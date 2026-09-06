/* Smoke test: THE FIRST MOVE FAILED, AND THERE WAS NOWHERE TO PUT WHAT COMES NEXT.
 *
 * `under_threat` is one static sentence, so every character in the engine had one threat and one
 * response to it for the length of a story. The owner's account of the character it broke:
 *
 *   "Charming does not constantly insult... manipulative people will turn on their heel immediately
 *    because their goal is to dominate somebody. It doesn't really matter what they personally
 *    think — the moment the goal is being lost is the moment her character is failing."
 *
 * She was written with every dark triad trait and a conscience of 0.18, and her card said "turns
 * icy, speaks in short vicious truths." She was handed that on all twenty turns she spent
 * frightened, and did it on all twenty while the thing she wanted walked out of the building. She
 * did not fail to switch. There was no field to switch INTO.
 *
 * So `when_that_fails` — and it renders only once the first move is visibly not working, because
 * that is when a person finds out. A stubborn character's honest answer is the same thing harder,
 * which is why the field says which and never assumes the bend. */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest, FORGE_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIRST = "Turns icy and speaks in short vicious truths aimed at what the other person is worst about.";
const THEN = "Drops the cold act inside a sentence and goes warm and apologetic, the wounded one asking what she did wrong.";

function world(opts: { stressed?: boolean; stalledFor?: number; swing?: number; when?: string } = {}): SaveState {
  const s = newSave("heel", { name: "Elm Street", era: "contemporary" } as any);
  s.world.places["loc_hall"] = { id: "loc_hall", name: "The hallway", description_facts: "Bad tube light.", contains: [] } as any;
  s.world.player_location = "loc_hall";
  registerCharacter(s, { name: "Max", character_id: "char_player", pronouns: "he/him", age: 39,
    appearance_facts: "Glasses.", core_traits: ["quiet"], values: ["privacy"] } as any);
  const id = registerCharacter(s, { name: "Abigail", pronouns: "she/her", age: 18,
    appearance_facts: "Barefoot.", core_traits: ["Weaponizes charm"], values: ["leverage"], conscience: 0.18,
    attachment: { style: "avoidant", under_threat: FIRST, ...(opts.when ? { when_that_fails: opts.when } : {}) } } as any);
  s.characters[id].location = "loc_hall";
  s.characters["char_player"].location = "loc_hall";
  s.world.present = [id];
  s.world.current_turn = 29;
  s.condition[id].psyche.relaxation = opts.stressed === false ? 2 : -8;
  if (opts.stalledFor !== undefined) {
    s.characters[id].drive = { goal: "make him let her into the car", progress: 1, priority: 1,
      updated_turn: 29, progress_turn: 29 - opts.stalledFor } as any;
  }
  if (opts.swing !== undefined) {
    s.world.edges.push({ from: id, to: "char_player", warmth: -27, trust: -29, power: 0,
      swing: { since_turn: 24, warmth: opts.swing, trust: opts.swing } } as any);
  }
  return s;
}
const seeing = (s: SaveState) => volatileDigest(s, "she refuses to get in the car");

/* ── 1. the want has not moved, so she finds out ─────────────────────────────── */
{
  const out = seeing(world({ stalledFor: 4, when: THEN }));
  check("the reflex still renders", out.includes(FIRST), "missing first move");
  check("AND WHAT SHE DOES WHEN IT IS NOT WORKING", out.includes(THEN), "missing the switch");
  check("...introduced as the first move failing, not as a second mood", /it is not working/.test(out));
}

/* ── 2. the bond falling away counts too ─────────────────────────────────────── */
{
  // her real edge swing was warmth -8, trust -11 over five turns: the ground going under her
  const out = seeing(world({ swing: -6, when: THEN }));
  check("losing the person counts as the first move failing", out.includes(THEN), "swing did not trigger it");
  const mild = seeing(world({ swing: -1, when: THEN }));
  check("...but an ordinary bad turn does not", !mild.includes(THEN), "fired on noise");
}

/* ── 3. it is not a second personality that shows up whenever she is upset ───── */
{
  const fresh = seeing(world({ stalledFor: 0, swing: -1, when: THEN }));
  check("frightened but still getting somewhere: the reflex only", fresh.includes(FIRST) && !fresh.includes(THEN), "fired too early");
  const calm = seeing(world({ stressed: false, stalledFor: 9, swing: -9, when: THEN }));
  check("and neither half renders when she is not under threat at all",
    !calm.includes(FIRST) && !calm.includes(THEN), "stress gate leaked");
}

/* ── 4. a card that does not carry it says nothing new ───────────────────────── */
{
  const old = seeing(world({ stalledFor: 6, swing: -9 }));
  check("an older save is unchanged", old.includes(FIRST) && !/it is not working/.test(old), "invented a switch");
}

/* ── 5. the forge is told to write it, and told not to disarm a charmer ──────── */
{
  check("the forge asks for when_that_fails", /when_that_fails/.test(FORGE_SYSTEM));
  check("...and says stubbornness is a real answer to it", /same thing harder/.test(FORGE_SYSTEM));
  check("...and that one response forever is rigidity, not a person",
    /rigidity is a fact about a particular person/.test(FORGE_SYSTEM));
  // never_says had taken please/sorry/I feel off a manipulator — the three things she works with
  check("never_says is about what they cannot produce, not warmth they deploy",
    /never warmth they might DEPLOY/.test(FORGE_SYSTEM), "never_says guidance missing");
  check("...named with the failure it caused", /comes out of it a plain bully/.test(FORGE_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
