/* Smoke test: THE SAME ANECDOTE, THREE SCENES RUNNING.
 *
 * From a save, turns 14, 15 and 16, one woman answering three different questions:
 *
 *   "Elena keeps redesigning the same logo because the client can't decide if burgundy is 'too
 *    aggressive,' and Marcus is having some kind of feud with the new intern about who gets to
 *    order the flatstock."
 *   "Flatstock… It's—paper stock. For posters. Marcus wants to order the—"
 *   "Work is fine. Elena's still fighting over the burgundy. Marcus is still fighting over the
 *    flatstock."
 *
 * Half of that is the character working exactly as written. Her voice agenda is "to steer any
 * conversation off the closed door and back to something she can point at"; her tics are "swerves to
 * the physical environment when pressed" and "asks about logistics to stop a personal question"; and
 * the player asked her what was wrong three turns running. She is SUPPOSED to deflect. What she is
 * not supposed to do is deflect with the identical props every time, and nothing knew she had spent
 * them — the narrator reached for the nearest one, which was the one it had invented two turns ago
 * and could still see in the recent prose.
 *
 * The hard half is not detecting the repeat. It is not suppressing everything else along with it: a
 * conversation about work must still be able to say "work", and a scene must always be able to name
 * who is standing in it. So only DISTINCTIVE props are tracked, and the cast and the places are
 * never tracked at all.
 */
import { distinctiveProps, recordSpokenSubjects, spentSubjects, spentSubjectsNote } from "../src/engine/spent";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* The three turns, as the narrator actually wrote them. */
const T14 = `The phone buzzed on the counter, screen lighting up with Chloe's name.\n\n"Work's work," she said. "Elena keeps redesigning the same logo because the client can't decide if burgundy is 'too aggressive,' and Marcus is having some kind of feud with the new intern about who gets to order the flatstock." She blew across the surface of the tea.`;
const T15 = `Miranda's breath caught.\n\n"Flatstock," she said, and her voice came out slightly higher than before. "It's paper stock. For posters. Marcus wants to order the—" She stopped.`;
const T16 = `Miranda shifted, adjusting her legs.\n\n"Work is fine. Elena's still fighting over the burgundy. Marcus is still fighting over the flatstock." She laughed, a small, dry sound.`;

function freshState(turn: number): SaveState {
  return {
    world: { current_turn: turn, places: { loc_a: { name: "Ashford Loft" } }, present: [] },
    world_bible: { name: "The City of Ashford" },
    characters: {
      char_player: { name: "Vin" },
      char_m: { name: "Miranda" },
      char_c: { name: "Chloe" },
    },
  } as unknown as SaveState;
}

/* ── 1. the props are found, and only the props ───────────────────────────────── */
{
  const st = freshState(14);
  const exclude = new Set(["vin", "miranda", "chloe", "ashford", "loft", "city"]);
  const props = distinctiveProps(`"Elena keeps redesigning the same logo because the client can't decide if burgundy is 'too aggressive,' and Marcus is having some kind of feud with the new intern about who gets to order the flatstock."`, exclude);
  check("the invented colleague is a prop", props.includes("elena"), props);
  check("so is the other one", props.includes("marcus"), props);
  check("the trade word is a prop", props.includes("flatstock"), props);
  check("and the colour", props.includes("burgundy"), props);
  check("but 'logo' is just a word people say", !props.includes("logo"), props);
  check("and so is 'client'", !props.includes("client"), props);
  void st;
}

/* ── 2. the cast and the world are never spendable ───────────────────────────────
 *
 * This is the assertion that matters most. A rule that told the narrator to stop saying "Chloe"
 * because Chloe came up twice would be far worse than the bug it fixed. */
{
  const st = freshState(14);
  recordSpokenSubjects(st, `"Chloe called again," Miranda said. "Chloe always calls. We should walk into Ashford."`, 13);
  recordSpokenSubjects(st, `"Chloe again," she said. "Chloe. In Ashford, of all places."`, 14);
  const spent = spentSubjects(st);
  check("a character in the scene is never spent", !spent.includes("chloe"), spent);
  check("neither is the city", !spent.includes("ashford"), spent);
}

/* ── 3. the actual loop, replayed ─────────────────────────────────────────────── */
{
  const st = freshState(14);
  recordSpokenSubjects(st, T14, 14);
  st.world.current_turn = 15;
  check("nothing is spent after one telling", spentSubjects(st).length === 0, spentSubjects(st));

  recordSpokenSubjects(st, T15, 15);
  st.world.current_turn = 16;
  const spent = spentSubjects(st);
  check("said twice running, the trade word is spent", spent.includes("flatstock"), spent);
  check("...and so is the colleague who came with it", spent.includes("marcus"), spent);

  recordSpokenSubjects(st, T16, 16);
  st.world.current_turn = 17;
  const note = spentSubjectsNote(st);
  check("the narrator is told, by turn 17", note.includes("flatstock"), note);
  check("...and told it is the prop that is spent, not the behavior",
    /NOT an instruction to change what anybody wants/.test(note), note);
  check("...and pointed at the rest of the character's life", /background|standing interests/.test(note), note);
}

/* ── 4. a prop comes back once it has actually been left alone ───────────────── */
{
  const st = freshState(14);
  recordSpokenSubjects(st, T14, 14);
  recordSpokenSubjects(st, T15, 15);
  st.world.current_turn = 16;
  check("spent while it is still warm", spentSubjects(st).includes("flatstock"));
  st.world.current_turn = 21;   // five quiet turns later
  check("and available again after a rest", !spentSubjects(st).includes("flatstock"), spentSubjects(st));
}

/* ── 5. one repeated prop is not a pattern ───────────────────────────────────── */
{
  const st = freshState(14);
  recordSpokenSubjects(st, `"The flatstock again," she said.`, 14);
  recordSpokenSubjects(st, `"Flatstock," she repeated.`, 15);
  st.world.current_turn = 16;
  check("a single spent word does not raise a directive", spentSubjectsNote(st) === "", spentSubjectsNote(st));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
