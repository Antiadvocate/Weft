
/**
 * SCENE TONE â€” one derived signal that drives every ambient layer.
 * The engine already computes the real state (player openness, thread tension, weather,
 * mood); this module reads it and folds it into a single tone the visual layers key off:
 * particle kind/density/speed, backdrop palette, and prose reveal cadence.
 * Pure + deterministic: same save â†’ same tone. No engine writes, ever.
 */
import type { ClientSave } from "./api";

export type ToneId = "calm" | "warm" | "tense" | "dread" | "grief" | "wonder" | "neutral";
export type ParticleKind = "motes" | "embers" | "ash" | "rain" | "snow" | "fog";

export interface SceneTone {
  id: ToneId;
  particle: ParticleKind;
  density: number;    // 0..1 â€” how populated the field is
  speed: number;      // multiplier on the kind's base velocity
  color: string;      // particle base color (rgba)
  revealMs: number;   // per-word stagger for prose reveal
  breathS: number;    // openness breathing period, seconds (open = slow)
}

const GRIEF = /\bgrief|mourn|sorrow|loss|bereft|hollow\b/;
const WONDER = /\bawe|wonder|transcend|luminous|vast\b/;
const WARM = /\bwarm|tender|content|safe|loved|held\b/;

/** Weather words override the tone's default particle â€” rain is rain whatever the mood. */
function weatherParticle(weather: string): ParticleKind | null {
  const w = (weather || "").toLowerCase();
  if (/rain|storm|drizzle|downpour|squall/.test(w)) return "rain";
  if (/snow|sleet|blizzard|flurr/.test(w)) return "snow";
  if (/ash|smoke|burn|cinder/.test(w)) return "ash";
  if (/ember|firelight/.test(w)) return "embers";
  if (/fog|mist|haze/.test(w)) return "fog";
  return null;
}

export function sceneTone(save: ClientSave): SceneTone {
  const psy = (save as any).condition?.["char_player"]?.psyche as
    | { relaxation?: number; mood?: string; state?: string; active_states?: string[] } | undefined;
  const r = psy?.relaxation ?? 0;
  const moodText = `${psy?.mood ?? ""} ${(psy?.active_states ?? []).join(" ")}`.toLowerCase();
  const broken = psy?.state === "fracturing" || psy?.state === "broken" || psy?.state === "shattered";
  const tension = Math.max(0, ...save.world.threads.filter((t) => t.status === "active").map((t) => t.tension ?? 0));

  let id: ToneId = "neutral";
  if (broken || r <= -6 || tension >= 8) id = "dread";
  else if (r <= -3 || tension >= 6) id = "tense";
  else if (GRIEF.test(moodText)) id = "grief";
  else if (WONDER.test(moodText)) id = "wonder";
  else if (r >= 4 && WARM.test(moodText)) id = "warm";
  else if (r >= 4) id = "calm";

  // openness â†’ breathing period: clenched breathes fast and shallow, open breathes slow and deep
  const breathS = 1.6 + ((r + 10) / 20) * 4.6; // -10 â†’ 1.6s, +10 â†’ 6.2s

  const base: Record<ToneId, Omit<SceneTone, "id" | "breathS">> = {
    calm:    { particle: "motes",  density: 0.45, speed: 0.5,  color: "rgba(236,228,212,0.5)",  revealMs: 34 },
    warm:    { particle: "embers", density: 0.35, speed: 0.55, color: "rgba(217,142,74,0.55)",  revealMs: 30 },
    wonder:  { particle: "motes",  density: 0.6,  speed: 0.4,  color: "rgba(190,205,230,0.55)", revealMs: 38 },
    grief:   { particle: "fog",    density: 0.4,  speed: 0.35, color: "rgba(180,175,168,0.35)", revealMs: 42 },
    neutral: { particle: "motes",  density: 0.25, speed: 0.6,  color: "rgba(236,228,212,0.35)", revealMs: 24 },
    tense:   { particle: "motes",  density: 0.18, speed: 1.25, color: "rgba(220,200,170,0.4)",  revealMs: 14 },
    dread:   { particle: "ash",    density: 0.22, speed: 0.45, color: "rgba(160,150,140,0.5)",  revealMs: 12 },
  };

  const t = { id, breathS, ...base[id] };
  const wp = weatherParticle(save.world.weather);
  if (wp) {
    t.particle = wp;
    if (wp === "rain") { t.density = Math.max(t.density, 0.5); t.speed = Math.max(t.speed, 1.6); t.color = "rgba(170,185,205,0.4)"; }
    if (wp === "snow") { t.density = Math.max(t.density, 0.5); t.color = "rgba(240,244,250,0.6)"; }
  }
  return t;
}

/* â”€â”€ seeded randomness â€” deterministic backdrops and map layouts â”€â”€ */

export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D value noise (bilinear over a hashed lattice) â€” enough for a color field. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  const lattice = (ix: number, iy: number) => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 951274213) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = fade(x - x0), fy = fade(y - y0);
    const a = lattice(x0, y0), b = lattice(x0 + 1, y0), c = lattice(x0, y0 + 1), d = lattice(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* â”€â”€ ambience level â€” the prose is the point; the ambient layers must never cost readability.
      off: nothing mounts. subtle (default): faint presence. full: the previous look, tamed. â”€â”€ */
export type AmbienceLevel = "off" | "subtle" | "full";
const AMB_KEY = "weft-ambience";
export function getAmbience(): AmbienceLevel {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(AMB_KEY) : null;
  return v === "off" || v === "full" ? v : "subtle";
}
export function setAmbience(v: AmbienceLevel): void {
  try { localStorage.setItem(AMB_KEY, v); } catch { /* private mode */ }
}

