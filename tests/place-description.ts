/* Smoke test: THE GROUND GETS WRITTEN DOWN.
 *
 * description_facts is what the narrator, the offstage world-sim and the map all read as currently
 * true of a place. Three ways it goes wrong, all seen in one save:
 *
 *   • A place created mid-play with no description at all — `new_places` only requires a name —
 *     and nothing ever fills it in. Eighty turns of scenes set there, and the record says nothing.
 *   • A place transformed, with the description still asserting what used to be there.
 *   • A places_update that replaced a whole city's description with a note about one house in it.
 *
 * The bookkeeper is now asked for a places_update every turn a marked place appears in the prose;
 * this pass is the backstop for what it misses. These pin which places count as pending, and that
 * a place with nothing written about it yet is left alone rather than invented from thin air. */
import { newSave, registerCharacter } from "../src/engine/state";
import { pendingPlaces } from "../src/engine/placedesc";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("places", { name: "Veridun" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_offscene"] = { id: "loc_offscene", name: "elsewhere", description_facts: "", contains: [] };
  s.world.places["loc_written"] = {
    id: "loc_written", name: "The plant room", contains: [],
    description_facts: "Sub-level under the estate. Battery banks in racks, inverters, pumps, a switchboard. Constant low hum, warm, lit hard from above.",
  };
  s.world.places["loc_blank"] = { id: "loc_blank", name: "San Pietro", description_facts: "", contains: [] };
  s.world.places["loc_stale"] = {
    id: "loc_stale", name: "Thornwood", contains: [],
    description_facts: "A walled town, lit and quiet at night.",
    stale_note: "Changed on turn 40 by: I destroy the town — the description predates that.",
  };
  s.world.player_location = "loc_blank";
  return s;
}

/* 1. which places are pending */
{
  const s = world();
  const p = pendingPlaces(s);
  check("a place with no description is pending", p.includes("loc_blank"), p);
  check("a place flagged out of date is pending", p.includes("loc_stale"), p);
  check("a place with a good description is not", !p.includes("loc_written"), p);
  check("elsewhere is never pending", !p.includes("loc_offscene"), p);
  check("exactly the two", p.length === 2, p);
}

/* 2. writing a record clears the flag and stops it being pending */
{
  const s = world();
  const place = s.world.places["loc_stale"];
  place.description_facts = "Bare ground inside a broken ring of scorched stone. Nothing stands above knee height. Ash in the gutters where streets were.";
  delete place.stale_note;
  check("a rewritten place drops out of the queue", !pendingPlaces(s).includes("loc_stale"), pendingPlaces(s));
  check("a blank one is still waiting", pendingPlaces(s).includes("loc_blank"));
}

/* 3. the queue is state-derived, so it survives a reload and retries on its own */
{
  const s = world();
  const first = pendingPlaces(s);
  const round = JSON.parse(JSON.stringify(s)) as SaveState;   // export/import
  check("pending work survives a save round-trip", JSON.stringify(pendingPlaces(round)) === JSON.stringify(first), pendingPlaces(round));
}

/* 4. an empty world is not work */
{
  const s = newSave("empty", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_offscene"] = { id: "loc_offscene", name: "elsewhere", description_facts: "", contains: [] };
  check("nothing to do in a world with no places", pendingPlaces(s).length === 0, pendingPlaces(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
