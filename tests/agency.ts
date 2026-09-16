/* Smoke test: A PERSON WHO WAS NEVER TOLD SOMETHING CANNOT SAY IT.
 *
 * The world pass hands one model everything — every place, every cast member's wants, who is
 * standing where, every clock, every thread — and then spends 2,489 tokens of OFFSTAGE_SYSTEM
 * asking it to behave as though it had not been handed most of that. The headings in that prompt
 * are a list of the times it did not work: the barista reading a private text aloud down a phone
 * line, the smith forging a design nobody ever drew, the friend told which flight the player was on.
 *
 * engine/agency.ts answers it by construction instead of by instruction: the call carries one
 * person's knowledge and nothing else. That claim is only worth anything if it is CHECKABLE, and
 * the reason actorBrief is a pure function returning a string is so these can check it without a
 * socket, a key, or a model.
 *
 * So: the first block below is the whole argument for the module, written as assertions about
 * what is absent from a string. */
import { newSave, registerCharacter } from "../src/engine/state";
import { actorBrief, pickActors, actToEvent, collide, MAX_ACTORS } from "../src/engine/agency";
import { agencyTurn, applyOffstage } from "../src/engine/offstage";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const ID: Record<string, string> = {};

function makeState(): SaveState {
  const state = newSave("agency-test", {
    name: "Veridun", era: "medieval", technology_level: "iron", magic_rules: "none",
    forbidden: "", what_people_fear: "the tax men", cultures_and_languages: "common",
    climate_and_geography: "temperate", calendar_and_currency: "standard", political_situation: "strained",
  } as any);
  state.world.places["loc_forge"] = { id: "loc_forge", name: "Elara's Forge", description_facts: "Coal smoke and a cold anvil.", contains: [] };
  state.world.places["loc_square"] = { id: "loc_square", name: "The King's Square", description_facts: "Flagstones, a dry fountain.", contains: [] };
  state.world.places["loc_mill"] = { id: "loc_mill", name: "The Old Mill", description_facts: "Half a roof.", contains: [] };
  state.world.player_location = "loc_square";
  state.world.current_turn = 40;
  registerCharacter(state, { name: "Rabi", character_id: "char_player" } as any);

  ID.smith = registerCharacter(state, { name: "Elara", background: "A smith with rebel sympathies.", gregariousness: 0.6 } as any);
  state.characters[ID.smith].location = "loc_forge";
  state.characters[ID.smith].drive = { goal: "Finish a secret order of weapons for the northern rebels", approach: "work the nights and say it is horseshoes", progress: 20, priority: 1, updated_turn: 1, blocker: "the charcoal has not come" };

  ID.boy = registerCharacter(state, { name: "Tomas", background: "The smith's apprentice.", gregariousness: 0.8 } as any);
  state.characters[ID.boy].location = "loc_forge";

  ID.priest = registerCharacter(state, { name: "Father Caelus", background: "Preaches against the grain tax.", gregariousness: 0.9 } as any);
  state.characters[ID.priest].location = "loc_square";
  state.characters[ID.priest].drive = { goal: "Get the tax rolls read aloud in the square", progress: 5, priority: 1, updated_turn: 1 };

  ID.recluse = registerCharacter(state, { name: "Mother Vell", background: "Lives at the mill and speaks to nobody.", gregariousness: 0.1 } as any);
  state.characters[ID.recluse].location = "loc_mill";

  state.world.clocks.push({
    id: "clk_rebels", faction: "The Northern Rebels",
    objective: "Arm the uprising before the thaw.",
    segments: 6, filled: 0, consequence: "Open rebellion.", visible_signs: ["Strange men at the forge."], status: "running",
  } as any);
  state.world.threads.push({
    id: "thr_secret", title: "Who informed on the mill",
    description: "Somebody told the tax men where the grain was.",
    status: "active", tension: 6, turn_started: 5,
  } as any);
  state.world.present = [];
  return state;
}

/* ── 1. THE LEAK, WHICH IS THE WHOLE POINT ───────────────────────────────────────
 *
 * Elara is at her forge. She has never met Father Caelus, is not in his square, does not stand in
 * a faction he stands in, and has no memory of him. Nothing about him may be in her head. */
{
  const s = makeState();
  const brief = actorBrief(s, ID.smith);

  check("her own want is hers", brief.includes("Finish a secret order of weapons"));
  check("her own door is hers", brief.includes("work the nights and say it is horseshoes"));
  check("what is blocking her is hers", brief.includes("the charcoal has not come"));
  check("she knows where she is standing", brief.includes("Elara's Forge"));
  check("she can see who is in the room", brief.includes("Tomas"));

  check("SHE DOES NOT KNOW WHAT CAELUS WANTS", !brief.includes("tax rolls"), brief);
  check("she cannot see into the square", !brief.includes("King's Square"), brief);
  check("she cannot see into the mill", !brief.includes("Old Mill"), brief);
  check("a thread she has never touched is not in her head", !brief.includes("Who informed on the mill"), brief);
  check("she has no idea where the player is", !brief.includes("Rabi"), brief);

  /* A clock belongs to the people standing in it. She is not registered as one of them, so the
   * uprising is not hers to know about — the state has no membership record tying her to it, and a
   * loose word-match would have handed it to her because her background says "rebel sympathies". */
  check("a faction she is not listed in stays out", !brief.includes("Arm the uprising"), brief);
}

/* ── 2. WHAT SHE HAS BEEN TOLD, SHE MAY USE ─────────────────────────────────────
 *
 * The other half of the same rule. Asymmetry is only interesting if the knowledge people DO have
 * is in front of them: a brief that withholds everything produces a person who does nothing. */
{
  const s = makeState();
  s.world.rumors = [{
    id: "rum_1", content: "The tax men are coming back before the thaw.",
    truth: "distorted", salience: 7, origin_char: ID.priest, knowers: [ID.priest, ID.smith],
    born_turn: 30, path: [],
  } as any];

  const hers = actorBrief(s, ID.smith);
  const his = actorBrief(s, ID.boy);
  check("a rumour she holds is in front of her", hers.includes("The tax men are coming back"));
  check("...and the boy standing next to her, who was never told, has never heard it",
    !his.includes("The tax men are coming back"), his);
}

/* ── 3. A RECLUSE IS STILL A RECLUSE ────────────────────────────────────────────
 *
 * Printing somebody's rumours in their briefing is an invitation to pass them on, and a person who
 * speaks to nobody passing on news is the gregariousness field doing nothing. */
{
  const s = makeState();
  s.world.rumors = [{
    id: "rum_2", content: "The mill has a new owner.", truth: "true", salience: 6,
    origin_char: ID.priest, knowers: [ID.recluse], born_turn: 20, path: [],
  } as any];
  check("the recluse's news stays in the recluse",
    !actorBrief(s, ID.recluse).includes("The mill has a new owner"));
}

/* ── 4. A WRONG BELIEF TRAVELS AND THE TRUE NUMBER DOES NOT ─────────────────────
 *
 * The mind layer's entire value is that a character may be wrong about somebody. A briefing that
 * carried the real edge would hand them the correction along with the misreading. */
{
  const s = makeState();
  s.minds = { [ID.smith]: { character_id: ID.smith, about: [{
    target: ID.boy, predicted_warmth: -40, predicted_stance: "rival",
    held_false: "the boy has been talking to the tax men", surprise: 0.4, confidence: 0.8, updated_turn: 38,
  }] } } as any;
  const brief = actorBrief(s, ID.smith);
  check("what she wrongly believes is hers to act on", brief.includes("the boy has been talking to the tax men"));
  check("...and no true warmth number comes with it", !brief.includes("-40") && !/predicted/i.test(brief), brief);
}

/* ── 5. THE BUDGET IS A COUNT OF PEOPLE ─────────────────────────────────────────
 *
 * The cost control. Spend is n small calls and a large cast cannot surprise it. */
{
  const s = makeState();
  check("two asked for, two picked", pickActors(s, 2).length === 2);
  check("zero asked for, nobody picked", pickActors(s, 0).length === 0);
  check("the cap holds above MAX_ACTORS", pickActors(s, 99).length <= MAX_ACTORS);

  /* Anyone in the room with the player is having their turn on the page. This is the bug the world
   * pass shipped with for a hundred turns: a character standing in the scene, hand on the player's
   * sleeve, reported in the same turn as having spent the afternoon somewhere else. */
  s.world.present = [ID.priest];
  check("nobody in the scene is given an afternoon elsewhere", !pickActors(s, 4).includes(ID.priest));
}

/* ── 6. STALENESS ROTATES THE CAST ──────────────────────────────────────────────
 *
 * Without it the two people with the liveliest wants have every afternoon in the save and everyone
 * else is furniture. */
{
  const s = makeState();
  s.world.offstage_log = [
    { turn: 39, time: "Day 3, 10:00", what: "Elara banked the forge and waited on charcoal.", actor: "Elara" },
    { turn: 38, time: "Day 3, 09:00", what: "Elara counted what was left of the iron.", actor: "Elara" },
  ];
  const picked = pickActors(s, 1);
  check("somebody the world has not moved outranks somebody it moved last interval",
    picked[0] !== ID.smith, { picked, names: picked.map((p) => s.characters[p].name) });
}

/* ── 7. THE ACTOR DOES NOT NAME THE WITNESSES ───────────────────────────────────
 *
 * applyOffstage records that the world pass returned an empty witness list EVERY SINGLE TIME,
 * which made the subsystem write-only until a co-location fallback was written underneath it.
 * Nobody is asked here: the state knows who is standing there. */
{
  const s = makeState();
  const ev = actToEvent(s, ID.smith, { what: "Elara worked the bellows until the coal ran out.", place: "Elara's Forge" });
  check("an act becomes an event", !!ev);
  check("the boy in the room witnessed it without anyone naming him", ev!.witnesses.includes("Tomas"), ev);
  check("the priest across town did not", !ev!.witnesses.includes("Father Caelus"), ev);
  check("the player is never a witness to the background", !ev!.witnesses.includes("Rabi"), ev);

  /* The one name an actor may add, because being told is a thing only the teller knows happened. */
  const told = actToEvent(s, ID.smith, {
    what: "Elara sent word to the priest about the charcoal.", place: "Elara's Forge",
    told: "Father Caelus", telling: "that the charcoal never came",
  });
  check("somebody deliberately told is a witness wherever they were standing",
    told!.witnesses.includes("Father Caelus"), told);

  /* ...and only somebody who exists. An invented name gets a life in the log otherwise — the
   * "Denise" failure recorded in applyOffstage, two hundred words and three threads about a person
   * with no card, no location, no memory and no voice. */
  const ghost = actToEvent(s, ID.smith, {
    what: "Elara passed word to Denise.", place: "Elara's Forge", told: "Denise",
  });
  check("a name the cast does not contain is not made a witness",
    !ghost!.witnesses.includes("Denise"), ghost);
}

/* ── 8. TWO PEOPLE IN ONE ROOM HAD ONE AFTERNOON ────────────────────────────────
 *
 * The cost of isolation, paid back without giving anybody more context. Each becomes a witness to
 * the other, so two calls produce four memories and an edge that moved between two people the
 * player has never watched interact. */
{
  const s = makeState();
  const a = actToEvent(s, ID.smith, { what: "Elara banked the fire early.", place: "Elara's Forge" })!;
  const b = actToEvent(s, ID.boy, { what: "Tomas hid the good tongs under the bench.", place: "Elara's Forge" })!;
  // Each was written without the other in context, so neither list starts with the other's name
  // for any reason except co-location.
  const out = collide([a, b]);
  check("she saw what the boy did", out[0].witnesses.includes("Tomas"));
  check("the boy saw what she did", out[1].witnesses.includes("Elara"));

  const far = actToEvent(s, ID.priest, { what: "Caelus read the rolls aloud to nobody.", place: "The King's Square" })!;
  const out2 = collide([a, far]);
  check("a different place is not a collision", !out2[1].witnesses.includes("Elara"));
}

/* ── 9. NOTHING NEW TOUCHES THE WORLD ───────────────────────────────────────────
 *
 * An agent's act is an OffstageEvent and goes through the applier that already existed, so memory,
 * edges, rumours, clocks and threads keep their one write path and no save needs migrating. */
{
  const s = makeState();
  const ev = actToEvent(s, ID.smith, {
    what: "Elara turned the charcoal man away at the door with nothing.",
    place: "Elara's Forge",
    opens_question: { title: "Where the charcoal went", description: "Somebody bought the whole burn before it reached her." },
  })!;
  const before = s.world.threads.length;
  applyOffstage(s, [ev]);

  check("the actor remembers her own afternoon",
    (s.memory[ID.smith]?.episodic ?? []).some((m) => m.content.includes("charcoal")), s.memory[ID.smith]);
  check("the boy who was standing there remembers seeing it",
    (s.memory[ID.boy]?.episodic ?? []).some((m) => m.content.includes("charcoal")), s.memory[ID.boy]);
  check("it is in the world's log", (s.world.offstage_log ?? []).some((e) => e.actor === "Elara"));
  check("a question the day left open became a thread", s.world.threads.length === before + 1);
}

/* ── 10. THE PLAYER'S HAND IS STILL NOT THE WORLD'S TO WRITE ────────────────────
 *
 * playerAuthored runs inside applyOffstage and does not care which pass produced the sentence, so
 * the guard that caught the forged bicycle design covers this path for free. */
{
  const s = makeState();
  const ev = actToEvent(s, ID.smith, {
    what: "Elara laid out the two rims Rabi sketched for her and found neither would true.",
    place: "Elara's Forge",
  })!;
  const log = applyOffstage(s, [ev]);
  check("an act that forges the player's signature is dropped",
    log.some((l) => l.includes("dropped an event")), log);
}

/* ── 11. THE WORLD PASS SURVIVES UNDERNEATH ─────────────────────────────────────
 *
 * Nobody in the cast is the weather. Every agency_world_ratio-th interval is still the omniscient
 * pass, so illness, a flood, a herd and the factions nobody stands in keep existing. */
{
  const s = makeState();
  check("off by default, and off means the world pass exactly as before",
    agencyTurn(s).actors === 0 && agencyTurn(s).worldPass === true);

  s.model_settings.agency_actors = 2;
  s.world.agency_passes = 0;
  check("the first interval after switching on is a world pass", agencyTurn(s).worldPass);
  s.world.agency_passes = 1;
  check("the next two belong to the cast", !agencyTurn(s).worldPass);
  s.world.agency_passes = 2;
  check("...both of them", !agencyTurn(s).worldPass);
  s.world.agency_passes = 3;
  check("and then the world again", agencyTurn(s).worldPass);

  s.model_settings.agency_world_ratio = 0;
  check("a ratio of zero retires the world pass", !agencyTurn(s).worldPass);

  s.model_settings.agency_actors = 99;
  check("the actor count is clamped however it was written", agencyTurn(s).actors === MAX_ACTORS);
}

/* ── 12. A BRIEF IS THE CHEAP HALF OF THE TRADE ─────────────────────────────────
 *
 * The cost argument in the module header is that a brief is small where a world digest grows with
 * the cast. If a brief ever stops being small the trade stops being a trade, so it is pinned. */
{
  const s = makeState();
  for (let i = 0; i < 30; i++) {
    const id = registerCharacter(s, { name: `Villager ${i}`, background: "Farms." } as any);
    s.characters[id].location = "loc_square";
    s.characters[id].drive = { goal: `Get the ${i}th field drained`, progress: 1, priority: 1, updated_turn: 1 };
  }
  const brief = actorBrief(s, ID.smith);
  check("thirty more people in the world do not enter her head",
    brief.length < 2000 && !brief.includes("Villager"), { chars: brief.length });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
