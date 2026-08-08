/* Smoke test: STOPPING THE NARRATOR OR THE BOOKKEEPER.
 *
 * A turn is two long calls back to back. Stopping one has to mean three things at once, and each of
 * them was a place the old code did the opposite:
 *
 *   1. NO MORE MONEY IS SPENT. `complete` has a four-rung recovery ladder ending in the fallback
 *      model, and `completeStream` re-buys the whole scene on the fallback. An abort that fell into
 *      either would fire more requests than the turn that was cancelled.
 *   2. THE CANCEL SURVIVES THE CATCH BLOCKS. The simulator's failure handler swallows everything and
 *      commits a heuristics-only diff. A stop swallowed there would commit the exact turn the player
 *      just said they did not want.
 *   3. NOTHING IS RECORDED. The engine never persists — the caller reads a copy, the engine mutates
 *      it, the caller writes it at the end. So a throw before `apply` means the turn never happened.
 *      After `apply` it has, and the stop must not be honoured half way. */
import { complete, completeStream, isCancel, Cancelled } from "../src/llm";
import { newSave, registerCharacter } from "../src/engine/state";
import { runTurn } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

// the llm layer reads the API key from localStorage on every call and refuses to build headers
// without one; node has no localStorage, so stand one up with a throwaway key. Every fetch in this
// file is stubbed — nothing here can reach the network.
(globalThis as any).localStorage ??= {
  getItem: (k: string) => (k === "weft-openrouter-key" ? "sk-test-not-a-real-key" : null),
  setItem: () => {}, removeItem: () => {},
};
(globalThis as any).location ??= { origin: "http://localhost", href: "http://localhost/" };

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const abortErr = (): Error => { const e = new Error("The user aborted a request."); e.name = "AbortError"; return e; };

/* ── 1. what counts as a cancel ─────────────────────────────────────────────── */
{
  check("a Cancelled is a cancel", isCancel(new Cancelled()));
  check("an AbortError is a cancel", isCancel(abortErr()));
  check("a plain failure is not", !isCancel(new Error("OpenRouter 500: upstream exploded")));
  // the reason this matches on name and not on text: a provider error body is arbitrary prose, and a
  // 500 that happens to contain the word would have silently discarded a turn nobody cancelled
  check("a 500 whose body says 'aborted' is still a failure",
    !isCancel(new Error("OpenRouter 500: {\"error\":\"generation aborted upstream\"}")));
}

/* ── 2. no request is made at all once the signal is already aborted ─────────── */
{
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; throw new Error("should never be reached"); }) as any;
  const ac = new AbortController();
  ac.abort();
  let caught: unknown = null;
  try { await complete([{ role: "user", content: "x" }], "a/model", "b/fallback", false, 100, { signal: ac.signal }); }
  catch (e) { caught = e; }
  globalThis.fetch = real;
  check("an already-stopped call throws Cancelled", isCancel(caught), caught);
  check("and never reaches the network", calls === 0, calls);
}

/* ── 3. an abort mid-call does NOT walk the recovery ladder ──────────────────── */
{
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; throw abortErr(); }) as any;
  let caught: unknown = null;
  try {
    await complete([{ role: "user", content: "x" }], "a/model", "b/fallback",
      { schema: { type: "object" }, name: "diff" }, 100, { signal: new AbortController().signal });
  } catch (e) { caught = e; }
  globalThis.fetch = real;
  check("a stopped bookkeeper throws Cancelled", isCancel(caught), caught);
  // schema retry + reasoning retry + relaxed retry + the fallback model = four more calls, all billed
  check("and spends nothing further — one attempt, no fallback", calls === 1, calls);
}

/* ── 4. the same for the narrator stream ─────────────────────────────────────── */
{
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; throw abortErr(); }) as any;
  let caught: unknown = null;
  try {
    const s = completeStream([{ role: "user", content: "x" }], "a/model", "b/fallback", 100);
    for (;;) { const { done } = await s.next(); if (done) break; }
  } catch (e) { caught = e; }
  globalThis.fetch = real;
  check("a stopped narrator throws Cancelled", isCancel(caught), caught);
  check("and does not re-buy the scene on the fallback model", calls === 1, calls);
}

/* ── 5. the engine: a stop before the bookkeeper records nothing ─────────────── */
function world(): SaveState {
  const s = newSave("stop", {
    name: "The Narrow House", genre: "domestic", tone: "close",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa" } as any);
  s.world.current_turn = 12;
  return s;
}

const events = () => {
  const phases: string[] = [];
  return { phases, ev: { onPhase: (p: string) => phases.push(p), onDelta: () => {}, onMeta: () => {} } };
};

{
  // the resume path (proseOverride) skips the narrator, so this lands squarely on the bookkeeper —
  // the second of the two calls the player asked to be able to stop
  const s = world();
  const before = { turn: s.world.current_turn, history: s.history.length };
  const ac = new AbortController();
  ac.abort();
  const { phases, ev } = events();
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("no network in tests"); }) as any;
  let caught: unknown = null;
  try { await runTurn(s, "I put the phone down.", ev as any, "do", { proseOverride: "The phone goes face down on the table.", signal: ac.signal }); }
  catch (e) { caught = e; }
  globalThis.fetch = real;
  check("a stopped turn unwinds by throwing", isCancel(caught), caught);
  check("the bookkeeper never ran", !phases.includes("simulator"), phases);
  check("consequences were never applied", !phases.includes("apply"), phases);
  check("no turn was recorded", s.world.current_turn === before.turn, s.world.current_turn);
  check("no history entry was written", s.history.length === before.history, s.history.length);
}

/* ── 6. a stop DURING the bookkeeper still throws the turn away ───────────────
 * The dangerous shape: the simulator's failure handler swallows every exception and lets the turn
 * carry on with a heuristics-only diff. Two things stop that here — `complete` re-throwing Cancelled
 * rather than falling down its ladder, and the last-exit check in front of `apply`. What this pins
 * is the outcome: an abort while "recording changes" is on screen commits nothing. */
{
  const s = world();
  const before = s.history.length;
  const ac = new AbortController();
  const { phases, ev } = events();
  const real = globalThis.fetch;
  let calls = 0;
  // stop exactly when the bookkeeper call goes out — the shape of a player hitting the button while
  // "recording changes" is on screen
  globalThis.fetch = (async (_u: unknown, init: any) => {
    calls++;
    if (init?.signal) { ac.abort(); throw abortErr(); }
    throw new Error("no network in tests");
  }) as any;
  let caught: unknown = null;
  try { await runTurn(s, "I put the phone down.", ev as any, "do", { proseOverride: "The phone goes face down on the table.", signal: ac.signal }); }
  catch (e) { caught = e; }
  globalThis.fetch = real;
  check("stopping mid-bookkeeper unwinds the turn", isCancel(caught), caught);
  check("the bookkeeper was the call that got stopped", phases.includes("simulator"), phases);
  check("a thin heuristic diff is NOT applied in its place", !phases.includes("apply"), phases);
  check("nothing reached the history", s.history.length === before, s.history.length);
  check("and no further calls were made after the stop", calls === 1, calls);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
