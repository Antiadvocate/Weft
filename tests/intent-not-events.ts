/* Smoke test: "I DIDN'T GIVE TIGRIS SHOES. I GAVE YOU SHOES."
 *
 * From a save set in Rome, turn 11. The player took one woman upstairs to a rented room and handed
 * her one pair of shoes. Three other characters were downstairs and the narrator said so, plainly,
 * in the last line of the scene:
 *
 *   "Marcus had not followed them up. Tigris had not moved from her corner. Clodia's rag kept its
 *    slow circle on the counter."
 *
 * The intent pass had been run before any of that was written, and it drafted a stance for each of
 * them anyway — Tigris "takes the shoes with a practiced, bright thank-you", Clodia "accepts the
 * gift with a small, genuine smile". Those are `surface`: a plan for behaviour, authored before the
 * scene existed. They went to the bookkeeper under a header calling the whole block authoritative
 * and instructing it to record "from THIS, not from the prose". So it did, and the turn entered the
 * record as "Tigris and Clodia receive their own pairs with guarded reactions".
 *
 * Nine turns later, in a wineshop, the woman who had actually been given the shoes said to the
 * player's face: "I watched you pay her in gold. I watched you give Tigris shoes." He spent his
 * whole turn arguing with the engine about something he had never done — "I didn't give Tigris
 * shoes I gave you shoes. That you are currently wearing, look down."
 *
 * The module's own header comment already had the split right: `surface` is for the NARRATOR to
 * render, `truth` is inner state for the BOOKKEEPER to file. It was the formatter that sent both.
 * Interiority is the one thing prose genuinely hides and the one thing this pass knows. Events are
 * the prose's job and nothing else's.
 */
import { intentForBookkeeper, intentForNarrator, type NpcIntent } from "../src/engine/intent";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* the intents the save actually carried on turn 11 */
const TURN_11: NpcIntent[] = [
  {
    char_id: "char_lucia", name: "Lucia Aelia Severa",
    surface: "She watches him kneel to put on the shoes, a small smile tugging at her mouth.",
    truth: "She is touched that he would kneel for her, and the warmth of it loosens something in her chest.",
    lying: false,
  },
  {
    char_id: "char_tigris", name: "Tigris",
    surface: "She takes the shoes with a practiced, bright thank-you, turning them over in her hands like she's appraising them, and sets them aside without trying them on.",
    truth: "She is reeling. He gave her something without asking for anything back, and she doesn't know what to do with that.",
    lying: true,
  },
  {
    char_id: "char_clodia", name: "Clodia",
    surface: "She accepts the gift with a small, genuine smile, turning the shoes over in her hands, then sets them aside.",
    truth: "She is touched by the unexpected kindness and wants to extend the connection.",
    lying: false,
  },
];

/* ── 1. the plan does not reach the ledger ────────────────────────────────────── */
{
  const b = intentForBookkeeper(TURN_11);
  check("nobody is recorded taking the shoes", !/takes the shoes|accepts the gift/i.test(b), b);
  check("no surface text survives at all", !TURN_11.some((i) => b.includes(i.surface)), b);
  check("and none of the stances leak in paraphrase", !/turning them over in her hands/i.test(b), b);
}

/* ── 2. what it IS for still gets through ─────────────────────────────────────── */
{
  const b = intentForBookkeeper(TURN_11);
  for (const i of TURN_11) check(`${i.name}'s true state is filed`, b.includes(i.truth!), b);
  check("the liar is marked as concealing", /WAS CONCEALING SOMETHING/.test(b), b);
  check("the honest ones are not", (b.match(/WAS CONCEALING SOMETHING/g) ?? []).length === 1, b);
  check("ids are carried so the diff can write to them", TURN_11.every((i) => b.includes(`[${i.char_id}]`)), b);
}

/* ── 3. and the header says which one outranks the other ──────────────────────── */
{
  const b = intentForBookkeeper(TURN_11);
  check("it is scoped to inner state", /for their inner state only/.test(b), b);
  check("it says outright that this is not what happened", /NOT A RECORD OF WHAT HAPPENED/.test(b), b);
  check("events are sent back to the prose", /from the NARRATOR PROSE only/.test(b), b);
  check("and the summary is named, since that is where it landed", /scene_summary/.test(b), b);
  check("the old instruction to prefer this over the prose is gone",
    !/not from the prose/i.test(b) && !/record memories\/facts\/traits from THIS/i.test(b), b);
  check("nothing is emitted for an empty turn", intentForBookkeeper([]) === "");
}

/* ── 4. the narrator's half is untouched — the plan is exactly what it wants ──── */
{
  const n = intentForNarrator(TURN_11);
  check("the narrator still gets the stances", TURN_11.every((i) => n.includes(i.surface)), n);
  check("and never the decoded answer", !TURN_11.some((i) => n.includes(i.truth!)), n);
}

/* ── 5. A STANCE WITH NO INTERIOR IS STILL A STANCE ───────────────────────────────
 * When the cheap model writes the posture twice, the truth is dropped and the intent used to be
 * dropped with it — so the narrator lost the commitment too and wrote the character free-hand from
 * the card. Measured across five saves of one game, a present, living, central character got a
 * committed stance on only 22-27% of the turns they were in the room for, decaying from 50% at
 * turn 20 to 24% by turn 169. The pass was firing the whole time; three results in four were being
 * binned. Now the stance survives and only the interior is withheld. */
{
  const stanceOnly = [{ char_id: "c1", name: "Vela", surface: "keeps her back to the counter and answers short", tell: "her thumb goes still on the cloth", lying: false }];
  const n = intentForNarrator(stanceOnly);
  check("the narrator still gets a committed stance", n.includes("keeps her back to the counter"), n);
  check("…and the tell with it", n.includes("thumb goes still"), n);
  const b = intentForBookkeeper(stanceOnly);
  check("the bookkeeper is told nothing rather than something false", b === "", b);
  const mixed = intentForBookkeeper([...stanceOnly, ...TURN_11]);
  check("…and a stance-only one does not suppress the real ones", TURN_11.every((i) => mixed.includes(i.truth!)), mixed);
  check("…while still contributing no interior of its own", !mixed.includes("keeps her back to the counter"), mixed);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
