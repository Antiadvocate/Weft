/* "I HATE. HATE. THE WAY THE AI MAKES PEOPLE TALK. WHAT PERSON TALKS LIKE THIS? JUST CLAUDE."
 *
 * The player wrote that, and then — to make the point — wrote their own closing line in the register
 * they were complaining about: "That's pretty much the whole ask." Which is, word for word, the shape
 * of a line in the save they had just uploaded:
 *
 *     "Friday. That's the whole ask."
 *     "Forty-two sixty-eight. Not my month."
 *     "Read it. Mark it up. Tell me where the bride's mother spelled her own daughter's middle name
 *      wrong, which she did, because I already spotted it…"
 *
 * Six spoken lines in that turn. Three of them are figures of speech nobody can perform out loud.
 *
 * NOTHING IN THE ENGINE COULD SEE THEM. maxims.ts catches a line that makes a claim about the world;
 * none of these makes any claim at all. reviser.ts holds eighty families of tic and refuses, by an
 * explicit rule at line 172, to look at any sentence containing a quotation mark — so the entire
 * repair apparatus points at narration while the complaint is entirely about speech.
 *
 * These tests are built from the corpus itself: 3,208 quoted lines across thirteen saves, 947 of
 * them distinct. Every POSITIVE below is a line the engine really wrote. Every NEGATIVE is also a
 * real line, chosen because it is ordinary speech that a lazier detector flagged — the three
 * families that were measured and dropped are asserted here so they cannot come back.
 */
import { findClaudisms, claudismFix, claudismRate, spokenShape } from "../src/engine/claudisms";
import { findMaxims } from "../src/engine/maxims";
import { flagTics } from "../src/engine/reviser";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const q = (s: string) => `He looked at her. "${s}" She waited.`;
const caught = (s: string) => findClaudisms(q(s));
const shape = (s: string) => caught(s)[0]?.shape ?? null;

/* ── 1. the four lines the player put in front of me ──────────────────────────── */
{
  check("«Friday. That's the whole ask.» is caught",
    caught("Friday. That's the whole ask.").length === 1, caught("Friday. That's the whole ask."));
  check("...as the summing-up tag",
    shape("Friday. That's the whole ask.") === "summing up their own sentence", shape("Friday. That's the whole ask."));
  check("«Forty-two sixty-eight. Not my month.» is caught",
    caught("Forty-two sixty-eight. Not my month.").length === 1);
  check("the tricolon of commands is caught",
    shape("Read it. Mark it up. Tell me where the bride's mother spelled her own daughter's middle name wrong.") === "three commands in a row",
    shape("Read it. Mark it up. Tell me where the bride's mother spelled her own daughter's middle name wrong."));
  // The fourth one the player quoted is deliberately NOT caught — see the dropped-families note.
  check("the trailing em-dash is left alone on purpose",
    caught("So can you look at it tonight, or — ?").length === 0,
    caught("So can you look at it tonight, or — ?"));
}

/* ── 2. nothing that already existed could see them ───────────────────────────── */
{
  const four = [
    "Friday. That's the whole ask.",
    "Forty-two sixty-eight. Not my month.",
    "Read it. Mark it up. Tell me where the bride's mother spelled her own daughter's middle name wrong.",
    "Sunday chicken. Lemons.",
  ];
  for (const l of four) {
    check(`maxims.ts does not catch «${l.slice(0, 28)}…»`, findMaxims(q(l)).length === 0, findMaxims(q(l)));
    check(`the reviser passes over «${l.slice(0, 28)}…»`, flagTics(q(l)).length === 0, flagTics(q(l)));
  }
  check("...and this module catches all four", four.every((l) => caught(l).length === 1),
    four.filter((l) => caught(l).length !== 1));
}

/* ── 3. each family, on real lines from the corpus ────────────────────────────── */
{
  check("the summing-up tag: «That's the whole thing. That's the two hours.»",
    caught("That's the whole thing. That's the two hours.").length === 1);
  check("the summing-up tag: «That's the question you should've opened with.»",
    shape("That's the question you should've opened with.") === "summing up their own sentence");

  const nots = "I didn't send anyone. Not Mara. Not Drea.";
  check("the negation series: «Not Mara. Not Drea.»", shape(nots) === "a series of parallel negations", shape(nots));
  check("...and it quotes only the offending span, not the whole line",
    caught(nots)[0].line === "Not Mara. Not Drea.", caught(nots)[0].line);
  check("the negation series: «I haven't laughed. Not once. Not at any of it.»",
    shape("I haven't laughed. Not once. Not at any of it.") === "a series of parallel negations");

  check("the repeated opening: «You're fine. You're fine with it. All of it.»",
    shape("You're fine. You're fine with it. All of it.") === "the same opening said twice",
    shape("You're fine. You're fine with it. All of it."));

  check("the fragment coda: «Sunday chicken. Lemons.»",
    shape("I'm doing the chicken on Sunday. Lemons.") === "a fragment kept back for the last word",
    shape("I'm doing the chicken on Sunday. Lemons."));

  check("the antithesis: «That's not a job, that's a tide.»",
    shape("That's not a job, that's a tide.") === "not that, but this", shape("That's not a job, that's a tide."));

  check("the announcement: «Here's what we're going to do»",
    shape("Here's what we're going to do, and you're not going to like all of it.") === "announcing the sentence before saying it");

  check("the stock concession: «That's fair.»",
    shape("Okay. That's fair. That was a weird exit.") === "conceding in the approved phrasing",
    shape("Okay. That's fair. That was a weird exit."));
}

/* ── 4. THE THREE FAMILIES THAT WERE MEASURED AND DROPPED ─────────────────────── */
{
  // Each of these was a candidate detector, each hit a large slice of the corpus, and each slice was
  // mostly people talking. They are asserted as negatives so a later widening cannot resurrect them.

  // STACCATO — 123 of 428 multi-sentence lines. At 29% it is detecting dialogue, not a tic.
  check("staccato is not a fault: «Really good. They liked the program. They just want the numbers tighter.»",
    caught("Really good. They liked the program. They just want the numbers tighter.").length === 0,
    caught("Really good. They liked the program. They just want the numbers tighter."));
  check("staccato is not a fault: «You okay? You sound like shit.»",
    caught("You okay? You sound like shit.").length === 0);

  // PRONOUN ANAPHORA — a repeated `I` or `They` is how people talk when they are upset.
  check("a repeated pronoun subject is not a fault",
    caught("I don't know how she got here. I don't know how Mara got here. I don't know how you got here.").length === 0,
    caught("I don't know how she got here. I don't know how Mara got here. I don't know how you got here."));

  // REPETITION ANYWHERE — matched on "in the", "she was", "mad at".
  check("mid-sentence repetition is not a fault",
    caught("God, listen to us. We're both just standing here in the kitchen being insane. It's eight in the morning.").length === 0,
    caught("God, listen to us. We're both just standing here in the kitchen being insane. It's eight in the morning."));
}

/* ── 5. ordinary speech from the corpus stays untouched ───────────────────────── */
{
  const clean = [
    "The forty-person calls are worse. Everybody talks over everybody and nobody says the thing they're actually worried about until minute thirty-eight.",
    "My back was killing me at the office yesterday. I think I was hunched over those proofs for six hours straight.",
    "You're up early. I thought you'd sleep in since it's your day off.",
    "Eggs are in it. Parsley from the corner stall. The old woman, the one with the thumb—she gave me extra again.",
    "Different how? Like, good different, or I've been feeding you the same thing for two years and you're just now telling me different?",
    "You told me to go. Twice. You finished the dishes and told me you'd clean up and then you said go ahead, so I'm going.",
    "I'm not saying I want a whole thing. Just, like, a Saturday where nobody's phone goes off and I don't have to think about grants.",
  ];
  for (const l of clean) check(`left alone: «${l.slice(0, 42)}…»`, caught(l).length === 0, caught(l));

  // Interruptions and trailing-off are how flustered people speak and must survive.
  check("a person losing the thread is left alone", caught("Put the phone down, Rabi. I'm your wife. I'm right here. I just—").length === 0,
    caught("Put the phone down, Rabi. I'm your wife. I'm right here. I just—"));
  check("a fixed idiom on a negator is left alone",
    caught("You're in a mood this morning. Not that I'm complaining.").length === 0,
    caught("You're in a mood this morning. Not that I'm complaining."));
  // Keyed to the actual cast, not to capitalisation — "Lemons." is capitalised too.
  const vocative = `He looked at her. "You have to eat something before you go. Rabi." She waited.`;
  check("a name said on its own is not a coda", findClaudisms(vocative, "", ["Rabi", "Emily"]).length === 0,
    findClaudisms(vocative, "", ["Rabi", "Emily"]));
  check("...and a plain plural noun in the same position still is",
    findClaudisms(`He looked at her. "I'm doing the chicken on Sunday. Lemons." She waited.`, "", ["Rabi", "Emily"]).length === 1);
  check("an interjection is not a coda", caught("I already told them we'd be there by six. God.").length === 0);
}

/* ── 6. it never scolds the narrator for the player's own words ───────────────── */
{
  const line = "Friday. That's the whole ask.";
  check("the player's own phrasing is excluded",
    findClaudisms(q(line), `I tell her, "${line}"`).length === 0,
    findClaudisms(q(line), `I tell her, "${line}"`));
  check("...but the same line from a character is not",
    findClaudisms(q(line), "I put the kettle on and wait.").length === 1);
}

/* ── 7. the correction ────────────────────────────────────────────────────────── */
{
  check("no correction when nothing fired", claudismFix(null) === "");
  const d = claudismFix({ line: "Friday. That's the whole ask.", shape: "summing up their own sentence" });
  check("it quotes the actual line", d.includes(`"Friday. That's the whole ask."`), d.slice(0, 120));
  check("it names what is structurally wrong", /classifies their own request/.test(d));
  check("it says the unintuitive thing: write LONGER, not shorter",
    /Do not write shorter/.test(d) && /LONGER and WORSE ORGANISED/.test(d));
  check("it forbids the specific shapes for the coming turn",
    /no two consecutive sentences begin the same way/.test(d) && /does not end on a fragment/.test(d));
  check("an unknown shape still gets a usable correction",
    claudismFix({ line: "x y z", shape: "something new" }).includes("shaped like a written line"));
}

/* ── 8. the standing rule, and the one thing it must never do ─────────────────── */
{
  const r = spokenShape();
  check("the standing rule is present on every turn", r.length > 200);
  check("it says terseness is the disease, not the cure", /IF A LINE FEELS TIGHT, IT IS WRONG/.test(r));
  // A phrase attached to a prohibition is still a phrase the model has been handed — echo.ts.
  const banned = ["whole ask", "Not my month", "Mark it up", "that's a tide", "Here's what", "That's fair"];
  for (const b of banned) check(`the standing rule hands the model no example: «${b}»`, !r.includes(b));
  check("...and neither does it quote any spoken line at all", !/["“”]/.test(r), r.match(/["“”].{0,30}/)?.[0]);
}

/* ── 9. wired into the turn, the ledger and the prompt ────────────────────────── */
{
  const T = readFileSync("src/engine/turn.ts", "utf8");
  check("the detector runs on the committed prose", /const claudisms = findClaudisms\(prose, action,/.test(T));
  check("...and it is given the cast, so a name said on its own is not mistaken for a coda",
    /findClaudisms\(prose, action, Object\.values\(state\.characters/.test(T));
  check("the hit is stored for the next turn", /state\.last_claudism = claudisms\.length/.test(T));
  check("...and the correction is in the per-turn directive, not the cached prefix",
    /claudismFix\(state\.last_claudism\)/.test(T) && /maximNote = /.test(T));
  check("the standing rule is in the directive too", /spokenShape\(\)/.test(T));
  check("it counts toward the integrity aggregate", /noteFire\(state, "composed"/.test(T));
  check("the player is told when it is more than a one-off", /composed rather than spoken/.test(T));
  const I = readFileSync("src/engine/integrity.ts", "utf8");
  check("the ledger can name the kind in a sentence", /composed: "a line of dialogue that was composed/.test(I));
}

/* ── 10. the rate, for the toast ──────────────────────────────────────────────── */
{
  const two = `"Friday. That's the whole ask." She shrugged. "I didn't send anyone. Not Mara. Not Drea." He said nothing.`;
  check("the rate is hits over spoken lines", claudismRate(two) === 1, claudismRate(two));
  check("clean dialogue rates zero", claudismRate(`"You're up early. I thought you'd sleep in since it's your day off."`) === 0);
  check("prose with no dialogue rates zero", claudismRate("She crossed the kitchen and put the kettle on.") === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
