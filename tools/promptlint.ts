/**
 * PROMPTLINT — instructions that describe a quality instead of specifying an operation.
 *
 * Every prompt in this engine is written to be read by a model, and a large number of them are
 * written as literary criticism instead: they name a quality, assert something about it, and assume
 * the reader shares a definition. A sample, all of it real, some of it mine:
 *
 *     BUT SHORT IS NOT THE SAME AS TRUE.
 *     Take the SHAPE of speech from the culture you were given.
 *     A clipped, laconic line is a modern literary register, not a neutral one.
 *
 * The first is a maxim. It asserts a distinction between "short" and "true" without saying what
 * either refers to here. The second names SHAPE in capitals as though it were a defined field —
 * cadence? syntax? vocabulary? sentence length? — and a model has to guess which, and two models
 * guess differently. The third makes a claim about literary history; there is no operation in it.
 *
 * This matters more than it looks, and the reason is measurable. Research on constraint compliance
 * finds that models carry strong default patterns for common tasks, and that when an instruction
 * ALIGNS with the default, compliance is near-total, while an instruction that FIGHTS the default
 * degrades sharply. The default for "person in an ancient setting speaks" is the oracular register.
 * Every rule above fights that default using an abstraction, which is the weakest possible form of
 * a conflicting constraint — so the default wins, and the characters talk like an oracle.
 *
 * The fix is not more emphasis. It is to stop describing the output and start specifying the
 * procedure: name the fields to read, the order to read them in, and a check that can be applied to
 * a finished line. That aligns with what models do well (follow a procedure over named inputs)
 * instead of what they do badly (infer an aesthetic from a noun).
 *
 * This linter finds three things. It is deliberately crude — it flags candidates for a human to
 * judge, and its counts are a ratchet in tests/prompt-craft.ts, not a gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Model-facing text only: template literals long enough to be instructions, with the ${...} code
 *  interpolations removed so we lint prose rather than expressions. */
export function modelFacing(src: string): string {
  // Comments first. A file header explaining WHY a rule exists is written for people and never
  // reaches a model — counting it would inflate every number here and point at the wrong lines.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  return (code.match(/`[^`]{40,}`/g) ?? [])
    // ...and template literals that are CODE (regex sources, JSX, expression soup) are not prompts.
    .filter((t) => !/=>|\?\?|\(\)|\\b|\\s\+|<\/|className/.test(t))
    .filter((t) => (t.match(/\s/g) ?? []).length >= 8)
    .join("\n")
    .replace(/\$\{[^}]*\}/g, " ");
}

export interface Finding { kind: string; text: string; why: string }

/**
 * 1. UNDEFINED ABSTRACTIONS. A noun naming a quality, used as the object of an instruction, with no
 *    definition anywhere in the prompt. The model has to supply the meaning, and its meaning is the
 *    default it already had — which is the thing the instruction was trying to change.
 */
const ABSTRACT = /\b(register|cadence|shape|texture|tone|energy|quality|feel|flavou?r|vibe|voice)\b/i;
/** ...but only when it is being COMMANDED rather than described or named as a data field. */
const COMMANDED = /\b(take|match|use|keep|hold|find|choose|pick|set|write in|derive|infer|capture)\b/i;

/**
 * 2. MAXIM-SHAPED INSTRUCTIONS. The same shapes engine/maxims.ts hunts for in the narrator's
 *    dialogue, turned on the instructions themselves — because an instruction written as an epigram
 *    teaches an epigram, which turn.ts:1079 already worked out once and fixed in exactly one place.
 */
const MAXIM = [
  /\b(?:is|are)\s+not\s+the\s+same\s+as\b/i,
  /\b(?:is|are)\s+not\s+a\s+\w+[,;]\s*(?:it|they)\s+(?:is|are)\b/i,
  /\bnever\s+\w+[^.;]{2,30},\s*always\b/i,
  /\bthe\s+\w+\s+is\s+not\s+the\s+\w+\b/i,
];

/**
 * 3. CLAIMS THE MODEL CANNOT ACT ON. Assertions about literary history, taste, or what "real"
 *    writing does. They read as authoritative and contain no operation: there is nothing to DO
 *    with "this is a modern literary register."
 */
const UNACTIONABLE = /\b(modern literary|literary register|prestige|purple prose|the register that|reads as literary|sounds literary|a modern \w+ convention)\b/i;

/**
 * 4. LITERARY VOCABULARY, WHICHEVER SIDE OF THE BAN IT IS ON.
 *
 * Naming a form in order to forbid it puts that form in the context. A prompt that says "no
 * aphorisms, no proverbs, no epigraphs, do not sound like a movie trailer" has just spent its
 * tokens describing aphorisms, proverbs, epigraphs and movie trailers, and the model has to
 * represent each one to avoid it. The instruction and the failure are made of the same words.
 *
 * The way out is a positive requirement that excludes the thing without naming it. "Every line
 * names something physically present in the room" removes aphorism completely — an aphorism names
 * nothing in the room — and never introduces the idea of an aphorism. That rule is in the dialogue
 * spec and this check exists so nobody reaches for the ban again.
 */
const LITERARY = /\b(aphorisms?|maxims?|proverbs?|epigrams?|epigraphs?|purple|florid|prose style|literary|movie trailer|melodrama|poetic|lyrical|writerly)\b/i;

export function lint(src: string): Finding[] {
  const out: Finding[] = [];
  for (const raw of modelFacing(src).split(/(?<=[.;!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 25 || s.length > 400) continue;
    if (ABSTRACT.test(s) && COMMANDED.test(s)) {
      out.push({ kind: "undefined-abstraction", text: s, why: "commands a quality-noun the prompt never defines; the model substitutes its own default" });
      continue;
    }
    if (MAXIM.some((re) => re.test(s))) {
      out.push({ kind: "maxim-instruction", text: s, why: "written as an epigram; an instruction in that shape teaches that shape" });
      continue;
    }
    if (UNACTIONABLE.test(s)) {
      out.push({ kind: "unactionable-claim", text: s, why: "a claim about style with no operation in it — nothing to do" });
      continue;
    }
    if (LITERARY.test(s)) {
      out.push({ kind: "literary-vocabulary", text: s, why: "names a literary form; the model must represent it to avoid it. Use a positive requirement that excludes it without naming it" });
    }
  }
  return out;
}

export function lintDir(dir = "src/engine"): { file: string; findings: Finding[] }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, findings: lint(readFileSync(join(dir, f), "utf8")) }))
    .filter((r) => r.findings.length);
}

if (process.argv[1]?.endsWith("promptlint.ts")) {
  const results = lintDir(process.argv[2] ?? "src/engine");
  let n = 0;
  for (const { file, findings } of results.sort((a, b) => b.findings.length - a.findings.length)) {
    console.log(`\n${file}  (${findings.length})`);
    for (const f of findings) { n++; console.log(`  [${f.kind}] ${f.text.slice(0, 150)}`); }
  }
  console.log(`\n${n} findings across ${results.length} files`);
}
