/* "SHE REPEATS MY EXACT WORDS SEVERAL TIMES."
 *
 * From the save that report came with, all of it Emily, all within fourteen turns:
 *
 *   "A date," she said, and the word came out soft, almost to herself.
 *   "Trust you," she said, and the word came out with a little breath behind it.
 *   "Fun," she said, as if you had handed her something to hold that she did not want.
 *   "The waiter," she said, and let the word drop.
 *   "Tell me about yourself, I'm Rabi. By the way," she repeated, not mocking.
 *
 * and one turn that produced four of them: "The Ritz," / "The hotel." / "Breakfast," /
 * "With you. At the Ritz."
 *
 * findEcho already hunts this and is floored at five words ON PURPOSE — "come here" and "I know"
 * coming back are ordinary speech, and flagging them would be worse than missing them. Every line
 * above is under that floor. Length was the wrong measure: what makes it a tic is that the line
 * OPENS on the player's phrase and then turns it over instead of saying anything.
 *
 * Measured across seven saves of two games, the player's own words open a short spoken line on
 * 48% to 75% of turns, at up to two a turn. So this counts rather than bans, the way the register
 * gauge and the template rate do. One is a person. The note fires at two. */
import { echoOpeners, openerFix } from "../src/engine/echo";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const SAID = `Trust me I have enough money to buy the ritz. A date. Tell me about yourself, I'm Rabi. By the way. This just made it not fun. The waiter keeps refusing money.`;

/* ── THE REAL LINES ─────────────────────────────────────────────────────────────────────────── */
{
  const prose = `"A date," she said, and the word came out soft.\n\n"Trust me," she said. "All right."\n\n"Fun," she said, as if you had handed her something.\n\n"The waiter," she said, and let the word drop.`;
  const o = echoOpeners(prose, SAID);
  check("all four openers are found", o.length === 4, o);
  check("…including the one-word ones findEcho's floor is above", o.some((l) => /^Fun/.test(l)), o);
}
check("a verbatim long one counts too",
  echoOpeners(`"Tell me about yourself, I'm Rabi. By the way," she repeated.`, SAID).length === 1);

/* ── AND WHAT IS LEFT ALONE ─────────────────────────────────────────────────────────────────
 * A character starting on their own words is the whole point, and a long reply that happens to
 * begin on a shared word is a reply, not a tic. */
for (const line of [
  `"I work in a theatre. The dresser's room smells of sweat and greasepaint."`,
  `"You'd better have something better than that, and I'd like to hear it before the coffee comes."`,
  `"Come on, then. Before I turn sensible."`,
  `"I'm Emily. Emily Clarke."`,
]) check(`left alone: ${line.slice(0, 46)}`, echoOpeners(line, SAID).length === 0, echoOpeners(line, SAID));
check("a long line that opens on a shared word is a reply",
  echoOpeners(`"A date is a thing people do on Sundays, and my aunt would have opinions about all of it."`, SAID).length === 0);
check("nothing said, nothing to echo", echoOpeners(`"A date," she said.`, "").length === 0);
check("a two-word player line is too little to match on", echoOpeners(`"Yes," she said.`, "Yes ok").length === 0);

/* ── ONE IS A PERSON, TWO IS A HABIT ────────────────────────────────────────────────────────── */
{
  check("a single repeat says nothing", openerFix(echoOpeners(`"A date," she said.`, SAID)) === "");
  check("nothing at all says nothing", openerFix([]) === "" && openerFix(null) === "");
  const note = openerFix(echoOpeners(`"A date," she said.\n\n"Fun," she said.\n\n"The waiter," she said.`, SAID));
  check("three fires the note", note.length > 0);
  check("…and it counts them, so the note is about the rate", /3 SPOKEN LINES/.test(note), note.slice(0, 90));
  check("…quotes them back", /"A date,"/.test(note));
  check("…still allows one, for a person who would", /may repeat a phrase once/.test(note));
  check("…and says where taking the meaning should show instead", /show it in what they DO with it/.test(note));
  check("a pile-up does not become a wall of text",
    (openerFix(Array.from({ length: 12 }, (_, i) => `line ${i}`)).match(/"/g) ?? []).length <= 8);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
