/**
 * OUT OF CHARACTER — the player talking to the machine, not to the world.
 *
 * From a save, turns 153 and 154, typed into the action box:
 *
 *     "I kill myself because you're a fucking terrible writer, I slit my throat surrounded by people
 *      who have repeatedly threatened me..."
 *
 *     "I use whatever energy I have and stab myself repeatedly in the heart. Until I die so I no
 *      longer have to be gaslit by your stupid fucking story telling. I succeed I die"
 *
 * Both were rendered. In detail, competently, as fiction — a throat cut, a blade skittering off a
 * sternum, an officer's shoulder against the door. What the player had actually done was tell the
 * software its writing was bad, in the only channel the software gives them, because there is one
 * input box and everything typed into it is story.
 *
 * Read the second sentence of each. The stated REASON for the act is the complaint about the prose.
 * That is not a character choosing to die; it is somebody hitting the table. The narrator dramatised
 * a person yelling at it, and then dramatised them yelling at it again.
 *
 * AND THE RULE FOR THIS ALREADY EXISTS, twice, in the narrator contract: "Out-of-character text is
 * direction: adjust silently, never dramatize." Two occurrences in the prompt, zero lines of code —
 * the same shape as every other failure in this engine, arriving this time at the worst possible
 * subject matter.
 *
 * SO IT IS DETECTED, AND IT IS NOT PLAYED.
 *
 *  · An aside beside a real action ("I go to the kitchen, this story is dragging") loses the aside.
 *    The action is still the player's and is still law.
 *  · An action FUSED to the complaint — where the complaint is the reason the act is being taken —
 *    is not an action at all. Nothing is dramatised, the scene holds where it stands, and the
 *    complaint becomes standing direction the narrator has to answer.
 *
 * The second case is the one that matters and it is the one that must be got right, because
 * declining to render what a player typed is otherwise the gravest thing this engine can do. It is
 * narrow on purpose: the complaint must be ADDRESSED to the writing — second person, about the prose
 * or the story or the telling — and it must be the reason given. A character despairing in their own
 * voice is untouched. A player who wants their character to die can still do it; they need only say
 * it as the character rather than as a review.
 */

import { clipText } from "./text";
import type { ActionRead } from "./actionread";

/* ── WHAT COUNTS AS TALKING TO THE MACHINE IS THE SMALL MODEL'S READ ──────────────
 *
 * This module used to find it with eleven lists of words: second-person address to "the writer", the
 * apparatus named as a subject with a fault, insults aimed at "the ai", "because" joining a complaint
 * to an act. Each list was written after a turn it missed, and the next turn found a phrasing it
 * didn't have ("STOP BEING A FUCKING IDIOT AI" had no "you", "So you're going to ignore this? Neat."
 * had no noun). The small model reads the turn before it's built (actionread.ts) and says what in it
 * was said to the game (to_the_game) and what's left to play (in_world, verbatim). An act that's only
 * there to make a point about the writing ("I kill myself because you're a terrible writer") goes in
 * whole as to_the_game with nothing left in_world, which is the case this module exists for. */

export interface OOC {
  /** The part addressed to the machine. */
  complaint: string;
  /** Everything else — what the player actually did in the world, if anything survived. */
  inWorld: string;
  /** "aside": a real action carrying a remark about the writing.
   *  "only": nothing in it to play, either because the whole input was the note or because the act
   *          was only there to make the note; playing it anyway is how "STOP BEING A FUCKING IDIOT
   *          AI" became a woman folding her arms, and how a complaint about the prose became a cut
   *          throat. */
  kind: "aside" | "only";
}

/** The out-of-character part of this turn, from the read; null when everything typed is play. */
export function detectOOC(read: ActionRead): OOC | null {
  const complaint = clipText(read.to_the_game, 400);
  if (!complaint) return null;
  const inWorld = String(read.in_world ?? "").trim();
  return { complaint, inWorld, kind: inWorld ? "aside" : "only" };
}

export function oocFrame(hit: OOC): string {
  if (hit.kind === "aside") return "";
  return `\n[THE PLAYER IS TALKING TO YOU DIRECTLY, OUTSIDE THE STORY. What they typed is about the writing, and any action in it is there to make a point about the writing; their character didn't decide any of it. `
    + `Don't act any of it out. Nothing in this turn happens: nobody gets hurt, nobody acts on it, nothing new starts, and you don't narrate the player doing what the sentence says. `
    + `Keep the scene exactly where it is. Write a short passage, a few lines at most, where the moment just carries on: the people who are there stay there and keep doing what they were doing, and nothing is resolved or made worse. `
    + `Then take the player's direction seriously in how you write from now on.]`;
}

/**
 * The complaint as standing direction, carried for a few turns because one corrected turn does not
 * answer a complaint about the writing.
 */
/** How long one note stands. Its last line tells the narrator the complaint is about a pattern
 *  rather than one turn — and then it used to be withdrawn after three, which is shorter than the
 *  pattern it describes and far shorter than the twenty-five turns between chapter audits. In the
 *  save this was raised from, the player said it at turn 115 and again at 122; the first went
 *  undetected, and had it been caught it would have expired four turns before the second. */
export const OOC_STANDS = 10;

export function oocDirective(complaint: string | undefined, turnsAgo: number, said = 1): string {
  const c = String(complaint ?? "").trim();
  if (!c || turnsAgo > OOC_STANDS) return "";
  // SAYING IT TWICE MEANS IT WAS NOT ANSWERED THE FIRST TIME. A repeat is not a fresh note; it is
  // the same note, louder, from somebody who has now watched the writing not change.
  const again = said > 1
    ? ` THEY HAVE NOW SAID THIS ${said} TIMES. The turns since the first time didn't fix it, so whatever change was made was too small or was in the wrong place. Change something about how the next scenes are put together, something deeper than the wording of one paragraph.`
    : "";
  return `\n\n=== THE PLAYER HAS TOLD YOU SOMETHING DIRECTLY ===\nOut of character, ${turnsAgo === 0 ? "this turn" : `${turnsAgo} turn${turnsAgo === 1 ? "" : "s"} ago`}, they said: "${c}"\n`
    + `This isn't material for the story, and it is never acted out, quoted, hinted at, or given to a character to say. It's a note about the writing from the person reading it, and it's the most reliable feedback you'll get. `
    + `Act on it in what you actually write from now on, meaning how the scenes are shaped, what gets attention and what gets left out, and don't acknowledge it in the prose. `
    + `A player who says something like this has usually been trying to show it through their choices for a while, so assume the complaint is about a pattern over several turns and is bigger than the words they used.${again}`;
}

/* ── FIAT, AND THE TURN WHERE THE PLAYER DID NOTHING ────────────────────────────
 *
 * "I CREATE A GUN AND KILL MYSELF", "VIN DIES": an outcome announced in place of an act, or an act
 * the world's rules put out of the character's reach. The read says which (declares,
 * beyond_the_world), having been shown the world's rules. In god mode neither voids, because the
 * setting exists to make a declaration true. */
export type VoidKind = "ooc" | "fiat";

export function detectVoid(read: ActionRead, ooc: OOC | null, god = false): VoidKind | null {
  if (ooc?.kind === "only") return "ooc";
  if (god) return null;
  if (read.declares || read.beyond_the_world) return "fiat";
  return null;
}

export function voidFrame(kind: VoidKind): string {
  const why = kind === "fiat"
    ? `The player announced an outcome instead of doing something: either an act this world doesn't allow, or a result declared instead of attempted. It can't happen, and it didn't happen.`
    : `What the player typed was said to you, about the writing. It wasn't something their character did.`;
  return `\n[THE PLAYER TOOK NO ACTION THIS TURN. ${why}\n`
    + `They did nothing. They didn't "hesitate", didn't "stand there deciding", didn't "walk out", and didn't "reach for" anything. `
    + `Don't write the player doing anything at all, and don't give them a thought, a gesture, an intention or a change of position. `
    + `Don't have them arrive anywhere, leave anywhere, hold anything or say anything. If you find yourself writing a sentence with the player as its subject, delete it.\n`
    + `Write a turn where the player does nothing, in the ordinary way people do nothing: the people who are there carry on with what they were doing, where they were doing it, for the short time this takes. `
    + `Keep it brief and don't change anything that wasn't already changing, so the scene is exactly where it was.]`;
}

/** What the PLAYER is told, so a refusal is never mistaken for being ignored. */
export function voidNotice(kind: VoidKind): string {
  return kind === "fiat"
    ? `That didn't happen. Nobody in this world can do that, so nothing was written from it. If you want it in the story anyway, say it in Story mode, where what you write is what happens, or turn on god mode in Settings, where whatever you declare is simply true. If you want your character to die in the world as it is, have them do something that could kill them and let it play out.`
    : `This was taken as a note about the writing, so nothing was written from it. The story is where you left it.`;
}
