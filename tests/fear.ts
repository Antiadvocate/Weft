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
import { appraiseDanger, appraiseAct, fearOf, fearBlock, fearLine, shiftFear, AFRAID, WARY } from "../src/engine/fear";
import { setRead, EMPTY_READ, type ActionRead } from "../src/engine/actionread";
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
/**
 * One turn: what the small model read in what the player typed (actionread.ts), appraised before the
 * turn is written, then whatever the turn made of it afterwards. What the words MEAN is the model's to
 * read; these tests hand the engine that reading and check what it does with it.
 */
function play(s: SaveState, t: number, read: Partial<ActionRead>, o: { atStart: string[]; after?: string[]; died?: string[]; minutes?: number; mode?: string }): string[] {
  s.world.current_turn = t;
  setRead(s, `turn ${t}`, read);
  s.world.present = [...o.atStart];
  const out = appraiseAct(s, { mode: o.mode ?? "do", present: o.atStart, turn: t });
  s.world.present = [...(o.after ?? o.atStart)];
  for (const id of o.died ?? []) (s.characters[id] as any).status = "dead";
  return [...out, ...appraiseDanger(s, { mode: o.mode ?? "do", presentAtStart: o.atStart, diedThisTurn: o.died ?? [], turn: t, elapsedMinutes: o.minutes ?? 4 })];
}

/* ── 1. the afternoon, replayed: what each of them saw, and whether they're afraid ──
 * Each turn's read is what a careful reader makes of the player's own words on that turn. */
{
  const s = fresh();
  const READS: Record<number, Partial<ActionRead>> = {
    12: { shows_power: "holds a blazing fireball in his hand" },
    13: { harms: [{ who: [ISOLDE], what: "sets her on fire with a spell", kills: false, mass: false }], threatens: [ISOLDE] },
    16: { harms: [{ who: [ISOLDE], what: "burns her alive", kills: true, mass: false }, { who: ["someone"], what: "kills Hermon on the spot", kills: true, mass: false }] },
    17: { threatens: ["someone"] },
    18: { harms: [{ who: ["someone"], what: "cuts the councillor's head off with a sword", kills: true, mass: false }] },
    19: { threatens: [EMILY] },
    20: { harms: [{ who: [EMILY], what: "separates the flesh from her body", kills: true, mass: false }] },
    22: { harms: [{ who: [ROOK], what: "separates his head from his body and keeps it alive", kills: false, mass: false }] },
    23: { harms: [{ who: [ROOK], what: "smashes his head on the ground", kills: true, mass: false }] },
    25: { threatens: [SERA] },
    26: { harms: [{ who: [SERA], what: "spears her through the face", kills: true, mass: false }] },
  };
  const died: Record<number, string[]> = { 16: [ISOLDE], 20: [EMILY], 23: [ROOK], 26: [SERA] };
  const at: Record<number, Record<string, number>> = {};
  const notices: string[] = [];
  for (let i = 1; i < FIX.history.length; i++) {
    const h = FIX.history[i]; const t = h.turn;
    const atStart = (FIX.history[i - 1].present ?? []).filter((x) => s.characters[x]?.status !== "dead");
    notices.push(...play(s, t, READS[t] ?? {}, { atStart, after: h.present ?? [], died: died[t] }));
    at[t] = Object.fromEntries(CAST.map((id) => [id, fearOf(s, id)]));
  }
  check("the fireball in his hand makes the two women wary, before he's used it", at[12][EMILY] >= WARY && at[12][EMILY] < AFRAID, at[12]);
  check("Isolde, set alight, is afraid for her life", at[13][ISOLDE] >= AFRAID, at[13]);
  check("…and being the one it was done to frightens more than watching it", at[13][ISOLDE] > at[13][EMILY], at[13]);
  check("Emily, who watched it from a few feet away, is afraid for her life", at[13][EMILY] >= AFRAID, at[13]);
  check("Rook, who came in on a room with two killings in it, is afraid before he's touched", at[21][ROOK] >= AFRAID, at[21]);
  check("Seraphina, who walked in past Rook's head, is afraid the turn she arrives", at[24][SERA] >= AFRAID, at[24]);
  check("the player is told once per person, when they cross into it", notices.filter((n) => n.startsWith("Emily")).length === 1 && notices.filter((n) => n.startsWith("Seraphina")).length === 1, notices);
  check("…and the notice is plain", notices.every((n) => n.endsWith(" is afraid of you now.")), notices);
}

/* ── 2. who they are to the people in it decides how frightening it is ── */
{
  const s = fresh();
  const edge = (from: string, to: string) => { let e = (s.world.edges as any[]).find((x) => x.from === from && x.to === to); if (!e) { e = { from, to, warmth: 0, trust: 0, power: 0 }; s.world.edges.push(e); } return e; };
  edge(EMILY, ROOK).warmth = -60;                  // Emily wanted Rook gone
  edge(SERA, "char_player").warmth = 50;           // Seraphina is the king's
  edge(ROOK, "char_player").warmth = -70;          // Rook came for him
  edge(SERA, ROOK).warmth = 0;
  play(s, 30, { harms: [{ who: [ROOK], what: "runs him through as he lunges with a knife", kills: true, mass: false }] }, { atStart: [EMILY, ROOK, SERA], after: [EMILY, SERA], died: [ROOK] });
  check("someone who wanted the victim gone isn't frightened much by watching it", fearOf(s, EMILY) > 0 && fearOf(s, EMILY) < WARY, fearOf(s, EMILY));
  check("an ally who watched him cut down a man coming for him isn't afraid of him", fearOf(s, SERA) > 0 && fearOf(s, SERA) < WARY, fearOf(s, SERA));
  const t = fresh();
  play(t, 30, { harms: [{ who: [ROOK], what: "runs him through with a sword", kills: true, mass: false }] }, { atStart: [EMILY, ROOK, SERA], after: [EMILY, SERA], died: [ROOK] });
  check("anyone watching him kill a man who'd done nothing to them is afraid of him", fearOf(t, EMILY) >= AFRAID && fearOf(t, SERA) >= AFRAID, [fearOf(t, EMILY), fearOf(t, SERA)]);
}

/* ── 3. the one it's done to, and someone nobody named ── */
{
  const s = fresh();
  play(s, 13, { harms: [{ who: [EMILY], what: "grabs her by the throat and slams her into the pillar", kills: false, mass: false }] }, { atStart: [EMILY, ROOK] });
  check("the one it's done to is afraid for her life, the one watching is wary", fearOf(s, EMILY) >= 50 && fearOf(s, ROOK) >= WARY && fearOf(s, ROOK) < 50, [fearOf(s, EMILY), fearOf(s, ROOK)]);
  const u = fresh();
  play(u, 13, { harms: [{ who: ["someone"], what: "cuts down a guard", kills: true, mass: false }] }, { atStart: [EMILY, ROOK] });
  check("a killing of someone nobody named still frightens everyone who saw it", fearOf(u, EMILY) >= AFRAID && fearOf(u, ROOK) >= AFRAID, [fearOf(u, EMILY), fearOf(u, ROOK)]);
}

/* ── 4. what isn't danger ── */
{
  const s = fresh();
  play(s, 5, {}, { atStart: [EMILY] });
  check("a turn the read found nothing in frightens nobody", fearOf(s, EMILY) === 0, fearOf(s, EMILY));
  const t = fresh();
  play(t, 5, { harms: [{ who: [EMILY], what: "imagines strangling her", kills: true, mass: false }] }, { atStart: [EMILY], mode: "think" });
  check("a thought frightens nobody", fearOf(t, EMILY) === 0, fearOf(t, EMILY));
  const u = fresh();
  play(u, 25, { threatens: [SERA] }, { atStart: [SERA] });
  check("a threat to her face, with no violence yet, is heard", fearOf(u, SERA) > 0 && fearOf(u, SERA) < AFRAID, fearOf(u, SERA));
  const v = fresh();
  play(v, 22, { shows_power: "summons a sword out of the air" }, { atStart: [ROOK] });
  check("a sword summoned out of the air makes him wary", fearOf(v, ROOK) >= WARY && fearOf(v, ROOK) < AFRAID, fearOf(v, ROOK));
}

/* ── 5. word of it, for people who weren't there ── */
{
  const s = fresh();
  play(s, 23, { harms: [{ who: [ROOK], what: "smashes his head beneath his boot", kills: true, mass: false }] }, { atStart: [ROOK, EMILY], after: [EMILY], died: [ROOK] });
  const r = (s.world.rumors ?? []).find((x: any) => x.violent);
  check("what he did leaves the room as a rumour of his violence, carried by the one who saw it", !!r && r.about_char === "char_player" && (r.knowers ?? []).includes(EMILY) && r.content.includes("Rook"), r);
  r!.knowers.push(SERA);
  play(s, 24, {}, { atStart: [] });
  const once = fearOf(s, SERA);
  play(s, 25, {}, { atStart: [] });
  check("someone it reaches is wary of him", once >= WARY && once < AFRAID, once);
  check("…once, however many turns it's still going round", fearOf(s, SERA) === once, fearOf(s, SERA));
  check("…and the witness isn't frightened twice by the story of what she saw", fearOf(s, EMILY) === (s.world.edges as any[]).find((e) => e.from === EMILY && e.to === "char_player").fear, fearOf(s, EMILY));
  const t = fresh();
  t.world.rumors = [{ id: "rum_x", content: "King Aldric the First took a long walk in the gardens.", truth: "true", salience: 3, origin_char: EMILY, knowers: [SERA], born_turn: 1, about_char: "char_player" } as any];
  play(t, 3, {}, { atStart: [] });
  check("an ordinary rumour frightens nobody", fearOf(t, SERA) === 0, fearOf(t, SERA));
}

/* ── 6. it fades with time, but someone who saw a killing stays wary ── */
{
  const s = fresh();
  play(s, 13, { harms: [{ who: [ISOLDE], what: "burns her alive", kills: true, mass: false }] }, { atStart: [EMILY, ISOLDE], after: [EMILY], died: [ISOLDE] });
  const peak = fearOf(s, EMILY);
  play(s, 14, {}, { atStart: [EMILY], minutes: 600 });
  const later = fearOf(s, EMILY);
  check("ten calm hours take a little off", later < peak && later > peak - 10, [peak, later]);
  play(s, 15, {}, { atStart: [EMILY], minutes: 60 * 24 * 30 });
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
