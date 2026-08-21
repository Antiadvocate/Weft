/* Smoke test: an authored want that has never once happened, in any save.
 *
 * The player wrote a want onto a character, at maximum stage, crystallised. Four turns later the
 * prose had covered a dishwasher, a dryer full of napkins, a row of glasses and a conversation
 * about Chloe. Nothing else. The turn before that save it was five turns of plates and mail.
 *
 * Measured across every save this engine has produced — eleven playthroughs, twenty authored wants,
 * several of them running 90, 114, 156, 165 and 179 turns — EXACTLY ONE FIRED, ONCE. The feature
 * has effectively never worked, and every one of those saves already contained the proof:
 *
 *     Miranda  'Will re-fold a napkin or straighten a picture frame...'   fires=1  last=1
 *     Miranda  "Has a laugh that starts as a surprised, sharp 'Ha!'..."   fires=1  last=2
 *     Miranda  'Always Makes sure Vin's face is always covered...'        fires=0  last=-1
 *
 * The simulator reports `traits_expressed` every turn — which core traits the scene actually put on
 * screen, "judged by MEANING, not wording" — and recordExpressions files the answer in state.habits.
 * A crystallised want IS a core trait, so the answer was always right there. Her two ordinary traits
 * fired; the authored one never did; and nothing in the engine read the difference.
 *
 * I BUILT THE WRONG DETECTOR FIRST. It matched the want's distinctive words against the prose. Over
 * these same saves the turns where the act demonstrably never happened scored 0.36–0.50 overlap
 * ("face", "dry", "talking" turn up in ordinary kitchen prose), while a paragraph written to contain
 * the act outright scored 0.09, because real prose says "came across his cheek" where the want says
 * "cums on his face". It ranked the misses ABOVE the hit. Word overlap cannot answer a question
 * about meaning; the model that reads the scene already can, and already does.
 *
 * A detector was also tried here once before and removed, correctly — it gated PROGRESS on finding
 * the want, and the ladder's early rungs are deliberately not the act. So this reads only the rung
 * where the act itself is ordered, and it never touches the ratchet.
 */
import { noteWantMisses, missDirective, actOrdered, newAuthored, crystallize } from "../src/engine/authored";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const GOAL = "Always Makes sure Vin's face is always covered with her cum, does not let him wipe it off, quickly cums on his face if it's dry without needing sex or talking to him about what she's doing.";

function scene(opts: Partial<Parameters<typeof newAuthored>[2]> = {}) {
  const s: any = newSave("t", { name: "Vin" } as any);
  s.world.places["loc_x"] = { id: "loc_x", name: "The loft", description_facts: "k", contains: [] };
  s.world.player_location = "loc_x";
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  const m = registerCharacter(s, { name: "Miranda", age: 38, background: "b", core_traits: ["t"] } as any);
  s.characters[m].location = "loc_x";
  s.world.present = ["char_player", m];
  const a = newAuthored(GOAL, 1, { stage: 5, inhabit_turns: 3, ...opts });
  s.characters[m].authored = [a];
  return { s, m, a };
}
const fired = (s: any, m: string, label: string, turn: number) => {
  (s.habits ??= {})[m] = [{ trait: label, strength: 90, baseline: 90, seen_fires: 1, last_fired_turn: turn, noticed_watermark: 90 }];
};

/* ── 1. which rung is allowed to be judged ────────────────────────────────────── */
{
  const { s, m, a } = scene();
  check("a rung below the act is not judged", !actOrdered(newAuthored(GOAL, 1, { stage: 0, inhabit_turns: 8 })));
  check("a live want at the top of its ramp is", actOrdered(newAuthored(GOAL, 1, { stage: 5, inhabit_turns: 3, turns_live: 3 })));
  crystallize(s, m, a, 3);
  check("a crystallised want always is", actOrdered(a));
  a.paused = true;
  check("a paused want is not", !actOrdered(a));
  a.paused = undefined;
}

/* ── 2. the save that prompted this ───────────────────────────────────────────── */
{
  const { s, m, a } = scene();
  crystallize(s, m, a, 3);
  // no habit row at all: it has never been expressed, which is what that save carries
  const first = noteWantMisses(s, 4, [m]);
  check("a want with no habit row is a miss", first.length === 1, first);
  check("...counted", a.missed === 1);
  check("...and the player is told, not left guessing", /did not reach the page/.test(first[0]), first);

  const second = noteWantMisses(s, 5, [m]);
  check("the second turn says how many", /skipped 2 turns running/.test(second[0]), second);
  check("...and keeps counting", a.missed === 2);
}

/* ── 3. a turn where it actually happened ─────────────────────────────────────── */
{
  const { s, m, a } = scene();
  const label = crystallize(s, m, a, 3)!;
  noteWantMisses(s, 4, [m]);
  noteWantMisses(s, 5, [m]);
  check("two turns of skipping are on the record", a.missed === 2);
  fired(s, m, label, 6);
  check("the turn it fires reports nothing", noteWantMisses(s, 6, [m]).length === 0);
  check("...and the count is cleared", a.missed === 0);
  check("...so the next turn is told nothing", missDirective(s, [m]) === "");

  // stale: it fired, but three turns ago
  fired(s, m, label, 6);
  check("a fire from an older turn does not count for this one", noteWantMisses(s, 9, [m]).length === 1);
}

/* ── 4. what the narrator is handed ───────────────────────────────────────────── */
{
  const { s, m, a } = scene();
  crystallize(s, m, a, 3);
  check("silent while nothing has been missed", missDirective(s, [m]) === "");

  noteWantMisses(s, 4, [m]);
  const one = missDirective(s, [m]);
  check("after one miss it says so", /THE TURN CAME BACK WITHOUT IT/.test(one), one);
  check("...quoting the want", one.includes("covered with her cum"), one);
  check("...and the count", /ordered for the last 1 turn and absent from all of it/.test(one), one);
  check("...ordering it to the front of the prose", /WRITE IT FIRST THIS TURN/.test(one));
  check("...with no lead-in required", /needs no lead-in and no occasion/.test(one));
  check("...because the build-up already happened", /The build-up already happened/.test(one));

  noteWantMisses(s, 5, [m]);
  const two = missDirective(s, [m]);
  check("after two it escalates", /There is no third/.test(two), two);
  check("...and counts them", /ordered for the last 2 turns and absent from all of them/.test(two), two);
  check("...without simply getting louder", !/VERY|EXTREMELY|ABSOLUTELY MUST/.test(two));
}

/* ── 5. it stays out of everything else ───────────────────────────────────────── */
{
  const { s, m, a } = scene();
  crystallize(s, m, a, 3);
  const before = { stage: a.stage, acted: a.acted, turns_live: a.turns_live, label: a.label, crystallized_turn: a.crystallized_turn };
  noteWantMisses(s, 4, [m]);
  noteWantMisses(s, 5, [m]);
  check("the ratchet is untouched", a.stage === before.stage && a.acted === before.acted && a.turns_live === before.turns_live);
  check("the label is untouched", a.label === before.label && a.crystallized_turn === before.crystallized_turn);
  check("the player is never judged", noteWantMisses(s, 6, ["char_player"]).length === 0);
  check("a character with no wants is never judged", noteWantMisses(s, 6, ["char_nobody"]).length === 0);

  const below = scene({ stage: 0, inhabit_turns: 8 });
  check("a want still climbing is never reported missing", noteWantMisses(below.s, 4, [below.m]).length === 0);
  check("...and draws no directive", missDirective(below.s, [below.m]) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
