/* Smoke test: NOBODY IN THIS WORLD IS HOLDING ANYTHING.
 *
 * A player's report: "For the most part all my NPCs just stand around uselessly. But in reality
 * people are texting, on their phones, watching shows, doing stuff. Multitasking. The more tense,
 * the more stuff they tend to be doing all at once, they aren't pissed they're just splitting their
 * attention a lot. And this doesn't seem to happen in Weft at all."
 *
 * Both halves of that are checked here.
 *
 * WHY NOTHING WAS IN ANYBODY'S HANDS. The rule exists — NARRATOR_SYSTEM carries "EVERY PRESENT
 * CHARACTER ACTS OR EXITS", and it names the failure exactly ("presence made only of posture is
 * furniture"). It sits in the cached prefix, which this engine has recorded three times over is
 * read as reference, and it supplies nothing to act with: a narrator told to invent an action out
 * of nothing invents a posture, which is the thing the rule bans, arrived at by obeying it.
 *
 * Meanwhile `current_activity` had been declared on the Identity type since the beginning. Nothing
 * wrote it, no prompt contained it, and Cast.tsx printed it to the player. Section 4 is the test
 * that it now survives a turn.
 *
 * WHY TENSION NARROWED INSTEAD OF SPLITTING. Three systems map a low relaxation reading and all
 * three collapse the attention: aperture.ts ("narrows onto the one thing"), deriveVoice at r ≤ −7
 * ("clenched — under pressure and it is going somewhere"), clench.ts. Every one of them is right
 * about a knife in a corridor and none of them describes a woman carrying four open loops through
 * a dinner she did not want to be at. So occupation is a second axis rather than a correction, and
 * the one place the old reading is still correct — a guarded scene — is where this stands down.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import { occupationOf, occupiedDirective, toHand, activityLine, SPLIT_AT, SCATTERED_AT } from "../src/engine/occupied";
import { charCard, stablePrefix, simulatorContext, FORGE_SYSTEM } from "../src/engine/prompts";
import { sceneRegister } from "../src/engine/register";
import { lint } from "../tools/promptlint";
import { figured } from "../src/engine/aphorism";
import type { SaveState, Condition } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const cond = (relaxation: number) => ({ psyche: { relaxation }, inventory: [] } as unknown as Condition);

function bar(): { s: SaveState; mirela: string; tom: string } {
  const s = newSave("occupied", {
    name: "Elm Street", era: "contemporary",
    technology_level: "Phones, laptops, a television behind the bar, contactless card readers.",
  } as any);
  s.world.places["loc_bar"] = { id: "loc_bar", name: "The Anchor", description_facts: "Long zinc bar, a television on mute.", contains: [] } as any;
  s.world.player_location = "loc_bar";
  registerCharacter(s, { name: "Max", character_id: "char_player", pronouns: "he/him", age: 39,
    appearance_facts: "Curly hair.", core_traits: ["quiet"], values: ["privacy"] } as any);
  const mirela = registerCharacter(s, { name: "Mirela", pronouns: "she/her", age: 34,
    appearance_facts: "Short dark hair.", core_traits: ["Counts the float twice"], values: ["order"],
    texture: ["the away match she will not admit she follows", "her sister's new flat"] } as any);
  const tom = registerCharacter(s, { name: "Tom", pronouns: "he/him", age: 61,
    appearance_facts: "Heavy grey beard.", core_traits: ["Repeats the punchline"], values: ["company"] } as any);
  for (const id of [mirela, tom, "char_player"]) s.characters[id].location = "loc_bar";
  s.world.present = [mirela, tom];
  s.world.current_turn = 12;
  return { s, mirela, tom };
}

/* ── 1. the band, and which direction it runs ────────────────────────────────── */
{
  check("a settled person still has one thing going", occupationOf(cond(4), false) === "occupied");
  check("a resting reading is not an empty pair of hands", occupationOf(cond(0), false) === "occupied");
  check("tense splits it", occupationOf(cond(SPLIT_AT), false) === "split");
  check("...and further down it scatters", occupationOf(cond(SCATTERED_AT), false) === "scattered");
  check("the floor is scattered, not still", occupationOf(cond(-10), false) === "scattered");

  // THE WHOLE DISTINCTION THE REPORT DRAWS. A held moment is the one place the attention really does
  // collapse, and it is the one place every other unrefusable injection in this engine stands down.
  check("a guarded scene collapses it to one thing", occupationOf(cond(-10), true) === "single");
  check("...even for somebody settled", occupationOf(cond(8), true) === "single");
  check("a missing condition record is not a crash", occupationOf(undefined, false) === "occupied");
}

/* ── 2. the block names the people in the room ───────────────────────────────── */
{
  const { s, mirela, tom } = bar();
  s.condition[mirela].psyche.relaxation = -7;
  s.condition[tom].psyche.relaxation = 3;
  const d = occupiedDirective(s, s.world.present, false);

  check("it fires at all", d.length > 0, d);
  check("both present characters get a row", d.includes("Mirela") && d.includes("Tom"), d);
  check("the player is not one of them", !d.includes("Max"), d);
  check("the tense one is told she is carrying several things", /Mirela \(-7\.0\) — four or five things/.test(d), d);
  check("the settled one gets one thing going alongside", /Tom \(3\.0\) — one thing going alongside/.test(d), d);
  // …and it does NOT reprint what the digest already carries. prompts.ts sends texture every turn
  // as "raises these unprompted"; paying for the same four strings twice a turn buys nothing, which
  // is the economy voiceAnchor's own header argues for in the other direction.
  check("her standing interests are left to the block that already prints them",
    !/the away match she will not admit she follows/.test(d), d);

  // THE LINE THE REPORT IS ABOUT: sharpness under load is busyness, and the engine's own r ≤ -7 band
  // ("clenched — under pressure and it is going somewhere") is what the player was reading as anger.
  check("split attention is separated from anger", /which is what busy sounds like/.test(d), d);
  check("...and anger still needs the state to say so", /anger goes on the page only where this turn's state says they are angry/.test(d), d);

  // …and the note about five loops is only sent to a room that has somebody at the bottom of the scale.
  const calm = bar();
  calm.s.condition[calm.mirela].psyche.relaxation = 2;
  calm.s.condition[calm.tom].psyche.relaxation = 3;
  const quiet = occupiedDirective(calm.s, calm.s.world.present, false);
  check("a calm room is not told about somebody losing hold of it", !/losing hold of it one piece at a time/.test(quiet), quiet);
  check("...and is still told their hands are doing something", /one thing going alongside/.test(quiet), quiet);
}

/* ── 3. where it stands down ─────────────────────────────────────────────────── */
{
  const { s, mirela, tom } = bar();
  s.condition[mirela].psyche.relaxation = -8;
  check("nothing is sent into a guarded scene", occupiedDirective(s, s.world.present, true) === "", occupiedDirective(s, s.world.present, true));
  // the register that produces that verdict, from the prose, is the one every other mandate reads
  check("...and that is the register the rest of the engine stands down on",
    sceneRegister("She held her breath. Neither spoke.").guarded === true);
  check("an ordinary tense evening is not guarded",
    sceneRegister("She put the glass down harder than she meant to and asked him again.").guarded === false);

  s.characters[tom].status = "departed";
  const d = occupiedDirective(s, s.world.present, false);
  check("somebody who has left the story gets no row", !d.includes("Tom"), d);
  check("an empty room sends nothing", occupiedDirective(s, [], false) === "");
  check("a room of nobody but the player sends nothing", occupiedDirective(s, ["char_player"], false) === "");
}

/* ── 4. THE FIELD THAT WAS DECLARED AND FORGOTTEN ────────────────────────────── */
{
  const { s, mirela } = bar();
  check("nothing is claimed for a character who has no record of it", activityLine(s.characters[mirela]) === "");
  check("...and toHand reports it empty rather than guessing", toHand(s, mirela).was === "");

  s.characters[mirela].current_activity = "wiping the taps down, phone face-down by the till";
  s.condition[mirela].inventory = [{ id: "i1", name: "bar towel" }, { id: "i2", name: "her phone" }] as any;

  check("what she was doing carries into the next turn's block",
    /still: wiping the taps down/.test(occupiedDirective(s, s.world.present, false)));
  check("...and what she is carrying is named", /on them: bar towel, her phone/.test(occupiedDirective(s, s.world.present, false)));

  // and onto the character card, which is where the narrator meets her
  const card = charCard(mirela, s.characters[mirela], s.condition[mirela], [], false, undefined, "", true);
  check("the card says what her hands were on", /Doing: wiping the taps down, phone face-down by the till\./.test(card), card);
  check("...before it says anything about her core traits", card.indexOf("Doing:") < card.indexOf("Core:"), card);

  const blank = charCard("char_player", s.characters["char_player"], s.condition["char_player"], [], false, undefined, "", true);
  check("a character with nothing on file gets no clause at all", !/Doing:/.test(blank), blank);
}

/* ── 5. THE WORLD'S OBJECTS STOP BEING ONLY A CEILING ────────────────────────────
 *
 * Two prompts carry technology_level and they carry it differently, which is the finding. The
 * BOOKKEEPER got a rule: "tech law — do NOT let anyone use what this rules out", written to stop a
 * phone call in a no-signal world. The NARRATOR — the one writing what people do with their hands —
 * got the bare field under a label, with no rule attached in either direction. So the one place in
 * the engine that knows a save has phones in it mentioned them only in order to bound them, in the
 * prompt that does not write prose.
 */
{
  const { s } = bar();
  const pre = stablePrefix(s);
  check("the narrator is told the world's objects are there to be picked up",
    /everything here exists to be picked up/.test(pre), "");
  check("...and that the cast handles them unprompted",
    /this cast handles it all day without being asked to/.test(pre), "");
  check("the world's own list is what is offered", /a television behind the bar/.test(pre), "");

  const sim = simulatorContext(s);
  check("the bookkeeper's ceiling is untouched", /do NOT let anyone use what this rules out/.test(sim), "");
  check("...and it gained the floor too", /DO let them use what it contains/.test(sim), "");
}

/* ── 5b. AND THE BOOKKEEPER CAN ACTUALLY WRITE IT ────────────────────────────────
 *
 * The block in section 2 reads `current_activity` and nothing in this engine has ever written it.
 * Without this half it resets every turn and a woman puts her phone down and picks it up again
 * forever, because the next turn is told nothing about what the last one established.
 *
 * Carried on the existing facts[] channel as a new field rather than a new array: the diff already
 * declares about thirty arrays and one more per turn is a cost the sim budget notices.
 */
{
  const { s, mirela } = bar();
  const facts = (rows: { char_id: string; field: string; value: string }[]) =>
    applyDiff(s, { facts: rows } as any, "", "", true);

  facts([{ char_id: mirela, field: "doing", value: "half-watching the match with the sound off, restacking the clean glasses" }]);
  check("the bookkeeper's entry lands on the character",
    s.characters[mirela].current_activity === "half-watching the match with the sound off, restacking the clean glasses",
    s.characters[mirela].current_activity);
  check("...and comes back out on the next turn's block",
    /still: half-watching the match/.test(occupiedDirective(s, s.world.present, false)));

  facts([{ char_id: mirela, field: "doing", value: "nothing" }]);
  check("a scene that empties somebody's hands can say so", s.characters[mirela].current_activity === undefined,
    s.characters[mirela].current_activity);

  facts([{ char_id: mirela, field: "doing", value: "  " }]);
  check("...and so does a blank", s.characters[mirela].current_activity === undefined);

  const long = "x".repeat(400);
  facts([{ char_id: mirela, field: "doing", value: long }]);
  check("a runaway value is cut before it reaches a card",
    (s.characters[mirela].current_activity ?? "").length <= 170, (s.characters[mirela].current_activity ?? "").length);

  facts([{ char_id: "char_nobody", field: "doing", value: "pacing" }]);
  check("an entry for somebody who does not exist changes nothing", true);
}

/* ── 5c. WHY THEY KEEP CHECKING IT ───────────────────────────────────────────────
 *
 * A phone turned over for no reason is set dressing, and a cast fiddling with props is a different
 * kind of empty from a cast standing still. The ledger that says who is waiting on whom already
 * exists and reaches nothing: tools/audit.ts on a 45-turn save reports world.promises at 0 of 16
 * fields reaching any prompt.
 */
{
  const { s, mirela, tom } = bar();
  s.condition[mirela].psyche.relaxation = -4;
  s.world.promises = [
    { id: "p1", from: tom, to: mirela, text: "bring the ladder back before Sunday", made_turn: 6, weight: 1, status: "open" },
    { id: "p2", from: mirela, to: "char_player", text: "tell him what the brewery said", made_turn: 9, weight: 2, status: "open" },
    { id: "p3", from: tom, to: mirela, text: "a thing that is over", made_turn: 2, weight: 1, status: "kept" },
  ] as any;
  const d = occupiedDirective(s, s.world.present, false);

  check("what she is waiting on somebody for is named", /waiting on Tom — bring the ladder back/.test(d), d);
  check("...and so is what she owes", /owes Max — tell him what the brewery said/.test(d), d);
  check("a settled promise is left out of it", !/a thing that is over/.test(d), d);
  check("the reason is given as a reason to look, and stays a gesture",
    /they do not say who it is or explain the delay/.test(d), d);

  const clean = bar();
  check("a world with an empty ledger says nothing about it",
    !/unfinished with somebody not here/.test(occupiedDirective(clean.s, clean.s.world.present, false)));
  check("toHand reports the loops it found", toHand(s, mirela).owed.length === 2, toHand(s, mirela).owed);
}

/* ── 5d. HOW THIS PERSON IS WITH THEIR WORLD'S MACHINERY ─────────────────────────
 *
 * The forge already asks for standing interests and gets a bird, a road, a nephew. Nothing has ever
 * asked what a character's hands are on for most of their day, which in a contemporary save is a
 * phone and in a bronze-age one is a whetstone. Same question, and the field for it already exists.
 */
{
  check("the forge asks how each person is with the machinery of their own world",
    /HOW THIS PERSON IS WITH THE MACHINERY OF THEIR OWN WORLD/.test(FORGE_SYSTEM));
  check("...with contemporary examples", /the phone face-down at dinner or answered in the middle of a sentence/.test(FORGE_SYSTEM));
  check("...and the version for a world that has none of it", /the whetstone, the loom, the tally sticks/.test(FORGE_SYSTEM));
}

/* ── 6. a screen is still nobody else's business ─────────────────────────────── */
{
  // scene.ts already protects the PLAYER's screen from being read across the room. The same has to
  // hold for everyone else's, or this block hands the narrator a cast of mind readers.
  const { s, mirela } = bar();
  s.condition[mirela].psyche.relaxation = -5;
  const d = occupiedDirective(s, s.world.present, false);
  check("nobody reads a screen across the room", /nobody reads it across the room/.test(d), d);
  check("...and nobody guesses the content right", /guesses it right/.test(d), d);
}

/* ── 7. it is written the way this engine now requires ───────────────────────── */
{
  const { s, mirela } = bar();
  s.condition[mirela].psyche.relaxation = -8;
  const d = occupiedDirective(s, s.world.present, false);
  const findings = lint("const D = `" + d.replace(/`/g, "'") + "`;");
  check("the block carries no instruction written as an epigram", findings.length === 0, findings);
  check("...and no sentence in it is a figure", !figured(d), d);
  // THE GENRE-AGNOSTIC HALF. Nothing in the block names a phone: the objects come from this world's
  // own material list, which is in the prefix and is a whetstone and a loom in the save that has
  // those. A block that named phones would be a contemporary feature bolted onto an engine whose
  // presets are a bronze-age fishing camp and a cyber-industrial slum.
  check("the block names no device of its own", !/\b(phone|laptop|tv|television|app|feed|text)\b/i.test(d), d);
  check("...and the one surface it does name works in any world", /on a screen or a page/.test(d), d);
  check("...while the objects come from this world's own list",
    /out of what this world contains and what is in this room/.test(d), d);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
