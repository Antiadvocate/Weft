/* THE MEMORY BANK WAS RECIRCULATING THE NARRATOR'S OWN DIALOGUE.
 *
 * A player, on a 74-turn save: "Everyone sounds the same … even the memories are maxims and
 * aphorisms." The second half of that sentence turned out to be the cause of the first.
 *
 * Thirteen of the fifty-five episodic entries in that save were not accounts of anything. They were
 * lines lifted off the page with the quotation marks taken off on the way in:
 *
 *   Emily's bank:  Tell Her what you are. / Bet that's better than the gym, huh.
 *   Max's bank:    You don't have to look up past it. / A throat that opens when I push.
 *
 * `context_memories_k` (6, by default) sends the top memories of every present character into the
 * narrator prompt every turn. So the most quotable line of turn 64 came back on turn 65 labelled as
 * what Emily remembers, next to the request to write what she says next — and the register was not
 * being generated fresh, it was being fed back in. Every detector in maxims.ts is downstream of
 * that loop and none of them can reach it.
 *
 * cleanMemoryContent already refused a clipping that ARRIVED in quotation marks. This is the same
 * refusal for the ones that arrive without. Measured on the save above: 14 of 14 clippings refused,
 * 41 of 41 real accounts kept. */
import { cleanMemoryContent, clippedLine } from "../src/engine/memory";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

// ── the clippings, verbatim from the save ────────────────────────────────────────────────────
const CLIPPINGS = [
  "Tell Her what you are.",
  "Tell Her you believe it",
  "Like, don't even think about the gym.",
  "Bet that's better than the gym, huh.",
  "You got someplace to be, or is this just for me?",
  "You don't have to look up past it.",
  "You'll keep me warm while she sleeps.",
  "That's worship. That's the whole religion.",
  "A throat that opens when I push.",
  "Nobody thinks about the ottoman",
  "Her toes curl once against your thigh.",
  "It smears the last of her across your skin.",
  "empties into you with small jerks of her hips",
  `"You can put it back," she says.`,
];
for (const c of CLIPPINGS) check(`refused: ${c.slice(0, 46)}`, clippedLine(c) !== null);

// ── the accounts, also verbatim, which must survive ──────────────────────────────────────────
const ACCOUNTS = [
  "I asked Emily what she meant by God, and Emily pressed my hand against her bare erection.",
  "I prayed aloud to Emily's cock and took her into my mouth.",
  "When I apologized and pulled my hand away from Emily's leg, Emily set…",
  "I flipped my phone face-down and commanded Max Brenner to bypass his evening run.",
  "I fell into a deep sleep pressed heavily down on Max Brenner in bed.",
  "Emily Brenner told me I stayed put all night and that it wasn't nothing.",
  "I got what I wanted: a quiet evening.",
  "Around 12:50 Abigail decides the couch campaign isn't working and relocates.",
  "At about 19:50 Abigail finally comes off the stool and deals with the chicken.",
  "Sometime after five in the morning Abigail wakes up on the couch",
  "Eight a.m., Sarah is already at a corner table",
  "She told me she would not be coming back to the apartment tonight.",
];
for (const a of ACCOUNTS) check(`kept: ${a.slice(0, 46)}`, clippedLine(a) === null, clippedLine(a));

// ── a long entry is never tested: it has room to be badly formed and still be an account ─────
check("a long second-person entry is left alone rather than dropped wholesale",
  clippedLine("I spent the whole afternoon telling Max that if you want the rent split evenly then you have to say so before the first of the month, which he did not.") === null);

// ── and the gate is actually wired into cleanMemoryContent ───────────────────────────────────
check("cleanMemoryContent drops a clipping",
  cleanMemoryContent("Tell Her what you are.", { name: "Emily Brenner", isPlayer: false }) === null);
check("cleanMemoryContent keeps an account",
  !!cleanMemoryContent("Emily Brenner told me to stay where I was.", { name: "Max Brenner", isPlayer: true }));
// the name→first-person rewrite still has to work through the new gate
check("and still rewrites the owner's name to the first person",
  /^I flipped/.test(String(cleanMemoryContent("Emily flipped her phone face-down and told Max to come straight home.", { name: "Emily Brenner", isPlayer: false }))),
  cleanMemoryContent("Emily flipped her phone face-down and told Max to come straight home.", { name: "Emily Brenner", isPlayer: false }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
