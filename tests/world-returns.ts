/* Smoke test: THE WORLD THAT MOVES OFFSCREEN HAS TO COME BACK.
 *
 * Measured on a 108-turn save: `world.offstage_log` reached the narrator and the bookkeeper 0% of
 * the time — 225 fields of invented world with exactly one reader, the offstage pass itself,
 * checking what it already said so as not to repeat. 103 rumours, of which 86 never left their
 * witness and 0 were ever brought up by a second-hand knower. 45 offstage events, 0 that surfaced
 * above the coincidence floor. The world sim ran for a hundred turns talking to itself.
 *
 * Four return paths, each closing a different half of that:
 *   1. what a present character HAS HEARD — was gated behind detail>=2, the top context budget
 *   2. what a present character SAW while the player was elsewhere — the witness memory the offstage
 *      pass writes, which was then losing a word-overlap relevance sort to a hundred other memories
 *   3. what happened IN THIS ROOM since the player last stood in it
 *   4. a question the world opened for itself — threads were authored-only, so offstage motion could
 *      never change what the story was ABOUT */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest } from "../src/engine/prompts";
import { applyOffstage } from "../src/engine/offstage";
import { applyReflection } from "../src/engine/memory";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("returns", {
    name: "The Arrangement",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa", character_id: "char_tessa" } as any);
  s.world.current_turn = 40;
  s.world.present = ["char_tessa"];
  // a bare newSave has no ground; the room is the whole point of test 3
  const pid = "loc_apartment";
  s.world.places[pid] = { id: pid, name: "the apartment", description_facts: "Two rooms and a kitchen.", contains: [] } as any;
  s.world.player_location = pid;
  s.characters.char_player.location = pid;
  s.characters.char_tessa.location = pid;
  return s;
}

/* ── 1. news someone is carrying reaches the narrator at ordinary detail ─────── */
{
  const s = world();
  s.world.rumors = [{
    id: "rum1", content: "The foreman walked off the Brackenridge site and took two of the crew with him.",
    truth: "true", salience: 0.8, origin_char: "char_player", knowers: ["char_player", "char_tessa"],
    born_turn: 30, dead: false, path: [],
  } as any];
  // the low budget is the point: this used to be a top-context-only field
  s.model_settings.token_budget = 3000;
  const digest = volatileDigest(s, "");
  check("what a character has heard reaches the narrator", /has heard/.test(digest) && /Brackenridge/.test(digest), digest.slice(0, 200));
  check("and is offered, not ordered", /never make them announce it/.test(digest));
}
{
  const s = world();
  s.world.rumors = [{
    id: "rum1", content: "Something Tessa herself started.", truth: "true", salience: 0.5,
    origin_char: "char_tessa", knowers: ["char_tessa"], born_turn: 30, dead: false, path: [],
  } as any];
  check("a rumour they started is not news TO them", !/has heard/.test(volatileDigest(s, "")));
}

/* ── 2. what they saw while the player was somewhere else ────────────────────── */
{
  const s = world();
  s.memory.char_tessa.episodic.push({
    id: "m1", turn: 36, content: "John cleared his desk at the firm and left without telling anyone.",
    importance: 7, source: "offstage", where: "the firm", when_label: "Day 4",
  } as any);
  // bury it under a pile so a relevance sort would never surface it — that is the failure this fixes
  for (let i = 0; i < 60; i++) {
    s.memory.char_tessa.episodic.push({ id: `f${i}`, turn: 37, content: `An ordinary unrelated moment number ${i}.`, importance: 3, source: "witnessed" } as any);
  }
  const digest = volatileDigest(s, "completely unrelated query about weather");
  check("an offstage sighting gets its own slot", /saw while you were elsewhere/.test(digest), digest.slice(0, 200));
  check("even buried under sixty other memories", /cleared his desk/.test(digest));
}
{
  const s = world();
  s.memory.char_tessa.episodic.push({
    id: "old", turn: 1, content: "Something from very long ago that has stopped mattering.",
    importance: 7, source: "offstage",
  } as any);
  check("but an old sighting stops being live", !/saw while you were elsewhere/.test(volatileDigest(s, "")));
}

/* ── 3 & 4. the applier: traces in the room, and a question the world opened ─── */
const place = (s: SaveState) => s.world.places[s.world.player_location];

{
  const s = world();
  const here = place(s).name;
  const log = applyOffstage(s, [{
    actor: "Tessa", place: here, what: "Tessa came back for the rest of her things and left the key on the counter.",
    witnesses: ["Tessa"],
    opens_thread: { title: "The Key on the Counter", description: "Whether the lease gets signed over or simply runs out." },
  }] as any, []);
  check("the event is logged", (s.world.offstage_log ?? []).length === 1, s.world.offstage_log);
  check("the witness carries it as an offstage memory",
    s.memory.char_tessa.episodic.some((m) => m.source === "offstage" && /left the key/.test(m.content)));
  check("the world opened a thread", s.world.threads.some((t) => t.title === "The Key on the Counter"), s.world.threads.map((t) => t.title));
  check("which is an ordinary active thread, indistinguishable from an authored one",
    s.world.threads.find((t) => t.title === "The Key on the Counter")?.status === "active");
  check("and it says so in the log", log.some((l) => /opened a question/.test(l)), log);
}
{
  // it may raise questions; it may not bury the story in them
  const s = world();
  const here = place(s).name;
  for (let i = 0; i < 14; i++) {
    s.world.threads.push({ id: `thr_${i}`, title: `Existing question ${i}`, description: "…", status: "active", tension: 3, turn_started: 1 } as any);
  }
  applyOffstage(s, [{ actor: "Tessa", place: here, what: "Something happened.", witnesses: [],
    opens_thread: { title: "One More Question", description: "…" } }] as any, []);
  check("a crowded board gets no new questions", !s.world.threads.some((t) => t.title === "One More Question"), s.world.threads.length);
}
{
  // and never the same question twice
  const s = world();
  const here = place(s).name;
  s.world.threads.push({ id: "thr_x", title: "The Key on the Counter", description: "…", status: "active", tension: 3, turn_started: 1 } as any);
  applyOffstage(s, [{ actor: "Tessa", place: here, what: "Something happened.", witnesses: [],
    opens_thread: { title: "the key on the counter", description: "…" } }] as any, []);
  check("a question already being asked is not asked again",
    s.world.threads.filter((t) => /key on the counter/i.test(t.title)).length === 1, s.world.threads.map((t) => t.title));
}
{
  const s = world();
  applyOffstage(s, [{ actor: "Tessa", place: place(s).name, what: "An ordinary evening that resolved itself.", witnesses: [] }] as any, []);
  check("an ordinary event opens nothing", s.world.threads.length === 0, s.world.threads);
}

/* ── 5. and it survives the compaction that was deleting it ─────────────────── */
{
  const s = world();
  s.world.current_turn = 60;
  const mem = s.memory.char_tessa;
  // an offstage sighting, filed at 7, against the player's own scenes, which run 8-10
  mem.episodic.push({ id: "off", turn: 50, content: "John cleared his desk and left without telling anyone.", importance: 7, source: "offstage" } as any);
  for (let i = 0; i < 12; i++) {
    mem.episodic.push({ id: `sc${i}`, turn: 40 + i, content: `A scene that mattered more, number ${i}.`, importance: 10, source: "witnessed" } as any);
  }
  applyReflection(mem, [{ content: "A conclusion.", confidence: 0.8, formed_turn: 60, evidence_turns: [] }], 60);
  check("an offstage sighting survives the reflection compaction",
    mem.episodic.some((m) => m.source === "offstage" && /cleared his desk/.test(m.content)),
    mem.episodic.map((m) => m.source));
}
{
  const s = world();
  s.world.current_turn = 200;
  const mem = s.memory.char_tessa;
  mem.episodic.push({ id: "off", turn: 50, content: "Something from long ago.", importance: 7, source: "offstage" } as any);
  // the six older slots have to be full, or it survives on importance alone and proves nothing
  for (let i = 0; i < 10; i++) {
    mem.episodic.push({ id: `sc${i}`, turn: 60 + i, content: `A scene that mattered more, number ${i}.`, importance: 10, source: "witnessed" } as any);
  }
  applyReflection(mem, [{ content: "A conclusion.", confidence: 0.8, formed_turn: 200, evidence_turns: [] }], 200);
  check("but it is not kept forever — once it stops being news it competes like anything else",
    !mem.episodic.some((m) => m.id === "off"), mem.episodic.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
