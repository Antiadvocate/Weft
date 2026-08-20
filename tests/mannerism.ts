/* Smoke test: THE LAUGH IN EVERY SCENE.
 *
 * From a twenty-turn save. One character's core_traits, straight off the forge:
 *
 *   "Will re-fold a napkin or straighten a picture frame in a restaurant without realizing she's
 *    doing it."
 *   "Has a laugh that starts as a surprised, sharp 'Ha!' before dissolving into silent,
 *    shoulder-shaking giggles."
 *
 * Her habit rows at turn 20:
 *
 *   strength 92  baseline 92  seen_fires 0  last_fired_turn -1  expressions 8  last_expressed 19
 *   strength 97  baseline 97  seen_fires 0  last_fired_turn -1  expressions 9  last_expressed 19
 *
 * Every number in those rows is a symptom. expressions 8 and 9 means the prose rendered them in
 * nearly every scene. last_fired_turn -1 means the habit engine never fired them ONCE, so the
 * recognition path never touched them and strength never moved off its forge value. Two subsystems
 * held the same trait and neither could act on it.
 *
 * WHY. Both were built for SUBJECT traits and a mannerism is not one.
 *   · habits.ts picks a live habit by relevance(trait, beatText) > 0.34 — lexical overlap with what
 *     the player typed. "Loves basketball" fires when a beat mentions a court. A laugh has no
 *     subject to appear in "I come out after drying myself I'm in pjs", scores ~0 forever, and never
 *     gets an opportunity.
 *   · novelty.ts measures the PROSE, so it saw them fine and correctly called them ground — then
 *     applied the subject remedy: "do not write a scene ABOUT these; write a scene that HAPPENS
 *     during them". For a tic that reads as keep doing it, just stop commenting, which is precisely
 *     what nine uncommented laughs in twenty turns looks like.
 *
 * This is not a forge bug. The card spec asks for exactly this — "PHYSICAL SIGNATURE, naming the
 * body and the object" is one of its five right forms, and the could-you-film-it test rewards it.
 * The category is intended; the handling was missing.
 */
import { isMannerism, mannerismGap, mannerismSuppressed, noveltyStage } from "../src/engine/novelty";
import type { CoreHabit } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const habit = (trait: string, expressions: number, last: number): CoreHabit => ({
  trait, strength: 90, baseline: 90, seen_fires: 0, last_fired_turn: -1,
  noticed_watermark: 90, expressions, last_expressed_turn: last,
});

/* ── 1. the two from the save ─────────────────────────────────────────────────── */
{
  check("the laugh is a manner",
    isMannerism("Has a laugh that starts as a surprised, sharp 'Ha!' before dissolving into silent, shoulder-shaking giggles."));
  check("straightening the picture frame is a manner",
    isMannerism("Will re-fold a napkin or straighten a picture frame in a restaurant without realizing she's doing it."));
  check("turning an object over in his hands is a manner",
    isMannerism("When he's thinking hard, he'll pick up the nearest object—a pen, a coaster, a lemon—and turn it over and over in his hands."));
}

/* ── 2. and the dispositions on the same cards, which must NOT be caught ──────────
 *
 * This is the half that matters. A classifier that swept up subject traits would stop a character
 * caring about anything on a cadence, which is a far worse failure than a repeated laugh. */
{
  check("a half-told story is a subject",
    !isMannerism("Cannot stand a half-told story; will gently but relentlessly ask questions until he has the whole picture."));
  check("showing love through action is a subject",
    !isMannerism("Shows love through action: fixing a sticky door, making coffee exactly the way you like it, remembering the name of your third-grade teacher."));
  check("wit turning surgical under pressure is a subject",
    !isMannerism("When she feels cornered or insecure, her wit turns from playful to surgical, and she can cut someone down with a single, precise sentence."));
}

/* ── 3. the forge spec's own examples, sorted into the right bins ─────────────── */
{
  check("PHYSICAL SIGNATURE: the two-handed grip", isMannerism("Holds everything — cup, knife, child — in the same two-handed grip."));
  check("PHYSICAL SIGNATURE: counting under her breath", isMannerism("Counts under her breath when she is waiting: steps, coins, sheep."));
  check("AFFINITY is not a mannerism", !isMannerism("Goes to the water when anything goes wrong, and only then."));
  check("AVERSION is not a mannerism", !isMannerism("Will not eat anything from fresh water, and cannot say why."));
  check("UNEARNED APTITUDE is not a mannerism", !isMannerism("Mimics any accent she hears within a day, badly at first, then perfectly."));
}

/* ── 4. the frequency budget: a widening gap, not a ban ───────────────────────── */
{
  const laugh = "has a laugh that starts as a sharp Ha";
  check("a tic nobody has seen yet is free", mannerismGap(habit(laugh, 1, 5)) === 0);
  check("a familiar tic rests three turns", mannerismGap(habit(laugh, 3, 5)) === 3);
  check("a worn tic rests six", mannerismGap(habit(laugh, 9, 5)) === 6);
  // the save's exact state: nine expressions, on the page last turn
  check("the Ashford laugh is suppressed at turn 20", mannerismSuppressed(habit(laugh, 9, 19), 20));
  check("...and comes back once the gap has passed", !mannerismSuppressed(habit(laugh, 9, 13), 20));
  check("a first-time tic is never suppressed", !mannerismSuppressed(habit(laugh, 1, 19), 20));
  check("a dormant one is left alone", !mannerismSuppressed({ ...habit(laugh, 9, 19), dormant: true }, 20));
}

/* ── 5. subject traits keep the OLD treatment and are never rate-limited ──────── */
{
  const story = habit("Cannot stand a half-told story; will ask questions until he has the whole picture.", 9, 19);
  check("a subject trait is never frequency-suppressed", !mannerismSuppressed(story, 20));
  check("...it is still ground, and still gets the commentary rule", noveltyStage(story) === "ground");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
