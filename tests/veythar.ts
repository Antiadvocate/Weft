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
import { castGoneCold, PLAYER_VIOLENCE } from "../src/engine/social";
import { physicalAct } from "../src/engine/reaction";
import { playerTrip } from "../src/engine/leaving";
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
check("'I go back to the castle' is a trip to the palace", playerTrip(s0, "I go back to the castle.")?.toId === "palace");

// ── 3. nobody listed in a room the prose never shows them in ──
check("a footer entry for someone not already here needs the narration to name them", /const shownHere = \(id: string\): boolean =>/.test(turn) && /if \(!shownHere\(id\)\) continue;/.test(turn) && /if \(id && shownHere\(id\)\)/.test(turn));

// ── 4. told what you're doing ──
check("Emily's lines are caught", toldLines(`"And instead, you're down in the grass being eaten by your own cats."`, "").length === 1 && toldLines(`"Instead you stand up and shout for them."`, "").length === 1 && toldLines(`"You looked," she says. "Twice."`, "").length === 1);
check("ordinary talk isn't", toldLines(`"So you're buying me lunch." "You watched me go." "You're picking the place, remember?" "You're looking at me like I'm the confused one."`, "").length === 0);
const hit = findNarratedBack(`"Instead you stand up and shout for them."`, [`"And instead, you're down in the grass being eaten by your own cats."`], "I stand");
check("it fires when it recurs", !!hit && hit.lines.length === 2);
check("and at once when the player says so in the scene", !!findNarratedBack("Quiet.", [], `"I'd rather enjoy my time rather than having my actions be narrated I suppose?" I stand up`)?.complained);
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
const cold = newSave("V", { name: "V", tone: "Action, erotica, love" } as any);
cold.characters = { char_player: { name: "Aldric" }, a: { name: "A" }, b: { name: "B" } } as any;
cold.world.edges = [{ from: "a", to: "char_player", warmth: -40, trust: -40 }, { from: "b", to: "char_player", warmth: -30, trust: -30 }] as any;
check("the cast going cold is reported in a gentle story", !!castGoneCold(cold));
cold.history = [{ turn: 20, player_action: "I separate the flesh from her body. And watch her die." }] as any;
check("…but not as a fault right after the player's own violence", castGoneCold(cold) === null);

// ── 7. what counts as the player's violence (fear.ts reads it; see tests/fear.ts) ──
for (const a of ["I set isolade on fire with a spell.", "I burn her alive.", "I cut his head off with a sword.", "I separate his head from his body.", "I smash his head on the ground.", "I spear her directly through the face."]) {
  check(`"${a}" is violence`, PLAYER_VIOLENCE.test(physicalAct(a)));
}
check("a threat in dialogue isn't", !PLAYER_VIOLENCE.test(physicalAct(`"I'll kill you." I sit down.`)));
check("no special rule for violent turns: the beat runs as on any turn, and fear is read from what happened", !/violentAct/.test(turn) && /appraiseDanger\(state, \{/.test(turn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
