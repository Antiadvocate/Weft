/**
 * THE RECORD — what actually happened, put in front of the narrator when the player disputes it.
 *
 * "May losing her entire memory is pretty insane because it was a pretty massive fight and she
 *  starts making stuff up and forgets the specific details of what occurred. I know I've made memory
 *  fluid like real life but major things like 'I didn't come home all night' are not things you can
 *  glance over."
 *
 * Rainier Valley, Day 1 into Day 2. May texts "coming home now, about 25" at 9:21 and doesn't come.
 * Rabi wakes at 12:14 to an empty bed. The next evening she says it herself: "I slept at the office.
 * In the wellness room." On Day 3, twenty-four turns later, the same argument comes back and she
 * says "I didn't sleep at the office. I left at six, I was home by seven", calls the texts "from
 * Friday" in a story that started on a Monday, and gives back the night Rabi slept on the sofa with
 * the two of them swapped: "I woke up on this couch with a blanket over me. Did you put that there?"
 *
 * Her own memory of T86 was still in the bank, but memory decays by TURNS, and a fight followed by a
 * reconciliation is twenty-four turns in one evening. By T110 it had faded to its last stage, had
 * not been retrieved since T90, and lost on token overlap to six fresher memories of the make-up. The
 * narrator, shown nothing about that night, wrote a plausible one. Then the false version was filed
 * as her memory, so the next turn defended it.
 *
 * Fluid memory is right for a Tuesday. It is wrong for the thing two people are arguing about,
 * because an argument is the act of both of them reaching for the same night. So when the player's
 * line reaches into the past and disputes it, the record of those turns goes to the narrator as the
 * one account nobody may contradict, and the character's own memories of those turns are rehearsed
 * back to full, the way being made to go over something again actually works.
 */
import type { SaveState, EpisodicMemory } from "./types";
import { clipText } from "./text";

/** The player is reaching into the past, usually to say it went differently than somebody claims. */
const DISPUTE = /\b(?:you (?:said|told me|texted|promised|swore|claimed|didn'?t|did not|weren'?t|were not|never|left|came home|stayed|slept)|you're (?:telling me|saying|lying)|you (?:lied|are lying)|lying|liar|gaslight\w*|that'?s not what happened|that never happened|didn'?t happen|remember (?:when|what|that)|do you remember|last night|yesterday|the day before|the other day|this morning|overnight|all night|the whole night|that night)\b/i;

export function disputesPast(action: string): boolean {
  return DISPUTE.test(String(action ?? ""));
}

/** How far back the record reaches, in turns. A fight about last week is still a fight about something
 *  this size; the cap only keeps the block from becoming the whole story. */
const REACH = 120;
const MAX_ROWS = 40;

function firstName(n: string | undefined): string {
  return String(n ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Build the block, and rehearse the memories it names. Returns "" when the player isn't disputing
 * anything, nobody is here to remember it, or everything relevant is still in the replayed prose.
 *
 * `inProse` is how many of the latest turns the narrator already has word for word; the record only
 * covers what is older than that, because the recent turns are already on the page.
 */
export function recordRecall(state: SaveState, action: string, presentIds: readonly string[], inProse = 5): string {
  if (!disputesPast(action)) return "";
  const turn = state.world?.current_turn ?? 0;
  const people = presentIds
    .filter((id) => id !== "char_player" && state.characters?.[id])
    .map((id) => ({ id, name: state.characters[id].name ?? "", first: firstName(state.characters[id].name) }))
    .filter((p) => p.first.length >= 2);
  if (!people.length) return "";

  const cutoff = turn - Math.max(1, inProse);
  const named = (s: string) => people.some((p) => new RegExp(`\\b${p.first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s));
  const rows = (state.history ?? [])
    .filter((h) => h && h.turn > 0 && h.turn < cutoff && h.turn >= turn - REACH)
    .map((h) => ({ turn: h.turn, when: String(h.time_label ?? `turn ${h.turn}`), what: String(h.summary ?? "").trim() }))
    .filter((r) => r.what && !/^the opening\.?$/i.test(r.what) && named(r.what))
    .slice(-MAX_ROWS);
  if (!rows.length) return "";

  // REHEARSAL. Being made to go over a night again brings it back sharp; that is what recall does to
  // a trace (see memory.ts, retrieveScored). Restored to full text and marked as just accessed, so the
  // decay clock starts again from now instead of from the last time anybody happened to cue it.
  const turns = new Set(rows.map((r) => r.turn));
  for (const p of people) {
    for (const m of (state.memory?.[p.id]?.episodic ?? []) as EpisodicMemory[]) {
      if (!turns.has(m.event_turn ?? m.turn)) continue;
      m.last_accessed_turn = turn;
      if (m.full_content) m.content = m.full_content;
      m.decay_stage = 0;
    }
  }

  const who = people.map((p) => p.name).join(" and ");
  return `\n\n=== THE RECORD: WHAT ACTUALLY HAPPENED ===
The player is talking about something that already happened. These are those events as they happened in this story, in order. ${who} lived through them and remember them. A night like this, a day or two ago, is not something a person forgets or gets wrong. How they feel about it now is open: they can regret it, justify it, minimise it, or be hurt by how it's being put. What they can't do is contradict this record, whether that's the times, where anyone was or slept, what was said or texted, or who did what to whom. Where the player's account matches the record, they don't deny it. Where it doesn't, they correct only the part the record actually contradicts, and they say what really happened.
${rows.map((r) => `· (${r.when}) ${clipText(r.what, 400)}`).join("\n")}`;
}
