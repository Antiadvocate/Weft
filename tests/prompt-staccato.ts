/* Smoke test: THE ENGINE WROTE ITS INSTRUCTIONS IN THE VOICE IT KEEPS CATCHING.
 *
 * The player, reading a forged register that said "Short, flat sentences. Says the thing and stops.
 * Does not soften it.":
 *
 *     "Do you hear this register? It becomes a part of the fucking prose. Everywhere. At
 *      everything. The purpose of grounding sentence structure was to stop pontification and to
 *      stop abstract wordiness. Which is still happening. But it's grounded so now it just sounds
 *      like a western."
 *
 * He is pointing at the instructions rather than at the card. The card is three sentences. The
 * corpus is thousands, written by the same hand on the same days, and read by the model in the
 * seconds before it writes.
 *
 * MEASURED THE DAY THIS FILE WAS WRITTEN: 3,841 model-facing sentences in src/engine, 851 of them
 * three to nine words long, and 437 of those with no comma, no dash and no subordinate clause.
 * 11.4% of everything the engine says to a model was a flat short declarative. Among them, from a
 * prompt written the same week the complaint arrived:
 *
 *     You call and get no answer.
 *     You ask the wrong person.
 *     You go and find the door shut.
 *
 * THIS IS THE SAME ARGUMENT tests/prompt-shapes.ts makes about the contrastive epigram, which went
 * from 262 to zero. A prompt is a corpus the model conditions on, and a shape used hundreds of
 * times teaches it far more reliably than one sentence asking for it to be avoided. That file
 * measured one shape. Nobody had measured this one.
 *
 * WHY IT IS A RATCHET AND NOT A GATE. No single sentence here is wrong — "One sentence is enough."
 * is a fine instruction, and a JSON field description that reads "Dialogue in quotes." is a label
 * rather than prose. What does the damage is the proportion. So the number may fall and may never
 * rise, the way the epigram count did, and the fix is never deletion: let a sentence carry its own
 * reason, hang the qualification off the clause instead of starting a new one, and put the example
 * inside the sentence that needs it.
 */
import { isStaccato, staccato, staccatoTree } from "../tools/promptlint";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the unit ─────────────────────────────────────────────────────────────── */
{
  for (const s of ["You call and get no answer.", "The briefing names it.", "A refresh does not end anything.",
                   "Short flat sentences.", "Nothing convenient arrives to help."]) {
    check(`counted: ${s}`, isStaccato(s));
  }

  // A sentence carrying its own reason is doing two things and is not the shape.
  for (const s of ["You call and get no answer, because nobody told her you were coming.",
                   "A refresh ends nothing that was open.",
                   "Keep the length close to the original, since a shorter replacement changes its weight."]) {
    check(`not counted: ${s.slice(0, 50)}`, !isStaccato(s));
  }

  // Excluded by construction: headings are labels, questions are questions, and anything long
  // enough to have said something is out of range in both directions.
  check("a heading in capitals is a label", !isStaccato("THE BRIEFING IS THE WHOLE OF WHAT YOU KNOW."));
  check("a question is not a declarative", !isStaccato("Did anybody tell her?"));
  check("two words is not a sentence", !isStaccato("No exceptions."));
  check("past nine words it is no longer this shape",
    !isStaccato("The world moved on without anybody stopping to explain what happened."));
}

/* ── 2. THE RATCHET ──────────────────────────────────────────────────────────────
 *
 * 437 on the day the instrument was written, 204 after two passes over prompts.ts, agency.ts and
 * reviser.ts. The number below may fall and may never rise. If a change pushes it up, the fix is to
 * rewrite the sentences that pushed it, in the file that pushed it. */
const BUDGET = 215;
{
  const t = staccatoTree("src/engine");
  check(`src/engine is at or under ${BUDGET} flat declaratives`, t.flat <= BUDGET,
    { flat: t.flat, of: t.total, pct: `${t.pct.toFixed(1)}%`, worst: t.byFile.slice(0, 5) });

  /* The narrator contract is the document read immediately before every line of prose is written,
   * so it is held tighter than the tree. 113 when this was measured. */
  const p = staccato(readFileSync("src/engine/prompts.ts", "utf8"));
  check("the narrator contract is at or under 40", p.flat <= 40, { flat: p.flat, pct: `${p.pct.toFixed(1)}%`, samples: p.samples });

  /* The prompts written while this complaint was open, held at zero, because they are the ones with
   * no excuse. agency.ts had nine and was three weeks old. */
  const a = staccato(readFileSync("src/engine/agency.ts", "utf8"));
  check("agency.ts carries none", a.flat === 0, a.samples);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
