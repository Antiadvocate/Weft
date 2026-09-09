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
  // AND ONE THAT HAS NEVER MOVED IS REACHABLE TOO, which reverses what this test used to assert.
  // "Left to the offstage pass" assumed the offstage pass could advance a clock. It cannot — only
  // the bookkeeper's clocks_advance can, through a knowledge gate that is closed for every faction
  // the forge invents before any character exists to belong to it, and a three-hour time gate that
  // a story told in rooms cannot pay. So a clock at 0 could not be seen because it had not moved
  // and could not move because nothing could see it, and twelve turns later the stall path retired
  // it. Every forge-written clock in the game began inside that deadlock.
  const unmoved = sample({ clocks: [{ ...VOICE, filled: 0 }] });
  check("...and one that has not moved yet is reachable too — a sign is what it has before it moves",
    (unmoved.get("clock") ?? 0) > 0, unmoved);
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

/* ── 6. the in-world clock cannot hold the gate forever ──────────────────────── */
{
  // The save that prompted all this runs a single morning in one apartment: 139 in-world minutes
  // across 43 turns, about three a turn. Its tension dial is 9, whose cooldown is 40 in-world
  // minutes — and thirty had passed, so the gate stayed shut turn after turn. At lower tensions the
  // arithmetic is worse: 300 minutes at tension 4 is ninety more turns of that pace.
  const stuck = { clocks: [VOICE], threads: THREADS, tension: 9, last_beat_turn: 32, minutesSinceBeat: 30 };
  const m = sample(stuck);
  check("a story that spends little in-world time still gets beats", (m.get("none") ?? 0) < 400, m);
  check("...incidents, not only reminders", (m.get("thread") ?? 0) > 0, m);

  // and the ceiling is a ceiling on WAITING, not a bypass: two turns after a beat, nothing yet
  const fresh = sample({ ...stuck, last_beat_turn: 42, minutesSinceBeat: 6 });
  check("...but a beat two turns ago still holds the world off",
    (fresh.get("thread") ?? 0) === 0 && (fresh.get("clock") ?? 0) === 0, fresh);
  // A calm world waits far longer in turns than a hot one. The number this asserts moved once:
  // it used to be the doubled patience ceiling (twenty turns at tension 2) and it is now the turn
  // ladder itself (ten), because in a story whose scenes run in minutes the minutes gate is
  // unreachable at every setting of the dial and the ceiling was silently serving as the cadence —
  // handing every such story half the tension it was set to. See selectBeat.
  const calm = (t: number) => sample({ ...stuck, tension: 2, last_beat_turn: 43 - t, minutesSinceBeat: 3 * t });
  check("...and a calm story is left alone much longer", (calm(9).get("thread") ?? 0) === 0, calm(9));
  check("...for the ten turns its own dial asks for, not twenty", (calm(11).get("thread") ?? 0) > 0, calm(11));
  const hot = sample({ ...stuck, tension: 9, last_beat_turn: 41, minutesSinceBeat: 9 });
  check("...which is five times what a story set to 9 waits", (hot.get("thread") ?? 0) > 0, hot);
}

/* ── 7. during a cooldown a clock shows a sign, not its private objective ─────── */
{
  const m = sample({ clocks: [VOICE], threads: [], tension: 9, last_beat_turn: 39, minutesSinceBeat: 12 });
  check("a cooling turn can still carry a sign", (m.get("clock") ?? 0) > 0, m);
  // the bare-reminder path handed the narrator `faction: objective` verbatim — the one thing the
  // clock table is withheld to protect — and then asked for it "lightly"
  let leaked = 0, signed = 0;
  for (let i = 0; i < 300; i++) {
    const b = selectBeat(base({ clocks: [VOICE], threads: [], tension: 9, last_beat_turn: 39, minutesSinceBeat: 12 })) as Beat;
    if (b.kind === "reminder" && /grows stronger and more seductive/.test(b.ref)) leaked++;
    if (b.kind === "clock" && (b as any).young) signed++;
  }
  check("a clock never reaches the page as its own objective", leaked === 0, { leaked });
  check("...it reaches it as something somebody could see", signed > 0, { signed });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
