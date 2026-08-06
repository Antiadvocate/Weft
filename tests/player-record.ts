/* Smoke test: THE PLAYER'S DESCRIPTION OF THEIR OWN CHARACTER IS THEIRS.
 *
 * `background_addition` is glued onto the end of a character's record and stays for the rest of
 * the game, and the narrator reads the whole accumulated thing every turn as WHO THIS PERSON IS.
 * One save's player record began as two sentences the player typed about themselves:
 *
 *   "Rabi is from another land, he used to be an electrical engineer at a utility firm. He's adhd,
 *    very introspective, and intensely addicted to womens feet. Hes self deprecatory and socially
 *    awkward."
 *
 * Four chapter forks later it had grown four appended paragraphs, each restating the same three
 * facts with more contempt than the last — bored, self-loathing, casually lethal, incapable of
 * connecting without power or transaction, incapable of wanting anyone who isn't afraid of him, a
 * boredom curdled to rot, undone, wholly undone, still, still, still — and the final one had
 * switched to the second person to tell the player what three months had failed to cure in them.
 *
 * Every character in that world then met a man whose own card said he was a monster who could not
 * be loved, and behaved accordingly. The player spent a long time asking why nobody would warm to
 * him. */
import { appendBackground, MAX_BACKGROUND_ADDITIONS } from "../src/engine/continuity";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const OWN = "Rabi is from another land, he used to be an electrical engineer at a utility firm. He's adhd, very introspective, and intensely addicted to womens feet. Hes self deprecatory and socially awkward.";

/* 1. the four real additions, in the order they were appended */
{
  const a1 = "Rabi is now an isolated, near-omnipotent god-duke of Thornwood — bored, self-loathing, casually lethal, still ruled by his private hunger for women's bare feet and still incapable of connecting without power or transaction in the way.";
  const a2 = "Three months of unchecked godhood have only sharpened the emptiness — Rabi rules a fabricated city he regards as a terrarium, kills when the mood takes him, and remains a lonely, self-loathing man privately ruled by his hunger for women's bare feet and incapable of wanting anyone who isn't afraid of him.";
  const a3 = "Rabi is the near-omnipotent god-duke of Thornwood, three months deeper into a boredom that has curdled to rot — he still kills on a whim, still cannot want anyone who isn't afraid of him, and still, in private, is undone by the sight of a woman's bare feet.";
  const a4 = "Three months entombed as weeping stone did not kill you or cure you; you have surfaced again, still god, still bored to rot, still killing when the mood takes you, and still, in private, wholly undone by a woman's bare feet.";

  // every one of them is a diagnosis of the man rather than a record of the chapter, and each is
  // refused for its own reason: the vocabulary of a verdict, then restatement, then second person.
  const r1 = appendBackground(OWN, a1);
  check("a note that diagnoses instead of recording is refused", r1 === OWN, r1.slice(OWN.length));
  const r2 = appendBackground(r1, a2);
  check("and the second, which says it again", r2 === OWN, r2.slice(OWN.length));
  const r3 = appendBackground(r2, a3);
  check("and the third", r3 === OWN, r3.slice(OWN.length));
  const r4 = appendBackground(r3, a4);
  check("and the fourth, which had switched to the second person", r4 === OWN, r4.slice(OWN.length));

  check("the record is exactly what the player wrote", r4 === OWN);
  check("so it never becomes a rap sheet", r4.split("\n").length === 1, r4.split("\n").length);

  // the specific verdicts, each on its own
  check("'self-loathing' is a diagnosis", appendBackground("A duke.", "He is a self-loathing man.") === "A duke.");
  check("'incapable of' is a diagnosis", appendBackground("A duke.", "He is incapable of trusting anyone.") === "A duke.");
  check("'still killing, still alone' is a diagnosis", appendBackground("A duke.", "He is still killing, still alone.") === "A duke.");
  check("'undone by' is a diagnosis", appendBackground("A duke.", "He remains undone by the sight of her.") === "A duke.");
}

/* 2. second person is refused outright — a record describes a person, it does not address them */
{
  check("'you' is refused", appendBackground(OWN, "Three months did not kill you or cure you.") === OWN);
  check("'your' is refused", appendBackground(OWN, "Your city stands empty now.") === OWN);
  check("a word merely containing 'you' is fine",
    appendBackground("A smith.", "He took in a young apprentice over the winter.").includes("apprentice"));
}

/* 3. what a chapter note is FOR still gets through */
{
  const real = "He holds the Royal Charter for the Duchy of Thornwood and has built a city on the old town's footprint.";
  const out = appendBackground(OWN, real);
  check("an actual change of circumstance is recorded", out.includes("Royal Charter"), out.slice(-100));
  check("on its own line, under what the player wrote", out.split("\n")[0] === OWN, out.split("\n")[0].slice(0, 40));
  check("an empty addition changes nothing", appendBackground(OWN, "") === OWN);
  check("and so does a missing one", appendBackground(OWN, undefined) === OWN);
  check("a record that was empty to begin with just takes the note", appendBackground("", real) === real);
}

/* 4. notes do not pile up forever, and the player's own line is never what falls off */
{
  let rec = OWN;
  const notes = [
    "He holds the Royal Charter for the Duchy of Thornwood.",
    "A crusade of black banners has camped outside his walls since the spring.",
    "He crossed the western sea and emptied the Republic of Vismara in a single act.",
    "The King's castle at Thornhaven stands breached and unrepaired since he came through it.",
    "He spent the winter entombed beneath the estate as weeping stone.",
  ];
  for (const n of notes) rec = appendBackground(rec, n);
  const lines = rec.split("\n");
  check("the record is capped", lines.length === MAX_BACKGROUND_ADDITIONS + 1, lines.length);
  check("the player's own line is still line one", lines[0] === OWN, lines[0].slice(0, 40));
  check("the newest note is kept", rec.includes("weeping stone"));
  check("the oldest note is what fell off", !rec.includes("Royal Charter"), rec);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
