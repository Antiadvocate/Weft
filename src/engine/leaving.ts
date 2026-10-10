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
import { physicalAct } from "./reaction";
import { OFFSCENE } from "./places";

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

const GO = String.raw`(?:go(?:es|ing)?|head(?:s|ing)?|drive|drives|driving|walk(?:s|ing)?|ride|rides|riding|get(?:s|ting)?|come|comes|coming|return(?:s|ing)?|run(?:s|ning)?|hurry|bike|cycle|fly|take\s+(?:the|a|an|my|our)\s+\w+|make\s+(?:my|our|his|her|their)\s+way)`;
const HOMEWARD = new RegExp(String.raw`\b${GO}\b[^.!?;]{0,30}?\bhome\b`, "i");
const TOWARD = new RegExp(String.raw`\b${GO}\s+(?:(?:us|her|him|them|back|over|down|up|out|straight|right)\s+)*(?:to|toward|towards|into)\s+([^.!?;,]{2,60})`, "gi");
/** A destination that is only words, not a tracked place, counts when the trip is by vehicle —
 *  "I walk to the window" is a step across the room. */
const VEHICLE = /\b(?:drive|drives|driving|ride|rides|riding|fly|take\s+(?:the|a|an|my|our)\s+(?:car|bus|train|cab|taxi|uber|lyft|ferry|subway|metro|tram|boat|plane|bike))\b/i;
/** The plan isn't the act: "I think about going home", "before I head home", "I don't go home". */
const NOT_YET = /\b(?:think(?:s|ing)?\s+about|consider(?:s|ing)?|wish|wonder|should|could|might|would|maybe|before|after|until|unless|if|when|later|tomorrow|tonight|plan(?:s|ning)?\s+to|want(?:s)?\s+to|about\s+to|don'?t|do\s+not|won'?t|not|never|instead\s+of|rather\s+than)\b/i;
const LEAVE = /\b(?:walk|head|storm|slip)\s+out\b|\bleave(?:s)?\s+(?:the\s+)?(?:building|office|tower|house|place|bar|restaurant|party|meeting|room)\b|\bclock\s+out\b|\bcall\s+it\s+a\s+day\b/i;
/** Moving on, with no new destination given: what carries a trip stated on an earlier turn. */
const ONWARD = /\b(?:take|took|taking)\s+the\s+(?:elevator|lift|stairs|escalator)\b|\bget(?:s)?\s+(?:in|into)\s+(?:the|my|our)\s+(?:car|truck|van|cab|uber|taxi)\b|\b(?:drive|driving|walk|walking|ride|riding)\b(?!\s+(?:her|him|them)\b)|\bleave\b|\bhead\s+out\b|\bkeep\s+going\b/i;
const CONTINUE = /^\s*(?:continue|go\s+on|keep\s+going|\.{3}|…)\s*[.!]?\s*$/i;
const HOMEY = /\b(?:home|house|apartment|flat|cottage|cabin|residence|quarters|condo|loft|farmhouse|homestead)\b/i;

/** ...and the same after it: "I'm going home after this", "I'll drive home later". */
const LATER = /^[^.!?;]{0,40}?\b(?:later|tonight|tomorrow|after|afterwards|soon|eventually|this\s+evening|in\s+an?\s+(?:hour|minute|bit|while)|once|when|at\s+\d)\b/i;

/** The sentence of `text` around index `at`, up to the match: what was said before the verb. */
function leadIn(text: string, at: number): string {
  const before = text.slice(0, at);
  const cut = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(";"));
  return before.slice(cut + 1);
}

function places(state: SaveState): [string, string][] {
  return Object.entries(state.world?.places ?? {})
    .filter(([id, p]) => id !== OFFSCENE && p?.name && p.name !== "elsewhere")
    .map(([id, p]) => [id, p.name]);
}

/** Where "home" is for the player: their schedule's home, a home-like place with their name on it,
 *  the home-like place they started in, or the only place called home. */
export function playerHome(state: SaveState): { id?: string; name: string } {
  const all = places(state);
  const sched = state.characters?.char_player?.schedule?.home;
  if (sched) {
    const hit = all.find(([id, name]) => id === sched || name.toLowerCase() === sched.toLowerCase());
    if (hit) return { id: hit[0], name: hit[1] };
  }
  const first = String(state.characters?.char_player?.name ?? "").split(/\s+/)[0]?.toLowerCase();
  const mine = first && first.length >= 2 ? all.find(([, name]) => HOMEY.test(name) && name.toLowerCase().includes(first)) : undefined;
  if (mine) return { id: mine[0], name: mine[1] };
  const start = state.travel_log?.[0]?.place;
  const started = all.find(([id, name]) => id === start && HOMEY.test(name));
  if (started) return { id: started[0], name: started[1] };
  const called = all.filter(([, name]) => /\bhome\b/i.test(name));
  if (called.length === 1) return { id: called[0][0], name: called[0][1] };
  return { name: "home" };
}

/** A tracked place named in `words`, other than where the player already is. */
function placeIn(state: SaveState, words: string): [string, string] | undefined {
  const w = words.toLowerCase();
  return places(state)
    .filter(([id]) => id !== state.world.player_location)
    .map(([id, name]) => [id, name, name.toLowerCase().replace(/^the\s+/, "")] as const)
    .filter(([, , n]) => n.length >= 3 && w.includes(n))
    .sort((a, b) => b[2].length - a[2].length)
    .map(([id, name]) => [id, name] as [string, string])[0];
}

/** The trip this action states, on its own, without looking back. */
function statedTrip(state: SaveState, action: string): Trip | null {
  const act = physicalAct(action);
  if (!act) return null;
  const home = act.match(HOMEWARD);
  if (home && home.index !== undefined && !NOT_YET.test(leadIn(act, home.index)) && !LATER.test(act.slice(home.index + home[0].length))) {
    const h = playerHome(state);
    if (h.id && h.id === state.world.player_location) return null;
    return { toId: h.id, toName: h.name, said: home[0].trim() };
  }
  for (const to of act.matchAll(TOWARD)) {
    if (to.index === undefined || NOT_YET.test(leadIn(act, to.index)) || LATER.test(act.slice(to.index + to[0].length))) continue;
    const hit = placeIn(state, to[1]);
    if (hit) return { toId: hit[0], toName: hit[1], said: to[0].trim() };
    if (VEHICLE.test(to[0])) {
      const where = to[1].split(/\s+(?:and|then|so|while|to)\s+/i)[0].trim();
      if (where.length >= 3) return { toName: where, said: to[0].trim() };
    }
  }
  const out = act.match(LEAVE);
  if (out && out.index !== undefined && !NOT_YET.test(leadIn(act, out.index))) return { toName: "", said: out[0].trim() };
  return null;
}

/**
 * The trip this turn is for, or null. A trip stated in this action wins; otherwise one stated on
 * either of the last two turns, still unfinished, carries over to an action that only moves on.
 */
export function playerTrip(state: SaveState, action: string): Trip | null {
  const now = statedTrip(state, action);
  if (now) return now;
  const act = physicalAct(action);
  if (!CONTINUE.test(action) && !ONWARD.test(act)) return null;
  const recent = (state.history ?? []).slice(-2).reverse();
  for (const h of recent) {
    // Only a trip to a place the game tracks carries over, because only then can the engine tell
    // whether it has finished. "A Mexican restaurant" may have been reached in the last turn's prose.
    const t = statedTrip(state, h.player_action ?? "");
    if (!t?.toId) continue;
    if (t.toId === state.world.player_location) return null;   // already there
    return { ...t, carried: h.turn };
  }
  return null;
}

/** The beat for a turn the player spends leaving. Replaces ANSWER THE PLAYER and the quiet beats. */
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
