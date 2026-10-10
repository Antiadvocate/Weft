/* Smoke test: THE WEB SEARCH LOOKS FOR THE QUESTION, NOT THE PEOPLE.
 *
 * With grounding on and no ((target)), the query used to be the location's internal id plus the two
 * newest canon lines, which in a Seattle City Light save were about Rabi and May's marriage. So a turn
 * that spelled out what an Electric Service Engineer does went searching for the couple. The query is
 * now built from the turn: its questions, else what it says, with the real place and the setting. */
import { turnSearchQuery } from "../src/engine/grounding";
import { newSave } from "../src/engine/state";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s = newSave("Rainier Valley", { name: "Rainier Valley", era: "Contemporary Seattle, early June" } as any);
s.world.places["loc_muvkzoeki2za2"] = { id: "loc_muvkzoeki2za2", name: "Seattle Municipal Tower" } as any;
s.world.player_location = "loc_muvkzoeki2za2";
s.world.canon = [
  "May is less comfortable than Rabi with abstract logic and prefers concrete examples.",
  "Affection does not give either spouse access to the other's thoughts.",
];

const t55 = `I forward her questions on my phone to SCL HR. *please see my coworkers question. Her job is an ese. Which as far as I know is: At Seattle City Light (SCL), an ESE stands for Electric Service Engineer (or Electrical Service Engineer).
While Electric Service Representatives (ESRs) typically handle residential and smaller commercial connections (under 1 MW), ESEs provide professional engineering direction for large, complex electric service installations.`;
const q55 = turnSearchQuery(s, t55);
check("the query is about the job, not the marriage", /Electric Service Engineer|ESE/.test(q55) && !/May|Rabi|spouse|abstract logic/.test(q55), q55);
check("the player's own stage direction is left out", !/^I forward/.test(q55), q55);
check("the place is named, never its id", /Seattle Municipal Tower/.test(q55) && !/loc_/.test(q55), q55);
check("the setting rides along", /Contemporary Seattle/.test(q55), q55);
check("it stays a search, not an essay", q55.length <= 260, q55.length);

const asked = turnSearchQuery(s, `"Ellie, who actually signs off on the load review for a 2 MW service at City Light?" I lean on the desk.`);
check("a question asked in the turn is what gets searched", /^Ellie, who actually signs off on the load review/.test(asked), asked);

check("director lines and an explicit target are not in it", !/\[\[|\(\(/.test(turnSearchQuery(s, "[[make it rain]] What does an ESR do? ((SCL ESR duties))")));
check("an empty turn searches for nothing", turnSearchQuery(s, "   ") === "");
check("a turn that is only stage direction still searches for something", turnSearchQuery(s, "I take the elevator").startsWith("I take the elevator"));

const turn = readFileSync("src/engine/turn.ts", "utf8");
check("play uses it when grounding is on", /opts\?\.ground === true \? turnSearchQuery\(state, action\)/.test(turn));
check("the old id-plus-canon query is gone", !/\[state\.world\.player_location, \.\.\.\(state\.world\.canon/.test(turn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
