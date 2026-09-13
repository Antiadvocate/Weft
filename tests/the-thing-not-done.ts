/* THE CAT THAT NEVER GOT TAKEN TO THE VET.
 *
 * The player who built this engine, describing his own afternoon: the cat is sick and that is the
 * day's job. Then an email lands about his son's birthday, so now there is a cake. The cake needs
 * decorations. His mother needs collecting at a time already agreed. By nightfall the cat is still
 * sick, he has nothing left, and the cat has been on the list the whole time getting heavier.
 *
 * Four things in that the engine had no model for, and the first two are the engine's assumptions
 * running backwards:
 *
 *   You do not do the most important thing — you do the one the moment affords.
 *   Past a certain weight, importance stops pulling you toward a thing and starts pushing you off.
 *   The set-aside thing accrues on its own.
 *   And it charges on RECALL. You are fine until you walk past the cat.
 *
 * This also settles an argument from earlier in the same session. "Her wants have been skipped 9
 * turns" was a toast the player found useless and it was suppressed as noise. Skipping is not a
 * fault — nobody deals with the cat while they are buying the cake. What was missing is that it
 * should cost something by the time you get home. */
import { neglectOf, dreadOf, recalledBy, neglectCue, tickNeglect, liveWant } from "../src/engine/neglect";
import { newSave, registerCharacter } from "../src/engine/state";
import type { NPCDrive, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const want = (goal: string, o: Partial<NPCDrive> = {}): NPCDrive =>
  ({ goal, progress: 0, updated_turn: 0, progress_turn: 0, priority: 2, ...o } as NPCDrive);

/* ── NEGLECT IS MEASURED FROM MOVEMENT, NOT FROM BEING WRITTEN ABOUT ────────────────────────
 * progress_turn exists precisely because the bookkeeper restamps updated_turn every time it
 * rewrites a blocker, which it does constantly while a question is on the table. A want being
 * asked again is not a want being worked on. */
{
  const d = want("take the cat to Mr. Pargeter", { updated_turn: 40, progress_turn: 8 });
  check("neglect counts from the last real movement", neglectOf(d, 40) === 32, neglectOf(d, 40));
  check("a want that moved this turn is not neglected", neglectOf(want("x", { progress_turn: 40 }), 40) === 0);
  check("no want, no neglect", neglectOf(undefined, 40) === 0);
}

/* ── AND DREAD IS NOT JUST STALENESS ───────────────────────────────────────────────────────
 * A low-priority unblocked errand can sit untouched for a month and weigh nothing. What makes a
 * thing heavy is that it matters AND it is hard, which is what a blocker records. */
{
  const heavy = want("tell Rabi what happened to the money", { priority: 3, blocker: "she cannot say it out loud", progress_turn: 0 });
  const errand = want("get the good scissors back off Olga", { priority: 1, progress_turn: 0 });
  check("the hard important thing gets heavy", dreadOf(heavy, 40) > 0.6, dreadOf(heavy, 40));
  check("…and the small errand does not, at the same age", dreadOf(errand, 40) < 0.4, dreadOf(errand, 40));
  check("nothing weighs anything inside the patience window", dreadOf(heavy, 4) === 0, dreadOf(heavy, 4));
  check("…and it starts to, past it", dreadOf(heavy, 14) > 0, dreadOf(heavy, 14));
  check("it ramps rather than switching on", dreadOf(heavy, 14) < dreadOf(heavy, 26), [dreadOf(heavy, 14), dreadOf(heavy, 26)]);
  check("a finished want weighs nothing at all",
    dreadOf(want("done", { progress: 100, progress_turn: 0 }), 90) === 0);
}

/* ── WHAT PUTS IT BACK IN FRONT OF THEM ─────────────────────────────────────────────────────
 * "Some goals only appear when you're in the space itself, and if you don't write it down then it
 * vanishes until you come back to that space." */
function room(): SaveState {
  const s: any = newSave("neglect", {
    name: "England", era: "1932", technology_level: "interwar", magic_rules: "none", forbidden: "",
    what_people_fear: "the means test", cultures_and_languages: "english", climate_and_geography: "wet",
    calendar_and_currency: "sterling", political_situation: "the slump",
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_lobby"] = { id: "loc_lobby", name: "the Ritz lobby", description_facts: "a marble floor and a long desk" };
  s.world.player_location = "loc_lobby";
  return s;
}
{
  const s = room();
  const olga = registerCharacter(s, { name: "Olga Reiter", age: 34 } as any);
  s.world.present = [olga];
  check("the person the want is about walks in", recalledBy(s, "get Rabi to say where the money went") === "Rabi");
  check("…or the place it belongs to is where they are", recalledBy(s, "get the lobby desk cleared before six") !== null);
  check("nothing in the room names it, nothing surfaces",
    recalledBy(s, "write to her sister in Hull") === null, recalledBy(s, "write to her sister in Hull"));
  check("an empty want recalls nothing", recalledBy(s, "") === null);
}

/* ── AND IT LANDS ON RECALL, ONCE ──────────────────────────────────────────────────────────── */
{
  const s = room();
  const olga = registerCharacter(s, {
    name: "Olga Reiter", age: 34,
    drive: want("tell Rabi what happened to the money", { priority: 3, blocker: "she cannot say it out loud", progress_turn: 0 }),
  } as any);
  s.world.present = [olga];
  const before = s.condition[olga].psyche.relaxation;
  const log = tickNeglect(s, 40);
  const after = s.condition[olga].psyche.relaxation;
  check("being reminded of it costs them", after < before - 1, [before, after]);
  check("…and it is reported", log.length === 1, log);
  check("…and it shows on them as a state", s.condition[olga].psyche.active_states.includes("the thing they have not done"));
  const again = tickNeglect(s, 41);
  check("standing in the same room twice does not charge twice", again.length === 0 && s.condition[olga].psyche.relaxation === after);
}
{
  const s = room();
  const olga = registerCharacter(s, {
    name: "Olga Reiter", age: 34,
    drive: want("write to her sister in Hull", { priority: 3, blocker: "no", progress_turn: 0 }),
  } as any);
  s.world.present = [olga];
  const before = s.condition[olga].psyche.relaxation;
  check("a heavy want nothing here names costs nothing yet",
    tickNeglect(s, 40).length === 0 && s.condition[olga].psyche.relaxation === before);
}
{
  const s = room();
  const olga = registerCharacter(s, { name: "Olga Reiter", age: 34, drive: want("find Rabi", { progress_turn: 39 }) } as any);
  s.world.present = [olga];
  check("a want they are actually working on is not a weight", tickNeglect(s, 40).length === 0);
}
/* THE MORE IGNORED, THE HARDER IT DROPS — but not so hard that a glance across a room takes
 * somebody from settled to shattered. */
{
  const drop = (age: number) => {
    const s = room();
    const olga = registerCharacter(s, { name: "Olga Reiter", age: 34,
      drive: want("tell Rabi about the money", { priority: 3, blocker: "cannot say it", progress_turn: 0 }) } as any);
    s.world.present = [olga];
    const b = s.condition[olga].psyche.relaxation;
    tickNeglect(s, age);
    return b - s.condition[olga].psyche.relaxation;
  };
  check("a fortnight of avoiding it hurts more than a week", drop(30) > drop(12), [drop(12), drop(30)]);
  check("…and it is still survivable", drop(200) <= 3, drop(200));
}

/* ── WHICH ONE THEY ACTUALLY TAKE UP ────────────────────────────────────────────────────────
 * The cake, not the cat. Importance loses to what the moment affords, and loses again to having
 * nothing left. */
{
  const s = room();
  const olga = registerCharacter(s, {
    name: "Olga Reiter", age: 34,
    drive: want("tell Rabi what happened to the money", { priority: 3, blocker: "she cannot say it out loud", progress_turn: 0 }),
    drive_queue: [want("get the lobby desk cleared before six", { priority: 1, progress_turn: 38 })],
  } as any);
  s.world.present = [olga];
  const cond = s.condition[olga];

  cond.fatigue = "fresh"; cond.psyche.relaxation = 2;
  const rested = liveWant(s, olga, 40);
  check("rested, with him in the room, she goes at the hard thing",
    /money/.test(rested?.goal ?? ""), rested);

  cond.fatigue = "exhausted";
  const spent = liveWant(s, olga, 40);
  check("with nothing left, she does the desk instead", /desk/.test(spent?.goal ?? ""), spent);
  check("…and the engine says why in words the narrator can use",
    /reserve/.test(spent?.why ?? ""), spent);

  cond.fatigue = "fresh"; cond.psyche.relaxation = -7;
  check("badly clenched does the same thing as exhausted", /desk/.test(liveWant(s, olga, 40)?.goal ?? ""));
  check("nobody with no wants takes one up", liveWant(s, "char_player", 40) === null);
}

/* ── AND WHAT THE NARRATOR IS TOLD IT LOOKS LIKE ───────────────────────────────────────────── */
{
  const heavy = want("tell Rabi about the money", { priority: 3, blocker: "cannot say it", progress_turn: 0 });
  check("a fresh want gets no cue at all", neglectCue(want("x", { progress_turn: 39 }), 40) === "");
  const bad = neglectCue(heavy, 60);
  check("a badly avoided one reads as avoidance, not as a plan", /flinch off the subject/.test(bad), bad);
  check("…and names the easy thing they do instead", /easy thing in front of them/.test(bad));
  check("…and says how long, so the prose can pitch it", /\d+ turns/.test(bad), bad);
  const mid = neglectCue(heavy, 20);
  check("a middling one is milder", !/flinch/.test(mid) && mid.length > 0, mid);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
