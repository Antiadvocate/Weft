/* Smoke test: THE WOMAN WHO WAS NEVER THERE.
 *
 * From a save set in Rome. On turn 6 a gladiator did her crowd-work in a cookshop doorway:
 *
 *   "The Dolphin! Best lentils in the Subura, they say. Tigris the Nubian says it too, so now
 *    it's three people saying it. Ha!"
 *
 * The speaker detector read "Nubian says", found no cast member by that name, and registered one.
 * The promotion loop made her central on the same turn. The voice forge gave her a diction list
 * (soundings, mud-line, oar-sweep, silt, keel) and the drive forge gave her a mother's armlet
 * confiscated by a watch captain. She joined PRESENT and stayed. From turn 16 she walked beside the
 * player through the Subura, was written intents every turn, took a gold coin from his hand, asked
 * him for help, and had Tigris's own history filed onto her by the bookkeeper — "Rabi offered
 * Nubian freedom in exchange for her silence about his gold-making". At turn 24 the player typed
 * "I don't know you. Sorry." and the narrator had the noblewoman he was walking with reproach him
 * for it: "She's been walking with us since the alley."
 *
 * Every guard in the detector passed her, and the one meant to CONFIRM personhood is what let her
 * through: it requires a lower-case letter before the name, on the theory that a real person gets
 * referred to mid-sentence. "the Nubian" satisfies it perfectly.
 *
 * Two fixes, tested here. An epithet — a capitalised word that appears ONLY behind a determiner or
 * a possessive — is what somebody is being called, not what they are named. And a record the engine
 * scraped out of prose is not promoted into the cast until something has actually filled it in.
 */
import { isAppellation, isStub, isPersonName } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the line from the save ────────────────────────────────────────────────── */
{
  const line = `Tigris leaned against the doorframe with her arms crossed, grinning at nothing in `
    + `particular. "The Dolphin! Best lentils in the Subura, they say. Tigris the Nubian says it `
    + `too, so now it's three people saying it. Ha!" The laugh came too loud and too fast.`;
  check("Nubian is an appellation, not a name", isAppellation("Nubian", line));
  check("and the name it is attached to is not", !isAppellation("Tigris", line));
  // the detector's own gates never rejected her — this is why the new one had to exist
  check("she passed the person-name test", isPersonName("Nubian"));
}

/* ── 2. the epithets a story reaches for instead of a name ────────────────────── */
{
  for (const [word, prose] of [
    ["Nubian", "The Nubian vendor nearest him was telling him something about the price of copper."],
    ["Gaul", `"Enough," the Gaul said, and put the pot down.`],
    ["Greek", "Her grandfather's Greek said the fever would break by morning."],
    ["Widow", `The Widow answered before he could. "Five asses a night."`],
    ["Prefect", "His Prefect said nothing at all, which was the whole of the answer."],
  ] as [string, string][]) check(`"${word}" behind a determiner is not a name`, isAppellation(word, prose), prose);
}

/* ── 3. and the names that must still get through ─────────────────────────────── */
{
  for (const [word, prose] of [
    ["Allison", `"You should go," Allison said, and did not look up from the sink.`],
    ["Marek", "Marek said nothing. Later, in the yard, Marek asked him what he had meant by it."],
    // one bare mention anywhere clears it, which is what a real name gets almost immediately
    ["Clodia", `Lucia said, "The woman's name is Clodia." Clodia said nothing and kept wiping the counter.`],
    // a title in front of a name is not a determiner
    ["Severa", "Lady Severa said the price was already agreed."],
  ] as [string, string][]) check(`"${word}" survives`, !isAppellation(word, prose), prose);

  check("a word the prose never contains is not judged", !isAppellation("Tomas", "Nobody here is called that."));
}

/* ── 4. a scraped record is not a cast member yet ─────────────────────────────── */
{
  // exactly the record the save carried, twenty-five turns after she was invented
  const nubian = {
    provisional: undefined,
    background: `INCOMPLETE RECORD — entered the story at Day 1, 09:05 (Morning) without being `
      + `declared. What the text established: Tigris the Nubian says it too, so now it's three `
      + `people saying it.`,
  };
  check("the scraped record still reads as a stub", isStub(nubian));
  check("and a fresh provisional one does too", isStub({ provisional: true, background: "" }));
  check("a written person does not", !isStub({ background: "Born in Nubia, taken in a raid at nine." }));
  check("and neither does a blank record with no marker", !isStub({ background: "" }));
  check("nothing is not a stub", !isStub(undefined));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
