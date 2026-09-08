/* Smoke test: FIVE ACTIVE THREADS, TWO CLOCKS, AND NOTHING EVER HAPPENED.
 *
 * "Here's a save that shows no storyline firing at all. Joe is not hearing Amber's feet."
 *
 * The save, at turn 43, holds five active threads, two running clocks, four promises and a fired
 * consequence. Sampled four hundred times against that exact state, selectBeat returned "NO NEW
 * INCIDENT THIS TURN" four hundred times out of four hundred. He was not exaggerating and it was
 * not the narrator: nothing was ever offered to it.
 *
 * THREE INDEPENDENT GATES, EACH CLOSED FOR A DIFFERENT REASON.
 *
 * 1. A thread with no `kind` was handed the THREAT bar of 6. The comment one line above had already
 *    lowered non-threats to 2 precisely because ordinary business "opens low and matures slowly, so
 *    under the old rule it could sit in state forever and never once reach the page" — but the
 *    default made every unlabelled thread a crisis candidate. In this save the only two threads
 *    carrying a kind were both already resolved; all five active ones were unlabelled, at tensions
 *    2, 3, 3, 4 and 4, and therefore unpickable.
 *
 * 2. A clock became a beat candidate only at 75% full, and the narrator is never shown the clock
 *    table (correctly — the objective is private, and handing it over is the omniscience leak). So
 *    below three-quarters a clock had no channel into the prose at all. The clock here reads "the
 *    voice Joe hears from Amber's feet grows stronger and more seductive", running, 1 of 6, with
 *    signs already written for it. It could not reach the page until it was five-sixths over, and
 *    the forge prompt asks for those signs as "what leaks into ordinary scenes AS IT ADVANCES".
 *
 * 3. And ties in the picker went to array order. Every source that has never fired scores
 *    MAX_SAFE_INTEGER, and a strict `>` gave the pick to whichever loop pushed first, forever.
 */
import { selectBeat, pressureDirective, type Beat } from "../src/engine/pressure";
import type { FactionClock } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const VOICE = { id: "clk_v", faction: "The Voice",
  objective: "The voice Joe hears from Amber's feet grows stronger and more seductive.",
  segments: 6, filled: 1, consequence: "Joe loses his grip on reality.", status: "running",
  visible_signs: ["Joe hears whispers even when Amber is not in the room.", "He stares at her feet without meaning to."],
} as unknown as FactionClock;
/** The save's five active threads, verbatim in shape: unlabelled, tension 2-4. */
const THREADS = [
  { id: "t1", title: "Lit from below", status: "active", tension: 4 },
  { id: "t2", title: "The job on Fifth", status: "active", tension: 3 },
  { id: "t3", title: "Barefoot past the door", status: "active", tension: 2 },
  { id: "t4", title: "The shoes came back on", status: "active", tension: 3 },
  { id: "t5", title: "Denise hasn't come out", status: "active", tension: 4 },
] as any[];
const base = (o: any = {}) => ({ turn: 43, tension: 4, clocks: [], threads: [], agents: [],
  consequences: [], recent: [], sinceBeat: 11, minutesSinceBeat: 400, rng: Math.random, ...o });
const sample = (inp: any, n = 400) => {
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) { const b = selectBeat(base(inp)) as Beat; out.set(b.kind, (out.get(b.kind) ?? 0) + 1); }
  return out;
};

/* ── 1. the save's own state now produces something ──────────────────────────── */
{
  const m = sample({ clocks: [VOICE], threads: THREADS });
  check("SOMETHING FIRES AT ALL", (m.get("none") ?? 0) < 400, m);
  check("...the threads are reachable", (m.get("thread") ?? 0) > 0, m);
  check("...and so is the clock the player was waiting on", (m.get("clock") ?? 0) > 0, m);
  check("...while quiet turns still happen — this is pacing, not a firehose",
    (m.get("none") ?? 0) > 0, m);
}

/* ── 2. an unlabelled thread is not assumed to be a crisis ───────────────────── */
{
  const quiet = sample({ threads: [{ id: "t", title: "Barefoot past the door", status: "active", tension: 2 }] });
  check("an unlabelled thread at tension 2 can reach the page", (quiet.get("thread") ?? 0) > 0, quiet);
  const named = sample({ threads: [{ id: "t", title: "Raiders on the road", status: "active", tension: 4, kind: "threat" }] });
  check("...but one explicitly CALLED a threat still waits for the crisis bar",
    (named.get("thread") ?? 0) === 0, named);
  const resolved = sample({ threads: [{ id: "t", title: "Done with", status: "resolved", tension: 9 }] });
  check("...and a resolved thread stays closed", (resolved.get("thread") ?? 0) === 0, resolved);
}

/* ── 3. a young clock gets a channel, and only when it has something to show ──── */
{
  const young = sample({ clocks: [VOICE] });
  check("a clock at 1 of 6 is reachable", (young.get("clock") ?? 0) > 0, young);
  const unmoved = sample({ clocks: [{ ...VOICE, filled: 0 }] });
  check("...but one that has never moved is left to the offstage pass",
    (unmoved.get("clock") ?? 0) === 0, unmoved);
  const blind = sample({ clocks: [{ ...VOICE, visible_signs: [] }] });
  check("...and one with nothing anybody could SEE stays private",
    (blind.get("clock") ?? 0) === 0, blind);
}

/* ── 4. and it arrives as a sign, not as a crisis ────────────────────────────── */
{
  const young: Beat = { kind: "clock", ref: "The Voice: the voice grows stronger", young: true,
    signs: ["Joe hears whispers even when Amber is not in the room."], filled: 1, segments: 6 };
  const d = pressureDirective({ band: "friction", pressure: 4 } as any, [], 4, "mortal", young);
  check("the sign itself is on the page", /hears whispers even when/.test(d), d.slice(-200));
  check("...named as a sign rather than an incident", /A SIGN, NOT AN INCIDENT/.test(d));
  check("...demanding nothing", /demands nothing, interrupts nothing/.test(d));
  check("...and explicitly not escalated or explained", /Do NOT escalate it, do not explain it/.test(d));
  check("...and the private objective is never handed over as a thing anyone can name",
    /do not have anyone name the thing behind it/.test(d));

  const mature: Beat = { kind: "clock", ref: "The Voice: the voice grows stronger",
    signs: ["Joe hears whispers."], filled: 5, segments: 6 };
  const m = pressureDirective({ band: "friction", pressure: 4 } as any, [], 4, "mortal", mature);
  check("a mature clock still gets the full pressure beat", /PRESSURE BEAT from a maturing faction clock/.test(m));
  check("...and a young one does not", !/PRESSURE BEAT from a maturing/.test(d));
}

/* ── 5. ties do not go to whoever was pushed first ───────────────────────────── */
{
  // one clock and five threads, none ever fired: all tie at MAX_SAFE_INTEGER
  const m = sample({ clocks: [VOICE], threads: THREADS }, 1200);
  const clock = m.get("clock") ?? 0, thread = m.get("thread") ?? 0;
  check("a lone fresh clock is not drowned out by five fresh threads",
    clock > 0 && clock * 4 > thread / 5, { clock, thread });
  check("...nor does it monopolise them", thread > clock, { clock, thread });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
