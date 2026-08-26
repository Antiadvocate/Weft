/* Smoke test: THE HABIT ENGINE, which had no test and did not work.
 *
 * Core traits as firing physics — a pattern loosens a little each time its owner catches it
 * happening and deepens when it runs blind. It is the engine's slowest channel and the one that
 * carries change that nobody chose. It was flag-gated off, and simulated with the flag ON, over 200
 * turns, with beats written so the behaviour was unmistakably happening, it produced:
 *
 *   SETTLED  0 fires   NEUTRAL  0 fires   CLENCHED  0 fires
 *
 * The opportunity gate was a cosine similarity that a well-written behavioural trait can never clear
 * (0.30 against a beat that IS the behaviour; 0.16 against a real turn of prose; the bar is 0.34).
 * The only trait shape that could fire was the two-word adjective this engine has a whole module
 * devoted to forbidding. See the long note in habits.ts.
 *
 * Most of what follows is the long simulation, because a probabilistic subsystem that runs every
 * turn for the life of a save cannot be checked by asserting on one call.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import {
  tickHabits, ensureHabits, formHabit, regrooveHabits, dissolveWornHabits, absorbContradiction,
  habitVerdicts, recognitionProbability, seenProbability, intensityProbability, unpromptedRate,
} from "../src/engine/habits";
import { DEFAULT_MODELS } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const TRAITS = [
  "Answers a question with a joke first and the real answer only if you wait her out",
  "Will not let a check be split evenly; recalculates everyone's share to the cent, out loud",
  "Spots people's injuries on sight and says so unasked",
];
const BEATS = [
  "she asked him a question about the money and he made a joke about it first",
  "the check came and everyone reached for their share of the bill",
  "they walked to the car in the rain and nobody said anything at all",
  "Dana traced the parcel line with the eraser end of a pencil and the air conditioning rattled",
];

function world(relax = 0) {
  const s: any = newSave("t", { name: "Vin" } as any);
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Amber", character_id: "char_a", core_traits: TRAITS } as any);
  registerCharacter(s, { name: "Leo", character_id: "char_l", core_traits: ["Listens more than he speaks"] } as any);
  s.world.present = ["char_player", "char_a", "char_l"];
  s.world.edges.push({ from: "char_l", to: "char_a", warmth: 40, trust: 30 });
  s.condition["char_a"].psyche.relaxation = relax;
  s.condition["char_a"].psyche.capacity = relax;
  ensureHabits(s, "char_a"); ensureHabits(s, "char_l");
  return s;
}

/** A reproducible run. Returns what actually happened over `turns`. */
function simulate(relax: number, salience: number, turns = 200, seedN = 12345) {
  let seed = seedN;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const s = world(relax);
  let fires = 0, seen = 0, notices = 0;
  for (let t = 1; t <= turns; t++) {
    s.world.current_turn = t;
    const r = tickHabits(s, ["char_a", "char_l"], BEATS[t % BEATS.length], salience, rng);
    fires += r.fires.length; seen += r.fires.filter((f: any) => f.seen).length; notices += r.shifts.length;
    regrooveHabits(s);
  }
  const hs = s.habits["char_a"];
  const loosened = hs.filter((h: any) => h.strength <= h.baseline - 15).length;
  const deepened = hs.filter((h: any) => h.strength >= h.baseline + 2).length;
  return { fires, seen, notices, loosened, deepened, habits: hs, state: s };
}

/* ── 1. it runs at all, which is the entire point ───────────────────────────── */
{
  const r = simulate(0, 3);
  check("a well-written behavioural trait can now fire", r.fires > 0, r.fires);
  check("...and it is not firing every single beat either", r.fires < 200 * 0.8, r.fires);
}

/* ── 2. the two roads, measured rather than asserted ────────────────────────── */
{
  const settled = simulate(4, 3);
  const blind = simulate(-7, 3);          // clenched, nothing loud happening
  const loud = simulate(-7, 9);           // clenched, at full volume

  check("a settled body has slack: its patterns mostly do not have to run",
    settled.fires < blind.fires / 2, { settled: settled.fires, clenched: blind.fires });
  check("...and sees nearly everything it does do",
    settled.seen / Math.max(1, settled.fires) > 0.75, settled.seen / settled.fires);

  check("a clenched body runs its patterns constantly", blind.fires > 60, blind.fires);
  check("...and is nearly blind to them", blind.seen / Math.max(1, blind.fires) < 0.2, blind.seen / blind.fires);
  check("...so they groove DEEPER than they started — the chain of delusion",
    blind.deepened >= 1, blind.habits.map((h: any) => `${h.strength}/${h.baseline}`));

  // THE SECOND ROAD. The most change in the whole table happens to the most clenched character, when
  // what is arising is loud enough that it cannot be looked past. This is the claim PHILOSOPHY.md
  // makes and the engine could not previously demonstrate.
  check("the same body at full volume sees far more than in quiet",
    loud.seen > blind.seen * 1.5, { quiet: blind.seen, loud: loud.seen });
  check("...and that is where the real loosening happens",
    loud.loosened > settled.loosened && loud.loosened >= 1,
    { settled: settled.loosened, quiet: blind.loosened, loud: loud.loosened });
  check("...and somebody else is the one who notices", loud.notices >= 1, loud.notices);
}

/* ── 3. the probabilities the roads are built on ────────────────────────────── */
check("the calm road is clear when settled", seenProbability(4) > 0.9);
check("...and nearly blind when clenched", seenProbability(-7) < 0.02);
check("the second road is silent in an ordinary moment", intensityProbability(-7, 3) < 0.06);
check("...and opens at full volume in a gripped body", intensityProbability(-7, 9) > 0.15);
check("...and never opens for a settled body, which does not need it", intensityProbability(4, 9) < 0.06);
check("seeing is never impossible at any state", recognitionProbability(-10, 1) > 0);
check("grip drives automaticity", unpromptedRate(-7) > unpromptedRate(4) * 4, [unpromptedRate(-7), unpromptedRate(4)]);

/* ── 4. what the narrator receives ──────────────────────────────────────────── */
{
  const s = world(0);
  const v = habitVerdicts([{ char_id: "char_a", trait: TRAITS[0], seen: true }], s);
  check("the verdict is the concrete behaviour, verbatim", v.includes(TRAITS[0]));
  check("no number, no lexicon, ever", !/strength|groove|probabilit|habit engine|\b\d{2}\b/i.test(v), v);
  check("seen/unseen stays engine-side", !/\bseen\b|\bunseen\b/i.test(v));
  check("and the character may not notice themselves doing it", /Do NOT have them notice/.test(v));
  // A scene of four people each doing their signature thing is a scene made of tics.
  const many = habitVerdicts([
    { char_id: "char_a", trait: "a", seen: false }, { char_id: "char_l", trait: "b", seen: false },
  ], s);
  check("more than one person may still act in a beat", many.split("\n").filter((l) => l.includes(":")).length >= 2);
}

/* ── 5. what the story lays down becomes automatic too ──────────────────────── */
{
  const s = world(0);
  const before = s.habits["char_a"].length;
  check("a trait the story earned enters as a habit", formHabit(s, "char_a", "flinches when a door closes hard"));
  check("...and the list grew", s.habits["char_a"].length === before + 1);
  const made = s.habits["char_a"].find((h: any) => /flinches/.test(h.trait));
  const forged = s.habits["char_a"].find((h: any) => h.trait === TRAITS[0]);
  check("...as drywall, not as the wall a forged trait is", made.strength < forged.strength - 20, { made: made.strength, forged: forged.strength });
  check("...and is not added twice", formHabit(s, "char_a", "flinches when a door closes hard") === false);
  // relapse
  made.dormant = true; made.strength = 4;
  formHabit(s, "char_a", "flinches when a door closes hard");
  check("a dormant pattern the story re-establishes comes back", !made.dormant && made.strength > 30, made.strength);
}

/* ── 6. a contradiction feeds the arc instead of skipping it ────────────────── */
{
  const s = world(0);
  s.characters["char_a"].core_traits = ["cold and guarded with everyone"];
  s.habits["char_a"] = []; ensureHabits(s, "char_a");
  const before = s.habits["char_a"][0].strength;
  const hit = absorbContradiction(s, "char_a", "openly warm toward him", 9);
  check("planting the opposite of a standing pattern is absorbed, not planted", hit !== null, hit);
  check("...as a seen fire against it, so one scene cannot reverse a person",
    s.habits["char_a"][0].strength < before && s.habits["char_a"][0].strength > before - 15,
    { before, after: s.habits["char_a"][0].strength });
}

/* ── 7. dissolution is an absence, never an improvement ─────────────────────── */
{
  const s = world(0);
  s.habits["char_a"][0].strength = 12;
  const out = dissolveWornHabits(s, "char_a", 40);
  check("a worn-through pattern goes dormant", s.habits["char_a"][0].dormant, out);
  check("...and leaves the live trait list", !s.characters["char_a"].core_traits.includes(TRAITS[0]));
  check("...but is kept, because extinction is inhibition and not erasure", s.habits["char_a"].some((h: any) => h.trait === TRAITS[0]));
  const text = `${out.join(" ")} ${s.characters["char_a"].life_history}`;
  check("...and nothing anywhere calls it growth",
    !/better|good|worse|growth|grow|improv|heal|soften|kinder|wiser|redeem|progress/i.test(text), text);
}

/* ── 8. on by default ───────────────────────────────────────────────────────── */
{
  check("a new save has the engine running", DEFAULT_MODELS.habit_engine === true);
  const old: any = newSave("t", { name: "V" } as any);
  registerCharacter(old, { name: "Amber", character_id: "char_a", core_traits: TRAITS } as any);
  check("a save that predates the default gets habits from its traits", (old.habits?.["char_a"] ?? []).length === TRAITS.length,
    old.habits?.["char_a"]?.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
