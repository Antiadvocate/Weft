/* THE OTHER END OF IT.
 *
 * tests/the-gone-stay-gone.ts is about the narrator writing a dead man back in. This is about the
 * engine ASKING for him. Across the six saves of the game where Arthur Penhale came through the
 * revolving doors of the Ritz six times after being shot, the world was still holding threads like
 *
 *   [dormant] Hollis is sending a boy at three      — Hollis is dead
 *   [dormant] Halloran holds Vance's letter         — Vance has left the story
 *
 * as live sources. Dormant is not a reprieve — dormant threads are deliberately kept eligible so
 * the world can pick a subject back up, and they skip the tension bar while they are at it. The
 * likeliest use of "Hollis is sending a boy at three" is the turn the world returns to it, which is
 * the turn a dead man sends a boy. Handed that as the thing the scene is about, a narrator writes
 * Hollis, and it is not hallucinating: it is doing what it was told.
 *
 * The posture is the one forbidden_engine already uses. The thread stays open, the clock keeps
 * ticking, they just stop being the reason for a scene. */
import { namesTheGone, fictionHeat, selectBeat, beatSources } from "../src/engine/pressure";
import type { Thread, FactionClock } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const GONE = ["Arthur Penhale", "Emily Clarke", "Jo"];

/* ── THE MATCH ─────────────────────────────────────────────────────────────────────────────── */
for (const t of [
  "Arthur Penhale's network",
  "Arthur's men are seen in new suits",
  "what Penhale owed the Cattermoles",
  "Emily Clarke will not be talked round",
  "the letter EMILY left in the drawer",
]) check(`named: ${t.slice(0, 46)}`, namesTheGone(t, GONE), t);
for (const t of [
  "the upkeep dispute at the mill",
  "Olga wants the ledger back",
  "the Cattermoles are hiring again",
  "",
]) check(`untouched: ${t.slice(0, 46) || "(empty)"}`, !namesTheGone(t, GONE), t);
check("a two-letter first name is not a word to search for", !namesTheGone("the job is done", GONE));
/* A LONE TOKEN ONLY COUNTS CAPITALISED. Surnames are ordinary English words, and so are half the
 * first names anybody uses; a thread called "the rose beds have gone over" is about flowers even
 * when the story has lost a Rose. Titles capitalise their people and not their flowers. */
check("a lowercase surname is a word", !namesTheGone("the penhale road needs resurfacing", GONE));
check("…but the full name always counts, however it is written",
  namesTheGone("arthur penhale's road", GONE));
check("a common word that happens to be a surname is left alone",
  !namesTheGone("the rose beds have gone over", ["Rose Kellaway"]));
check("…and the same word capitalised is the person",
  namesTheGone("what Rose left unfinished", ["Rose Kellaway"]));
check("nobody gone, nothing matched", !namesTheGone("Arthur Penhale's network", []));

/* ── AND WHAT IT DOES TO THE SELECTOR ──────────────────────────────────────────────────────── */
const thread = (id: string, title: string, tension: number, status = "active"): Thread =>
  ({ id, title, tension, status } as unknown as Thread);
const clock = (faction: string, objective: string, filled: number, signs: string[]): FactionClock =>
  ({ id: `clk_${faction}`, faction, objective, filled, segments: 6, status: "running", visible_signs: signs } as unknown as FactionClock);

const threads = [
  thread("t1", "Arthur Penhale's debt to the Cattermoles", 8),
  thread("t2", "whether Penhale's men know he is dead", 7, "dormant"),
  thread("t3", "the upkeep dispute at the mill", 3),
];
const clocks = [
  clock("Penhale's network", "regroup under a new name", 5, ["Arthur's men are seen in new suits"]),
  clock("the Cattermoles", "buy the freehold", 5, ["surveyors on the lane", "Arthur's old lorry parked outside the office"]),
];

{
  const live = fictionHeat(threads, clocks, [], 40, undefined, [], GONE);
  check("the hottest source is skipped when it is a dead man's",
    !/Penhale/i.test(live.source), live);
  check("…and the next hottest live source gets the scene", /Cattermoles/.test(live.source), live);
  check("…which is still a real one", live.heat > 0, live);
  const blind = fictionHeat(threads, clocks, [], 40, undefined, []);
  check("without the list, the old behaviour is intact", /Penhale/i.test(blind.source), blind);
}

const beatInput = {
  turn: 40, tension: 7, threads, clocks, consequences: [], agents: [],
  last_beat_turn: 0, last_exo_turn: 0, recent: [], gone: GONE,
};
{
  const refs = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const b = selectBeat({ ...beatInput, rng: () => (i * 0.0025) % 1 });
    const r = (b as { ref?: string }).ref;
    if (r) refs.add(r);
    if (b.kind === "clock") for (const s of b.signs ?? []) refs.add(s);
  }
  check("four hundred draws and he is named in none of them",
    ![...refs].some((r) => namesTheGone(r, GONE)), [...refs].filter((r) => namesTheGone(r, GONE)));
  check("…and the world still has something to press with", refs.size > 0, [...refs]);
  check("a live clock keeps its clean signs", [...refs].some((r) => /surveyors on the lane/.test(r)), [...refs]);
  check("…and loses only the sign that names him",
    ![...refs].some((r) => /old lorry/.test(r)), [...refs]);
}
{
  const rows = beatSources(beatInput).join("\n");
  check("the [[beat: ?]] table agrees with the selector", !namesTheGone(rows, GONE), rows);
  check("…and still lists what is live", /mill/.test(rows) && /freehold/.test(rows), rows);
  check("without the list it lists everything, as before",
    namesTheGone(beatSources({ ...beatInput, gone: undefined }).join("\n"), GONE));
}

/* A CLOCK WHOSE ONLY SIGN NAMES HIM IS NOT A YOUNG CLOCK — the young-clock branch exists to put a
 * sign on the page, and if the only sign is unusable there is nothing to put there. */
{
  const only = [clock("Penhale's network", "regroup", 1, ["Arthur's men are seen in new suits"])];
  const b = selectBeat({ ...beatInput, threads: [], clocks: only, tension: 9, rng: () => 0.01 });
  check("a clock with nothing showable left is not offered", b.kind !== "clock", b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
