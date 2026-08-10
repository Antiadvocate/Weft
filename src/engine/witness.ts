/** WHAT EVERYONE IN THIS ROOM SAW TOGETHER.
 *
 *  "Nothing pulls you out of existence vs a coherency sequential logical time sequence that can be
 *   agreed upon by multiple characters. They should've corrected her on top of it saying 'we didn't
 *   see you field wrap him for shit outside?'"
 *
 *  That is the missing thing, and it is a better diagnosis than the ones I had been working from.
 *  Every character in this engine holds a PRIVATE memory store, written per-character by a pass that
 *  reads prose and infers. Nothing has ever been shared. So when one of them asserts something that
 *  did not happen, the four people who were standing there have no basis to contradict it — not
 *  because they are being polite, but because the engine never gave them a common record to check it
 *  against. Each of them has their own inferences and no way to know they disagree.
 *
 *  What that produced, on the save this was written from: a character said a wrap happened in the
 *  field, nobody corrected her, and the story then spent FIVE consecutive turns — 39 through 43 —
 *  with the player interrogating the crew about contradictions, during which the engine invented a
 *  whole new character (a sister on reactor watch who "also handles comms") to explain away a radio
 *  voice that was itself a bug. Confabulation defending confabulation, because there was no agreed
 *  record for any of it to break against.
 *
 *  The material for one already existed and was never assembled: every history entry carries the
 *  turn, the in-world time, a factual summary, and the list of who was present. That IS a shared
 *  timeline. This hands it to the narrator as exactly that — the events these specific people
 *  witnessed together — and says what a witness is FOR.
 *
 *  Deliberately the SUMMARY and not the prose. The summary is the bookkeeper's factual record of
 *  what occurred; the prose is full of interpretation, and replaying interpretation as agreed fact
 *  would install the very thing this exists to catch. */
import type { SaveState } from "./types";

/** How many recent turns of shared record to carry. Enough to cover an argument about something that
 *  happened earlier in the same scene, which is the case this exists for. */
export const WITNESS_TURNS = 10;

/** The events the currently-present cast lived through together, newest last. */
export function witnessRecord(state: SaveState, presentIds: string[]): string {
  const others = presentIds.filter((id) => id !== "char_player" && state.characters[id]);
  if (!others.length) return "";

  const name = (id: string) => state.characters[id]?.name?.split(/\s+/)[0] ?? id;
  const rows: string[] = [];
  for (const h of state.history.slice(-WITNESS_TURNS)) {
    if (!h.summary?.trim()) continue;
    // who, of the people standing here NOW, was also there THEN
    const saw = others.filter((id) => (h.present ?? []).includes(id));
    if (!saw.length) continue;
    const when = h.time_label ? h.time_label.replace(/\s*\(.*\)$/, "") : `turn ${h.turn}`;
    rows.push(`- ${when} — ${h.summary.trim().slice(0, 200)} [present: you, ${saw.map(name).join(", ")}]`);
  }
  if (!rows.length) return "";

  return `\n[WHAT THESE PEOPLE SAW WITH THEIR OWN EYES — the shared record, and it is not negotiable:
${rows.join("\n")}
Everyone marked present at a line above KNOWS that line, the same way you do. They may remember how it felt differently, argue about what it meant, or lie about it on purpose — but none of them is confused about WHETHER it happened, WHEN, or WHERE, and none of them may state a version that contradicts it by accident.
IF SOMEONE PRESENT SAYS SOMETHING THAT CONTRADICTS THIS RECORD, THE OTHERS SAY SO. That is what having been there is for. Somebody who was in the room does not sit through a confident account of an event they watched go differently — they interrupt, they correct, they ask what the hell you are talking about. A room full of people who all quietly accept a false account of their own afternoon is not a scene, it is four narrators agreeing.
And do not invent a new person, a relative, a second radio, or an offstage explanation to make a contradiction go away. If two accounts do not fit, the people in the room notice that they do not fit. That is the scene.]`;
}
