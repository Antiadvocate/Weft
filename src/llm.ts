/** OpenRouter client (browser). Streaming + JSON, fallback chain, usage accounting.
 *  The key is read from localStorage and sent directly to OpenRouter from the browser. */
import { getApiKey } from "./config";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface Usage { prompt_tokens: number; completion_tokens: number; cached_tokens?: number; cost?: number }
export interface LLMResult { text: string; usage: Usage; model: string; annotations?: { url: string; title?: string }[]; truncated?: boolean }

/** Per-save LLM preferences, set by the turn loop each call batch (module-level because the
 *  llm layer deliberately knows nothing about SaveState). */
export interface LLMPrefs { routeByPrice?: boolean }
let prefs: LLMPrefs = {};
export function setLLMPrefs(p: LLMPrefs): void { prefs = { ...p }; }

/** Ring buffer of recent LLM failures — the old `complete()` swallowed the primary error
 *  entirely, so a misbehaving narrator model looked identical to a healthy fallback. */
export const llmErrors: { at: number; model: string; message: string }[] = [];
function logErr(model: string, e: any): void {
  llmErrors.push({ at: Date.now(), model, message: String(e?.message ?? e).slice(0, 300) });
  if (llmErrors.length > 20) llmErrors.shift();
  console.warn(`[llm] ${model} failed:`, e?.message ?? e);
}

function key(): string {
  const k = getApiKey();
  if (!k) throw new Error("No OpenRouter key set — open Tuning (or the welcome screen) and paste your key.");
  return k;
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key()}`,
    "HTTP-Referer": location.origin,
    "X-Title": "Weft",
  };
}

export function buildMessages(system: string, stable: string, volatile: string, model: string): any[] {
  const anthropic = model.startsWith("anthropic/");
  if (anthropic) {
    return [
      { role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] },
      { role: "user", content: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }, { type: "text", text: volatile }] },
    ];
  }
  return [
    { role: "system", content: system },
    { role: "user", content: stable + "\n\n" + volatile },
  ];
}

export type JsonMode = boolean | { schema: object; name?: string };
export interface CallOpts { providerSort?: "price" | "throughput" | "latency"; omitReasoning?: boolean; online?: boolean; searchQuery?: string }


/** CHATLOG-MODE message builder. The full state snapshot (I-frame) rides inside the system
 *  message; the turns since the anchor are literal user/assistant pairs; the current turn's
 *  user message carries the small P-frame delta + direction + action. Between anchors every
 *  prior byte is identical, so implicit prefix caching covers nearly the whole input. For
 *  Anthropic models, cache_control breakpoints are set on the system block and the last
 *  history pair. */
export function buildChatlogMessages(system: string, anchorDigest: string, pairs: { user: string; assistant: string }[], currentUser: string, model: string): any[] {
  const sys = `${system}\n\n=== WORLD STATE (anchored snapshot; per-turn deltas follow in the conversation) ===\n${anchorDigest}`;
  const anthropic = model.startsWith("anthropic/");
  const msgs: any[] = [];
  if (anthropic) msgs.push({ role: "system", content: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }] });
  else msgs.push({ role: "system", content: sys });
  pairs.forEach((p, i) => {
    const lastPair = i === pairs.length - 1;
    msgs.push({ role: "user", content: p.user || "(continue)" });
    if (anthropic && lastPair) msgs.push({ role: "assistant", content: [{ type: "text", text: p.assistant || "…", cache_control: { type: "ephemeral" } }] });
    else msgs.push({ role: "assistant", content: p.assistant || "…" });
  });
  msgs.push({ role: "user", content: currentUser });
  return msgs;
}

async function once(messages: any[], model: string, json: JsonMode, maxTokens: number, opts?: CallOpts): Promise<LLMResult> {
  // CONSTRAINED DECODING: when a schema is supplied, ask the provider to enforce it at the
  // decoder (structured outputs). This kills malformed JSON at the source instead of repairing
  // it after. Providers that don't support json_schema reject the request; `complete` catches
  // that and retries in plain json_object mode.
  const rf = json
    ? (typeof json === "object"
        ? { response_format: { type: "json_schema", json_schema: { name: json.name ?? "diff", strict: false, schema: json.schema } } }
        : { response_format: { type: "json_object" } })
    : {};
  // WEB GROUNDING (non-streaming) — same mechanism as completeStream: the web plugin has no
  // query field, so to keep Exa on-topic we push a high-salience search line onto the tail user
  // message and restate it in search_prompt. Used by the Forge (world-building from real media/
  // places/history) instead of the fragile ":online" model-slug suffix.
  let groundMsgs = messages;
  const gq = opts?.searchQuery?.trim();
  const groundOn = !!opts?.online && !model.endsWith(":online");
  if (groundOn && gq) {
    groundMsgs = messages.map((x) => ({ ...x }));
    for (let i = groundMsgs.length - 1; i >= 0; i--) {
      if (groundMsgs[i].role === "user" && typeof groundMsgs[i].content === "string") {
        groundMsgs[i] = { ...groundMsgs[i], content: `${groundMsgs[i].content}\n\n=== WEB SEARCH TARGET (search the web for exactly this, ignore other topics) ===\n${gq}` };
        break;
      }
    }
  }
  const webPlugin = groundOn
    ? [gq
        ? { id: "web", max_results: 3, search_prompt: `Web results for "${gq}". Use the factual detail; cite nothing.` }
        : { id: "web", max_results: 3 }]
    : undefined;
  const res = await fetch(OR_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model, messages: groundMsgs, max_tokens: maxTokens,
      ...(webPlugin ? { plugins: webPlugin } : {}),
      temperature: json ? 0.2 : 0.85,
      ...rf,
      // ROUTING: an explicit per-call sort (the bookkeeper routes for throughput) beats the
      // global price preference. Bookkeeping wants tokens/sec, not pennies.
      ...(opts?.providerSort ? { provider: { sort: opts.providerSort } } : prefs.routeByPrice ? { provider: { sort: "price" } } : {}),
      // NO THINKING FOR BOOKKEEPING: structured-output calls carry reasoning disabled — a diff
      // needs transcription, not deliberation; hidden thinking tokens are pure latency on
      // reasoning-capable models. Dropped automatically if a provider rejects the parameter.
      ...(json && !opts?.omitReasoning ? { reasoning: { enabled: false } } : {}),
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  // CONTENT RECOVERY — the #1 silent bookkeeping death. Reasoning-tier models (and some
  // providers under json_schema) return an empty `content` string and put the actual payload
  // in `reasoning`, or hand back `content` as an array of parts rather than a string. Treating
  // only string `content` as valid made every one of those turns a dead black hole: the sim
  // call threw "empty completion", burned the (identical) fallback, and recorded nothing.
  // Pull text from wherever it actually landed; for JSON calls, a reasoning field that contains
  // a JSON object is a perfectly good source.
  let text: string = typeof msg.content === "string" ? msg.content : "";
  if (!text && Array.isArray(msg.content)) {
    text = msg.content.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  }
  if (!text && typeof msg.reasoning === "string" && /[{[]/.test(msg.reasoning)) {
    text = msg.reasoning; // constrained JSON that leaked into the reasoning channel
  }
  if (!text && typeof msg.refusal === "string" && msg.refusal.trim()) {
    // a real refusal is not an empty completion — surface it so fallback/repair can react
    throw new Error(`model refusal: ${msg.refusal.slice(0, 200)}`);
  }
  if (!text) throw new Error("empty completion");
  return {
    text,
    usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0, cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, cost: data.usage?.cost ?? undefined },
    model: data.model ?? model,
  };
}

export async function complete(messages: any[], model: string, fallback: string, json: JsonMode = false, maxTokens = 4000, opts?: CallOpts): Promise<LLMResult> {
  try { return await once(messages, model, json, maxTokens, opts); }
  catch (e1: any) {
    logErr(model, e1);
    const msg = String(e1?.message ?? "");
    // the reasoning parameter itself rejected → same call without it
    if (json && /reasoning/i.test(msg)) {
      try { return await once(messages, model, json, maxTokens, { ...opts, omitReasoning: true }); } catch (e0: any) { logErr(model, e0); }
    }
    // a schema rejection is a capability gap, not a model failure — retry SAME model, plain JSON
    if (typeof json === "object" && /response_format|json_schema|400/.test(msg)) {
      try { return await once(messages, model, true, maxTokens, opts); } catch (e2: any) { logErr(model, e2); }
    }
    // EMPTY/REFUSAL ON A JSON CALL — before spending the fallback (which for the bookkeeper is
    // usually the SAME model), give the primary one more chance with the constraints relaxed:
    // drop json_schema down to plain json_object AND turn reasoning back on. An empty completion
    // is very often the constrained decoder + disabled reasoning starving a reasoning-tier model;
    // loosening both is what actually recovers the diff instead of re-failing identically.
    if (json && /empty completion|refusal/i.test(msg)) {
      try { return await once(messages, model, true, maxTokens, { ...opts, omitReasoning: true }); } catch (e2b: any) { logErr(model, e2b); }
    }
    // FALLBACK — but only if it's genuinely a different model. Routing a dead call to an
    // identical fallback just burns time and returns the same nothing; skip straight to the
    // throw so the caller's watchdog/heuristics take over this turn.
    if (fallback && fallback !== model) {
      try { return await once(messages, fallback, typeof json === "object" ? true : json, maxTokens, { ...opts, omitReasoning: true }); }
      catch (e3: any) { logErr(fallback, e3); throw e3; }
    }
    throw e1;
  }
}

export async function* completeStream(messages: any[], model: string, fallback: string, maxTokens = 4000, online = false, searchQuery?: string): AsyncGenerator<string, LLMResult, unknown> {
  const attempt = async function* (m: string): AsyncGenerator<string, LLMResult, unknown> {
    // WEB GROUNDING — the explicit plugins form, not the ":online" slug. Some provider routes
    // reject a suffixed slug outright, and the catch below then re-ran the turn WITHOUT search
    // via the fallback: grounding failed silently and looked like it did nothing. The plugins
    // param is the documented path, works with streaming, and returns url_citation annotations
    // we surface to the player as proof the search actually happened.
    //
    // TARGETED QUERY — the web plugin has NO query field: Exa auto-derives the search terms from
    // the message content, and against a 5000-token narrator prompt that auto-query grabs whatever
    // is most salient (hence a Warhammer scene pulling sports links). The fix is to steer Exa: we
    // (a) push a single high-salience search line onto the tail of the last user message so it
    // dominates the derived query, and (b) restate it in search_prompt. Both point Exa at the
    // topic we actually want instead of letting it guess from the whole digest.
    let outMsgs = messages;
    const q = searchQuery?.trim();
    if (online && q && !m.endsWith(":online")) {
      outMsgs = messages.map((x) => ({ ...x }));
      for (let i = outMsgs.length - 1; i >= 0; i--) {
        if (outMsgs[i].role === "user" && typeof outMsgs[i].content === "string") {
          outMsgs[i] = { ...outMsgs[i], content: `${outMsgs[i].content}\n\n=== WEB SEARCH TARGET (search the web for exactly this, ignore other topics) ===\n${q}` };
          break;
        }
      }
    }
    const body: Record<string, unknown> = { model: m, messages: outMsgs, max_tokens: maxTokens, temperature: 0.85, stream: true, usage: { include: true } };
    if (online && !m.endsWith(":online")) {
      const web: Record<string, unknown> = { id: "web", max_results: 3 };
      if (q) web.search_prompt = `Web results for "${q}". Incorporate the factual detail into the prose; do not cite sources or break fiction.`;
      body.plugins = [web];
    }
    const res = await fetch(OR_URL, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "", usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
    let truncated = false;
    const annotations: { url: string; title?: string }[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) { full += delta; yield delta; }
          // hit the output cap mid-generation — the tail (scene footer) was cut. Flag it so the
          // caller can recover rather than silently losing the footer.
          if (j.choices?.[0]?.finish_reason === "length") truncated = true;
          const ann = j.choices?.[0]?.delta?.annotations ?? j.choices?.[0]?.message?.annotations;
          if (Array.isArray(ann)) for (const a of ann) {
            const u = a?.url_citation?.url ?? a?.url;
            if (u && !annotations.some((x) => x.url === u)) annotations.push({ url: u, title: a?.url_citation?.title });
          }
          if (j.usage) usage = { prompt_tokens: j.usage.prompt_tokens ?? 0, completion_tokens: j.usage.completion_tokens ?? 0, cached_tokens: j.usage.prompt_tokens_details?.cached_tokens ?? 0, cost: j.usage.cost ?? undefined };
        } catch { /* keep-alive */ }
      }
    }
    if (!full.trim()) throw new Error("empty stream");
    return { text: full, usage, model: m, annotations: annotations.length ? annotations : undefined, truncated };
  };
  try { return yield* attempt(model); }
  catch (e: any) { logErr(model, e); return yield* attempt(fallback); }
}

export function extractJson(text: string): string {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start === -1) return t;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return t.slice(start);
}

export function repairJson(t: string): string {
  let inStr = false, esc = false; const stack: string[] = [];
  for (const ch of t) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = t;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

export function safeJson<T>(text: string, fallback: T): T {
  const ex = extractJson(text);
  try { return JSON.parse(ex) as T; } catch { /* try repair */ }
  try { return JSON.parse(repairJson(ex)) as T; } catch { return fallback; }
}

export async function generateImage(prompt: string, model = "google/gemini-2.5-flash-image", refImages: string[] = [], aspect: "portrait" | "landscape" | "square" = "landscape"): Promise<string> {
  // reference images (e.g. character portraits) are passed as image_url content blocks;
  // models that support multimodal input use them for consistency, others ignore them.
  // Aspect: the image models default to landscape/square, so we both (a) state the orientation
  // forcefully in the text and (b) pass a generation hint where the routing supports it.
  const ratio = aspect === "portrait" ? "2:3" : aspect === "square" ? "1:1" : "16:9";
  const orient = aspect === "portrait"
    ? "IMPORTANT: vertical portrait orientation, tall 2:3 aspect ratio, taller than wide. "
    : aspect === "square" ? "Square 1:1 aspect ratio. " : "";
  const content: any[] = [{ type: "text", text: orient + prompt }];
  for (const url of refImages.slice(0, 4)) if (url?.startsWith("data:") || url?.startsWith("http")) content.push({ type: "image_url", image_url: { url } });
  const res = await fetch(OR_URL, {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      model, messages: [{ role: "user", content }], modalities: ["image", "text"],
      // generation hints — honored by routings that support image config, ignored otherwise
      image_config: { aspect_ratio: ratio },
    }),
  });
  if (!res.ok) throw new Error(`image gen HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) throw new Error("model returned no image — try google/gemini-2.5-flash-image");
  return img as string;
}
