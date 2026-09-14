/* SHE LEFT THREE TIMES AND NEVER LEFT.
 *
 * Constance Wexford, on the terrace, over seventeen turns:
 *
 *   T13  "If you do not want me here, Rabi, you need only tell me to leave. I will not come back
 *         a thirteenth time."
 *   T15  "I will leave the grounds now. I won't come back."  …she turned, her movements precise,
 *         and began the long walk back toward the front of the club.
 *   T16  Constance stood by the stone edge, her back to the water.  …took a half-turn toward the
 *         club, and began to walk.
 *
 * She is in `present` on all of them, alive, exit_turn unset, standing in the player's location at
 * the end of the save. On the turn she went, the bookkeeper recorded that she tensed up, cooled,
 * trusted him less and was holding on too tight, and then gave her a new want — "distance myself
 * from Rabi's influence". It read the feeling and missed the fact. Because she stays in `present`,
 * the next turn's directive puts her in the room, so the narrator writes her in the room, so she
 * leaves again.
 *
 * departureEvidence already guards this ground and only ever answers "the bookkeeper says they
 * went — did they?". Nothing asked the opposite question. This is that question, and it is strict
 * on purpose: a missed departure costs one turn of writing somebody who has gone, and a false one
 * deletes a person out of a conversation.
 *
 * SIX PASSES OF TUNING, AND THE BUG THAT SETTLED THE DESIGN: LEAVES contains the word `leaves`, so
 * "the smell of wet leaves rises from the pavement" is a departure, and the distance-based
 * ownership test found a name within its window and walked that man off into the foliage. Distance
 * was the wrong question. Whose sentence it is, is the right one. */
import { findDeparted, subjectIsTheirs, nameProbes } from "../src/engine/exit";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const CAST = ["Constance Wexford"];

/* ── THE REAL TURN ──────────────────────────────────────────────────────────────────────────── */
{
  const t15 = `Constance went perfectly still. The wind stirred the loose strands of hair at her temples.\n\n"I have no answer for that, Rabi," she said. She did not look at you again. "I will leave the grounds now. I won't come back."\n\nShe turned, her movements precise, and began the long walk back toward the front of the club, her pace steady and even, not once looking back at the water.`;
  const d = findDeparted(t15, CAST);
  check("the departure is seen", d.length === 1 && d[0].name === "Constance Wexford", d);
  check("…and the evidence is the sentence she goes in", /began the long walk/.test(d[0]?.line ?? ""), d[0]);
}
check("the unhurried kind counts — LEAVES only knew decisive exits",
  findDeparted(`She adjusted the strap of her bag, took a half-turn toward the club, and began to walk.`, CAST).length === 1);
check("so does the decisive kind", findDeparted(`Constance walked out without another word.`, CAST).length === 1);

/* ── AUTUMN ─────────────────────────────────────────────────────────────────────────────────── */
check("wet leaves on a pavement are not a woman leaving",
  findDeparted(`Constance and Arthur stood together by the rail. Behind them, the drizzle thickens for a moment, and the smell of wet leaves rises from the pavement.`,
    ["Constance Wexford", "Arthur Penhale"]).length === 0);

/* ── AND EVERY OTHER WAY IT COULD DELETE SOMEBODY ───────────────────────────────────────────── */
check("the prose gets the last word when it says they stayed",
  findDeparted(`Constance did not move. She would not leave, and she began the long walk to nowhere in her head.`, CAST).length === 0);
check("somebody who speaks after going has not gone",
  findDeparted(`She turned and began the long walk to the door.\n\n"One more thing," she said.`, CAST).length === 0);
check("a departure in the middle of a turn is crossing a room",
  findDeparted(`Constance walked out toward the hall. She came back a moment later with the ledger. The fire settled in the grate and nobody said anything for a while.`, CAST).length === 0);
/* THE GROUNDSMAN'S WHEELBARROW. He is in the scene and not in the cast list, so `others` cannot
 * see him — which is exactly when the sentence-subject test has to carry it alone. */
check("an unrostered bystander's motion is not hers",
  findDeparted(`Constance stood by the stone edge. The groundsman watched her pass, then looked toward you, his rake still held in both hands. He shifted his weight, and began to walk it slowly toward the service yard.`, CAST).length === 0);
check("nobody present, nothing to find", findDeparted(`Somebody left.`, []).length === 0);
check("empty prose is not a departure", findDeparted("", CAST).length === 0);

/* ── WHOSE SENTENCE IT IS ───────────────────────────────────────────────────────────────────── */
{
  const p = nameProbes("Constance Wexford");
  check("her name in the sentence settles it", subjectIsTheirs("Constance began the long walk.", p, 10));
  check("a pronoun carries from her own previous sentence",
    subjectIsTheirs("She did not look at you again. She began the long walk.", p, 32));
  check("…but not across somebody else taking the floor",
    !subjectIsTheirs("The groundsman watched her pass. He began to walk.", p, 33));
  check("a sentence about the weather is nobody's",
    !subjectIsTheirs("Behind them, the smell of wet leaves rises from the pavement.", p, 30));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
