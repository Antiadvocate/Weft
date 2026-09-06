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

/**
 * How long a blown appointment stays a live fact about somebody's day — MEASURED IN WORLD TIME.
 *
 * The first version of this was twenty-five TURNS, borrowed from how long an offstage sighting
 * survives reflection, and it was wrong for the same reason the STILL DUE label was wrong: turns
 * are not time. The save this came from ran forty-one turns across twelve hours, three minutes at
 * a stretch, so the shift missed at eleven fell out of the window at about seven in the evening —
 * on the very turn the player finally called the salon to check. The guard went quiet and the
 * claim detector went blind at the exact moment both existed for.
 *
 * Two days of world time. A shift missed this morning is still this morning's shift tonight; it is
 * not still an open question next week.
 */
export const MISSED_KEEP_MINUTES = 2 * 1440;

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
  const now = state.world?.current_time ?? "";
  const mem = state.memory?.[id];
  if (!mem?.episodic?.length) return [];
  const name = state.characters?.[id]?.name ?? "";
  return mem.episodic
    .filter((m) => {
      if (m.commitment_status !== "missed") return false;
      const due = scheduledAt(m);
      return !!due && (!now || absMinutes(now) - absMinutes(due) <= MISSED_KEEP_MINUTES);
    })
    // Newest hour first, and where two promises name the SAME hour the plainer wording wins — the
    // save this came from filed "I have to be at the salon by eleven" and a forty-word version of
    // the same sentence five minutes apart, and the long one is not what she promised.
    .sort((a, b) => (b.turn - a.turn) || (String(a.full_content ?? a.content).length - String(b.full_content ?? b.content).length))
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
  // Two promises about the same hour are ONE missed appointment. The save this came from filed "I
  // have to be at the salon by eleven" and a forty-word version of the same sentence five minutes
  // apart, and printing both said the same thing twice, louder, in the wordier of the two voices.
  // One row per hour, in the plainest words the character used for it.
  const byHour = new Map<string, MissedCommitment>();
  for (const id of presentIds) {
    if (id === "char_player") continue;
    for (const mc of missedFor(state, id)) {
      const key = `${id}|${mc.due}`;
      const held = byHour.get(key);
      if (!held || mc.content.length < held.content.length) byHour.set(key, mc);
    }
  }
  const rows = [...byHour.values()].map((mc) =>
    `${mc.name} said: ${mc.content.slice(0, 120)} — due ${mc.due}. It is now ${state.world.current_time}. ${mc.name} was in this room when that hour passed, and did not go.`);
  if (!rows.length) return "";
  // It stays for as long as the memory does (MISSED_KEEP_TURNS) rather than for a few turns after
  // the hour: the save this was built from produced its worst confabulation twenty turns after the
  // shift, long past any freshness window, and this block costs a hundred words only in the rare
  // scene where somebody standing here actually blew something off.
  return `\n\nAN HOUR SOMEBODY NAMED WENT PAST WHILE THEY WERE STANDING HERE.\n· ${rows.join("\n· ")}\n`
    + `They know it. Nobody in this scene says they went, says they were there, describes what happened while they were there, or refers to anybody having watched them leave — none of that is in the record and none of it happened. `
    + `If it comes up, what is true is that the hour passed and they were here, and whatever they feel about that is theirs: brazen about it, sore about it, lying about it to somebody who was in the room and knows better, or already working out what they will say to whoever is owed the time. `
    + `A person who blows off work has somebody to answer to and something they would rather do instead, and both of those are things they can want out loud without being asked.\n`
    + `AND NOTHING OFF-SCREEN CORROBORATES IT. No manager, no coworker, no timesheet, no keycard log, no text sent from the back room, no schedule on a wall and no camera puts them there, because they were not there. `
    + `If somebody in this scene reaches for proof, the proof is on the side of the record.`;
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

/**
 * A FIRST-PERSON PAST CLAIM, and the three things that are not one.
 *
 * The real turns this has to separate, from one save, four consecutive turns of the same argument:
 *
 *   T35  "I was at work at eleven, Max. I came back."                        ← the claim
 *   T36  "No. I was here. I was talking to you at eleven."                   ← TRUE, and the opposite
 *   T36  "I came home from work and you were on your laptop"                 ← the claim
 *   T37  "You think I've been here all day. Like I just—what, stood in       ← quoting HIM
 *         this living room for twelve hours"
 *   T37  "Max, I was at the salon at eleven. I covered the lunch rush."      ← the claim
 *   T38  "I already texted her from the back room at 11:12"                  ← manufactured evidence
 *
 * A first draft on whole lines flagged the T37 rebuttal and missed the T37 claim in the same line,
 * because both live inside one pair of quotation marks. So it runs per SENTENCE, and it throws out
 * the two shapes that are not assertions about the appointment: a sentence repeating what the other
 * person just said, and a sentence claiming they were HERE — which is the true version, and the one
 * a character says while their memory is being argued with.
 */
const PAST_FIRST_PERSON = /\b(?:i\s+(?:was|went|worked|covered|clocked|left|took|had|made|got|did|saw|told|texted|called|[a-z]+ed)|i'?ve\s+been\s+(?:at|to|in)|i\s+came\s+(?:back|home|in)|(?:you|he|she|they)\s+(?:saw|watched)\s+me)\b/i;
/** Repeating the other person's version back at them is not a claim of your own. */
const REBUTTAL = /\b(?:you\s+think|you'?re\s+saying|you\s+said|you'?re\s+telling\s+me|according\s+to\s+you|like\s+i\s+just|as\s+if\s+i|you\s+want\s+me\s+to)\b/i;
/** "Say you'd stay on the floor till I got back." A verb under till/until/before/when/if is not a
 *  claim that anything happened — it is a plan, and in the save this came from it was said an hour
 *  BEFORE the shift she then did not go to. */
const HYPOTHETICAL = /\b(?:till|until|before|when|while|if|unless|so\s+that|in\s+case)\s+i\b/i;
/** "I was here", "I've been home" — the true version, said by somebody being told they imagined
 *  their morning. It must never be quoted back at the narrator as the fault. */
const WAS_HERE = /\bi(?:'?ve\s+been|\s+was|\s+stayed)\s+(?:right\s+)?(?:here|home|in\s+this|on\s+(?:the|that)\s+couch)\b/i;
/** Having gone and having come back — a departure claim needs no place name to be a claim. */
const WENT_AND_RETURNED = /\b(?:i\s+came\s+(?:back|home)|i\s+left\b|i\s+got\s+back|(?:you|he|she|they)\s+(?:saw|watched)\s+me\s+(?:leave|go)|i\s+clocked\s+(?:in|out))/i;

/** Which part of the day an hour falls in, in the words people actually use for it. */
function dayPart(hour: number): string {
  return hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
}

/**
 * Does this sentence point at the missed hour?
 *
 * Three ways, because a person lying about an appointment mostly does not name it. The real turn 34
 * of the first save says "I was there this morning", "they asked me to cover the lunch rush", "you
 * saw me leave at ten forty" — the word "salon" appears nowhere in any of it. So: the commitment's
 * own distinctive words, or the part of the day it fell in, or a clock time within a few hours of
 * it. All three are only ever consulted for a character who already has a commitment the record
 * says they missed, which is what keeps this off ordinary talk about the morning.
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
        for (const raw of line.split(/(?<=[.!?])\s+|\s+—\s+/)) {
          const sentence = raw.trim();
          if (sentence.split(/\s+/).length < 4) continue;
          if (REBUTTAL.test(sentence) || WAS_HERE.test(sentence) || HYPOTHETICAL.test(sentence)) continue;
          if (!PAST_FIRST_PERSON.test(sentence)) continue;
          if (!WENT_AND_RETURNED.test(sentence) && !pointsAtHour(sentence, marks, mc.due)) continue;
          return { name: mc.name, said: sentence.slice(0, 180), content: mc.content.slice(0, 120), due: mc.due };
        }
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE WITNESS WHO AGREES WITH WHOEVER SPOKE LAST.
 *
 * The player did the one thing that should end this. Same save, four turns later:
 *
 *   T35  Abigail: "I was at work at eleven, Max. I came back."
 *   T36  player:  "No. I was here at 11 am. You were talking to me. You haven't gone anywhere."
 *   T37  Abigail: "Max, I was at the salon at eleven. I covered the lunch rush. … I remember
 *                  locking the door. I remember the keycard."
 *   T38  player:  "Yeah? Any proof? That you did? Let's call your manager"
 *        Abigail: "Because I already texted her from the back room at 11:12 when Tanya was late
 *                  for her station. … Ask her what time I clocked out."
 *   T40  player:  I press the button and ask "hi. Did Abigail work today?"
 *        → "Solstice Tanning, this is Dana."
 *
 * Between the demand and the dial tone the engine invented a text message at 11:12, a back room, a
 * late coworker named Tanya, a keycard and a locked door. Then it put a manager on speakerphone
 * with nothing anywhere telling it what that manager knows. A voice generated fresh, mid-argument,
 * with no record of its own, agrees with whatever the prose most recently asserted — so the check
 * the player invented to end the hallucination becomes the thing that certifies it.
 *
 * WHAT IT COST, IN THE SAVE'S OWN NUMBERS. By turn 40 Abigail is at relaxation −10, state "broken",
 * break_mode "fractured", and her active states read: flustered, confused, SECOND-GUESSING REALITY.
 * The engine gaslit its own character into a breakdown because its record and its prose disagreed
 * and only the prose ever got to speak. Her drive, rewritten that turn, is "Conceal whether she
 * actually attended her shift from Max while Dana is on the line" — the simulator had worked out
 * what was true and the narrator was still free to have Dana say otherwise.
 *
 * So the verdict arrives BEFORE the prose, the way attempt.ts resolves a stakes-bearing action
 * before a word is written. The engine already knows the answer; a scene where the player asks for
 * it is the one place it must not be re-derived from the conversation.
 */

/** The player reaching for something outside the room to settle it. */
const VERIFYING = /\b(?:call|calls|calling|phone|phoning|ring|dial|dials|speaker|speakerphone|text|texts|texting|manager|boss|supervisor|co-?workers?|colleagues?|time\s?sheet|timesheet|time\s?card|timecard|punch\s?card|key\s?card|keycard|badge|roster|rota|clock(?:ed)?\s+(?:in|out)|payslip|pay\s?stub|receipt|cameras?|footage|cctv|proof|prove|verify|verified|confirm|check\s+with|find\s+out\s+(?:if|whether))\b/i;

/**
 * THE CHANNEL, as opposed to the demand — a much shorter list, read against the previous turn's
 * PROSE rather than the player's typed line.
 *
 * It has to be short. Narration says "called" and "asked" and "confirmed" constantly about nothing
 * in particular, and a law that fires on those is a hundred and fifty words of correction landing
 * on turns where nobody is checking anything. This is only the vocabulary of a line that is
 * actually open: something ringing, somebody on speaker, a roster, a workplace on the other end.
 */
const CHANNEL_OPEN = /\b(?:speakerphone|on\s+speaker|the\s+speaker|phone(?:'s)?\s+(?:speaker|ringing)|dial(?:ing|\s+tone)|ringing|answered\s+the\s+phone|on\s+the\s+line|(?:her|his|their|your|my)\s+manager|timesheet|time\s?sheet|roster|clocked\s+(?:in|out)|key\s?card)\b/i;

/**
 * The law for a turn in which the player is checking a settled commitment.
 *
 * Deliberately not a ban on the character lying — she may lie for as long as she likes, and lying
 * to somebody who was in the room is a far better scene than a confession. What is settled is what
 * the WORLD says when the world is asked, and the world is not a second opinion.
 */
export function verificationLaw(state: SaveState, action: string, presentIds: readonly string[], previousProse = ""): string {
  // THE CHANNEL STAYS OPEN AFTER THE DEMAND. The turn that matters most in the save above is the
  // one whose typed action is `I press the button and ask "hi. Did Abigail work today?"` — no
  // manager, no proof, no verb this regex knows, and the turn where the manager answers. So the
  // previous turn's prose counts too: once a phone is in somebody's hand and a workplace is on the
  // line, the check is live whatever the player types next.
  if (!VERIFYING.test(String(action ?? "")) && !CHANNEL_OPEN.test(String(previousProse ?? ""))) return "";
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const id of presentIds) {
    if (id === "char_player") continue;
    for (const mc of missedFor(state, id)) {
      if (seen.has(`${id}|${mc.due}`)) continue;
      seen.add(`${id}|${mc.due}`);
      rows.push(`${mc.name} was not there. ${mc.due} passed with ${mc.name} in this room, on the page, in front of the player.`);
    }
  }
  if (!rows.length) return "";
  return `\n\n=== THE ANSWER IS ALREADY SETTLED. DO NOT DERIVE IT FROM THE CONVERSATION. ===\n· ${rows.join("\n· ")}\n`
    + `The player is checking this against something outside the room. Whoever or whatever answers — a manager, a coworker, a shift log, a text thread, a badge reader, a till receipt — answers from the record above, and the record says it did not happen. `
    + `A voice invented this turn has no memory of its own to consult, so it cannot be the thing that decides; it can only repeat what the engine already knows. `
    + `A manager who says she worked is this story agreeing with a thing it knows to be false, and it is worse than the original error, because the player asked.\n`
    + `WHAT IS STILL OPEN, and it is most of the scene. The answer can be slow, partial, distracted, or useless — somebody on a busy line does not have the roster in front of them, does not remember, has to go and look, asks who is calling, or hangs up. `
    + `The person being checked can lie over the top of it, talk across it, take the phone, refuse, walk out, or tell the truth. Nobody has to be believed and nothing has to be resolved this turn. `
    + `The one thing unavailable is a third party putting them somewhere the record does not.`;
}
