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
import { applyDiff, repairStrandedCast } from "../src/engine/turn";
import { dispositionCue } from "../src/engine/desire";
import { updatePublicStanding, publicStandingDirective } from "../src/engine/social";
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

/* 6. the repair: a phantom already standing in the scene is sent home */
{
  const { s, away, here } = world();
  s.characters[away].location = "loc_city";          // the ledger parked her in the inn
  s.characters[away].drive = { goal: "Get the stranger to leave the inn without incident.", progress: 0, priority: 1, updated_turn: 1 };
  s.memory[away].episodic.push({ turn: 2, content: "Left Vismara and went to Thornwood.", importance: 4 } as any);
  s.world.present = [away, here];
  // Doren was in the scene the whole time; Angeline appears from nowhere at turn 3, and the prose
  // of that turn — like every other — never says her name.
  s.history = [1, 2, 3, 4, 5].map((turn) => ({
    turn, player_action: "I drink", narrator_prose: INN_PROSE, summary: "", offscreen: [],
    present: turn >= 3 ? [here, away] : [here],
  })) as any;

  const log = repairStrandedCast(s);
  check("the phantom is sent home", s.characters[away].location !== "loc_city", s.characters[away].location);
  check("her memory decides where home is", s.characters[away].location === "loc_home", s.characters[away].location);
  check("the goal she got from a scene she was never in goes with her", !s.characters[away].drive, s.characters[away].drive);
  check("the repair reports what it did", log.length === 1, log);
  check("someone really in the scene is untouched", s.characters[here].location === "loc_city");
  check("presence is rebuilt", !s.world.present.includes(away) && s.world.present.includes(here), s.world.present);
  check("running it again is a no-op", repairStrandedCast(s).length === 0);
}

/* 7. ...but a character the prose actually names is never touched */
{
  const { s, away } = world();
  s.characters[away].location = "loc_city";
  s.world.present = [away];
  s.history = [1, 2, 3, 4, 5].map((turn) => ({
    turn, player_action: "", narrator_prose: "Angeline stood at the rail and said nothing.",
    summary: "", offscreen: [], present: turn >= 3 ? [away] : [],
  })) as any;
  check("a named character stays put", repairStrandedCast(s).length === 0 && s.characters[away].location === "loc_city");

  // and a quiet character who has simply been in the room all along is never swept
  const { s: s3, here: h3 } = world();
  s3.history = [1, 2, 3, 4, 5].map((turn) => ({
    turn, player_action: "I drink", narrator_prose: INN_PROSE, summary: "", offscreen: [], present: [h3],
  })) as any;
  check("silence alone is not evidence of anything", repairStrandedCast(s3).length === 0 && s3.characters[h3].location === "loc_city");
}

/* 8. an atrocity in a populated place actually registers */
{
  const s = newSave("standing", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_town"] = { id: "loc_town", name: "Thornwood", description_facts: "", contains: [], population: { scale: 4000, who: "townsfolk" } };
  s.world.player_location = "loc_town";
  s.world.present = [];                       // nobody CARDED is present — the old blocker
  updatePublicStanding(s, "I kill everyone in the town", "The town simply ceased.");
  check("a massacre with no cast present still moves standing", (s.world.public_standing ?? 0) <= -8, s.world.public_standing);
  check("and it lands in the feared band", /FEARED/.test(publicStandingDirective(s)), publicStandingDirective(s).slice(0, 80));

  // an unpopulated place is still private
  const s2 = newSave("standing2", { name: "V" } as any);
  registerCharacter(s2, { name: "Rabi", character_id: "char_player" } as any);
  s2.world.places["loc_wood"] = { id: "loc_wood", name: "The Old Forest", description_facts: "", contains: [] };
  s2.world.player_location = "loc_wood";
  s2.world.present = [];
  updatePublicStanding(s2, "I kill him", "He fell among the pines. No one saw.");
  check("a killing nobody could see moves nothing", (s2.world.public_standing ?? 0) === 0, s2.world.public_standing);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
