/* Smoke test: A ROOM WITH TWO PEOPLE IN IT AND NOBODY SPEAKING.
 *
 * The complaint, on a 48-turn save: "Characters do not talk at all. Non reactions, HEAVY prose of
 * just atmosphere. Everything is ambiance. Zero actual humans." Measured on that save's history:
 * 12.2% of the prose was quoted speech, and five turns contained none at all — in a house with a
 * wife and a three-year-old in it, the wife written as somebody who cannot stop asking questions.
 *
 * tests/dialogue-shape.ts already found the mechanism and named it: every channel for conveying a
 * person has been closed except an observable action. Interiority is forbidden, captioning is
 * forbidden, comparison is forbidden, the camera may only report what a person could point at. All
 * of those are right and none of them is repealed here. But they are PROHIBITIONS, they hold every
 * position that wins — including the last two notes before generation — and the cheapest output
 * that satisfies all of them at once is a paragraph of bodies and weather.
 *
 * Three things are checked, one per repair:
 *   1. the detector fires on a sustained mute stretch and NOT on a quiet beat, a solo scene, or a
 *      room whose only other occupant is asleep;
 *   2. the last note before generation now contains a positive ask, not only prohibitions;
 *   3. a three-year-old is given a three-year-old's grammar, and a fifty-year-old is not.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest } from "../src/engine/prompts";
import { findMute, muteFix, spokenShare } from "../src/engine/dialogue";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** Atmosphere, verbatim in shape from the save this came from: bodies, cloth, light, no mouths. */
const MUTE_TURN = `The room settled into the long blue of evening. Livia had gone still under the blanket, the rise and fall of her breathing slow enough that the words seemed to move through her and leave the bed untouched. Her hand lay open on the cover, and the tips of her toes made a small ridge in the wool where they curled and relaxed, once. Outside, the street had gone fully blue, and the last voice from the next street over had stopped calling. The lamp guttered and steadied. Steam had begun to bead on the tile above the basin, and the water in the tub sloshed softly against the rim, and settled, and was still.`;

/** The same length, with people in it. Written as single-line paragraphs because that is the shape
 *  narrator prose actually arrives in, and the reader deliberately does not match a quote across a
 *  newline — an unterminated quotation mark should not swallow the rest of the turn. */
const TALKY_TURN = [
  `"Bar it," she said. "Bar it now, and don't leave me to lock up while you walk toward the Guard — stay, the loaves can burn." She had her hand on his sleeve already. "Who was at the door asking for you, one man or three, tell me, don't go out to the street."`,
  `"Nobody was at the door."`,
  `"Somebody was at the door. Marcus. Somebody was at the door and you went out to it. Who was it, what did he want, did he give a name, did he look at the ovens."`,
  `He put the bar up himself. She watched him do it and counted the beam, and the hinge, and the latch, on three fingers, and did not let go of the sleeve.`,
].join("\n");

function fixture(prose: string[], opts: { alone?: boolean; asleep?: boolean } = {}) {
  const s: any = newSave("t", { name: "Marcus" } as any);
  s.world.places["loc_shop"] = { id: "loc_shop", name: "The shop", description_facts: "Flour.", contains: [] };
  s.world.player_location = "loc_shop";
  registerCharacter(s, { name: "Marcus", character_id: "char_player" } as any);
  const w = registerCharacter(s, { name: "Livia", age: 19 } as any);
  s.characters[w].location = "loc_shop";
  s.world.present = opts.alone ? ["char_player"] : ["char_player", w];
  if (opts.asleep) s.condition[w].conditions = ["asleep"];
  s.history = prose.map((p, i) => ({ turn: i + 1, player_action: "I wait.", narrator_prose: p, summary: "", offscreen: [], time_label: "", weather: "" }));
  return { s, w };
}

/* ── 1. the measurement itself ───────────────────────────────────────────────── */
{
  check("a turn of pure atmosphere scores near zero", spokenShare(MUTE_TURN) < 0.02, spokenShare(MUTE_TURN));
  check("a turn of people talking scores high", spokenShare(TALKY_TURN) > 0.5, spokenShare(TALKY_TURN));
  check("empty prose does not divide by zero", spokenShare("") === 0);
}

/* ── 2. IT FIRES ON A SUSTAINED STRETCH ──────────────────────────────────────── */
{
  const { s } = fixture([MUTE_TURN, MUTE_TURN, MUTE_TURN, MUTE_TURN]);
  const v = findMute(s);
  check("four mute turns in an occupied room is caught", !!v, v);
  check("...and it reports what it measured", (v?.pct ?? 99) < 8, v);
  check("...and who was standing there", v?.present.includes("Livia") === true, v);
  const note = muteFix(v);
  check("the correction names the person who did not speak", /Livia/.test(note));
  check("...and hands the turn back to the wants, not to a word count", /what they want in the next minute/i.test(note), note);
  check("...and explicitly refuses to become a quota", /Not a quota/i.test(note));
  check("...and refuses filler as the fix", /pleasant agreeable noise/i.test(note));
}

/* ── 3. WHAT IT MUST NOT TOUCH ───────────────────────────────────────────────── */
{
  // A held beat. One silent turn in a talking scene is the contract working, not failing.
  check("one quiet turn among three talking ones is left alone",
    findMute(fixture([TALKY_TURN, TALKY_TURN, MUTE_TURN, TALKY_TURN]).s) === null);
  // Two silent turns still inside a talking stretch — a lull, not a house style.
  check("a lull is still a lull",
    findMute(fixture([TALKY_TURN, MUTE_TURN, MUTE_TURN, TALKY_TURN]).s) === null);
  // Nobody to talk to. The player alone in a room did not fail to write dialogue.
  check("a solo scene is exempt", findMute(fixture([MUTE_TURN, MUTE_TURN, MUTE_TURN, MUTE_TURN], { alone: true }).s) === null);
  // A sleeping body is a body, not a character written as furniture.
  check("an asleep companion is exempt", findMute(fixture([MUTE_TURN, MUTE_TURN, MUTE_TURN, MUTE_TURN], { asleep: true }).s) === null);
  // Not enough history to call it a pattern.
  check("two turns is not a pattern", findMute(fixture([MUTE_TURN, MUTE_TURN]).s) === null);
  check("nothing to say when there is nothing to fix", muteFix(null) === "");
}

/* ── 4. THE LAST NOTE BEFORE GENERATION IS NO LONGER ALL PROHIBITION ─────────── */
{
  const turnSrc = readFileSync("src/engine/turn.ts", "utf8");
  const tail = turnSrc.slice(turnSrc.indexOf("const SURFACE_TAIL"), turnSrc.indexOf("const SURFACE_TAIL") + 1400);
  check("the surface rule still closes interiority", /No motive, no concealment named, no gesture captioned/.test(tail));
  check("...and still forbids the caption and the comparison", /as if \/ as though/.test(tail));
  // THE REPAIR: the one channel that stays open when the others close, said at the position that wins.
  check("but speech is now named as the open channel", /SPOKEN WORDS/.test(tail), tail.slice(0, 400));
  check("...and the banned interpretation is given a mouth to come out of", /a person in the room may still SAY/.test(tail));
  check("...and the turn is asked for talking, positively", /write them talking/.test(tail));
}

/* ── 5. A THREE-YEAR-OLD TALKS LIKE A THREE-YEAR-OLD ─────────────────────────── */
{
  /* The save had a 3-year-old delivering this, and it passed every rule in the contract:
   *     "I eat dinner before sweets. I ate the eggs. They were on the plate."
   *     "I won't be too big. I'll fit sideways."   "Cats don't have wings. They have feet."
   * A rebuttal, a distinguished case, a corrected premise. The only age signal near generation was
   * "a child's plain, direct cadence", which covered everyone from two to twelve — a register with
   * no limit in it, and all three of those lines are plain and direct. */
  const s: any = newSave("t", { name: "Marcus" } as any);
  s.world.places["loc_shop"] = { id: "loc_shop", name: "The shop", description_facts: "Flour.", contains: [] };
  s.world.player_location = "loc_shop";
  registerCharacter(s, { name: "Marcus", character_id: "char_player" } as any);
  const kid = registerCharacter(s, { name: "Alice", age: 3, background: "Born in the shop.", core_traits: ["willful"] } as any);
  const gran = registerCharacter(s, { name: "Lucia", age: 62, background: "Runs the inn.", core_traits: ["Counts twice"] } as any);
  s.characters[kid].location = "loc_shop"; s.characters[gran].location = "loc_shop";
  s.world.present = ["char_player", kid, gran];

  const ctx = volatileDigest(s, "");
  const a = ctx.slice(ctx.indexOf("=== HOW THESE PEOPLE SPEAK"));
  const alice = a.slice(a.indexOf("Alice, 3"), a.indexOf("Lucia, 62"));

  check("the toddler's age carries a grammar, not just a register", /three to six words/.test(alice), alice.slice(0, 600));
  check("...one clause", /ONE clause/.test(alice));
  check("...and the specific moves that produced the complaint are named as wrong",
    /marshal evidence|build an argument/.test(alice) && /correct somebody's premise/.test(alice), alice);
  check("...and her refusals are given their real shape", /'no' or 'want it'/.test(alice));
  check("an older adult is not handed a toddler's limit", !/three to six words/.test(a.slice(a.indexOf("Lucia, 62"))));
  check("...and still gets her own band", /settled, unhurried cadence/.test(a.slice(a.indexOf("Lucia, 62"))), a.slice(a.indexOf("Lucia, 62"), a.indexOf("Lucia, 62") + 300));

  /* AND THE BAND THAT WAS HANDING OUT THE COMPLAINED-OF REGISTER IN THE FIRST PLACE. The teen band
   * read "a teenager's slangy, testing cadence" — a modern register asserted over every world the
   * engine can build, and a quality-noun that resolves to attitude, which is the thing the player
   * named. A nineteen-year-old running a Roman household does not have slang. */
  const teen = registerCharacter(s, { name: "Nona", age: 19, background: "Keeps her father's house.", core_traits: ["absolute"] } as any);
  s.characters[teen].location = "loc_shop"; s.world.present.push(teen);
  const t = volatileDigest(s, "");
  const nona = t.slice(t.indexOf("Nona, 19"), t.indexOf("Nona, 19") + 400);
  check("no band asserts a modern register over the world's own speech", !/slangy/.test(nona), nona);
  check("...and the teen band says something structural instead",
    /shorter stock of things to compare anything to/.test(nona), nona);
}

/* ── 6. THE STRUCTURAL VOICE FIELDS REACH THE POINT OF GENERATION ────────────── */
{
  /* voice.syntax and voice.rhythm are the fields that decide how long and how built a line is, and
   * they were printed ONLY on the cached identity card, thousands of tokens above the write. The
   * save had a woman whose recorded syntax is "stacked questions with no answer between them" and
   * whose rhythm is "breathless run-ons under threat" saying "I'll come." for forty turns. */
  const s: any = newSave("t", { name: "Marcus" } as any);
  s.world.places["loc_shop"] = { id: "loc_shop", name: "The shop", description_facts: "Flour.", contains: [] };
  s.world.player_location = "loc_shop";
  registerCharacter(s, { name: "Marcus", character_id: "char_player" } as any);
  const w = registerCharacter(s, {
    name: "Livia", age: 19, background: "Grew up over the ovens.", core_traits: ["fearful"],
    voice: {
      diction: "fearful-fast; slaves denounced, spies at the door",
      syntax: "stacked questions with no answer between them",
      rhythm: "breathless run-ons under threat, then a sudden count on her fingers to steady",
      tics: ["counts fingers aloud when the fear peaks"],
    },
  } as any);
  s.characters[w].location = "loc_shop";
  s.world.present = ["char_player", w];
  const ctx = volatileDigest(s, "");
  const a = ctx.slice(ctx.indexOf("=== HOW THESE PEOPLE SPEAK"));

  check("SYNTAX reaches the block that is read last", /stacked questions with no answer between them/.test(a), a.slice(0, 700));
  check("RHYTHM with it", /breathless run-ons under threat/.test(a));
  check("...labelled as deciding length, which is the thing it was missing", /this decides LENGTH and SHAPE/.test(a));
  check("the tic is here too, with its once-a-scene budget", /counts fingers aloud/.test(a) && /at most once in the scene/.test(a));

  // AND THE CONTRACT NO LONGER POINTS AT SAMPLE LINES THAT WERE DELETED. The exemplars were removed
  // from the card on purpose (short samples teach a whole cast to answer in fragments) and two
  // paragraphs of the narrator contract went on telling it to draw word choice and sentence length
  // from "the quoted lines under each name" — an instruction sourcing voice from nothing.
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  check("no instruction still points at quoted samples that are not shipped",
    !/QUOTED LINES UNDER EACH NAME/i.test(prompts));
  check("...and what replaced it names the fields that ARE shipped",
    /WHAT IS PRINTED UNDER EACH NAME IN "HOW THESE PEOPLE SPEAK" IS WHERE EVERY LINE COMES FROM/.test(prompts));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
