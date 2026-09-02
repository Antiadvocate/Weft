/* THE MIC DROP THAT INVENTED A SISTER.
 *
 * "Narrator invents perfect near absolute perfect one line mic drops by inventing shit."
 *
 * Turn 39 of the Seattle save. The player had spent three turns furious that his wife vanished for
 * a night and a day without a word. Mara arrives on the porch:
 *
 *     "Emily called me at seven this morning from her sister's couch. She was there all night
 *      because her sister's kid was sick, and she was too tired to drive back, and her phone died
 *      in the car. She told me she'd texted you but it didn't go through. She showed me the text.
 *      The one that says 'staying at Priya's tonight, home by ten.' Priya. Her sister."
 *
 * It is a beautifully built speech and every load-bearing fact in it is invented. Emily's own card:
 * "the only child of a nurse and a high school teacher." Priya's own card: "a yoga instructor and
 * the owner of a small studio in Columbia City ... the daughter of Indian immigrants who run a
 * grocery store in the Central District", recorded roles ["neighbor", "friend"], friends with Emily
 * "over the past year", and marked departed. No sister, no sick kid, no dead phone, no lost text.
 *
 * The narrator's law forbids precisely this, by name — "DO NOT invent backstory, phone calls,
 * deaths, or history to fill an emotional space and then treat your own invention as fact next
 * turn ... A character speaking about them says only what the record already holds." A rule that
 * specific, ignored, needs a detector behind it.
 *
 * AND THE ENGINE FILED IT. That turn's scene summary — replayed into every following turn as what
 * happened — reads "Emily had spent the night at her sister Priya's because the kid was sick and
 * her phone died". A queued gm_intent has Emily whispering "I was at my sister's" on a turn not yet
 * played. One invented sister, three places in the state, compounding.
 *
 * Dialogue is the only channel in this engine with no guard on it: the reviser is barred from
 * touching any sentence carrying a quotation mark. The most devastating line a scene can produce is
 * a fact nobody can check, and a model reaching for one reaches for family.
 */
import { findKinBreach, kinFix } from "../src/engine/kinship";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/invented-kin.json", "utf8"));
const EMILY = "char_mtggvs9t2dhp3";
const save = (over: Record<string, unknown> = {}): SaveState => ({
  characters: JSON.parse(JSON.stringify(FIX.characters)),
  world: { edges: FIX.edges },
  ...over,
} as unknown as SaveState);

/* ── 1. the turn itself ──────────────────────────────────────────────────────── */
{
  const s = save();
  const hit = findKinBreach(s, FIX.prose["39"]);
  check("the invented sister is caught", !!hit, hit);
  check("...attributed to Emily", hit?.owner === "Emily", hit);
  check("...as a sibling", hit?.relation === "sister", hit);
  check("...on the sentence that did it", /her sister's couch/.test(hit?.sentence ?? ""), hit);
  check("...because her own record says so", /no siblings/.test(hit?.because ?? ""), hit);
  check("...in her own pronouns", /says she has/.test(hit?.because ?? ""), hit?.because);

  // The record it is checked against, quoted so this test fails loudly if the fixture drifts.
  check("Emily's card really does say only child", /only child/i.test(FIX.characters[EMILY].background));
  check("and Priya's card gives her different parents",
    /daughter of Indian immigrants/i.test(FIX.characters["char_mtggvs9wvhjy7"].background));
  check("and the ledger records Priya as a neighbour, not family",
    FIX.edges.some((e: any) => e.from === "char_mtggvs9wvhjy7" && (e.roles ?? []).includes("neighbor")));

  // The bookkeeper filed it, which is why this is worth a detector rather than a shrug.
  check("the scene summary canonised the invention", /her sister Priya/.test(FIX.summary39), FIX.summary39);
}

/* ── 2. the correction voids it rather than staging a retraction ─────────────── */
{
  const fix = kinFix(findKinBreach(save(), FIX.prose["39"]));
  check("the line is voided", /That is void/.test(fix));
  check("...with no walk-back scene", /do not write a scene about the mistake/.test(fix));
  check("...and nobody caught in it", /be caught in it/.test(fix));
  check("the reason it happened is named", /can never be checked/.test(fix));
  check("...and a better instruction given", /use one that is already true/.test(fix));
}

/* ── 3. the other half: a cast member recast as a relative ───────────────────── */
{
  // Emily with a family, so the only-child rule cannot fire and rule two has to carry it.
  const s = save();
  s.characters[EMILY].background = "Emily grew up in Portland with a big loud family.";
  const hit = findKinBreach(s, "Mara said Emily had been at her sister Priya's place all night.");
  check("a cast member cast as a relative is caught", !!hit, hit);
  check("...and it is PRIYA who was named the sister, not Mara who said it",
    hit?.other === "Priya", hit);
  check("...because the ledger says otherwise", /no family tie|not family/.test(hit?.because ?? ""), hit);
}

/* ── 4. and it does not fire on the truth ────────────────────────────────────── */
{
  const s = save();
  s.characters[EMILY].background = "Emily grew up in Portland with a big loud family.";
  const clean = [
    "Emily kissed her husband Rabi on the porch.",                    // recorded on the edge
    "Mara talked about her own mother for a while.",                  // record silent, not contradicted
    "Rabi thought about his wife the whole way to the airport.",      // recorded
    "The duffel sat by the stairs and nobody said anything.",         // no kinship at all
    "Drea's shift ended at two and she walked home in the rain.",     // no kinship
  ];
  for (const line of clean) check(`no false positive: "${line.slice(0, 46)}…"`, findKinBreach(s, line) === null, findKinBreach(s, line));

  // Turns either side of the offending one are clean.
  const s2 = save();
  check("turn 37 is clean", findKinBreach(s2, FIX.prose["37"]) === null, findKinBreach(s2, FIX.prose["37"]));
  check("turn 38 is clean", findKinBreach(s2, FIX.prose["38"]) === null, findKinBreach(s2, FIX.prose["38"]));
}

/* ── 5. silence is not a contradiction ───────────────────────────────────────── */
{
  // A record that simply never mentions a family does not make a family an invention. Only a record
  // that SAYS otherwise does. Getting this wrong would flag every new person a story introduces.
  const s = save();
  s.characters[EMILY].background = "Emily moved to Seattle for work.";
  check("an unstated family is left alone",
    findKinBreach(s, "Emily called her brother from the car.") === null);
  s.characters[EMILY].background = "Emily was an only child.";
  check("...and a stated one is not", findKinBreach(s, "Emily called her brother from the car.") !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
