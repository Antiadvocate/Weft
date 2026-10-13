/* Smoke test: THE KINGDOM OF VEYTHAR.
 *
 * A god-mode save, 27 turns, one afternoon. The player's account: "There are so many failures here I
 * can't even enumerate them." The engine's faults in it, each pinned with the save's own prose:
 * people dismissed in pronouns never left; people left behind in the garden came along; someone at
 * the Golden Lily was listed in the throne room; a woman narrated the king's every move back to him
 * for six turns while he objected; the POV check misread a room of unnamed guards as the king in the
 * third person and corrected the narrator for ten turns; and the notices read "keeps going back over
 * the exposed", reported feelings for the dead, and called fear of him "possessive". */
import { departureEvidence } from "../src/engine/exit";
import { onlySeenFromAfar } from "../src/engine/turn";
import { toldLines, findNarratedBack, narratedBackFix } from "../src/engine/narratedback";
import { povDrift } from "../src/engine/integrity";
import { ruminationLine, releasedLine, moodPassedLine, feelingKind } from "../src/engine/emotions";
import { castGoneCold } from "../src/engine/social";
import { playerTrip } from "../src/engine/leaving";
import { EMPTY_READ, setRead, type ActionRead } from "../src/engine/actionread";
import { rejectedBy } from "../src/engine/rejection";
import { newSave } from "../src/engine/state";
import { lint } from "../tools/promptlint";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

// ── 1. dismissed in pronouns, and gone ──
const T14 = `Isolde gets up.\n\nIt is slow, because her burned hands cannot take her weight at first. She rocks forward, catches herself on her forearm, and rises. She does not shake it back. She walks out with her head up, and she does not look at Emily as she passes.\n\nThe door closes behind her.\n\nEmily is still standing where she stopped, one foot half-covered in grey ash.`;
const T15 = `The guards move before the last word is out of your mouth.\n\nTwo of them step to Emily, one on each side, and the older one takes her by the arm. She tries to pull back, but the guard's grip holds.\n\nThe guards do not wait. They turn her toward the door, and her head twists back over her shoulder as they walk her out.\n\nA footstep sounds behind one of the side pillars, and Lady Isolde steps into the light.`;
check("'She walks out' takes Isolde out, though the nearest name is Emily's", departureEvidence({ prose: T14, name: "Lady Isolde D’Veyth", others: ["Emily Veyne"], pronouns: "she/her", othersPronouns: ["she/her"], destination: "elsewhere" }).ok);
check("…and leaves Emily, who stayed", !departureEvidence({ prose: T14, name: "Emily Veyne", others: ["Lady Isolde D’Veyth"], pronouns: "she/her", othersPronouns: ["she/her"], destination: "elsewhere" }).ok);
check("'as they walk her out' takes Emily out", departureEvidence({ prose: T15, name: "Emily Veyne", others: ["Lady Isolde D’Veyth"], pronouns: "she/her", othersPronouns: ["she/her"], destination: "elsewhere" }).ok);
check("a 'he' doesn't take a woman out", !departureEvidence({ prose: "Tom shrugged at Anna. He walked out.", name: "Anna", others: ["Tom"], pronouns: "she/her", othersPronouns: ["he/him"], destination: "elsewhere" }).ok);

// ── 2. left behind, not following ──
const T9 = `You turn from Emily and start back along the path toward the palace, the two guards falling in behind you.\n\nBehind you, Emily's voice comes clearly across the garden, not loud, but pitched to reach you. "You didn't have to do the shoes."\n\nHe just stares after Emily with his shears hanging loose at his side.`;
const T10 = `In your room, the light falls long and low across the floor.\n\nBelow, through the window, you can see the garden where you left Emily. She is still standing on the path where the guards were called. Emily has not sat down to put them on.`;
check("calling after the player across the garden is not being with him", onlySeenFromAfar(T9, ["Emily Veyne", "Emily"]));
check("seen through the window is not being in the room", onlySeenFromAfar(T10, ["Emily Veyne", "Emily"]));
check("someone actually in the room is", !onlySeenFromAfar(T14, ["Emily Veyne", "Emily"]) && !onlySeenFromAfar(`Emily laughs and sits beside you on the bench.`, ["Emily"]));
const turn = readFileSync("src/engine/turn.ts", "utf8");
check("the footer, the presence floor and travelling companions all honour it", (turn.match(/onlySeenFromAfar\(prose,/g) ?? []).length >= 3);
const prompts = readFileSync("src/engine/prompts.ts", "utf8");
check("the bookkeeper and the footer are told the same", /calling after the player across a garden, seen through a window/.test(prompts) && /someone the player left behind, who calls after them across a garden/.test(prompts));
const s0 = newSave("V", { name: "V" } as any);
s0.world.places = { gardens: { id: "gardens", name: "The Royal Gardens" }, palace: { id: "palace", name: "The Royal Palace of Veythar" }, tav: { id: "tav", name: "The Black Boar Tavern" } } as any;
s0.world.player_location = "gardens";
check("'I go back to the castle', read as the palace, is a trip there", playerTrip(s0, { ...EMPTY_READ, did: "goes back to the castle", leaving: { going: true, to: "the castle", place: "palace", home: false } })?.toId === "palace");

// ── 3. nobody listed in a room the prose never shows them in ──
check("a footer entry for someone not already here needs the narration to name them", /const shownHere = \(id: string\): boolean =>/.test(turn) && /if \(!shownHere\(id\)\) continue;/.test(turn) && /if \(id && shownHere\(id\)\)/.test(turn));

// ── 4. told what you're doing ──
check("Emily's lines are caught", toldLines(`"And instead, you're down in the grass being eaten by your own cats."`, "").length === 1 && toldLines(`"Instead you stand up and shout for them."`, "").length === 1 && toldLines(`"You looked," she says. "Twice."`, "").length === 1);
check("ordinary talk isn't", toldLines(`"So you're buying me lunch." "You watched me go." "You're picking the place, remember?" "You're looking at me like I'm the confused one."`, "").length === 0);
// The player's half is the turn read: "I stand" is a read with nothing said, and whether the player
// says they're being narrated at is its call (says_described_back), not a pattern's.
const hit = findNarratedBack(`"Instead you stand up and shout for them."`, [`"And instead, you're down in the grass being eaten by your own cats."`], { ...EMPTY_READ, did: "stands" });
check("it fires when it recurs", !!hit && hit.lines.length === 2);
const objected = `I'd rather enjoy my time rather than having my actions be narrated I suppose?`;   // `"…" I stand up`
check("and at once when the player says so in the scene", !!findNarratedBack("Quiet.", [], { ...EMPTY_READ, said: [objected], did: "stands up", says_described_back: true })?.complained);
const twice = `"You're sitting down." "You're standing."`;
check("the player's own line quoted back isn't held against the scene",
  !!findNarratedBack(twice, [], EMPTY_READ) && findNarratedBack(twice, [], { ...EMPTY_READ, said: ["You're sitting down."] }) === null);
check("an empty read is no complaint", findNarratedBack("Quiet.", [], EMPTY_READ) === null);
const fix = narratedBackFix(hit);
check("the correction names the habit and what to do instead", /DESCRIBING THE PLAYER BACK TO THEM/.test(fix) && /never a report of where the player is sitting/.test(fix) && lint(fix).length === 0, lint(fix));
check("and the turn feeds it back", /narratedBackFix\(state\.last_narrated_back\)/.test(turn));

// ── 5. the POV check and unnamed men ──
const room = `You lift the sword. The guard by the door has his hand on the hilt, and he does not move. The old lord with the chain drops his cup; his hands shake. You step down from the dais. He backs away from you, and his boots scrape the stone. The council watches you, and the man at the end bows his head, and the clerk beside him drops his papers.`;
check("a room of unnamed guards and lords isn't the king in the third person", povDrift(room, "King Aldric the First", "he/him", []) === null);
check("a real slip still is", !!povDrift(`Emily held his gaze a moment, her smile unbalanced now. She kept her eyes on his. "You say that to a lot of women?" she asked, though the question had no teeth, and he did not answer. She laughed, and she looked at his hands, and then at the palace, and then back at his face, and waited for him to say something more.`, "King Aldric the First", "he/him", []));

// ── 6. the notices ──
check("'keeps going back over the exposed' reads as English", ruminationLine("Emily Veyne", "exposed", "she/her") === "Emily Veyne keeps going back over what left her exposed, and reliving it has become painful in itself.");
check("'King Aldric the First's energized passes on its own' too", releasedLine("King Aldric the First", "energized", "passes on its own once it has been fully felt") === "King Aldric the First's feeling of being energized passes on its own once it has been fully felt.");
check("a noun stays a noun", ruminationLine("Emily", "fear") === "Emily keeps going back over the fear, and reliving it has become painful in itself." && moodPassedLine("Emily", "fearful") === "Emily is no longer fearful.");
check("'replaying it' is something being done", feelingKind("replaying it") === "doing" && ruminationLine("Emily", "replaying it") === "Emily can't stop replaying it, and it has become painful in itself.");
check("the dead don't get notices about getting used to tension", /if \(!rc \|\| rc\.status === "dead" \|\| rc\.status === "departed"\) continue;/.test(turn));
check("an engine correction goes to the console, not the player", !/so it was dropped and they'll get one of their own`\);/.test(turn.replace(/console\.info\([^)]*\)/g, "")));
check("fear of the player isn't 'possessive'", /\(e\.warmth \?\? 0\) >= 15 && !\(e as any\)\.rejected/.test(readFileSync("src/engine/desire.ts", "utf8")));
// A cold cast in a gentle story, with a turn behind it whose read (kept on its history entry) is
// whatever the case hands in.
const coldCast = (action = "", read: Partial<ActionRead> = {}) => {
  const s = newSave("V", { name: "V", tone: "Action, erotica, love" } as any);
  s.characters = { char_player: { name: "Aldric" }, a: { name: "A" }, b: { name: "B" } } as any;
  s.world.edges = [{ from: "a", to: "char_player", warmth: -40, trust: -40 }, { from: "b", to: "char_player", warmth: -30, trust: -30 }] as any;
  if (action) s.history = [{ turn: 20, player_action: action, read: { ...EMPTY_READ, ...read } }] as any;
  return s;
};
const harm = (what: string, kills = false): Partial<ActionRead> => ({ harms: [{ who: ["a"], what, kills, mass: false }] });
check("the cast going cold is reported in a gentle story", !!castGoneCold(coldCast()));
check("…but not as a fault right after the player's own violence",
  castGoneCold(coldCast("I separate the flesh from her body. And watch her die.", harm("separates the flesh from her body", true))) === null);

// ── 7. what counts as the player's violence ──
// It's the turn read's call (actionread.ts: harms); fear.ts reads it (see tests/fear.ts), and so does
// the cold-cast report above. These are the save's lines with the read a careful reader gives them;
// the verb list that used to decide this never had "skin" on it, nor a typo'd name.
for (const [a, what] of [
  ["I set isolade on fire with a spell.", "sets Isolde on fire with a spell"],
  ["I burn her alive.", "burns her alive"],
  ["I cut his head off with a sword.", "cuts his head off with a sword"],
  ["I separate his head from his body.", "separates his head from his body"],
  ["I smash his head on the ground.", "smashes his head on the ground"],
  ["I spear her directly through the face.", "spears her through the face"],
]) {
  check(`"${a}" is violence`, castGoneCold(coldCast(a, harm(what, true))) === null);
}
check("a threat in dialogue isn't", !!castGoneCold(coldCast(`"I'll kill you." I sit down.`, { said: ["I'll kill you."], threatens: ["a"] })));
check("nor is a turn whose read found nothing", !!castGoneCold(coldCast("I burn her alive.")));
check("no special rule for violent turns: the beat runs as on any turn, and fear is read from what happened", !/violentAct/.test(turn) && /appraiseDanger\(state, \{/.test(turn));

// ── 8. the second run, turn 5: "I haven't found a reason to make you go away", and the player was
// told she'd keep her distance from him now ──
{
  const r = newSave("V", { name: "V" } as any);
  (r.characters as any).char_e = { character_id: "char_e", name: "Emily Veyne", pronouns: "she/her" };
  r.world.edges.push({ from: "char_e", to: "char_player", warmth: 30, trust: 10, power: 0, attraction: 50 } as any);
  const said = `"No. Girls don't wander into the garden. I am a king. And guarded as one. But you are here. And I am sitting here. And I haven't found a reason to make you go away" I let the fire dissipate`;
  // who a line turns away is the turn read's call (actionread.ts); each line gets the read a careful
  // reader gives it, and the engine does what that read says
  const turned = (action: string, read: Partial<ActionRead>) => { setRead(r, action, read); return rejectedBy(r, action, ["char_e"]); };
  check("\"haven't found a reason to make you go away\" turns nobody away", turned(said, {}).length === 0);
  check("\"I don't want you to go away\" either", turned(`"I don't want you to go away."`, {}).length === 0);
  check("\"Go away. Don't come back.\" still does", turned(`"Go away. Don't come back."`, { turns_away: ["char_e"] }).length === 1);
  check("\"Leave me alone, Emily\" still does", turned(`"Leave me alone, Emily."`, { turns_away: ["char_e"] }).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
