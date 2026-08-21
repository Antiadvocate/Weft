/* Smoke test: "now we can completely ignore everything! who cares what traits are."
 *
 * Twelve turns of a fresh save. The player had authored a want onto Miranda by hand — a specific
 * act, stated as quick, without sex, regardless of context. The narrator escalated it into a long
 * undressing scene instead, and the player spent four of the twelve turns telling the software so:
 *
 *   t6   So you're going to ignore the erotica part of the prompt? Neat. An ai that doesn't kisten
 *   t9   I don't think you needed to take off her jeans. They aren't having sex.
 *   t10  So you just made her not cum on his dick because you have no clue what that means listen dumbass.
 *   t11  STOP BEING A FUCKING IDIOT AI
 *
 * detectOOC caught none of them. Turn 10 was played as Miranda asking "Vin. What are you talking
 * about?" — and the bookkeeper filed a standing want off it: understand why Vin is suddenly acting
 * so combative and strange in the kitchen. The player's complaint about the prose became a
 * character's motivation. Turn 11, in story mode, was played as her folding her arms.
 *
 * THE GUARD NEEDED THE PLAYER TO NAME THE MACHINE. It matched on about seventeen nouns — writer,
 * prose, narrator, ai — and a person complaining does not do that. They say "you made her", "you
 * needed to", "you have no clue". So the second tier tests the shape instead: nobody inside a story
 * can be held responsible for having AUTHORED that story, so an unquoted second-person accusation
 * of authorship has no referent in the world at all.
 *
 * Which cuts close to ordinary dialogue, and t5 is the case that proves it: "Oh I'll come. Sorry.
 * You don't need to get so upset I was asking if you wanted to go or not" — a man apologising to
 * his wife, containing the words "you don't need". Quoting is what separates them, and the mask has
 * to be taken across the WHOLE input, before it is cut into sentences, or that line splits into
 * three and the last fragment reads as an accusation.
 *
 * AND THE TRAIT ITSELF WAS MANGLED. The want was stored clipped to 200 characters, mid-word, ending
 * "regardless of context or situation and doesn't ev" — the sentence carrying the instruction, cut
 * in half, and that is what the narrator was handed every turn. Crystallising it pushed the whole
 * 200-character fragment onto the character card as a core trait. The player, seeing nothing
 * happen, wrote it again slightly differently; the engine stacked a second one, so the card carried
 * two clipped copies and the habit ladder counted expressions under two keys and found none.
 */
import { detectOOC, detectVoid } from "../src/engine/ooc";
import { labelFor, sameWant, findSameWant, newAuthored, crystallizedLabel } from "../src/engine/authored";
import { clipWords } from "../src/engine/coerce";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the four turns ────────────────────────────────────────────────────────── */
{
  const TURNS = [
    "So you're going to ignore the erotica part of the prompt? Neat. An ai that doesn't kisten",
    `I don't think you needed to take off her jeans. They aren't having sex. Unless you can't read or don't understand what "quickly" means and are about to devote 56 turns to this one scene`,
    "So you just made her not cum on his dick because you have no clue what that means listen dumbass. When a trans girl has a dick she can jerk it off.",
    "STOP BEING A FUCKING IDIOT AI",
  ];
  for (const t of TURNS) {
    const o = detectOOC(t);
    check(`caught: ${t.slice(0, 44)}`, !!o, t);
    check("...as a note and nothing else", o?.kind === "only", o);
    check("...so the turn is voided", detectVoid(t, o, false) === "ooc");
  }
}

/* ── 2. the seven turns of ordinary play in the same save ─────────────────────── */
{
  const PLAY = [
    `"I can help clean?"`,
    `I get to drying the dishes "hah yeah..."`,
    `"Oh boy. So we'll be having dinner out?"`,
    `"Why would I want that? Do you?"`,
    `"Oh I'll come. Sorry. You don't need to get so upset I was asking if you wanted to go or not"`,
    `"Ok sure I won't"`,
    `I stand still "go on love"`,
  ];
  for (const p of PLAY) check(`left alone: ${p.slice(0, 46)}`, detectOOC(p) === null, detectOOC(p));

  // the quote mask has to hold across sentences, which is the whole reason t5 survives
  const SPLIT = `"Oh I'll come. Sorry. You don't need to get so upset."`;
  check("a quoted line spanning three sentences stays one quoted line", detectOOC(SPLIT) === null);
  // Unquoted, the same words split: the complaint is lifted off and the action underneath still
  // plays. (Say mode never reaches this module at all — there the whole input is the spoken line.)
  const bare = detectOOC(`Oh I'll come. Sorry. You don't need to get so upset.`);
  check("...and the same words unquoted are read as a remark on an action", bare?.kind === "aside", bare);
  check("...with the action kept whole", bare?.inWorld === "Oh I'll come. Sorry.", bare);
}

/* ── 3. a complaint riding along with a real action still plays the action ─────── */
{
  const a = detectOOC(`I put the towel down and take her hand. Your pacing is killing me.`);
  check("an aside is still an aside", a?.kind === "aside", a);
  check("...and the action survives", /take her hand/.test(a?.inWorld ?? ""), a);
  check("...so the turn is not voided", detectVoid(`I put the towel down and take her hand. Your pacing is killing me.`, a, false) === null);

  const b = detectOOC(`So you're going to ignore this? Neat.`);
  check("a one-word leftover is not an action", b?.kind === "only", b);
}

/* ── 4. the want the player actually wrote ────────────────────────────────────── */
{
  const GOAL = "Without having sex, unzips her pants. And Vins and quickly (such that no one can see) cums on vins penis, forbidding him from cleaning it, she does it regardless of context or situation and doesn't ever explain why she wants it there.";
  const made = newAuthored(GOAL, 1, { stage: 5, inhabit_turns: 3 });
  check("the whole want survives", made.goal.length === GOAL.length, made.goal.length);
  check("...to the last word", made.goal.endsWith("why she wants it there."), made.goal.slice(-30));

  const LONG = "alpha beta gamma delta ".repeat(30) + "and the tail";
  check("a genuinely long one is still cut", newAuthored(LONG, 1).goal.length < LONG.length);
  const cut = newAuthored(LONG, 1).goal;
  check("...never through a word", LONG.startsWith(cut.slice(0, -1)) && /^\s|^$/.test(LONG.slice(cut.length - 1)), cut.slice(-24));
  check("...and says it was cut", newAuthored(LONG, 1).goal.endsWith("…"));

  check("clipWords leaves a short string alone", clipWords("Cannot pass a dog without stopping.", 100) === "Cannot pass a dog without stopping.");
  check("clipWords cuts on a space", clipWords("alpha beta gamma delta epsilon zeta", 20) === "alpha beta gamma\u2026", clipWords("alpha beta gamma delta epsilon zeta", 20));
}

/* ── 5. the label it gets filed under ─────────────────────────────────────────── */
{
  const GOAL = "Without having sex, unzips her pants. And Vins and quickly cums on vins penis, forbidding him from cleaning it, she does it regardless of context or situation.";
  const label = labelFor(GOAL);
  check("the label is a readable length", label.length <= 100, `${label.length}: ${label}`);
  check("...and ends on a whole word", !/\w…$/.test(label) && !/\s$/.test(label), label);
  check("...taken from the opening act", /^Without having sex, unzips her pants/.test(label), label);
  check("a short want is its own label", labelFor("Start leaving the porch light on all night.") === "leaving the porch light on all night");
  check("crystallizedLabel falls back to the goal", crystallizedLabel({ goal: "Cannot pass a dog without stopping." } as any) === "Cannot pass a dog without stopping");
}

/* ── 6. writing it again edits it ─────────────────────────────────────────────── */
{
  const A = "Without having sex, unzips her pants. And Vins and quickly (such that no one can see) cums on vins penis, forbidding him from cleaning it, she does it regardless of context or situation.";
  const B = "Always and without sex, unzips her pants. And Vins and quickly (such that no one can see) cums on vins penis, forbidding him from cleaning it, she does it regardless of context or situation.";
  check("the two the player actually typed are the same want", sameWant(A, B));
  check("...and it is found in the list", findSameWant([newAuthored(A, 1)], B) === 0);

  check("a different want on the same person is not", !sameWant(A, "Starts leaving the porch light on all night for him."));
  check("...nor two wants that merely share a subject", !sameWant(
    "Keeps asking Vin about the fellowship every single evening.",
    "Keeps Vin's coffee cup filled without being asked, every morning."));
  check("nothing to match against is not a match", findSameWant([], A) === -1 && findSameWant(undefined, A) === -1);
  check("a two-word want is too thin to dedupe on", !sameWant("hums constantly", "hums always"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
