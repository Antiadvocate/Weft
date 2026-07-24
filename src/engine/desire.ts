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

/** Stable per-person noise so a fallback beauty is reproducible per character: -8..+8. */
function soloNoise(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 100) / 100) * 16 - 8;
}

/**
 * Intrinsic attractiveness, 0..100 — the millisecond snap-read, BEFORE any observer's taste.
 * Species-agnostic: symmetry, youth/vitality, presence, striking features — the model that
 * created the character sets it. When unset (older saves, or the AI omitted it), we derive a
 * deterministic fallback: a broad youth/vitality curve peaking in the reproductively-signalled
 * years and easing on both sides, plus stable per-person noise so not everyone is average.
 * This is not a claim that only the young are beautiful — it's the default prior a stranger's
 * nervous system applies at first sight; the authored value should override it whenever it exists.
 */
export function beautyOf(c: Identity): number {
  if (typeof c.beauty === "number") return clamp(c.beauty, 0, 100);
  const age = typeof c.age === "number" ? c.age : 30;
  // youth/vitality curve: rises through adolescence, broad plateau ~18–32, gentle decline after.
  let v: number;
  if (age < 18) v = 44 + (age - 13) * 2;          // pre-adult: lower, climbing
  else if (age <= 32) v = 56;                      // peak plateau
  else v = Math.max(30, 56 - (age - 32) * 0.7);    // slow decline, floored
  return clamp(Math.round(v + soloNoise(c.character_id ?? c.name ?? "")), 0, 100);
}

/** Map intrinsic beauty (0..100, 50≈ordinary) to a signed baseline pull (-25..+45).
 *  This is the shared first read everyone gets before personal taste is applied. */
function beautyPull(beauty: number): number {
  // 50 → ~0 (neutral). 75 → ~+25 (turns heads). 90 → ~+42. 30 → ~-16 (off-putting).
  return clamp(Math.round((beauty - 50) * (beauty >= 50 ? 1.7 : 0.9)), -25, 45);
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
    // orientation excludes this target: no desire, whatever they look like. Aesthetic appreciation only.
    a = 0;
  } else {
    // BASELINE — the millisecond snap-read: intrinsic beauty, before personal taste. Beauty is
    // objective (symmetry/vitality is a given) and the body registers it fully regardless of clench.
    // Clench does NOT reduce the pull — a clenched nervous system wants the beautiful thing just as
    // much, often more. What clench governs is ADMISSIBILITY (below): whether that wanting can reach
    // the person's own self-report, or discharges sideways as grasping/possession. So the seed
    // magnitude is the clean intrinsic pull; the entrance clench is stamped separately.
    const base = beautyPull(beautyOf(to));
    // PERSONAL DEVIATION — this observer's conditioning (taste) matched against what the target IS.
    // A taste match makes them extra compelling on top of the shared read; a flat/mismatched taste
    // leaves only the baseline. asText/asList (not `?? ""`): pre-coercion saves hold arrays/strings.
    const targetBlob = [asText(to.appearance_facts, " "), asList(to.core_traits).join(" "), asText(to.background, " ")].join(" ");
    const taste = asText(from.taste);
    const match = taste ? relevance(targetBlob, taste) : 0; // 0..1 token overlap
    const tasteBonus = match * 40; // taste deviates UP from the shared baseline, doesn't replace it
    a = Math.round(clamp(base + tasteBonus + pairNoise(fromId, toId) + (e.warmth > 0 ? e.warmth * 0.1 : 0), -25, 80));
  }
  e.attraction = a;
  e.attraction_base = a;
  // ADMISSIBILITY STAMP — born grasping or born in awe. Set once, from how clenched the perceiver
  // was at first sight. A pull that arises in a gripped body (low relaxation) is high-magnitude but
  // can't reach clean self-report: it will express as possession, sharpness, gift-that's-taking —
  // the picked flower. A pull that arises open is ownable: flirtation, letting-stand. Only stamped
  // when there's actual desire to color; a null/near-zero pull needs no texture. This then DRIFTS
  // toward current relaxation each turn (tickDesire) — slowly up under calm, faster down under clench.
  if (a >= 12) {
    const r = state.condition[fromId]?.psyche.relaxation ?? 0; // -10..+10
    e.desire_admissibility = +clamp(0.5 + r * 0.05, 0, 1).toFixed(2); // clenched entrance ~0, open ~1
  }
}

/**
 * BEAUTY RECOMPUTE (delta-propagation). When a person's judged-on-sight appearance changes
 * permanently — a scar, aging, weight change, an ear blown off, being shrunk — their intrinsic
 * beauty is re-scored (by the caller: either the small AI rescore or the manual button), and the
 * change must ripple to everyone already attracted to them WITHOUT resetting those edges. An
 * established bond is history; a new scar shifts it, it does not erase it. So we nudge each
 * existing attraction edge toward the new first-read by the beauty delta, scaled DOWN the more
 * invested/warm the observer already is: a stranger's flicker of interest tracks looks almost
 * fully; a devoted partner barely moves. Returns the number of edges nudged.
 */
export function applyBeautyChange(state: SaveState, toId: string, oldBeauty: number, newBeauty: number): number {
  const dPull = beautyPull(clamp(newBeauty, 0, 100)) - beautyPull(clamp(oldBeauty, 0, 100));
  if (dPull === 0) return 0;
  let nudged = 0;
  for (const e of state.world.edges) {
    if (e.to !== toId || e.attraction === undefined) continue;
    if (e.from === "char_player") continue; // never author the player's own desire
    // investment 0..1: warmth + how far attraction sits above baseline both count as "bond".
    const warmthInv = clamp(Math.abs(e.warmth) / 100, 0, 1);
    const invested = clamp(warmthInv * 0.7 + clamp(e.attraction / 100, 0, 1) * 0.3, 0, 1);
    // strangers track the delta ~fully; the deeply-bonded barely move (down to ~15%).
    const scale = 1 - invested * 0.85;
    const shift = dPull * scale;
    e.attraction = Math.round(clamp(e.attraction + shift, -25, 100));
    // the conditioned FIRST read also drifts, but half as much — bedrock memory of the first sight.
    if (e.attraction_base !== undefined) e.attraction_base = Math.round(clamp(e.attraction_base + shift * 0.5, -25, 100));
    e.updated_turn = state.world.current_turn;
    nudged++;
  }
  return nudged;
}


export function attractionWord(a: number): string {
  if (a <= -15) return "averse";
  if (a < 15) return "not drawn";
  if (a < 35) return "drawn to";
  if (a < 55) return "wants";
  return "aches for";
}

/** One digest line: this character's desire toward the player, gated by their openness. */
export function desireLine(state: SaveState, id: string): string {
  const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
  if (!e || e.attraction === undefined) return "";
  const a = e.attraction;
  const r = state.condition[id]?.psyche.relaxation ?? 0;
  const cold = typeof state.characters[id]?.conscience === "number" && state.characters[id].conscience! <= 0.35;
  if (a <= -15) return "desire toward you: none, actively repelled — SHOW: subtle withdrawal, stiffening at closeness; never narrate the aversion as a stated feeling";
  if (a < 15) return "desire toward you: none — SHOW: warmth stays platonic, a flirt would land awkward; do not invent attraction, and never narrate 'she felt nothing'";
  const adm = e.desire_admissibility ?? clamp(0.5 + r * 0.05, 0, 1);
  // Each line: a behavioral instruction (what to SHOW) plus an explicit NEVER — the narrator must not
  // convert the desire into a quotable interior sentence ("she resented not having him"). Magnitude (a)
  // is kept for calibration; the interpretation is stripped so it can't be paraphrased into prose.
  if (cold) return adm >= 0.4
    ? `desire toward you: strong (${a}), cold-natured — SHOW: patient charming pursuit, warmth deployed as a tool, gifts with strings; NEVER narrate the wanting or that the charm is technique — behavior only, let the player sense it`
    : `desire toward you: strong (${a}), cold and grasping — SHOW: possessiveness, tallying who's near you, sharpness toward rivals, a gift that's really a claim; NEVER narrate resentment, wanting, or "she resented not having him" — only the acts`;
  if (adm >= 0.6) return `desire toward you: real (${a}), settled — SHOW: flirts, teases, seeks closeness, lets you be; NEVER state the wanting outright — render it as behavior`;
  if (adm <= 0.35) return `desire toward you: strong (${a}) but unadmitted — SHOW: it leaks as grasping — possessiveness, sharpness, taking-for-your-own-good, a claim dressed as care; NEVER narrate the pull or that they can't admit it — only what they DO`;
  return `desire toward you: real (${a}), not yet settled — SHOW: surfaces in small glances and half-gestures when the moment allows; NEVER state it outright — behavior only`;
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
    // ADMISSIBILITY DRIFT — the stamped grasp/awe texture migrates toward CURRENT relaxation, but
    // asymmetrically: learning to see rather than pick is slow work; losing it under stress is fast.
    // Target = where this body's current openness would place the wanting. Creeps UP (+0.02/turn) when
    // the target is higher than now; drops DOWN (−0.06/turn, ~3× faster) when clench pulls it lower.
    // The groove down is always easier to fall into than the climb out.
    if (e.desire_admissibility !== undefined && e.attraction >= 12) {
      const target = clamp(0.5 + cond.psyche.relaxation * 0.05, 0, 1);
      const cur = e.desire_admissibility;
      if (target > cur) e.desire_admissibility = +Math.min(target, cur + 0.02).toFixed(2);
      else if (target < cur) e.desire_admissibility = +Math.max(target, cur - 0.06).toFixed(2);
    }
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

/** Translate raw warmth/trust toward the player into an explicit BEHAVIORAL cue on a named emotional
 *  scale, so the narrator understands what the numbers MEAN, not just a bare figure it can default
 *  past. Warmth (−100..100) is how much they CARE; trust (−100..100) is how much they RELY on you.
 *  They diverge: someone can care deeply while still not trusting (warm but cautious), which reads as
 *  warmth WITH guardedness, never as coldness. The key failure this fixes is a narrator fixating on
 *  low trust and writing a loyal, warming companion as a hostile stranger. */
export function dispositionCue(warmth: number, trust: number): string {
  // warmth band on the full scale, with what it looks like in behavior
  const care =
    warmth >= 70 ? "loves you / devoted (warmth very high) — open affection, protectiveness, seeks your closeness" :
    warmth >= 45 ? "is fond of you (warmth high) — visibly cares, softens around you, small kindnesses" :
    warmth >= 20 ? "likes you and is warming (warmth moderate, on a −100..100 scale where 0 is a stranger) — friendly, drawn to you, glad you're near" :
    warmth >= 5 ? "is mildly well-disposed (warmth slight) — cordial, no hostility" :
    warmth > -5 ? "is neutral (warmth ~0) — a stranger's baseline, neither warm nor cold" :
    warmth > -20 ? "is cool toward you (warmth mildly negative) — distant, unengaged" :
    warmth > -45 ? "dislikes you (warmth negative) — sharp, unwelcoming" :
    "resents or hates you (warmth very negative) — openly cold or antagonistic";
  const rely =
    trust >= 50 ? "and trusts you (relies on your word, lowers their guard)" :
    trust >= 20 ? "and is starting to trust you (testing, hopeful)" :
    trust >= 0 ? "but doesn't fully trust you yet (still cautious, watching)" :
    trust > -25 ? "and is wary of trusting you (guarded, keeps a little distance)" :
    "and does not trust you (expects the worst, stays defensive)";
  // spell out the divergence so the narrator can't collapse warm-but-cautious into cold
  const note = warmth >= 20 && trust < 20
    ? " — RENDER BOTH: the warmth is real and shows (care, softness, loyalty), the low trust only makes them guarded, NOT cold or hostile; do not write a caring character as a distant stranger"
    : warmth <= -20
      ? " — this coldness is THIS character's earned stance from what's passed between you, not a default suspicion to apply to everyone"
      : warmth >= 45 && trust >= 20
        ? " — let this warmth be plainly visible; do not make the player re-earn it every scene"
        : "";
  return `${care} ${rely}${note}`;
}
