/**
 * WHAT BEING CLENCHED DOES TO WHAT SOMEBODY SAYS.
 *
 * The psyche layer is the most developed thing in this engine — relaxation, capacity, recovery,
 * consecutive_clenched, grief_drag, four break states, a resting climate, per-state ages. All of it
 * reached the narrator as ONE CLAUSE.
 *
 * Measured: one identical scene rendered at relaxation -8, -4, 0, +4 and +8, diffed against the
 * neutral run. Four lines of a fifty-six-line character block change, and two of those are the mood
 * word repeating itself. The behavioural difference between a cornered woman and an unguarded one
 * is the tail of `seeing:` — "misreads as threat" against "receiving, not assessing".
 *
 * And that clause is about PERCEPTION. It says what she sees. It says nothing about what she then
 * produces, which is the only thing the reader gets. bodyDirective already learned this lesson for
 * the body and says it at length — "no measured cadence, no multi-clause arguments, no rhetorical
 * figures... fragments, a few words at a time" — because a state that does not change the sentences
 * does not exist on the page. The mind had no equivalent.
 *
 * THE PART THAT WAS MISSING ENTIRELY IS THE MISREADING. "Misreads as threat" is a note about her
 * inner life. The renderable version is that she ANSWERS A SENTENCE THAT WAS NOT SAID — and the
 * other person can hear the gap, which is the whole drama of talking to somebody who is frightened.
 * That is a thing prose can do. "She misreads it as a threat" is a thing prose can only assert.
 *
 * Emitted only off-neutral, like bodyDirective below moderate: an ordinary person needs no
 * paragraph, and most people most turns are ordinary.
 */
import type { Condition } from "./types";

/** The misreading each band reaches for, and what it does with the sentence afterwards. */
export function clenchDirective(cond: Condition | undefined, name: string): string {
  if (!cond) return "";
  const r = cond.psyche?.relaxation ?? 0;
  if (r > -3 && r < 3) return "";      // ordinary. No paragraph, and no budget spent on one.

  const spent = cond.psyche?.state === "broken" || cond.psyche?.state === "shattered";

  if (r <= -7) {
    return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, heavily clenched) — this decides the SENTENCES. `
      + `They take the worst available reading of anything that could go two ways, and they answer THAT — out loud, as though it had been said. `
      + `The misreading has to be a reading a reasonable person could get from the actual words; never one the words cannot support, or it reads as madness instead of fear. `
      + `A question lands as an accusation. An offer seems like a trap or an obligation. Kindness lands as setup. Silence lands as judgement being formed. `
      + `They answer before the other person has finished, and they answer short — a few words, often the wrong few. They do not ask what was meant. `
      + `Corrected, they do not take it the first time: they hold the misread for at least one more exchange, because letting it go means having been wrong AND having been frightened. `
      + `Their body keeps something between them and the room — an object, a doorway, a counter — and does not settle. `
      + `Do not have them explain any of this, name their own fear, or apologise for it. The scene is the gap between what the other person said and what got answered.${spent ? ` And the guard is spent — what is said to them now arrives instead of being deflected on the way in, so the next plain thing said lands hard and they have nothing to meet it with.` : ""}`;
  }
  if (r <= -3) {
    return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, clenched) — this decides the SENTENCES. `
      + `They take the second-worst reading of anything ambiguous and answer that, and unlike somebody further gone they CAN be talked off it when the other person is plain and patient — which takes a beat or two, and they do not thank anybody for it. `
      + `They give slightly less than was asked for and answer only the safest part of a question. They check the other person's face before committing to anything. `
      + `They keep their own business back and ask nothing about anybody else's, because a question invites one in return.`;
  }
  if (r <= 6) {
    return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, guard coming down) — this decides the SENTENCES. `
      + `They let a sentence finish before answering, and take the plain reading of it rather than hunting for a second one. `
      + `They ask the small follow-up. They volunteer something nobody asked for — an ordinary thing about their day, their work, somebody they know — and it is not a confession and not a lesson. `
      + `They let a silence sit without filling it.`;
  }
  return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, wide open) — this decides the SENTENCES. `
    + `They answer things they would ordinarily deflect, and they do not notice they have. `
    + `They take what is said at face value, including things they would normally test; if somebody is working them, it works, and nothing in the prose flags it. `
    + `They are unhurried, they let the other person carry the conversation, and what they notice about that person stays in their head — no read delivered out loud, no inventory of what anybody is or wants.`;
}
