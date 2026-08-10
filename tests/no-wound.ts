/* Smoke test: THE WOUND THAT WAS NEVER THERE.
 *
 * "She tells me to bandage again? And when I do she's like oh it's been field wrapped you were on
 * the field and it's been wet for hours basically imagining shit."
 *
 * The state on that save:
 *
 *     conditions: ["ankle_wrapped_and_elevated"]   (set 5 turns earlier, in a lit room)
 *     injuries:   []
 *
 * The prose:
 *
 *     "It was a field wrap. It's been wet for three hours. You walked off the beach on it and stood
 *      through two arguments." ... the pause when the gauze came free and she saw what was underneath.
 *
 * None of that is in the record, and nothing is underneath — there is no injury at all. Then the
 * bookkeeper filed it: "She unwrapped his ankle, SAW THE WOUND BENEATH, and checked the bone." The
 * invention became a memory, the memory becomes a belief, and the character is now treating a wound
 * that does not exist. That is the whole compounding failure in one beat.
 *
 * The cause is that an unhurt body was described by SILENCE. Every injury render in prompts.ts is
 * gated on injuries.length, so "nothing is wrong with this person" was communicated by omission —
 * and omission is not a statement, it is room. A dressing with no injury under it is an incoherent
 * body, and a model handed an incoherent body resolves it. */
import { simulatorContext } from "../src/engine/prompts";
import { sanitize } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const save = (cond: Record<string, unknown>): SaveState => {
  const base: any = {
    id: "x", name: "t", updated_at: "",
    world_bible: { name: "W", era: "", technology_level: "", magic_rules: "", forbidden: "", what_people_fear: "", cultures_and_languages: "", climate_and_geography: "", calendar_and_currency: "", political_situation: "", difficulty_profile: {} },
    world: { current_turn: 30, current_time: "Day 2, 20:00 (Night)", weather: "rain", player_location: "loc_a", present: [],
      places: { loc_a: { id: "loc_a", name: "The bunkroom", description_facts: "" } },
      edges: [], threads: [], clocks: [], consequences: [], rumors: [], canon: [], norms: [], money: "", promises: [], offstage_log: [], time_at_turn: {} },
    characters: { char_player: { name: "Rabi", age: 34, appearance_facts: "x", background: "b", core_traits: [], values: [], speech_pattern: "p", intelligence: "average", gregariousness: 0.5 } },
    condition: { char_player: { injuries: [], conditions: [], fatigue: "fresh", hunger: "peckish", inventory: [], wearing: [], psyche: { relaxation: 1, mood: "even", active_states: [] }, ...cond } },
    memory: {}, traits: {}, history: [], telemetry: [], pressure_trace: [], records: [], snapshots: [],
    model_settings: { narrator_model: "m", simulator_model: "m", forge_model: "m", fallback_model: "m", image_model: "m", context_memories_k: 6, reflection_cadence: 10, history_window: 5 },
  };
  return sanitize(JSON.parse(JSON.stringify(base))) as SaveState;
};
const bodyOf = (s: SaveState) => simulatorContext(s, "");

/* ── the exact state from the save ───────────────────────────────────────────── */
{
  const t = bodyOf(save({ conditions: ["ankle_wrapped_and_elevated"], injuries: [] }));
  check("a dressing with nothing under it says so, loudly", /NO INJURIES/.test(t), t.slice(0, 400));
  check("and forbids inventing the wound", /there is no wound under it/.test(t));
  check("and forbids anyone uncovering one", /do not have anyone uncover one/i.test(t));
  check("the dressing itself is still on the record", /ankle_wrapped_and_elevated/.test(t));
}
{
  // a real injury must read exactly as before — this is a fix for absence, not a new gag on presence
  const t = bodyOf(save({ conditions: ["ankle_wrapped_and_elevated"], injuries: [{ type: "sprained ankle", functional_impact: "limps" }] }));
  check("a real injury is still reported", /sprained ankle/.test(t), t.slice(0, 300));
  check("and the no-injury claim is absent when there IS one", !/NO INJURIES/.test(t));
}
{
  // an ordinary unhurt body with no conditions at all — the common case, and it should stay cheap
  const t = bodyOf(save({}));
  check("an untouched body says so in three words, not a paragraph", /no injuries/.test(t) && !/NO INJURIES —/.test(t), t.slice(0, 300));
}
{
  const t = bodyOf(save({ conditions: ["exhausted", "soaked"], injuries: [] }));
  check("conditions that are not treatments still get the guard", /NO INJURIES/.test(t));
  check("and they survive onto the record", /exhausted/.test(t) && /soaked/.test(t));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
