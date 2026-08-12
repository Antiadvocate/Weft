/* Smoke test: THE SCENE ANSWERS WHAT THE PLAYER JUST DID.
 *
 * Turn 35 of a real save. The player types: I make a cart and a biometric safe next to the hotel.
 * "This is roughly 500 lbs of solid gold." Matter out of nothing, in 63 BC, in front of two women,
 * in a world whose own canon reads "Sorcery — maleficium — is real in everyone's mind and
 * punishable by death."
 *
 * What the engine told the narrator that turn:
 *   PRESSURE 6/10 (obstacle) — source: thread: Ownership and tax liability of the hotel.
 *   NO NEW INCIDENT THIS TURN — no rider, no messenger, no alarm...
 *
 * What it wrote: an argument about savings, with a remark about a beetle. What the bookkeeper
 * recorded as the witness's state: `impressed_by_the_gold`. And `power_witnessed` stayed null,
 * because the engine's detector for the impossible is a regex hunting for words like "godlike"
 * while the prose rules forbid writing like that.
 *
 * Two things are tested here, and the first needs no detector at all — which is why it is the one
 * to trust. The player acted; the scene answers that before it answers a thread from twenty turns
 * ago. The second is the world remembering it happened.
 */
import { physicalAct, reactionDirective, applyUnexplained } from "../src/engine/reaction";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("react", {
    name: "Aricia",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Lucia", character_id: "char_l", pronouns: "she/her" } as any);
  registerCharacter(s, { name: "Tertia", character_id: "char_t", pronouns: "she/her" } as any);
  s.world.places.loc_hotel = { id: "loc_hotel", name: "The Modern Hotel", description_facts: "", contains: [] } as any;
  s.world.player_location = "loc_hotel";
  for (const id of ["char_player", "char_l", "char_t"]) s.characters[id].location = "loc_hotel";
  s.world.present = ["char_l", "char_t"];
  s.world.current_turn = 35;
  s.world.canon = ["Sorcery — maleficium — is real in everyone's mind and punishable by death."];
  return s;
}
const GOLD = `"Ok then here." I make a cart and a biometric safe next to the hotel. "This is roughly 500 lbs of solid gold."`;

/* ── 1. the channels: only what the room could SEE has to be answered ────────── */
{
  check("speech is stripped — it is heard, not witnessed",
    !physicalAct(GOLD).includes("roughly 500") && physicalAct(GOLD).includes("biometric safe"), physicalAct(GOLD));
  check("private thought is stripped", physicalAct(`*I wonder if she knows* I set the cup down on the table`) === "I set the cup down on the table");
  check("a search directive is not story text", !physicalAct(`I look it up ((roman law))`).includes("roman law"));
  check("pure dialogue leaves no act", physicalAct(`"Just tell me what you want."`) === "");
}

/* ── 2. the act is named, and outranks the thread the pressure line picked ───── */
{
  const s = world();
  const d = reactionDirective(s, GOLD, "do");
  check("the act is quoted back", /biometric safe/.test(d), d.slice(0, 120));
  check("it is declared the largest thing in the scene", /outranks any standing thread/.test(d));
  check("and the pressure line cannot write past it", /does not license writing past this/.test(d));
  check("the witnesses are named", /Lucia, Tertia/.test(d), d);
}

/* ── 3. the reaction is measured against what THIS world believes ────────────── */
{
  const d = reactionDirective(world(), GOLD, "do");
  check("it points at the canon rather than at a magnitude", /WHAT THIS WORLD HOLDS TO BE TRUE/.test(d));
  check("impossible-here is named as the largest fact in the room", /impossible here, or forbidden here/.test(d));
  check("but an ordinary act stays ordinary", /If it is unremarkable here, it is unremarkable/.test(d));
}

/* ── 4. the two failures this exists to stop, both caught in play ────────────── */
{
  const d = reactionDirective(world(), GOLD, "do");
  check("the previous topic may not simply continue", /must not still be an argument about money/.test(d));
  check("and the act may not become a figure of speech", /figure of speech, a lesson, or an occasion for someone's philosophy/.test(d));
}

/* ── 5. it stays quiet when there is nothing to answer ───────────────────────── */
{
  const s = world();
  check("a thought is imperceptible, so nothing answers it", reactionDirective(s, "*she is lying*", "think") === "");
  check("pure speech raises no act", reactionDirective(s, `"Where were you last night?"`, "do") === "");
  check("and a gesture is below the floor", reactionDirective(s, "I nod", "do") === "");
  const alone = world();
  alone.world.present = [];
  check("alone, the place answers instead of a person", /Nobody is here to see it/.test(reactionDirective(alone, GOLD, "do")));
}

/* ── 6. the world has to keep knowing ───────────────────────────────────────── */
{
  const s = world();
  check("nothing witnessed, nothing stamped", applyUnexplained(s, undefined, 35).length === 0 && !s.power_witnessed);

  const log = applyUnexplained(s, { what: "Rabi made a cart and a safe of gold appear out of empty air.", witnesses: ["Lucia", "Tertia"] }, 35);
  check("the world's read of the player changes", s.power_witnessed?.tier === "mythic", s.power_witnessed);
  check("and it says so once", log.length === 1, log);
  for (const id of ["char_l", "char_t"]) {
    const m = s.memory[id].episodic.find((x) => /out of empty air/.test(x.content));
    check(`${s.characters[id].name} remembers watching it`, !!m, s.memory[id].episodic);
    check(`  ...at a weight that survives the memory cap`, (m?.importance ?? 0) >= 9);
  }
  // recorded twice in one scene must not double-file
  applyUnexplained(s, { what: "Rabi made a cart and a safe of gold appear out of empty air.", witnesses: ["Lucia"] }, 35);
  check("the same sight is not filed twice",
    s.memory.char_l.episodic.filter((x) => /out of empty air/.test(x.content)).length === 1);
}
{
  // an unnamed witness list falls back to whoever was standing there
  const s = world();
  applyUnexplained(s, { what: "The wound closed under his hand." }, 40);
  check("present characters witness it by default", s.memory.char_t.episodic.some((x) => /wound closed/.test(x.content)));
}
{
  // already mythic: refresh the clock, never escalate on its own
  const s = world();
  s.power_witnessed = { tier: "cosmic", turn: 10 };
  applyUnexplained(s, { what: "He unmade the hill." }, 40);
  check("a standing tier is refreshed, not promoted", s.power_witnessed.tier === "cosmic" && s.power_witnessed.turn === 40, s.power_witnessed);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
