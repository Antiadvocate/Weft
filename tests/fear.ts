/* FEAR: the people in the room after the king kills someone in it.
 *
 * Kingdom of Veythar. Over one afternoon the player set Lady Isolde alight, burned her to ash, took
 * a councillor's head off, flayed Emily, beheaded Rook and crushed the head under his boot, and put
 * a spear through Seraphina's face. The council trembled and the guard went the colour of milk, but
 * the named people, whose cards carried wants and traits and notes, answered him back: Isolde came
 * out from behind a pillar to face him, Rook complained that the flayed woman had owed him money, and
 * Seraphina, having walked in past Rook's head, waited to present a petition and then told the king
 * she'd rather speak first and die with her shoes on. The player asked whether their responses
 * made sense given what he was doing, and said: "I don't want special rules for it. I want
 * realistic responses emergent."
 *
 * The engine had no number for "this man can kill me, and just did". This checks that it has one,
 * that it comes from what each person saw, heard or walked into, and that the narrator's card for
 * someone afraid for their life describes a frightened person.
 */
import { appraiseDanger, fearOf, fearBlock, fearLine, shiftFear, AFRAID, WARY } from "../src/engine/fear";
import { volatileDigest } from "../src/engine/prompts";
import { lint } from "../tools/promptlint";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/veythar.json", "utf8")) as SaveState;
const EMILY = "char_mv4s64a46df5n", ISOLDE = "char_mv4s64a67pguz", ROOK = "char_mv4s64a7yk7me", SERA = "char_mv4s64a8rmmxo";
const CAST = [EMILY, ISOLDE, ROOK, SERA];
/** The save as it was before the afternoon: everyone alive, nobody afraid, no rumours yet. */
function fresh(): SaveState {
  const s = JSON.parse(JSON.stringify(FIX)) as SaveState;
  for (const id of CAST) { (s.characters[id] as any).status = "active"; delete (s.characters[id] as any).exit; (s.characters[id] as any).location = (s.world as any).player_location; }
  for (const e of s.world.edges as any[]) { delete e.fear; delete e.fear_why; delete e.fear_peak; }
  s.world.rumors = [];
  delete (s.world as any).violence;
  return s;
}
const act = (t: number) => String(FIX.history.find((h) => h.turn === t)?.player_action ?? "");

/* ── 1. the afternoon, replayed: what each of them saw, and whether they're afraid ── */
{
  const s = fresh();
  const died: Record<number, string[]> = { 16: [ISOLDE], 20: [EMILY], 23: [ROOK], 26: [SERA] };
  const at: Record<number, Record<string, number>> = {};
  const notices: string[] = [];
  for (let i = 1; i < FIX.history.length; i++) {
    const h = FIX.history[i]; const t = h.turn;
    s.world.current_turn = t;
    const atStart = (FIX.history[i - 1].present ?? []).filter((x) => s.characters[x]?.status !== "dead");
    s.world.present = [...(h.present ?? [])];
    for (const id of died[t] ?? []) (s.characters[id] as any).status = "dead";
    notices.push(...appraiseDanger(s, { action: h.player_action, mode: (h as any).action_mode ?? "do", presentAtStart: atStart, diedThisTurn: died[t] ?? [], turn: t, elapsedMinutes: 4 }));
    at[t] = Object.fromEntries(CAST.map((id) => [id, fearOf(s, id)]));
  }
  check("the fireball in his hand makes the two women wary, before he's used it", at[12][EMILY] >= WARY && at[12][EMILY] < AFRAID, at[12]);
  check("Isolde, set alight (\"isolade\" in the player's spelling), is afraid for her life", at[13][ISOLDE] >= AFRAID, at[13]);
  check("…and being the one it was done to frightens more than watching it", at[13][ISOLDE] > at[13][EMILY], at[13]);
  check("Emily, who watched it from a few feet away, is afraid for her life", at[13][EMILY] >= AFRAID, at[13]);
  check("Rook, who came in on a room with two killings in it, is afraid before he's touched", at[21][ROOK] >= AFRAID, at[21]);
  check("Seraphina, who walked in past Rook's head, is afraid the turn she arrives", at[24][SERA] >= AFRAID, at[24]);
  check("the player is told once per person, when they cross into it", notices.filter((n) => /^Emily/.test(n)).length === 1 && notices.filter((n) => /^Seraphina/.test(n)).length === 1, notices);
  check("…and the notice is plain", notices.every((n) => /^[\w’' -]+ is afraid of you now\.$/.test(n)), notices);
}

/* ── 2. who they are to the people in it decides how frightening it is ── */
{
  const s = fresh();
  s.world.current_turn = 30; s.world.present = [EMILY, ROOK, SERA];
  const edge = (from: string, to: string) => { let e = (s.world.edges as any[]).find((x) => x.from === from && x.to === to); if (!e) { e = { from, to, warmth: 0, trust: 0, power: 0 }; s.world.edges.push(e); } return e; };
  edge(EMILY, ROOK).warmth = -60;                  // Emily wanted Rook gone
  edge(SERA, "char_player").warmth = 50;           // Seraphina is the king's
  edge(ROOK, "char_player").warmth = -70;          // Rook came for him
  edge(SERA, ROOK).warmth = 0;
  appraiseDanger(s, { action: "Rook lunges with a knife. I run him through.", mode: "do", presentAtStart: [EMILY, ROOK, SERA], diedThisTurn: [ROOK], turn: 30 });
  check("someone who wanted the victim gone isn't frightened much by watching it", fearOf(s, EMILY) > 0 && fearOf(s, EMILY) < WARY, fearOf(s, EMILY));
  check("an ally who watched him cut down a man coming for him isn't afraid of him", fearOf(s, SERA) > 0 && fearOf(s, SERA) < WARY, fearOf(s, SERA));
  const t = fresh();
  t.world.current_turn = 30; t.world.present = [EMILY, ROOK, SERA];
  appraiseDanger(t, { action: "I run Rook through with my sword.", mode: "do", presentAtStart: [EMILY, ROOK, SERA], diedThisTurn: [ROOK], turn: 30 });
  check("anyone watching him kill a man who'd done nothing to them is afraid of him", fearOf(t, EMILY) >= AFRAID && fearOf(t, SERA) >= AFRAID, [fearOf(t, EMILY), fearOf(t, SERA)]);
}

/* ── 3. the victim, by name, by a typo, or the only one a pronoun fits ── */
{
  const s = fresh();
  s.world.current_turn = 13; s.world.present = [EMILY, ROOK];
  appraiseDanger(s, { action: "I grab her by the throat and slam her into the pillar.", mode: "do", presentAtStart: [EMILY, ROOK], diedThisTurn: [], turn: 13 });
  check("\"her\", with one woman in the room, is that woman", fearOf(s, EMILY) >= 50 && fearOf(s, ROOK) < 50, [fearOf(s, EMILY), fearOf(s, ROOK)]);
  for (const a of ["I break Rook's arm.", "I slam Rook against the wall.", "I punch Rook in the jaw."]) {
    const u = fresh();
    u.world.current_turn = 13; u.world.present = [EMILY, ROOK];
    appraiseDanger(u, { action: a, mode: "do", presentAtStart: [EMILY, ROOK], diedThisTurn: [], turn: 13 });
    check(`"${a}": Rook is the one it was done to, and Emily is wary of the man who did it`, fearOf(u, ROOK) >= 50 && fearOf(u, EMILY) >= WARY, [fearOf(u, ROOK), fearOf(u, EMILY)]);
  }
}

/* ── 4. what isn't danger ── */
{
  for (const a of ["I kill time scrolling on my phone.", "I shoot her a text.", "I execute the plan we made.", "We're killing it at work today.", "I slam the door to the car.", "I grab the bottle by the neck.", "I punch the clock and head out.", "I cut the tree down.", "I beat the eggs."]) {
    const s = fresh();
    s.world.current_turn = 5; s.world.present = [EMILY];
    appraiseDanger(s, { action: a, mode: "do", presentAtStart: [EMILY], diedThisTurn: [], turn: 5 });
    check(`"${a}" frightens nobody`, fearOf(s, EMILY) === 0, fearOf(s, EMILY));
  }
  const s = fresh();
  s.world.current_turn = 5; s.world.present = [EMILY];
  appraiseDanger(s, { action: "*I could kill her for that.*", mode: "think", presentAtStart: [EMILY], diedThisTurn: [], turn: 5 });
  check("a thought frightens nobody", fearOf(s, EMILY) === 0, fearOf(s, EMILY));
  const u = fresh();
  u.world.current_turn = 25; u.world.present = [SERA];
  appraiseDanger(u, { action: act(25), mode: "do", presentAtStart: [SERA], diedThisTurn: [], turn: 25 });
  check("a threat to her face, with no violence yet, is heard", fearOf(u, SERA) > 0 && fearOf(u, SERA) < AFRAID, fearOf(u, SERA));
}

/* ── 5. word of it, for people who weren't there ── */
{
  const s = fresh();
  s.world.current_turn = 24; s.world.present = [];
  s.world.rumors = [{ id: "rum_1", content: "King Aldric the First severed Rook's head with magic and smashed it beneath his boot before the assembled High Council.", holders: [SERA] } as any];
  appraiseDanger(s, { action: "I sit on the throne.", mode: "do", presentAtStart: [], diedThisTurn: [], turn: 24 });
  const once = fearOf(s, SERA);
  appraiseDanger(s, { action: "I sit on the throne.", mode: "do", presentAtStart: [], diedThisTurn: [], turn: 25 });
  check("someone who heard it told is wary of him", once >= WARY && once < AFRAID, once);
  check("…once, however many turns the rumour is still going round", fearOf(s, SERA) === once, fearOf(s, SERA));
}

/* ── 6. it fades with time, but someone who saw a killing stays wary ── */
{
  const s = fresh();
  s.world.current_turn = 13; s.world.present = [EMILY];
  appraiseDanger(s, { action: "I burn Isolde alive.", mode: "do", presentAtStart: [EMILY, ISOLDE], diedThisTurn: [ISOLDE], turn: 13 });
  const peak = fearOf(s, EMILY);
  appraiseDanger(s, { action: "I go for a walk.", mode: "do", presentAtStart: [EMILY], diedThisTurn: [], turn: 14, elapsedMinutes: 600 });
  const later = fearOf(s, EMILY);
  check("ten calm hours take a little off", later < peak && later > peak - 10, [peak, later]);
  appraiseDanger(s, { action: "I go for a walk.", mode: "do", presentAtStart: [EMILY], diedThisTurn: [], turn: 15, elapsedMinutes: 60 * 24 * 30 });
  check("a month later she's still wary of the man who burned a woman in front of her", fearOf(s, EMILY) >= WARY && fearOf(s, EMILY) < AFRAID, fearOf(s, EMILY));
  shiftFear(s, EMILY, -10, "", 16); shiftFear(s, EMILY, -10, "", 17); shiftFear(s, EMILY, -10, "", 18);
  check("what happens between them later can bring it down further", fearOf(s, EMILY) < WARY, fearOf(s, EMILY));
  shiftFear(s, EMILY, 40, "he drew a knife and held it to her cheek", 19);
  check("the bookkeeper's reading of a danger no pattern sees moves it, with its reason", fearOf(s, EMILY) >= AFRAID && fearBlock(s, EMILY).includes("drew a knife"), fearBlock(s, EMILY));
}

/* ── 7. the narrator's card for someone afraid for their life ── */
{
  const s = fresh();
  s.world.current_turn = 24; s.world.present = [SERA];
  const calm = volatileDigest(s, "Who the fuck are you?");
  (s.world as any).violence = [{ turn: 23, act: "I smash his head on the ground.", victims: [ROOK], lethal: true, where: (s.world as any).player_location, seen: [ROOK] }];
  appraiseDanger(s, { action: "I sweep the head aside.", mode: "do", presentAtStart: [], diedThisTurn: [], turn: 24 });
  const afraid = volatileDigest(s, "Who the fuck are you?");
  const card = (d: string) => { const i = d.lastIndexOf(`— Seraphina [${SERA}]`); return d.slice(i, d.indexOf("\n—", i + 5) > 0 ? d.indexOf("\n—", i + 5) : i + 6000); };
  const before = card(calm), after = card(afraid);
  check("the card says she's afraid for her life, and why", /AFRAID OF KING ALDRIC THE FIRST FOR THEIR LIFE/.test(after) && /came in soon after/.test(after), after.slice(0, 400));
  check("her wants are still on the card, waiting", /wants \(waiting until they're safe from the player\):/.test(after) && !/wants \(waiting/.test(before), after);
  check("the bookkeeper's old note that she \"refuses to cower\" is gone from it", /refuses to cower/.test(before) && !/refuses to cower/.test(after));
  check("her desire for him doesn't show while she's afraid", !/desire toward you: (?:real|strong)/.test(after) && (/desire toward you: (?:real|strong)/.test(before) ? /fear of you is on top of it/.test(after) : true), before.match(/desire toward you:[^\n]*/)?.[0]);
  check("no \"goes at it by\", \"voice now\" or stress habit runs underneath it", !/goes at it by|voice now:|under stress this person/.test(after), after);
  check("the line toward the player carries the number", /toward player: warmth -?\d+, trust -?\d+, fear \d+/.test(after));
  check("the bookkeeper is shown it too", /toward player: warmth -?\d+, trust -?\d+(?:, desire -?\d+)?, fear \d+/.test(afraid.slice(afraid.indexOf("fatigue"))) || /, fear \d+/.test(afraid));
  check("the block itself passes the prompt lint", lint(fearBlock(s, SERA)).length === 0, lint(fearBlock(s, SERA)));
  check("…and the intent pass gets a line of it", /^Afraid of the player for their life \(fear \d+\), because they came in soon after/.test(fearLine(s, SERA)), fearLine(s, SERA));
}

/* ── 8. nothing scripted ── */
{
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  const reaction = readFileSync("src/engine/reaction.ts", "utf8");
  const intent = readFileSync("src/engine/intent.ts", "utf8");
  check("no special rule for violent turns in the turn loop", !/violentAct/.test(turn));
  check("answering the player no longer means going on talking to him", !/go on talking to the player/.test(reaction) && /fear has made silence the safest thing/.test(reaction));
  check("the intent pass drops the approach for someone afraid", /afraid \? "" : \(\(\) => \{ const door/.test(intent));
  check("the bookkeeper's fear only lands on the edge to the player", /to === "char_player" && from !== "char_player"[^\n]*\n\s*shiftFear\(/.test(turn));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
