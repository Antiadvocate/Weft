/**
 * SOMATIC REMODELLING — the resting point is not a constant, and it was one.
 *
 * `capacity` is where relaxation drifts back to. It is stamped at forge from conscience and traits,
 * healed downward in turn.ts when it contradicts a character's nature, and after that it never moves
 * again for the life of the save. So a body that has spent eighty turns braced comes to rest in
 * exactly the same place as one that arrived this morning, and a body that has been held and safe
 * for eighty turns does too. The one number the whole kernel drifts toward is the only number in the
 * psyche with no history in it.
 *
 * Measured off the Ashford save at turn 29, four characters:
 *
 *   Vin    cap 2  rel 2.50  open_run 28   recovery 0.18
 *   Amber  cap 2  rel 2.51  open_run 28   recovery 0.18
 *   Leo    cap 4  rel 4.00  open_run 28   recovery 0.18
 *   Dana   cap 2  rel 2.00  open_run  6   recovery 0.18
 *
 * Every capacity is the integer the forge wrote on turn zero. Three of the four have sat at or above
 * their own resting openness for twenty-eight consecutive turns — the longest settled run the engine
 * can record — and it has changed nothing about them. Whatever those turns were, they were not a
 * life; they were weather over a fixed point. (Every `recovery` is 0.18 as well, the blank default,
 * so the claim that some people return to calm fast and some sit braced for days is also not true of
 * anybody in this save. That is a second undifferentiated constitutional scalar and it is
 * deliberately NOT touched here — see the note on the ratchet below.)
 *
 * The engine already has both temporary halves of this and has had them for a while:
 * `discharge_lift` (+1.5, ×0.7 a turn) for release and `grief_drag` for loss, both subtracted from
 * or added to capacity to produce an *effective* resting point that returns to baseline within a
 * week of turns. What has never existed is the case where the baseline itself moves — where the
 * week of turns does not end and the body stops treating the old number as home.
 *
 * ── WHAT MOVES IT ─────────────────────────────────────────────────────────────────────────────
 *
 * Runs, not turns. A single bad afternoon changes nobody, which is why this reads the run counters
 * the kernel already keeps rather than the current reading: `open_run` (turns at or above their own
 * openness floor) and a new `braced_run` (turns at or below −3, the same "threatened" line
 * emotions.ts uses for the second hit). A step is taken when a run COMPLETES a threshold, which is
 * what makes this hysteresis rather than jitter — capacity does not follow relaxation around, it
 * lags it by a whole run and then holds.
 *
 * Settling is cheaper to earn than wear (6 turns against 8) and pays the same step. That asymmetry
 * is deliberate and it is the single most important number in this file.
 *
 * ── AND WHY IT CANNOT RUN AWAY ────────────────────────────────────────────────────────────────
 *
 * The failure mode of this mechanic is a ratchet, and this engine has been bitten by that shape
 * twice already in the same scalar — a woman parked above capacity for thirty-five turns because
 * the delta always won the race against the drift, and a companion at −10 against a capacity of 2
 * for eleven. Both are documented in social.ts. Wear is worse than either, because wear FEEDS
 * ITSELF: a lower resting point means more turns spent below −3, which earns more wear. Left alone
 * that converges on a cast of shells in every long save, and there is no story in a person nothing
 * can reach.
 *
 * Four things stop it, and they are the design rather than a safety margin bolted on after:
 *
 *  1. A BAND. Capacity lives in [born − 2.5, born + 2.0] and cannot leave it. Whoever the forge said
 *     this person was is still legible at either edge. There is always a way back because there is
 *     always a bottom.
 *  2. A RESTORING FORCE. Every turn, with no run in progress at all, capacity creeps toward
 *     `capacity_born` at 2% of the gap. Too slow to fight a live run; decisive over fifty quiet
 *     turns. Absent sustained conditions, a person returns to themselves. This is the anti-ratchet
 *     proper: the default direction of the whole mechanism is home.
 *  3. SETTLING IS EASIER THAN WEAR, above.
 *  4. NUMBNESS HAS A CEILING AND IT IS LOW. See below.
 *
 * Simulated over the real tick order (drift → remodel → damped delta → grief drag → settle clamp),
 * which is what tests/remodel.ts runs. Born at 2.0 in every case:
 *
 *   120 turns of unbroken cruelty (−3 every turn)      cap 2.0 → 0.44,  numbness 0.63
 *   …then 120 turns of being held (+2 every turn)      cap 0.44 → 3.81, numbness 0
 *   120 turns of an ordinary life (small ups and downs) cap 2.0 → 2.0,  nothing moves at all
 *   60 turns of hell, then 100 turns of NOTHING        cap 0.72 → 1.73, numbness 0.51 → 0.11
 *
 * The last row is the one that matters and it is the reason the restoring force exists: no therapy,
 * no love, no scene — just a hundred turns in which nothing happens to her — and she comes most of
 * the way back. Slowly, and not all the way.
 *
 * The first row has a property worth recording: continuous wear converges around born − 1.6 and
 * never reaches the −2.5 floor, because the pull home scales with the gap (0.02 × gap) while wear is
 * flat (0.3 per 8 turns), so they balance. The band is a hard backstop that in practice never gets
 * used. The mechanism is self-limiting before the clamp is, which is the property you want — a limit
 * enforced by a clamp is a limit that will be hit.
 *
 * ── NUMBNESS ─────────────────────────────────────────────────────────────────────────────────
 *
 * The second axis, and the more interesting one: a worn body is not merely resting lower, it is
 * responding flatter. Ordinary friction stops landing. But "damp what reaches this character" is
 * exactly the shape that produces someone the story cannot touch, so it is bounded on the axis that
 * matters: only deltas of |1.5| or less are damped, and at most to 45% of their size. A worn person
 * does not flinch at the daily grind and is not, and cannot become, immune to catastrophe. A blow
 * lands in full on the most hardened character in any save.
 *
 * ── NEVER THE PLAYER ─────────────────────────────────────────────────────────────────────────
 *
 * `char_player` is excluded, and not as an oversight to fix later. The player's resting point is a
 * fact about a person the engine cannot observe: their interior reaches it only when they choose to
 * type it, and their tightness anchor is a self-report that caps relaxation and deliberately cannot
 * lift it. Deriving from the prose that the story has worn the player down, and then quietly making
 * that true of their body for the next hundred turns, is the same authorship `fault` is already
 * forbidden from committing ("telling somebody they feel guilty is the authorship the tightness
 * anchor exists to prevent"). Same rule, same reason.
 */
import type { Psyche, SaveState } from "./types";
import { clamp } from "./num";


/* ── the constants, gathered so the whole skeleton is visible at once ─────────────────────────── */

/** At or below this, the body is bracing. Same line emotions.ts uses for the second hit — and, for
 *  somebody whose nature already rests near it, stricter than it, because a guarded person sitting
 *  at their own resting point is at home rather than under load. */
export const BRACED_AT = -3;
/** Consecutive braced turns per step down. */
export const WEAR_RUN = 8;
/** Consecutive lifted turns per step up. Cheaper than WEAR_RUN on purpose. */
export const SETTLE_RUN = 6;
/** How far above their own resting point a body has to actually be for the turn to count as growth.
 *
 *  This is not `open_run`, and the first draft's use of it was the bug the long simulation found.
 *  `open_run` counts turns at or above an openness FLOOR one below capacity, so a character doing
 *  nothing in particular accrues it forever simply by not being hurt — Amber's reads 28 of 29 turns
 *  in the Ashford save. Growth keyed off that meant every peaceful cast drifted to the top of the
 *  band within forty turns and stayed, which makes an expanded nervous system the default reward for
 *  an uneventful story. An unremarkable life does not widen anybody. Being actively held does, so
 *  the turn only counts when something in the world has lifted this body ABOVE where it rests. */
export const LIFTED_BY = 0.5;
/** How far one completed run moves the resting point. */
export const STEP = 0.3;
/** How far the lived resting point may fall below, and rise above, the one they were made with. */
export const MAX_WEAR = 2.5;
export const MAX_GROWTH = 2.0;
/** Per-turn pull back toward `capacity_born`, as a fraction of the gap. The default direction. */
export const HOMING = 0.02;
/** Discharges that must accrue before release counts as a change of nature rather than an opening. */
export const DISCHARGES_PER_STEP = 3;
/** Deltas at or under this magnitude are ordinary friction and can be damped. Above it, nothing is. */
export const NUMB_CEILING = 1.5;
/** The most of an ordinary delta numbness may ever take. */
export const MAX_DAMP = 0.55;

/* ── state ───────────────────────────────────────────────────────────────────────────────────── */

/** The resting point this person was made with. Stamped once and never written again — every drift
 *  in this file is measured against it and pulled back toward it. Constitutional, not lived. */
export function bornCapacity(p: Psyche): number {
  return typeof p.capacity_born === "number" ? p.capacity_born : p.capacity;
}

/** Backfill for saves written before capacity had a history. Called from state.sanitize. */
export function ensureBorn(p: Psyche): void {
  if (typeof p.capacity_born !== "number") p.capacity_born = p.capacity;
}

/* ── the tick ────────────────────────────────────────────────────────────────────────────────── */

/**
 * One turn of remodelling for one body. Runs after drift, never for the player.
 *
 * Returns what it did, for the audit trail — the caller may ignore it. Nothing here is reported to
 * the narrator as a number; see `remodelCue` for what a card is allowed to carry.
 */
export function tickRemodel(p: Psyche, turn: number): { dir: "wear" | "settle" | null; to: number } {
  ensureBorn(p);
  const born = bornCapacity(p);
  const floor = born - MAX_WEAR, ceil = born + MAX_GROWTH;
  let dir: "wear" | "settle" | null = null;

  // A step is owed for every completed threshold of a run — so a twenty-four turn brace is three
  // steps, not one and not twenty-four.
  //
  // COUNTED AS A DEBT RATHER THAN CHECKED WITH A MODULO, which was the first draft and was quietly
  // broken. The run counters live in tickPsyche and therefore keep running through time skips, where
  // this function is deliberately not called (continuity.ts runs drift and no deltas — nobody is
  // releasing or breaking anything offscreen; the world just turns). A modulo test only fires on the
  // exact turn a threshold is crossed, so a week skipped offscreen would take a run from 6 to 30 and
  // pay out nothing at all. A debt survives the gap: whatever was earned while nobody was looking is
  // paid on the next turn that looks.
  const owe = (run: number, per: number, paid: number) => (run <= 0 ? -paid : Math.floor(run / per) - paid);
  const wearDue = owe(p.braced_run ?? 0, WEAR_RUN, p.wear_steps ?? 0);
  const settleDue = owe(p.settled_run ?? 0, SETTLE_RUN, p.settle_steps ?? 0);
  if (wearDue > 0) { p.capacity = clamp(p.capacity - STEP * wearDue, floor, ceil); dir = "wear"; }
  if (settleDue > 0) { p.capacity = clamp(p.capacity + STEP * settleDue, floor, ceil); dir = dir ?? "settle"; }
  p.wear_steps = Math.max(0, (p.wear_steps ?? 0) + wearDue);
  p.settle_steps = Math.max(0, (p.settle_steps ?? 0) + settleDue);

  // RELEASE ACCRUES, IT DOES NOT FIRE. One discharge is an opening and the engine already pays for
  // it with discharge_lift, which decays. Three of them across a save is a body that has learned it
  // can come back down, and that is a different resting point.
  const owed = Math.floor((p.discharges ?? 0) / DISCHARGES_PER_STEP);
  if (owed > (p.discharge_steps ?? 0)) {
    p.discharge_steps = owed;
    p.capacity = clamp(p.capacity + STEP, floor, ceil);
    dir = dir ?? "settle";
  }

  // AND THE DEFAULT DIRECTION IS HOME. Runs move the point; nothing keeps it there but more of the
  // same. This runs unconditionally, including on the turn a step lands, because a step is 0.3 and
  // this is at most 0.05 — it never reverses a run, it only outlasts one.
  p.capacity = +(p.capacity + (born - p.capacity) * HOMING).toFixed(3);
  p.capacity = clamp(p.capacity, floor, ceil);
  if (dir) p.remodel_turn = turn;
  return { dir, to: p.capacity };
}

/**
 * The two run counters this file owns. Updated in tickPsyche beside `open_run` and
 * `consecutive_clenched` so they keep counting wherever drift runs, time skips included.
 *
 * Both are measured against the EFFECTIVE resting point (capacity ± the temporary lift and drag),
 * not the bare one. That matters in both directions: a body carrying grief is already sitting low
 * and the drag is what lets it reach the braced line at all, and a body inside a discharge opening
 * is not growing — it is spending an opening the engine has already paid for, and counting it here
 * as well would pay twice for one release.
 */
export function tickRuns(p: Psyche): void {
  const eff = p.capacity + (p.discharge_lift ?? 0) - (p.grief_drag ?? 0);
  // WHERE THIS BODY HAS BEEN SITTING, not where the drift has just put it. tickPsyche calls this
  // AFTER moving relaxation toward the resting point, and above the resting point that move is the
  // fast collapse (rate ≥ 0.5) — so a body the world had lifted a full point above its nature reads
  // as exactly half a point above it by the time this runs, every time, and a threshold at half a
  // point loses on the equals. `prev_relaxation` is the value captured at the top of the turn,
  // which is where they actually spent it.
  const at = p.prev_relaxation ?? p.relaxation;
  const bracedLine = Math.min(BRACED_AT, eff - 1);
  p.braced_run = at <= bracedLine ? (p.braced_run ?? 0) + 1 : 0;
  p.settled_run = at > eff + LIFTED_BY ? (p.settled_run ?? 0) + 1 : 0;
}

/* ── numbness ────────────────────────────────────────────────────────────────────────────────── */

/** 0 = as reachable as they were made; 1 = as worn as this engine allows. Never above 0 for a body
 *  that has grown — settling does not blunt anybody. */
export function numbness(p: Psyche): number {
  const lost = bornCapacity(p) - p.capacity;
  return lost <= 0 ? 0 : clamp(lost / MAX_WEAR, 0, 1);
}

/**
 * What of an incoming relaxation delta actually reaches a worn body.
 *
 * Only ordinary friction is damped. The ceiling is the whole safety property: whatever this returns,
 * a delta of −3 is still a delta of −3, on anybody, always.
 */
export function dampen(p: Psyche, delta: number): number {
  const n = numbness(p);
  if (n <= 0 || Math.abs(delta) > NUMB_CEILING) return delta;
  return +(delta * (1 - n * MAX_DAMP)).toFixed(3);
}

/* ── what anybody is allowed to see ──────────────────────────────────────────────────────────── */

/** Below this the drift is not yet a difference anybody would notice. */
const LEGIBLE = 0.5;

/**
 * The card line, for a body the story has actually changed. Comparative and behavioural — what this
 * person does not react to any more, or what they can now take — never the number and never a mood.
 * Empty for everybody who is still where they started, which is most people most of the time.
 */
export function remodelCue(p: Psyche, name: string): string {
  const born = bornCapacity(p);
  const drift = p.capacity - born;
  if (Math.abs(drift) < LEGIBLE) return "";
  if (drift < 0) {
    return `  the story has worn this body: ${name} comes to rest tighter than ${name} did when this began. `
      + `Ordinary friction does not land the way it used to — the small slights, the ordinary rudeness, the day being difficult go through ${name} without catching — `
      + `and there is less in reserve when something real arrives. Render it as what ${name} no longer reacts to, never as a mood and never as toughness.`;
  }
  return `  the story has settled this body: ${name} comes to rest easier than ${name} did when this began. `
    + `There is more room before ${name} contracts, and care lands where it used to bounce. Render it as a widened threshold — what ${name} can now take without narrowing — never as cheerfulness.`;
}

/**
 * The auditable version, with the numbers in it. For the Inspector and the audit pass, never for a
 * model. A mechanic that moves a hidden number slowly over a hundred turns is exactly the kind that
 * can be wrong the entire time without anybody noticing, so the number is made legible rather than
 * inferred from behaviour — this is the detector for this file.
 */
export function remodelLine(p: Psyche, name: string): string {
  const born = bornCapacity(p);
  const drift = +(p.capacity - born).toFixed(2);
  if (Math.abs(drift) < 0.05) return `${name}: resting point ${born.toFixed(1)}, unchanged`;
  const dir = drift < 0 ? "worn" : "settled";
  const n = numbness(p);
  return `${name}: resting point ${born.toFixed(1)} → ${p.capacity.toFixed(2)} (${dir} ${Math.abs(drift).toFixed(2)}`
    + `${p.remodel_turn ? `, last moved turn ${p.remodel_turn}` : ""})`
    + `${n > 0 ? ` · ordinary friction lands at ${Math.round((1 - n * MAX_DAMP) * 100)}%` : ""}`;
}

/** Everybody in this save whose body the story has actually changed. */
export function remodelReport(state: SaveState): string[] {
  const out: string[] = [];
  for (const [id, c] of Object.entries(state.condition)) {
    if (id === "char_player" || !c?.psyche) continue;
    const name = state.characters[id]?.name;
    if (!name) continue;
    if (Math.abs(c.psyche.capacity - bornCapacity(c.psyche)) >= 0.05) out.push(remodelLine(c.psyche, name));
  }
  return out;
}
