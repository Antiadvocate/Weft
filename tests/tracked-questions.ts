/* Smoke test: THE PLAYER'S OWN VARIABLES, KEPT CURRENT BY THE STORY.
 *
 * Everything Weft tracks is something the engine decided to track. A player who cares whether the
 * bridge is still standing had to keep typing it. A tracked question (after Talemate's state
 * reinforcements) is re-answered from the record every few turns, alongside the bookkeeper, and
 * handed to the narrator as how things stand. */
import { addTracked, removeTracked, dueTracked, trackedContext, applyTracked, trackedBlock, askTracked, MAX_TRACKED, TRACKED_SYSTEM } from "../src/engine/tracked";
import { newSave } from "../src/engine/state";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

(async () => {
  const s = newSave("Valley", { name: "Valley" } as any);
  s.world.current_turn = 10;
  s.history = [{ turn: 9, time_label: "Day 2, 18:00", player_action: "I cross the bridge", narrator_prose: "", summary: "Joe crossed the old bridge; a plank gave way behind him." } as any];

  const a = addTracked(s, "Is the bridge still standing?", 2)!;
  const b = addTracked(s, "How much does Mara owe the Hall?")!;
  check("a question is pinned", !!a && s.world.tracked!.length === 2 && b.every === 3);
  check("a blank one is not", addTracked(s, "   ") === null);
  for (let i = 0; i < 10; i++) addTracked(s, `question ${i}`);
  check(`no more than ${MAX_TRACKED}`, s.world.tracked!.length === MAX_TRACKED);
  for (const t of [...s.world.tracked!]) if (t.id !== a.id && t.id !== b.id) removeTracked(s, t.id);
  check("and they can be taken off", s.world.tracked!.length === 2);

  check("both are due on first sight", dueTracked(s, 10).length === 2);
  applyTracked(s, [{ id: a.id, answer: "It stands, missing one plank near the far end." }, { id: "trk_nope", answer: "x" }], 10);
  check("an answer lands on its question, with the turn", !!a.answer?.startsWith("It stands") && a.answered_turn === 10);
  check("an answer to a question that doesn't exist is ignored", s.world.tracked!.every((t) => t.answer !== "x"));
  check("an answered question waits its interval", !dueTracked(s, 11).some((t) => t.id === a.id) && dueTracked(s, 12).some((t) => t.id === a.id));

  const ctx = trackedContext(s, dueTracked(s, 12), "The plank you stepped over is gone now; the river shows through.");
  check("the call reads recent turns, this turn's prose, and the last answer", /a plank gave way/.test(ctx) && /river shows through/.test(ctx) && /last answer \(turn 10\): It stands/.test(ctx), ctx);

  const block = trackedBlock(s);
  check("the narrator is told how it stands", /WHAT THE PLAYER IS KEEPING TRACK OF/.test(block) && /Is the bridge still standing\? — It stands/.test(block), block);
  check("an unanswered question isn't put in front of the narrator", !/Mara owe/.test(block));
  check("the narrator digest carries the block", /\$\{trackedBlock\(state\)\}/.test(readFileSync("src/engine/prompts.ts", "utf8")));

  const none = newSave("x", { name: "x" } as any);
  check("nothing pinned, nothing asked, no socket opened", (await askTracked(none, "prose", { model: "m", fallback: "m" })).length === 0);
  check("the call is told to leave a gap open rather than fill it", /isn't known yet/.test(TRACKED_SYSTEM) && /don't add events/i.test(TRACKED_SYSTEM));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
