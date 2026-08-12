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

/**
 * Every template literal in the file, nesting handled.
 *
 * This used to be `src.match(/`[^`]{40,}`/g)`, and that regex is wrong in a way worth recording,
 * because it hid most of the corpus it was supposed to be measuring. A nested template —
 *
 *     `Period: ${bible.era ? `${bible.era}` : ""} — and the rest of the instruction`
 *
 * — has four backticks, and the regex pairs the FIRST with the SECOND. So it returned the fragment
 * up to the start of the inner template, then paired the inner closer with the outer closer and
 * returned `: "" } — and the rest…`. Every prompt built with a ternary came out shredded, and
 * whichever text fell in the shredder's off-phase was never linted at all. voiceforge.ts, which
 * writes the sample lines the narrator imitates, was being read 204 characters deep out of 4,000.
 *
 * So: scan properly. Track template depth and brace depth, collect only the literal parts, and drop
 * the ${...} expressions on the way past rather than by a second regex afterwards.
 */
export function templateLiterals(src: string): string[] {
  // Comments first. A file header explaining WHY a rule exists is written for people and never
  // reaches a model — counting it would inflate every number here and point at the wrong lines.
  const s = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const out: string[] = [];
  const stack: { buf: string; depth: number }[] = [];   // one frame per open template literal
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const top = stack[stack.length - 1];
    if (c === "\\" && top && top.depth === 0) { top.buf += " "; i += 2; continue; }
    if (c === "`") {
      if (top && top.depth === 0) { out.push(stack.pop()!.buf); i++; continue; }
      stack.push({ buf: "", depth: 0 });                 // opens inside code, or inside an ${expr}
      i++; continue;
    }
    if (top && top.depth === 0 && c === "$" && s[i + 1] === "{") {
      top.depth = 1; top.buf += " "; i += 2; continue;   // enter interpolation; the code is not prose
    }
    if (top && top.depth > 0) {
      if (c === "{") top.depth++;
      else if (c === "}") top.depth--;
      // a quoted string inside the expression can hold braces and backticks — skip it whole
      else if (c === '"' || c === "'") {
        const q = c; i++;
        while (i < s.length && s[i] !== q) i += s[i] === "\\" ? 2 : 1;
      }
      i++; continue;
    }
    if (top) top.buf += c;
    i++;
  }
  return out;
}

/** Model-facing text only: template literals long enough to be instructions. */
export function modelFacing(src: string): string {
  return templateLiterals(src)
    .filter((t) => t.length >= 40)
    // ...and template literals that are CODE (regex sources, JSX, expression soup) are not prompts.
    .filter((t) => !/=>|\?\?|\(\)|\\b|\\s\+|<\/|className/.test(t))
    .filter((t) => (t.match(/\s/g) ?? []).length >= 8)
    // Terminate each literal. Two adjacent literals are two separate pieces of text a model reads in
    // different places; joining them with a bare newline let a literal ending without punctuation
    // run into the next one, and the sentence splitter below then read the pair as one sentence —
    // which manufactured findings out of words that never appear together in any prompt.
    .join(".\n");
}

export interface Finding { kind: string; text: string; why: string }

/**
 * 1. UNDEFINED ABSTRACTIONS. A noun naming a quality, used as the object of an instruction, with no
 *    definition anywhere in the prompt. The model has to supply the meaning, and its meaning is the
 *    default it already had — which is the thing the instruction was trying to change.
 */
const ABSTRACT =
  // words that are quality-nouns wherever they appear...
  /\b(?:register|cadence|texture|flavou?r|vibe|voice)\b/i.source +
  // ...and words that are only the problem as NOUNS. "use it to shape what the body does" and
  // "plainly feeling what they feel" are verbs and were being flagged; "take the SHAPE of speech"
  // and "match the tone" are the real thing, and every real one carries an article or possessive.
  "|" + /\b(?:the|its|their|his|her|a|this|that)\s+(?:shape|tone|energy|quality|feel)\b/i.source;
const ABSTRACT_RE = new RegExp(ABSTRACT, "i");
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
    if (ABSTRACT_RE.test(s) && COMMANDED.test(s)) {
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
