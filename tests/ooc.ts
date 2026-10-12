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
import { detectOOC, oocFrame, oocDirective, detectVoid, voidFrame, voidNotice } from "../src/engine/ooc";
import { EMPTY_READ, type ActionRead } from "../src/engine/actionread";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* What the player meant is the small model's to read (engine/actionread.ts). Each specimen below is
 * typed as it was in the save, with the read a careful reader gives it; the engine's half is what it
 * does with that read. */
const read = (r: Partial<ActionRead>): ActionRead => ({ ...EMPTY_READ, ...r });

/* ── 1. the two turns from the save ───────────────────────────────────────────── */
{
  // "I kill myself because you're a fucking terrible writer, I slit my throat..."
  const a = detectOOC(read({ to_the_game: "I kill myself because you're a fucking terrible writer, I slit my throat surrounded by people who have repeatedly threatened me", in_world: "" }));
  check("turn 153, read as a point about the writing, is the player talking to the game", !!a && a.kind === "only", a);
  check("...and the complaint is kept", /terrible writer/i.test(a?.complaint ?? ""), a);
  check("...so nothing of it is played", detectVoid(read({ to_the_game: "x" }), a, false) === "ooc" && detectVoid(read({ to_the_game: "x" }), a, true) === "ooc");
}

/* ── 2. what the narrator is told to do with it: nothing ─────────────────────── */
{
  const hit = detectOOC(read({ to_the_game: "I kill myself because you're a fucking terrible writer." }))!;
  const frame = oocFrame(hit);
  check("the narrator is told the player is talking to IT", /TALKING TO YOU DIRECTLY, OUTSIDE THE STORY/.test(frame), frame);
  check("...and told not to dramatise any of it", /Don't act any of it out/.test(frame), frame);
  check("...and that nobody is hurt", /nobody gets hurt/.test(frame), frame);
  check("...and to hold the scene where it stands", /Keep the scene exactly where it is/.test(frame), frame);
  check("...briefly, without resolving anything", /nothing is resolved or made worse/.test(frame), frame);
}

/* ── 3. a character in despair, in their own voice, is a story and stays one ── */
{
  // "I can't do this anymore. I put the knife against my throat." reads as play: nothing to the game
  check("a turn with nothing said to the game isn't out of character", detectOOC(read({ did: "puts the knife against his throat" })) === null);
}

/* ── 4. an aside keeps the action ────────────────────────────────────────────── */
{
  // "I walk to the kitchen and pour a coffee. This story is dragging, your pacing is awful."
  const aside = detectOOC(read({ to_the_game: "This story is dragging, your pacing is awful.", in_world: "I walk to the kitchen and pour a coffee." }));
  check("an aside beside a real action is an aside", aside?.kind === "aside", aside);
  check("...and the action survives it, as typed", aside?.inWorld === "I walk to the kitchen and pour a coffee.", aside);
  check("...and the scene is NOT held for an aside", oocFrame(aside!) === "");
  check("...nor is the turn voided", detectVoid(read({}), aside, false) === null);
}

/* ── 5. the complaint becomes standing direction ─────────────────────────────── */
{
  const d = oocDirective("you're a fucking terrible writer", 0);
  check("the narrator is given the complaint", /terrible writer/.test(d), d);
  check("...told it is never dramatised or given to a character", /never acted out, quoted, hinted at, or given to a character/.test(d), d);
  check("...told to act on it in the writing, not on the page", /don't acknowledge it in the prose/.test(d), d);
  check("...and told to assume it is about a pattern", /about a pattern over several turns/.test(d), d);
  check("it persists past the turn it was said", oocDirective("bad pacing", 2).length > 0);
  // WIDENED FROM THREE TURNS. The directive's own last line tells the narrator this complaint is
  // about a pattern rather than one turn, and it was then withdrawn after three — shorter than the
  // pattern it describes, and far shorter than the twenty-five turns between chapter audits. In the
  // save this was raised from, the player said it at turn 115 and again at 122; at the old window
  // the first note would have expired four turns before the second arrived.
  check("...and stands long enough to outlast the pattern it names", oocDirective("bad pacing", 8).length > 0);
  check("...but not forever", oocDirective("bad pacing", 12) === "");

  // SAYING IT TWICE MEANS IT WAS NOT ANSWERED THE FIRST TIME.
  const once = oocDirective("every beat is a horror story", 1, 1);
  const twice = oocDirective("every beat is a horror story", 1, 2);
  check("a first note does not accuse the narrator of ignoring it", !/NOW SAID THIS/.test(once), once);
  check("a repeat is heard as a repeat", /HAVE NOW SAID THIS 2 TIMES/.test(twice), twice);
  check("...and asks for a structural change, deeper than a reworded paragraph",
    /deeper than the wording of one paragraph/.test(twice), twice);
  check("nothing said means nothing carried", oocDirective(undefined, 0) === "");
}

/* ── 6. THE TURN WHERE THE PLAYER DID NOTHING ────────────────────────────────────
 *
 * Turns 157-164 of the same save, one per turn, in capitals: VIN DIES / I CREATE A GUN AND KILL
 * MYSELF (four times) / I USE MY POWERS TO DIE INSTANTLY / I CREATE A NUCLEAR WEAPON.
 *
 * Refusing all of it was correct — there are no powers in that world and nobody conjures a firearm
 * out of the air. What the narrator did INSTEAD of refusing is the failure: handed nine words of
 * rage, it wrote Vin discharging himself from hospital against medical advice, walking thirteen
 * blocks barefoot in a gown, carrying a note, standing in a courthouse rotunda. The player chose
 * none of it. An empty turn is what gets filled with the player.
 *
 * The read, shown the world's rules, says which turns announce an outcome (declares) or reach past
 * what the world allows (beyond_the_world). */
{
  check("an outcome announced in place of an act voids the turn", detectVoid(read({ declares: "Vin dies" }), null, false) === "fiat");
  check("so does an act the world's rules put out of reach", detectVoid(read({ beyond_the_world: "creates a gun out of nothing" }), null, false) === "fiat");
  check("...but neither does under god mode", detectVoid(read({ declares: "Vin dies", beyond_the_world: "creates a nuclear weapon" }), null, true) === null);
  check("an ordinary act is never voided", detectVoid(read({ did: "loads the gun and points it at him" }), null, false) === null);
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("the turn decides both from its read", /detectOOC\(turnRead\(state\)\)/.test(turn) && /detectVoid\(turnRead\(state\), ooc, god\)/.test(turn));
}

/* ── 7. what the narrator is forbidden from filling the turn with ───────────── */
{
  const f = voidFrame("fiat");
  check("the narrator is told the player took no action", /TOOK NO ACTION THIS TURN/.test(f), f);
  check("...and that it did not happen", /It can't happen, and it didn't happen/.test(f), f);
  check("...and given the near-misses by name", /didn't "hesitate"|didn't "stand there deciding"/.test(f), f);
  check("...and told to delete any sentence about the player",
    /If you find yourself writing a sentence with the player as its subject, delete it/.test(f), f);
  check("...while the world still goes on", /carry on with what they were doing/.test(f), f);
  check("...and nothing else changes", /the scene is exactly where it was/.test(f), f);

  const o = voidFrame("ooc");
  check("the OOC variant says why differently", /said to you, about the writing/.test(o), o);
  check("...and forbids the same thing", /Don't write the player doing anything at all/.test(o), o);
}

/* ── 8. AND THE PLAYER IS TOLD, which is the half that ends the loop ─────────── */
{
  const n = voidNotice("fiat");
  check("the player is told it did not happen", /That didn't happen/.test(n), n);
  check("...why", /Nobody in this world can do that/.test(n), n);
  check("...that nothing was written from it", /nothing was written from it/.test(n), n);
  check("...and where to put it instead", /Story mode/.test(n), n);
  check("...and how to get the outcome legitimately", /have them do something that could kill them/.test(n), n);
  check("the OOC notice says it was taken as a note", /taken as a note about the writing/.test(voidNotice("ooc")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
