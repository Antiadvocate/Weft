/* Smoke test: THE PLAYER SAID THEY WERE GOING, SO THEY GO.
 *
 * Rainier Valley, turns 51 to 54: "I get up and start heading home", "I take the laptop and go home",
 * "Continue", "I take the elevator". Each turn's beat was ANSWER THE PLAYER, which tells the room to
 * "go on talking to the player about it" for the whole turn, and he ended up in the lobby of the
 * office he'd been leaving for four turns. A departure now gets its own beat, and a trip that hasn't
 * finished carries over to an action that only moves on. */
import { playerTrip, leavingBeat, playerHome } from "../src/engine/leaving";
import { EMPTY_READ, tripUnderWay, type ActionRead } from "../src/engine/actionread";
import { newSave } from "../src/engine/state";
import { lint } from "../tools/promptlint";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s = newSave("Rainier Valley", { name: "Rainier Valley", era: "Contemporary Seattle" } as any);
s.characters["char_player"] = { id: "char_player", name: "Rabi" } as any;
for (const [id, name] of [["loc_house", "Rabi and May's House"], ["loc_tower", "Seattle Municipal Tower"], ["loc_alder", "Alder Span Engineering"], ["loc_cafe", "Juniper Cup"]]) {
  s.world.places[id] = { id, name } as any;
}
s.travel_log = [{ turn: 1, place: "loc_house" }, { turn: 14, place: "loc_tower" }];
s.world.player_location = "loc_tower";

/* What the player typed is read by the small model (actionread.ts); these hand the engine that read. */
const read = (r: Partial<ActionRead>): ActionRead => ({ ...EMPTY_READ, ...r, leaving: { ...EMPTY_READ.leaving, ...(r.leaving ?? {}) } });
const going = (to: string, place = "", home = false, did = `heads for ${to}`) => read({ did, leaving: { going: true, to, place, home } });

check("with nothing on record, home is just \"home\"", playerHome(s).id === undefined && playerHome(s).name === "home");
s.characters["char_player"].schedule = { home: "loc_house" } as any;
check("the player's schedule says where home is", playerHome(s).id === "loc_house");
delete (s.characters["char_player"] as any).schedule;

const t51 = playerTrip(s, going("home", "loc_house", true, "gets up and starts heading home"));
check("'start heading home', read as home, is a trip there", t51?.toId === "loc_house", t51);
check("…and the engine remembers which place is home", playerHome(s).id === "loc_house");
check("home without a place named still finds it once known", playerTrip(s, going("home", "", true))?.toId === "loc_house");
check("a named place is a trip there", playerTrip(s, going("Juniper Cup", "loc_cafe"))?.toId === "loc_cafe");
check("a place the game doesn't track keeps the player's words for it", playerTrip(s, going("the hospital"))?.toName === "the hospital");
check("walking out with nowhere named counts as leaving", playerTrip(s, going(""))?.toName === "");
check("a turn the read didn't call leaving isn't one", playerTrip(s, read({ did: "walks to the window" })) === null);

// The carry-over: turn 52 set off home, and the read of "Continue" says they carry on there.
s.history = [{ turn: 52, player_action: "I take the laptop and go home to work from home.", read: going("home", "loc_house", true, "takes the laptop and goes home") } as any];
check("the read is told about the trip under way", /A TRIP UNDER WAY: on turn 52 the player set off for Rabi and May's House \(loc_house\)/.test(tripUnderWay(s)), tripUnderWay(s));
const t53 = playerTrip(s, going("home", "loc_house", true, "takes the elevator down"));
check("carrying on finishes the trip, and says when it began", t53?.toId === "loc_house" && t53.carried === 52, t53);
s.world.player_location = "loc_house";
check("once they're home, nothing is under way", tripUnderWay(s) === "");
check("'go home' at home is not a trip", playerTrip(s, going("home", "loc_house", true)) === null);
s.world.player_location = "loc_tower";

const beat = leavingBeat(s, t51!);
check("the beat says they go and get there", /They go, this turn, and they get there/.test(beat) && /arrived at Rabi and May's House/.test(beat), beat);
check("the people left behind don't hold them", /nobody blocks the way, holds onto them, follows them out/.test(beat));
check("nothing the player didn't type", /Nothing the player says or does on the way goes beyond what they typed/.test(beat));
check("the scene line names the destination", /names Rabi and May's House as the place/.test(beat));
check("a carried trip says when it was said", /On turn 52 the player said "takes the elevator down"/.test(leavingBeat(s, t53!)), leavingBeat(s, t53!));
check("the beat passes the prompt linter", lint(beat).length === 0, lint(beat));

const turn = readFileSync("src/engine/turn.ts", "utf8");
check("the turn uses the leaving beat ahead of ANSWER THE PLAYER", /const beatNote = trip\s*\? `[^`]*\$\{leavingBeat\(state, trip\)\}/.test(turn));
check("a held departure is counted", /noteFire\(state, "held"/.test(turn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
