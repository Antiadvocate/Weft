// ─────────────────────────────── THE HABIT ENGINE ───────────────────────────────
// Core traits as PHYSICS, not labels. A habit is an automaticity with a firing strength; the engine
// owns whether it fires each beat. The narrator NEVER receives the numbers or the lexicon (groove,
// strength, habit, probability) — only a per-beat fire verdict, the same way it receives fate and
// pressure. It cannot map the mechanic onto its trained "bad pattern to overcome" prior because it
// never sees the mechanic.
//
// The change mechanic is dzogchen self-liberation, grounded and directionless:
//   • A habit fires. If it fires SEEN, its automaticity drops a little — recognition loosens the
//     grip. No suppression, no antidote, no self doing work, and NOTHING written to the character's
//     memory. Self-liberation leaves no trace of a "self improving".
//   • SEEING HAS TWO ROADS IN, and the engine used to know only one. The settled body watching
//     itself is the first. The second is the arising so loud it cannot be looked past, in a body
//     with no ease anywhere in it — which is where most people who ever caught themselves actually
//     caught themselves. Calm is not the price of admission; grip is what is being seen, not what
//     prevents seeing. See seenProbability / intensityProbability below.
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
import { isMannerism, mannerismSuppressed } from "./novelty";

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
/** Turns between chances for a mannerism to fire. A tic recurs; it does not recur every beat, and
 *  firing it every turn would groove it upward forever in any body that is not settled. */
const MANNERISM_REFRACTORY = 2;
/** Turns between chances for a subject habit. Longer than a tic: a signature behaviour is a signature
 *  because it recurs, not because it happens every beat. */
const HABIT_REFRACTORY = 3;

/* ── THE OPPORTUNITY GATE, AND WHY IT WAS A WALL ───────────────────────────────────────────────
 *
 * This engine was dark. Not off — dark: flag-gated off by default, and producing nothing at all when
 * the flag was set. Simulated over 200 turns, deterministic rng, three well-written traits and beats
 * deliberately written so the behaviour was unmistakably happening:
 *
 *   SETTLED (r +4)          200 turns:  0 fires,  0 seen,  0 noticed
 *   NEUTRAL (r  0)          200 turns:  0 fires,  0 seen,  0 noticed
 *   CLENCHED (r −7), loud   200 turns:  0 fires,  0 seen,  0 noticed
 *
 * Nothing ever cleared this threshold, because the threshold was a cosine similarity against the
 * beat, and novelty.ts had already written down exactly why that does not work:
 *
 *   "That is cosine similarity, which is right for ranking memories against each other but wrong
 *    here: it normalizes by document length, so an unmistakable expression inside a normal paragraph
 *    scores ~0.19 and gets weaker the longer the prose runs."
 *
 * novelty.ts fixed it and this file never did. Measured:
 *
 *   "Answers a question with a joke first…"  vs a beat of exactly that      relevance 0.302
 *   "Will not let a check be split evenly…"  vs the check arriving          relevance 0.218
 *   the same trait against a REAL turn of prose (what turn.ts passes)       relevance 0.162
 *   "loves basketball" vs "they played basketball at the court"             relevance 0.408  ← only
 *
 * The gate is at 0.34. So the only trait shape that could ever fire was the two-word adjective —
 * and this engine spends a whole module (coerce.ts, sketch.ts) forcing traits to be written as
 * concrete behavioural sentences instead, because adjectives give a person nothing to do. The better
 * the trait was written, the less able it was to ever fire. A perfect inversion.
 *
 * AND NO THRESHOLD FIXES IT, which is the part worth recording so nobody tunes this number again.
 * Against realistic prose — a woman deflecting a question about the roof with a joke and then giving
 * the real figure — the trait scores cosine 0.053 and containment 0.00, because the words "joke",
 * "answers" and "wait" are nowhere in it. The behaviour is ENACTED, not named. Lexical matching
 * cannot see an enacted behaviour, and the beat text is assembled BEFORE the prose exists, so the
 * simulator's semantic read (which is how novelty.ts solves the after-the-fact version) is not
 * available here either.
 *
 * So opportunity stops being lexical. The mannerism path already had the answer and had it for the
 * right reason — "a mannerism's trigger context is simply BEING IN THE SCENE" — and that is true of
 * every habit, not just the tics. A person does not do their pattern because the room said its
 * keyword. They do it because it is their pattern. Lexical relevance becomes a BOOSTER that decides
 * which habit wins the one slot when the scene is genuinely on-subject, never the gate that decides
 * whether anything happens at all.
 *
 * What replaces the gate is grip. An unprompted pattern runs far more readily in a braced body than
 * in a settled one — which is the kernel's own claim, applied to the channel it had never reached:
 * clenching IS the automaticity. A settled character does an unprompted signature behaviour about
 * one eligible beat in ten; a badly clenched one, better than half. Both still fire on-subject when
 * the scene actually calls for it.
 */

/** How readily a pattern runs when nothing in the scene prompted it. Grasping drives automaticity;
 *  slack is what an open body has and a braced one does not. */
export function unpromptedRate(relaxation: number): number {
  const gripped = Math.max(0, Math.min(1, (2 - relaxation) / 9));   // 0 at r≥+2, full by r≤−7
  return 0.05 + 0.45 * gripped;
}

/** Fire verdicts one beat may carry. Each one is a line of law telling the narrator to render a
 *  specific behaviour, and a scene of four people each doing their signature thing is a scene made
 *  of tics. The most gripped bodies keep their slots: whose patterns are running hardest is exactly
 *  what the beat is about. */
const FIRES_PER_BEAT = 2;
const BARE_SEEING = 0.04;         // seeing is never impossible, at any state — the floor under both roads
const INTENSITY_SEEING = 0.22;    // additional chance at full volume: a loud arising in a gripped body

/** sigmoid over relaxation → probability the character SEES the habit as it fires. Clear at +3,
 *  blind at −3. This is the corrected use of the relaxation kernel: it gates CLARITY OF SIGHT of
 *  one's own loop, NOT kindness. The mapping the narrator kept corrupting now lives engine-side.
 *
 *  THE CALM ROAD. It is one of two, and on its own it was a false claim about how seeing works —
 *  see intensityProbability below. */
export function seenProbability(relaxation: number): number {
  return 1 / (1 + Math.exp(-(relaxation) * 0.7));
}

/** THE SECOND ROAD — seeing that does not come through calm.
 *
 *  The calm road alone says a settled body sees its own loop and a clenched one cannot. At −7 the
 *  sigmoid returns 0.7%: a character in real trouble was mechanically incapable of the moment where
 *  they catch themselves doing it, and that moment is the most powerful scene fiction has. It was
 *  also a claim the engine had no business making. Regulation is not recognition; a calm person can
 *  be thoroughly asleep, and seeing has been known to arrive at the worst moment of someone's life —
 *  not despite the intensity, because of it. The louder the thing is, the more of it there is to
 *  see. That is why the instruction is always "look at the anger", never "wait until it passes".
 *
 *  So: a small floor that holds at any state, plus a bump that scales with how LOUD the arising is
 *  (beat salience) times how GRIPPED the body holding it is. Nothing above r = −2 and nothing below
 *  salience 4 — an ordinary moment in an ordinary body gets the floor and no more. At the bottom, at
 *  full volume, it reaches about one turn in four.
 *
 *  The two roads are independent doors: P(seen) = 1 − (1−calm)(1−intensity). The calm road loses
 *  nothing; the clenched body stops being blind by construction. */
export function intensityProbability(relaxation: number, salience: number): number {
  const loud = Math.max(0, Math.min(1, (salience - 4) / 6));       // silent below salience 4
  const gripped = Math.max(0, Math.min(1, (-relaxation - 2) / 6)); // nothing above r = −2, full by −8
  return BARE_SEEING + INTENSITY_SEEING * loud * gripped;
}

/** The whole probability of seeing a fire as it happens, across both roads. */
export function recognitionProbability(relaxation: number, salience: number): number {
  return 1 - (1 - seenProbability(relaxation)) * (1 - intensityProbability(relaxation, salience));
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

/**
 * A pattern the STORY laid down, entering as a habit for the first time.
 *
 * NEW_HABIT_STRENGTH was declared in this file from the beginning and never once used, so the only
 * habits any character ever had were the ones the forge wrote before turn one. Whatever a save did
 * to somebody could reach their acquired traits, their beliefs, their memory and their voice card —
 * and could never become an automaticity, which is the one thing a habit is.
 *
 * The distinction the unused constant was reserved for is the one that matters here: what a person
 * was made with is a wall (95), and what a life laid down on top of it is drywall (60). Both loosen
 * the same way and by the same mechanism. The second just has less of itself to lose, which is why a
 * thing you have been doing for a year comes apart faster than the thing you have always done.
 *
 * Called when consolidateTraits promotes a lived trait into core_traits — the moment the engine
 * already recognises as "this is who they are now" — so the two records stop disagreeing.
 */
export function formHabit(state: SaveState, id: string, trait: string): boolean {
  if (!trait?.trim()) return false;
  state.habits ??= {};
  const list = (state.habits[id] ??= []);
  const key = trait.trim().toLowerCase();
  const existing = list.find((h) => h.trait.trim().toLowerCase() === key);
  if (existing) {
    // A dormant pattern the story has re-established is a relapse, not a new habit: it comes back at
    // the strength a lived pattern gets, never at the wall it used to be.
    if (existing.dormant) { existing.dormant = false; existing.strength = NEW_HABIT_STRENGTH; existing.noticed_watermark = NEW_HABIT_STRENGTH; }
    return false;
  }
  list.push({ trait: trait.trim(), strength: NEW_HABIT_STRENGTH, baseline: NEW_HABIT_STRENGTH, seen_fires: 0, last_fired_turn: -1, noticed_watermark: NEW_HABIT_STRENGTH });
  return true;
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
    //
    // TWO KINDS OF TRIGGER, because there are two kinds of trait. A SUBJECT trait ("loves
    // basketball", "cannot let a half-told story go") is live when the beat is about its subject,
    // which lexical relevance measures well. A MANNER trait — a laugh, a straightened picture frame,
    // a thumb worrying a drawstring — has no subject to appear in the player's typed action, scores
    // ~0 against every beat ever written, and so never fired at all: in one twenty-turn save both of
    // a character's mannerisms sat at last_fired_turn -1 and seen_fires 0 while the prose rendered
    // them eight and nine times. The recognition path could not reach the traits most in need of it,
    // for a purely lexical reason. A mannerism's trigger context is simply BEING IN THE SCENE, so it
    // gets a non-lexical opportunity — rate-limited by the same frequency budget that governs
    // whether it should be on the page, so this does not just fire one every turn instead.
    let best: CoreHabit | null = null;
    let bestScore = -1;
    let onSubject = false;
    for (const h of habits) {
      if (h.dormant) continue;
      const manner = isMannerism(h.trait);
      if (manner && mannerismSuppressed(h, turn)) continue;   // resting: not on the page, not fired
      if (turn - (h.last_fired_turn ?? -99) < (manner ? MANNERISM_REFRACTORY : HABIT_REFRACTORY)) continue;
      // Lexical relevance no longer decides WHETHER anything is eligible — only which eligible habit
      // takes the one slot when the scene is genuinely about one of them. A tic has no subject to
      // match on and is never scored for it.
      const rel = manner ? 0 : relevance(h.trait, beatText);
      const score = rel + (rng() * 0.01);                     // tie-break, so the list order is not destiny
      if (score > bestScore) { bestScore = score; best = h; onSubject = rel >= OPPORTUNITY_THRESHOLD; }
    }
    if (!best) continue;

    // NOTHING IN THE SCENE ASKED FOR IT. A pattern still runs — that is what makes it a pattern —
    // but how readily depends on how much slack the body has. See unpromptedRate above.
    if (!onSubject && rng() > unpromptedRate(relax)) continue;

    // FIRE ROLL — P(fire) = strength/100. A misfire produces NOTHING: no verdict, no absence note,
    // no one notices. The dog simply doesn't bark. (This is the bootstrap: the alternative is never
    // chosen — it just fails to occur, and only later reads as an absence.)
    if (rng() > best.strength / 100) {
      // a NON-fire at low strength is where the absence lives — but we emit nothing; the observer
      // pass below is what eventually surfaces the accumulated absence.
      continue;
    }

    // it fired. SEEN ROLL — clarity of one's own loop. Two roads in: the settled body that can
    // watch itself, and the arising loud enough to be unmissable in a body with no ease at all.
    const seen = rng() < recognitionProbability(relax, salience);
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

  // The strength math above has already happened for everyone who fired — being seen or grooved is
  // what a firing DOES, and it does it whether or not the page has room for it. What the cap trims
  // is the narrator's instruction list, not the physics.
  const kept = fires.length <= FIRES_PER_BEAT ? fires
    : [...fires].sort((a, b) =>
        (state.condition[a.char_id]?.psyche?.relaxation ?? 0) - (state.condition[b.char_id]?.psyche?.relaxation ?? 0)
      ).slice(0, FIRES_PER_BEAT);
  return { fires: kept, shifts, dwellings };
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
