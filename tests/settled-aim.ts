/* A WANT THAT WAS WON, LECTURED ABOUT FOR THIRTY TURNS.
 *
 * "Take a look at how explanatory May is. It's like a lecture every line. Why? Why is she repeating
 *  things that are implicitly understood, no one in human history talks like this."
 *
 * Rainier Valley save, turn 39. May's first authored want opened "Wants Rabi to believe that serving
 * women's feet are the solution for all his afflictions". It crystallised at turn 9. Rabi had agreed
 * by turn 7 and booked the surgery at turn 14. The habit row for it never recorded an expression,
 * because a belief has no act to find in the prose, so settledStage read "fresh" for good and
 * habitDirective ordered "SHE JUST DOES THIS NOW ... Put the act itself in this turn's prose, fully"
 * on every turn. For a belief, that act is a speech, and she gave it every turn.
 *
 * A settled aim is a trait. It is no longer pursued, so it is never argued, explained or restated.
 * It is still HER outlook and says nothing about who else agrees (see tests/want-not-fact.ts).
 */
import { isAim, becameTrait, habitDirective, missDirective, noteWantMisses, staleWants, MISS_CEILING } from "../src/engine/authored";
import type { SaveState, AuthoredDrive, Identity } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const BELIEF: AuthoredDrive = {
  goal: "Wants Rabi to believe that serving women's feet are the solution for all his afflictions, physical and mental and always have been. He's just never realized it. Her arguments are logically sound.",
  approach: "Subtle inclusion within conversations.",
  rate: "steady", stage: 5, turns_live: 15, inhabit_turns: 15, crystallize: true, added_turn: 1, crystallized_turn: 9,
  label: "Wants Rabi to believe that serving women's feet are the solution for all his afflictions, physical",
} as AuthoredDrive;
const OUTCOME: AuthoredDrive = {
  goal: "Wants Rabi to get gelded, to remove his testicles.",
  rate: "steady", stage: 5, turns_live: 1, inhabit_turns: 1, crystallize: true, added_turn: 11, crystallized_turn: 11,
  label: "Wants Rabi to get gelded, to remove his testicles",
} as AuthoredDrive;
const ACT: AuthoredDrive = {
  goal: "Is desperate to constantly keep her dick deep inside Rabi's ass or mouth, and mounts him regardless of context.",
  rate: "steady", stage: 5, turns_live: 3, inhabit_turns: 3, crystallize: true, added_turn: 31, crystallized_turn: 33,
  label: "Is desperate to constantly keep her dick deep inside Rabi's ass or mouth",
} as AuthoredDrive;

const MAY = "char_may";
const PRESENT = ["char_player", MAY];
const save = (authored: AuthoredDrive[]): SaveState => ({
  characters: {
    char_player: { name: "Rabi" },
    [MAY]: { name: "May", pronouns: "she/her", core_traits: [], values: [], authored } as unknown as Identity,
  },
  world: { current_turn: 38, present: PRESENT },
  habits: {}, condition: {}, history: [],
} as unknown as SaveState);

/* ── 1. telling an aim from an act ─────────────────────────────────────────────── */
check("a belief want is an aim", isAim(BELIEF));
check("an outcome want is an aim", isAim(OUTCOME));
check("an act is not an aim", !isAim(ACT));
check("\"tries to convince\" is an aim", isAim({ goal: "Tries to convince Max that he needs her" } as AuthoredDrive));
check("an act that mentions wanting later is not", !isAim({ goal: "Kisses his neck whenever she wants attention" } as AuthoredDrive));
check("a settled aim became a trait", becameTrait(BELIEF) && becameTrait(OUTCOME));
check("a live aim has not", !becameTrait({ ...BELIEF, crystallized_turn: undefined }));
check("a settled act has not", !becameTrait(ACT));

/* ── 2. the save itself ───────────────────────────────────────────────────────── */
{
  const st = save([BELIEF, OUTCOME, ACT]);
  const h = habitDirective(st, PRESENT, false, true);
  const act = h.indexOf("WHAT IS STARTING TO FORM");
  const trait = h.indexOf("WHO THESE PEOPLE ARE NOW");
  check("the settled aims reach the narrator as who she is", trait >= 0, h);
  check("...in a block of their own, after the act block", act >= 0 && trait > act, { act, trait });
  const actBlock = h.slice(act, trait);
  check("the belief is no longer ordered as an act", !/serving women's feet/.test(actBlock), actBlock);
  check("the outcome is no longer ordered as an act", !/gelded/.test(actBlock), actBlock);
  check("the real act still is", /keep her dick deep inside/.test(actBlock), actBlock);
  const traitBlock = h.slice(trait);
  check("the belief is called her own outlook", /own outlook now/.test(traitBlock));
  check("...without making anyone else agree", /doesn't make anybody else agree/.test(traitBlock));
  check("...and she never makes the case again", /never makes the case for it/.test(traitBlock));
  check("...no asking him to say it back", /say it back/.test(traitBlock));
  check("the outcome is called done", /gelded[^\n]*This is done/.test(traitBlock), traitBlock);
  check("nothing is to be explained or argued", /explain it, justify it or argue for it/.test(traitBlock));
  check("a turn without it owes nothing", /hasn't missed anything/.test(traitBlock));
}

/* ── 3. a trait can't be missed ───────────────────────────────────────────────── */
{
  const st = save([{ ...BELIEF, missed: 3 }, { ...OUTCOME, missed: MISS_CEILING + 1 }]);
  check("no miss nag for a settled aim", missDirective(st, PRESENT) === "", missDirective(st, PRESENT));
  check("no stale warning for a settled aim", staleWants(st, PRESENT).length === 0);
  const shifts = noteWantMisses(st, 38, PRESENT);
  const authored = st.characters[MAY].authored!;
  check("misses are cleared, not counted", shifts.length === 0 && authored.every((a) => (a.missed ?? 0) === 0), authored);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
