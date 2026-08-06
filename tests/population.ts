/* Smoke test: THE WORLD HAS PEOPLE IN IT WHO ARE NOT CHARACTERS.
 *
 * `Place.contains` holds carded cast only, and the cast is capped on purpose. Nothing modelled the
 * other tier — the ordinary traffic of a market, a dock, a town — so a place with no cast member
 * standing in it was, to the narrator, an empty room. PRESENT is law and PRESENT was empty.
 *
 * A player who built a town with a market, a hospital, walls and a beach walked all of it alone,
 * sat on a board in the river for four turns because there was nobody to talk to, and unmade the
 * town. Also pinned here: the arrival timer that could never fire, and a place transformed from
 * outside it. */
import { newSave, registerCharacter } from "../src/engine/state";
import { populationOf, populationLine, crowdDirective } from "../src/engine/population";
import { applyDiff, replanDrives, ARRIVAL_PATIENCE } from "../src/engine/turn";
import { tickDrives } from "../src/engine/social";
import type { Place, SaveState, SimulatorDiff } from "../src/engine/types";

const place = (name: string, description_facts = ""): Place => ({ id: `loc_${name}`, name, description_facts, contains: [] });

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. a place's own name says what is ordinarily about it */
{
  check("a market has a crowd", (populationOf(place("Thornwood Market"))?.scale ?? 0) >= 100);
  check("a dock has working people", /dockhands/.test(populationOf(place("The River Docks"))?.who ?? ""));
  check("a gate has a watch", (populationOf(place("Thornwood Gate"))?.scale ?? 0) > 0);
  check("a forest has nobody", populationOf(place("The Old Forest")) === null);
  check("an unrecognised name infers nothing rather than guessing", populationOf(place("Thornwood")) === null);
}

/* 2. the description does not get to vote on scale — only to veto */
{
  // every one of these came back as thousands of hawkers when descriptions were matched too
  check("'near the city wall' does not make a forge a city",
    (populationOf(place("Elara's Forge", "A soot-stained stone building near the city wall."))?.scale ?? 0) < 20);
  check("'outskirts of the city' does not make a manor a city",
    (populationOf(place("Lady Marchess's Estate", "A walled manor on the outskirts of the city."))?.scale ?? 0) < 20);
  check("'north of the city' does not populate a forest",
    populationOf(place("The Old Forest", "A dense ancient forest north of the city.")) === null);
  check("a description CAN say a place is empty",
    populationOf(place("Thornwood Hospital", "An automated hospital. It has no one working in it.")) === null);
}

/* 3. an explicit population always wins, including an explicit zero */
{
  const p = place("Thornwood"); p.population = { scale: 3000, who: "townsfolk of the duke's new town" };
  check("authored population is used", populationOf(p)?.scale === 3000);
  check("it reaches the locations block", /thousands of people/.test(populationLine(p)), populationLine(p));
  const empty = place("Thornwood Market"); empty.population = { scale: 0, who: "" };
  check("an explicit zero overrides the inference", populationOf(empty) === null);
}

/* 4. the directive for the room the player is standing in — the acute case */
{
  const s = newSave("pop", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_beach"] = place("Thornwood Beach");
  s.world.player_location = "loc_beach";
  s.world.present = [];
  const d = crowdDirective(s);
  check("a populated place with no cast produces a directive", d.length > 0);
  check("it forbids writing the place as deserted", /Do not write this place as deserted/.test(d));
  check("it says the crowd exists without the cast", /whether or not anyone from the cast is standing here/.test(d));
  check("it keeps them anonymous so they don't become cast", /Keep them ANONYMOUS/.test(d));

  s.world.places["loc_wood"] = place("The Old Forest");
  s.world.player_location = "loc_wood";
  check("genuinely empty ground gets no directive", crowdDirective(s) === "");
}

/* 5. the arrival timer can actually accumulate — it was measured against a field stamped every turn */
{
  const s: SaveState = newSave("arrive", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_estate"] = place("Thornwood Estate");
  s.world.places["loc_gate"] = place("Thornwood Gate");
  s.world.player_location = "loc_estate";
  s.characters["char_player"].location = "loc_estate";
  const wife = registerCharacter(s, { name: "Andrea" } as any);
  s.characters[wife].location = "loc_gate";
  s.characters[wife].tracked = true;
  s.characters[wife].drive = { goal: "Prove her worth to Rabi by managing Thornwood", progress: 40, priority: 0, updated_turn: 1 };
  s.telemetry = [{ turn: 1, present: [wife] }] as any;

  // tickDrives stamps updated_turn every turn — the exact thing that pinned the old counter at 1
  for (let t = 20; t < 20 + ARRIVAL_PATIENCE; t++) {
    s.world.current_turn = t;
    replanDrives(s);
    tickDrives(s, () => 0.5);
    check.length; // no-op
  }
  check("updated_turn is being refreshed under us", s.characters[wife].drive!.updated_turn >= 20 + ARRIVAL_PATIENCE - 1, s.characters[wife].drive);
  check("pursuit_since is stamped once and holds", s.characters[wife].drive!.pursuit_since === 20, s.characters[wife].drive);
  check("she is still walking, not teleported", s.characters[wife].location === "loc_gate");

  s.world.current_turn = 20 + ARRIVAL_PATIENCE;
  replanDrives(s);
  check("after the patience window she actually arrives", s.characters[wife].location === "loc_estate", s.characters[wife].location);
  check("the pursuit clock is cleared on arrival", s.characters[wife].drive!.pursuit_since === undefined);
}

/* 6. a place transformed from OUTSIDE it is still caught */
{
  const s = newSave("wreck", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_town"] = place("Thornwood", "A walled town, lit and quiet at night.");
  s.world.places["loc_beach"] = place("Thornwood Beach", "Sand and river.");
  s.world.player_location = "loc_beach";        // standing on the beach, unmaking the town
  applyDiff(s, {} as unknown as SimulatorDiff, "I destroy Thornwood and revert it to how it was before I came", "The town came apart.");
  check("the named place is flagged, not just the one underfoot", /no longer reliable/.test(s.world.places["loc_town"].description_facts), s.world.places["loc_town"].description_facts);
  check("the place the player is standing in is left alone when another is named", !/no longer reliable/.test(s.world.places["loc_beach"].description_facts));

  // and places_update still carries population when the change moved people
  const s2 = newSave("wreck2", { name: "V" } as any);
  registerCharacter(s2, { name: "Rabi", character_id: "char_player" } as any);
  s2.world.places["loc_town"] = place("Thornwood", "A walled town.");
  s2.world.player_location = "loc_town";
  applyDiff(s2, { places_update: [{ place: "Thornwood", description_facts: "Bare ground.", population: { scale: 0, who: "" } }] } as unknown as SimulatorDiff, "x", "y");
  check("a rewrite can empty a place of people", populationOf(s2.world.places["loc_town"]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
