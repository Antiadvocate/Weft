/* Smoke test: A ROMANCE THAT ENDED IN A RESTRAINING ORDER.
 *
 * 92 turns. The settings, verbatim from the save:
 *
 *   tone                 "Love, erotica, romantic"
 *   destination          "Vin gives Miranda's penis enough focused, loving attention that she fully
 *                         accepts it as a cherished part of herself, and their shared intimacy is
 *                         restored and deepened."
 *   destination_turns    0
 *   forbidden_as_primary ["Physical violence or threats of it", "A villain with malicious intent",
 *                         "A medical crisis or health scare", "A breakup or infidelity plot"]
 *
 * What it became: estrangement, a bag packed, a flight across the country, a friend who turns out to
 * have been secretly meeting the wife for a year, and the player filing a restraining order. Two of
 * the four forbidden-as-primary entries are the spine of it.
 *
 * TWO SAFETY NETS, BOTH OFF, FOR TWO UNRELATED ONE-LINE REASONS.
 *
 * 1. THE CLOCK. A budget of 0 is a documented mode — the Settings panel calls it "gravity, not fate"
 *    and promises "the ending pulls but never forces". readFate makes `active` false, fateDirective
 *    returns the empty string, and the promise's first half was never implemented anywhere: `act`
 *    stayed "open" (the ending is far, the player is free) for ninety-two turns, and the only thing
 *    still pointing anywhere was one passive line in the digest. PHILOSOPHY.md names this exactly:
 *    "a directive leaves the machinery pulling elsewhere."
 *
 * 2. THE AUDITOR. It is asked, every chapter, whether the story has drifted from its contract — and
 *    the contract it was handed was `narrator_direction`, which in that save is "". So it was told
 *    STANDING DIRECTION: "none given" and returned on_contract true three times, while its own
 *    summaries described the marriage coming apart. The player HAD stated the contract, in the three
 *    fields they filled: genre, pressure palette, forbidden-as-primary. None of them were shown to
 *    the auditor. And because on_contract never came back false, contract_drift stayed null and the
 *    COURSE-CORRECTION directive never fired once.
 *
 * The auditor was not even wrong about the gap. At turn 75 it recorded, correctly: "No physical or
 * emotional focus on Miranda's body or Vin's loving attention to it." That sentence reaches the
 * narrator only through fateDirective, which was returning "".
 */
import { readFate, fateDirective, gravityDirective } from "../src/engine/fate";
import { CHAPTER_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const DEST = "Vin gives Miranda's penis enough focused, loving attention that she fully accepts it as a cherished part of herself.";
const MISSING = "No physical or emotional focus on Miranda's body or Vin's loving attention to it";
const save = (turns: number): SaveState => ({
  world: { current_turn: 92 },
  world_bible: { destination: DEST, destination_turns: turns, destination_set_turn: 1, tone: "Love, erotica, romantic" },
} as unknown as SaveState);

/* ── 1. the save's own numbers ────────────────────────────────────────────────── */
{
  const f = readFate(save(0));
  check("a budget of 0 leaves fate inactive", !f.active, f);
  check("...and the act never leaves 'open'", f.act === "open", f.act);
  check("...and fate says nothing at all", fateDirective(f, MISSING) === "");
}

/* ── 2. but gravity is a promise too, and it is kept now ─────────────────────── */
{
  const f = readFate(save(0));
  const g = gravityDirective(f, save(0).world_bible, MISSING);
  check("a destination with no clock still pulls", g.length > 0, g);
  check("...naming the ending", g.includes("cherished part of herself"), g);
  check("...carrying the auditor's gap, which used to be thrown away", g.includes(MISSING), g);
  check("...and it never invents a deadline", /no deadline|must not manufacture one/.test(g), g);
  check("...nor tells anyone to write the ending now", !/must be written now|turns for it are spent/.test(g), g);
  check("...nor to have anybody talk about it", /does not mean anyone talking about it/.test(g), g);

  // with a clock, fate has it and gravity stays out of the way
  const withClock = readFate(save(40));
  check("a story WITH a clock is unaffected", withClock.active && gravityDirective(withClock, save(40).world_bible, MISSING) === "");
  // and a story with no destination is left completely alone
  check("open play is untouched",
    gravityDirective(readFate({ world: { current_turn: 5 }, world_bible: {} } as unknown as SaveState),
      {}, undefined) === "");
}

/* ── 3. the auditor now knows what a contract is ─────────────────────────────── */
{
  check("it is told the contract is more than the direction line",
    /genre, the standing direction, the pressures/.test(CHAPTER_SYSTEM), "");
  check("...and to judge against all of it", /not only the direction line/.test(CHAPTER_SYSTEM));
  check("...and to check the genre against what the beats are made of",
    /Check the GENRE against what the beats are actually made of/.test(CHAPTER_SYSTEM));
  check("...and to check whether a forbidden thing became the engine",
    /anything listed as NEVER THE ENGINE has become the engine/.test(CHAPTER_SYSTEM));
  check("...and that saying so is not a criticism of the writing",
    /not a criticism of the writing/.test(CHAPTER_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
