/* Smoke test: A WANT IS NOT A THING PEOPLE SAY.
 *
 * A save read like a novel rather than like people, and the reason was mechanical. A drive is a
 * sentence, the card hands the narrator that sentence under "wants:", and the shortest path from a
 * sentence to a scene is a character saying it. Jess's recorded want was "find the right words to
 * tell Rabi about her body's changes and the pregnancy before tonight", and on turn 12 she said:
 *
 *     "I'll—" She taps her fingers on the table. "I'll have words by then. The right ones."
 *
 * She recited her own goal field. Nothing in the state or the contract described HOW a person goes
 * at something they are frightened of — and that approach is where the characterisation actually
 * lives. Someone with a want they cannot say raises the adjacent subject, asks a question so the
 * other person volunteers it, floats a small deniable version first, tells it as someone else's
 * story. Which door they pick says more about them than the want does.
 *
 * So a drive carries a door now, and the door has to survive the bookkeeper rewriting the drive
 * every turn — which was the trap: `mk()` rebuilt the drive object from the diff's fields, so an
 * approach would have been dropped on the first progress update, one turn after it was written. */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest, narratorSystem } from "../src/engine/prompts";
import { applyDiff } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("oblique", {
    name: "CuldeSac of the Heart",
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Jess", character_id: "char_jess" } as any);
  s.world.current_turn = 12;
  s.world.present = ["char_jess"];
  const pid = "loc_kitchen";
  s.world.places[pid] = { id: pid, name: "the kitchen", description_facts: "A table, a window.", contains: [] } as any;
  s.world.player_location = pid;
  s.characters.char_player.location = pid;
  s.characters.char_jess.location = pid;
  return s;
}

const GOAL = "Find the right words to tell Rabi about her body's changes and the pregnancy before tonight.";
const DOOR = "brings it up as a case she read about, and watches his face while she describes it";

/* ── 1. the rule reaches the narrator, in both contracts ─────────────────────── */
{
  for (const lean of [false, true]) {
    const sys = narratorSystem(lean);
    check(`${lean ? "lean" : "full"}: the contract says a want is not announced`,
      /NOBODY LEADS WITH IT/.test(sys), sys.slice(0, 80));
    check(`${lean ? "lean" : "full"}: and names the doors people actually use`,
      /adjacent/.test(sys) && /deniable version/.test(sys));
    check(`${lean ? "lean" : "full"}: and does not contradict the intensity rule`,
      /frightened|furious|aroused/.test(sys) && /(plainly|directly)/.test(sys));
  }
}

/* ── 2. the door reaches the card, and reads as an instruction about behaviour ─ */
{
  const s = world();
  s.characters.char_jess.drive = { goal: GOAL, approach: DOOR, progress: 30, priority: 1, updated_turn: 11 };
  const digest = volatileDigest(s, "");
  check("the want is on the card", digest.includes(GOAL));
  check("so is the door", digest.includes(DOOR), digest.slice(0, 200));
  check("and the card says the want itself is not to be stated",
    /they do not state the want itself/.test(digest));
}
{
  const s = world();
  s.characters.char_jess.drive = { goal: GOAL, progress: 30, priority: 1, updated_turn: 11 };
  check("a drive with no door adds no line", !/goes at it by/.test(volatileDigest(s, "")));
}

/* ── 3. THE DOOR SURVIVES THE BOOKKEEPER ─────────────────────────────────────── */
const bump = (s: SaveState, d: Record<string, unknown>) =>
  applyDiff(s, { drives_update: [{ char_id: "char_jess", ...d }] } as any,
    "I ask how her morning went.", "Jess looks up from the table. Jess says the morning was fine.");

{
  const s = world();
  s.characters.char_jess.drive = { goal: GOAL, approach: DOOR, progress: 30, priority: 1, updated_turn: 11 };
  // the ordinary case: the bookkeeper moves progress and rewrites the blocker, nothing else
  bump(s, { goal: GOAL, progress: 45, blocker: "Fear of how he will react." });
  const d = s.characters.char_jess.drive!;
  check("a progress update does not drop the door", d.approach === DOOR, d);
  check("while progress still moves", d.progress === 45, d.progress);
}
{
  const s = world();
  s.characters.char_jess.drive = { goal: GOAL, approach: DOOR, progress: 30, priority: 1, updated_turn: 11 };
  bump(s, { goal: "Get out of the house before he wakes up.", progress: 0 });
  check("but a NEW want does not inherit the old door",
    s.characters.char_jess.drive?.approach === undefined, s.characters.char_jess.drive);
}
{
  const s = world();
  s.characters.char_jess.drive = { goal: GOAL, approach: DOOR, progress: 30, priority: 1, updated_turn: 11 };
  const better = "asks him to rub her feet, and lets the conversation arrive from there";
  bump(s, { goal: GOAL, progress: 50, approach: better });
  check("and a door the bookkeeper writes replaces the old one",
    s.characters.char_jess.drive?.approach === better, s.characters.char_jess.drive);
}
{
  // a "door" that just restates the want is not a door — it would hand the narrator the
  // announcement twice over
  const s = world();
  s.characters.char_jess.drive = { goal: GOAL, progress: 30, priority: 1, updated_turn: 11 };
  bump(s, { goal: GOAL, progress: 40, approach: "Find the right words to tell Rabi about the pregnancy tonight." });
  check("a restatement of the want is rejected as a door",
    s.characters.char_jess.drive?.approach === undefined, s.characters.char_jess.drive);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
