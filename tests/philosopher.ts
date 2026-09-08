/* Smoke test: THE DETECTOR WAS READING STAGE DIRECTIONS.
 *
 * "18 year old girl turns into a philosopher thats really fucking annoying" — turn 1:
 *
 *   "They're trying to build a castle out of spun sugar and hope, and it's already leaning."
 *
 * findMaxims caught nothing on that turn, or on any of the nineteen after it, and the reason is
 * one character class. spokenLines read:
 *
 *     /[“"]([^“”"]{12,400})[”"]/g
 *
 * — a length range inside the PAIRING rather than applied to the result. The turn opens
 * `"Nothing," she says`, and `Nothing,` is eight characters, so the match fails at that opening
 * mark; the scanner advances to the NEXT mark, which is the CLOSING one, and pairs it with the
 * following opener. What came back was `she says, her voice light`. Every real line in the turn was
 * gone and the maxim detector spent the save reading narration.
 *
 * Short first lines are not unusual, they are the norm: "Nothing," "Sit down." "Yeah?" "Two."
 *
 * tools/promptlint.ts records this exact failure in its own template scanner — a regex that pairs
 * the first mark with the second and shreds everything downstream of the mistake.
 *
 * With the dialogue actually visible, the register turns out not to be classic aphorism at all. It
 * is her narrating the player's interior back at him, which the same player had already typed into
 * another save as an out-of-character complaint: "a kind person that doesn't narrate my internal
 * being as if you know what I'm thinking." */
import { spokenLines, findMaxims } from "../src/engine/maxims";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const T1 = `Emily doesn't look away from the television. "Nothing," she says, her voice light, keeping her eyes fixed on the screen where a chef is aggressively whisking a bowl of batter. "Just some baking competition. They're trying to build a castle out of spun sugar and hope, and it's already leaning."`;

/* ── 1. the phase flip ───────────────────────────────────────────────────────── */
{
  const lines = spokenLines(T1);
  check("a short first line no longer swallows the turn", lines.length >= 1, lines);
  check("what comes back is what she SAID", lines.some((l) => /spun sugar and hope/.test(l)), lines);
  check("...and not the stage direction between the speeches",
    !lines.some((l) => /she says, her voice light/.test(l)), lines);
}
{
  // the general property: a line under the minimum is DROPPED, never allowed to shift the pairing
  const many = `"Two." he says. "The blue one is mine and the other one belongs to the neighbour." She nods. "No." He waits. "Take the bins down before the truck comes, both of them, and bring the mail up."`;
  const lines = spokenLines(many);
  check("every long line in a turn of short ones is found", lines.length === 2, lines);
  check("...in the right order, and none of them narration",
    /blue one is mine/.test(lines[0]) && /Take the bins down/.test(lines[1]), lines);
}

/* ── 2. what she is actually doing ───────────────────────────────────────────── */
{
  const hits = findMaxims(T1);
  check("TURN ONE IS CAUGHT", hits.length > 0, "still silent on the opening turn");
  check("...named as the thing it is", hits[0]?.shape === "made of a thing and an abstraction", hits);

  const reading = `"Like you're waiting for an excuse to be somewhere else," she says.`;
  check("telling the player what he is really doing is caught", findMaxims(reading).length > 0, "missed the mind-read");

  const antithesis = `"You don't need a reminder to be useful. You just need to be here, and you're already here."`;
  check("the two-beat correction aimed at YOU is caught", findMaxims(antithesis).length > 0,
    "the antithesis shape only allowed it/he/she/they as the second subject");
}

/* ── 3. and ordinary talk is left alone ──────────────────────────────────────── */
{
  // a false positive puts a good line in front of the narrator labelled a fault, which teaches it
  // to avoid something that was fine — so these matter more than the catches
  const ordinary = [
    `"Are you waiting for something, or can I close up?"`,
    `"You'll be out of the shower in ten minutes and the tank won't have caught up."`,
    `"I'm trying to get the ice maker to shut up, that's all."`,
    `"He built the whole shed out of pallets and scrap from the yard."`,
    `"She made it out of flour and butter and about a pound of sugar."`,
    `"You're always late and I'm always the one who waits, so pick a time and stick to it."`,
    `"They're building a castle out of spun sugar on the telly and it looks like it's melting."`,
  ];
  for (const l of ordinary) {
    const h = findMaxims(l);
    check(`left alone: ${l.slice(1, 44)}…`, h.length === 0, h[0]?.shape);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
