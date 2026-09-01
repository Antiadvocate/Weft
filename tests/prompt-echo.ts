/* Smoke test: THE MODEL WRITES THE EXAMPLE YOU TOLD IT NEVER TO WRITE.
 *
 * PROSE_RULES carried this, as a banned move, in two separate places:
 *
 *   ruling out readings in order to install one ("not frightened, not grateful, just a woman
 *   doing arithmetic on a sum she hadn't expected")
 *
 * The narrator wrote it twice in twenty-four turns:
 *
 *   T3   "something behind her eyes was doing arithmetic on a sum she had not expected"
 *   T21  "the way a woman's face goes still when she is doing arithmetic on a sum she had not
 *         expected to see"
 *
 * A vivid phrase is the most memorable text in a 224,000-character instruction block, and the
 * prohibition attached to it is not. Handing a model a well-turned line and saying "never write
 * this" supplies the line. The rule survives being stated without a specimen; the specimen does
 * not survive being read.
 *
 * This test holds two lines. The phrases already caught leaking must stay gone. And the stock of
 * quotable lines attached to prohibitions is a RATCHET: it may fall, never rise, so the next rule
 * written in the heat of a bad save cannot reintroduce the failure it is trying to fix.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { templateLiterals } from "../tools/promptlint";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/**
 * Everything inside a template literal long enough to be instruction text — i.e. what a model reads
 * — with the `${...}` interpolations stripped out. Those are CODE, not prose, and leaving them in
 * made the ratchet below count a fragment like `")}${bodySeverity(c) >= 3 ? "` as a quotable example
 * phrase. A budget that moves when the surrounding code is edited measures the wrong thing.
 */
const modelFacing = templateLiterals(readFileSync("src/engine/prompts.ts", "utf8"))
  .filter((t) => t.length >= 40)
  .join("\n");

/* ── 1. the phrases caught coming back in the prose ───────────────────────────── */
{
  for (const phrase of [
    "doing arithmetic on a sum",              // written twice by the narrator in one save
    "the way she'd looked at him when they were younger",
    "the way it always was with him",
  ]) check(`no longer supplied: "${phrase.slice(0, 46)}"`, !modelFacing.includes(phrase));

  // ...and the rule they belonged to is still stated. It used to be a list of banned constructions,
  // which named four figures of speech in order to forbid them — the failure tools/promptlint.ts
  // calls literary-vocabulary. It is now one check applied to a finished sentence, and the four
  // named figures are all excluded by it: none of them is a thing a person in the room could point
  // at. The assertions below track the check, not the list.
  check("the rule itself survives without its specimen",
    /something a person standing in the room could point at/.test(modelFacing), "camera rule");
  check("...and it is stated as a test on the output, not a catalogue of forbidden figures",
    /[Ss]trike from each sentence any part a person in the room could not have pointed at|[Ss]trike any part of it that a person in the room could not have pointed at/.test(modelFacing));
  check("which still covers the private conclusion the accounting metaphor was used for",
    /what one of them privately concluded/.test(modelFacing));
}

/* ── 2. the ratchet ───────────────────────────────────────────────────────────── */
{
  // A quotable line is 4+ words in quotes. It counts against us when the clause introducing it is
  // a prohibition — that is the shape that supplies what it forbids.
  const NEG = /(never|no |not |ban(ned)?|forbidden|avoid|stop |instead of|rather than|failure|wrong|do not|don't)/i;
  let supplied = 0;
  for (const sentence of modelFacing.split(/(?<=[.;])\s+/)) {
    for (const ex of sentence.match(/["“][^"”\n]{15,120}["”]/g) ?? []) {
      if (ex.replace(/["“”]/g, "").split(/\s+/).length < 4) continue;
      if (NEG.test(sentence.slice(0, sentence.indexOf(ex)))) supplied++;
    }
  }
  // Measured after removing the ones proven to leak. This number may go DOWN freely. Raising it
  // means a new rule was written with a ready-made line attached, which is the bug this file is
  // about — lower the count or delete this test deliberately, do not nudge the budget.
  const BUDGET = 86;
  console.log(`     (quotable lines attached to a prohibition: ${supplied}, budget ${BUDGET})`);
  check(`the stock of forbidden-but-quotable lines has not grown`, supplied <= BUDGET, supplied);
}

/* ── 2b. AND THE OTHER THIRTY PROMPTS ─────────────────────────────────────────
 *
 * This file only ever measured prompts.ts, and its scanner only ever saw the parts of it that fell
 * in phase with a backtick-pairing regex (see tools/promptlint.ts). Meanwhile the prompt that writes
 * the sample lines every character's speech is copied from lives in voiceforge.ts, the one that
 * writes what a player's own faculties tell them lives in read.ts, and neither was ever read here.
 * Same rule, same ratchet, applied to all of them.
 */
{
  const NEG = /(never|no |not |ban(ned)?|forbidden|avoid|stop |instead of|rather than|failure|wrong|do not|don't)/i;
  let supplied = 0;
  const worst: [string, number][] = [];
  for (const f of readdirSync("src/engine").filter((x) => x.endsWith(".ts") && x !== "prompts.ts")) {
    let n = 0;
    const text = templateLiterals(readFileSync(join("src/engine", f), "utf8")).filter((t) => t.length >= 40).join("\n");
    for (const sentence of text.split(/(?<=[.;])\s+/)) {
      for (const ex of sentence.match(/["“][^"”\n]{15,120}["”]/g) ?? []) {
        if (ex.replace(/["“”]/g, "").split(/\s+/).length < 4) continue;
        if (NEG.test(sentence.slice(0, sentence.indexOf(ex)))) n++;
      }
    }
    if (n) worst.push([f, n]);
    supplied += n;
  }
  // Ratcheted down from 60 after turn.ts's eleven supplied specimens were rewritten as tests on the
  // finished line — the POV block alone was handing over five ready-made sentences it forbade. What
  // remains is mostly JSON field descriptions in montage-run.ts and minimal pairs in turn.ts, which
  // are not quotable prose. The number may only fall. Same rule as above: lower it, do not nudge it.
  const BUDGET = 46;
  console.log(`     (…and in the other prompts: ${supplied}, budget ${BUDGET})`);
  check("nor has it grown outside prompts.ts", supplied <= BUDGET,
    worst.sort((a, b) => b[1] - a[1]).slice(0, 4));
}

/* ── 3. the same text is not pasted into two prompts ──────────────────────────── */
{
  // The banned example above appeared in two separate blocks, so a narrator building a turn read it
  // twice. Duplicated instruction is duplicated exposure, and it is paid for on every turn.
  const sents = modelFacing.split(/(?<=[.;])\s+/).map((x) => x.trim()).filter((x) => x.length > 90);
  const seen = new Map<string, number>();
  for (const s of sents) seen.set(s, (seen.get(s) ?? 0) + 1);
  const repeated = [...seen.entries()].filter(([, n]) => n > 1);
  check("no long instruction sentence is pasted more than twice", repeated.every(([, n]) => n <= 2), repeated.slice(0, 3).map(([s, n]) => `x${n} ${s.slice(0, 60)}`));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
