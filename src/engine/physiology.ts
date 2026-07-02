/**
 * PHYSIOLOGY — deterministic, time-driven body simulation. Zero tokens.
 *
 * Hunger, thirst, and sleep pressure accrue from in-world elapsed time, scaled by body mass
 * (Kleiber-style ¾-power metabolic scaling) and weather. The LLM's only physiological job is
 * REFILLS — noticing that someone ate, drank, or slept — plus dramatic overrides (a battle can
 * still exhaust a rested body). The clock does the rest.
 *
 * The centerpiece: a physiological CEILING on relaxation. A body running on no sleep, no water,
 * or an empty stomach cannot be at ease no matter how sweet the scene — the ceiling clamps the
 * psyche's relaxation scalar (-10..+10) after every turn's psychological updates. Context can
 * lower you below the ceiling; nothing can lift you above it.
 *
 * Meters are 0–10 (0 = sated/fresh, 10 = starving/parched). Offscreen characters are assumed
 * self-maintaining — accrual runs only for the player and the present cast, because a person
 * living their life eats without being watched.
 */
import type { Condition, Identity } from "./types";

// ── accrual rates (meter points per hour, for a 70 kg body, temperate weather)
const HUNGER_PER_H = 10 / 16;   // empty → starving over ~16 waking hours
const THIRST_PER_H = 10 / 12;   // hydrated → parched over ~12 hours
const HOT = /\b(hot|scorch|blaz|swelter|heat ?wave|arid|parch)/i;

const massScale = (weight_kg?: number): number => Math.pow(Math.max(35, Math.min(180, weight_kg ?? 70)) / 70, 0.75);
const clamp10 = (x: number): number => Math.max(0, Math.min(10, x));

/** Advance the body clock by `minutes` of in-world time. `sleeping` halves hunger accrual,
 *  skips thirst-from-heat, and does NOT add waking minutes. */
export function accruePhysiology(cond: Condition, ident: Identity | undefined, minutes: number, weather: string, sleeping = false): void {
  if (minutes <= 0) return;
  const h = minutes / 60;
  const scale = massScale(ident?.weight_kg);
  // IMPLICIT UPKEEP on long spans: a time skip is not a hunger strike. People feed themselves
  // inside an unnarrated afternoon — deprivation must be STATED (captivity, wilderness, the LLM
  // setting "starving"), never inferred from elapsed minutes. Long turns cap at a rough
  // "hard traveling day" level of accrual; short scenes accrue linearly.
  const long = minutes > 240;
  const hungerDelta = HUNGER_PER_H * h * scale * (sleeping ? 0.5 : 1);
  cond.hunger_meter = clamp10((cond.hunger_meter ?? 2) + (long ? Math.min(hungerDelta, 3.2) : hungerDelta));
  const heat = !sleeping && HOT.test(weather || "") ? 1.3 : 1;
  const thirstDelta = THIRST_PER_H * h * scale * heat;
  cond.thirst_meter = clamp10((cond.thirst_meter ?? 2) + (long ? Math.min(thirstDelta, 3.8) : thirstDelta));
  if (!sleeping) cond.awake_minutes = (cond.awake_minutes ?? 0) + minutes;
  // deterministic upgrades of the legacy string enums (the LLM may still worsen them; sleep resets)
  const awakeH = (cond.awake_minutes ?? 0) / 60;
  if (awakeH >= 22 && cond.fatigue !== "exhausted") cond.fatigue = "exhausted";
  else if (awakeH >= 14 && cond.fatigue === "fresh") cond.fatigue = "tired";
  cond.hunger = cond.hunger_meter >= 8.5 ? "starving" : cond.hunger_meter >= 6 ? "hungry" : cond.hunger_meter >= 4 ? "peckish" : "fed";
}

/** Refills. */
export function applyMeal(cond: Condition, size: "snack" | "meal" | "feast" = "meal"): void {
  const drop = size === "feast" ? 9 : size === "meal" ? 6 : 2.5;
  cond.hunger_meter = clamp10((cond.hunger_meter ?? 2) - drop);
  cond.hunger = cond.hunger_meter >= 6 ? "hungry" : cond.hunger_meter >= 4 ? "peckish" : "fed";
}
export function applyDrink(cond: Condition): void {
  cond.thirst_meter = clamp10((cond.thirst_meter ?? 2) - 6);
}
export function applySleep(cond: Condition, hours: number): void {
  cond.awake_minutes = Math.max(0, (cond.awake_minutes ?? 0) - Math.round(hours * 60 * 2.2)); // sleep pays debt at ~2x
  if ((cond.awake_minutes ?? 0) < 8 * 60) cond.fatigue = "fresh";
  else if (cond.fatigue === "exhausted") cond.fatigue = "tired";
}

/** THE CEILING — the highest relaxation (-10..+10) this body can currently reach.
 *  Sleep debt dominates; severe thirst and hunger stack on top. */
export function relaxationCeiling(cond: Condition): number {
  const awakeH = (cond.awake_minutes ?? 0) / 60;
  let cap = 10;
  if (awakeH >= 36) cap = -5;
  else if (awakeH >= 24) cap = -2;
  else if (awakeH >= 20) cap = 1;
  else if (awakeH >= 16) cap = 4;
  if ((cond.thirst_meter ?? 0) >= 8) cap = Math.min(cap, -1);
  else if ((cond.thirst_meter ?? 0) >= 6.5) cap = Math.min(cap, 3);
  if ((cond.hunger_meter ?? 0) >= 9) cap = Math.min(cap, 0);
  else if ((cond.hunger_meter ?? 0) >= 7) cap = Math.min(cap, 4);
  return cap;
}
export function applyRelaxationCeiling(cond: Condition): boolean {
  const cap = relaxationCeiling(cond);
  if (cond.psyche.relaxation > cap) { cond.psyche.relaxation = cap; return true; }
  return false;
}

/** Compact label for the digest — empty until something crosses a threshold, so it costs
 *  nothing while everyone is fine. */
export function physioLabel(cond: Condition): string {
  const bits: string[] = [];
  const awakeH = (cond.awake_minutes ?? 0) / 60;
  if ((cond.hunger_meter ?? 0) >= 8.5) bits.push("ravenous");
  else if ((cond.hunger_meter ?? 0) >= 6) bits.push("hungry");
  if ((cond.thirst_meter ?? 0) >= 8) bits.push("parched");
  else if ((cond.thirst_meter ?? 0) >= 6.5) bits.push("thirsty");
  if (awakeH >= 24) bits.push(`${Math.round(awakeH)}h without sleep`);
  else if (awakeH >= 17) bits.push("running on too little sleep");
  return bits.join(", ");
}

/** American rendering — storage stays metric, every visible surface speaks ft-in and lbs. */
export function ftIn(height_cm?: number): string {
  if (!height_cm) return "";
  const totalIn = Math.round(height_cm / 2.54);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}
export function lbs(weight_kg?: number): number | undefined {
  return weight_kg ? Math.round(weight_kg * 2.20462) : undefined;
}
