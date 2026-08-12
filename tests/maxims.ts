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
import { findMaxims, maximFix, maximRate, spokenLines, voiceAnchor } from "../src/engine/maxims";

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
  check("it names the structural fault", /portable|general truth/i.test(fix));
  check("it says what to write instead", /plain specifics|answer it directly/i.test(fix));
  check("and it covers the direct-question failure", /answering a direct question with an image/i.test(fix));
  check("nothing to correct produces nothing", maximFix(null) === "" && maximFix(undefined) === "");
}

/* ── the positive half: their own lines, where instructions land ─────────────── */
{
  const state = { characters: {
    char_l: { name: "Lucia", voice: { example_lines: ["A crown you keep by murder — is that worship?", "If she wanted blood in her wood she'd have said so plainly."] } },
    char_m: { name: "Marcus", voice: { example_lines: ["The fifteenth. Not the sixteenth. Bring it then."] } },
    char_x: { name: "Nobody", voice: {} },
  } };
  const a = voiceAnchor(state, ["char_l", "char_m", "char_x"]);
  check("present speakers get their own lines", /Lucia sounds like this/.test(a) && /Marcus sounds like this/.test(a), a);
  check("a card with no lines contributes nothing", !/Nobody/.test(a));
  check("and it forbids improving on them", /smoother, wiser, more compressed or more quotable/.test(a));
  check("no cards, no note", voiceAnchor({ characters: { c: { name: "X" } } }, ["c"]) === "");
}

/* ── the rate, for the toast ─────────────────────────────────────────────────── */
{
  const bad = `"Shock has a price." "Everything has a price." "The road to Bovillae is bad."`;
  const r = maximRate(bad);
  check("the rate reflects how much of the talking was pronouncement", r > 0.5 && r < 1, r);
  check("clean dialogue rates zero", maximRate(`"Two sestertii. Pay the girl."`) === 0);
  check("no dialogue at all rates zero", maximRate("He crossed the room and sat down.") === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
