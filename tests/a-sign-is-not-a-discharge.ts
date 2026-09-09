/* Smoke test: THE STORY SPENT ITS WHOLE BUDGET ON THINGS THAT DEMANDED NOTHING.
 *
 * A save at turn 38, tension on 10, the player reporting that the story's own premise had not
 * fired once. Its palette is two lines; both had fired, at 16 and 20, and then nothing for
 * seventeen turns. The beat telemetry for that stretch:
 *
 *   T21 none  T22 none  T23 clock (a SIGN of the Voice clock, 2 of 6)  T24 none  T25 none
 *   T26 consequence  T27-30 none  T31 thread  T32-33 none  T34 consequence  T35-37 none
 *
 * Two things were wrong, and they compound.
 *
 * ONE. `quiet` and `young` are the forms a source takes when the world is NOT allowed to press —
 * their directives say outright that they demand nothing and interrupt nothing. A young clock has
 * no other form at all: below 75% full the sign IS the clock's only channel. Every one of them was
 * being recorded as a discharge, resetting last_beat_turn and starting the refractory period over.
 * T23's sign cost turns 24, 25 and 26. Across T21-37 exactly two turns were ever free.
 *
 * TWO. The patience ceiling. It exists so the in-world minutes gate cannot hold the world shut
 * forever, and it is set at twice the turn ladder, on the reasoning that the ladder "IS this
 * engine's own idea of pacing at a given tension". But this story runs at about two and a half
 * in-world minutes a turn, which is what a conversation in an apartment costs — and at that pace
 * the minutes gate is unreachable at every setting of the dial: 17 turns to pay it at tension 10,
 * 250 at tension 2. So the ceiling was never a ceiling. It was the cadence, always, and at twice
 * the ladder it handed a story set to 10 the pacing of a story set to 5. */
import { selectBeat, beatCooldown, beatCooldownMinutes, type Beat } from "../src/engine/pressure";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const VOICE = "The voice from Amber's feet becoming more insistent and seductive";
const INTIMACY = "The growing intimacy and tension between Joe and Amber";
// The Voice clock as the save carries it: running, 2 of 6, signs written, nowhere near the 75%
// line that lets it be an incident. Its only channel is the sign.
const CLOCKS = [{ faction: "The Voice", objective: "the voice grows stronger and more seductive",
  status: "running", segments: 6, filled: 2, visible_signs: ["Joe hears whispers even when Amber is not in the room"] }] as any[];
const THREADS = ["Amber's Hidden Drawings", "The Thing On Amber's Wall", "Amber's Job Search",
  "The Application Amber Did Not Send"].map((title, i) => ({ id: `t${i}`, title, status: "active", tension: 3 })) as any[];

const input = (o: any = {}) => ({
  turn: 39, tension: 10, threads: THREADS, clocks: CLOCKS, consequences: [], agents: [],
  palette: [VOICE, INTIMACY], last_beat_turn: 34, last_exo_turn: 0,
  recent: [{ ref: VOICE, turn: 16, count: 2, kind: "palette" }, { ref: INTIMACY, turn: 20, count: 2, kind: "palette" }],
  minutesSinceBeat: 12, restoration: false, rng: Math.random, ...o,
});

// ---- the pace reading itself -------------------------------------------------------------------
// The numbers the two gates are actually made of, so a later tuning pass can see what it is moving.
check("tension 10 asks for a beat every 2 turns", beatCooldown(10, CLOCKS) === 2, beatCooldown(10, CLOCKS));
check("...and the minutes gate for it is 40", beatCooldownMinutes(10, CLOCKS) === 40, beatCooldownMinutes(10, CLOCKS));
check("...which is 17 turns at this story's pace, so it is never what fires",
  Math.ceil(beatCooldownMinutes(10, CLOCKS) / 2.4) === 17);

// ---- ONE: a sign does not spend the cooldown ----------------------------------------------------
// selectBeat cannot see turn.ts's bookkeeping, so this asserts the property turn.ts keys off:
// every form the engine hands back during a cooldown is marked as a sign.
function sample(inp: any, n = 600): Beat[] {
  const out: Beat[] = [];
  for (let i = 0; i < n; i++) out.push(selectBeat(inp) as Beat);
  return out;
}
const cooling = sample(input({ turn: 35, last_beat_turn: 34, minutesSinceBeat: 2.4 }));
const pressedWhileCooling = cooling.filter((b) => b.kind !== "none" && !(b as any).quiet && !(b as any).young);
check("nothing presses on the turn straight after a beat", pressedWhileCooling.length === 0,
  pressedWhileCooling.slice(0, 3));
// The young clock reaches the page through the ordinary rotation, not through the cooling branch —
// at tension 10 the cooling window is now shorter than the three turns that branch waits for, which
// is fine: a world that presses every second turn does not need filler between the presses.
const clockSigns = sample(input({ turn: 38, last_beat_turn: 34, minutesSinceBeat: 9.6 })).filter((b) => b.kind === "clock");
check("a clock at 2 of 6 can still reach the page", clockSigns.length > 0);
check("...and every one of them is marked young, so turn.ts will not bill it as a discharge",
  clockSigns.every((b: any) => b.young === true), clockSigns.find((b: any) => !b.young));
// At a calmer dial the cooling branch is alive again, and everything it emits is a sign.
const calmCooling = sample(input({ turn: 38, tension: 4, last_beat_turn: 34, minutesSinceBeat: 9.6 }));
check("a calm story still gets texture between its beats", calmCooling.some((b) => b.kind !== "none"));
check("...and none of that texture is billed as a discharge",
  calmCooling.every((b: any) => b.kind === "none" || b.quiet || b.young || b.kind === "reminder"),
  calmCooling.find((b: any) => b.kind !== "none" && !b.quiet && !b.young && b.kind !== "reminder"));

// ---- TWO: the ceiling is the ladder when the world's clock is too slow to reach the gate --------
// Four turns after a beat, at this story's pace. Under the old doubled ceiling this was the last
// cooling turn; the dial says 10 and the ladder says 2, so it should be long free.
const free = sample(input({ turn: 38, last_beat_turn: 34, minutesSinceBeat: 9.6 }));
const quietTurns = free.filter((b) => b.kind === "none").length / free.length;
check("at tension 10, four turns on, the world is mostly free to move", quietTurns < 0.35, quietTurns);
const palette = free.filter((b) => b.kind === "palette").length / free.length;
check("and the premise is what it mostly moves with", palette > 0.35, palette);

// Two turns on, the floor still holds: MIN_GAP_TURNS keeps two incidents off consecutive pages.
const gap = sample(input({ turn: 35, last_beat_turn: 34, minutesSinceBeat: 2.4 }));
check("consecutive pages still cannot both carry an incident",
  gap.every((b) => b.kind === "none" || (b as any).quiet || (b as any).young));

// A story that SKIPS HOURS between scenes reaches the minutes gate on its own, and keeps the
// doubled patience for the odd long wait — that is what the doubling was for.
const skips = sample(input({ turn: 36, last_beat_turn: 34, tension: 4, minutesSinceBeat: 400 }));
check("a story that spends real time is not held by the ladder", skips.some((b) => b.kind !== "none"));
// ...and the same story two turns in, with almost no time spent, is still cooling at a calm dial.
const calm = sample(input({ turn: 36, last_beat_turn: 34, tension: 4, minutesSinceBeat: 5 }));
const calmPressed = calm.filter((b) => b.kind !== "none" && !(b as any).quiet && !(b as any).young);
check("a calm dial is still calm", calmPressed.length === 0, calmPressed.slice(0, 2));

// ---- and the two together, over a run --------------------------------------------------------
// Replaying turn.ts's own bookkeeping forward from the save. The measure the player cares about is
// how often the story is about its own subject.
function replay(billSigns: boolean, turns = 60): number {
  let last = 34, mins = 0, hit = 0;
  const recent = JSON.parse(JSON.stringify(input().recent));
  for (let i = 0; i < turns; i++) {
    const turn = 39 + i;
    const b: any = selectBeat(input({ turn, last_beat_turn: last, minutesSinceBeat: mins, recent }));
    if (b.kind === "palette") hit++;
    const sign = !!(b.quiet || b.young);
    const discharge = ["consequence", "clock", "thread", "agent", "exogenous", "palette"].includes(b.kind);
    if (discharge && (billSigns || !sign)) { last = turn; mins = 0; } else mins += 2.4;
    if (b.ref && discharge && (billSigns || !sign)) {
      const p = recent.find((r: any) => r.ref === b.ref);
      if (p) { p.turn = turn; p.count += 1; } else recent.push({ ref: b.ref, turn, count: 1, kind: b.kind });
    }
  }
  return hit / turns;
}
const runs = 200;
let now = 0, then = 0;
for (let i = 0; i < runs; i++) { now += replay(false); then += replay(true); }
now /= runs; then /= runs;
console.log(`     (premise on the page: ${(100 * then).toFixed(0)}% of turns when signs are billed, ${(100 * now).toFixed(0)}% when they are not)`);
check("the premise reaches the page at least one turn in six", now > 1 / 6, now);
check("not billing signs is the better of the two", now > then, { now, then });

// ---- and turn.ts keys off the mark ------------------------------------------------------------
const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
check("turn.ts reads the sign mark off the beat", /const sign = \(beat as \{ quiet\?: boolean; young\?: boolean \}\)\.quiet \|\| \(beat as \{ young\?: boolean \}\)\.young;/.test(src));
check("...and a sign does not restart the cooldown", /if \(!sign && \["consequence", "clock", "thread", "agent", "exogenous", "palette"\]\.includes\(beat\.kind\)\)/.test(src));
check("...and does not count toward retirement",
  /if \(!sign\) prior\.count = prior\.count >= RETIRE_AT \? 1 : prior\.count \+ 1;/.test(src)
  && /count: sign \? 0 : 1/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
