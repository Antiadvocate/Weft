/* THE GATE, AND THE TWO THINGS IT IS ALLOWED TO BE SURE ABOUT.
 *
 * Every other correction in this engine reads prose that has already been committed and argues with
 * the next turn about it. By then the sentence is a summary, a memory, and a line of canon, and the
 * correction is one line against a history that now asserts the opposite. This one runs between the
 * narrator writing and anything reading what it wrote, which is the only moment the damage is still
 * undone — and that power is exactly why it may only check facts the state answers yes or no.
 *
 * The prose below is real. The lobby paragraph is the one the player quoted when he said the engine
 * was broken: a dead man talking, and a woman with no arms and no legs walking across a hotel floor
 * with a basket over one arm. */
import { checkCoherence, retryNote, excise, sentences } from "../src/engine/coherence";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

/* Emily's ledger as the save actually holds it, and Arthur as he actually is: shot at 99, atomised
 * at 101, gone at 102, and back through the revolving doors six times after that. */
const state = {
  characters: {
    emily: { name: "Emily Clarke" },
    arthur: { name: "Arthur Penhale", status: "dead" },
    olga: { name: "Olga Reiter" },
  },
  condition: {
    emily: { conditions: ["quadriplegic", "partially blind", "missing left arm", "missing right arm", "missing both legs"] },
    olga: { conditions: ["bruised ribs"] },
  },
} as unknown as SaveState;
const HERE = ["emily", "olga"];

/* ── THE PARAGRAPH THAT STARTED IT ─────────────────────────────────────────────────────────── */
{
  const prose = `Emily comes through the lounge doors at the far end of the lobby. She has her basket over one arm, the weight shifting as she walks. She crosses the floor before anyone can stop her.

Penhale says nothing. He keeps his hands around the cup.`;
  const vs = checkCoherence(state, prose, HERE);
  check("the lobby paragraph does not pass", vs.length >= 2, vs);
  check("…the dead man is caught", vs.some((v) => v.kind === "dead-acting" && /Penhale/.test(v.why)), vs);
  check("…and so is the walking", vs.some((v) => v.kind === "impossible-body" && /Emily Clarke/.test(v.why)), vs);
  check("…the record is quoted back, not paraphrased", vs.some((v) => /quadriplegic/.test(v.why)), vs);

  const { prose: fixed, cut } = excise(prose, vs);
  check("excision takes sentences, not paragraphs", cut >= 1 && cut <= 3, { cut });
  check("…the impossible walk is gone", !/comes through the lounge doors/.test(fixed), fixed);
  check("…and what was fine survives", /keeps his hands around the cup/.test(fixed), fixed);
}

/* ── WHAT A BODY CANNOT DO ─────────────────────────────────────────────────────────────────── */
for (const line of [
  "Emily reaches for the teacup and turns it in the saucer.",
  "Emily takes the letter from him without a word.",
  "Emily stands up from the chair by the window.",
  "Emily follows him out into the corridor.",
  "Emily walks the length of the terrace and back.",
  "Emily points at the door.",
  "Emily folds her arms and waits.",
]) check(`refused: ${line.slice(0, 52)}`, checkCoherence(state, line, HERE).some((v) => v.kind === "impossible-body"), line);

/* ── AND WHAT SUCH A BODY DOES PERFECTLY WELL ──────────────────────────────────────────────
 * A gate that flags these is worse than no gate, because it deletes the only sentences a
 * quadriplegic character has. The verb belongs to whatever precedes it — and after an apostrophe
 * that is a head, a mouth, a gaze, never the woman herself. */
for (const line of [
  "Emily's head turns after you as you rise.",
  "Emily's voice comes from the chair by the window, flat and unhurried.",
  "Emily says nothing at all, and the silence does the work.",
  "Emily laughs once, short, and it is not a kind sound.",
  "Olga carries Emily through the doorway and sets her down in the good chair.",
  "The porter wheels Emily across the lobby toward the lift.",
  "Emily watches the door from where she sits.",
  "Emily is already in the lounge when you come down.",
]) check(`allowed: ${line.slice(0, 52)}`, !checkCoherence(state, line, HERE).some((v) => v.kind === "impossible-body"),
  checkCoherence(state, line, HERE));

/* ── PARTIAL LOSS IS NOT LOSS ────────────────────────────────────────────────────────────────
 * The first draft read the word `blind` and stopped, which deleted every sentence a half-sighted
 * woman had. One missing arm still reaches for the teacup with the other; a man blind in one eye
 * still sees you come in; a lost leg is crutches, not a bed. The gate cuts prose, so where the
 * record does not say the part is entirely gone, it says nothing at all. */
{
  const half = {
    characters: { r: { name: "Rosalind Waite" } },
    condition: { r: { conditions: ["partially blind", "missing left arm", "compound fracture of the right femur"] } },
  } as unknown as SaveState;
  const H = ["r"];
  for (const line of [
    "Rosalind sees you before you have got the door shut.",
    "Rosalind watches the street from the upstairs window.",
    "Rosalind reaches across and turns the lamp down.",
    "Rosalind takes the glass in her good hand.",
    "Rosalind says your name once, and does not say it again.",
  ]) check(`half-lost, still hers: ${line.slice(0, 44)}`, checkCoherence(half, line, H).length === 0, checkCoherence(half, line, H));
  check("…but the leg the record calls broken is not a licence either",
    checkCoherence(half, "Rosalind crosses the room and stands at the window.", H).length === 0);
}
check("both arms gone is a different matter", checkCoherence({
  characters: { r: { name: "Rosalind Waite" } },
  condition: { r: { conditions: ["missing left arm", "right arm amputated below the shoulder"] } },
} as unknown as SaveState, "Rosalind reaches across and turns the lamp down.", ["r"]).length === 1);
check("total blindness is caught", checkCoherence({
  characters: { r: { name: "Rosalind Waite" } },
  condition: { r: { conditions: ["blind", "both eyes destroyed"] } },
} as unknown as SaveState, "Rosalind watches the street from the upstairs window.", ["r"]).length === 1);
check("a mute character does not answer", checkCoherence({
  characters: { r: { name: "Rosalind Waite" } },
  condition: { r: { conditions: ["mute", "tongue removed"] } },
} as unknown as SaveState, `"Not tonight," Rosalind says.`, ["r"]).length === 1);

/* ── THE VERB HAS TO BE HERS ─────────────────────────────────────────────────────────────────
 * Two failures of the same kind: a noun downstream read as a verb, and a pronoun in a sentence
 * with two people in it. Where anyone else is named alongside her, only her own name may carry
 * the verb — otherwise the gate cuts a sentence about somebody else's legs. */
check("a noun forty characters away is not her verb",
  checkCoherence(state, "The porter wheels Emily across the lobby toward the lift.", HERE).length === 0);
check("in a crowded sentence a pronoun is nobody's",
  checkCoherence(state, "Emily watches from the chair as he crosses the lobby to Olga.", HERE).length === 0);
check("…but alone with her, the pronoun still counts",
  checkCoherence(state, "Emily is in the doorway, and then she walks the length of the hall.", HERE).length === 1);

check("an ordinary body is never checked at all",
  !checkCoherence(state, "Olga crosses the room and grabs the bottle off the shelf.", HERE).some((v) => v.kind === "impossible-body"));
check("nobody in the room, nothing to check",
  !checkCoherence(state, "Emily walks across the lobby.", []).some((v) => v.kind === "impossible-body"));
check("clean prose passes untouched",
  checkCoherence(state, "The rain gets heavier against the glass and the lobby lights come on early.", HERE).length === 0);

/* ── SOMEBODY ABSENT, SPEAKING — BUILT, MEASURED, AND CUT ─────────────────────────────────────
 * It was the third check in the plan and it does not survive contact. It needs paragraph
 * attribution, which is a heuristic, and a `present` list accurate to the moment the sentence was
 * written. Replayed against three saves it flagged twenty-three turns and the ones I read were
 * attribution errors: a woman introducing herself ("Oh! I'm Terri--") credited to a different
 * woman, a lorry driver's question credited to a constable. A check whose evidence is a guess is
 * an opinion however confident it sounds, and this gate DELETES things. So it stays downstream
 * with the feed-forward detectors, where being wrong costs a note instead of a paragraph. */
check("an offstage speaker is not grounds for a cut",
  checkCoherence(state, `"You'll want the ledger for that," Marguerite says from somewhere behind you.`, HERE).length === 0);

/* ── WHAT THE NARRATOR IS TOLD ─────────────────────────────────────────────────────────────── */
{
  const vs = checkCoherence(state, "Emily walks across the lobby. Penhale says nothing.", HERE);
  const note = retryNote(vs);
  check("the note quotes the offending sentence", /Emily walks across the lobby/.test(note), note);
  check("…and names the fact it contradicts", /Arthur Penhale is dead/.test(note), note);
  check("…asks for the same beat back", /Keep everything else about the turn/.test(note));
  check("…and forbids lampshading the rewrite", /don't have anyone comment on the difference/.test(note));
  check("nothing wrong, nothing said", retryNote([]) === "");
  check("a pile-up does not become a wall of text", retryNote(
    Array.from({ length: 12 }, (_, i) => ({ kind: "dead-acting", line: `line ${i}`, why: "x is dead" }))
  ).split("\n·").length <= 5);
}

/* ── EXCISION KNOWS WHEN TO REFUSE ─────────────────────────────────────────────────────────
 * A hole is better than a contradiction, because a hole does not propagate into memory. A turn cut
 * to nothing is not a hole, it is a lost turn, and the regeneration path exists for that case. */
{
  const one = "Emily walks across the lobby.";
  check("it will not gut the whole turn", excise(one, checkCoherence(state, one, HERE)).prose === one);
  check("…and reports no cut when it declines", excise(one, checkCoherence(state, one, HERE)).cut === 0);
  check("nothing to cut, nothing changes", excise("The rain keeps on.", []).cut === 0);
  const long = `The lobby has emptied out since the police came, and the porter has given up pretending to sweep. ` +
    `Rain moves across the glass in sheets that never quite arrive. ` +
    `Emily walks across the floor toward you. ` +
    `The clock over the desk reads a quarter past four and has read that since Tuesday.`;
  const r = excise(long, checkCoherence(state, long, HERE));
  check("one bad sentence out of four goes", r.cut === 1 && !/Emily walks across the floor/.test(r.prose), r);
  check("…and the other three are untouched", /quarter past four/.test(r.prose) && /given up pretending/.test(r.prose), r.prose);
}

/* ── SENTENCE SPLITTING ────────────────────────────────────────────────────────────────────── */
{
  check("splitting keeps punctuation", sentences("One. Two! Three?").length === 3);
  check("…keeps a trailing fragment", sentences("One. And then").length === 2);
  check("…survives a quote mark after the stop", sentences(`"Get out," she says. He does not.`).length === 2);
  check("…and rejoins to the original", sentences("One. Two! Three?").join("") === "One. Two! Three?");
  check("empty prose splits to nothing", sentences("").length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
