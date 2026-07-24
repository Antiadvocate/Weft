
// ─────────────────────────────── THE HABIT ENGINE ───────────────────────────────
// Core traits as PHYSICS, not labels. A habit is an automaticity with a firing strength; the engine
// owns whether it fires each beat. The narrator NEVER receives the numbers or the lexicon (groove,
// strength, habit, probability) — only a per-beat fire verdict, the same way it receives fate and
// pressure. It cannot map the mechanic onto its trained "bad pattern to overcome" prior because it
// never sees the mechanic.
//
// The change mechanic is dzogchen self-liberation, grounded and directionless:
//   • A habit fires. If it fires SEEN (clarity of sight, gated by relaxation), its automaticity drops
//     a little — recognition loosens the grip. No suppression, no antidote, no self doing work, and
//     NOTHING written to the character's memory. Self-liberation leaves no trace of a "self improving".
//   • If it fires UNSEEN (clenched, blind), it DEEPENS — strength ticks up — and seeds a dwelling
//     (a replay) that, in a clenched body, grooves a second-order habit. The chain of delusion.
//   • Change is never chosen. The alternative never has to occur. Weakening happens DURING firing,
//     via seeing; the misfire later shows up as an ABSENCE, which needs no will and no decision.
//   • No self sees its own change. Strength moves in the dark. The ONLY way it becomes narratable is
//     when ANOTHER character, who knew the old pattern, notices the new behavior from outside.
//   • Directionless: the engine never judges a habit good or bad. What fills a dissolved habit's space
//     comes from the character's surviving desire, never a moral pole.
//
// Extinction is inhibition, not erasure (the relapse literature): unwatched, strength re-grooves
// toward baseline; a dissolved habit goes dormant, not deleted, and can revive under hard relapse.

import type { SaveState, CoreHabit, Identity } from "./types";
import { relevance } from "./memory";

// ── tuning (calibrated to ~4–6 arcs per 200 turns when opportunities are frequent; see design) ──
const FORGE_STRENGTH = 95;        // a new core habit is a wall
const NEW_HABIT_STRENGTH = 60;    // habits formed in play are drywall, not load-bearing
const SEEN_DROP = 5;              // automaticity lost when a fire is seen
const SEARING_MULT = 2;           // a searing seen fire (high salience) counts double — big step, not a flip
const CLENCH_GROOVE = 1;          // automaticity gained when a fire is unseen
const REGROOVE_PER = 1;           // spontaneous recovery toward baseline, applied on a cadence
const REGROOVE_EVERY = 5;         // turns between re-groove ticks (when not recently seen-fired)
const DORMANT_BELOW = 30;         // at/under this, the habit is ready to go dormant at next reflection
const NOTICE_DROP = 18;           // an observer notices once strength falls this far below the watermark
const OPPORTUNITY_THRESHOLD = 0.34; // relevance(trait, beat) above which the trigger context is "live"

/** sigmoid over relaxation → probability the character SEES the habit as it fires. Clear at +3,
 *  blind at −3. This is the corrected use of the relaxation kernel: it gates CLARITY OF SIGHT of
 *  one's own loop, NOT kindness. The mapping the narrator kept corrupting now lives engine-side. */
export function seenProbability(relaxation: number): number {
  return 1 / (1 + Math.exp(-(relaxation) * 0.7));
}

/** Backfill habits from a character's existing core_traits at forge strength, with small per-trait
 *  hash noise so not every wall is identically tall. Idempotent — only adds missing entries. */
export function ensureHabits(state: SaveState, id: string): CoreHabit[] {
  state.habits ??= {};
  const c = state.characters[id];
  if (!c) return [];
  const list = (state.habits[id] ??= []);
  const have = new Set(list.map((h) => h.trait.toLowerCase()));
  for (const t of (c.core_traits ?? [])) {
    if (!t || have.has(t.toLowerCase())) continue;
    const noise = (hashStr(t) % 7) - 3; // −3..+3
    const strength = Math.max(80, Math.min(99, FORGE_STRENGTH + noise));
    list.push({ trait: t, strength, baseline: strength, seen_fires: 0, last_fired_turn: -1, noticed_watermark: strength });
    have.add(t.toLowerCase());
  }
  return list;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

export interface HabitFire {
  char_id: string;
  trait: string;   // the concrete behavior to render, verbatim
  seen: boolean;   // engine-internal; NOT sent to the narrator
}

/** Run the habit engine for one beat, for the present central characters. Returns fire verdicts to
 *  render (concrete behaviors only) plus internal shifts/dwellings to apply. Zero tokens. */
export function tickHabits(
  state: SaveState,
  presentIds: string[],
  beatText: string,
  salience: number = 3,
  rng: () => number = Math.random,
): { fires: HabitFire[]; shifts: string[]; dwellings: { char_id: string; label: string }[] } {
  const fires: HabitFire[] = [];
  const shifts: string[] = [];
  const dwellings: { char_id: string; label: string }[] = [];
  const turn = state.world.current_turn;

  for (const id of presentIds) {
    if (id === "char_player") continue;
    const c = state.characters[id];
    if (!c || c.status === "dead" || c.status === "departed") continue;
    const habits = ensureHabits(state, id);
    const relax = state.condition[id]?.psyche?.relaxation ?? 0;

    // OPPORTUNITY DETECTION — is any habit's trigger context live this beat? Cap 1 fire/char/beat:
    // pick the single most-relevant live habit so a character doesn't discharge their whole sheet.
    let best: CoreHabit | null = null;
    let bestRel = OPPORTUNITY_THRESHOLD;
    for (const h of habits) {
      if (h.dormant) continue;
      const rel = relevance(h.trait, beatText);
      if (rel > bestRel) { bestRel = rel; best = h; }
    }
    if (!best) continue;

    // FIRE ROLL — P(fire) = strength/100. A misfire produces NOTHING: no verdict, no absence note,
    // no one notices. The dog simply doesn't bark. (This is the bootstrap: the alternative is never
    // chosen — it just fails to occur, and only later reads as an absence.)
    if (rng() > best.strength / 100) {
      // a NON-fire at low strength is where the absence lives — but we emit nothing; the observer
      // pass below is what eventually surfaces the accumulated absence.
      continue;
    }

    // it fired. SEEN ROLL — clarity of one's own loop, gated by relaxation.
    const seen = rng() < seenProbability(relax);
    best.last_fired_turn = turn;
    fires.push({ char_id: id, trait: best.trait, seen });

    if (seen) {
      // recognition loosens the grip — nothing written to memory, no self, no insight recorded.
      // A SEARING seen fire (a high-salience beat clearly witnessed) is a genuinely bigger step — the
      // honest version of a "coming to Jesus" moment: it counts double. Still a step, never a flip.
      const searing = salience >= 8;
      const drop = SEEN_DROP * (searing ? SEARING_MULT : 1);
      best.strength = Math.max(0, best.strength - drop);
      best.seen_fires += 1;
    } else {
      // fired blind — it deepens, and seeds a dwelling that (in a clenched body) grooves further.
      best.strength = Math.min(100, best.strength + CLENCH_GROOVE);
      dwellings.push({ char_id: id, label: `replaying it` });
    }

    // OBSERVER NOTICING — the ONLY path by which change enters the fiction, and only from OUTSIDE.
    // When strength has fallen far enough below the last-noticed watermark, and someone present knew
    // the old pattern (has an edge + witnessed prior fires), THEY get the observation. The changed
    // character gets nothing, ever.
    if (best.strength <= best.noticed_watermark - NOTICE_DROP) {
      const observer = presentIds.find((oid) =>
        oid !== id && oid !== "char_player" &&
        state.world.edges.some((e) => e.from === oid && e.to === id));
      if (observer) {
        best.noticed_watermark = best.strength;
        // neutral, non-evaluative observation — no "better/growing/softened", just a plain difference.
        if (state.memory[observer]) state.memory[observer].episodic.push({
          turn, content: lexScrub(neutralObservation(state.characters[observer], c, best.trait)),
          importance: 5, emotional_charge: "", last_accessed_turn: turn, source: "witnessed",
        });
        shifts.push(`${state.characters[observer].name} noticed something different about ${c.name}.`);
      }
    }
  }

  return { fires, shifts, dwellings };
}

/** Re-groove: extinction is inhibition, not erasure. Habits not recently seen-fired drift back toward
 *  baseline — the wall rebuilds itself when nobody's watching. Call on a cadence. */
export function regrooveHabits(state: SaveState): void {
  const turn = state.world.current_turn;
  if (turn % REGROOVE_EVERY !== 0) return;
  for (const list of Object.values(state.habits ?? {})) {
    for (const h of list) {
      if (h.dormant) continue;
      if (turn - h.last_fired_turn < REGROOVE_EVERY) continue; // recently active — no recovery yet
      if (h.strength < h.baseline) h.strength = Math.min(h.baseline, h.strength + REGROOVE_PER);
    }
  }
}

/** A neutral, non-evaluative observation string — banned from the evaluative lexicon. It states a
 *  plain difference ("hasn't done X the way they used to"), never growth/improvement/softening. */
function neutralObservation(observer: Identity, subject: Identity, trait: string): string {
  // strip the trait to a plain behavior clause; keep it observational and valence-free
  return `${subject.name} hasn't been ${describeAbsence(trait)} the way they used to.`;
}

/** Turn a trait label into a plain absence phrase without moralizing. Conservative: if we can't
 *  phrase it cleanly, fall back to a bare "acting the way they used to". */
function describeAbsence(trait: string): string {
  const t = trait.toLowerCase().trim();
  // e.g. "hits people on greeting" → "hitting people on greeting"; "cold and guarded" → "as cold and guarded"
  if (/^(hits?|strikes?|snaps?|lies?|steals?|drinks?|hums?|paces?|flinch\w*)/.test(t)) {
    return t.replace(/^(\w+)s?\b/, (m) => m.replace(/s$/, "") + "ing"); // crude gerund
  }
  return `as ${t}`;
}

/** POLARITY CHECK — the single-moment-flip killer. When the bookkeeper tries to plant a trait that
 *  CONTRADICTS an established core habit ("gentle" onto a habitual striker), it must not flat-plant —
 *  that's the drift, a whole personality reversed by one scene. Instead the contradicting moment is
 *  credited as a SEEN FIRE against the habit: the dramatic beat feeds the slow arc instead of skipping
 *  it. Returns true if the incoming trait was absorbed as a credit (and should NOT be planted). */
const POLARITY_PAIRS: [RegExp, RegExp][] = [
  [/\b(cruel|ruthless|cold|harsh|brutal|violent|aggressive|merciless|callous)\b/i, /\b(gentle|kind|warm|tender|merciful|soft|caring|compassionate|nurturing)\b/i],
  [/\b(guarded|closed|withdrawn|secretive|distrustful)\b/i, /\b(open|trusting|forthcoming|vulnerable|candid)\b/i],
  [/\b(cowardly|timid|meek|fearful)\b/i, /\b(brave|bold|fearless|courageous)\b/i],
  [/\b(dishonest|deceptive|lying|manipulative)\b/i, /\b(honest|truthful|sincere|straightforward)\b/i],
];
function contradicts(habitTrait: string, incoming: string): boolean {
  for (const [a, b] of POLARITY_PAIRS) {
    if ((a.test(habitTrait) && b.test(incoming)) || (b.test(habitTrait) && a.test(incoming))) return true;
  }
  return false;
}
/** If `incoming` contradicts one of this character's habits, credit it as a seen fire (double for a
 *  searing beat) and return true — absorbed, do not plant. Else false. */
export function absorbContradiction(state: SaveState, id: string, incoming: string, salience: number): string | null {
  const habits = state.habits?.[id]; if (!habits) return null;
  for (const h of habits) {
    if (h.dormant) continue;
    if (contradicts(h.trait, incoming)) {
      const drop = SEEN_DROP * (salience >= 8 ? SEARING_MULT : 1);
      h.strength = Math.max(0, h.strength - drop);
      h.seen_fires += 1;
      h.last_fired_turn = state.world.current_turn;
      return h.trait; // absorbed
    }
  }
  return null;
}

/** At the reflection cadence, retire any habit worn below the dormancy threshold. Directionless: the
 *  habit goes dormant (revivable on relapse), it's removed from the live core_traits list, and a
 *  NEUTRAL third-person life_history line marks the absence. What fills the space is NOT authored here
 *  as a moral improvement — the character's surviving desires and other traits simply operate without
 *  the automatism now. Returns neutral shift lines. Lexicon-banned: no better/growth/softened. */
export function dissolveWornHabits(state: SaveState, id: string, turn: number): string[] {
  const out: string[] = [];
  const habits = state.habits?.[id]; if (!habits) return out;
  const c = state.characters[id]; if (!c) return out;
  for (const h of habits) {
    if (h.dormant || h.strength > DORMANT_BELOW) continue;
    h.dormant = true;
    // remove from the live core_traits list (kept in habits[] as dormant, so it can revive)
    c.core_traits = (c.core_traits ?? []).filter((t) => t.toLowerCase() !== h.trait.toLowerCase());
    // neutral life_history note — plain absence, no valence
    const note = `Over that stretch, ${lexScrub(gerund(h.trait))} stopped being automatic for ${c.name}.`;
    c.life_history = c.life_history ? `${c.life_history} ${note}` : note;
    out.push(`Something long-set in ${c.name} has loosened.`);
  }
  return out;
}

/** crude gerund/absence phrasing for a trait, valence-free */
function gerund(trait: string): string {
  const t = trait.toLowerCase().trim();
  if (/^(hits?|strikes?|snaps?|lies?|steals?|drinks?|hums?|paces?|flinch\w*|grasps?|guards?)/.test(t)) {
    return t.replace(/^(\w+?)s?\b/, (_m, v) => v.replace(/s$/, "") + "ing");
  }
  return `being ${t}`;
}

/** strip any evaluative word that could smuggle a moral direction back into an engine-authored string */
function lexScrub(s: string): string {
  return s.replace(/\b(better|good|bad|worse|growth|growing|grown|improv\w*|heal\w*|soften\w*|kinder|nicer|wiser|redeem\w*|progress\w*)\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** The ONLY habit output the narrator ever receives. Concrete behavior verbatim, framed as law that
 *  already happened. No numbers, no lexicon (groove/strength/habit/probability never appear), no
 *  direction, and an explicit prohibition on the character noticing or the narration justifying it —
 *  because a self that notices its own pattern is exactly the moralizing arc we're foreclosing. */
export function habitVerdicts(fires: HabitFire[], state: SaveState): string {
  const live = fires.filter((f) => f.trait);
  if (!live.length) return "";
  const lines = live.map((f) => {
    const name = state.characters[f.char_id]?.name ?? "they";
    return `${name}: ${f.trait} — this happens before any choice, the way a hand finds a familiar railing. Render it plainly as what they do. Do NOT have them notice it, question it, resist it, or feel anything about doing it; do NOT justify or explain it.`;
  });
  return `\n\n=== WHAT THESE CHARACTERS DO WITHOUT DECIDING TO (law — already happening this beat) ===\n${lines.join("\n")}`;
}

