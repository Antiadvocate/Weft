/* "ABIGAIL VANISHED FOR NO REASON. INTO THE ABYSS."
 *
 * Turn 20 of a real save. The player types "I walk to my room lie in bed and read a book." The
 * prose follows him down the hall, and four paragraphs in, describing the room behind him:
 *
 *     Out in the living room the television keeps playing to nobody in particular, volume
 *     unchanged from where Abigail left it. A floorboard somewhere near the couch takes weight,
 *     then settles again.
 *
 * Every word of that says she is still on the couch. The departure guard read "Abigail left",
 * found her name inside the matched span — which `owns` treats as settling the question outright —
 * and moved her out of the story to `elsewhere`.
 *
 * Then she could not come back. `elsewhere` is the engine's null bucket, not a place, so it has no
 * authored distance, no travel-log entry and no shared word with anything; it fell through to the
 * world-scale default. The scale itself had been taught by the same player reading his book: the
 * travel log had the bedroom at turn 20 and the living room at turn 24, six in-world hours apart,
 * and the engine filed that as a five-hour walk between two rooms of one flat. The result, in the
 * save's own shift log, on the turn the player typed "Continue story until Abigail is back in the
 * picture":
 *
 *     bookkeeping correction: Abigail Mercer cannot be here yet —
 *     elsewhere is 1088 minutes away and 408 have passed
 *
 * Eighteen hours of travel, from nowhere, to walk back into the apartment she never left. Three
 * bugs stacked: a transitive verb read as an intransitive one, a null bucket priced as a location,
 * and a dwell time recorded as a journey.
 *
 * The third failure in the same report — "I do something and she instantly knows I'm on hinge" —
 * has no fixture because it is not a bug in the record; it is the absence of a rule. See section 4.
 */
import { departureEvidence } from "../src/engine/exit";
import { travelMinutesBetween, worldScale, NEIGHBOUR_TRAVEL_MIN, DEFAULT_TRAVEL_MIN } from "../src/engine/turn";
import { screenPrivacyNote } from "../src/engine/scene";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/vanished.json", "utf8")) as SaveState;
const prose = (t: number): string => String(FIX.history.find((h) => h.turn === t)?.narrator_prose ?? "");
const acted = (t: number): string => String(FIX.history.find((h) => h.turn === t)?.player_action ?? "");
const NAME = (id: string): string => FIX.world.places[id]?.name ?? id;
const LIVING = "loc_mtl12i1fabqns", BEDROOM = "loc_mtl12i1gpjqaj", SHOP = "loc_mtl12i1gj22nm";

/* ── 1. `left` is two verbs ──────────────────────────────────────────────────── */
{
  check("the sentence that did it is really in the prose",
    /volume unchanged from where Abigail left it/.test(prose(20)), prose(20).slice(0, 80));
  const ev = departureEvidence({
    prose: prose(20), action: acted(20), said: "narrator: left",
    name: "Abigail Mercer", others: [], destination: "elsewhere",
  });
  check("turn 20 no longer reads as a departure", !ev.ok, ev);

  // the whole point is that the intransitive verb still works
  const rows: [string, boolean][] = [
    ["Abigail left.", true],
    ["Abigail left the apartment without another word.", true],
    ["Abigail had left by the time he came back.", true],
    ["Abigail slipped out through the side door.", true],
    ["volume unchanged from where Abigail left it.", false],
    ["Abigail left them on the counter and went back to the couch.", false],
    ["Abigail left behind a smear of polish on the arm of the couch.", false],
    ["Abigail leaves it running and folds her arms.", false],
  ];
  for (const [line, want] of rows) {
    const got = departureEvidence({ prose: line, name: "Abigail Mercer" }).ok;
    check(`${want ? "went" : "stayed"}: ${line}`, got === want, got);
  }
}

/* ── 2. elsewhere is not a place ─────────────────────────────────────────────── */
{
  const back = travelMinutesBetween(FIX, "elsewhere", NAME(BEDROOM));
  check("coming back from nowhere is not an eighteen-hour journey", back <= NEIGHBOUR_TRAVEL_MIN, back);
  check("...but it is not instant either", back > 0, back);
  check("the offscene id is read the same way as its name",
    travelMinutesBetween(FIX, "loc_offscene", NAME(BEDROOM)) === back);

  // and with 408 minutes on the clock she is let back in, which is what the player asked for
  const had = 408;
  check("the turn the player said \"continue until Abigail is back\" would now let her back", had >= back, { had, back });
}

/* ── 3. a stay is not a journey ──────────────────────────────────────────────── */
{
  // The log: living room T1, bedroom T20, living room T24, bedroom T27 — with six hours of reading
  // sitting inside the T20→T24 gap.
  check("the travel log has the gaps that caused it",
    (FIX.travel_log ?? []).some((r, i, a) => i > 0 && r.turn - a[i - 1].turn > 3), FIX.travel_log);

  const rooms = travelMinutesBetween(FIX, NAME(LIVING), NAME(BEDROOM));
  check("two rooms of one flat are minutes apart", rooms <= NEIGHBOUR_TRAVEL_MIN, rooms);

  const scale = worldScale(FIX);
  check("the world's scale is measured in hours, not in a day", (scale ?? 0) > 0 && (scale ?? 0) < 6 * 60, scale);
  check("...and an unmeasured pair inherits that, not the default",
    travelMinutesBetween(FIX, NAME(LIVING), NAME(SHOP)) < DEFAULT_TRAVEL_MIN,
    travelMinutesBetween(FIX, NAME(LIVING), NAME(SHOP)));
}

/* ── 4. a screen is not the room ─────────────────────────────────────────────── */
{
  const her = ["Abigail Mercer"];
  const note = screenPrivacyNote("I pull out my phone and open Hinge, swiping for a bit", her);
  check("the room is told it cannot read his screen", note.length > 0);
  check("...naming who is standing there", /ABIGAIL MERCER CANNOT READ IT/.test(note), note.slice(0, 160));
  check("...and what IS available instead", /the angle it is held at|light on a face/i.test(note), note);
  check("...and that being wrong about it is the good version", /Being wrong about it is the best/.test(note), note);

  check("alone with his phone, no rule is needed", screenPrivacyNote("I check my phone", []) === "");
  check("showing her is showing her",
    screenPrivacyNote("I show her the message on my phone", her) === "");
  check("...however he hands it over",
    screenPrivacyNote("I turn the screen around so she can read it", her) === "");
  check("putting a phone down is not reading anything",
    screenPrivacyNote("I put my phone down on the arm of the couch", her) === "");
  check("and an action with no screen in it is untouched",
    screenPrivacyNote("I sit on the floor by her feet", her) === "");
  check("a laptop counts", screenPrivacyNote("I open my laptop and check my email", her).length > 0);
  check("so does a letter read at an angle", screenPrivacyNote("I read the letter, holding it away from her", her).length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
