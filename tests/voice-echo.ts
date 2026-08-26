/* Smoke test: ONE COPY OF THE VOICE, NOT THREE.
 *
 * "Her voice and tone are monotone reflecting an uninvented personality across characters."
 *
 * Part of that is measurable and was a plain duplication bug. The character card printed
 * `speech_pattern` and then the diction/syntax/rhythm fingerprint — and on every real save those are
 * the same text, because the voice refresh writes the fingerprint INTO speech_pattern. Measured on
 * the save this came from: 27 of 27 fingerprint words already present, on all three characters.
 * deriveVoice then opened the per-turn line with speech_pattern a third time.
 *
 * So the loudest thing about any character, by sheer repetition, was a paragraph written at creation
 * and never updated, restated three times per request — with the two or three phrases that actually
 * move turn to turn buried underneath it. */
import { charCard, deriveVoice } from "../src/engine/prompts";
import type { Condition, Identity } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FINGER = {
  diction: "sensual-precise, the vocabulary of surfaces and touch used to talk around desire",
  syntax: "long tactile sentence, a comma splice of small sensations, ending before the point",
  rhythm: "drawn out, patient, wants you to lean in",
};
const ident = (over: Partial<Identity> = {}): Identity => ({
  name: "Clara", age: 34, pronouns: "she/her",
  appearance_facts: "Copper-red hair in a sharp bob.",
  background: "Sells vintage furniture.",
  core_traits: ["Knows where the best light is."], values: ["Beauty as a moral good."],
  intelligence: "sharp", gregariousness: 0.6,
  speech_pattern: `${FINGER.diction}. ${FINGER.syntax}. ${FINGER.rhythm}.`,
  voice: { ...FINGER, agenda: "to be leaned toward", tics: ["names the material"] },
  ...over,
} as unknown as Identity);
const cond = (relaxation = 0): Condition =>
  ({ psyche: { relaxation, mood: "level", active_states: [] }, injuries: [], conditions: [], fatigue: "rested", hunger: "fed" } as unknown as Condition);

/* ── the card says it once ───────────────────────────────────────────────────── */
{
  const card = charCard("char_clara", ident(), cond(), []);
  const n = (card.match(/comma splice of small sensations/g) ?? []).length;
  check("the fingerprint appears exactly once on the card", n === 1, n);
  check("and the voice is still there at all", /sensual-precise/.test(card));
}
{
  // a character whose fingerprint genuinely differs from the baseline keeps both — this is a
  // deduplication, not a deletion
  const other = ident({ speech_pattern: "Blunt. Short. Never explains herself twice." });
  const card = charCard("char_clara", other, cond(), []);
  check("a real second voice field is not swallowed", /sensual-precise/.test(card) && /Blunt/.test(card), card.slice(0, 300));
}

/* ── the per-turn line carries what CHANGED ──────────────────────────────────── */
{
  const line = deriveVoice(ident(), cond(0), []);
  check("the per-turn line no longer restates the whole baseline",
    !/comma splice of small sensations/.test(line), line);
  check("it carries what is under the words", /leaned toward/.test(line), line);
}
{
  const calm = deriveVoice(ident(), cond(8), []);
  const clenched = deriveVoice(ident(), cond(-9), []);
  check("a settled body and a braced one do not produce the same line", calm !== clenched);
  check("and the braced one says so", /clenched/.test(clenched), clenched);
}
{
  const warm = deriveVoice(ident(), cond(), [], { warmth: 60, trust: 20 });
  const cold = deriveVoice(ident(), cond(), [], { warmth: -50, trust: -50 });
  check("who they are talking to changes it", warm !== cold);
  check("warmth reads as a softer register", /softer register/.test(warm), warm);
  check("hostility reads as cutting", /cutting|cold/.test(cold), cold);
}
{
  // a character with nothing dynamic must not end up with an empty voice line
  const bare = ident({ voice: undefined });
  const line = deriveVoice(bare, cond(0), []);
  check("with nothing else to say, the baseline comes back rather than nothing",
    line.length > 0 && /sensual-precise/.test(line), line);
}
{
  // acquired traits are the main thing that SHOULD make a voice drift over a long story — and the
  // save this came from had a character 108 turns deep with none at all
  const t = [{ label: "Boundary-eroding possessiveness", intensity: 7, behavioral_impact: "presses" }];
  check("a learned trait colours the voice", /Boundary-eroding/.test(deriveVoice(ident(), cond(), t)));
  check("a faint one does not", !/faint/.test(deriveVoice(ident(), cond(), [{ label: "faint", intensity: 2, behavioral_impact: "x" }])));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
