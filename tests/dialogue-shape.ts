/* Smoke test: WHY EVERYBODY TALKS LIKE THAT.
 *
 * The complaint was "thirty pages of describing what is happening, two lines of actual dialogue."
 * The dialogue SHARE turned out to be ordinary — 14% on the save in question, against 4–31% across
 * every save on file since the first, with no trend. What is not ordinary is the SHAPE:
 *
 *     88% of spoken lines arrived wrapped in physical description.
 *
 *     Clara let out a short, sharp laugh that didn't reach her eyes. She set the empty glass down
 *     with a precise clink, aligning it with the edge of the marble.
 *       "Ikea is efficient," she said, her voice flat.
 *     She turned away, walking toward the window. The greyhound lifted its head. Clara didn't look
 *     back. Her shoulders were rigid beneath the wool cardigan.
 *       "You're deflecting," she said to the window pane.
 *
 * Gesture, line, gesture, line. And that rhythm is not the model being florid — it is this contract
 * followed exactly. Interiority is forbidden, captioning a gesture is forbidden, role comparisons are
 * forbidden, similes are restricted to physical form. Every channel for conveying a person has been
 * closed except an observable action, so every line gets one bolted to it.
 *
 * The second consequence is worse and took longer to see. The interpretation the narrator may not
 * write does not evaporate — it relocates into a character's mouth. "I'm not asking for your trauma,
 * I'm asking why you look like you're waiting for a bomb to go off" is the banned observation,
 * spoken. A cast who all read each other perfectly and say so is worse than a narrator who states
 * it, because now everyone sounds like a therapist. */
import { narratorSystem } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

for (const lean of [false, true]) {
  const t = narratorSystem(lean);
  const tag = lean ? "lean" : "full";

  check(`${tag}: dialogue is permitted to stand without a beat`, /A LINE DOES NOT NEED A BEAT/.test(t));
  check(`${tag}: and consecutive exchanges are named as the thing to do`,
    /(several exchanges|two, three, four exchanges)/.test(t));
  check(`${tag}: a beat is defined as something happening, not punctuation`, /not as punctuation/.test(t));

  check(`${tag}: the interpretation may not be relocated into dialogue`, /WHAT ONE PERSON KNOWS STOPS AT THEIR OWN SKIN/.test(t));
  check(`${tag}: a character may still guess`, /guess/.test(t));
  check(`${tag}: and the guess is allowed to be wrong`, /wrong/.test(t));
  check(`${tag}: nobody delivers an accurate readout of another's interior`,
    /accurate account of another person's inside/.test(t));

  // the rules this is correcting must still be there — the fix is a release valve, not a repeal
  check(`${tag}: interiority is still forbidden`, /SURFACE ONLY/.test(t) || /never narrated/.test(t));
  check(`${tag}: the want is still not announced`, /NOBODY LEADS WITH IT/.test(t));
}

/* the two rules have to point in compatible directions, or the model splits the difference badly */
{
  const t = narratorSystem(false);
  const beatAt = t.indexOf("A LINE DOES NOT NEED A BEAT");
  const mouthAt = t.indexOf("WHAT ONE PERSON KNOWS STOPS AT THEIR OWN SKIN");
  // the SURFACE ONLY block lives in the per-turn directive (povFilter), not in this contract —
  // which is part of why the interaction was hard to see: the rule that closes the channels and the
  // rule that relieves the pressure were never in the same document.
  check("the contract does not also demand a gesture on every line",
    !/(every|each) line (must|should) (be|carry|have) (a )?(gesture|beat)/i.test(t));
  check("and the two new rules sit together", Math.abs(mouthAt - beatAt) < 2000, { beatAt, mouthAt });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
