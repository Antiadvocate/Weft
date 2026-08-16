/* Smoke test: THE PLAYER'S HANDS ARE NOT THE WORLD'S TO WRITE.
 *
 * Rome, 41 AD, turn 43. The offstage pass reported:
 *
 *   "Titus, unable to leave the bicycle riddle alone, lays out the two iron rims A FOREIGN HAND
 *    SKETCHED FOR HIM and finds neither will true against the other — the axle-mounts he shaped
 *    this afternoon…"
 *
 * The player's last word on the subject was turn 10 — "I'll create the design for the bike" — and
 * he never did. No turn in the save contains him drawing anything. This pass invented the drawing,
 * then a day of forging out of it, and the applier filed the whole thing as a fact in Titus's
 * memory, where it has sat for thirty turns. The player's question was how a man he never gave a
 * design to came to have one built.
 *
 * The prompt's ONE RULE covers events that exist BECAUSE of the player. Nothing covered an event
 * that quietly writes the player's own hand into the past.
 */
import { playerAuthored, OFFSTAGE_SYSTEM } from "../src/engine/offstage";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the event that caused this, and its family ───────────────────────────── */
{
  const drop = [
    "Titus, unable to leave the bicycle riddle alone, lays out the two iron rims a foreign hand sketched for him and finds neither will true against the other",
    "Livia takes the drawing Marcus gave her to the workshop-master and asks what the solder would cost",
    "The crewman waits at the plank for the chart Marcus promised him",
    "Cloelius shows the stranger's design to a wheelwright in the Subura",
  ];
  for (const t of drop) check(`dropped: ${t.slice(0, 52)}`, playerAuthored(t, "Marcus"), t);
}

/* ── 2. and what it must not touch — the world doing its own business ────────── */
{
  const keep = [
    "Rufus finally reaches his own smithy after the walk up from the river, works the fire hot with the last of his charcoal, and lays out a clean sheet of papyrus and a stick of charred wood",
    "Claudia intercepts a household freedman of Claudius crossing from the Curia and presses into his hand a sealed tablet naming her husband",
    "Titus lies awake thinking about Marcus and whether the venture is worth staking the forge on",
    "Livia, having lost Marcus in the crowd, turns into the colonnade where her father's old patron keeps late hours",
    "The fuller Balbus sends word that he wants the wedding before the next market-day",
  ];
  for (const t of keep) check(`kept: ${t.slice(0, 52)}`, !playerAuthored(t, "Marcus"), t);
  // a player who never appears in the text is never the subject
  check("an event with nobody's name in it is fine", !playerAuthored("A boat comes in overdue and the factor refuses the price", "Marcus"));
}

/* ── 3. the prompt says it too, so the model mostly does not write them ──────── */
{
  check("the rule is stated", /THE PLAYER'S OWN HANDS ARE NOT YOURS/.test(OFFSTAGE_SYSTEM));
  check("...with the acts named", /not drawing, giving, showing, telling, teaching, promising, paying, agreeing, or arriving/.test(OFFSTAGE_SYSTEM));
  check("...and the worked example", /two iron rims that a foreign hand had sketched for him/.test(OFFSTAGE_SYSTEM));
  check("...and what to write instead", /A smith with no drawing is a smith waiting/.test(OFFSTAGE_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
