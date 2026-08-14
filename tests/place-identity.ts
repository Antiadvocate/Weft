/* Smoke test: A PLACE THAT STOPS BEING ITSELF.
 *
 * A player: "the description of the places keeps changing so it's prose. It's not adding addendums.
 * It should rewrite description but there should be something fixed — 'this is Rabi's house' should
 * never be different."
 *
 * places_update is a FULL REPLACEMENT by design, and that design is right for the thing it was built
 * for: a town the player levelled must stop being described as walled and quiet. But the replacement
 * covered the whole record, so every rewrite re-described the ground from scratch — including the
 * part that was never in question. A house drifted a little further from itself each time anything
 * happened to it, and whose house it was became a matter of opinion.
 *
 * So a place has two halves now. `identity` is one sentence — what this place is and whose it is —
 * written once at creation and never again by anything except the player's own hand. It is printed
 * with the name everywhere the narrator or the bookkeeper sees a place, and the simulator is told it
 * is not its to write. `description_facts` stays exactly as it was: the current state, replaced
 * wholesale whenever the world changes the place.
 */
import { newSave, sanitize, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import { volatileDigest, FORGE_SYSTEM, simulatorSystem } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world() {
  const s: any = newSave("t", { name: "Rabi" } as any);
  s.world.places["loc_house"] = {
    id: "loc_house", name: "The house on the lane", contains: [], founding: true,
    identity: "Rabi's house — the two rooms he rents above the tannery.",
    description_facts: "Two rooms. A shuttered window, a cold hearth, a bed under the eaves.",
  };
  s.world.player_location = "loc_house";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.characters["char_player"].location = "loc_house";
  return s;
}

/* ── 1. THE WORLD MAY BURN IT DOWN AND IT IS STILL HIS HOUSE ─────────────────── */
{
  const s = world();
  applyDiff(s, {
    scene_summary: "fire", elapsed_minutes: 10,
    places_update: [{
      place: "The house on the lane",
      description_facts: "Burned out. The roof is gone and the eaves are down. Soot to the sill.",
      note: "fire",
    }],
  } as any, "I set it alight", "The thatch went up.", false);

  const p = s.world.places["loc_house"];
  check("the changing half changed", /Burned out/.test(p.description_facts), p.description_facts);
  check("...and the old state is gone, not appended", !/cold hearth/.test(p.description_facts), p.description_facts);
  check("THE FIXED HALF DID NOT", p.identity === "Rabi's house — the two rooms he rents above the tannery.", p.identity);
  check("it is still recorded as his", /Rabi's house/.test(p.identity ?? ""));
}

/* ── 2. and a simulator that tries to write it cannot ────────────────────────── */
{
  const s = world();
  applyDiff(s, {
    scene_summary: "x", elapsed_minutes: 5,
    places_update: [{
      place: "The house on the lane",
      identity: "A abandoned tenement nobody owns.",           // the model overreaching
      description_facts: "Dust on the sill.",
    }],
  } as any, "I look around", "Dust.", false);
  check("identity supplied by the bookkeeper is ignored",
    s.world.places["loc_house"].identity === "Rabi's house — the two rooms he rents above the tannery.",
    s.world.places["loc_house"].identity);
  check("...while the state it WAS allowed to write landed", /Dust on the sill/.test(s.world.places["loc_house"].description_facts));
}

/* ── 3. both halves reach the narrator, marked for what they are ─────────────── */
{
  const d = volatileDigest(world(), "");
  check("the fixed half is in front of the narrator", /Rabi's house/.test(d), d.match(/Scene:[^\n]*/)?.[0]);
  check("...labelled as fixed", /this does not change/.test(d), d.match(/Scene:[^\n]*/)?.[0]);
  check("...and the current state is labelled as current", /as it stands now:/.test(d));
  check("the location list carries it too, so it is never re-invented", /- The house on the lane — Rabi's house/.test(d), d.match(/- The house on the lane[^\n]*/)?.[0]);
}

/* ── 4. the contracts say who owns which half ────────────────────────────────── */
{
  for (const [label, P] of [["full", simulatorSystem(false)], ["lean", simulatorSystem(true)]] as [string, string][]) {
    check(`${label}: the bookkeeper is told the identity is not its to write`,
      /is not yours to write/.test(P), label);
    check(`${label}: with the case that makes it concrete`,
      /burned house is still that person's house/i.test(P), label);
  }
  check("and the Forge is asked for it explicitly", /what this place is and whose it is/i.test(FORGE_SYSTEM));
  check("...and told what does NOT belong in it", /not its current state, not the weather/i.test(FORGE_SYSTEM));
}

/* ── 5. a save written before any of this existed still gets a fixed half ────── */
{
  const s: any = newSave("old", { name: "Rabi" } as any);
  s.world.places["loc_x"] = {
    id: "loc_x", name: "The mill", contains: [],
    description_facts: "The mill Greta's family has run for four generations. The wheel is stopped and the race is choked with weed.",
  };
  const healed: any = sanitize(s);
  const p = healed.world.places["loc_x"];
  check("the fixed half is seeded from what was already recorded", !!p.identity?.trim(), p.identity);
  check("...taking the sentence that says what it IS", /Greta's family/.test(p.identity), p.identity);
  check("...and not the sentence about how it stands", !/choked with weed/.test(p.identity), p.identity);
  check("the description is left exactly as it was", /choked with weed/.test(p.description_facts));

  // and a second load does not overwrite what the player has since corrected
  p.identity = "Greta's mill.";
  const again: any = sanitize(healed);
  check("a corrected identity survives the next load", again.world.places["loc_x"].identity === "Greta's mill.");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
