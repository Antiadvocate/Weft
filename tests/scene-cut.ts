/* Smoke test: A SCENE THAT HAS SPENT ITSELF ENDS BY ITSELF.
 *
 * A screenplay reading feels natural moment to moment and still arrives somewhere, because a scene
 * is a unit: it plays its beat and the film CUTS, and the ordinary connective time — the drive, the
 * afternoon, the queue — is crossed in a line of slug text that nobody misses.
 *
 * Weft had no unit. Every turn was one beat at the same granularity, in the same room, until the
 * player typed a movement — so the player was doing the director's job by hand ("I do the laundry,
 * then I go see Marcus"). That should keep working. It should not be the only way a story changes
 * room or hour.
 *
 * `world.scene_started_time` already existed and was printed to the narrator every turn. Nothing
 * read it. The whole risk in reading it is cutting away from a scene that was not finished, so
 * almost all of this file is about when the answer must be NO. */
import { newSave, registerCharacter } from "../src/engine/state";
import { readScene, sceneCutDirective } from "../src/engine/scene";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** A long, quiet scene with nobody pursuing anything: the one shape that is actually finished. */
function spentScene(): SaveState {
  const s = newSave("scene", {
    name: "CuldeSac of the Heart",
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Jess", character_id: "char_jess" } as any);
  s.world.current_turn = 30;
  s.world.present = ["char_jess"];
  s.world.scene_started_time = "Day 1, 09:00 (Morning)";
  s.world.current_time = "Day 1, 11:00 (Morning)";      // two hours in
  s.pressure_trace = [5, 4, 1, 1, 0, 2];                 // four flat turns at the tail
  return s;
}

{
  const r = readScene(spentScene());
  check("a long quiet scene with nobody pursuing is spent", r.spent, r);
  check("and reports how it got there", r.minutes >= 75 && r.flatFor >= 4, r);
  check("the directive tells it to end on the page", /Bring it to a close ON THE PAGE/.test(sceneCutDirective(r)));
  check("and permits the cut, rather than ordering it", /You MAY CUT/i.test(sceneCutDirective(r)));
  check("with the guard against inventing a reason", /Never invent an errand/.test(sceneCutDirective(r)));
}

/* ── every way the answer has to be NO ───────────────────────────────────────── */
{
  const s = spentScene();
  s.world.current_time = "Day 1, 09:40 (Morning)";       // 40 minutes
  const r = readScene(s);
  check("a young scene is never cut", !r.spent && r.reason === "still young", r);
}
{
  const s = spentScene();
  s.pressure_trace = [1, 1, 1, 6];                        // something just arrived
  const r = readScene(s);
  check("a scene something just entered is not cut", !r.spent && /still arriving/.test(r.reason), r);
}
{
  const s = spentScene();
  s.pressure_trace = [1, 1, 1];                           // only three flat turns
  check("three quiet turns is a lull, not an ending", !readScene(s).spent, readScene(s));
}
{
  const s = spentScene();
  s.world.consequences = [{ id: "c1", description: "The call she has been dreading comes.", status: "pending", due_time: "Day 1, 11:05 (Morning)" } as any];
  const r = readScene(s);
  check("never cut away from a consequence about to land", !r.spent && /consequence/.test(r.reason), r);
}
{
  const s = spentScene();
  s.characters.char_jess.drive = { goal: "Tell him about the pregnancy.", progress: 40, priority: 1, updated_turn: 29, progress_turn: 29 };
  const r = readScene(s);
  check("a quiet scene where someone is mid-pursuit is still working", !r.spent && /mid-pursuit/.test(r.reason), r);
}
{
  // …but a want that stopped moving turns ago is not holding the scene open
  const s = spentScene();
  s.characters.char_jess.drive = { goal: "Tell him about the pregnancy.", progress: 40, priority: 1, updated_turn: 29, progress_turn: 12 };
  check("a want nobody has moved in twenty turns does not hold it open", readScene(s).spent, readScene(s));
}
{
  // a finished want does not hold it open either
  const s = spentScene();
  s.characters.char_jess.drive = { goal: "Tell him about the pregnancy.", progress: 100, priority: 1, updated_turn: 29, progress_turn: 29 };
  check("nor does a want that is already done", readScene(s).spent, readScene(s));
}
{
  const r = readScene(spentScene());
  check("a scene that is not spent produces no directive at all",
    sceneCutDirective({ ...r, spent: false }) === "");
}
{
  // a fresh save with no scene clock at all must not read as a two-hour scene
  const s = spentScene();
  s.world.scene_started_time = undefined;
  check("no scene clock means no cut", !readScene(s).spent, readScene(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
