/* Smoke test: FIRING A CLOCK BY HAND GOES THROUGH THE ENGINE'S OWN DISCHARGE.
 *
 * A clock does not act when it fills. `dischargeFiredClocks` converts it into a PENDING CONSEQUENCE
 * and beat selection checks due consequences ahead of cooldowns and grace — that is what forces the
 * promised thing into a scene at full scale.
 *
 * Which makes the obvious hand-edit exactly wrong: setting status to "fired" is the one change that
 * PREVENTS a clock firing, because the discharge guard only picks up clocks that are still running.
 * A clock edited that way goes quiet having promised something that never arrives. */
import { newSave, registerCharacter } from "../src/engine/state";
import { dischargeFiredClocks, isDue } from "../src/engine/pressure";
import type { SaveState, FactionClock } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const clock = (over: Partial<FactionClock> = {}): FactionClock => ({
  id: "clk_courts", faction: "The courts of Aurenza",
  objective: "place a woman of their own close enough to the God-Duke to hold him",
  segments: 6, filled: 1, status: "running",
  consequence: "A rival to Mable is installed inside the estate with a court behind her.",
  visible_signs: [], ...over,
});

function world(over: Partial<FactionClock> = {}): SaveState {
  const s = newSave("clocks", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.current_turn = 40;
  s.world.clocks = [clock(over)];
  return s;
}

/* what the button does: fill it, leave it running, let the engine discharge */
function fireByHand(s: SaveState, id: string) {
  const c = s.world.clocks.find((x) => x.id === id)!;
  c.filled = c.segments;
  c.status = "running";
  const log = dischargeFiredClocks(s, s.world.current_turn);
  for (const x of s.world.consequences) if (x.id === `clockfire_${c.id}` && x.status === "pending") x.fire_turn = s.world.current_turn;
  return log;
}

/* 1. a partly-filled clock does nothing on its own */
{
  const s = world();
  check("an unfilled clock queues nothing", dischargeFiredClocks(s, 40).length === 0);
  check("and stays running", s.world.clocks[0].status === "running");
  check("with no consequence pending", s.world.consequences.length === 0);
}

/* 2. firing it by hand */
{
  const s = world();
  const log = fireByHand(s, "clk_courts");
  check("it reports what it did", log.some((l) => /clock has run out/.test(l)), log);
  check("the clock is marked fired", s.world.clocks[0].status === "fired");
  check("it is full", s.world.clocks[0].filled === s.world.clocks[0].segments);

  const con = s.world.consequences.find((x) => x.id === "clockfire_clk_courts");
  check("a consequence is queued", !!con);
  check("carrying what the clock promised", /A rival to Mable is installed/.test(con?.description ?? ""), con?.description);
  check("and naming the faction", /The courts of Aurenza/.test(con?.description ?? ""));
  check("it is major, so the beat selector cannot defer it", con?.severity === "major");
  check("it is due NOW, not next turn", isDue(con!, s.world.current_turn, s.world.current_time), con);
  check("and it would still be due a turn later", isDue(con!, s.world.current_turn + 1, s.world.current_time));
}

/* 3. THE TRAP: hand-setting status to "fired" is the one edit that stops it firing */
{
  const s = world({ filled: 6, status: "fired" });
  check("a clock already marked fired queues nothing", dischargeFiredClocks(s, 40).length === 0);
  check("so its promise never arrives", s.world.consequences.length === 0, s.world.consequences);
  // which is exactly what the button avoids
  const s2 = world({ filled: 6, status: "fired" });
  s2.world.clocks[0].status = "running";
  check("resetting it to running lets the discharge run", dischargeFiredClocks(s2, 40).length === 1);
  check("and the consequence lands", s2.world.consequences.length === 1);
}

/* 4. firing twice does not double-queue */
{
  const s = world();
  fireByHand(s, "clk_courts");
  s.world.clocks[0].status = "running";           // simulate a second attempt
  dischargeFiredClocks(s, 41);
  check("the same clock's consequence is queued once", s.world.consequences.filter((x) => x.id === "clockfire_clk_courts").length === 1,
    s.world.consequences.length);
}

/* 5. a clock with no consequence written still closes cleanly */
{
  const s = world({ consequence: "" });
  const log = fireByHand(s, "clk_courts");
  check("it fires", s.world.clocks[0].status === "fired");
  check("queues nothing there is nothing to queue", s.world.consequences.length === 0);
  check("and says nothing happened", log.length === 0, log);
}

/* 6. other clocks are left alone */
{
  const s = world();
  s.world.clocks.push(clock({ id: "clk_other", faction: "The northern league", filled: 2 }));
  fireByHand(s, "clk_courts");
  const other = s.world.clocks.find((c) => c.id === "clk_other")!;
  check("an unrelated clock does not move", other.filled === 2 && other.status === "running");
  check("and queues nothing", !s.world.consequences.some((x) => x.id === "clockfire_clk_other"));
}


/* ── A CLOCK THE NARRATOR CAN ACTUALLY SHOW ─────────────────────────────────────
 *
 * A player: "Clocks flare up, tensions, there are TONS of threads popping up where literally
 * nothing in the prose depicts anything of what is occurring."
 *
 * The narrator is deliberately not shown the clock table — a faction's objective and its consequence
 * are private bookkeeping, and handing them over is the omniscience leak that makes every character
 * mysteriously aware of what a distant power intends. The selected beat came through the directive
 * as a title and nothing else. But visible_signs is the opposite of private: the forge writes it as
 * what an ordinary person in this world can SEE of that faction's progress, and it was withheld
 * along with the rest. Told to "advance this clock into the player's awareness" with nothing
 * observable attached, the narrator writes a sentence of foreboding and moves on — which is exactly
 * a clock flaring with nothing on the page.
 */
{
  const { selectBeat, pressureDirective } = await import("../src/engine/pressure");
  const clocks: any = [{
    id: "c1", faction: "The decurio", objective: "seize the inn for the road tax",
    segments: 6, filled: 5, status: "running", consequence: "the inn is taken",
    visible_signs: ["men counting tiles on the roof", "a notice nailed to the post at the crossroads"],
  }];
  const beat: any = selectBeat({ turn: 20, tension: 7, threads: [], clocks, consequences: [], agents: [], last_beat_turn: 0, last_exo_turn: 0 } as any);
  check("a mature clock is picked as the beat", beat?.kind === "clock", beat);
  check("and the beat carries what can be seen of it", beat?.signs?.length === 2, beat);
  check("and how far along it is", beat?.filled === 5 && beat?.segments === 6, beat);

  const d = pressureDirective({ pressure: 7, band: "high", source: "clock" } as any, undefined, 7, "mortal", beat);
  check("the directive names the signs", /men counting tiles on the roof/.test(d), d.slice(0, 300));
  check("...and requires one of them on the page", /put at least one of these ON THE PAGE this turn/.test(d));
  check("...as an event, not an atmosphere", /not as a mood/.test(d));
  check("...and says how close it is", /5 of 6 of the way to happening/.test(d));
  // AND STILL NOT THE OMNISCIENCE LEAK: nobody in the room learns what the sign is for.
  check("the scene is told nobody knows what it means", /Nobody in the scene knows what it is FOR/.test(d));
  check("the private consequence is not handed over", !/the inn is taken/.test(d), d);

  // a clock with no signs recorded still works, just without the extra
  const bare: any = selectBeat({ turn: 20, tension: 7, threads: [], clocks: [{ ...clocks[0], visible_signs: [] }], consequences: [], agents: [], last_beat_turn: 0, last_exo_turn: 0 } as any);
  const d2 = pressureDirective({ pressure: 7, band: "high", source: "clock" } as any, undefined, 7, "mortal", bare);
  check("no signs recorded, no empty demand", !/ON THE PAGE this turn/.test(d2), d2.slice(0, 200));
  check("...but the beat still fires", /maturing faction clock/.test(d2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
