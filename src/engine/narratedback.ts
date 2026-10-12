/**
 * TOLD WHAT YOU'RE DOING, TO YOUR FACE.
 *
 * Kingdom of Veythar, turns 1 to 6. Every time the player did something, Emily said it back to him:
 *
 *     "You looked. Twice."
 *     "And instead, you're down in the grass being eaten by your own cats."
 *     "And you just— Sit in the dirt and let them bite you."
 *     "Instead you stand up and shout for them, and now I'm the woman who was found in the gardens."
 *
 * The player answered in character three times running: "I tend not to have an internal dialogue that
 * tells me what I'm doing", "I don't really know why you want to talk to me anyways, beyond describing
 * what I'm doing", and finally "I'd rather enjoy my time rather than having my actions be narrated",
 * and called the guards.
 *
 * The narrator contract already forbids it (the ECHO BAN in turn.ts), as a rule in the prompt, which
 * is where rules go to be read once. Nothing read the output. This does: a spoken line that tells the
 * player what their body is doing or just did, counted when it recurs, and quoted back once at the
 * end of the next turn's direction. A player saying, in the scene, that they're being narrated at is
 * taken at their word straight away.
 *
 * Zero tokens.
 */
import { quotedLines } from "./echo";

/** "you're down in the grass", "you're staring", "you just sit there", "instead you stand up", "You looked." */
const BODY_ING = "sitting|standing|kneeling|lying|crouching|staring|playing|smiling|grinning|laughing|blushing|shaking|trembling|fidgeting|pacing|leaning|hiding|sprawled|slouching|squirming|rocking|humming|drumming|tapping|chewing";
const BODY_PAST = "looked|stared|glanced|smiled|laughed|knelt|kneeled|sat|stood|shouted|turned|walked|played|nodded|shrugged|blushed|flinched|winced|grinned|sighed|leaned|stepped|reached|got up|stood up|picked up|looked away|looked back";
const TOLD = [
  // where the player's body is: "you're down in the grass", "you're on your knees"
  /\byou(?:'re| are)\s+(?:just\s+|still\s+|all\s+)?(?:down (?:in|on|there)|up (?:there|on)|on your (?:knees|feet|back)|in the (?:grass|dirt|mud|corner|doorway)|sitting|standing|kneeling|lying|crouching)\b/i,
  // what it's doing, in the progressive: "you're staring", "you're playing with"
  new RegExp("\\byou(?:'re| are)\\s+(?:just\\s+|still\\s+)?(?:" + BODY_ING + ")\\b(?!\\s+at me like)", "i"),
  // "instead you stand up", "and then you sit there"
  /\b(?:instead|now|and then|then)\s*,?\s+you\s+(?:stand|sit|kneel|look|walk|turn|get|shout|call|laugh|smile|reach|lean|play|stare|pick|put|wave|nod|shrug|rise|step)\w*\b/i,
  // a bodily act just done, reported to its doer: "You looked. Twice." Not "you looked at me", which
  // is somebody saying what they saw done to them.
  new RegExp("\\byou\\s+(?:" + BODY_PAST + ")\\b(?!\\s+(?:at\\s+)?(?:me|my|us|our)\\b)", "i"),
];

/** The player, in the scene, saying they're being narrated at. */
const COMPLAINT = /\b(?:narrat\w+|describ\w+|commentar\w+|play[- ]by[- ]play)\b[^.?!]{0,50}\b(?:what i'?m doing|what i do|my actions|everything i do|me)\b|\b(?:stop|quit) (?:narrating|describing|commenting on)\b|\binternal (?:dialogue|monologue) that tells me what i'?m doing\b|\b(?:my actions|what i'?m doing|everything i do)\b[^.?!]{0,30}\b(?:narrat\w+|describ\w+)/i;

export interface NarratedBack { lines: string[]; complained: boolean }

/** The spoken lines in `prose` that tell the player what they're doing. */
export function toldLines(prose: string, playerSaid: string): string[] {
  const own = String(playerSaid ?? "").toLowerCase();
  return quotedLines(prose)
    .filter((l) => !own.includes(l.toLowerCase()))   // the player's own line, quoted back, is echo.ts's job
    .filter((l) => TOLD.some((re) => re.test(l)));
}

/**
 * Whether to correct it next turn: two such lines this turn, one this turn and one in either of the
 * two turns before, or the player saying so in the scene. Returns what to quote.
 */
export function findNarratedBack(prose: string, previousProse: string | string[], action: string): NarratedBack | null {
  const said = [...String(action ?? "").matchAll(/["“]([^"”]{2,})["”]/g)].map((m) => m[1]).join(" … ");
  const now = toldLines(prose, said);
  const before = (Array.isArray(previousProse) ? previousProse.slice(-2) : [previousProse]).flatMap((p) => toldLines(p, ""));
  const complained = COMPLAINT.test(String(action ?? ""));
  if (now.length >= 2 || (now.length >= 1 && before.length >= 1) || (complained && (now.length || before.length))) {
    return { lines: [...now, ...before].slice(0, 3), complained };
  }
  if (complained) return { lines: [], complained };
  return null;
}

export function narratedBackFix(hit: NarratedBack | null | undefined): string {
  if (!hit) return "";
  const quoted = hit.lines.length ? ` Lines like ${hit.lines.map((l) => `"${l.slice(0, 120)}"`).join(", ")} tell the player what they're doing while they do it.` : "";
  return `\nTHE PEOPLE HERE HAVE BEEN DESCRIBING THE PLAYER BACK TO THEM.${quoted}${hit.complained ? " The player said so in the scene, too." : ""} When the player does something, the people present answer with what they think of it, what they want, or what they were in the middle of, or they let it pass and talk about something of their own. Their lines are about themselves, the room, or what they're after, and never a report of where the player is sitting or what their hands are doing.`;
}
