/* Smoke test: A VOICE CARD THAT SAYS THE SAME THING FOUR TIMES.
 *
 * "Read her voice. It's completely fucked... her whole shtick is she keeps telling me what to do."
 *
 * He is right, and it is not the narrator. An eighteen-year-old was written with six core traits,
 * one of which was "Draws out syllables when giving an order, smiling slightly before the final
 * noun" and another of which was "Charming and non antagonizing". The voice pass took the first one
 * and answered all four of its questions with it:
 *
 *   syntax  "Second person, imperative-heavy. Frames requests as scheduling."
 *   rhythm  "...the last noun of every order stretched slightly longer than the rest."
 *   tic     "adds a smiling qualifier after an order"
 *   agenda  "To get the other person to agree to a specific time and place."
 *
 * Nothing charming reached any field. The narrator reads all four every turn, so every line she had
 * was an instruction, and there was no switch to find because there was no switch — there was a
 * card saying one thing four times.
 *
 * The prompt now says not to. Instruction-following does not move a distribution, which is the
 * argument this whole module is built on, so it is measured in TypeScript as well: a candidate
 * whose fields keep restating one act loses to any candidate in the pool that does not. */
import { monotone, pickFromTail, type VoiceCard } from "../src/engine/voiceforge";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** Her card, verbatim from the save. */
const HERS: VoiceCard = {
  diction: "Salon jargon and body-part flatness mixed together — beds, bulbs, minutes, lotion, sanitizer spray.",
  syntax: "Second person, imperative-heavy. Frames requests as scheduling. Uses 'you're going to' instead of 'will you.'",
  rhythm: "Even, unhurried, salesroom-smooth, with the last noun of every order stretched slightly longer than the rest.",
  tics: ["gives a time window like she's booking an appointment", "adds a smiling qualifier after an order"],
  never_says: ["if you don't mind", "I hate you", "stop"],
  agenda: "To get the other person to agree to a specific time and place, so the leverage has a schedule attached to it.",
  example_lines: ["Hand me the sanitizer spray. No — the other one, the one that stings."],
};

/** The same character, four questions answered four ways. */
const VARIED: VoiceCard = {
  diction: "Salon jargon and body-part flatness — beds, bulbs, minutes, lotion, sanitizer spray.",
  syntax: "Second person, imperative-heavy. Frames requests as scheduling.",
  rhythm: "Starts fast and slows to a stop in the middle, so the other person answers into the gap.",
  tics: ["says his name in the middle of a sentence", "prices a thing nobody asked the price of"],
  never_says: ["if you don't mind"],
  agenda: "To stay the most comfortable person in the room while somebody else is not.",
  example_lines: ["Bed three's bulbs are shot and Trina still books it at twelve minutes."],
};

/* ── 1. the real card is caught ──────────────────────────────────────────────── */
{
  check("HER ACTUAL CARD reads as one idea four times", monotone(HERS), HERS);
  check("...and the same voice answered four ways does not", !monotone(VARIED), VARIED);
}

/* ── 2. it is the collapse being measured, not the bluntness ─────────────────── */
{
  // a commanding voice is allowed — it just may not be the answer to every question
  const commanding: VoiceCard = { ...VARIED, syntax: "Imperative, second person, no hedges. Orders arrive as statements." };
  check("a voice may still be built on giving orders", !monotone(commanding), commanding.syntax);
  // and the general shape: any one word carrying three of the four fields
  const harped: VoiceCard = { ...VARIED, syntax: "Sentences built around silence.", rhythm: "Silence used as punctuation.", agenda: "To make the silence somebody else's problem." };
  check("any single idea carrying three fields is caught, not only orders", monotone(harped), harped);
}

/* ── 3. a thin card is not condemned for being thin ──────────────────────────── */
{
  check("two fields filled in is not enough to judge", !monotone({ ...VARIED, rhythm: "", agenda: "", tics: [] }));
}

/* ── 4. selection prefers the varied one, and never returns nothing ──────────── */
{
  const cands = [{ probability: 0.02, voice: HERS }, { probability: 0.03, voice: VARIED }];
  const picks = new Set(Array.from({ length: 60 }, () => pickFromTail(cands)?.rhythm));
  check("the collapsed candidate is never chosen when a varied one exists",
    picks.size === 1 && [...picks][0] === VARIED.rhythm, [...picks]);

  // fail OPEN: a monotone voice still beats no voice at all
  const allBad = [{ probability: 0.02, voice: HERS }, { probability: 0.04, voice: { ...HERS, diction: "x" } }];
  check("when every candidate collapsed, one is still returned", pickFromTail(allBad) !== null);
  check("and an empty candidate list is still null", pickFromTail([]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
