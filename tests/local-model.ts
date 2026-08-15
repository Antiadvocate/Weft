/* THE MODEL ON YOUR OWN MACHINE.
 *
 * A `local/…` model id routes to the player's own OpenAI-compatible server instead of OpenRouter.
 * Three things have to hold or the feature is worse than not having it:
 *
 *   1. NOTHING OPENROUTER-SHAPED IN THE BODY. `provider`, `plugins`, `usage:{include}` and
 *      `reasoning` are marketplace instructions. llama.cpp's server 400s on some unknown fields,
 *      which would fail every local turn over a parameter about pricing.
 *   2. NO KEY REQUIRED. `key()` throws when the OpenRouter key is missing. A fully-local setup has
 *      no key and must still be able to play.
 *   3. THE MODEL'S THINKING NEVER REACHES THE PAGE. Cloud providers put chain-of-thought in a
 *      separate field; a local GGUF writes <think>…</think> straight into content. Unfiltered, the
 *      narrator's deliberation streams into the story pane, gets stored as the turn, and is then
 *      replayed to the model as an example of how it writes. The tags arrive split across stream
 *      chunks, so a naive replace on the finished text is not enough — nothing may be YIELDED.
 */
import { completeStream, stripThinking } from "../src/llm";
import { LOCAL_PREFIX, isLocalModel, localModelId, setLocalEndpoint, getLocalEndpoint } from "../src/config";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── the browser bits the engine assumes ─────────────────────────────────────── */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).location = { origin: "http://localhost:5173" };

/** An SSE stream of OpenAI-shaped chunks, one per delta. */
function sse(deltas: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const d of deltas) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200 }) as Response;
}

let lastCall: { url: string; body: any; headers: any } | null = null;
function stubFetch(deltas: string[]) {
  (globalThis as any).fetch = async (url: string, init: any) => {
    lastCall = { url, body: JSON.parse(init.body), headers: init.headers };
    return sse(deltas);
  };
}

async function drain(gen: AsyncGenerator<string, any, unknown>): Promise<{ yielded: string[]; text: string; cost?: number }> {
  const yielded: string[] = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) return { yielded, text: step.value.text, cost: step.value.usage?.cost };
    yielded.push(step.value);
  }
}

/* ── the id convention IS the routing ────────────────────────────────────────── */
{
  check("a local/ id is local", isLocalModel(`${LOCAL_PREFIX}qwen3-8b`));
  check("an openrouter id is not", !isLocalModel("deepseek/deepseek-v4-pro"));
  check("the prefix is stripped for the server", localModelId(`${LOCAL_PREFIX}qwen3-8b`) === "qwen3-8b");
  check("a bare local/ still names something", localModelId(LOCAL_PREFIX) === "default");
  check("a cloud id passes through untouched", localModelId("openai/gpt-5") === "openai/gpt-5");
}

/* ── an unconfigured endpoint fails LOUDLY, not as "Failed to fetch" ─────────── */
{
  setLocalEndpoint(null);
  stubFetch(["x"]);
  let msg = "";
  // both the primary and the fallback are local, so nothing can rescue it — the error must name
  // the actual problem rather than surfacing as a network error from a bad URL
  try { await drain(completeStream([], `${LOCAL_PREFIX}q`, `${LOCAL_PREFIX}q`, 100)); }
  catch (e: any) { msg = String(e?.message ?? e); }
  check("no endpoint set says so, and says where to set it", /local endpoint/i.test(msg) && /Tuning/.test(msg), msg);
}

/* ── /no_think DEFAULTS OFF ──────────────────────────────────────────────────── */
{
  // It shipped defaulting ON and that was wrong. The token is read by a chat template, not the
  // sampler, so a model whose template doesn't know it sees a stray line of text in the most
  // salient position in the prompt — and two real saves show it printed straight back into the
  // prose ("(no_think)" opening a scene; "(no_think mode: direct output, no reasoning)" closing a
  // deliberation). Thinking is stripped from the output regardless, so the switch buys nothing to
  // offset that unless the player knows their model honors it.
  setLocalEndpoint({ url: "http://localhost:5001/v1" });
  stubFetch(["ok"]);
  await drain(completeStream([{ role: "user", content: "go" }], `${LOCAL_PREFIX}q`, "x", 100));
  check("no control token unless it is explicitly asked for",
    !/no_?think/i.test(String(lastCall?.body.messages.at(-1)?.content)), lastCall?.body.messages.at(-1));
}

setLocalEndpoint({ url: "http://localhost:5001/v1/", no_think: true });

/* ── the trailing slash is not the player's problem ──────────────────────────── */
{
  check("a trailing slash on the base url is normalised away", getLocalEndpoint()?.url === "http://localhost:5001/v1");
}

/* ── the request that actually goes out ──────────────────────────────────────── */
{
  stubFetch(["She looks up."]);
  // NO OPENROUTER KEY IS SET anywhere in this file — if the local path consulted key() this throws.
  const out = await drain(completeStream(
    [{ role: "system", content: "contract" }, { role: "user", content: "I sit down." }],
    `${LOCAL_PREFIX}qwen3-8b`, "google/gemini-3.1-flash-lite", 500, true, "a search query",
  ));
  check("it posts to the local server, not openrouter", lastCall?.url === "http://localhost:5001/v1/chat/completions", lastCall?.url);
  check("with no key required", !(lastCall?.headers as any)?.Authorization);
  check("under the id the server knows", lastCall?.body.model === "qwen3-8b", lastCall?.body.model);
  check("no provider routing", !("provider" in (lastCall?.body ?? {})));
  check("no web plugin — grounding is an openrouter capability", !("plugins" in (lastCall?.body ?? {})));
  check("no usage accounting block", !("usage" in (lastCall?.body ?? {})));
  check("no reasoning switch", !("reasoning" in (lastCall?.body ?? {})));
  check("it still streams", lastCall?.body.stream === true);
  // A LOCAL SERVER SHIPS NO SAMPLER OPINION. OpenRouter's providers do, which is why the cloud path
  // sends none of this — left bare, a low-bit quant cycles a clause until the budget dies, and says
  // a character's line twice in one scene. One dial drives both penalties that answer that.
  check("a loop guard is sent", lastCall?.body.frequency_penalty === 0.3, lastCall?.body.frequency_penalty);
  check("and the gentler presence penalty with it", lastCall?.body.presence_penalty === 0.15, lastCall?.body.presence_penalty);
  check("and top_p", lastCall?.body.top_p === 0.9, lastCall?.body.top_p);
  check("and the prose comes back", out.text === "She looks up.");
  check("a local turn is recorded as free, not as unknown", out.cost === 0, out.cost);
  const lastUser = lastCall?.body.messages.at(-1);
  check("/no_think rides on the last user message", /\/no_think/.test(String(lastUser?.content)), lastUser?.content);
  check("and the search steering line was not added", !/WEB SEARCH TARGET/.test(String(lastUser?.content)));
}

/* ── the sampler is the player's to turn off ─────────────────────────────────── */
{
  setLocalEndpoint({ url: "http://localhost:5001/v1", loop_guard: 0, top_p: 0 });
  stubFetch(["ok"]);
  await drain(completeStream([{ role: "user", content: "go" }], `${LOCAL_PREFIX}q`, "x", 100));
  check("zero means send nothing and let the server decide",
    !("frequency_penalty" in (lastCall?.body ?? {})) && !("presence_penalty" in (lastCall?.body ?? {})) && !("top_p" in (lastCall?.body ?? {})),
    lastCall?.body);
  setLocalEndpoint({ url: "http://localhost:5001/v1", loop_guard: 0.8 });
  stubFetch(["ok"]);
  await drain(completeStream([{ role: "user", content: "go" }], `${LOCAL_PREFIX}q`, "x", 100));
  check("and raising the guard raises both penalties together",
    lastCall?.body.frequency_penalty === 0.8 && lastCall?.body.presence_penalty === 0.4, lastCall?.body);
  setLocalEndpoint({ url: "http://localhost:5001/v1/", no_think: true });
}

/* ── a cloud model is completely unaffected ──────────────────────────────────── */
{
  store.set("weft-openrouter-key", "sk-or-test");
  stubFetch(["Cloud prose."]);
  await drain(completeStream([{ role: "user", content: "go" }], "deepseek/deepseek-v4-pro", "x", 500));
  check("a cloud call still goes to openrouter", String(lastCall?.url).includes("openrouter.ai"), lastCall?.url);
  check("and still asks for usage", !!lastCall?.body.usage);
  check("and carries no local sampler", !("frequency_penalty" in (lastCall?.body ?? {})) && !("presence_penalty" in (lastCall?.body ?? {})), lastCall?.body);
  check("and is not given a /no_think it never asked for", !/\/no_think/.test(String(lastCall?.body.messages.at(-1)?.content)));
  store.delete("weft-openrouter-key");
}

/* ── THINKING NEVER REACHES THE PAGE ─────────────────────────────────────────── */
{
  // the tags arrive split across chunks, exactly as a real token stream delivers them
  stubFetch(["<th", "ink>", "I should open on the ", "cold. Maybe.", "</thi", "nk>", "The ice spoke", " first."]);
  const out = await drain(completeStream([{ role: "user", content: "go" }], `${LOCAL_PREFIX}qwen3-8b`, "x", 500));
  check("the finished turn holds no deliberation", out.text === "The ice spoke first.", JSON.stringify(out.text));
  check("and not one deliberating token was ever yielded to the page", !out.yielded.join("").includes("should open"), JSON.stringify(out.yielded));
  check("nor a stray fragment of the tags themselves", !/<\/?th/.test(out.yielded.join("")), JSON.stringify(out.yielded));
}
{
  // thinking that arrives whole, and prose that follows on the same chunk
  stubFetch(["<think>brief</think>Prose."]);
  const out = await drain(completeStream([{ role: "user", content: "go" }], `${LOCAL_PREFIX}q`, "x", 500));
  check("a think block inside one chunk is removed too", out.text === "Prose.", JSON.stringify(out.text));
}
{
  // a model that never closes the tag has produced nothing usable; the empty-stream guard upstream
  // treats that as an interrupted turn rather than committing silence as the scene
  stubFetch(["<think>going forever and ever"]);
  let err = "";
  try { await drain(completeStream([{ role: "user", content: "go" }], `${LOCAL_PREFIX}q`, `${LOCAL_PREFIX}q`, 500)); }
  catch (e: any) { err = String(e?.message ?? e); }
  check("an unterminated think block is an empty stream, not a scene", /empty stream/.test(err), err);
}
{
  check("stripThinking leaves ordinary prose alone", stripThinking("The ice spoke first.") === "The ice spoke first.");
  check("stripThinking removes a whole block", stripThinking("<think>hm</think>The ice spoke.") === "The ice spoke.");
  check("stripThinking keeps prose that follows a closed block on a new line", stripThinking("<think>hm</think>\n\nTwo paragraphs.\n\nHere.").startsWith("Two paragraphs."));
  // never hand back "" — the caller's repair and refusal paths need something to look at
  check("stripThinking never eats everything", stripThinking("<think>never closed").length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
