/**
 * SCHEDULEFORGE — reading a person's week off the life they already have.
 *
 * The schedule model (engine/schedule.ts) is deliberately dumb: given hours and a place, it moves
 * people. What it cannot do is decide that the man whose background says "kept the ledgers for a
 * shipping house until the fire" is at a counting-house from seven, or that the woman whose drive is
 * "get the boy into the school before the term closes" is at the school gate on the days it admits.
 * Typing that in by hand is possible and is what the editor is for; asking for it is one cheap call.
 *
 * THIS IS A READING, NOT AN INVENTION, and that distinction is the whole design — the same one
 * traitforge is built on. A schedule generated freely produces a stranger: a barista with a gym
 * habit in a world with no coffee and no gyms, or a soldier who has acquired a second job the story
 * never gave him. What is wanted is the week that is ALREADY IMPLIED by the background, the drives,
 * the standing wants and the places the world actually contains — written down, with hours on it,
 * so the engine can act on it. If the card does not imply a job, the honest output is a short week
 * of ordinary obligations, or none at all.
 *
 * The weekday/weekend question is answered by the setting rather than assumed. A five-day week with
 * two off is an industrial arrangement; a fishing village has tides, a farm has seasons, a temple
 * has holy days. The prompt asks for whichever of those the world supports and the model gets an
 * explicit day-list to express it with.
 */
import { buildMessages, complete, safeJson } from "../llm";
import { hasAuthored, liveAuthored } from "./authored";
import { newBlock, normalizeDays, parseClock } from "./schedule";
import type { SaveState, Schedule, ScheduleBlock } from "./types";

const SCHEDULE_SYSTEM = `You write down the week ONE character already has. You are not designing them a life.

Everything you write must be traceable to something you were given: their background, their work, their standing wants, their obligations, the world's technology and politics, and the places that exist. If the card does not say they have a job, THEY DO NOT HAVE ONE — do not award them employment to fill the form. A person with no work still has a week: a meal they take with someone, a duty, a market day, a place they always are at a certain hour.

WHAT A BLOCK IS. Somewhere this person HAS TO BE, at hours that repeat. Not what they want (that is elsewhere on their card and it is not your business), not an itinerary of their day. A shift. A watch. A round. A service. Lessons. The hours a shop is theirs to keep.

HOW MANY. One to three. Almost never four. A week is a skeleton — the story happens in the gaps, and a character booked solid is a character the player can never reach. If one block is the truth of their week, write one.

THE WEEK ITSELF IS A PROPERTY OF THE WORLD, NOT A DEFAULT. A five-day working week with two days off is an industrial arrangement and belongs only to a world that has one. Otherwise use what this world actually runs on: every day (a farm, a kitchen, a watch), specific named days (a market on Tuesdays and Fridays, a service on Sunday), or a rest day the setting names. Choose "days" accordingly.

HOURS MUST FIT THE WORLD. Pre-industrial work starts at first light and stops at dark; a night watch is a night watch; an office is an office. Do not write 09:00–17:00 into a world that has no clocks to say it with.

"why" IS THE MOST IMPORTANT FIELD AND IT IS NOT A JOB DESCRIPTION. It is why THIS is in THIS person's life, in one plain sentence, drawn from their background or what they are trying to get: "it is the only yard that took a man off the boats", "she is the only one in the house who can read the weights", "he goes because his mother's name is on the roll and someone has to answer to it". Never "because he is a blacksmith".

"where" MUST NAME A PLACE FROM THE LIST when one of them fits — copy the name exactly. Only name a new one when the week genuinely requires somewhere the world does not have yet, and then name it as a person would say it aloud, as a whole place (a building, a yard, a stretch of road), never a room inside one.

"how" is the getting there — the walk, the tram, the cart, whose horse. One short phrase. It is what the person would say, and it is often the most human line on the card.

"rigidity": "mandatory" only when missing it genuinely costs them something they cannot absorb (pay, rank, custody, liberty). "expected" is the normal case. "optional" is a thing they do most days and can drop.

"stakes" only for mandatory blocks: what missing it actually does, concretely, to them. One clause.

Output ONLY this JSON:
{"home":"the place they return to when nothing else claims them — a name from the place list if one fits","note":"one short line about the week that the blocks cannot express, or empty","blocks":[{"what":"","why":"","where":"","how":"","start":"HH:MM","end":"HH:MM","days":"daily | weekdays | weekends | [0-6 where 0=Sunday]","rigidity":"optional|expected|mandatory","stakes":""}]}`;

export interface ForgedSchedule {
  name: string;
  blocks: number;
  schedule: Schedule;
}

/** Everything the model is allowed to reason from. Deliberately excludes the player: a week is a
 *  fact about someone's own life, and a schedule written with the protagonist in view is a schedule
 *  whose every hour turns out to be convenient. */
function brief(state: SaveState, id: string): string {
  const c = state.characters[id];
  const b = state.world_bible ?? ({} as SaveState["world_bible"]);
  const places = Object.values(state.world.places ?? {})
    .filter((p) => p.id !== "loc_offscene")
    .map((p) => `- ${p.name}${p.description_facts ? `: ${String(p.description_facts).slice(0, 110)}` : ""}`)
    .join("\n");
  const wants = [
    c.drive?.goal,
    ...(c.drive_queue ?? []).map((d) => d?.goal),
    ...(hasAuthored(c) ? liveAuthored(c).map((a) => a.goal) : []),
  ].filter(Boolean).join("; ");
  const here = state.world.places[c.location ?? ""]?.name;

  return [
    `NAME: ${c.name}, age ${c.age}${c.pronouns ? ` (${c.pronouns})` : ""}`,
    `SETTING: ${b.name ?? ""} — ${b.era ?? ""}`,
    `WHAT THIS WORLD CAN DO: ${b.technology_level ?? ""}`,
    `HOW IT MEASURES TIME AND MONEY: ${b.calendar_and_currency ?? "unstated"}`,
    `CLIMATE AND GROUND: ${b.climate_and_geography ?? ""}`,
    `POLITICS: ${b.political_situation ?? ""}`,
    `BACKGROUND (this is where their week comes from): ${c.background ?? ""}`,
    c.life_history?.trim() ? `WHAT HAS HAPPENED TO THEM SINCE: ${c.life_history.trim().slice(0, 600)}` : "",
    `AS A PERSON: ${(c.core_traits ?? []).join("; ")}`,
    (c.values ?? []).length ? `HOLDS TO: ${(c.values ?? []).join(", ")}` : "",
    Object.keys(c.skills ?? {}).length ? `CAN DO: ${Object.entries(c.skills).map(([k, v]) => (v ? `${k} (${v})` : k)).join("; ")}` : "",
    wants ? `WHAT THEY ARE CURRENTLY TRYING TO GET (their week should make room for this, not consist of it): ${wants}` : "",
    here ? `WHERE THEY ARE RIGHT NOW: ${here}` : "",
    `\nPLACES THAT EXIST — use these names exactly where one fits:\n${places}`,
    `\nIT IS CURRENTLY: ${state.world.current_time}${b.start_date ? ` (calendar starts ${b.start_date})` : " (no calendar is kept; the week runs from Day 1)"}`,
  ].filter(Boolean).join("\n");
}

/**
 * Write one character's week. Returns null on any failure, leaving them exactly as they were —
 * a character with no schedule behaves the way every character behaved before this existed, so
 * failing closed costs nothing.
 */
export async function forgeSchedule(state: SaveState, charId: string, model: string): Promise<ForgedSchedule | null> {
  const c = state.characters?.[charId];
  if (!c || charId === "char_player") return null;

  let raw: { home?: string; note?: string; blocks?: Partial<ScheduleBlock>[] } = {};
  try {
    const msgs = buildMessages(SCHEDULE_SYSTEM, "CHARACTER:", brief(state, charId), model);
    const out = await complete(msgs, model, model, true, 1200);
    raw = safeJson<typeof raw>(out.text, {});
  } catch {
    return null;
  }

  const blocks = (raw.blocks ?? [])
    .filter((b) => String(b?.what ?? "").trim() && String(b?.where ?? "").trim())
    // Hours arrive as "HH:MM" strings; a block whose times cannot be read is dropped rather than
    // defaulted, because a silently-wrong hour puts somebody at work at midnight for the rest of the
    // save and looks exactly like the feature not working.
    .filter((b) => parseClock(b.start) !== null && parseClock(b.end) !== null)
    .map((b) => newBlock({ ...b, what: String(b.what), where: String(b.where), days: normalizeDays(b.days) }))
    .slice(0, 4);
  if (!blocks.length) return null;

  const schedule: Schedule = {
    blocks,
    home: String(raw.home ?? "").trim().slice(0, 80) || undefined,
    note: String(raw.note ?? "").trim().slice(0, 200) || undefined,
  };
  c.schedule = schedule;
  // A WEEK IS UPKEEP. An untracked character is one the engine spends nothing on — the same reason
  // authoring a want tracks somebody, and with more force here: an unfollowed character's schedule
  // would move them around a world nobody is watching, for nothing.
  c.tracked = true;
  return { name: c.name, blocks: blocks.length, schedule };
}
