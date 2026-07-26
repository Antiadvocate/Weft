/* Smoke test: DEPARTURE EVIDENCE GUARD in applyDiff.
 * A character who was in world.present when the turn began cannot be moved by
 * diff.locations unless the prose shows the departure (quoted `said` or a
 * departure verb near their name). Offscreen characters move freely.
 * Names are generic but titled on purpose — the guard must skip ranks and
 * honorifics when probing for a character's name in the prose. */
import { newSave, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import type { SaveState, SimulatorDiff } from "../src/engine/types";

function makeState(): SaveState {
  const state = newSave("guard-test", {
    name: "Test World", era: "now", technology_level: "modern", magic_rules: "none",
    forbidden: "", what_people_fear: "nothing", cultures_and_languages: "english",
    climate_and_geography: "mild", calendar_and_currency: "standard", political_situation: "stable",
  } as any);
  // places
  state.world.places["loc_yard"] = { id: "loc_yard", name: "The Courtyard", description_facts: "", contains: ["char_player"] };
  state.world.places["loc_hall"] = { id: "loc_hall", name: "The Hall", description_facts: "", contains: [] };
  state.world.places["loc_offscene"] = { id: "loc_offscene", name: "elsewhere", description_facts: "", contains: [] };
  state.world.player_location = "loc_yard";
  // player
  registerCharacter(state, { name: "Rabi", character_id: "char_player" } as any);
  state.characters["char_player"].location = "loc_yard";
  // three NPCs in the scene, one offscreen
  const reyes = registerCharacter(state, { name: "Captain Reyes" } as any);
  const hale = registerCharacter(state, { name: "Mr. Hale" } as any);
  const mara = registerCharacter(state, { name: "Mara" } as any);
  const offscreen = registerCharacter(state, { name: "Sgt. Okafor" } as any);
  state.characters[reyes].location = "loc_yard";
  state.characters[hale].location = "loc_yard";
  state.characters[mara].location = "loc_yard";
  state.characters[offscreen].location = "loc_offscene";
  state.world.present = [reyes, hale, mara];
  (globalThis as any).__ids = { reyes, hale, mara, offscreen };
  return state;
}

const ids = () => (globalThis as any).__ids;

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. engaged character, no evidence → move rejected, stays in the scene */
{
  const s = makeState();
  const { reyes } = ids();
  const prose = "Reyes gripped the fence rail as the ground shook. 'Hold steady,' she said.";
  const diff = { locations: [{ char_id: reyes, place: "elsewhere", said: "" }] } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I look around", prose);
  check("engaged, no evidence: location unchanged", s.characters[reyes].location === "loc_yard", s.characters[reyes].location);
  check("engaged, no evidence: correction shift emitted",
    shifts.some((x) => x.includes("bookkeeping correction") && x.includes("Reyes")), shifts);
}

/* 2. engaged character, quoted said present in prose → move allowed */
{
  const s = makeState();
  const { reyes } = ids();
  const prose = `"I need the workshop," Reyes said, and headed off down the corridor. The door shut behind her.`;
  const diff = { locations: [{ char_id: reyes, place: "The Hall", said: "and headed off down the corridor" }] } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I watch her go", prose);
  check("engaged, quoted said: moved", s.characters[reyes].location === "loc_hall", s.characters[reyes].location);
  check("engaged, quoted said: no correction shift",
    !shifts.some((x) => x.includes("bookkeeping correction")), shifts);
}

/* 3. engaged character, departure verb near name (no said) → move allowed */
{
  const s = makeState();
  const { hale } = ids();
  const prose = "Hale rose from the bench and left the courtyard without a word, his expression unreadable.";
  const diff = { locations: [{ char_id: hale, place: "elsewhere", said: "" }] } as unknown as SimulatorDiff;
  applyDiff(s, diff, "I nod", prose);
  check("engaged, departure verb near name: moved", s.characters[hale].location === "loc_offscene", s.characters[hale].location);
}

/* 4. engaged character, said fabricated (not in prose) → rejected */
{
  const s = makeState();
  const { mara } = ids();
  const prose = "Mara stayed close, her hand still on your sleeve.";
  const diff = { locations: [{ char_id: mara, place: "elsewhere", said: "she walked out of the room quietly" }] } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I hold her hand", prose);
  check("engaged, fabricated said: rejected", s.characters[mara].location === "loc_yard", s.characters[mara].location);
}

/* 5. offscreen character, no evidence → moves freely (guard does not apply) */
{
  const s = makeState();
  const { offscreen } = ids();
  const prose = "The courtyard lay quiet under the afternoon sun.";
  const diff = { locations: [{ char_id: offscreen, place: "The Hall", said: "" }] } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I wait", prose);
  check("offscreen: moves without evidence", s.characters[offscreen].location === "loc_hall", s.characters[offscreen].location);
  check("offscreen: no correction shift", !shifts.some((x) => x.includes("bookkeeping correction")), shifts);
}

/* 6. full-cast dump regression: three characters talking, bookkeeper dumps all three → all stay */
{
  const s = makeState();
  const { reyes, hale, mara } = ids();
  const prose = `The ground lurched. "Report," Reyes snapped. Hale's hands moved across the instrument panel. "At the current rate the floodwater reaches the gate in four minutes." Mara pressed her forehead against your shoulder.`;
  const diff = {
    locations: [
      { char_id: reyes, place: "elsewhere", said: "" },
      { char_id: hale, place: "elsewhere", said: "" },
      { char_id: mara, place: "elsewhere", said: "" },
    ],
  } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I brace", prose);
  const allStay = [reyes, hale, mara].every((id) => s.characters[id].location === "loc_yard");
  check("full-cast dump regression: all three stay in the scene", allStay,
    [reyes, hale, mara].map((id) => s.characters[id].location));
  check("full-cast dump regression: three corrections", shifts.filter((x) => x.includes("bookkeeping correction")).length === 3, shifts);
}

/* 7. move within same place (pid === fromPid) is a no-op, guard untouched */
{
  const s = makeState();
  const { reyes } = ids();
  const diff = { locations: [{ char_id: reyes, place: "The Courtyard", said: "" }] } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I wait", "Reyes stood by the gate.");
  check("same-place move: stays, no correction", s.characters[reyes].location === "loc_yard" && !shifts.some((x) => x.includes("bookkeeping correction")), shifts);
}

/* 8. title/rank probing: prose uses the bare surname, bookkeeper gives full titled name */
{
  const s = makeState();
  const { hale } = ids();
  // prose never says "Mr. Hale" — only "Hale" — and the departure verb sits near it
  const prose = "The argument went in circles until Hale finally withdrew, muttering about the ledgers.";
  const diff = { locations: [{ char_id: hale, place: "The Hall", said: "" }] } as unknown as SimulatorDiff;
  applyDiff(s, diff, "I let him go", prose);
  check("titled name, bare surname in prose: moved", s.characters[hale].location === "loc_hall", s.characters[hale].location);
}

/* 9. rank word alone is NOT evidence: "the captain" near a departure verb, with the character
 *    themselves unnamed in the prose, must not free Captain Reyes. If "captain" were used as a
 *    name probe, this move would wrongly pass — the honorific filter is what rejects it. */
{
  const s = makeState();
  const { reyes } = ids();
  const prose = "Someone shouted that the captain of the watch had left an hour ago. The yard went quiet.";
  const diff = { locations: [{ char_id: reyes, place: "elsewhere", said: "" }] } as unknown as SimulatorDiff;
  applyDiff(s, diff, "I stay put", prose);
  check("bare rank mention is not evidence: stays", s.characters[reyes].location === "loc_yard", s.characters[reyes].location);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
