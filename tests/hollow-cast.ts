/* NOBODY IN THE HOUSE WANTED ANYTHING THAT PREDATED THE PLAYER'S LAST SENTENCE.
 *
 * "Toddlers that talk like adults. Idiocracies where they keep repeating everything I do instead of
 *  sounding human. People that are just... boxes of wasting tokens. Have zero actual thoughts."
 *
 * Turn 21 of the Fernhaven save. The player had made a dog the turn before. Every want in the house:
 *
 *   Ivy, 7      "Teach Ruff the names of the deer herd."          — Ruff is ONE TURN OLD
 *   Felicity    "Adjust to the new domestic boundaries Rabi has set."
 *   Wren, 1     "Get closer to Gordon the deer"
 *   Ruff, new   "Find and close the gap in the garden boundary..."
 *
 * Not one of them wants anything from their own life. Every drive was rewritten, that turn, into a
 * restatement of what the player had just done — so every line any of them spoke was a paraphrase of
 * it too. Ivy's dialogue across three turns is almost entirely readback: "You said dog. You didn't
 * say maybe or we'll see or ask your mama. You said dog." / "Guard dog, child care specialist,
 * genius. That's three things. And adorable. That's four." Felicity: "You said a dog and I was
 * picturing a dog." The room has no interior because nobody in it wants anything.
 *
 * THE FORGE WRITES DRIVES CAREFULLY. Its guidance runs to a paragraph — "WANTS ARE THINGS THEY DO,
 * NOT THINGS THEY ASK FOR ... write wants the person can advance BY THEIR OWN ACTION". The
 * bookkeeper then overwrites them every turn, and its schema for the field was, in full:
 *
 *     "drives_update":[{"char_id":"","goal":"","progress":0,"blocker":"","priority":1}]
 *
 * Nothing about what a drive is. Nothing about when one should change. So it wrote down whatever had
 * just happened, every turn, for everybody.
 *
 * AND TWO TURNS OPENED BY PRINTING THE PLAYER'S OWN TYPED LINE BACK AT THEM, verbatim, in quotes,
 * before any prose at all — against a law that says so in as many words: "quotes are ... ALREADY
 * SAID — never write the line out again, open on it, or have anyone repeat it back."
 */
import { stripOpeningPlayerLine } from "../src/engine/echo";
import { stablePrefix, SIMULATOR_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const F = JSON.parse(readFileSync("tests/fixtures/hollow-cast.json", "utf8"));
const SRC = readFileSync("src/engine/turn.ts", "utf8");
const st = () => ({
  characters: JSON.parse(JSON.stringify(F.characters)),
  world: { places: JSON.parse(JSON.stringify(F.places)), present: [], current_turn: 22, canon: [], edges: [], threads: [], clocks: [], consequences: [], rumors: [], norms: [], player_location: "loc_mtjwnb1edt4lj", current_time: "Day 3, 19:00", weather: "clear" },
  world_bible: { name: "Fernhaven", era: "now", tone: "Love, romance, erotica, slice of life", difficulty_profile: {} },
  condition: {}, traits: {}, memory: {}, minds: {}, history: [], model_settings: {}, records: [], habits: [], chapters: [],
} as unknown as SaveState);

/* ── 1. the state that produced it ───────────────────────────────────────────── */
{
  const C = (n: string) => Object.values(F.characters).find((c: any) => c.name === n) as any;
  check("Ivy's want is about a dog one turn old", /Ruff/.test(C("Ivy").drive.goal), C("Ivy").drive.goal);
  check("Felicity's want is a restatement of the player's move",
    /boundaries Rabi has set/.test(C("Felicity").drive.goal), C("Felicity").drive.goal);
  check("every want was rewritten in the last two turns",
    ["Ivy", "Felicity", "Wren"].every((n) => 22 - (C(n).drive.updated_turn ?? 0) <= 2),
    ["Ivy", "Felicity", "Wren"].map((n) => [n, C(n).drive.updated_turn]));
  check("and the dog itself already wants something", !!C("Ruff").drive?.goal, C("Ruff").drive);
}

/* ── 2. a want that echoes the player is refused ─────────────────────────────── */
{
  check("the guard exists", /A WANT IS NOT AN ECHO OF THE PLAYER'S LAST MOVE/.test(SRC));
  check("...measured the same way a parroted line is", /longestEchoRun\(action, g\)/.test(SRC));
  check("...and lets a continuation of the standing want through", /const continues = cur && overlapRatio\(cur, g\)/.test(SRC));
  check("...keeping the old want rather than blanking it", /keeps their own want/.test(SRC));
  check("...and only when there IS an old want to keep", /if \(echoesPlayer && !continues && cur\)/.test(SRC));

  check("the bookkeeper is now told what a drive is", /A WANT IS NOT A REACTION, AND MOST TURNS DO NOT CHANGE ONE/.test(SIMULATOR_SYSTEM));
  check("...that the field's default is empty", /This field's default is EMPTY/.test(SIMULATOR_SYSTEM));
  check("...that a new character does not want the thing that made them",
    /do not hand a newly created character a want about the thing that created them/.test(SIMULATOR_SYSTEM));
  check("...with the actual save quoted at it", /adjust to the new domestic boundaries Rabi has set/i.test(SIMULATOR_SYSTEM));
  check("the rotate-on-answer rule survived", /ANSWERED WANTS ROTATE/.test(SIMULATOR_SYSTEM));
}

/* ── 3. the turns that opened on the player's own line ───────────────────────── */
{
  const t19 = stripOpeningPlayerLine(F.turns["19"].prose, F.turns["19"].action);
  check("turn 19 opened by reprinting the player", !!t19.stripped, F.turns["19"].prose.slice(0, 70));
  check("...and it is cut", /^Ivy's whole body went still/.test(t19.prose), t19.prose.slice(0, 60));
  const t18 = stripOpeningPlayerLine(F.turns["18"].prose, F.turns["18"].action);
  check("turn 18 did it too", !!t18.stripped);
  const t20 = stripOpeningPlayerLine(F.turns["20"].prose, F.turns["20"].action);
  check("turn 20 did not, and is left alone", t20.stripped === null && t20.prose === F.turns["20"].prose);

  // A character opening a scene with their own line is not this.
  check("an NPC's own opening line survives",
    stripOpeningPlayerLine('"Morning, love." she said from the stove.', "I walk into the kitchen").stripped === null);
  check("...even when it answers the player", 
    stripOpeningPlayerLine('"Get out of my house." Mara did not move.', "I tell her to leave").stripped === null);
  check("a short action never triggers it",
    stripOpeningPlayerLine('"Yes." she said.', "ok").stripped === null);
}

/* ── 4. and a seven-year-old stops lecturing ─────────────────────────────────── */
{
  const d = stablePrefix(st());
  check("Ivy's card binds her age to her sentences", /AGE IS BINDING ON HOW IVY TALKS — 7 is a child/.test(d));
  check("...naming the exact failure in her dialogue", /does not narrate their own method/.test(d));
  check("...and the readback", /does not recap what somebody just said back to them/.test(d));
  check("...and the tally she kept", /does not count up what they have been promised/.test(d));
  check("a one-year-old gets the one-year-old rule", /AGE IS BINDING ON HOW WREN TALKS — 1 is a child[^]*?No sentences/.test(d));
  check("...which is a different rule from the seven-year-old's",
    /Single words and two-word pairs/.test(d) && /One idea per sentence/.test(d));
  check("adults get no note at all", !/AGE IS BINDING ON HOW FELICITY TALKS/.test(d));
  check("what a child DOES is not narrowed", /a child can be brave, cruel, exactly right/.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
