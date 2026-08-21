/* Smoke test: SHE NEVER TALKS ABOUT ANYTHING OTHER THAN CHLOE.
 *
 * An 83-turn save, and the player: "This is emblematic of the disease. She never talks about
 * anything other than Chloe. Repeating the things she's already told me."
 *
 * spent.ts was already running in that save and had not noticed, because it CANNOT. Its whole
 * mechanism exempts the cast, on the reasoning that a scene must always be free to say who is
 * standing in it — which is right, and which aimed it away from the thing being complained about.
 * Meanwhile the props it did file were "three", "tell", "exactly", "sleep", "leaving" and
 * "married": sentence-initial capitals that are not names, and seven-letter words that are not
 * rare. It was blind to the target and noisy about everything else.
 *
 * Naming somebody is not the failure. Having ONE SUBJECT is — a person whose every scene is about
 * the same absent third party has stopped being a person and become a topic with legs, which is the
 * defect the card spec already names for walk-ons. So it is measured on its own terms, and the
 * correction never suppresses the name: the answer to a monopolised subject is the character having
 * another one, not a gag order.
 */
import { monopolisedSubject, monopolyNote, distinctiveProps, retoldToPlayer, retoldNote } from "../src/engine/spent";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const CAST = ["Miranda", "Chloe", "Leo", "Sarah Keller"];

/* ── 1. the monopoly ──────────────────────────────────────────────────────────── */
{
  const turns = [
    `"Chloe called again," she said. "Chloe is furious about the fellowship."`,
    `"I keep thinking about Chloe," she said. "Chloe found out from someone at the Grind."`,
    `"Chloe texted twice more." She set the mug down. "Chloe wants to strategize."`,
  ];
  check("three scenes of one absent name is a monopoly",
    monopolisedSubject(turns, CAST, ["Miranda"]) === "Chloe", monopolisedSubject(turns, CAST, ["Miranda"]));

  check("a passing mention is not", monopolisedSubject(
    [`"Chloe called."`, `"The bread is stale."`, `"I slept badly."`], CAST, ["Miranda"]) === null);

  // whoever is standing in the room is never the monopolised subject — that is just the scene
  check("the person in the room is not a monopoly", monopolisedSubject(
    [`"Miranda, Miranda, listen."`, `"Miranda. Miranda."`, `"Miranda? Miranda."`], CAST, ["Miranda"]) === null);

  // narration about Chloe is not somebody talking about Chloe
  check("only what is actually SAID counts", monopolisedSubject(
    ["Chloe had texted twice. Chloe was furious.", "Chloe again. Chloe.", "Chloe. Chloe."], CAST, ["Miranda"]) === null);
}

/* ── 2. the correction, and the thing it must not do ─────────────────────────── */
{
  const n = monopolyNote("Chloe", "Miranda");
  check("the narrator is told", n.length > 0);
  check("...naming who has become a topic", /Miranda has talked about Chloe/.test(n), n);
  check("...and is explicitly NOT told to avoid the name",
    /NOT forbidden and must not be conspicuously avoided/.test(n), n);
  check("...but to give them something of their own",
    /background, their trade|standing interests/.test(n), n);
  check("nothing to say means nothing said", monopolyNote(null, "Miranda") === "");
}

/* ── 3. and the junk it was filing instead of props ──────────────────────────── */
{
  const none = new Set<string>();
  // every one of these was in that save's spent_subjects
  for (const junk of ["Three days, exactly.", "Tell me again.", "Sleep is not the problem.", "Work is fine."]) {
    check(`not a prop: ${junk}`, distinctiveProps(junk, none).length === 0, distinctiveProps(junk, none));
  }
  check("nor a seven-letter ordinary word", !distinctiveProps("She is leaving and I am married.", none).includes("leaving"));
  check("nor an -ing or -ed form", !distinctiveProps("It was happening and it had happened.", none).some((w) => /happen/.test(w)));
  // ...while the things that ARE props still land
  check("a real name still lands", distinctiveProps("Elena keeps redesigning the logo.", none).includes("elena"));
  check("a name opening a line still lands", distinctiveProps("Marcus wants the order.", none).includes("marcus"));
  check("trade vocabulary still lands", distinctiveProps("It is about the flatstock.", none).includes("flatstock"));
  check("and a colour", distinctiveProps("The client hated the burgundy.", none).includes("burgundy"));
}

/* ── 4. AND THE HALF THAT WAS ACTUALLY MEASURABLE ────────────────────────────────
 *
 * Worth recording so nobody chases the wrong one again. Over that 83-turn save the name "Chloe" is
 * spoken in 21 turns, twice or more in only two, longest run four. The monopoly detector finds
 * nothing there and is right to. Frequency was never it — RE-DELIVERY was, and the player said so
 * in the same breath: "repeating the things she's already told me."
 */
{
  const st = {
    memory: { char_player: { character_id: "char_player", core: [], beliefs: [], knows: [], episodic: [],
      facts: [{ content: "Miranda only received the fellowship shortlist email this morning and does not yet know who else made the cut.", turn: 11 }] } },
  } as unknown as SaveState;

  // T12, verbatim from the save
  const hit = retoldToPlayer(st, `She looked at the nightstand. "I don't know who else made the cut. I only got the email this morning."`);
  check("a line delivering what the player already holds is caught", !!hit, hit);
  check("...and the line is kept so the correction can quote it", /who else made the cut/.test(hit?.line ?? ""), hit);

  check("a line about something new is not caught",
    retoldToPlayer(st, `"The gallery called. They want the drawings by Friday and I said yes."`) === null);
  check("a short line is never a re-delivery", retoldToPlayer(st, `"I don't know."`) === null);
  check("and a player with no record is never accused",
    retoldToPlayer({ memory: {} } as unknown as SaveState, `"I only got the email this morning."`) === null);

  const note = retoldNote(hit);
  check("the next turn is told, quoting both sides", /already had it/.test(note) && /who else made the cut/.test(note), note);
  check("...and told to start from the far side of it", /far side of what has already been said/.test(note), note);
  check("nothing to correct means nothing said", retoldNote(null) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
