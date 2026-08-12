/* Smoke test: THE WEEK SOMEBODY ALREADY HAS.
 *
 * Every forward-looking thing the engine knew about a person was a WANT — open-ended, and pursued
 * whenever the story happened to allow it. Nothing could say where somebody HAS to be at nine on a
 * Tuesday, so nobody was ever anywhere: a woman with a shift at a bar was at the player's flat at
 * eleven on a weekday morning and again at three in the afternoon, because "works at the bar" is a
 * sentence in a background and a background is not a clock. And no part of the engine could tell
 * Tuesday from Sunday, so a player could never plan around either.
 *
 * The five properties that make a schedule different from a drive:
 *
 *   1. there is a week at all — weekday and weekend exist even with no calendar in the bible
 *   2. they know what is coming, far enough ahead to act on it and no further
 *   3. offscreen, they go — the engine puts them where their hours say they are, for free
 *   4. onscreen, they are NEVER teleported out of a live scene; the narrator is told to write them
 *      going, and only a scene that holds them far past the hour makes the engine act itself
 *   5. missing it is a thing that happened — remembered, and cashed out through the same
 *      consequence machinery as a broken promise
 */
import {
  hasSchedule, newBlock, readSchedule, runsOn, scheduleDirective, scheduleLine, tickSchedule,
  LATE_GRACE_MIN, excuseElapsedToday,
} from "../src/engine/schedule";
import { isWeekend, weekdayIndex } from "../src/engine/time";
import { newSave, registerCharacter, sanitize } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(time = "Day 1, 07:30"): SaveState {
  const s = newSave("week", {
    name: "The Yard",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Sera", character_id: "char_sera", pronouns: "she/her" } as any);
  s.world.current_turn = 10;
  s.world.current_time = time;
  const home = "loc_flat", yard = "loc_yard";
  s.world.places[home] = { id: home, name: "the flat", description_facts: "Two rooms.", contains: [] } as any;
  s.world.places[yard] = { id: yard, name: "the tannery yard", description_facts: "Vats and a long shed.", contains: [] } as any;
  s.world.player_location = home;
  s.characters.char_player.location = home;
  s.characters.char_sera.location = home;
  s.world.present = ["char_sera"];
  s.characters.char_sera.schedule = {
    blocks: [newBlock({
      what: "the early shift at the tannery", where: "the tannery yard",
      why: "it is the only yard that took her back after the strike",
      how: "walks the towpath", travel_min: 20,
      start: "08:00", end: "16:00", days: "weekdays",
      rigidity: "mandatory", stakes: "the foreman docks the day and remembers it",
    })],
    home: "the flat",
  };
  return s;
}

/* ── 1. there is a week, with or without a calendar ──────────────────────────── */
{
  // No start_date: Day 1 is a Monday, and the week counts on from there.
  check("Day 1 is a Monday when the bible names no date", weekdayIndex("Day 1, 09:00") === 1);
  check("Day 6 is a Saturday", isWeekend("Day 6, 09:00") && weekdayIndex("Day 6, 09:00") === 6);
  check("Day 7 is a Sunday", isWeekend("Day 7, 09:00") && weekdayIndex("Day 7, 09:00") === 0);
  check("Day 8 is a Monday again", !isWeekend("Day 8, 09:00") && weekdayIndex("Day 8, 09:00") === 1);
  // With one, the real calendar wins: 2035-06-15 was a Friday.
  check("a real date beats the synthetic week", weekdayIndex("Day 1, 09:00", "2035-06-15") === 5);
  check("weekdays run Mon–Fri", [1, 2, 3, 4, 5].every((d) => runsOn("weekdays", d)) && !runsOn("weekdays", 0) && !runsOn("weekends", 3));
  check("an explicit day list is honoured", runsOn([2, 5], 5) && !runsOn([2, 5], 4));
}

/* ── 2. they know what is coming, and only as far ahead as a person would ────── */
{
  const s = world("Day 1, 07:00");   // an hour before the shift, 40 min before she has to leave
  const line = scheduleLine(s, "char_sera");
  check("the card says what is next and how long they have", /next: the early shift/.test(line) && /sets out in \d+ min/.test(line), line);
  check("the card names the day of the week", /Monday/.test(line), line);

  const early = world("Day 1, 02:00");
  check("nothing is on their mind at two in the morning", !/next: the early shift/.test(scheduleLine(early, "char_sera")), scheduleLine(early, "char_sera"));

  const sat = world("Day 6, 07:00");
  const satLine = scheduleLine(sat, "char_sera");
  check("a weekday shift is not due on Saturday", !/set out|ALREADY DUE/.test(satLine), satLine);
  check("and the next one is named as being days off", /Monday|in \d+ days|nothing on their week/.test(satLine), satLine);
}

/* ── 3. offscreen, they go on their own ──────────────────────────────────────── */
{
  const s = world("Day 1, 08:10");
  s.world.present = [];                       // the player is not with her
  s.characters.char_sera.location = "loc_flat";
  s.world.player_location = "loc_market";
  s.world.places.loc_market = { id: "loc_market", name: "the market", description_facts: "", contains: [] } as any;
  const log = tickSchedule(s);
  check("she is at the yard when her shift is running", s.characters.char_sera.location === "loc_yard", s.characters.char_sera.location);
  check("and the world-motion log says so", log.some((l) => /tannery yard/.test(l)), log);

  // and home again once it is over, rather than standing in a dark yard all night
  s.world.current_time = "Day 1, 16:30";
  tickSchedule(s);
  check("she goes home when the shift ends", s.characters.char_sera.location === "loc_flat", s.characters.char_sera.location);
}
{
  // The travel window is not the shift: she is not at work before work.
  const s = world("Day 1, 07:45");
  s.world.present = [];
  s.world.player_location = "loc_market";
  s.world.places.loc_market = { id: "loc_market", name: "the market", description_facts: "", contains: [] } as any;
  tickSchedule(s);
  check("she has not arrived before the hour", s.characters.char_sera.location === "loc_flat", s.characters.char_sera.location);
}

/* ── 4. onscreen, nobody is teleported out of a live scene ───────────────────── */
{
  const s = world("Day 1, 07:45");            // inside the travel window, standing with the player
  const d = scheduleDirective(s, s.world.present);
  check("the narrator is told she has to go", /HAS TO SET OUT NOW/.test(d), d);
  check("the leaving is hers to do, not the player's to permit", /without being asked|without waiting for permission/.test(d), d);
  check("staying stays available, with a price on it", /staying COSTS THEM SOMETHING/.test(d), d);
  check("and the reason it exists comes with it", /only yard that took her back/.test(d), d);

  tickSchedule(s);
  check("the engine does not move her out of the scene", s.characters.char_sera.location === "loc_flat", s.characters.char_sera.location);
  check("and she is still in it", s.world.present.includes("char_sera"), s.world.present);
}
{
  // held ten minutes past the hour: pressed, still not moved
  const s = world("Day 1, 08:10");
  check("late is stated as late", /LATE FOR/.test(scheduleDirective(s, s.world.present)));
  tickSchedule(s);
  check("ten minutes late is the story's business, not the engine's", s.characters.char_sera.location === "loc_flat");
}
{
  // held well past the grace: the engine stops waiting for a goodbye that is not coming
  const s = world(`Day 1, ${String(8 + Math.floor((LATE_GRACE_MIN + 20) / 60)).padStart(2, "0")}:${String((LATE_GRACE_MIN + 20) % 60).padStart(2, "0")}`);
  const log = tickSchedule(s);
  check("past the grace she goes", s.characters.char_sera.location === "loc_yard", s.characters.char_sera.location);
  check("and is out of the scene", !s.world.present.includes("char_sera"), s.world.present);
  check("the narrator is told she has already gone", (s.world.departures_pending ?? []).some((x) => x.name === "Sera"), s.world.departures_pending);
  check("she remembers being held up", (s.memory.char_sera.episodic ?? []).some((m) => /Left late/.test(m.content)), s.memory.char_sera.episodic);
  check("and it is in the world-motion log", log.some((l) => /late for/.test(l)), log);
}
{
  // an OPTIONAL block is never forced — the scene simply wins
  const s = world("Day 1, 12:00");
  s.characters.char_sera.schedule!.blocks[0].rigidity = "optional";
  tickSchedule(s);
  check("an optional commitment loses to the scene", s.characters.char_sera.location === "loc_flat", s.characters.char_sera.location);
}

/* ── 5. what did not happen is a thing that happened ─────────────────────────── */
{
  const s = world("Day 1, 08:30");
  tickSchedule(s);                         // she is present and past the hour: the scene is holding her
  s.world.current_time = "Day 1, 16:30";   // the shift has been and gone
  s.characters.char_sera.schedule!.blocks[0].rigidity = "optional";   // so the engine never forced her out
  const log = tickSchedule(s);
  check("a shift the scene ate is recorded as missed", s.characters.char_sera.schedule!.blocks[0].last_missed_day === 1);
  check("she remembers not going", (s.memory.char_sera.episodic ?? []).some((m) => /Did not go/.test(m.content)));
  check("and the world says so", log.some((l) => /missed/.test(l)), log);
}
{
  // A TIME SKIP IS NOT A MISSED SHIFT. Nobody was looking at her; she went to work.
  const s = world("Day 1, 22:00");
  s.world.present = [];
  s.characters.char_sera.location = "loc_flat";
  s.world.player_location = "loc_market";
  s.world.places.loc_market = { id: "loc_market", name: "the market", description_facts: "", contains: [] } as any;
  const log = tickSchedule(s);
  check("a skipped-over day is not a missed shift", s.characters.char_sera.schedule!.blocks[0].last_missed_day === undefined);
  check("nothing is announced about it", !log.some((l) => /missed/.test(l)), log);
}
{
  // the stated cost becomes a scheduled consequence, through the ordinary machinery
  const s = world("Day 1, 08:30");
  tickSchedule(s);
  s.world.current_time = "Day 1, 17:00";
  s.characters.char_sera.schedule!.blocks[0].rigidity = "optional";  // avoid the forced exit, keep the stakes
  s.characters.char_sera.schedule!.blocks[0].rigidity = "mandatory";
  s.characters.char_sera.location = "loc_flat";
  tickSchedule(s);
  check("a cost written down is a cost that lands", s.world.consequences.some((c) => /docks the day/.test(c.description)), s.world.consequences);
}
{
  // ...and never at tension 0, where the engine originates nothing
  const s = world("Day 1, 08:30");
  s.model_settings.tension = 0;
  tickSchedule(s);
  s.world.current_time = "Day 1, 17:00";
  s.characters.char_sera.location = "loc_flat";
  tickSchedule(s);
  check("tension 0 still originates nothing", !s.world.consequences.length, s.world.consequences);
}
{
  // the player let her off: no shift, no miss, no cost, and it comes round again tomorrow
  const s = world("Day 1, 08:30");
  s.characters.char_sera.schedule!.blocks[0].excused_day = 1;
  tickSchedule(s);
  check("an excused day is not a departure", s.characters.char_sera.location === "loc_flat");
  s.world.current_time = "Day 1, 17:00";
  tickSchedule(s);
  check("nor a miss", s.characters.char_sera.schedule!.blocks[0].last_missed_day === undefined);
  check("and tomorrow it is back", !!readSchedule({ ...s, world: { ...s.world, current_time: "Day 2, 07:00" } } as SaveState, "char_sera").next);
}

/* ── 6. a week written at noon does not start this morning ───────────────────── */
{
  const s = world("Day 1, 10:10");   // two hours past a shift that has only just been written down
  const b = s.characters.char_sera.schedule!.blocks[0];
  excuseElapsedToday(s, b, s.characters.char_sera.location);
  check("the hour that already went by is excused", b.excused_day === 1);
  tickSchedule(s);
  check("nobody is walked out of a scene for a morning they already lived", s.characters.char_sera.location === "loc_flat");
  check("and it comes round again tomorrow", !!readSchedule({ ...s, world: { ...s.world, current_time: "Day 2, 07:20" } } as SaveState, "char_sera").next);
}

/* ── 7. it is optional, and it survives a hand-edit ──────────────────────────── */
{
  const s = world();
  delete s.characters.char_sera.schedule;
  check("a character without a week has no schedule line", scheduleLine(s, "char_sera") === "");
  check("and no directive", scheduleDirective(s, s.world.present) === "");
  check("and the tick leaves them alone", tickSchedule(s).length === 0 && s.characters.char_sera.location === "loc_flat");
  check("hasSchedule is honest about it", !hasSchedule(s.characters.char_sera));
}
{
  // the raw JSON editor is a hostile input: a start time typed as a string used to make every
  // comparison against it false, so the character silently never went anywhere again
  const s = world();
  (s.characters.char_sera.schedule!.blocks[0] as any).start = "08:00";
  (s.characters.char_sera.schedule!.blocks[0] as any).days = "WEEKDAYS";
  (s.characters.char_sera.schedule!.blocks[0] as any).rigidity = "nonsense";
  sanitize(s);
  const b = s.characters.char_sera.schedule!.blocks[0];
  check("a hand-typed clock string is coerced", b.start === 480, b.start);
  check("a hand-typed day spec is coerced", b.days === "weekdays", b.days);
  check("an unreadable rigidity falls back rather than crashing", b.rigidity === "expected", b.rigidity);
  const junk = world();
  (junk.characters.char_sera.schedule as any).blocks = [{ what: "", where: "" }, null];
  sanitize(junk);
  check("an empty block is dropped, not kept as a ghost",
    !(junk.characters.char_sera.schedule?.blocks ?? []).length && !hasSchedule(junk.characters.char_sera));
  const bare = world();
  bare.characters.char_sera.schedule = { blocks: [] };
  sanitize(bare);
  check("a schedule with nothing in it at all is removed", !bare.characters.char_sera.schedule);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
