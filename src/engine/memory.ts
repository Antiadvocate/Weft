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

export function recency(deltaTurns: number, halfLife = HALF_LIFE_TURNS): number {
  return Math.exp((-Math.LN2 * Math.max(0, deltaTurns)) / halfLife);
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

/** Should we run a reflection pass? Importance-sum trigger + cadence. */
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

export function compactMemoryDigest(mem: CharMemory, query: string, currentTurn: number, k: number): string {
  const parts: string[] = [];
  if (mem.core.length) parts.push(`CORE: ${mem.core.join(" | ")}`);
  if (mem.beliefs.length) parts.push(`BELIEFS: ${mem.beliefs.slice(-6).map((b) => b.content).join(" | ")}`);
  const top = retrieve(mem, query, currentTurn, k);
  if (top.length) parts.push(`RECALLS: ${top.map((m) => `[T${m.turn}${m.commitment_status === "pending" ? `, due ${m.scheduled_time}` : ""}] ${m.content}`).join(" | ")}`);
  return parts.join("\n");
}
