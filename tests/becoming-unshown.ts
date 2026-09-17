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
import { becomingLaw, becomingFinalLaw, applyBecomingProgress, GRACE_TURNS } from "../src/engine/becoming";
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

/* ── 6. THE LAST TURN OF THE CLOCK IS NOT A REQUEST ──────────────────────────────
 *
 * becomingDirective already asks as hard as prose can, and past STALL_LIMIT it tells the narrator
 * the world is behind and this turn opens on it. The save's becoming came back moved: 0, stalled: 3
 * on a three-turn clock — asked three times, ignored three times, then converted into a fact.
 *
 * Asking harder is not the move left. What the engine had and was not using is the shape it uses
 * wherever something MUST be on the page: state it as a fact, name the specific ways it gets
 * skipped, and put it LAST, which is where this codebase has repeatedly recorded that a rule stops
 * being reference and becomes an instruction. */
{
  const s = state([{ id: "x", claim: NEVER, turns: 3, remaining: 1, moved: 0, stalled: 2 }]);
  const law = becomingFinalLaw(s);
  check("the final turn gets its own law", law.includes("THE LAST TURN ON THIS CLOCK"), law);
  check("...carrying the claim", law.includes(NEVER));
  check("...and the three declines, the same three a player's declaration gets",
    /Nothing arrives to interrupt it/.test(law) && /Nobody almost does it/.test(law) && /Nothing milder happens instead/.test(law), law);
  check("...with the clock's own bargain named", law.includes("The player set the number of turns"));

  check("a becoming with turns left does not get it",
    becomingFinalLaw(state([{ id: "y", claim: NEVER, turns: 3, remaining: 2, moved: 0, stalled: 0 }])) === "");
  check("nor does one that already arrived",
    becomingFinalLaw(state([{ id: "z", claim: NEVER, turns: 3, remaining: 0, moved: 1, stalled: 0, arrived_turn: 4 }])) === "");
}

/* ── 7. AND THE CLOCK DOES NOT SPEND A TURN THE PROSE NEVER DELIVERED ────────────
 *
 * The existing note is right that gating the clock on the simulator's report was wrong — the report
 * is the thing that fails, and a becoming gated on a model's judgement waits forever. That is an
 * objection to gating on a JUDGEMENT. findDeclaredMiss reads the committed prose for the claim's
 * own content words and for the three shapes a skipped event takes, the way maxims, echo, anatomy
 * and kinship all read the page: free, lexical, no opinion.
 *
 * Every turn but the last still spends itself regardless. The last one is given again, at most
 * GRACE_TURNS times, when the prose came back without the thing in it. */
{
  const CLAIM = "The basement laundry has been padlocked by the management company.";
  const s = state([{ id: "g", claim: CLAIM, turns: 3, remaining: 1, moved: 0, stalled: 2 }]);
  const b = (s.becomings as any[])[0];

  const empty = "The fan turned in the window. He kept reading until the light went out of the room.";
  applyBecomingProgress(s, 9, undefined, empty);
  check("a final turn that came back empty does not spend the clock", b.remaining === 1, b);
  check("...and the grace is counted", b.grace === 1, b);
  check("...and the player is told", !b.arrived_turn);

  check(`the grace is ${GRACE_TURNS} turn, because a final turn now costs two model attempts`, GRACE_TURNS === 1);

  /* Bounded, because a narrator that never finds a way in must not freeze it forever. That is the
   * objection the deadline was built against and it still holds — and by this point four model
   * attempts have been spent on it: two on the first final turn, two on the grace turn, since
   * turn.ts re-runs the whole turn on the fallback when an ordered thing is missing. */
  applyBecomingProgress(s, 10, undefined, empty);
  check("past the grace it lands anyway", b.arrived_turn === 10, b);
  check("...and is then owed on the page", becomingLaw(s).includes("NEVER ONCE ON THE PAGE"));
}

/* ── 8. A FINAL TURN THAT DID DELIVER SPENDS ITSELF ──────────────────────────── */
{
  const CLAIM = "The basement laundry has been padlocked by the management company.";
  const s = state([{ id: "h", claim: CLAIM, turns: 3, remaining: 1, moved: 2, stalled: 0 }]);
  const b = (s.becomings as any[])[0];
  const landed = "A padlock had gone on the basement laundry door overnight, management company's notice taped beside it, and the hasp was new.";
  applyBecomingProgress(s, 9, undefined, landed);
  check("the clock spends when the prose carried it", b.arrived_turn === 9, b);
  check("...with no grace used", !b.grace, b);

  /* And it is not owed, because it was shown on the way in. */
  check("...and it is not in the owed block", !becomingLaw(s).includes("NEVER ONCE ON THE PAGE"), becomingLaw(s));
}

/* ── 9. WITHOUT PROSE THE OLD BEHAVIOUR STANDS ───────────────────────────────── */
{
  const s = state([{ id: "i", claim: NEVER, turns: 3, remaining: 1, moved: 0, stalled: 2 }]);
  const b = (s.becomings as any[])[0];
  applyBecomingProgress(s, 9, undefined);
  check("a caller that passes no prose is unchanged", b.arrived_turn === 9, b);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
