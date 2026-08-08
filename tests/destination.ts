/* Smoke test: A DESTINATION HAS TO REACH THE PEOPLE IT IS ABOUT.
 *
 * A player set this ending:
 *
 *   "Tessa makes Rabi a cuckold, explicitly telling him he can only have her armpits or feet,
 *    while she gets to fuck Anthony and he will live with them."
 *
 * and played to turn 87. Tessa's want, forged by the engine, was:
 *
 *   "Get herself hard and stay hard with Rabi again — reclaim the part of her body she is proud of
 *    and that he loves, by changing how they touch each other this week."
 *
 * The exact inversion. Anthony's was "stop being seen as a threat". Every want in the cast pointed
 * away from the stated ending, and the player's read was: she has no general direction, the
 * destination was missed completely.
 *
 * Two mechanical causes. The budget was 77 turns and only 15 were spent, which is the "open" act —
 * where enforceFate returned immediately, so there was no spine thread, nothing for the pressure
 * system to select, and nothing visible anywhere. And the drive forge, which writes those wants,
 * was never shown the destination at all. */
import { newSave, registerCharacter } from "../src/engine/state";
import { readFate, enforceFate, fateDirective } from "../src/engine/fate";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const DEST = "Tessa claims Anthony as her lover and relegates Rabi, who lives with them.";

function world(turn: number, budget = 77, setAt = 72): SaveState {
  const s = newSave("dest", { name: "The Narrow House", destination: DEST, destination_turns: budget, destination_set_turn: setAt } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa" } as any);
  s.world.current_turn = turn;
  return s;
}

/* 1. the save's actual numbers put it in the open act — that part was never wrong */
{
  const f = readFate(world(87));
  check("the clock is read from turns spent", f.turnsUsed === 15 && f.budget === 77, f);
  check("which is the open act", f.act === "open", f.act);
  check("and it is active", f.active);
  check("with most of the budget left", f.turnsLeft === 62, f.turnsLeft);
}

/* 2. but open no longer means the engine does nothing */
{
  const s = world(87);
  check("no spine thread before the pass runs", !s.world.threads.some((t) => t.id === "thread_fate"));
  enforceFate(s, readFate(s));
  const spine = s.world.threads.find((t) => t.id === "thread_fate");
  check("the ending exists as a thread from the open act", !!spine, s.world.threads.map((t) => t.id));
  check("carrying the destination", /Anthony/.test(spine?.description ?? ""), spine?.description);
  check("quiet, so it does not take over an open story", (spine?.tension ?? 0) === 3, spine?.tension);
  check("and running", spine?.status === "active");

  // open must still leave the rest of the world alone
  const s2 = world(87);
  s2.world.threads.push({ id: "t_other", title: "Mara digs into Anthony's past", status: "active", description: "unrelated", turn_started: 1, tension: 6 } as any);
  enforceFate(s2, readFate(s2));
  check("an unrelated thread keeps its pull in the open act",
    s2.world.threads.find((t) => t.id === "t_other")!.tension === 6);
}

/* 3. and it still tightens on schedule */
{
  const rising = world(72 + 25);       // 32% of budget
  enforceFate(rising, readFate(rising));
  check("rising raises the spine above open", (rising.world.threads.find((t) => t.id === "thread_fate")?.tension ?? 0) > 3);

  const conv = world(72 + 70);         // 91%
  const fc = readFate(conv);
  check("late budget is convergence", fc.act === "convergence", fc.act);
  conv.world.threads.push({ id: "t_other", title: "something else", status: "active", description: "unrelated", turn_started: 1, tension: 6 } as any);
  enforceFate(conv, fc);
  check("now unrelated threads lose their pull",
    conv.world.threads.find((t) => t.id === "t_other")!.tension < 6);

  const done = world(72 + 77);
  check("a spent budget forces the ending", readFate(done).forceArrival);
}

/* 4. the narrator is told, at every act, what the ending is */
{
  for (const [label, turn] of [["open", 87], ["rising", 72 + 25], ["closing", 72 + 50], ["convergence", 72 + 70], ["arrival", 72 + 77]] as [string, number][]) {
    const d = fateDirective(readFate(world(turn)), "Anthony must be brought back into the household");
    check(`${label}: the destination is named`, d.includes(DEST) || /WRITE THE ENDING/.test(d), d.slice(0, 60));
  }
  check("the gap is passed through when there is one",
    /Anthony must be brought back/.test(fateDirective(readFate(world(72 + 50)), "Anthony must be brought back into the household")));
  check("no destination, no directive at all", fateDirective(readFate(newSave("x", { name: "V" } as any)), "") === "");
}

/* 5. a story with no destination is untouched — open play must stay open */
{
  const s = newSave("free", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.current_turn = 40;
  const f = readFate(s);
  check("fate is inactive", !f.active);
  check("and plants no thread", enforceFate(s, f).length === 0 && !s.world.threads.some((t) => t.id === "thread_fate"));

  // a destination with no budget is also not a clock
  const s2 = newSave("nobudget", { name: "V", destination: DEST, destination_turns: 0 } as any);
  registerCharacter(s2, { name: "Rabi", character_id: "char_player" } as any);
  check("a destination with no turns is inert", !readFate(s2).active);
  check("and plants nothing", !s2.world.threads.some((t) => t.id === "thread_fate"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
