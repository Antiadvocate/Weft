/* Smoke test: IT BECAME TRUE, NOBODY EVER SAW IT, AND THEN NOBODY WAS ALLOWED TO MENTION IT.
 *
 * From a save, the second of two becomings the player wrote:
 *
 *     turns: 3   moved: 0   stalled: 3   arrived_turn: 6
 *
 * It stalled on every turn of its life. The clock spent all three anyway, because a deadline is a
 * deadline and the card says so. It entered world.canon.
 *
 * From that turn on, becomingLaw told the narrator that the arrived claims are "the water these
 * people have always swum in: old, unremarkable, and beneath comment", that "NOBODY IS SURPRISED BY
 * THEM", that "NOBODY ANNOUNCES THEM EITHER… they are not stated, quoted, or described as facts",
 * and that they are "visible only in what people do without thinking about it".
 *
 * So the engine promoted an event the player had never seen into a background condition and then
 * forbade anybody from showing it. Every line after that is written against something that has not
 * happened on the page. The player: "Dialogue makes no sense now. None of the things within 'what
 * this world is turning into' has occurred."
 *
 * One clause in that block did say "it shows in THIS scene" — sitting inside a paragraph whose
 * other four sentences say do not announce it, do not remark on it, keep it beneath comment. The
 * louder half wins, and becomingLaw's own header records the same failure happening once before.
 *
 * A becoming the world grew into and a becoming that landed on the calendar alone need opposite
 * instructions, so they get separate blocks.
 */
import { becomingLaw } from "../src/engine/becoming";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const GROWN = "The building's upper floors are no longer structurally sound.";
const NEVER = "The basement laundry has been padlocked by the management company.";

const state = (becomings: unknown[]): SaveState =>
  ({ becomings, world: { present: [] }, characters: {} } as unknown as SaveState);

/* ── 1. A BECOMING THE WORLD GREW INTO IS UNCHANGED ──────────────────────────── */
{
  const law = becomingLaw(state([{ id: "a", claim: GROWN, turns: 3, remaining: 0, moved: 3, stalled: 0, arrived_turn: 4, shown: 1 }]));
  check("it is still written as the ordinary condition of the place", law.includes("WHAT IS TRUE OF THIS WORLD NOW"), law);
  check("...nobody is surprised by it", law.includes("NOBODY IS SURPRISED BY THEM"));
  check("...and it is not announced", law.includes("NOBODY ANNOUNCES THEM EITHER"));
  check("the claim is in it", law.includes(GROWN));
  check("and no separate block is opened for it", !law.includes("NEVER ONCE ON THE PAGE"), law);
}

/* ── 2. ONE THAT LANDED ON THE CALENDAR ALONE GETS THE OPPOSITE ──────────────── */
{
  const law = becomingLaw(state([{ id: "b", claim: NEVER, turns: 3, remaining: 0, moved: 0, stalled: 3, arrived_turn: 6 }]));
  check("it is named as never having reached the page", law.includes("NEVER ONCE ON THE PAGE"), law);
  check("...the turn its clock ran out is given", law.includes("turn 6"));
  check("...and this turn has to render it", law.includes("WRITE IT HAPPENING, THIS TURN"), law);

  /* The instruction it was drowning in must not be applied to this one. */
  check("it is not called old and beneath comment", !law.includes("beneath comment"), law);
  check("it is not called unremarkable", !law.includes("unremarkable"), law);
  check("nothing tells the narrator to keep it invisible",
    !law.includes("visible only in what people do without thinking"), law);

  /* Both halves have to hold at once: canon means nobody is startled, and never-seen means it has
   * to actually be on the page. */
  check("nobody is startled by it, because it is canon", law.includes("nobody is startled"), law);
  check("...and it may not be alluded to as already understood",
    law.includes("cannot be alluded to, assumed, or referred to"), law);
}

/* ── 3. BOTH AT ONCE, IN THE RIGHT ORDER ─────────────────────────────────────── */
{
  const law = becomingLaw(state([
    { id: "a", claim: GROWN, turns: 3, remaining: 0, moved: 3, stalled: 0, arrived_turn: 4, shown: 1 },
    { id: "b", claim: NEVER, turns: 3, remaining: 0, moved: 0, stalled: 3, arrived_turn: 6 },
  ]));
  check("both blocks are sent", law.includes("NEVER ONCE ON THE PAGE") && law.includes("WHAT IS TRUE OF THIS WORLD NOW"));
  check("the owed one comes first", law.indexOf("NEVER ONCE ON THE PAGE") < law.indexOf("WHAT IS TRUE OF THIS WORLD NOW"), law);
  check("each claim appears once", (law.match(new RegExp(NEVER.slice(0, 30), "g")) ?? []).length === 1);
  check("the grown one is not in the owed block",
    law.slice(0, law.indexOf("WHAT IS TRUE OF THIS WORLD NOW")).indexOf(GROWN) === -1, law);
}

/* ── 4. ONCE IT HAS BEEN SHOWN, IT STOPS BEING OWED ──────────────────────────── */
{
  const law = becomingLaw(state([{ id: "b", claim: NEVER, turns: 3, remaining: 0, moved: 0, stalled: 3, arrived_turn: 6, shown: 1 }]));
  check("a claim rendered after arrival joins the ordinary block",
    !law.includes("NEVER ONCE ON THE PAGE") && law.includes("WHAT IS TRUE OF THIS WORLD NOW"), law);
}

/* ── 5. NOTHING ARRIVED, NOTHING SAID ────────────────────────────────────────── */
{
  check("no becomings, no block", becomingLaw(state([])) === "");
  check("a live one is not law yet",
    becomingLaw(state([{ id: "c", claim: NEVER, turns: 3, remaining: 2, moved: 0, stalled: 1 }])) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
