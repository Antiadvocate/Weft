/* Smoke test: THE ENGINE CAUGHT THE MAXIM ON THE WAY OUT AND SUPPLIED IT ON THE WAY IN.
 *
 * engine/maxims.ts opens on four consecutive turns of a save in which a character answered every
 * question with portable wisdom, and it spends six hundred lines catching that in committed prose.
 * Its header also says, in capitals, what it decided the cause was NOT:
 *
 *     WHAT IT IS NOT. It is not the forge. The cards in that save are specific and good and
 *     contain no aphorism anywhere.
 *
 * True of that save. Nothing checked, on that save or any other. The forge writes diction, syntax,
 * rhythm, agenda and example_lines; driveforge writes a goal; traitforge writes core traits; the
 * bookkeeper writes a whole record for anybody who walks into the prose. Every one of those strings
 * is then printed into the narrator's prompt for the rest of the save, and voiceAnchor prints one
 * example line every turn under the heading ONE OF THEIR ACTUAL LINES.
 *
 * So a maxim on a card is worth more than a maxim in a turn: the turn is read once and the card is
 * read forever. This file is the gate at that intake.
 */
import { figureIn, figured, screenCard, rewriteNote, FIGURES, INSTRUCTION_PRONOUNCEMENTS, PRONOUNCEMENT_FIGURES } from "../src/engine/aphorism";
import { pickFromTail, voiceFaults, type VoiceCard } from "../src/engine/voiceforge";
import { lint } from "../tools/promptlint";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the shapes, on card-sized text ───────────────────────────────────────── */
{
  // Every one of these is a real sentence from this codebase's own record of what it produced —
  // maxims.ts, promptlint.ts, and prompt-shapes.ts each quote their own.
  const CAUGHT = [
    "Everything here has a price.",
    "Metaphors are for men who have time for ghosts.",
    "She has a way of looking at a stone and seeing the wall it came from.",
    "This house breathes without a lung.",
    "There is no dark here, only lamps and neighbours.",
    "They are trying to build a castle out of spun sugar and hope.",
    "He touches people in ways that are not kind.",
    "Needling as a way of making contact with somebody she will not address.",
    "She stands nearer than the argument needs.",
    "A steady hand, not a kind one.",
  ];
  for (const t of CAUGHT) check(`caught: ${t.slice(0, 50)}`, figured(t), figureIn(t));
}

/* ── 2. and the card text it has to leave alone ──────────────────────────────── */
{
  /* THE STANDARD THIS IS HELD TO is written down twice in this repo — in tools/promptlint.ts, where
   * the litotes family was opened too wide and reported thirty findings of which two thirds were
   * ordinary restrictive clauses, and in engine/maxims.ts, whose SHAPES comment says a false
   * positive "puts a real line of dialogue in front of the narrator labelled as a fault, which
   * teaches it to avoid something that was fine". Here it costs a discarded voice card.
   *
   * These are real fields: the traits are from traitforge's own worked examples, the sample lines
   * from voiceforge's tests, the wants from driveforge's. */
  const CLEAN = [
    "Counts under her breath while waiting: steps, coins, sheep.",
    "Will not eat anything from fresh water, and cannot say why.",
    "Holds everything — cup, knife, child — in the same two-handed grip.",
    "Could untangle any knot before she could read; still does it while thinking.",
    "Bed three's bulbs are shot and Trina still books it at twelve minutes.",
    "Hand me the sanitizer spray. No — the other one, the one that stings.",
    "Get the field cleared before the frost, because her brother's family eats from it.",
    "Eleven years in commercial laundry; she knows sodium percarbonate by smell.",
    "Salon jargon and body-part flatness — beds, bulbs, minutes, lotion, sanitizer spray.",
    "Starts fast and slows to a stop in the middle, so the other person answers into the gap.",
    "Argumentative, theological, she disputes the gods' arrangements like a woman haggling over meat.",
    "A crown you keep by murder — is that worship?",
  ];
  for (const t of CLEAN) check(`left alone: ${t.slice(0, 50)}`, !figured(t), figureIn(t));
}

/* ── 3. a short field is not an epigram ──────────────────────────────────────── */
{
  check("three words cannot carry one", !figured("Everything has price"));
  check("an empty field is not a finding", !figured("") && !figured(null) && !figured(undefined));
}

/* ── 4. THE CARD SCREEN, field by field ──────────────────────────────────────── */
{
  const card = {
    speech_pattern: "She has a way of answering a question with the price of something else.",
    background: "Eleven years in commercial laundry. She knows sodium percarbonate by smell and has a torn labrum from it.",
    core_traits: ["Counts under her breath while waiting", "Grief that keeps coming back for more of her"],
    voice: {
      diction: "The vocabulary of a wash floor: soda, bleach, the dryer that eats socks.",
      agenda: "Needling as a way of making contact.",
      example_lines: ["Nothing here is ever just what it looks like.", "The dryer ate a sock again. Third one this month."],
    },
  };
  const faults = screenCard(card);
  const fields = faults.map((f) => f.field);

  check("a sample line written as a verdict on the world is caught", fields.includes("example_lines"), faults);
  check("...and the one about the dryer is left on the card",
    !faults.some((f) => /dryer/.test(f.text)), faults);
  check("a speech pattern in the same register is caught", fields.includes("speech_pattern"), faults);
  check("an agenda restating an act as its own meaning is caught", fields.includes("voice.agenda"), faults);
  check("a trait handing an abstraction a verb is caught", fields.includes("core_traits"), faults);
  check("the honest background and diction are untouched",
    !fields.includes("background") && !fields.includes("voice.diction"), faults);

  // THE SAMPLE LINE COMES FIRST because that is the order the narrator meets them in: an example
  // line is a sentence to copy, a speech pattern is a description to write from, a background is
  // reference.
  check("the sample lines are reported first", faults[0]?.field === "example_lines", faults.map((f) => f.field));

  check("a clean card produces nothing", screenCard({
    speech_pattern: "Short sentences, and she stops before the end of them when she is thinking.",
    core_traits: ["Takes a full breath before saying anything at all, even to say yes."],
    voice: { example_lines: ["Bed three's bulbs are shot and Trina still books it at twelve minutes."] },
  }).length === 0, screenCard({ speech_pattern: "Short sentences, and she stops before the end of them when she is thinking." }));
  check("no card is not a crash", screenCard(null).length === 0 && screenCard(undefined).length === 0);
}

/* ── 5. never_says and tics are exempt, and have to be ───────────────────────── */
{
  /* A never_says entry is a construction named in order to be banned and a tic is a verbal habit
   * quoted as one, so screening either would report the thing the field exists to record. The card
   * below lists two of the shapes this file hunts, in the one place they belong. */
  const card = { voice: { never_says: ["Everything has a price", "I don't know"], tics: ["says it's like a loaf that's never been cut"] } };
  check("a forbidden construction may be written down as forbidden", screenCard(card).length === 0, screenCard(card));
}

/* ── 6. THE VOICE FORGE DROPS IT, on the mechanism it already had ────────────── */
{
  const PLAIN: VoiceCard = {
    diction: "The vocabulary of a wash floor: soda, bleach, the dryer that eats socks.",
    syntax: "Short, and she stops before the end when she is thinking.",
    rhythm: "Starts fast and slows to a stop in the middle, so the other person answers into the gap.",
    tics: ["prices a thing nobody asked the price of"],
    never_says: ["if you don't mind"],
    agenda: "To get off the floor an hour early without anybody noticing.",
    example_lines: ["Bed three's bulbs are shot and Trina still books it at twelve minutes."],
  };
  const FIGURED_CARD: VoiceCard = {
    ...PLAIN,
    agenda: "Needling as a way of making contact.",
    example_lines: ["Nothing here is ever just what it looks like."],
  };

  check("voiceFaults names what is wrong with the written-up card", voiceFaults(FIGURED_CARD).length >= 2, voiceFaults(FIGURED_CARD));
  check("...and finds nothing on the plain one", voiceFaults(PLAIN).length === 0, voiceFaults(PLAIN));

  const cands = [{ probability: 0.02, voice: FIGURED_CARD }, { probability: 0.03, voice: PLAIN }];
  const picks = new Set(Array.from({ length: 60 }, () => pickFromTail(cands)?.agenda));
  check("the written-up candidate is never chosen when a plain one exists",
    picks.size === 1 && [...picks][0] === PLAIN.agenda, [...picks]);

  // FAILS OPEN, like the monotone rejection beside it: a figured card still beats no card, which is
  // what the fallback path gives — the forge's original, unsampled voice.
  const allBad = [{ probability: 0.02, voice: FIGURED_CARD }, { probability: 0.04, voice: { ...FIGURED_CARD, rhythm: "flat" } }];
  check("when every candidate is written up, one is still returned", pickFromTail(allBad) !== null);
}

/* ── 7. the correction quotes the line and names no literary form ───────────── */
{
  /* promptlint.ts check 4 records the reason, and it applies to this note as much as to any other
   * instruction: a prompt that says "no aphorisms" has spent its tokens describing aphorisms, and
   * the model has to represent one in order to avoid it. So the note asks for something a camera
   * could catch and never introduces the idea it is removing. */
  const faults = screenCard({ voice: { example_lines: ["Everything here has a price."] } });
  const note = rewriteNote(faults, "Mirela");
  check("the caught sentence is quoted back", note.includes("Everything here has a price."), note);
  check("...and the person is named", note.includes("Mirela"), note);
  check("no literary form is named in it", !/aphorism|maxim|proverb|epigram|metaphor|simile|figure of speech/i.test(note), note);
  check("...which is what the linter says too", lint("const N = `" + note + "`;").length === 0, lint("const N = `" + note + "`;"));
  check("nothing caught, nothing said", rewriteNote([], "Mirela") === "");
}

/* ── 8. one list, three readers ──────────────────────────────────────────────── */
{
  /* The whole point of moving the catalogue out of tools/promptlint.ts: a shape added because the
   * voice forge started writing it is a shape the linter reports on the same commit. These two
   * assertions are what would break if somebody re-inlined the regexes. */
  check("the linter's epigram check reads the shared list",
    lint("const X = `Give the reader the gesture, not the feeling behind it, and stop there.`;")
      .some((f) => f.kind === "contrastive-instruction"));
  check("and the card screen reads the same shape",
    figured("Give the reader the gesture, not the feeling behind it"));

  // …with one family deliberately held back from the instructions. A prohibition in English is
  // written with a universal quantifier and a copula, so this shape reports the corpus.
  check("universal verdict screens a card", figured("Nothing here is ever just what it looks like."));
  check("...and is off the linter", !INSTRUCTION_PRONOUNCEMENTS.some((f) => f.name === "universal verdict"));
  check("...while every other pronouncement shape stays on it",
    INSTRUCTION_PRONOUNCEMENTS.length === PRONOUNCEMENT_FIGURES.length - 1);
  check("a prohibition is not a finding for the linter",
    lint("const X = `Nothing is invented that contradicts the state, and nobody is hurt off the page.`;").length === 0,
    lint("const X = `Nothing is invented that contradicts the state, and nobody is hurt off the page.`;"));

  check("every shape carries a name and a reason a model can act on",
    FIGURES.every((f) => f.name.length > 3 && f.why.length > 10), FIGURES.filter((f) => !f.why));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
