/* "POWER MEANS. NOTHING. HER BEING ABLE TO WALK AWAY AFTER I FREEZE HER IN PLACE AND REMOVE HER
 *  ABILITY TO TALK IS WILD. AND I HAVE SERVANTS BACK TALKING ME."
 *
 * Both halves come back to the same thing: a godlike act touches nothing the engine keeps.
 *
 * THE STANDING HALF. `power_witnessed` is the tier effectiveStanding reads to decide whether anyone
 * defers, and reaction.applyUnexplained is the only thing that sets it, and it fires off the
 * simulator's `unexplained` field. That field is described at length in the contract, typed in
 * types.ts, consumed by the engine — and was never declared in SIMULATOR_JSON_SCHEMA. The root
 * object is additionalProperties:true so a volunteered field still lands, which is why it worked
 * sometimes: set in seven of eleven saves, missing in the rest, including one where the player
 * conjured and then vanished furniture in front of a witness on turn 9. With the tier unset,
 * TIER_STANDING contributes zero and a man who rewrites matter carries a stranger's standing.
 *
 * THE FROZEN HALF. The coherence gate already refuses a body doing what it has not got the parts
 * for, and lostFaculties already knew about amputations and diagnoses — but not about being held.
 * "frozen in place, cannot move" was a severity-3 mark that mapped to no lost faculty at all, so
 * nothing objected when she walked off. What matters to the gate is that the legs do not work, not
 * how they came to. */
import { lostFaculties } from "../src/engine/body";
import { checkCoherence } from "../src/engine/coherence";
import { effectiveStanding } from "../src/engine/desire";
import { SIMULATOR_JSON_SCHEMA } from "../src/engine/schema";
import { SIMULATOR_SYSTEM } from "../src/engine/prompts";
import type { Condition, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const cond = (...conditions: string[]) => ({ conditions, injuries: [] } as unknown as Condition);

/* ── HELD IN PLACE IS LOST MOBILITY, HOWEVER IT HAPPENED ────────────────────────────────────── */
for (const t of ["frozen in place, cannot move", "cannot move", "unable to move", "held fast",
                 "frozen solid", "rooted to the spot", "immobilised by something he did"])
  check(`mobility lost: "${t}"`, lostFaculties(cond(t)).includes("legs"), lostFaculties(cond(t)));
check("and being silenced is lost speech", lostFaculties(cond("cannot speak")).includes("speech"));
check("both at once, from one act", (() => {
  const f = lostFaculties(cond("frozen in place, cannot move", "cannot speak"));
  return f.includes("legs") && f.includes("speech");
})(), lostFaculties(cond("frozen in place, cannot move", "cannot speak")));
/* AND ORDINARY STILLNESS IS NOT THIS. Somebody choosing not to move is not somebody who cannot. */
for (const t of ["did not move", "standing very still", "waiting by the door", "tired"])
  check(`left alone: "${t}"`, !lostFaculties(cond(t)).includes("legs"), lostFaculties(cond(t)));

/* ── AND THE GATE THEN REFUSES THE WALK ─────────────────────────────────────────────────────── */
{
  const st = {
    characters: { c: { name: "Constance Wexford" }, char_player: { name: "Rabi" } },
    condition: { c: cond("frozen in place, cannot move", "cannot speak") },
  } as unknown as SaveState;
  const v = checkCoherence(st, "Constance walks out through the doors without looking back.", ["c"]);
  check("a woman held in place does not walk out", v.some((x) => x.kind === "impossible-body"), v);
  check("…and the reason names what the record says", /cannot move under their own power/.test(v[0]?.why ?? ""), v[0]);
  /* A NAME INSIDE DIALOGUE IS BEING ADDRESSED, NOT ACTING. The ambiguity guard counted a vocative
   * as another actor in the sentence, so a silenced woman's dialogue tag went unchecked. */
  const spoke = checkCoherence(st, `Constance turns her head, and then she says, "Not tonight, Rabi."`, ["c"]);
  check("a vocative no longer disables the check", spoke.some((x) => x.kind === "impossible-body"), spoke);
  /* AND A LIMIT WORTH WRITING DOWN. The gate only reads sentences that NAME the person, so a bare
   * dialogue tag in its own sentence — `"I have no answer for that," she said.` — is not checked at
   * all. Relaxing that means deciding which "she" a pronoun is, and this gate deletes prose. */
  check("a nameless dialogue tag is still outside its reach",
    checkCoherence(st, `The wind came off the water. "I have no answer for that," she said.`, ["c"]).length === 0);
}

/* ── THE TIER, AND WHAT IT IS WORTH ─────────────────────────────────────────────────────────── */
{
  const declared = (SIMULATOR_JSON_SCHEMA as { properties: Record<string, unknown> }).properties;
  check("the field the engine depends on is declared", "unexplained" in declared, Object.keys(declared).length);
  const u = declared.unexplained as { properties: Record<string, unknown>; required: string[] };
  check("…with what they saw", "what" in u.properties);
  check("…and who saw it", "witnesses" in u.properties);
  check("…and the account of it is required", u.required.includes("what"));
}
check("a witnessed cosmic power floors everyone's standing far below him",
  effectiveStanding(0, "cosmic") <= -45, effectiveStanding(0, "cosmic"));
check("…and with no tier recorded, a god has a stranger's standing",
  effectiveStanding(0, undefined) === 0);
check("…which is the whole of the servants back-talking him",
  effectiveStanding(0, "mythic") < effectiveStanding(0, undefined));

/* ── AND THE BOOKKEEPER IS TOLD TO RECORD IT ────────────────────────────────────────────────── */
check("acts on a body are named as conditions on that body",
  /WHAT THE PLAYER DID TO SOMEBODY'S BODY IS A CONDITION ON THAT BODY/.test(SIMULATOR_SYSTEM));
check("…with the plain wording asked for", /frozen in place, cannot move/.test(SIMULATOR_SYSTEM));
check("…the consequence of omitting it spelled out",
  /walk out of the room and answer a question/.test(SIMULATOR_SYSTEM));
check("…and the release recorded the same way", /condition_remove, the moment the prose lets them go/.test(SIMULATOR_SYSTEM));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
