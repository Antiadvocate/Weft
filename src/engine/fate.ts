// FATE — the destination as a thing that HAPPENS, not a thing that is hoped for.
//
// A destination without a clock is gravity: it bends the story and can be ignored forever. A
// destination WITH a turn budget is fate: the ending arrives inside the budget, well or badly, and
// the only negotiable thing is the road. That distinction is the whole module.
//
// Fate escalates in five acts as the budget burns. Early on it barely touches the world — the player
// is free and the ending is far. Late, it seizes the machinery: threads that do not serve the ending
// are collapsed, clocks are pointed at it, pressure is forced upward, and the narrator is told, in
// terms it cannot mistake, that the scene must close the distance THIS TURN.
//
// The ending may arrive as triumph, as ruin, or hollow — earned, catastrophic, or empty. What it may
// not do is fail to arrive. Running out of budget with the ending unreached is not a stalemate; it is
// the ruinous form of the ending, and the engine says so.

import type { SaveState, Thread } from "./types";

export type Act = "open" | "rising" | "closing" | "convergence" | "arrival";

export interface Fate {
  active: boolean;          // a destination AND a budget exist and it has not yet landed
  destination: string;
  act: Act;
  turnsUsed: number;
  turnsLeft: number;        // may go negative — overrun means the ending lands hard
  budget: number;
  fraction: number;         // 0..1+ of the budget spent
  pct: number;              // progress toward the ending, 0..100 (auditor's reading)
  authority: number;        // 0..1 — how much of the world fate may seize this turn
  behind: boolean;          // progress is lagging the clock badly
  forceArrival: boolean;    // the budget is spent: the ending happens NOW, by any road
}

/** Where the story stands against its clock. Cheap; safe to call every turn. */
export function readFate(state: SaveState): Fate {
  const b = state.world_bible;
  const dest = (b.destination ?? "").trim();
  const budget = Math.max(0, Math.round(b.destination_turns ?? 0));
  const started = b.destination_set_turn ?? 0;
  const turnsUsed = Math.max(0, state.world.current_turn - started);
  const turnsLeft = budget - turnsUsed;
  const fraction = budget > 0 ? turnsUsed / budget : 0;
  const pct = state.destination_progress?.pct ?? 0;
  const landed = !!b.destination_reached || !!state.destination_progress?.reached;
  const active = !!dest && budget > 0 && !landed;

  // The act is set by the clock, not by progress — a story that has done nothing with three turns
  // left is still in its final act, and fate must drag it there. Progress only decides how violent
  // that dragging has to be.
  const act: Act = !active ? (landed ? "arrival" : "open")
    : fraction >= 1 ? "arrival"
    : fraction >= 0.85 ? "convergence"
    : fraction >= 0.6 ? "closing"
    : fraction >= 0.25 ? "rising"
    : "open";

  // Authority = how far behind the story is, weighted by how late it is. A story on pace keeps its
  // freedom; a story that has burned 80% of the clock at 10% progress gets seized.
  const expected = Math.min(100, fraction * 100);
  const deficit = Math.max(0, expected - pct) / 100;
  const authority = active ? Math.min(1, fraction * 0.55 + deficit * 0.9) : 0;

  return {
    active, destination: dest, act, turnsUsed, turnsLeft, budget, fraction, pct,
    authority, behind: active && deficit > 0.25,
    forceArrival: active && turnsLeft <= 0,
  };
}

/** How the ending lands, judged when it lands. Progress buys triumph; a spent clock buys ruin. */
export function outcomeOf(f: Fate): "triumph" | "ruin" | "hollow" {
  if (f.pct >= 75) return "triumph";
  if (f.forceArrival && f.pct < 40) return "ruin";
  return "hollow";
}

/** The narrator's marching orders. Empty string when no destination or no clock — open play is
 *  untouched. This is appended to the pressure directive, so it speaks with the same authority. */
export function fateDirective(f: Fate): string {
  if (!f.active) return "";
  const left = f.turnsLeft;
  const dest = f.destination;

  if (f.forceArrival) {
    return `\n\nFATE — THE ENDING ARRIVES NOW. The story's stated ending is: "${dest}". The turn budget is spent. This scene brings that ending to pass — not near, not imminent, ARRIVED — by whatever road the fiction can bear. If the player earned it, they get it whole. If they squandered the story, it arrives ruined: the ending happens TO them rather than through them, at a cost they did not choose, in a shape they did not want. Either way it happens in this scene. Do not defer it. Do not gesture at it. Do not end this turn on the brink of it. Write the ending.`;
  }

  if (f.act === "convergence") {
    return `\n\nFATE — CONVERGENCE (${left} turn${left === 1 ? "" : "s"} remain). The ending is: "${dest}". Everything in this scene now serves its arrival. Collapse distance: the people, places, and pressures needed for that ending are HERE or arrive this turn. No new subject may be introduced that does not bear on it. Every character wants something that pushes the story onto it — including the ones who want to stop it. The player may still choose HOW, and may still choose badly; they may no longer choose something else. Close the distance hard this turn.${f.behind ? " The story is badly behind its ending; take a large step, not a small one." : ""}`;
  }

  if (f.act === "closing") {
    return `\n\nFATE — CLOSING (${left} turns remain). The ending is: "${dest}". The world has begun to arrange itself around it. Raise complications that force the question rather than defer it; let characters act on wants that bear on this ending. Alternatives narrow — a road the player abandoned does not stay open, and drifting has a cost that shows. Do not resolve it yet, but do not let this scene be about something else.${f.behind ? " The story is well behind its ending; the world presses harder now — a door closes, a cost lands, someone forces the issue." : ""}`;
  }

  if (f.act === "rising") {
    return `\n\nFATE — RISING (${left} turns remain). The ending is: "${dest}". Let this scene make it nearer or make its price clearer. The frictions you raise should be the ones that stand between here and there.${f.behind ? " Progress is lagging; introduce a development that forces movement toward it." : ""}`;
  }

  return `\n\nFATE — the story is written toward: "${dest}" (${left} turns remain). It is far off. The player is free; let them be. Bend only lightly toward it — a want, an obstacle, a fact that will matter later.`;
}

/** What the WORLD must do to converge. Threads and clocks are the machinery the story actually runs
 *  on; a directive alone leaves them pulling elsewhere. In late acts fate reaches in and turns them.
 *  Returns humanized lines for the shift log; mutates state. */
export function enforceFate(state: SaveState, f: Fate): string[] {
  if (!f.active || f.authority < 0.35) return [];
  const out: string[] = [];
  const threads = state.world.threads ?? [];
  const open = threads.filter((t) => t.status === "active");

  const bearsOnEnding = (t: Thread): boolean => {
    const words = f.destination.toLowerCase().match(/[a-z']{5,}/g) ?? [];
    const hay = `${t.title} ${t.description}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  };

  // 1 ── the ending gets its own thread, and it outranks everything.
  const spineTitle = "The ending: " + f.destination.split(/[.,;]/)[0].trim().slice(0, 60);
  let spine = threads.find((t) => t.id === "thread_fate");
  if (!spine && f.act !== "open") {
    spine = { id: "thread_fate", title: spineTitle, status: "active", description: f.destination.slice(0, 240), turn_started: state.world.current_turn, tension: 5 };
    threads.push(spine);
    state.world.threads = threads;
    out.push(`the story's ending has become its central thread`);
  }
  if (spine && spine.status === "active") {
    // tension climbs with the clock; at convergence it is maximal and cannot be ignored
    const want = Math.round(Math.min(10, 4 + f.fraction * 6 + (f.behind ? 1 : 0)));
    if (want > spine.tension) { spine.tension = want; }
  }

  // 2 ── in closing and beyond, threads that do not serve the ending lose their grip. They are not
  //      erased (the player did those things; they happened) — they stop pressing. The world's
  //      attention narrows, which is what the end of a story feels like from the inside.
  if (f.act === "closing" || f.act === "convergence" || f.act === "arrival") {
    for (const t of open) {
      if (t.id === "thread_fate" || bearsOnEnding(t)) continue;
      const drop = f.act === "closing" ? 2 : 4;
      const before = t.tension;
      t.tension = Math.max(0, t.tension - drop);
      if (before > 0 && t.tension === 0 && f.act !== "closing") {
        t.status = "abandoned"; t.turn_resolved = state.world.current_turn;
        out.push(`"${t.title}" falls away — the story has room for one ending now`);
      }
    }
  }

  // 3 ── at convergence, faction clocks stop pursuing their own agendas and bear on the ending.
  if ((f.act === "convergence" || f.act === "arrival") && state.world.clocks?.length) {
    for (const c of state.world.clocks) {
      if (c.status !== "running" || c.filled >= c.segments) continue;
      const step = Math.max(1, Math.round((c.segments * (0.15 + f.authority * 0.2))));
      const before = c.filled;
      c.filled = Math.min(c.segments, c.filled + step);
      if (before < c.segments && c.filled >= c.segments) {
        c.status = "fired";
        out.push(`${c.faction} reaches "${c.objective}" — the world closes in`);
      }
    }
  }

  return out;
}

/** A floor under pressure. Fate cannot make a quiet scene loud, but it can forbid the world from
 *  being asleep while the ending waits. Returns the minimum pressure this turn. */
export function fatePressureFloor(f: Fate): number {
  if (!f.active) return 0;
  if (f.forceArrival) return 8;
  if (f.act === "convergence") return f.behind ? 7 : 6;
  if (f.act === "closing") return f.behind ? 5 : 3;
  return 0;
}
