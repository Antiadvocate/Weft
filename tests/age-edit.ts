/* Smoke test: SHE WAS TWENTY ON THE CARD AND FIFTEEN IN EVERY SENTENCE.
 *
 * A player opened a character's profile, changed the age from 15 to 20, saved. The card printed 20
 * from that turn on — `charCard` reads the number live — and the cast went on calling her fifteen,
 * and she said it about herself.
 *
 * The number was never the problem. Age is written down twice: once as a field, and once as prose,
 * in the bedrock appearance the forge is explicitly told to give an "apparent age" to, in the
 * background, in the durable fact ledger of everyone who knows her, in rumors, in canon. The profile
 * edits the field. Nothing edited the prose, and "she is fifteen" in a memory outweighs "20" in a
 * comma-separated card every time.
 *
 * `reconcileAge` restates the present-tense claims and — this is the half that makes it safe —
 * leaves the past-tense ones alone: "she left home at fifteen" is still true at twenty, and "her
 * brother is fifteen" was never about her. Everything it declines to touch comes back in the report
 * rather than being silently rewritten or silently ignored.
 */
import { restateAge, reconcileAge, ageWord, summarizeAgeReport } from "../src/engine/age";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const say = (s: string, from = 15, to = 20) => restateAge(s, from, to).text;

/* ── 1. the present tense moves ───────────────────────────────────────────────── */
{
  const moves: [string, string][] = [
    ["A fifteen-year-old girl with dark hair.", "A twenty-year-old girl with dark hair."],
    ["a 15-year-old apprentice, thin for her age", "a 20-year-old apprentice, thin for her age"],
    ["She is fifteen years old.", "She is twenty years old."],
    ["Apparent age: 15.", "Apparent age: 20."],
    ["aged fifteen, wiry, a burn scar on the left wrist", "aged twenty, wiry, a burn scar on the left wrist"],
    ["Mira is fifteen.", "Mira is twenty."],
    ["She's 15 and knows the whole river.", "She's 20 and knows the whole river."],
    ["I'm fifteen, not a child.", "I'm twenty, not a child."],
    ["looks about fifteen", "looks about twenty"],
    ["barely fifteen and already running the stall", "barely twenty and already running the stall"],
    ["a girl of fifteen", "a girl of twenty"],
    // "the girl" in her own appearance line is her; only a possessive makes it somebody else's child
    ["The girl is fifteen, thin, dark-haired.", "The girl is twenty, thin, dark-haired."],
    ["Fifteen years old, and she has never left the valley.", "Twenty years old, and she has never left the valley."],
  ];
  for (const [before, after] of moves) check(`restated: "${before}"`, say(before) === after, say(before));
}

/* ── 2. the past tense does not ───────────────────────────────────────────────── */
{
  const holds = [
    "She left home at fifteen and never went back.",
    "Her mother was fifteen when she had her.",
    "On her fifteenth birthday the river froze.",
    "She was fifteen the year the mill burned.",
    "Her brother is fifteen and useless with a net.",
    "Her girl is fifteen and already taller than her.",
    "The father is fifteen years younger than the woman he married.",
    "He turned fifteen in the spring.",
    "It cost fifteen coins and a morning.",
    "Fifteen men came down the road.",
    "There are fifteen of them in the yard.",
    "The walk is fifteen minutes if the gate is open.",
  ];
  for (const line of holds) check(`left alone: "${line}"`, say(line) === line, say(line));
}

/* ── 3. the form the author used survives ─────────────────────────────────────── */
{
  check("numerals stay numerals", say("She is 15.", 15, 32) === "She is 32.", say("She is 15.", 15, 32));
  check("words stay words", say("She is fifteen.", 15, 32) === "She is thirty-two.", say("She is fifteen.", 15, 32));
  check("a sentence-initial capital survives", say("Fifteen-year-old, dark-eyed.", 15, 31) === "Thirty-one-year-old, dark-eyed.", say("Fifteen-year-old, dark-eyed.", 15, 31));
  check("compound old ages match un-hyphenated too", say("She is twenty one.", 21, 40) === "She is forty.", say("She is twenty one.", 21, 40));
  check("ageWord spells the tens", ageWord(20) === "twenty" && ageWord(47) === "forty-seven" && ageWord(9) === "nine", ageWord(47));
  check("past ninety-nine it stays a numeral", ageWord(104) === "104", ageWord(104));
}

/* ── 4. what it declines to touch, it reports ─────────────────────────────────── */
{
  const r = restateAge("She is fifteen now, and she left home at fifteen.", 15, 20);
  check("the present-tense claim moved", r.text === "She is twenty now, and she left home at fifteen.", r.text);
  check("the history was reported for a human to read", r.left.some((l) => /left home at fifteen/.test(l)), r.left);
}

/* ── 5. the whole save, end to end ────────────────────────────────────────────── */
{
  const s: SaveState = newSave("age", "test");
  const her = registerCharacter(s, {
    name: "Mira", age: 15,
    appearance_facts: "A fifteen-year-old girl, black hair cut at the jaw, a burn scar on her left wrist.",
    background: "Raised on the river. She is fifteen and has run her mother's stall since she was eleven. Her brother is fifteen and useless with a net.",
    life_history: "She turned fifteen the week the barge sank.",
    core_traits: ["quick", "will not be talked over"],
  } as any);
  const him = registerCharacter(s, { name: "Sten", age: 40, appearance_facts: "Broad, grey.", background: "A ferryman.", core_traits: ["patient"] } as any);

  s.memory[her].core = ["I am fifteen and I know the river better than any of them."];
  s.memory[her].facts = [{ content: "I am fifteen years old.", turn: 1 }] as any;
  s.memory[him].beliefs = [{ content: "Mira is fifteen and too young for the night crossing.", turn: 1 }] as any;
  s.memory[him].episodic = [{ content: "Mira is only fifteen, and she took the tiller anyway.", turn: 2, importance: 6 }] as any;
  s.memory[him].facts = [{ content: "The crossing costs fifteen coins.", turn: 2 }] as any;
  s.world.canon = ["Mira is fifteen and the youngest licensed pilot on the river."];
  s.world.rumors = [{ id: "r1", content: "They say Mira is fifteen and pilots the night barge.", truth: "true", salience: 5, origin_char: him, knowers: [him], born_turn: 2, about_char: her }] as any;
  s.history = [{ turn: 3, narrator_prose: "Mira is fifteen. She takes the rope without being asked.", player_action: "" } as any];

  const rep = reconcileAge(s, her, 15, 20);

  check("the bedrock appearance was restated", s.characters[her].appearance_facts.startsWith("A twenty-year-old girl"), s.characters[her].appearance_facts);
  check("her background's claim about HER moved", /She is twenty and has run/.test(s.characters[her].background), s.characters[her].background);
  check("her background's claim about her BROTHER did not", /Her brother is fifteen/.test(s.characters[her].background), s.characters[her].background);
  check("what she turned, and when, is history and stands", s.characters[her].life_history === "She turned fifteen the week the barge sank.", s.characters[her].life_history);
  check("her own core memory moved", /I am twenty and I know the river/.test(s.memory[her].core[0]), s.memory[her].core[0]);
  check("her own fact ledger moved", /twenty years old/.test(s.memory[her].facts![0].content), s.memory[her].facts![0].content);
  check("what Sten believes about her moved", /Mira is twenty/.test(s.memory[him].beliefs[0].content), s.memory[him].beliefs[0].content);
  check("what Sten remembers of her moved", /only twenty/.test(s.memory[him].episodic[0].content), s.memory[him].episodic[0].content);
  check("the price of the crossing is not an age", s.memory[him].facts![0].content === "The crossing costs fifteen coins.", s.memory[him].facts![0].content);
  check("canon moved", /Mira is twenty/.test(s.world.canon[0]), s.world.canon[0]);
  check("the rumor in circulation moved", /Mira is twenty/.test(s.world.rumors[0].content), s.world.rumors[0].content);
  check("played prose is the record and was not rewritten", /Mira is fifteen\./.test(s.history[0].narrator_prose ?? ""), s.history[0].narrator_prose);
  check("but the player is told it still says the old number", rep.prose_turns === 1, rep.prose_turns);
  check("the brother came back as something to look at", rep.left.some((l) => /brother is fifteen/.test(l.text)), rep.left);

  const line = summarizeAgeReport(rep, "Mira");
  check("the notice names the new age and counts the fixes", /Mira is now 20/.test(line) && /restated \d+ stale mention/.test(line), line);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
