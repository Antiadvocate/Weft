/* Smoke test: THE RELAY, FROM THE BROWSER'S SIDE.
 *
 * Two properties matter more than the happy path, because both fail quietly.
 *
 * 1. WITH NO RELAY CONFIGURED, NOTHING CHANGES. Weaver is a static site you can run with nothing
 *    but an API key, and a server must never become a requirement for playing. Every relay function
 *    has to be inert when it is switched off.
 *
 * 2. THE JOB ID IS THE WHOLE RECOVERY MECHANISM. It is minted before the request goes out and
 *    written into the turn journal, because it is the only handle a cold-booted app has on a
 *    completion it already paid for. If ids collided, or were regenerated on a retry, a resumed
 *    turn would collect somebody else's prose or re-buy its own.
 *
 * The SSE parser is here too: it sits between the model and the page, and a framing bug in it shows
 * up as prose with holes in it rather than as an error. */
import { getRelay, newJobId, setRelay, streamJob, type RelayConfig } from "../src/relay";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* localStorage does not exist in node; the module only ever touches it through get/setRelay. */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

/* ── switched off means switched off ─────────────────────────────────────────── */
{
  check("no relay configured reads as no relay", getRelay() === null);
  setRelay({ url: "", token: "" } as RelayConfig);
  check("a blank url does not count as configured", getRelay() === null);
  setRelay({ url: "https://r.example.dev", token: "" } as RelayConfig);
  check("nor a url with no token — that would 401 every turn", getRelay() === null);
  setRelay(null);
  check("and clearing it puts things back", getRelay() === null);
}
{
  setRelay({ url: "https://r.example.dev/", token: "abc", vapid: "k" });
  check("a configured relay reads back", getRelay()?.token === "abc");
  check("the trailing slash is normalised away, or every path would double up",
    getRelay()?.url === "https://r.example.dev", getRelay()?.url);
  setRelay(null);
}

/* ── the job id ──────────────────────────────────────────────────────────────── */
{
  (globalThis as any).crypto ??= (await import("node:crypto")).webcrypto;
  const ids = new Set(Array.from({ length: 5000 }, () => newJobId()));
  check("job ids do not collide", ids.size === 5000, ids.size);
  const one = newJobId();
  check("and each is long enough to be unguessable", one.length === 32, one.length);
  check("hex only, so it is safe in a url path", /^[0-9a-f]{32}$/.test(one), one);
}

/* ── the stream parser ───────────────────────────────────────────────────────── */
const enc = new TextEncoder();
function fakeRelay(chunks: string[]) {
  (globalThis as any).fetch = async () => ({
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
    }),
  });
}
const drain = async (c: RelayConfig) => {
  const it = streamJob(c, "job1");
  let text = "";
  let tail: unknown = null;
  for (;;) {
    const s = await it.next();
    if (s.done) { tail = s.value; break; }
    text += s.value;
  }
  return { text, tail: tail as { usage?: { cost?: number }; truncated?: boolean } };
};
const CFG: RelayConfig = { url: "https://r.example.dev", token: "abc" };

{
  fakeRelay([
    `data: ${JSON.stringify({ delta: "She set the " })}\n\n`,
    `data: ${JSON.stringify({ delta: "glass down." })}\n\n`,
    `data: ${JSON.stringify({ done: true, usage: { cost: 0.012 }, truncated: false })}\n\n`,
  ]);
  const { text, tail } = await drain(CFG);
  check("deltas come through in order", text === "She set the glass down.", text);
  check("and usage rides back, so the cost governor is not blinded", tail.usage?.cost === 0.012, tail);
}
{
  // an SSE record split across two network reads is normal and must not lose or duplicate anything
  const payload = `data: ${JSON.stringify({ delta: "a whole sentence, arriving in pieces." })}\n\n`;
  fakeRelay([payload.slice(0, 12), payload.slice(12, 30), payload.slice(30), `data: ${JSON.stringify({ done: true })}\n\n`]);
  const { text } = await drain(CFG);
  check("a record split across reads is reassembled", text === "a whole sentence, arriving in pieces.", text);
}
{
  fakeRelay([`data: ${JSON.stringify({ delta: "x" })}\n\ndata: ${JSON.stringify({ delta: "y" })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`]);
  const { text } = await drain(CFG);
  check("several records in one read are all seen", text === "xy", text);
}
{
  fakeRelay([`: keep-alive\n\n`, `data: not json at all\n\n`, `data: ${JSON.stringify({ delta: "ok" })}\n\n`, `data: ${JSON.stringify({ done: true })}\n\n`]);
  const { text } = await drain(CFG);
  check("keep-alives and junk are skipped rather than thrown on", text === "ok", text);
}
{
  fakeRelay([`data: ${JSON.stringify({ error: "openrouter 429" })}\n\n`]);
  let msg = "";
  try { await drain(CFG); } catch (e) { msg = String((e as Error).message); }
  check("an error from the relay surfaces as an error", /429/.test(msg), msg);
}
{
  // the truncation flag has to survive: it is what triggers scene-footer recovery
  fakeRelay([`data: ${JSON.stringify({ delta: "cut" })}\n\n`, `data: ${JSON.stringify({ done: true, truncated: true })}\n\n`]);
  const { tail } = await drain(CFG);
  check("a truncated completion says so", tail.truncated === true, tail);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
