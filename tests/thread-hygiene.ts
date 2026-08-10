/* Smoke test: A LIST OF EVERY SITUATION THAT EVER EXISTED.
 *
 * "Holy fuck that's a lot of threads that do absolutely nothing in the story."
 *
 * Turn 108 of one save: fourteen threads, twelve still active, NONE ever resolved, nine sitting at
 * exactly the tension they were created with. The oldest had been open since turn 1. Two were the
 * same symptom ("The first cramp" and "The cramp that outgrew the log"); three were one deception
 * split three ways; and one, still active, had a description reading "The old flinch is gone; she
 * moves toward him without hesitation" — a thread whose own text says it is over.
 *
 * The first cause is embarrassing. The JSON template the bookkeeper copies read
 *
 *     "threads_update":[{ ..., "status":"active", ..., "tension":3 }]
 *
 * with those as literal values. A model filling in a template copies what it is shown — which is
 * the histogram exactly. And the contract, in both its full and lean forms, explained when to OPEN
 * a thread and never once mentioned closing one.
 *
 * The second is that the engine never checked either. The pressure system picks what to press on
 * from this list, so a pile of dead situations makes the pressure arbitrary, which is what it felt
 * like from the inside. */
import { DORMANT_AFTER, liveThreads, sweepThreads } from "../src/engine/threads";
import { simulatorSchemaHint, simulatorSystem } from "../src/engine/prompts";
import type { SaveState, Thread } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const th = (over: Partial<Thread>): Thread => ({
  id: "thr_x", title: "The buried box", description: "Still pending discovery.",
  status: "active", turn_started: 1, tension: 3, ...over,
} as Thread);
const save = (threads: Thread[], turn = 108): SaveState =>
  ({ world: { current_turn: turn, threads }, history: [] } as unknown as SaveState);

/* ── the contract now has the half it was missing ────────────────────────────── */
for (const [tag, t] of [["full", simulatorSystem(false)], ["lean", simulatorSystem(true)]] as const) {
  check(`${tag}: closing a thread is asked for at all`, /resolved/.test(t) && /(CLOSE THEM TOO|Mark it "resolved")/.test(t));
  check(`${tag}: and tension is told to move`, /(lower its tension|lower tension)/.test(t));
}
{
  // the template must not read as a constant, or it gets copied as one
  const t = simulatorSchemaHint();
  const tpl = /"threads_update":\[\{[\s\S]*?\}\]/.exec(t)?.[0] ?? "";
  check("the example no longer hardcodes an always-active status", !/"status":"active"[,}]/.test(tpl), tpl.slice(0, 160));
  check("nor a constant tension of 3", !/"tension":3[,}]/.test(tpl), tpl.slice(0, 160));
  check("it shows resolution as an option", /resolved/.test(tpl), tpl.slice(0, 200));
}

/* ── the sweep, which exists because asking was not enough ───────────────────── */
{
  // MIGRATION: a save from before this field existed must not have its world gutted on first run.
  // Reconstructing a touch from the prose was tried and retired ten of twelve threads on the real
  // save — including the one the pressure system had cited two turns earlier.
  const s = save([th({ turn_started: 1 }), th({ id: "b", title: "Jess's secret", turn_started: 44 })]);
  const log = sweepThreads(s, "Nothing about either of these.");
  check("the first sweep on an old save retires nothing", liveThreads(s).length === 2, log);
  check("and it starts the clock instead", s.world.threads.every((t) => t.last_touched_turn === 108));
}
{
  const s = save([th({ last_touched_turn: 108 - DORMANT_AFTER - 1 })]);
  sweepThreads(s, "unrelated prose");
  check("a thread nobody has touched for a long time goes dormant", s.world.threads[0].status === "dormant");
  check("it is not deleted — a buried box is not gone, just not today's story",
    s.world.threads.length === 1 && !!s.world.threads[0].title);
  check("and it drops out of what the pressure system may press on", liveThreads(s).length === 0);
}
{
  const s = save([th({ last_touched_turn: 100 })]);
  sweepThreads(s, "unrelated");
  check("a recently touched thread stays live", s.world.threads[0].status === "active");
}
{
  const s = save([th({ last_touched_turn: 40, title: "The dug corner", description: "Someone opened ground in the yard without being let in and the sod was already peeled back." })]);
  sweepThreads(s, "She stood at the window looking at the peeled sod where someone had opened the ground in the yard, uninvited.");
  check("prose that is genuinely about a thread keeps it alive", s.world.threads[0].status === "active", s.world.threads[0]);
  check("and records the touch", s.world.threads[0].last_touched_turn === 108);
}
{
  const s = save([th({ status: "dormant", last_touched_turn: 40, title: "The dug corner", description: "Someone opened ground in the yard without being let in, sod peeled back." })]);
  const log = sweepThreads(s, "The sod was still peeled back where the ground had been opened in the yard, and nobody had been let in.");
  check("a dormant thread wakes when the story returns to it", s.world.threads[0].status === "active", log);
  check("and says so", log.some((l) => /Back in play/.test(l)), log);
}
{
  // a couple of incidental word matches is not the story returning to a subject
  const s = save([th({ last_touched_turn: 40, title: "The buried box", description: "A box was buried in the garden behind the shed and nobody has dug it up." })]);
  sweepThreads(s, "She put the cereal box back in the cupboard and went to the garden for air.");
  check("glancing word overlap does not resurrect a dead thread", s.world.threads[0].status === "dormant", s.world.threads[0]);
}
{
  const s = save([th({ tension: 0, last_touched_turn: 107 })]);
  sweepThreads(s, "unrelated");
  check("a thread cooled to nothing retires even if it was touched", s.world.threads[0].status === "dormant");
}
{
  const s = save([th({ status: "resolved", last_touched_turn: 1 }), th({ id: "c", status: "abandoned", last_touched_turn: 1 })]);
  const log = sweepThreads(s, "x");
  check("already-closed threads are left alone", log.length === 0 && s.world.threads[0].status === "resolved");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
