/* Smoke test: AN AUTHORED TRAIT THAT NEVER STOPS BEING THE SUBJECT.
 *
 * "If I make something as a personality trait added via injection it gets used every single time in
 * every single conversation moving forward, so it starts getting repetitive — phrasing it here or
 * there but it's the same thing repeating, because it can't do anything creative with it. It's
 * eating up a lot of reading and it doesn't drive the story forward."
 *
 * Exactly what the code said to do. A crystallised authored want went into habitDirective on every
 * turn the character was present, forever, as:
 *
 *   SIMPLY DOES THIS NOW, without deciding to: <goal>. Not a version of it, not a suggestion of it —
 *   that, the act itself, in this turn's prose. It needs no occasion, no excuse and no build-up...
 *
 * under a header reading NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE and ending "There is no
 * version of this turn in which none of it can be seen." Six hundred characters of mandate per
 * settled trait per turn, at full strength, with no end condition — because there was no state that
 * meant "this has landed."
 *
 * The engine already had one and the two systems were fighting. novelty.ts counts how many times a
 * trait has actually been expressed in the prose and, past the fifth, tells the narrator it is the
 * floor rather than the subject: do not write a scene ABOUT this, write a scene that HAPPENS during
 * it. That guidance cannot survive an absolute order sitting in the same prompt.
 *
 * So the order now hands over. Full force until it has landed twice, a short reminder while it beds
 * in, and once it is worn the novelty note governs alone.
 */
import { habitDirective, crystallize, newAuthored, settledStage, crystallizedLabel } from "../src/engine/authored";
import { ensureHabits } from "../src/engine/habits";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const GOAL = "leaves the door of every room she is in standing open behind her";

function world(): { s: SaveState; id: string } {
  const s = newSave("authored", { name: "Rome" } as any);
  s.world.places["loc_x"] = { id: "loc_x", name: "The Villa", description_facts: "Stone.", contains: [] };
  s.world.player_location = "loc_x";
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him" } as any);
  const id = registerCharacter(s, { name: "Lucilla", pronouns: "she/her" } as any)!;
  s.world.present = ["char_player", id];
  s.world.current_turn = 10;
  s.characters[id].authored = [newAuthored(GOAL, 1)];
  crystallize(s, id, s.characters[id].authored![0], 10);   // it has finished forming
  ensureHabits(s, id);                                      // ...and became a tracked habit
  return { s, id };
}

/** Set how many times the habit has actually been expressed in prose. */
function expressed(s: SaveState, id: string, n: number): void {
  const label = crystallizedLabel(s.characters[id].authored![0]).toLowerCase();
  const h = (s.habits?.[id] ?? []).find((x) => x.trait.toLowerCase() === label);
  if (h) h.expressions = n;
}

/* ── 1. it still lands hard while it is new ──────────────────────────────────── */
{
  const { s, id } = world();
  check("a just-settled want reads as fresh", settledStage(s, id, s.characters[id].authored![0]) === "fresh");
  const d = habitDirective(s, s.world.present);
  check("and is still ordered into the scene", /SIMPLY DOES THIS NOW/.test(d), d.slice(0, 200));
  check("under the mandate that makes it unrefusable", /NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE/.test(d));
  check("naming the act itself", d.includes(GOAL), d.slice(0, 300));
}

/* ── 2. once it has landed a few times it stops being staged ─────────────────── */
{
  const { s, id } = world();
  expressed(s, id, 3);
  check("three expressions in and it is familiar", settledStage(s, id, s.characters[id].authored![0]) === "familiar");
  const d = habitDirective(s, s.world.present);
  check("the mandate is gone", !/SIMPLY DOES THIS NOW/.test(d), d);
  check("it is noted as settled instead", /SETTLED, AND NO LONGER NEWS/.test(d), d);
  check("and the narrator is told not to stage it", /do not stage one/.test(d), d);
  check("still named, so it is not forgotten", d.includes(crystallizedLabel(s.characters[id].authored![0])), d);
}

/* ── 3. worn in, it leaves the directive entirely ────────────────────────────── */
{
  const { s, id } = world();
  expressed(s, id, 6);
  check("six expressions in and it is ground", settledStage(s, id, s.characters[id].authored![0]) === "ground");
  const d = habitDirective(s, s.world.present);
  check("nothing about it is ordered", !/SIMPLY DOES THIS NOW/.test(d), d);
  check("and nothing about it is even mentioned", !d.includes(GOAL), d);
  // novelty.ts governs it from here — "the floor, not the subject" — and that note is built
  // separately and appended to the same prompt.
}

/* ── 4. the saving is real, because this was per turn forever ────────────────── */
{
  const { s, id } = world();
  const fresh = habitDirective(s, s.world.present).length;
  expressed(s, id, 3);
  const familiar = habitDirective(s, s.world.present).length;
  expressed(s, id, 6);
  const ground = habitDirective(s, s.world.present).length;
  check("each stage costs less than the last", familiar < fresh && ground < familiar, [fresh, familiar, ground]);
  check("and the worn one costs a fraction of the mandate", ground < fresh * 0.5, [fresh, ground]);
  console.log(`     (directive length: fresh ${fresh} → familiar ${familiar} → worn ${ground} chars, every turn)`);
}

/* ── 5. a want still FORMING is untouched — the ladder is what makes it arrive ── */
{
  const { s, id } = world();
  s.characters[id].authored = [newAuthored("starts taking the long way home past the barracks", 1)];
  const d = habitDirective(s, s.world.present);
  check("an unfinished want is still driven", d.length > 0 && /NOT OPTIONAL/.test(d), d.slice(0, 120));
}

/* ── 6. and the label survives so the match cannot silently fail ─────────────── */
{
  const { s, id } = world();
  const a = s.characters[id].authored![0];
  check("crystallising records the label it became", !!a.label, a);
  check("which is the core_trait the habit is tracked under",
    (s.characters[id].core_traits ?? []).some((t) => t.toLowerCase() === crystallizedLabel(a).toLowerCase()),
    s.characters[id].core_traits);
  // a save written before the label existed still matches, by recomputing it
  delete (a as any).label;
  check("an older save recomputes it", settledStage(s, id, a) === "fresh", settledStage(s, id, a));
}

/* ── 7. THE ROTATION MUST NOT PUT IT STRAIGHT BACK ────────────────────────────
 *
 * crystallize() writes a finished want into core_traits — correct, it IS one now — and the trait
 * rotation at the bottom of habitDirective orders one core_trait per character per turn to be acted
 * out. So standing the authored mandate down achieved nothing on the turns the wheel came round to
 * the same trait. It picks from what still has something to establish. */
{
  const { s, id } = world();
  expressed(s, id, 6);
  s.characters[id].core_traits = [crystallizedLabel(s.characters[id].authored![0])];
  check("a character whose only trait is worn gets no order at all", habitDirective(s, s.world.present) === "", habitDirective(s, s.world.present));

  // ...but an unworn trait beside it still gets its turn
  s.characters[id].core_traits!.push("counts the coins in her hand twice before she puts them away");
  const d = habitDirective(s, s.world.present);
  check("an unworn trait is still driven", /counts the coins/.test(d), d);
  check("and the worn one is not named beside it", !d.includes(crystallizedLabel(s.characters[id].authored![0])), d);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
