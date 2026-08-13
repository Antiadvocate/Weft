/* Smoke test: STATE THAT EXISTS BUT NEVER REACHES THE NARRATOR.
 *
 * A field can be written by the forge, updated by the simulator, rendered in the character sheet,
 * and still never appear in front of the model that writes the prose. Nothing fails when that
 * happens. The save looks right, the UI looks right, and the story reads as though the engine is
 * ignoring its own records — which it is.
 *
 * Three were found by filling every field with a unique sentinel and searching the assembled
 * narrator context for each one:
 *
 *   1. The player's `wearing` and `inventory` lived inside reactionDirective, which returns an
 *      empty string unless the player's input contains a physical act of 18+ characters. Every turn
 *      the player spoke, thought, or did something short, the narrator was told nothing about what
 *      the player was visibly wearing or carrying — and the comparison against the world's
 *      technology level, which exists specifically to catch a suit and a scooter in iron-age
 *      Latium, never ran on those turns.
 *   2. No NPC's `wearing` or `inventory` reached the narrator on ANY turn. So it invented what
 *      everyone in the room had on, and the simulator recorded the invention as state.
 *   3. `attachment.soothed_by` — "one plain sentence: what actually settles them", written by the
 *      forge for every NPC — reached nobody. The branch that should have used it printed a generic
 *      sentence about avoidant people instead.
 *
 * The test is the sentinel method itself, so the next field to go missing fails here.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest, stablePrefix } from "../src/engine/prompts";
import { reactionDirective } from "../src/engine/reaction";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function fixture() {
  const s: any = newSave("t", { name: "Rabi" } as any);
  s.world_bible.technology_level = "Ox-plows, hand-mills, oil lamps, wax tablets.";
  s.world.places["loc_x"] = { id: "loc_x", name: "The yard", description_facts: "yard", contains: [] };
  s.world.player_location = "loc_x";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const m = registerCharacter(s, {
    name: "Lucia", age: 40, background: "bg", core_traits: ["t"],
    voice: { example_lines: ["Two sestertii."] },
    attachment: { style: "avoidant", under_threat: "SENT_underthreat", soothed_by: "SENT_soothed" },
  } as any);
  s.characters[m].location = "loc_x";
  s.world.present = ["char_player", m];
  s.condition["char_player"].wearing = ["SENT_pwearing"];
  s.condition["char_player"].inventory = [{ id: "i1", name: "SENT_pinventory" }];
  s.condition[m].wearing = ["SENT_nwearing"];
  s.condition[m].inventory = [{ id: "i2", name: "SENT_ninventory" }];
  return { s, m };
}
/** Everything the narrator is handed for one turn, for a given player input. */
const context = (s: any, action: string, mode: any = "do") =>
  stablePrefix(s) + "\n" + volatileDigest(s, "") + "\n" + reactionDirective(s, action, mode);

/* ── 1. what the player has on them, on EVERY kind of turn ───────────────────── */
{
  const { s } = fixture();
  const turns: [string, string, string][] = [
    ["a long physical act", "I ride the machine up to the gate and step off", "do"],
    ["a short act", "I nod", "do"],
    ["a spoken turn", '"How much for the room?"', "say"],
    ["a thought", "she is lying about the roof", "think"],
  ];
  for (const [label, action, mode] of turns) {
    const ctx = context(s, action, mode);
    check(`${label}: the narrator knows what the player is wearing`, ctx.includes("SENT_pwearing"), label);
    check(`${label}: ...and what they are carrying`, ctx.includes("SENT_pinventory"), label);
    check(`${label}: ...against what this world can make`, /This world can do this and no more/.test(ctx), label);
  }
}

/* ── 2. and what everyone ELSE in the room has on ────────────────────────────── */
{
  const { s } = fixture();
  const ctx = context(s, "I nod", "do");
  check("an NPC's clothes reach the narrator", ctx.includes("SENT_nwearing"), ctx.slice(0, 200));
  check("...and what they are carrying", ctx.includes("SENT_ninventory"));
  check("...marked as visible to the room, not as private state", /has on them \(everyone here can see it\)/.test(ctx));
}

/* ── 3. the sentence the forge wrote about settling this person ──────────────── */
{
  const { s, m } = fixture();
  s.condition[m].psyche.relaxation = 5;
  const ctx = context(s, "I nod", "do");
  check("a relaxed character's own soothed_by is used", ctx.includes("SENT_soothed"), ctx.slice(0, 200));
  check("...instead of the generic note it used to print", !/warmth lands better with room to breathe/.test(ctx));

  // and the stressed half still works, which is the branch that was already right
  const { s: s2, m: m2 } = fixture();
  s2.condition[m2].psyche.relaxation = -5;
  check("a stressed character still gets under_threat", context(s2, "I nod", "do").includes("SENT_underthreat"));
}

/* ── 4. the reaction directive still gates on there being an act to answer ───── */
{
  const { s } = fixture();
  // splitting the visible-state fact out of it must not make it fire on a turn with no act:
  // "the scene answers this first" is about something having HAPPENED.
  check("no act, no demand that the scene answer one", reactionDirective(s, "I nod", "do") === "");
  check("a real act still produces one", /THE SCENE ANSWERS THIS FIRST/.test(reactionDirective(s, "I ride the machine up to the gate and step off", "do")));
  check("a thought is never answered by the room", reactionDirective(s, "a long private thought about the roof and the money", "think") === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
