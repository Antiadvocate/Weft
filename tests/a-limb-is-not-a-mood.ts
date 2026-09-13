/* HOW EMILY CLARKE GREW HER ARMS BACK.
 *
 *   turn 83   quadriplegic · partially blind · missing left arm · missing right arm · missing both legs
 *   turn 108  (nothing), alive, fatigue "fresh"
 *
 * No timer was involved, and the coherence gate and the card gate would both have sat silent
 * through it, because by then the LEDGER agreed with the narrator: she had her arms.
 *
 * `conditions` is one array of free strings holding two unrelated kinds of thing — what a body is
 * doing this hour ("winded", "in shock") and what has been permanently taken off it ("missing left
 * arm"). Everything managing the array was written for the first kind and applies to the second
 * without noticing. Four separate mechanisms will erase an amputation:
 *
 *  1. THE DEDUPE treats two conditions as one when they share a content word. "missing left arm"
 *     and "missing right arm" share `missing`.
 *  2. THE CAP of six evicts the oldest, and a limb is older than this morning's panic.
 *  3. condition_remove matches loosely, substring either way or one shared word.
 *  4. A MULTI-DAY GAP wiped the array wholesale on a comment claiming everything in it was
 *     transient. Nothing checked.
 *
 * All four now ask body.lossKey whether the thing they are about to drop is a mood or a limb.
 * A limb stays until something NAMES it — and it can still be named, because a story is allowed to
 * give a limb back and everything downstream returns by itself when it does. */
import { addCondition } from "../src/engine/turn";
import { lossKey, isPermanentLoss, lostFaculties } from "../src/engine/body";
import { simulateForward } from "../src/engine/continuity";
import { newSave, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
/** The bookkeeper's facts[] channel, which is where condition_remove arrives from. */
const facts = (state: any, rows: { char_id: string; field: string; value: string }[]) =>
  applyDiff(state, { facts: rows } as any, "", "", true);

const HERS = ["quadriplegic", "partially blind", "missing left arm", "missing right arm", "missing both legs"];

/* ── TELLING A LIMB FROM A MOOD ────────────────────────────────────────────────────────────── */
for (const [t, k] of [
  ["missing left arm", "left|arm"], ["missing right arm", "right|arm"], ["missing both legs", "both|leg"],
  ["left arm amputated below the shoulder", "left|arm"], ["both eyes destroyed", "both|eye"],
  ["quadriplegic", "dx|quadripleg"], ["partially blind", "dx|blind"], ["mute", "dx|mute"],
] as const) check(`${String(k).padEnd(15)} ← ${t}`, lossKey(t) === k, lossKey(t));
for (const t of ["in shock", "winded", "shivering", "hysterical panic", "bleeding",
  "deep gash to the thigh", "broken left leg", "concussion", "feverish", "gunshot wound to the shoulder",
  "tired", "peckish", "soaked through"])
  check(`a mood, not a limb: ${t}`, !isPermanentLoss(t), lossKey(t));

/* ── 1. THE DEDUPE. This is the one that actually did it. ─────────────────────────────────── */
{
  const c: any = { conditions: [], condition_age: {} };
  let t = 80;
  for (const v of HERS) addCondition(c, v, t++);
  check("all five amputations survive being recorded", c.conditions.length === 5, c.conditions);
  check("…the left arm is still there after the right one is written", c.conditions.includes("missing left arm"), c.conditions);
  check("…and the arms are still there after the legs", c.conditions.includes("missing right arm"), c.conditions);
  check("…so the body still reads as wrecked", lostFaculties(c).length === 2, lostFaculties(c));
}
{
  const c: any = { conditions: [], condition_age: {} };
  addCondition(c, "shaken", 1); addCondition(c, "badly shaken", 2);
  check("an ordinary condition still replaces its own variant", c.conditions.length === 1, c.conditions);
  addCondition(c, "missing left arm", 3); addCondition(c, "left arm gone", 4);
  check("…and so does a limb, when it is the SAME limb reworded", c.conditions.length === 2, c.conditions);
}

/* ── 2. THE CAP ────────────────────────────────────────────────────────────────────────────── */
{
  const c: any = { conditions: [], condition_age: {} };
  let t = 80;
  for (const v of HERS) addCondition(c, v, t++);
  for (const v of ["in shock", "hysterical panic", "dissociating", "soaked through"]) addCondition(c, v, t++);
  check("no limb falls off the end of the list", HERS.every((h) => c.conditions.includes(h)), c.conditions);
  check("…the moods take the eviction instead", c.conditions.filter((x: string) => !isPermanentLoss(x)).length <= 1, c.conditions);
  check("…and the list is allowed to be longer than six to hold them", c.conditions.length >= 5, c.conditions.length);
}

/* ── 3. A LOOSE REMOVAL ────────────────────────────────────────────────────────────────────── */
/** A real save with a real Emily in it, so the removals go through the engine and not a stub. */
function withEmily(): { state: any; id: string; c: any } {
  const state: any = newSave("limb-test", {
    name: "England", era: "1932", technology_level: "interwar", magic_rules: "none", forbidden: "",
    what_people_fear: "the means test", cultures_and_languages: "english", climate_and_geography: "wet",
    calendar_and_currency: "sterling", political_situation: "the slump",
  } as any);
  registerCharacter(state, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(state, {
    name: "Emily Clarke", age: 19, appearance_facts: "light brown hair in a short bob, hazel eyes, freckles",
    background: "a dressmaker's girl from Reading",
    core_traits: ["Touches people when she talks to them — a hand on the arm."],
    skills: { "Sewing and dressmaking": "Expert.", "Singing": "Fair. She can carry a tune." },
  } as any);
  const c = state.condition[id];
  c.conditions = [...HERS]; c.condition_age = {};
  return { state, id, c };
}
{
  const { state, id, c } = withEmily();
  facts(state, [{ char_id: id, field: "condition_remove", value: "shock" }]);
  check("a removal aimed at something else takes nothing", c.conditions.length === 5, c.conditions);
  facts(state, [{ char_id: id, field: "condition_remove", value: "missing" }]);
  check("…and a removal naming only the verb takes nothing either", c.conditions.length === 5, c.conditions);
}
/* BUT A LIMB CAN STILL BE GIVEN BACK, and that is the whole design: nothing downstream was edited,
 * so the moment the ledger says the arm is there, every trait and skill that needed it returns. */
{
  const { state, id, c } = withEmily();
  facts(state, [
    { char_id: id, field: "condition_remove", value: "missing left arm" },
    { char_id: id, field: "condition_remove", value: "right arm gone" },
    { char_id: id, field: "condition_remove", value: "quadriplegic" },
  ]);
  check("naming the left arm restores the left arm", !c.conditions.includes("missing left arm"), c.conditions);
  check("…naming it differently still works, because the part is the key", !c.conditions.includes("missing right arm"), c.conditions);
  check("…and what was not named stays gone", c.conditions.includes("missing both legs"), c.conditions);
  check("…so her hands come back and her legs do not",
    !lostFaculties(c).includes("hands") && lostFaculties(c).includes("legs"), lostFaculties(c));
}

/* ── 4. A WEEK OFF THE PAGE ────────────────────────────────────────────────────────────────── */
{
  const { state, c } = withEmily();
  c.conditions.push("soaked through");
  c.injuries = [
    { id: "i1", type: "missing left arm", cause: "the lorry", permanent: true, functional_impact: "", turn: 80 },
    { id: "i2", type: "deep gash to the thigh", cause: "the glass", permanent: false, functional_impact: "", turn: 80 },
  ];
  simulateForward(state, 9, () => 0.5);
  check("nine days do not regrow an arm", HERS.every((h) => c.conditions.includes(h)), c.conditions);
  check("…the soaking dries out", !c.conditions.includes("soaked through"), c.conditions);
  check("…the gash closes", !c.injuries.some((i: any) => /gash/.test(i.type)), c.injuries);
  check("…and the amputation on the injury ledger stays too",
    c.injuries.some((i: any) => /missing left arm/.test(i.type)), c.injuries);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
