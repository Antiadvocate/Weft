/* "THESE ARE HER ORIGINAL THINGS, BUT NOW SHE HAS NO LEGS."
 *
 * Emily Clarke, from the save where the player finally said the engine was unplayable. Recorded
 * quadriplegic, partially blind, both arms and both legs gone — and handed to the narrator every
 * single turn as the woman she was written as:
 *
 *   "Touches people when she talks to them — a hand on the arm, a brush of the shoulder — and does
 *    not notice she is doing it."
 *   "Cannot sit still; she is always adjusting something, a hem, a cushion, her own hair."
 *   Sewing and dressmaking — Expert.   Hairdressing — Good.
 *
 * with the narrator contract three lines above declaring core traits supreme over everything else
 * on the block. She reached for people with arms she does not have because the document told her
 * to, every turn, and it outranked the line saying her body was wrecked.
 *
 * THE CARD IS NOT REWRITTEN. The player said why, and he is right: "these are her original things,
 * but now she has no legs. So maybe if her legs are restored she can dance again." Editing traits
 * out destroys who somebody is in order to record what happened to them, and it does not survive
 * the story giving the part back. So the card stays exactly as authored and is filtered at render
 * time, every turn, against the body as the ledger currently reads it. */
import { lostFaculties, needsFaculty, FACULTY_LOSS, type Faculty } from "../src/engine/body";
import type { Condition } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const cond = (...conditions: string[]) => ({ conditions, injuries: [] } as unknown as Condition);

const EMILY = cond("quadriplegic", "partially blind", "missing left arm", "missing right arm", "missing both legs");

/* ── WHAT IS ACTUALLY GONE ─────────────────────────────────────────────────────────────────── */
{
  const f = lostFaculties(EMILY);
  check("her hands and her legs", f.includes("hands") && f.includes("legs"), f);
  check("…and not her sight, because partially blind is not blind", !f.includes("sight"), f);
  check("…and not her voice", !f.includes("speech"), f);
}
check("one arm is not both", !lostFaculties(cond("missing left arm")).includes("hands"));
check("both arms named separately is both", lostFaculties(cond("missing left arm", "right arm amputated")).includes("hands"));
check("the plural does it in one", lostFaculties(cond("no longer has arms")).includes("hands"));
check("a broken leg is not a lost one", !lostFaculties(cond("broken left leg", "concussion")).length);
check("blind in one eye still sees", !lostFaculties(cond("blind in one eye")).includes("sight"));
check("deaf in one ear still hears", !lostFaculties(cond("deaf in one ear")).includes("hearing"));
check("total blindness counts", lostFaculties(cond("blind")).includes("sight"));
check("a paraplegic keeps their hands", (() => {
  const f = lostFaculties(cond("paraplegic")); return f.includes("legs") && !f.includes("hands");
})(), lostFaculties(cond("paraplegic")));
check("an undamaged body loses nothing", !lostFaculties(cond("tired", "peckish")).length);

/* ── WHICH CARD ENTRIES THE BODY CAN NO LONGER CARRY OUT ─────────────────────────────────── */
const GONE: Faculty[] = ["hands", "legs"];
for (const [text, want] of [
  ["Touches people when she talks to them — a hand on the arm, a brush of the shoulder.", "hands"],
  ["Cannot sit still; she is always adjusting something, a hem, a cushion, her own hair.", "hands"],
  ["Sewing and dressmaking Expert. She can copy any garment from a picture.", "hands"],
  ["Hairdressing Good. She cuts and sets her own hair and her friends'.", "hands"],
  ["Paces when she is thinking and will not be told to sit down.", "legs"],
  ["Dancing Good. Learned it at the Palais on Saturday nights.", "legs"],
] as const) check(`blocked (${want}): ${text.slice(0, 44)}`, needsFaculty(text, GONE).includes(want), needsFaculty(text, GONE));

/* ── AND WHAT IS STILL ENTIRELY HERS ─────────────────────────────────────────────────────────
 * The whole point. A gate that takes everything leaves a body where a person was, and the traits
 * that survive are the ones the story still has to play. Several of these are words that read like
 * a body and are not: "carry a tune" flagged her Singing as needing hands until it was cut. */
for (const text of [
  "Has a temper that flares suddenly and dies just as fast.",
  "Singing Fair. She can carry a tune but not perform.",
  "Reading people Good. She can tell when someone is lying or frightened.",
  "Holds forth about the racing results to anyone who will let her.",
  "Reaches for the polite word first and regrets it after.",
  "Restless, and always has been.",
  "Warm with strangers and sharp with her own family.",
  "Carries a grudge the way other people carry a handkerchief.",
] as const) check(`still hers: ${text.slice(0, 44)}`, !needsFaculty(text, GONE).length, needsFaculty(text, GONE));

check("nothing lost, nothing gated", !needsFaculty("Sewing and dressmaking. Expert.", []).length);

/* ── AND IT COMES BACK ────────────────────────────────────────────────────────────────────────
 * Nothing was ever deleted, so restoring the part restores the trait with no repair pass, no
 * bookkeeping and no second call. This is the test the whole design exists for. */
{
  const after = cond("partially blind");            // the arms and legs given back
  const f = lostFaculties(after);
  check("with the limbs restored, nothing is gated", !f.length, f);
  check("…so the dressmaking is hers again", !needsFaculty("Sewing and dressmaking Expert.", f).length);
  check("…and so is the hand on the arm", !needsFaculty("Touches people when she talks to them — a hand on the arm.", f).length);
}

/* ── WHAT THE NARRATOR IS TOLD IT MEANS ────────────────────────────────────────────────────── */
{
  const said = lostFaculties(EMILY).map((f) => FACULTY_LOSS[f]).join("; ");
  check("the loss is stated as a fact about the body", /has no working arms or hands/.test(said), said);
  check("…and it reads as a sentence after a name", /^[a-z]/.test(said) && !/^[A-Z]/.test(said), said);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
