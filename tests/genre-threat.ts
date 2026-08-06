/* Smoke test: A WORLD WITH NO MONSTERS IN IT DOES NOT GET SENT MONSTERS.
 *
 * GENRE-THREAT ESCALATION exists so a survival-horror world cannot let its predator sit offstage
 * for twenty turns. It decided whether a world qualified like this:
 *
 *   lethalWorld = BEASTWORDS.test(what_people_fear)
 *     || pressure_palette.some(p => /predator|threat|attack|hunt|violence|kill/i.test(p))
 *
 * unanchored, so the bare word "threat" was enough — and a pressure palette is BY DEFINITION a list
 * of threats. Every world qualified. A political game about spies, a civil war and a compulsion that
 * could be exploited was classified as a monster world on one clause reading "Rabi's power could be
 * seen as a threat or a tool."
 *
 * Then the directive demanded a predator arrive bodily and menace someone, handing the narrator a
 * fear that named no creature — a heretic god, the Church's fires, cold arithmetic. Told to make
 * THAT walk in and take someone, the only move left is to invent a beast. Hence black mass
 * creatures at intervals in a story with no monsters in it. */
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

/** The classifier as it now stands in turn.ts. */
const BEAST = /\b(predator|beast|creature|monster|dinosaur|raptor|wolf|wolves|bear|shark|swarm|horde|infected|undead|zombie|revenant|wraith|demon|devil|maw|claw|tooth|teeth|fang)s?\b|\b(thing|things) in the\b|\b(eaten alive|devour\w*|maul\w*|being (eaten|devoured|hunted))\b/;
function lethalWorld(s: SaveState): boolean {
  const fear = (s.world_bible.what_people_fear ?? "").toLowerCase();
  const playerName = (s.characters["char_player"]?.name ?? "").toLowerCase();
  const fearIsThePlayer = playerName.length >= 3 && fear.includes(playerName);
  return BEAST.test(fear) && !fearIsThePlayer;
}
function make(fear: string, palette: string[], playerName = "Rabi"): SaveState {
  const s = newSave("gt", { name: "V", what_people_fear: fear, pressure_palette: palette } as any);
  registerCharacter(s, { name: playerName, character_id: "char_player" } as any);
  return s;
}

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. the exact world that was being sent creatures */
{
  const s = make(
    "The heretic god of Thornwood who kills without effort or reason; the Church's fires; and increasingly, the cold arithmetic that neither king nor faith can protect anyone from a man who reshapes reality.",
    ["The king's spies are everywhere", "and Rabi's power could be seen as a threat or a tool.",
     "The kingdom is on the brink of civil war", "Rabi's power attracts dangerous attention from those who want to use him."],
  );
  check("a political world is not a monster world", !lethalWorld(s), s.world_bible.what_people_fear);
}

/* 2. the word "threat" in a pressure palette proves nothing — every palette has it */
{
  for (const p of ["a threat from the north", "assassins attack at night", "the hunt for the heir", "kill orders from the crown"]) {
    check(`palette entry "${p}" alone does not summon predators`, !lethalWorld(make("political intrigue and debt", [p])));
  }
}

/* 3. a world that really does have something hunting in it still qualifies */
{
  check("being eaten", lethalWorld(make("being eaten by the things in the dark", [])));
  check("a named predator", lethalWorld(make("the raptors that come at dusk", [])));
  check("undead", lethalWorld(make("the undead that walk after the flood", [])));
  check("a swarm", lethalWorld(make("the swarm, when it turns toward a village", [])));
  check("plain beasts", lethalWorld(make("wolves in a hard winter", [])));
}

/* 4. the player is never sent at themselves */
{
  const s = make("The demon of Thornwood — Rabi, who kills without effort", [], "Rabi");
  check("a fear that names the player never fires", !lethalWorld(s), s.world_bible.what_people_fear);
  // the same world, feared for something that is not the protagonist, still fires
  check("...but a real creature in the same world does", lethalWorld(make("the demon that walks the moors at night", [], "Rabi")));
}

/* 5. an empty or absent fear is not a monster world */
{
  check("no stated fear", !lethalWorld(make("", [])));
  check("an ordinary human fear", !lethalWorld(make("the tax men, and winter", [])));
  check("fear of a person", !lethalWorld(make("the duke's soldiers and what they do to debtors", [])));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
