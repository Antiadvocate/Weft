/**
 * THE PLAYER SAID THEY WERE GOING, SO THEY GO.
 *
 * Rainier Valley, turns 51 to 55. The player typed, in order: "I get up and start heading home",
 * "I take the laptop and go home to work from home", "Continue", and "I take the elevator". At the
 * end of it he was standing in the lobby of the office he had been leaving for four turns, his
 * coworker was somehow there with him, and the narration had given him two lines he never typed
 * ("Just—going home," you say) on the way.
 *
 * The narrator wasn't being stubborn on its own. Each of those turns had the player's action in the
 * slot that decides what a turn is for, under ANSWER THE PLAYER, and that beat tells the room to
 * respond to what he did and to "go on talking to the player about it" for the whole turn. Applied
 * to "I'm going home", that is an instruction to keep him there. The one turn that didn't get it
 * (turn 52) got the story's palette pressure instead, delivered "in the room the characters are
 * actually standing in" — the room he was leaving. And the narrator contract lets anyone "plead,
 * block their way or start pulling them" with the turn stopping at the grab, which on a departure is
 * a loop: every turn stops at the grab.
 *
 * So a departure gets its own beat. When the player's own action (not their dialogue, not their
 * thoughts) says they are going home or to a named place, the turn is for getting them there: they
 * leave, the trip is a line or two, and the turn ends at the destination. The people left behind
 * react as they go and don't hold them. A trip stated on one of the last two turns and not yet
 * completed carries over to "Continue", "I take the elevator", or "I get in the car", so the
 * player never has to say it a third time.
 *
 * Zero tokens: regexes over the action and the place names already in the save.
 */
import type { SaveState } from "./types";
import { OFFSCENE } from "./places";
import { turnRead, type ActionRead } from "./actionread";
import { clipText } from "./text";

export interface Trip {
  /** The place id when the destination is a place the game tracks. */
  toId?: string;
  /** What to call the destination: the tracked place's name, or the player's own words for it. */
  toName: string;
  /** The words in the action that said so. */
  said: string;
  /** Stated on an earlier turn and carried into this one. */
  carried?: number;
}

/**
 * The player's home, as the story knows it: their schedule's home, or the place they last went home
 * to (the small model names it when they say they're going home; see actionread.ts). Nothing here
 * guesses at a home from what places are called.
 */
export function playerHome(state: SaveState): { id?: string; name: string } {
  const places = state.world?.places ?? {};
  const known = (id: unknown) => typeof id === "string" && id !== OFFSCENE && places[id]?.name ? id : undefined;
  const sched = state.characters?.char_player?.schedule?.home;
  const byName = sched ? Object.entries(places).find(([, p]) => (p?.name ?? "").toLowerCase() === String(sched).toLowerCase())?.[0] : undefined;
  const id = known(sched) ?? known(byName) ?? known((state.world as any)?.player_home);
  return id ? { id, name: places[id].name } : { name: "home" };
}

/**
 * Whether this turn takes the player somewhere, from the small model's read of what they typed: where
 * to, as a place id when it's one the story knows, and whether it's a trip set off on in the last two
 * turns and still unfinished (the read is told about it and says whether the player carries on).
 */
export function playerTrip(state: SaveState, read: ActionRead = turnRead(state)): Trip | null {
  const l = read.leaving;
  if (!l?.going) return null;
  let toId = l.place && state.world?.places?.[l.place] && l.place !== OFFSCENE ? l.place : undefined;
  if (!toId && l.home) toId = playerHome(state).id;
  if (toId && toId === state.world.player_location) return null;   // already there
  // the read named home: remember which place that is
  if (l.home && toId) (state.world as any).player_home = toId;
  const toName = toId ? state.world.places[toId].name : l.home ? "home" : l.to;
  const said = clipText(read.did || l.to || "leaves", 160);
  const before = toId ? (state.history ?? []).slice(-2).reverse().find((h) => h.read?.leaving?.going && h.read.leaving.place === toId) : undefined;
  return { toId, toName, said, carried: before?.turn };
}

export function leavingBeat(state: SaveState, trip: Trip): string {
  const here = state.world.places[state.world.player_location]?.name;
  const from = here && here !== "elsewhere" ? here : "where they are";
  const said = trip.carried !== undefined
    ? `On turn ${trip.carried} the player said "${trip.said}", and they haven't got there yet, so this turn finishes it.`
    : `The player's action says "${trip.said}".`;
  if (!trip.toName) {
    return `THE PLAYER IS LEAVING ${from.toUpperCase()}. ${said} They go, this turn: write them leaving, and end the turn once they're out of ${from}, with the people they left behind still in there. Those people can react as the player goes, with a look, a word, or a question called after them, and the player doesn't stop for it, so nobody blocks the way, holds onto them, follows them out, or turns their leaving into a conversation. Anyone who wants something from them can try again on a later turn. Nothing the player says or does on the way goes beyond what they typed.`;
  }
  const dest = trip.toName;
  const footer = trip.toId
    ? `The scene line at the end names ${dest} as the place, and its "here" lists only the people who are at ${dest} when the player walks in.`
    : `The scene line at the end names the place they arrived at if it's on the list, or "elsewhere" if it isn't, and its "here" lists only the people who are there when the player arrives.`;
  return `THE PLAYER IS GOING ${trip.toId || dest === "home" ? "" : "TO "}${dest.toUpperCase()}. ${said} They go, this turn, and they get there. Write them leaving ${from}, cover the trip in a sentence or two at most, and end the turn with them arrived at ${dest}, in the first moment after they get in. The people they're leaving can react as they go, with a look, a word, or a question called after them, and the player doesn't stop for it, so nobody blocks the way, holds onto them, follows them out, or turns their leaving into a conversation, and nobody comes along unless the player brought them. Anyone who wants something from the player can try again later, by phone or in person, on a later turn. Nothing the player says or does on the way goes beyond what they typed. If something else is due this turn, it reaches them at ${dest} or on the way, in the way it really would, and it doesn't turn them around. ${footer}`;
}
