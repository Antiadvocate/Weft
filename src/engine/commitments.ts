/**
 * THE APPOINTMENT THAT NEVER STOPPED BEING DUE — and the false memory it manufactured.
 *
 * From a real save, Elm Street, one character across thirty-four turns:
 *
 *   T14  10:02  Abigail: "I have to be at the salon by eleven."
 *                → filed as episodic, scheduled_time "Day 1, 11:00", commitment_status "pending"
 *   T19  10:21  she is in the room with the player
 *   T20  14:21  she is still in the room with the player. Eleven o'clock passed between two
 *               consecutive turns, on-screen, without her going anywhere.
 *   T21  14:24  she says it herself: "That means the alarm already went off and I didn't hear it.
 *               Guess I'm late."
 *   T28  14:56  "I have a job. I work at the salon. I was there this morning."
 *   T34  15:26  "I was there this morning, Max. I told you they asked me to cover the lunch rush.
 *                … I came home after. You saw me leave at ten forty. You watched me go."
 *                "You don't remember watching me leave. That's fine. I remember."
 *
 * None of that happened. There is no turn in which she leaves, no turn in which she is at the
 * salon, no lunch rush anywhere in the record, and the player never watched her go. By T34 she is
 * accusing him of forgetting an afternoon the engine invented, and the world model has agreed with
 * her: the relationship edge written that turn reads "Called Max out for not remembering her shift."
 * The confabulation is now canon.
 *
 * THE ENGINE ASKED FOR IT, IN TWO PLACES, BOTH OF WHICH WERE RIGHT ON THEIR OWN.
 *
 *   · memory.ts renders a pending commitment as `, STILL DUE ${m.scheduled_time}`. At turn 34 the
 *     world clock reads Day 1, 15:26 and the digest handed to the narrator says STILL DUE Day 1,
 *     11:00. That is not a reminder, it is a contradiction: an hour four and a half hours in the
 *     past described as still ahead. A model resolving that contradiction has exactly one cheap
 *     move, and it took it — she must have gone.
 *   · commitmentBoost returns 0.9 for a commitment that is "due or overdue: front of mind", with no
 *     upper bound on overdue. So the impossible line was not merely present, it outranked every
 *     other memory she had, every turn, forever. The one memory guaranteed to be in front of the
 *     narrator was the one that could not be true.
 *
 * And nothing anywhere ever moved a commitment out of `pending`. The type has had "fulfilled",
 * "missed" and "cancelled" since it was written; grep the engine and not one line assigns any of
 * them. A commitment could only ever be born.
 *
 * WHAT COUNTS AS PROOF, AND WHAT DOES NOT. Being in the room at 14:21 does not prove she was not at
 * the salon at 11:00 — she could have gone and come back. What proves it is the CROSSING: the
 * scheduled minute passing between two consecutive recorded turns with the character on-screen for
 * both. Telemetry already stores `present` and `time_label` for every turn, so this is a fact the
 * record holds rather than an inference about it. When the crossing is not on-screen, nothing is
 * decided — the appointment simply stops being described as still ahead, and the narrator is told
 * the record is silent instead of being handed a timestamp that cannot be true.
 */
import type { SaveState, EpisodicMemory } from "./types";
import { absMinutes } from "./time";

/** Minutes past the named hour before the record stops calling it upcoming. An hour is late; forty
 *  minutes is late enough that a person knows it, and short enough that the turn it happens on is
 *  usually still the turn that mattered. */
export const OVERDUE_GRACE = 40;

/** How long a blown appointment stays live in retrieval. Missing a shift is a consequence, not a
 *  deletion — she has a manager to answer to — but it is not the front of her mind forever the way
 *  the unresolved version was. */
export const MISSED_KEEP_TURNS = 25;

export interface MissedCommitment {
  id: string;
  name: string;
  /** what they said they would do, in their own words */
  content: string;
  /** the hour they named */
  due: string;
  /** the turn the promise was made — how the note knows whether this is still fresh */
  filed: number;
}

/** A commitment with a real clock time on it. "unresolved" is the engine's marker for an open loop
 *  with no hour attached, and an open loop cannot be missed. */
function scheduledAt(m: EpisodicMemory): string | null {
  const s = String(m.scheduled_time ?? "").trim();
  if (!s || /^unresolved$/i.test(s)) return null;
  return /day\s*\d+\s*,?\s*\d{1,2}:\d{2}/i.test(s) ? s : null;
}

/**
 * THE CROSSING. Did the named minute pass between two consecutive recorded turns with this person
 * in the room the whole time? Returns the pair of turns when it did.
 *
 * Reads telemetry rather than history because telemetry is where `present` is stored per turn —
 * the engine's own record of who was standing there, written at the end of every turn.
 */
function crossedOnScreen(state: SaveState, id: string, due: string): [number, number] | null {
  const rows = (state.telemetry ?? []).filter((t) => t?.time_label);
  const dueAt = absMinutes(due);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const ta = absMinutes(a.time_label!), tb = absMinutes(b.time_label!);
    if (!(ta <= dueAt && dueAt <= tb)) continue;
    if ((a.present ?? []).includes(id) && (b.present ?? []).includes(id)) return [a.turn, b.turn];
  }
  return null;
}

/**
 * Resolve every commitment the clock has run past. Deterministic, zero tokens, safe to run every
 * turn and on load. Returns one line per commitment it settled, for the turn's shifts.
 *
 * Only ever writes "missed", and only on the crossing proof above. It never marks anything
 * fulfilled: the engine cannot tell from a timestamp that somebody kept their word, and guessing in
 * that direction is the same failure as the one this module exists to stop, pointed the other way.
 */
export function resolveOverdue(state: SaveState): string[] {
  const now = state.world?.current_time;
  if (!now) return [];
  const nowAt = absMinutes(now);
  const out: string[] = [];
  for (const [id, mem] of Object.entries(state.memory ?? {})) {
    if (!mem?.episodic?.length) continue;
    // The player's own commitments are rendered honestly (see dueLabel) but never adjudicated: the
    // player is not in `present`, so the crossing test has nothing to read for them, and the engine
    // has no business telling somebody what their own character did with their morning.
    if (id === "char_player") continue;
    const name = state.characters?.[id]?.name ?? "";
    for (const m of mem.episodic) {
      if (m.commitment_status !== "pending") continue;
      const due = scheduledAt(m);
      if (!due) continue;
      if (nowAt - absMinutes(due) < OVERDUE_GRACE) continue;
      const between = crossedOnScreen(state, id, due);
      if (!between) continue;                       // the record is silent; nothing is decided
      m.commitment_status = "missed";
      out.push(`${name || id} did not go: "${String(m.full_content ?? m.content).slice(0, 90)}" was due ${due} and ${
        name || "they"} ${between[0] === between[1] ? "was in the room" : "was in the room across turns " + between[0] + "–" + between[1]} when the hour passed`);
    }
  }
  return out;
}

/** Every appointment this person is now known to have blown, newest first. */
export function missedFor(state: SaveState, id: string): MissedCommitment[] {
  const turn = state.world?.current_turn ?? 0;
  const mem = state.memory?.[id];
  if (!mem?.episodic?.length) return [];
  const name = state.characters?.[id]?.name ?? "";
  return mem.episodic
    .filter((m) => m.commitment_status === "missed" && turn - m.turn <= MISSED_KEEP_TURNS && scheduledAt(m))
    .sort((a, b) => b.turn - a.turn)
    .map((m) => ({
      id, name,
      content: String(m.full_content ?? m.content).replace(/\s+/g, " ").trim(),
      due: scheduledAt(m)!,
      filed: m.turn,
    }));
}

/**
 * How a commitment renders inside the memory digest.
 *
 * The three states are three different sentences on purpose. "STILL DUE" is a reminder and belongs
 * only to an hour that has not arrived. An hour that has arrived and been blown is a fact about the
 * character's day. An hour that passed while nobody was watching is a hole in the record, and
 * saying so is the whole fix — a narrator told the record is silent writes around it; a narrator
 * handed an impossible timestamp fills it in.
 */
export function dueLabel(m: EpisodicMemory, nowLabel: string): string {
  const due = scheduledAt(m);
  if (m.commitment_status === "missed") {
    return due ? `, MISSED — ${due} came and went and they did not go` : ", MISSED";
  }
  if (m.commitment_status !== "pending") return "";
  const raw = String(m.scheduled_time ?? "").trim();
  if (!raw) return "";
  if (!due) return `, STILL DUE ${raw}`;                          // unclocked open loop, unchanged
  const late = absMinutes(nowLabel) - absMinutes(due);
  if (late < OVERDUE_GRACE) return `, STILL DUE ${due}`;
  return `, THE HOUR NAMED (${due}) HAS PASSED and nothing in the record says whether it happened — do not decide that it did`;
}

/**
 * WHAT THE ROOM IS TOLD ABOUT IT, at the end of the directive where instructions live.
 *
 * Not a ban and not a plot beat. A missed shift is the most ordinary kind of trouble a person can
 * be in, and this engine's whole problem with this character was that she had no trouble of her own
 * — every line she spoke was about the player. She has a manager, a rent share and four-hour shifts
 * she can be dropped from. That is hers.
 */
export function missedNote(state: SaveState, presentIds: readonly string[]): string {
  const rows: string[] = [];
  for (const id of presentIds) {
    if (id === "char_player") continue;
    for (const mc of missedFor(state, id).slice(0, 2)) {
      rows.push(`${mc.name} said: ${mc.content.slice(0, 120)} — due ${mc.due}. It is now ${state.world.current_time}. ${mc.name} was in this room when that hour passed, and did not go.`);
    }
  }
  if (!rows.length) return "";
  // It stays for as long as the memory does (MISSED_KEEP_TURNS) rather than for a few turns after
  // the hour: the save this was built from produced its worst confabulation twenty turns after the
  // shift, long past any freshness window, and this block costs a hundred words only in the rare
  // scene where somebody standing here actually blew something off.
  return `\n\nAN HOUR SOMEBODY NAMED WENT PAST WHILE THEY WERE STANDING HERE.\n· ${rows.join("\n· ")}\n`
    + `They know it. Nobody in this scene says they went, says they were there, describes what happened while they were there, or refers to anybody having watched them leave — none of that is in the record and none of it happened. `
    + `If it comes up, what is true is that the hour passed and they were here, and whatever they feel about that is theirs: brazen about it, sore about it, lying about it to somebody who was in the room and knows better, or already working out what they will say to whoever is owed the time. `
    + `A person who blows off work has somebody to answer to and something they would rather do instead, and both of those are things they can want out loud without being asked.`;
}

/**
 * THE CLAIM, CAUGHT IN THE COMMITTED PROSE.
 *
 * The note above is the prevention; this is the same mechanism `last_leak` and `last_maxim` use,
 * because a rule that fires before the fact stops most of it and the one that gets through has to
 * be quoted back. Narrow on purpose: a spoken line, from somebody with a commitment the record says
 * they missed, asserting in the past tense that they did the thing. It reads the blown commitment's
 * own distinctive words, so it cannot fire on a character who has no missed commitment at all.
 */
const STOP = new Set(("the a an and or of to in on at is was were be been being it its that this his her hers she he "
  + "they them their i me my mine you your yours we us our for with as so if not no yes what when where which who "
  + "how just very really about from into out up down over then than here there all any some have has had do does "
  + "did get got go going gone come came be to by have i'm i'll it's that's don't").split(" "));

function keyWords(text: string): string[] {
  return [...new Set((String(text ?? "").toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/** "I was there this morning" / "I went" / "I came home after" / "you saw me leave" — a past-tense
 *  assertion that the thing happened, as opposed to talking about the hour. */
const DID_IT = /\b(?:i\s+(?:was|went|worked|covered|made it|got there|showed up|came (?:back|home)|did)\b|i'?ve\s+(?:been|already)\b|(?:you|he|she|they)\s+(?:saw|watched)\s+me\b|was\s+there\b|been\s+there\b)/i;

/** Which part of the day an hour falls in, in the words people actually use for it. */
function dayPart(hour: number): string {
  return hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
}

/**
 * Does this line point at the missed hour?
 *
 * Three ways, because a person lying about an appointment mostly does not name it. The real turn 34
 * says "I was there this morning", "they asked me to cover the lunch rush", "you saw me leave at
 * ten forty" — the word "salon" appears nowhere in any of it. So: the commitment's own distinctive
 * words, or the part of the day it fell in, or a clock time within a few hours of it. All three are
 * only ever consulted for a character who already has a commitment the record says they missed,
 * which is what keeps this from firing on ordinary talk about the morning.
 */
function pointsAtHour(line: string, marks: string[], due: string): boolean {
  const low = line.toLowerCase();
  if (marks.some((w) => low.includes(w))) return true;
  const t = absMinutes(due), hour = Math.floor((t % 1440) / 60);
  if (low.includes(dayPart(hour))) return true;
  for (const m of low.matchAll(/\b(?:at\s+)?(\d{1,2})[:\s-]?(\d{2})?\s*(a\.?m|p\.?m)?\b/g)) {
    let h = Number(m[1]);
    if (m[3]?.startsWith("p") && h < 12) h += 12;
    if (Math.abs(h * 60 + Number(m[2] ?? 0) - (hour * 60)) <= 180) return true;
  }
  // "ten forty", "half eleven" — the hour written out, which is how people say a time out loud
  const WORD_HOUR = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
  for (let i = 0; i < WORD_HOUR.length; i++) {
    if (!new RegExp(`\\b${WORD_HOUR[i]}\\b`).test(low)) continue;
    const h12 = i === 0 ? 12 : i;
    if (Math.abs(h12 - (hour % 12 || 12)) <= 3) return true;
  }
  return false;
}

export interface MissedClaim { name: string; said: string; content: string; due: string }

export function findMissedClaim(prose: string, state: SaveState, presentIds: readonly string[]): MissedClaim | null {
  const said = [...String(prose ?? "").matchAll(/[“"]([^“”"]{8,400})[”"]/g)].map((m) => m[1].trim());
  if (!said.length) return null;
  for (const id of presentIds) {
    if (id === "char_player") continue;
    for (const mc of missedFor(state, id)) {
      // The words that make this commitment that commitment — the salon, the shift, the eleven.
      const marks = keyWords(mc.content).filter((w) => w.length > 3);
      if (!marks.length) continue;
      for (const line of said) {
        if (!DID_IT.test(line)) continue;
        if (!pointsAtHour(line, marks, mc.due)) continue;
        return { name: mc.name, said: line.slice(0, 180), content: mc.content.slice(0, 120), due: mc.due };
      }
    }
  }
  return null;
}

export function missedClaimFix(hit: MissedClaim | null | undefined): string {
  if (!hit) return "";
  return `\nLAST TURN ${hit.name.toUpperCase()} DESCRIBED SOMETHING THAT NEVER HAPPENED, AS IF THE PLAYER HAD BEEN THERE FOR IT: "${hit.said}" — `
    + `the record has "${hit.content}" due ${hit.due}, and it has ${hit.name} in this room when that hour went past. There is no turn in which ${hit.name} leaves, arrives, or is anywhere else. `
    + `The player did not watch anything, was not told anything, and did not forget anything. A character may lie; a character may not be handed an afternoon the story never wrote and then accuse the player of not remembering it. `
    + `THIS TURN nothing invented last turn is treated as having happened. If ${hit.name} is lying about it, the prose is written from the outside — what ${hit.name} says, what ${hit.name} does with their hands, and the plain fact that the other person was standing right there — and the player is never told they forgot, missed, or failed to notice a scene that does not exist.`;
}
