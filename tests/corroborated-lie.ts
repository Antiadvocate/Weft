/* THE MANAGER WHO AGREES WITH WHOEVER SPOKE LAST.
 *
 * The same story, seven turns further on. The player did the one thing that should have ended it:
 *
 *   T35  Abigail: "I was at work at eleven, Max. I came back."
 *   T36  player:  "No. I was here at 11 am. You were talking to me. You haven't gone anywhere."
 *   T37  Abigail: "Max, I was at the salon at eleven. I covered the lunch rush. … I remember
 *                  locking the door. I remember the keycard."
 *   T38  player:  "Yeah? Any proof? That you did? Let's call your manager"
 *        Abigail: "Because I already texted her from the back room at 11:12 when Tanya was late."
 *   T40  player:  I press the button and ask "hi. Did Abigail work today?"
 *        → "Solstice Tanning, this is Dana."
 *
 * Between the demand and the dial tone the engine minted a text at 11:12, a back room, a coworker
 * named Tanya, a keycard and a locked door — then put a manager on speaker with nothing telling it
 * what that manager knows. By turn 40 Abigail's psyche reads relaxation −10, state "broken",
 * break_mode "fractured", active states "confused" and "second-guessing reality". The engine
 * gaslit its own character because its record and its prose disagreed and only the prose spoke.
 *
 * Three bugs, all of them in this file:
 *   1. The missed-appointment guard measured its window in TURNS. Forty-one turns covered twelve
 *      hours here, so the shift missed at eleven aged out at about seven in the evening — the exact
 *      turn the player called the salon. The guard went quiet when it was finally needed.
 *   2. The claim detector could not tell "I was at the salon at eleven" from "No. I was here" or
 *      from "You think I've been here all day", because it read whole quoted lines.
 *   3. Nothing settled the answer before the prose, so a witness invented mid-argument was free to
 *      certify the hallucination.
 */
import {
  resolveOverdue, missedFor, missedNote, findMissedClaim, verificationLaw, MISSED_KEEP_MINUTES,
} from "../src/engine/commitments";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/corroborated-lie.json", "utf8")) as SaveState;
const ABI = "char_mtl12i1gbbk30";
const load = (): SaveState => JSON.parse(JSON.stringify(FIX)) as SaveState;
const prose = (turn: number): string => String(FIX.history.find((h) => h.turn === turn)?.narrator_prose ?? "");
const acted = (turn: number): string => String(FIX.history.find((h) => h.turn === turn)?.player_action ?? "");
const prev = (turn: number): string => prose(turn - 1);

/* ── 1. forty-one turns is not "a long time ago" ─────────────────────────────── */
{
  const s = load();
  check("the save is at turn 41 and Day 1, 19:39", s.world.current_turn === 41 && /19:39/.test(s.world.current_time),
    [s.world.current_turn, s.world.current_time]);
  check("...twenty-seven turns after the promise was filed at turn 14",
    s.world.current_turn - 14 > 25, s.world.current_turn - 14);
  const settled = resolveOverdue(s);
  check("the shift still settles as missed", settled.length >= 1, settled);
  check("...and is STILL a live fact eight and a half hours later",
    missedFor(s, ABI).length >= 1, missedFor(s, ABI));
  check("the window is measured in world time, not turns", MISSED_KEEP_MINUTES >= 1440);

  // and it does expire, on the scale a day has
  const later = load();
  resolveOverdue(later);
  later.world.current_time = "Day 5, 11:00 (Morning)";
  check("four days on, it is no longer today's shift", missedFor(later, ABI).length === 0, missedFor(later, ABI));
}

/* ── 2. one hour, one row ────────────────────────────────────────────────────── */
{
  const s = load();
  resolveOverdue(s);
  check("both promises about eleven o'clock settle", missedFor(s, ABI).length === 2, missedFor(s, ABI).map((m) => m.content.slice(0, 40)));
  const note = missedNote(s, s.world.present);
  const rows = note.split("\n").filter((l) => l.startsWith("· "));
  check("...but the room is told about it once", rows.length === 1, rows);
  check("...in the plainest words she used", /I have to be at the salon by eleven/.test(rows[0] ?? ""), rows[0]);
  check("and the note now closes off the outside world too",
    /No manager, no coworker, no timesheet/i.test(note), note.slice(-400));
}

/* ── 3. the claim, and the three things that are not one ─────────────────────── */
{
  const s = load();
  resolveOverdue(s);
  const caught = FIX.history
    .map((h) => [h.turn, findMissedClaim(String(h.narrator_prose ?? ""), s, s.world.present)?.said ?? null] as const)
    .filter(([, said]) => said);
  const turns = caught.map(([t]) => t);

  check("turn 37's claim is caught", /I was at the salon at eleven/i.test(caught.find(([t]) => t === 37)?.[1] ?? ""), caught.find(([t]) => t === 37));
  check("...and turn 39's", turns.includes(39), caught);
  check("...and turn 38's clock-out", /clocked out/i.test(caught.find(([t]) => t === 38)?.[1] ?? ""), caught.find(([t]) => t === 38));

  // THE THREE FALSE POSITIVES THE FIRST VERSION PRODUCED, each from a real line in this save.
  check("turn 36 is not flagged for \"No. I was here\"", !turns.includes(36), caught.find(([t]) => t === 36));
  check("...and turn 35 is not flagged for the player's version quoted back",
    !/you think|been here all day/i.test(caught.find(([t]) => t === 35)?.[1] ?? ""), caught.find(([t]) => t === 35));
  check("...and turn 20's \"till I got back\" is not a claim that she went",
    !turns.includes(20), caught.find(([t]) => t === 20));

  // and a character with nothing settled against them can never be flagged
  const clean = load();
  check("nothing is flagged before the commitment settles",
    FIX.history.every((h) => findMissedClaim(String(h.narrator_prose ?? ""), clean, clean.world.present) === null));
}

/* ── 4. the answer arrives before the prose ──────────────────────────────────── */
{
  const s = load();
  resolveOverdue(s);
  const fires = (t: number): boolean => !!verificationLaw(s, acted(t), s.world.present, prev(t));

  check("the turn the player asks for proof", fires(38), acted(38));
  check("the turn he tells her to put the manager on speaker", fires(39), acted(39));
  check("and the turn Dana answers — whose typed action names none of it", fires(40), acted(40));

  const law = verificationLaw(s, acted(40), s.world.present, prev(40));
  check("the law states the verdict", /was not there/i.test(law), law.slice(0, 200));
  check("...names what may not decide it", /A voice invented this turn has no memory of its own/i.test(law), law);
  check("...and says why it would be worse than the original error", /because the player asked/i.test(law), law);
  check("...while leaving the character free to lie", /can lie over the top of it/i.test(law), law);
  check("...and leaving the answer allowed to be useless", /slow, partial, distracted, or useless/i.test(law), law);

  check("an unrelated action does not summon it",
    verificationLaw(s, "I kiss her neck and tell her she looks good", s.world.present, "She turned the fan back on.") === "", "");
  const clean = load();
  check("and with nothing settled there is nothing to rule on",
    verificationLaw(clean, acted(38), clean.world.present, prev(38)) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
