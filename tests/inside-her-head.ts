/* "CAN YOU IMAGINE A 19 YEAR OLD WHO GOES 'AGHAST. HE HATH NAMED THE LIE…'"
 *
 * Emily Clarke, nineteen, a theatre dresser, as the intent pass wrote her inner life:
 *
 *   "The accusation stings worse than Rabi ever could, leaving her sickeningly aware of how low
 *    she brought herself just to be discarded on the pavement."
 *   "He has named the lie out loud and called her an acquaintance in the same breath, and the
 *    worst part is he is right about both."
 *   "underneath the anger is a raw wish that he'll ask her in — not for the club, just to be
 *    somewhere warm for a minute."
 *
 * Nobody's mind runs in balanced clauses. What she actually thinks is that she wants him to take it
 * back in front of Ames, she is freezing, and she will walk if he sides with Rabi.
 *
 * TWO LINES OF THE PROMPT WERE TEACHING IT, and both were in the field's own spec.
 *
 *   "in words that could not describe a body" — an instruction to avoid concrete language, which
 *   leaves abstraction as the only thing available. A person's actual interior is full of concrete
 *   things: a name, a sum, a door, a sentence they want said.
 *
 *   And the single worked example the model was given for a truth: "the sting of what he said has
 *   not gone" — an abstraction handed a verb. One demonstration, 283 imitations.
 *
 * The mechanical half of the register is measurable and this file measures it: a truth field
 * reports one person's mind, so its subject should be that person. 42% of the ones written in play
 * open on something else instead. */
import { narratedFromOutside } from "../src/engine/intent";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

/* ── THE NARRATOR STANDING OUTSIDE HER, ALL VERBATIM FROM PLAY ─────────────────────────────── */
for (const t of [
  "The accusation of cowardice stings worse than the lost post, leaving her furious at herself.",
  "The bold parting invitation leaves her flustered and sharply drawn to him.",
  "Absolute bewilderment has blown through her caution, leaving her rattled.",
  "The laugh and the easy exit have taken the pressure off.",
  "The invitation lands harder than she wants it to.",
  "The money line and the beautiful-woman line are two different offers and she cannot take both.",
  "Startled and a little thrown by the compliment landing somewhere so odd.",
  "Relief that the room has absorbed the other man, accompanied by an urgent need to disappear.",
]) check(`outside her: ${t.slice(0, 52)}`, narratedFromOutside(t, "Emily Clarke"), t);

/* ── AND HER OWN MIND, ALSO VERBATIM ────────────────────────────────────────────────────────
 * These are the ones the same pass got right, and they are noticeably better without being
 * plainer in any way that costs. */
for (const t of [
  "He is glad the noisy lunatic took the machine away before it drew more eyes.",
  "She is relieved he did not press on who she is avoiding.",
  "He is utterly baffled to be called Emily and invited to dinner by a stranger.",
  "They want the door shut before anyone from the kitchen comes through it.",
  "Her whole plan was to get paid before Friday and this has ruined it.",
]) check(`inside them: ${t.slice(0, 52)}`, !narratedFromOutside(t, "Emily Clarke"), t);

check("the character's own name counts as the person",
  !narratedFromOutside("Emily wants him to say it in front of Ames.", "Emily Clarke"));
check("…and a different name does not", narratedFromOutside("Ames wants the door shut.", "Emily Clarke"));
check("no name given, a pronoun still counts", !narratedFromOutside("She is freezing and will not say so."));
check("an empty field is not a finding", !narratedFromOutside(""));

/* ── AND THE RULE IS ACTUALLY IN THE PROMPT ─────────────────────────────────────────────────
 * A measurement with no instruction behind it measures a thing nobody was asked to do. */
{
  const { INTENT_SYSTEM } = await import("../src/engine/intent");
  check("the subject rule is stated", /THE PERSON IS THE SUBJECT OF EVERY SENTENCE/.test(INTENT_SYSTEM));
  check("…and the same beat shown from inside her", /she wants to say yes and is frightened of what happens if she does/.test(INTENT_SYSTEM));
  /* AND NOT ONE FAILING LINE IS QUOTED IN ORDER TO FORBID IT. A first draft of this rule named
   * three, and tests/prompt-echo.ts caught it — quoting a bad line attached to a prohibition puts
   * the bad line in the context, which is the same mistake as naming the form outright. Every
   * example that survives here is one to copy. */
  for (const bad of ["The invitation lands harder", "the sting of it has not gone",
                     "underneath the anger is a raw wish", "the worst part is that he is right"])
    check(`no forbidden line is demonstrated: ${bad.slice(0, 34)}`, !INTENT_SYSTEM.includes(bad));
  check("the ban on concrete language is gone", !/in words that could not describe a body/.test(INTENT_SYSTEM));
  check("…and the example that taught the figure is gone",
    !/the sting of what he said has not gone/.test(INTENT_SYSTEM));
  check("the replacement example names a person and a thing owed",
    /still wants an apology for the thing he said about her sister/.test(INTENT_SYSTEM));
  check("plain words are asked for outright", /No figures of speech, no image standing in for a feeling/.test(INTENT_SYSTEM));
  check("…and the card's own words are named as the source", /use the words on that person's own card/.test(INTENT_SYSTEM));
  /* NAMING A FORM IN ORDER TO FORBID IT PUTS THE FORM IN THE CONTEXT — this engine keeps a detector
   * for that, and my first draft of this very rule tripped it by using the word outright. */
  check("and none of it names the form it is avoiding", !/\baphorism|\bmaxim|\bepigram/i.test(INTENT_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
