import { parseTime } from "./time";
/**
 * Generative-agents memory (Park et al. 2023, arXiv:2304.03442), embedding-free.
 *
 * retrieval(m, q, t) = α·recency(t − t_access) + β·importance(m) + γ·relevance(m, q)
 *   recency   = exp(−ln2 · Δturns / H)        H = half-life in turns
 *   importance= normalized poignancy 0..1
 *   relevance = token-overlap cosine (BM25-lite, no API call, zero tokens)
 *
 * Reflection (every R turns): episodic memories above an importance-sum
 * threshold are compressed into Beliefs by one cheap LLM call, then the
 * compressed episodics are dropped. This bounds per-character context at
 * O(core + beliefs + k) — constant in total turn count. See verify.ts for
 * the geometric-series bound and Monte Carlo precision checks.
 */
import type { CharMemory, EpisodicMemory, Belief } from "./types";

export const HALF_LIFE_TURNS = 24;       // recency half-life
export const ALPHA = 1.0, BETA = 1.0, GAMMA = 1.5;

const STOP = new Set(["the","a","an","and","or","but","of","to","in","on","at","is","was","were","it","he","she","they","you","i","with","for","that","this","his","her","my","your"]);

export function tokenize(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}

export function relevance(memory: string, query: string): number {
  const a = tokenize(memory), b = tokenize(query);
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [w, v] of b) { nb += v * v; const av = a.get(w); if (av) dot += av * v; }
  return dot === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * MOOD-CONGRUENT RECALL — the perception gate pointed inward at the past.
 * A memory carries no fixed emotional value; its valence is recomputed on retrieval through the
 * recaller's CURRENT state. A clenched person recalls a shared evening as the night it started
 * going wrong; an open person recalls the same evening as warmth. We don't rewrite the stored
 * trace here (that's reconsolidation, and it's gated) — we tint how the memory PRESENTS to the
 * narrator, so the character recalls it colored by how they're holding themselves right now.
 * Returns a short lens cue, or "" when the recaller is level (no distortion).
 */
export function recallTint(relaxation: number): string {
  if (relaxation <= -7) return "recalled through a clenched, sour lens — its worst reading foregrounded, slights and threats sharpened, the warmth in it hard to feel right now";
  if (relaxation <= -3) return "recalled warily — the guarded reading, what went wrong easier to reach than what went right";
  if (relaxation >= 6) return "recalled warmly — its kinder reading, the good in it foregrounded, old friction softened";
  if (relaxation >= 3) return "recalled with some ease — leaning toward the better reading of it";
  return "";
}

export function recency(deltaTurns: number, halfLife = HALF_LIFE_TURNS): number {
  return Math.exp((-Math.LN2 * Math.max(0, deltaTurns)) / halfLife);
}

/**
 * MEMORY DECAY — graceful degradation, modeling how human episodic memory actually fades:
 *   stage 0  vivid: full somatic detail, exact words, place, the works (just happened)
 *   stage 1  gist + person + place: you have the shape of it, not the exact words
 *   stage 2  gist + person, PLACE LOST: where is gone (but reconstructable from temporal neighbors)
 *   stage 3  person + bare gist: just who, and a compacted sense of what
 *
 * Decay is driven by AGE since the event, slowed hard by importance (a life-marking moment stays
 * vivid for a long time; a passing exchange blurs within days) and by recent access (recalling a
 * memory refreshes it). This is the derive-don't-store kernel applied to memory: we keep the gist
 * and the person, drop the specifics, and let place be reconstructed from what surrounds it in time.
 * Deterministic, zero tokens. The text itself is rewritten to its faded form lazily, at reflection.
 */
export function decayStageFor(m: EpisodicMemory, currentTurn: number): 0 | 1 | 2 | 3 {
  if (m.commitment_status === "pending" || m.folded) return 0; // live commitments and folded-into-identity memories don't blur
  const age = currentTurn - m.turn;
  const sinceAccess = currentTurn - m.last_accessed_turn;
  const base = age * 0.6 + sinceAccess * 0.4;             // unaccessed memories blur faster
  // EXPONENTIAL on the unimportant: a trivial memory's effective age accelerates, so it falls off
  // a cliff; a searing one's barely moves. importance in [1,10] → forget-rate factor.
  // imp 1: ~age^1.5 (collapses fast). imp 10: ~age^0.55 (stays vivid for a very long time).
  const exponent = 1.6 - (m.importance / 10) * 1.05;       // 1.55 (trivial) .. 0.55 (searing)
  const effAge = Math.pow(Math.max(0, base), exponent);
  if (effAge < 4) return 0;
  if (effAge < 10) return 1;
  if (effAge < 22) return 2;
  return 3;
}

/** Advance decay stages each turn (structural only — text rewrite happens lazily at reflection). */
export function tickMemoryDecay(mem: CharMemory, currentTurn: number): void {
  for (const m of mem.episodic) {
    const stage = decayStageFor(m, currentTurn);
    if ((m.decay_stage ?? 0) < stage) {
      m.decay_stage = stage;
      if (stage >= 2) m.where = undefined; // place is lost at the gist-only stage (reconstructable, not stored)
    }
  }
}

/** Commitment boost: a pending appointment whose time is near outranks decay. */
function commitmentBoost(m: EpisodicMemory, currentTurn: number): number {
  if (m.commitment_status !== "pending" || !m.scheduled_time) return 0;
  return 0.8; // pending commitments are always near the surface
}

export function score(m: EpisodicMemory, query: string, currentTurn: number): number {
  return (
    ALPHA * recency(currentTurn - m.last_accessed_turn) +
    BETA * (m.importance / 10) +
    GAMMA * relevance(m.content, query) +
    commitmentBoost(m, currentTurn)
  );
}

export function retrieve(mem: CharMemory, query: string, currentTurn: number, k: number): EpisodicMemory[] {
  const ranked = [...mem.episodic]
    .map((m) => ({ m, s: score(m, query, currentTurn) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.m);
  for (const m of ranked) m.last_accessed_turn = currentTurn; // access refreshes recency
  return ranked;
}

/**
 * INTEGRATION GATE — whether a character actually absorbs a correction/detail someone supplies.
 * Not automatic: the same kernel logic as perception, applied to whose account you trust. You fold
 * another person's version into your memory only if your bond to them carries it.
 *
 *   bond     = warmth + trust toward the SOURCE (do I credit this person's account?)
 *   resist   = how clenched the receiver is (a stressed/guarded mind digs into its own version)
 *
 * The dynamic specified: clench makes you RESIST, but a strong warm/trusting bond OVERRIDES the
 * resistance — an annoyed but loving partner will still question their own memory and take the
 * correction. Bond is the override term, clench is the resistance term. Low bond + any clench →
 * reject (hold your version). High bond → integrate even while annoyed. Neutral acquaintance → it
 * mostly rides on whether they're calm enough to be open to it.
 */
export function integrationGate(receiverRelaxation: number, warmthToSource: number, trustToSource: number): boolean {
  const bond = (warmthToSource + trustToSource) / 2;      // -100..100: do I credit their account?
  const resist = Math.max(0, -receiverRelaxation) / 10;    // 0 (open) .. 1 (clenched tight)
  const acceptance = bond / 100 - resist * 0.6;            // warm trust survives stress
  return acceptance > -0.1;  // people usually defer to a credible account unless distrustful or hard-clenched against a weak bond
}

/**
 * RECONSOLIDATION — recall rewrites the trace. Memory is reconstructive, not reproductive: when
 * a past event is actively discussed and someone supplies detail, the retrieved memory is rebuilt,
 * and the rebuilt version (including the supplied detail, even if wrong, and the recaller's mood)
 * OVERWRITES the original. A decayed "blue dresses, dancing" recoheres with "and cake, and music"
 * into one fuller trace — and the character can no longer tell which parts they witnessed and which
 * were supplied. This counters decay (discussed memories stay alive and sharp) and lets false detail
 * propagate. Finds the best-matching existing memory; if none, this was genuinely new (caller adds it
 * as a fresh memory instead).
 */
export function reconsolidate(mem: CharMemory, about: string, addedDetail: string, currentTurn: number): boolean {
  // match the memory being discussed by content overlap
  let best: EpisodicMemory | null = null, bestScore = 0;
  for (const m of mem.episodic) {
    const s = relevance(m.content + " " + (m.full_content ?? ""), about);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  if (!best || bestScore < 0.15) return false; // nothing close enough — not a recoherence, it's new
  // rebuild: fold the supplied detail in, restore vividness (recall sharpens), mark it freshly handled
  const merged = best.content.includes(addedDetail) ? best.content : `${best.content} ${addedDetail}`.replace(/\s+/g, " ").trim();
  best.content = merged;
  best.full_content = merged;                 // the rebuilt version IS the memory now
  best.decay_stage = Math.max(0, (best.decay_stage ?? 0) - 2) as 0 | 1 | 2 | 3; // recohered: pulled back toward vivid
  best.importance = Math.min(10, best.importance + 1); // discussed = mattered
  best.last_accessed_turn = currentTurn;      // refreshes recency
  return true;
}
export function reflectionDue(mem: CharMemory, cadence: number, currentTurn: number): boolean {
  if (currentTurn % cadence !== 0) return false;
  const unreflected = mem.episodic.filter((m) => m.turn > (mem.beliefs.at(-1)?.formed_turn ?? 0));
  const sum = unreflected.reduce((s, m) => s + m.importance, 0);
  return sum >= 25 || unreflected.length >= 12;
}

/** After the LLM produces beliefs, fold them in and compact the episodic store. */
export function applyReflection(mem: CharMemory, beliefs: Belief[], currentTurn: number, keepRecent = 8): void {
  mem.beliefs.push(...beliefs);
  if (mem.beliefs.length > 14) mem.beliefs = mem.beliefs.slice(-14);
  // keep the most recent + the few highest-importance episodics; drop the rest (now represented as beliefs)
  const recent = mem.episodic.filter((m) => currentTurn - m.turn <= keepRecent);
  const old = mem.episodic
    .filter((m) => currentTurn - m.turn > keepRecent)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 6);
  const pending = mem.episodic.filter((m) => m.commitment_status === "pending");
  const seen = new Set<EpisodicMemory>();
  mem.episodic = [...recent, ...old, ...pending].filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
}

function agoLabel(whenLabel: string | undefined, nowLabel: string): string {
  if (!whenLabel) return "";
  const a = parseTime(whenLabel), b = parseTime(nowLabel);
  const mins = (b.day - a.day) * 1440 + (b.hour - a.hour) * 60 + (b.minute - a.minute);
  if (mins < 0) return whenLabel;
  if (mins < 90) return "earlier today";
  if (b.day === a.day) return "earlier today";
  const days = b.day - a.day;
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

export function compactMemoryDigest(mem: CharMemory, query: string, currentTurn: number, k: number, nowLabel = "", recallerRelaxation = 0): string {
  const parts: string[] = [];
  if (mem.core.length) parts.push(`CORE: ${mem.core.join(" | ")}`);
  if (mem.beliefs.length) parts.push(`BELIEFS: ${mem.beliefs.slice(-6).map((b) => b.content).join(" | ")}`);
  const top = retrieve(mem, query, currentTurn, k);
  if (top.length) {
    const tint = recallTint(recallerRelaxation);
    parts.push(`RECALLS${tint ? ` (${tint})` : ""}: ${top.map((m) => {
    const stage = m.decay_stage ?? 0;
    const ago = agoLabel(m.when_label, nowLabel);
    // place: present at stages 0–1; at stage 2+ it's lost but reconstructable from a neighbor memory
    let place = m.where ? `at ${m.where}` : "";
    if (!m.where && stage >= 2) {
      const neighbor = mem.episodic.find((o) => o !== m && o.where && Math.abs(o.turn - m.turn) <= 3);
      if (neighbor?.where) place = `somewhere around ${neighbor.where}`; // contextual reconstruction
    }
    // temporal stamp fades too: vivid memories carry the exact time; old ones only the rough "ago"
    const when = stage <= 1 ? [m.when_label, ago && ago !== m.when_label ? `≈${ago}` : ""].filter(Boolean).join(", ") : ago;
    const stamp = [when, place].filter(Boolean).join(", ");
    const due = m.commitment_status === "pending" ? `, STILL DUE ${m.scheduled_time}` : "";
    const faded = stage >= 3 ? " (a dim, distant impression)" : stage === 2 ? " (hazy now)" : "";
    return `[${stamp || `T${m.turn}`}${due}] ${m.content}${faded}`;
  }).join(" | ")}`);
  }
  return parts.join("\n");
}
