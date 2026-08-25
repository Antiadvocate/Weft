/** THE ENGINE WAS DELIVERING PEOPLE TO A MAN THEY HATED.
 *
 *  From a433538a-The_City_of_Ashford.weaver_19.json, the player's report:
 *
 *      "Chloe keeps showing. Keeps calling herself my friend. The game keeps pushing her. She
 *       escapes fucking prison. She finds my house address. Miranda is there in the beginning
 *       when my house is settled. None of it makes any sense."
 *
 *  It made one kind of sense. `returnFromOffscene` decided where an offscreen character reappears,
 *  and it read the social graph like this:
 *
 *      Math.abs(e.warmth) >= 25 || Math.abs(e.trust) >= 25   →   state.world.player_location
 *
 *  Absolute value. The save's actual edges toward the player:
 *
 *      Chloe   warmth -100    trust -100     → |100| ≥ 25   → delivered to the player
 *      Miranda warmth  -28.3  trust  -50.9   → | 28| ≥ 25   → delivered to the player
 *      Leo     warmth   +4    trust    0     → |  4| < 25   → scattered at random
 *      Amber   warmth  +57    trust  +24     → | 57| ≥ 25   → delivered to the player
 *
 *  So the two women who wanted nothing to do with him were the two the engine put in his house
 *  every eight turns, the one man who mildly liked him was thrown somewhere random every time
 *  (which is why the player could never work out what Leo had to do with anything), and because
 *  `present` is derived from co-location, they arrived standing in the room with no arrival ever
 *  written. A grudge and a bond were the same number.
 */
import { returnFromOffscene } from "../src/engine/offstage";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
}

const HOUSE = "place_house", LOFT = "loc_loft", APT = "loc_chloe_apt", LEOS = "loc_leo_house", GYM = "loc_gym", OFF = "loc_offscene";

type Edge = { from: string; to: string; warmth: number; trust: number };
function world(chars: Record<string, Record<string, unknown>>, edges: Edge[], turn = 114) {
  return {
    world: {
      current_turn: turn,
      player_location: HOUSE,
      edges,
      places: {
        [HOUSE]: { id: HOUSE, name: "Vin's New House", contains: [] },
        [LOFT]: { id: LOFT, name: "Vin and Miranda's Loft", contains: [] },
        [APT]: { id: APT, name: "Chloe's Apartment", contains: [] },
        [LEOS]: { id: LEOS, name: "Leo's House", contains: [] },
        [GYM]: { id: GYM, name: "The Rock Climbing Gym", contains: [] },
        [OFF]: { id: OFF, name: "elsewhere", contains: [] },
      },
    },
    characters: {
      char_player: { name: "Vin", location: HOUSE },
      ...Object.fromEntries(
        Object.entries(chars).map(([id, c]) => [id, { location: OFF, offscene_since: 100, ...c }]),
      ),
    },
  };
}

const at = (s: ReturnType<typeof world>, id: string) => (s.characters as Record<string, { location?: string }>)[id]?.location;

console.log("\n── the save's four edges, run through the returner ──");

{
  const s = world(
    {
      chloe: { name: "Chloe", drive: { goal: "Find Leo and make him answer for abandoning her, so she can stop carrying the weight alone." } },
      miranda: { name: "Miranda", drive: { goal: "Decide whether to countersign the lease removal." } },
      leo: { name: "Leo", drive: { goal: "Open the estate lockbox and co-sign the fund." } },
      amber: { name: "Amber Reyes", drive: { goal: "Prove she will not be taken away again." } },
    },
    [
      { from: "chloe", to: "char_player", warmth: -100, trust: -100 },
      { from: "miranda", to: "char_player", warmth: -28.3, trust: -50.9 },
      { from: "leo", to: "char_player", warmth: 4, trust: 0 },
      { from: "amber", to: "char_player", warmth: 57.2, trust: 24.2 },
    ],
  );
  returnFromOffscene(s);
  check("Chloe at -100 is not delivered to the player's house", at(s, "chloe") !== HOUSE, String(at(s, "chloe")));
  check("Chloe goes home instead", at(s, "chloe") === APT, String(at(s, "chloe")));
  check("Miranda at -28 is not delivered to the player's house", at(s, "miranda") !== HOUSE, String(at(s, "miranda")));
  check("Leo at +4 goes home rather than being scattered", at(s, "leo") === LEOS, String(at(s, "leo")));
  check("Amber at +57 does come to him — a bond still draws", at(s, "amber") === HOUSE, String(at(s, "amber")));
}

console.log("\n── a stated want is the one thing that overrides a grudge ──");
{
  const s = world(
    { chloe: { name: "Chloe", drive: { goal: "Find Vin and make him say it to her face." } } },
    [{ from: "chloe", to: "char_player", warmth: -100, trust: -100 }],
  );
  returnFromOffscene(s);
  check("a want that names the player sends her to him even at -100", at(s, "chloe") === HOUSE, String(at(s, "chloe")));
}
{
  const s = world(
    { chloe: { name: "Chloe", drive: { goal: "Corner Miranda at the Rock Climbing Gym before she leaves." } } },
    [{ from: "chloe", to: "char_player", warmth: -100, trust: -100 }],
  );
  returnFromOffscene(s);
  check("a want that names a place sends her to that place", at(s, "chloe") === GYM, String(at(s, "chloe")));
}
{
  const s = world(
    { amber: { name: "Amber Reyes", drive: { goal: "Corner Miranda at the Rock Climbing Gym." } } },
    [{ from: "amber", to: "char_player", warmth: 57, trust: 24 }],
  );
  returnFromOffscene(s);
  check("...and a named place beats even a warm tie", at(s, "amber") === GYM, String(at(s, "amber")));
}

{
  // The save's Miranda: warmth -28.3, trust -50.9, and a want that reads "Get Vin back into the
  // same bed and touching her again". She still comes — and that is the point of the rule. Before,
  // she came because |−28| ≥ 25 and nobody could see why. Now she comes because of a sentence
  // written on her card that the player can read, argue with, or delete.
  const s = world(
    { miranda: { name: "Miranda", drive: { goal: "Get Vin back into the same bed and touching her again — on her own terms." } } },
    [{ from: "miranda", to: "char_player", warmth: -28.3, trust: -50.9 }],
  );
  returnFromOffscene(s);
  check("a grudge with a stated want about him still brings her, for a reason on the page",
    at(s, "miranda") === HOUSE, String(at(s, "miranda")));
}
{
  const s = world(
    { miranda: { name: "Miranda", drive: { goal: "Decide whether to countersign the lease removal." } } },
    [{ from: "miranda", to: "char_player", warmth: -28.3, trust: -50.9 }],
  );
  returnFromOffscene(s);
  check("...and the same grudge with a want that is not about him does not",
    at(s, "miranda") !== HOUSE, String(at(s, "miranda")));
}

console.log("\n── the held do not come back on a timer ──");
{
  const s = world(
    { chloe: { name: "Chloe", held: { since_turn: 104, where: "Prison", note: "taken on turn 104" }, drive: { goal: "Find Vin." } } },
    [{ from: "chloe", to: "char_player", warmth: -100, trust: -100 }],
  );
  const log = returnFromOffscene(s);
  check("a held character is not returned at all", at(s, "chloe") === OFF, String(at(s, "chloe")));
  check("...and nothing is logged about her being back", !log.join(" ").includes("Chloe"), log.join(" "));
}

console.log("\n── the rest of the contract, unchanged ──");
{
  const s = world({ ivy: { name: "Ivy", offscene_since: 112 } }, []);
  returnFromOffscene(s);
  check("nobody comes back before eight turns have passed", at(s, "ivy") === OFF, String(at(s, "ivy")));
}
{
  const s = world({ nadia: { name: "Nadia", status: "departed" } }, [{ from: "nadia", to: "char_player", warmth: 80, trust: 80 }]);
  returnFromOffscene(s);
  check("the departed do not come back", at(s, "nadia") === OFF, String(at(s, "nadia")));
}
{
  const s = world({ owen: { name: "Owen", status: "dead" } }, [{ from: "owen", to: "char_player", warmth: 80, trust: 80 }]);
  returnFromOffscene(s);
  check("the dead do not come back", at(s, "owen") === OFF, String(at(s, "owen")));
}
{
  // no home, no want, no tie: still lands somewhere real, and never on top of the player
  let landedOnPlayer = 0;
  for (let i = 0; i < 60; i++) {
    const s = world({ zed: { name: "Zed" } }, []);
    returnFromOffscene(s);
    if (at(s, "zed") === HOUSE) landedOnPlayer++;
    if (at(s, "zed") === OFF) { landedOnPlayer = -1; break; }
  }
  check("a stranger with no tie lands somewhere real, never on the player", landedOnPlayer === 0, String(landedOnPlayer));
}
{
  // a grudge with a home, run repeatedly: never the player, every time
  let onPlayer = 0;
  for (let i = 0; i < 60; i++) {
    const s = world({ chloe: { name: "Chloe" } }, [{ from: "chloe", to: "char_player", warmth: -100, trust: -100 }]);
    returnFromOffscene(s);
    if (at(s, "chloe") === HOUSE) onPlayer++;
  }
  check("sixty returns at -100 and not one of them is his house", onPlayer === 0, `${onPlayer}/60`);
}
{
  // trust alone is enough of a bond, as it always was
  const s = world({ tam: { name: "Tam" } }, [{ from: "tam", to: "char_player", warmth: 5, trust: 40 }]);
  returnFromOffscene(s);
  check("high trust alone still draws someone to the player", at(s, "tam") === HOUSE, String(at(s, "tam")));
}
{
  // ...but not when the other half of the tie is a grudge
  const s = world({ tam: { name: "Tam" } }, [{ from: "tam", to: "char_player", warmth: -60, trust: 40 }]);
  returnFromOffscene(s);
  check("warm trust and cold warmth is not a reason to turn up", at(s, "tam") !== HOUSE, String(at(s, "tam")));
}

console.log("\n── the stamp is not a fossil ──");
{
  // Chloe's save had offscene_since: 73 while she stood in the player's living room at turn 114 —
  // the mark is only cleared when THIS pass brings someone back, never when the story does.
  const s = world({ chloe: { name: "Chloe", location: HOUSE, offscene_since: 73 } }, []);
  returnFromOffscene(s);
  check("a character who is somewhere loses the mark that says they are nowhere",
    (s.characters as Record<string, { offscene_since?: number }>).chloe.offscene_since === undefined);
}
{
  const s = world({ chloe: { name: "Chloe", location: OFF, offscene_since: undefined } }, []);
  returnFromOffscene(s);
  check("...and stepping out starts the grace period fresh, so nobody is instantly eligible",
    at(s, "chloe") === OFF && (s.characters as Record<string, { offscene_since?: number }>).chloe.offscene_since === 114);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
