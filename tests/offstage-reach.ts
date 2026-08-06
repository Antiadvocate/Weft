/* Smoke test: THE BACKGROUND ACTUALLY REACHING THE STORY.
 *
 * The offstage pass simulates the world moving while nobody watches, and everything it produces is
 * supposed to enter play through witnesses → memories → rumors → gossip. Four separate breaks meant
 * none of it ever arrived: the world-sim was told nobody wanted anything, it never named a witness,
 * its clock steps missed on an exact-string compare, and the one log line that survived was crowded
 * out of the feed by drive bookkeeping.
 *
 * These pin each one. */
import { newSave, registerCharacter } from "../src/engine/state";
import { worldDigest, offstageDue, retireUnreachableClocks, OFFSTAGE_INTERVAL_TURNS } from "../src/engine/offstage";
import { regenerateDrives } from "../src/engine/drives";
import { rankOffscreen } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

function makeState(): SaveState {
  const state = newSave("offstage-test", {
    name: "Veridun", era: "medieval", technology_level: "iron", magic_rules: "none",
    forbidden: "", what_people_fear: "the tax men", cultures_and_languages: "common",
    climate_and_geography: "temperate", calendar_and_currency: "standard", political_situation: "strained",
  } as any);
  state.world.places["loc_forge"] = { id: "loc_forge", name: "Elara's Forge", description_facts: "", contains: [] };
  state.world.places["loc_square"] = { id: "loc_square", name: "The King's Square", description_facts: "", contains: [] };
  state.world.player_location = "loc_square";
  registerCharacter(state, { name: "Rabi", character_id: "char_player" } as any);

  const smith = registerCharacter(state, { name: "Elara", background: "A smith with rebel sympathies." } as any);
  state.characters[smith].location = "loc_forge";
  state.characters[smith].tracked = true;
  state.characters[smith].drive = { goal: "Finish a secret order of weapons for the northern rebels", progress: 20, priority: 1, updated_turn: 1 };

  // the ping-pong pair: two goals, both blocked, exactly the shape that thrashed every turn
  const lady = registerCharacter(state, { name: "Lady Marchess", background: "A noblewoman of the court." } as any);
  state.characters[lady].location = "loc_square";
  state.characters[lady].tracked = true;
  state.characters[lady].drive = { goal: "Return to the king and report what she saw", progress: 96, priority: 1, updated_turn: 1, blocker: "must find Rabi first" };
  state.characters[lady].drive_queue = [{ goal: "Stay silent and protect her house", progress: 10, priority: 1, updated_turn: 1, blocker: "the king will ask" }];

  // a witness standing where an offstage event will happen
  const priest = registerCharacter(state, { name: "Father Caelus", background: "Preaches against the grain tax." } as any);
  state.characters[priest].location = "loc_square";
  state.characters[priest].tracked = true;

  state.world.clocks.push({
    id: "clk_rebels", faction: "The Northern Rebels", objective: "Receive a shipment of weapons from Elara to arm their uprising.",
    segments: 6, filled: 0, consequence: "Open rebellion.", visible_signs: ["Strange men at the forge at odd hours."], status: "running",
  } as any);
  state.world.present = [];
  (globalThis as any).__ids = { smith, lady, priest };
  return state;
}

const ids = () => (globalThis as any).__ids;

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. the world-sim is told what the cast actually wants — it read forge-input field names that
 *    never exist on a live character, so every cast member reported "nothing pressing" */
{
  const s = makeState();
  const digest = worldDigest(s);
  check("cast wants reach the digest", digest.includes("Finish a secret order of weapons"), digest.split("\n").filter((l) => l.startsWith("- Elara")));
  check("no live character reports 'nothing pressing' while holding a drive",
    !/- (Elara|Lady Marchess).*nothing pressing/.test(digest));
  check("a blocker is reported as stuckness, not silence", digest.includes("Stuck on: must find Rabi first"));
  check("who-is-where is listed so witnesses can be named", /The King's Square: .*Father Caelus/.test(digest), digest);
  check("a clock that never moved is flagged", digest.includes("HAS NOT MOVED ONCE"));
  check("people positioned to move a clock are named", /In a position to move it: .*Elara/.test(digest), digest);
}

/* 2. the offstage interval has a turn floor — a story told in conversation burns almost no
 *    in-world time, so the clock alone froze the world for forty turns at a stretch */
{
  const s = makeState();
  s.world.offstage_last_time = s.world.current_time;
  s.world.offstage_last_turn = 0;
  s.world.current_turn = 5;
  check("not due a few turns in", !offstageDue(s));
  s.world.current_turn = OFFSTAGE_INTERVAL_TURNS;
  check("due on the turn floor even with the in-world clock barely moved", offstageDue(s));
}

/* 3. two blocked goals no longer ping-pong forever, burning the feed and progressing nothing */
{
  const s = makeState();
  const { lady } = ids();
  const lines: string[] = [];
  for (let t = 1; t <= 20; t++) { s.world.current_turn = t; lines.push(...regenerateDrives(s, () => 0.5)); }
  const swaps = lines.filter((l) => l.includes("sets aside")).length;
  check("blocked pair does not thrash every turn", swaps <= 2, `${swaps} swaps in 20 turns`);
  check("she stays on a goal she can't act on rather than trading it for another she can't act on",
    !!s.characters[lady].drive?.goal, s.characters[lady].drive);

  // an unblocked backup IS still a real reason to move on
  const s2 = makeState();
  const l2 = ids().lady;
  s2.characters[l2].drive_queue = [{ goal: "Bring in the pears before the frost", progress: 0, priority: 1, updated_turn: 1 }];
  s2.world.current_turn = 6;
  const log = regenerateDrives(s2, () => 0.5);
  check("an unblocked backup is promoted", log.some((l) => l.includes("sets aside")), log);
}

/* 4. the offscreen feed shows the world moving before it shows the engine shuffling goals */
{
  const noise = [
    `Lady Marchess sets aside "A" and turns to: B.`,
    `Angeline sets aside "C" and turns to: D.`,
    `King Aldric III works toward "E" (22%)`,
    `Osric sets aside "F" and turns to: G.`,
    `Marta: bruised — faded.`,
    `Andrea turns to something new: H.`,
    `Elsewhere: the barge master cast off before the mist burned away.`,
    `SIGN (The Northern Rebels): Strange men at the forge at odd hours.`,
    `The Northern Rebels moved closer to their objective.`,
    `Father Caelus got what they wanted: organize the protest. It shows.`,
  ];
  const top = rankOffscreen(noise).slice(0, 6);
  check("world motion makes the feed", top.some((l) => l.startsWith("Elsewhere:")), top);
  check("a clock sign makes the feed", top.some((l) => l.startsWith("SIGN (")), top);
  check("a completed want makes the feed", top.some((l) => l.includes("got what they wanted")), top);
  check("goal-shuffling is last, not first", !top[0].includes("sets aside"), top[0]);
  check("ranking is stable, not lossy", rankOffscreen(noise).length === noise.length);
}

/* 5. a clock waiting on someone who left the story is retired, not frozen at 0/6 forever */
{
  const s = makeState();
  const { smith } = ids();
  s.characters[smith].status = "departed";        // the player sent Elara away
  const before = s.world.clocks[0];
  check("clock still running before the sweep", before.status === "running" && before.filled === 0);
  const log = retireUnreachableClocks(s);
  check("a clock whose objective names someone gone is retired", s.world.clocks[0].status === "stalled", s.world.clocks[0]);
  check("the retirement is reported, not silent", log.length === 1, log);
  check("the objective becomes ordinary business", /ordinary business/.test(s.world.clocks[0].objective));

  // a clock that has actually moved is never retired out from under the story
  const s2 = makeState();
  s2.characters[ids().smith].status = "departed";
  s2.world.clocks[0].filled = 3;
  retireUnreachableClocks(s2);
  check("a clock already in motion is left alone", s2.world.clocks[0].status === "running");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
