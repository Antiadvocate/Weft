/* Smoke test: INSTRUCTIONS THAT DESCRIBE A QUALITY INSTEAD OF SPECIFYING AN OPERATION.
 *
 * Three real lines from this engine's prompts, all of them mine:
 *
 *   BUT SHORT IS NOT THE SAME AS TRUE.
 *   Take the SHAPE of speech from the culture you were given.
 *   A clipped, laconic line is a modern literary register, not a neutral one.
 *
 * The first is a maxim: it asserts a distinction between "short" and "true" without saying what
 * either refers to. The second capitalises SHAPE as though it were a defined field — cadence?
 * syntax? sentence length? vocabulary? — and two models resolve it differently. The third is a
 * claim about literary history with no operation in it; there is nothing to DO with it.
 *
 * Why this is not a style quibble: research on constraint compliance finds models carry strong
 * default patterns, and that an instruction ALIGNED with the default gets near-total compliance
 * while one that FIGHTS the default degrades sharply. The default for "person in an ancient
 * setting speaks" is the oracular register. All three lines above fight that default using an
 * abstraction — the weakest form a conflicting constraint can take — so the default wins and the
 * characters talk like oracles. Which is exactly what the save showed.
 *
 * The count is a RATCHET, like the one in prompt-echo.ts. It may fall freely. Raising it means a
 * new instruction was written as criticism rather than as a procedure: rewrite the instruction,
 * do not raise the budget.
 */
import { lint, lintDir, modelFacing, templateLiterals } from "../tools/promptlint";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the linter reads what a MODEL reads, not what a maintainer reads ─────── */
{
  const src = `
/** A file header explaining why a rule exists. This is written for people and never reaches a
 *  model: take the SHAPE of it and match the register. */
// take the register from the culture
const RE = /\\bfoo\\b/;
const prompt = \`Match the register of the story you are given and keep the tone consistent throughout.\`;
`;
  const mf = modelFacing(src);
  check("a block comment is not model-facing", !/file header/.test(mf), mf);
  check("a line comment is not model-facing", !/take the register from the culture/.test(mf));
  check("a regex source is not a prompt", !/\\\\bfoo/.test(mf));
  check("the actual instruction is", /Match the register/.test(mf), mf);
}

/* ── 1b. A NESTED TEMPLATE DOES NOT HIDE THE PROMPT INSIDE IT ─────────────────
 *
 * The scanner used to be a regex pairing backticks in order, so an inner `${x ? `y` : ""}` shifted
 * the pairing and everything after it fell out of phase. The effect was not a few missed lines: it
 * silently excluded most of the corpus. voiceforge.ts — the prompt that writes the voice every
 * character speaks out of — was being read 204 characters deep, and the
 * measured count that this file ratchets was taken over the fraction that happened to land in
 * phase. A linter that reports zero because it never looked is worse than no linter.
 */
{
  const src = 'const p = `Alpha instruction text here ${a ? `${b}` : ""} and the tail of it` + `Beta instruction text that must also be seen by the linter`;';
  const lits = templateLiterals(src);
  check("the outer literal survives an inner one", lits.some((t) => /Alpha instruction text here/.test(t) && /and the tail of it/.test(t)), lits);
  check("...and the literal after it is not lost", lits.some((t) => /Beta instruction text/.test(t)), lits);
  check("the interpolated code is not read as prose", !lits.join("").includes("a ?"));

  // and the real file it was hiding
  const vf = modelFacing(readFileSync("src/engine/voiceforge.ts", "utf8"));
  check("voiceforge is actually linted now", vf.length > 2000, vf.length);
  check("...including the rules for the voice the narrator writes from", /THE IDIOLECT IS THE CARD/.test(vf));
  // and the rule that keeps a voice card from becoming a script the narrator recites
  check("...and its ban on writing any dialogue at all", /WRITE NO DIALOGUE/.test(vf), vf.slice(0, 200));
}

/* ── 2. the three shapes ─────────────────────────────────────────────────────── */
{
  const one = (t: string) => lint(`const p = \`${t}\`;`);
  check("maxim: an instruction written as an epigram",
    one("Remember that short is not the same as true when you write these people.")[0]?.kind === "maxim-instruction");
  check("abstraction: a quality-noun commanded but never defined",
    one("Take the shape of speech from the culture you were given and hold it throughout.")[0]?.kind === "undefined-abstraction");
  check("unactionable: a claim about style with nothing to do",
    one("A clipped line is a modern literary register and should be avoided everywhere.")[0]?.kind === "unactionable-claim");
}

/* ── 3. what it must NOT flag: a procedure over named fields ─────────────────── */
{
  const good = [
    "What does this person want out of this exchange in the next minute? The line is aimed at that.",
    "They speak only from what this character has been told, seen, or worked out, and they can be wrong.",
    "Read their state above: tired, hurt, frightened, hungry, drunk, at ease.",
    "People say different things in front of a stranger, an employer, a child, or nobody.",
    "Read the line alone, with no scene around it, and replace it if it still means something.",
    "Emit promises_resolved with outcome kept or broken for every promise the prose settled.",
    "If two of these people would produce the same line in this moment, at least one of them is wrong.",
  ];
  for (const g of good) check(`left alone: ${g.slice(0, 52)}`, lint(`const p = \`${g}\`;`).length === 0, lint(`const p = \`${g}\`;`));
}

/* ── 4. the specific lines that caused this, are gone ────────────────────────── */
{
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  for (const gone of ["SHORT IS NOT THE SAME AS TRUE", "SHAPE of speech", "modern literary register"]) {
    check(`no longer shipped: "${gone}"`, !prompts.includes(gone));
  }
  // ...and the procedure that replaced them is
  check("the five state questions are asked", /WHAT THEY WANT IN THE NEXT MINUTE/.test(prompts) && /WHAT THEY KNOW/.test(prompts));
  check("...including the one that produced the Segway failure",
    /WHAT THEIR LIFE HAS GIVEN THEM WORDS FOR/.test(prompts));
  check("the things writing removes are put back as actions, not adjectives",
    /Let them stop before the end of a sentence/.test(prompts) && /Let one line come out badly/.test(prompts));
  // THE WHOLE FIX, and the reason it can be genre-agnostic: an aphorism names nothing in the room,
  // so requiring every line to name something present excludes it without introducing the concept.
  check("and the requirement is positive, naming no form it wants avoided",
    /IT NAMES SOMETHING IN THIS ROOM/.test(prompts));
  check("which leaves a character free to be wise about the thing in front of them",
    !/no aphorism|no proverb|not a maxim/i.test(prompts.split("WRITING A LINE OF DIALOGUE")[1]?.slice(0, 2200) ?? ""));
}

/* ── 5. THE RATCHET ─────────────────────────────────────────────────────────── */
{
  const total = lintDir("src/engine").reduce((n, r) => n + r.findings.length, 0);
  // The backlog is gone: every instruction the four checks found has been rewritten as a procedure
  // over a named field, a check applicable to a finished sentence, or a positive requirement that
  // excludes a form without naming it. Zero is now the standing budget, so the next one written as
  // criticism fails here on the commit that introduces it. Rewrite the instruction; do not raise this.
  const BUDGET = 0;
  console.log(`     (quality-descriptions where an operation belongs: ${total}, budget ${BUDGET})`);
  check("instructions written as criticism have not increased", total <= BUDGET, total);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
