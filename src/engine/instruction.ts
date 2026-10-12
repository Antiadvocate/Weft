/**
 * AN INSTRUCTION ABOUT THE STORY, TYPED WHERE THE STORY GOES.
 *
 * Rainier Valley, chapter two, turn 14, typed into the action box:
 *
 *     Rabi's not the point of contact. Ellie is. Change the story to adjust. Remove beacon works
 *     from Rabi and anything having to do with it should no longer appear in the story.
 *
 * That isn't anything Rabi does. It went in as his action, and the turn played as Rabi standing in a
 * towel reading his email while a coworker let herself in.
 *
 * The engine has the tools for what was asked: a correction (a fact that is true from now on) and a
 * nuke (a storyline wiped from everything the models read). The Play view offers those tools before
 * sending anything, with "play it as an action anyway" one tap away, whenever the small model's read
 * of what was typed (actionread.ts) says it asks for the story itself to change. What to wipe and
 * what's now true come from that same read.
 */
import type { ActionRead } from "./actionread";
import { clipText } from "./text";

export interface StoryInstruction {
  /** The words that asked for it. */
  line: string;
  /** What to wipe, when it asked for something to be removed. */
  terms: string;
  /** What it asserted as true alongside, which can go in as a correction. */
  correction: string;
}

/** The instruction in this read, or null when what was typed is play. */
export function instructionFromRead(read: ActionRead | null | undefined, typed: string): StoryInstruction | null {
  if (!read?.story_change?.asked) return null;
  return {
    line: clipText(read.to_the_game || typed, 240),
    terms: read.story_change.remove,
    correction: read.story_change.true_now,
  };
}
