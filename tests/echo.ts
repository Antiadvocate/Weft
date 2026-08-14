/* Smoke test: THE PLAYER'S OWN LINE, HANDED BACK.
 *
 * A player: "I really really hate them saying 'say it again' in general — even in the old save it's
 * non stop. One time she had me say something three times." And the other half of it: characters
 * repeating the player's words back at them verbatim, which they described as "bar none meaningless,
 * and no one does this in real life".
 *
 * There was a rule against both. It worked by listing the four wordings the failure had shown up in,
 * which put four ready-made lines in the context — the exact failure tests/prompt-echo.ts exists to
 * catch. Removing the list was right, and the rule got weaker, because a general statement does not
 * fire on a specific move the way a quoted example does.
 *
 * So the specimen moves to where it is safe: a detector on the OUTPUT. The prompt carries no example
 * in advance; when the narrator does it, the next turn is shown the sentence it wrote. Same
 * mechanism as engine/maxims.ts, and the only place a banned line can be quoted without supplying
 * it, because by then it has already been written.
 */
import { findEcho, echoFix, longestEchoRun } from "../src/engine/echo";
import { narratorSystem } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const said = (s: string) => `She set the cup down. "${s}" The fire went on burning.`;

/* ── 1. the demand, in every wording it has been played in ───────────────────── */
{
  for (const line of [
    "Say it again.",
    "Say that again.",
    "Tell me again.",
    "I want to hear you say it.",
    "Say it one more time.",
    "Say that louder.",
    "Repeat that.",
    "Again.",
  ]) check(`caught: "${line}"`, findEcho(said(line), "")?.kind === "demand", findEcho(said(line), ""));
}

/* ── 2. and the parrot ───────────────────────────────────────────────────────── */
{
  const player = "I came up from Bovillae to buy the grey mare before the market closes";
  const parrot = said("You came up from Bovillae to buy the grey mare, did you.");
  check("a character quoting the player back is caught", findEcho(parrot, player)?.kind === "parrot", findEcho(parrot, player));
  check("the run has to be long enough to be a quotation", longestEchoRun(player, "You came up from Bovillae to buy the grey mare") >= 4);
}

/* ── 3. WHAT IT MUST NOT TOUCH. Ordinary conversation reuses words ───────────── */
{
  const player = "I came up from Bovillae to buy the grey mare before the market closes";
  const FINE = [
    "The mare's lame. You'll want the bay.",                       // same subject, own words
    "Market's shut. You're a day late and the man's gone to Rome.",
    "Bovillae. Long walk in this heat.",                            // one word back is not a quotation
    "Two sestertii for the room, four with supper.",
    "Grey? I've a grey. She kicks.",
  ];
  for (const line of FINE) check(`left alone: ${line.slice(0, 44)}`, findEcho(said(line), player) === null, findEcho(said(line), player));

  check("no player speech, no parrot check", findEcho(said("You came up from Bovillae to buy the grey mare"), "") === null);
  check("narration restating the action is a different rule and not policed here",
    findEcho("He came up from Bovillae to buy the grey mare before the market closed.", player) === null);
}

/* ── 4. the correction quotes what was written, and says what to do instead ──── */
{
  const d = echoFix({ line: "Say it again.", kind: "demand" });
  check("the demand correction quotes the line", /Say it again/.test(d), d);
  check("...and rules out every wording rather than the four listed", /in any wording/.test(d));
  check("...and says what evidence a line landed actually looks like", /what the listener DOES next/.test(d));
  check("...including what a genuine mishearing does", /acts on the half they did catch/.test(d));

  const p = echoFix({ line: "You came up from Bovillae, did you.", kind: "parrot" });
  check("the parrot correction quotes the line", /Bovillae/.test(p));
  check("...and names why it wastes the turn", /a line in which nothing happened/.test(p));

  check("nothing caught, nothing said", echoFix(null) === "" && echoFix(undefined) === "");
}

/* ── 5. and the prompt still carries no ready-made example of any of it ──────── */
{
  const P = narratorSystem(false) + narratorSystem(true);
  for (const spec of ["say it again", "say that again", "tell me again", "I want to hear you say it"]) {
    check(`not supplied in advance: "${spec}"`, !new RegExp(spec, "i").test(P));
  }
  check("but the rule is still stated", /WHAT THE PLAYER TYPED IS SPENT/.test(P));
}


/* ── 6. model working that is not the story ──────────────────────────────────── */
{
  const { stripScaffolding } = await import("../src/engine/echo");
  const prose = "The yard was empty. She was already at the gate with the mare.";

  check("a thinking block goes", stripScaffolding(`<thinking>I should open on the yard and keep it short.</thinking>\n\n${prose}`) === prose);
  check("an unclosed one goes too", stripScaffolding(`${prose}\n<thinking>Now I need to set up the debt`) === prose);
  check("a markdown header goes", stripScaffolding(`## The Opening Scene\n\n${prose}`) === prose);
  check("a preamble goes", stripScaffolding(`Here's the opening scene, keeping it to four paragraphs.\n\n${prose}`) === prose);
  check("a trailing note goes", stripScaffolding(`${prose}\n\nNote: I left the debt unmentioned so it can surface later.`) === prose);

  // AND WHAT IT MUST NOT TOUCH
  check("clean prose is returned unchanged", stripScaffolding(prose) === prose);
  const dialogue = `"I'll think about it," she said. "Here's the thing. You're late."`;
  check("prose that merely starts like a preamble survives", stripScaffolding(dialogue) === dialogue);
  const short = "She left.";
  check("stripping never empties the scene", stripScaffolding(`## Scene\n\n${short}`).includes("She left"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
