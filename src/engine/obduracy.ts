// Obduracy — how hard it is to move this person's feeling about someone.
//
// The engine already had a brake on relational drift, but it engaged almost nowhere.
// gainScale() returned a flat 1 below warmth 50, so the entire lower half of the range
// was unbraked and a stranger reached 45 in three deltas. And driftVeto() only fired on
// conscience <= 0.35 or a core trait matching /cruel|ruthless|cold|merciless|brutal|
// vicious|callous/ — which the Forge guarantees for exactly ONE character per cast.
// Everyone forged as guarded, wary, bitter, prickly, proud, or closed-off had no
// protection at all, and those are precisely the people who should be slow.
//
// So: one graded 0..1 scalar, derived from constitution, replacing a binary that
// described almost nobody. 0 is an open person who warms at the old speed — obduracy 0
// reproduces the previous numbers EXACTLY, so nothing already tuned moves. 1 is someone
// whose regard has to be earned over an arc and cannot be bought in an afternoon.

import type { Identity, AcquiredTrait } from "./types";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Constitutionally cold — cruelty as nature, not as wound. */
const HARD = /\b(cruel|ruthless|cold|merciless|brutal|vicious|callous|predatory|sadistic|remorseless)\b/i;

/** Closed, not cruel. The missing middle: people who are perfectly capable of warmth and
 *  simply do not hand it out on a first meeting. This is the class the old veto ignored. */
const GUARDED = /\b(guarded|wary|warily|suspicious|distrustful|mistrustful|paranoid|closed[- ]?off|closed|withdrawn|private|reserved|aloof|standoffish|remote|prickly|abrasive|caustic|acerbic|bitter|resentful|grudging|unforgiving|vengeful|spiteful|proud|haughty|imperious|stubborn|obstinate|intractable|rigid|hostile|contemptuous|disdainful|cynical|jaded|hardened|hard[- ]?bitten|severe|austere|humorless|territorial|possessive|controlling|manipulative|calculating|transactional)\b/i;

/** Openness that should stay fast. Present so a forged-warm character isn't slowed by
 *  a single sour adjective sitting next to five generous ones. */
const OPEN = /\b(warm|open|generous|trusting|kind|gentle|affectionate|guileless|earnest|gregarious|sunny|tender|forgiving|loyal|devoted)\b/i;

function traitPressure(words: string[]): number {
  let up = 0, down = 0;
  for (const w of words) {
    if (HARD.test(w)) up += 0.34;
    else if (GUARDED.test(w)) up += 0.24;
    else if (OPEN.test(w)) down += 0.12;
  }
  return up - down;
}

/**
 * 0..1. Zero means "behaves exactly as the engine did before this module existed."
 *
 * Sources, in rough order of weight:
 *   • core traits — what the Forge decided this person IS
 *   • attachment style — avoidant and disorganized treat closeness under threat as
 *     pressure, so their warmth genuinely should not climb on a kind afternoon
 *   • conscience — the old binary, kept, but now as one contributing term
 *   • acquired traits — a character the STORY made guarded gets slower over time,
 *     weighted by how integrated the trait has become
 */
export function obduracyOf(c: Identity | undefined, acquired: AcquiredTrait[] = []): number {
  if (!c) return 0;
  let o = 0;

  o += Math.max(0, traitPressure(c.core_traits ?? []));

  switch (c.attachment?.style) {
    case "avoidant":     o += 0.30; break;  // distance IS the regulation strategy
    case "disorganized": o += 0.24; break;  // reaches and flinches in the same motion
    case "anxious":      o += 0.00; break;  // pursues; fast to warm, and fragile — not obdurate
    default:             break;             // secure: settles near safe people, no penalty
  }

  // conscience: unchanged threshold, now graded. 0.9 adds nothing; 0.2 adds a lot.
  const con = typeof c.conscience === "number" ? c.conscience : 0.7;
  if (con < 0.6) o += (0.6 - con) * 0.75;

  // what play has made them, scaled by how much of their identity it now occupies
  for (const t of acquired) {
    const w = clamp01((t.self_weight ?? 0) / 10) * clamp01((t.intensity ?? 0) / 10);
    if (HARD.test(t.label)) o += 0.30 * w;
    else if (GUARDED.test(t.label)) o += 0.22 * w;
  }

  return clamp01(o);
}

/** Convenience for call sites that hold the save rather than the identity. */
export function obduracyIn(
  chars: Record<string, Identity> | undefined,
  traits: Record<string, AcquiredTrait[]> | undefined,
  id: string,
): number {
  return obduracyOf(chars?.[id], traits?.[id] ?? []);
}

/** Coarse band, for prose and for the veto. */
export function isObdurate(o: number): boolean { return o >= 0.45; }
