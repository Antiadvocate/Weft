/* Smoke test: THE CHANNEL THAT SAYS THIS HAPPENS, AND THEN HEDGES THREE TIMES.
 *
 * The player, after a long argument about why the thing he wrote his world to run on never
 * occurred: "The problem is literally that anything I type in the next thing in the world NEEDS to
 * happen."
 *
 * Weft has a channel for exactly that, and here is what it said, in full, against the channel next
 * to it:
 *
 *   think  PRIVATE INTERIOR — the player's unspoken thought, sensed by NO ONE… The player did NOT
 *          say or do this. No character can hear it, react to it, or know it, and that holds for
 *          everyone present and for every kind of intuition. Do NOT have anyone respond to it…
 *
 *   story  The player narrates what happens next (treat as authorial intent, weave it in, keep the
 *          world's logic): …
 *
 * Sixty words of law for the channel about a thing that does NOT happen. Seventeen words with three
 * escape hatches for the channel whose whole purpose is that it DOES — "authorial INTENT" makes it
 * a wish, "WEAVE IT IN" invites blending, and "KEEP THE WORLD'S LOGIC" hands the model a reason to
 * decline. Nothing else in the narrator contract mentions the channel at all.
 *
 * A model that will not write a declared event almost never refuses it. It postpones (a phone, a
 * knock, somebody in the doorway), it attenuates ("almost", "started to", "was about to"), or it
 * substitutes something milder in the same room. All three read as cooperation, which is why the
 * frame names them and why the detector below looks for them in the committed prose.
 */
import { storyFrame, findDeclaredMiss, declaredFix, declaredCoverage, declaredTokens, DECLARED_FLOOR } from "../src/engine/declared";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. THE FRAME IS A LAW NOW ───────────────────────────────────────────────── */
{
  const f = storyFrame("Abigail takes the laptop off him and puts it on the high shelf.");
  check("the player's text is in it", f.includes("puts it on the high shelf"));
  check("it states the event as fact", /THAT HAPPENED/.test(f), f.slice(0, 200));
  check("the heading is not itself written as an epigram", !/WORLD, NOT ACTING/.test(f));

  /* The three hedges that were in the old frame, and are the reason it did not hold. */
  check("no 'authorial intent'", !/authorial intent/i.test(f));
  check("no 'weave it in'", !/weave it in/i.test(f));
  check("world logic is scoped to consequence rather than to permission",
    /WHERE THE WORLD'S LOGIC STILL RULES: what it cost/.test(f), f);

  /* The three declines, named, because this engine has learned that a rule naming a specific move
   * beats a rule describing a quality. */
  check("postponement is named", /No phone, no knock/.test(f));
  check("attenuation is named", /almost.*nearly.*started to/is.test(f));
  check("substitution is named", /Nothing milder happens instead/.test(f));

  /* And the part that is still the narrator's. A law that took consequence away too would make the
   * world a typewriter. */
  check("consequence is handed back, explicitly", /Consequence is yours, and it should be unsparing/.test(f));
}

/* ── 2. CONTENT WORDS ARE WHAT HAS TO REACH THE PAGE ─────────────────────────── */
{
  check("the scaffolding is dropped",
    !declaredTokens("she takes it from him and puts it on the shelf").includes("from"));
  check("...and the substance is kept",
    declaredTokens("she takes the laptop and puts it on the shelf").includes("laptop"));
}

/* ── 3. A DECLARATION THAT LANDED IS LEFT ALONE ──────────────────────────────── */
{
  const d = "Abigail takes the laptop off him and puts it on the high shelf in the hall.";
  const landed = "Abigail took the laptop out of his hands before he had closed it, walked it into the hall, and set it on the high shelf above the coat hooks. She did not look back at him.";
  check("coverage is high when it happened", declaredCoverage(d, landed) >= DECLARED_FLOOR, declaredCoverage(d, landed));
  check("nothing is flagged", findDeclaredMiss(d, landed) === null, findDeclaredMiss(d, landed));

  /* A heavy paraphrase is still the event. A false accusation next turn is worse than a missed one,
   * so the floor is deliberately low. */
  const paraphrased = "The laptop went out of his hands and onto the shelf in the hall, too high for him without the stool.";
  check("a paraphrase is not an accusation", findDeclaredMiss(d, paraphrased) === null, declaredCoverage(d, paraphrased));
}

/* ── 4. THE THREE DECLINES ───────────────────────────────────────────────────── */
{
  const d = "Abigail takes the laptop off him and puts it on the high shelf in the hall.";

  const hedged = "Abigail almost took the laptop off him. Her hand started to close on the lid, and for a moment it seemed she would carry it out to the high shelf in the hall.";
  const h = findDeclaredMiss(d, hedged);
  check("the act rendered as an approach to itself is caught", h?.how === "hedged", h);

  const interrupted = "Abigail reached for the laptop and the phone went off on the nightstand, loud in the heat, and she stopped with her hand out.";
  const i = findDeclaredMiss(d, interrupted);
  check("something arriving to stop it is caught", i?.how === "interrupted", i);

  const absent = "The fan turned in the window. He kept reading. Outside, a car door shut and the street went back to itself.";
  const a = findDeclaredMiss(d, absent);
  check("the event simply not being there is caught", a?.how === "absent", a);
}

/* ── 5. ...AND THE PLAYER'S OWN INTERRUPTION IS NOT ONE ──────────────────────── */
{
  /* "If the player wrote an interruption, that is the only interruption there is." The detector
   * must not flag a phone the player themselves put in the sentence. */
  const d = "Abigail takes the laptop off him and the phone goes off in her hand.";
  const prose = "Abigail took the laptop off him, and the phone went off in her hand before she had it closed.";
  check("a declared interruption is the event, not a decline", findDeclaredMiss(d, prose) === null, findDeclaredMiss(d, prose));
}

/* ── 6. AND NOTHING IS CLAIMED ABOUT A DECLARATION TOO SHORT TO CHECK ────────── */
{
  check("two content words is not enough to accuse anybody",
    findDeclaredMiss("she leaves", "He read until the light went.") === null);
  check("nor is an empty one", findDeclaredMiss("", "anything") === null);
}

/* ── 7. THE CORRECTION SAYS WHICH OF THE THREE IT WAS ────────────────────────── */
{
  for (const [how, want] of [["hedged", "approach to itself"], ["interrupted", "the player wrote no interruption"], ["absent", "not on the page"]] as const) {
    const fix = declaredFix({ declaration: "she takes the laptop", coverage: 0.1, how });
    check(`the ${how} correction names the move`, fix.includes(want), fix);
    check(`...and demands it this turn`, /THIS TURN opens with that event having happened/.test(fix));
  }
  check("no miss, no correction", declaredFix(null) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
