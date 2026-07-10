/**
 * Desire — attraction as its own axis, separate from warmth. Deterministic, zero tokens.
 *
 * The model follows the classical Buddhist account of how wanting works, mapped onto the
 * engine's relaxation kernel:
 *
 *   1. THE ARISING IS CONDITIONED, NOT CHOSEN. A pull toward someone arises at contact,
 *      shaped by prior conditioning — what a person's world and history trained them to
 *      find desirable (their `taste`, plus `attracted_to` orientation). It is a first read,
 *      not a verdict, and it is NOT warmth: liking someone and wanting someone are separate
 *      channels. Kindness earns gratitude; it does not manufacture desire.
 *
 *   2. WHAT HAPPENS NEXT DEPENDS ON THE BODY IT ARISES IN. The same pull, in an open
 *      (relaxed) person, expresses cleanly — real flirtation, play, initiative — or is
 *      simply enjoyed and released. In a clenched person the pull gets GRIPPED: it can't
 *      come out straight, so it leaks sideways (staring, sharpness, avoidance,
 *      overcorrection), and held long enough it hardens into fixation — a craving state
 *      that itself taxes the nervous system (a small relaxation drain each turn while held:
 *      craving is agitation). When the person settles again, the fixation dissolves on its
 *      own — nothing gripping it, it liberates itself. Same energy, two trajectories,
 *      decided by openness. This is the engine's core mechanic doing the gating.
 *
 *   3. WARMTH CAN EARN DESIRE, SLOWLY, WITH A CEILING. Sustained closeness lifts attraction
 *      over time ("made up for it") — but if the conditioned first read was flat, the drift
 *      plateaus at a companionate level: fondness with a mild pull, a different relationship,
 *      not consuming passion. The simulator can still move attraction past the plateau, but
 *      only with explicit cause in the prose.
 */
import type { SaveState, Identity } from "./types";
import { asText, asList } from "./coerce";
import { getEdge } from "./social";
import { relevance } from "./memory";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Stable per-pair noise so first reads are reproducible: -10..+15. */
function pairNoise(a: string, b: string): number {
  const s = a + "|" + b;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 100) / 100) * 25 - 10;
}

/**
 * Orientation gate. Returns null when no cap applies, otherwise the maximum attraction
 * this pairing can hold. "no one" caps at 0; a stated orientation that excludes the target
 * caps at 5 (aesthetic appreciation without desire). Permissive when data is missing —
 * absence of a field never manufactures a gate.
 */
export function orientationCap(from: Identity, to: Identity): number | null {
  const o = asText(from.attracted_to).toLowerCase();
  if (!o) return null;
  if (/\b(no ?one|none|nobody)\b/.test(o)) return 0;
  if (/\b(anyone|everyone|any|all)\b/.test(o)) return null;
  const p = asText(to.pronouns).toLowerCase();
  const targetFem = /\bshe\b|\bher\b/.test(p);
  const targetMasc = /\bhe\b|\bhim\b/.test(p);
  if (!targetFem && !targetMasc) return null; // they/them or unknown: don't hard-gate
  const wantsFem = /wom[ae]n|female|girls?|femme/.test(o);
  const wantsMasc = /\bm[ae]n\b|\bmale\b|boys?|\bmasc/.test(o);
  if (targetFem && wantsFem) return null;
  if (targetMasc && wantsMasc) return null;
  if (wantsFem || wantsMasc) return 5;
  return null;
}

/**
 * First read — set once, the moment two people share a scene. Conditioning (taste) matched
 * against what the target actually is (appearance, traits, background), plus stable noise
 * and a small head start from existing warmth. Never authors the player's own desire.
 */
export function seedAttraction(state: SaveState, fromId: string, toId: string): void {
  if (fromId === toId || fromId === "char_player") return;
  const from = state.characters[fromId], to = state.characters[toId];
  if (!from || !to) return;
  const e = getEdge(state.world.edges, fromId, toId);
  if (e.attraction !== undefined) return;
  const cap = orientationCap(from, to);
  let a: number;
  if (cap !== null && cap <= 5) {
    a = 0;
  } else {
    // asText/asList, not `?? ""` — saves written before coercion hold arrays in `taste` and strings
    // in `core_traits`, and `.trim`/`.join` on those throws.
    const targetBlob = [asText(to.appearance_facts, " "), asList(to.core_traits).join(" "), asText(to.background, " ")].join(" ");
    const taste = asText(from.taste);
    const match = taste ? relevance(targetBlob, taste) : 0; // 0..1 token overlap
    a = Math.round(clamp(match * 55 + pairNoise(fromId, toId) + (e.warmth > 0 ? e.warmth * 0.1 : 0), -20, 70));
  }
  e.attraction = a;
  e.attraction_base = a;
}

export function attractionWord(a: number): string {
  if (a <= -15) return "averse";
  if (a < 15) return "not drawn";
  if (a < 45) return "drawn";
  return "wants";
}

/** One digest line: this character's desire toward the player, gated by their openness. */
export function desireLine(state: SaveState, id: string): string {
  const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
  if (!e || e.attraction === undefined) return "";
  const a = e.attraction;
  const r = state.condition[id]?.psyche.relaxation ?? 0;
  const cold = typeof state.characters[id]?.conscience === "number" && state.characters[id].conscience! <= 0.35;
  if (a <= -15) return "desire: none — actively unattracted; advances would repel, however warm the bond";
  if (a < 15) return "desire: none — kindness reads as kindness; a flirt would land awkward or unwelcome, and niceness never changes that";
  if (cold) return r >= -2
    ? `desire: wants you (${a}) like a collector — patient, charming pursuit; the warmth is technique`
    : `desire: wants you (${a}) and resents not having you — possessive, tallying, punitive near rivals`;
  if (r >= 2) return `desire: drawn (${a}) and settled enough to show it — flirts, teases, gets close`;
  if (r <= -2) return `desire: drawn (${a}) but clenched — leaks sideways: staring, sharpness, avoidance; no clean flirtation`;
  return `desire: drawn (${a}) — surfaces in small ways when the moment allows`;
}

/**
 * Per-turn drift for present characters. Warmth slowly earns attraction under a
 * base-dependent ceiling; strong pull held in a clenched body becomes fixation
 * (an active state that drains relaxation while held and dissolves when the
 * person settles).
 */
export function tickDesire(state: SaveState): string[] {
  const shifts: string[] = [];
  const player = state.characters["char_player"];
  for (const id of state.world.present) {
    const c = state.characters[id];
    if (!c || id === "char_player" || c.central === false || c.status === "dead") continue;
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    if (!e || e.attraction === undefined) continue;
    // "made up for it": sustained warmth lifts attraction, capped by the conditioned first read.
    const base = e.attraction_base ?? e.attraction;
    const ceiling = base >= 15 ? 100 : 40; // flat first read → companionate plateau
    if (e.warmth >= 35 && e.attraction >= 0 && e.attraction < ceiling && player && orientationCap(c, player) === null) {
      e.attraction = Math.min(ceiling, +(e.attraction + 0.2).toFixed(2));
    }
    const cond = state.condition[id];
    if (!cond) continue;
    const label = `fixated on ${player?.name ?? "you"}`;
    const has = cond.psyche.active_states.includes(label);
    if (e.attraction >= 45 && cond.psyche.relaxation <= -3 && !has) {
      cond.psyche.active_states.push(label);
      shifts.push(`${c.name} is holding on too tight — wanting has turned into gripping.`);
    } else if (has && cond.psyche.relaxation >= 2) {
      cond.psyche.active_states = cond.psyche.active_states.filter((s) => s !== label);
      shifts.push(`${c.name}'s grip loosens — the wanting is still there, held lightly now.`);
    }
    if (cond.psyche.active_states.includes(label)) {
      cond.psyche.relaxation = Math.max(-10, +(cond.psyche.relaxation - 0.3).toFixed(2));
    }
  }
  return shifts;
}
