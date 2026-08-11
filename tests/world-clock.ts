/* Smoke test: HADRIAN BOUGHT A HILL IN FIFTY-FIVE MINUTES.
 *
 * Offstage drives advanced by 6–13 percentage points per TURN, with no reference to elapsed time,
 * so a want finished in about ten turns whatever those turns were. A turn is a beat of
 * conversation. In one save, twenty-four of them covered a single Roman morning — 08:30 to 11:25,
 * a hundred and seventy-five minutes — and in that morning, entirely offscreen:
 *
 *   t3   Hadrian works toward his first ambition                            (34%)
 *   t5                                                                      (47%)
 *   t12  "Publius Aelius Hadrianus completes their aim offscreen"
 *   t18  new want: acquire the crest of the Tiburtine hill from a senator   (39%)
 *   t23                                                                     (94%)
 *   t24  "completes their aim offscreen: Acquire the crest of the Tiburtine hill"
 *
 * A senator's hilltop estate, bought between half past ten and half past eleven. Marcus, in the
 * same feed, seized and drained three barrels of illicit lamp-oil from a cellar across the city
 * while that same feed had him sitting in a cookshop finishing his lunch and watching the door.
 *
 * The player said the story had no timescales. This was most of why: the fastest way to make the
 * world lurch was to talk to somebody for a while.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { tickDrives, MINUTES_PER_WANT, STALLED_WANT_TURNS } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(goal = "Acquire the crest of the Tiburtine hill from Senator Servilius's estate"): { s: SaveState; id: string } {
  const s = newSave("clock", { name: "Rome" } as any);
  s.world.places["loc_rome"] = { id: "loc_rome", name: "Rome", description_facts: "A city.", contains: [] };
  s.world.player_location = "loc_rome";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, { name: "Hadrian" } as any)!;
  s.characters[id].location = "loc_palatine";
  s.characters[id].drive = { goal, progress: 0, priority: 1, updated_turn: 0 };
  s.world.present = ["char_player"];
  return { s, id };
}

/* ── 1. the morning from the save ─────────────────────────────────────────────── */
{
  // 24 turns of conversation across 175 minutes — the real per-turn elapsed from the save
  const gaps = [3, 2, 10, 15, 5, 5, 5, 3, 5, 10, 10, 5, 10, 2, 10, 5, 5, 10, 15, 10, 10, 10, 5, 5];
  const { s, id } = world();
  gaps.forEach((min, i) => { s.world.current_turn = i + 1; tickDrives(s, () => 0.5, min); });
  const p = s.characters[id].drive!.progress;
  check("a morning of talking does not buy a senator's hill", p < 25, `${p}% after ${gaps.reduce((a, b) => a + b)} minutes`);
  check("but the world is not frozen either", p > 3, p);
  check("and nothing 'completes their aim' in one morning", !!s.characters[id].drive, s.characters[id].drive);
}

/* ── 2. turns are not the clock — same turns, no time ─────────────────────────── */
{
  const { s, id } = world();
  const turns = STALLED_WANT_TURNS - 1;   // past this the stall guard takes the want away, correctly
  for (let t = 1; t <= turns; t++) { s.world.current_turn = t; tickDrives(s, () => 0.5, 0); }
  check("turns in which no time passes move nothing", s.characters[id].drive!.progress === 0, s.characters[id].drive);
  check("the drive is still stamped each turn, as the arrival logic relies on",
    s.characters[id].drive!.updated_turn === turns, s.characters[id].drive);
}

/* ── 3. ...and time is, even without turns to spend ───────────────────────────── */
{
  const { s, id } = world();
  s.world.current_turn = 1;
  tickDrives(s, () => 0.5, MINUTES_PER_WANT);
  check("a full day of unimpeded offstage work finishes an ordinary want",
    s.characters[id].drive === undefined || (s.characters[id].drive?.progress ?? 0) >= 100, s.characters[id].drive);
}

/* ── 4. a blocked want moves slower than an open one ──────────────────────────── */
{
  const open = world(); open.s.world.current_turn = 1;
  tickDrives(open.s, () => 0.5, 240);
  const blocked = world(); blocked.s.characters[blocked.id].drive!.blocker = "the senator will not see him";
  blocked.s.world.current_turn = 1;
  tickDrives(blocked.s, () => 0.5, 240);
  check("a blocker slows the want down",
    blocked.s.characters[blocked.id].drive!.progress < open.s.characters[open.id].drive!.progress,
    [blocked.s.characters[blocked.id].drive!.progress, open.s.characters[open.id].drive!.progress]);
}

/* ── 5. a skip still moves the world, which is the point of a skip ────────────── */
{
  const { s, id } = world();
  s.world.current_turn = 1;
  tickDrives(s, () => 0.5, 3 * 24 * 60);   // three days away
  check("three days offstage finishes it", (s.characters[id].drive?.progress ?? 100) >= 100 || !s.characters[id].drive, s.characters[id].drive);
}

/* ── 6. people do not finish in lockstep ──────────────────────────────────────── */
{
  const s = newSave("clock", { name: "Rome" } as any);
  s.world.places["loc_rome"] = { id: "loc_rome", name: "Rome", description_facts: "A city.", contains: [] };
  s.world.player_location = "loc_rome";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const ids = ["A", "B", "C", "D"].map((n) => registerCharacter(s, { name: `Person${n}` } as any)!);
  for (const id of ids) s.characters[id].drive = { goal: "do the thing", progress: 0, priority: 1, updated_turn: 0 };
  s.world.present = ["char_player"];
  let roll = 0;
  s.world.current_turn = 1;
  tickDrives(s, () => (roll = (roll + 0.37) % 1), 600);
  const progresses = ids.map((id) => s.characters[id].drive!.progress);
  check("four people given the same want on the same turn do not march in step",
    new Set(progresses.map((p) => Math.round(p))).size > 1, progresses);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
