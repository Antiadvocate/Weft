/* STATION: a slum seamstress and her king.
 *
 * Kingdom of Veythar, the opening scene. Emily, barefoot, from the slums, walks up to the king in
 * his garden and talks to him like a man on a bench: "You looked. Twice." She sits while he kneels
 * in the grass, calls him "an odd sort of king", and when he calls his guards asks "Is that what you
 * wanted?" The player: "How does a random woman like Emily simply speak to the king like he's
 * another dude?"
 *
 * "King" was a word in his name. Every edge was born at power 0, which reads as two equals. This
 * checks that a person now has a place in their world's order, that the world says how much that
 * order counts, and that the narrator is told where two people stand before anything has happened
 * between them.
 */
import { stationOf, hierarchyOf, stationGap, standingToward, stationLine, stationTag, stationLedger, setStation } from "../src/engine/station";
import { volatileDigest, deltaNote, stablePrefix } from "../src/engine/prompts";
import { registerCharacter } from "../src/engine/state";
import { lint } from "../tools/promptlint";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/veythar.json", "utf8")) as SaveState;
const EMILY = "char_mv4s64a46df5n", ISOLDE = "char_mv4s64a67pguz", ROOK = "char_mv4s64a7yk7me", SERA = "char_mv4s64a8rmmxo", P = "char_player";
/** The garden, turn one: Emily alive and beside him, liking him, nothing yet between them in power. */
function garden(): SaveState {
  const s = JSON.parse(JSON.stringify(FIX)) as SaveState;
  for (const id of [EMILY, ISOLDE, ROOK, SERA]) { (s.characters[id] as any).status = "active"; delete (s.characters[id] as any).exit; (s.characters[id] as any).location = (s.world as any).player_location; }
  for (const e of s.world.edges as any[]) { delete e.fear; if (e.to === P) { e.power = 0; e.notes = ""; } }
  const e = (s.world.edges as any[]).find((x) => x.from === EMILY && x.to === P);
  Object.assign(e, { warmth: 34, trust: 11 });
  s.world.present = [EMILY]; s.world.current_turn = 1;
  return s;
}

/* ── 1. who they are, read off cards written before stations existed ── */
{
  const s = garden();
  const st = (id: string) => stationOf(s, id);
  check("the king is the sovereign, from the title in his name", st(P)?.rank === 100 && st(P)?.place === "the sovereign", st(P));
  check("Lady Isolde is a noble, from hers", st(ISOLDE)?.rank === 75, st(ISOLDE));
  check("Emily, an outcast from a village who works odd jobs, is at the bottom", (st(EMILY)?.rank ?? 99) <= 15, st(EMILY));
  check("…though her background mentions the king's secret further on", st(EMILY)?.place !== "the sovereign");
  check("Seraphina is a courtesan, though nobles frequent her brothel", st(SERA)?.place === "a courtesan", st(SERA));
  check("Rook, who grew up in the slums and runs a gang, is near the bottom", (st(ROOK)?.rank ?? 99) <= 15, st(ROOK));
  check("all of them are marked as guesses", [P, EMILY, ISOLDE, ROOK, SERA].every((id) => st(id)?.source === "guessed"));
}

/* ── 2. how much rank counts, by world ── */
{
  const s = garden();
  check("a kingdom with a throne and a council: rank counts for a great deal", hierarchyOf(s) >= 0.8, hierarchyOf(s));
  const m = garden();
  m.world_bible = { ...m.world_bible, name: "Rainier Valley", era: "Contemporary Seattle, early June", technology_level: "present day", political_situation: "Ordinary municipal government and workplace hierarchies shape daily life without dominating it.", cultures_and_languages: "" } as any;
  check("contemporary Seattle: some", hierarchyOf(m) <= 0.35, hierarchyOf(m));
  (m.world_bible as any).hierarchy = 0.1;
  check("what the world says outright wins over the guess", hierarchyOf(m) === 0.1);
}

/* ── 3. where two people stand before anything happens between them ── */
{
  const s = garden();
  check("Emily stands a very long way below the king", standingToward(s, EMILY, P) <= -60, standingToward(s, EMILY, P));
  check("…and the king a very long way above her", standingToward(s, P, EMILY) >= 60, standingToward(s, P, EMILY));
  const e = (s.world.edges as any[]).find((x) => x.from === EMILY && x.to === P);
  e.power = 10;
  check("what happens between them moves it from there (a secret held over him, say)", standingToward(s, EMILY, P) === stationGap(s, EMILY, P) + 10);
  e.power = 0; e.roles = ["wife"];
  check("a wife feels half the distance", Math.abs(stationGap(s, EMILY, P)) < 45, stationGap(s, EMILY, P));
  check("Isolde far outranks Emily, and Emily knows it", stationTag(s, ISOLDE, EMILY) === "far outranks them" && stationTag(s, EMILY, ISOLDE) === "far beneath them in rank", [stationTag(s, ISOLDE, EMILY), stationTag(s, EMILY, ISOLDE)]);
}

/* ── 4. what the narrator is told about Emily in the garden ── */
{
  const s = garden();
  const dn = deltaNote(s, "hello");
  const em = dn.split("\n").find((l) => l.startsWith(`— Emily Veyne`)) ?? "";
  check("her standing is a whole order of society below him", /far beneath you in this world's order and they know it \(standing -\d+\)/.test(em), em.slice(-700));
  check("…so what she feels shows inside the forms of her station before his", /shows inside the forms someone of their station keeps before someone of yours here/.test(em));
  const card = volatileDigest(s, "hello");
  const line = card.split("\n").find((l) => /^\s+station: Emily Veyne is/.test(l)) ?? "";
  check("her card names both stations and the distance", /a commoner from the bottom of society, and King Aldric the First is the sovereign\. In this world that puts Emily Veyne a very long way below King Aldric the First/.test(line), line);
  s.world.present = [EMILY, ISOLDE];
  const both = volatileDigest(s, "hello");
  check("with Isolde in the room, each card says who outranks whom", /toward others here: [^\n]*Lady Isolde D’Veyth: [^\n]*far beneath them in rank/.test(both) || /toward others here: [^\n]*Emily Veyne: [^\n]*far outranks them/.test(both));
  const flat = garden();
  (flat.world_bible as any).hierarchy = 0.1;
  const fl = deltaNote(flat, "hello").split("\n").find((l) => l.startsWith(`— Emily Veyne`)) ?? "";
  check("in a world where rank barely counts, the same two people aren't told to keep any forms", !/this world's order/.test(fl) && !/^\s+station:/m.test(volatileDigest(flat, "hello")));
}

/* ── 5. people with no station on record, in a modern story ── */
{
  const s = garden();
  s.world_bible = { ...s.world_bible, era: "Contemporary Seattle", political_situation: "ordinary city life", name: "Rainier Valley" } as any;
  for (const id of [P, EMILY]) { (s.characters[id] as any).name = id === P ? "Rabi" : "May"; (s.characters[id] as any).background = "Works at a design studio downtown. Likes running."; }
  check("two coworkers with nothing on their cards stand level", stationGap(s, EMILY, P) === 0 && stationLine(s, EMILY) === "", stationGap(s, EMILY, P));
}

/* ── 6. where it's written ── */
{
  const s = garden();
  check("the bookkeeper sees a guess and is asked to set it", /station: a commoner from the bottom of society \(rank 12, a guess, so set it\)/.test(stationLedger(s, EMILY)), stationLedger(s, EMILY));
  check("the bookkeeper replaces the guess", setStation(s, EMILY, "a seamstress who sells at the market's edge", 14, "bookkeeper") && stationOf(s, EMILY)?.source === "bookkeeper" && !/a guess/.test(stationLedger(s, EMILY)));
  setStation(s, EMILY, "a lady of the court", 70, "player");
  check("a station the player set stays theirs", !setStation(s, EMILY, "a seamstress", 14, "bookkeeper") && stationOf(s, EMILY)?.rank === 70);
  const id = registerCharacter(s, { name: "Bram", station: { place: "the palace's master of hounds", rank: 32 } } as any);
  check("a forged or newly arrived person keeps the station they came with", stationOf(s, id)?.rank === 32 && stationOf(s, id)?.source === "forge", stationOf(s, id));
}

/* ── 7. the prompts ── */
{
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  const schema = readFileSync("src/engine/schema.ts", "utf8");
  const intent = readFileSync("src/engine/intent.ts", "utf8");
  check("the bookkeeper is asked for stations and shown how", /stations is where someone sits in this world's order/.test(prompts) && /"stations":\[\{"char_id":""/.test(prompts) && /stations: A\(S\(\{ char_id: str, place: str, rank: num \}/.test(schema));
  check("power_delta no longer counts a title being used, which rank now covers", !/a title being used/.test(prompts) && /Rank is already counted from each person's station/.test(prompts));
  check("the forge writes a station for everyone and the world's hierarchy", /"hierarchy":"0 to 1: how much rank governs/.test(prompts) && (prompts.match(/"station":\{"place":/g) ?? []).length >= 3);
  check("the intent pass is told it too", /stationLine\(state, id\),/.test(intent) && /standingToward\(state, id, "char_player"\)/.test(intent));
  const s = garden();
  check("the station line passes the prompt lint", lint(stationLine(s, EMILY)).length === 0, lint(stationLine(s, EMILY)));
  const em = deltaNote(s, "hello").split("\n").find((l) => l.startsWith(`— Emily Veyne`)) ?? "";
  const cue = em.slice(em.indexOf("They are far beneath you"));
  check("…and so does the standing cue", lint(cue.slice(0, cue.indexOf(";") > 0 ? cue.indexOf(";") : undefined)).length === 0, lint(cue));
  check("the cached prefix is untouched by it", !/station:/.test(stablePrefix(s)));
}

/* ── 8. the second run: the rest of her card was written for two people on level ground ──
 *
 * With stations in, Emily curtsied and said "Your Majesty". Then the clenched register had her answer
 * the worst reading "out loud", "voice now" sent her anger "AT the other person", her desire had her
 * "flirt, tease, angle to get close", and she told the king "I don't think you know, and I don't
 * think you like not knowing", and, with a guard's hand on her arm, "You cannot put someone in a
 * cell for the afternoon because the conversation tired you." */
{
  const s = garden();
  const c = (s.condition as any)[EMILY];
  c.psyche.relaxation = -8;
  const e = (s.world.edges as any[]).find((x) => x.from === EMILY && x.to === P);
  e.attraction = 41; e.desire_admissibility = 0.7;
  const card = volatileDigest(s, "riff raff");
  const em = card.slice(card.lastIndexOf(`— Emily Veyne [${EMILY}]`));
  check("clenched, she answers the king's words in a stiff, overcareful answer and says the rest elsewhere", /IS TAKING THINGS[^\n]*When the one they'd answer is King Aldric the First, who stands far above them, the misreading shows in a stiff, overcareful answer/.test(em), em.match(/IS TAKING THINGS[^\n]*/)?.[0]?.slice(-400));
  check("her anger toward him stays inside the forms", /voice now:[^\n]*toward King Aldric the First, far above them, it stays inside the forms/.test(em), em.match(/voice now:[^\n]*/)?.[0]);
  check("her wanting him shows as looks and small liberties she takes back", /desire toward you: (?:real|strong)[^\n]*\. Between people this far apart it shows inside the forms/.test(em), em.match(/desire toward you:[^\n]*/)?.[0]);
  const dn = deltaNote(s, "riff raff").split("\n").find((l) => l.startsWith("— Emily Veyne")) ?? "";
  check("far beneath him she keeps her opinion of him to herself and lets him end it", /keep their opinion of you, and of what kind of man or woman you are, to themselves, and let you be the one to end the conversation/.test(dn));
  const flat = garden();
  (flat.world_bible as any).hierarchy = 0.1;
  (flat.condition as any)[EMILY].psyche.relaxation = -8;
  const fe = (flat.world.edges as any[]).find((x) => x.from === EMILY && x.to === P);
  fe.attraction = 41; fe.desire_admissibility = 0.7;
  const fc = volatileDigest(flat, "riff raff");
  check("between equals the same card keeps its argument and its flirting", !/far above them|Between people this far apart/.test(fc.slice(fc.lastIndexOf(`— Emily Veyne [${EMILY}]`))));
  for (const clause of [/When the one they'd answer is[^\n]*/, /toward King Aldric the First, far above them[^\n]*/, /Between people this far apart[^\n]*/]) {
    const t = em.match(clause)?.[0] ?? "";
    if (t) check(`the clause passes the prompt lint: "${t.slice(0, 40)}…"`, lint(t).length === 0, lint(t));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
