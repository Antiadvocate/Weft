/* Smoke test: HABIT POWER — the figure meaning what it reads as.
 *
 * The drawer printed 95 and the engine fired the pattern in about one scene in twenty, because the
 * roll was `unpromptedRate(relaxation) × strength/100` and unpromptedRate in a settled body is 0.05.
 * Both numbers lived in the same save. A player could not plan around either of them.
 *
 * What this checks is the promise, end to end: the figure is the share of eligible occasions; the top
 * of the scale means every scene and the narrator is told so in a register it cannot decline; the
 * bottom of the scale still needs the scene's permission; pushing somebody about a pattern wears it
 * down, slowly at the top and faster once it has started to give; and the drift that moves the figure
 * on its own can carry somebody into the compulsion band but never to the ceiling, because the
 * ceiling is a promise a person makes and not one arithmetic can assemble.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import {
  tickHabits, ensureHabits, regrooveHabits, habitVerdicts, reconcileHabits, heldMandateNote,
  appearanceChance, yieldFactor, applyPress, pressWorth, detectPressure, setHabitPower, drift,
  isCompulsion, ownOccasion, COMPULSION_AT,
} from "../src/engine/habits";
import type { CoreHabit, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const TAP = "Taps his hands on whatever is nearest every time he speaks";
const BILL = "Will not let a check be split evenly; recalculates everyone's share to the cent";
const QUIET = "Keeps his own counsel about money";

function world(relax = 0, traits = [TAP, BILL]): SaveState {
  const s: any = newSave("t", { name: "Vin" } as any);
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Amber", character_id: "char_a", pronouns: "she/her", core_traits: traits } as any);
  s.world.present = ["char_player", "char_a"];
  s.condition["char_a"].psyche.relaxation = relax;
  ensureHabits(s, "char_a");
  return s;
}
function seeded(n = 99991) {
  let seed = n;
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
}
function of(s: SaveState, trait: string): CoreHabit {
  return s.habits!["char_a"].find((h) => h.trait === trait)!;
}

/* ── 1. a trait that says it is not optional arrives that way ───────────────── */
{
  const s = world();
  check("a trait written as a compulsion is forged as one", isCompulsion(of(s, TAP)), of(s, TAP).strength);
  check("...and an ordinary signature behaviour is not", !isCompulsion(of(s, BILL)), of(s, BILL).strength);
  check("...and nothing the forge writes starts at the ceiling", of(s, TAP).strength < 100, of(s, TAP).strength);
}

/* ── 2. the number is the frequency ─────────────────────────────────────────── */
{
  const s = world(4);                                    // settled: the old gate's worst case
  const h = of(s, BILL);
  h.strength = 80;
  check("on-subject, the figure IS the chance", Math.abs(appearanceChance(h, 4, true, false) - 0.8) < 0.001,
    appearanceChance(h, 4, true, false));
  check("...and off-subject a merely-strong pattern still needs the scene",
    appearanceChance(h, 4, false, false) < 0.1, appearanceChance(h, 4, false, false));
  h.strength = 100;
  check("at the ceiling nothing gates it at all — any scene, any body",
    appearanceChance(h, 4, false, false) === 1 && appearanceChance(h, -7, false, false) === 1);
  h.strength = COMPULSION_AT;
  check("the compulsion line is where the ramp starts, not where it finishes", ownOccasion(COMPULSION_AT) === 0);
  check("...and the ramp is done at the top", ownOccasion(100) === 1);
}

/* ── 3. so it actually shows up that often, over a long run ─────────────────── */
{
  const s = world(4);                                    // settled, and the beat is about nothing
  setHabitPower(s, "char_a", TAP, 100);
  const rng = seeded();
  let tapped = 0, billed = 0;
  for (let t = 1; t <= 120; t++) {
    s.world.current_turn = t;
    const r = tickHabits(s, ["char_a"], "they walked to the car in the rain and nobody said anything", 3, rng);
    if (r.fires.some((f) => f.trait === TAP)) tapped++;
    if (r.fires.some((f) => f.trait === BILL)) billed++;
    regrooveHabits(s);
  }
  check("a pattern at 100 is in every single scene", tapped === 120, tapped);
  check("...and the page budget never trims it away", tapped === 120);
  check("...while an ordinary one still waits for its occasion", billed < 25, billed);
}

/* ── 4. what the narrator is handed at the top of the scale ─────────────────── */
{
  const s = world();
  const ceiling = habitVerdicts([{ char_id: "char_a", trait: TAP, seen: false, compelled: true, absolute: true }], s);
  const ordinary = habitVerdicts([{ char_id: "char_a", trait: BILL, seen: false }], s);
  check("the ceiling is stated as law it may not decline", /WITHOUT EXCEPTION/.test(ceiling));
  check("...and the out is refused before the model reaches for it", /tense, crowded or grim/.test(ceiling));
  check("...and an ordinary pattern gets no such line", !/WITHOUT EXCEPTION/.test(ordinary));
  check("still no number and no lexicon anywhere in it",
    !/strength|groove|probabilit|percent|compulsion|\b\d{2}\b/i.test(ceiling), ceiling);
}

/* ── 5. pushing somebody about it ───────────────────────────────────────────── */
{
  const s = world();
  const found = detectPressure(s, ["char_a"], "I tell Amber to stop tapping her hands, again");
  check("a push is read off what the player typed", found.length === 1 && found[0].trait === TAP, found);
  check("...and an ordinary sentence about the same subject is not a push",
    detectPressure(s, ["char_a"], "her hands were tapping on the table").length === 0);
  const other = world(0, [TAP, QUIET]);
  check("...and it is scoped to the person named",
    detectPressure(other, ["char_a"], "I ask Amber to stop tapping").length === 1);
}
{
  const s = world();
  setHabitPower(s, "char_a", TAP, 100);
  const h = of(s, TAP);
  check("inertia at the top eats almost the whole push", yieldFactor(100) < 0.1, yieldFactor(100));
  check("...and lets go entirely once a pattern is ordinary", yieldFactor(50) === 1);
  const first = applyPress(h, 1, false);
  check("a try that was ignored still moves it", first > 0 && first < 1, first);
  // twenty turns of leaning on somebody, none of which the habit ever yields to
  for (let t = 2; t <= 20; t++) applyPress(h, t, false);
  check("...and twenty of them get somewhere", h.strength < 96 && h.strength > 85, h.strength);
  check("...with the streak making the later ones count for more",
    pressWorth(h) > pressWorth({ ...h, pressure_streak: 0 } as CoreHabit), [pressWorth(h), h.pressure_streak]);
}
{
  const s = world();
  const h = of(s, BILL);
  const before = h.strength, baseBefore = h.baseline;
  applyPress(h, 1, true);
  check("a push that LANDS takes the floor down with it, so progress sticks",
    h.baseline < baseBefore && h.strength < before, { baseline: h.baseline, strength: h.strength });
  check("...and is counted where the player can see it", h.pressed_clear === 1);
  // re-groove must not hand it straight back while somebody is still working on it
  s.world.current_turn = 5; h.last_fired_turn = -20;
  const held = h.strength;
  regrooveHabits(s);
  check("...and the drift does not undo it the same week", h.strength === held, h.strength);
}

/* ── 6. what the scene actually did with the order ──────────────────────────── */
{
  const s = world();
  const h = of(s, BILL);
  h.strength = 70; h.mandated_turn = 3; s.world.current_turn = 3;
  reconcileHabits(s, ["char_a"], new Map([["char_a", [BILL]]]), 3, true);
  check("ordered and delivered grooves it a little deeper", h.strength > 70, h.strength);

  const h2 = of(s, TAP);
  h2.strength = 70; h2.mandated_turn = 4;
  reconcileHabits(s, ["char_a"], new Map([["char_a", []]]), 4, true);
  check("ordered and absent wears it down — the extinction trial", h2.strength < 70, h2.strength);
  check("...and the miss is remembered for the next turn", (h2.held ?? 0) === 1);

  h2.strength = 70; h2.mandated_turn = 5; const was = h2.strength;
  reconcileHabits(s, ["char_a"], new Map(), 5, false);
  check("a turn the bookkeeper did not answer for moves nothing at all", h2.strength === was, h2.strength);
}
{
  const s = world();
  setHabitPower(s, "char_a", TAP, 100);
  const h = of(s, TAP); h.held = 1; h.mandated_turn = 7; s.world.current_turn = 8;
  const note = heldMandateNote(s, ["char_a"]);
  check("a ceiling the prose skipped is restated harder next turn", note.includes(TAP) && /NOT OPTIONAL/.test(note));
  check("...and an ordinary miss is not nagged about", !heldMandateNote(world(), ["char_a"]).includes(BILL));
  s.world.current_turn = 20;
  check("...and a miss from a week ago is not brought up at all", heldMandateNote(s, ["char_a"]) === "");
}

/* ── 7. the ceiling is not reachable by drift ───────────────────────────────── */
{
  check("grooving cannot walk a pattern to the top", drift(95, 1) < 100 && drift(95, 50) < 100, drift(95, 50));
  check("...but it can carry one into the compulsion band", drift(90, 3) >= COMPULSION_AT, drift(90, 3));
  check("...and it never drags down a figure already above it", drift(100, 5) === 100);
  // the measured failure: clenched and quiet for 200 turns used to end at a flat 100 across the sheet
  const s = world(-7);
  const rng = seeded(4242);
  for (let t = 1; t <= 200; t++) {
    s.world.current_turn = t;
    tickHabits(s, ["char_a"], "Dana traced the parcel line with the eraser end of a pencil", 3, rng);
    regrooveHabits(s);
  }
  check("...so a clenched body nobody touched does not become three compulsions at the ceiling",
    s.habits!["char_a"].every((h) => h.strength < 100), s.habits!["char_a"].map((h) => Math.round(h.strength)));
}

/* ── 8. the hand on the dial ────────────────────────────────────────────────── */
{
  const s = world();
  const h = setHabitPower(s, "char_a", BILL, 30)!;
  check("setting it by hand sets the figure", Math.round(h.strength) === 30);
  check("...and the floor with it, so the drift has nothing to pull back to", h.baseline === 30);
  check("...and pins it against the drift entirely", h.pinned === true);
  // ...and the drift restores TOWARD the hand-set figure rather than away from it, in both
  // directions: the number the player chose is the number the pattern comes home to.
  h.strength = 12; h.last_fired_turn = -30;
  s.world.current_turn = 10; regrooveHabits(s);
  check("...and the drift brings it home to that figure, not the old one",
    h.strength > 12 && h.strength <= 30, h.strength);
  // and a retired pattern can be brought back by hand
  const dead = of(s, TAP); dead.dormant = true; dead.strength = 4;
  s.characters["char_a"].core_traits = s.characters["char_a"].core_traits.filter((t) => t !== TAP);
  setHabitPower(s, "char_a", TAP, 85);
  check("a loosened pattern can be revived by hand", !dead.dormant && Math.round(dead.strength) === 85);
  check("...and comes back onto the card", s.characters["char_a"].core_traits.includes(TAP));
  check("setting an unknown pattern fails rather than inventing one",
    setHabitPower(s, "char_a", "collects stamps", 50) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
