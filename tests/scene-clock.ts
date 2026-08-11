/* Smoke test: TURN 45 AND IT IS TWO IN THE AFTERNOON.
 *
 * The engine has exactly one mechanism for crossing dead time — readScene deciding a scene has
 * spent itself, which lets the narrator close it and cross the walk, the afternoon, the queue, in
 * a line instead of playing it. It has never fired.
 *
 * Four conditions, all required, and one of them cannot be met in a story that has a pressure
 * controller in it: FLAT_TURNS wants four consecutive turns at pressure ≤2, and varying the
 * pressure is the pressure system's whole job. The real trace from a 24-turn save:
 *
 *   1 1 5 1 1 6 5 4 1 2 1 7 3 2 4 7 1 7 0 1 3 6 4 4
 *
 * Longest run at or below 2: three. The scene hit exactly 75 minutes on the final turn and the cut
 * was still refused. So every beat was played at conversational resolution, the clock advanced 7.3
 * minutes a turn, and one in-world day costs 197 turns.
 *
 * The vetoes are right and stay. What was wrong was treating "this scene has more to give" as a
 * fixed test. Eighty minutes in with pressure still moving, it does. Four hours later it does not,
 * whatever the trace says.
 */
import { readScene, sceneCutDirective } from "../src/engine/scene";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** The real pressure trace from the Rome save. */
const TRACE = [1, 1, 5, 1, 1, 6, 5, 4, 1, 2, 1, 7, 3, 2, 4, 7, 1, 7, 0, 1, 3, 6, 4, 4];

function scene(minutesIn: number, trace: number[]): SaveState {
  const s = newSave("clock", { name: "Rome" } as any);
  s.world.places["loc_shop"] = { id: "loc_shop", name: "A cookshop", description_facts: "Low ceiling.", contains: [] };
  s.world.player_location = "loc_shop";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.scene_started_time = "Day 1, 09:00";
  const h = 9 + Math.floor(minutesIn / 60), m = minutesIn % 60;
  s.world.current_time = `Day 1, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  s.pressure_trace = [...trace];
  s.world.present = ["char_player"];
  s.world.consequences = [];
  return s;
}

/* ── 1. the trace that could never satisfy the old gate ───────────────────────── */
{
  let longest = 0, run = 0;
  for (const p of TRACE) { run = p <= 2 ? run + 1 : 0; longest = Math.max(longest, run); }
  check("the real trace never gives four quiet turns in a row", longest === 3, longest);
  check("...so at 75 minutes the cut is still refused, as it was", !readScene(scene(75, TRACE)).spent);
  check("and at two hours", !readScene(scene(120, TRACE)).spent);
}

/* ── 2. but a scene cannot run all day ────────────────────────────────────────── */
{
  const r = readScene(scene(4 * 60, TRACE));
  check("four hours in one unbroken scene ends it regardless of the trace", r.spent, r);
  check("and the reason says so, for the log", /four hours/.test(r.reason), r.reason);
  check("a busy scene an hour old is still left alone", !readScene(scene(60, TRACE)).spent);
}

/* ── 3. the quiet it demands relaxes as the scene ages ────────────────────────── */
{
  // two quiet turns: not enough at 75 minutes, enough at two and a half hours
  const twoQuiet = [7, 6, 4, 1, 2];
  check("two quiet turns is not enough early", !readScene(scene(80, twoQuiet)).spent);
  check("but it is enough deep into a scene", readScene(scene(150, twoQuiet)).spent, readScene(scene(150, twoQuiet)).reason);
  const oneQuiet = [7, 6, 4, 5, 1];
  check("one quiet turn is enough past three hours", readScene(scene(190, oneQuiet)).spent, readScene(scene(190, oneQuiet)).reason);
}

/* ── 4. the case it was originally written for still works ───────────────────── */
{
  check("a genuinely quiet scene cuts at 75 minutes", readScene(scene(80, [5, 4, 1, 1, 2, 1])).spent);
}

/* ── 5. the vetoes are untouched below the ceiling ────────────────────────────── */
{
  const quiet = [5, 1, 1, 2, 1];
  const withConsequence = scene(80, quiet);
  withConsequence.world.consequences = [{ id: "c1", status: "pending" } as any];
  check("a pending consequence still holds the scene", !readScene(withConsequence).spent, readScene(withConsequence).reason);

  const pursuing = scene(80, quiet);
  const id = registerCharacter(pursuing, { name: "Lucia" } as any)!;
  pursuing.world.present = ["char_player", id];
  pursuing.world.current_turn = 10;
  pursuing.characters[id].drive = { goal: "reach the bookseller", progress: 40, priority: 1, updated_turn: 10, progress_turn: 9 };
  check("somebody mid-pursuit still holds it", !readScene(pursuing).spent, readScene(pursuing).reason);

  // ...but not past the ceiling. A four-hour scene is over even with a want alive in it.
  const stuck = scene(5 * 60, quiet);
  const id2 = registerCharacter(stuck, { name: "Lucia" } as any)!;
  stuck.world.present = ["char_player", id2];
  stuck.world.current_turn = 10;
  stuck.characters[id2].drive = { goal: "reach the bookseller", progress: 40, priority: 1, updated_turn: 10, progress_turn: 9 };
  check("the ceiling overrides the vetoes", readScene(stuck).spent, readScene(stuck).reason);
}

/* ── 6. and the directive only exists when the scene is over ──────────────────── */
{
  check("no directive while the scene is live", sceneCutDirective(readScene(scene(60, TRACE))) === "");
  const d = sceneCutDirective(readScene(scene(5 * 60, TRACE)));
  check("a directive once it is spent", d.length > 0);
  check("it asks for the ending to be played, not skipped", /close it on the page|Bring it to a close ON THE PAGE/i.test(d), d);
  check("and it permits crossing the connective time", /CUT/.test(d), d);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
