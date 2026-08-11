/* Smoke test: HE WALKED UP THE COOKSHOP STAIRS AND LEFT THE PARTY IN ANOTHER WORLD.
 *
 * From the save, the travel log is the whole story:
 *
 *     turn  1   The Forum of Trajan
 *     turn  4   The Subura
 *     turn  6   A cookshop in the Subura
 *     turn 12   Subura Rabi's Room        <-- the upstairs of the cookshop he was already in
 *     turn 15   The Subura
 *
 * The prose that made it: "Rabi turned from the counter and walked toward the narrow stair at the
 * back of the cookshop." He went up one flight. The engine gave the landing its own location, a
 * sibling of the Subura itself, and because presence is computed per location, Marcus, Tigris and
 * Clodia — sitting in a room he could see from the stairs — were NOT IN HIS SCENE for three turns.
 * When he came back down at turn 15 the narrator wrote the cookshop as continuous ("At the bottom,
 * the cookshop was quieter than before. Tigris was still at her corner table"), because the prose
 * knew what the state did not.
 *
 * The same fault has a second shape. One save carries THREE villas:
 *
 *     "Villa outside Rome"              a real place, described at length
 *     "Rabi's villa, Tiber waterfront"  a real place, where the player lives
 *     "The villa"                       description_facts, in full: "The kitchen is now fully
 *                                       enclosed by a stone wall with a glass door set in the
 *                                       center, and the hearth has been replaced by a modern
 *                                       four-burner gas stove."
 *
 * That last one is a places_update about a ROOM that got filed as a new building. And once it
 * exists the damage compounds, because the matcher cannot tell the three apart: "the villa" and
 * "my villa" both score 1.000 against all three and resolve to DIFFERENT ones. Two people walking
 * to the same house end up in different places over a word the player varied by accident.
 *
 * WHY: four code paths can mint a location — the bookkeeper's new_places, the offstage pass's
 * new_place, a montage's place_plan.create, and resolvePlace when the player moves — and each
 * carried a different, smaller subset of the checks. Only resolvePlace had all of them; the other
 * three compared names for EXACT EQUALITY and created on any miss.
 *
 * And resolvePlace's own guard had a hole in the middle of it. isPartOfAPlace opened with "two or
 * more capitalised words, or a possessive, means somebody named this, so it is a place" — correct
 * for "Kubota Garden" and "Tessa's House", and catastrophic for "Marcus's kitchen", "Rabi's Room"
 * and "Subura Rabi's Room", which have exactly that shape and are bedrooms. The escape ran first,
 * so the room test never got to speak.
 */
import { isPartOfAPlace, placeIntent, existingPlaceFor, mergePhantomPlaces, placeSimilarity } from "../src/engine/places";
import { resolvePlace } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function w(names: string[], loc = 0): SaveState {
  const places: any = { loc_offscene: { id: "loc_offscene", name: "elsewhere", contains: [] } };
  names.forEach((n, i) => places[`loc_${i}`] = { id: `loc_${i}`, name: n, contains: [], founding: true });
  return { world: { places, player_location: `loc_${loc}`, current_turn: 12 }, characters: {} } as unknown as SaveState;
}
const ROME = ["The Forum of Trajan", "The Subura", "A cookshop in the Subura", "The house of Lucia Aelia Severa"];
const nameOf = (s: SaveState, id: string) => s.world.places[id].name;

/* ── 1. the stairs at the back of the cookshop ────────────────────────────────── */
{
  const s = w(ROME, 2);   // the player is in the cookshop
  const before = Object.keys(s.world.places).length;
  check("'my room' keeps him where the stairs are", nameOf(s, resolvePlace(s, "my room")) === "A cookshop in the Subura");
  check("...and mints nothing", Object.keys(s.world.places).length === before, Object.keys(s.world.places).length - before);
  check("'the room upstairs' too", nameOf(s, resolvePlace(s, "the room upstairs")) === "A cookshop in the Subura");
  check("and \"Rabi's room\", possessive and all", nameOf(s, resolvePlace(s, "Rabi's room")) === "A cookshop in the Subura");
  check("the exact name from the save folds into the Subura",
    nameOf(s, resolvePlace(s, "Subura Rabi's Room")) === "The Subura", nameOf(s, resolvePlace(s, "Subura Rabi's Room")));
  check("nothing was created by any of it", Object.keys(s.world.places).length === before, Object.keys(s.world.places));
}

/* ── 2. ...but somewhere genuinely new is still somewhere new ─────────────────── */
{
  const s = w(ROME, 2);
  const before = Object.keys(s.world.places).length;
  const id = resolvePlace(s, "The Old Cannery on the Aventine");
  check("a place the world has never had is created", Object.keys(s.world.places).length === before + 1, nameOf(s, id));
  check("and it is not swallowed by a neighbour", /Cannery/.test(nameOf(s, id)), nameOf(s, id));
}

/* ── 3. the room test now outranks the escape hatch ───────────────────────────── */
{
  const rooms = ["Marcus's kitchen", "Rabi's Room", "Tessa's bedroom", "The Blue House Kitchen", "my room",
                 "Subura Rabi's Room", "Alki Bunker - Rabi and Liz Room", "the kitchen", "the garden"];
  const places = ["Tessa's House", "The Old Cannery", "Kubota Garden", "The Great Hall", "Interbay Yard"];
  rooms.forEach((n) => check(`a room: "${n}"`, isPartOfAPlace(n) === true));
  places.forEach((n) => check(`a place: "${n}"`, isPartOfAPlace(n) === false));
}

/* ── 4. all four creation paths go through one gate ───────────────────────────── */
{
  const s = w(["The Alki Bunker", "Villa outside Rome", "Rabi's villa, Tiber waterfront"], 0);
  const intent = (n: string) => {
    const i = placeIntent(s, n, "test");
    return i === null ? "room" : "id" in i ? nameOf(s, i.id) : "create";
  };
  check("the bunker's rooms fold into the bunker", intent("Alki Bunker - Rabi and Liz Room") === "The Alki Bunker");
  check("a second copy of a villa folds into the first", intent("Rabi's villa") === "Rabi's villa, Tiber waterfront");
  check("a bare room is refused outright", intent("the spare room") === "room");
  check("and real new ground is still allowed", intent("The Old Cannery") === "create");
  check("...including a named garden", intent("Kubota Garden") === "create");
}

/* ── 5. why the duplicates were load-bearing ──────────────────────────────────── */
{
  // the matcher scores 1.000 against all three, so an unqualified reference is a coin flip
  const villas = ["Villa outside Rome", "The villa", "Rabi's villa, Tiber waterfront"];
  check("every villa name matches every other perfectly",
    villas.every((v) => placeSimilarity("the villa", v.toLowerCase()) >= 0.99),
    villas.map((v) => placeSimilarity("the villa", v.toLowerCase()).toFixed(2)));
  const s = w(villas, 0);
  const a = nameOf(s, resolvePlace(s, "the villa")), b = nameOf(s, resolvePlace(s, "my villa"));
  check("so two ways of saying the same house reach different houses", a !== b, [a, b]);
}

/* ── 6. and the repair for saves that already have them ───────────────────────── */
{
  const s = w(["Villa outside Rome", "The villa", "Rabi's villa, Tiber waterfront"], 2);
  s.world.places.loc_0.population = { scale: 1, who: "whoever holds the villa" };
  s.world.places.loc_2.population = { scale: 2, who: "the resident and few attendants" };
  s.world.places.loc_1.description_facts = "The kitchen is now fully enclosed by a stone wall, and the hearth has been replaced by a modern four-burner gas stove.";
  check("before: 'the villa' finds the phantom", nameOf(s, existingPlaceFor(s, "the villa")!) === "The villa");
  const log = mergePhantomPlaces(s);
  check("the phantom is removed", !s.world.places.loc_1, Object.values(s.world.places).map((p) => p.name));
  check("and it says so", log.length === 1 && /removed as a duplicate/.test(log[0]), log);
  check("after: 'the villa' finds a real one", /Villa/.test(nameOf(s, existingPlaceFor(s, "the villa")!)));
  check("the kitchen was NOT welded onto a guessed building",
    !Object.values(s.world.places).some((p) => /four-burner/.test(p.description_facts ?? "")),
    Object.values(s.world.places).map((p) => p.description_facts));
}

/* ── 7. the repair never touches a place anyone is in, has been to, or wrote ───
 *
 * The last of those is the one this test was originally too generous to catch. The occupancy rules
 * alone made a phantom of any place that happens to be EMPTY RIGHT NOW with no population field —
 * so on the first run the repair deleted "Rabi's villa, Tiber waterfront", the house the story is
 * set in, and kept a stub called "The villa" because somebody was standing in the stub. A place is
 * a stub by its text, not only by its occupancy. */
{
  const LONG = "A brick-and-concrete villa on the Tiber's east bank, single-storied and low, its river face fitted with a broad glass door that opens onto a walled garden. A garden wall of dressed stone runs along the waterfront, warm under the sun, wide enough to sit on; beyond it the river slides brown and slow.";
  const described = (loc = 0) => {
    const s = w(["Villa outside Rome", "The villa", "Rabi's villa, Tiber waterfront"], loc);
    s.world.places.loc_2.description_facts = LONG;
    return s;
  };
  const s = described();
  (s as any).characters = { char_x: { name: "X", location: "loc_1" } };
  mergePhantomPlaces(s);
  check("somewhere with someone standing in it survives", !!s.world.places.loc_1);
  check("...and so does the described house nobody happens to be in", !!s.world.places.loc_2,
    Object.values(s.world.places).map((p) => p.name));

  const t = described();
  (t as any).travel_log = [{ turn: 3, place: "loc_1" }];
  mergePhantomPlaces(t);
  check("somewhere the story has been survives", !!t.world.places.loc_1);

  const u = w(["Villa outside Rome", "The villa"], 1);   // the player is standing in it
  mergePhantomPlaces(u);
  check("and the player's own location survives", !!u.world.places.loc_1);

  const v = w(["The Subura", "A burned steading on the Appian Way"], 0);
  mergePhantomPlaces(v);
  check("a genuinely new place nobody has reached yet survives", Object.keys(v.world.places).length === 3,
    Object.values(v.world.places).map((p) => p.name));
}

/* ── 8. when the match IS unambiguous, the description comes across ───────────── */
{
  const s = w(["The Alki Bunker", "The Forum"], 1);
  s.world.places.loc_0.population = { scale: 12, who: "whoever is holed up here" };
  const phantom = { id: "loc_p", name: "Alki bunker", description_facts: "The generator room floods when it rains.", contains: [] };
  (s.world.places as any).loc_p = phantom;
  const log = mergePhantomPlaces(s);
  check("one clear answer means one clear fold", log.length === 1 && /folded into "The Alki Bunker"/.test(log[0]), log);
  check("and the fact is kept", /generator room floods/.test(s.world.places.loc_0.description_facts ?? ""),
    s.world.places.loc_0.description_facts);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
