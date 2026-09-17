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

THAT HAPPENED. It is now a fact of this world in the same way the door and the heat are facts, and this turn's prose renders it occurring, in full, on the page. You are not being asked whether it fits, whether the characters would, or whether now is the moment. The player has decided all three of those already, which is what choosing this channel means.

THREE WAYS OF NOT WRITING IT, and none of them is available this turn:
- Nothing arrives to interrupt it. No phone, no knock, no footstep in the hall, no third person in the doorway, no noise from another flat. If the player wrote an interruption, that is the only interruption there is.
- Nobody almost does it, because an act rendered as an approach to itself is the act declining to happen. Strike "almost", "nearly", "started to", "was about to", "for a moment", "seemed to" and every other word that renders the act as an approach to itself. It is done, finished, past tense by the end of the paragraph.
- Nothing milder happens instead, however well it fits the room. A smaller adjacent act in the same room with the same people is not this act. If the player wrote a specific thing, that specific thing is what is on the page.

WHERE THE WORLD'S LOGIC STILL RULES: what it cost. Who saw it, what it broke, who knows now, what somebody does about it, what it makes impossible tomorrow. Consequence is yours, and it should be unsparing, because a world that absorbs anything without charge is not a world. What the logic has no vote on is whether the thing occurred.

IF IT CONTRADICTS THE RECORD, the record is what changes. Somebody the state placed elsewhere is now here; a thing the cast believed is now wrong; a bond the numbers called warm is now whatever this makes it. Write the world as the player's sentence leaves it.`;
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
    ? "you wrote it as an approach to itself — almost, started to, moved to — which is the act not happening, described warmly"
    : miss.how === "interrupted"
      ? "something arrived and stopped it, and the player wrote no interruption"
      : "it is not on the page in any form";
  return `\nSTOP. LAST TURN THE PLAYER WROTE THE WORLD AND THE WORLD DID NOT DO IT. They declared: "${miss.declaration}" — and ${how}.
That channel is not a suggestion and the player is not asking. THIS TURN opens with that event having happened: render it complete, in the same room, with the same people, in plain past tense, before anything else occurs. Nothing arrives to prevent it, nobody nearly does it, and nothing smaller stands in for it. Then write what it cost — who saw, what broke, who knows, what somebody does about it — which is where your judgement belongs and where it is wanted.`;
}
