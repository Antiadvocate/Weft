/* Smoke test: THE INJECTOR — changing somebody by giving them something to want.
 *
 * The only manual lever on a person was their core traits, which is instant and total. Wanting the
 * neighbour to become a nuisance meant typing "annoys me with loud music nightly" into the field
 * that says what somebody fundamentally IS — a result entered as a nature, with no first party and
 * no evening it might have gone differently.
 *
 * What was wanted is one level down: give the man a want, let it escalate, and let the trait be the
 * thing the story arrives at rather than the thing it starts from. This covers the four properties
 * that make an authored want different from an ordinary drive:
 *
 *   1. it survives — ten places in the engine overwrite `drive`, none of them touch this
 *   2. it does not complete — a habit that finishes after one party is not a habit
 *   3. it climbs — same want, different evening, at stage 0 and stage 3
 *   4. it becomes the person, once it has run long enough to have earned it */
import { authoredLine, authoredWants, crystallize, hasAuthored, intensity, newAuthored, setback, tickAuthored, MAX_STAGE } from "../src/engine/authored";

import { regenerateDrives, seedDrive } from "../src/engine/drives";
import { volatileDigest } from "../src/engine/prompts";
import { sanitize } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

/* A turn is a quarter-hour of story on a real save (Day 1 to Day 3 across 108 turns), so that is
 * what one tick means here. Escalation is measured in IN-WORLD time, not in turns: a montage that
 * skips two days must move a standing want two days, and a turn spent staring across a table must
 * barely move it at all. It was turn-counted and calibrated for stories lasting weeks — which no
 * real save does, so a "steady" want would have sat at the bottom rung until the story ended. */
const TURN_MIN = 15;
const tick = (s: SaveState, n = 1, min = TURN_MIN) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) { s.world.current_turn++; out.push(...tickAuthored(s, min)); }
  return out;
};

const RUNGS = ["EXPOSURE", "NEAR IT", "EXAMINING IT", "THE SIDEWAYS FIRST TIME", "AGAIN", "SIMPLY WHAT SHE DOES"];
const rampOrder = (r: string) => RUNGS.indexOf(r);

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const mk = (turn = 10): SaveState => ({
  world: { current_turn: turn, present: [], edges: [], threads: [], clocks: [], places: {}, player_location: "loc_a", offstage_log: [] },
  characters: {
    char_player: { name: "Rabi", core_traits: [], values: [] },
    char_neigh: { name: "Dev", core_traits: ["private"], values: [], tracked: true, status: "active", location: "loc_a" },
  },
  traits: {}, memory: {}, condition: {}, history: [], telemetry: [],
} as unknown as SaveState);

const give = (s: SaveState, opts: Parameters<typeof newAuthored>[2] = {}) => {
  s.characters.char_neigh.authored = newAuthored("start having people over late", s.world.current_turn, opts);
  return s.characters.char_neigh.authored!;
};

/* ── 1. it survives the things that eat ordinary drives ──────────────────────── */
{
  const s = mk();
  give(s);
  // regenerateDrives is the promoter/seeder — the single biggest clobberer of `drive`
  s.characters.char_neigh.drive = { goal: "fix the gate", progress: 100, priority: 1, updated_turn: 1 };
  regenerateDrives(s, () => 0.5);
  check("a seeded drive replacing the active one leaves the authored want alone",
    s.characters.char_neigh.authored?.goal === "start having people over late", s.characters.char_neigh.authored);
  check("and the ordinary drive still turned over as it always did",
    s.characters.char_neigh.drive?.goal !== "fix the gate", s.characters.char_neigh.drive?.goal);
}
{
  // the blunt clobbers: rupture and departure set drive to undefined outright
  const s = mk();
  give(s);
  s.characters.char_neigh.drive = undefined;
  check("wiping the drive entirely does not wipe the authored want", hasAuthored(s.characters.char_neigh));
}
{
  // seedDrive must never be handed the authored want as if it were one of its own candidates
  const s = mk();
  give(s);
  const seeded = seedDrive(s, "char_neigh", () => 0.5);
  check("the seeder does not echo the authored want back as a fresh goal",
    seeded?.goal !== "start having people over late", seeded?.goal);
}

/* ── 2. it does not complete ─────────────────────────────────────────────────── */
{
  const s = mk();
  give(s, { rate: "fast" });
  tick(s, 1, 24 * 60 * 7);   // a week of story, well past the top of the ladder
  const a = s.characters.char_neigh.authored!;
  check("a week later the want is still there", !!a.goal);
  check("it never reports progress, because it is not a task", !("progress" in a), Object.keys(a));
  check("and it does not climb past the top rung", a.stage === MAX_STAGE, a.stage);
}

/* ── 3. it climbs, at the rate that was chosen ───────────────────────────────── */
{
  const s = mk();
  give(s, { rate: "steady" });
  const stageAfter = (n: number) => { tick(s, n); return s.characters.char_neigh.authored!.stage; };
  check("it starts at the bottom", s.characters.char_neigh.authored!.stage === 0);
  check("an hour in, it is still a new thing", stageAfter(4) === 0, s.characters.char_neigh.authored!.stage);
  check("it moves up once a day or so has passed", stageAfter(64) >= 1, s.characters.char_neigh.authored!.stage);
}
{
  // rate is the whole dial — slow and fast must not land in the same place
  const run = (rate: "slow" | "fast", hours: number) => {
    const s = mk(); give(s, { rate });
    tick(s, 1, hours * 60);
    return s.characters.char_neigh.authored!.stage;
  };
  check("over one day, fast has climbed and slow has not", run("fast", 24) > run("slow", 24), [run("fast", 24), run("slow", 24)]);
  check("slow still gets there across most of a week", run("slow", 24 * 6) >= MAX_STAGE, run("slow", 24 * 6));
}
{
  const s = mk();
  give(s, { rate: "fast", paused: true });
  tick(s, 1, 24 * 60 * 7);
  check("a want held in place stays where it was put", s.characters.char_neigh.authored!.stage === 0);
}
{
  const s = mk();
  give(s, { rate: "fast", stage: 2 });
  check("starting it partway up does not strand the counter below it",
    s.characters.char_neigh.authored!.acted >= 2 * 4 * 60, s.characters.char_neigh.authored!.acted);
  tick(s, 1, 4 * 60);
  check("so the next rung arrives on schedule rather than after a full re-climb",
    s.characters.char_neigh.authored!.stage === 3, s.characters.char_neigh.authored!.stage);
}
{
  const s = mk();
  give(s, { rate: "steady", stage: 2 });
  setback(s.characters.char_neigh.authored!);
  const a = s.characters.char_neigh.authored!;
  check("being faced down costs a rung", a.stage === 1, a.stage);
  check("and the counter goes back with it, so it does not jump straight up again", a.acted === 1 * 10 * 60, a.acted);
  setback(a); setback(a); setback(a);
  check("it stops at the bottom instead of going negative", a.stage === 0, a.stage);
}
{
  // the escalation has to be legible to the models, or none of it reaches the page
  const s = mk();
  const a = give(s, { rate: "fast", because: "his brother moved in last month", approach: "asks first, then stops asking" });
  const low = authoredLine(a);
  a.stage = 3;
  const high = authoredLine(a);
  check("the want reads differently once it has escalated", low !== high);
  check("the reason travels with it", /brother moved in/.test(high), high);
  check("so does the door they use", /asks first/.test(high), high);
  check("and provenance never does — a model told a human wrote this plays it as an order",
    !/(author|inject|player wrote|the player set)/i.test(high), high);
}

/* ── 4. it becomes the person ────────────────────────────────────────────────── */
{
  const s = mk();
  give(s, { rate: "fast", crystallize: true, because: "his brother moved in last month" });
  // it has to have actually happened in the story — see surfaced()
  s.history.push({ turn: 11, player_action: "", narrator_prose: "He started having people over late, and the street heard it." } as any);
  tick(s, 1, 24 * 60 * 7);
  const c = s.characters.char_neigh;
  check("a want carried to the top long enough becomes a trait", !!c.authored?.crystallized_turn, c.authored);
  check("it lands in core traits, where the player would have typed it",
    c.core_traits.some((t) => /having people over late/.test(t)), c.core_traits);
  check("and in the learned-traits ledger with an origin", (s.traits.char_neigh ?? []).length === 1, s.traits.char_neigh);
  check("the origin is the reason it started, not a shrug",
    /brother moved in/.test((s.traits.char_neigh ?? [])[0]?.origin ?? ""), s.traits.char_neigh?.[0]?.origin);
  check("the want retires in the same motion, so nothing is counted twice",
    !hasAuthored(c) && !authoredWants(s).has("char_neigh"));
}
{
  const s = mk();
  give(s, { rate: "fast", crystallize: false });
  tick(s, 1, 24 * 60 * 3);
  check("a want the player asked to stay a want never hardens", !s.characters.char_neigh.authored!.crystallized_turn);
  check("but it still sits at the top of the ladder", s.characters.char_neigh.authored!.stage === MAX_STAGE);
}
{
  const s = mk();
  give(s, { rate: "fast" });
  crystallize(s, "char_neigh", 20);
  const before = (s.traits.char_neigh ?? []).length;
  crystallize(s, "char_neigh", 21);
  check("crystallising twice does not write the trait twice", (s.traits.char_neigh ?? []).length === before, before);
}

/* ── 5. the dead and the gone stop wanting things ────────────────────────────── */
for (const status of ["dead", "departed"] as const) {
  const s = mk();
  give(s, { rate: "fast" });
  (s.characters.char_neigh as any).status = status;
  tick(s, 1, 24 * 60 * 7);
  check(`a ${status} character's authored want stops climbing`, s.characters.char_neigh.authored!.stage === 0);
  check(`and is not handed to the world-sim`, !authoredWants(s).has("char_neigh"));
}
{
  const s = mk();
  give(s, { paused: true });
  check("a held want is not driving the world either", !authoredWants(s).has("char_neigh"));
}

/* ── 5. IT HAS TO OCCUPY THE WANTS SLOT ──────────────────────────────────────────
 *
 * "I've now put in multiple things and not a single one has shown up as a part of them."
 *
 * It rendered the whole time. It rendered UNDERNEATH this, on the same card, two lines apart:
 *
 *     wants: nothing pressing
 *     and this has been going on in their life: start having people over late — ...
 *
 * The emptiness check only ever looked at `drive`, so a character whose only want was the authored
 * one was announced as wanting nothing — in the field every downstream rule keys off, including the
 * one that says a character with nothing of their own to say says nothing and does something
 * instead. What the player had deliberately written arrived after it, introduced with "and", as
 * background colour. A model resolving that contradiction picks the field that governs behaviour. */
const scene = (over: Record<string, unknown> = {}): SaveState => {
  const base: any = {
    id: "x", name: "t", updated_at: "",
    world_bible: { name: "W", era: "", technology_level: "", magic_rules: "", forbidden: "", what_people_fear: "", cultures_and_languages: "", climate_and_geography: "", calendar_and_currency: "", political_situation: "", difficulty_profile: {} },
    world: { current_turn: 20, current_time: "Day 2, 10:00 (Morning)", weather: "clear", player_location: "loc_a", present: ["char_n"],
      places: { loc_a: { id: "loc_a", name: "The street", description_facts: "" } },
      edges: [], threads: [], clocks: [], consequences: [], rumors: [], canon: [], norms: [], money: "", promises: [], offstage_log: [], time_at_turn: {} },
    characters: {
      char_player: { name: "Rabi", age: 34, appearance_facts: "x", background: "b", core_traits: [], values: [], speech_pattern: "p", intelligence: "average", gregariousness: 0.5 },
      char_n: { name: "Dev", age: 40, appearance_facts: "x", background: "b", core_traits: ["private"], values: [], speech_pattern: "p", intelligence: "average", gregariousness: 0.5, tracked: true, central: true, location: "loc_a", ...over },
    },
    condition: {}, memory: {}, traits: {}, history: [], telemetry: [], pressure_trace: [], records: [], snapshots: [],
    model_settings: { narrator_model: "m", simulator_model: "m", forge_model: "m", fallback_model: "m", image_model: "m", context_memories_k: 6, reflection_cadence: 10, history_window: 5 },
  };
  // through sanitize, as the real app does — it is what fills derived fields like place.contains
  return sanitize(JSON.parse(JSON.stringify(base))) as SaveState;
};
const wantsLines = (s: SaveState) =>
  volatileDigest(s, "").split("\n").filter((l) => /^\s+(wants|also wants)/.test(l));

{
  const s = scene({ authored: newAuthored("start having people over late", 12, { because: "his brother moved in" }) });
  const lines = wantsLines(s);
  check("an authored want reaches the narrator at all", lines.some((l) => /people over late/.test(l)), lines);
  check("and it is in the WANTS slot, not an appendix", /^\s+wants:.*people over late/.test(lines.join("\n")), lines);
  check("the card no longer also claims they want nothing",
    !lines.some((l) => /nothing pressing/.test(l)), lines);
}
{
  // with a real drive as well, both are wants — the authored one is marked standing, not demoted
  const s = scene({
    drive: { goal: "get the gate fixed before dark", progress: 0, updated_turn: 19 },
    authored: newAuthored("start having people over late", 12),
  });
  const lines = wantsLines(s);
  check("an ordinary drive still leads when there is one", /^\s+wants:.*gate fixed/.test(lines.join("\n")), lines);
  check("and the authored want sits beside it as standing", lines.some((l) => /also wants.*people over late/.test(l)), lines);
  check("neither is described as nothing", !lines.some((l) => /nothing pressing/.test(l)), lines);
}
{
  const s = scene({});
  check("a character with no wants at all still says so", wantsLines(s).some((l) => /nothing pressing/.test(l)), wantsLines(s));
}
{
  const s = scene({ authored: newAuthored("start having people over late", 12, { paused: true }) });
  check("a held want is not presented as a live one", !wantsLines(s).some((l) => /people over late/.test(l)), wantsLines(s));
  check("and the card falls back to nothing pressing", wantsLines(s).some((l) => /nothing pressing/.test(l)), wantsLines(s));
}
{
  // stage 0 must not read as permission to skip it
  const a = newAuthored("start having people over late", 12);
  const line = authoredLine(a);
  check("a new want is not described as easily abandoned", !/abandon/i.test(line), line);
  // and the bottom rung is now the part BEFORE the act, which is the whole correction: at the start
  // the want exists only as attention, and doing the thing is explicitly off the table
  check("the bottom rung is exposure", /^.*EXPOSURE\./.test(line) || /EXPOSURE\./.test(line), line);
  // AND IT MUST STILL PUT SOMETHING ON THE PAGE. The version before this one described the first
  // three rungs purely as absence — "they notice the openings", "anyone watching closely would see
  // only that something is occupying them" — which a narrator satisfies by writing nothing at all.
  // A 20-turn budget ran to completion, the character present for every turn of it, and the want
  // never once reached the prose. Not acting is not the same as nothing happening.
  check("and even it demands a beat a reader could point at", /ONE CONCRETE THING IS ON THE PAGE/.test(line), line);
}

/* ── 6. A FIXED TIMEFRAME YOU CAN CHECK ──────────────────────────────────────────
 *
 * "I added a random thing to Dana's personality, it's been a day and she hasn't done anything. I
 *  need a debug mode of 'within x turns she fully inhabits it', showing 10% to start and escalating
 *  logarithmically."
 *
 * Two reasons nothing happened, and only one was pacing. The want was ticking correctly — 165 of the
 * 360 in-world minutes a "fast" rung needs — which is indistinguishable from broken. And Dana was in
 * another room: the machinery that lets an offscreen character with a want aimed at the player
 * generate an arrival required c.drive?.goal, which an authored want deliberately is not. So it went
 * only to the world-sim and could never bring her into a scene. */
{
  const s = mk(20);
  s.characters.char_neigh.authored = newAuthored("ask him to do the thing", 20, { inhabit_turns: 10 });
  const a = s.characters.char_neigh.authored!;
  const at = (t: number) => Math.round(intensity(a, t) * 100);
  const rung = (t: number) => RUNGS.find((r) => authoredLine(a, t).includes("where they are with it: " + r)) ?? "?";
  check("it is visible immediately rather than at zero", at(20) === 10, at(20));
  check("it moves on the very next turn", at(21) > 10, at(21));
  check("and on every turn after that", [22,23,24,25,26,27,28,29].every((t) => at(t) > at(t - 1)));
  check("it is exactly full on the turn named", at(30) === 100, at(30));
  check("and does not overshoot", at(40) === 100, at(40));

  /* THE SHAPE IS THE FEATURE. The first version used a logarithmic curve — steepest at the start —
   * and two turns into a ten-turn budget it already said GO AT IT. Dana brought it up out of
   * nowhere, which is the failure this exists to prevent. Habituation is the other shape. */
  /* The Yorkie days, in order. 10–50% is build-up through things the world puts in their way, and
   * on none of those rungs does the thing happen. */
  check("it opens as bare exposure — the scene shows it, they do nothing", rung(20) === "EXPOSURE", rung(20));
  check("then proximity by circumstance, still not a decision", rung(22) === "NEAR IT", rung(22));
  check("then examining the specific thing, and being interrupted", rung(24) === "EXAMINING IT", rung(24));
  check("nothing has HAPPENED through the whole first half", [20,21,22,23,24].every((t) => RUNGS.indexOf(rung(t)) <= 2), [20,24].map(rung));
  check("the first time it happens is past halfway, and sideways", rung(25) === "THE SIDEWAYS FIRST TIME", rung(25));
  check("then repetition without a pretext", rung(28) === "AGAIN", rung(28));
  check("and only at the deadline is it simply what they do", rung(30) === "SIMPLY WHAT SHE DOES", rung(30));
  check("the early rungs are body and circumstance, never conversation",
    /Not one word about it/.test(authoredLine(a, 22)), rung(22));
  check("and the meaning arrives after the habit, not before",
    /meaning arrives after the habit/.test(authoredLine(a, 30)));
  check("the rung never goes backwards", [21,22,23,24,25,26,27,28,29,30].every((t, i, xs) => i === 0 || rampOrder(rung(t)) >= rampOrder(rung(xs[i-1]))));
}
{
  const s = mk(20);
  s.characters.char_neigh.authored = newAuthored("ask him", 20, { inhabit_turns: 10 });
  const line = authoredLine(s.characters.char_neigh.authored!, 25);
  check("the narrator is told how far along it is, as a number", /\d+% of the way/.test(line), line);
  check("and that it must show at exactly that strength and no more", /at exactly this strength and no more/.test(line), line);
  check("with an invisible turn named as failure", /nothing about it can be seen is a turn in which this failed/.test(line), line);
}
{
  // the budget completes the want, so "fully inhabits it" actually finishes
  const s = mk(20);
  s.characters.char_neigh.authored = newAuthored("ask him", 20, { inhabit_turns: 5, crystallize: true });
  s.history.push({ turn: 22, player_action: "", narrator_prose: "She finally did ask him, and he said yes." } as any);
  s.world.current_turn = 25;
  tickAuthored(s, 15);
  check("reaching the deadline makes it part of who they are",
    !!s.characters.char_neigh.authored?.crystallized_turn, s.characters.char_neigh.authored);
}
{
  // and without a budget nothing changes — in-world hours still govern
  const s = mk(20);
  s.characters.char_neigh.authored = newAuthored("ask him", 20, { rate: "fast" });
  check("an unbudgeted want still reports off its rungs", intensity(s.characters.char_neigh.authored!, 99) < 0.3);
  check("and its line carries no percentage", !/% of the way/.test(authoredLine(s.characters.char_neigh.authored!, 99)));
}

/* ── 7. NEVER HARDEN SOMETHING THAT NEVER HAPPENED ───────────────────────────────
 *
 * A 20-turn budget ran to completion. The character was present for twelve straight turns. The want
 * was on her card, in the wants slot, every single one of them — and it never reached the prose
 * once. Then the deadline arrived and it crystallised into a core trait reading "Forces Rabi lick
 * her armpit. Anytime they're together."
 *
 * The engine declared a habit the story had never shown, which is exactly the blunt instrument this
 * whole feature exists to replace — arrived at automatically, without a single scene earning it. */
{
  const s = mk(20);
  s.characters.char_neigh.authored = newAuthored("ask him to do the thing", 20, { inhabit_turns: 3, crystallize: true });
  s.world.current_turn = 24;
  tickAuthored(s, 15);
  const a = s.characters.char_neigh.authored!;
  check("a want the story never showed does not become a trait", !a.crystallized_turn, a);
  check("it holds at the top rung, still wanting", a.stage === MAX_STAGE, a.stage);
  check("and it is not written into core traits", !s.characters.char_neigh.core_traits.some((t) => /do the thing/.test(t)), s.characters.char_neigh.core_traits);
}
{
  const s = mk(20);
  s.characters.char_neigh.authored = newAuthored("ask him to do the thing", 20, { inhabit_turns: 3, crystallize: true });
  s.history.push({ turn: 22, player_action: "", narrator_prose: "She asked him to do the thing, finally, and did not look away." } as any);
  s.world.current_turn = 24;
  tickAuthored(s, 15);
  check("but one the story DID show becomes who they are", !!s.characters.char_neigh.authored?.crystallized_turn);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
