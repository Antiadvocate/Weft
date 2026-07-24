
/**
 * PSYCHIC — two pure derivations off data the engine already keeps.
 *
 *   previouslyHere()  — the player's own memories of the place they're standing in.
 *                       Locations get a memory without spending a token.
 *   dueSoon()         — pending consequences the player's own actions set in motion,
 *                       arriving within a couple of in-world days. Free dread, and
 *                       it makes the consequence system feel FAIR rather than random.
 *
 * Both read straight from the client save. No LLM, no writes, no new state.
 */
import type { ClientSave } from "./api";
import { absMinutes } from "../engine/time";

export interface RecallLine {
  key: string;
  text: string;
  when?: string;
  shared?: string;   // name of a present character who was also there
}

/**
 * The freshest one or two things the player remembers about where they are.
 *
 * `where` drops off a memory as it decays (stage 2+ loses the place), so this
 * naturally surfaces sharper memories and lets faded ones fall away — which is
 * the correct behaviour, not a limitation: you don't get a crisp recollection of
 * a room you barely remember being in.
 */
export function previouslyHere(save: ClientSave, limit = 2): RecallLine[] {
  const placeName = save.world.places[save.world.player_location]?.name;
  if (!placeName) return [];
  const here = placeName.toLowerCase();

  const mine = save.memory["char_player"]?.episodic ?? [];
  const currentTurn = save.world.current_turn;

  const hits = mine
    .filter((m) => {
      if (!m.where) return false;
      const w = m.where.toLowerCase();
      // match the locale, so "The Ray Deck (galley)" still counts as the Ray Deck
      return w === here || w.includes(here) || here.includes(w);
    })
    // don't surface what just happened — this is for RE-entry, not the current scene
    .filter((m) => currentTurn - (m.turn ?? 0) >= 3)
    .sort((a, b) => {
      const imp = (b.importance ?? 0) - (a.importance ?? 0);
      return imp !== 0 ? imp : (b.turn ?? 0) - (a.turn ?? 0);
    })
    .slice(0, limit);

  // if someone present shares a memory of this place, say so — one line, no call
  const presentNames = new Map<string, string>();
  for (const id of save.world.present) {
    if (id === "char_player") continue;
    const c = save.characters[id];
    if (!c) continue;
    const theirs = (save.memory[id]?.episodic ?? []).some((m) => {
      if (!m.where) return false;
      const w = m.where.toLowerCase();
      return w === here || w.includes(here) || here.includes(w);
    });
    if (theirs) presentNames.set(id, c.name);
  }
  const sharedWith = [...presentNames.values()][0];

  return hits.map((m, i) => ({
    key: `rec-${m.turn}-${i}`,
    text: m.content,
    when: m.when_label,
    shared: i === 0 ? sharedWith : undefined,
  }));
}

export interface DueSoonLine {
  key: string;
  text: string;
  severity: "minor" | "notable" | "major";
  hours: number;      // in-world hours until it fires
  mine: boolean;      // set in motion by the player's own actions
}

/**
 * Pending consequences arriving within `withinDays` in-world days.
 *
 * Only things already scheduled — this never invents dread. Player-sourced ones
 * are marked so the UI can lead with them: a storm you can see coming because of
 * something you did is tension; one that arrives unannounced is just noise.
 */
export function dueSoon(save: ClientSave, withinDays = 2): DueSoonLine[] {
  const now = absMinutes(save.world.current_time);
  const horizon = withinDays * 1440;

  return (save.world.consequences ?? [])
    .filter((c) => c.status === "pending")
    .map((c) => {
      const mins = c.fire_time ? absMinutes(c.fire_time) - now : NaN;
      return { c, mins };
    })
    .filter(({ mins }) => Number.isFinite(mins) && mins >= 0 && mins <= horizon)
    .sort((a, b) => a.mins - b.mins)
    .slice(0, 3)
    .map(({ c, mins }) => ({
      key: c.id,
      text: c.description,
      severity: c.severity,
      hours: Math.round(mins / 60),
      mine: c.source_char === "char_player",
    }));
}

/** "in ~3h" / "in ~1 day" — vague on purpose; the engine knows the minute, the player shouldn't. */
export function dueLabel(hours: number): string {
  if (hours <= 1) return "within the hour";
  if (hours < 20) return `in ~${hours}h`;
  const days = Math.round(hours / 24);
  return days <= 1 ? "in ~a day" : `in ~${days} days`;
}

