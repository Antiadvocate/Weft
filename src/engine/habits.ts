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
import { isMannerism, mannerismSuppressed, namedInPush } from "./novelty";

// ── tuning (calibrated to ~4–6 arcs per 200 turns when opportunities are frequent; see design) ──
/* FORGED AT 88, NOT 95, AND THE TWELVE POINTS ARE THE WHOLE OF THE POWER FEATURE.
 *
 * Once strength means what it reads as — see THE NUMBER IS A PROMISE below — the top of the scale
 * stops being a place to mint ordinary people. 92 and up is a COMPULSION: a pattern that supplies
 * its own occasion, ignores the page budget, and at 100 is in every single scene without exception.
 * That band has to be empty unless something deliberately puts a person in it, or every character
 * the forge writes is a tic machine. 88 is still a wall next to the 60 a lived pattern gets; it is
 * just a wall on the human side of the line. */
const FORGE_STRENGTH = 88;        // a new core habit is a wall — but not a compulsion
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

/* ── THE NUMBER IS A PROMISE ───────────────────────────────────────────────────────────────────
 *
 * A character was forged with a pattern at 95 and it surfaced in about one scene in twenty. Both
 * figures were in the save at once. The drawer printed 95; the engine rolled
 *
 *     P(fire) = unpromptedRate(relaxation) × strength/100
 *
 * and unpromptedRate in a settled body is 0.05. So the number the player could see, and reason
 * about, and plan around, was off by a factor of twenty from the number the engine used, in the one
 * direction that makes a feature look broken rather than mis-tuned: the pattern you were told was
 * definitive almost never happened.
 *
 * The occasion gate itself was not wrong. A person does not recalculate a restaurant bill in a scene
 * with no bill in it, and that is what it was protecting. What was wrong is that the gate was
 * applied to the whole scale, including the part of it that has no occasion because the occasion is
 * being awake. Somebody who taps their hands every time they speak does not need the scene to offer
 * an opening; the opening is that they spoke. The engine already knew this and had written it down
 * for mannerisms — "a mannerism's trigger context is simply BEING IN THE SCENE" — and then damped
 * mannerisms by grip anyway, which took the one channel that needed no occasion and gave it one.
 *
 * So the scale is now read as PERCENTAGE OF ELIGIBLE OCCASIONS, and what counts as an occasion
 * widens as the figure climbs:
 *
 *   below 92   a subject trait needs its subject in the scene; off-subject it is damped by grip,
 *              exactly as before. A manner trait's occasion is being present, full stop.
 *   92 → 100   the pattern begins supplying its own occasion, and the refractory gap and the page
 *              budget recede with it.
 *   100        every scene, no gate, no refractory, no budget, uncapped, and stated to the narrator
 *              as law it may not decline. The hand-tapper.
 *
 * That is the whole mechanic: one number, a spectrum, meaning what it says at every point on it. */

/** Where a pattern stops being situational. At and above this it supplies its own occasion. */
export const COMPULSION_AT = 92;
/** Base points a single push takes off, before inertia. */
const PRESS_DROP = 4;
/** How little of a push lands at the very top of the scale. Never zero: a wall you cannot ever move
 *  is not a habit, it is scenery. At 100 this is ~0.3 points a try, so it takes a dozen-odd tries to
 *  shift it five — which is the intended feel, and the reason the streak below exists. */
const PRESS_MIN_YIELD = 0.08;
/** Below this, a push moves the figure freely. Above it, inertia starts eating the push. */
const INERTIA_KNEE = 60;
/** How much a streak of pushes compounds, per consecutive turn, and where it stops. Pushing somebody
 *  four turns running is not four times one push; it is the thing that actually works. */
const PRESS_STREAK_STEP = 0.25;
const PRESS_STREAK_MAX = 5;
/** Turns of not pushing before the streak is forgotten and the pattern is on its own again. Set to
 *  the re-groove cadence on purpose: while somebody is still working on a pattern, the spontaneous
 *  recovery that would hand the ground straight back is held off, and keeping at it once every five
 *  turns is enough to keep holding it off. Stop, and the pattern starts climbing back to its floor —
 *  which is the relapse curve, and the reason this has to be kept at rather than done once. */
const PRESS_FORGET = 5;
/** Points a habit gains when it was ordered into a scene and the prose delivered it. Reinforcement
 *  is the cheap direction: doing a thing is how it stays done. */
const REINFORCE = 1;
/** Points a habit loses when it was ordered into a scene and did not occur — before inertia. A scene
 *  that should have had it and didn't is an absence, and absences are how extinction works. */
const HELD_DROP = 2;
/** A push that lands also drags the BASELINE down by this share of the drop, so re-groove cannot
 *  quietly undo a week of work over the following five turns. Progress has to be able to stick, or
 *  there is no point pushing at all. */
const PRESS_BASELINE_SHARE = 0.5;
/* THE CEILING IS NOT REACHABLE BY DRIFT, and finding that out cost a simulation.
 *
 * Run clenched and quiet for 200 turns, every fire blind, +1 a time: three patterns walked to a flat
 * 100 by turn ninety and stayed there. At 100 a pattern supplies its own occasion, ignores the
 * refractory gap and the page budget, and is stated to the narrator as law it may not decline — so a
 * character nobody had touched had silently become three simultaneous compulsions, in every beat, for
 * the remaining hundred and ten turns. 421 fires against 36 for the same cast at rest.
 *
 * A pattern hardening into a compulsion because its owner never once saw it happen is exactly right
 * and should stay possible. Walking to the absolute ceiling on arithmetic is not: the top of the
 * scale is a promise the player makes deliberately, by hand or at the forge, and a promise that can
 * assemble itself out of a hundred +1s is not one. So drift stops at 96 — inside the compulsion band,
 * short of the ceiling. Above 96 nothing but a hand puts you there, and nothing drags you down from
 * there either; the clamp only refuses to ADD. */
const DRIFT_CEILING = 96;

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

/** The figure as the player reads it: 0–100, whole points. */
export function habitPower(h: CoreHabit): number {
  return Math.max(0, Math.min(100, Math.round(h.strength)));
}

/** HOW MUCH OF ITS OWN OCCASION A PATTERN SUPPLIES. 0 below the compulsion line, 1 at 100.
 *
 *  This is the only thing that changes as a habit crosses from "who they are" into "what they cannot
 *  not do", and everything the top of the scale promises is expressed through it: the occasion gate,
 *  the refractory gap and the page budget all fade out on this one ramp. */
export function ownOccasion(power: number): number {
  return Math.max(0, Math.min(1, (power - COMPULSION_AT) / (100 - COMPULSION_AT)));
}

/** Is this pattern past the line where the scene no longer gets a say? */
export function isCompulsion(h: CoreHabit): boolean {
  return !h.dormant && habitPower(h) >= COMPULSION_AT;
}

/** Nothing may decline this one — it is at the ceiling, so it is in the scene, whatever the scene is. */
export function isAbsolute(h: CoreHabit): boolean {
  return !h.dormant && habitPower(h) >= 100;
}

/** THE SPECTRUM, in one line: how likely this pattern is to show up in THIS beat.
 *
 *  `onSubject` — the scene is about the thing. `manner` — a tic, whose occasion is being present.
 *  Everything else is the compulsion ramp widening what counts as an occasion until, at 100, there
 *  is no gate left and the answer is 1. */
export function appearanceChance(
  h: CoreHabit, relaxation: number, onSubject: boolean, manner: boolean,
): number {
  const power = habitPower(h);
  const base = onSubject || manner ? 1 : unpromptedRate(relaxation);
  const own = ownOccasion(power);
  const occasion = base + (1 - base) * own;
  return Math.max(0, Math.min(1, occasion * (power / 100)));
}

/** Turns that must pass before this pattern may run again. Shrinks on the compulsion ramp and is
 *  gone at the ceiling — a thing somebody does every time they speak has no cooling-off period. */
export function refractoryFor(h: CoreHabit, manner: boolean): number {
  const base = manner ? MANNERISM_REFRACTORY : HABIT_REFRACTORY;
  return Math.round(base * (1 - ownOccasion(habitPower(h))));
}

/** INERTIA — how much of a push actually lands, and the reason a deep pattern needs pushing at all.
 *
 *  Free movement up to the knee, then a straight fade to a floor at the top. At 90 a try moves a
 *  quarter of its nominal four points; at 100, a twelfth of it. That is the momentum the whole
 *  feature is for: you cannot talk somebody out of a compulsion in a scene, and you can wear one
 *  down over twenty. */
export function yieldFactor(power: number): number {
  if (power <= INERTIA_KNEE) return 1;
  const over = (power - INERTIA_KNEE) / (100 - INERTIA_KNEE);
  // SQUARED, not linear, and the difference is the whole feel of the top of the scale. Linear gives
  // a quarter of the push back at 90, which over twenty turns walks a deep pattern down without
  // anybody having to work at it — "a habit that's 90% likely to occur will rarely go down" is the
  // requirement, and a quarter is not rarely. Squared puts 90 at the floor and leaves the middle of
  // the scale moving at a speed a scene can actually change.
  return Math.max(PRESS_MIN_YIELD, (1 - over) * (1 - over));
}

/** WHAT A SCENE IS WORTH — and it is NOT the push curve, which cost a simulation to learn.
 *
 *  The first version ran the passive channels through yieldFactor too, on the reasoning that a deep
 *  pattern should resist everything equally. That froze the engine's oldest and most important arc.
 *  The forge writes at 88, which is most of the way up the push curve, so a caught fire went from
 *  five points to two tenths of one and 200 turns of a clenched body at full volume produced zero
 *  loosened patterns, zero grooved ones and nobody noticing anything — the same flat nothing this
 *  file's opening note was written about, reintroduced from the other side.
 *
 *  The two curves are answering different questions. How hard is this to ARGUE somebody out of is
 *  the push curve, and it is steep by design. How hard is this to SEE YOURSELF DOING is not steeper
 *  for a deep pattern — arguably the reverse — and it is the channel the whole self-liberation
 *  mechanic runs on. So below the compulsion line the scene is worth exactly what it always was, and
 *  only the compulsion band damps it, down to a quarter at the top. */
export function driftYield(power: number): number {
  if (power < COMPULSION_AT) return 1;
  return Math.max(0.25, 1 - ownOccasion(power));
}

/** A PASSIVE LOSS, which the ceiling does not take.
 *
 *  At 100 the figure is a promise the player made by hand: this is in every scene. Letting a caught
 *  fire quietly shave it to 99 and then 98 breaks that promise within three turns, on the channel
 *  the player has no way to see and no way to answer — and the ceiling is precisely the case where
 *  recognition is NOT the mechanism. A compulsion is not a thing somebody notices their way out of;
 *  it is a thing other people have to keep pushing on, which is what applyPress is. So drift stops
 *  at the ceiling from below (DRIFT_CEILING) and at the ceiling from above (here), and the only door
 *  off the top of the scale is a push or a hand. */
export function passiveLoss(strength: number, loss: number): number {
  if (Math.round(strength) >= 100) return strength;
  return Math.max(0, strength - loss * driftYield(Math.round(strength)));
}

/** Add to a figure without letting drift carry it past DRIFT_CEILING. A figure already above the
 *  ceiling is left exactly where it is — the clamp refuses to add, it never subtracts. */
export function drift(strength: number, gain: number): number {
  if (gain <= 0) return strength;
  return Math.min(100, Math.max(strength, Math.min(strength + gain, DRIFT_CEILING)));
}

/** What a single push is worth right now, streak included — so the drawer can say it before the
 *  player spends a turn finding out. */
export function pressWorth(h: CoreHabit, base: number = PRESS_DROP): number {
  const streak = Math.min(PRESS_STREAK_MAX, h.pressure_streak ?? 0);
  return base * yieldFactor(habitPower(h)) * (1 + streak * PRESS_STREAK_STEP);
}

/** SOMEBODY PUSHED THEM ON IT — the player's typed action, matched against the habit's own words.
 *
 *  This is deliberately lexical, and it is the one place in this engine where lexical matching is the
 *  RIGHT instrument rather than the wrong one. The long note above explains why a behaviour cannot be
 *  found in prose by its words: prose ENACTS a habit, and enacted behaviour shares no vocabulary with
 *  the label. A push is the exact opposite. You cannot ask somebody to stop doing a thing without
 *  naming the thing — "stop tapping", "will you leave the bill alone" — so the words are there by
 *  construction, in a short line the player typed, with no paragraph of scenery to dilute them.
 *
 *  It only reads the PLAYER's action. An NPC leaning on another NPC about their habit is invisible
 *  here and stays invisible; the pressure a character is under from the rest of the cast rides the
 *  existing seen-fire channel instead. This is the player's handle, and it is honest about being one. */
const PUSH_CUE = /\b(stop|quit|cut it out|knock it off|don'?t|do ?n'?t|enough|leave it|let it go|ask(?:s|ed)? (?:him|her|them|\w+) to stop|tell(?:s|ing)? (?:him|her|them|\w+) to stop|calm|steady|hold still|put (?:it|them) down|no more|again\?|catch(?:es)? (?:his|her|their) hand|take(?:s)? (?:his|her|their) hand)\b/i;

/** Which of a character's habits the player just pushed against, if any. Empty when the action was
 *  not a push at all — the cue is required, so "she tapped the table" is never read as an objection
 *  to somebody's tapping. */
export function pressedHabits(action: string, habits: CoreHabit[]): CoreHabit[] {
  const text = String(action ?? "");
  if (!text.trim() || !PUSH_CUE.test(text)) return [];
  return habits.filter((h) => !h.dormant && namedInPush(h.trait, text));
}

/** The key a pushed habit is carried under between the action and the roll. */
export function pressKey(id: string, trait: string): string {
  return `${id}::${String(trait ?? "").trim().toLowerCase()}`;
}

/** HOW MUCH BEING ASKED TO STOP ACTUALLY STOPS THEM, this beat.
 *
 *  A push is not a suppression — nobody in this engine chooses their way out of a pattern, and the
 *  whole file exists to say so. What a push does is make the occasion slightly harder to take, which
 *  for an ordinary pattern is enough to turn some scenes into the extinction trials that do the real
 *  work, and for a compulsion is almost nothing. At the ceiling it is exactly nothing: a habit set to
 *  be in every scene is in every scene, and a player who set that figure should not have it quietly
 *  undone by their own character asking nicely. */
export function pressDamp(h: CoreHabit): number {
  return 1 - 0.35 * (1 - ownOccasion(habitPower(h)));
}

/** EVERY HABIT THE PLAYER'S ACTION PUSHED AGAINST, across the people in the room.
 *
 *  Scoped by name when the action names somebody present — "tell Amber to stop counting the bill"
 *  is about Amber and not about the other two people at the table. With no name it applies to
 *  anybody present whose pattern the words actually match, which in practice is one person, because
 *  the match requires the habit's own distinctive words to be in a line the player typed. */
export function detectPressure(
  state: SaveState, presentIds: string[], action: string,
): { key: string; char_id: string; trait: string }[] {
  const text = String(action ?? "");
  if (!text.trim() || !PUSH_CUE.test(text)) return [];
  const hay = ` ${text.toLowerCase()} `;
  const live = presentIds.filter((id) => id !== "char_player" && state.characters[id]);
  const named = live.filter((id) => {
    const n = state.characters[id]?.name?.split(/\s+/)[0]?.toLowerCase();
    return !!n && n.length > 2 && new RegExp(`\\b${n}\\b`).test(hay);
  });
  const scope = named.length ? named : live;
  const out: { key: string; char_id: string; trait: string }[] = [];
  for (const id of scope) {
    for (const h of pressedHabits(text, state.habits?.[id] ?? [])) {
      out.push({ key: pressKey(id, h.trait), char_id: id, trait: h.trait });
    }
  }
  return out;
}

/** APPLY ONE PUSH. `landed` means the habit did not occur in the scene the push was made in — the
 *  try worked. A try that didn't work still counts for half, because the player did the thing the
 *  mechanic is asking for, and a push that produces literally nothing on the turns the habit wins is
 *  a push nobody makes twice. "Every time I try it should be able to dial back."
 *
 *  Returns the points taken off, for the log. */
export function applyPress(h: CoreHabit, turn: number, landed: boolean): number {
  const lapsed = turn - (h.last_pressed_turn ?? -99);
  if (lapsed > PRESS_FORGET) h.pressure_streak = 0;
  h.pressure_streak = Math.min(PRESS_STREAK_MAX, (h.pressure_streak ?? 0) + 1);
  h.last_pressed_turn = turn;
  const worth = pressWorth(h) * (landed ? 1 : 0.5);
  const before = h.strength;
  h.strength = Math.max(0, h.strength - worth);
  const moved = before - h.strength;
  if (landed) {
    h.pressed_clear = (h.pressed_clear ?? 0) + 1;
    // and the floor comes with it, or re-groove hands the ground straight back
    h.baseline = Math.max(0, h.baseline - moved * PRESS_BASELINE_SHARE);
  }
  // A figure the player has been working on is no longer the figure the forge set, so the hand-edit
  // pin comes off: from here it is in play, and re-groove may have it back if nobody keeps pushing.
  h.pinned = false;
  return moved;
}

/** A HAND ON THE DIAL. The player setting the figure directly, because it got where it is by
 *  accident — a run of unlucky rolls, a trait the forge read as a compulsion, a push that overshot.
 *
 *  Baseline moves with it. Setting a figure that re-groove spends the next five turns undoing is not
 *  setting a figure; and the pin keeps the drift off it until something in play moves it again. */
export function setHabitPower(state: SaveState, id: string, trait: string, power: number): CoreHabit | null {
  const key = String(trait ?? "").trim().toLowerCase();
  const h = (state.habits?.[id] ?? []).find((x) => x.trait.trim().toLowerCase() === key);
  if (!h) return null;
  const p = Math.max(0, Math.min(100, Math.round(power)));
  h.strength = p;
  h.baseline = p;
  h.noticed_watermark = p;
  h.pinned = true;
  h.pressure_streak = 0;
  // Raising a retired pattern back over the dormancy line is how a player revives one by hand; it is
  // the same door a relapse comes through, so it opens the same way.
  if (h.dormant && p > DORMANT_BELOW) h.dormant = false;
  const c = state.characters[id];
  if (c && !h.dormant && !(c.core_traits ?? []).some((t) => t.trim().toLowerCase() === key)) {
    c.core_traits = [...(c.core_traits ?? []), h.trait];
  }
  return h;
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
    const strength = compulsiveWording(t)
      ? Math.max(COMPULSION_AT, Math.min(100, 97 + noise))
      : Math.max(80, Math.min(COMPULSION_AT - 1, FORGE_STRENGTH + noise));
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

/** DOES THE TRAIT SAY, IN ITS OWN WORDS, THAT IT IS NOT OPTIONAL?
 *
 *  "Taps his hands every time he speaks" and "cannot leave a crooked picture frame alone" are not
 *  the same kind of claim as "answers a question with a joke first", and minting all three at the
 *  same figure is how a forged compulsion ends up surfacing in one scene in five. A player can always
 *  set the dial by hand, but a character written as compulsive should arrive compulsive.
 *
 *  Lexical, and legitimately so: this reads the LABEL, which is a sentence somebody wrote about the
 *  behaviour, not prose enacting it. The long note above is about the other case. */
function compulsiveWording(trait: string): boolean {
  return /\b(every ?time|everytime|each time|whenever|always|constantly|compulsive\w*|cannot (?:help|stop|not)|can'?t (?:help|stop|not)|never not|without fail|unable to stop|involuntar\w*|tic\b|nervous habit)\b/i.test(String(trait ?? ""));
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
  /** Past the compulsion line: the page budget may not trim it, and the narrator is told so. */
  compelled?: boolean;
  /** At the ceiling. Every scene, no exceptions, and the mandate says exactly that. */
  absolute?: boolean;
}

/** Run the habit engine for one beat, for the present central characters. Returns fire verdicts to
 *  render (concrete behaviors only) plus internal shifts/dwellings to apply. Zero tokens. */
export function tickHabits(
  state: SaveState,
  presentIds: string[],
  beatText: string,
  salience: number = 3,
  rng: () => number = Math.random,
  /** Keys (`char_id::trait`) the player pushed against in THIS turn's action. See pressKey. */
  pressed?: Set<string>,
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
    // A COMPULSION DOES NOT QUEUE. The one-slot cap below is page economy for the patterns that
    // compete for attention; a pattern past the compulsion line is not competing, it is happening,
    // and a character with two of them does both. So the sheet splits in two here.
    const compelled: CoreHabit[] = [];
    let best: CoreHabit | null = null;
    let bestScore = -1;
    let onSubject = false;
    let bestManner = false;
    for (const h of habits) {
      if (h.dormant) continue;
      const manner = isMannerism(h.trait);
      const compel = isCompulsion(h);
      // The novelty budget rests a tic that has been on the page too often. It does not get to rest
      // a compulsion: "they have done it a lot lately" is the definition of the thing, not a reason
      // to skip it. Same for the refractory gap, which is zero at the ceiling by construction.
      if (manner && !compel && mannerismSuppressed(h, turn)) continue;   // resting: not on the page, not fired
      if (turn - (h.last_fired_turn ?? -99) < refractoryFor(h, manner)) continue;
      if (compel) { compelled.push(h); continue; }
      // Lexical relevance no longer decides WHETHER anything is eligible — only which eligible habit
      // takes the one slot when the scene is genuinely about one of them. A tic has no subject to
      // match on and is never scored for it.
      const rel = manner ? 0 : relevance(h.trait, beatText);
      // ...and a stronger pattern wins the slot over a weaker one on an equally indifferent beat,
      // which is what makes the figure mean something below the compulsion line too: a 40 and an 85
      // in the same person are not two coin flips for one place on the page.
      const score = rel + (h.strength / 100) * 0.2 + (rng() * 0.01);
      if (score > bestScore) { bestScore = score; best = h; bestManner = manner; onSubject = rel >= OPPORTUNITY_THRESHOLD; }
    }

    // ROLL EACH ONE ON ITS OWN NUMBER. appearanceChance is the whole spectrum — see THE NUMBER IS A
    // PROMISE. At 100 it returns 1 and the pattern is simply in this beat.
    const running: CoreHabit[] = [];
    const damp = (h: CoreHabit) => pressed?.has(pressKey(id, h.trait)) ? pressDamp(h) : 1;
    for (const h of compelled) if (rng() < appearanceChance(h, relax, true, isMannerism(h.trait)) * damp(h)) running.push(h);
    if (best && rng() < appearanceChance(best, relax, onSubject, bestManner) * damp(best)) running.push(best);
    // A misfire produces NOTHING: no verdict, no absence note, no one notices. The dog simply doesn't
    // bark. (This is the bootstrap: the alternative is never chosen — it just fails to occur, and only
    // later reads as an absence.)
    if (!running.length) continue;

    for (const fired of running) {
      firedOne(fired, id, c, relax);
    }
  }

  // The strength math above has already happened for everyone who fired — being seen or grooved is
  // what a firing DOES, and it does it whether or not the page has room for it. What the cap trims
  // is the narrator's instruction list, not the physics. A compulsion is never trimmed: it is the
  // one kind of line the budget exists to protect, not to ration.
  const mandatory = fires.filter((f) => f.compelled);
  const optional = fires.filter((f) => !f.compelled);
  const room = Math.max(0, FIRES_PER_BEAT - mandatory.length);
  const kept = [...mandatory, ...(optional.length <= room ? optional
    : [...optional].sort((a, b) =>
        (state.condition[a.char_id]?.psyche?.relaxation ?? 0) - (state.condition[b.char_id]?.psyche?.relaxation ?? 0)
      ).slice(0, room))];
  for (const f of kept) {
    const h = (state.habits?.[f.char_id] ?? []).find((x) => x.trait === f.trait);
    if (h) h.mandated_turn = turn;
  }
  return { fires: kept, shifts, dwellings };

  /** What one firing does. Lifted out of the loop when compulsions stopped queueing behind each
   *  other, so two patterns in the same person run the same code the one used to. */
  function firedOne(best: CoreHabit, id: string, c: Identity, relax: number): void {
    // it fired. SEEN ROLL — clarity of one's own loop. Two roads in: the settled body that can
    // watch itself, and the arising loud enough to be unmissable in a body with no ease at all.
    const seen = rng() < recognitionProbability(relax, salience);
    best.last_fired_turn = turn;
    fires.push({ char_id: id, trait: best.trait, seen, compelled: isCompulsion(best), absolute: isAbsolute(best) });

    if (seen) {
      // recognition loosens the grip — nothing written to memory, no self, no insight recorded.
      // A SEARING seen fire (a high-salience beat clearly witnessed) is a genuinely bigger step — the
      // honest version of a "coming to Jesus" moment: it counts double. Still a step, never a flip.
      const searing = salience >= 8;
      const drop = SEEN_DROP * (searing ? SEARING_MULT : 1);
      best.strength = passiveLoss(best.strength, drop);
      best.seen_fires += 1;
    } else {
      // fired blind — it deepens, and seeds a dwelling that (in a clenched body) grooves further.
      best.strength = drift(best.strength, CLENCH_GROOVE * driftYield(habitPower(best)));
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
}

/** Re-groove: extinction is inhibition, not erasure. Habits not recently seen-fired drift back toward
 *  baseline — the wall rebuilds itself when nobody's watching. Call on a cadence. */
export function regrooveHabits(state: SaveState): void {
  const turn = state.world.current_turn;
  if (turn % REGROOVE_EVERY !== 0) return;
  for (const list of Object.values(state.habits ?? {})) {
    for (const h of list) {
      if (h.dormant) continue;
      // No pin check: a hand-set figure sets the BASELINE, and re-groove only ever moves toward the
      // baseline. Restoring a pattern toward the number the player chose is what honouring that
      // number means, in both directions — there is nothing here for a pin to protect.
      if (turn - h.last_fired_turn < REGROOVE_EVERY) continue; // recently active — no recovery yet
      // AND NOT WHILE SOMEBODY IS STILL ON THEM ABOUT IT. Spontaneous recovery is what happens when
      // nobody is watching; a player who pushed two turns ago is watching. Without this the re-groove
      // tick hands back most of a landed push before the next one can be made, and the momentum the
      // whole mechanic is built on never accumulates.
      if (turn - (h.last_pressed_turn ?? -99) <= PRESS_FORGET) continue;
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
    const base = `${name}: ${f.trait} — this happens before any choice, the way a hand finds a familiar railing. Render it plainly as what they do. Do NOT have them notice it, question it, resist it, or feel anything about doing it; do NOT justify or explain it.`;
    // THE CEILING IS NOT A SUGGESTION, and the narrator has to be told so in the register it obeys.
    //
    // The ordinary line above is a description of something that already happened, which is the right
    // shape for a pattern that MOSTLY runs — the model renders it or finds the beat too crowded and
    // quietly doesn't, and either is fine because "mostly" is what the figure said. At the top of the
    // scale it is not fine. A person who taps their hands every time they speak taps their hands in
    // this scene, in the scene after it, and in the one where somebody is dying. There is no version
    // of the turn that is too busy, too tense, or too sad for it, and the only way the prose can
    // deliver that is if the instruction refuses the out before the model reaches for it.
    //
    // Still no number and no lexicon: what the narrator is handed is the behaviour and the words
    // "without exception". It cannot tell a ceiling from a floor from the other side of this string.
    if (f.absolute) {
      return `${base} THIS ONE IS WITHOUT EXCEPTION — it is in this scene, and it will be in the next one, and it does not wait for a lull or a natural opening. It is not a beat you are spending; it runs underneath whatever the scene is otherwise about, in the same breath as what they are already doing. If the turn is tense, crowded or grim, it happens anyway and nobody remarks on it. Do not write a version of the turn that leaves it out.`;
    }
    if (f.compelled) {
      return `${base} They cannot readily not do this, so do not look for the right moment for it — it does not need one and it does not wait for one.`;
    }
    return base;
  });
  return `\n\n=== WHAT THESE CHARACTERS DO WITHOUT DECIDING TO (law — already happening this beat) ===\n${lines.join("\n")}`;
}

/* ── AFTER THE PROSE: WHAT THE SCENE ACTUALLY DID WITH THE ORDER ───────────────────────────────
 *
 * Everything above this line is a prediction. `reconcileHabits` is the only part of the engine that
 * finds out, and it does it with an instrument that already existed and was being used one axis over:
 * the simulator's `traits_expressed` read, which judges a trait by MEANING (a gelato expresses "loves
 * ice cream") and is the only thing here capable of telling whether an ordered behaviour occurred.
 *
 * Two directions fall straight out of the comparison, and they are the two the player asked for:
 *
 *   ORDERED AND DELIVERED   → the pattern ran, so it is a little more the pattern than it was.
 *                             Repetition is the mechanism; there is no other one.
 *   ORDERED AND ABSENT      → a scene that should have had it and didn't. That is an extinction
 *                             trial, and it is the shape every real attempt to drop a habit takes:
 *                             not a decision, an occasion that went by without it.
 *
 * Both are damped by inertia, so a pattern near the ceiling barely moves on either — which is why
 * the player's push has a streak on it and a single lucky scene does not.
 */
export function reconcileHabits(
  state: SaveState, presentIds: string[], expressed: Map<string, string[]>, turn: number, simAnswered: boolean,
): string[] {
  const out: string[] = [];
  // A turn the simulator did not answer for tells us nothing. Reading silence as "it did not happen"
  // would erode every mandated habit in the cast on every thin bookkeeping turn — the exact failure
  // recordExpressions documents next door, and the reason its fallback is gated the same way.
  if (!simAnswered) return out;
  for (const id of presentIds) {
    if (id === "char_player") continue;
    const habits = state.habits?.[id];
    if (!habits?.length) continue;
    const said = expressed.get(id) ?? [];
    for (const h of habits) {
      if (h.dormant || h.mandated_turn !== turn) continue;
      const landed = said.some((r) => sameish(r, h.trait));
      if (landed) {
        h.strength = drift(h.strength, REINFORCE * driftYield(habitPower(h)));
        h.held = 0;
      } else {
        h.held = (h.held ?? 0) + 1;
        h.strength = passiveLoss(h.strength, HELD_DROP);
        // AND THE CEILING IS AUDITED OUT LOUD. Below the compulsion line a skipped beat is just the
        // roll going the other way and nobody needs telling. At the top the player was promised every
        // scene, and a promise the engine cannot keep is worth more said than hidden — it is the
        // difference between "the narrator ignored it" and "I have no idea whether this works".
        if (habitPower(h) >= 100 && (h.held ?? 0) >= 2) {
          const name = state.characters[id]?.name ?? "They";
          out.push(`${name}: "${h.trait}" was set to happen in every scene and has now missed ${h.held}. It is being pushed harder; if it keeps missing, the behaviour may be written in a way the prose cannot show.`);
          h.held = 0;
        }
      }
    }
  }
  return out;
}

/** THE SECOND TURN OF A MISSED CEILING. A mandate the prose skipped gets restated harder on the
 *  next turn, with the miss named — the same correction shape the rest of the engine uses when a
 *  directive did not land, rather than repeating the identical sentence and hoping. */
export function heldMandateNote(state: SaveState, presentIds: string[]): string {
  const rows: string[] = [];
  for (const id of presentIds) {
    if (id === "char_player") continue;
    for (const h of state.habits?.[id] ?? []) {
      if (h.dormant || !(h.held ?? 0)) continue;
      if (habitPower(h) < COMPULSION_AT) continue;
      // ONLY ABOUT THE TURN JUST GONE. `held` is a running count and never clears on its own, so
      // without this a character who missed once and then left the scene for a week comes back
      // carrying a correction about a turn nobody remembers. A correction is for the next turn or
      // it is noise.
      if (state.world.current_turn - (h.mandated_turn ?? -99) > 1) continue;
      const name = state.characters[id]?.name ?? "They";
      rows.push(`${name}: ${h.trait}`);
    }
  }
  if (!rows.length) return "";
  return `\n[LAST TURN LEFT THESE OUT AND THEY ARE NOT OPTIONAL — ${rows.join(" | ")}. Each one is something the person does as a matter of course, and the previous turn wrote around it. Put it in this turn's prose, plainly, inside something they are already doing. One clause is enough; it does not need a beat of its own and nobody comments on it.]`;
}

/** Loose match between a reported trait string and a stored one. Same job as novelty's private
 *  `sameTrait` — the simulator is asked for verbatim and will sometimes re-case or clip. */
function sameish(a: string, b: string): boolean {
  const norm = (x: string) => String(x ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  return A === B || A.includes(B) || B.includes(A);
}
