/* Smoke test: A WANT THE PLAYER WROTE IS NOT A THING BOTH CHARACTERS ALREADY AGREED.
 *
 * "The character when I add stuff, says I know about it. As if the narrator knows I entered the
 *  godhead but it shouldn't be. It's their desire."
 *
 * He had authored, on her card: "Convince Max that her feet and her cock are actually God and need
 * his dedicated lifetime of service." What came back, at turn 33:
 *
 *   "I know you've thought about it. I know what I am to you, Max. The Godhead."
 *
 * She is asserting the belief is already held — while the drive's own progress meter reads 0.7 out
 * of 100. The want and the world had agreed on nothing.
 *
 * `drive` has carried the guard for a long time, one line below the goal, on the door: "this is
 * what they DO about it — they do not state the want itself". `authored` never got it. So the one
 * kind of want a person sits down and writes by hand was the one handed to the narrator raw, and
 * "simply does this now, without deciding to" — which is about the BEHAVIOUR being automatic — read
 * on a persuasion goal as the persuasion having already worked.
 *
 * The drive's own guard also only existed when an approach existed, so a want with neither an
 * approach nor a voice to fall back on printed with nothing saying it was unspoken. */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const AUTHORED = "Convince Max that her feet are actually God and need his dedicated lifetime of service.";
function world(opts: { authored?: boolean; crystallised?: boolean; drive?: boolean; approach?: string } = {}): SaveState {
  const s = newSave("want", { name: "Hale Tower", era: "contemporary" } as any);
  s.world.places["loc_pent"] = { id: "loc_pent", name: "Penthouse 28A", description_facts: "River glass.", contains: [] } as any;
  s.world.player_location = "loc_pent";
  registerCharacter(s, { name: "Max", character_id: "char_player", pronouns: "he/him", age: 39,
    appearance_facts: "Runner's build.", core_traits: ["orderly"], values: ["order"] } as any);
  const id = registerCharacter(s, { name: "Emily", pronouns: "she/her", age: 18,
    appearance_facts: "Bare feet.", core_traits: ["waits"], values: ["being looked at"],
    ...(opts.drive ? { drive: { goal: "Make Max say aloud what he wants", progress: 0.7, priority: 1,
      updated_turn: 33, progress_turn: 33, ...(opts.approach ? { approach: opts.approach } : {}) } } : {}),
    ...(opts.authored ? { authored: [{ goal: AUTHORED, rate: "steady", stage: opts.crystallised ? 5 : 2,
      acted: 0, turns_live: 4, inhabit_turns: 4, crystallize: true, added_turn: 1,
      ...(opts.crystallised ? { crystallized_turn: 4 } : {}), label: AUTHORED.slice(0, 60) }] } : {}),
  } as any);
  s.characters[id].location = "loc_pent";
  s.characters["char_player"].location = "loc_pent";
  s.world.present = [id];
  s.world.current_turn = 34;
  return s;
}
const NOTE = /A WANT IS NOT A SHARED FACT/;

/* ── 1. a crystallised authored want — the case from the save ────────────────── */
{
  const d = volatileDigest(world({ authored: true, crystallised: true }), "on the couch");
  check("the want still renders", /simply does this now/.test(d), "authored want disappeared");
  check("AND IT IS MARKED AS UNSHARED", NOTE.test(d), "a hand-written want is still handed over raw");
  check("...saying nobody else has agreed to it", /agreed to it, or already believes it/.test(d));
  check("...and that a want to convince means they are not convinced",
    /means they are not convinced/.test(d), "the persuasion case is not covered");
  check("...and that it is not said out loud", /does not say it out loud/.test(d));
}

/* ── 2. a want still forming gets it too ─────────────────────────────────────── */
{
  const d = volatileDigest(world({ authored: true, crystallised: false }), "on the couch");
  check("a want still forming is marked the same way", NOTE.test(d));
}

/* ── 3. the drive's own hole: a want with no approach ────────────────────────── */
{
  const withDoor = volatileDigest(world({ drive: true, approach: "makes him ask for it first" }), "on the couch");
  check("a drive with an approach keeps its old guard", /they do not state the want itself/.test(withDoor));
  const noDoor = volatileDigest(world({ drive: true }), "on the couch");
  check("AND A DRIVE WITH NO APPROACH IS NO LONGER BARE", NOTE.test(noDoor),
    "the guard only existed on the door line");
}

/* ── 4. said once, not once per want ─────────────────────────────────────────── */
{
  const s = world({ authored: true, crystallised: true, drive: true, approach: "waits him out" });
  const id = Object.keys(s.characters).find((k) => k !== "char_player")!;
  (s.characters[id] as any).authored.push({ goal: "Make him say it in his own words.", rate: "steady",
    stage: 5, acted: 0, turns_live: 4, inhabit_turns: 4, crystallize: true, added_turn: 1,
    crystallized_turn: 4, label: "Make him say it" });
  const d = volatileDigest(s, "on the couch");
  check("three wants on one card do not print three copies of the rule",
    (d.match(new RegExp(NOTE.source, "g")) ?? []).length === 1,
    (d.match(new RegExp(NOTE.source, "g")) ?? []).length);
}

/* ── 5. and a character with no wants is not told about wants ────────────────── */
{
  const d = volatileDigest(world(), "on the couch");
  check("nothing is added to somebody who wants nothing", !NOTE.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
