/* Smoke test: A WANT THAT GOES THROUGH SOMEONE IS STILL A WANT.
 *
 * Two saves, pulling in opposite directions, and both of them right.
 *
 * The first: a woman present in twenty-four consecutive scenes, recorded as wanting to "Get Max
 * Mercer to hand over the rent money to her bank account and look at her body". Ten intents were
 * authored for her and every surface was a variant of reclining, every truth a sentence about what
 * HE did. The fix was a word list, isDependentGoal, that threw out every goal shaped like "get X to
 * do Y", and the forge was kept from ever seeing the player, so a want about him was unwriteable.
 *
 * The second, Kingdom of Veythar, turn 35: a woman whose card says she found out the king's secret
 * and means to use it to get his power, fear of him 88, given the want "sleep beside King Aldric
 * without angering him", and printed to the narrator as "waiting until they're safe from the
 * player". The player's report: she has control over me and wants my power, and instead of going
 * after it she asks for cookies and narrates. So does everyone who isn't me.
 *
 * Both failures are the same failure: a character with nothing to DO about their want. The first
 * one's want was waiting dressed as a goal; the cure banned the want instead of the waiting, and
 * produced the second. What's pinned here is the line between them:
 *
 *   1. the forge sees the player as one of the people in a life, and sees the long-run aim;
 *   2. the forge is told that getting something out of someone is a want and waiting on them isn't;
 *   3. somebody the player sent away still gets a want that leaves him alone;
 *   4. fear changes how a person goes after a want, never whether. */
import { brief, DRIVE_SYSTEM } from "../src/engine/driveforge";
import { fearBlock, fearLine } from "../src/engine/fear";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function court(): SaveState {
  const s = newSave("court", { name: "The Kingdom", era: "medieval" } as any);
  s.world.places["loc_hall"] = { id: "loc_hall", name: "The Great Hall", description_facts: "Stone.", contains: [] } as any;
  s.world.player_location = "loc_hall";
  registerCharacter(s, { name: "Aldric", character_id: "char_player", pronouns: "he/him", location: "loc_hall" } as any);
  registerCharacter(s, {
    name: "Marguerite Vale", character_id: "char_mv", pronouns: "she/her", age: 31, location: "loc_hall",
    background: "A seamstress from the slums who overheard the king's one weakness in the palace gardens.",
    current_goal: "Use what she knows about the king to win a seat on the royal council",
  } as any);
  s.characters["char_mv"].drive = { goal: "Sleep somewhere warm tonight", progress: 0, priority: 1, updated_turn: 1 } as any;
  s.world.edges.push({ from: "char_mv", to: "char_player", warmth: 30, trust: -10, power: 20, fear: 88, roles: ["subject"] } as any);
  s.world.present = ["char_mv"];
  return s;
}

/* ── 1. what the forge sees ───────────────────────────────────────────────────── */
{
  const s = court();
  const b = brief(s, "char_mv");
  check("the long-run aim is on the page", b.includes("WHAT THEY'RE AFTER IN THE LONG RUN: Use what she knows about the king"), b);
  check("so is the want she's been on, so the next one can be measured against it", b.includes("THE WANT THEY'VE BEEN ON: Sleep somewhere warm tonight"), b);
  check("the player is one of the people in her life", b.includes("ALDRIC, THE STORY'S MAIN CHARACTER, IS ALSO IN THEIR LIFE"), b);
  check("with how afraid of him she is", b.includes("afraid of Aldric, 88 out of 100"), b);
  check("and what he is to her", b.includes("Aldric is their subject") || b.includes("subject"), b);
}

/* ── 2. what the forge is told ────────────────────────────────────────────────── */
{
  check("getting something out of someone is a want", DRIVE_SYSTEM.includes("Getting something out of someone is a want"));
  check("including from the story's main character", DRIVE_SYSTEM.includes("the story's main character"));
  check("and the want is what they do to get it", DRIVE_SYSTEM.includes("the want is what they do to get it"));
  check("waiting on someone is still no want at all", DRIVE_SYSTEM.includes("Presenting yourself and waiting is the same as having no want"));
  check("the long-run aim sizes the want", DRIVE_SYSTEM.includes("the want is the next stretch of it"));
}

/* ── 3. somebody he sent away still leaves him alone ──────────────────────────── */
{
  const s = court();
  (s.world.edges.find((e) => e.from === "char_mv" && e.to === "char_player") as any).rejected = 1;
  const sent = brief(s, "char_mv");
  check("a person he sent away is never offered him as a way in", !sent.includes("IS ALSO IN THEIR LIFE"), sent);
  check("and the forge is told to write about their own life", sent.includes("about their own life"), sent);
  const h = court();
  (h.characters["char_mv"] as any).held = true;
  check("nor is a person being held", !brief(h, "char_mv").includes("IS ALSO IN THEIR LIFE"));
}

/* ── 4. fear changes the method, never the want ───────────────────────────────── */
{
  const s = court();
  const block = fearBlock(s, "char_mv");
  check("she is afraid for her life", block.startsWith("AFRAID OF ALDRIC FOR THEIR LIFE"), block);
  check("her wants no longer wait until she's safe", !block.includes("wait until they're safe"), block);
  check("what she wants still drives her", block.includes("What they want still drives them"), block);
  check("and fear decides how she goes after it", block.includes("fear changes how they go after it"), block);
  const line = fearLine(s, "char_mv");
  check("the intent pass is told the same", line.includes("still go after what they want, carefully"), line);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
