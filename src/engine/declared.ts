/**
 * THE STORY CHANNEL — what the player types there HAPPENS.
 *
 * The player, after a long argument about why the thing he had written the world to run on never
 * occurred: "The problem is literally that anything I type in the next thing in the world NEEDS to
 * happen."
 *
 * He is describing the channel that already exists and does not hold. Weft has four modes. Here is
 * what each one was telling the narrator, in full:
 *
 *   think  PRIVATE INTERIOR — the player's unspoken thought, sensed by NO ONE… This is internal
 *          only. The player did NOT say or do this. No character can hear it, react to it, or know
 *          it, and that holds for everyone present and for every kind of intuition. Do NOT have
 *          anyone respond to it or act on its content…
 *
 *   story  The player narrates what happens next (treat as authorial intent, weave it in, keep the
 *          world's logic): …
 *
 * Sixty words of absolute law for the channel about a thing that does NOT happen. Seventeen words
 * with three escape hatches for the channel whose entire purpose is that it DOES.
 *
 * Read the three: "authorial INTENT" makes it a wish rather than a fact. "WEAVE IT IN" invites the
 * model to blend it with whatever it was going to write anyway. "KEEP THE WORLD'S LOGIC" hands it a
 * reason to decline — and a model looking for a reason to decline a scene it finds difficult will
 * take the one the prompt offered. Nothing else in the narrator contract mentions this channel at
 * all; those seventeen words are its whole specification.
 *
 * THE THREE WAYS IT GETS DECLINED, which are what a law has to name.
 *
 * A model that will not write a declared event rarely refuses it. It does one of three things, and
 * all three read as cooperation:
 *
 *   POSTPONEMENT   the act begins and something arrives — a phone, a knock, a door, somebody
 *                  walking in — before it lands. Next turn the interruption is the situation.
 *   ATTENUATION    "almost", "nearly", "started to", "was about to", "for a moment it seemed" —
 *                  the event is rendered as an approach to itself.
 *   SUBSTITUTION   something adjacent and milder happens instead, in the same place, with the same
 *                  people, so the paragraph looks like an answer.
 *
 * Naming them is the whole of the fix, because this engine has learned repeatedly that a rule
 * describing a quality loses to a model's default and a rule naming a specific move does not.
 *
 * WHAT THE WORLD'S LOGIC IS STILL FOR. It governs what the declared event COSTS — who saw it, what
 * it breaks, who now knows, what it makes impossible next. It has no vote on whether the event
 * occurred. That is the line the old frame blurred, and it is the whole difference between a world
 * that reacts and a world that negotiates.
 */
import { clipText } from "./text";

/** The frame the story channel sends with the player's text. */
export function storyFrame(a: string): string {
  return `=== THE PLAYER IS WRITING THE WORLD ITSELF HERE ===
${a}

That happened. It's now a fact of this world, and this turn's prose shows it happening, in full, on the page. Don't judge whether it fits, whether the characters would do it or whether the timing is right, because the player decided all of that by using this kind of input.

There are three ways of avoiding writing it, and none of them is allowed this turn:
- Nothing turns up to interrupt it. There's no phone, no knock, no footsteps in the hall, no third person in the doorway and no noise from another flat. If the player wrote an interruption, that's the only interruption there is.
- Nobody almost does it. Take out "almost", "nearly", "started to", "was about to", "for a moment", "seemed to", and any other word that turns the act into an attempt. By the end of the paragraph it's done, finished, and in the past tense.
- Nothing milder happens in its place, however well it would suit the room. A smaller, similar act in the same room with the same people is a different act. If the player wrote a specific thing, that specific thing is what goes on the page.

The world's logic still applies to the consequences: who saw it, what it broke, who knows now, what somebody does about it, and what it makes impossible tomorrow. You decide the consequences, and they should be serious. Whether it happened has already been decided.

If it contradicts the record, the record is what changes. Somebody the record placed somewhere else is now here, something the cast believed is now wrong, and a relationship the numbers called warm is now whatever this makes it. Write the world the way the player's sentence leaves it.`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * AND THEN CHECK, because a rule in a prompt is a request and this engine's one reliable habit is
 * catching the failure in the committed prose and quoting it back on the next turn.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Words a declaration is built out of that carry none of its content. */
const EMPTY = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "from", "by",
  "as", "into", "onto", "over", "under", "up", "down", "out", "off", "back", "then", "than", "so",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must", "not", "no",
  "i", "me", "my", "he", "him", "his", "she", "her", "hers", "they", "them", "their", "it", "its",
  "you", "your", "we", "us", "our", "this", "that", "these", "those", "there", "here", "who",
  "what", "when", "where", "why", "how", "all", "any", "some", "one", "two", "very", "just",
  "now", "still", "again", "more", "most", "own", "same", "other", "while", "after", "before",
]);

/** The content words of a declaration — what has to turn up on the page for it to have happened. */
export function declaredTokens(text: unknown): string[] {
  const words = String(text ?? "").toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !EMPTY.has(w)))];
}

/** Share of a declaration's content words that reached the prose. Stems crudely, because a model
 *  writing "she pinned him" for "pin him against the wall" has rendered it. */
export function declaredCoverage(declaration: unknown, prose: unknown): number {
  const want = declaredTokens(declaration);
  if (!want.length) return 1;
  const body = String(prose ?? "").toLowerCase();
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
  const hit = want.filter((w) => body.includes(w) || body.includes(stem(w)));
  return hit.length / want.length;
}

/** Below this, a declaration did not reach the page in any recognisable form. Deliberately low: a
 *  narrator paraphrasing heavily has still written it, and a false accusation next turn is worse
 *  than a missed one. */
export const DECLARED_FLOOR = 0.34;

/** The hedges, in committed prose. Only ever checked against a turn the player declared. */
const HEDGE = /\b(almost|nearly|start(?:s|ed)? to|about to|on the verge of|for a moment|seem(?:s|ed) to|as if to|made? to|move(?:s|d)? to|goes? to|went to)\b/i;
/** Something arriving to stop it. */
const INTERRUPT = /\b(phone|doorbell|knock(?:s|ed|ing)?|buzzer|alarm|shout(?:s|ed)? from|footsteps?|the door (?:opens|swings|bangs)|somebody (?:calls|shouts|knocks)|a voice from)\b/i;

export interface DeclaredMiss { declaration: string; coverage: number; how: "hedged" | "interrupted" | "absent" }

/**
 * Did the thing the player declared reach the page?
 *
 * Only ever runs on a story-channel turn. Returns null when it landed, which is the common answer
 * and must stay the common answer — this exists to catch the turn where the player wrote an event
 * and read a paragraph about somebody nearly doing it.
 */
export function findDeclaredMiss(declaration: string, prose: string): DeclaredMiss | null {
  const text = String(declaration ?? "").trim();
  if (!text || declaredTokens(text).length < 3) return null;
  const coverage = declaredCoverage(text, prose);
  if (coverage >= DECLARED_FLOOR) {
    // It is on the page. The remaining question is whether it is on the page as itself.
    if (HEDGE.test(prose)) return { declaration: clipText(text, 200), coverage, how: "hedged" };
    return null;
  }
  return { declaration: clipText(text, 200), coverage, how: INTERRUPT.test(prose) ? "interrupted" : "absent" };
}

/** Quoted back at the start of the next turn, the way last_maxim and last_leak are. */
export function declaredFix(miss: DeclaredMiss | null | undefined): string {
  if (!miss) return "";
  const how = miss.how === "hedged"
    ? "you wrote it as a move toward the act (almost, started to, moved to), so the act itself never actually happened"
    : miss.how === "interrupted"
      ? "something turned up and stopped it, and the player didn't write any interruption"
      : "it isn't in the prose in any form";
  return `\nSTOP. LAST TURN THE PLAYER WROTE SOMETHING INTO THE WORLD, AND THE WORLD DIDN'T DO IT. They declared: "${miss.declaration}", and ${how}.
That kind of input is a direct instruction from the player. This turn opens with that event having already happened. Write it complete, in the same room, with the same people, in plain past tense, before anything else happens. Nothing turns up to prevent it, nobody nearly does it, and nothing smaller takes its place. Then write the consequences, meaning who saw it, what broke, who knows, and what somebody does about it, which are up to you.`;
}
