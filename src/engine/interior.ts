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
import type { ActionRead } from "./actionread";
import { collapseSpaces } from "./text";

/** What the player privately reported this turn, and how much of it there is. */
export interface PlayerInterior {
  /** The private text itself. For the BOOKKEEPER and the player's own state. Never the narrator. */
  content: string;
  /** 0..1 — how much is being carried. Coarse on purpose; it gates a three-way verdict. */
  charge: number;
  /** −1 tightened, +1 eased, 0 unreadable. Coarse: enough not to render dread as relief. */
  direction: -1 | 0 | 1;
}

/** Private spans: *asterisks* (a thought) and (parentheses) (the state behind the act). Double
 *  ((parens)) are a search directive, not story text, and are left to their own handler. Found by
 *  walking the characters: each span's inside goes to `take`, and the text comes back with every
 *  span, marks and all, replaced by a space. */
function withoutPrivate(text: string, take?: (inside: string) => void): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "*") {
      const close = text.indexOf("*", i + 1);
      if (close > i + 1) { take?.(text.slice(i + 1, close)); out += " "; i = close + 1; continue; }
    } else if (ch === "(" && text[i - 1] !== "(") {
      // a single pair with nothing nested inside, and not the outer marks of a ((directive))
      let close = i + 1;
      while (close < text.length && text[close] !== "(" && text[close] !== ")") close++;
      if (text[close] === ")" && close > i + 1 && text[close + 1] !== ")") { take?.(text.slice(i + 1, close)); out += " "; i = close + 1; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}

/* HOW MUCH, AND WHICH WAY. These were word lists (hate, angry, dread for tightening; glad, relief,
 * tender for easing; "so", "really", "fucking" for intensity) plus a word count, and the lists kept
 * missing phrasings: a feeling put any way but the listed one read as unreadable. The turn's read
 * (engine/actionread.ts, `inner`) now carries both, judged by a model reading the whole turn. */

/**
 * How much is being carried, 0..1.
 *
 * Deliberately coarse: it decides between "nothing shows", "something flickers" and "something
 * shows", and no finer reading than that is used anywhere.
 */
export function chargeOf(read: ActionRead): number {
  const c = Number(read?.inner?.charge ?? 0);
  return Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
}

/** Which way the body went. Unreadable is a legitimate answer and renders as nothing. */
export function directionOf(read: ActionRead): -1 | 0 | 1 {
  const d = read?.inner?.direction ?? 0;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/**
 * Split the player's input into what the room can witness and what only they carry.
 *
 * Speech stays in the outward half: it was said aloud, everyone heard it, and removing it would
 * break attribution. Only the private channels come out. How much the private half carries, and
 * which way, is the turn's read; without one it carries nothing the narrator is told about.
 */
export function splitInterior(action: string, read?: ActionRead): { outward: string; interior: PlayerInterior | null } {
  const raw = String(action ?? "");
  const held: string[] = [];
  const outward = collapseSpaces(withoutPrivate(raw, (inside) => {
    const t = inside.trim();
    if (t) held.push(t);
  }));
  const charge = read ? chargeOf(read) : 0;
  const direction = read ? directionOf(read) : 0;
  if (!held.length) {
    // UNMARKED INTERIOR. "I look at her feet and something in me changes, i feel the curse "Um...
    // Sure"" — no asterisks, and the feeling is plainly the player's own, not an act anyone could
    // see. Handed over whole, the room answered it ("Ah ha, the curse"). The turn's read already
    // separated what was only felt from what was done, so the narrator gets the read's outward half.
    const plain = plainOutward(read);
    if (plain !== null) return { outward: plain, interior: { content: read!.thought.trim(), charge, direction } };
    return { outward: raw.trim(), interior: null };
  }
  const content = held.join(" ");
  return { outward, interior: { content, charge, direction } };
}

/** What the room could witness, rebuilt from the read, when the read found a thought the player
 *  typed in plain prose. Null when there's no such thought or nothing outward to rebuild from. */
function plainOutward(read?: ActionRead): string | null {
  if (!read?.thought?.trim()) return null;
  const did = (read.did ?? "").trim();
  const said = (read.said ?? []).map((s) => s.trim()).filter(Boolean);
  if (!did && !said.length) return null;
  return collapseSpaces([did, ...said.map((s) => `"${s}"`)].filter(Boolean).join(" "));
}

/** Strip every private span from a piece of the player's own text. Used wherever a PAST turn's
 *  action is replayed to the narrator — LAST TURNS was quietly handing back every thought the
 *  player ever typed, so closing this turn's leak without closing that one closes nothing. With
 *  that turn's read, an unmarked thought goes too. */
export function outwardOnly(action: string, read?: ActionRead): string {
  const raw = String(action ?? "");
  const stripped = collapseSpaces(withoutPrivate(raw));
  if (stripped !== collapseSpaces(raw)) return stripped;
  return plainOutward(read) ?? stripped;
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

  const opaque = ` WHAT SHOWS DOESN'T GIVE IT AWAY. A body that went ${way} looks the same whatever caused it,`
    + ` so don't name the feeling, don't hint at what caused it, and don't write a sign that spells it out`
    + ` (write "his jaw set", not "his jaw set at the thought of what she had done").`
    + ` The people in the room only see this, and they interpret it for themselves, and they're allowed to get it wrong.`;

  if (relaxation >= 2) {
    return `\n[THE PLAYER HAS SOMETHING PRIVATE ON THEIR MIND THIS TURN, and their body is relaxed.`
      + ` It goes into what they do: they do it completely and without holding back${strong ? ", and that completeness is what shows" : ""}.`
      + ` Nothing leaks out, nothing is saved for later, and there's no second layer under the action for anyone to pick up on.`
      + ` You aren't told what it was and you don't need to know, so just write the action cleanly.${opaque}]`;
  }
  if (relaxation <= -3) {
    return `\n[THE PLAYER HAS SOMETHING PRIVATE ON THEIR MIND THIS TURN, and their body is tense, so it can't come out straight.`
      + ` It leaks out: what they do comes with something that doesn't match how it looks on the surface,${strong ? " like a pause held too long, flatness where there should have been warmth, or a hand that does the job and nothing more" : " like something slightly off in the timing or the pressure"}.`
      + ` Write the mismatch, never the cause.${opaque}]`;
  }
  return `\n[The player has something private on their mind this turn, and it barely shows,`
    + ` a flicker at most, gone before anyone could put a name to it. Don't build a moment around it.${opaque}]`;
}

/** The player's current grip, for the bearing. */
export function playerGrip(state: SaveState): number {
  return state.condition?.["char_player"]?.psyche?.relaxation ?? 0;
}
