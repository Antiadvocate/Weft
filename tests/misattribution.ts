/* Smoke test: THE LEDGER CANNOT PUT SOMEONE IN A ROOM THEY WERE NEVER IN.
 *
 * The narrator writes unnamed people constantly — an innkeeper, a boatman, a stallholder — and they
 * have no record and need none. The bookkeeper, needing an id to hang their behavior on and having
 * none, reaches for the nearest real cast member.
 *
 * In one save that put a guard captain from a city the player had flown away from behind the bar of
 * an inn in another country: she was moved into the scene, given the drive "Get the stranger to
 * leave the inn without incident", and grew a new trait from it — while the prose never mentioned
 * her once in five turns.
 *
 * The departure guard already refuses to move a present character OUT without evidence in the
 * prose. This is the missing mirror, plus the same test applied to wants.
 *
 * Also pinned: low warmth must not mean a publican refuses to sell a drink. */
import { newSave, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import { dispositionCue } from "../src/engine/desire";
import type { SaveState, SimulatorDiff } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): { s: SaveState; away: string; here: string } {
  const s = newSave("misattr", { name: "V" } as any);
  s.world.places["loc_city"] = { id: "loc_city", name: "Vismara", description_facts: "", contains: [] };
  s.world.places["loc_home"] = { id: "loc_home", name: "Thornwood", description_facts: "", contains: [] };
  s.world.places["loc_offscene"] = { id: "loc_offscene", name: "elsewhere", description_facts: "", contains: [] };
  s.world.player_location = "loc_city";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.characters["char_player"].location = "loc_city";
  // a guard captain a whole country away, in a city the player flew out of
  const away = registerCharacter(s, { name: "Angeline" } as any);
  s.characters[away].location = "loc_home";
  // someone actually in the scene
  const here = registerCharacter(s, { name: "Doren" } as any);
  s.characters[here].location = "loc_city";
  s.world.present = [here];
  return { s, away, here };
}

const INN_PROSE = "The innkeeper set down the candlestick. She looked at the gold and did not touch it. A boat passed outside the open door.";

/* 1. an absent character is not teleported into the scene by the ledger */
{
  const { s, away } = world();
  const shifts = applyDiff(
    s,
    { locations: [{ char_id: away, place: "Vismara", said: "" }] } as unknown as SimulatorDiff,
    "I ask about buying property", INN_PROSE,
  );
  check("she stays where she was", s.characters[away].location === "loc_home", s.characters[away].location);
  check("she is not in the scene", !s.world.present.includes(away));
  check("the block is reported", shifts.some((x) => /never showed them arrive/.test(x)), shifts);
}

/* 2. ...but a real arrival still works */
{
  const { s, away } = world();
  applyDiff(s, { locations: [{ char_id: away, place: "Vismara", said: "" }] } as unknown as SimulatorDiff,
    "I look around", "Angeline stepped off the boat onto the quay, her face unreadable.");
  check("someone the prose shows arriving does arrive", s.characters[away].location === "loc_city", s.characters[away].location);

  const { s: s2, away: a2 } = world();
  applyDiff(s2, { locations: [{ char_id: a2, place: "Vismara", said: "" }] } as unknown as SimulatorDiff,
    "I send for Angeline", INN_PROSE);
  check("the player calling for them is evidence too", s2.characters[a2].location === "loc_city");
}

/* 3. an absent character does not acquire a want from a scene they were not in */
{
  const { s, away, here } = world();
  const shifts = applyDiff(
    s,
    { drives_update: [
      { char_id: away, goal: "Get the stranger to leave the inn without incident.", progress: 0, priority: 1 },
      { char_id: here, goal: "Sell the stranger a house", progress: 0, priority: 1 },
    ] } as unknown as SimulatorDiff,
    "I ask about buying property", INN_PROSE,
  );
  check("the absent character gets no want from it", !s.characters[away].drive, s.characters[away].drive);
  check("the misattribution is reported", shifts.some((x) => /was not in this scene/.test(x)), shifts);
  check("someone actually present still gets theirs", s.characters[here].drive?.goal === "Sell the stranger a house", s.characters[here].drive);
}

/* 4. naming them in the prose is enough — the guard is about evidence, not about location */
{
  const { s, away } = world();
  applyDiff(s, { drives_update: [{ char_id: away, goal: "Find Rabi and have it out with him", progress: 0, priority: 1 }] } as unknown as SimulatorDiff,
    "I wonder where she is", "Somewhere behind him, Angeline was still in Thornwood, and he knew it.");
  check("a named character can still be written about", s.characters[away].drive?.goal === "Find Rabi and have it out with him", s.characters[away].drive);
}

/* 5. low warmth withholds favors, not the ordinary business of the world */
{
  const cold = dispositionCue(0, 0);
  const warm = dispositionCue(60, 40);
  check("a stranger's cue says transactions are not favors", /TRANSACTIONS ARE NOT FAVORS/.test(cold), cold);
  check("it names what may still be withheld", /Withhold favors, trust, secrets, loyalty, and risk/.test(cold));
  check("it no longer says they agree to nothing", !/agrees to nothing/.test(cold), cold);
  check("the same holds at warmth", /TRANSACTIONS ARE NOT FAVORS/.test(warm));
  check("hostility is still legible as hostility", /resents or hates you/.test(dispositionCue(-70, -70)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
