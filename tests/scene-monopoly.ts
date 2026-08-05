/* Smoke test: ONE CHARACTER CANNOT BECOME THE WHOLE CAST.
 *
 * In a 154-turn save every tracked character's goal named the protagonist, every one of them was
 * blocked on "must find Rabi first", none of them could move, and the single NPC who happened to be
 * standing in the room when the paging pass ran became the only person capable of appearing in a
 * scene again — for twenty-plus consecutive turns, at warmth -12.
 *
 * Four mechanisms conspired: the anti-chorus dispersion system went dead when the undertow was
 * retired, paging was a one-way latch, a pursuit blocker never caused actual pursuit, and a goal
 * whose only content is the player steered scenes as readily as one with a life behind it. */
import { newSave, registerCharacter } from "../src/engine/state";
import { magnetPull } from "../src/engine/drives";
import { updatePaging, replanDrives, ARRIVAL_PATIENCE } from "../src/engine/turn";
import { stampFor, describeStamp, SCHEMA_VERSION } from "../src/engine/version";
import type { SaveState } from "../src/engine/types";

function makeState(): SaveState {
  const state = newSave("monopoly-test", {
    name: "Veridun", era: "medieval", technology_level: "iron", magic_rules: "none",
    forbidden: "", what_people_fear: "the tax men", cultures_and_languages: "common",
    climate_and_geography: "temperate", calendar_and_currency: "standard", political_situation: "strained",
  } as any);
  state.world.places["loc_estate"] = { id: "loc_estate", name: "Thornwood Estate", description_facts: "", contains: [] };
  state.world.places["loc_gate"] = { id: "loc_gate", name: "Thornwood Gate", description_facts: "", contains: [] };
  state.world.places["loc_castle"] = { id: "loc_castle", name: "Osric's Castle", description_facts: "", contains: [] };
  state.world.player_location = "loc_estate";
  registerCharacter(state, { name: "Rabi", character_id: "char_player" } as any);
  state.characters["char_player"].location = "loc_estate";

  // the incumbent: in the room, cold, and wanting nothing but the player
  const cap = registerCharacter(state, { name: "Angeline" } as any);
  state.characters[cap].location = "loc_estate";
  state.characters[cap].tracked = true;
  state.characters[cap].drive = { goal: "Protect Rabi and enforce his will.", progress: 68, priority: 0, updated_turn: 1 };
  state.world.edges.push({ from: cap, to: "char_player", warmth: -12, trust: -10, power: 0, notes: "", updated_turn: 1 });

  // the wife, paged out of her own marriage: 39 turns unseen, bond just under the old floor
  const wife = registerCharacter(state, { name: "Andrea" } as any);
  state.characters[wife].location = "loc_gate";
  state.characters[wife].tracked = true;
  state.characters[wife].drive = { goal: "Prove her worth to Rabi by managing Thornwood without his oversight.", progress: 34, priority: 0, updated_turn: 1 };
  state.world.edges.push({ from: wife, to: "char_player", warmth: 22.15, trust: 14.48, power: 0, notes: "", updated_turn: 1, roles: ["wife"] });

  const rival = registerCharacter(state, { name: "Osric" } as any);
  state.characters[rival].location = "loc_castle";
  state.characters[rival].tracked = true;
  state.characters[rival].drive = { goal: "Learn what Rabi is before agreeing to meet him at the border.", progress: 28, priority: 0, updated_turn: 1 };
  state.world.edges.push({ from: rival, to: "char_player", warmth: -9, trust: -4, power: 0, notes: "", updated_turn: 1 });

  state.world.present = [cap];
  (globalThis as any).__ids = { cap, wife, rival };
  return state;
}

const ids = () => (globalThis as any).__ids;

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. the chorus magnet is measured again — it was hardcoded to 0 when the undertow was retired */
{
  const s = makeState();
  const m = magnetPull(s);
  check("a cast entirely aimed at one person registers as a magnet", m.sharedTarget === "char_player", m);
  check("dispersion is high enough to arm the self-interest tail", m.dispersion >= 0.4, m.dispersion);

  // an ensemble with their own lives is not a chorus
  const s2 = makeState();
  s2.characters[ids().wife].drive = { goal: "Bring in the pears before the frost", progress: 0, priority: 0, updated_turn: 1 };
  s2.characters[ids().rival].drive = { goal: "Settle the boundary dispute with the weavers", progress: 0, priority: 0, updated_turn: 1 };
  const m2 = magnetPull(s2);
  check("a spread-out cast is not flagged", m2.dispersion < 0.4, m2);
}

/* 2. paging is no longer a one-way latch, and the bond floor counts stated relationships */
{
  const s = makeState();
  const { wife, rival, cap } = ids();
  s.world.current_turn = 154;
  s.telemetry = [{ turn: 115, present: [wife] }, { turn: 101, present: [rival] }, { turn: 153, present: [cap] }] as any;
  updatePaging(s, "I surf");
  check("the player's wife is not paged out of her own marriage", !s.characters[wife].paged, s.characters[wife]);
  check("a cold, long-absent rival still pages out", s.characters[rival].paged === true);
  check("the character in the room stays loaded", !s.characters[cap].paged);

  // a paged character who walks back into the player's location wakes on arrival
  const s2 = makeState();
  s2.world.current_turn = 154;
  s2.telemetry = [{ turn: 101, present: [ids().rival] }] as any;
  updatePaging(s2, "");
  check("paged while away", s2.characters[ids().rival].paged === true);
  s2.characters[ids().rival].location = "loc_estate";     // they arrived
  updatePaging(s2, "");
  check("arriving at the player's location wakes them", !s2.characters[ids().rival].paged);
}

/* 3. "must find Rabi first" now causes someone to actually arrive */
{
  const s = makeState();
  const { wife } = ids();
  s.world.current_turn = 20;
  s.telemetry = [{ turn: 1, present: [wife] }] as any;   // long unseen → pursuit blocker
  replanDrives(s);
  check("pursuit blocker is set", /must find Rabi first/.test(s.characters[wife].drive?.blocker ?? ""), s.characters[wife].drive);
  check("nobody teleports the instant the blocker appears", s.characters[wife].location === "loc_gate");

  // ...and after the patience window, the walk happens
  s.world.current_turn = 20 + ARRIVAL_PATIENCE;
  replanDrives(s);
  const arrived = [ids().wife, ids().rival].filter((id) => s.characters[id].location === "loc_estate");
  check("someone who has been looking for a while reaches the player", arrived.length === 1, arrived.map((i) => s.characters[i].name));
  check("they arrive awake, not paged", !s.characters[arrived[0]].paged);
  check("it is a trickle, not the whole cast at once", arrived.length < 2);
}

/* 4. save exports carry provenance */
{
  const stamp = stampFor(154);
  check("stamp carries the schema version", stamp.schema === SCHEMA_VERSION);
  check("stamp carries the turn", stamp.turn === 154);
  check("a stamped save reads back", /schema \d+/.test(describeStamp(stamp)), describeStamp(stamp));
  check("an unstamped save is identified as pre-provenance", /unstamped/.test(describeStamp(undefined)));
  check("an older schema is called out against this build",
    /this build is schema/.test(describeStamp({ ...stamp, schema: 1 })), describeStamp({ ...stamp, schema: 1 }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
