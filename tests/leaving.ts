/* Smoke test: THE PLAYER SAID THEY WERE GOING, SO THEY GO.
 *
 * Rainier Valley, turns 51 to 54: "I get up and start heading home", "I take the laptop and go home",
 * "Continue", "I take the elevator". Each turn's beat was ANSWER THE PLAYER, which tells the room to
 * "go on talking to the player about it" for the whole turn, and he ended up in the lobby of the
 * office he'd been leaving for four turns. A departure now gets its own beat, and a trip that hasn't
 * finished carries over to an action that only moves on. */
import { playerTrip, leavingBeat, playerHome } from "../src/engine/leaving";
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

check("home is the home-like place with the player's name on it", playerHome(s).id === "loc_house");

const t51 = playerTrip(s, `"She can ask her" I get up and start heading home`);
check("'start heading home' is a trip home", t51?.toId === "loc_house", t51);
const t52 = playerTrip(s, "I take the laptop and go home to work from home. I delete anything related to beacon works.");
check("'go home to work from home' is a trip home", t52?.toId === "loc_house", t52);
check("'I drive home' is a trip home", playerTrip(s, "I drive home.")?.toId === "loc_house");
check("a named place is a trip there", playerTrip(s, "I walk over to Juniper Cup and order a coffee")?.toId === "loc_cafe");
check("a place by car, even one the game doesn't track", playerTrip(s, "I drive her to the hospital")?.toName === "the hospital");
check("walking out of the building counts as leaving", playerTrip(s, "I grab my coat and walk out")?.toName === "");

check("'go back to work' is not a trip", playerTrip(s, "I toss the paperwork and go back to work") === null);
check("'walk to the window' is not a trip", playerTrip(s, "I walk to the window") === null);
check("'leave the note' is not leaving", playerTrip(s, "I leave the note on her desk") === null);
check("thinking about it isn't doing it", playerTrip(s, "I think about going home") === null);
check("a plan for later isn't now", playerTrip(s, "I'm going home after this meeting, I decide") === null);
check("saying it aloud isn't the act", playerTrip(s, `"Go home, Ellie." I sit back down.`) === null);
check("thoughts aren't the act", playerTrip(s, "*I should just go home* I keep typing.") === null);

// The carry-over: turn 52 said home, so "Continue" and "I take the elevator" finish it.
s.history = [{ turn: 52, player_action: "I take the laptop and go home to work from home." } as any];
const t53 = playerTrip(s, "Continue");
check("'Continue' carries the trip home", t53?.toId === "loc_house" && t53.carried === 52, t53);
check("so does 'I take the elevator'", playerTrip(s, `"No. Go talk to an engineer." I take the elevator`)?.carried === 52);
check("an action that's about something else doesn't", playerTrip(s, "I forward her questions to HR") === null);
s.world.player_location = "loc_house";
check("and once they're home, nothing carries", playerTrip(s, "Continue") === null);
check("'go home' at home is not a trip", playerTrip(s, "I go home") === null);
s.world.player_location = "loc_tower";

const beat = leavingBeat(s, t51!);
check("the beat says they go and get there", /They go, this turn, and they get there/.test(beat) && /arrived at Rabi and May's House/.test(beat), beat);
check("the people left behind don't hold them", /nobody blocks the way, holds onto them, follows them out/.test(beat));
check("nothing the player didn't type", /Nothing the player says or does on the way goes beyond what they typed/.test(beat));
check("the scene line names the destination", /names Rabi and May's House as the place/.test(beat));
check("a carried trip says when it was said", /On turn 52 the player said "take the laptop and go home"/.test(leavingBeat(s, t53!)));
check("the beat passes the prompt linter", lint(beat).length === 0, lint(beat));

const turn = readFileSync("src/engine/turn.ts", "utf8");
check("the turn uses the leaving beat ahead of ANSWER THE PLAYER", /const beatNote = trip\s*\? `[^`]*\$\{leavingBeat\(state, trip\)\}/.test(turn));
check("a held departure is counted", /noteFire\(state, "held"/.test(turn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
