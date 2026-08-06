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
import { applyDiff, repairStrandedCast, pruneParseArtifacts, replanDrives, travelMinutesBetween, ARRIVAL_PATIENCE, DEFAULT_TRAVEL_MIN } from "../src/engine/turn";
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

/* 9. an institution is not a person, and `called` is not a speech verb */
{
  const s = newSave("church", { name: "V" } as any);
  s.world.places["loc_inn"] = { id: "loc_inn", name: "The inn", description_facts: "", contains: [] };
  s.world.player_location = "loc_inn";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const before = Object.keys(s.characters).length;
  // the exact sentence that registered the Church as a background figure with a rumor feed
  applyDiff(s, {} as unknown as SimulatorDiff, "I tell her who I am",
    `"My husband used to say the king's proclamations were lies. He said anyone the Church called a demon was just someone the priests couldn't tax."`);
  check("the Church does not join the cast", Object.keys(s.characters).length === before,
    Object.values(s.characters).map((c: any) => c.name));

  // other institutions in ordinary prose
  const s2 = newSave("crown", { name: "V" } as any);
  s2.world.places["loc_hall"] = { id: "loc_hall", name: "Hall", description_facts: "", contains: [] };
  s2.world.player_location = "loc_hall";
  registerCharacter(s2, { name: "Rabi", character_id: "char_player" } as any);
  applyDiff(s2, {} as unknown as SimulatorDiff, "I wait", "The Crown answered within the week. The Guild replied that it would not.");
  check("neither does the Crown or the Guild", Object.keys(s2.characters).length === 1,
    Object.values(s2.characters).map((c: any) => c.name));

  // ...but a real speaker still registers
  const s3 = newSave("real", { name: "V" } as any);
  s3.world.places["loc_hall"] = { id: "loc_hall", name: "Hall", description_facts: "", contains: [] };
  s3.world.player_location = "loc_hall";
  registerCharacter(s3, { name: "Rabi", character_id: "char_player" } as any);
  applyDiff(s3, {} as unknown as SimulatorDiff, "I listen", "The woman set down the cup. \"You should go,\" Allison said, and she meant it.");
  check("a genuine unregistered speaker is still caught",
    Object.values(s3.characters).some((c: any) => c.name === "Allison"),
    Object.values(s3.characters).map((c: any) => c.name));
}

/* 10. the arrival walk cannot cross a map in eight turns */
{
  const s = newSave("travel", { name: "V" } as any);
  s.world.places["loc_it"] = { id: "loc_it", name: "San Pietro", description_facts: "", contains: [] };
  s.world.places["loc_home"] = { id: "loc_home", name: "Thornwood", description_facts: "", contains: [] };
  s.world.places["loc_gate"] = { id: "loc_gate", name: "Thornwood Gate", description_facts: "", contains: [] };
  s.world.player_location = "loc_it";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.characters["char_player"].location = "loc_it";
  const wife = registerCharacter(s, { name: "Andrea" } as any);
  s.characters[wife].location = "loc_home";
  s.characters[wife].tracked = true;
  s.characters[wife].drive = { goal: "Find Rabi and keep him engaged", progress: 14, priority: 1, updated_turn: 1 };
  s.telemetry = [{ turn: 1, present: [wife] }] as any;

  s.world.current_turn = 30; s.world.current_time = "Day 1, 09:00";
  s.world.time_at_turn = { 30: "Day 1, 09:00" };
  replanDrives(s);
  s.world.current_turn = 30 + ARRIVAL_PATIENCE;
  s.world.current_time = "Day 1, 12:00";                       // three hours later
  replanDrives(s);
  check("a country away, three hours is not enough", s.characters[wife].location === "loc_home", s.characters[wife].location);

  s.world.current_time = "Day 3, 12:00";                       // two days later
  replanDrives(s);
  check("two days is", s.characters[wife].location === "loc_it", s.characters[wife].location);
  check("the arrival is announced, not silent", (s.world.arrivals_pending ?? []).includes("Andrea"), s.world.arrivals_pending);

  // and a walk inside the same settlement is free
  check("same-settlement travel costs nothing", travelMinutesBetween(s, "Thornwood Gate", "Thornwood") === 0);
  check("a genuinely different place is not free", travelMinutesBetween(s, "Thornwood", "San Pietro") === DEFAULT_TRAVEL_MIN);
  s.world.distances = [{ from: "Thornwood", to: "San Pietro", minutes: 90 }];
  check("a recorded distance wins", travelMinutesBetween(s, "San Pietro", "Thornwood") === 90);
}

/* 11. a word repeated back is not a person */
{
  // The exact turn: the player offers "wife" and "co-ruler", she says the words back, and the cast
  // gains a member called Wife. One save collected Cost, She, Dinner and Wife this way.
  const s = newSave("nouns", { name: "V" } as any);
  s.world.places["loc_floor"] = { id: "loc_floor", name: "Rabi's floor", description_facts: "", contains: [] };
  s.world.player_location = "loc_floor";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const before = Object.keys(s.characters).length;
  applyDiff(s, {} as unknown as SimulatorDiff,
    `"You would be my wife. You would be the co-ruler." I say as I walk away.`,
    `"Wife," she said quietly. "Co-ruler. You say it walking away, like it's a thing you're leaving on the table."`);
  check("nobody named Wife joins the cast", Object.keys(s.characters).length === before,
    Object.values(s.characters).map((c: any) => c.name));

  for (const [word, line] of [
    ["She", `"She," he said. "You keep saying she."`],
    ["Dinner", `"Dinner," she said, and set down the pot of dinner.`],
    ["Cost", `"Cost," the factor repeated. "You want to talk about cost."`],
  ] as [string, string][]) {
    const s2 = newSave("n", { name: "V" } as any);
    s2.world.places["loc_x"] = { id: "loc_x", name: "X", description_facts: "", contains: [] };
    s2.world.player_location = "loc_x";
    registerCharacter(s2, { name: "Rabi", character_id: "char_player" } as any);
    applyDiff(s2, {} as unknown as SimulatorDiff, "I listen", line);
    check(`"${word}" does not become a character`, Object.keys(s2.characters).length === 1,
      Object.values(s2.characters).map((c: any) => c.name));
  }

  // a genuine self-introduction still works
  const s3 = newSave("intro", { name: "V" } as any);
  s3.world.places["loc_x"] = { id: "loc_x", name: "X", description_facts: "", contains: [] };
  s3.world.player_location = "loc_x";
  registerCharacter(s3, { name: "Rabi", character_id: "char_player" } as any);
  applyDiff(s3, {} as unknown as SimulatorDiff, "I ask her name", `The woman wiped her hands. "Tomasa," she said, and went back to the pot.`);
  check("a real name answered to a question still registers",
    Object.values(s3.characters).some((c: any) => c.name === "Tomasa"),
    Object.values(s3.characters).map((c: any) => c.name));
}

/* 12. and the pruner can now clear the ones already in a save */
{
  const s = newSave("prune2", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  for (const n of ["Wife", "Dinner", "Cost", "She"]) {
    registerCharacter(s, { name: n, background: "INCOMPLETE RECORD — the narrator brought them into the story." } as any);
  }
  const real = registerCharacter(s, { name: "Mable", background: "Made by Rabi on the terrace." } as any);
  const removed = repairStrandedCast(s).concat(pruneParseArtifacts(s));
  check("all four common-noun phantoms are removed", removed.length === 4, removed);
  check("the real person is untouched", !!s.characters[real]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
