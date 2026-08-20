/**
 * THE PLAYER'S INTERIOR — the one channel the engine had rules for and no mechanism behind.
 *
 * A player types:
 *
 *     I hand her the towel *and I hated her for doing that*
 *
 * and the scene answers the hatred. Not because the rules are missing — there are four separate
 * paragraphs across the narrator contract, the inline channel note and the bookkeeper prompt saying
 * asterisks are private and no character may perceive, react to, or act on them. The rules are
 * there. The TEXT is also there, sitting in the narrator's context, and this codebase has learned
 * three times over — the tic guard, maxims.ts, echo.ts — that a rule in the prompt does not hold and
 * that a vivid phrase attached to a prohibition is still a phrase the model has been handed. The
 * narrator has the words. Reacting to them is the easiest thing in the document to do.
 *
 * So the words stop being handed over. What the narrator gets instead is a BEARING: how much of the
 * feeling reaches the body at all, and which way, with no content, no object, and nothing to quote.
 *
 * WHAT DECIDES THE BEARING IS GRIP, which is the same rule desire.ts already runs. A pull in a
 * settled body expresses cleanly — the person flirts, approaches, says it. The same pull in a
 * clenched body cannot come out straight, so it leaks sideways: staring, sharpness, avoidance. Same
 * energy, two roads, decided by openness. That is the engine's own account of how a feeling becomes
 * behavior, and there was never a reason the player should be exempt from it. Now they are not: the
 * player's own relaxation — the number the tightness anchor lets them set and the engine never
 * authors upward — decides whether what they felt comes out whole or comes out crooked.
 *
 * AND WHAT SHOWS DOES NOT DECODE. A tightened body is a tightened body; anger, grief and fear all
 * look like that from outside. The people in the room read it through their own edge (see mind.ts,
 * interpretation-under-affect) and may be wrong, and their being wrong is the scene. This is the
 * whole point of the channel: not that the feeling is hidden, but that others get the DISPLAY and
 * never the thing itself, and must guess.
 *
 * The bookkeeper still receives the interior verbatim — it is authoritative for the player's own
 * relaxation, mood and states, and it is the only honest source for them. Only the narrator, which
 * writes what the room can see, is kept from it.
 */
import type { SaveState } from "./types";

/** What the player privately reported this turn, and how much of it there is. */
export interface PlayerInterior {
  /** The private text itself. For the BOOKKEEPER and the player's own state. Never the narrator. */
  content: string;
  /** 0..1 — how much is being carried. Coarse on purpose; it gates a three-way verdict. */
  charge: number;
  /** −1 tightened, +1 eased, 0 unreadable. Coarse: enough not to render dread as relief. */
  direction: -1 | 0 | 1;
}

/** Private spans: *asterisks* (a thought) and (parentheses) (the state behind the act).
 *  Double ((parens)) are a search directive, not story text, and are left to their own handler. */
const PRIVATE_SPAN = /\*([^*]+)\*|(?<!\()\(([^()]+)\)(?!\))/g;

const TIGHTENS = /\b(hat(?:e|ed|ing)|angr|anger|furious|rage|resent|sick of|disgust|contempt|afraid|scared|terrif|dread|anxious|panic|humiliat|ashamed|shame|grief|grieving|hurt|betray|jealous|envy|tired of|exhausted|numb|dead inside|can'?t stand|wanted to scream|bit(?:e|ing) (?:my|back))\b/i;
const EASES = /\b(happy|glad|relie(?:f|ved)|love[ds]?|loving|tender|grateful|gratitude|safe|warm|calm|settled|at ease|proud|delight|joy|content|fond|melt(?:ed|ing)?|let go|softened)\b/i;
/** Words that mean the feeling is being held hard rather than merely noted. */
const INTENSIFIERS = /\b(so|really|absolutely|completely|utterly|fucking|god|never|always|every time|still|again)\b/i;

/**
 * How much is being carried, 0..1.
 *
 * Deliberately crude — it decides between "nothing shows", "something flickers" and "something
 * shows", and no finer reading than that is used anywhere. Length is the main signal because a
 * player who types six words about how they feel is carrying more than one who types two.
 */
export function chargeOf(text: string): number {
  const t = String(text ?? "").trim();
  if (!t) return 0;
  const words = t.split(/\s+/).filter(Boolean).length;
  let c = Math.min(0.6, words / 14);
  if (TIGHTENS.test(t) || EASES.test(t)) c += 0.25;
  if (INTENSIFIERS.test(t)) c += 0.15;
  if (/[!?]/.test(t)) c += 0.1;
  return Math.max(0, Math.min(1, c));
}

/** Which way the body went. Unreadable is a legitimate answer and renders as nothing. */
export function directionOf(text: string): -1 | 0 | 1 {
  const tight = TIGHTENS.test(text), ease = EASES.test(text);
  if (tight && !ease) return -1;
  if (ease && !tight) return 1;
  return 0;
}

/**
 * Split the player's input into what the room can witness and what only they carry.
 *
 * Speech stays in the outward half: it was said aloud, everyone heard it, and removing it would
 * break attribution. Only the private channels come out.
 */
export function splitInterior(action: string): { outward: string; interior: PlayerInterior | null } {
  const raw = String(action ?? "");
  const held: string[] = [];
  const outward = raw.replace(PRIVATE_SPAN, (_m, star, paren) => {
    const inner = String(star ?? paren ?? "").trim();
    if (inner) held.push(inner);
    return " ";
  }).replace(/\s+/g, " ").trim();
  if (!held.length) return { outward: raw.trim(), interior: null };
  const content = held.join(" ");
  return { outward, interior: { content, charge: chargeOf(content), direction: directionOf(content) } };
}

/** Strip every private span from a piece of the player's own text. Used wherever a PAST turn's
 *  action is replayed to the narrator — LAST TURNS was quietly handing back every thought the
 *  player ever typed, so closing this turn's leak without closing that one closes nothing. */
export function outwardOnly(action: string): string {
  return String(action ?? "").replace(PRIVATE_SPAN, " ").replace(/\s+/g, " ").trim();
}

/**
 * What the narrator is told in place of the words.
 *
 * Three verdicts, chosen by the player's own grip, and none of them carries the content:
 *
 *  · SETTLED and carrying something — it goes into the act. A body with nothing gripping it does
 *    the thing wholly: no hedge, no half-measure, no leak, and nothing showing that the act itself
 *    does not already show.
 *  · CLENCHED and carrying something — it cannot come out straight, so it comes out sideways. The
 *    act arrives with something on it that does not match its surface: a beat too long, an edge, a
 *    hand that does the job and nothing else. Visible and unreadable.
 *  · little or nothing carried — no verdict at all.
 *
 * In every case the last clause is the load-bearing one: what shows does not decode, and the people
 * in the room are reading it through their own eyes.
 */
export function bearingDirective(interior: PlayerInterior | null, relaxation: number): string {
  if (!interior || interior.charge < 0.25) return "";
  const way = interior.direction < 0 ? "tighter" : interior.direction > 0 ? "easier" : "changed";
  const strong = interior.charge >= 0.6;

  const opaque = ` WHAT SHOWS DOES NOT DECODE IT. A body that went ${way} looks the same whatever put it there —`
    + ` do not name the feeling, do not gesture at its cause, and do not write a tell that spells it out`
    + ` ("his jaw set at the thought of what she had done" is the failure; "his jaw set" is the line).`
    + ` The people in the room see only this and read it through their own eyes, and they are allowed to be wrong.`;

  if (relaxation >= 2) {
    return `\n[THE PLAYER IS CARRYING SOMETHING PRIVATE THIS TURN, and their body has nothing gripping it.`
      + ` It goes into the ACT: they do what they did wholly and without hedging${strong ? ", and the wholeness of it is the visible thing" : ""}.`
      + ` Nothing leaks, nothing is held back for later, and there is no second layer under the act for anyone to catch.`
      + ` You are not told what it was and you do not need it — render the act, cleanly.${opaque}]`;
  }
  if (relaxation <= -3) {
    return `\n[THE PLAYER IS CARRYING SOMETHING PRIVATE THIS TURN, and their body is clenched, so it cannot come out straight.`
      + ` It LEAKS: the act arrives with something on it that does not match its surface —${strong ? " a beat held too long, a flatness where warmth belonged, a hand that does the job and nothing more" : " a small wrongness of timing or pressure"}.`
      + ` Write the crookedness, never the cause.${opaque}]`;
  }
  return `\n[The player is carrying something private this turn, and it barely reaches the surface —`
    + ` a flicker at most, gone before anyone could name it. Do not build a beat on it.${opaque}]`;
}

/** The player's current grip, for the bearing. */
export function playerGrip(state: SaveState): number {
  return state.condition?.["char_player"]?.psyche?.relaxation ?? 0;
}
