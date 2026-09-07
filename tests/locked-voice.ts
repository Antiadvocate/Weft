/* Smoke test: THE VOICE THE PLAYER WROTE, STILL THERE TWENTY TURNS LATER.
 *
 * "I've got an eighteen year old who keeps defaulting to terrible voices. And I cannot control it."
 *
 * Three passes rewrite how somebody sounds, and none of them asked:
 *
 *   1. voiceforge.refreshStaleVoices — every 12 turns, for anybody in the scene, an LLM call that
 *      REPLACES `voice` and rebuilds `speech_pattern` from it. In the save that prompted this, an
 *      eighteen-year-old's card read `voice_refreshed_turn: 12`: whatever she was written as at the
 *      forge had been overwritten by turn 12 of a 23-turn story.
 *   2. social.consolidateTraits — appends "; has become X" onto speech_pattern.
 *   3. prompts.deriveVoice — adds an age cadence read off her birthday ("a teenager's slangy,
 *      testing cadence", for every eighteen-year-old who ever existed) plus acquired traits, on
 *      every single turn.
 *
 * All three are how the engine keeps a character it authored moving, and all three are vandalism on
 * one a person sat down and wrote. `voice_locked` turns every one of them off for that character.
 *
 * (Voice cards are off globally by default now; these cases pass cards=true so the LOCK is what is
 * being measured rather than the global setting.)
 *
 * What it does NOT turn off is the stress register — how somebody sounds when they are frightened
 * comes from the scene and the clench engine, and is not a description of their voice. */
import { deriveVoice } from "../src/engine/prompts";
import { refreshStaleVoices, refreshVoice, VOICE_REFRESH_INTERVAL } from "../src/engine/voiceforge";
import { consolidateTraits } from "../src/engine/social";
import type { Condition, Identity } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const WRITTEN = "Salon jargon and body-part flatness — beds, bulbs, minutes, lotion, sanitizer spray.";
const person = (locked: boolean): Identity => ({
  character_id: "char_a", name: "Abigail", age: 18, pronouns: "she/her",
  appearance_facts: "Barefoot.", background: "Scranton.", core_traits: [], values: [],
  speech_pattern: WRITTEN, skills: {}, texture: [], voice_locked: locked,
  voice: { diction: WRITTEN, syntax: "Imperative-heavy.", rhythm: "Even, unhurried.",
    tics: ["gives a time window like she is booking an appointment"], never_says: ["if you don't mind"],
    agenda: "To get a time and a place agreed.", example_lines: ["Bed three's bulbs are shot."] },
} as unknown as Identity);
const cond = (relaxation: number): Condition => ({
  injuries: [], conditions: [], fatigue: "fresh", hunger: "fed", inventory: [], wearing: [],
  psyche: { relaxation, capacity: 2, recovery: 0.18, state: "intact", break_mode: null,
    consecutive_clenched: 0, mood: "even", mood_valence: 0, active_states: [] },
} as unknown as Condition);
const TRAITS = [{ label: "openly bitter about the eviction", intensity: 8, behavioral_impact: "snaps" }];

/* ── 1. the per-turn drift stops ─────────────────────────────────────────────── */
{
  const open = deriveVoice(person(false), cond(0), TRAITS, undefined, true);
  check("unlocked, an age band is read off her birthday", /teenager's slangy/.test(open), open);
  check("...and acquired traits are added to how she talks", /speech now carries/.test(open), open);

  const shut = deriveVoice(person(true), cond(0), TRAITS, undefined, true);
  check("LOCKED: no cadence invented from her age", !/teenager's slangy/.test(shut), shut);
  check("LOCKED: no acquired trait bolted onto her voice", !/speech now carries/.test(shut), shut);
  check("...but what she was written as still renders", /time window|booking an appointment/.test(shut), shut);
}

/* ── 2. being frightened is not part of the lock ─────────────────────────────── */
{
  const shut = deriveVoice(person(true), cond(-8), TRAITS, undefined, true);
  const calm = deriveVoice(person(true), cond(0), TRAITS, undefined, true);
  check("a locked voice still sounds different under pressure", shut !== calm, { shut, calm });
}

/* ── 3. the periodic re-forge steps around her ───────────────────────────────── */
{
  // No network here on purpose: reaching the LLM call at all is the failure. A locked character has
  // to be skipped before anything is dispatched.
  const state = (locked: boolean) => ({
    world: { current_turn: VOICE_REFRESH_INTERVAL * 4, present: ["char_a"] },
    characters: { char_a: { ...person(locked), voice_refreshed_turn: 0 } },
    traits: {}, world_bible: { name: "Elm Street", era: "contemporary" },
  });
  const shut = state(true);
  check("long overdue, a locked voice is not re-forged",
    (await refreshStaleVoices(shut, "no/such-model")).length === 0);
  check("...and nothing on the card moved", shut.characters.char_a.speech_pattern === WRITTEN,
    shut.characters.char_a.speech_pattern);
  check("...and the deliberate re-roll refuses too, which is what a lock means",
    (await refreshVoice(shut, "char_a", "no/such-model")) === false);
}

/* ── 4. trait consolidation stops appending to it ────────────────────────────── */
{
  // integration bar: self_weight >= 6, reinforcement_count >= 8, intensity >= 5, and the label or
  // its impact has to read as being about how they SOUND ("bitter" is on that list)
  const deep = () => [{ label: "openly bitter about the eviction", intensity: 9, self_weight: 8,
    reinforcement_count: 9, behavioral_impact: "snaps at anyone who mentions the lease", acquired_turn: 1 }];
  const open = person(false);
  consolidateTraits(open, deep() as never, 40);
  check("unlocked, a deep trait is written into how they talk", open.speech_pattern !== WRITTEN, open.speech_pattern);
  const shut = person(true);
  consolidateTraits(shut, deep() as never, 40);
  check("LOCKED: a locked speech_pattern is not appended to", shut.speech_pattern === WRITTEN, shut.speech_pattern);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
