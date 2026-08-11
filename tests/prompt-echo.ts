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
import { readFileSync } from "node:fs";

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
const modelFacing = (readFileSync("src/engine/prompts.ts", "utf8").match(/`[^`]{40,}`/g) ?? [])
  .join("\n")
  .replace(/\$\{[^}]*\}/g, " ");

/* ── 1. the phrases caught coming back in the prose ───────────────────────────── */
{
  for (const phrase of [
    "doing arithmetic on a sum",              // written twice by the narrator in one save
    "the way she'd looked at him when they were younger",
    "the way it always was with him",
  ]) check(`no longer supplied: "${phrase.slice(0, 46)}"`, !modelFacing.includes(phrase));

  // ...and the rule they belonged to is still stated
  check("the rule itself survives without its specimen", /listing what a face was NOT in order to install what it was/.test(modelFacing), "camera rule");
  check("and so does the accounting-metaphor ban", /sums, ledgers, arithmetic, numbers adding up/.test(modelFacing));
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
