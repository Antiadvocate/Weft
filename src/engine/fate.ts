
// FATE — the destination as a scheduled event.
//
// A destination is an ending plus a number of turns: "in 30 turns, he has built the shelter." The
// turn count is the only clock. Progress is turns elapsed over turns budgeted — a fact, not a
// judgment. It cannot stall because a model failed to notice the story moved, and it has nothing to
// do with the chapter cadence, which exists to summarize history and save context.
//
// The chapter auditor still reads the story, but only to describe what is still missing between here
// and the ending. That description is passed to the narrator. It never decides when the ending lands.
//
// As turns run out, fate takes more of the world: threads that do not serve the ending lose their
// pull, faction clocks turn toward it, pressure gets a floor. At zero turns, the ending is written.

import type { SaveState, Thread } from "./types";

export type Act = "open" | "rising" | "closing" | "convergence" | "arrival";

export interface Fate {
  active: boolean;          // destination + budget exist, and the ending has not landed
  destination: string;
  act: Act;
  turnsUsed: number;
  turnsLeft: number;        // can go negative
  budget: number;
  pct: number;              // turns elapsed / budget, 0..100. The clock IS the progress.
  authority: number;        // 0..1, same as fraction of budget spent
  forceArrival: boolean;    // budget spent: write the ending now
}

/** Where the story stands against its clock. Deterministic; no model involved. */
export function readFate(state: SaveState): Fate {
  const b = state.world_bible;
  const dest = (b.destination ?? "").trim();
  const budget = Math.max(0, Math.round(b.destination_turns ?? 0));
  const started = b.destination_set_turn ?? 0;
  const turnsUsed = Math.max(0, state.world.current_turn - started);
  const turnsLeft = budget - turnsUsed;
  const landed = !!b.destination_reached;
  const active = !!dest && budget > 0 && !landed;

  const fraction = budget > 0 ? Math.min(1, turnsUsed / budget) : 0;
  const pct = Math.round(fraction * 100);

  // Acts are proportions of the budget, not fixed turn counts: a 5-turn story spends one turn per
  // act, a 60-turn story spends twelve. A short budget still passes through every act.
  const act: Act = !active ? (landed ? "arrival" : "open")
    : turnsLeft <= 0 ? "arrival"
    : fraction >= 0.8 ? "convergence"
    : fraction >= 0.55 ? "closing"
    : fraction >= 0.25 ? "rising"
    : "open";

  return { active, destination: dest, act, turnsUsed, turnsLeft, budget, pct, authority: active ? fraction : 0, forceArrival: active && turnsLeft <= 0 };
}

/** The narrator's orders this turn. Empty when there is no destination or no clock, so open play is
 *  untouched. `missing` is the auditor's description of the remaining gap, when it has one. */
export function fateDirective(f: Fate, missing?: string): string {
  if (!f.active) return "";
  const n = f.turnsLeft;
  const turns = `${n} turn${n === 1 ? "" : "s"}`;
  const gap = missing?.trim() ? ` What still stands in the way: ${missing.trim()}` : "";

  if (f.forceArrival) {
    return `\n\nWRITE THE ENDING IN THIS SCENE. The story was set to end with: "${f.destination}". The turns allotted for it are spent. That ending has to happen here, completely — not approach, not become imminent. If the player worked toward it, they get it and it means something. If they spent the story elsewhere, it still happens, but through someone else's choice or at a price they did not agree to. Do not stop short of it.`;
  }
  if (f.act === "convergence") {
    return `\n\nThe story ends in ${turns} with: "${f.destination}".${gap} Everything in this scene should shorten that distance. Whoever and whatever that ending needs is here now, or arrives this turn. Do not open a new subject. The player still chooses how it goes, and can still choose badly, but the scene should leave them nearer the ending than it found them.`;
  }
  if (f.act === "closing") {
    return `\n\nThe story ends in ${turns} with: "${f.destination}".${gap} The world is beginning to arrange itself around that. Raise the complications that force the question rather than postpone it. Roads the player walked away from do not stay open. Do not spend this scene on something unrelated.`;
  }
  if (f.act === "rising") {
    return `\n\nThe story ends in ${turns} with: "${f.destination}".${gap} Let this scene bring it nearer, or make its cost clearer. Choose frictions that lie between here and there.`;
  }
  return `\n\nThis story ends in ${turns} with: "${f.destination}". That is still far off; leave the player free. Plant what will matter later — a want, an obstacle, a fact.`;
}

/** What the world does as the ending nears. Threads and clocks are the machinery the story runs on;
 *  a note to the narrator leaves them pulling elsewhere. Mutates state; returns lines for the log. */
export function enforceFate(state: SaveState, f: Fate): string[] {
  if (!f.active || f.act === "open") return [];
  const out: string[] = [];
  const threads = state.world.threads ?? [];

  const servesEnding = (t: Thread): boolean => {
    const words = f.destination.toLowerCase().match(/[a-z']{5,}/g) ?? [];
    const hay = `${t.title} ${t.description}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  };

  // The ending becomes a thread, so the existing pressure system can select it as a beat.
  let spine = threads.find((t) => t.id === "thread_fate");
  if (!spine) {
    spine = { id: "thread_fate", title: f.destination.split(/[.,;]/)[0].trim().slice(0, 60), status: "active", description: f.destination.slice(0, 240), turn_started: state.world.current_turn, tension: 5 };
    threads.push(spine);
    state.world.threads = threads;
  }
  if (spine.status === "active") {
    const want = Math.round(Math.min(10, 4 + (f.pct / 100) * 6));
    if (want > spine.tension) spine.tension = want;
  }

  // From the closing act on, unrelated threads stop pressing. They still happened — they just stop
  // competing for the scene. At convergence they close.
  if (f.act !== "rising") {
    for (const t of threads) {
      if (t.status !== "active" || t.id === "thread_fate" || servesEnding(t)) continue;
      t.tension = Math.max(0, t.tension - (f.act === "closing" ? 2 : 4));
      if (t.tension === 0 && f.act !== "closing") {
        t.status = "abandoned";
        t.turn_resolved = state.world.current_turn;
        out.push(`"${t.title}" is set aside`);
      }
    }
  }

  // Faction clocks stop pursuing their own agendas once the ending is close.
  if ((f.act === "convergence" || f.act === "arrival") && state.world.clocks?.length) {
    for (const c of state.world.clocks) {
      if (c.status !== "running" || c.filled >= c.segments) continue;
      c.filled = Math.min(c.segments, c.filled + Math.max(1, Math.round(c.segments * 0.25)));
      if (c.filled >= c.segments) { c.status = "fired"; out.push(`${c.faction} reaches "${c.objective}"`); }
    }
  }

  return out;
}

/** Fate never quiets a scene; it only keeps the world from sleeping through the ending. */
export function fatePressureFloor(f: Fate): number {
  if (!f.active) return 0;
  if (f.forceArrival) return 8;
  if (f.act === "convergence") return 6;
  if (f.act === "closing") return 3;
  return 0;
}

/** Did the player drive the ending, or did the clock? Recorded when it lands. */
export function outcomeOf(f: Fate, playerDrove: boolean): "earned" | "forced" {
  return playerDrove ? "earned" : "forced";
}

