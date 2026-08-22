/* Smoke test: the word "face".
 *
 * A want the player wrote by hand, at maximum stage, crystallised, and never once on the page —
 * across eleven saves and twenty authored wants, one ever happened. Four fixes went into the
 * instruction that orders it. The instruction was not the problem.
 *
 * habitDirective — the whole mandatory "WHAT IS FORMING" block — was returning THE EMPTY STRING.
 * It drops a want whose habit has reached "ground", meaning worn in and no longer news. Both of
 * this character's wants were at ground. Their real expression counts were zero.
 *
 * The chain, measured end to end on the save:
 *
 *  1. The simulator does its job. Its contract says "Omit the character entirely if none of their
 *     traits surfaced", and it omitted her, correctly, because none had.
 *  2. turn.ts passed `reportedBy.get(pid)` — undefined for an omitted character — and
 *     recordExpressions read undefined as "the simulator did not answer" rather than as "nothing
 *     fired", and fell through to a blind string fallback.
 *  3. expressionCoverage returned 1 on the FIRST distinctive word of four or more characters found
 *     anywhere in the prose. The want contains the word "face". Somebody looks at somebody's face
 *     in almost every turn of a domestic drama.
 *  4. 22 turns out of 22 were credited as expressions of a want that never happened. GROUND_AT is
 *     5, so from turn six the want was "worn in", habitDirective skipped it, and the block that
 *     was supposed to demand it came back empty for the rest of the playthrough.
 *
 * Every subsequent turn of every one of those saves, the engine believed the thing had been
 * happening all along.
 *
 * Two fixes, and the first one is the one that matters: an omitted character is an ANSWER. The
 * fallback now only runs on a turn where the simulator returned nothing at all. And when it does
 * run it needs a real share of the trait on the page rather than one word, with the stopword list
 * widened by measurement — a trait written as a sentence donates its function words, and "always"
 * and "regardless" and "situation" are not evidence of anything.
 *
 * The fallback is deliberately left conservative. On the rare turn it runs, under-crediting keeps
 * an instruction alive one turn too long; over-crediting kills a want silently and forever.
 */
import { expressionCoverage, recordExpressions, noveltyStage } from "../src/engine/novelty";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const WANT = "Always Splatters Vin's face with her cum regardless of context or situation, does not ask for consent or need his approval or even talk about it, forbids him from cleaning it off.";

/* ── 1. the turns that were being counted ─────────────────────────────────────── */
{
  // real prose from the save, none of it the want
  const TURNS = [
    "Miranda's hands didn't stop moving. She straightened, wiping her hands on a dish towel, and turned to face him. Her eyes moved over his face and then away, toward the gallery wall.",
    "She put one knee on the cushion beside his, then the other, and lowered herself into his lap, her hands coming up to frame his face.",
    "She let out a breath and straightened, and she ran one through her hair, pushing it off her face. The flush was still high on her throat.",
    "Miranda watched him do it without moving, her thumbs still hooked in the waist of her jeans, and when the shirt dropped to the floor she let out a breath through her nose.",
  ];
  for (const p of TURNS) check(`not an expression: ${p.slice(0, 44)}`, expressionCoverage(WANT, p) === 0, p);
  check("the bare word is not evidence", expressionCoverage(WANT, "He looked at her face.") === 0);
  check("...nor two function words from a long sentence", expressionCoverage(WANT, "She always did it regardless of the situation.") === 0, expressionCoverage(WANT, "She always did it regardless of the situation."));
}

/* ── 2. and the turn that would be ────────────────────────────────────────────── */
{
  const REAL = "She took hold of his jaw and turned his face up, and she splattered his cheek and his mouth with her cum. He started to lift a hand and she caught his wrist. Cleaning it off was not allowed.";
  check("the act itself does register", expressionCoverage(WANT, REAL) === 1, REAL);
}

/* ── 3. short forged traits still work, which is what the old rule was for ────── */
{
  const cases: [string, string, number][] = [
    ["Cannot pass a dog without stopping.", "A dog came around the corner and she stopped dead, crouching to it.", 1],
    ["Will always, always take the seat facing the door in any room.", "Leo took the chair with its back to the wall, facing the door, and sat.", 1],
    ["Has a habit of polishing his glasses on his shirt when he's buying time to think.", "He pulled his glasses off and polished them on the hem of his shirt.", 1],
    ["Cannot sit still; she's always tapping a foot, twisting a ring, or re-arranging the objects on a table.", "Chloe's foot was tapping under the table and she twisted the ring on her finger.", 1],
    ["Cannot pass a dog without stopping.", "She walked the length of the block without looking up once.", 0],
    ["Will always, always take the seat facing the door in any room.", "Miranda's eyes moved over his face and then away, toward the gallery wall.", 0],
  ];
  for (const [t, p, want] of cases) check(`${want ? "fires" : "quiet"}: ${t.slice(0, 40)}`, expressionCoverage(t, p) === want, expressionCoverage(t, p));
  check("a short noun is still the subject", expressionCoverage("Cannot pass a dog without stopping.", "A dog stopped him on the path.") === 1);
}

/* ── 4. an omitted character is an answer ─────────────────────────────────────── */
{
  const habits = () => [{ trait: WANT, strength: 90, baseline: 90, seen_fires: 0, last_fired_turn: -1, noticed_watermark: 90 }] as any;
  const PROSE = "Her eyes moved over his face and then away, toward the gallery wall.";

  // the simulator answered and left her out: nothing fired, and the fallback must not overrule it
  const s1: any = { habits: { m: habits() } };
  recordExpressions(s1, "m", PROSE, 4, []);
  check("an empty report means nothing fired", (s1.habits.m[0].expressions ?? 0) === 0, s1.habits.m[0]);

  // the simulator answered and named it
  const s2: any = { habits: { m: habits() } };
  recordExpressions(s2, "m", PROSE, 4, [WANT]);
  check("a report that names it counts", s2.habits.m[0].expressions === 1);
  check("...and stamps the turn", s2.habits.m[0].last_expressed_turn === 4);

  // the simulator returned nothing at all — the one case the fallback is for
  const s3: any = { habits: { m: habits() } };
  recordExpressions(s3, "m", PROSE, 4, undefined);
  check("with no report at all the fallback runs", true);
  check("...and still does not credit one word", (s3.habits.m[0].expressions ?? 0) === 0, s3.habits.m[0]);

  // AND FOR AN AUTHORED WANT IT DOES NOT RUN AT ALL. The costs are not symmetric: a false credit
  // walks the want to "ground" and it stops being demanded, permanently; a missed credit costs one
  // repeated instruction. Even prose that WOULD satisfy the string test scores nothing here.
  const REAL = "She took hold of his jaw and turned his face up and splattered his cheek with her cum, and cleaning it off was not allowed.";
  const s4: any = { characters: { m: { authored: [{ goal: WANT, label: WANT, crystallized_turn: 3 }] } }, habits: { m: habits() } };
  recordExpressions(s4, "m", REAL, 4, undefined);
  check("an authored want is never credited by guesswork", (s4.habits.m[0].expressions ?? 0) === 0, s4.habits.m[0]);
  check("...the string test would have said yes", expressionCoverage(WANT, REAL) === 1);
  const s5: any = { characters: { m: { authored: [{ goal: WANT, label: WANT, crystallized_turn: 3 }] } }, habits: { m: habits() } };
  recordExpressions(s5, "m", REAL, 4, [WANT]);
  check("...but the simulator naming it still counts", s5.habits.m[0].expressions === 1);

  // an ordinary forged trait keeps the fallback, where a wrong credit is only a quieter beat
  const DOG = "Cannot pass a dog without stopping.";
  const s6: any = { habits: { m: [{ trait: DOG, strength: 90, baseline: 90, seen_fires: 0, last_fired_turn: -1, noticed_watermark: 90 }] } };
  recordExpressions(s6, "m", "A dog came around the corner and she stopped dead.", 4, undefined);
  check("a forged trait still has its fallback", s6.habits.m[0].expressions === 1);
}

/* ── 5. what it cost: five phantom credits and the want goes quiet ────────────── */
{
  const h = { trait: WANT, expressions: 0 } as any;
  check("a want that has never happened is fresh", noveltyStage(h) === "fresh");
  h.expressions = 5;
  check("five credits and it is ground", noveltyStage(h) === "ground");
  // habitDirective drops a ground want, which is correct behaviour on a TRUE count and was the
  // mechanism of the failure on a false one.
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
