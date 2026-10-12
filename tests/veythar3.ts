/* THE KINGDOM OF VEYTHAR, THIRD RUN.
 *
 * With fear and stations in, the player's report: "The king's advisor telling the king about the
 * guards needing coin, about them not getting paid. In a prosperous kingdom. And then not doing his
 * fucking job. Then Rook just talking it up real chill. Then Seraphina being like 'which one of you
 * did this', casually, to the king. Who has cut someone in half."
 *
 *   turn 19  The king orders the girl in the cells freed. The engine's beat that turn is the story
 *            palette, "Financial desperation", told to happen through whoever is there, and it
 *            replaces the answer to his order. The advisor tells him there's a silver mark's fee
 *            and the night watch hasn't been paid in four weeks.
 *   turn 21  Given an hour to fetch her, the advisor "says again, and goes". He had spoken before
 *            he went, so the floor that keeps anyone who acted this turn kept him, and he was in
 *            the corridor for three more turns. His name on the record was "Advisor"; his own
 *            background says Edrin Mallowe.
 *   turn 21  Rook walks into the king's private corridor, because the engine moves anyone who has
 *            been trying long enough to reach the player into the player's room. The list that
 *            announced him was never cleared, so "ARRIVING NOW: Rook" went out every turn after,
 *            and on the turn after he was killed a stranger walked in who had "walked three weeks
 *            for a man who's already dead" and asked the king, sword in hand over the body, "Which
 *            one of you killed Rook?"
 *   turn 22  A gang boss, afraid for his life of a king who had just summoned a sword, answers him
 *            with an insult, on a turn whose palette beat was "Power and control".
 */
import { goneByTheEnd } from "../src/engine/exit";
import { properNameFromRole, adoptProperNames } from "../src/engine/sketch";
import { beatOrder, keptAtTheDoor, atTheDoorNote, stationGap, standingToward } from "../src/engine/station";
import { fearBlock, AFRAID } from "../src/engine/fear";
import { lint } from "../tools/promptlint";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PROSE = JSON.parse(readFileSync("tests/fixtures/veythar3-prose.json", "utf8")) as Record<string, string>;
const FIX = JSON.parse(readFileSync("tests/fixtures/veythar.json", "utf8")) as SaveState;
const EMILY = "char_mv4s64a46df5n", ROOK = "char_mv4s64a7yk7me", P = "char_player";
const fresh = (): SaveState => {
  const s = JSON.parse(JSON.stringify(FIX)) as SaveState;
  for (const c of Object.values(s.characters) as any[]) { if (c.character_id !== P) { c.status = "active"; delete c.exit; } }
  for (const e of s.world.edges as any[]) { delete e.fear; if (e.to === P) e.power = 0; }
  return s;
};

/* ── 1. the advisor went, though he spoke first ── */
{
  const he = { pronouns: "he/him", others: ["Rook"], othersPronouns: ["he/him"] };
  check("turn 21: \"he says again, and goes\" takes the advisor out of the corridor", goneByTheEnd({ prose: PROSE["21"], name: "Advisor", ...he }));
  check("turn 24: \"he is through the archway\" takes him out again", goneByTheEnd({ prose: PROSE["24"], name: "Advisor", ...he }));
  check("turn 21: Rook, standing against the wall, stays", !goneByTheEnd({ prose: PROSE["21"], name: "Rook", pronouns: "he/him", others: ["Advisor"], othersPronouns: ["he/him"] }));
  check("turn 22: Rook, backed against the stone, stays", !goneByTheEnd({ prose: PROSE["22"], name: "Rook", pronouns: "he/him", others: ["Advisor"], othersPronouns: ["he/him"] }));
  check("\"the advisor's body leaves the floor\" isn't leaving", !goneByTheEnd({ prose: "The advisor's body leaves the floor before his feet find it. He lands halfway down the corridor.", name: "Advisor", pronouns: "he/him" }));
  for (const [line, name] of [
    ["Isolde rises, but she doesn't step away yet. \"Tomorrow, Your Majesty.\"", "Isolde"],
    ["May doesn't wait for the answer. She steps toward the door and puts a hand on the handle.", "May"],
    ["Emily doesn't answer at once. She has gone very still.", "Emily"],
    ["Seraphina steps forward now, into the space the guards left open.", "Seraphina"],
    ["Ellie walks out to the car and then comes back in for her keys.", "Ellie"],
  ]) check(`stays: "${line.slice(0, 60)}…"`, !goneByTheEnd({ prose: line, name, pronouns: "she/her" }));
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("the footer's \"here\" and the floor both let them go", /if \(leftForGood\(id\)\) \{ console\.info/.test(turn) && /if \(leftForGood\(id\)\) \{ rebuilt\.push\(\{ char_id: id, place: "elsewhere"/.test(turn));
}

/* ── 2. his name ── */
{
  const bg = "Edrin Mallowe was born in Hessick Ford, a wet river town four days south of the capital, where the chief industries were cheese, eels and burying people.";
  check("\"Advisor\", whose background opens \"Edrin Mallowe was born\", is Edrin Mallowe", properNameFromRole({ name: "Advisor", background: bg }) === "Edrin Mallowe");
  const s = fresh();
  (s.characters as any).char_adv = { character_id: "char_adv", name: "Advisor", background: bg, pronouns: "he/him" };
  const said = adoptProperNames(s);
  const a = (s.characters as any).char_adv;
  check("…renamed, with the job kept so \"the advisor\" still finds him", a.name === "Edrin Mallowe" && a.aliases.includes("Advisor") && a.aliases.includes("the advisor") && said[0] === "The advisor's name is Edrin Mallowe.", [a.name, a.aliases, said]);
  check("a real name stays", properNameFromRole({ name: "Emily Veyne", background: "Emily Veyne was born in a village." }) === null);
  check("a role with no name in the background stays a role", properNameFromRole({ name: "Guard", background: "He was born in the barracks." }) === null);
  check("…and \"The Night Clerk\" who is Maria de la Cruz becomes her", properNameFromRole({ name: "The Night Clerk", background: "Maria de la Cruz grew up in Tacoma." }) === "Maria de la Cruz");
}

/* ── 3. what the engine sends in has to fit the world, and reach a king like a king ── */
{
  const s = fresh();
  const bo = beatOrder(s);
  check("it agrees with the world's own facts: a stable, prosperous kingdom", /agrees with what this world has established about itself \(The kingdom is stable and prosperous/.test(bo), bo);
  check("…and reaches the sovereign as news, a report or a petition, with his orders carried out", /reaches King Aldric the First, who is the sovereign, the way things reach someone of that station here: as news, a report or a petition/.test(bo) && /nobody in his service putting a price or a condition on one/.test(bo), bo);
  check("the clause passes the prompt lint", lint(bo).length === 0, lint(bo));
  const m = fresh();
  m.world_bible = { ...m.world_bible, era: "Contemporary Seattle", political_situation: "", name: "Rainier Valley" } as any;
  (m.characters as any)[P].name = "Rabi"; (m.characters as any)[P].background = "Works at a design studio.";
  check("in an ordinary modern story there's no court to speak of", !/far beneath/.test(beatOrder(m)));
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("a beat in the room comes after the answer to what the player said, never instead of it", /AND ONCE THAT HAS BEEN ANSWERED, ALSO THIS TURN: \$\{fitted\(beatDirective\(beat, dial\)/.test(turn));
  const pressure = readFileSync("src/engine/pressure.ts", "utf8");
  check("the palette comes through someone whose life it's already part of, or from outside the room", /through someone here whose life it's already part of\. If it's part of nobody's life in this room, it reaches the room from outside/.test(pressure));
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  check("an order from someone with the right to give it is carried out, never priced", /An order is different from a request when the player has the right to give it/.test(prompts) && /An order from someone with the right to give it is carried out, or failed at, and never answered with a price or a condition/.test(prompts));
}

/* ── 4. who gets to walk in on a king ── */
{
  const s = fresh();
  (s.characters as any)[ROOK].station = { place: "underworld boss of the capital", rank: 20, source: "bookkeeper" };
  (s.characters as any).char_adv = { character_id: "char_adv", name: "Edrin Mallowe", station: { place: "palace advisor", rank: 55 } };
  check("a gang boss looking for the king is kept at the door", keptAtTheDoor(s, ROOK), standingToward(s, ROOK, P));
  check("the king's own advisor is far beneath him too, now that the top of the ladder is steep", stationGap(s, "char_adv", P) <= -40, stationGap(s, "char_adv", P));
  check("…while a seamstress and a carter stand level", Math.abs(stationGap(s, EMILY, ROOK)) < 10, stationGap(s, EMILY, ROOK));
  const note = atTheDoorNote(s, ["Rook"]);
  check("word is brought; he's not in the room unless the king has him brought in", /ASKING TO SEE KING ALDRIC THE FIRST: Rook\./.test(note) && /Whoever keeps the door stops them, and word is brought/.test(note) && /They aren't in the room, and they come in only if King Aldric the First has them brought in/.test(note), note);
  check("the note passes the prompt lint", lint(note).length === 0, lint(note));
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("the walk to the player stops at the door for them", /if \(keptAtTheDoor\(state, p\.id\)\) \{/.test(turn));
  check("arrivals are said once and cleared", /syncPresence\(state, diff\.present\);\n[^\n]*\n\s*state\.world\.arrivals_pending = \[\];/.test(turn));
  check("the dead don't arrive", /return !c \|\| \(c\.status !== "dead" && c\.status !== "departed"\);/.test(turn));
  check("whoever arrives reacts to what they walk into before what they came to say", /What they walk into comes first: they react to what's in front of them, and to who is, as the people they are, before anything they came to say/.test(turn));
}

/* ── 5. a hard man, afraid for his life ── */
{
  const s = fresh();
  const e = (s.world.edges as any[]).find((x) => x.from === ROOK && x.to === P) ?? (() => { const x = { from: ROOK, to: P, warmth: 0, trust: 0, power: 0 }; s.world.edges.push(x as any); return x; })();
  (e as any).fear = AFRAID + 20; (e as any).fear_why = ["saw the king summon a sword from empty air"];
  const fb = fearBlock(s, ROOK);
  check("going for him or the door, all at once, is what a fighter does", /go for him or for the door, all at once/.test(fb), fb);
  check("nobody afraid for their life trades remarks with the one they fear", /Nobody afraid for their life trades remarks with the one they're afraid of, makes a point at him, or needles him/.test(fb));
  check("a hard man's fear shows as stillness", /a hard man's fear shows as stillness and care with every word/.test(fb));
  check("the block passes the prompt lint", lint(fb).length === 0, lint(fb));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
