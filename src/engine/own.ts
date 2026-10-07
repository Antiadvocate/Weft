/**
 * THE PLAYER'S OWN BUSINESS — what they've said is theirs, and which of the world's questions are.
 *
 * "I explained my job to Ellie. The system still pushes Beacon Works as a thing I need to be aware
 *  of. This is not how project management works."
 *
 * Rainier Valley. Rabi is a project manager at a utility. At T51 he tells Ellie "I'm just the PM, as
 * are you", and she sets the red Beacon Works folder on his desk anyway; the bookkeeper files it in
 * his inventory; for the next forty turns he carries it home, opens it at his desk and "works through
 * it" all afternoon. At T94 he says it again, flatly: "I am not on Beacon Works ... my list is 37
 * projects." Five turns later that line had left the replayed prose and nothing anywhere held it.
 * Meanwhile the pressure picker was pressing his scenes with whichever open question in the world
 * was hottest, whoever it belonged to: Andre's switchgear key, Andre's taped sheet, Sonia's unsent
 * email, at Rabi's own sofa.
 *
 * Two halves, and both are here.
 *
 * WHAT THEY SAID ABOUT THEMSELVES STANDS. The bookkeeper records what the player's character says
 * about their own life, work and responsibilities; the card carries it every turn as true until
 * they say otherwise. It is the player's to say, the same way their actions are, so it is held at
 * the same weight.
 *
 * THE WORLD'S QUESTIONS PRESS WHERE THEY REACH. A storyline that names the player, somebody standing
 * in the scene with them, or the place they're in is pressure on that scene. One that doesn't is
 * somebody else's afternoon, and it stays offstage until it reaches them.
 */
import type { SaveState, Thread } from "./types";
import { clipText } from "./text";
import { relevance } from "./memory";

/** How many standing statements a player's card carries. Newer ones replace older ones on the same
 *  subject, so this is a cap on subjects rather than on history. */
const KEEP = 8;

export interface SelfStatement { text: string; turn: number }

/** File this turn's statements. A statement on the same subject as an older one replaces it, because
 *  "I'm not on Beacon Works" said on Wednesday is what is true on Wednesday. */
export function recordSelfStated(state: SaveState, lines: unknown, turn: number): string[] {
  const p = state.characters?.char_player as any;
  if (!p || !Array.isArray(lines)) return [];
  const list: SelfStatement[] = (p.self_stated ??= []);
  const added: string[] = [];
  for (const raw of lines) {
    const text = clipText(String(raw ?? "").trim().replace(/\s+/g, " "), 220);
    if (text.length < 8) continue;
    const i = list.findIndex((s) => relevance(s.text, text) >= 0.5);
    if (i >= 0) list.splice(i, 1);
    list.push({ text, turn });
    added.push(text);
  }
  p.self_stated = list.slice(-KEEP);
  return added;
}

/** The card line. Empty when the player hasn't said anything about themselves yet. */
export function selfStatedLine(state: SaveState): string {
  const p = state.characters?.char_player as any;
  const list: SelfStatement[] = p?.self_stated ?? [];
  if (!list.length) return "";
  const name = String(p?.name ?? "The player").trim() || "The player";
  return `What ${name} has said about ${name}'s own life and work. It's true, and it stays true until ${name} says otherwise. Nobody hands ${name} work, files, duties or ownership that ${name} has said aren't ${name}'s, and nobody treats ${name}'s role as anything other than what ${name} said it is: ${list.map((s) => s.text.replace(/\.$/, "")).join("; ")}.`;
}

function names(s: string, who: string): boolean {
  const w = who.trim();
  if (w.length < 2) return false;
  return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s);
}

/** Does this storyline reach the player's scene right now? */
export function threadReachesPlayer(state: SaveState, t: Thread): boolean {
  const text = `${t.title ?? ""} ${t.description ?? ""}`;
  const firsts = (id: string) => String(state.characters?.[id]?.name ?? "").trim().split(/\s+/)[0] ?? "";
  if (names(text, firsts("char_player"))) return true;
  for (const id of state.world?.present ?? []) {
    if (id !== "char_player" && names(text, firsts(id))) return true;
  }
  const place = state.world?.places?.[state.world?.player_location ?? ""]?.name;
  if (place && place !== "elsewhere" && names(text, place)) return true;
  return false;
}

/** The world's threads, narrowed to the ones that may press on the player's scene this turn. */
export function threadsThatReach(state: SaveState): Thread[] {
  return (state.world?.threads ?? []).filter((t) => threadReachesPlayer(state, t));
}
