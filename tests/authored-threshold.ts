/* Smoke test: a want written at maximum stage that produced five turns of dishes.
 *
 * The player authored a want onto Miranda, detailed and explicit, and crystallised it. Five turns
 * later the prose had covered a stack of plates, a bowl on the top shelf, three stacks of mail and
 * a turned-under collar, and not one word of the want. The engine had done everything right — the
 * goal was stored whole, stage 5, crystallised, and habitDirective put it in front of the narrator
 * at full force, under a header saying NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE.
 *
 * And then the clause bolted to the end of it read:
 *
 *   IF THE ACT REQUIRES THE PLAYER'S BODY OR THE PLAYER'S ASSENT, YOU CANNOT WRITE IT AND MUST NOT
 *   TRY ... What you write instead is HER ENTIRE HALF — everything up to the choice
 *
 * That clause was written for a real problem: a want that names the player as the one who has to
 * move is an order the narrator must not carry out, because the narration stops where the player's
 * choice begins. It is right about that and it is not negotiable.
 *
 * It is wrong about what a choice is. It folded the player's ASSENT together with the player's
 * BODY, and by the second reading almost nothing in this engine can be written — every touch, every
 * handed object, every shove requires the player's body in the sense of them standing there. For a
 * want whose act happens ON the player, "everything up to the choice" is everything except the
 * want. The escape hatch ate the instruction it was attached to, and the collar got straightened.
 *
 * So the line is drawn where it belongs. Somebody acting on the player is a thing that happens in
 * the world, and it is written. What is never written is the player DECIDING — agreeing, refusing,
 * going along, reciprocating, or being handed a feeling about it. Both halves are requirements now,
 * which is what stops one of them from swallowing the other.
 */
import { habitDirective, newAuthored, crystallize, crystallizedLabel, settledStage } from "../src/engine/authored";
import { clipWords, LABEL_MAX } from "../src/engine/coerce";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const GOAL = "Jerks her penis off on his face, Always Makes sure Vin's face is always covered with her cum, does not let him wipe it off, quickly cums on his face if it's dry without needing sex or talking to him about what she's doing.";

function scene() {
  const s: any = newSave("t", { name: "Vin" } as any);
  s.world.places["loc_x"] = { id: "loc_x", name: "The loft", description_facts: "k", contains: [] };
  s.world.player_location = "loc_x";
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  const m = registerCharacter(s, { name: "Miranda", age: 38, background: "b", core_traits: ["t"] } as any);
  s.characters[m].location = "loc_x";
  s.world.present = ["char_player", m];
  s.world.current_turn = 5;
  return { s, m };
}

/* ── 1. the want reaches the narrator, whole ──────────────────────────────────── */
{
  const { s, m } = scene();
  const a = newAuthored(GOAL, 1, { stage: 5, inhabit_turns: 3, crystallize: true });
  s.characters[m].authored = [a];
  crystallize(s, m, a, 3);

  const d = habitDirective(s, s.world.present);
  check("the directive fires", d.length > 0);
  check("...carrying the want to its last word", d.includes("about what she's doing"), d.slice(0, 120));
  check("...at full strength", /NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE/.test(d));
  check("...and it is still fresh, so it is not standing down", settledStage(s, m, a) === "fresh");
}

/* ── 2. the clause no longer cancels it ───────────────────────────────────────── */
{
  const { s, m } = scene();
  const a = newAuthored(GOAL, 1, { stage: 5, inhabit_turns: 3 });
  s.characters[m].authored = [a];
  crystallize(s, m, a, 3);
  const d = habitDirective(s, s.world.present);

  check("nothing tells the narrator it cannot write this", !/CANNOT WRITE IT AND MUST NOT TRY/.test(d), d);
  check("...or that the player's body is the reason to stop", !/REQUIRES THE PLAYER'S BODY/.test(d));
  check("her half is the act", /Her half is not the approach to the act and not a milder version of it/.test(d));
  check("...and being the one it is done to is not the player's move", /being the one it is done to does not turn it into the player's move/.test(d));
  check("...nor deferred to a later scene", /not deferred to a later scene/.test(d));

  check("the player's decision is still theirs", /WHERE IT STOPS IS THE PLAYER DECIDING/.test(d));
  check("...naming what is never written for them", /Never write them agreeing, refusing, allowing it, going along with it, reciprocating/.test(d));
  check("...including a feeling about it", /never hand them a feeling about it/.test(d));
  check("...and the turn ends at the choice", /THE TURN ENDS THERE, with her move complete and standing/.test(d));
  check("...without wandering off to somebody else", /do not move on to another character's business/i.test(d));
}

/* ── 3. one cut, at one length, shared ────────────────────────────────────────── */
{
  const { s, m } = scene();
  const a = newAuthored(GOAL, 1, { stage: 5 });
  s.characters[m].authored = [a];
  const label = crystallize(s, m, a, 3)!;
  check("the label is a readable length", label.length <= LABEL_MAX, `${label.length}`);
  check("...cut on a word", GOAL.startsWith(label) || GOAL.startsWith(label.replace(/…$/, "")), label);
  check("...and is what crystallizedLabel reports", crystallizedLabel(a) === label);
  check("...and what went onto the card", s.characters[m].core_traits.includes(label));
  check("...and into the trait store", s.traits[m].some((t: any) => t.label === label), s.traits[m]);

  // reloading a save used to re-cut every label at a different length, so the two stopped matching
  const reloaded: any = newSave("t2", { name: "Vin" } as any);
  reloaded.traits = { x: [{ label, origin: "", behavioral_impact: "", intensity: 7, self_weight: 0.6, last_reinforced_turn: 3, reinforcement_count: 6 }] };
  const norm = clipWords(label, LABEL_MAX);
  check("a label survives a reload unchanged", norm === label, `${label} -> ${norm}`);

  check("a stage-5 want is not filed as acted on six hundred times",
    s.traits[m].every((t: any) => t.reinforcement_count <= 7), s.traits[m].map((t: any) => t.reinforcement_count));
}

/* ── 4. an ordinary want is untouched ─────────────────────────────────────────── */
{
  const { s, m } = scene();
  const a = newAuthored("Start leaving the porch light on all night, whoever is out.", 1, { stage: 2 });
  s.characters[m].authored = [a];
  const d = habitDirective(s, s.world.present);
  check("a want with nobody's body in it still gets its beat", /porch light/.test(d), d);
  check("a short want keeps its whole self as its label", crystallize(s, m, a, 3) === "leaving the porch light on all night, whoever is out");

  // A LIVE want carries the stop rule at the rung where the act itself is ordered — the rungs below
  // it are approaches, and there is no choice standing in front of the player yet to protect.
  const { s: s2, m: m2 } = scene();
  s2.characters[m2].authored = [newAuthored(GOAL, 1, { stage: 5, inhabit_turns: 3, turns_live: 3, crystallize: false })];
  const live = habitDirective(s2, s2.world.present);
  check("a live want at the top rung orders the act", /IN THE BODY/.test(live), live.slice(0, 200));
  check("...and stops at the player's choice", /WHERE IT STOPS IS THE PLAYER DECIDING/.test(live));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
