/* Smoke test: THE STORY WAS NEVER ABOUT ITS OWN SUBJECT.
 *
 * "I need her feet to actually talk to him unprompted, because that's the storyline right now...
 *  currently literally nothing has happened in the story."
 *
 * His world bible permits it outright — magic_rules names the voice, and canon reads "The voice Joe
 * hears from Amber's feet is real to him, and its nature is a desire to be worshipped." He also
 * wrote, in the one field where a player says what their world runs on:
 *
 *   pressure_palette: ["Amber's Feet Talking directly into Joe's Thoughts, with insistent,
 *                      seductive, need for worship and prayer."]
 *
 * And pressure_palette has only ever been a FILTER on beats generated from clocks and threads —
 * "Draw pressure only from: ..." — never a source of one. fictionHeat's own header already recorded
 * what that costs, on an unrelated save: thirty-six of fifty-seven turns carried pressure, every one
 * naming a clock or a thread, "not one named anything from the bible's own pressure palette, which
 * is five lines about a marriage."
 *
 * By turn 64 the bookkeeper had opened threads called "The job on Fifth", "Denise has the
 * clipboard", "The receipt with the district line" and "The shoes came back on". The engine was
 * pressing faithfully, ten times in sixty turns, and pressing on none of the story. */
import { selectBeat, pressureDirective, type Beat } from "../src/engine/pressure";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FEET = "Amber's Feet Talking directly into Joe's Thoughts, with insistent, seductive, need for worship and prayer.";
const CHORES = [
  { id: "t1", title: "The job on Fifth", status: "active", tension: 3 },
  { id: "t2", title: "Denise has the clipboard", status: "active", tension: 3 },
  { id: "t3", title: "The receipt with the district line", status: "active", tension: 3 },
  { id: "t4", title: "The shoes came back on", status: "active", tension: 3 },
] as any[];
const base = (o: any = {}) => ({ turn: 30, tension: 9, threads: [], clocks: [], consequences: [],
  agents: [], palette: [FEET], last_beat_turn: 20, last_exo_turn: 0, minutesSinceBeat: 400,
  recent: [], rng: Math.random, ...o });

/** Sixty turns of play with fatigue accumulating — a frozen state cannot show rotation. */
function play(palette: string[] | undefined, threads: any[]) {
  let lastBeatTurn = 0, minutes = 0;
  const recent: any[] = []; const tally = new Map<string, number>();
  for (let turn = 1; turn <= 60; turn++) {
    minutes += 3;
    const b = selectBeat(base({ turn, threads, palette, last_beat_turn: lastBeatTurn,
      minutesSinceBeat: minutes - lastBeatTurn * 3, recent })) as Beat;
    tally.set(b.kind, (tally.get(b.kind) ?? 0) + 1);
    if (["consequence", "clock", "thread", "agent", "exogenous", "palette"].includes(b.kind)) {
      lastBeatTurn = turn;
      const ref = (b as any).ref ?? "";
      const h = recent.find((r) => r.ref === ref);
      if (h) { h.turn = turn; h.count++; } else recent.push({ ref, turn, count: 1, kind: b.kind });
    }
  }
  return tally;
}
const mean = (palette: string[] | undefined, threads: any[], n = 120) => {
  const avg = new Map<string, number>();
  for (let i = 0; i < n; i++) for (const [k, v] of play(palette, threads)) avg.set(k, (avg.get(k) ?? 0) + v / n);
  return avg;
};

/* ── 1. the premise can be the beat ──────────────────────────────────────────── */
{
  const m = mean([FEET], CHORES);
  check("THE STORY'S OWN SUBJECT REACHES THE PAGE", (m.get("palette") ?? 0) > 0, m);
  check("...several times across sixty turns, not once", (m.get("palette") ?? 0) >= 3, m.get("palette"));
  const without = mean(undefined, CHORES);
  check("...where before there was no such source at all", (without.get("palette") ?? 0) === 0);
}

/* ── 2. it displaces the bookkeeping without silencing it ────────────────────── */
{
  const withP = mean([FEET], CHORES), withoutP = mean(undefined, CHORES);
  check("the chores lose ground to the premise", (withP.get("thread") ?? 0) < (withoutP.get("thread") ?? 0),
    { with: withP.get("thread"), without: withoutP.get("thread") });
  check("...but are not silenced — the world still has other business",
    (withP.get("thread") ?? 0) > 0, withP.get("thread"));
  const beats = (m: Map<string, number>) => ["thread", "clock", "palette", "agent", "exogenous", "consequence"]
    .reduce((n, k) => n + (m.get(k) ?? 0), 0);
  check("...and the PACE is unchanged: same number of beats, different subject",
    Math.abs(beats(withP) - beats(withoutP)) < 4, { with: beats(withP), without: beats(withoutP) });
}

/* ── 3. a premise with nothing else in the world still runs ──────────────────── */
{
  // his save at forge time: no threads opened yet, clocks at zero
  const m = mean([FEET], []);
  check("a story with no threads and no clocks is still about something",
    (m.get("palette") ?? 0) > 0, m);
}

/* ── 4. the premise does not retire ──────────────────────────────────────────── */
{
  // RETIRE_AT drops a source after four discharges — "a threat that keeps losing stops coming".
  // The subject of the story does not lose and does not stop.
  const spent = [{ ref: FEET.slice(0, 130), turn: 5, count: 9, kind: "palette" }];
  const m = new Map<string, number>();
  for (let i = 0; i < 300; i++) {
    const b = selectBeat(base({ turn: 40, recent: spent })) as Beat;
    m.set(b.kind, (m.get(b.kind) ?? 0) + 1);
  }
  check("nine appearances do not retire the premise", (m.get("palette") ?? 0) > 0, m);
}

/* ── 5. what the narrator is actually told ───────────────────────────────────── */
{
  const d = pressureDirective({ band: "danger", pressure: 9 } as any, [FEET], 9, "mortal",
    { kind: "palette", ref: FEET } as Beat);
  check("the subject itself is named", /Feet Talking directly into Joe's Thoughts/.test(d));
  check("...as UNPROMPTED, which is the whole request", /It is UNPROMPTED/.test(d));
  check("...not waiting for the player to raise it", /does not wait for the player to raise it/.test(d));
  check("...in the room they are actually in", /in the room the characters are actually standing in/.test(d));
  check("...and not as foreshadowing or a mood", /Not foreshadowing, not a mood/.test(d), d.slice(-200));

  const quiet = pressureDirective({ band: "danger", pressure: 9 } as any, [FEET], 9, "mortal",
    { kind: "palette", ref: FEET, quiet: true } as Beat);
  check("during a cooldown it still touches the scene, lightly", /touches the scene, lightly/i.test(quiet));
  check("...and even then it is unprompted", /unprompted/i.test(quiet));
}

/* ── 6. no palette, no crash, no invention ───────────────────────────────────── */
{
  const m = mean(undefined, CHORES);
  check("a world with no palette is left exactly as it was", (m.get("palette") ?? 0) === 0);
  const empty = mean(["", "   "], CHORES);
  check("...and blank lines are not a premise", (empty.get("palette") ?? 0) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
