/**
 * DROP IT.
 *
 * Rainier Valley, chapter two, turns 2 to 9. May asked who the contact on a project was. The player
 * said it wasn't his project, then that it was Ellie's, then that he was exasperated, then "I swear
 * to god I'm leaving this house if you ask me another question related to this". Every one of those
 * turns carried ANSWER THE PLAYER, which tells the room to respond to what the player said, to "stay
 * with it for the whole turn" and that "nobody changes the subject to get away from it". So the
 * player's "stop asking me about this" was, each time, the subject the room had to stay on, and May
 * asked again, more carefully, eight turns running.
 *
 * When what the player says is that they're done with a subject, the turn is for dropping it. The
 * people in the room take being shut down the way they would, and then talk about something else.
 * For the next few turns the narrator is reminded that the subject is closed, until the player
 * raises it again themselves.
 *
 * Whether the player is closing a subject, and later whether they've brought it back up themselves,
 * is the small model's read of what they typed (actionread.ts); the subject is the previous turn's
 * summary.
 */
import type { SaveState } from "./types";
import { turnRead, type ActionRead } from "./actionread";
import { clipText } from "./text";

/** How many turns after the player closes a subject the narrator is reminded it's closed. */
const HOLD = 4;

/** The line the player closed the subject with, or "" when they didn't. */
export function dropItLine(read: ActionRead): string {
  return clipText(read.drop_subject, 200);
}

/** The beat for a turn the player spends closing a subject. Replaces ANSWER THE PLAYER. */
export function dropItBeat(line: string): string {
  return `THE PLAYER IS DONE WITH THIS SUBJECT. They said: "${line}"
This turn the people here drop it, so nobody asks about it again, rephrases the question, explains their side of it once more, or circles back to it before the turn ends. Each of them takes being shut down the way they would: hurt, irritated, relieved, or with a shrug, shown in what they do. Then they talk about something else or get on with what they were doing, and nothing new arrives from outside the scene this turn to fill the gap.`;
}

/** Remember it, so the next few turns know the subject is closed. */
export function recordDropped(state: SaveState, line: string, turn: number): void {
  const prev = [...(state.history ?? [])].reverse().find((h) => (h as any).kind !== "opening" && h.summary)?.summary ?? "";
  (state.world as any).dropped = { turn, said: line, topic: clipText(prev, 220) };
}

/** The reminder, for HOLD turns after, unless the player has brought it back up themselves. */
export function droppedNote(state: SaveState, read: ActionRead = turnRead(state)): string {
  const d = (state.world as any).dropped as { turn: number; said: string; topic: string } | undefined;
  if (!d) return "";
  const turn = state.world.current_turn;
  if (turn - d.turn > HOLD || turn <= d.turn) return "";
  // the player raising it again ends the hold (the read is told the subject, and says so)
  if (read.reopens_subject) { delete (state.world as any).dropped; return ""; }
  return `\nA SUBJECT THE PLAYER CLOSED: on turn ${d.turn} the player said "${d.said}"${d.topic ? `, about what the turn before had been about (${d.topic})` : ""}. Nobody brings it back up, asks about it in other words, or leaves a note or a message about it, unless the player raises it again.`;
}
