/* Smoke test: THE PLAYER'S INTERIOR IS NOT THE NARRATOR'S TO WRITE.
 *
 * Turn 3 of a four-turn save. The player typed:
 *
 *   I snap my fingers and the vat is drained. And her skin is now clear.
 *   I look at her. "Michelle. You know why I want a date"
 *
 * and got back, in Michelle's mouth, as flat assertion:
 *
 *   "You want a date because you're lonely and I'm the only person in Thornwood who still calls
 *    you an idiot to your face. And because you've been standing on that terrace of yours thinking
 *    about what you should have done a year ago, and you've decided to do it now."
 *   "Say the rest of it. The part you didn't come here to say."
 *
 * and from the camera:
 *
 *   "…not frightened, not grateful, just a woman doing arithmetic on a sum she hadn't expected to see."
 *   "She was looking at him the way she'd looked at him when they were younger and he'd said
 *    something true by accident — wary and open at the same time, fighting neither."
 *
 * The player: "How the fuck would I make this assumption? Is this my interior mind?"
 *
 * The scrub that keeps the narrator from copying its own worst sentence had rules for every one of
 * these families — and a contraction ("the way she'D looked") and a reordering ("not X, not Y,
 * just Z") were enough to walk through it. */
import { scrubForReplay } from "../src/engine/turn";
import { narratorSystem } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const gone = (s: string) => !scrubForReplay(s).includes(s.trim().slice(0, 40));

/* 1. the exact sentences from the save */
{
  check("reaching into a shared past to explain a look",
    gone("She was looking at him the way she'd looked at him when they were younger and he'd said something true by accident — wary and open at the same time, fighting neither."));
  check("ruling out readings to install one",
    gone("She was still looking at him, and the private smile had gone somewhere — not frightened, not grateful, just a woman doing arithmetic on a sum she hadn't expected to see."));
  check("asserting how two people always are",
    gone("Her voice was dry but the warmth was under it, the way it always was with him."));
  check("the something-quieter dodge, which was already caught",
    gone("She looked at him then, and the smile was still there but something quieter had settled behind it."));
}

/* 2. the holes that let two of them through */
{
  check("a contraction no longer defeats 'the way she looked'",
    gone("He watched the way she'd handled the rope."));
  check("nor an auxiliary", gone("She saw the way he had looked at the door."));
  check("the bare form is still caught", gone("He noticed the way she watched the road."));
  check("'just a woman doing X' on its own", gone("She stood there, just a woman working out what it cost her."));
}

/* 3. the accounting metaphor, which a player reports as constant */
{
  check("doing arithmetic", gone("He could see her doing the arithmetic behind her eyes."));
  check("a sum she hadn't expected", gone("It was a sum she had not expected to be handed."));
  check("the ledger of something", gone("She was reading the ledger of everything he had not done."));
  check("numbers that don't add up", gone("She read it back and the numbers did not add up."));
  // the world has real ledgers and real tallies, and those are not metaphors
  const literal = "She took her tally stick down to the granary and counted the winter reserve against the ledger.";
  check("a real ledger survives", scrubForReplay(literal).includes("tally stick"), scrubForReplay(literal));
  const literal2 = "The grain ledger was short by four bushels and she wrote the figure down.";
  check("and a real shortfall survives", scrubForReplay(literal2).includes("four bushels"), scrubForReplay(literal2));
}

/* 4. plain physical prose is never touched */
{
  for (const s of [
    "He found her in the yard behind the vats, barefoot on the wet flagstones, her arms blue to the elbow.",
    "The vat was empty before the snap finished ringing off the rafters.",
    '"The vat," she said. "And my skin. That\'s two." A beat. "You could have just worked the tap."',
    "She folded the rag once, set it down.",
  ]) check(`untouched: ${s.slice(0, 46)}…`, scrubForReplay(s).trim() === s.trim(), scrubForReplay(s));
}

/* 5. and the contracts forbid it happening in the first place — the scrub only stops the ECHO */
{
  for (const [label, P] of [["full", narratorSystem(false)], ["lean", narratorSystem(true)]] as [string, string][]) {
    check(`${label}: the player's interior is declared theirs`, /THE PLAYER'S INTERIOR BELONGS TO THE PLAYER/.test(P));
    check(`${label}: the lonely line is quoted as forbidden`, /you want a date because you're lonely/i.test(P));
    check(`${label}: the terrace line too`, /thinking about what you should have done a year ago/i.test(P));
    check(`${label}: a guess must read as a guess`, /guess is visibly a guess|visibly guessing/i.test(P));
    check(`${label}: the unnamed demand is banned`, /NOBODY DEMANDS A THING THEY WILL NOT NAME/.test(P));
    check(`${label}: with the exact line`, /the part you didn't come here to say/i.test(P));
    check(`${label}: the accounting metaphor is named`, /sums, ledgers, arithmetic, numbers adding up/i.test(P));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
