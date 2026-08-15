/** OpenRouter client (browser). Streaming + JSON, fallback chain, usage accounting.
 *  The key is read from localStorage and sent directly to OpenRouter from the browser. */
import { getApiKey, getLocalEndpoint, isLocalModel, localModelId, LOCAL_SAMPLER_DEFAULTS, LOCAL_MAX_OUTPUT_DEFAULT } from "./config";
import { currentPush, getRelay, startJob, streamJob, type RawUsage } from "./relay";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface Usage { prompt_tokens: number; completion_tokens: number; cached_tokens?: number; cost?: number }
export interface LLMResult { text: string; usage: Usage; model: string; annotations?: { url: string; title?: string }[]; truncated?: boolean }

/** Per-save LLM preferences, set by the turn loop each call batch (module-level because the
 *  llm layer deliberately knows nothing about SaveState). */
export interface LLMPrefs {
  routeByPrice?: boolean;
  narratorReasoning?: boolean;   // default OFF: prose rarely needs visible thinking, and reasoning tokens bill as output
  preferDeepSeek?: boolean;      // first-party DeepSeek first for deepseek/* models — the 0.8–2% cache-hit rate lives there
}
let prefs: LLMPrefs = {};
export function setLLMPrefs(p: LLMPrefs): void { prefs = { ...p }; }

/** The provider object for a call, if any routing preferences apply. First-party DeepSeek gets
 *  priority for deepseek/* models (its cache-hit pricing is the cheapest long-context input on
 *  the platform by an order of magnitude); allow_fallbacks keeps the pool when it's unhealthy,
 *  and the sort governs that fallback pool — an explicit per-call sort (bookkeeper: throughput)
 *  beats the global price preference. */
function providerParam(model: string, sortOverride?: "price" | "throughput" | "latency"): Record<string, unknown> {
  const sort = sortOverride ?? (prefs.routeByPrice ? "price" : undefined);
  const deep = !!prefs.preferDeepSeek && model.startsWith("deepseek/");
  if (!sort && !deep) return {};
  return { provider: { ...(deep ? { order: ["DeepSeek"], allow_fallbacks: true } : {}), ...(sort ? { sort } : {}) } };
}

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
    "X-Title": "Weaver",
  };
}

/* ── WHERE A CALL ACTUALLY GOES ───────────────────────────────────────────────────────────────
 *
 *  Everything in this file used to POST to one URL with one key. A `local/` model id sends the
 *  same body to the OpenAI-compatible server on the player's own machine instead, with three
 *  differences that matter:
 *
 *    - NO OPENROUTER PARAMS. `provider`, `plugins`, `reasoning` and `usage:{include}` are routing
 *      and billing instructions for a marketplace that isn't in the loop. Some local servers
 *      tolerate unknown fields, some 400 on them; none of them do anything useful with these.
 *    - NO KEY REQUIRED. `key()` throws when the OpenRouter key is missing, which would make a
 *      fully-local setup impossible to run.
 *    - NO RELAY. The relay is a Cloudflare Worker; it cannot reach localhost, and a call that
 *      never leaves the LAN doesn't need a server holding the socket for it anyway.
 */
interface Target { url: string; headers: Record<string, string>; model: string; local: boolean }

function resolveTarget(model: string): Target {
  if (!isLocalModel(model)) return { url: OR_URL, headers: headers(), model, local: false };
  const ep = getLocalEndpoint();
  if (!ep) throw new Error(`"${model}" is a local model but no local endpoint is set — open Tuning → Local AI and give it a base URL (KoboldCpp's is usually http://localhost:5001/v1).`);
  return {
    url: `${ep.url}/chat/completions`,
    headers: { "Content-Type": "application/json", ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {}) },
    model: localModelId(model),
    local: true,
  };
}

/** THE MODEL THINKING WHERE THE PLAYER CAN SEE IT.
 *
 *  Cloud providers put chain-of-thought in a separate `reasoning` field. A local GGUF has no such
 *  channel: Qwen3 and friends write `<think>…</think>` straight into `content`, so without this the
 *  narrator's deliberation streams into the story pane as prose, gets stored as the turn, and is
 *  then replayed to the model as an example of how it writes. Suppressed for local calls only —
 *  a cloud model that types the literal string is writing dialogue. */
/** `<think>` IS NOT THE ONLY NAME FOR IT. This filter shipped knowing exactly one tag, and the very
 *  next local model wrote `<analysis>` instead and put nine hundred words of deliberation on the
 *  page. Finetunes and merges each pick their own; there is no standard, so match a family. */
export const REASON_TAGS = ["think", "thinking", "analysis", "analyze", "reasoning", "reason", "thought", "thoughts", "scratchpad", "reflection", "deliberation", "plan"];
const OPEN_RE = new RegExp(`<(${REASON_TAGS.join("|")})\\b[^>]{0,40}>`, "i");
/** The longest partial tag that could still be completed by the next chunk. */
const MAX_TAG = 48;

/** Streaming filter: deltas split tags across chunk boundaries, so hold back anything that could
 *  still turn out to be the front of one. */
function thinkFilter() {
  let pend = "";
  let inside: string | null = null;   // the tag we are inside of, if any
  const step = (chunk: string, final: boolean): string => {
    pend += chunk;
    let out = "";
    for (;;) {
      if (inside) {
        const close = new RegExp(`</${inside}\\s*>`, "i").exec(pend);
        if (!close) {
          // keep only enough to recognise a close tag that straddles the boundary
          pend = pend.slice(Math.max(0, pend.length - MAX_TAG));
          break;
        }
        pend = pend.slice(close.index + close[0].length);
        inside = null;
        continue;
      }
      const open = OPEN_RE.exec(pend);
      if (open) { out += pend.slice(0, open.index); pend = pend.slice(open.index + open[0].length); inside = open[1].toLowerCase(); continue; }
      if (final) { out += pend; pend = ""; break; }
      if (pend.length > MAX_TAG) { out += pend.slice(0, pend.length - MAX_TAG); pend = pend.slice(pend.length - MAX_TAG); }
      break;
    }
    return out;
  };
  return { push: (c: string) => step(c, false), flush: () => step("", true) };
}
/** Whole-response version, for the non-streaming path. */
export function stripThinking(text: string): string {
  if (!/<\/?[a-z]/i.test(text)) return text;
  const f = thinkFilter();
  const out = f.push(text) + f.flush();
  // An unterminated block ate everything — the model opened its deliberation and never closed it.
  // Hand back the raw text rather than "": the engine's prose salvage knows how to find where the
  // scene begins inside an unclosed preamble, and this layer does not.
  return out.trim() ? out.replace(/^\s+/, "") : text;
}


/** The sampler fields for a local call — standard OpenAI names only, and omitted entirely when set
 *  to 0 so the server's own configuration wins. See LocalEndpoint for why these exist at all. */
function localSampler(): Record<string, number> {
  const ep = getLocalEndpoint();
  const guard = ep?.loop_guard ?? LOCAL_SAMPLER_DEFAULTS.loop_guard;
  const topP = ep?.top_p ?? LOCAL_SAMPLER_DEFAULTS.top_p;
  // ONE DIAL, BOTH PENALTIES. They answer different halves of the same failure and a player tuning
  // a local model should not have to know which: frequency_penalty pushes against re-emitting the
  // same TOKENS, which is what stops a clause cycling until the budget dies, while presence_penalty
  // pushes against returning to material already used, which is what stops a character delivering
  // a line and then delivering it again verbatim two paragraphs later. A real save produced both
  // in one response. Presence is the gentler of the two — it costs novelty when set high, and the
  // prose has a scene to stay inside.
  return {
    ...(guard > 0 ? { frequency_penalty: guard, presence_penalty: Math.round(guard * 50) / 100 } : {}),
    ...(topP > 0 ? { top_p: topP } : {}),
  };
}

/** Cap a PROSE budget for a local server. Bookkeeping calls are untouched: a diff is JSON and
 *  truncating it loses a turn's worth of state, which is a worse failure than a long scene. */
function localMaxTokens(asked: number): number {
  const cap = getLocalEndpoint()?.max_output ?? LOCAL_MAX_OUTPUT_DEFAULT;
  return cap > 0 ? Math.min(asked, cap) : asked;
}

/** Qwen3's soft switch. The control token is read by the chat template, not the sampler, so it has
 *  to ride inside a message; the last user message is where the template looks. */
function applyNoThink(messages: any[]): any[] {
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user") continue;
    if (typeof out[i].content === "string") {
      if (!/\/no_?think/.test(out[i].content)) out[i].content = `${out[i].content}\n/no_think`;
    }
    return out;
  }
  return out;
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
export interface CallOpts { providerSort?: "price" | "throughput" | "latency"; omitReasoning?: boolean; online?: boolean; searchQuery?: string;
  /** Abort the request in flight. A turn is two long calls back to back — the narrator, then the
   *  bookkeeper — and until now there was no way to stop either one. A typo, a wrong name, a scene
   *  going somewhere you did not mean: you watched it finish, then undid it. */
  signal?: AbortSignal }

/** Thrown when the caller aborted. Distinguished from a real failure so nothing gets logged as an
 *  error, no fallback model is spent, and the turn can unwind quietly. */
/** THE PROVIDER NEVER STARTED TALKING.
 *
 *  A hung provider is not an error — it is a socket that stays open, producing nothing, for as long
 *  as you are willing to wait. Turn 1 of one save took 320 SECONDS to produce 385 narrator tokens
 *  and 430 bookkeeper tokens, which is not generation, it is queueing. Nothing in the client had any
 *  opinion about how long that was allowed to take.
 *
 *  Thrown when the first token has not arrived in TTFT_MS, so the caller can re-route rather than
 *  keep waiting. Distinct from Cancelled: the player did not ask for this. */
export class Stalled extends Error {
  constructor(ms: number) { super(`no first token in ${Math.round(ms / 1000)}s`); this.name = "Stalled"; }
}
/** How long to wait for the FIRST token before giving up on a provider and asking for another one.
 *  Generous: a big cached prompt on a healthy provider starts inside ten seconds, and a cold cache on
 *  a busy one can legitimately take twenty. Past forty-five, nothing good is happening. */
export const TTFT_MS = 45_000;

export class Cancelled extends Error {
  constructor() { super("cancelled"); this.name = "Cancelled"; }
}
/** Matched on the error's NAME, not its text. A model that happens to say "aborted" in a 500 body
 *  is a failure and must still get the fallback ladder; only a real abort unwinds the turn. */
export const isCancel = (e: unknown): boolean =>
  e instanceof Cancelled || (e as any)?.name === "AbortError" || (e as any)?.name === "Cancelled";


/** CHATLOG-MODE message builder. The full state snapshot (I-frame) rides inside the system
 *  message; the turns since the anchor are literal user/assistant pairs; the current turn's
 *  user message carries the small P-frame delta + direction + action. Between anchors every
 *  prior byte is identical, so implicit prefix caching covers nearly the whole input. For
 *  Anthropic models, cache_control breakpoints are set on the system block and the last
 *  history pair. */
export function buildChatlogMessages(system: string, anchorDigest: string, pairs: { user: string; assistant: string }[], currentUser: string, model: string): any[] {
  const anthropic = model.startsWith("anthropic/");
  const msgs: any[] = [];
  // ── THE CONTRACT GETS ITS OWN BLOCK, AND NOTHING ELSE GOES IN IT ────────────────────────────
  // The narrator contract is 14,455 tokens and never changes; the anchored digest is ~9,000 and
  // changes every few turns. They were concatenated into one system message, which means the two
  // shared a fate: every re-anchor rewrote the head of the prefix and threw away the cache on the
  // rules as well as on the snapshot. Measured across a 121-turn save, the contract was 55% of all
  // narrator input and the whole prompt cached at 31%.
  //
  // Prefix caching works on prefixes. Split into two blocks, in order of how often each changes, the
  // contract's 14k caches once and holds for the entire story, and only the snapshot pays for a
  // re-anchor. Nothing about what the model is told changes — only where the boundaries fall.
  if (anthropic) msgs.push({ role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] });
  else msgs.push({ role: "system", content: system });
  const world = `=== WORLD STATE (anchored snapshot; per-turn deltas follow in the conversation) ===\n${anchorDigest}`;
  if (anthropic) msgs.push({ role: "system", content: [{ type: "text", text: world, cache_control: { type: "ephemeral" } }] });
  else msgs.push({ role: "system", content: world });
  pairs.forEach((p, i) => {
    const lastPair = i === pairs.length - 1;
    msgs.push({ role: "user", content: p.user || "(continue)" });
    if (anthropic && lastPair) msgs.push({ role: "assistant", content: [{ type: "text", text: p.assistant || "…", cache_control: { type: "ephemeral" } }] });
    else msgs.push({ role: "assistant", content: p.assistant || "…" });
  });
  msgs.push({ role: "user", content: currentUser });
  return msgs;
}

/** HOW LONG A LOCAL MODEL IS ALLOWED TO SAY NOTHING.
 *
 *  TTFT_MS exists to catch a cloud provider that took the request and then queued it forever. A
 *  local model is not queueing — it is doing the arithmetic, on your GPU, and the first token
 *  legitimately waits for the entire prompt to be prefilled. Weft's narrator prompt is ~26k tokens;
 *  on a machine doing 300 tok/s of prefill that is ninety seconds before generation even starts, and
 *  a cold cache on CPU-only inference is minutes. Forty-five seconds would abort every first turn. */
export const LOCAL_TTFT_MS = 900_000;

async function onceLocal(messages: any[], tgt: Target, slug: string, json: JsonMode, maxTokens: number, opts?: CallOpts): Promise<LLMResult> {
  const ep = getLocalEndpoint();
  const msgs = ep?.no_think === true ? applyNoThink(messages) : messages;
  // json_schema support is patchy across local servers and llama.cpp releases; the ladder in
  // `complete()` already downgrades a rejected schema to plain json_object on the SAME model,
  // which for a local setup is exactly the right recovery (there is nowhere cheaper to fall to).
  const rf = json
    ? (typeof json === "object"
        ? { response_format: { type: "json_schema", json_schema: { name: json.name ?? "diff", strict: false, schema: json.schema } } }
        : { response_format: { type: "json_object" } })
    : {};
  if (opts?.signal?.aborted) throw new Cancelled();
  const res = await fetch(tgt.url, {
    method: "POST",
    signal: opts?.signal,
    headers: tgt.headers,
    body: JSON.stringify({ model: tgt.model, messages: msgs, max_tokens: maxTokens, temperature: json ? 0.2 : 0.85, ...localSampler(), ...rf }),
  });
  if (!res.ok) throw new Error(`local model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  let text: string = typeof msg.content === "string" ? msg.content : "";
  if (!text && Array.isArray(msg.content)) text = msg.content.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  if (!text && typeof msg.reasoning === "string" && /[{[]/.test(msg.reasoning)) text = msg.reasoning;
  text = stripThinking(text);
  if (!text.trim()) throw new Error("empty completion");
  return {
    text,
    // A local call costs nothing, and saying 0 is different from saying "unknown" — the ledger
    // should show a free turn as free rather than as a gap.
    usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0, cached_tokens: 0, cost: 0 },
    model: slug,
    truncated: data.choices?.[0]?.finish_reason === "length",
  };
}

async function once(messages: any[], model: string, json: JsonMode, maxTokens: number, opts?: CallOpts): Promise<LLMResult> {
  const tgt = resolveTarget(model);
  if (tgt.local) return onceLocal(messages, tgt, model, json, maxTokens, opts);
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
  if (opts?.signal?.aborted) throw new Cancelled();
  const res = await fetch(OR_URL, {
    method: "POST",
    signal: opts?.signal,
    headers: headers(),
    body: JSON.stringify({
      model, messages: groundMsgs, max_tokens: maxTokens,
      ...(webPlugin ? { plugins: webPlugin } : {}),
      temperature: json ? 0.2 : 0.85,
      ...rf,
      // ROUTING: an explicit per-call sort (the bookkeeper routes for throughput) beats the
      // global price preference; first-party DeepSeek priority rides on top for deepseek models.
      ...providerParam(model, opts?.providerSort),
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
  // RAN OUT OF ROOM, rather than finished. Only the streaming path reported this, so a non-streamed
  // JSON call that filled its budget looked identical to one that simply produced malformed output —
  // and the two need completely different handling. Truncated content is MISSING, not mangled: asking
  // a model to re-emit it as valid JSON buys a full round trip and returns the same missing content.
  return {
    text,
    usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0, cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, cost: data.usage?.cost ?? undefined },
    model: data.model ?? model,
    truncated: data.choices?.[0]?.finish_reason === "length",
  };
}

export async function complete(messages: any[], model: string, fallback: string, json: JsonMode = false, maxTokens = 4000, opts?: CallOpts): Promise<LLMResult> {
  try { return await once(messages, model, json, maxTokens, opts); }
  catch (e1: any) {
    // A CANCELLATION IS NOT A FAILURE. Without this the whole recovery ladder below runs on the way
    // out — schema retry, reasoning retry, then the fallback model — so pressing stop would fire
    // three more requests and bill for all of them.
    if (isCancel(e1)) throw new Cancelled();
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

/** `jobId`, when a relay is configured, is what makes this call survive the app being killed. It is
 *  generated once per turn and journaled BEFORE the request goes out, so a cold-booted app can ask
 *  the relay for the completion it already paid for. Passing nothing keeps the old direct path. */
export async function* completeStream(messages: any[], model: string, fallback: string, maxTokens = 4000, online = false, searchQuery?: string, signal?: AbortSignal, jobId?: string): AsyncGenerator<string, LLMResult, unknown> {
  const attempt = async function* (m: string, reroute = false): AsyncGenerator<string, LLMResult, unknown> {
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
    const tgt = resolveTarget(m);
    let outMsgs = messages;
    const q = searchQuery?.trim();
    // A local server has no web plugin — grounding is an OpenRouter capability. Skip the steering
    // line too, so a local turn isn't handed a search instruction nothing is going to act on.
    if (online && q && !tgt.local && !m.endsWith(":online")) {
      outMsgs = messages.map((x) => ({ ...x }));
      for (let i = outMsgs.length - 1; i >= 0; i--) {
        if (outMsgs[i].role === "user" && typeof outMsgs[i].content === "string") {
          outMsgs[i] = { ...outMsgs[i], content: `${outMsgs[i].content}\n\n=== WEB SEARCH TARGET (search the web for exactly this, ignore other topics) ===\n${q}` };
          break;
        }
      }
    }
    const localEp = tgt.local ? getLocalEndpoint() : null;
    if (tgt.local && localEp?.no_think === true) outMsgs = applyNoThink(outMsgs);
    const body: Record<string, unknown> = tgt.local
      // A local server gets the plain OpenAI body and nothing else. Marketplace routing, billing
      // and reasoning switches are not merely useless here — llama.cpp's server rejects some
      // unknown fields outright, which would fail every local turn for a parameter about pricing.
      // THE BUDGET IS CAPPED ON THE WAY OUT. See LocalEndpoint.max_output: a local window is small
      // enough that a 5000-token ask can eat a third of it, and a looping model fills whatever it
      // is given. TURN ENDINGS still decides where the scene stops; this only bounds the room.
      ? { model: tgt.model, messages: outMsgs, max_tokens: localMaxTokens(maxTokens), temperature: 0.85, stream: true, ...localSampler() }
      : { model: m, messages: outMsgs, max_tokens: maxTokens, temperature: 0.85, stream: true, usage: { include: true },
      // routing rides the narrator stream too — it's the biggest call of the turn. On a re-route
      // after a stall, drop the price sort and the provider pin: whoever answers fastest.
      ...(reroute ? { provider: { sort: "throughput", allow_fallbacks: true } } : providerParam(m)),
      // NO THINKING FOR PROSE: reasoning-tier models default to thinking, and those tokens bill
      // as output. A scene doesn't need deliberation; the directive already carries the design.
      ...(prefs.narratorReasoning ? {} : { reasoning: { enabled: false } }),
    };
    if (online && !tgt.local && !m.endsWith(":online")) {
      const web: Record<string, unknown> = { id: "web", max_results: 3 };
      if (q) web.search_prompt = `Web results for "${q}". Incorporate the factual detail into the prose; do not cite sources or break fiction.`;
      body.plugins = [web];
    }
    if (signal?.aborted) throw new Cancelled();

    // ── THE RELAY TAKES THE CALL ──────────────────────────────────────────────────────────────
    // With a relay configured and a job id for this turn, the request is made by the relay and this
    // tab only watches. The difference shows up when the app is killed mid-narration, which on iOS
    // is the common case rather than the rare one: the relay is still holding the socket, so the
    // completion finishes, and the same job id fetches it whole on the next cold boot.
    //
    // A failure here falls through to the direct call below rather than failing the turn. A relay
    // that is down, misconfigured, or out of quota should cost the player a background turn, never
    // the turn itself.
    // …and it cannot take a LOCAL call. The relay is a Cloudflare Worker: `localhost` from its side
    // is its own sandbox, not the player's desk. A local turn stays in the tab.
    const relay = jobId && !tgt.local ? getRelay() : null;
    if (relay && jobId) {
      try {
        await startJob(relay, jobId, body, await currentPush());
        // Driven by hand rather than with yield*, because the deltas have to be accumulated on the
        // way past: the caller gets them for live rendering AND the finished text is the turn.
        const it = streamJob(relay, jobId, signal);
        let full = "";
        let tail: { usage?: RawUsage | null; truncated?: boolean } = {};
        for (;;) {
          const step = await it.next();
          if (step.done) { tail = step.value ?? {}; break; }
          full += step.value;
          yield step.value;
        }
        if (!full.trim()) throw new Error("relay returned an empty stream");
        return {
          text: full,
          usage: {
            prompt_tokens: tail.usage?.prompt_tokens ?? 0,
            completion_tokens: tail.usage?.completion_tokens ?? 0,
            cached_tokens: tail.usage?.prompt_tokens_details?.cached_tokens ?? 0,
            cost: tail.usage?.cost,
          },
          model: m,
          truncated: !!tail.truncated,
        };
      } catch (e) {
        if (isCancel(e)) throw new Cancelled();
        console.warn("[relay] falling back to a direct call:", (e as Error)?.message);
      }
    }

    // TIME TO FIRST TOKEN, WATCHED. The abort controller is chained to the caller's signal so the
    // stop button still works, and the timer is cleared the moment anything arrives — a slow
    // GENERATION is fine and none of our business, a provider that never starts is not.
    const guard = new AbortController();
    const onAbort = () => guard.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let started = false;
    let stalled = false;
    // A local model's silence before the first token is PREFILL, not queueing. See LOCAL_TTFT_MS.
    const ttftMs = tgt.local ? LOCAL_TTFT_MS : TTFT_MS;
    const ttft = setTimeout(() => { if (!started) { stalled = true; guard.abort(); } }, ttftMs);

    let res: Response;
    try {
      res = await fetch(tgt.url, { method: "POST", signal: guard.signal, headers: tgt.headers, body: JSON.stringify(body) });
    } catch (e) {
      clearTimeout(ttft); signal?.removeEventListener("abort", onAbort);
      if (stalled) throw new Stalled(ttftMs);
      // A local endpoint that isn't running fails as an opaque browser network error ("Failed to
      // fetch"), which tells the player nothing about which of the four model slots reached for a
      // server that isn't there.
      if (tgt.local) throw new Error(`could not reach the local model at ${tgt.url} — is the server running, and does it allow requests from ${location.origin}? (${String((e as Error)?.message ?? e).slice(0, 120)})`);
      throw e;
    }
    if (!res.ok || !res.body) { clearTimeout(ttft); signal?.removeEventListener("abort", onAbort); throw new Error(`${tgt.local ? "local model" : "OpenRouter"} ${res.status}: ${(await res.text()).slice(0, 300)}`); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    // Local GGUFs stream their deliberation inline; strip it on the way past so it never reaches
    // the story pane and never gets stored as the turn.
    const think = tgt.local ? thinkFilter() : null;
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
          if (delta) {
            if (!started) { started = true; clearTimeout(ttft); }
            const shown = think ? think.push(delta) : delta;
            if (shown) { full += shown; yield shown; }
          }
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
    clearTimeout(ttft);
    signal?.removeEventListener("abort", onAbort);
    if (think) { const tail = think.flush(); if (tail) { full += tail; yield tail; } }
    if (stalled) throw new Stalled(ttftMs);
    if (!full.trim()) throw new Error("empty stream");
    if (tgt.local && !usage.cost) usage = { ...usage, cost: 0 };
    return { text: full, usage, model: m, annotations: annotations.length ? annotations : undefined, truncated };
  };
  try { return yield* attempt(model); }
  catch (e: any) {
    // stopping the narrator must not silently re-buy the whole scene on the fallback model
    if (isCancel(e)) throw new Cancelled();
    // A STALL IS A ROUTING PROBLEM, NOT A MODEL PROBLEM. The provider never started talking, so the
    // model has not been given a chance to fail — switching to a different MODEL would be answering
    // the wrong question and would change the prose for a reason the player never chose. Ask for the
    // same model on the fastest available provider instead, with no pinned order.
    //
    // This matters most in exactly the configuration that produced it: route-by-price plus a pin to
    // first-party DeepSeek sends the longest call of the turn to the cheapest, most-queued host
    // there is. The bookkeeper already opts out of price routing because "bookkeeping latency is the
    // felt latency" — which is true, and truer still of the narrator, which is twice the call.
    //
    // None of that applies to a local model: there is no provider pool to re-route within, so a
    // second identical request would just spend another fifteen minutes not starting. Fall through
    // to the fallback model, which for a local narrator is usually a cloud one.
    if (e?.name === "Stalled" && !isLocalModel(model)) {
      logErr(model, e);
      console.warn(`[llm] ${model} never started; re-routing for throughput`);
      return yield* attempt(model, true);
    }
    logErr(model, e); return yield* attempt(fallback);
  }
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

/**
 * CLOSING AN UNFINISHED SENTENCE MAKES IT LOOK FINISHED.
 *
 * The salvage used to end `if (inStr) out += '"'`, which is the right instinct and the wrong place
 * to put the quote. A response cut off mid-string is cut off mid-WORD, and adding the closing quote
 * turns a fragment into a field value that every consumer downstream reads as complete. From one
 * save, all four of these are what the story actually ran on:
 *
 *   Tigris   want:    "…the stash of silver denarii she hid in the hollowed stone footings behind
 *                      the Subura lud"
 *            blocked: "…the day's events with Rabi and the stranger have kept her aw"
 *   Marcus   want:    "Seize and drain three barrels of illicit lamp-oil stashed in the cellar
 *                      beneath the Subura cook"
 *   Clodia   want:    "Force the grain dealer's carter to take back the spoiled, insect-e"
 *
 * Those went onto cards, into the digest the narrator reads every turn, into the world-motion feed
 * the player is shown ("Tigris works toward … behind the Subura lud (15%)"), and nothing anywhere
 * could tell they were half a sentence, because syntactically they were perfect.
 *
 * The salvage is still worth doing — a diff cut three-quarters through still carries its memories,
 * edges and facts, and that is most of a turn's bookkeeping. What it must not do is keep the one
 * value it KNOWS is incomplete. So drop it: rewind to where the unterminated string opened, shed
 * the key it belonged to, and close the structure without it. A missing field means "no change",
 * which is true. A truncated field is a lie the rest of the engine cannot detect.
 */
export function repairJson(t: string): string {
  let inStr = false, esc = false, strStart = -1; const stack: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { if (!inStr) strStart = i; inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  // Back up over the fragment itself, then shed whatever the cut left dangling: a trailing comma,
  // a key whose value never arrived (not valid JSON, and worth nothing without it), and an object
  // or array element that opened and was immediately cut, which is not an element at all. Each of
  // those can expose the next, so keep going until nothing changes.
  let out = inStr && strStart >= 0 ? t.slice(0, strStart) : t;
  for (;;) {
    const before = out;
    out = out.replace(/[\s,]+$/, "").replace(/"(?:[^"\\]|\\.)*"\s*:\s*$/, "");
    const empty = /,\s*[{[]\s*$/.exec(out);
    if (empty && stack.length > 1) { out = out.slice(0, empty.index); stack.pop(); }
    if (out === before) break;
  }
  while (stack.length) out += stack.pop();
  return out;
}

export function safeJson<T>(text: string, fallback: T): T {
  const ex = extractJson(text);
  try { return JSON.parse(ex) as T; } catch { /* try repair */ }
  try { return JSON.parse(repairJson(ex)) as T; } catch { return fallback; }
}

export async function generateImage(prompt: string, model = "google/gemini-2.5-flash-image", refImages: string[] = [], aspect: "portrait" | "landscape" | "square" = "landscape"): Promise<{ url: string; cost?: number }> {
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
  // image models bill per image; when the provider reports usage.cost we keep the REAL number
  return { url: img as string, cost: j.usage?.cost ?? undefined };
}
