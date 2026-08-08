/* Smoke test: A BLANK FIELD IN THE EDITOR MUST NOT MAKE A SAVE UNPLAYABLE.
 *
 *   undefined is not an object (evaluating 'z.title.toLowerCase')
 *
 * every turn, forever. Ten places call `.title.toLowerCase()` on a STORED thread — one of them on
 * the threads_update path, which runs on every turn — and none of them were guarded. Threads became
 * hand-editable when the Inspector shipped, and nothing validated them on the way in: adding a row
 * and not filling it, or clearing a title, was enough to end the save.
 *
 * Two halves. sanitize heals the world's lists on load, so a save already carrying the damage
 * repairs itself the next time it is opened; and every read site coerces, so the next hole cannot
 * do this again. */
import { sanitize, newSave, registerCharacter } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import type { SaveState, SimulatorDiff } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function broken(): SaveState {
  const s = newSave("broken", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_x"] = { id: "loc_x", name: "X", description_facts: "A room.", contains: [] };
  s.world.player_location = "loc_x";
  s.world.current_turn = 12;
  // exactly what the editor produces: a row added and never filled, and a title cleared by hand
  s.world.threads = [
    { id: "thr_ok", title: "Anthony's patience", status: "active", description: "fraying", turn_started: 1, tension: 7 },
    { id: "thr_blank" } as any,
    { description: "a thread whose title was cleared in the editor", status: "active" } as any,
    null as any,
  ];
  s.world.clocks = [{ id: "clk_ok", faction: "The courts" } as any, {} as any, null as any];
  s.world.promises = [{ id: "p1", from: "char_player", to: "x", text: "help her", status: "open", weight: 1, made_turn: 1 } as any, { id: "p2" } as any];
  s.world.consequences = [{ id: "c1", description: "the thing arrives", status: "pending", fire_turn: 13, severity: "major" } as any, { id: "c2" } as any];
  return s;
}

/* 1. the damage repairs itself on load */
{
  const s = sanitize(broken());
  check("the junk row is dropped", s.world.threads.length === 2, s.world.threads.map((t) => t.id));
  check("the real thread survives", s.world.threads.some((t) => t.title === "Anthony's patience"));
  check("a title-less thread WITH a description is kept and given an empty title",
    s.world.threads.some((t) => t.title === "" && /cleared in the editor/.test(t.description)), s.world.threads);
  check("every surviving thread has a string title", s.world.threads.every((t) => typeof t.title === "string"));
  check("and a usable tension", s.world.threads.every((t) => typeof t.tension === "number" && t.tension >= 0 && t.tension <= 10));
  check("and an id", s.world.threads.every((t) => !!t.id));
  check("and a valid status", s.world.threads.every((t) => ["active", "resolved", "abandoned"].includes(t.status)));

  check("empty clock rows are dropped", s.world.clocks.length === 1, s.world.clocks);
  check("the clock keeps sane segments", s.world.clocks[0].segments >= 1 && s.world.clocks[0].filled >= 0);
  check("a text-less promise is dropped", s.world.promises!.length === 1, s.world.promises);
  check("a description-less consequence is dropped", s.world.consequences.length === 1, s.world.consequences);
}

/* 2. and a turn runs against the healed world instead of throwing */
{
  const s = sanitize(broken());
  let threw = "";
  try {
    applyDiff(s, { threads_update: [{ id: "thr_new", title: "Where does Rabi sleep now", status: "active", description: "a live rupture", tension: 5 }] } as unknown as SimulatorDiff,
      "I sit down", "He sat down and said nothing.");
  } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check("a turn does not throw on threads_update", threw === "", threw);
  check("the new thread landed", s.world.threads.some((t) => t.title === "Where does Rabi sleep now"), s.world.threads.map((t) => t.title));
}

/* 3. the read sites survive a hole that gets past the healer */
{
  const s = sanitize(broken());
  (s.world.threads[0] as any).title = undefined;      // as if something wrote it after load
  let threw = "";
  try {
    applyDiff(s, { threads_update: [{ id: "x", title: "Something new", status: "active", description: "d", tension: 4 }] } as unknown as SimulatorDiff, "I wait", "Nothing happened.");
  } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check("an unhealed title no longer crashes the turn", threw === "", threw);
}

/* 4. a healthy world is not disturbed */
{
  const s = newSave("fine", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.threads = [{ id: "t1", title: "Anthony's patience", status: "active", description: "fraying", turn_started: 3, tension: 7 }];
  const before = JSON.stringify(s.world.threads);
  sanitize(s);
  check("a good thread is byte-identical after healing", JSON.stringify(s.world.threads) === before, s.world.threads);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
