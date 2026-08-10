/* Smoke test: A PROVIDER THAT NEVER STARTS TALKING.
 *
 * Turn 1 of a brand new save: 320 seconds, for 385 narrator tokens and 430 bookkeeper tokens. That
 * is not generation. Eight hundred tokens is well under a minute anywhere healthy — the rest was a
 * socket sitting open producing nothing, and nothing in the client had any opinion about how long
 * that was allowed to go on.
 *
 * The configuration that produced it is worth naming, because it is the default anyone cost-
 * conscious would pick: route_by_price true, plus prefer_deepseek_provider true. Together those send
 * the LONGEST call of the turn to the cheapest, most-queued host available and then pin it there.
 * The bookkeeper already opts out of price routing — the setting's own comment says "bookkeeping
 * latency is the felt latency" — and the narrator, which is twice the call, had no such escape.
 *
 * Two rules here. A stall is bounded. And a stall is a ROUTING failure, not a model failure: the
 * model was never given a chance to fail, so answering it by switching models would change the prose
 * for a reason the player never chose. */
import { TTFT_MS, Stalled, isCancel } from "../src/llm";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── the bound ───────────────────────────────────────────────────────────────── */
{
  check("there is a first-token deadline at all", typeof TTFT_MS === "number" && TTFT_MS > 0);
  check("it is generous enough for a cold cache on a busy provider", TTFT_MS >= 30_000, TTFT_MS);
  check("and far below the 320s that prompted it", TTFT_MS < 120_000, TTFT_MS);
}

/* ── a stall is not a cancellation ───────────────────────────────────────────── */
{
  const s = new Stalled(TTFT_MS);
  check("a stall is its own kind of failure", s.name === "Stalled");
  check("it says how long it waited", /45s/.test(s.message), s.message);
  check("and it is NOT treated as the player pressing stop", !isCancel(s));
}
{
  // the distinction matters: isCancel unwinds the turn silently and spends nothing. A stall must
  // fall through to the recovery path instead, or a hung provider would look like a cancelled turn.
  check("a real abort still reads as a cancellation", isCancel({ name: "AbortError" }));
  check("as does an explicit one", isCancel({ name: "Cancelled" }));
  check("but a provider error does not", !isCancel(new Error("OpenRouter 503: upstream aborted")));
}

/* ── the guard must not fire on a SLOW GENERATION ────────────────────────────── */
{
  // The deadline is time-to-FIRST-token, not total duration. A long scene that streams steadily for
  // three minutes is fine and none of the client's business; only silence is a problem. This is the
  // property that keeps the guard from truncating legitimate long turns.
  let started = false;
  let stalled = false;
  const ttft = setTimeout(() => { if (!started) stalled = true; }, 40);
  await new Promise((r) => setTimeout(r, 10));
  started = true; clearTimeout(ttft);              // first token arrives early
  await new Promise((r) => setTimeout(r, 60));     // generation then runs long
  check("a stream that starts promptly and runs long is never flagged", !stalled);
}
{
  let started = false;
  let stalled = false;
  const ttft = setTimeout(() => { if (!started) stalled = true; }, 20);
  await new Promise((r) => setTimeout(r, 50));     // nothing ever arrives
  clearTimeout(ttft);
  check("a stream that never starts is flagged", stalled);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
