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
    return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, very tense and guarded). This decides how their sentences come out. `
      + `They take the worst possible reading of anything that could go two ways, and they answer that reading out loud, as though it had actually been said. `
      + `The misreading has to be one a reasonable person could get from the actual words. It can never be one the words can't support, or it comes across as madness instead of fear. `
      + `A question sounds like an accusation to them, an offer sounds like a trap or an obligation, kindness sounds like a setup, and silence sounds like someone making up their mind about them. `
      + `They answer before the other person has finished, and they answer briefly, in a few words that are often the wrong ones. They don't ask what was meant. `
      + `When they're corrected, they don't accept it the first time. They hold on to the misreading for at least one more exchange, because letting go of it means admitting they were wrong and that they were frightened. `
      + `Their body keeps something between them and the room, like an object, a doorway or a counter, and they don't settle. `
      + `Don't have them explain any of this, name their own fear, or apologise for it. The scene is the gap between what the other person said and what got answered.${spent ? ` Their guard is worn out as well, so what's said to them now gets through instead of being turned away, and the next plain thing someone says will hit hard with nothing to stop it.` : ""}`;
  }
  if (r <= -3) {
    return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, tense and guarded). This decides how their sentences come out. `
      + `They take the second-worst reading of anything unclear and answer that. Unlike someone more on edge, though, they can be talked out of it if the other person is plain and patient. That takes a moment or two, and they don't thank anyone for it. `
      + `They give a little less than they were asked for and answer only the safest part of a question. They check the other person's face before committing to anything. `
      + `They keep their own business to themselves and don't ask about anybody else's, because asking a question invites one back.`;
  }
  if (r <= 6) {
    return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, starting to relax). This decides how their sentences come out. `
      + `They let a sentence finish before they answer, and they take the plain meaning of it instead of looking for a hidden one. `
      + `They ask a small follow-up question. They mention something nobody asked about, like an ordinary thing about their day, their work or somebody they know, and it isn't a confession or a lesson. `
      + `They let a silence stay without rushing to fill it.`;
  }
  return `\nHOW ${name.toUpperCase()} IS TAKING THINGS (openness ${Math.round(r)}, completely at ease). This decides how their sentences come out. `
    + `They answer things they'd usually dodge, and they don't notice that they've done it. `
    + `They take what's said at face value, including things they'd normally test. If somebody is manipulating them, it works, and nothing in the prose points it out. `
    + `They're unhurried, they let the other person lead the conversation, and whatever they notice about that person stays in their head, so there's no reading of the other person spoken out loud and no list of what anybody is or wants.`;
}
