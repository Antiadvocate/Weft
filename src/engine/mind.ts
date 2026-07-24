
/**
 * THEORY OF MIND — the active-inference belief layer.
 *
 * The engine was, until now, OMNISCIENT: every character's true state sat in the
 * prompt, so no one could be wrong about anyone. The position papers on LLM social
 * simulation are blunt that this is exactly the regime where models look deceptively
 * good and believability quietly dies — real social life runs on information
 * asymmetry. This layer fixes that. Each tracked character holds a PRIVATE model of
 * the people who matter to them (the player, and their sharpest tie). The model can
 * diverge from ground truth, and the GAP is the point.
 *
 * Active inference, stripped of the math: an agent acts to (a) get what it wants and
 * (b) reduce its own uncertainty. Surprise — the error between what it predicted and
 * what actually happened — is the master signal. Here:
 *
 *   • predicted_warmth / predicted_stance = the agent's generative model of the other.
 *   • each turn we compare the model to what the diff ACTUALLY did (the edge moves,
 *     the stance the QRE layer sampled) and compute prediction error.
 *   • error magnitude → `surprise`, which (1) feeds the cusp load term `a` in the
 *     undertow (surprise IS the body bracing against an unpredictable world — the
 *     clench model and the cognition model turn out to be the same thing measured
 *     twice), (2) surfaces as a narrator-renderable shift ("she didn't expect that
 *     from you"), and (3) when uncertainty about someone important is high, biases
 *     the drive system toward an EPISTEMIC goal — go find out — which the existing
 *     QRE stance layer then executes.
 *   • the model then UPDATES toward what it observed (precision-weighted: confident
 *     models move less, surprised models move more — Bayesian-flavored, deterministic).
 *
 * All zero-token. A few scalars per tracked character, updated like the rest of the
 * undertow. The `held_false` belief — one concrete thing the agent is WRONG about —
 * is the only string, and it's the dramatic seed the narrator can spend.
 */
import type { SaveState, BeliefAbout, MindModel, Stance } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Who does character A model? The player (always, if A has ever met them) plus A's
 *  single sharpest tie (largest |warmth|+|trust| edge to a present/tracked other).
 *  Kept sparse on purpose — a theory of mind about everyone is neither realistic nor cheap. */
function modeledTargets(state: SaveState, id: string): string[] {
  const targets = new Set<string>();
  // the player, if there's any relationship at all (they've interacted)
  const pe = state.world.edges.find((e) => e.from === id && e.to === "char_player");
  if (pe) targets.add("char_player");
  // sharpest non-player tie
  let best: string | null = null, bestMag = 12; // threshold: must be a real tie
  for (const e of state.world.edges) {
    if (e.from !== id || e.to === "char_player" || e.to === id) continue;
    if (!state.characters[e.to] || state.characters[e.to].status === "dead" || state.characters[e.to].status === "departed") continue;
    const mag = Math.abs(e.warmth) + Math.abs(e.trust);
    if (mag > bestMag) { bestMag = mag; best = e.to; }
  }
  if (best) targets.add(best);
  return [...targets];
}

function blankBelief(target: string, turn: number, trueWarmth: number): BeliefAbout {
  return {
    target,
    // first read is a noisy, attenuated version of the truth — people start with a rough guess
    predicted_warmth: clamp(Math.round(trueWarmth * 0.5), -100, 100),
    predicted_stance: trueWarmth > 20 ? "ally" : trueWarmth < -20 ? "rival" : "unknown",
    surprise: 0,
    confidence: 0.3,
    updated_turn: turn,
  };
}

const stanceWarmthHint: Record<Stance, number> = { press: -8, maneuver: -3, hold: 0, yield: 6 };

// ── INTERPRETATION-UNDER-AFFECT ──────────────────────────────────────────────
// No mind perceives a raw event. The reader sees whatever the actor did THROUGH the
// reader's own edge toward that actor — warmth, attraction, and attachment style bend
// the percept before any prediction error is computed. This is what makes miscommunication
// emergent rather than authored: A acts warm, B's cold edge reads manipulation, B updates
// negative, A then reads B's new coldness through A's own edge, and the two spiral apart
// with no author input. Runs player→NPC and NPC→NPC, both signs.
//
// The distortion is a signed, magnitude-scaled bend of the objective valence:
//   • low warmth toward the actor COMPRESSES neutral/ambiguous acts toward a hostile read
//     (a warm gesture from someone you distrust looks like a move).
//   • high attraction toward the actor PULLS neutral toward the intimate/invested read
//     (you find the meaning you want to find).
//   • attachment style shapes HOW the bend behaves, it is not flavor:
//       - secure: light bend, quick to take the act near-straight.
//       - anxious: amplifies the negative direction — reads abandonment into ambiguity.
//       - avoidant: compresses warmth specifically — intimacy gets flattened to neutral/mild threat.
//       - disorganized: WIDENS VARIANCE — the same input swings threat↔desire across turns,
//         gated on turn parity + edge so it is deterministic but non-stationary.
type PerceptEdge = { warmth: number; attraction: number; style: AttachStyle };
type AttachStyle = "secure" | "anxious" | "avoidant" | "disorganized";

function perceivedValence(objective: number, edge: PerceptEdge, turn: number): number {
  const w = edge.warmth / 100;      // -1..1 reader→actor warmth
  const a = edge.attraction / 100;  // -1..1 reader→actor desire
  // ambiguity weight: the bend acts hardest on near-neutral events, barely on extremes —
  // an unmistakable act (someone screams at you / saves your life) resists reinterpretation.
  const ambiguity = 1 - Math.min(1, Math.abs(objective) / 60);

  // cold edge drags neutral toward hostile; the colder, the harder. Only pulls DOWN.
  const hostileDrag = w < 0 ? w * 26 * ambiguity : w * 6 * ambiguity;
  // attraction pulls neutral toward the invested/intimate read (positive). Averse attraction pushes away.
  const intimatePull = a * 20 * ambiguity;

  let bend = hostileDrag + intimatePull;

  switch (edge.style) {
    case "secure": bend *= 0.5; break;                         // takes it closer to straight
    case "anxious": if (bend < 0) bend *= 1.6; break;          // catastrophizes the negative read
    case "avoidant": if (objective > 0) bend -= 10 * ambiguity; break; // flattens warmth specifically
    case "disorganized": {
      // non-stationary: same input, different sign across turns. Deterministic on turn + edge,
      // so replays identically but reads as instability. Widens, doesn't just shift.
      const swing = Math.sin(turn * 1.7 + edge.warmth * 0.11 + edge.attraction * 0.07);
      bend += swing * 22 * ambiguity;
      break;
    }
  }
  return clamp(objective + bend, -100, 100);
}

// ── BREAKTHROUGH THRESHOLD ──────────────────────────────────────────────────
// The one knob separating "misreads that repair" with sustained contradiction from a mind
// that "cannot be reached." When THIS turn's raw prediction error is large enough, the
// percept filter is BYPASSED and the mind takes the objective valence straight — reality
// broke through. The cutoff is per-character: most minds are recoverable (a moderate cutoff),
// but a few are sealed — pushed so high that no ordinary contradiction lands. Sealing is
// driven by edge extremity and attachment: an avoidant/disorganized reader with a strongly
// negative edge is the hard case. A sealed mind's cutoff sits above the max achievable error,
// so nothing bypasses; the player's only counters are distance (stop generating misreadable
// events) and the record (other minds' accurate models in minds[].about).
function breakthroughCutoff(edge: PerceptEdge): number {
  let cut = 0.62; // baseline: a strong single-turn violation punches through
  // hostility raises the wall — the more negative the edge, the harder truth must hit.
  if (edge.warmth < 0) cut += (-edge.warmth / 100) * 0.3;
  if (edge.style === "avoidant") cut += 0.12;
  if (edge.style === "disorganized") cut += 0.18; // instability itself resists correction
  if (edge.style === "secure") cut -= 0.15;       // secure minds are cheaply reached
  // sealed: extreme negative edge + guarded style pushes the cutoff past 1.0 (unreachable by error∈[0,1])
  return clamp(cut, 0.2, 1.2);
}

/**
 * Update one believer's whole theory of mind against ground truth this turn.
 * Returns humanized surprise lines (for shifts) and the peak surprise scalar (for the cusp).
 */
export function updateMind(
  state: SaveState,
  id: string,
  observedStances: Record<string, Stance>, // char_id -> the stance the QRE layer sampled for them this turn
  turn: number,
  dispersion = 0, // 0..1 from the undertow: how hard the cast is pulling apart — erodes settled confidence
): { lines: string[]; peakSurprise: number; epistemicTarget: string | null } {
  const minds: Record<string, MindModel> = (state.minds ??= {});
  const model = (minds[id] ??= { character_id: id, about: [] });
  const targets = modeledTargets(state, id);

  // prune models of people no longer relevant
  model.about = model.about.filter((b) => targets.includes(b.target));

  const lines: string[] = [];
  let peakSurprise = 0;
  let epistemicTarget: string | null = null;
  let epistemicGap = 0;

  for (const target of targets) {
    const trueEdge = state.world.edges.find((e) => e.to === target && e.from === id);
    const trueWarmth = trueEdge?.warmth ?? 0;
    let b = model.about.find((x) => x.target === target);
    if (!b) { b = blankBelief(target, turn, trueWarmth); model.about.push(b); continue; } // first sighting: no surprise yet

    // ── PERCEPT (interpretation-under-affect) ──
    // The reader (id) perceives the actor's (target's) act through id's OWN edge toward target.
    // We distort the objective valence FIRST, then the predictor reasons on the percept, not truth.
    const rawWarmth = trueWarmth;
    const targetStance = observedStances[target]; // the stance the QRE layer sampled for the actor this turn
    const rawStanceHint = targetStance ? stanceWarmthHint[targetStance] : 0;
    const readerStyle = (state.characters[id]?.attachment?.style ?? "secure") as AttachStyle;
    const pEdge: PerceptEdge = { warmth: trueEdge?.warmth ?? 0, attraction: trueEdge?.attraction ?? 0, style: readerStyle };
    // raw single-turn error (truth vs model) decides whether reality BREAKS THROUGH the filter.
    const rawWarmthErr = Math.abs(rawWarmth - b.predicted_warmth) / 200;
    const broughtThrough = rawWarmthErr >= breakthroughCutoff(pEdge);
    // if breakthrough: take the objective act straight. otherwise: perceive it through the edge.
    const seenWarmth = broughtThrough ? rawWarmth : perceivedValence(rawWarmth, pEdge, turn);
    const seenStanceHint = broughtThrough ? rawStanceHint : perceivedValence(rawStanceHint * 7, pEdge, turn) / 7;

    // ── PREDICTION ERROR ── computed on the PERCEPT, not the truth.
    // warmth error: how far the agent's model was from what it PERCEIVED, normalized to 0..1
    const warmthErr = Math.abs(seenWarmth - b.predicted_warmth) / 200;
    // stance error: did the target act against the agent's read? (perceived stance valence vs expectation)
    let stanceErr = 0;
    if (targetStance) {
      const expected = b.predicted_stance === "ally" ? 6 : b.predicted_stance === "rival" ? -6 : 0;
      stanceErr = Math.abs(seenStanceHint - expected) / 14;
    }
    const err = clamp(warmthErr * 0.7 + stanceErr * 0.3, 0, 1);

    // precision-weighting: a confident model is more surprised by the same error (it expected to be right)
    const weightedErr = clamp(err * (0.6 + b.confidence * 0.8), 0, 1);
    // surprise is a leaky accumulator — decays in calm, spikes on violation
    b.surprise = clamp(b.surprise * 0.55 + weightedErr, 0, 1);
    peakSurprise = Math.max(peakSurprise, b.surprise);

    // a genuinely violated expectation is a beat the narrator can render
    if (weightedErr > 0.28 && trueEdge) {
      const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
      const sname = state.characters[id]?.name ?? id;
      if (seenWarmth > b.predicted_warmth + 25) lines.push(`${sname} is recalibrating: ${tname} is warmer than they'd assumed.`);
      else if (seenWarmth < b.predicted_warmth - 25) lines.push(`${sname} realizes ${tname} is colder toward them than they thought.`);
      else lines.push(`${sname} didn't expect that from ${tname}.`);
    }

    // ── EPISTEMIC PULL ── low confidence about someone who matters → a want to FIND OUT
    const stakes = Math.abs(trueWarmth) + (target === "char_player" ? 30 : 0);
    const gap = (1 - b.confidence) * (stakes / 130);
    if (gap > epistemicGap) { epistemicGap = gap; if (gap > 0.4) epistemicTarget = target; }

    // ── BELIEF UPDATE ── move the model toward what was PERCEIVED (seenWarmth), not the raw truth —
    //    a mind that misread the act updates toward its misreading; that's what makes the filter bite
    //    rather than being cosmetic. On a breakthrough turn seenWarmth == rawWarmth, so reality lands.
    //    surprised models move more, confident models resist (Bayesian precision).
    const lr = clamp(0.25 + b.surprise * 0.5, 0, 0.85);
    b.predicted_warmth = clamp(Math.round(b.predicted_warmth + (seenWarmth - b.predicted_warmth) * lr), -100, 100);
    b.predicted_stance = b.predicted_warmth > 20 ? "ally" : b.predicted_warmth < -20 ? "rival" : "unknown";
    // confidence rises when predictions land, falls on shock — but the GAIN is capped low when the
    // cast is fracturing: under social pressure you don't get to feel certain about people just
    // because they were briefly legible. Dispersion both caps the gain and erodes the stock.
    const confGain = (0.12 - weightedErr * 0.45) * (1 - dispersion * 0.7);
    b.confidence = clamp(b.confidence + confGain, 0.05, 0.98);
    // DISPERSION erodes settled certainty: a cast that's pulling apart stops reading each other
    // perfectly. This is what breaks the omniscient-chorus fixed point — confidence can no longer
    // ratchet to 0.98 and stay there. Strongest on the most certain models; scales with diversification.
    b.confidence = clamp(b.confidence - dispersion * 0.22 * b.confidence, 0.05, 0.98);
    b.updated_turn = turn;

    // a large, sustained PERCEIVED warmth gap that the agent keeps NOT resolving crystallizes into a
    // concrete false belief — the misunderstanding that can drive a scene. The gap is measured against
    // the percept: a sealed mind keeps perceiving hostility even as the truth contradicts it, so the
    // false belief holds until either a breakthrough lands or the player stops feeding misreadable acts.
    if (b.surprise > 0.6 && Math.abs(seenWarmth - b.predicted_warmth) > 35 && !b.held_false) {
      const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
      b.held_false = seenWarmth < b.predicted_warmth
        ? `is convinced ${tname} has turned on them`
        : `can't believe ${tname} actually means them well`;
    } else if (b.held_false && Math.abs(seenWarmth - b.predicted_warmth) < 12 && b.surprise < 0.25) {
      const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
      const sname = state.characters[id]?.name ?? id;
      lines.push(`${sname} finally sees ${tname} clearly — the misunderstanding clears.`);
      b.held_false = undefined;
    }
  }

  return { lines, peakSurprise, epistemicTarget };
}

/** The narrator's window into a present character's HEAD: what they believe (possibly
 *  wrongly) about the player, and any misread they're carrying. This is what makes a
 *  scene play on the character's model instead of the truth. Returns "" when the model
 *  matches reality closely (no divergence worth spending words on). */
export function mindDigest(state: SaveState, id: string): string {
  const model = state.minds?.[id];
  if (!model) return "";
  const out: string[] = [];
  for (const b of model.about) {
    if (b.target !== "char_player") continue; // narrator block is player-facing; lateral models stay internal
    const trueEdge = state.world.edges.find((e) => e.to === "char_player" && e.from === id);
    const trueWarmth = trueEdge?.warmth ?? 0;
    const divergence = Math.abs(trueWarmth - b.predicted_warmth);
    // only surface the model when it MEANINGFULLY differs from truth, or there's a held misread / live surprise
    // Behavioral imperatives, not quotable belief-statements: the narrator must let the misread COLOR
    // behavior without ever naming the belief in prose ("she believed he had betrayed her").
    if (b.held_false) out.push(`acts as if the player ${b.held_false} — let this false read drive their behavior and word choice; NEVER state the belief in prose, only show them acting on it`);
    else if (divergence > 25) out.push(`treats the player as ${b.predicted_stance === "unknown" ? "an unknown quantity" : b.predicted_stance === "ally" ? "warmer than they truly are" : "more hostile than they truly are"} — behavior follows their read; do not narrate the misjudgment`);
    if (b.surprise > 0.45) out.push(`is freshly thrown — the player just did something against their expectation; SHOW the recalibration, don't state it`);
    if (b.confidence < 0.25 && Math.abs(trueWarmth) > 25) out.push(`can't get a clean read on the player — SHOW it as watchfulness or probing, never as narrated confusion`);
  }
  return out.length ? `how they read you (behavior only, never stated in prose): ${out.join("; ")}` : "";
}

/** An epistemic drive goal-string: A wants to resolve uncertainty about `target`. The
 *  existing drive/QRE machinery executes it like any other want. */
export function epistemicGoal(state: SaveState, target: string): string {
  const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
  return `find out where ${tname} really stands — test them, probe, get a read`;
}

