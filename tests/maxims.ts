/* Smoke test: A CHARACTER TALKING vs AN ORACLE TALKING.
 *
 * Every line here is real output, from a save set in the Alban Hills. Over four turns a tavern cook
 * said "Shock has a price, Rabi", "This house breathes without a lung", "We're just counting the
 * cost of the air", and "Metaphors are for men who have time for ghosts, Rabi" — the last of those
 * in answer to the player typing, in plain words, that the metaphor meant nothing to him. He then
 * asked a second character whether the first speaks only in maxims, and she replied in maxims.
 *
 * Which is the tell: it is not a character voice, it is the narrator's register wearing whichever
 * mouth is open. And it is not the forge — those characters' cards are specific and quarrelsome and
 * contain no aphorism anywhere.
 *
 * The bar for the detector is set by the OK cases below as much as the caught ones. All of them are
 * from the same save, and every one is good dialogue: hard, transactional, priced, specific. A
 * detector that flags "Two sestertii is high for bread that needs trimming" to the narrator as a
 * fault teaches it to stop writing the best thing in the file.
 */
import { findMaxims, maximFix, maximRate, spokenLines, speakerAnchor } from "../src/engine/maxims";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const said = (s: string) => `She set the jar down. "${s}" She did not look up.`;
const caught = (s: string) => findMaxims(said(s)).length > 0;

/* ── the real offences ───────────────────────────────────────────────────────── */
{
  const REAL = [
    "Shock has a price, Rabi.",
    "This house breathes without a lung.",
    "We're just counting the cost of the air.",
    "Metaphors are for men who have time for ghosts, Rabi.",
    "She just has a way of looking at a stone and seeing the wall it came from.",
    "There is no dark here, only lamps and neighbors.",
    "Everything has a price in this town.",
    "Nothing is ever just what it looks like.",
  ];
  for (const line of REAL) check(`caught: ${line.slice(0, 52)}`, caught(line), findMaxims(said(line)));
}

/* ── and the speech it must not touch, from the same save ────────────────────── */
{
  const FINE = [
    "Two sestertii is high for bread that needs trimming. For a stranger, it's a tax on the road.",
    "The crust is burnt, but the center is sound. Two sestertii.",
    "The decuriones meet at the hall near the grove if you're looking to buy land.",
    "Market day brings in every kind of traveler, Rabi. Rooms aren't free, and the stew is four asses.",
    "You're a long way from the road, stranger.",
    "The fifteenth. Not the sixteenth. Bring it then.",
    "My father can't read the tally. He signs where I point.",
    "Rain tomorrow. The road to Bovillae will be bad by evening. I'd start now.",
    "In Rome the water comes to you, out of the wall, cold, you don't carry it.",
    "I'll argue it with your augur and his augur too — no, I will, send him up.",
    "A crown you keep by murder — is that worship?",
    "He looks like the priest's goat when it's cross — ha — no, don't tell him I said it.",
  ];
  for (const line of FINE) check(`left alone: ${line.slice(0, 48)}`, !caught(line), findMaxims(said(line)));
}

/* ── it is a rule about DIALOGUE, not about description ──────────────────────── */
{
  const narration = "The house breathes without a lung. Everything here has a price. Nothing is ever just what it looks like.";
  check("narration is not policed by this", findMaxims(narration).length === 0, findMaxims(narration));
  check("only quoted speech is read", spokenLines(narration).length === 0);
  check("but the same words inside quotes are", findMaxims(`He said "Everything here has a price."`).length === 1);
}

/* ── a question is not a pronouncement ───────────────────────────────────────── */
{
  check("a question escapes", !caught("Does everything have a price in this town?"));
  check("so does a short exclamation", !caught("No."));
}

/* ── the correction quotes the sentence and says what to do instead ──────────── */
{
  const fix = maximFix("Shock has a price, Rabi.");
  check("it quotes the actual line", /Shock has a price/.test(fix), fix);
  check("and reports the property rather than naming the form", /NAMED NOTHING THAT WAS IN THE ROOM/.test(fix));
  check("it names the structural fault", /about the world in general rather than about anything in that room/i.test(fix));
  check("it says what to write instead, as a positive requirement", /NAMES SOMETHING PHYSICALLY PRESENT/.test(fix));
  check("and it covers the direct-question failure", /they answer it, or they refuse it in plain words/i.test(fix));
  check("nothing to correct produces nothing", maximFix(null) === "" && maximFix(undefined) === "");
}

/* ── the positive half: who is talking, where instructions land ─────────────── */
{
  // NO SAMPLE LINES AND NO REGISTERS. Three two-word exemplars per character taught the whole cast
  // to answer in fragments — a sample of a voice is always compressed, and "match this" then reads
  // as "never write anyone a long sentence". Nobody has a stored voice at all now; what goes in is
  // who is in the room, and the line comes from what they want and what state they are in.
  const state = { characters: {
    char_l: { name: "Lucia", age: 52, core_traits: ["Counts everything twice"], background: "Runs the inn. Owes the decurio." },
    char_m: { name: "Marcus", age: 19, core_traits: ["Answers before you finish"], background: "Carries water for the temple." },
    char_x: { name: "Nobody" },
  } };
  const a = speakerAnchor(state, ["char_l", "char_m", "char_x"]);
  check("present speakers arrive as who they are", /Lucia — 52/.test(a) && /Marcus — 19/.test(a), a);
  check("a card with nothing on it contributes nothing", !/Nobody/.test(a));
  check("no sample line is handed over at all", !/"/.test(a), a);
  check("no manner of speaking is handed over either",
    !/(TALKS LIKE THIS|Would never say|register)/i.test(a.replace(/in the same plain register/, "")), a);
  check("and it says so outright", /NOBODY HERE HAS A VOICE OF THEIR OWN/.test(a), a);
  check("a state can override the person", /repeats themselves, stops halfway/.test(a));
  check("length is named as coming from the moment, not a style", /LENGTH COMES FROM THAT, NOT FROM A STYLE/.test(a));
  check("and a uniformly terse cast is called out as one person", /they have all been written by the same person/.test(a));
  check("no cards, no note", speakerAnchor({ characters: { c: { name: "X" } } }, ["c"]) === "");
}

/* ── the rate, for the toast ─────────────────────────────────────────────────── */
{
  const bad = `"Shock has a price." "Everything has a price." "The road to Bovillae is bad."`;
  const r = maximRate(bad);
  check("the rate reflects how much of the talking was pronouncement", r > 0.5 && r < 1, r);
  check("clean dialogue rates zero", maximRate(`"Two sestertii. Pay the girl."`) === 0);
  check("no dialogue at all rates zero", maximRate("He crossed the room and sat down.") === 0);
}



/* ── the second generation: the register moved and the detector did not ──────────
 *
 * Thirty turns after the first fix shipped, the same story produced 138 lines of dialogue and the
 * detector caught seven — every one of them from turns BEFORE it shipped. Not one of the lines
 * below is an aphorism by the original shapes. All of them are the same behaviour: answering the
 * person in front of you with a figure instead of an answer.
 */
{
  const MOVED = [
    "It's like a loaf that's never been cut.",
    "It\u2019s like a loaf that\u2019s never been cut.",
    "The fever doesn't take a roof off. It takes the hands that hold the roof up.",
    "The beetle rolls with its back legs. Everyone knows that.",
    "You stay long enough, you'll see.",
    "That's what they say about the road.",
  ];
  for (const line of MOVED) check(`second generation: ${line.slice(0, 44)}`, caught(line), findMaxims(said(line)));
}
{
  // and the plain speech from the SAME save has to survive it
  const STILL_FINE = [
    "Five pounds of gold is five pounds of gold. It's under the floor, and it stays under the floor.",
    "There was a man with a mule before. He may still want a room.",
    "If you want to keep arguing with her, come inside. The garden will still be here.",
    "You don't know the first thing about what we're afraid of.",
    "You've made your point. You don't need to make it out of metal.",
    "I'd go to the woman who sells them by the fountain and say how much for the white ones.",
  ];
  for (const line of STILL_FINE) check(`still fine: ${line.slice(0, 44)}`, !caught(line), findMaxims(said(line)));
}

/* ── the worst move: the narrator arguing with the player through a character ──── */
{
  const defence = "A beetle and a fever and a roof aren't maxims. They're the room we're standing in.";
  check("the defence is caught", caught(defence), findMaxims(said(defence)));
  const fix = maximFix(defence);
  check("and gets its own correction", /ARGUED WITH THE PLAYER ABOUT HOW THE CHARACTERS TALK/.test(fix));
  check("which rules the opinion out of the world", /Nobody in this world has an opinion about how the writing works/.test(fix));
  check("and closes it", /The player is right and the argument is over/.test(fix));
  check("an ordinary maxim still gets the ordinary correction",
    !/ARGUED WITH THE PLAYER/.test(maximFix("Shock has a price, Rabi.")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
