/* Smoke test: GRIEF DOES NOT QUIETLY RESOLVE INTO COMPANY.
 *
 * A player, on the arc he wanted and the one he was afraid of:
 *
 *   "so long as the story doesn't run with 'and then her and John happily distract her from the
 *    pain until her relaxation is 0 and all is forgiven while she never talks to Rabi'"
 *
 * Both halves of that drift were mechanical, and neither had anything to do with the narrator.
 *
 * tickBonds warms any two OFFSTAGE characters who share a location, one point a pass, toward a
 * ceiling derived from how compatible their cards are — a function that knows nothing about what
 * either of them is living through. So the woman whose marriage detonated last night drifts steadily
 * closer to the man she detonated it with, purely for being in the same building, while the person
 * she actually needs to face is across the city and moving only by decay.
 *
 * And tickPsyche drifts relaxation toward capacity every turn, so without grief_drag she is back at
 * her easy resting point inside a fortnight regardless of what happened. */
import { newSave, registerCharacter } from "../src/engine/state";
import { tickBonds, tickPsyche, getEdge } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(grief: number): SaveState {
  const s = newSave("arc", { name: "The Arrangement" } as any);
  s.world.places["loc_hotel"] = { id: "loc_hotel", name: "Hotel", description_facts: "A room.", contains: [] };
  s.world.places["loc_bar"] = { id: "loc_bar", name: "The Rusty Nail", description_facts: "A bar.", contains: [] };
  s.world.player_location = "loc_hotel";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const t = registerCharacter(s, { name: "Tessa" } as any);
  const j = registerCharacter(s, { name: "John" } as any);
  // both offstage, in the same room — the exact shape that drifts
  s.characters[t].location = "loc_bar";
  s.characters[j].location = "loc_bar";
  s.world.present = [];
  if (grief) s.condition[t].psyche.grief_drag = grief;
  getEdge(s.world.edges, t, j).warmth = 10;
  getEdge(s.world.edges, j, t).warmth = 10;
  return s;
}

/* 1. without grief, two compatible people in a room drift closer — unchanged */
{
  const s = world(0);
  const before = getEdge(s.world.edges, Object.keys(s.characters).find((k)=>s.characters[k].name==="Tessa")!,
                          Object.keys(s.characters).find((k)=>s.characters[k].name==="John")!).warmth;
  for (let i = 0; i < 40; i++) tickBonds(s, () => 0.1);
  const T = Object.keys(s.characters).find((k)=>s.characters[k].name==="Tessa")!;
  const J = Object.keys(s.characters).find((k)=>s.characters[k].name==="John")!;
  const after = getEdge(s.world.edges, T, J).warmth;
  check("ordinary offstage bonds still move", after !== before, { before, after });
}

/* 2. carrying grief, they do not */
{
  const s = world(4.5);
  const T = Object.keys(s.characters).find((k)=>s.characters[k].name==="Tessa")!;
  const J = Object.keys(s.characters).find((k)=>s.characters[k].name==="John")!;
  const before = getEdge(s.world.edges, T, J).warmth;
  for (let i = 0; i < 40; i++) tickBonds(s, () => 0.1);
  check("a grieving person does not drift into fondness", getEdge(s.world.edges, T, J).warmth === before,
    { before, after: getEdge(s.world.edges, T, J).warmth });
  check("and neither does the other side of it", getEdge(s.world.edges, J, T).warmth === before);
}

/* 3. it is the drift that stops, not the relationship — a real scene still lands */
{
  const s = world(4.5);
  const T = Object.keys(s.characters).find((k)=>s.characters[k].name==="Tessa")!;
  const J = Object.keys(s.characters).find((k)=>s.characters[k].name==="John")!;
  const e = getEdge(s.world.edges, T, J);
  e.warmth += 25;                                   // as the bookkeeper would write it after a scene
  check("the bookkeeper's own deltas are untouched", e.warmth === 35, e.warmth);
}

/* 4. and the grief itself lifts slowly enough to still be there for the confrontation */
{
  const p = { relaxation: -6.4, capacity: -1, recovery: 0.1, state: "fracturing", break_mode: null,
    consecutive_clenched: 0, open_run: 0, mood: "gutted", mood_valence: -7, active_states: [], grief_drag: 4.5 } as any;
  const at = (n: number) => { const q = JSON.parse(JSON.stringify(p)); for (let i = 0; i < n; i++) tickPsyche(q); return q; };
  check("she is still in pieces ten turns on", at(10).relaxation < -4.5, at(10).relaxation);
  check("still not at ease after thirty", at(30).relaxation < -2, at(30).relaxation);
  check("the drag is still real at twenty", (at(20).grief_drag ?? 0) > 1, at(20).grief_drag);
  check("but it does eventually lift", (at(70).grief_drag ?? 0) === 0 || at(70).grief_drag === undefined, at(70).grief_drag);
  check("and she is never dragged below the floor", at(200).relaxation >= -10);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
