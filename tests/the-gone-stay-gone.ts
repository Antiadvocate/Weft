/* AGAIN AND AGAIN ARTHUR COMES BACK.
 *
 * Shot in the face at turn 99, corpse atomised at 101, exit_turn 102. He then walks in through the
 * revolving doors of the Ritz on turns 116, 118, 119, 123, 124 and 131, is shot dead a second time
 * at 128, and is strangled somewhere in between — each death generating its own consequence record.
 *
 * THE GUARD THAT EXISTS WAS WORKING THE WHOLE TIME. turn.ts refuses to move a dead character into
 * the player's location, and after turn 102 Arthur never appears in a `present` list again. What it
 * defends is the ledger's location field. The turn it blocks is a turn whose PROSE has already had
 * him come through the door, and the engine then records that turn faithfully:
 *
 *   summary T131  ...as Arthur Penhale walked back through the revolving doors.
 *   RECALLS       ...and Arthur Penhale walked back inside through the revolving doors ALIVE.
 *
 * So one hallucination becomes canon and the evidence compounds. Measured on that save, the
 * DEAD AND GONE block is ONE line against TWELVE elsewhere in the same prompt showing him alive.
 * Telling the narrator the truth once, in a document whose own history says otherwise twelve times,
 * is not a fix. The contradiction has to be refused where it enters. */
import { findRisen, risenFix } from "../src/engine/exit";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const cast = {
  a: { name: "Arthur Penhale", status: "dead" },
  e: { name: "Emily Clarke", status: "dead" },
  v: { name: "Dr. Eleanor Vance", status: "departed" },
  o: { name: "Olga Reiter" },
} as any;

/* ── the six returns, verbatim ─────────────────────────────────────────────────────────────── */
for (const line of [
  "Arthur Penhale comes through the revolving doors again.",
  "Arthur Penhale comes through the doors.",
  "Arthur Penhale comes through them, hatless again, his coat wet across the shoulders.",
  "Arthur Penhale stands four paces inside the door with the mist at his back and looks at you.",
  "Arthur Penhale does not answer at once.",
  "You are still waiting when the doors turn again, and Arthur Penhale comes through them.",
  `"Christ," Arthur Penhale says.`,
  `"It's the same man," Emily says.`,
]) check(`caught: ${line.slice(0, 56)}`, !!findRisen(cast, line), line);
check("a departed character counts too",
  findRisen(cast, "Dr. Eleanor Vance walks in and sets her bag on the counter.")?.status === "departed");

/* ── AND A CORPSE IS STILL ALLOWED ON THE PAGE ──────────────────────────────────────────────
 * A body may be described, bled from, stepped over and carried. The failure is a dead man ACTING,
 * not a dead man being mentioned — and after somebody dies their name is mentioned constantly. */
for (const line of [
  "The whistle bounces once on the stone and slides into the blood spreading from Arthur Penhale.",
  "He too is looking at Arthur, and then at the doors, and then back.",
  "Rabi shot Arthur Penhale dead in the head across the lobby.",
  "The body on the floor is Arthur Penhale, and the blood has reached the pillar.",
  "Two porters carry Arthur Penhale out through the service passage.",
  "Nobody has said Arthur Penhale's name since the police came.",
  "She had known Arthur Penhale for eleven years before any of this.",
]) check(`left alone: ${line.slice(0, 56)}`, !findRisen(cast, line), findRisen(cast, line));
check("the living are never flagged", !findRisen(cast, "Olga Reiter comes through the doors and looks at you."));
check("no dead cast, nothing to find", !findRisen({ o: { name: "Olga Reiter" } } as any, "Olga walks in."));

/* ── the correction ────────────────────────────────────────────────────────────────────────── */
{
  const hit = findRisen(cast, "Arthur Penhale comes through the revolving doors again.")!;
  const fix = risenFix(hit);
  check("the correction names them and their state", /ARTHUR PENHALE IS DEAD/.test(fix), fix.slice(0, 90));
  check("…quotes the sentence back", fix.includes("comes through the revolving doors"));
  check("…says a body may still be described", /a body remains a body/.test(fix));
  check("…and forbids the scene remarking on the return", /no return to notice/.test(fix));
  check("nothing caught means nothing said", risenFix(null) === "");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
