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
import { authoredLine, authoredWants, crystallize, habitDirective, hasAuthored, intensity, newAuthored, setback, tickAuthored, MAX_STAGE } from "../src/engine/authored";

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
  s.characters.char_neigh.authored = [newAuthored("start having people over late", s.world.current_turn, opts)];
  return s.characters.char_neigh.authored![0];
};

/* ── 1. it survives the things that eat ordinary drives ──────────────────────── */
{
  const s = mk();
  give(s);
  // regenerateDrives is the promoter/seeder — the single biggest clobberer of `drive`
  s.characters.char_neigh.drive = { goal: "fix the gate", progress: 100, priority: 1, updated_turn: 1 };
  regenerateDrives(s, () => 0.5);
  check("a seeded drive replacing the active one leaves the authored want alone",
    s.characters.char_neigh.authored?.[0]?.goal === "start having people over late", s.characters.char_neigh.authored?.[0]);
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
  const a = s.characters.char_neigh.authored![0];
  check("a week later the want is still there", !!a.goal);
  check("it never reports progress, because it is not a task", !("progress" in a), Object.keys(a));
  check("and it does not climb past the top rung", a.stage === MAX_STAGE, a.stage);
}

/* ── 3. it climbs, at the rate that was chosen ───────────────────────────────── */
{
  const s = mk();
  give(s, { rate: "steady" });
  const stageAfter = (n: number) => { tick(s, n); return s.characters.char_neigh.authored![0].stage; };
  check("it starts at the bottom", s.characters.char_neigh.authored![0].stage === 0);
  check("an hour in, it is still a new thing", stageAfter(4) === 0, s.characters.char_neigh.authored![0].stage);
  check("it moves up once a day or so has passed", stageAfter(64) >= 1, s.characters.char_neigh.authored![0].stage);
}
{
  // rate is the whole dial — slow and fast must not land in the same place
  const run = (rate: "slow" | "fast", hours: number) => {
    const s = mk(); give(s, { rate });
    tick(s, 1, hours * 60);
    return s.characters.char_neigh.authored![0].stage;
  };
  check("over one day, fast has climbed and slow has not", run("fast", 24) > run("slow", 24), [run("fast", 24), run("slow", 24)]);
  check("slow still gets there across most of a week", run("slow", 24 * 6) >= MAX_STAGE, run("slow", 24 * 6));
}
{
  const s = mk();
  give(s, { rate: "fast", paused: true });
  tick(s, 1, 24 * 60 * 7);
  check("a want held in place stays where it was put", s.characters.char_neigh.authored![0].stage === 0);
}
{
  const s = mk();
  give(s, { rate: "fast", stage: 2 });
  check("starting it partway up does not strand the counter below it",
    s.characters.char_neigh.authored![0].acted >= 2 * 4 * 60, s.characters.char_neigh.authored![0].acted);
  tick(s, 1, 4 * 60);
  check("so the next rung arrives on schedule rather than after a full re-climb",
    s.characters.char_neigh.authored![0].stage === 3, s.characters.char_neigh.authored![0].stage);
}
{
  const s = mk();
  give(s, { rate: "steady", stage: 2 });
  setback(s.characters.char_neigh.authored![0]);
  const a = s.characters.char_neigh.authored![0];
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
  check("a want carried to the top long enough becomes a trait", !!c.authored?.[0]?.crystallized_turn, c.authored);
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
  check("a want the player asked to stay a want never hardens", !s.characters.char_neigh.authored![0].crystallized_turn);
  check("but it still sits at the top of the ladder", s.characters.char_neigh.authored![0].stage === MAX_STAGE);
}
{
  const s = mk();
  give(s, { rate: "fast" });
  crystallize(s, "char_neigh", s.characters.char_neigh.authored![0], 20);
  const before = (s.traits.char_neigh ?? []).length;
  crystallize(s, "char_neigh", s.characters.char_neigh.authored![0], 21);
  check("crystallising twice does not write the trait twice", (s.traits.char_neigh ?? []).length === before, before);
}

/* ── 5. the dead and the gone stop wanting things ────────────────────────────── */
for (const status of ["dead", "departed"] as const) {
  const s = mk();
  give(s, { rate: "fast" });
  (s.characters.char_neigh as any).status = status;
  tick(s, 1, 24 * 60 * 7);
  check(`a ${status} character's authored want stops climbing`, s.characters.char_neigh.authored![0].stage === 0);
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
  const s = scene({ authored: [newAuthored("start having people over late", 12, { because: "his brother moved in" })] });
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
    authored: [newAuthored("start having people over late", 12)],
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
  const s = scene({ authored: [newAuthored("start having people over late", 12, { paused: true })] });
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
  s.characters.char_neigh.authored = [newAuthored("ask him to do the thing", 20, { inhabit_turns: 10 })];
  const a = s.characters.char_neigh.authored![0];
  const to = (n: number) => { while ((a.turns_live ?? 0) < n) { s.world.current_turn++; tickAuthored(s, 15); } };
  const pct = () => Math.round(intensity(a) * 100);
  const rung = () => RUNGS.find((r) => authoredLine(a).includes("where they are with it: " + r)) ?? "?";

  check("it is visible immediately rather than at zero", pct() === 10, pct());
  to(1);
  check("one turn moves the number", pct() > 10, pct());

  /* The Yorkie days, in order — counted in turns, which is the unit the player set. */
  to(1); check("it opens as bare exposure", rung() === "EXPOSURE", rung());
  to(3); check("then proximity by circumstance", rung() === "NEAR IT", rung());
  to(4); check("then examining the specific thing", rung() === "EXAMINING IT", rung());
  check("nothing has HAPPENED through the whole first half", RUNGS.indexOf(rung()) <= 2, rung());
  to(5); check("the first time it happens is past halfway, and sideways", rung() === "THE SIDEWAYS FIRST TIME", rung());
  to(8); check("then repetition without a pretext", rung() === "AGAIN", rung());
  to(10); check("and only at the end is it simply what they do", rung() === "SIMPLY WHAT SHE DOES", rung());

  /* "It must increase the percent if I'm using number of turns. Those turns aren't suggestions."
   *
   * Fifteen turns of prose with no visible connection to the want whatsoever. The percentage runs to
   * the end anyway, because the alternative — the engine reading the prose back and deciding for
   * itself whether the turn counted — is the thing that broke this feature for a week. */
  const s2 = mk(20);
  s2.characters.char_neigh.authored = [newAuthored("ask him to do the thing", 20, { inhabit_turns: 10 })];
  const b = s2.characters.char_neigh.authored![0];
  for (let i = 0; i < 15; i++) { s2.world.current_turn++; tickAuthored(s2, 15); }
  check("the percentage completes on schedule, unconditionally", Math.round(intensity(b) * 100) === 100, Math.round(intensity(b) * 100));
  check("and it does not run past the end", (b.stage ?? 0) === MAX_STAGE, b.stage);
}
{
  const s = mk(20);
  s.characters.char_neigh.authored = [newAuthored("ask him about the thing", 20, { inhabit_turns: 10 })];
  // the percentage only exists once something has been SEEN — feed it three shown turns
  for (let i = 0; i < 3; i++) { s.world.current_turn++; tickAuthored(s, 15, "She asked him about the thing, or nearly did."); }
  const line = authoredLine(s.characters.char_neigh.authored![0]);
  check("the narrator is told how far along it is, as a number", /\d+% of the way/.test(line), line);
  check("and that it must show at exactly that strength and no more", /at exactly this strength and no more/.test(line), line);
  check("with an invisible turn named as failure", /nothing about it can be seen is a turn in which this failed/.test(line), line);
}
{
  // the budget completes the want, so "fully inhabits it" actually finishes
  const s = mk(20);
  s.characters.char_neigh.authored = [newAuthored("ask him about the thing", 20, { inhabit_turns: 2, crystallize: true })];
  for (let i = 0; i < 4; i++) {
    s.world.current_turn++;
    const shown = "She asked him about the thing again, plainly.";
    s.history.push({ turn: s.world.current_turn, player_action: "", narrator_prose: shown } as any);
    tickAuthored(s, 15, shown);
  }
  check("reaching the deadline makes it part of who they are",
    !!s.characters.char_neigh.authored?.[0]?.crystallized_turn, s.characters.char_neigh.authored?.[0]);
}
{
  // and without a budget nothing changes — in-world hours still govern
  const s = mk(20);
  s.characters.char_neigh.authored = [newAuthored("ask him", 20, { rate: "fast" })];
  // These two were passing the whole LIST where a single want belongs, left over from when `authored`
  // was one object. Both checks were reading fields off an array and quietly asserting nothing.
  check("an unbudgeted want still reports off its rungs", intensity(s.characters.char_neigh.authored![0]) < 0.3);
  check("and its line carries no percentage", !/% of the way/.test(authoredLine(s.characters.char_neigh.authored![0])));
}

/* ── 7. THE DEADLINE IS THE DEADLINE ─────────────────────────────────────────────
 *
 * This section used to assert the opposite, and the history is worth keeping because both versions
 * were responses to a real save.
 *
 * FIRST: a 20-turn budget ran to completion with the character present throughout, the want never
 * reached the prose once, and the deadline hardened it into a core trait reading "Forces Rabi lick
 * her armpit. Anytime they're together." The engine declared a habit the story had never shown. So a
 * guard went in: crystallisation required finding the want's distinctive words somewhere in the
 * prose since it was written.
 *
 * THEN: the want finally started landing, and the guard could not see it. The beat that worked was
 * Dana standing a half-step too close with her sleeve rolled up, holding the position "just long
 * enough that something in the angle of her body read as an opening". That is EXACTLY the bottom
 * rung performed correctly, and the detector scored the turn as skipped. It could only ever have
 * fired on prose that said the quiet part — which is to say, on the rushed and announced version
 * this whole ladder exists to prevent.
 *
 * A detector that fires on the failure and misses the success is not a guard, so it is gone. What
 * stops a want hardening now is the player: `crystallize` is a per-want switch, and `drop it` and
 * `knock it back` are on the card. The deadline they set is honoured. */
{
  const s = mk(20);
  s.characters.char_neigh.authored = [newAuthored("ask him to do the thing", 20, { inhabit_turns: 3, crystallize: true })];
  s.world.current_turn = 24;
  for (let i = 0; i < 4; i++) { s.world.current_turn++; tickAuthored(s, 15); }
  const a = s.characters.char_neigh.authored![0];
  check("the schedule runs to the top on turns alone", (a.stage ?? 0) === MAX_STAGE, a.stage);
  check("and the deadline the player set is honoured", !!a.crystallized_turn, a);
  check("so it is written into who they are", s.characters.char_neigh.core_traits.some((t) => /do the thing/.test(t)), s.characters.char_neigh.core_traits);
}
{
  // The player's actual veto, which is a switch rather than a heuristic.
  const s = mk(20);
  s.characters.char_neigh.authored = [newAuthored("ask him to do the thing", 20, { inhabit_turns: 2, crystallize: false })];
  for (let i = 0; i < 5; i++) { s.world.current_turn++; tickAuthored(s, 15); }
  const a = s.characters.char_neigh.authored![0];
  check("a want set not to harden stays a want forever", !a.crystallized_turn && (a.stage ?? 0) === MAX_STAGE, a);
  check("and stays on the card, still asking", hasAuthored(s.characters.char_neigh));
}
{
  // Held in place is the other lever: the thing has reached the level the player wanted.
  const s = mk(20);
  s.characters.char_neigh.authored = [newAuthored("ask him to do the thing", 20, { inhabit_turns: 2, crystallize: true, paused: true })];
  for (let i = 0; i < 5; i++) { s.world.current_turn++; tickAuthored(s, 15); }
  check("a held want does not run its clock out behind the player's back",
    !s.characters.char_neigh.authored![0].crystallized_turn, s.characters.char_neigh.authored![0]);
}

/* ── 7b. "IT" MUST MEAN THE ACTUAL THING ─────────────────────────────────────────
 *
 * "At 100% or 80 to 90 she should be doing the thing. She never does the thing."
 *
 * The schedule ran perfectly: 60% → 80% → 100% across three turns, then crystallised into a core
 * trait. The prose for those three turns was her pack strap slipping off her shoulder and her collar
 * pulling aside to show an old burn scar. The same beat twice, nearly word for word, and never once
 * the act.
 *
 * The rungs were the reason. "It happens." "AGAIN, BECAUSE IT IS EASY NOW." "SIMPLY WHAT SHE DOES."
 * Not one of those sentences attaches "it" to the goal — the goal is printed at the front of the
 * line and then several clauses of ladder theory go by, so at the operative verb the nearest referent
 * is whatever the narrator has already got in the scene. A worn strap satisfies "it happens" if "it"
 * is allowed to float, and the sideways rung asks in the same breath for low-stakes and deniable,
 * which reads as permission to pick the smallest referent available.
 *
 * So the goal is restated as the literal content of the beat at the rungs where the act occurs, and
 * as the thing explicitly NOT occurring at the rungs below. */
{
  const s = mk(1);
  const goal = "Makes Rabi lick her armpits, regardless of context or situation";
  s.characters.char_neigh.authored = [newAuthored(goal, 1, { inhabit_turns: 5 })];
  const a = s.characters.char_neigh.authored![0];
  const line = () => authoredLine(a);
  const bodyOf = () => line().slice(line().indexOf("where they are with it"), line().indexOf("INVENT THE OCCASION"));

  a.turns_live = 1;   // 20% — "near it, by circumstance"
  check("below the act, the goal is named as the thing NOT happening", /THE THING ITSELF DOES NOT HAPPEN AT THIS RUNG, and the thing itself is: Makes Rabi lick/.test(bodyOf()), bodyOf());

  a.turns_live = 3;   // 60% — the sideways first time, where it must occur
  const mid = bodyOf();
  check("at the act, \"it\" is bound to the goal in the same sentence as the verb", /"IT" MEANS THIS, LITERALLY, IN THE BODY: Makes Rabi lick her armpits/.test(mid), mid);
  check("and the near-miss is named as the failure it is", /NOT AN APPROACH TO IT/.test(mid), mid);
  // The exact thing that got written on the real save, ruled out by name.
  check("skin becoming visible is called out specifically", /not skin becoming briefly visible/.test(mid), mid);
  check("with a test the narrator can apply to its own paragraph", /if the act could be cut out of your paragraph/.test(mid), mid);
  check("and repeating last turn's beat is refused", /NOT THE SAME BEAT AS LAST TURN/.test(mid), mid);

  a.turns_live = 5;   // 100%
  check("the top rung binds it too", /"IT" MEANS THIS, LITERALLY, IN THE BODY/.test(bodyOf()), bodyOf());
}
{
  // Once it has hardened the want leaves `authored`'s live list and is carried by the settled line,
  // which had the same hole: "if this scene gives it any opening at all" is a condition, and a
  // condition is something a model can decide is unmet.
  const s = mk(9);
  s.world.present = ["char_neigh"];
  s.characters.char_neigh.authored = [newAuthored("Makes Rabi lick her armpits", 1, { inhabit_turns: 2 })];
  crystallize(s, "char_neigh", s.characters.char_neigh.authored![0], 9);
  const d = habitDirective(s, s.world.present);
  check("a finished habit is stated as the act, not as a version of it", /Not a version of it, not a suggestion of it/.test(d), d);
  check("and carries no condition the narrator can find unmet", !/if this scene gives it any opening/.test(d) && /there is no "if the scene allows"/.test(d), d);
  check("and nobody treats it as news", /nobody remarks on it being new/.test(d), d);
}

/* ── 7c. WHEN THE ACT IS THE PLAYER'S TO PERFORM ─────────────────────────────────
 *
 * The rung above finally produced the whole approach and stopped one sentence short. Dana rolls the
 * shoulder, "her arm lifted, the sleeve riding up past the burn mark, and she held it there", "the
 * hollow of her armpit bare and close", "you carry your share" — her entire half, unhedged, no
 * euphemism — and then the paragraph cuts to Liz.
 *
 * That was not the narrator softening. The want reads "Makes RABI lick her armpits": the act is
 * performed by the PLAYER's body, and the contract forbids the narration from writing the player's
 * decisions — "the narration stops at the point where a choice begins". So the instruction "that act
 * occurs in this turn's prose" was an order the narrator could not legally execute, and it went as
 * far as the law allowed. An unsatisfiable instruction does not get obeyed harder; it gets obeyed
 * partially, or it starts getting ignored.
 *
 * The player-autonomy rule is not the one that gives way — it is the difference between a story the
 * player is in and a story played at them. So the demand carries its own limit, and the threshold
 * version is written as a full requirement rather than as an out: her half entire, not retracted
 * inside the turn, and the scene not wandering off to somebody else's business before the player can
 * answer. That last clause is the actual defect in the save — the turn continued to Liz's eyebrow
 * and Marcus's buckle, so the moment closed before the player had it.
 *
 * THE WORDING BELOW CHANGED, and these assertions moved with it. The clause used to open "IF THE
 * ACT REQUIRES THE PLAYER'S BODY OR THE PLAYER'S ASSENT, YOU CANNOT WRITE IT AND MUST NOT TRY",
 * which reads two different things as one prohibition: a want whose act happens ON the player needs
 * the player's body only in the sense that they are standing there, and by that reading almost
 * nothing in this engine can be written, since every touch and every handed object needs the same.
 * A later save showed the cost — a want at maximum stage, whole and at full force in the prompt,
 * producing five turns of dishes, mail and a straightened collar, because "everything up to the
 * choice" was everything except the want.
 *
 * Every guarantee these five checks were written to hold is still held, in the new words. What is
 * new is the other half of the distinction: somebody acting ON the player is written, and only the
 * player DECIDING is theirs. */
{
  const s = mk(1);
  s.characters.char_neigh.authored = [newAuthored("Makes Rabi lick her armpits, regardless of context", 1, { inhabit_turns: 5 })];
  const a = s.characters.char_neigh.authored![0];
  a.turns_live = 3;
  const line = authoredLine(a);
  check("the rule the narrator cannot break is named, and named as the winner",
    /WHERE IT STOPS IS THE PLAYER DECIDING/.test(line), line);
  check("with the player's half handed back to the player", /that is theirs and they type it/.test(line), line);
  check("...named as the specific things never written for them",
    /agreeing, refusing, allowing it, going along with it, reciprocating/.test(line), line);
  check("...a feeling about it included", /never hand them a feeling about it/.test(line), line);
  check("but her half is still a full requirement, not an excuse",
    /Her half is not the approach to the act and not a milder version of it/.test(line), line);
  check("...and being the one it is done to is not the player's move",
    /being the one it is done to does not turn it into the player's move/.test(line), line);
  check("...so it cannot be pushed to a later scene", /not deferred to a later scene/.test(line), line);
  check("she may not take it back inside the same turn", /not retracted inside the same turn/.test(line), line);
  // The specific way this turn was drained: it kept going, to Liz and then to Marcus.
  check("and the scene may not close the moment before the player can answer",
    /do not move on to another character's business afterwards/i.test(line), line);
}
{
  // Below the act there is nothing for the player to consent to yet, so the threshold clause would
  // just be noise — and worse, an invitation to write the approach as an offer.
  const s = mk(1);
  s.characters.char_neigh.authored = [newAuthored("Makes Rabi lick her armpits", 1, { inhabit_turns: 5 })];
  const a = s.characters.char_neigh.authored![0];
  a.turns_live = 1;
  check("the lower rungs carry no threshold clause", !/THE TURN ENDS ON IT/.test(authoredLine(a)), authoredLine(a));
}
{
  // A habit that has hardened is not a proposal. It had "she does not comment on it", which still
  // leaves a character who works up to it every time — the thing being established means she starts
  // from the far end.
  const s = mk(9);
  s.world.present = ["char_neigh"];
  s.characters.char_neigh.authored = [newAuthored("Makes Rabi lick her armpits", 1, { inhabit_turns: 2 })];
  crystallize(s, "char_neigh", s.characters.char_neigh.authored![0], 9);
  const d = habitDirective(s, s.world.present);
  check("a settled habit assumes rather than asks", /she does not ask for it and does not work up to it/.test(d), d);
  check("and is not embarrassed by an audience", /unbothered by who is standing there/.test(d), d);
  check("and it too stops where the player's choice begins", /WHERE IT STOPS IS THE PLAYER DECIDING/.test(d), d);
}

/* ── 8. A SAVE WRITTEN UNDER THE OLD GATE STILL KNOWS WHERE IT IS ────────────────
 *
 * Every want injected while the detector was live carries `seen` and no `turns_live`, and `seen` is
 * a bad number — on the save that prompted the removal it read 0 for a turn that had landed. Reading
 * the schedule off a fresh `turns_live` alone would silently reset those wants to 10%: the player
 * would open the card and find yesterday's injection back at the start.
 *
 * Turns elapsed since it was written is what the field would have held all along, so that is the
 * backfill — held one short of the budget, so the top rung is always reached by a real turn with the
 * direction in front of the narrator rather than by the migration itself. */
{
  const s = mk(1);
  const old = newAuthored("Makes Rabi lick her armpits, regardless of context", 1, { inhabit_turns: 3 });
  delete (old as { turns_live?: number }).turns_live;
  (old as { seen?: number }).seen = 0;
  (old as { stalled?: number }).stalled = 1;
  s.characters.char_neigh.authored = [old];
  s.world.current_turn = 2;
  tickAuthored(s, 15);
  const a = s.characters.char_neigh.authored![0];
  check("an old want picks up where the story actually is", (a.turns_live ?? 0) === 1, a.turns_live);
  check("rather than restarting at nothing", Math.round(intensity(a) * 100) > 10, Math.round(intensity(a) * 100));
}
{
  // A long-abandoned want does not complete itself in the instant the save loads.
  const s = mk(1);
  const old = newAuthored("ask him to do the thing", 1, { inhabit_turns: 4, crystallize: true });
  delete (old as { turns_live?: number }).turns_live;
  s.characters.char_neigh.authored = [old];
  s.world.current_turn = 90;
  tickAuthored(s, 15);
  const a = s.characters.char_neigh.authored![0];
  check("the migration itself never crystallises anything", !a.crystallized_turn, a);
  check("it lands one turn short of the deadline instead", (a.turns_live ?? 0) === 3, a.turns_live);
  s.world.current_turn++;
  tickAuthored(s, 15);
  check("and the next real turn — the one the narrator was told about — finishes it",
    !!s.characters.char_neigh.authored![0].crystallized_turn);
}

/* ── 9. THE MODEL INVENTS THE OCCASION, AND A FINISHED HABIT STAYS VISIBLE ───────
 *
 * "You can literally utilize the habit creation within the framework of the story — it would have to
 *  invent the scenario for the habit to build emergent out of current conditions without requiring
 *  it to break any rules. For Dana it could be 'I get so sweaty, my bag slips off' or 'you need salt,
 *  your bones hurt, we don't have salt'."
 *
 * That is a better answer than the mechanism I was about to build. The engine has nothing that
 * manufactures the circumstances a habit forms under, and a model asked to find one inside the
 * conditions already present will do it better than a pressure table would.
 *
 * "And worse is that once it's solidified it doesn't show up at all in the personality."
 *
 * That one was mine. Crystallising REMOVED the want — hasAuthored went false, the wants slot lost
 * it, and it survived only as one line among five in core_traits, which nothing obliges anybody to
 * act on. The reward for a habit completing was that it stopped appearing. */
{
  const s = mk(1);
  s.characters.char_neigh.authored = [newAuthored("start having people over late", 1, { inhabit_turns: 6 })];
  const line = authoredLine(s.characters.char_neigh.authored![0]);
  check("the narrator is told to invent the occasion", /INVENT THE OCCASION/.test(line), line.slice(0, 120));
  check("out of conditions that already exist", /conditions that already exist/.test(line));
  check("and is given the shape of one", /bag strap|no water|salt/.test(line));
  check("without inventing new facts about the world", /invent no new fact about the world/.test(line));
  check("and without waiting for the world to supply it", /do not wait for one/.test(line));
}
{
  const s = scene({ authored: [newAuthored("start having people over late", 1, { inhabit_turns: 2, crystallize: true })] });
  const c: any = s.characters.char_n;
  c.authored[0].crystallized_turn = 9;
  const lines = volatileDigest(s, "").split("\n").filter((l) => /simply does this|wants/.test(l));
  check("a finished habit is still on the card", lines.some((l) => /people over late/.test(l)), lines);
  // the card keeps a one-line reference; the working instruction moved to the per-turn direction,
  // because a rule in the middle of a 30k digest is reference and a rule at the end is an instruction
  check("the card points at where the instruction actually lives", lines.some((l) => /see the direction below/.test(l)), lines);
  check("the card does not also claim they want nothing", !lines.some((l) => /nothing pressing/.test(l)), lines);
}

/* ── 10. A RULE AT THE END IS AN INSTRUCTION; ONE IN THE MIDDLE IS REFERENCE ─────
 *
 * Ten turns, 0% seen, stalled 6 — with the want on the card, correct and complete, on every one of
 * them. It sat 60% of the way through a 29,788-character digest, behind a 27,000-character contract.
 * Every previous fix made that middle-of-the-document entry longer, which is not the same as making
 * it louder.
 *
 * This is the identical failure to the repeated-dialogue bug earlier in the same session, whose fix
 * was to move the no-repeat rule out of a block sixty thousand characters in and put it where
 * nothing follows it. I never applied that lesson here. */
{
  const s = mk(5);
  s.world.present = ["char_neigh"];
  s.characters.char_neigh.authored = [newAuthored("start having people over late", 1, { inhabit_turns: 6 })];
  const d = habitDirective(s, s.world.present);
  check("the want reaches the per-turn direction, not only the card", /people over late/.test(d), d.slice(0, 120));
  check("stated as required rather than as background", /NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE/.test(d));
  check("a turn without it is not an option at all", /no version of this turn in which none of it can be seen/.test(d));
  check("and the narrator is denied the busy-scene excuse", /too busy for it, or that the plot matters more/.test(d));
  // There used to be an extra "IT HAS BEEN SKIPPED N TURNS RUNNING" line here, driven by the prose
  // detector. It fired on the save where the beat had actually landed — telling the narrator to push
  // harder than the rung allows, on the strength of a reading that was wrong. A false signal in the
  // prompt costs more than a missing one, so the direction now says only what it knows: the rung,
  // the percentage, and that it is due this turn.
  check("and nothing in it is conditioned on a guess about last turn's prose", !/SKIPPED/.test(d), d);
}
{
  const s = mk(5);
  s.world.present = ["char_neigh"];
  s.characters.char_neigh.authored = [newAuthored("start having people over late", 1, { inhabit_turns: 2 })];
  s.characters.char_neigh.authored![0].crystallized_turn = 4;
  const d = habitDirective(s, s.world.present);
  check("a finished habit is in the direction too", /SIMPLY DOES THIS NOW/.test(d), d.slice(0, 200));
  // It used to read "if this scene gives it any opening at all" — a condition, and a condition is
  // something a model can decide is unmet. A finished habit has no condition; that is what finished
  // means. See section 7b: the same floating-referent problem, one level up.
  check("and carries no condition at all", /there is no "if the scene allows"/.test(d), d);
}
{
  /* "There are random habits that are never used at all, but they should integrate to make a person,
   * which is why everyone feels like the same person." Same failure one level up: core_traits are
   * listed where things are listed, never where things are asked for. */
  const s = mk(5);
  s.world.present = ["char_neigh"];
  s.characters.char_neigh.core_traits = ["Sleeps with a wrench within arm's reach", "Comments on every wasted resource out loud"];
  const d = habitDirective(s, s.world.present);
  check("an existing core trait is asked for by name", /wrench|wasted resource/.test(d), d);
  check("as something they DO rather than something stated", /in something they DO rather than something stated/.test(d));
  const turns = [5, 6, 7, 8].map((t) => { s.world.current_turn = t; return habitDirective(s, s.world.present); });
  check("and it rotates, so it is a different one across turns", new Set(turns).size > 1);
}
{
  const s = mk(5);
  s.world.present = [];
  check("an empty room asks for nothing", habitDirective(s, []) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
