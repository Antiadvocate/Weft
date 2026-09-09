/* Smoke test: THE ENGINE WAS ASKING THE PROSE WHETHER IT HAD DONE THE THING IT HAD JUST DONE.
 *
 * "Threads and clocks are broken and don't work at all any more. The narrator does not act on
 *  threads nor shows any movement. Nothing works except giving the NPCs a want."
 *
 * He was right, and it is measurable. The same five active threads and one clock, three hundred
 * turns at conversation pace (four in-world minutes a turn, which is what a scene in a kitchen
 * costs), before this change:
 *
 *     thread beats = 0 to 2, out of 300 turns
 *     all five threads ABANDONED
 *     one of seven sources still able to fire after turn 200 — the palette line, which is exempt
 *
 * Five separate mechanisms, each defensible on its own, multiplying into a world that could only
 * ever be about a person's want:
 *
 * 1. THE TOUCH WAS READ OUT OF THE PROSE. `mentioned` wants a third of a thread's distinctive words
 *    back verbatim before it will believe the story is still about it. Three scenes written straight
 *    at their own thread — a shut door at the end of a hall, a phone screen going dark too fast, an
 *    envelope nobody opens — score zero between them. Meanwhile the engine had CHOSEN that thread as
 *    the turn's subject and knew it for a fact. So a thread was assigned the scene and demoted for
 *    inactivity on the same turn.
 *
 * 2. DORMANT WAS A ONE-WAY DOOR. selectBeat only ever looked at `status === "active"`, so a demoted
 *    thread could not be chosen, so it could not be touched, so it aged out to abandoned. The
 *    promise in threads.ts is "any mention wakes it" — but a mention is a thing the PLAYER does, and
 *    the world had no way of its own to pick a subject back up.
 *
 * 3. DORMANCY RAN FASTER THAN THE ROTATION. Twelve turns, against a selector that picks one source
 *    per turn out of eight or nine — about forty turns between visits to any one thread.
 *
 * 4. RETIREMENT WAS PERMANENT AND WAS COUNTING THE WRONG THING. Four discharges retired a source
 *    forever; nothing anywhere reset the count; and the count rose when the source was SELECTED,
 *    not when anything happened in the fiction.
 *
 * 5. AND THE CLOCKS WERE IN A DEADLOCK FROM WORLD CREATION. A clock below 75% could only reach the
 *    page as a visible sign, and the sign channel required `filled > 0`. Advancing required the
 *    faction to know something, and `factionMembers` matches the faction's name against character
 *    backgrounds — for a faction the forge invented before any character existed, that is nobody.
 *    Twelve turns later the stall path rewrote the objective and set the status to "stalled", which
 *    nothing in the engine could undo. Invisible at 0, dead at 13. Then, for a clock that somehow
 *    got past all that, a segment cost three in-world hours: sixty turns at conversation pace, so
 *    three hundred and sixty turns from a six-segment clock to the consequence it promised.
 */
import { selectBeat, RETIRE_AT, type Beat } from "../src/engine/pressure";
import { sweepThreads, DORMANT_AFTER } from "../src/engine/threads";
import { factionEverInPlay, reviveStalledClocks } from "../src/engine/knowledge";
import type { FactionClock, SaveState, Thread } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const th = (over: Partial<Thread>): Thread => ({
  id: "thr_x", title: "The buried box", description: "Still pending discovery.",
  status: "active", turn_started: 1, tension: 3, ...over,
} as Thread);
const save = (threads: Thread[], turn = 60): SaveState =>
  ({ world: { current_turn: turn, threads }, history: [] } as unknown as SaveState);
const base = (o: any = {}) => ({ turn: 60, tension: 5, clocks: [], threads: [], agents: [],
  consequences: [], recent: [], minutesSinceBeat: 4000, rng: Math.random, ...o });
const sample = (inp: any, n = 400) => {
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) { const b = selectBeat(base(inp)) as Beat; out.set(b.kind, (out.get(b.kind) ?? 0) + 1); }
  return out;
};

/* ── 1. the engine's own choice is the touch ─────────────────────────────────── */
{
  const s = save([th({ id: "a", last_touched_turn: 5, title: "Denise hasn't come out",
    description: "Denise has not left her room in three days and will not say why." })]);
  // prose that IS the thread and shares almost none of its wording — which is the normal case
  const prose = "The door at the end of the hall stayed shut. He knocked twice and got nothing back.";
  sweepThreads(s, prose);
  check("without the beat, prose about a thread reads as silence", s.world.threads[0].status === "dormant");

  const s2 = save([th({ id: "a", last_touched_turn: 5, title: "Denise hasn't come out" })]);
  sweepThreads(s2, prose, "a");
  check("the thread the engine ASSIGNED this turn counts as touched", s2.world.threads[0].last_touched_turn === 60);
  check("and it stays live", s2.world.threads[0].status === "active");

  const s3 = save([th({ id: "a", status: "dormant", last_touched_turn: 5 })]);
  const log = sweepThreads(s3, "unrelated", "a");
  check("a dormant thread the world returns to wakes up", s3.world.threads[0].status === "active");
  check("and says so", log.some((l) => /Back in play/.test(l)), log);
}
{
  // the mechanism this replaces, stated as a measurement rather than an opinion
  const s = save([th({ id: "a", last_touched_turn: 5, title: "Friction between Vin and Miranda over privacy",
    description: "Miranda has been reading Vin's messages and he has not said anything about it." })]);
  sweepThreads(s, `Miranda didn't look up from her phone when he came in. "You were out late," she said. The screen went dark in her hand, too fast.`);
  check("prose matching cannot carry this on its own — that is why the beat does",
    s.world.threads[0].status === "dormant", s.world.threads[0]);
}

/* ── 2. the beat names WHICH thread, so nothing has to match titles ───────────── */
{
  let withId = 0;
  for (let i = 0; i < 200; i++) {
    const b = selectBeat(base({ threads: [th({ id: "a", tension: 5 })] })) as Beat;
    if (b.kind === "thread" && b.id === "a") withId++;
  }
  check("a thread beat carries the thread's id", withId > 0);
}

/* ── 3. dormant is set aside, not buried ─────────────────────────────────────── */
{
  const dormant = sample({ threads: [th({ id: "a", status: "dormant", tension: 4 })] });
  check("a dormant thread can still be chosen", (dormant.get("thread") ?? 0) > 0, dormant);
  const resolved = sample({ threads: [th({ id: "a", status: "resolved", tension: 9 })] });
  check("...and a resolved one still cannot", (resolved.get("thread") ?? 0) === 0, resolved);
}
{
  // it loses the tie-break to a live thread of the same age, which is what dormant should mean
  const both = { threads: [th({ id: "live", title: "Live one", tension: 4 }),
                           th({ id: "dorm", title: "Set aside", status: "dormant", tension: 4 })] };
  let live = 0, dorm = 0;
  for (let i = 0; i < 600; i++) {
    const b = selectBeat(base(both)) as Beat;
    if (b.kind === "thread") (b.id === "live" ? live++ : dorm++);
  }
  check("a live thread outranks an equally stale dormant one", live > dorm, { live, dorm });
}

/* ── 4. dormancy is slower than the rotation it measures ─────────────────────── */
check("the dormancy window is longer than the gap between visits to any one thread",
  DORMANT_AFTER >= 20, DORMANT_AFTER);

/* ── 5. retirement is a long silence, not a tombstone ────────────────────────── */
{
  const spent = [{ ref: "Old news", turn: 20, count: RETIRE_AT, kind: "threat" }];
  const soon = sample({ turn: 30, threads: [th({ id: "a", title: "Old news", tension: 5 })], recent: spent });
  check("a source that has discharged its limit goes quiet", (soon.get("thread") ?? 0) === 0, soon);
  const later = sample({ turn: 90, threads: [th({ id: "a", title: "Old news", tension: 5 })], recent: spent });
  check("...and the world is allowed to remember it exists", (later.get("thread") ?? 0) > 0, later);
}
{
  const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
  check("a source coming back from retirement starts its count again",
    /prior\.count = prior\.count >= RETIRE_AT \? 1 : prior\.count \+ 1/.test(src));
}

/* ── 6. a clock has a body before it has moved ───────────────────────────────── */
{
  const clock = { id: "c", faction: "Meridian Works", objective: "the substation is rewired",
    segments: 6, filled: 0, consequence: "the grid changes hands", status: "running",
    visible_signs: ["A works van is parked where it was not yesterday."] } as unknown as FactionClock;
  const fresh = sample({ clocks: [clock] });
  check("a clock at 0 of 6 with signs can reach the page", (fresh.get("clock") ?? 0) > 0, fresh);
  const blind = sample({ clocks: [{ ...clock, visible_signs: [] }] });
  check("...and one with nothing anybody could see stays private", (blind.get("clock") ?? 0) === 0, blind);
  let asSign = 0, total = 0;
  for (let i = 0; i < 400; i++) {
    const b = selectBeat(base({ clocks: [clock] })) as Beat;
    if (b.kind === "clock") { total++; if (b.young) asSign++; }
  }
  check("and it arrives as a sign, never as a crisis", total > 0 && asSign === total, { asSign, total });
}

/* ── 7. the knowledge gate holds where it means something ────────────────────── */
{
  const world = (chars: Record<string, unknown>): SaveState =>
    ({ characters: chars, world: { clocks: [], rumors: [] }, memory: {} } as unknown as SaveState);
  const warband = world({ char_player: { name: "Joe" },
    c1: { name: "Bran", background: "a warrior in the warband of Lord Áedán", status: "alive" } });
  check("a faction with people in it is gated on what those people know",
    factionEverInPlay(warband, "Áedán's Warband"));
  const dead = world({ char_player: { name: "Joe" },
    c1: { name: "Bran", background: "a warrior in the warband of Lord Áedán", status: "dead" } });
  check("...and killing every one of them does NOT open the gate — that is the case it exists for",
    factionEverInPlay(dead, "Áedán's Warband"));
  check("a faction nobody in the world belongs to is offstage machinery, not an omniscient enemy",
    !factionEverInPlay(warband, "Meridian Works"));
}

/* ── 8. and a stall can be undone ────────────────────────────────────────────── */
{
  const s = {
    characters: { c1: { name: "Bran", background: "a rider for the Ashfell Company", status: "alive" } },
    memory: { c1: { episodic: [{ turn: 9, content: "a stranger came down the coast road asking after the ford", importance: 8, source: "witnessed" }] } },
    world: { current_turn: 30, rumors: [], clocks: [{
      id: "c", faction: "Ashfell Company", segments: 6, filled: 0, status: "stalled",
      objective: "Ashfell Company goes about its ordinary business.",
      original_objective: "a stranger came down the coast road asking after the ford",
      stalled_since: 12, consequence: "riders reach the ford", visible_signs: [],
    }] },
  } as unknown as SaveState;
  const log = reviveStalledClocks(s);
  const c = s.world.clocks[0];
  check("a stalled clock starts again when word finally reaches the faction", c.status === "running", c);
  check("...on the objective it actually had, not the placeholder",
    /coast road/.test(c.objective) && c.original_objective === undefined, c);
  check("and the player is told", log.length === 1, log);
  const again = reviveStalledClocks(s);
  check("running clocks are left alone", again.length === 0);
}

/* ── 9. the time gates can be paid by a story told in rooms ──────────────────── */
{
  const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
  check("a clock segment can be bought with turns as well as in-world hours",
    /waited < MINUTES_PER_SEGMENT && turnsWaited < TURNS_PER_SEGMENT/.test(src));
  check("...and so can a rise in a thread's tension",
    /waited >= MINUTES_PER_ESCALATION \|\| turnsWaited >= TURNS_PER_ESCALATION/.test(src));
  check("the sweep is told what the engine chose rather than guessing from the prose",
    /sweepThreads\(state, prose, beat\.kind === "thread"/.test(src));
}

/* ── 10. and the whole thing, over the length of a real game ─────────────────── */
function play(turns: number, tension: number) {
  const threads: Thread[] = [
    th({ id: "t1", title: "Lit from below", tension: 4, last_touched_turn: 1 }),
    th({ id: "t2", title: "The job on Fifth", tension: 3, last_touched_turn: 1 }),
    th({ id: "t3", title: "Barefoot past the door", tension: 2, last_touched_turn: 1 }),
    th({ id: "t4", title: "The shoes came back on", tension: 3, last_touched_turn: 1 }),
    th({ id: "t5", title: "Denise hasn't come out", tension: 4, last_touched_turn: 1 }),
  ];
  const clocks = [{ id: "c1", faction: "The Voice", objective: "the voice grows stronger", segments: 6,
    filled: 0, consequence: "he stops arguing with it", status: "running",
    visible_signs: ["Joe hears whispers even when Amber is not in the room."] }] as unknown as FactionClock[];
  const recent: { ref: string; turn: number; count: number; kind?: string }[] = [];
  let lastBeat = 0, lastBeatMin = 0, threadBeats = 0;
  const late = new Set<string>();
  for (let turn = 1; turn <= turns; turn++) {
    const b = selectBeat({ turn, tension, threads, clocks, consequences: [], agents: [],
      palette: ["A marriage under strain"], last_beat_turn: lastBeat, last_exo_turn: 0, recent,
      minutesSinceBeat: 4 * turn - lastBeatMin, rng: Math.random }) as Beat;
    const ref = (b as { ref?: string }).ref;
    const sign = (b as { quiet?: boolean; young?: boolean }).quiet || (b as { young?: boolean }).young;
    if (b.kind === "thread") threadBeats++;
    if (ref) late.add(ref);
    if (!sign && ["consequence", "clock", "thread", "agent", "exogenous", "palette"].includes(b.kind)) {
      lastBeat = turn; lastBeatMin = 4 * turn;
    }
    if (ref && ["clock", "thread", "agent", "consequence", "palette"].includes(b.kind)) {
      const prior = recent.find((r) => r.ref === ref);
      const kind = b.kind === "palette" ? "palette" : "threat";
      if (prior) { prior.turn = turn; prior.kind = kind; if (!sign) prior.count = prior.count >= RETIRE_AT ? 1 : prior.count + 1; }
      else recent.push({ ref, turn, count: sign ? 0 : 1, kind });
    }
    sweepThreads({ world: { current_turn: turn, threads } } as unknown as SaveState,
      "prose that repeats none of their wording", b.kind === "thread" ? (b as { id?: string }).id : undefined);
  }
  return { threads, threadBeats, late };
}
{
  // 120 turns is a long game — the saves this was diagnosed from ran 43, 56, 108 and 120. Averaged
  // over twenty of them, because a rotation over eight sources is noisy by design and one run
  // proves nothing either way.
  let beats = 0, letGo = 0, hot = 0, sawAll = 0;
  const RUNS = 20;
  for (let i = 0; i < RUNS; i++) {
    const { threads, threadBeats, late } = play(120, 5);
    beats += threadBeats;
    for (const t of threads) if (t.status === "abandoned") { letGo++; if ((t.tension ?? 0) > 0) hot++; }
    if (late.size === 7) sawAll++;   // five threads, the clock and the palette line
  }
  console.log(`     (120 turns x${RUNS}: ${(beats / RUNS).toFixed(1)} thread beats a game, ${(letGo / RUNS).toFixed(2)} of five let go, all seven sources reached the page in ${sawAll}/${RUNS})`);
  check("threads are the subject of the scene regularly, not once or twice a game", beats / RUNS >= 5, beats / RUNS);
  check("and a full-length game holds on to nearly all of them", letGo / RUNS < 0.5, letGo / RUNS);
  check("...never one still carrying tension", hot === 0, hot);
  check("every source in the world reaches the page at least once", sawAll === RUNS, sawAll);
}
{
  // 300 turns, on the rest dial, is where letting go SHOULD start to happen — and it may only ever
  // happen to a situation that has actually cooled to nothing while nobody came back to it.
  let hot = 0, letGo = 0;
  for (let i = 0; i < 20; i++) {
    const { threads } = play(300, 3);
    for (const t of threads) if (t.status === "abandoned") { letGo++; if ((t.tension ?? 0) > 0) hot++; }
  }
  console.log(`     (300 quiet turns x20: ${letGo} threads let go, ${hot} of them still carrying tension)`);
  check("a story long enough does eventually set some things down", letGo > 0, letGo);
  check("...and never one the world was still willing to press on", hot === 0, hot);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
