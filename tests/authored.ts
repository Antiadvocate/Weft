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
import { authoredLine, authoredWants, crystallize, hasAuthored, newAuthored, setback, tickAuthored, MAX_STAGE } from "../src/engine/authored";
import { regenerateDrives, seedDrive } from "../src/engine/drives";
import type { SaveState } from "../src/engine/types";

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
  for (let t = 0; t < 40; t++) { s.world.current_turn++; tickAuthored(s); }
  const a = s.characters.char_neigh.authored!;
  check("forty turns later the want is still there", !!a.goal);
  check("it never reports progress, because it is not a task", !("progress" in a), Object.keys(a));
  check("and it does not climb past the top rung", a.stage === MAX_STAGE, a.stage);
}

/* ── 3. it climbs, at the rate that was chosen ───────────────────────────────── */
{
  const s = mk();
  give(s, { rate: "steady" });
  const stageAfter = (n: number) => {
    for (let i = 0; i < n; i++) { s.world.current_turn++; tickAuthored(s); }
    return s.characters.char_neigh.authored!.stage;
  };
  check("it starts at the bottom", s.characters.char_neigh.authored!.stage === 0);
  check("a few turns in, it is still a new thing", stageAfter(5) === 0, s.characters.char_neigh.authored!.stage);
  check("it moves up once it has been going a while", stageAfter(3) >= 1, s.characters.char_neigh.authored!.stage);
}
{
  // rate is the whole dial — slow and fast must not land in the same place
  const run = (rate: "slow" | "fast", turns: number) => {
    const s = mk(); give(s, { rate });
    for (let i = 0; i < turns; i++) { s.world.current_turn++; tickAuthored(s); }
    return s.characters.char_neigh.authored!.stage;
  };
  check("fast gets there and slow does not, over the same stretch", run("fast", 9) > run("slow", 9), [run("fast", 9), run("slow", 9)]);
}
{
  const s = mk();
  give(s, { rate: "fast", paused: true });
  for (let i = 0; i < 20; i++) { s.world.current_turn++; tickAuthored(s); }
  check("a want held in place stays where it was put", s.characters.char_neigh.authored!.stage === 0);
}
{
  const s = mk();
  give(s, { rate: "fast", stage: 2 });
  check("starting it partway up does not strand the counter below it",
    s.characters.char_neigh.authored!.acted >= 2 * 3, s.characters.char_neigh.authored!.acted);
  s.world.current_turn++; tickAuthored(s); s.world.current_turn++; tickAuthored(s); s.world.current_turn++; tickAuthored(s);
  check("so the next rung arrives on schedule rather than after a full re-climb",
    s.characters.char_neigh.authored!.stage === 3, s.characters.char_neigh.authored!.stage);
}
{
  const s = mk();
  give(s, { rate: "steady", stage: 2 });
  setback(s.characters.char_neigh.authored!);
  const a = s.characters.char_neigh.authored!;
  check("being faced down costs a rung", a.stage === 1, a.stage);
  check("and the counter goes back with it, so it does not jump straight up again", a.acted === 1 * 6, a.acted);
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
  for (let i = 0; i < 12; i++) { s.world.current_turn++; tickAuthored(s); }
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
  for (let i = 0; i < 20; i++) { s.world.current_turn++; tickAuthored(s); }
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
  for (let i = 0; i < 20; i++) { s.world.current_turn++; tickAuthored(s); }
  check(`a ${status} character's authored want stops climbing`, s.characters.char_neigh.authored!.stage === 0);
  check(`and is not handed to the world-sim`, !authoredWants(s).has("char_neigh"));
}
{
  const s = mk();
  give(s, { paused: true });
  check("a held want is not driving the world either", !authoredWants(s).has("char_neigh"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
