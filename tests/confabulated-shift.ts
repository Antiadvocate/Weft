/* THE SHIFT SHE NEVER WORKED, AND THE AFTERNOON SHE ACCUSED THE PLAYER OF FORGETTING.
 *
 * A reader's report on thirty-four turns of one save: "False memories, false beliefs, not acting
 * according to description, sounds maxim heavy, no characterization, no personality, no uniqueness,
 * no self desires, no questions about wanting something new on her own. No... nothing."
 *
 * Four separate failures, one save, and every one of them is measurable in the file:
 *
 *  1. THE FALSE MEMORY. She says at 10:02 that she has to be at the salon by eleven. Eleven passes
 *     between turn 19 (10:21) and turn 20 (14:21) with her on-screen for both. At 14:24 she says so
 *     herself — "the alarm already went off and I didn't hear it. Guess I'm late." At 14:56 she says
 *     she was at the salon this morning, and at 15:26 she has a lunch rush, a departure at ten
 *     forty, and a player who watched her go and has forgotten it. None of it was ever written.
 *     Cause: nothing in the engine has ever moved a commitment out of "pending", so the digest went
 *     on saying STILL DUE Day 1, 11:00 at half past three, boosted to the front of her mind.
 *  2. THE TIC. Five turns out of six use one narration frame: "She said it flat, like —".
 *  3. THE CARD. Her voice card forbids "I don't know". Turn 29: "Now I'm— I don't know."
 *  4. THE EMPTY CENTRE. Five turns running, twenty-one spoken lines, not one of them says what she
 *     wants — and apertureNote, the module built to notice exactly this, returned "" for her,
 *     because a clenched body was skipped before it could reach its own paragraph.
 */
import { resolveOverdue, missedFor, dueLabel, missedNote, findMissedClaim, missedClaimFix, OVERDUE_GRACE } from "../src/engine/commitments";
import { findFigure, figureFix, findNeverSaid, neverSaidFix, findMaxims } from "../src/engine/maxims";
import { apertureNote, appetiteGap, APPETITE_GAP } from "../src/engine/aperture";
import type { SaveState, EpisodicMemory } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/confabulated-shift.json", "utf8")) as SaveState;
const ABI = "char_mtl12i1gbbk30";
const load = (): SaveState => JSON.parse(JSON.stringify(FIX)) as SaveState;
const proseAt = (turn: number): string =>
  String(FIX.history.find((h) => h.turn === turn)?.narrator_prose ?? "");

/* ── 1. the appointment the clock ran past ───────────────────────────────────── */
{
  const s = load();
  const before = s.memory[ABI].episodic.find((m) => m.turn === 14)!;
  check("the salon shift is on file as a pending commitment", before.commitment_status === "pending", before);
  check("...for eleven o'clock", /11:00/.test(before.scheduled_time ?? ""), before.scheduled_time);

  const log = resolveOverdue(s);
  const after = s.memory[ABI].episodic.find((m) => m.turn === 14)!;
  check("the hour passed on-screen, so it settles as missed", after.commitment_status === "missed", after);
  check("...and says which turns it passed between", /19|20/.test(log.join(" ")), log);
  check("...naming the person and the hour", /Abigail/.test(log.join(" ")) && /11:00/.test(log.join(" ")), log);

  // idempotent — a second pass has nothing left to settle
  check("running it again settles nothing further", resolveOverdue(s).length === 0);

  // and it is the ONLY thing it touched: the other commitments in the bank are for hours that have
  // not passed on-screen, or are unclocked open loops, and it must not guess at those.
  const others = s.memory[ABI].episodic.filter((m) => m.turn !== 14);
  check("nothing else in the bank was adjudicated",
    others.every((m) => m.commitment_status !== "missed"), others.map((m) => [m.turn, m.commitment_status]));
}

/* ── 2. what the narrator is shown instead ───────────────────────────────────── */
{
  const s = load();
  resolveOverdue(s);
  const m = s.memory[ABI].episodic.find((mm) => mm.turn === 14)!;
  const label = dueLabel(m, s.world.current_time);
  check("the digest no longer calls a passed hour STILL DUE", !/STILL DUE/.test(label), label);
  check("...it says the hour came and went", /came and went/i.test(label), label);

  const note = missedNote(s, s.world.present);
  check("the room is told, at the end of the directive", note.length > 0);
  check("...that she was standing here when the hour passed", /was in this room when that hour passed/i.test(note), note);
  check("...and that nobody says she went", /does not say they went|says they went/i.test(note), note);
  // the point of the block is not the ban — it is that a blown shift is hers to want something about
  check("...and it hands the trouble back to her as something of her own",
    /somebody to answer to|want out loud/i.test(note), note);
}

/* ── 2b. an hour nobody watched pass is not decided either way ───────────────── */
{
  const s = load();
  s.telemetry = [];                          // no record of who was in the room
  const settled = resolveOverdue(s);
  check("with no record of the crossing, nothing is settled", settled.length === 0, settled);
  const m = s.memory[ABI].episodic.find((mm) => mm.turn === 14)!;
  check("...the commitment stays pending", m.commitment_status === "pending");
  const label = dueLabel(m, s.world.current_time);
  check("...but it still stops being described as upcoming", !/STILL DUE/.test(label), label);
  check("...and the narrator is told the record is silent rather than handed a timestamp",
    /nothing in the record says whether it happened/i.test(label), label);
}

/* ── 2c. an hour that has not arrived is left completely alone ───────────────── */
{
  const s = load();
  const m: EpisodicMemory = {
    turn: 30, content: "I told him I'd meet him at the Copper Tap at nine.",
    importance: 5, emotional_charge: "", last_accessed_turn: 30,
    scheduled_time: "Day 1, 21:00", commitment_status: "pending",
  };
  s.memory[ABI].episodic.push(m);
  resolveOverdue(s);
  check("an appointment still ahead is untouched", m.commitment_status === "pending");
  check("...and still reads as due", dueLabel(m, s.world.current_time) === ", STILL DUE Day 1, 21:00",
    dueLabel(m, s.world.current_time));
  // and the grace period is real: one minute past the hour is not yet a missed appointment
  const justPast = { ...m, scheduled_time: "Day 1, 15:20" } as EpisodicMemory;
  check(`${OVERDUE_GRACE} minutes of grace before the record calls it`,
    /STILL DUE/.test(dueLabel(justPast, "Day 1, 15:26 (Afternoon)")), dueLabel(justPast, "Day 1, 15:26 (Afternoon)"));
}

/* ── 3. and the claim itself, caught in the prose ────────────────────────────── */
{
  const s = load();
  resolveOverdue(s);
  const hit = findMissedClaim(proseAt(34), s, s.world.present);
  check("turn 34 is caught", !!hit, hit);
  check("...on the sentence that did it", /was there this morning|came home after|saw me leave/i.test(hit?.said ?? ""), hit?.said);
  const fix = missedClaimFix(hit);
  check("the correction voids it rather than retconning the fiction",
    /never happened|did not watch anything/i.test(fix), fix);
  check("...and protects the player from being told they forgot", /did not forget/i.test(fix), fix);

  // turn 31 is her pressing him about Sarah and Kristi — no claim about the salon anywhere in it
  check("turn 31 is clean", findMissedClaim(proseAt(31), s, s.world.present) === null);
  // and with nothing missed on file, the detector has nothing to fire on at all
  const clean = load();
  check("a character with no missed commitment can never trip it",
    findMissedClaim(proseAt(34), clean, clean.world.present) === null);
}

/* ── 4. the narration frame, five turns out of six ───────────────────────────── */
{
  const run = [29, 30, 31, 32, 33].map(proseAt);
  const hit = findFigure(run, proseAt(34));
  check("the repeated frame is caught", !!hit, hit);
  check("...as a run, not as one simile", (hit?.runs ?? 0) >= 3, hit);
  check("...quoting THIS turn's sentence", /said it|testing the word/i.test(hit?.line ?? ""), hit?.line);
  const fix = figureFix(hit);
  check("the correction names the tic", /same sentence shape/i.test(fix), fix);
  check("...and names the leak hiding inside it", /states what a person was privately doing/i.test(fix), fix);

  // ONE simile is writing, not a tic. Turn 34 on its own, with nothing before it, says nothing.
  check("a single use is not a finding", findFigure([], proseAt(34)) === null);
  check("...and neither are two", findFigure([proseAt(32)], proseAt(34)) === null);
  // the existing dialogue detector never saw any of this: it only reads inside the quotes
  check("the spoken-line detector was blind to all five turns",
    run.concat(proseAt(34)).every((p) => findMaxims(p).length === 0));
}

/* ── 5. the line her own card forbids ────────────────────────────────────────── */
{
  const s = load();
  check("the card forbids it in plain words",
    (s.characters[ABI].voice?.never_says ?? []).some((x) => /i don't know/i.test(x)),
    s.characters[ABI].voice?.never_says);
  const hit = findNeverSaid(s, s.world.present, proseAt(29));
  check("turn 29 is caught", !!hit, hit);
  check("...attributed to her", hit?.name === "Abigail Mercer", hit);
  check("...against the right entry", /don't know/i.test(hit?.forbidden ?? ""), hit);
  const fix = neverSaidFix(hit);
  check("the correction says where the pressure goes instead",
    /into the body|refusal|changing the subject/i.test(fix), fix);

  check("the other turns are clean", [30, 31, 32, 33, 34].every((t) => findNeverSaid(s, s.world.present, proseAt(t)) === null));
  // a card with no never_says can never produce a hit
  const bare = load();
  delete (bare.characters[ABI] as { voice?: unknown }).voice;
  check("a character with no never-says list is never flagged",
    findNeverSaid(bare, bare.world.present, proseAt(29)) === null);
}

/* ── 6. five turns without wanting anything ──────────────────────────────────── */
{
  // Measured turn by turn, the way it runs in play: the history as it stood at the end of each turn.
  const through = (turn: number): SaveState => {
    const s = load();
    s.history = FIX.history.filter((h) => h.turn <= turn);
    return s;
  };
  // (the fixture's history starts at turn 26, so turn 30 sees a short window; in the full save it
  //  reads 4 there too. The stretch that matters is 31–33, where nothing she says wants anything.)
  const gaps = [31, 32, 33, 34].map((t) => [t, appetiteGap(through(t), ABI)] as const);
  check("the gap grows across the dead stretch", gaps.slice(0, 3).every(([, g]) => g >= APPETITE_GAP), gaps);
  check("...and closes on turn 34, when she finally asks for something",
    gaps[gaps.length - 1][1] === 0, gaps);

  const s33 = through(33);
  const note = apertureNote(s33, s33.world.present);
  check("the aperture speaks for a clenched body now", note.length > 0);
  check("...naming the run", /5 turns running without once saying what she wants/i.test(note), note);
  check("...and asking for a want that did not come from the player's line",
    /did not come from the player's last line/i.test(note), note);
  check("...offering what is already on her card", /Confirm beyond doubt|cuticle oil/i.test(note), note);
  check("...while still granting that a braced body narrows",
    /that is not a fault to correct/i.test(note), note);
  check("...onto her own thing rather than his", /WHOSE ONE THING IT IS/.test(note), note);

  // THE REGRESSION THIS EXISTS TO STOP: at turn 34 the same call returned the empty string, for a
  // character at −5.6 with five active emotional states, because a narrowed body was skipped before
  // it could reach the paragraph written for it.
  const s34 = through(34);
  check("she stops being nagged the turn she does it", !/without once saying what she wants/.test(apertureNote(s34, s34.world.present)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
