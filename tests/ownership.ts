/* Smoke test: WHOSE ROW IS THIS?
 *
 * The bookkeeper writes many characters' fields in one JSON object, bound to a person by nothing but
 * an id. Measured across every save to hand: 176 drives, of which 8 named their own owner.
 *
 *   Mable's row:  "Mable makes Rabi kneel and worship her feet in the cave today, on her terms."
 *   Jess's row:   "…deepening the shared private language with Jess and Jess's and Rabi's and…"
 *
 * Both are the row written from OUTSIDE the person it belongs to. Jess's had also degenerated into a
 * loop, which is what confusion tends to precede.
 *
 * And the engine taught it the format: `seedDrive` had a fallback reading "pursue what matters most
 * to ${c.name} right now", so a card could show a goal in the third person naming its owner, and the
 * model copied what it saw. Two of the eight were ours.
 *
 * The two shapes are not equally safe to touch, which is the whole design here. A leading name is
 * unambiguous and strips to the imperative a goal is supposed to be. A name buried mid-clause could
 * mean several things, so it is never rewritten — only reported, at the point it was written. */
import { ownWant } from "../src/engine/coerce";
import { newSave, registerCharacter } from "../src/engine/state";
import { applyDiff, splitLines } from "../src/engine/turn";
import { seedDrive } from "../src/engine/drives";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. a leading name is repaired into the imperative ───────────────────────── */
{
  const r = ownWant("Mable", "Mable makes Rabi kneel and worship her feet in the cave today, on her terms.");
  check("a goal opening with its owner's name is repaired", r.goal === "makes Rabi kneel and worship her feet in the cave today, on her terms.", r.goal);
  check("and is not reported, because nothing was ambiguous", !r.slipped);

  const p = ownWant("Mable", "Mable's plan is to get the grain in before the frost.");
  check("a possessive lead is repaired too", p.goal.startsWith("plan is to get the grain"), p.goal);
}

/* ── 2. a buried name is reported, never rewritten ───────────────────────────── */
{
  const r = ownWant("Jess", "Continue to nurture the quiet intimacy with Rabi, deepening the shared private language with Jess.");
  check("a goal naming its owner mid-clause is flagged", r.slipped, r);
  check("and left exactly as written — a rewrite would be a guess",
    r.goal === "Continue to nurture the quiet intimacy with Rabi, deepening the shared private language with Jess.", r.goal);
}

/* ── 3. what must not be touched ─────────────────────────────────────────────── */
{
  check("an ordinary goal is untouched",
    ownWant("Clara", "Get Rabi alone in her house this week, on the pretext of the vintage business.").goal
      === "Get Rabi alone in her house this week, on the pretext of the vintage business.");
  check("and not flagged", !ownWant("Clara", "Get Rabi alone in her house this week.").slipped);
  check("naming SOMEONE ELSE is the normal case, not a slip", !ownWant("Clara", "Get Rabi alone this week.").slipped);
  check("a name inside another word does not count", !ownWant("Sam", "Get the samples to the lab before noon.").slipped, ownWant("Sam", "Get the samples to the lab before noon."));
  check("a two-letter name is too short to match on", !ownWant("Jo", "Join the crew going north.").slipped);
  check("nothing stays nothing", ownWant("Jess", "").goal === "" && ownWant("Jess", undefined).goal === "");
}

/* ── 4. the engine no longer writes the shape it is trying to prevent ────────── */
{
  const s = newSave("own", {
    name: "Veridun", difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, { name: "Hewitt", core_traits: ["patient"], background: "A quiet man." } as any);
  s.world.current_turn = 5;
  const seeds = new Set<string>();
  for (let i = 0; i < 60; i++) { const d = seedDrive(s, id, () => i / 60); if (d) seeds.add(d.goal); }
  const naming = [...seeds].filter((g) => /\bHewitt\b/.test(g));
  check("no seeded fallback names its own owner", naming.length === 0, naming);
  check("and the seeder still produces wants", seeds.size > 0, seeds.size);
}

/* ── 5. through the applier, end to end ──────────────────────────────────────── */
function room(): SaveState {
  const s = newSave("own2", {
    name: "CuldeSac", difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Jess", character_id: "char_jess" } as any);
  s.world.current_turn = 47;
  s.world.present = ["char_jess"];
  const pid = "loc_kitchen";
  s.world.places[pid] = { id: pid, name: "the kitchen", description_facts: "A table.", contains: [] } as any;
  s.world.player_location = pid;
  s.characters.char_jess.location = pid;
  return s;
}
{
  const s = room();
  const shifts = applyDiff(s, { drives_update: [{ char_id: "char_jess", goal: "Jess keeps the mornings quiet so he does not leave early.", progress: 0 }] } as any,
    "I get up.", "Jess is at the table when he comes in.");
  check("the applier repairs a leading name", s.characters.char_jess.drive?.goal.startsWith("keeps the mornings quiet"), s.characters.char_jess.drive);
  check("and the shift reports the repaired want, not the raw one",
    shifts.some((x) => /wants something new: keeps the mornings quiet/.test(x)), shifts.filter((x) => /wants something/.test(x)));
}
{
  const s = room();
  const shifts = applyDiff(s, { drives_update: [{ char_id: "char_jess", goal: "Continue the quiet intimacy, deepening the private language with Jess.", progress: 0 }] } as any,
    "I get up.", "Jess is at the table when he comes in.");
  check("a buried name is surfaced to the player", shifts.some((x) => /naming its own owner/.test(x)), shifts);
  check("and the want is still recorded rather than dropped", !!s.characters.char_jess.drive?.goal);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
