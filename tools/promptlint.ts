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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
/* THE SHAPES LIVE IN THE ENGINE NOW. Three passes were hunting the same sentence shapes with three
 * separate copies of the rules — this file on the instructions, engine/maxims.ts on committed
 * dialogue, and nothing at all on the strings the forge and the bookkeeper write onto a character
 * card. engine/aphorism.ts holds the one list all three read, so a shape added for the card screen
 * is a shape this linter starts reporting on the same commit. The regexes moved unchanged. */
import { EPIGRAM_FIGURES, CONTRASTIVE_FIGURES, FIGURED_FIGURES, INSTRUCTION_PRONOUNCEMENTS } from "../src/engine/aphorism";

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
const MAXIM = EPIGRAM_FIGURES.map((f) => f.re);

/**
 * 2b. THE CONTRASTIVE, WHICH IS THE ONE EVERYBODY ELSE ALSO BANS.
 *
 * "X, not Y." The four shapes above were mined from this engine's own worst sentences and none of
 * them covers the commonest form of the same move. That omission is expensive, because this exact
 * construction is:
 *
 *   · a SHAPE in engine/maxims.ts, listed there as "not X, but Y", mined out of a real save;
 *   · 25% of the entire EQ-Bench Slop Score, weighted third behind slop words at 60%;
 *   · banned by name in OpenAI's own GPT-6 Astra prompting guide — "Do not use contrastive
 *     phrasing such as 'X, not Y' or 'X—not Y'".
 *
 * Three independent parties treat it as a top-three marker of machine prose, and the engine that
 * detects it in its OUTPUT was writing its INSTRUCTIONS in it ninety-four times.
 *
 * That is not an irony, it is a supply problem, and it is the same one tests/prompt-echo.ts was
 * written for: a prompt is a corpus the model conditions on. Ninety-four instructional sentences in
 * a shape carry that shape into the prose far more reliably than one sentence saying to avoid it,
 * and the rebound work (arXiv 2511.12381) says the sentence saying to avoid it primes it too.
 *
 * WHAT IT DOES NOT FLAG. A bare "not" is ordinary and necessary; what is caught is the balanced
 * pair — a comma, "not", and a replacement term — which is where the epigram lives. Rewriting one
 * is usually a matter of stating the positive requirement and stopping.
 */
const CONTRASTIVE = CONTRASTIVE_FIGURES.map((f) => f.re);

/**
 * 2c. THE FIGURED INSTRUCTION — an epigram that never uses a contrast.
 *
 * Every shape in MAXIM above is a contrastive wearing a different hat: "not the same as", "not a X
 * it is Y", "never X always Y", "the X is not the Y". So the detector could only ever find epigrams
 * built out of opposition, and it scored this at zero — the hostile-desire directive in
 * engine/desire.ts, which the previous commit established is the single loudest instruction in the
 * whole character block:
 *
 *   they keep ending up where you are and are angry about it
 *   they stand nearer than the argument needs
 *   they touch you in ways that are not kind
 *   contempt that keeps coming back for more of you
 *   needling as a way of making contact
 *   punishing you for a pull they will not own
 *
 * Six clauses, six epigrams, zero contrastives, zero findings. And the player who reads this
 * engine's output for a living spotted it in one glance, having already caught the same thing in my
 * prose once this session.
 *
 * It matters more here than anywhere else for the reason the file header already gives: a prompt is
 * a corpus the model conditions on. The loudest instruction in the character block was also the
 * most literary one in it, so it was teaching the register at the same time as commanding the
 * behaviour — and the register it teaches is the one the player's very first report was about.
 *
 * Four shapes, mined from those six clauses:
 *
 *   LITOTES        a quality asserted by negating its opposite — "in ways that are not kind",
 *                  "not unkind", "no small thing". The most reliable single marker of the register.
 *   ABSTRACT ACTOR an abstraction handed a verb — "contempt that keeps coming back", "the silence
 *                  does the work", "a pull they will not own". Nothing in the room is doing it.
 *   NOMINAL GLOSS  "X-ing as a way of Y-ing", which restates an action as its own interpretation.
 *   MEASURED AGAINST AN ABSTRACTION  "nearer than the argument needs", "longer than the moment
 *                  warranted" — a comparison whose yardstick is a concept.
 *
 * Each is narrow on purpose. A bare "not" is ordinary, an abstract noun is ordinary, and "as a way
 * of" is ordinary; what is caught is the figure.
 */
const FIGURED = FIGURED_FIGURES.map((f) => f.re);

/**
 * 2d. THE PRONOUNCEMENT — a general law about the world, standing in an instruction.
 *
 * These shapes were mined out of committed dialogue, in engine/maxims.ts, and were never turned on
 * the instructions. They should have been on the first day, for the reason this file's header
 * already gives: a prompt is a corpus. A rule reading "everything a person says has a price behind
 * it" hands the model both the rule and a sample of the register it is meant to suppress, and the
 * sample is the part that survives thirty thousand characters of prefix.
 *
 * Sharing the list with the card screen is the point. A shape added because the voice forge started
 * writing it is a shape this linter reports on the same commit, without anybody copying a regex.
 *
 * ONE SHAPE IS HELD BACK, and engine/aphorism.ts says which and why: the universal quantifier is
 * how a prohibition is written in English, so running it over a corpus of prohibitions reports the
 * corpus. It stays on the card screen and comes off here.
 */
const PRONOUNCEMENT = INSTRUCTION_PRONOUNCEMENTS.map((f) => f.re);

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

/**
 * 5. A NAMED RULE THE PROMPT NEVER STATES.
 *
 * Detector 1 above is the right idea and could not see the worst instance of it in the engine:
 *
 *     BROKEN (fractured) — the Mirror rule applies: no judgments, only clear reflection of others
 *
 * It needs a quality-noun from a closed list AND an imperative from a closed list. "reflection" is
 * on neither, and "applies" is not a command — it is a statement that something is already true,
 * which binds a model at least as hard as an order and reads to it as settled fact. So the line ran
 * in every prompt for every broken character in every save, and this file reported zero findings.
 *
 * A capitalised name in front of rule/principle/law/doctrine is a promise that the name means
 * something. Either the prompt says what it means, or the model decides — and it decided that
 * "reflection of others" was an instruction to repeat other people's sentences back at them.
 * Nothing here objects to naming a rule; the objection is to naming one and then not writing it.
 * Matched only mid-sentence, after a lowercase word — a capital at a sentence start is ordinary
 * ("Every rule above is...", "This law is real"), and those are descriptions of rules that ARE
 * written out, not invocations of a name standing in for one.
 */
const NAMED_RULE = /[a-z,]\s+(?:the\s+)?[A-Z][a-z]{2,}\s+(?:rule|principle|law|doctrine)\b/;

/* A SENTENCE TOO LONG TO LINT IS NOT A SENTENCE, IT IS SEVERAL.
 *
 * The cap below exists so a giant blob cannot collect a spurious match across half a paragraph, and
 * it was skipping the text outright. This engine writes enormous run-on directives, so what it
 * skipped was 3.7% of all prompt text — including the desire branch that carried "standing closer
 * than the argument needs, a hand that is not kind, needling as a way of making contact" straight
 * through a pass that had just been built to catch exactly those three shapes, and reported zero.
 *
 * So an over-long sentence is broken at the boundaries its author actually used — the semicolons
 * and em-dashes it is strung together with — and the clauses are linted. Anything still over the
 * cap after that really is one unbroken blob and is still skipped. */
function clauses(s: string): string[] {
  if (s.length <= 400) return [s];
  return s.split(/\s*[;—]\s+/).map((x) => x.trim()).filter((x) => x.length >= 25 && x.length <= 400);
}

export function lint(src: string): Finding[] {
  const out: Finding[] = [];
  for (const sentence of modelFacing(src).split(/(?<=[.;!?])\s+/)) for (const raw of clauses(sentence.trim())) {
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
    if (CONTRASTIVE.some((re) => re.test(s))) {
      out.push({ kind: "contrastive-instruction", text: s, why: "the 'X, not Y' shape — banned in this engine's own output detector, weighted 25% of EQ-Bench's slop score, and named in OpenAI's Astra guide. State the positive requirement and stop" });
      continue;
    }
    if (FIGURED.some((re) => re.test(s))) {
      out.push({ kind: "figured-instruction", text: s, why: "an epigram built without a contrast — litotes, an abstraction given a verb, an action restated as its own meaning, or a comparison measured against a concept. The prompt is a corpus: this teaches the register while it commands the behaviour" });
      continue;
    }
    if (PRONOUNCEMENT.some((re) => re.test(s))) {
      out.push({ kind: "pronouncement-instruction", text: s, why: "a general law about the world, in the shape engine/maxims.ts catches in dialogue. Say which case, in this engine, and what to do about it" });
      continue;
    }
    if (UNACTIONABLE.test(s)) {
      out.push({ kind: "unactionable-claim", text: s, why: "a claim about style with no operation in it — nothing to do" });
      continue;
    }
    if (LITERARY.test(s)) {
      out.push({ kind: "literary-vocabulary", text: s, why: "names a literary form; the model must represent it to avoid it. Use a positive requirement that excludes it without naming it" });
      continue;
    }
    if (NAMED_RULE.test(s)) {
      out.push({ kind: "undefined-named-rule", text: s, why: "invokes a rule by name that no prompt defines; the model supplies a meaning for the name and writes that instead. State the behaviour and drop the name" });
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

/* EVERY .ts AND .tsx UNDER A ROOT, NOT JUST THE ONE FLAT DIRECTORY.
 *
 * lintDir reads `src/engine` and stops there, so the ratchets it feeds have only ever measured the
 * engine. Model-facing text is not only in the engine. src/llm.ts builds the message envelope,
 * src/lib/api.ts carries the retry and repair prompts, and src/views/*.tsx holds the strings a
 * player reads — which are not sent to a model, but are written by the same hand on the same day
 * and drift the same way. Walking the tree is what lets one ratchet cover the whole game. */
export function lintTree(root: string): { file: string; findings: Finding[] }[] {
  const out: { file: string; findings: Finding[] }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir).sort()) {
      if (e === "node_modules" || e === "dist" || e === ".git") continue;
      const full = join(dir, e);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e)) continue;
      const findings = lint(readFileSync(full, "utf8"));
      if (findings.length) out.push({ file: full, findings });
    }
  };
  walk(root);
  return out;
}

if (process.argv[1]?.endsWith("promptlint.ts")) {
  const target = process.argv[2] ?? "src/engine";
  const results = target === "src/engine" ? lintDir(target) : lintTree(target);
  let n = 0;
  for (const { file, findings } of results.sort((a, b) => b.findings.length - a.findings.length)) {
    console.log(`\n${file}  (${findings.length})`);
    for (const f of findings) { n++; console.log(`  [${f.kind}] ${f.text.slice(0, 150)}`); }
  }
  console.log(`\n${n} findings across ${results.length} files`);
}
