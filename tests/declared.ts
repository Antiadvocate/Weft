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
import { storyFrame, findDeclaredMiss, declaredFix, declaredCoverage, declaredTokens, DECLARED_FLOOR,
  mandatesFor, unmetMandates, forcedRetryNote, appendToLastUser } from "../src/engine/declared";

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

/* ── 8. WHAT A TURN WAS ORDERED TO CONTAIN ───────────────────────────────────────
 *
 * Two things can be mandatory: a declaration typed on the story channel, and a becoming on the last
 * turn of its clock. Both are the player's own hand. */
{
  const st = { becomings: [
    { claim: "The lift has stopped running.", remaining: 1 },
    { claim: "The rent has gone up again.", remaining: 3 },
    { claim: "The roof has been condemned.", remaining: 1, arrived_turn: 4 },
    { claim: "The yard has been fenced off.", remaining: 1, paused: true },
  ] };
  const m = mandatesFor(st, "story", "Abigail takes the laptop off him.", null);
  check("the declaration is a mandate", m.some((x) => x.kind === "declaration"));
  check("a becoming on its last turn is a mandate", m.some((x) => x.claim.includes("lift")));
  check("one with turns left is not", !m.some((x) => x.claim.includes("rent")));
  check("nor is one that already arrived", !m.some((x) => x.claim.includes("roof")));
  check("nor is one the player is holding", !m.some((x) => x.claim.includes("yard")));

  check("a do-mode turn declares nothing",
    !mandatesFor(st, "do", "I go to the kitchen", null).some((x) => x.kind === "declaration"));
  check("nor does a voided one",
    !mandatesFor(st, "story", "STOP BEING A FUCKING IDIOT AI", "ooc").some((x) => x.kind === "declaration"));
  check("an ordinary turn carries no mandate at all", mandatesFor({ becomings: [] }, "do", "I wait", null).length === 0);
}

/* ── 9. AND WHICH OF THEM THE DRAFT DID NOT CARRY ────────────────────────────── */
{
  const mandates = [
    { kind: "declaration" as const, claim: "Abigail takes the laptop off him and puts it on the high shelf." },
    { kind: "becoming" as const, claim: "The basement laundry has been padlocked by the management company." },
  ];
  const half = "Abigail took the laptop out of his hands and set it on the high shelf in the hall. He did not get up.";
  const unmet = unmetMandates(mandates, half);
  check("the one that landed is not reported", !unmet.some((u) => u.mandate.kind === "declaration"), unmet);
  check("the one that did not is", unmet.some((u) => u.mandate.kind === "becoming"), unmet);

  const both = "A padlock had gone on the basement laundry overnight, the management company's notice taped beside it. Abigail took the laptop off him and set it on the high shelf.";
  check("a draft carrying both reports nothing", unmetMandates(mandates, both).length === 0, unmetMandates(mandates, both));
}

/* ── 10. THE RETRY NOTE NAMES WHOSE ORDER IT WAS AND HOW IT WAS DODGED ───────── */
{
  const note = forcedRetryNote([
    { mandate: { kind: "declaration", claim: "she takes the laptop" }, miss: { declaration: "x", coverage: 0.1, how: "hedged" } },
    { mandate: { kind: "becoming", claim: "the lift has stopped" }, miss: { declaration: "y", coverage: 0, how: "absent" } },
  ]);
  check("it says the draft came back without it", note.includes("CAME BACK WITHOUT WHAT IT WAS FOR"));
  check("a declaration is named as the player's own hand", note.includes("The player wrote this into the world themselves"));
  check("a becoming is named as the clock's last turn", note.includes("this is the last turn of it"));
  check("the hedge is named", note.includes("approach to itself"));
  check("the absence is named", note.includes("does not contain it in any form"));
  check("and the three declines are closed off", /nothing arrives to interrupt it.*nobody almost does it.*nothing milder/is.test(note), note);
  check("the rest of the turn is left alone", note.includes("Everything else about the turn is yours"));
  check("no miss, no note", forcedRetryNote([]) === "");
}

/* ── 11. THE NOTE REACHES THE PROMPT ON EVERY PROVIDER ───────────────────────────
 *
 * buildMessages sends a string for most providers and a block array for anthropic/*, so the stable
 * half can carry a cache breakpoint. Both retry paths in turn.ts guarded with `typeof last.content
 * === "string"` and therefore appended NOTHING on an Anthropic narrator: the retry went out
 * identical to the draft that had just failed, which is a call spent on a coin flip. */
{
  const plain = appendToLastUser([{ role: "system", content: "S" }, { role: "user", content: "U" }], "NOTE");
  check("a string user turn is appended to", plain[1].content === "UNOTE", plain);

  const blocks = appendToLastUser(
    [{ role: "system", content: [{ type: "text", text: "S" }] },
     { role: "user", content: [{ type: "text", text: "stable" }, { type: "text", text: "volatile" }] }], "NOTE");
  check("a block-array user turn is appended to", blocks[1].content.length === 3, blocks[1].content);
  check("...as a text block at the end", blocks[1].content[2].text === "NOTE");
  check("...leaving the cached blocks untouched", blocks[1].content[0].text === "stable");

  /* Chatlog mode ends on a user turn after a run of assistant turns; the note belongs on that one. */
  const chat = appendToLastUser(
    [{ role: "system", content: "S" }, { role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "u2" }], "NOTE");
  check("the LAST user turn gets it", chat[3].content === "u2NOTE");
  check("...and an earlier one does not", chat[1].content === "u1");

  check("no note, no change", appendToLastUser([{ role: "user", content: "U" }], "")[0].content === "U");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
