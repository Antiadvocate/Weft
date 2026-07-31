/**
 * Social fabric — the world-reacting layer. All deterministic, zero tokens.
 *
 * Rumor diffusion: independent-cascade on the co-presence graph
 * (Kempe–Kleinberg–Tardos 2003). Each turn, every knower k may transmit to
 * each co-present non-knower j with
 *   p(k→j) = base · (salience/10) · ((greg_k + greg_j)/2)
 * Expected coverage and hop counts verified by Monte Carlo in verify.ts.
 * Inspired by Park et al. information-diffusion findings and Social
 * Simulacra (Park et al. 2022): community texture emerges from cheap local
 * rules, not from asking an LLM to imagine it.
 *
 * Psyche: relaxation r drifts toward capacity at rate ρ, perturbed by
 * Simulator deltas; psyche state derived from thresholds and dwell time.
 */
import type { SaveState, Rumor, SocialEdge, Psyche, AcquiredTrait, Identity, EpisodicMemory, CharMemory } from "./types";
import { asText } from "./coerce";
import { relevance } from "./memory";
import { uid } from "./state";
import { obduracyIn } from "./obduracy";

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

// ── RATCHET BRAKE ── Step sizes are symmetric but OPPORTUNITY is not: almost every turn contains
// something kind, brave, or grateful, and almost none contain betrayal. So up-moves fire constantly
// and down-moves rarely, and any symmetric rule drifts upward until it pins at the ceiling and never
// comes back. High feeling then reads charitably, suppressing the down-moves further — it feeds
// itself. Fix the SHAPE, not the step: gains shrink as the value climbs, losses always land full.
// Below 50 nothing changes (early closeness should still move fast); past 50 each further point
// costs more, so 90 is reachable only by sustained, repeated evidence and never by one warm scene.
// OBDURACY bends this curve per person. The old shape was flat 1 below 50, which meant the
// entire lower half of the range had no brake at all: a stranger at 0 reached 45 in three
// deltas without the ratchet engaging once, and 45 already reads as familiar and comfortable.
// That is the "she softened over one conversation" bug, and it lived here, not in the prompt.
//
// knee = where diminishing returns start. An open person keeps the old knee at 50 and the old
// numbers exactly. A guarded person's knee slides toward 0, so their gains shrink from the
// first point — and `below` damps even the easy early movement, because the whole point is
// that the first fifteen points of warmth are the ones they don't give away.
//
// TUNING. These two are the whole feel of the system, so they're named rather than buried.
//   OPEN_KNEE  — where an obduracy-0 person starts hitting diminishing returns. 50 = old behavior.
//   MAX_DAMP   — how much a fully obdurate person's gains are cut even in the easy early range.
//                0.6 → a +8 kindness lands as +3.2. Raise toward 0.8 if the cast still thaws too
//                fast; a fully closed character then needs ~22 turns of steady warmth to reach 50.
export const OPEN_KNEE = 50;
export const MAX_DAMP = 0.6;

const gainScale = (current: number, obduracy = 0) => {
  const o = Math.max(0, Math.min(1, obduracy));
  const knee = OPEN_KNEE * (1 - o);
  const below = 1 - o * MAX_DAMP;
  if (current <= knee) return below;
  return clamp((100 - current) / Math.max(1, 100 - knee), 0.12, 1) * below;
};

// ── DRIFT ── Feeling toward someone is a claim that needs renewing, not a stored quantity. Without
// this, a character parked at 95 stays there forever on the strength of one good week forty turns
// ago, and estrangement is impossible except by explicit betrayal. Any edge untouched for a while
// eases back toward neutral, slowly, and only from the outer bands — close relationships don't
// evaporate, they just stop being free. Call once per turn, before the turn's deltas land.
export function decayEdges(edges: SocialEdge[], turn: number, idleTurns = 8, step = 0.5) {
  for (const e of edges) {
    if (turn - (e.updated_turn ?? turn) < idleTurns) continue;
    const ease = (v: number) => (Math.abs(v) <= 20 ? v : v > 0 ? v - step : v + step);
    e.warmth = clamp(ease(e.warmth), -100, 100);
    e.trust = clamp(ease(e.trust), -100, 100);
  }
}

export function applyEdgeDelta(
  edges: SocialEdge[],
  d: { from: string; to: string; warmth_delta: number; trust_delta: number; power_delta: number; note?: string; roles_set?: string[] },
  turn: number,
  ctx?: { chars?: Record<string, Identity>; traits?: Record<string, AcquiredTrait[]> },
) {
  const e = getEdge(edges, d.from, d.to);
  // The edge is d.from's feeling TOWARD d.to, so the relevant constitution is the feeler's.
  // Omit ctx and obduracy is 0, which reproduces the old arithmetic exactly — every existing
  // save and every call site that hasn't been updated behaves identically.
  const obd = ctx ? obduracyIn(ctx.chars, ctx.traits, d.from) : 0;
  const warmthDelta = d.warmth_delta > 0 ? d.warmth_delta * gainScale(e.warmth, obd) : d.warmth_delta;
  e.warmth = clamp(e.warmth + clamp(warmthDelta, -15, 15), -100, 100);
  // trust breaks faster than it builds: positive deltas apply at 60% strength, negatives at full.
  // Dampen the DELTA before applying it once (the old version added full then subtracted from the
  // absolute value, which gave wrong results at the clamp ceiling).
  let trustDelta = d.trust_delta > 0 ? d.trust_delta * 0.6 * gainScale(e.trust, obd) : d.trust_delta;
  // RUPTURE-REPAIR: trust that grows within five turns of a real disagreement on this edge is
  // REPAIR, and repair is how trust is actually built — it earns half again. Then the flag clears;
  // the next growth has to be earned on its own terms.
  if (d.trust_delta > 0 && e.last_rupture_turn !== undefined && turn - e.last_rupture_turn <= 5) {
    trustDelta *= 1.5;
    delete e.last_rupture_turn;
  }
  e.trust = clamp(e.trust + clamp(trustDelta, -20, 20), -100, 100);
  e.power = clamp(e.power + clamp(d.power_delta, -10, 10), -100, 100);
  if (d.note) e.notes = d.note.slice(0, 140);
  if (d.roles_set) {
    let roles = d.roles_set.map((r) => (typeof r === "string" ? r : String(r ?? "")).trim()).filter(Boolean).slice(0, 4);
    // RECIPROCAL-ROLE SANITY. The bookkeeper sometimes dumps BOTH sides of a directional
    // relationship onto one edge ("Marie -> Joe: [father, daughter]"), which is incoherent — Marie's
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
/** RUMORS AS A CELLULAR FIELD on the social graph — the engine's one cellular-automaton rule.
 *
 *  Each co-located group is a NEIGHBORHOOD; each person's cell state is knower/naive plus their
 *  relaxation scalar; the local rule spreads the rumor across the neighborhood with a threshold
 *  set by the group's aggregate body state. Dread travels through clenched rooms (fear rides a
 *  braced crowd), warm news through settled ones; neutral gossip rides either weather mildly.
 *
 *  Crucially, the field REDUCES — the thing a bare cellular automaton never does. Salience decays
 *  every turn (a rumor nobody is charged enough to repeat dies of boredom, not old age), while a
 *  transmission in matching weather feeds it (the story grows in the telling). Growth and decay on
 *  the same rule, because the field rides the same dissipative kernel as everything else: tension
 *  accrues, relaxation releases, structure cycles instead of only complexifying. */
const DREAD_WORDS = /\b(kill|dead|death|die|dying|war|raid|attack|burn|fire|plague|sick|arrest|hang|execut|betray|monster|flood|storm|collapse|missing|blood|threat|danger|curse|riot|flee|invad|drown|starv)\b/i;
const WARM_WORDS = /\b(wedding|married|birth|born|baby|festival|feast|harvest|peace|treaty|heal|cured|return|alive|saved|rescue|celebrat|gift|rain|spring)\b/i;

/** The rumor's emotional charge, read lexically from its content — zero tokens, no save migration.
 *  -1 dread / +1 warm / 0 neutral. */
function rumorCharge(content: string): number {
  const dread = DREAD_WORDS.test(content), warm = WARM_WORDS.test(content);
  if (dread && !warm) return -1;
  if (warm && !dread) return 1;
  return 0;
}

export function diffuseRumors(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  const groups: string[][] = [];
  // group 1: everyone in the player's scene. Then: offscreen NPCs bucketed by their actual LOCATION —
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
  // each neighborhood's aggregate body state — the mean relaxation of its members. This is the
  // local field the rule reads: one number per room, recomputed each turn.
  const groupMood = new Map<string[], number>();
  for (const group of groups) {
    const vals = group.map((id) => state.condition[id]?.psyche.relaxation ?? 0);
    groupMood.set(group, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  for (const rumor of state.world.rumors) {
    if (rumor.dead) continue;
    const age = state.world.current_turn - rumor.born_turn;
    if (age > 30 || rumor.knowers.length >= Object.keys(state.characters).length) { rumor.dead = true; continue; }
    // DISSIPATION: salience leaks away every turn. What nobody is charged enough to repeat dies.
    rumor.salience = Math.max(0, rumor.salience - 0.3);
    if (rumor.salience < 1) { rumor.dead = true; continue; }
    const charge = rumorCharge(rumor.content);
    let fed = false; // a rumor grows at most once per turn, no matter how many rooms carry it
    for (const group of groups) {
      const mood = groupMood.get(group) ?? 0;
      // weather match: dread amplifies in clenched rooms, warmth in settled ones, neutral mildly in either
      const match = charge < 0 ? Math.max(0, -mood) : charge > 0 ? Math.max(0, mood) : Math.abs(mood) / 2;
      const spread = 1 + (Math.min(8, match) / 8) * 1.5; // up to ×2.5 when the room's weather fits the story
      const knowers = group.filter((id) => rumor.knowers.includes(id));
      const naive = group.filter((id) => !rumor.knowers.includes(id) && id !== "char_player");
      for (const k of knowers) {
        const gk = state.characters[k]?.gregariousness ?? 0.5;
        for (const j of naive) {
          if (rumor.knowers.includes(j)) continue;
          const gj = state.characters[j]?.gregariousness ?? 0.5;
          const p = RUMOR_BASE_P * (rumor.salience / 10) * ((gk + gj) / 2) * spread;
          if (rng() < p) {
            rumor.knowers.push(j);
            log.push(`${state.characters[j]?.name ?? j} hears: "${rumor.content}" (from ${state.characters[k]?.name ?? k})`);
            // GROWTH: carried by matching weather, the story sharpens in the telling — the CA's
            // accrual term, balanced against the decay above so the field can't only complexify.
            if (!fed && match >= 3) {
              rumor.salience = Math.min(10, rumor.salience + 0.6);
              fed = true;
              log.push(`the story grows in the telling — "${rumor.content}" sharpens as it spreads.`);
            }
          }
        }
      }
    }
  }
  return log;
}

/** Per-turn drift of relaxation toward capacity; derive psyche state. */
export function tickPsyche(p: Psyche): void {
  // Drift toward capacity. Overshoot ABOVE capacity decays FASTER than recovery from below —
  // a person's nature sets a ceiling on how open they get, and they don't float far above it just
  // because scenes are pleasant. This is the fix for a low-capacity (tense, guarded, predatory)
  // character being pushed up to serene openness by repeated positive relaxation_deltas and staying
  // there: above capacity the pull-back is strong, so their natural tension reasserts.
  // A discharge (release from depth — see tickDischarge in emotions.ts) temporarily raises the
  // resting point: for a while after letting something go, the body CAN sit more open than its
  // nature. The lift decays below; capacity itself is untouched.
  const effCapacity = p.capacity + (p.discharge_lift ?? 0);
  const gap = effCapacity - p.relaxation;
  const rate = p.relaxation > effCapacity ? Math.max(p.recovery, 0.5) : p.recovery; // above-capacity overshoot collapses fast
  p.relaxation = clamp(p.relaxation + gap * rate, -10, 10);
  if (p.relaxation <= -7) p.consecutive_clenched++;
  else p.consecutive_clenched = 0;
  // open_run tracks how long they've sat AT/ABOVE their own resting openness — a character whose
  // capacity is low (guarded by nature) shouldn't accrue a long "open run" just for being at rest.
  // Reset when relaxation falls meaningfully below their capacity OR below the neutral line.
  const openFloor = Math.min(3, Math.max(0, effCapacity - 1));
  p.open_run = p.relaxation >= openFloor ? (p.open_run ?? 0) + 1 : 0;
  // the discharge opening closes gradually — ×0.7 per turn, gone within about a week of turns
  if (p.discharge_lift !== undefined) {
    p.discharge_lift = +(p.discharge_lift * 0.7).toFixed(3);
    if (p.discharge_lift < 0.2) p.discharge_lift = undefined;
  }
  if (p.state === "intact" && p.consecutive_clenched >= 4) p.state = "fracturing";
  if (p.state === "fracturing" && p.relaxation > -4) { p.state = "intact"; p.break_mode = null; }
  if (p.state === "fracturing" && p.relaxation <= -9) { p.state = "broken"; p.break_mode = p.break_mode ?? "fractured"; }
  if ((p.state === "broken" || p.state === "shattered") && p.relaxation > -2) { p.state = "intact"; p.break_mode = null; }
  p.mood_valence = clamp(Math.round(p.relaxation * 0.8), -10, 10);
}

/** Trait reinforcement-or-decay. Unreinforced acquired traits fade; identity-integrated ones persist. */
/** Consolidation — earned, slow identity change. An acquired trait reinforced into deep
 *  integration (high self_weight AND repeatedly reinforced) stops being a "learned" overlay
 *  and becomes WHO THEY ARE: folded into core_traits, and — if it bears on how they come
 *  across — into the stored speech_pattern, then retired from the acquired list. Never runs
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
  // importance >= 8, which — with a bookkeeper that under-scores — silently dropped genuinely
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
 *  rewrite is async, done by the turn loop — rare and cheap. Bedrock background is never touched. */
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
    return false; // retire from acquired — it's core now
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
    else if (rng() < 0.18) log.push(`${c.name} works toward "${c.drive.goal}" (${c.drive.progress}%)${c.drive.blocker ? ` — blocked by ${c.drive.blocker}` : ""}`);
  }
  return log;
}

/**
 * SELF-BETRAYAL CLENCH (deterministic). Yielding under pressure AGAINST an active want of one's
 * own is a clench, whatever its social shape — agreement-from-fixation is still fixation. Each
 * self-betrayal dips relaxation and increments a counter; at 3+ the strain shows as a
 * "swallowing resentment" state the narrator and lifecycle carry. Standing your ground (a
 * refusal or counteroffer) is free and repairs a point of the count; the count also drains
 * slowly on its own. A willing yes (no active want crossed) costs nothing — compliance is only
 * taxed when it contradicts something the character actually wants. Refusals and counters also
 * mark the pair's edge as ruptured, so trust grown within five turns earns the repair bonus.
 */
export function applyStances(
  state: SaveState,
  stances: { charId: string; towardId: string; stance: "yielded" | "refused" | "countered"; about: string }[],
  turn: number,
): string[] {
  const log: string[] = [];
  const handledIds = new Set<string>(); // anyone with a stance this turn skips the passive drain
  for (const st of stances) {
    const c = state.characters[st.charId];
    const cond = state.condition[st.charId];
    if (!c || !cond || st.charId === "char_player" || c.central === false) continue;
    handledIds.add(st.charId);
    if (st.stance === "yielded") {
      const opposing =
        (c.drive && relevance(st.about, c.drive.goal) >= 0.2) ||
        (c.current_goal && relevance(st.about, c.current_goal) >= 0.2);
      if (!opposing) continue; // nothing of their own was crossed: a willing yes is free
      const style = c.attachment?.style ?? "secure";
      const mult = style === "anxious" ? 1.25 : style === "disorganized" ? 1.1 : style === "avoidant" ? 0.9 : 0.75;
      cond.psyche.relaxation = clamp(cond.psyche.relaxation - 0.4 * mult, -10, 10);
      cond.psyche.betrayals = (cond.psyche.betrayals ?? 0) + 1;
      if (cond.psyche.betrayals >= 3 && !cond.psyche.active_states.includes("swallowing resentment")) {
        cond.psyche.active_states.push("swallowing resentment");
        log.push(`${c.name} keeps giving in against what they want — the strain of it is becoming visible.`);
      } else {
        log.push(`${c.name} gave in against their own want — a small clench.`);
      }
    } else {
      // refused or countered: standing your ground is free, and it hands a point of self back
      if ((cond.psyche.betrayals ?? 0) > 0) cond.psyche.betrayals = Math.max(0, (cond.psyche.betrayals ?? 0) - 1);
      getEdge(state.world.edges, st.charId, st.towardId).last_rupture_turn = turn;
    }
  }
  // the count drains for everyone with no stance this turn; resentment lifts when it empties
  for (const [cid, cond] of Object.entries(state.condition)) {
    if (handledIds.has(cid)) continue;
    const b = cond.psyche.betrayals ?? 0;
    if (b > 0) {
      cond.psyche.betrayals = Math.max(0, b - 0.34);
      if (cond.psyche.betrayals === 0) cond.psyche.active_states = cond.psyche.active_states.filter((s) => s !== "swallowing resentment");
    }
  }
  return log;
}

/**
 * ANSWERED-WANT CLOSURE (deterministic safety net). When a promise lands on the ledger whose
 * text matches a character's active drive — the player agreed to the date, swore to the favor —
 * that want is ANSWERED even though the event hasn't happened yet: the character got their yes,
 * and pressing the same ask next turn is a broken record, not a person. We complete the drive
 * exactly the way tickDrives completes offscreen ones (it becomes a memory, the slot clears) so
 * the Simulator's drives_update assigns the NEXT concrete goal ("plan the evening"). This closes
 * the loop even when the bookkeeper forgets to rotate: the promise reaching the ledger IS the
 * answer reaching state. Only the promise RECIPIENT's drive can match — they asked; the "yes"
 * was given to them.
 */
export function completeDrivesForPromises(state: SaveState, promises: { from: string; to: string; text: string }[]): string[] {
  const log: string[] = [];
  for (const p of promises) {
    const c = state.characters[p.to];
    if (!c || p.to === "char_player" || !c.drive) continue;
    if (relevance(p.text, c.drive.goal) < 0.2) continue;
    state.memory[p.to]?.episodic.push({
      turn: state.world.current_turn,
      content: `${state.characters[p.from]?.name ?? p.from} agreed: ${p.text}.`,
      importance: 7, emotional_charge: "satisfaction",
      last_accessed_turn: state.world.current_turn,
    });
    if (c.current_goal === c.drive.goal) c.current_goal = undefined;
    log.push(`${c.name} got their answer ("${c.drive.goal}") — moving to what comes next.`);
    c.drive = undefined;
  }
  return log;
}

/** Player-facing edges for telemetry snapshots. */
export function playerEdgeSnapshot(state: SaveState): { pair: string; warmth: number; trust: number }[] {
  return state.world.edges
    .filter((e) => e.to === "char_player" && state.characters[e.from])
    .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust }));
}

// ─────────────────────────── PROMISE LEDGER ───────────────────────────
// Who swore what to whom, and what it costs to keep or break it. The emotional swing scales with
// TWO things, like real life: how BIG the promise was (weight 1–3), and the PATTERN of this person's
// track record with the one they promised (a first slip from someone reliable is forgivable; the
// fifth broken vow is who they are now). Kept promises build trust faster than warmth (you can rely
// on them); broken ones cost trust hardest, and warmth too when the promise was large.

import type { Promise as PromiseRec } from "./types";

/** How many promises `from` has already KEPT vs BROKEN toward `to` — the track record that bends
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
    // each kept promise land a little softer (already expected) — but a big vow kept always matters.
    const base = p.weight === 3 ? 10 : p.weight === 2 ? 6 : 3;
    const familiarity = Math.max(0.6, 1 - hist.kept * 0.08); // slight diminishing returns
    const trustGain = Math.round(base * familiarity);
    const warmthGain = Math.round(trustGain * 0.6);
    applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: warmthGain, trust_delta: trustGain, power_delta: 0, note: `kept a promise: ${p.text}` }, turn, { chars: state.characters, traits: state.traits });
    if (state.memory[to]) state.memory[to].episodic.push({
      turn, content: `${fromName} kept their promise to ${toName === "you" ? "me" : toName}: ${p.text}`,
      importance: Math.min(8, 3 + p.weight * 2), emotional_charge: "trust, relief", last_accessed_turn: turn,
      source: state.world.present.includes(to) ? "witnessed" : "inferred",
    });
    return to === "char_player" ? `${fromName} kept their word: ${p.text}.` : `${fromName} kept a promise to ${toName}.`;
  } else {
    // breaking costs trust hardest, warmth too when the promise was large. A PATTERN of breaking
    // (this isn't the first) deepens the wound sharply — that's when "unreliable" becomes identity.
    const base = p.weight === 3 ? 14 : p.weight === 2 ? 9 : 5;
    const patternMult = 1 + Math.min(1.0, hist.broken * 0.4); // 1st break ×1, 2nd ×1.4, 3rd ×1.8, capped ×2
    // being genuinely trusted softens a FIRST, small break — benefit of the doubt, once
    const soften = (hist.broken === 0 && p.weight === 1 && (edge?.trust ?? 0) >= 40) ? 0.5 : 1;
    const trustLoss = -Math.round(base * patternMult * soften);
    const warmthLoss = -Math.round(base * patternMult * soften * (p.weight === 3 ? 0.8 : 0.45));
    applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: warmthLoss, trust_delta: trustLoss, power_delta: 0, note: `broke a promise: ${p.text}` }, turn, { chars: state.characters, traits: state.traits });
    if (state.memory[to]) state.memory[to].episodic.push({
      turn, content: `${fromName} broke their promise to ${toName === "you" ? "me" : toName}: ${p.text}${hist.broken > 0 ? " — again" : ""}`,
      importance: Math.min(9, 4 + p.weight * 2 + hist.broken), emotional_charge: hist.broken > 0 ? "hurt, hardening, done giving chances" : "hurt, let down", last_accessed_turn: turn,
      source: state.world.present.includes(to) ? "witnessed" : "inferred",
    });
    return to === "char_player" ? `${fromName} broke their word: ${p.text}.` : `${fromName} broke a promise to ${toName}${hist.broken > 0 ? " — not the first time" : ""}.`;
  }
}

// ─────────────────────────── OFF-SCREEN BOND DRIFT ───────────────────────────
// The world shouldn't freeze between scenes. Characters who share a place while the player is away
// slowly warm to or cool from each other based on compatibility — how alike their consciences are
// (do they both care, or both not?) and how much their values overlap. This is a gentle ±1/round
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
  // combine → a target sign: compatible pairs drift warm, incompatible drift cool
  return (conscienceScore * 0.5 + valueScore * 0.5); // 0..1
}

/** Drift warmth ±1 between same-place offscreen pairs toward their compatibility. Returns occasional
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
        if (rng() > 0.5) continue; // not every pair every round — bonds move slowly
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
