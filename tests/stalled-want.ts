/* Smoke test: NOBODY ASKS THE SAME QUESTION FOUR TIMES.
 *
 * Mable, three turns running, in almost the same words:
 *
 *   t122 "I want to know what I am to you when you are not afraid and not hoping."
 *   t123 "What am I to you when you're not afraid and not hoping?"
 *   t124 "I asked what I am to you when you're not afraid and not hoping."
 *
 * Her drive was "Get Rabi to give her a concrete place in his life" — a want that cannot be
 * advanced by anything she DOES, only by the player answering. tickDrives documents this failure
 * exactly and has an escape hatch for it... measured against `drive.updated_turn`.
 *
 * Which the bookkeeper restamps every single turn the question is live, because it rewrites the
 * blocker each turn ("his answer was warm but vague, and the horn interrupted"). So the staleness
 * counter read 2 forever, the abandonment could never fire, and the threshold was forty turns
 * anyway. The escape hatch was disarmed by the loop it exists to break — the same shape as the
 * arrival timer measured against a field stamped every turn. */
import { newSave, registerCharacter } from "../src/engine/state";
import { tickDrives, STALLED_WANT_TURNS } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function withWant(goal: string, progress = 30): { s: SaveState; id: string } {
  const s = newSave("stall", { name: "V" } as any);
  s.world.places["loc_room"] = { id: "loc_room", name: "Rabi's floor", description_facts: "", contains: [] };
  s.world.player_location = "loc_room";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, { name: "Mable" } as any);
  s.characters[id].location = "loc_room";
  s.characters[id].drive = { goal, progress, priority: 1, updated_turn: 1 };
  s.world.current_turn = 1;
  return { s, id };
}

/* 1. the loop, reproduced: the bookkeeper restamps updated_turn every turn */
{
  const { s, id } = withWant("Get Rabi to give her a concrete place in his life, not just feelings.");
  for (let t = 2; t <= 2 + STALLED_WANT_TURNS + 2; t++) {
    s.world.current_turn = t;
    // exactly what the bookkeeper does while the question is on the table: rewrite the blocker,
    // restamp updated_turn, and leave progress where it was
    if (s.characters[id].drive) {
      s.characters[id].drive!.blocker = `his answer was warm but vague (turn ${t})`;
      s.characters[id].drive!.updated_turn = t;
    }
    tickDrives(s, () => 0.5);
  }
  check("the want is eventually given up on", !s.characters[id].drive, s.characters[id].drive);
  check("giving up is remembered", (s.memory[id]?.episodic ?? []).some((m: any) => /stopped asking/i.test(m.content)),
    (s.memory[id]?.episodic ?? []).map((m: any) => m.content));
}

/* 2. ...and it happens on a human timescale, not forty turns */
{
  const { s, id } = withWant("Get Rabi to say what she is to him.");
  for (let t = 2; t <= 1 + STALLED_WANT_TURNS; t++) {
    s.world.current_turn = t;
    if (s.characters[id].drive) s.characters[id].drive!.updated_turn = t;
    tickDrives(s, () => 0.5);
  }
  check(`it does not fire before ${STALLED_WANT_TURNS} turns of no progress`, !!s.characters[id].drive);
  s.world.current_turn = 2 + STALLED_WANT_TURNS;
  if (s.characters[id].drive) s.characters[id].drive!.updated_turn = s.world.current_turn;
  tickDrives(s, () => 0.5);
  check("and it does fire once the window passes", !s.characters[id].drive, s.characters[id].drive);
}

/* 3. a want that is actually MOVING is never taken away */
{
  const { s, id } = withWant("Finish the north wall before the frost.", 10);
  for (let t = 2; t <= 2 + STALLED_WANT_TURNS * 3; t++) {
    s.world.current_turn = t;
    const d = s.characters[id].drive;
    if (d) { d.progress = Math.min(95, d.progress + 5); d.updated_turn = t; }   // real work, every turn
    tickDrives(s, () => 0.5);
  }
  check("a want being worked on survives", !!s.characters[id].drive, s.characters[id].drive);
  check("its progress clock tracks the movement", (s.characters[id].drive!.progress ?? 0) > 30);
}

/* 4. a want that is nearly done is not abandoned for stalling at the end */
{
  const { s, id } = withWant("Get the charter signed.", 80);
  for (let t = 2; t <= 2 + STALLED_WANT_TURNS + 3; t++) {
    s.world.current_turn = t;
    if (s.characters[id].drive) s.characters[id].drive!.updated_turn = t;
    tickDrives(s, () => 0.5);
  }
  check("something 80% done is not thrown away", !!s.characters[id].drive, s.characters[id].drive);
}

/* 5. the progress clock is seeded for saves written before it existed */
{
  const { s, id } = withWant("An old want from a save with no progress clock.");
  delete (s.characters[id].drive as any).progress_turn;
  s.world.current_turn = 50;
  tickDrives(s, () => 0.5);
  check("an unseeded drive is not instantly abandoned", !!s.characters[id].drive, s.characters[id].drive);
  check("and it now carries a progress clock", s.characters[id].drive!.progress_turn === 50, s.characters[id].drive);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
