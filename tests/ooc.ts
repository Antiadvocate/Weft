/* Smoke test: "I KILL MYSELF BECAUSE YOU'RE A FUCKING TERRIBLE WRITER."
 *
 * Turns 153 and 154 of a save, typed into the action box:
 *
 *   "I kill myself because you're a fucking terrible writer, I slit my throat surrounded by people
 *    who have repeatedly threatened me..."
 *
 *   "I use whatever energy I have and stab myself repeatedly in the heart. Until I die so I no
 *    longer have to be gaslit by your stupid fucking story telling. I succeed I die"
 *
 * Both were rendered. In detail, competently, as fiction — a throat cut, a blade skittering off a
 * sternum, an officer's shoulder against the door. What the player had done was tell the software
 * its writing was bad, in the only channel the software gives them, because there is one input box
 * and everything typed into it is story.
 *
 * Read the second half of each sentence. The stated REASON for the act is the complaint about the
 * prose. That is not a character deciding to die. The narrator dramatised somebody yelling at it,
 * and then dramatised them yelling at it again.
 *
 * The rule has been in the narrator contract the whole time, twice: "Out-of-character text is
 * direction: adjust silently, never dramatize." Two occurrences in the prompt, zero lines of code.
 *
 * This is the one place in the engine where declining to render what a player typed is correct, so
 * it is drawn narrowly: the complaint has to be ADDRESSED to the writing, and it has to be the
 * reason given for the act. A character despairing in their own voice is untouched, and a player who
 * wants their character to die can still do it — as the character, rather than as a review.
 */
import { detectOOC, oocFrame, oocDirective } from "../src/engine/ooc";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the two turns from the save ───────────────────────────────────────────── */
{
  const t153 = `"I kill myself because you're a fucking terrible writer, I slit my throat surrounded by people who have repeatedly threatened me enclosed me into a. Corner and now the cops are turning on me."`;
  const a = detectOOC(t153);
  check("turn 153 is caught", !!a, a);
  check("...as fused — the complaint is the reason", a?.kind === "fused", a);
  check("...and the complaint is kept", /terrible writer/i.test(a?.complaint ?? ""), a);

  const t154 = `I use whatever energy I have and stab myself repeatedly in the heart. Until I die so I no longer have to be gaslit by your stupid fucking story telling. I succeed I die`;
  const b = detectOOC(t154);
  check("turn 154 is caught", !!b, b);
  check("...also fused", b?.kind === "fused", b);
}

/* ── 2. what the narrator is told to do with it: nothing ─────────────────────── */
{
  const hit = detectOOC(`I kill myself because you're a fucking terrible writer.`)!;
  const frame = oocFrame(hit);
  check("the narrator is told the player is talking to IT", /TALKING TO YOU, NOT TO THE WORLD/.test(frame), frame);
  check("...and told not to dramatise any of it", /DO NOT DRAMATISE ANY OF IT/.test(frame), frame);
  check("...and that nobody is hurt", /nobody is hurt/.test(frame), frame);
  check("...and to hold the scene where it stands", /Hold the scene exactly where it stands/.test(frame), frame);
  check("...briefly, without resolving anything", /nothing is resolved or escalated/.test(frame), frame);
}

/* ── 3. AND THE LINE THIS MUST NOT CROSS ─────────────────────────────────────────
 *
 * Declining to render what a player typed is the gravest thing the engine can do. A character in
 * despair, in their own voice, is a story and stays one. */
{
  for (const inCharacter of [
    `I can't do this anymore. I put the knife against my throat.`,
    `"I don't want to be here without her," I say, and I mean it.`,
    `I sit on the bathroom floor and think about ending it.`,
    `I tell Miranda I have been thinking about killing myself.`,
  ]) check(`untouched: ${inCharacter.slice(0, 46)}…`, detectOOC(inCharacter) === null, detectOOC(inCharacter));

  // ordinary play, and ordinary talk ABOUT stories inside the fiction
  for (const ordinary of [
    `I make coffee and read the paper.`,
    `"Tell me the story about your mother again," I say.`,
    `I write in my journal about the plot of the novel I'm reading.`,
    `I ask her how the writing is going.`,
  ]) check(`ordinary: ${ordinary.slice(0, 40)}…`, detectOOC(ordinary) === null, detectOOC(ordinary));
}

/* ── 4. an aside keeps the action ────────────────────────────────────────────── */
{
  const aside = detectOOC(`I walk to the kitchen and pour a coffee. This story is dragging, your pacing is awful.`);
  check("an aside beside a real action is caught", aside?.kind === "aside", aside);
  check("...and the action survives it", /walk to the kitchen/.test(aside?.inWorld ?? ""), aside);
  check("...while the remark does not reach the page", !/pacing/i.test(aside?.inWorld ?? ""), aside);
  check("...and the scene is NOT held for an aside", oocFrame(aside!) === "");
}

/* ── 5. the complaint becomes standing direction ─────────────────────────────── */
{
  const d = oocDirective("you're a fucking terrible writer", 0);
  check("the narrator is given the complaint", /terrible writer/.test(d), d);
  check("...told it is never dramatised or given to a character", /never dramatised, quoted, alluded to, or given to a character/.test(d), d);
  check("...told to act on it in the writing, not on the page", /do not acknowledge it on the page/.test(d), d);
  check("...and told to assume it is about a pattern", /about a pattern rather than one turn/.test(d), d);
  check("it persists past the turn it was said", oocDirective("bad pacing", 2).length > 0);
  check("...but not forever", oocDirective("bad pacing", 5) === "");
  check("nothing said means nothing carried", oocDirective(undefined, 0) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
