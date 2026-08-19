/**
 * MUTE — a scene of people in a room where nobody says anything.
 *
 * THE COMPLAINT. "Characters do not talk at all. Non reactions, HEAVY prose of just atmosphere.
 * Everything is ambiance. Zero actual humans." Measured on the save it came from: 12.2% of the
 * prose was quoted speech across 48 turns, with five turns at exactly 0% — two people alone in a
 * house together, one of whom is written as unable to stop asking questions, and neither of them
 * opened their mouth.
 *
 * WHY THE PROMPT CANNOT FIX THIS ON ITS OWN. tests/dialogue-shape.ts already found the mechanism
 * and named it: every channel for conveying a person has been closed except an observable action.
 * Interiority is forbidden (povFilter, SURFACE_TAIL), captioning a gesture is forbidden, role
 * comparison is forbidden, the camera may only report what someone could point at. Those rules are
 * right and this does not repeal any of them. But they are all PROHIBITIONS, and they occupy every
 * position that wins — including the last two notes the model reads before it writes. The cheapest
 * output that satisfies all of them at once is a paragraph of bodies and weather. Nothing anywhere
 * in the request asks anyone to speak.
 *
 * AND CHATLOG MODE WELDS IT SHUT. The narrator's own prior prose is replayed as assistant messages,
 * so forty turns at 12% is forty turns of proof that this is how this story is written, authored by
 * the role the model is playing. The drift is self-reinforcing and rises with turn count — the same
 * signature as the POV failure that the prose scrub exists to break (see turn.ts CHATLOG PROSE
 * SCRUB). Voice got a fix. Prose got a fix. Dialogue volume never did.
 *
 * SO IT IS MEASURED ON THE OUTPUT, NOT ASSERTED IN THE PROMPT — the discipline of echo.ts and
 * maxims.ts. Read what was actually written, and when the pattern is real, tell the narrator at the
 * end of the next turn's directive, which is the only position that has ever reliably broken one of
 * its habits.
 *
 * WHAT THIS IS CAREFUL NOT TO BECOME. A dialogue QUOTA. The contract says, correctly, that the
 * right amount of NPC chatter is often none: in an intimate, dangerous, stealthy, or stunned moment
 * a held look beats a line, and a scene may be quiet. A detector that fired on any silent turn
 * would convert that into banter every time. Three guards keep it honest:
 *
 *   · IT NEEDS A WINDOW. One quiet turn is a quiet turn. Only a SUSTAINED stretch fires — silence
 *     that has become the house style rather than a beat that earned it.
 *   · IT NEEDS SOMEBODY TO TALK TO. A solo scene, or a scene whose only other occupant is asleep,
 *     unconscious, or a corpse, is exempt: nobody failed to speak there.
 *   · IT ASKS FOR NOTHING SPECIFIC. No topic, no line, no minimum count. It reports the measurement
 *     and points back at the machinery that already knows what these people want — which is the one
 *     thing a quota cannot do and is the whole reason the cast reads as furniture when it is missing.
 */
import type { SaveState } from "./types";

/** Quoted runs, the same reader echo.ts uses. Straight and curly quotes; no length floor, because
 *  "Wait." is speech and a floor would score a turn of clipped exchanges as silence. */
function spokenWords(prose: string): number {
  let n = 0;
  for (const m of String(prose ?? "").matchAll(/["“]([^"”\n]{1,400})["”]/g)) {
    n += m[1].trim().split(/\s+/).filter(Boolean).length;
  }
  return n;
}

function totalWords(prose: string): number {
  return String(prose ?? "").split(/\s+/).filter(Boolean).length;
}

/** Share of a turn's prose that is somebody talking, 0..1. */
export function spokenShare(prose: string): number {
  const t = totalWords(prose);
  return t ? spokenWords(prose) / t : 0;
}

/** Turns of prose read back. Long enough that a held beat, a fight, and a turn of pure travel can
 *  all pass through without tripping it; short enough that the correction arrives while the stretch
 *  is still the stretch the player is reading. */
const WINDOW = 4;

/** Below this share of spoken words, across the whole window, the scene has gone mute. Calibrated
 *  against the saves on file: the ordinary range is 4–31% per turn and the complaint save averaged
 *  12.2% overall — so a per-turn floor would fire constantly on healthy stories. What separates the
 *  failure is the WINDOW average, which stays high in a normal story because talky turns pull it up
 *  and sits under this line only when nothing is pulling. */
const MUTE_UNDER = 0.08;

/** A window is only mute if most of its turns were. One 40% turn inside four silent ones is a scene
 *  that talked and then stopped, which the average alone would hide. */
const SILENT_TURN_UNDER = 0.05;

export interface MuteVerdict {
  /** Share of the window's prose that was spoken, as a percentage, rounded. */
  pct: number;
  /** How many of the window's turns had essentially no speech in them. */
  silentTurns: number;
  /** Names of the people who were in the room for it. */
  present: string[];
}

/** Someone who could have spoken and did not. Excludes the player (the narrator may not write their
 *  speech at all) and anyone the state says cannot talk right now — a sleeping or unconscious body
 *  is not a character being written as furniture, it is a body doing what bodies do. */
function couldHaveSpoken(state: SaveState): string[] {
  const out: string[] = [];
  for (const id of state.world.present ?? []) {
    if (id === "char_player") continue;
    const c = state.characters[id];
    if (!c || c.status === "dead" || c.status === "departed") continue;
    const cond = state.condition[id];
    const blocked = [...(cond?.conditions ?? []), ...(cond?.injuries ?? []).map((i) => `${i.type} ${i.functional_impact}`)]
      .join(" ").toLowerCase();
    if (/\b(asleep|sleeping|unconscious|comatose|out cold|sedated|mute|gagged)\b/.test(blocked)) continue;
    out.push(c.name);
  }
  return out;
}

/**
 * Read the last WINDOW turns of prose. Returns a verdict only when the stretch is genuinely mute
 * AND there was somebody in the room to break the silence — otherwise null, which is most turns.
 */
export function findMute(state: SaveState): MuteVerdict | null {
  const present = couldHaveSpoken(state);
  if (!present.length) return null;

  const recent = (state.history ?? []).slice(-WINDOW).map((h) => h?.narrator_prose ?? "").filter((p) => totalWords(p) >= 40);
  // Not enough prose on record to judge a pattern. An opening, or a run of tiny turns.
  if (recent.length < WINDOW) return null;

  let spoken = 0, total = 0, silent = 0;
  for (const p of recent) {
    const s = spokenWords(p), t = totalWords(p);
    spoken += s; total += t;
    if (s / t < SILENT_TURN_UNDER) silent++;
  }
  const share = total ? spoken / total : 0;
  if (share >= MUTE_UNDER) return null;
  if (silent < Math.ceil(recent.length / 2)) return null;

  return { pct: Math.round(share * 100), silentTurns: silent, present };
}

/**
 * The correction, for the end of the next turn's directive.
 *
 * It states the measurement and then hands the turn back to the machinery that already knows what
 * these people want — deliberately, and this is the part that matters. Telling a narrator "add more
 * dialogue" gets dialogue-shaped filler: two characters agreeing pleasantly about the weather, which
 * is the same non-scene with quotation marks on it. The failure is not a missing word count, it is
 * that nobody in the room was given anything to pursue, so the note points at the wants, the
 * disagreements, and the subjects each person actually has — all of which are already in the
 * context, several thousand tokens above, being outvoted by position.
 */
export function muteFix(v: MuteVerdict | null | undefined): string {
  if (!v) return "";
  const who = v.present.slice(0, 4).join(", ");
  return `\n[YOU HAVE STOPPED WRITING PEOPLE. Across the last four turns ${v.pct}% of the prose was somebody speaking, and ${v.silentTurns} of those turns contained essentially none — while ${who} stood in the room the whole time. That is not a quiet beat; a quiet beat is one turn. It is a scene of furniture and weather, and it is yours, not theirs: the rules that forbid interiority, captioning and comparison closed every channel except an observable action, so you have been writing bodies because bodies are the only thing left that is always safe. Speech is also always safe. Open the channel back up this turn.
DO THIS, IN THIS ORDER. For each person listed as present, go back up and read the four lines printed under their name: what they want in the next minute, the subjects listed after "texture:" and after "can talk at length about:", what has happened to them lately, and what they believe to be true. Then write at least one of them pursuing one of those four out loud, addressed to somebody in the room, in the words their own age and sentence-shape allow. Let that exchange run several lines with nothing between them but who is speaking.
AND NOT THIS. Not a quota, and not chatter: nobody makes pleasant agreeable noise about the room they are standing in, and no disagreement is manufactured to give the turn something to be about. If a person genuinely has none of those four things live this turn, that is the signal they should not be standing in the scene — send them to their own business and let them come back when they have a reason.]`;
}
