/* Smoke test: THE PERSON WHO WON'T LEAVE.
 *
 * Rainier Valley, chapter two, the fifth story to end the same way. A coworker the player had told to
 * get out, called a stalker and had arrested ended with warmth -32, trust -75 and attraction 68 toward
 * him, a want reading "find out what Rabi is really doing", no record of custody, and an engine that
 * put anyone whose want named the player back in the world AT the player's location. Six fixes:
 * returns never land on the player, custody the player writes holds, being turned away lowers
 * attraction and takes the pursuit off, the sifter respects a gentle tone and won't cast a wife as a
 * rival, "drop it" drops it, and an instruction about the story isn't played as an action. */
import { returnFromOffscene } from "../src/engine/offstage";
import { recordCustody } from "../src/engine/exit";
import { rejectedBy, applyRejection, keepsAway, backfillRejections, sweepPursuit, isPartner, namesPlayer } from "../src/engine/rejection";
import { seedDrive } from "../src/engine/drives";
import { siftStory, siftSituations, allowedHere } from "../src/engine/sift";
import { dropItLine, dropItBeat, recordDropped, droppedNote } from "../src/engine/dropit";
import { storyInstruction } from "../src/engine/instruction";
import { newSave } from "../src/engine/state";
import { lint } from "../tools/promptlint";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(tone = "Slice of life", forbidden: string[] = ["Sudden relationship betrayal"]) {
  const s = newSave("Rainier Valley", { name: "Rainier Valley", era: "Contemporary Seattle", tone, forbidden_as_primary: forbidden } as any);
  for (const [id, name] of [["loc_house", "Rabi and May's House"], ["loc_tower", "Seattle Municipal Tower"], ["loc_park", "Seward Park"], ["loc_ellie", "Ellie's Apartment"]]) {
    s.world.places[id] = { id, name, contains: [] } as any;
  }
  s.world.places["loc_offscene"] = { id: "loc_offscene", name: "elsewhere", contains: [] } as any;
  s.world.player_location = "loc_house";
  s.characters = {
    char_player: { character_id: "char_player", name: "Rabi", location: "loc_house" },
    char_may: { character_id: "char_may", name: "May", location: "loc_house" },
    char_ellie: { character_id: "char_ellie", name: "Ellie Navarro", location: "loc_offscene", offscene_since: 1, drive: { goal: "find out what Rabi is really doing", progress: 0 }, drive_queue: [{ goal: "get Rabi alone somewhere" }, { goal: "finish her own capacity review" }] },
    char_sonia: { character_id: "char_sonia", name: "Sonia Vale", location: "loc_tower" },
  } as any;
  s.world.canon = ["Rabi and May are consenting adult spouses who have been married for several years."];
  s.world.edges = [
    { from: "char_may", to: "char_player", warmth: 40, trust: 40, power: 0, attraction: 78 },
    { from: "char_ellie", to: "char_player", warmth: 30, trust: 10, power: 0, attraction: 68 },
    { from: "char_sonia", to: "char_may", warmth: 0, trust: 0, power: 0, attraction: 56 },
  ] as any;
  s.world.present = ["char_may"];
  s.world.current_turn = 12;
  return s;
}

// ── 1. never onto the player ──
{
  const s = world();
  for (let i = 0; i < 20; i++) {
    s.characters.char_ellie.location = "loc_offscene"; (s.characters.char_ellie as any).offscene_since = 1;
    returnFromOffscene(s);
    if (s.characters.char_ellie.location === s.world.player_location) break;
  }
  check("someone whose want names the player comes back somewhere, never onto the player", s.characters.char_ellie.location !== "loc_house" && s.characters.char_ellie.location !== "loc_offscene", s.characters.char_ellie.location);
  const t = world();
  t.world.player_location = "loc_ellie";
  t.characters.char_ellie.location = "loc_offscene"; (t.characters.char_ellie as any).offscene_since = 1;
  returnFromOffscene(t);
  check("...except into their own home when the player's in it and they don't hold a grudge", t.characters.char_ellie.location === "loc_ellie", t.characters.char_ellie.location);
  const off = readFileSync("src/engine/offstage.ts", "utf8");
  check("the old 'wants the player, goes to the player' rule is gone", !/wantsThePlayer \|\| \(bond && !grudge\) \? state\.world\.player_location/.test(off));
}

// ── 2. custody the player writes holds ──
{
  const s = world();
  s.history = [{ turn: 11, player_action: "Police arrive and arrest Ellie for trespassing. Rabi files charges", narrator_prose: "The officer cuffs her wrists behind her back." } as any];
  check("an arrest the player wrote holds someone who's gone", recordCustody(s, "", ". Ellie will be held for 90 days without bond until court case", 12).includes("Ellie Navarro") && !!s.characters.char_ellie.held);
  check("and a held person isn't put back in the world", (() => { s.world.current_turn = 40; returnFromOffscene(s); return s.characters.char_ellie.location === "loc_offscene"; })());
  const t = world();
  t.characters.char_ellie.location = "loc_house";
  check("someone still in the room isn't held by a word near their name", recordCustody(t, "Ellie says she was arrested once, in college.", "", 12).length === 0 && !t.characters.char_ellie.held);
  const u = world();
  check("a quoted threat isn't an arrest", recordCustody(u, "", `"I'll have Ellie arrested," I say.`, 12).length === 0);
}

// ── 3. no means no ──
{
  const s = world();
  s.world.present = ["char_may", "char_ellie"];
  check("'leave me alone' turns away whoever in the room wants the player", JSON.stringify(rejectedBy(s, `"Leave me alone." I go upstairs.`, s.world.present)) === JSON.stringify(["char_ellie"]));
  check("the player's wife isn't turned away by an angry line", !rejectedBy(s, `"Fuck off, May, I'm going for a walk."`, s.world.present).includes("char_may"));
  check("she is by 'I want a divorce'", rejectedBy(s, `"May, I want a divorce."`, s.world.present).includes("char_may"));
  check("'call the cops' counts only with a name", rejectedBy(s, "Do I need to call the cops?", s.world.present).length === 0 && rejectedBy(s, "Ellie Navarro has been harassing me. I'm calling the police.", s.world.present).includes("char_ellie"));
  check("a fire isn't a rejection", rejectedBy(s, `"Get out, the kitchen's on fire!"`, s.world.present).length === 0);
  check("the wife is recognised from canon alone", isPartner(s, "char_may") && !isPartner(s, "char_ellie"));

  const lines = applyRejection(s, ["char_ellie"], 12);
  const e = s.world.edges.find((x) => x.from === "char_ellie" && x.to === "char_player") as any;
  check("attraction steps down", e.attraction === 53 && e.rejected?.count === 1, e);
  check("wants aimed at the player go, and their own want takes over", s.characters.char_ellie.drive?.goal === "finish her own capacity review" && !(s.characters.char_ellie.drive_queue ?? []).some((d: any) => /rabi/i.test(d.goal)), s.characters.char_ellie.drive);
  check("the player is told it registered", /Ellie Navarro heard you/.test(lines.join(" ")));
  check("they keep away", keepsAway(s, "char_ellie"));
  const seeds = new Set<string>(); for (let i = 0; i < 300; i++) seeds.add(seedDrive(s, "char_ellie")!.goal);
  check("the seeder never offers them a want about the player", ![...seeds].some((g) => namesPlayer(s, g)), [...seeds]);
  (s.characters.char_ellie as any).drive = { goal: "get back in front of Rabi and make them deal with it" };
  check("and the sweep takes one off if it turns up", sweepPursuit(s).includes("Ellie Navarro") && !s.characters.char_ellie.drive);
  s.world.edges.push({ from: "char_player", to: "char_ellie", warmth: 20, trust: 10, power: 0 } as any);
  check("it lifts when the player warms to them", !keepsAway(s, "char_ellie") && !e.rejected);

  const old = world();
  old.history = [
    { turn: 15, player_action: "Hey so why the fuck are you in my house?", present: ["char_may", "char_ellie"] },
    { turn: 17, player_action: "Bob, Ellie Navarro has been harassing me.", present: ["char_may", "char_ellie"] },
    { turn: 21, player_action: "She's harassing me. I need a protection order. Her name is Ellie Navarro.", present: ["char_may", "char_ellie"] },
  ] as any;
  check("a save from before this reads its own history, once", JSON.stringify(backfillRejections(old)) === JSON.stringify(["char_ellie"]) && (old.world.edges.find((x) => x.from === "char_ellie") as any).rejected.count === 2 && backfillRejections(old).length === 0);
  check("desire doesn't grow toward the player for someone turned away", /!\(e as any\)\.rejected && e\.warmth >= 20/.test(readFileSync("src/engine/desire.ts", "utf8")));
  check("the forge and the bookkeeper don't hand it back", /keepsAway\(state, id\) && namesPlayer\(state, goal\)/.test(readFileSync("src/engine/driveforge.ts", "utf8")) && /keepsAway\(state, id\) && namesPlayer\(state, du\.goal\)/.test(readFileSync("src/engine/turn.ts", "utf8")));
  check("a time skip doesn't bring them home either", /filter\(\(x\) => !keepsAway\(state, x\)\)/.test(readFileSync("src/engine/continuity.ts", "utf8")));
}

// ── 4. the sifter and the story's tone ──
{
  const s = world();
  s.world.edges.push({ from: "char_sonia", to: "char_player", warmth: 0, trust: 0, power: 0, attraction: 50 } as any);
  check("the wife is never one of two rivals", !siftSituations(s).some((x) => x.pattern === "rivals"));
  s.world.threads = [{ id: "t1", title: "Sonia Vale wants May, who wants Rabi", status: "active", kind: "relationship", sifted: "triangle:char_sonia:char_may:char_player", tension: 4, turn_started: 2 } as any];
  const log = siftStory(s, 12);
  check("in a slice-of-life story a live romantic thread is set aside", s.world.threads[0].status === "abandoned" && /isn't about that/.test(log.join(" ")), log);
  check("and no new one opens", !s.world.threads.some((t) => t.sifted && t.status === "active" && /wants/.test(t.title)));
  const tri = { key: "triangle:a:b:c", pattern: "triangle", who: ["a", "b", "c"], title: "", next: "", ripeness: 1 };
  check("a thriller still gets its triangles", allowedHere(world("Noir thriller", []), tri) && !allowedHere(world("Drama", ["Affairs"]), tri));
  check("friendship gone sour is still allowed in slice of life", allowedHere(s, { ...tri, pattern: "one-sided" }));
}

// ── 5. drop it ──
{
  const t9 = `"Holy mother of idiots. You NEED TO ASK ELLIE ITS HER PROJECT I am exasperated do you fucking understand? I swear to god I'm leaving this house if you ask me another question related to this"`;
  const line = dropItLine(t9);
  check("'if you ask me another question' closes the subject", /if you ask me another question/.test(line), line);
  check("so does 'it's not my project'", !!dropItLine(`"No. It's not my project."`) && !dropItLine("I read the email."));
  const beat = dropItBeat(line);
  check("the beat drops it", /drop it, so nobody asks about it again/.test(beat) && lint(beat).length === 0, lint(beat));
  const s = world();
  s.history = [{ turn: 8, summary: "May asked who should be the primary contact for Beacon Works." } as any];
  recordDropped(s, line, 9);
  s.world.current_turn = 10;
  const note = droppedNote(s, "I make coffee.");
  check("the next turns are reminded the subject is closed", /A SUBJECT THE PLAYER CLOSED/.test(note) && /primary contact for Beacon Works/.test(note) && lint(note).length === 0, note);
  s.world.current_turn = 14;
  check("for four turns", droppedNote(s, "I make coffee.") === "");
  s.world.current_turn = 11;
  check("or until the player raises it again", droppedNote(s, "Who is the primary contact for Beacon Works anyway?") === "");
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("the turn uses it ahead of ANSWER THE PLAYER", /: dropLine\s*\? `[^`]*\$\{dropItBeat\(dropLine\)\}/.test(turn) && /droppedNote\(state, action\)/.test(turn));
}

// ── 6. an instruction about the story ──
{
  const t14 = "Rabi's not the point of contact. Ellie is. Change the story to adjust. Remove beacon works from Rabi and anything having to do with it should no longer appear in the story.";
  const i = storyInstruction(t14);
  check("turn 14 is read as an instruction, with what to wipe and what's true", !!i && i.terms === "beacon works" && i.correction === "Rabi's not the point of contact. Ellie is.", i);
  check("play isn't", storyInstruction("I go home and take a shower.") === null && storyInstruction(`"Change the story, May." I sit down.`) === null && storyInstruction("I remove the batteries from the remote.") === null);
  check("the Play view offers the tools before sending", /const found = storyInstruction\(a\);\s*if \(found\) \{ setInstr/.test(readFileSync("src/views/Play.tsx", "utf8")));
}

// ── 4b. a new chapter can leave things behind ──
{
  const api = readFileSync("src/lib/api.ts", "utf8");
  check("the fork wipes what the player leaves behind before the forge reads it", /forkNewSeason: async \(id: string, direction\?: string, leaveBehind\?: string\)[\s\S]{0,900}nukeStoryline\(s, String\(leaveBehind\)\)/.test(api));
  check("and carries the guard and the rejection marks into the new chapter", /ns\.world\.nuked = /.test(api) && /rejected: \(prevEdge as any\)\.rejected/.test(api));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
