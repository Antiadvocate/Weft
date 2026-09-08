/* Smoke test: THE TURN THE PLAYER STOPPED BEING "YOU".
 *
 * A save switched narrator model halfway and nothing else changed. Counted across its prose,
 * third-person references to the player run 0 or 1 a turn for fifteen turns, then jump to fifteen:
 *
 *   T15  "...your palm moves. Her shoulders drop, the tension of her posture breaking..."
 *   T16  "Her eyes stay on HIM... presses the length of her against HIS hand"
 *   T17  "MAX'S HAND kept its slow rhythm..."   — and past tense arrives with it
 *
 * The player went from the person in the room to a man described from across it. The owner's
 * report was that the character "instantly became a caricature of a human", which is what anybody
 * looks like once you are watching them instead of standing in front of them.
 *
 * THE CAUSE WAS IN THE PROMPT. The narrator document carried "the narration never addresses the
 * reader as 'you'", written against breaking frame and reading as a ban on the second person —
 * which is the mode this entire engine narrates in, and which its own bookkeeper prompt states
 * outright. The weaker model had been ignoring it. The stronger one obeyed. A better model made
 * the output worse because the instruction was wrong, and following it faithfully is the failure.
 *
 * The rule is fixed. This catches the next one, from any model. */
import { povDrift } from "../src/engine/integrity";
import { NARRATOR_SYSTEM } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** Verbatim from the save, either side of the switch. */
const BEFORE = `Emily's breath hitches, a sharp, sudden intake of air that vanishes into a low, hummed laugh as your palm moves. Her shoulders drop, the tension of her posture breaking into something looser, heavier against the cushions. She doesn't pull away; she arches her hips once, a deliberate, slow-motion shift that keeps the pressure of your palm locked against the heat of her. "Praying?" Her voice is a shade lower, the edges of it soft and unhurried as she looks down at the hand moving against her.`;
const AFTER = `She doesn't laugh. Her eyes stay on him, bright and steady, and the corner of her mouth ticks up just enough to show she caught the joke and is choosing not to hand it back. Her hips shift under his palm, a small roll that presses the length of her against his hand again, and one of her feet slides up from the floor to rest along the outside of his thigh, bare toes curling against the fabric of his shorts. "You think I'd eat your head off?" Her voice is light, almost sweet. "I'm not the one who gets mean when he's hungry, Max."`;

/* ── 1. the two sides of the seam ────────────────────────────────────────────── */
{
  check("second-person prose is left alone", povDrift(BEFORE, "Max", "he/him", ["she/her"]) === null);
  const d = povDrift(AFTER, "Max", "he/him", ["she/her"]);
  check("THE TURN IT FLIPPED IS CAUGHT", !!d, "missed the flip");
  check("...and it says how badly", (d?.third ?? 0) >= 3 && d?.second === 0, d);
}

/* ── 2. dialogue is not evidence ─────────────────────────────────────────────── */
{
  // people say each other's names out loud constantly; a line is not a point of view
  const spoken = `"Max, you're doing it again," she says. "Max. Listen to me, Max." You put the cup down and look at her, and she waits with her hand flat on the table between you, not saying anything else for a while.`;
  check("a name said out loud three times is not POV drift", povDrift(spoken, "Max", "he/him", ["she/her"]) === null, "counted dialogue");
}

/* ── 3. pronouns are only evidence when they can belong to nobody else ───────── */
{
  const twoMen = `Liam leans on the bar and wipes the same spot twice. His jaw is tight. He does not look up when the door goes, and his hands keep moving over the wood, and his shoulders stay exactly where they were before the noise.`;
  check("with another man in the room, his/him proves nothing",
    povDrift(twoMen, "Max", "he/him", ["he/him", "she/her"]) === null, "attributed an ambiguous pronoun");
  check("...and with nobody sharing them it counts",
    povDrift(twoMen, "Max", "he/him", ["she/her"]) !== null, "should have counted");
}

/* ── 4. it does not read a mode off a fragment ───────────────────────────────── */
{
  check("a one-line turn is not judged", povDrift("His hand. His face. He waits.", "Max", "he/him", ["she/her"]) === null);
}

/* ── 5. the prompt no longer bans the mode the engine narrates in ────────────── */
{
  check("the contradicting rule is gone", !/narration never addresses the reader as/.test(NARRATOR_SYSTEM),
    "the ban on second person is still in the narrator prompt");
  check("...and the second person is stated as the mode", /THE PLAYER IS "YOU"/.test(NARRATOR_SYSTEM));
  check("...with what was actually meant kept", /turning to the AUDIENCE|dear reader/i.test(NARRATOR_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
