// OFFSTAGE — the world moving while nobody is watching it.
//
// Weft already simulates a lot in the background, but all of it is INTERNAL to characters: drives
// tick, wants regenerate, psyches settle, traits consolidate, rumors spread. What never happened
// was the world CHANGING — a steading burning, a herd lost, a kindred paying tribute late, a
// boat not coming back. So when the game went quiet the only source of new material was the
// pressure system, which manufactured something aimed at the player because that was its job.
// That's what made the story feel railroaded: the only thing that ever happened was you.
//
// This replaces that. Every OFFSTAGE_INTERVAL_MIN of IN-WORLD time it takes the world state and
// asks what happened elsewhere, under one hard constraint: none of it may be about the player.
// Not aimed at them, not caused by them, not a reaction to them, not staged for them to find.
//
// The events don't reach the player directly. They reach WITNESSES, who form memories, which seed
// rumors, which diffuse across the co-presence graph at the speed of people walking between
// places. So you learn the world changed the way you'd learn it — because someone told someone
// who told you, weeks late and half wrong. The emergence isn't in the event generator. It's in
// what the existing systems do with the event once it exists.

import { buildMessages, complete, safeJson } from "../llm";
import { uid } from "./state";
import { minutesBetween } from "./time";

/** In-world minutes between offstage passes. The world doesn't reorganize itself hourly. */
export const OFFSTAGE_INTERVAL_MIN = 360;

export interface OffstageEvent {
  actor: string;        // WHO did it — a named person, kindred, faction, or a force (weather, sickness)
  place: string;        // where it happened
  what: string;         // one plain sentence, past tense
  witnesses: string[];  // names of tracked characters who saw or heard it firsthand; may be empty
  new_place?: string;   // a place this event brought into being, if any
  advances?: string;    // exact faction name whose clock this event moved a step, if any
}

const OFFSTAGE_SYSTEM = `You are the world's own motion. You report what happened ELSEWHERE, to people who were not thinking about the protagonist.

THE ONE RULE: nothing you write may involve, mention, target, describe, anticipate, or be caused by the player character. Not as a subject, not as a rumor's topic, not as someone's motive, not as a threat forming, not as a discovery waiting to be found. If an event only makes sense because the player exists, it is invalid. The world was here first and is busy.

What you SHOULD write: the ordinary consequential business of this place. A debt called in. A herd sickening. A boat overdue. A marriage negotiated between two kindreds. A hostage returned or not returned. Someone dying of something dull. A field flooding. A quarrel over a boundary stone that has been running for years and got worse. A faction advancing its own stated objective by a step. Weather doing what weather does at this latitude in this season. Small, specific, and consequential to the people it happened to.

Each event must be CAUSED by something already in the world state: a named person acting on a want they already have, a faction pursuing the objective already written for it, a season, an animal, an illness, a grudge already recorded. Do not introduce a new faction or a new named power. You may bring a small new PLACE into being if the event requires one (a burned steading, a camp, a new weir) — name it as a person would say it aloud.

WITNESSES matter more than the event. List, by exact name, only tracked characters from the CAST who would plausibly have seen or heard this firsthand, given where they are. Most events have no tracked witness at all, and an empty list is the correct and common answer. Do not place a witness somewhere convenient. Do not invent names.

FACTION CLOCKS ADVANCE HERE, OR NOWHERE. A faction pursuing an objective the player never sees is doing that work offstage, in ordinary steps: a testimony taken, a boundary walked, a payment made, a page finished, a rider sent. When one of your events IS such a step for one of the listed factions, set "advances" to that faction's exact name. This is the ONLY way their clocks move — a clock the player never walks into otherwise sits frozen forever, which is not the world being patient, it is the world being dead. Do not attribute an event to a faction it has nothing to do with, and do not invent activity for a faction whose objective the state gives you no way to progress.

Write 1–3 events. Fewer is right when the world state gives you little. An interval where almost nothing happened is a valid report.

Output ONLY this JSON:
{"events":[{"actor":"","place":"","what":"","witnesses":[],"new_place":"","advances":""}]}`;

function worldDigest(state: any): string {
  const places = Object.values<any>(state.world?.places ?? {})
    .filter((p) => p.id !== "loc_offscene")
    .map((p) => `- ${p.name}: ${p.description_facts ?? ""}`).join("\n");

  const cast = Object.entries<any>(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed")
    .map(([id, c]) => {
      const where = state.world.places[c.location]?.name ?? "unknown";
      const wants = (c.drive_goals ?? [c.drive_goal]).filter(Boolean).join("; ");
      return `- ${c.name}, at ${where}. Wants: ${wants || "nothing pressing"}.`;
    }).join("\n");

  const clocks = (state.world?.clocks ?? [])
    .filter((c: any) => c.status === "running")
    .map((c: any) => `- ${c.faction}: ${c.objective} (${c.filled}/${c.segments})`).join("\n");

  const threads = (state.world?.threads ?? [])
    .filter((t: any) => t.status === "active")
    .map((t: any) => `- ${t.title}: ${t.description ?? ""}`).join("\n");

  const recent = (state.world?.offstage_log ?? []).slice(-8)
    .map((e: any) => `- ${e.what}`).join("\n");

  const b = state.world_bible ?? {};
  return [
    `SETTING: ${b.name ?? ""} — ${b.era ?? ""}`,
    `MATERIAL WORLD: ${b.technology_level ?? ""}`,
    `CLIMATE AND SEASON: ${b.climate_and_geography ?? ""}. It is now ${state.world?.current_time ?? ""}, weather ${state.world?.weather ?? ""}.`,
    `WHAT PEOPLE HERE FEAR: ${b.what_people_fear ?? ""}`,
    `POLITICS: ${b.political_situation ?? ""}`,
    `\nPLACES:\n${places}`,
    `\nCAST (the only names you may use as witnesses):\n${cast}`,
    clocks ? `\nFACTIONS AND WHAT THEY ARE ALREADY PURSUING:\n${clocks}` : "",
    threads ? `\nOPEN QUESTIONS IN THE WORLD:\n${threads}` : "",
    recent ? `\nALREADY REPORTED — do not repeat or continue these:\n${recent}` : "",
  ].filter(Boolean).join("\n");
}

/** True when enough in-world time has passed since the last offstage pass. */
export function offstageDue(state: any): boolean {
  const last = state.world?.offstage_last_time;
  if (!last) return true;
  return minutesBetween(last, state.world.current_time) >= OFFSTAGE_INTERVAL_MIN;
}

/**
 * Run the world forward offstage. Returns log lines for the offscreen feed.
 *
 * Everything this produces enters the world through the SAME doors as anything else: witnesses get
 * memories, memories seed rumors, rumors diffuse. Nothing here is handed to the narrator as a plot
 * point, and nothing here is guaranteed to reach the player at all. Some of it never will, which
 * is the point — a world with events the player never learns about is a world, and one where
 * every event finds its way to the protagonist is a story pretending to be one.
 */
export async function runOffstage(state: any, model: string): Promise<string[]> {
  if (!offstageDue(state)) return [];
  state.world.offstage_last_time = state.world.current_time;

  let events: OffstageEvent[] = [];
  try {
    const msgs = buildMessages(OFFSTAGE_SYSTEM, "WORLD STATE:", worldDigest(state), model);
    const out = await complete(msgs, model, model, true, 1200);
    events = safeJson<{ events?: OffstageEvent[] }>(out.text, {}).events ?? [];
  } catch {
    return [];
  }

  const byName = new Map<string, string>();
  for (const [id, c] of Object.entries<any>(state.characters ?? {})) {
    if (id !== "char_player") byName.set(c.name.toLowerCase(), id);
  }

  const log: string[] = [];
  const turn = state.world.current_turn ?? 0;

  for (const ev of events.slice(0, 3)) {
    if (!ev?.what) continue;

    // A place the event brought into being. The forge's ten were never meant to be the whole
    // world forever — a world that cannot grow new ground is a stage set.
    if (ev.new_place?.trim()) {
      const name = ev.new_place.trim().slice(0, 60);
      const exists = Object.values<any>(state.world.places).some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!exists) {
        const pid = uid("loc");
        state.world.places[pid] = { id: pid, name, description_facts: ev.what.slice(0, 160), contains: [], founding: false };
      }
    }

    (state.world.offstage_log ??= []).push({ turn, time: state.world.current_time, what: ev.what, place: ev.place, actor: ev.actor });

    // Witnesses get a real memory. This is the ONLY channel by which an offstage event can ever
    // reach the player — through a person who was there, then through whoever they talk to.
    // No witnesses means the world changed and nobody in play knows it yet. That is allowed.
    for (const w of ev.witnesses ?? []) {
      const id = byName.get(String(w).toLowerCase().trim());
      if (!id) continue;                        // never invent a witness the cast doesn't contain
      const mem = (state.memory[id] ??= { character_id: id, core: [], episodic: [], beliefs: [], facts: [], knows: [] });
      mem.episodic.push({
        id: uid("mem"),
        turn,
        content: ev.what.slice(0, 200),
        importance: 7,                          // at the gossip threshold: worth repeating, not world-ending
        source: "witnessed",
        where: ev.place,
        when_label: state.world.current_time,
        emotional_charge: 0,
        decay: 0,
      });
    }

    // A step taken offstage by a faction the player never sees. This is the missing half of the
    // knowledge gate: gating advancement on demonstrated action was right, but the only place the
    // simulator could demonstrate it was a scene the player was IN — and forge clocks are now
    // deliberately NOT pointed at the player, so their factions never appeared and both clocks in a
    // 108-turn game sat at 0/6, never advancing once. The world's own motion is where they move.
    if (ev.advances) {
      const clock = state.world.clocks.find(
        (c: any) => c.status === "running" && c.faction.toLowerCase() === String(ev.advances).toLowerCase().trim(),
      );
      if (clock && clock.filled < clock.segments) {
        clock.filled += 1;
        clock.last_advanced_time = state.world.current_time;
        const signs = clock.visible_signs ?? [];
        const frac = clock.filled / Math.max(1, clock.segments);
        if (signs.length && frac >= 0.5) log.push(`SIGN (${clock.faction}): ${signs[Math.min(signs.length - 1, frac >= 0.85 ? signs.length - 1 : 0)]}`);
        log.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
      }
    }

    log.push(`Elsewhere: ${ev.what}`);
  }

  return log;
}
