import { parseTime } from "./time";
import { factGate, factOverlap } from "./facts";
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
import type { CharMemory, EpisodicMemory, Belief, SaveState } from "./types";

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
  // A LIVE COMMITMENT DOES NOT BLUR — BUT ALMOST NONE OF THESE ARE LIVE COMMITMENTS.
  //
  // This exempted every memory carrying `commitment_status: "pending"`, and `commitmentBoost` below
  // has a whole paragraph on what that flag actually means in practice: "Set scheduled_time whenever
  // something is left unfinished" reads to the simulator as EVERYTHING, measured at 98-100% of
  // episodic memories in a live save. The retrieval side was fixed for it — an unclocked loop's
  // salience is live for a day, fades after, gone after three — and the decay side never was. So in
  // a 24-turn save 21 of 45 memories carried `scheduled_time: "unresolved"` and were pinned at
  // stage 0 permanently. Replayed forward to turn 150 they are still at stage 0.
  //
  // `folded` was the other half. It marks a memory whose gist has already been folded into the
  // character's life_history, which makes the episodic copy REDUNDANT — the least valuable thing in
  // the bank to keep at full fidelity, not the most. Terminal decay already declines to promote a
  // folded memory into a fact for exactly this reason (its gist is elsewhere); it should be allowed
  // to reach terminal decay in the first place.
  //
  // What stays vivid: a commitment with a real clock on it. That is what "she is expecting me at
  // nine" means, and it is rare enough to be worth exempting.
  if (m.commitment_status === "pending") {
    const unclocked = !m.scheduled_time || /^unresolved$/i.test(String(m.scheduled_time).trim());
    if (!unclocked) return 0;
    if (currentTurn - m.turn <= 12) return 0;   // an unclocked loop is live for about a day of turns
  }
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

/** STORE RECONCILIATION — the same remembered thing must not occupy core, facts, AND episodic at
 *  once (the duplication bug). One canonical home per memory, by kind:
 *   • core = life-defining autobiography (a founding, a first, an irreversible turn) — the spine.
 *   • facts = durable semantic knowledge (biography, standing truths, semanticized residue).
 *   • episodic = lived experiences that still carry texture and still decay.
 *  When content is echoed across stores, the most-semantic surviving copy wins and the others are
 *  dropped: core outranks facts outranks episodic for the SAME content. Runs on load and after
 *  each decay tick, so drift self-heals. */
export function reconcileStores(mem: CharMemory): void {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const overlap = (a: string, b: string): number => {
    const A = new Set(norm(a)), B = new Set(norm(b));
    if (!A.size || !B.size) return 0;
    let i = 0; for (const w of A) if (B.has(w)) i++;
    return i / Math.min(A.size, B.size);
  };
  // core is authoritative: any fact or episodic memory it subsumes is a duplicate
  for (const c of mem.core) {
    mem.facts = (mem.facts ?? []).filter((f) => overlap(c, f.content) < 0.6);
    mem.episodic = mem.episodic.filter((m) => overlap(c, m.full_content ?? m.content) < 0.6 || (m.commitment_status === "pending"));
  }
  // facts outrank still-decaying episodic copies of the SAME settled knowledge (the experience
  // already became a fact — keep the fact, release the redundant scene), but never touch a live
  // commitment or a still-vivid (stage 0) memory that hasn't finished becoming knowledge yet.
  for (const f of mem.facts ?? []) {
    mem.episodic = mem.episodic.filter((m) =>
      m.commitment_status === "pending" || (m.decay_stage ?? 0) < 2 || overlap(f.content, m.full_content ?? m.content) < 0.6);
  }
}

/** How long a memory's text is allowed to be at each decay stage. */
const STAGE_LEN: Record<number, number> = { 1: 150, 2: 110, 3: 70 };

/**
 * THE STEP THAT WAS NEVER WRITTEN.
 *
 * The block above this one describes four decay stages and ends "The text itself is rewritten to
 * its faded form lazily, at reflection." Nothing ever rewrote it. `tickMemoryDecay` advanced
 * `decay_stage`, cleared `where`, and returned; `applyReflection` pruned the store and never
 * touched a character's words. `tickMemoryDecay` is byte-identical to the first commit in this
 * repository, so the fade has never once run.
 *
 * Everything downstream was built assuming it had. The digest renders `content` for a faded memory
 * and `full_content` only for the two the moment strongly cues — but with the fade missing those
 * are the same string, so a "dim, distant impression" was shipped to the narrator at full length
 * and the only compression anywhere was `raw.slice(0, 170)` at render: a hard mid-word cut that
 * regularly severs a memory before its own object. From a save at turn 24: fifteen memories had
 * reached stage 2 or 3 and every one of them still held its complete original text.
 *
 * And it takes the whole reconsolidation idea with it. `reconsolidate` pulls a memory two stages
 * back toward vivid when new detail is integrated — recalling something and re-storing it changed.
 * There was nothing to change. The gist it would re-cohere from never existed.
 *
 * What goes first is what goes first in people: the exact words. Then the surrounding clauses, then
 * everything but who and what. `full_content` is kept untouched, so a strong cue still brings the
 * whole thing back — that contrast is the entire point of storing both.
 */
export function fadeToStage(full: string, stage: 0 | 1 | 2 | 3): string {
  const original = String(full ?? "").replace(/\s+/g, " ").trim();
  if (stage <= 0 || !original) return original;
  const budget = STAGE_LEN[stage] ?? 110;

  // 1. VERBATIM SPEECH IS THE MOST PERISHABLE THING IN A MEMORY. People keep what was said and lose
  //    how it was said within hours, so a quoted line is the first thing to stop being exact. The
  //    speech verb it hung off has to be given something back, or the sentence loses its object:
  //    `Rabi said "you already know what I am" and I did not answer` must not fade to `Rabi said
  //    and I did not answer`.
  let t = original.replace(/\s*["“][^"”]{0,400}["”]\s*/g, " ").replace(/\s+/g, " ").trim();
  if (t !== original) {
    t = t.replace(
      /\b(said|says|told (?:me|him|her|them|us)|asked|answered|replied|shouted|snapped|whispered|muttered|added)(?=\s*(?:[,.;]|$|\b(?:and|but|then)\b))/gi,
      "$1 something",
    ).replace(/\s+([,.;])/g, "$1").replace(/\s+/g, " ").trim();
  }
  //    ...unless the memory was ALL speech, in which case removing it removes the memory.
  if (t.split(/\s+/).filter(Boolean).length < 4) t = original;

  // 2. AT TERMINAL DECAY ONLY THE HEAD CLAUSE SURVIVES: who, and what, and nothing after it.
  if (stage >= 3) t = t.split(/\s*[;—–]\s*|,\s+(?:and|but|then|which|while|so|because)\s+/)[0];

  // 3. AND THEN IT HAS TO ACTUALLY BE SHORTER. compactGist only ever cuts on sentence boundaries —
  //    its loop takes the first sentence whole however long it is — and a memory is almost always
  //    ONE sentence, so on its own it returns the input unchanged and the fade does nothing. Cut to
  //    the budget on a word boundary after it, never mid-word, which is the failure the render-time
  //    `slice(0, 170)` has been committing on every long memory in the digest.
  let out = compactGist(t, budget);
  if (out.length > budget) out = out.slice(0, budget).replace(/\s+\S*$/, "").replace(/[\s,;:]+$/, "") + "…";
  out = out.replace(/[\s,;:]+$/, "").trim();
  // A cut that lands inside a quoted span leaves an opening mark with nothing to close it. At this
  // point the exact words are going anyway, so drop the marks rather than ship the orphan.
  if ((out.match(/["“”]/g) ?? []).length % 2 === 1) out = out.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  return out || original;
}

export function tickMemoryDecay(mem: CharMemory, currentTurn: number): void {
  const semanticized: EpisodicMemory[] = [];
  for (const m of mem.episodic) {
    const stage = decayStageFor(m, currentTurn);
    if ((m.decay_stage ?? 0) < stage) {
      // Preserve the vivid original BEFORE the first fade overwrites it — full recall reads this,
      // and a memory that faded without keeping one can never come back sharp.
      m.full_content ??= m.content;
      m.decay_stage = stage;
      m.content = fadeToStage(m.full_content, stage);
      if (stage >= 2) m.where = undefined; // place is lost at the gist-only stage (reconstructable, not stored)
    }
    // SEMANTICIZATION (Ribot's gradient): a memory reaching terminal decay does not vanish — if
    // it mattered (importance ≥6), its GIST survives as a durable semantic fact ("I knew this
    // person; this happened") while the perceptual experience is released from episodic memory.
    // This is the marriage: the day's light fades, but "we married, and it rained" is kept for
    // life as knowledge, not re-lived as scene. Low-importance memories at terminal decay simply
    // fade (nobody carries a forgettable Tuesday as a fact).
    if (stage >= 3 && !m.folded) {
      if ((m.importance ?? 3) >= 6) { addFactLocal(mem, semanticGist(m), m.turn); semanticized.push(m); }
      else if ((m.importance ?? 3) <= 2) semanticized.push(m); // trivial + terminal → released
    }
  }
  if (semanticized.length) mem.episodic = mem.episodic.filter((m) => !semanticized.includes(m));
  reconcileStores(mem);
}

/** Local fact-writer (mirrors facts.addFact) — kept here to avoid a value-level import cycle
 *  between memory.ts and facts.ts. Same quality gate and fuzzy dedupe. */
function addFactLocal(mem: CharMemory, fact: string, turn: number): void {
  mem.facts ??= [];
  const f = fact.trim();
  if (!f || !factGate(f).ok) return;
  const near = mem.facts.find((x) => relevance(x.content, f) >= 0.6 || factOverlap(x.content, f) >= 0.6);
  if (near) { if (f.length > near.content.length + 12) near.content = compactGist(f, 140); near.turn = turn; return; }
  mem.facts.push({ content: compactGist(f, 140), turn });
  if (mem.facts.length > 30) { mem.facts.sort((a, b) => a.turn - b.turn); mem.facts.shift(); }
}

/** The durable residue of a faded memory: its gist, stated as settled knowledge rather than
 *  scene. Strips first/second-person immediacy so it reads as a fact, not a re-experience. */
function semanticGist(m: EpisodicMemory): string {
  const g = compactGist(m.full_content ?? m.content, 120).replace(/\s+/g, " ").trim();
  return g;
}

/** Commitment boost: a pending appointment outranks decay — hard when its time is NEAR,
 *  soft when it is still days out (a dinner next week shouldn't crowd out today). */
function commitmentBoost(m: EpisodicMemory, currentTurn: number, nowLabel = ""): number {
  if (m.commitment_status !== "pending" || !m.scheduled_time) return 0;
  // UNCLOCKED OPEN LOOP: most unfinished business has no due time — an answer owed, a message
  // interrupted, a question left hanging. It used to be unrepresentable, since the boost required a
  // parseable timestamp, so the only open loops that survived mood-gating were the ones that
  // happened to have a calendar entry. An open loop with no clock is not less live than one with
  // one; it sits at the "within a day" weight, which is enough to clear a run of same-toned
  // memories crowding the top-k.
  // SATURATION GUARD. "Set scheduled_time whenever something is left unfinished" turned out to mean
  // EVERYTHING to the simulator — measured at 98-100% of episodic memories marked open in a live
  // save. A boost every memory receives is not a boost; it flattens retrieval back to noise, and
  // worse, nothing ever closes, so the character keeps re-opening business she already settled and
  // asks the same question a third time. An unclocked loop therefore DECAYS: live for a day of
  // in-world time, fading after, gone after three. Real unfinished business gets re-touched by events;
  // the rest quietly stops nagging, which is what actually happens to people.
  if (/^unresolved$/i.test(m.scheduled_time.trim())) {
    const age = currentTurn - m.turn;
    if (age <= 12) return 0.8;
    if (age <= 40) return 0.35;
    return 0;
  }
  if (!nowLabel) return 0.8;
  const a = parseTime(nowLabel), b = parseTime(m.scheduled_time);
  const mins = (b.day - a.day) * 1440 + (b.hour - a.hour) * 60 + (b.minute - a.minute);
  if (mins <= 0) return 0.9;              // due or overdue: front of mind
  if (mins <= 1440) return 0.8;           // within a day
  if (mins <= 3 * 1440) return 0.5;       // within three days
  return 0.25;                            // distant: present, not dominant
}

/** Rough valence of a memory's emotional charge: −1 threat/pain … +1 warmth/safety, 0 neutral.
 *  Used for state-gated retrieval — a clenched mind reaches for threat-toned memories, an open
 *  mind for warm ones (mood-congruent RETRIEVAL, not just mood-congruent coloring). */
function chargeValence(charge: string): number {
  if (!charge) return 0;
  const c = charge.toLowerCase();
  const threat = /(fear|terror|dread|anger|rage|fury|betray|shame|humiliat|grief|loss|pain|hurt|panic|threat|danger|disgust|hatred|hostil|wound|violat|abandon|despair|anguish|cold|menace)/;
  const warm = /(warmth|love|tender|joy|relief|safe|comfort|trust|pride|hope|affection|peace|delight|gratitude|belong|content|ease|playful|fond)/;
  if (threat.test(c)) return -1;
  if (warm.test(c)) return 1;
  return 0;
}

export function score(m: EpisodicMemory, query: string, currentTurn: number, recallerRelaxation = 0, nowLabel = ""): number {
  // relevance matches the FULL trace, not just the decayed gist — a faded memory can still be the
  // right one when the scene cues its original detail (the cue is what brings it back vivid).
  const rel = Math.max(relevance(m.content, query), relevance(m.full_content ?? m.content, query));
  // STATE-GATED RETRIEVAL: the recaller's current openness shifts WHICH memories surface, not just
  // how they're worded. A clenched mind (negative relaxation) reaches for threat/pain-toned
  // memories — old defensive precedents — and away from warmth; an open mind reaches for warm ones.
  // congruence is +1 when the memory's valence matches the recaller's lean, −1 when it opposes.
  const lean = clampN(recallerRelaxation / 10, -1, 1);      // −1 clenched … +1 open
  const congruence = chargeValence(m.emotional_charge) * lean; // same sign → boost, opposite → suppress
  const stateBias = congruence * 0.4 * Math.abs(lean);        // scales with how far from neutral the recaller is
  return (
    ALPHA * recency(currentTurn - m.last_accessed_turn) +
    BETA * (m.importance / 10) +
    GAMMA * rel +
    stateBias +
    commitmentBoost(m, currentTurn, nowLabel)
  );
}

function clampN(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

/** Retrieve top-k, exposing each memory's relevance-to-query so the digest can decide which few
 *  to render at FULL fidelity (the scene is reaching into them) vs decayed gist (the default). */
export function retrieveScored(mem: CharMemory, query: string, currentTurn: number, k: number, recallerRelaxation = 0, nowLabel = ""): { m: EpisodicMemory; rel: number }[] {
  const ranked = [...mem.episodic]
    .map((m) => ({ m, s: score(m, query, currentTurn, recallerRelaxation, nowLabel), rel: Math.max(relevance(m.content, query), relevance(m.full_content ?? m.content, query)) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, k);
  for (const x of ranked) {
    // RICH-GET-RICHER GUARD: a memory the scene actually reached into (real relevance) is
    // rehearsed — full refresh. One that surfaced only on recency/importance gets a half-step,
    // so the same top-k can't lock itself in forever by being retrieved.
    x.m.last_accessed_turn = x.rel >= 0.2 ? currentTurn : Math.round((x.m.last_accessed_turn + currentTurn) / 2);
  }
  return ranked.map(({ m, rel }) => ({ m, rel }));
}

export function retrieve(mem: CharMemory, query: string, currentTurn: number, k: number): EpisodicMemory[] {
  const ranked = [...mem.episodic]
    .map((m) => ({ m, s: score(m, query, currentTurn) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.m);
  for (const m of ranked) m.last_accessed_turn = Math.round((m.last_accessed_turn + currentTurn) / 2); // half-step (see retrieveScored)
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
  if (!best || bestScore < 0.3) return false; // nothing close enough — not a recoherence, it's new
  // PROPER-NOUN CONFLICT GUARD: reconsolidation rewrites the trace, so a mismatched merge is how
  // "Seattle" becomes "Portland" permanently. If the supplied detail introduces a capitalized name
  // the target memory doesn't contain, require a much stronger match before we let it overwrite.
  const newNames = (addedDetail.match(/\b[A-Z][a-zA-Z'’-]{2,}\b/g) ?? []).filter((n) => !(best!.content + " " + (best!.full_content ?? "")).includes(n));
  if (newNames.length && bestScore < 0.5) return false;
  // rebuild: fold the supplied detail in, restore vividness (recall sharpens), mark it freshly handled
  const merged = best.content.includes(addedDetail) ? best.content : `${best.content} ${addedDetail}`.replace(/\s+/g, " ").trim();
  best.content = merged;
  best.full_content = merged;                 // the rebuilt version IS the memory now
  best.decay_stage = Math.max(0, (best.decay_stage ?? 0) - 2) as 0 | 1 | 2 | 3; // recohered: pulled back toward vivid
  best.importance = Math.min(10, best.importance + 1); // discussed = mattered
  best.last_accessed_turn = currentTurn;      // refreshes recency
  return true;
}

/**
 * GIST COMPACTION — a memory trace is a gist, not an essay. Stored memories are kept tight (a
 * paragraph of vivid prose costs ~80 tokens and repeats in context every turn it's recalled). Keeps
 * whole leading sentences up to a budget, preserving the core event; drops trailing elaboration.
 * The original is preserved in full_content so decay/recoherence can still reach it. Lossy by design.
 */
export function compactGist(text: string, maxLen = 170): string {
  if (!text || text.length <= maxLen) return text;
  // Protect common abbreviations from being read as sentence ends, then split, then restore.
  // Two classes: simple trailing-dot (Mr. Dr.) and internal-dot (a.m. e.g. i.e.) — guard both.
  const guarded = text
    .replace(/\b(a\.m|p\.m|e\.g|i\.e)\./gi, (m) => m.replace(/\./g, "\u0001"))
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sgt|Capt|Lt|Col|Gen|Gov|Sr|Jr|St|vs|etc|No)\.(\s|$)/gi, (_m, a, sp) => `${a}\u0001${sp}`);
  const sents = guarded.match(/[^.!?]+[.!?]+/g) ?? [guarded];
  let out = "";
  for (const s of sents) { if ((out + s).length > maxLen && out) break; out += s; }
  out = (out.trim() || text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…");
  return out.replace(/\u0001/g, "."); // restore protected periods
}

/**
 * A MEMORY IS SOMEBODY'S ACCOUNT OF WHAT HAPPENED, NOT A CLIPPING FROM THE PAGE.
 *
 * The contract asks for "one tight sentence, the core of what happened" and says nothing about
 * whose account it is or what form it takes. One save's memory bank shows what that permits:
 *
 *   "Hey in getting a divorce.                         ← the player's own typed text, filed as HERS
 *   "I don't want to be that woman on the train.       ← a dangling quote fragment
 *   How about you?                                     ← a line of dialogue with no context at all
 *   Rabi demanded the universe obey HER wishes, and SHE deflected…
 *   Rabi joked about serenading ME and I dared him…    ← the same person, two turns apart
 *
 * Two separate failures. The person flips between first and third for the same character, which is
 * what makes them read as if she did the thing the player did. And raw quoted spans get stored as
 * memories, which is how the player's own words ended up in somebody else's head — the player wrote
 * "Hey in getting a divorce" as a text message from a car, and it became a thing Tessa remembers.
 *
 * Returns the repaired content, or null if there is nothing recoverable.
 */
export function cleanMemoryContent(content: unknown, opts: { name: string; isPlayer: boolean; playerAction?: string }): string | null {
  let t = String(content ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  // 1. A BARE QUOTE IS NOT A MEMORY. A span that is mostly quoted speech with no account around it
  //    records the words and loses who said them, which is exactly how they end up owned by the
  //    wrong person on the next read.
  const unbalanced = (t.match(/["\u201c\u201d]/g) ?? []).length % 2 === 1;
  const startsQuoted = /^["\u201c]/.test(t);
  if (startsQuoted && unbalanced) return null;                 // `"Hey in getting a divorce.`
  if (startsQuoted && /^["\u201c][^"\u201d]*["\u201d]$/.test(t)) return null;  // a whole line, nothing else
  // A fragment with no clause in it is a line off the page, not an account of anything. Four words
  // cannot say who did what: `How about you?` was sitting in a character's memory bank.
  if (t.length < 12 || t.split(/\s+/).length < 5) return null;

  // 2. THE PLAYER'S OWN WORDS ARE NEVER SOMEBODY ELSE'S MEMORY. Verbatim, or near enough that it is
  //    plainly a copy rather than an account of having heard it.
  const pa = String(opts.playerAction ?? "").replace(/\s+/g, " ").trim();
  if (!opts.isPlayer && pa.length > 12) {
    const bare = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const b = bare(t);
    if (b.length > 12 && bare(pa).includes(b)) return null;
  }

  // 3. THE PLAYER'S MEMORY RECORDS WHAT THEY DID, NOT A VERDICT ON WHY. The bookkeeper likes to
  //    close a player memory with an interpretation of their inner life — "Rabi apologized to Tessa
  //    for his lack of trust, CONVINCED THAT HER LOYALTY REMAINED INTACT throughout the affair."
  //    A memory outlives the turn it was written in and a promoted one is permanent, so a clause
  //    like that keeps telling the narrator what the player believes ninety turns after they
  //    stopped believing it — which reads, from inside the story, as a character who feels
  //    permanently at fault no matter what they do. Keep the act; drop the ruling on the motive.
  if (opts.isPlayer) {
    const stripped = t.replace(/,\s*(convinced|believing|certain|sure|knowing|feeling|thinking|hoping|convincing himself|convincing herself|convincing themselves)\b[^.!?]*/gi, "");
    // only take it if an actual account survives — never turn a memory into a fragment
    if (stripped.trim().length >= 20) t = stripped.replace(/\s+([.!?])/g, "$1").trim();
  }

  // 4. A MEMORY BELONGS TO SOMEBODY, AND THE TEXT HAS TO SAY SO.
  //
  //    This used to run the other way: rewrite first person INTO third, on the reasoning that a
  //    memory written about its owner from outside "can be handed to any reader without changing
  //    meaning". It fixed the flipping it was written for and created something worse, because
  //    third person about yourself is not one voice — it is a name and then a pronoun, and the
  //    pronoun has no anchor. Two entries from one save:
  //
  //      in Lucia's bank:  "Rabi put the soft-soled shoes on HER bare feet ... and SHE flushed"
  //      in Tigris's bank: "Rabi gave HER a pair of shoes ... which SHE took with a thank-you"
  //
  //    Same shape, different woman, and the digest renders both as a bare line with no owner on it.
  //    The reflection pass then read one of Marcus's memories — "reading it as a sign SHE is
  //    building her own network", about Lucia — and formed him a permanent conviction that reads
  //    "RABI conducts HERSELF like a soldier ... SHE is the kind of initiative he would recruit
  //    for." Rabi is a man. Two people fused into one belief because a pronoun had nothing to hold
  //    onto. That is the "who did what" corruption, and it starts here.
  //
  //    So: first person is the canonical form. "I" cannot be anybody but the owner of the bank it
  //    is stored in, which is the property the old rule was reaching for and could not get from a
  //    pronoun. The digest already prints these under a heading that names the character, so the
  //    reader always knows whose "I" it is.
  //
  //    Only the NAME is rewritten, never a pronoun. A third-person memory says "Lucia agreed" and
  //    then "she told him", where the second word may be Lucia or may be someone else; converting
  //    the first without knowing about the second is how you turn one ambiguity into two. The
  //    bookkeeper contract now asks for first person directly, and every other person by name.
  if (!opts.isPlayer) {
    const first = (opts.name.split(/\s+/)[0] || opts.name).replace(/[^A-Za-z'’-]/g, "");
    if (first.length >= 2) {
      const full = opts.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // "I" or "me" depends on where the name stands. A name is a SUBJECT when it opens the memory,
      // follows a sentence end, or follows a conjunction that starts a fresh clause; anywhere else
      // — after a verb, after a preposition — it is an object, and "Rabi took Tessa aside" must not
      // become "Rabi took I aside".
      // A FRONTED PHRASE ENDS IN A COMMA, AND THE SUBJECT COMES AFTER IT. Without that case the
      // heuristic read "Eight a.m., Sarah is already at a corner table" as Sarah being an OBJECT,
      // because the only thing before her is a comma, and wrote "Eight a.m., me is already at a
      // corner table". Three of one character's four stored facts were ungrammatical that way. A
      // comma at the start of the string, or after an opening adverbial, is a subject position.
      const SUBJECT_BEFORE = /(?:^|[.!?;:]["”')\]]?\s+|^[^.!?]{0,40},\s+|\b(?:and|but|then|or|so|because|which|that|while|when|if|though|although|yet|however|before|after|until|once)\s+)$/i;
      const selfPronoun = (offset: number, s: string) => (SUBJECT_BEFORE.test(s.slice(0, offset)) ? "I" : "me");
      t = t
        .replace(new RegExp(`\\b${full}(?:'s|’s)\\b`, "g"), "my")
        .replace(new RegExp(`\\b${full}\\b`, "g"), (_m, off: number, s: string) => selfPronoun(off, s))
        .replace(new RegExp(`\\b${first}(?:'s|’s)\\b`, "g"), "my")
        .replace(new RegExp(`\\b${first}\\b`, "g"), (_m, off: number, s: string) => selfPronoun(off, s))
        // agreement for the verbs that follow a subject swap
        .replace(/\bI\s+(?:is|are)\b/g, "I am")
        .replace(/\bI\s+(?:has)\b/g, "I have")
        .replace(/\bI\s+(?:does)\b/g, "I do")
        .replace(/\bI\s+(?:was)\b/g, "I was").replace(/\bI\s+(?:were)\b/g, "I was")
        // ...and every other third-person verb the swap leaves stranded: "Sarah lets herself in"
        // became "I lets myself in". Strip the agreement -s from the verb that immediately follows
        // a converted subject, sparing the handful that are not third-person singular forms at all.
        .replace(/\bI\s+([a-z]+)s\b(?!\s*')/g, (m, v: string) =>
          /^(?:i|thi|hi|alway|perhap|sometime|toward|upstair|downstair|need|guess|pas|mis|dres|addres|posses)$/.test(v) ? m : `I ${v}`)
        .replace(/\bI\s+herself\b/g, "I myself").replace(/\bI\s+himself\b/g, "I myself").replace(/\bI\s+themselves\b/g, "I myself")
        // A REFLEXIVE IS SAFE WHERE A FREE PRONOUN IS NOT. Rule 4 refuses to touch "she" mid-
        // sentence because it may belong to somebody introduced earlier, and that caution is right.
        // A reflexive is different in kind: grammar requires it to corefer with the subject of its
        // own clause, so once that subject is "I" the reflexive is "myself" as a matter of syntax
        // rather than of guessing. Without this, "Miranda told herself she is not ready" repaired to
        // "I told herself", which is worse than what it started as. Guarded the same way the verb
        // agreement above is: no other named person may stand between the "I" and the reflexive.
        .replace(/\bI\b((?:(?!\b[A-Z][a-z])[^.!?])*?)\b(?:herself|himself|themselves)\b/g, (_m, mid: string) => `I${mid}myself`);
      // ...and for a coordinated clause whose subject was elided: "Tessa is terrified and has not
      // said a word" carries its subject across the "and", so the swap has to reach it too. Only
      // when the conjunction is followed IMMEDIATELY by the verb (an elided subject) and no other
      // named person stands between it and the "I" — "I told Rabi and he has not answered" and
      // "I went out and the bread is stale" both supply their own subject and are left alone.
      const AGREE: Record<string, string> = { is: "am", has: "have", does: "do", "isn't": "am not", "hasn't": "haven't", "doesn't": "don't" };
      t = t.replace(
        /\bI\b(?:(?!\b[A-Z][a-z])[^.!?])*?\b(?:and|but|then|or)\s+(is|has|does|isn't|hasn't|doesn't)\b/g,
        (m, v: string) => m.slice(0, m.length - v.length) + AGREE[v.toLowerCase()],
      );
      // a memory that is now nothing but "I" and a verb lost its content to the rewrite
      if (t.split(/\s+/).filter(Boolean).length < 5) return null;
    }
    // 5. AN OPENING PRONOUN HAS NO ANTECEDENT, so in this bank it can only be the owner.
    //
    //    Rule 4 rewrites the NAME and deliberately never a pronoun, because a pronoun in the middle
    //    of a sentence may belong to somebody introduced earlier in it — that reasoning is right and
    //    stands. It does not apply to the FIRST word. A memory that opens "She reached past him and
    //    folded the corner of his book page down" has nothing before the "She" to refer to, and it
    //    was sitting in that woman's own bank describing her own hands from outside. Only the
    //    opening subject is touched, and only when the memory does not name somebody else first.
    //    AND ONLY WHEN NOTHING DOWNSTREAM DEPENDS ON IT. Converting the opener to "I" re-points
    //    every later pronoun that was coreferring with it: "She told Rabi she wouldn't punch him —
    //    she'd just sit and wait" becomes "I told Rabi she wouldn't punch him", and the two later
    //    "she"s now read as a different woman. That is turning one ambiguity into two, which is the
    //    precise failure rule 4 refuses to commit and tests/memory-voice.ts pins. So the opener moves
    //    only when it is the ONLY pronoun of its family in the memory — nothing is left to strand.
    //    Otherwise the entry stays third-person and merely vague, which is the safe direction: a
    //    legacy memory left alone is unclear, and one rewritten on a guess is false.
    const FAMILY: Record<string, RegExp> = {
      she: /\b(?:she|her|hers|herself)\b/gi,
      he: /\b(?:he|him|his|himself)\b/gi,
      they: /\b(?:they|them|their|theirs|themselves)\b/gi,
    };
    const openerMatch = t.match(/^(She|He|They)\s+(?=[a-z])/);
    const fam = openerMatch ? FAMILY[openerMatch[1].toLowerCase()] : undefined;
    const lone = !!fam && (t.match(fam) ?? []).length === 1;
    const opener = lone ? openerMatch : null;
    if (opener) {
      t = t.slice(opener[0].length);
      t = "I " + t.replace(/^(is|are|was|were|has|have)\b/, (v) => ({ is: "am", are: "am", was: "was", were: "was", has: "have", have: "have" } as Record<string, string>)[v.toLowerCase()] ?? v);
      t = t.replace(/^I\s+(\w+)s\b(?!\s*')/, (m, verb: string) => (/^(wa|ha|i|thi|ga|le|clo|dre)/i.test(verb) ? m : `I ${verb}`));
      t = t.replace(/\bherself\b/g, "myself").replace(/\bhimself\b/g, "myself").replace(/\bthemselves\b/g, "myself");
    }
  }
  return t.slice(0, 400);
}

/**
 * EVERY DOOR, NOT JUST THE BOOKKEEPER'S.
 *
 * cleanMemoryContent guards one entrance — the `memories` the bookkeeper files. There are twelve
 * writers into the episodic store, across eight modules: promises kept and broken, drives that
 * stalled or completed, schedule misses, offstage events, montage vignettes, habit observations,
 * time skips, witnessed reactions. Eleven of them wrote straight past it, and what they wrote was
 * built by string interpolation out of fields authored in other voices — a drive goal is a
 * directive ("Tell Vin she understands he felt uncared for"), a promise line is a report about a
 * third party — so a first-person bank filled up with things like:
 *
 *   Miranda broke their promise to Miranda: Miranda told herself she is not ready to talk about it.
 *   Miranda agreed: Tell Vin she understands he felt uncared for and that she wants to fix it.
 *   Stopped asking about Lean into this morning of tenderness with Vin, let herself be fully…
 *   She reached past him and folded the corner of his book page down.
 *
 * Rather than thread the guard through twelve call sites — where the thirteenth would miss it — the
 * bank is swept. Each entry is marked once so this never reprocesses, which also means an existing
 * save is cleaned the first time it is loaded rather than carrying its corruption forever.
 */
export function sweepMemories(state: SaveState, playerAction?: string): number {
  let dropped = 0;
  for (const [id, mem] of Object.entries(state.memory ?? {}) as [string, CharMemory][]) {
    if (!mem?.episodic?.length) continue;
    const name = state.characters?.[id]?.name ?? "";
    if (!name) continue;
    const isPlayer = id === "char_player";
    const kept: typeof mem.episodic = [];
    for (const m of mem.episodic) {
      const e = m as typeof m & { swept?: boolean };
      if (e.swept) { kept.push(m); continue; }
      e.swept = true;
      const cleaned = cleanMemoryContent(m.content, { name, isPlayer, playerAction });
      if (!cleaned) { dropped++; continue; }
      m.content = cleaned;
      kept.push(m);
    }
    mem.episodic = kept;
  }
  return dropped;
}

/**
 * Bring an existing save's memories into the first-person form (see rule 4 above). Runs once per
 * bank on load: saves written before the change hold third-person accounts, and leaving them mixed
 * in with new first-person ones is the ambiguity the change exists to remove. Name-only, for the
 * same reason the write path is name-only — a pronoun cannot be safely reassigned after the fact.
 */
export function migrateToFirstPerson(mem: CharMemory, name: string, isPlayer: boolean): number {
  if (isPlayer || !name) return 0;
  let changed = 0;
  for (const m of mem.episodic ?? []) {
    for (const key of ["content", "full_content"] as const) {
      const before = m[key];
      if (typeof before !== "string" || !before) continue;
      const after = cleanMemoryContent(before, { name, isPlayer: false });
      if (after && after !== before) { m[key] = after; changed++; }
    }
  }
  return changed;
}

export function reflectionDue(mem: CharMemory, cadence: number, currentTurn: number, salt = 0): boolean {
  // salt (a stable per-character hash) staggers reflections across turns — previously every
  // character reflected on the SAME turn, producing a burst of LLM calls and a visible stall.
  if ((currentTurn + salt) % cadence !== 0) return false;
  const unreflected = mem.episodic.filter((m) => m.turn > (mem.beliefs.at(-1)?.formed_turn ?? 0));
  const sum = unreflected.reduce((s, m) => s + m.importance, 0);
  return sum >= 25 || unreflected.length >= 12;
}

/** After the LLM produces beliefs, fold them in and compact the episodic store. */
export function applyReflection(mem: CharMemory, beliefs: Belief[], currentTurn: number, keepRecent = 8): void {
  // Stamp every belief with the turn it was actually formed. Without this, beliefs carried no
  // formed_turn and defaulted to 0/-1, which made a late-invented conviction ("her father is in
  // trouble") look like origin backstory that predated events it actually came after — and the
  // narrator then treated it as long-established truth.
  // ── SUPERSEDE, DON'T ACCUMULATE ─────────────────────────────────────────────
  // Facts have deduped since they were written; beliefs never did — they were pushed blind and
  // trimmed to the last 14. Reflection runs every few turns and re-derives the SAME conviction
  // from the same standing situation, so one belief became three near-identical entries ("her
  // father's ship is coming in three days…" ×3, measured at 1.00 overlap), each rephrased, each
  // occupying a slot, all shown to the narrator at once. A person holds ONE conviction about a
  // thing and updates it; they don't hold three drafts of it. Merge in place, keeping the newer
  // wording and the higher confidence.
  for (const nb of beliefs) {
    // A conviction is a sentence. The pass sometimes returns the scaffolding around one — a
    // confidence, a turn, an empty evidence list — and nothing to believe; storing that put an
    // unreadable entry in the ledger which then broke every digest built from it.
    const content = compactGist(typeof nb?.content === "string" ? nb.content : "", 130);
    if (!content.trim()) continue;
    const prior = mem.beliefs.find((x) => relevance(x?.content ?? "", content) >= 0.5 || relevance(content, x?.content ?? "") >= 0.5);
    if (prior) {
      prior.content = content;                                   // the newer phrasing is the current belief
      prior.confidence = Math.max(prior.confidence ?? 0.7, nb.confidence ?? 0.7);
      prior.formed_turn = currentTurn;                           // reaffirmed now
      continue;
    }
    mem.beliefs.push({ ...nb, formed_turn: currentTurn, content });
  }
  if (mem.beliefs.length > 14) mem.beliefs = mem.beliefs.slice(-14);
  // keep the most recent + the few highest-importance episodics; drop the rest (now represented as beliefs)
  const recent = mem.episodic.filter((m) => currentTurn - m.turn <= keepRecent);
  const old = mem.episodic
    .filter((m) => currentTurn - m.turn > keepRecent)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 6);
  const pending = mem.episodic.filter((m) => m.commitment_status === "pending");
  // WHAT THEY SAW WHILE THE PLAYER WAS ELSEWHERE SURVIVES THIS. An offstage sighting is filed at
  // importance 7 and then has to win six slots against the player's own scenes, which run 8–10 —
  // so it is deleted at the first reflection after it stops being recent, roughly eight turns in,
  // long before the character is next in a room with the player. Measured on a 108-turn save: 45
  // offstage events, 45 witness memories written, and zero left alive in the file. The channel the
  // whole world sim depends on was being composted on a schedule. Kept like a pending commitment
  // is kept — exempt from the contest, and only while it is still news.
  const OFFSTAGE_KEEP_TURNS = 25;
  const witnessedWorld = mem.episodic.filter((m) => m.source === "offstage" && currentTurn - m.turn <= OFFSTAGE_KEEP_TURNS);
  const seen = new Set<EpisodicMemory>();
  mem.episodic = [...recent, ...old, ...pending, ...witnessedWorld].filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
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

/** Time is verbatim detail — it decays FIRST and FASTEST. Widen the stored exact stamp by decay
 *  stage: 0 exact → 1 part-of-day → 2 just the day → 3 the absolute is gone, only the STICKY
 *  landmark anchor ("before the outbreak") remains. The anchor never decays, so ordinal placement
 *  survives even when the clock dissolves — a faded memory keeps its before/after relation and can't
 *  drift into the wrong point in the timeline. Full recall (a vivid re-surfacing) restores the exact
 *  stamp, matching how a strong retrieval momentarily brings back specifics. */
function fuzzedWhen(m: EpisodicMemory, full: boolean): string {
  const anchor = m.anchor_rel?.trim();
  if (full) return [m.when_label, anchor].filter(Boolean).join(" — ");
  const stage = m.decay_stage ?? 0;
  if (stage <= 0) return [m.when_label, anchor].filter(Boolean).join(" — ");
  const t = m.when_label ? parseTime(m.when_label) : null;
  if (stage === 1 && t) {
    const part = t.hour < 5 ? "night" : t.hour < 12 ? "morning" : t.hour < 17 ? "afternoon" : t.hour < 21 ? "evening" : "night";
    return [`Day ${t.day}, ${part}`, anchor].filter(Boolean).join(" — ");
  }
  if (stage === 2 && t) return [`around Day ${t.day}`, anchor].filter(Boolean).join(" — ");
  // stage 3: the absolute time is gone. Only the sticky landmark anchor remains (or a vague "a while back").
  return anchor || "a while back";
}

/**
 * A BELIEF ABOUT SOMEBODY WHO IS NO LONGER STANDING.
 *
 * Beliefs are written in the present tense as live guidance — "Andrea is the only one who speaks
 * plainly to me, and her advice to slow down was right" — and nothing ever revisits them. That one
 * was formed on turn 175, about a woman the player had already killed, and went on being served to
 * the narrator as the player's current read of the world. The belief is not wrong to exist; people
 * do hold convictions about the dead. It is wrong to be in the present tense with no marker, which
 * is what makes a player look at their own recorded beliefs and not recognise the person holding
 * them. `gone` maps lowercase name → "dead" | "departed".
 */
export function beliefLine(content: string, gone: Map<string, string>): string {
  // A BELIEF WITH NOTHING IN IT. One save carried {confidence: 0.7, formed_turn: 15,
  // evidence_turns: []} and no content field at all — the reflection pass returned a belief object
  // with no sentence in it, `content` came through undefined, and JSON.stringify dropped the key on
  // the way to disk. From then on this line read `undefined.length` on EVERY turn, because the
  // digest is rebuilt every turn, and the save could not be played again. The write path refuses
  // these now (see applyReflection) and loading repairs old ones (see pruneEmptyMemories); this is
  // the third layer, because a bad entry from any source must not be able to end a playthrough.
  const raw = typeof content === "string" ? content : "";
  if (!raw.trim()) return "";
  const text = raw.length > 180 ? raw.slice(0, 178).trimEnd() + "…" : raw;
  const hits: string[] = [];
  for (const [name, how] of gone) {
    if (name.length < 3) continue;
    // match case-insensitively but report the name as the belief spells it, so the annotation
    // does not read like a different person to the one the sentence is about
    const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(text);
    if (m) hits.push(`${m[0]} is ${how}`);
  }
  return hits.length ? `${text} [${hits.slice(0, 2).join("; ")} — this is held ABOUT the past, not a live read of the present]` : text;
}

export function compactMemoryDigest(mem: CharMemory, query: string, currentTurn: number, k: number, nowLabel = "", recallerRelaxation = 0, gone: Map<string, string> = new Map()): string {
  const parts: string[] = [];
  if (mem.core.length) parts.push(`CORE: ${mem.core.join(" | ")}`);
  // the fact ledger: verified declarative knowledge, never decayed — most query-relevant few + newest
  if (mem.facts?.length) {
    // Superseded facts are never offered as current knowledge — that is what let a character hold
    // "my father sent his champion" and "my father sent no one" at the same time and reach for
    // whichever the sentence wanted. They are still shown, but marked as what she USED to believe,
    // because knowing you were wrong is itself something a person carries.
    const live = mem.facts.filter((f) => !f.superseded_by);
    const ranked = [...live].map((f) => ({ f, r: relevance(f.content, query) })).sort((a, b) => b.r - a.r);
    const chosen = new Set(ranked.slice(0, 4).map((x) => x.f));
    if (live.length) chosen.add(live[live.length - 1]);
    const clipF = (t: string) => (t.length > 140 ? t.slice(0, 138).trimEnd() + "…" : t);
    if (chosen.size) parts.push(`KNOWS (verified facts): ${[...chosen].map((x) => clipF(x.content)).join(" | ")}`);
    const corrected = mem.facts
      .filter((f) => f.superseded_by && relevance(f.content, query) >= 0.25)
      .slice(-2);
    if (corrected.length) {
      parts.push(`ONCE BELIEVED, NOW KNOWS BETTER (never state the old version as true): ${corrected.map((f) => `"${clipF(f.content)}" → ${clipF(f.superseded_by!)}`).join(" | ")}`);
    }
  }
  const beliefLines = (mem.beliefs ?? []).slice(-6).map((b) => beliefLine(b?.content, gone)).filter((l) => l.trim());
  if (beliefLines.length) parts.push(`BELIEFS: ${beliefLines.join(" | ")}`);
  const top = retrieveScored(mem, query, currentTurn, k, recallerRelaxation, nowLabel);
  // ── RECENCY FLOOR ──────────────────────────────────────────────────────────
  // Retrieval is relevance-ranked, and word-overlap relevance is nearly flat across a long
  // memory (in practice every candidate scores ~0.10), so with k=2 the two surfaced memories are
  // effectively arbitrary. When they happen to miss the last few turns, the character has no
  // record of what just happened to them and re-opens a scene they already played — asking again
  // for a message that was already delivered. Recency is not one signal among many for events
  // this fresh: a person always knows what they did an hour ago. Force the most recent memories
  // in regardless of how they score.
  const RECENT_FLOOR = 3;
  const already = new Set(top.map((x) => x.m));
  const recent = [...mem.episodic]
    .filter((m) => !already.has(m) && currentTurn - m.turn <= 12)
    .sort((a, b) => b.turn - a.turn)
    .slice(0, RECENT_FLOOR)
    .map((m) => ({ m, rel: 0.35 }));
  top.push(...recent);
  top.sort((a, b) => b.m.turn - a.m.turn);   // most recent last-seen first: the scene's own history reads in order
  if (top.length) {
    // FULL RECALL: decay governs the default (gist), but the scene can reach into a memory and
    // bring it back whole. Restore full fidelity for at most 2 memories per character — the ones
    // the current moment is strongly cued to (high relevance), or that are genuinely defining
    // (high importance). A cue brings the whole thing back; everything else stays a gist.
    const RECALL_CAP = 2;
    const fullSet = new Set(
      top
        .filter((x) => x.rel >= 0.4 || x.m.importance >= 8)   // strongly cued, or a defining memory
        .sort((a, b) => (b.rel + b.m.importance / 10) - (a.rel + a.m.importance / 10))
        .slice(0, RECALL_CAP)
        .map((x) => x.m)
    );
    const tint = recallTint(recallerRelaxation);
    parts.push(`RECALLS${tint ? ` (${tint})` : ""}: ${top.map(({ m, rel }) => {
    const full = fullSet.has(m);
    const stage = m.decay_stage ?? 0;
    // place: present at stages 0–1, or whenever recalled full; at stage 2+ gist it's lost but reconstructable
    let place = (m.where || full) ? (m.where ? `at ${m.where}` : "") : "";
    if (!place && !full && stage >= 2) {
      const neighbor = mem.episodic.find((o) => o !== m && o.where && Math.abs(o.turn - m.turn) <= 3);
      if (neighbor?.where) place = `somewhere around ${neighbor.where}`; // contextual reconstruction
    }
    // time decays first and fastest — exact stamp fuzzes to a range by stage, sticky anchor persists
    const when = fuzzedWhen(m, full);
    const stamp = [when, place].filter(Boolean).join(", ");
    const due = m.commitment_status === "pending" ? `, STILL DUE ${m.scheduled_time}` : "";
    const raw = full ? (m.full_content ?? m.content) : m.content;
    const budget = full ? 300 : 170; // render cap: a memory is a cue for the narrator, not a transcript — verbose bookkeeper output must not flood the digest
    const text = raw.length > budget ? raw.slice(0, budget - 2).trimEnd() + "…" : raw;
    const faded = full ? (rel >= 0.4 ? " (this moment brings it back sharp and whole)" : "") : stage >= 3 ? " (a dim, distant impression)" : stage === 2 ? " (hazy now)" : "";
    return `[${stamp || `T${m.turn}`}${due}] ${text}${faded}`;
  }).join(" | ")}`);
  }
  return parts.join("\n");
}


/**
 * ENTRIES WITH NOTHING IN THEM, TAKEN BACK OUT.
 *
 * Run once when a save is loaded. A single contentless belief made a sixteen-turn save unplayable —
 * every turn rebuilds the memory digest, the digest read `.length` on the missing sentence, and the
 * throw arrived after every response with no way for the player to clear it from inside the game.
 * Nothing else in the engine ever revisits a stored memory's SHAPE, so this is where that happens.
 *
 * Returns how many entries it removed, so the load path can say so rather than repairing silently.
 */
export function pruneEmptyMemories(state: { memory?: Record<string, CharMemory> }): number {
  let removed = 0;
  const hasText = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;
  for (const mem of Object.values(state.memory ?? {})) {
    if (!mem) continue;
    for (const key of ["episodic", "beliefs", "facts"] as const) {
      const arr = (mem as any)[key];
      if (!Array.isArray(arr)) { (mem as any)[key] = []; continue; }
      const kept = arr.filter((e: any) => hasText(key === "facts" ? (e?.fact ?? e?.content) : e?.content));
      removed += arr.length - kept.length;
      (mem as any)[key] = kept;
    }
    if (!Array.isArray(mem.core)) mem.core = [];
    else {
      const keptCore = mem.core.filter(hasText);
      removed += mem.core.length - keptCore.length;
      mem.core = keptCore;
    }
  }
  return removed;
}
