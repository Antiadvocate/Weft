/* Smoke test: THE PLAYER SAYS WHERE THEY ARE GOING AND THE ENGINE TAKES THEM THERE.
 *
 * Turn 49 of a save. The action: "K. I go workout. And shower. And then head to Clara's." The prose
 * walks him out the front door, down the street, and up to Clara standing on her porch. Turn 50: he
 * is in the kitchen with Jess.
 *
 * THE EXTRACTORS WERE WRITTEN FOR A NARRATION NOBODY USES. Player movement matched only
 * "you walk into <Place>", and inventory only "you take the <thing>" — second person. Across
 * twenty-five saves in hand, every single one is narrated in the THIRD person: "He walked out the
 * front door into the mist." So the player's own movement and every hand-off had been silently
 * unextractable for the entire life of those stories.
 *
 * THE ACTION DROPS ITS SUBJECT. "And then head to Clara's" is where the destination is actually
 * named, and it has no "I" in front of it — so even a fixed subject-anchored pattern reads the line
 * as nothing.
 *
 * AND THE FOOTER THREW AWAY WHAT WAS LEFT. `findChar` deliberately never resolves the player, so a
 * footer reading "left: Rabi" matches nobody and is dropped — while `place`, which is where the
 * scene HAPPENED, overwrote the destination. When the footer says the player left, place is the
 * origin, and anything that found a destination outranks it. */
import { newSave, registerCharacter } from "../src/engine/state";
import { extractHeuristics, DEPART_IN_PROSE } from "../src/engine/extract";
import { resolvePlace } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function culdesac(): SaveState {
  const s = newSave("moves", {
    name: "CuldeSac of the Heart",
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him" } as any);
  registerCharacter(s, { name: "Jess", character_id: "char_jess", pronouns: "she/her" } as any);
  registerCharacter(s, { name: "Clara", character_id: "char_clara", pronouns: "she/her" } as any);
  for (const [id, name] of [["loc_home", "Rabi and Jess's House"], ["loc_clara", "Clara's House"], ["loc_cds", "The Cul-de-Sac"]] as const) {
    s.world.places[id] = { id, name, description_facts: "", contains: [] } as any;
  }
  s.world.player_location = "loc_home";
  s.characters.char_player.location = "loc_home";
  s.characters.char_jess.location = "loc_home";
  s.characters.char_clara.location = "loc_clara";
  s.world.present = ["char_jess"];
  s.world.current_turn = 49;
  return s;
}

const ACTION = `"K" I go workout. And shower. And then head to Clara's.`;
const PROSE = "He moved through the house, the floorboards familiar under his feet. He walked out the front door into the mist. "
  + "He began his run toward the cul-de-sac, his breath visible in the grey light. Clara was standing on her porch.";

/* ── 1. the destination is found, from the line that actually names it ───────── */
{
  const s = culdesac();
  const h = extractHeuristics(s, ACTION, PROSE);
  check("the player's stated destination is extracted", h.player_location === "Clara's", h.player_location);
  check("and resolves to the real place",
    s.world.places[resolvePlace(s, h.player_location!, { keepIfUnknown: true })]?.name === "Clara's House");
}
{
  // third-person prose alone, no action cue — the case that was dead for every save on file
  const s = culdesac();
  const h = extractHeuristics(s, "I keep running.", "Rabi walked into The Cul-de-Sac and stopped at the kerb.");
  check("third-person prose moves the player", h.player_location === "The Cul-de-Sac", h.player_location);
}
{
  const s = culdesac();
  const h = extractHeuristics(s, "I keep going.", "He headed into The Cul-de-Sac without slowing.");
  check("so does a bare pronoun, when nobody else in the room shares it", h.player_location === "The Cul-de-Sac", h.player_location);
}
{
  // …and NOT when someone present shares that pronoun: putting the player in the wrong room is
  // worse than not moving them
  const s = culdesac();
  registerCharacter(s, { name: "Marcus", character_id: "char_marcus", pronouns: "he/him" } as any);
  s.world.present = ["char_jess", "char_marcus"];
  const h = extractHeuristics(s, "I wait.", "He headed into The Cul-de-Sac without slowing.");
  check("an ambiguous 'he' moves nobody", h.player_location === undefined, h.player_location);
}
{
  const s = culdesac();
  const h = extractHeuristics(s, "Jess heads to Clara's while I stay put.", "She left through the side door.");
  check("somebody else's movement is not the player's", h.player_location === undefined, h.player_location);
}
{
  const s = culdesac();
  check("an action with no destination moves nobody",
    extractHeuristics(s, "I make her eggs and toast.", "He cracked two eggs into the pan.").player_location === undefined);
}

/* ── 2. inventory, the other second-person-only family ───────────────────────── */
{
  const s = culdesac();
  const h = extractHeuristics(s, "I pick it up.", "Rabi picked up the brass key, turning it once before pocketing it.");
  check("a third-person hand-off is recorded",
    (h.facts ?? []).some((f) => f.field === "inventory_add" && /brass key/.test(f.value)), h.facts);
}

/* ── 3. departure, which could never be true of the player ──────────────────── */
{
  check("the prose depicts him leaving", /walked out the front door/.test(PROSE));
  check("but it never names him", !/\bRabi\b/.test(PROSE));
  // DEPART_IN_PROSE matches on the NAME, so for a player the prose never names it is always false.
  // Left as is on purpose: it guards character_exits (dead/departed — leaving the STORY), which the
  // player cannot do, and loosening it to pronouns would let a stray "he left" kill somebody off.
  check("so the name-based departure test cannot fire for him", !DEPART_IN_PROSE(PROSE, "Rabi"));
  check("which is why the destination path is what moves him", extractHeuristics(culdesac(), ACTION, PROSE).player_location === "Clara's");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
