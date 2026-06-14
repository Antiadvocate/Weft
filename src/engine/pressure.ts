/**
 * Pressure controller — replaces the Threat Director LLM call. Zero tokens.
 *
 * Model: scene pressure P_t ∈ [0,10] drawn from a difficulty-defined target
 * mixture, corrected by a proportional controller on the rolling empirical
 * mean (so long-run distribution converges to target — verified by Monte
 * Carlo in verify/verify.ts), with hard constraints:
 *   C1 opening grace:        t ≤ 2 ⇒ P ≤ 2
 *   C2 breath rule:          mean(P_{t-2}, P_{t-1}) ≥ 7 ⇒ P ≤ 4
 *   C3 lethality ceiling:    lethality=low ⇒ P ≤ 9; medium ⇒ ≤ 10 with cause
 *   C4 earned danger:        P ≥ 8 requires max(thread tension, clock heat) ≥ 6
 *   C5 mundane default:      restful intents bias the draw down 2 bands
 *
 * The fiction-awareness the old LLM director provided is recovered from
 * state: thread tension (set by the Simulator), due consequences, and
 * faction clock heat feed an additive "fiction heat" term — so pressure is
 * still earned by the story, just computed instead of asked for.
 */
import type { DifficultyProfile, Thread, ConsequenceEvent, FactionClock } from "./types";

export interface PressureInput {
  turn: number;
  trace: number[];                 // prior pressures
  difficulty: DifficultyProfile;
  threads: Thread[];
  consequences: ConsequenceEvent[];
  clocks: FactionClock[];
  action: string;                  // player's typed intent
  instability?: number;            // 0..1 from the Undertow — chaotic regimes run hotter
  rng?: () => number;              // injectable for verification
}

export interface PressureVerdict {
  pressure: number;
  band: "calm" | "friction" | "obstacle" | "danger" | "lethal";
  source: string;                  // one-line rationale traceable to state
  due_consequence?: ConsequenceEvent;
}

/** Target band probabilities by friction density: [calm, friction, obstacle, danger, lethal] */
export const TARGETS: Record<DifficultyProfile["friction_density"], number[]> = {
  sparse:   [0.50, 0.35, 0.12, 0.025, 0.005],
  balanced: [0.30, 0.40, 0.20, 0.08, 0.02],
  dense:    [0.15, 0.40, 0.30, 0.12, 0.03],
};
export const BAND_RANGES: [number, number][] = [[0, 2], [3, 5], [6, 7], [8, 9], [10, 10]];
export const BAND_NAMES = ["calm", "friction", "obstacle", "danger", "lethal"] as const;

const RESTFUL = /\b(rest|sleep|eat|drink|sit|relax|talk|chat|walk|stroll|read|wash|bathe|cook|tend|mend|browse|listen|watch|wait)\b/i;

export function bandMean(target: number[]): number {
  return target.reduce((s, p, i) => s + p * ((BAND_RANGES[i][0] + BAND_RANGES[i][1]) / 2), 0);
}

export function fictionHeat(threads: Thread[], clocks: FactionClock[], consequences: ConsequenceEvent[], turn: number): { heat: number; source: string } {
  let heat = 0;
  let source = "ambient world texture";
  const hot = threads.filter((t) => t.status === "active").sort((a, b) => b.tension - a.tension)[0];
  if (hot && hot.tension > heat) { heat = hot.tension; source = `thread: ${hot.title}`; }
  for (const c of clocks) {
    if (c.status !== "running" || c.segments === 0) continue;
    const h = (c.filled / c.segments) * 8;
    if (h > heat) { heat = h; source = `clock: ${c.faction} — ${c.objective}`; }
  }
  const due = consequences.find((c) => c.status === "pending" && c.fire_turn <= turn);
  if (due) {
    const h = due.severity === "major" ? 8 : due.severity === "notable" ? 6 : 4;
    if (h >= heat) { heat = h; source = `consequence due: ${due.description}`; }
  }
  return { heat, source };
}

export function decidePressure(input: PressureInput): PressureVerdict {
  const rng = input.rng ?? Math.random;
  const target = TARGETS[input.difficulty.friction_density];

  // proportional correction: shift band probabilities toward target mean
  const window = input.trace.slice(-12);
  const mean = window.length ? window.reduce((a, b) => a + b, 0) / window.length : bandMean(target);
  const err = bandMean(target) - mean;                 // >0 ⇒ we've been too quiet
  const kP = 0.10;                                     // gentle gain (stability proven in verify)
  const tilt = Math.max(-0.3, Math.min(0.3, kP * err));

  // tilted band distribution: move mass between calm and {obstacle,danger}
  const p = [...target];
  const shift = Math.abs(tilt);
  if (tilt > 0) { const take = Math.min(p[0], shift); p[0] -= take; p[2] += take * 0.7; p[3] += take * 0.3; }
  else if (tilt < 0) { const take = Math.min(p[2] + p[3], shift); const t2 = Math.min(p[2], take * 0.7), t3 = Math.min(p[3], take * 0.3); p[2] -= t2; p[3] -= t3; p[0] += t2 + t3; }

  // sample band
  let r = rng(), band = 0;
  for (let i = 0; i < p.length; i++) { r -= p[i]; if (r <= 0) { band = i; break; } if (i === p.length - 1) band = i; }

  // fiction heat: pressure ≥ 8 must be earned (C4); heat also pulls band up
  let { heat, source } = fictionHeat(input.threads, input.clocks, input.consequences, input.turn);
  if (input.instability) {
    heat = Math.min(10, heat + input.instability * 2);
    if (input.instability >= 1) source = source === "quiet — the world breathes" ? "the undertow — the world is primed" : source + " (amplified by the undertow)";
  }
  const due = input.consequences.find((c) => c.status === "pending" && c.fire_turn <= input.turn);
  if (due && due.severity !== "minor") band = Math.max(band, due.severity === "major" ? 3 : 2);
  if (band >= 3 && heat < 6) band = 2;                 // C4: unearned danger demoted to obstacle
  if (band === 4 && (input.difficulty.lethality === "low" || heat < 8)) band = 3; // C3 + earned-lethal

  // restful intent bias (C5): drop up to 2 bands when nothing is due
  if (RESTFUL.test(input.action) && !due && heat < 5) band = Math.max(0, band - 2);

  // breath rule (C2)
  const last2 = input.trace.slice(-2);
  if (last2.length === 2 && (last2[0] + last2[1]) / 2 >= 7) band = Math.min(band, 1);

  // opening grace (C1)
  if (input.turn <= 2) band = 0;

  // pressure within band, leaning low
  const [lo, hi] = BAND_RANGES[band];
  const pressure = Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1) * 0.9));
  // lethality cap (C3)
  const capped = input.difficulty.lethality === "low" ? Math.min(9, pressure) : pressure;

  return {
    pressure: capped,
    band: BAND_NAMES[band],
    source: band === 0 ? "quiet — the world breathes" : source,
    due_consequence: due,
  };
}

/** Compact directive injected into the narrator's volatile digest. */
export function pressureDirective(v: PressureVerdict, palette?: string[]): string {
  const lines = [`PRESSURE ${v.pressure}/10 (${v.band}) — source: ${v.source}.`];
  if (v.pressure <= 2) lines.push("No complication. No hostile interest. Let the scene simply be a scene.");
  if (v.pressure >= 3 && v.pressure <= 5) lines.push("Minor friction only: a small cost, a social wrinkle, weather, a tool failing. No injury.");
  if (v.pressure >= 6 && v.pressure <= 7) lines.push("A real obstacle to work through — social, emotional, or practical. No physical danger yet.");
  if (v.pressure >= 8) lines.push("Real danger with built-up cause already in the state. Nothing arrives from thin air.");
  if (v.due_consequence) lines.push(`A scheduled consequence reaches the scene NOW: ${v.due_consequence.description}`);
  if (palette?.length) lines.push(`Draw pressure only from: ${palette.join("; ")}.`);
  return lines.join(" ");
}
