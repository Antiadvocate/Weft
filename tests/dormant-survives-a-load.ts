/* Smoke test: ONE MISSING WORD IN AN ALLOW-LIST UNDID THE ENTIRE THREAD SYSTEM.
 *
 * "Like 40 threads. Means nothing. Nothing actually happened."
 *
 * The save: 128 turns in a two-hander about an apartment. Twenty-three threads, ten of them about
 * the same pair of shoes by the front door, most opened and resolved within a turn or two of each
 * other. The measurement that gives it away is not the thread list, though — it is the offscreen
 * feed, which is the only window the player has on the world moving:
 *
 *     458 lines of "Nobody has thought about it in a while: <thread>", across 128 turns
 *     105 of them about ONE thread, on turns 40, 41, 42, 44, 45, 46, 47, 48, ...
 *     77% of every world-motion line the player was ever shown
 *     0 lines of "Back in play", 0 of "A new thread", 0 of "Thread resolved"
 *
 * That line is only emitted on the active → dormant transition, so a thread reporting it on eight
 * consecutive turns is being set back to active eight times. Nothing in the turn loop does that.
 * `sanitize` does:
 *
 *     status: ["active", "resolved", "abandoned"].includes(t.status) ? t.status : "active"
 *
 * No "dormant". `getSave` sanitizes, and every turn begins with a `getSave`, so the sweep demoted a
 * thread, the store woke it, and the sweep demoted it again — forever, and once per turn in the
 * player's face. Everything downstream follows: nothing could reach `abandoned` (which needs a
 * thread to have BEEN dormant when a sweep began), so the list only ever grew; MAX_LIVE's demotions
 * were undone the same way; and `liveThreads` — the narrator's digest, the pressure pool — was
 * handed every situation that had ever existed, on every turn, for the length of the game.
 *
 * The dormancy code was fine. It had simply never once survived a turn boundary.
 */
import { sanitize } from "../src/engine/state";
import { THREAD_STATUSES } from "../src/engine/types";
import { sweepThreads, liveThreads, DORMANT_AFTER } from "../src/engine/threads";
import { declaredMinutes } from "../src/engine/time";
import type { SaveState, Thread } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const save = (threads: Partial<Thread>[], turn: number): SaveState => sanitize({
  id: "s", name: "n", world_bible: {}, model_settings: {}, characters: {}, traits: {}, condition: {},
  memory: {}, history: [],
  world: { current_turn: turn, threads, clocks: [], rumors: [], edges: [], norms: [], consequences: [], canon: [], places: {} },
} as unknown as SaveState);

/* ── 1. the allow-list covers the union, and the compiler says so ────────────── */
check("every thread status is on the list sanitize validates against",
  ["active", "dormant", "resolved", "abandoned"].every((s) => (THREAD_STATUSES as readonly string[]).includes(s)),
  THREAD_STATUSES);

/* ── 2. a dormant thread survives the round trip a turn begins with ──────────── */
{
  const s = save([{ id: "a", title: "Amber's Hidden Drawings", description: "d", status: "dormant", tension: 4, turn_started: 1, last_touched_turn: 9 }], 60);
  check("dormant is still dormant after a load", s.world.threads[0].status === "dormant", s.world.threads[0].status);
  check("...and out of the pressure pool, which is the whole point", liveThreads(s).length === 0);
}

/* ── 3. and therefore the sweep says it once, not once a turn forever ────────── */
{
  // the save's own numbers: a thread last touched at turn 9, played from turn 40 to 48
  let s = save([{ id: "a", title: "Amber's Hidden Drawings", description: "the drawings under the bed", status: "active", tension: 4, turn_started: 1, last_touched_turn: 9 }], 39);
  const lines: string[] = [];
  for (let turn = 40; turn <= 48; turn++) {
    s.world.current_turn = turn;
    lines.push(...sweepThreads(s, "Nothing in this scene is about that."));
    s = sanitize(s);                      // what getSave does at the top of every turn
  }
  const said = lines.filter((l) => /Nobody has thought about it in a while/.test(l));
  check("the world says a thread has gone quiet exactly once", said.length === 1, lines);
  check("and it stays quiet across nine turns of loads", s.world.threads[0].status === "dormant");
}

/* ── 4. which is what lets a thread ever actually be let go ──────────────────── */
{
  let s = save([{ id: "a", title: "The buried box", description: "d", status: "active", tension: 2, turn_started: 1, last_touched_turn: 1 }], 1);
  let released = false;
  for (let turn = 2; turn <= 400 && !released; turn++) {
    s.world.current_turn = turn;
    released = sweepThreads(s, "unrelated").some((l) => /Let go:/.test(l));
    s = sanitize(s);
  }
  check("a thread nobody ever returns to is eventually released", released, s.world.threads[0]);
  check("...which requires it to have spent real time dormant first",
    (s.world.threads[0].last_touched_turn ?? 0) + DORMANT_AFTER < s.world.current_turn);
}

/* ── 5. and the player's own message is not a bill for the turn ──────────────── */
{
  // verbatim from the save, turn 109. It moved 13:36 in the afternoon to 23:36 at night, while the
  // narrator — handed the same scene — wrote "the gray light has thinned and brightened past noon".
  const texted = "I text her *hey hope it went well. Sorry about earlier. I think 10 hours of being tense about your interview and questions and all rattled me. I hope I prepped you enough.*";
  check("words inside a text message do not bill the turn", declaredMinutes(texted) === 0, declaredMinutes(texted));
  check("nor do a character's spoken words", declaredMinutes(`"I waited three hours for you"`) === 0);
  check("nor a private thought", declaredMinutes("(I've been at this four hours)") === 0);
  // ...and the thing the field is actually for still works
  check("but the player narrating what they did still counts",
    declaredMinutes(`"Sure" I spend a few hours interviewing her`) === 180, declaredMinutes(`"Sure" I spend a few hours interviewing her`));
  check("...including a plain declaration", declaredMinutes("I work for two hours") === 120);
  check("...and a mixed line bills the narration, not the speech",
    declaredMinutes(`"Give me ten minutes" I say, and then I sleep for eight hours`) === 480);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
