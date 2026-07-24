
/**
 * Social fabric â€” the world-reacting layer. All deterministic, zero tokens.
 *
 * Rumor diffusion: independent-cascade on the co-presence graph
 * (Kempeâ€“Kleinbergâ€“Tardos 2003). Each turn, every knower k may transmit to
 * each co-present non-knower j with
 *   p(kâ†’j) = base Â· (salience/10) Â· ((greg_k + greg_j)/2)
 * Expected coverage and hop counts verified by Monte Carlo in verify.ts.
 * Inspired by Park et al. information-diffusion findings and Social
 * Simulacra (Park et al. 2022): community texture emerges from cheap local
 * rules, not from asking an LLM to imagine it.
 *
 * Psyche: relaxation r drifts toward capacity at rate Ï, perturbed by
 * Simulator deltas; psyche state derived from thresholds and dwell time.
 */
import type { SaveState, Rumor, SocialEdge, Psyche, AcquiredTrait, Identity, EpisodicMemory, CharMemory } from "./types";
import { asText } from "./coerce";
import { relevance } from "./memory";
import { uid } from "./state";

export const RUMOR_BASE_P = 0.45;

export function getEdge(edges: SocialEdge[], from: string, to: string): SocialEdge {
  let e = edges.find((x) => x.from === from && x.to === to);
  if (!e) {
    e = { from, to, warmth: 0, trust: 0, power: 0, notes: "", updated_turn: 0 };
    edges.push(e);
  }
  return e;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function applyEdgeDelta(edges: SocialEdge[], d: { from: string; to: string; warmth_delta: number; trust_delta: number; power_delta: number; note?: string; roles_set?: string[] }, turn: number) {
  const e = getEdge(edges, d.from, d.to);
  e.warmth = clamp(e.warmth + clamp(d.warmth_delta, -15, 15), -100, 100);
  // trust breaks faster than it builds: positive deltas apply at 60% strength, negatives at full.
  // Dampen the DELTA before applying it once (the old version added full then subtracted from the
  // absolute value, which gave wrong results at the clamp ceiling).
  const trustDelta = d.trust_delta > 0 ? d.trust_delta * 0.6 : d.trust_delta;
  e.trust = clamp(e.trust + clamp(trustDelta, -20, 20), -100, 100);
  e.power = clamp(e.power + clamp(d.power_delta, -10, 10), -100, 100);
  if (d.note) e.notes = d.note.slice(0, 140);
  if (d.roles_set) {
    let roles = d.roles_set.map((r) => (typeof r === "string" ? r : String(r ?? "")).trim()).filter(Boolean).slice(0, 4);
    // RECIPROCAL-ROLE SANITY. The bookkeeper sometimes dumps BOTH sides of a directional
    // relationship onto one edge ("Marie -> Joe: [father, daughter]"), which is incoherent â€” Marie's
    // role toward Joe is daughter; father is Joe's role toward Marie. When a known reciprocal PAIR
    // appears together on one edge, keep only the side that fits THIS direction and stamp the inverse
    // on the reverse edge, so the narrator gets a correct, directional anchor (this is what prevents
    // garbled "you daughter her"-type lines: the relationship is unambiguous in state).
    const RECIP: Record<string, string> = {
      father: "child", mother: "child", dad: "child", mom: "child", parent: "child",
      son: "parent", daughter: "parent", child: "parent",
      husband: "wife", wife: "husband", boss: "employee", employee: "boss",
      teacher: "student", student: "teacher", master: "apprentice", apprentice: "master",
      mentor: "mentee", mentee: "mentor", owner: "pet", captain: "crew",
    };
    const inverseHits = roles.filter((r) => RECIP[r.toLowerCase()]);
    if (inverseHits.length >= 2) {
      // Two reciprocal terms collided. Decide which belongs to from->to using the CHILD/PARENT axis:
      // a younger/subordinate term (daughter, son, child, student, apprentice, employee, mentee, crew)
      // is what `from` is TO `to`; the senior term goes on the reverse edge.
      const JUNIOR = new Set(["son","daughter","child","student","apprentice","employee","mentee","crew","pet"]);
      const junior = roles.find((r) => JUNIOR.has(r.toLowerCase()));
      const senior = roles.find((r) => !JUNIOR.has(r.toLowerCase()) && RECIP[r.toLowerCase()]);
      if (junior && senior) {
        roles = roles.filter((r) => r.toLowerCase() !== senior.toLowerCase()); // from keeps junior (+ any non-recip roles)
        const rev = getEdge(edges, d.to, d.from);
        const revRole = senior;
        rev.roles = rev.roles ?? [];
        if (!rev.roles.some((r) => r.toLowerCase() === revRole.toLowerCase())) {
          rev.roles = [...rev.roles.filter((r) => r.toLowerCase() !== (RECIP[revRole.toLowerCase()] ?? "")), revRole].slice(0, 4);
          rev.updated_turn = turn;
        }
      }
    }
    e.roles = roles;
  }
  e.updated_turn = turn;
}

/** One diffusion step over the co-presence groups. Deterministic given rng. */
export function diffuseRumors(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  const groups: string[][] = [];
  // group 1: everyone in the player's scene. Then: offscreen NPCs bucketed by their actual LOCATION â€”
  // only characters in the SAME place exchange rumors. The old code dumped every offscreen character
  // into one "village-scale" group regardless of where they were, so a rumor hopped instantly from a
  // character fifty miles away to one in the next room, and an NPC who stepped offscreen for a day
  // returned "knowing" everything everywhere. Bucketing by location makes news travel at the speed of
  // people actually moving between places.
  groups.push([...state.world.present]);
  const byLocation = new Map<string, string[]>();
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || state.world.present.includes(id) || c.status === "dead" || c.status === "departed") continue;
    const loc = c.location || "loc_elsewhere";
    const list = byLocation.get(loc) ?? [];
    list.push(id);
    byLocation.set(loc, list);
  }
  for (const group of byLocation.values()) {
    if (group.length > 1) groups.push(group); // only same-place offscreen characters mingle
  }
  for (const rumor of state.world.rumors) {
    if (rumor.dead) continue;
    const age = state.world.current_turn - rumor.born_turn;
    if (age > 30 || rumor.knowers.length >= Object.keys(state.characters).length) { rumor.dead = true; continue; }
    for (const group of groups) {
      const knowers = group.filter((id) => rumor.knowers.includes(id));
      const naive = group.filter((id) => !rumor.knowers.includes(id) && id !== "char_player");
      for (const k of knowers) {
        const gk = state.characters[k]?.gregariousness ?? 0.5;
        for (const j of naive) {
          if (rumor.knowers.includes(j)) continue;
          const gj = state.characters[j]?.gregariousness ?? 0.5;
          const p = RUMOR_BASE_P * (rumor.salience / 10) * ((gk + gj) / 2);
          if (rng() < p) {
            rumor.knowers.push(j);
            log.push(`${state.characters[j]?.name ?? j} hears: "${rumor.content}" (from ${state.characters[k]?.name ?? k})`);
          }
        }
      }
    }
  }
  return log;
}

/** Per-turn drift of relaxation toward capacity; derive psyche state. */
export function tickPsyche(p: Psyche): void {
  // Drift toward capacity. Overshoot ABOVE capacity decays FASTER than recovery from below â€”
  // a person's nature sets a ceiling on how open they get, and they don't float far above it just
  // because scenes are pleasant. This is the fix for a low-capacity (tense, guarded, predatory)
  // character being pushed up to serene openness by repeated positive relaxation_deltas and staying
  // there: above capacity the pull-back is strong, so their natural tension reasserts.
  const gap = p.capacity - p.relaxation;
  const rate = p.relaxation > p.capacity ? Math.max(p.recovery, 0.5) : p.recovery; // above-capacity overshoot collapses fast
  p.relaxation = clamp(p.relaxation + gap * rate, -10, 10);
  if (p.relaxation <= -7) p.consecutive_clenched++;
  else p.consecutive_clenched = 0;
  // open_run tracks how long they've sat AT/ABOVE their own resting openness â€” a character whose
  // capacity is low (guarded by nature) shouldn't accrue a long "open run" just for being at rest.
  // Reset when relaxation falls meaningfully below their capacity OR below the neutral line.
  const openFloor = Math.min(3, Math.max(0, p.capacity - 1));
  p.open_run = p.relaxation >= openFloor ? (p.open_run ?? 0) + 1 : 0;
  if (p.state === "intact" && p.consecutive_clenched >= 4) p.state = "fracturing";
  if (p.state === "fracturing" && p.relaxation > -4) { p.state = "intact"; p.break_mode = null; }
  if (p.state === "fracturing" && p.relaxation <= -9) { p.state = "broken"; p.break_mode = p.break_mode ?? "fractured"; }
  if ((p.state === "broken" || p.state === "shattered") && p.relaxation > -2) { p.state = "intact"; p.break_mode = null; }
  p.mood_valence = clamp(Math.round(p.relaxation * 0.8), -10, 10);
}

/** Trait reinforcement-or-decay. Unreinforced acquired traits fade; identity-integrated ones persist. */
/** Consolidation â€” earned, slow identity change. An acquired trait reinforced into deep
 *  integration (high self_weight AND repeatedly reinforced) stops being a "learned" overlay
 *  and becomes WHO THEY ARE: folded into core_traits, and â€” if it bears on how they come
 *  across â€” into the stored speech_pattern, then retired from the acquired list. Never runs
 *  per-turn (only on reflection / time skips), so a single scene can't move the core. */
export function capMemory(episodic: EpisodicMemory[], cap = 60): EpisodicMemory[] {
  if (episodic.length <= cap) return episodic;
  const sacred = episodic.filter((m) => m.importance >= 8 || m.commitment_status === "pending");
  const rest = episodic.filter((m) => !(m.importance >= 8 || m.commitment_status === "pending"));
  const room = Math.max(0, cap - sacred.length);
  // Evict by a keep-score, not pure age: importance matters as much as recency, so a burst of
  // trivial recent memories can't nuke a still-significant older one. Highest scores survive.
  const maxTurn = Math.max(1, ...episodic.map((m) => m.turn));
  const keepScore = (m: EpisodicMemory) => (m.importance / 10) * 0.6 + (m.turn / maxTurn) * 0.4;
  const keptRest = rest.slice().sort((a, b) => keepScore(b) - keepScore(a)).slice(0, room);
  const keep = new Set<EpisodicMemory>([...sacred, ...keptRest]);
  return episodic.filter((m) => keep.has(m));
}

export function consolidateBackground(ident: Identity, mem: CharMemory): string[] {
  const log: string[] = [];
  // What counts as "defining" enough to accrete into the character's story-so-far. The old bar was
  // importance >= 8, which â€” with a bookkeeper that under-scores â€” silently dropped genuinely
  // life-shaping beats (being abandoned, a betrayal, a rescue) that it happened to score a 6 or 7, so
  // life_history froze early and stopped reflecting what the character actually lived. Broaden it: a
  // core memory always counts; so does an importance>=6 beat carrying real emotional charge, or any
  // importance>=7. This keeps trivia out while catching the beats that actually reshape a person.
  const charged = (m: EpisodicMemory) => !!(m.emotional_charge && m.emotional_charge.trim() && !/none|neutral|calm/i.test(m.emotional_charge));
  const defining = mem.episodic.filter((m) => !m.folded && (m.importance >= 7 || (m.importance >= 6 && charged(m))));
  if (!defining.length) return log;
  const facts = defining
    .slice()
    .sort((a, b) => a.turn - b.turn)
    .map((m) => m.content.trim())
    .filter((c) => c && !asText(ident.life_history, " ").includes(c) && !asText(ident.background, " ").includes(c));
  if (facts.length) {
    // fold into the ACCRETED layer, never the bedrock forge background
    ident.life_history = `${ident.life_history ?? ""} ${facts.join(" ")}`.trim();
    // deterministic light trim: keep the most recent ~1100 chars on a sentence boundary
    const SOFT = 1100;
    if (ident.life_history.length > SOFT) {
      const tail = ident.life_history.slice(-SOFT);
      const firstStop = tail.search(/[.!?]\s/);
      ident.life_history = (firstStop >= 0 ? tail.slice(firstStop + 2) : tail).trim();
    }
    log.push(`${ident.name}'s history now carries ${facts.length} defining moment${facts.length > 1 ? "s" : ""}.`);
  }
  for (const m of defining) m.folded = true;
  return log;
}

/** When life_history has grown past where deterministic trimming reads cleanly, an LLM should
 *  re-summarize it into tighter prose (preserve the shape, lose verbatim detail). The actual
 *  rewrite is async, done by the turn loop â€” rare and cheap. Bedrock background is never touched. */
export function needsHistoryCompaction(ident: Identity): boolean {
  return (ident.life_history?.length ?? 0) > 1400;
}

export function consolidateTraits(ident: Identity, traits: AcquiredTrait[], _turn: number): { kept: AcquiredTrait[]; log: string[] } {
  const log: string[] = [];
  const SPEECHY = /(mean|cruel|harsh|cold|gentle|warm|tender|curt|terse|sharp|bitter|guarded|open|cheerful|grim|sardonic|formal|crude|profane|soft-spoken|aggressive|meek|commanding|timid|sarcastic|kind)/i;
  const kept = traits.filter((t) => {
    const integrated = t.self_weight >= 6 && t.reinforcement_count >= 8 && t.intensity >= 5;
    if (!integrated) return true;
    const already = ident.core_traits.some((c) => c.toLowerCase().includes(t.label.toLowerCase()) || t.label.toLowerCase().includes(c.toLowerCase()));
    if (!already) {
      ident.core_traits = [...ident.core_traits, t.label].slice(-8);
      log.push(`${ident.name}'s trait "${t.label}" has become part of their core personality.`);
    }
    if (SPEECHY.test(t.label) || SPEECHY.test(t.behavioral_impact)) {
      const add = t.label.toLowerCase();
      if (!ident.speech_pattern.toLowerCase().includes(add)) {
        ident.speech_pattern = `${ident.speech_pattern}; has become ${add}`.replace(/^;\s*/, "");
      }
    }
    return false; // retire from acquired â€” it's core now
  });
  return { kept, log };
}

export function decayTraits(traits: AcquiredTrait[], currentTurn: number): { kept: AcquiredTrait[]; log: string[] } {
  const log: string[] = [];
  const kept = traits.filter((t) => {
    const idle = currentTurn - t.last_reinforced_turn;
    if (idle <= 6) return true;
    const decay = 0.15 * Math.sqrt(idle - 6) * (1 - Math.min(0.9, t.self_weight / 10));
    t.intensity = Math.max(0, t.intensity - decay);
    if (t.intensity < 0.8 && t.self_weight < 3) {
      log.push(`trait dissolved: "${t.label}" (disuse)`);
      return false;
    }
    return true;
  });
  return { kept, log };
}

export function reinforceOrMergeTrait(traits: AcquiredTrait[], incoming: { label: string; origin: string; behavioral_impact: string; intensity: number }, turn: number): void {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const existing = traits.find((t) => {
    const a = new Set(norm(t.label).split(" ")), b = norm(incoming.label).split(" ");
    return b.filter((w) => a.has(w)).length / Math.max(1, b.length) > 0.5;
  });
  if (existing) {
    existing.intensity = clamp(existing.intensity + 0.7, 1, 10);
    existing.self_weight = clamp(existing.self_weight + 0.5, 0, 10);
    existing.reinforcement_count++;
    existing.last_reinforced_turn = turn;
  } else {
    traits.push({
      id: `trait_${Math.random().toString(36).slice(2, 8)}`,
      label: incoming.label,
      origin: incoming.origin,
      behavioral_impact: incoming.behavioral_impact,
      intensity: clamp(incoming.intensity, 1, 6), // new traits start modest
      self_weight: 1,
      last_reinforced_turn: turn,
      reinforcement_count: 1,
    });
    if (traits.length > 8) {
      traits.sort((a, b) => b.self_weight * b.intensity - a.self_weight * a.intensity);
      traits.length = 8;
    }
  }
}

/** Offscreen NPC drives advance stochastically; produces world-motion lines without an LLM. */
export function tickDrives(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || state.world.present.includes(id) || !c.drive) continue;
    if (c.drive.progress >= 100) {
      // completion is an EVENT, not a frozen meter: it becomes a memory and the slot clears
      log.push(`${c.name} got what they wanted: ${c.drive.goal}. It shows.`);
      state.memory[id]?.episodic.push({
        turn: state.world.current_turn,
        content: `Achieved: ${c.drive.goal}.`,
        importance: 7, emotional_charge: "satisfaction",
        last_accessed_turn: state.world.current_turn,
      });
      if (c.current_goal === c.drive.goal) c.current_goal = undefined;
      c.drive = undefined; // the Simulator assigns the next want via drives_update
      continue;
    }
    // movement now comes from the Undertow's QRE stances; this tick is the safety
    // net for worlds whose undertow hasn't run this turn (e.g. plain time skips)
    if (c.drive.updated_turn < state.world.current_turn) {
      const step = c.drive.blocker ? 2 : 6 + Math.floor(rng() * 8);
      c.drive.progress = Math.min(100, c.drive.progress + step);
      c.drive.updated_turn = state.world.current_turn;
    }
    if (c.drive.progress >= 100) log.push(`${c.name} completes their aim offscreen: ${c.drive.goal}`);
    else if (rng() < 0.18) log.push(`${c.name} works toward "${c.drive.goal}" (${c.drive.progress}%)${c.drive.blocker ? ` â€” blocked by ${c.drive.blocker}` : ""}`);
  }
  return log;
}

/** Player-facing edges for telemetry snapshots. */
export function playerEdgeSnapshot(state: SaveState): { pair: string; warmth: number; trust: number }[] {
  return state.world.edges
    .filter((e) => e.to === "char_player" && state.characters[e.from])
    .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust }));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PROMISE LEDGER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Who swore what to whom, and what it costs to keep or break it. The emotional swing scales with
// TWO things, like real life: how BIG the promise was (weight 1â€“3), and the PATTERN of this person's
// track record with the one they promised (a first slip from someone reliable is forgivable; the
// fifth broken vow is who they are now). Kept promises build trust faster than warmth (you can rely
// on them); broken ones cost trust hardest, and warmth too when the promise was large.

import type { Promise as PromiseRec } from "./types";

/** How many promises `from` has already KEPT vs BROKEN toward `to` â€” the track record that bends
 *  how the next outcome lands. */
function promiseHistory(state: SaveState, from: string, to: string): { kept: number; broken: number } {
  let kept = 0, broken = 0;
  for (const p of state.world.promises ?? []) {
    if (p.from !== from || p.to !== to) continue;
    if (p.status === "kept") kept++;
    else if (p.status === "broken") broken++;
  }
  return { kept, broken };
}

/** Record a new promise on the ledger. Weight defaults to a real commitment (2) unless the text
 *  reads small (a quick favor) or huge (a vow / life-stakes). */
export function addPromise(state: SaveState, from: string, to: string, text: string, weight?: 1 | 2 | 3, due_time?: string): PromiseRec | null {
  if (!state.characters[from] || !state.characters[to] || !text.trim()) return null;
  state.world.promises ??= [];
  // don't double-log a near-identical open promise between the same pair
  const dup = state.world.promises.find((p) => p.from === from && p.to === to && p.status === "open" && relevance(p.text, text) >= 0.6);
  if (dup) return dup;
  const w: 1 | 2 | 3 = weight ?? (/(\bvow\b|\bswear\b|\bwith my life\b|protect|never leave|marry|die for|always be)/i.test(text) ? 3
    : /(\bhelp\b|\bbring\b|\bget\b|\bfetch\b|\bwalk\b|\bmeet\b|\bstop by\b|\blook after\b for a)/i.test(text) ? 1 : 2);
  const rec: PromiseRec = { id: uid("promise"), from, to, text: text.trim().slice(0, 160), made_turn: state.world.current_turn, due_time, weight: w, status: "open" };
  state.world.promises.push(rec);
  if (state.world.promises.length > 40) state.world.promises = state.world.promises.filter((p) => p.status === "open").concat(state.world.promises.filter((p) => p.status !== "open").slice(-20));
  return rec;
}

/** Resolve a promise kept or broken, applying the weight- and pattern-scaled relationship change and
 *  a memory for the one it was made to. Returns a human line for the shift log. */
export function resolvePromise(state: SaveState, p: PromiseRec, outcome: "kept" | "broken", turn: number): string {
  if (p.status !== "open") return "";
  p.status = outcome;
  const from = p.from, to = p.to;
  const fromName = state.characters[from]?.name ?? "someone";
  const toName = to === "char_player" ? "you" : state.characters[to]?.name ?? "someone";
  const hist = promiseHistory(state, from, to);
  const edge = getEdge(state.world.edges, to, from); // how `to` feels about `from`

  if (outcome === "kept") {
    // reliability compounds: keeping builds trust more than warmth, and a good track record makes
    // each kept promise land a little softer (already expected) â€” but a big vow kept always matters.
    const base = p.weight === 3 ? 10 : p.weight === 2 ? 6 : 3;
    const familiarity = Math.max(0.6, 1 - hist.kept * 0.08); // slight diminishing returns
    const trustGain = Math.round(base * familiarity);
    const warmthGain = Math.round(trustGain * 0.6);
    applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: warmthGain, trust_delta: trustGain, power_delta: 0, note: `kept a promise: ${p.text}` }, turn);
    if (state.memory[to]) state.memory[to].episodic.push({
      turn, content: `${fromName} kept their promise to ${toName === "you" ? "me" : toName}: ${p.text}`,
      importance: Math.min(8, 3 + p.weight * 2), emotional_charge: "trust, relief", last_accessed_turn: turn,
      source: state.world.present.includes(to) ? "witnessed" : "inferred",
    });
    return to === "char_player" ? `${fromName} kept their word: ${p.text}.` : `${fromName} kept a promise to ${toName}.`;
  } else {
    // breaking costs trust hardest, warmth too when the promise was large. A PATTERN of breaking
    // (this isn't the first) deepens the wound sharply â€” that's when "unreliable" becomes identity.
    const base = p.weight === 3 ? 14 : p.weight === 2 ? 9 : 5;
    const patternMult = 1 + Math.min(1.0, hist.broken * 0.4); // 1st break Ã—1, 2nd Ã—1.4, 3rd Ã—1.8, capped Ã—2
    // being genuinely trusted softens a FIRST, small break â€” benefit of the doubt, once
    const soften = (hist.broken === 0 && p.weight === 1 && (edge?.trust ?? 0) >= 40) ? 0.5 : 1;
    const trustLoss = -Math.round(base * patternMult * soften);
    const warmthLoss = -Math.round(base * patternMult * soften * (p.weight === 3 ? 0.8 : 0.45));
    applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: warmthLoss, trust_delta: trustLoss, power_delta: 0, note: `broke a promise: ${p.text}` }, turn);
    if (state.memory[to]) state.memory[to].episodic.push({
      turn, content: `${fromName} broke their promise to ${toName === "you" ? "me" : toName}: ${p.text}${hist.broken > 0 ? " â€” again" : ""}`,
      importance: Math.min(9, 4 + p.weight * 2 + hist.broken), emotional_charge: hist.broken > 0 ? "hurt, hardening, done giving chances" : "hurt, let down", last_accessed_turn: turn,
      source: state.world.present.includes(to) ? "witnessed" : "inferred",
    });
    return to === "char_player" ? `${fromName} broke their word: ${p.text}.` : `${fromName} broke a promise to ${toName}${hist.broken > 0 ? " â€” not the first time" : ""}.`;
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ OFF-SCREEN BOND DRIFT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The world shouldn't freeze between scenes. Characters who share a place while the player is away
// slowly warm to or cool from each other based on compatibility â€” how alike their consciences are
// (do they both care, or both not?) and how much their values overlap. This is a gentle Â±1/round
// nudge, so bonds evolve over days offscreen without lurching. Only same-locale, non-present,
// living pairs; the player is never included (their edges are earned in play, not drifted).
function compatibility(a: Identity, b: Identity): number {
  // conscience closeness: two warm people or two cold people are more compatible than a mismatch
  const ca = typeof a.conscience === "number" ? a.conscience : 0.7;
  const cb = typeof b.conscience === "number" ? b.conscience : 0.7;
  const conscienceScore = 1 - Math.abs(ca - cb); // 0..1, 1 = identical temperament
  // value overlap
  const av = (a.values ?? []).map((v) => v.toLowerCase());
  const bv = (b.values ?? []).map((v) => v.toLowerCase());
  const shared = av.filter((v) => bv.some((w) => w === v || w.includes(v) || v.includes(w))).length;
  const valueScore = av.length && bv.length ? shared / Math.max(av.length, bv.length) : 0.3;
  // combine â†’ a target sign: compatible pairs drift warm, incompatible drift cool
  return (conscienceScore * 0.5 + valueScore * 0.5); // 0..1
}

/** Drift warmth Â±1 between same-place offscreen pairs toward their compatibility. Returns occasional
 *  human lines for pairs that cross a threshold, so the player can hear a bond shifted while away. */
export function tickBonds(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  // bucket living, offscreen characters by location
  const byLoc = new Map<string, string[]>();
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || state.world.present.includes(id) || c.status === "dead" || c.status === "departed") continue;
    const loc = c.location || "loc_elsewhere";
    (byLoc.get(loc) ?? byLoc.set(loc, []).get(loc)!).push(id);
  }
  for (const group of byLoc.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (rng() > 0.5) continue; // not every pair every round â€” bonds move slowly
        const comp = compatibility(state.characters[a], state.characters[b]);
        const dir = comp >= 0.5 ? 1 : -1; // compatible warm up, incompatible cool
        const e1 = getEdge(state.world.edges, a, b), e2 = getEdge(state.world.edges, b, a);
        const before = e1.warmth;
        // drift toward the compatibility-implied ceiling/floor, never past it
        const ceil = dir > 0 ? 20 + Math.round(comp * 40) : -(10 + Math.round((1 - comp) * 30));
        if ((dir > 0 && e1.warmth < ceil) || (dir < 0 && e1.warmth > ceil)) {
          e1.warmth = clampWarmth(e1.warmth + dir);
          e2.warmth = clampWarmth(e2.warmth + dir);
        }
        // occasional shift line when a bond crosses a round number (a felt change)
        const crossed = (t: number) => (before < t && e1.warmth >= t) || (before > t && e1.warmth <= t);
        if (dir > 0 && crossed(20)) log.push(`${state.characters[a].name} and ${state.characters[b].name} have been growing closer.`);
        else if (dir < 0 && crossed(-10)) log.push(`Something has cooled between ${state.characters[a].name} and ${state.characters[b].name}.`);
      }
    }
  }
  return log;
}
function clampWarmth(w: number): number { return Math.max(-100, Math.min(100, w)); }

