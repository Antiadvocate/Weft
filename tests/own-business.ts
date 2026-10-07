/* WHAT THE PLAYER SAID IS THEIRS, AND WHICH OF THE WORLD'S QUESTIONS ARE.
 *
 * "I explained my job to Ellie. The system still pushes Beacon Works as a thing I need to be aware
 *  of. This is not how project management works."  ... "Option C." (both halves)
 *
 * Rainier Valley. At T94 Rabi says "I am not on Beacon Works ... my list is 37 projects" and five
 * turns later nothing holds it. The pressure picker pressed his scenes with the hottest open
 * question in the world, whoever's it was: Andre's switchgear key, Sonia's unsent email. Threads
 * below are the save's own, at turn 127. See engine/own.ts.
 */
import { readFileSync } from "node:fs";
import { recordSelfStated, selfStatedLine, threadReachesPlayer, threadsThatReach } from "../src/engine/own";
import { simulatorSchemaHint } from "../src/engine/prompts";
import type { SaveState, Thread } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const T = (title: string, description: string, status: Thread["status"] = "active"): Thread =>
  ({ id: title, title, description, status, tension: 4, turn_started: 1 } as Thread);
const THREADS = [
  T("The double-booked Tuesday at Beacon Works", "Rabi declined the conflicting walkthrough invite, insisting on a delay, while Ellie offered to cover a riser walkthrough on Thursday.", "dormant"),
  T("The key log line nobody has answered", "Andre has signed himself out a key that was never handed to him, and the facilities desk is still empty.", "dormant"),
  T("Who took Andre's sheet off the switchgear door?", "Andre's dated notice taped across the Beacon Works basement switchgear door was removed sometime between dawn and 16:57 on Day 3 and left face-down on the floor.", "dormant"),
  T("Whether Sonia answers the email or waits for Thursday", "May's request is now on the record with the office manager copied. Either Sonia replies with a yes or a no before Thursday, or she lets it sit.", "dormant"),
  T("The draft waiting to be sent", "Ellie has a checklist email to Rabi written and unsent, timed for morning."),
];
const world = (present: string[], at: string): SaveState => ({
  characters: {
    char_player: { name: "Rabi", pronouns: "he/him" },
    char_may: { name: "May" }, char_ellie: { name: "Ellie Navarro" }, char_sonia: { name: "Sonia Vale" }, char_andre: { name: "Andre Sol" },
  },
  world: {
    current_turn: 127, present: ["char_player", ...present], player_location: at, threads: JSON.parse(JSON.stringify(THREADS)),
    places: { loc_house: { id: "loc_house", name: "Rabi and May's House" }, loc_tower: { id: "loc_tower", name: "Seattle Municipal Tower" }, loc_bw: { id: "loc_bw", name: "Beacon Works" } },
  },
} as unknown as SaveState);
const titles = (st: SaveState) => threadsThatReach(st).map((t) => t.title);

/* ── 1. on the sofa with May ─────────────────────────────────────────────────── */
{
  const st = world(["char_may"], "loc_house");
  const r = titles(st);
  check("Andre's key does not press on Rabi's sofa", !r.includes("The key log line nobody has answered"), r);
  check("...nor Andre's sheet on the switchgear door", !r.includes("Who took Andre's sheet off the switchgear door?"), r);
  check("May's email to Sonia can: May is in the room", r.includes("Whether Sonia answers the email or waits for Thursday"), r);
  check("a thread that names Rabi always can", r.includes("The double-booked Tuesday at Beacon Works") && r.includes("The draft waiting to be sent"), r);
}

/* ── 2. it reaches him when the people or the place do ───────────────────────── */
{
  check("Andre's key reaches Rabi when Andre is standing there", threadReachesPlayer(world(["char_andre"], "loc_tower"), THREADS[1]));
  check("the switchgear sheet reaches him at Beacon Works", threadReachesPlayer(world([], "loc_bw"), THREADS[2]));
  check("Sonia's email doesn't reach him at the office without May or Sonia", !threadReachesPlayer(world(["char_ellie"], "loc_tower"), THREADS[3]));
}

/* ── 3. what he said about his own job stands ───────────────────────────────── */
{
  const st = world([], "loc_tower");
  const added = recordSelfStated(st, ["Rabi is a project manager, not an engineer, and Beacon Works is not his project.", "Rabi has 37 projects on his list."], 94);
  check("both statements are filed", added.length === 2 && (st.characters.char_player as any).self_stated.length === 2);
  const line = selfStatedLine(st);
  check("the card says it", /Beacon Works is not his project/.test(line) && /37 projects/.test(line), line);
  check("...as true until he says otherwise", /stays true until Rabi says otherwise/.test(line));
  check("...and that nobody hands him work he disowned", /Nobody hands Rabi work, files, duties or ownership that Rabi has said aren't Rabi's/.test(line));
  recordSelfStated(st, ["Rabi took over Beacon Works from Ellie as its project manager."], 130);
  const after = (st.characters.char_player as any).self_stated.map((s: any) => s.text).join(" | ");
  check("a later statement on the same subject replaces the old one",
    /took over Beacon Works/.test(after) && !/Beacon Works is not his project/.test(after) && /37 projects/.test(after), after);
  check("junk is ignored", recordSelfStated(world([], "loc_tower"), ["", "ok", null], 1).length === 0);
  check("nothing said, nothing on the card", selfStatedLine(world([], "loc_tower")) === "");
}

/* ── 4. the bookkeeper is asked for it, and both narrators show it ─────────── */
{
  check("the bookkeeper's schema asks for player_self", /"player_self":\["Only when the player's character said something this turn about their own life/.test(simulatorSchemaHint()));
  const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
  const plain = readFileSync(new URL("../src/engine/plain.ts", import.meta.url), "utf8");
  check("the plain narrator's player card carries it", /function playerCard[\s\S]{0,1200}selfStatedLine\(state\)/.test(plain));
  check("the directed turn carries it", (src.match(/\$\{ownNote\}/g) ?? []).length === 2);
  check("the pressure picker only sees threads that reach the scene", /threads: reaching,[^\n]*\n[^\n]*instability/.test(src) && /threads: reaching, clocks/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
