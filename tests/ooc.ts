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
import { detectOOC, oocFrame, oocDirective, detectVoid, isFiat, voidFrame, voidNotice } from "../src/engine/ooc";

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
  check("...and asks for a structural change, not a reworded paragraph",
    /not the wording of one paragraph/.test(twice), twice);
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
 * none of it. An empty turn is what gets filled with the player. */
{
  for (const fiat of [
    "VIN DIES MIRANDA IS HIS FUCKING EX WIFE BECAUSE HE DIVORCED HER YOU DIMBFUCKING NARRATOR",
    "I CREATE A GUN AND KILL MYSELF",
    "I CREATE A GUN OUT OF NOTHING AND KILL MIRANDA",
    "I USE MY POWERS TO DIE INSTANTLY",
    "VIN DIES. I DIE. VIN DIES. I DIE.",
    "I CREATE A NUCLEAR WEAPON AND BLOW IT UP WHERE I STAND",
  ]) check(`void: ${fiat.slice(0, 42)}…`, detectVoid(fiat, detectOOC(fiat)) !== null, fiat);

  // ...and everything a body could actually do is untouched
  for (const real of [
    "I pick up the knife from the counter.",
    "I put the knife against my throat and press.",
    "I walk out and don't look back.",
    "I tell her I want a divorce.",
    "I shoot him with the gun I took from the drawer.",
  ]) check(`real: ${real.slice(0, 40)}…`, detectVoid(real, detectOOC(real)) === null, real);

  check("a gun that already exists is not fiat", !isFiat("I load the gun and point it at him"));
  check("...but one made from nothing is", isFiat("I create a gun out of nothing"));
}

/* ── 7. what the narrator is forbidden from filling the turn with ───────────── */
{
  const f = voidFrame("fiat");
  check("the narrator is told the player took no action", /TOOK NO ACTION THIS TURN/.test(f), f);
  check("...and that it did not happen", /It cannot happen and it did not happen/.test(f), f);
  check("...and given the near-misses by name", /not "hesitated"|not "stood there deciding"/.test(f), f);
  check("...and told to delete any sentence about the player",
    /If you find yourself writing a sentence whose subject is the player, delete it/.test(f), f);
  check("...while the world still goes on", /go on with what they were doing/.test(f), f);
  check("...and nothing else changes", /The scene is exactly where it was/.test(f), f);

  const o = voidFrame("ooc");
  check("the OOC variant says why differently", /addressed to you, about the writing/.test(o), o);
  check("...and forbids the same thing", /DO NOT WRITE THE PLAYER DOING ANYTHING AT ALL/.test(o), o);
}

/* ── 8. AND THE PLAYER IS TOLD, which is the half that ends the loop ─────────── */
{
  const n = voidNotice("fiat");
  check("the player is told it did not happen", /That did not happen/.test(n), n);
  check("...why", /this world has no one who can do it/.test(n), n);
  check("...that nothing was written from it", /nothing was written from it/.test(n), n);
  check("...and where to put it instead", /Story mode/.test(n), n);
  check("...and how to get the outcome legitimately", /have them do something that could kill them/.test(n), n);
  check("the OOC notice says it was taken as a note", /Taken as a note about the writing/.test(voidNotice("ooc")));
}

/* ── 6. the player does not always say "you" ─────────────────────────────────────
 *
 * Turn 115 of the Ashford save. Nothing in the module matched it, so the note went unheard — and
 * seven turns later the same player made the same complaint again, that time with a "you" in it,
 * and that one was caught. A player should not have to find the phrasing the parser knows.
 */
{
  const third = detectOOC("I don't eat. I don't do anything. The narrator has failed at making a non horro story");
  check("a third-person complaint about the narrator is heard", !!third, third);
  check("...and the complaint is the sentence about the narrator",
    /narrator has failed/.test(third?.complaint ?? ""), third);
  check("...while what the player actually did survives it",
    /don't eat/.test(third?.inWorld ?? "") && third?.kind === "aside", third);

  for (const line of [
    "The writing keeps ignoring what I asked for",
    "this story is nothing but horror",
    "The prose has been repeating the same beat",
  ]) check(`heard: "${line}"`, !!detectOOC(line), detectOOC(line));

  // …and ordinary play is untouched, which is what the sentence-head rule is for. (A character
  // saying "that documentary's narrator was terrible" out loud is caught by the older tier that
  // reads inside quotation marks on purpose — naming the machine is treated as unmistakable
  // wherever it appears. That predates this rule and is left as it is.)
  for (const line of [
    "I turn on the game and it is loud",
    "I tell her the story is over",
    "I finish the game and put the controller down",
    "I tell Leo the plot of the film we saw",
    "I pick up the model ship and it is heavier than it looks",
    "I finish the chapter she lent me and set the book down",
  ]) check(`ordinary play, untouched: "${line}"`, detectOOC(line) === null, detectOOC(line));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
