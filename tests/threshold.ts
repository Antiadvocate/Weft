/* Smoke test: "HE'D COME IN FROM THE PORCH AT SOME POINT."
 *
 * Turn 106 of a save. The player is at his mother's house. A man he has never met:
 *
 *     Marcus was in the front room. He'd come in from the porch at some point, and he was standing
 *     now with one hand on the back of the sofa, not quite sitting.
 *
 * No knock, no door, no admission, no turn in which it happened — a stranger placed inside a private
 * residence retroactively, in a subordinate clause. Two turns later the player was pulling a shotgun
 * out from under a bed, and two turns after that there were police in the front room, in a story
 * whose genre is "Love, erotica, romantic" and whose forbidden-as-primary list opens with "Physical
 * violence or threats of it".
 *
 * AND THE ENGINE HAS AN ARRIVAL GUARD, WHICH PASSED IT. Its evidence test is whether the name
 * appears in the PROSE. That defends against the bookkeeper inventing an arrival the story never
 * had; it cannot defend against anything the NARRATOR invents, because there the prose is the
 * evidence. A guard whose only witness is the accused.
 *
 * The narrator knew, too, which is the part worth recording. Five turns later it wrote a police
 * officer asking Marcus: "And you walked inside the residence." … "Did the homeowner invite you in?"
 * — and Marcus looks at the floor and does not answer. It audited its own plot hole, correctly, and
 * shipped the audit as a scene.
 */
import { findIntrusion, thresholdFix, thresholdLaw, isPrivateInterior } from "../src/engine/threshold";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const world = (place: string): SaveState => ({
  world: { player_location: "loc_h", places: { loc_h: { name: place } }, present: [] },
  characters: { char_player: { name: "Vin" }, char_m: { name: "Marcus" }, char_mir: { name: "Miranda" } },
} as unknown as SaveState);

/* ── 1. which places need letting into ────────────────────────────────────────── */
{
  check("a family home is private", isPrivateInterior("Vin's family home"));
  check("a loft is private", isPrivateInterior("Vin and Miranda's Loft"));
  check("an apartment is private", isPrivateInterior("Chloe's Apartment"));
  check("a coffee shop is not", !isPrivateInterior("The Daily Grind"));
  check("nor an inn", !isPrivateInterior("The Gilded Lily"));
  check("nor a street", !isPrivateInterior("Riverside Park"));
  check("nor a courthouse", !isPrivateInterior("The Ashford County Courthouse"));
}

/* ── 2. the sentence from the save ───────────────────────────────────────────── */
{
  const prose = `Miranda went still.\n\nMarcus was in the front room. He'd come in from the porch at some point, and he was standing now with one hand on the back of the sofa, not quite sitting.\n\n"You good?"`;
  const hit = findIntrusion(world("Vin's family home"), prose, new Set(["char_mir"]));
  check("a man discovered in the front room is caught", hit?.name === "Marcus", hit);
  check("...and the actual sentence is kept, to quote back", /at some point/.test(hit?.line ?? ""), hit);

  const fix = thresholdFix(hit);
  check("the next turn is told, quoting the line itself", fix.includes(hit!.line), fix);
  check("...that getting in is an event on the page", /happens where the reader can see it/.test(fix), fix);
  check("...and told the past tense is the tell", /past tense or in a subordinate clause/.test(fix), fix);
  check("...and given what to do with him now", /whoever lives there gets to ask how they got in/.test(fix), fix);
}

/* ── 3. and everything that is NOT this ──────────────────────────────────────── */
{
  const home = world("Vin's family home");
  check("somebody who knocked is fine", findIntrusion(home,
    `A knock at the screen door. Marcus stood on the porch with the rain behind him, and Vin let him in.`, new Set()) === null);
  check("somebody let in is fine", findIntrusion(home,
    `Vin opened the door for Marcus. Marcus stood in the front room, dripping.`, new Set()) === null);
  check("somebody already in the scene is fine", findIntrusion(home,
    `Marcus was in the front room, one hand on the sofa.`, new Set(["char_m"])) === null);
  check("being TALKED about is not being present", findIntrusion(home,
    `"Marcus drove three hours to get here," she said. "He's still on the road."`, new Set()) === null);
  check("a public place is nobody's threshold", findIntrusion(world("The Daily Grind"),
    `Marcus was at the corner table when they came in.`, new Set()) === null);
  check("an ordinary scene raises nothing", findIntrusion(home,
    `Vin poured the coffee. The rain kept on against the gutters.`, new Set()) === null);
  check("and nothing to correct says nothing", thresholdFix(null) === "");
}

/* ── 4. the standing law, so it is not only ever a correction after the fact ─── */
{
  const law = thresholdLaw(world("Vin's family home"));
  check("a private place gets a standing law", law.length > 0, law);
  check("...naming who is inside", /exactly the people the scene list names/.test(law), law);
  check("...and forbidding the discovery", /Do not discover a person already in a room here/.test(law), law);
  check("a public place gets none", thresholdLaw(world("The Daily Grind")) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
