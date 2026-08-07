/* Smoke test: CORE TRAITS ARE BINDING BEHAVIOUR, AND THE PLAYER HAS THEM TOO.
 *
 * A player wrote this as their character's first core trait:
 *
 *   "Cannot refuse any direct request from a woman whose bare feet he sees — his body moves
 *    before his mind can object."
 *
 * It reached the narrator exactly once, buried in a 34,000-character cached prefix that is
 * re-anchored every six turns, and never again on any turn where it might have mattered. Every
 * NPC in the same scene got their traits restated in the volatile per-turn block, on the line
 * immediately above their mood and their wants. The player got one truncated sentence of
 * background and nothing else. It read as being ignored because it effectively was. */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest, narratorSystem } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PLAYER_TRAIT = "Cannot refuse any direct request from a woman whose bare feet he sees—his body moves before his mind can object.";

function world(): SaveState {
  const s = newSave("traits", { name: "Veridun", era: "medieval" } as any);
  s.world.places["loc_cave"] = { id: "loc_cave", name: "The cave", description_facts: "Cold stone.", contains: [] };
  s.world.player_location = "loc_cave";
  registerCharacter(s, {
    name: "Rabi", character_id: "char_player", pronouns: "he/him", age: 30,
    appearance_facts: "Lean build. Dark brown hair.",
    background: "Rabi is from another land, he used to be an electrical engineer. He's adhd and socially awkward.",
    core_traits: [PLAYER_TRAIT, "obsessed with beautiful womens feet.", "exceptionally socially awkward at times"],
    values: ["Freedom—he never wants to be caged again.", "Knowledge", "Kindness"],
  } as any);
  const m = registerCharacter(s, {
    name: "Mable", pronouns: "she/her", age: 28, appearance_facts: "Red braid. Barefoot.",
    core_traits: ["Devoted", "Perceptive", "enjoys being worshipped by rabi"],
    values: ["being treated as a person, not a problem", "her feet being worshipped"],
  } as any);
  s.characters[m].location = "loc_cave";
  s.characters["char_player"].location = "loc_cave";
  s.world.present = [m];
  s.world.current_turn = 25;
  return s;
}

/* 1. the per-turn block carries both cards' traits */
{
  const d = volatileDigest(world());
  check("the NPC's traits are in the volatile block", /Devoted; Perceptive/.test(d), d.match(/as: .*/)?.[0]);
  check("the player's traits are too", d.includes(PLAYER_TRAIT), d.match(/built like this.*/)?.[0]?.slice(0, 120));
  check("the player's values come with them", /Freedom/.test(d));
  check("and it is framed as the body, not their choices",
    /built like this — render it in the body and the involuntary, never in their choices/.test(d), d.match(/built like this[^\n]*/)?.[0]?.slice(0, 90));
  check("the NPC framing is unchanged", /\n {2}as: Devoted/.test(d), d.match(/ {2}as: [^\n]*/)?.[0]);
}

/* 2. a character with no traits does not produce an empty line */
{
  const s = world();
  s.characters["char_player"].core_traits = [];
  const d = volatileDigest(s);
  check("no traits, no line", !/built like this/.test(d));
  check("the rest of the player's block survives", /\(PLAYER\)/.test(d));
}

/* 3. and the narrator is told what a trait is FOR */
{
  // BOTH contracts. The lean one is what most turns actually run on — the full contract is only
  // re-sent on an I-frame, so a rule that lives only there is a rule that applies every sixth turn.
  for (const [label, P] of [["full", narratorSystem(false)], ["lean", narratorSystem(true)]] as [string, string][]) {
    check(`${label}: traits are declared binding`, /CORE TRAITS ARE BINDING BEHAVIOUR/.test(P));
    check(`${label}: a trait bearing on the scene has to show`, /if a trait bears on (?:what is happening in )?this scene,? it SHOWS/i.test(P));
    check(`${label}: the trait outranks convenience`, /where a trait and the scene's convenience disagree,? the trait wins/i.test(P));
    check(`${label}: the player's agency is protected`, /never their decisions/i.test(P));
    check(`${label}: it points at the lines the digest actually emits`, /"as:"/.test(P) && /"built like this"/.test(P));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
