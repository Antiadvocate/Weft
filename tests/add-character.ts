/* Smoke test: A PERSON THE PLAYER ASKED FOR, AND A LIST THAT HAS TO CLOSE.
 *
 * Two things a player asked for after a long save:
 *
 *   "It's not making characters. Even if code names them. Give me a way to manually create a
 *    prefilled character based on just a prompt."
 *   "I also have way too many threads that aren't doing anything. I think we should max out at 5 or
 *    6 threads tops. Because I need them to go somewhere or close."
 *
 * The first is a gap: completeSketch could already build a whole person out of world context, and
 * the only thing it could not do was start from a sentence the player typed rather than from prose
 * the narrator had already written.
 *
 * The second was half-built. sweepThreads has capped the LIVE list at MAX_LIVE for a while, but it
 * capped by demoting the surplus to dormant once a turn — which kept the pressure pool honest and
 * did nothing about the cause. The world opened new questions faster than it answered old ones, so
 * every turn the newest thread pushed an older one out of sight and nothing was ever finished. The
 * cap binds at CREATION now, and the bookkeeper is told how many slots are left.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import { sweepThreads, MAX_LIVE, DORMANT_AFTER } from "../src/engine/threads";
import { simulatorContext } from "../src/engine/prompts";
import { RECORD_FIELDS, SKETCH_SYSTEM } from "../src/engine/sketch";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(threadCount = 0) {
  const s: any = newSave("t", { name: "Rabi" } as any);
  s.world.places["loc_inn"] = { id: "loc_inn", name: "The inn", description_facts: "Smoke.", contains: [], identity: "Lucia's inn." };
  s.world.player_location = "loc_inn";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.characters["char_player"].location = "loc_inn";
  s.world.current_turn = 30;
  // Distinct subjects on purpose: applyDiff collapses near-duplicate titles, and six variations of
  // "Situation N" are near-duplicates by any measure — the fixture would be testing the deduper.
  const SUBJECTS = [
    "Who owns the roof", "The grain tally is short", "Marcus will not go home",
    "A rider was seen on the hill road", "Greta's brother has not written", "The well tastes of iron",
  ];
  for (let i = 0; i < threadCount; i++) {
    s.world.threads.push({
      id: `thr_${i}`, title: SUBJECTS[i % SUBJECTS.length], status: "active", description: `d${i}`,
      turn_started: 20, last_touched_turn: 29, tension: 4,
    });
  }
  return s;
}

/* ── 1. THE LIST IS FULL, SO THE SEVENTH IS REFUSED ──────────────────────────── */
{
  const s = world(MAX_LIVE);
  applyDiff(s, {
    scene_summary: "x", elapsed_minutes: 5,
    threads_update: [{ title: "Something brand new", status: "active", description: "n", tension: 4 }],
  } as any, "I wait", "Nothing much.", false);
  const live = s.world.threads.filter((t: any) => t.status === "active");
  check("no seventh thread was opened", live.length === MAX_LIVE, live.length);
  check("...and it was refused rather than opened and buried",
    !s.world.threads.some((t: any) => t.title === "Something brand new"), s.world.threads.map((t: any) => t.title));
}

/* ── 2. but closing one makes room ───────────────────────────────────────────── */
{
  const s = world(MAX_LIVE);
  applyDiff(s, {
    scene_summary: "x", elapsed_minutes: 5,
    threads_update: [
      { id: "thr_0", title: "Who owns the roof", status: "resolved" },
      { title: "Something brand new", status: "active", description: "n", tension: 4 },
    ],
  } as any, "I settle it", "It was settled.", false);
  check("the resolved one is closed", s.world.threads.find((t: any) => t.id === "thr_0")?.status === "resolved");
  check("and the new one got the freed slot",
    s.world.threads.some((t: any) => t.title === "Something brand new" && t.status === "active"),
    s.world.threads.map((t: any) => `${t.title}:${t.status}`));
  check("the live count is still at the cap", s.world.threads.filter((t: any) => t.status === "active").length === MAX_LIVE);
}

/* ── 3. under the cap, a new thread opens normally ───────────────────────────── */
{
  const s = world(2);
  applyDiff(s, {
    scene_summary: "x", elapsed_minutes: 5,
    threads_update: [{ title: "A real new one", status: "active", description: "n", tension: 4 }],
  } as any, "I ask about the roof", "She told him about the roof.", false);
  check("room on the list means the thread opens", s.world.threads.some((t: any) => t.title === "A real new one"));
}

/* ── 4. and the bookkeeper is TOLD, which is what turns a refusal into a reason ─ */
{
  const full = simulatorContext(world(MAX_LIVE));
  check("the budget is stated", new RegExp(`THREAD BUDGET: ${MAX_LIVE} of ${MAX_LIVE} open`).test(full), full.match(/THREAD BUDGET:[^\n]*/)?.[0]);
  check("...and that a new one will be refused", /THE LIST IS FULL/.test(full));
  check("...and how to make room", /mark a thread resolved when the scene has actually settled it/.test(full));
  check("...without inviting a fake resolution", /Do not resolve one that is still open just to free a slot/.test(full));

  const room = simulatorContext(world(2));
  check("with room, it says how much", new RegExp(`You may open ${MAX_LIVE - 2} more`).test(room), room.match(/THREAD BUDGET:[^\n]*/)?.[0]);
}

/* ── 5. dormant is not a resting place ───────────────────────────────────────── */
{
  const s = world(1);
  s.world.threads[0].status = "dormant";
  s.world.threads[0].last_touched_turn = 1;
  s.world.current_turn = 1 + DORMANT_AFTER * 4;
  const log = sweepThreads(s, "nothing to do with it");
  check("a thread nobody has touched in a very long time is let go",
    s.world.threads[0].status === "abandoned", s.world.threads[0].status);
  check("and it says so once", log.some((l) => /Let go:/.test(l)), log);
  check("the text is kept, not deleted", !!s.world.threads[0].title);

  // and a merely-dormant one is left alone
  const s2 = world(1);
  s2.world.threads[0].status = "dormant";
  s2.world.threads[0].last_touched_turn = s2.world.current_turn - 2;
  sweepThreads(s2, "unrelated");
  check("a recently dormant thread is still just dormant", s2.world.threads[0].status === "dormant");
}

/* ── 6. the character record is defined ONCE, for both ways a person is made ─── */
{
  check("the schema is shared", RECORD_FIELDS.length > 1000);
  check("the sketch pass uses it", SKETCH_SYSTEM.includes(RECORD_FIELDS.slice(0, 200)));
  for (const field of ["appearance_facts", "core_traits", "background", "drive_goals", "under_threat"]) {
    check(`both passes ask for ${field}`, RECORD_FIELDS.includes(field));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
