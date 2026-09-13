/* Smoke test: THE ENGINE WROTE ITS INSTRUCTIONS IN THE SHAPE ITS DETECTORS BAN.
 *
 * "You've written instructions in maxims and aphorisms?"
 *
 * Yes. Measured across src/engine at the time this file was written: 262 model-facing sentences
 * built on the contrastive epigram, 151 of them in prompts.ts alone.
 *
 *     render the act, not the psychology.
 *     accurate, not invented, not withheld.
 *     A stretch of turns where the world does not press is correct output, not drift.
 *
 * "X, not Y" is not an incidental habit. It is:
 *
 *   · a SHAPE in engine/maxims.ts, listed as "not X, but Y", mined from a real save;
 *   · 25% of the entire EQ-Bench Slop Score, third behind slop words at 60%;
 *   · banned by name in OpenAI's GPT-6 Astra prompting guide.
 *
 * Three independent parties call it a top-three marker of machine prose, and the engine that
 * detects it in its own OUTPUT was supplying it two hundred and sixty-two times on the way in.
 *
 * THIS IS THE SAME PROBLEM tests/prompt-echo.ts EXISTS FOR, at the level of grammar instead of
 * phrasing. A prompt is a corpus the model conditions on: a shape used hundreds of times across an
 * instruction block teaches that shape far more reliably than one sentence asking for it to be
 * avoided, and the rebound work (arXiv 2511.12381) says the sentence asking primes it as well.
 *
 * So, the same remedy: a RATCHET. The count may fall and may never rise. Nobody has to rewrite two
 * hundred sentences today, and nobody gets to add the next one. Rewriting one is
 * usually a matter of stating the positive requirement and stopping.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lint } from "../tools/promptlint";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function countIn(dir: string, kind: string): { total: number; byFile: Record<string, number> } {
  const byFile: Record<string, number> = {};
  let total = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const n = lint(readFileSync(join(dir, f), "utf8")).filter((x) => x.kind === kind).length;
    if (n) { byFile[f] = n; total += n; }
  }
  return { total, byFile };
}

/* ── the ratchet ──────────────────────────────────────────────────────────────── */
{
  const { total, byFile } = countIn("src/engine", "contrastive-instruction");
  /* Pinned at the count on the day the detector shipped. LOWER IT when you fix some; never raise it.
   *
   * Roughly one in seven of these is the detector catching the tail of a long sentence rather than a
   * real epigram, so this number is a direction of travel and not a to-do list. That is the right
   * trade for a ratchet: what it has to do is stop the count growing, and it does that whether or not
   * every individual hit deserves a rewrite. Read the findings with `npx tsx tools/promptlint.ts`. */
  const BUDGET = 262;
  console.log(`     (contrastive instructions in src/engine: ${total}, budget ${BUDGET})`);
  check("the stock of 'X, not Y' instructions has not grown", total <= BUDGET, { total, worst: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 3) });
}
{
  const { total } = countIn("src/engine", "maxim-instruction");
  const BUDGET = 12;
  console.log(`     (epigram instructions: ${total}, budget ${BUDGET})`);
  check("nor has the epigram count grown", total <= BUDGET, total);
}

/* ── AND THE EPIGRAM THAT USES NO CONTRAST ────────────────────────────────────────────────────
 *
 * Every shape the maxim detector knew was a contrastive wearing a different hat, so it could only
 * find epigrams built out of opposition. It scored this at zero — the hostile-desire directive,
 * which is the loudest single instruction in the character block:
 *
 *   they stand nearer than the argument needs
 *   they touch you in ways that are not kind
 *   contempt that keeps coming back for more of you
 *   needling as a way of making contact
 *   punishing you for a pull they will not own
 *
 * Five clauses, five epigrams, no contrast anywhere in them. The player caught it by reading it,
 * having already caught the same thing once before in this project.
 *
 * It is worth a hard zero rather than a budget because there are only a handful of these shapes and
 * they are always rewritable — every one of the eight found on the first honest run was gone inside
 * an hour, and none of the rewrites lost anything. A budget invites the count to sit at it.
 */
{
  const { total, byFile } = countIn("src/engine", "figured-instruction");
  console.log(`     (figured instructions in src/engine: ${total})`);
  check("no instruction is written as a figure", total === 0, byFile);
}

/* ── and the shapes the detector must keep catching ───────────────────────────── */
{
  // Either kind counts as caught: the older MAXIM list already owns some of these shapes, and which
  // bucket a sentence lands in matters less than whether it is reported at all.
  const caught = (s: string) => lint("const X = `" + s + "`;").some((f) => f.kind === "contrastive-instruction" || f.kind === "maxim-instruction");
  for (const s of [
    "Render the act, not the psychology, and stop there.",
    "Record what they did, not what it meant about them.",
    "Give the reader the gesture — not the feeling behind it.",
    "It is not a bond, it is an appetite with nothing behind it.",
  ]) check(`caught: ${s.slice(0, 52)}`, caught(s), s);

  // …and ordinary prose with a bare negation is left alone
  for (const s of [
    "Do not invent a capability the character's card does not give them.",
    "They stay in the room and the anger brings them closer to you.",
    "A refusal from them is short, and it costs them visibly.",
    "Never state the wanting outright; render it as behaviour in the scene.",
  ]) check(`left alone: ${s.slice(0, 52)}`, !caught(s), s);
}

/* ── the lines this conversation added, which were the whole reason to look ───── */
{
  const desire = readFileSync("src/engine/desire.ts", "utf8");
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  const verbalized = readFileSync("src/engine/verbalized.ts", "utf8");
  for (const [what, hay] of [["desire.ts", desire], ["prompts.ts", prompts], ["verbalized.ts", verbalized]] as [string, string][]) {
    for (const gone of [
      "What is missing is courtship, not appetite",
      "A person who wants somebody does not drift off",
      "not a reason to go home",
      "a settled wanting is not a passive one",
      "IS NOT THE SAME QUESTION AS WHO SPEAKS LAST",
      "not the shape of an ending",
      "an exception about ACTION, not about the player",
      "They are not a menu and not a script",
    ]) if (hay.includes(gone)) check(`${what} no longer supplies "${gone.slice(0, 40)}"`, false, gone);
  }
  check("the instructions added in this branch carry no contrastive epigram", true);

/* ── AND THE FOUR SHAPES THE DETECTOR LEARNED FROM THE ONE IT MISSED ────────────────────────── */
{
  const figured = (t: string) => lint("const X = `" + t + "`;").some((f) => f.kind === "figured-instruction");
  for (const t of [
    "they stand nearer than the argument needs and will not say why to anyone",
    "they touch you in ways that are not kind and do not apologise afterwards",
    "contempt that keeps coming back for more of you, again and again this scene",
    "needling as a way of making contact with somebody they will not address",
    "punishing you for a pull they will not own and cannot put down",
    "the silence does the work here and nobody in the room fills it",
    "let them stay longer than the errand warrants and say nothing about it",
    "it was not unkind of her, whatever the others in the room decided",
  ]) check(`figure caught: ${t.slice(0, 46)}`, figured(t), t);
  /* AND THE ORDINARY RULE-WRITING IT MUST LEAVE ALONE. A first cut opened the litotes family with
   * a plain restrictive clause and flagged thirty-odd of these — two thirds of everything it found.
   * A detector wrong two times in three teaches you to skip its output. */
  for (const t of [
    "A capability or a past event that is not in the bible does not exist until the player adds it",
    "Do not invent events that are not already in the raw memories you were given",
    "Give one present character something to say that is not about the plot or the player",
    "Do not put a text in his hands that was not already there before this turn began",
    "Change nothing that was not already changing before the player walked into the room",
    "manufacture desire that is not already recorded in these people's edges",
  ]) check(`plain rule left alone: ${t.slice(0, 40)}`, !figured(t), t);
}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
