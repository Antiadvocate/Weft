/* THE AGGREGATE NOBODY WAS KEEPING.
 *
 * "I haven't deployed because I want to see how bad it gets... This has happened to my prior game
 *  too, I had done all these inane fixes and now I'm back with a nightmare mode on a love story."
 *
 * Six saves of one world, 208 turns. A love story became a municipal procedural, then a nine-turn
 * argument about a plate of eggs, then a stalking thriller, then a scene where two women crossed two
 * thousand miles in fifty-five minutes and the ledger swapped which of them was in the room.
 *
 * Across all of it, five chapter audits ran. Every one returned on_contract: true. contract_drift is
 * null in all six saves. The component whose entire job is to say "this is not the story that was
 * asked for" has never fired once.
 *
 * It was right on the evidence it had. The audit reads the BOOKKEEPER'S SCENE SUMMARIES — where
 * "Mara confronted Rabi ... telling him that Emily had spent the night at her sister Priya's because
 * the kid was sick" is stored as a plain account of what happened. Fed a laundered transcript, it
 * sees a coherent domestic drama and certifies it. It was checking the story against the contract
 * while reading a record the failures had already rewritten, and it was never given the cast's own
 * facts to check that record against.
 *
 * Meanwhile every detector in the engine — echo, maxims, leak, anatomy, kinship, reprint, and the
 * engine's own bookkeeping refusals — catches its own failure, emits one correction into the next
 * turn, and forgets. Nothing counted them. So a story could come apart steadily with the engine
 * noticing every individual crack and no part of it noticing the wall.
 */
import { noteFire, integrityAlarm, integrityLog } from "../src/engine/integrity";
import { CHAPTER_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const save = (turn = 1): SaveState => ({ world: { current_turn: turn } } as unknown as SaveState);
const at = (s: SaveState, t: number) => { (s.world as { current_turn: number }).current_turn = t; return s; };

/* ── 1. one problem being corrected is the system working ────────────────────── */
{
  const s = save();
  for (const t of [1, 2, 3, 4]) { at(s, t); noteFire(s, "anatomy", "same failure again"); }
  check("the same detector firing four turns running is not an alarm", integrityAlarm(at(s, 4)) === null);
  check("...but it is all on the record", integrityLog(s).length === 4);
}

/* ── 2. three different ones in a window is the wall ─────────────────────────── */
{
  const s = save();
  at(s, 10); noteFire(s, "kin", "Emily given a sister");
  at(s, 12); noteFire(s, "arrival", "Drea placed 815 minutes away");
  at(s, 13); noteFire(s, "swap", "Mara moved out of a scene she is in");
  const alarm = integrityAlarm(at(s, 13));
  check("three different kinds inside the window raises it", !!alarm, alarm);
  check("...naming them in plain words", /a family invented|could not have got to|disagreeing with the prose/.test(alarm ?? ""), alarm);
  check("...and telling the player what to do about it", /rolling back/.test(alarm ?? ""), alarm);
  check("...because corrections only work forwards", /turn to turn rather than backwards/.test(alarm ?? ""), alarm);

  check("it does not repeat itself every turn after", integrityAlarm(at(s, 14)) === null);
  check("...nor a few turns later", integrityAlarm(at(s, 20)) === null);
  at(s, 24); noteFire(s, "phantom", "somebody arrived off-page");
  at(s, 25); noteFire(s, "reprint", "the turn before, again");
  at(s, 26); noteFire(s, "line", "a line said twice");
  check("but it speaks again for a fresh run", !!integrityAlarm(at(s, 26)));
}

/* ── 3. old trouble ages out ─────────────────────────────────────────────────── */
{
  const s = save();
  at(s, 1); noteFire(s, "kin", "a");
  at(s, 2); noteFire(s, "anatomy", "b");
  at(s, 40); noteFire(s, "swap", "c");
  check("failures from thirty turns ago do not raise an alarm now", integrityAlarm(at(s, 40)) === null);
}

/* ── 4. it costs nothing and decides nothing ─────────────────────────────────── */
{
  const s = save();
  check("a clean story reports nothing", integrityAlarm(s) === null);
  check("...and keeps no log", integrityLog(s).length === 0);
  for (let t = 1; t <= 200; t++) { at(s, t); noteFire(s, "kin", `x${t}`); }
  check("the log is bounded however long the game runs", (s.integrity?.fires.length ?? 0) <= 60);
}

/* ── 5. and the auditor is finally given the record to check against ─────────── */
{
  check("the audit is told the beats are the bookkeeper's account",
    /BOOKKEEPER'S account of each turn/.test(CHAPTER_SYSTEM));
  check("...and that an invention arrives in them as fact",
    /indistinguishable from anything that really happened/.test(CHAPTER_SYSTEM));
  check("...and is asked for contradictions by name", /"contradictions"/.test(CHAPTER_SYSTEM));
  check("...with the shapes spelled out",
    /a relative somebody does not have, a person in two places/.test(CHAPTER_SYSTEM));
  check("...kept separate from the genre question",
    /NOT the same question as on_contract/.test(CHAPTER_SYSTEM));
  check("...explicitly, so neither softens the other",
    /do not let one soften the other/.test(CHAPTER_SYSTEM));
  check("the field is in the output schema", /"contradictions":\[/.test(CHAPTER_SYSTEM));
  check("and on_contract still exists as its own verdict", /"on_contract":true/.test(CHAPTER_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
