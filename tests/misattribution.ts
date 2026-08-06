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
import { applyDiff, repairStrandedCast, pruneParseArtifacts, replanDrives, syncPresence, travelMinutesBetween, giftDirective, repairBibleLists, splitLines, ARRIVAL_PATIENCE, DEFAULT_TRAVEL_MIN, NEIGHBOUR_TRAVEL_MIN } from "../src/engine/turn";
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

/* 13. A ONE-WORD ANSWER IS NOT A NAME UNLESS SOMEBODY ASKED FOR ONE.
 *
 * `"Hiding," it said.` — the answer to "what are you doing in there" — put a person called Hiding
 * in the cast. The self-introduction rule matches one capitalised word in quotes followed by an
 * attribution, which is the shape of EVERY terse answer in English, not just an introduction.
 * Waiting, Everlasting, Leaving and Listening all arrive the same way and no blocklist ends. */
{
  const bare = (action: string, prose: string) => {
    const s = newSave("bare", { name: "V" } as any);
    s.world.places["loc_x"] = { id: "loc_x", name: "X", description_facts: "", contains: [] };
    s.world.player_location = "loc_x";
    registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
    applyDiff(s, {} as unknown as SimulatorDiff, action, prose);
    return Object.values(s.characters).map((c: any) => c.name).filter((n) => n !== "Rabi");
  };

  check("an answer to 'what are you doing' is not a person",
    bare(`"Alright. What are you doing in there"`, `The thing did not move. "Hiding," it said.`).length === 0,
    bare(`"Alright. What are you doing in there"`, `The thing did not move. "Hiding," it said.`));
  check("a gerund answer is not a person",
    bare(`I ask what they want`, `"Waiting," she said. "That is all any of us do here."`).length === 0);
  check("an abstraction answered back is not a person",
    bare(`"What is on the other side"`, `"Everlasting," he answered, and would say nothing more.`).length === 0);
  check("a thing does not introduce itself even when a name IS asked",
    bare(`"Who are you"`, `"Hiding," it said.`).length === 0,
    bare(`"Who are you"`, `"Hiding," it said.`));

  // the rule still does the job it exists for
  check("a name given in answer to a name question still registers",
    bare(`I ask her name`, `The woman wiped her hands. "Tomasa," she said, and went back to the pot.`).includes("Tomasa"));
  check("'who are you' works as the question too",
    bare(`"Who are you?"`, `He put the crate down. "Corwin," he said.`).includes("Corwin"));
  check("the narrator asking counts as asking",
    bare(`I wait`, `"Does the boy have a name?" the smith said. "Tomas," he said, barely audible.`).includes("Tomas"));
}

/* 14. TRAVEL THAT IS ACTUALLY WALKABLE.
 *
 * The arrival walk needs a distance, and the distance was guessed from names: a shared first word
 * meant a stroll, anything else meant a full day. Mable stood on "Mable's floor" for the rest of a
 * save because the player was in "Andrea's workroom" — one staircase away, sharing no words — so
 * the engine quoted her twenty-four hours and her arrival could never fire. */
{
  const s = newSave("travel", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const P: [string, string][] = [
    ["loc_mable", "Mable's floor"], ["loc_work", "Andrea's workroom"],
    ["loc_gate", "Thornwood Gate"], ["loc_mkt", "Thornwood Market"],
    ["loc_pietro", "San Pietro"], ["loc_far", "Vismara"],
  ];
  for (const [id, name] of P) s.world.places[id] = { id, name, description_facts: "", contains: [] };
  const t = (a: string, b: string) => travelMinutesBetween(s, a, b);

  check("the same place is no distance at all", t("San Pietro", "San Pietro") === 0);
  check("a shared settlement name is a stroll", t("Thornwood Gate", "Thornwood Market") === 0);
  check("two unrelated places still cost a day", t("San Pietro", "Vismara") === DEFAULT_TRAVEL_MIN, t("San Pietro", "Vismara"));
  check("two rooms are not a day apart", t("Mable's floor", "Andrea's workroom") < 60, t("Mable's floor", "Andrea's workroom"));
  check("a room and a city still are", t("Mable's floor", "Vismara") === DEFAULT_TRAVEL_MIN);

  // an authored distance beats every heuristic, in both directions
  s.world.distances = [{ from: "Mable's floor", to: "Andrea's workroom", minutes: 600 }];
  check("an authored distance wins", t("Mable's floor", "Andrea's workroom") === 600);
  check("and it is symmetric", t("Andrea's workroom", "Mable's floor") === 600);
  delete s.world.distances;

  // the player's own path is a measurement — better than any name heuristic
  s.travel_log = [{ turn: 10, place: "loc_pietro" }, { turn: 11, place: "loc_far" }];
  s.world.time_at_turn = { 10: "Day 3, 08:00", 11: "Day 3, 11:00" };
  check("a walk the player made is measured, not guessed", t("San Pietro", "Vismara") === 180, t("San Pietro", "Vismara"));
  check("measured in the other direction too", t("Vismara", "San Pietro") === 180);

  // ...and the shortest crossing wins, because the player may have dawdled once
  s.travel_log = [
    { turn: 10, place: "loc_pietro" }, { turn: 11, place: "loc_far" },
    { turn: 20, place: "loc_pietro" }, { turn: 21, place: "loc_far" },
  ];
  s.world.time_at_turn = { 10: "Day 3, 08:00", 11: "Day 3, 11:00", 20: "Day 4, 08:00", 21: "Day 4, 09:00" };
  check("the fastest recorded crossing is the distance", t("San Pietro", "Vismara") === 60, t("San Pietro", "Vismara"));

  // an old trip whose clock stamps have scrolled out still proves adjacency
  s.world.time_at_turn = {};
  check("adjacency outlives the clock window", t("San Pietro", "Vismara") === NEIGHBOUR_TRAVEL_MIN, t("San Pietro", "Vismara"));

  // and Mable can finally cross the floor she is standing on
  const m = newSave("mable", { name: "V" } as any);
  registerCharacter(m, { name: "Rabi", character_id: "char_player" } as any);
  m.world.places["loc_work"] = { id: "loc_work", name: "Andrea's workroom", description_facts: "", contains: [] };
  m.world.places["loc_mable"] = { id: "loc_mable", name: "Mable's floor", description_facts: "", contains: [] };
  m.world.player_location = "loc_work";
  m.characters["char_player"].location = "loc_work";
  const mable = registerCharacter(m, { name: "Mable" } as any);
  m.characters[mable].location = "loc_mable";
  m.characters[mable].tracked = true;
  m.characters[mable].drive = { goal: "Reach Rabi and show him what she made", progress: 10, priority: 3, updated_turn: 1 };
  m.telemetry = [{ turn: 1, present: [mable] }] as any;
  m.world.current_time = "Day 1, 09:00";
  m.world.time_at_turn = {};
  for (let turn = 20; turn <= 20 + ARRIVAL_PATIENCE; turn++) {
    m.world.current_turn = turn;
    m.world.time_at_turn[turn] = `Day ${1 + Math.floor(turn / 24)}, ${String(turn % 24).padStart(2, "0")}:00`;
    m.world.current_time = m.world.time_at_turn[turn];
    replanDrives(m);
  }
  check("Mable gets down one floor inside a save", m.characters[mable].location === "loc_work", m.characters[mable].location);
}

/* 15. THE GONE DO NOT WALK BACK IN.
 *
 * A woman who had departed the story was carried back into the room by the ledger on the strength
 * of the scene TALKING ABOUT her — the arrival guard accepts a name in the prose as evidence of an
 * arrival, and a name in the prose is what happens to somebody right after they leave. */
{
  const s = newSave("gone", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_work"] = { id: "loc_work", name: "Andrea's workroom", description_facts: "", contains: [] };
  s.world.places["loc_away"] = { id: "loc_away", name: "Vismara", description_facts: "", contains: [] };
  s.world.player_location = "loc_work";
  s.characters["char_player"].location = "loc_work";
  const lady = registerCharacter(s, { name: "Lady Marchess" } as any);
  s.characters[lady].location = "loc_away";
  s.characters[lady].status = "departed";
  const wife = registerCharacter(s, { name: "Andrea" } as any);
  s.characters[wife].location = "loc_work";
  syncPresence(s);
  check("a departed character is not in the scene to begin with", !s.world.present.includes(lady), s.world.present);

  const shifts = applyDiff(s, { locations: [{ char_id: lady, place: "Andrea's workroom" }] } as unknown as SimulatorDiff,
    "I ask Andrea what happened to her", `Andrea did not look up. "Lady Marchess is not coming back," she said. "Marchess made that clear."`);
  check("she is not moved into the room", s.characters[lady].location === "loc_away", s.characters[lady].location);
  check("and she is not in the scene", !s.world.present.includes(lady), s.world.present);
  check("the correction is reported", shifts.some((x: string) => /departed/.test(x)), shifts);
  check("the person actually here is untouched", s.world.present.includes(wife), s.world.present);

  // the lock holds even if something else puts her back after the rebuild
  s.world.present.push(lady);
  s.world.places["loc_work"].contains.push(lady);
  applyDiff(s, {} as unknown as SimulatorDiff, "I wait", "The room was quiet.");
  check("the departure lock strips her out again", !s.world.present.includes(lady), s.world.present);
  check("and out of the room", !s.world.places["loc_work"].contains.includes(lady), s.world.places["loc_work"].contains);

  // coming back is a real event: clear the status and she is a person in a room again
  s.characters[lady].status = "active";
  s.characters[lady].location = "loc_work";
  syncPresence(s);
  check("a returning character is not permanently barred", s.world.present.includes(lady), s.world.present);
}

/* 16. A GIFT IS NOT AN INVOICE.
 *
 * "I made something for the people and again they fucking decry me and ask me for payment?" The
 * narrator reads a cold edge as "be an obstacle" and reaches for the only friction it knows —
 * money — without checking which direction the goods just moved. */
{
  const gift = (action: string) => giftDirective(action);
  check("building something for a town is giving", /GIVING, NOT BUYING/.test(gift("I build a well for the village")));
  check("handing food to people is giving", /GIVING, NOT BUYING/.test(gift("I give the food to the children")));
  check("healing someone is giving", /GIVING, NOT BUYING/.test(gift("I heal the wounded for them")));
  check("making a thing for a named person is giving", /GIVING, NOT BUYING/.test(gift("I made a coat for Mable")));

  check("buying something is not giving", gift("I buy bread from the baker") === "");
  check("asking for something is not giving", gift("I ask the smith to make a blade for me") === "");
  check("giving someone a look is not a benefaction", gift("I give her a long look") === "");
  check("an empty action is not a gift", gift("") === "");

  const d = gift("I build a well for the village");
  check("it forbids the invoice specifically", /No price, no fee, no invoice/.test(d));
  check("it leaves refusal and suspicion available", /they refuse it/.test(d) && /suspicious/.test(d), d);
  check("it asks for a proportionate reaction", /proportionate to the size of what was given/.test(d), d);
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

/* 17. LISTS THAT A COMMA-SPLIT SHREDDED.
 *
 * pressure_palette and forbidden_as_primary round-tripped through join(", ") / split(","), so any
 * entry containing a comma broke in two — and did it again on every save. One save's palette had
 * decayed into seven fragments, three of them starting with "and", and its forbidden list read
 * ["Political intrigue without immediate", ...] with the words that gave it meaning gone. The
 * narrator was handed those fragments as genre law every turn. */
{
  const s = newSave("lists", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world_bible.pressure_palette = [
    "The king's spies are everywhere", "and Rabi's power could be seen as a threat or a tool.",
    "Rabi's compulsion can be exploited by anyone who learns of it", "leading to betrayal or manipulation.",
    "The kingdom is on the brink of civil war", "and Rabi's actions could tip the balance.",
    "Rabi's power attracts dangerous attention from those who want to use him.",
  ];
  s.world_bible.forbidden_as_primary = ["Political intrigue without immediate", "personal stakes", "Moralizing about power—let actions speak."];
  const log = repairBibleLists(s);

  const pal = s.world_bible.pressure_palette!;
  check("the shredded palette is put back together", pal.length === 4, pal);
  check("the tail is rejoined to its head",
    pal[0] === "The king's spies are everywhere, and Rabi's power could be seen as a threat or a tool.", pal[0]);
  check("no entry starts mid-sentence any more", !pal.some((x) => /^(and|or|leading) /.test(x)), pal);
  check("an entry that was always whole is untouched",
    pal[3] === "Rabi's power attracts dangerous attention from those who want to use him.", pal[3]);

  const fb = s.world_bible.forbidden_as_primary!;
  check("the truncated ban recovers its meaning", fb[0] === "Political intrigue without immediate, personal stakes", fb[0]);
  check("the ban that survived intact is left alone", fb[1] === "Moralizing about power—let actions speak.", fb);
  check("the repair says what it did", log.some((x) => /rejoined/.test(x)), log);

  // a healthy save is not "repaired"
  const ok = newSave("ok", { name: "V" } as any);
  registerCharacter(ok, { name: "Rabi", character_id: "char_player" } as any);
  ok.world_bible.pressure_palette = ["Money", "The weather turning", "A rival's patience running out"];
  check("nothing is done to a list that is already fine", repairBibleLists(ok).length === 0);
  check("and it is left exactly as it was", ok.world_bible.pressure_palette!.length === 3);

  // and the editor no longer creates the damage in the first place
  check("an entry with a comma survives the editor now",
    splitLines("Political intrigue without immediate, personal stakes\nMoralizing about power").length === 2,
    splitLines("Political intrigue without immediate, personal stakes\nMoralizing about power"));
  check("a legacy single-line value still splits on commas",
    splitLines("Money, The weather, A rival").length === 3);
  check("blank lines are dropped", splitLines("a\n\n\nb").length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
