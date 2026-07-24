
/**
 * MONTAGE â€” directed passage of time.
 *
 * The engine has two speeds: one turn, or a blind interlude. Neither can execute
 * an *intent* ("thirty days, we move in, the cats arrive, the taco argument
 * becomes ritual"). A montage is the middle layer: a plan, executed in beats,
 * where every beat writes through the existing ledgers.
 *
 * The invariant that keeps it from being a teleport: the ENGINE owns the
 * trajectory, the MODEL writes the weather. Edges walk toward their target
 * inside a per-beat envelope, so a beat can dip ("the first week was cold
 * silence") and still converge. The dips are the B and C the player is missing.
 *
 * This module is deliberately pure â€” no LLM calls, no state mutation. It is the
 * math the beat loop is held to, so it can be tested without spending a token.
 */
import type { SaveState } from "./types";
import { orientationCap } from "./desire";

export interface MontageBeat {
  span_days: number;
  goal: string;
}

export interface MontageEdgeTarget {
  from: string;
  to: string;
  warmth?: number;
  trust?: number;
  power?: number;
  roles?: string[];
}

export interface MontagePlan {
  checklist: string[];
  targets: MontageEdgeTarget[];
  beats: MontageBeat[];
  place_plan?: {
    create?: { name: string; description_facts?: string };
    player_moves_to?: string;
  };
  household_facts?: string[];
}

/**
 * Front-loaded share of the remaining distance for beat i (1-indexed) of n.
 *
 *   s_i = 2(n - i + 1) / (n(n + 1))
 *
 * The weights sum to exactly 1 across all beats, so walking each beat by
 * s_i Ã— (target âˆ’ current) converges on the target without ever overshooting.
 * Front-loading matters: the decision lands early, the long tail is texture.
 */
export function envelopeShare(i: number, n: number): number {
  if (n <= 0 || i < 1 || i > n) return 0;
  return (2 * (n - i + 1)) / (n * (n + 1));
}

/**
 * The most this beat may move an axis.
 *
 * `origin` MUST be the value at the START OF THE MONTAGE, not the current value.
 * The shares sum to 1 across the whole run, so they are shares of the ORIGINAL
 * distance. Applying them to the *remaining* distance double-discounts and the
 * walk stalls short of target forever â€” a 34â†’78 arc lands at 63 and the
 * relationship never actually arrives, which is the exact failure this feature
 * exists to fix. Capture origins once at plan time and pass them unchanged.
 */
export function edgeEnvelope(origin: number, target: number, i: number, n: number): number {
  return Math.round((target - origin) * envelopeShare(i, n));
}

/** Origin snapshot for every targeted axis, taken once before the first beat. */
export interface EdgeOrigins { [pairKey: string]: { warmth: number; trust: number; power: number } }

export const pairKey = (from: string, to: string) => `${from}->${to}`;

export function captureOrigins(state: SaveState, targets: MontageEdgeTarget[]): EdgeOrigins {
  const out: EdgeOrigins = {};
  for (const t of targets) {
    const e = state.world.edges.find((x) => x.from === t.from && x.to === t.to);
    out[pairKey(t.from, t.to)] = {
      warmth: e?.warmth ?? 0, trust: e?.trust ?? 0, power: e?.power ?? 0,
    };
  }
  return out;
}

/**
 * The full per-beat allowance for one edge. The beat-writer is told these
 * numbers and emits its own deltas inside them, so it can dip and recover while
 * the run as a whole still converges.
 */
export function beatAllowance(
  origins: EdgeOrigins, t: MontageEdgeTarget, i: number, n: number,
): { warmth: number; trust: number; power: number } {
  const o = origins[pairKey(t.from, t.to)] ?? { warmth: 0, trust: 0, power: 0 };
  return {
    warmth: t.warmth === undefined ? 0 : edgeEnvelope(o.warmth, t.warmth, i, n),
    trust: t.trust === undefined ? 0 : edgeEnvelope(o.trust, t.trust, i, n),
    power: t.power === undefined ? 0 : edgeEnvelope(o.power, t.power, i, n),
  };
}

/**
 * Split a day-span into beats. Fewer, longer beats for a quick montage; more,
 * shorter ones for a full-fidelity run. Always at least one beat, and the
 * remainder rides on the last beat so the days sum exactly.
 */
export function planBeats(days: number, granularity: "quick" | "standard" | "full"): number[] {
  const d = Math.max(1, Math.round(days));
  const perBeat = granularity === "quick" ? 10 : granularity === "standard" ? 4 : 1;
  const n = Math.max(1, Math.min(16, Math.round(d / perBeat)));
  const base = Math.floor(d / n);
  const spans = Array.from({ length: n }, () => Math.max(1, base));
  let used = spans.reduce((a, b) => a + b, 0);
  let k = 0;
  while (used < d) { spans[k % n]++; used++; k++; }
  while (used > d && spans.some((s) => s > 1)) {
    const idx = spans.findIndex((s) => s > 1);
    spans[idx]--; used--;
  }
  return spans;
}

/**
 * Deterministic pre-flight. Zero tokens. Warns, never blocks â€” the player is
 * sovereign over their own story, but they should know when a direction is
 * fighting the physics rather than discover it thirty in-world days later.
 */
export function preflightDirection(state: SaveState, direction: string, days?: number): string[] {
  const warnings: string[] = [];
  const text = direction.toLowerCase();

  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player") continue;
    if (!c.name || !text.includes(c.name.toLowerCase())) continue;
    if (c.status === "dead")
      warnings.push(`${c.name} is dead â€” a montage moves time forward, it can't bring her back.`);
    else if (c.status === "departed")
      warnings.push(`${c.name} has left the story â€” she won't be present unless the montage brings her back deliberately.`);
  }

  const romantic = /\b(love|lover|marry|married|move in|moving in|together|partner|romance|kiss|sleep with)\b/.test(text);
  if (romantic) {
    const named = Object.entries(state.characters).filter(
      ([id, c]) => id !== "char_player" && c.name && text.includes(c.name.toLowerCase()),
    );
    if (named.length === 0)
      warnings.push("This reads as a romance but names nobody â€” the montage will pick whoever is closest, which may not be who you meant.");
    // the desire model gates attraction by orientation; a montage that ignores it would
    // write an arc the engine then refuses to hold. Say so up front rather than 30 days in.
    const player = state.characters["char_player"];
    for (const [, c] of named) {
      if (!player) continue;
      const cap = orientationCap(c, player);
      if (cap !== null && cap <= 5)
        warnings.push(`${c.name} isn't oriented toward you by the engine's read â€” a romance arc here will fight the desire model. It'll still run if you mean it.`);
    }
  }

  // heavy arcs the skip will refuse to settle â€” say so before tokens are spent, not after
  if (typeof days === "number") {
    const ceiling = days <= 2 ? 2 : days <= 6 ? 3 : days <= 13 ? 4 : days <= 29 ? 5 : days <= 59 ? 6 : 7;
    const heavy = state.world.threads
      .filter((t) => t.status === "active" && (t.tension ?? 0) > ceiling)
      .map((t) => t.title);
    if (heavy.length)
      warnings.push(
        `A ${days}-day skip won't settle the heavy threads â€” ${heavy.slice(0, 3).join("; ")}${heavy.length > 3 ? `, +${heavy.length - 3} more` : ""}. Those resolve in scenes you play.`,
      );
  }

  if (!/\d/.test(text) && direction.trim().length < 12)
    warnings.push("Very short direction â€” the planner has little to work from. More specifics land more of the checklist.");

  return warnings;
}

/**
 * Score the plan's checklist against what the beats actually landed. Items the
 * run missed get surfaced so the player can weave them in rather than
 * discovering the cats never arrived.
 */
export function scoreChecklist(checklist: string[], landed: string[]): { item: string; landed: boolean }[] {
  const done = landed.map((l) => l.toLowerCase());
  return checklist.map((item) => ({
    item,
    landed: done.some((d) => d.includes(item.toLowerCase()) || item.toLowerCase().includes(d)),
  }));
}

