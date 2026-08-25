/** A LEVEL CANNOT SAY THAT SOMEBODY IS REELING.
 *
 *  From a433538a-The_City_of_Ashford.weaver_19.json, the player's report: "Amber not reacting to
 *  Amber." The turns behind it:
 *
 *    t111  Vin throws Chloe out          shifts: Amber Reyes cooled toward you.
 *                                                Amber Reyes trusts you less.
 *    t112  Vin: "…Get the fuck out"      shifts: Amber Reyes cooled toward you.
 *                                                Amber Reyes trusts you less.
 *    t113  Vin: "yes dear god please fuck off."
 *
 *  and the prose of 113: Amber crosses the kitchen, sets both hands on his chest, kisses the back
 *  of his hand, presses his palm to her cheek, says "I'm not going anywhere", and fixes him a
 *  plate. A woman who has just been told to leave twice, behaving as though nothing happened.
 *
 *  The ledger had it right. `Amber Reyes -> Vin` sat at warmth 57 after two consecutive cuts, and
 *  what reached the narrator was the line
 *
 *      toward player: warmth 57, trust 24
 *
 *  A number, with no way to tell a woman who has always been at 57 from a woman who arrived there
 *  this afternoon on her way down. The per-turn deltas were computed, applied, and discarded. This
 *  keeps them for a few turns and puts them on the page.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest } from "../src/engine/prompts";
import { applyEdgeDelta, getEdge, swingLine, SWING_WINDOW, SWING_FLOOR } from "../src/engine/social";
import type { SaveState, SocialEdge } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("swing", { name: "Ashford", era: "modern" } as never);
  s.world.places["loc_house"] = { id: "loc_house", name: "Vin's New House", description_facts: "A craftsman porch.", contains: [] } as never;
  s.world.player_location = "loc_house";
  registerCharacter(s, { name: "Vin", character_id: "char_player", pronouns: "he/him", age: 36, appearance_facts: "Lean.", background: "A man in the middle of a divorce." } as never);
  const a = registerCharacter(s, { name: "Amber Reyes", pronouns: "she/her", age: 29, appearance_facts: "Barefoot.", core_traits: ["Stays"], values: ["not being left"] } as never);
  s.characters[a].location = "loc_house";
  s.characters["char_player"].location = "loc_house";
  s.world.present = [a];
  s.world.current_turn = 111;
  return s;
}

const cut = (edges: SocialEdge[], turn: number, w: number, t: number) =>
  applyEdgeDelta(edges, { from: "amber", to: "char_player", warmth_delta: w, trust_delta: t, power_delta: 0 }, turn);

/** A bond as it stands after a hundred turns of being built — set directly, because the point here
 *  is what the last three turns did to it, not how it got there. Growth clamps are tested elsewhere. */
function settled(warmth: number, trust: number, from = "amber"): SocialEdge[] {
  const edges: SocialEdge[] = [];
  const e = getEdge(edges, from, "char_player");
  e.warmth = warmth; e.trust = trust; delete e.swing;
  return edges;
}

console.log("\n── the two cuts are remembered ──");
{
  const edges = settled(57, 24);
  const e = getEdge(edges, "amber", "char_player");
  const before = e.warmth;
  cut(edges, 111, -9, -7);
  cut(edges, 112, -9, -7);
  check("she really is lower than she was", e.warmth < before, `${before} → ${e.warmth}`);
  const line = swingLine(e, 113);
  check("and the turn after, the drop is still on the page", !!line, line);
  check("it names warmth", /warmth -\d+/.test(line), line);
  check("it names trust", /trust -\d+/.test(line), line);
  check("it names how long ago", /in the last \d+ turns/.test(line), line);
  check("it says what to do with it", /reacting to that move, not to the level/.test(line), line);
}

console.log("\n── and it does not shout about nothing ──");
{
  const edges = settled(40, 20);
  const e = getEdge(edges, "amber", "char_player");
  cut(edges, 110, -2, -1);
  check("one ordinary exchange is not a swing", swingLine(e, 110) === "", swingLine(e, 110));
  check(`the floor is ${SWING_FLOOR}`, SWING_FLOOR === 8);
}
{
  const edges = settled(60, 30);
  const e = getEdge(edges, "amber", "char_player");
  cut(edges, 101, -12, -10);
  check("a real drop reads immediately", swingLine(e, 101) !== "");
  check(`and stops reading after ${SWING_WINDOW} turns`, swingLine(e, 101 + SWING_WINDOW + 1) === "", swingLine(e, 108));
}
{
  // small moves that keep going the same way add up — a slow bleed is still a bleed, and it was
  // the shape of a whole save. It takes a while to cross the floor because a strong bond damps
  // ordinary losses (lossScale), which is correct: four small slights are not a rupture.
  const edges = settled(50, 25);
  const e = getEdge(edges, "amber", "char_player");
  for (const t of [101, 102, 103, 104]) cut(edges, t, -3, 0);
  check("four small slights against a strong bond stay quiet", swingLine(e, 104) === "", swingLine(e, 104));
  check("...and the bleed is being counted all the same", (e.swing?.warmth ?? 0) < -5, JSON.stringify(e.swing));
  for (const t of [105, 106]) cut(edges, t, -3, 0);
  check("six of them in a row do cross the floor", swingLine(e, 106) !== "", swingLine(e, 106));
}
{
  const edges = settled(0, 0);
  const e = getEdge(edges, "amber", "char_player");
  cut(edges, 100, 14, 0);
  check("good news reads too, not only wounds", /warmth \+\d+/.test(swingLine(e, 100)), swingLine(e, 100));
}
{
  // the window is a window, not a ledger: a cut and an equal repair inside it cancel
  const edges = settled(60, 0);
  const e = getEdge(edges, "amber", "char_player");
  cut(edges, 101, -12, 0);
  cut(edges, 102, 14, 0);
  check("a wound taken back the next turn does not keep reading as a wound",
    !/warmth/.test(swingLine(e, 102)), swingLine(e, 102));
}

console.log("\n── it reaches the narrator ──");
{
  const s = world();
  const amber = Object.keys(s.characters).find((k) => s.characters[k].name === "Amber Reyes")!;
  const pe = getEdge(s.world.edges, amber, "char_player");
  pe.warmth = 57; pe.trust = 24; delete pe.swing;
  const quiet = volatileDigest(s);
  check("a settled bond says nothing extra", !quiet.includes("just moved:"), quiet.match(/toward player[^\n]*/)?.[0]);

  applyEdgeDelta(s.world.edges, { from: amber, to: "char_player", warmth_delta: -9, trust_delta: -7, power_delta: 0 }, 111);
  applyEdgeDelta(s.world.edges, { from: amber, to: "char_player", warmth_delta: -9, trust_delta: -7, power_delta: 0 }, 112);
  s.world.current_turn = 113;
  const d = volatileDigest(s);
  check("after two cuts the per-turn block carries the drop", d.includes("just moved:"), d.match(/just moved:[^\n]*/)?.[0]);
  check("...on its own line under the level", /toward player:[^\n]*\n\s*just moved:/.test(d), d.match(/toward player:[\s\S]{0,160}/)?.[0]);
  check("...and the level is still there", /toward player: [^\n]*warmth/.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
