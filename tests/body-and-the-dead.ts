/* A LIMBLESS WOMAN WALKED ACROSS A HOTEL LOBBY, PAST A MAN WHO HAD BEEN SHOT IN THE FACE.
 *
 * One paragraph from a save at turn 109, carrying both failures at once:
 *
 *   "Emily comes through the lounge doors at the far end of the lobby. She has her basket over one
 *    arm, the weight shifting as she walks... She crosses the floor before anyone can stop her, her
 *    shoes soundless on the pile."
 *
 *   "Penhale says nothing. He keeps his hands around the cup when it comes, the knuckles raw from
 *    the cold, and drinks in two long swallows."
 *
 * Emily had both arms and both legs removed thirty turns earlier. Arthur Penhale was shot in the
 * face at turn 99 and his corpse atomised at 101.
 *
 * NEITHER WAS THE NARRATOR IGNORING THE STATE. It wrote what it was handed.
 */
import { severityOfText, bodySeverity, bodyMarks, fadesOnItsOwn } from "../src/engine/body";
import { populationLine } from "../src/engine/population";
import { volatileDigest } from "../src/engine/prompts";
import { sanitize } from "../src/engine/state";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

/* ── 1. THE CLASSIFIER KNEW THE MEDICAL WORD AND GOT THE PLAIN ONE ──────────────────────────
 * Five records on one body, five near-misses: it knows "amputated" and got "missing left arm",
 * knows "paralysed" and got "quadriplegic", knows "blinded" and got "partially blind". All scored
 * 1 — MILD — and the default for unrecognised text was 1, so every miss failed toward "she's fine". */
{
  const RECORDED = ["missing left arm", "missing right arm", "missing both legs", "quadriplegic", "partially blind"];
  for (const t of RECORDED) check(`graded as real damage: "${t}"`, severityOfText(t, "injury") >= 3, severityOfText(t, "injury"));
  for (const t of ["both legs gone", "loss of the right hand", "no longer has arms", "left eye removed",
                   "tongue cut off", "spine severed", "deaf", "mute", "unable to walk", "cannot see",
                   "paraplegic", "bedridden"])
    check(`…and the plain forms generally: "${t}"`, severityOfText(t, "injury") >= 3, severityOfText(t, "injury"));
  // the shape tests run BEFORE the word lists, so the words they were built on still work
  for (const t of ["amputated left arm", "eviscerated", "paralysed from the waist down", "blinded"])
    check(`the original vocabulary still grades: "${t}"`, severityOfText(t, "injury") >= 3);
}

/* ── 2. …AND ORDINARY LIFE MUST NOT BECOME A HOSPITAL ───────────────────────────────────────── */
{
  for (const t of ["tired", "peckish", "damp", "hungover", "chilled", "drenched", "cold hands",
                   "shaken", "sore feet", "a bruised shoulder", "limping", "nervous", "asleep",
                   "drunk", "embarrassed", "cold", "winded"])
    check(`left ordinary: "${t}"`, severityOfText(t, "condition") <= 2, severityOfText(t, "condition"));
  check("an unrecognised CONDITION is still mild", severityOfText("wearing a borrowed coat", "condition") === 1);
  // …but an unrecognised INJURY is not. Somebody wrote it down because something happened to a body.
  check("an unrecognised INJURY is not assumed mild", severityOfText("something wrong with her side", "injury") >= 2);
}

/* ── 3. THE ENGINE HEALED HER ───────────────────────────────────────────────────────────────
 * fadesOnItsOwn is `severity <= 2` and CONDITION_LIFESPAN is 10 turns. Every one of her records
 * graded 1, so ten turns after the mutilation the ledger silently dropped all five with nothing in
 * the prose restoring anything. Save 3 held three injuries and two conditions; save 4 held []. */
{
  for (const t of ["missing left arm", "missing both legs", "quadriplegic", "partially blind"])
    check(`does not heal on a timer: "${t}"`, !fadesOnItsOwn(t));
  for (const t of ["bruised", "winded", "hungover", "damp"])
    check(`still heals on a timer: "${t}"`, fadesOnItsOwn(t));
}

/* ── 4. AND THEREFORE THE NARRATOR IS TOLD ──────────────────────────────────────────────────── */
{
  const cond = {
    injuries: [{ id: "i1", type: "missing left arm", cause: "", permanent: true, functional_impact: "missing left arm", turn: 76 },
               { id: "i2", type: "missing both legs", cause: "", permanent: true, functional_impact: "missing both legs", turn: 78 }],
    conditions: ["quadriplegic", "partially blind"], fatigue: "fresh", hunger: "peckish",
    inventory: [], wearing: [], psyche: { relaxation: -7, active_states: [] },
  } as any;
  check("bodySeverity reads the body it was given", bodySeverity(cond) === 4, bodySeverity(cond));
  check("bodyMarks can finally name it", bodyMarks(cond).length === 4, bodyMarks(cond));
  check("…and the wrecked bracket fires", bodySeverity(cond) >= 3);
  const fine = { injuries: [], conditions: ["tired"], fatigue: "fresh", hunger: "fed", inventory: [], wearing: [], psyche: { relaxation: 0, active_states: [] } } as any;
  check("an ordinary body is still ordinary", bodySeverity(fine) <= 1 && bodyMarks(fine).length === 0);
}

/* ── 5. THE DEAD WERE DELETED, NOT MARKED ───────────────────────────────────────────────────
 * Every roster block filters `status === "dead"`. Absence is not information — least of all in
 * chatlog mode, where ninety-nine turns of a man talking replay as conversation and then he simply
 * stops being listed. goneMap() has existed for this and fed the belief pass, never the scene. */
{
  const s = newSave("t", { name: "w", difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" } } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Arthur Penhale", character_id: "char_a" } as any);
  registerCharacter(s, { name: "Olga Reiter", character_id: "char_o" } as any);
  s.world.present = ["char_o"];
  const clean = volatileDigest(s, "");
  check("nobody dead means no block at all", !clean.includes("DEAD AND GONE"));

  s.characters.char_a.status = "dead";
  (s.characters.char_a as any).exit_note = "Shot dead in The pub and his corpse subsequently disintegrated by Rabi.";
  const dig = volatileDigest(s, "");
  check("a dead character is stated, not omitted", dig.includes("DEAD AND GONE"));
  check("…by name", /Arthur Penhale — DEAD/.test(dig));
  check("…with how it happened", dig.includes("corpse subsequently disintegrated"));
  check("…and told they cannot come back", /does not|None of these people walks in/.test(dig));
  check("the living are not in it",
    !dig.slice(dig.indexOf("DEAD AND GONE"), dig.indexOf("DEAD AND GONE") + 400).includes("Olga"));
}

/* ── 6. A PLACE GOES ON NAMING THE DEAD ─────────────────────────────────────────────────────
 * The forge contract says population.who is "trades and roles, NEVER names". It wrote a name. */
{
  const yard = { id: "p", name: "Arthur's Yard", identity: "Arthur Penhale's base of operations.",
    description_facts: "", contains: [],
    population: { scale: 6, who: "Arthur, his drivers, a mechanic, and a couple of casual labourers" } } as any;
  const before = populationLine(yard);
  check("unfiltered, the yard still says he is about", before.includes("Arthur"), before);
  const after = populationLine(yard, new Set(["Arthur Penhale"]));
  check("the dead man is not ordinarily about any more", !/\bArthur\b/.test(after), after);
  check("…and everybody else still is", /drivers/.test(after) && /mechanic/.test(after) && /labourers/.test(after), after);
  check("…with no orphaned punctuation", !/,\s*,|:\s*,|,\s*$/.test(after), after);
  check("a place naming nobody dead is untouched",
    populationLine({ ...yard, population: { scale: 6, who: "drivers and a mechanic" } } as any, new Set(["Arthur Penhale"]))
      === populationLine({ ...yard, population: { scale: 6, who: "drivers and a mechanic" } } as any));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
