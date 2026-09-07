/* Smoke test: NOBODY CARRIES A WRITTEN-DOWN SPEC FOR HOW THEY TALK.
 *
 * "Everyone talks in maxims like they're all construction workers from South Philly."
 *
 * Measured on the four-person cast of the save that prompted this — an eighteen-year-old, a
 * print-shop manager, a bartender and a stranger:
 *
 *   syntax, Abigail : "Declarative, front-loads the number, then the instruction."
 *   syntax, Chloe   : "Crisp, active clauses; rarely hedges or uses qualifiers."
 *   syntax, Liam    : "Short, choppy sentences linked by 'and then' or 'listen'."
 *   syntax, Emily   : "Short declaratives placed side by side without conjunctions."
 *
 * Four for four: short, declarative, no hedging. Nine of their thirteen sample lines name a number
 * or a dollar amount. Two of them carry "no abstractions" in the diction field — the model copying
 * the prompt's own constraint onto the character as though it were a personality.
 *
 * Two of those four had never been re-forged, so this is not the refresh drifting: the forge and
 * the refresh carry the same example_lines rule, and the rule describes one register. Tail sampling
 * cannot escape a hard constraint.
 *
 * This file's neighbour already reached the same conclusion about example_lines and pulled them off
 * the card, ending "how much they say comes from what they want and what has happened." The rest of
 * the card goes the same way. What differentiates these people is underneath it and always was:
 * where they are from, the trade they actually hold, what they raise unprompted, who they are
 * talking to, and what they want out of them. */
import { newSave, registerCharacter } from "../src/engine/state";
import { stablePrefix, volatileDigest, voiceCardsOn, FORGE_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const SPEC = "Crisp, active clauses; rarely hedges.";
function world(cards?: boolean, locked = false): SaveState {
  const s = newSave("cards", { name: "Elm Street", era: "contemporary" } as any);
  s.world.places["loc_bar"] = { id: "loc_bar", name: "The Copper Tap", description_facts: "Narrow, dim.", contains: [] } as any;
  s.world.player_location = "loc_bar";
  registerCharacter(s, { name: "Max", character_id: "char_player", pronouns: "he/him", age: 39,
    appearance_facts: "Glasses.", core_traits: ["quiet"], values: ["privacy"] } as any);
  const id = registerCharacter(s, { name: "Chloe", pronouns: "she/her", age: 26,
    appearance_facts: "Ink on her hands.", core_traits: ["direct"], values: ["good work"],
    background: "Runs the floor at a print shop on Elm; knows what a comma splice is.",
    texture: ["the pallet of linen bond nobody ordered"], skills: { "offset printing": "expert" },
    speech_pattern: SPEC, voice_locked: locked,
    voice: { diction: "Print-shop terminology.", syntax: SPEC, rhythm: "Brisk.", tics: ["taps a pocket ruler"],
      never_says: ["it's not my place"], agenda: "To get him out of the building.",
      example_lines: ["Twenty-five hundred sheets on pallet four."] } } as any);
  s.characters[id].location = "loc_bar";
  s.characters["char_player"].location = "loc_bar";
  s.world.present = [id];
  s.world.current_turn = 12;
  if (cards !== undefined) (s.model_settings as any).voice_cards = cards;
  return s;
}

/* ── 1. off is the default, and off means gone ───────────────────────────────── */
{
  const s = world();
  check("a save that says nothing gets no voice cards", !voiceCardsOn(s, s.characters[Object.keys(s.characters).find((k) => k !== "char_player")!]));
  const pre = stablePrefix(s);
  check("the card carries no written voice spec", !pre.includes(SPEC), pre.slice(0, 200));
  check("...nor the sample line the narrator was copying", !pre.includes("Twenty-five hundred sheets"), "example line leaked");
  check("...nor the agenda", !pre.includes("To get him out of the building"));
  const dig = volatileDigest(s, "at the bar");
  check("and no per-turn tic either", !dig.includes("taps a pocket ruler"), "tic leaked");
}

/* ── 2. what tells them apart is still all there ─────────────────────────────── */
{
  const s = world();
  const pre = stablePrefix(s), dig = volatileDigest(s, "at the bar");
  check("her trade survives", /print shop/i.test(pre));
  check("...what she raises unprompted survives", /linen bond/i.test(dig), "texture lost");
  check("...and her skills survive", /offset printing/i.test(pre));
}

/* ── 3. turning them back on restores the old card exactly ───────────────────── */
{
  const pre = stablePrefix(world(true));
  check("ON: the spec comes back", pre.includes(SPEC), "spec missing when on");
  // and the sample lines stay off it either way: they were pulled long before this change, for
  // teaching every character to speak in fragments the length of an example
  check("ON: sample lines stay off the card, as they already were", !pre.includes("Twenty-five hundred sheets"));
}

/* ── 4. a voice the player locked by hand is theirs either way ───────────────── */
{
  const s = world(false, true);
  const pre = stablePrefix(s);
  check("a locked voice keeps its card even with cards off globally", pre.includes(SPEC), "lock ignored");
  const other = world(false, false);
  check("...and an unlocked one in the same save does not", !stablePrefix(other).includes(SPEC));
}

/* ── 5. the scene still reaches the narrator ─────────────────────────────────── */
{
  // with cards off the per-turn line carries what is happening TO them and nothing prescribed;
  // when nothing is happening it must not render as an empty label
  const s = world();
  const cid = Object.keys(s.characters).find((k) => k !== "char_player")!;
  s.condition[cid].psyche.relaxation = -8;
  check("under pressure, the scene still says so", /voice now:/.test(volatileDigest(s, "at the bar")), "register lost");
  const calm = world();
  const lines = volatileDigest(calm, "at the bar").split("\n").filter((l) => l.includes("voice now:"));
  check("and an empty voice line is never printed as a bare label",
    lines.every((l) => l.replace(/\s*voice now:\s*/, "").trim().length > 0), lines);
}

/* ── 6. the rule that converged them is gone from the forge ──────────────────── */
{
  check("the forge no longer demands a price or a count in every line",
    !/EVERY ONE MUST NAME SOMETHING THE SPEAKER COULD POINT AT/.test(FORGE_SYSTEM));
  check("...and says outright that a number has crowded out the alternatives",
    /crowded out all the others/.test(FORGE_SYSTEM), "replacement rule missing");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
