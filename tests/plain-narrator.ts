/* THE PLAIN NARRATOR: THE STORY AND THE PEOPLE, AND NO DIRECTIONS.
 *
 * On the Velora save the directed narrator got about 155,000 characters for one turn, of which the
 * story itself was about 6,000 and only the last three turns. This pins the other shape: the whole
 * story, the scene, each person present as a whole person with their openness described, and no
 * per-turn direction at all. */
import { plainNarratorMessages, opennessWords, storyBlock, PLAIN_NARRATOR_SYSTEM } from "../src/engine/plain";
import { sanitize } from "../src/engine/state";
import { readFileSync } from "node:fs";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const history = Array.from({ length: 20 }, (_, i) => ({
  turn: i, player_action: i ? `"Line ${i}"` : "", time_label: `Day 1, 09:${String(i).padStart(2, "0")}`,
  narrator_prose: `PROSE-OF-TURN-${i}. ` + "Sera turns the glass in xer hands and talks about the brewery in Marn. ".repeat(i === 0 ? 3 : 60),
  summary: `SUMMARY-OF-TURN-${i}`,
}));

const base: any = {
  id: "x", name: "t", updated_at: "",
  world_bible: { name: "Velora", era: "now", technology_level: "grids", magic_rules: "none", forbidden: "No he or she.", what_people_fear: "", cultures_and_languages: "", climate_and_geography: "", calendar_and_currency: "", political_situation: "", difficulty_profile: {} },
  world: { current_turn: 20, current_time: "Day 1, 10:00 (Morning)", weather: "grey", player_location: "loc_a", present: ["char_player", "char_s"],
    places: { loc_a: { id: "loc_a", name: "Rabi's apartment", identity: "his alone", description_facts: "One room.", population: { scale: 1, who: "Rabi, alone" } } },
    edges: [{ from: "char_s", to: "char_player", warmth: 42, trust: 11, power: 0, roles: ["co-worker"], notes: "", updated_turn: 1 }],
    threads: [], clocks: [], consequences: [], rumors: [], canon: ["Everyone here uses xe/xem/xer."], norms: [], money: "", promises: [], offstage_log: [], time_at_turn: {} },
  characters: {
    char_player: { name: "Rabi", pronouns: "he/him", age: 39, appearance_facts: "Curly dark hair.", background: "From Seattle.", core_traits: [], values: [], speech_pattern: "Measured.", intelligence: "average", gregariousness: 0.5 },
    char_s: { name: "Sera Oln", pronouns: "xe/xer/xem", age: 28, appearance_facts: "Strawberry-blonde.", background: "Raised in Marn by xer grandmother.", core_traits: ["Cannot sit still"], values: ["Good beer"], speech_pattern: "Long looping sentences.",
      voice: { diction: "Trade shop-talk", syntax: "Long looping sentences", rhythm: "Builds speed", tics: ["Prefaces gossip with 'and this isn't mine to say, so'"], never_says: ["Anything about being nineteen"], example_lines: ["And this isn't mine to say, so — Osk's wife runs the mash now."] },
      attachment: { style: "anxious", under_threat: "Talks faster, asks more questions.", when_that_fails: "Goes quiet and cold.", soothed_by: "Being told plainly that xe did nothing wrong." },
      drive: { goal: "Leave on xer own terms", progress: 40, priority: 1, updated_turn: 12 },
      intelligence: "average", gregariousness: 0.8, tracked: true, central: true, location: "loc_a" },
  },
  condition: {}, memory: {}, traits: {}, history, telemetry: [], pressure_trace: [], records: [], snapshots: [],
  model_settings: { narrator_model: "m", simulator_model: "m", forge_model: "m", fallback_model: "m", image_model: "m", context_memories_k: 6, reflection_cadence: 10, history_window: 5 },
};
const s = sanitize(JSON.parse(JSON.stringify(base))) as SaveState;
s.condition.char_s.psyche.relaxation = -8;

const msgs = plainNarratorMessages(s, `"Sera. Can we talk?"`, "do");
const all = msgs.map((m: any) => (typeof m.content === "string" ? m.content : m.content.map((c: any) => c.text).join("\n"))).join("\n\n");

/* ── 1. the story is there, all of it ── */
check("the latest turn is there as prose", all.includes("PROSE-OF-TURN-19"));
check("the opening is there, as prose or as its summary", all.includes("PROSE-OF-TURN-0") || all.includes("SUMMARY-OF-TURN-0"));
check("the player's own lines are in the story", all.includes(`Rabi: "Line 19"`));
const story = storyBlock(s);
check("turns that don't fit as prose come in as summaries", /Earlier, in short:/.test(story) && story.includes("SUMMARY-OF-TURN-1"), story.slice(0, 300));

/* ── 2. the person is there, whole ── */
check("the voice comes with its example line", all.includes("Osk's wife runs the mash now"));
check("what they do under pressure comes with them", all.includes("Talks faster, asks more questions."));
check("what settles them comes with them", all.includes("Being told plainly that xe did nothing wrong."));
check("how clenched they are is described in words", all.includes(opennessWords(-8)));
check("a role reads in its own direction", all.includes("Sera Oln is Rabi's co-worker."));
check("feeling toward the player is in words, with no raw number", /Sera Oln likes Rabi/.test(all) && !/warmth 42/.test(all));
check("the player's character is written as you", /the player's character, written as "you"/.test(all));

/* ── 3. no direction ── */
for (const banned of ["=== DIRECTION ===", "WHAT THIS TURN IS FOR", "PRESSURE ", "ANSWER THE PLAYER", "at most one line", "ALREADY USED UP", "WHAT THE CHARACTERS PRESENT LET SHOW"]) {
  check(`no "${banned}"`, !all.includes(banned));
}
check("a home for one gets no crowd", !/Ordinarily around here/.test(all));
check("the footer is asked for", all.includes("<<<SCENE place="));
check("the world's pronouns are stated", /use xe\/xem\/xer for everyone/.test(all));
check("the system prompt is short", PLAIN_NARRATOR_SYSTEM.length < 7000, PLAIN_NARRATOR_SYSTEM.length);
check("openness and clenching are explained as how people work", /When someone is clenched, their attention narrows/.test(PLAIN_NARRATOR_SYSTEM));
check("the story wins over a stale note", /The story itself is the final word/.test(PLAIN_NARRATOR_SYSTEM));

/* ── 4. the turn uses it by default ── */
{
  const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
  check("plain is the default", /narrator_style \?\? "plain"\) === "plain"/.test(src));
  check("no private intents are pre-written in plain mode", /plain \? \[\] : await runIntentPass/.test(src));
  check("the plain request replaces the directed one", /if \(plain\) \{\n[\s\S]{0,900}plainNarratorMessages\(state, plainAction, mode, plainWorldNow\)/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
