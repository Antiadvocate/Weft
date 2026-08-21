/* Smoke test: NOBODY IS EVER IN THE WRONG.
 *
 * The player's report: "no one feels guilt. There is only I was wronged." And the particular person
 * who could not exist: "people who are so attached that in their guilt they want to apologize, in
 * their hurt they want to do anything to fix things, without fixing their own emotions or
 * recognizing how they're hurt."
 *
 * They were right, and it was structural rather than a matter of tuning. Every emotional mechanic in
 * the engine reads what was done TO somebody. wasAbused stops the person who was sworn at from
 * settling. betrayals counts the times you gave in against your own want. grief_drag is what loss
 * does to your resting point. tickRivalry is watching somebody else's pursuit land. Not one of them
 * reads what a person DID — so there was no cost to causing it, and applyStances actively pays for
 * it ("standing your ground is free, and it hands a point of self back"). A character could be
 * wronged, resent, and withdraw. They could not be at fault.
 *
 * The repair loop is the part that matters and the part that is easy to get wrong, so it is worth
 * saying what it is NOT. It is not healthy repair. The fixing is what the person is doing INSTEAD of
 * feeling it: the second hit wearing a different coat, where a clenched body normally re-tells the
 * pain until the story becomes its own pain, and this one runs the pain outward into activity where
 * it never has to be felt. Which is why the loop suppresses self-liberation — a body sprinting looks
 * settled, and emotions.ts reads settled as "nothing is gripping this".
 */
import { faultsThisTurn, applyFaults, tickRepair, faultDirective } from "../src/engine/fault";
import { tickEmotions } from "../src/engine/emotions";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(opts: { conscience: number; style: string; warmth: number; relax?: number }): SaveState {
  return {
    world: {
      current_turn: 10, present: ["char_a"], places: {}, edges: [
        { from: "char_a", to: "char_player", warmth: opts.warmth, trust: opts.warmth, power: 0, attraction: 0 },
        { from: "char_player", to: "char_a", warmth: opts.warmth, trust: opts.warmth, power: 0, attraction: 0 },
      ],
    },
    characters: {
      char_player: { name: "Vin" },
      char_a: { name: "Miranda", conscience: opts.conscience, attachment: { style: opts.style } },
    },
    condition: {
      char_player: { psyche: { relaxation: 0, active_states: [], capacity: 2, recovery: 0.2, consecutive_clenched: 0, state: "intact" } },
      char_a: { psyche: { relaxation: opts.relax ?? 0, active_states: [], capacity: 2, recovery: 0.2, consecutive_clenched: 0, state: "intact" } },
    },
    model_settings: {},
  } as unknown as SaveState;
}

/* ── 1. it lands, and it scales with the bond ─────────────────────────────────── */
{
  const close = world({ conscience: 0.8, style: "secure", warmth: 75 });
  const before = close.condition.char_a.psyche.relaxation;
  applyFaults(close, [{ character: "char_a", toward: "char_player", about: "told his secret to Chloe" }], 10);
  const closeDip = before - close.condition.char_a.psyche.relaxation;
  check("doing it registers", !!close.condition.char_a.psyche.fault, close.condition.char_a.psyche);
  check("...as a state, named", close.condition.char_a.psyche.active_states.some((s: string) => /guilt toward Vin/.test(s)));
  check("...and it costs them", closeDip > 0, closeDip);

  const distant = world({ conscience: 0.8, style: "secure", warmth: 8 });
  const b2 = distant.condition.char_a.psyche.relaxation;
  applyFaults(distant, [{ character: "char_a", toward: "char_player", about: "same act" }], 10);
  check("hurting someone you love costs more than hurting a stranger",
    closeDip > b2 - distant.condition.char_a.psyche.relaxation);
}

/* ── 2. THE RUDRA LINE HOLDS. A cold character does the same harm and carries none of it. ── */
{
  const cold = world({ conscience: 0.2, style: "secure", warmth: 75 });
  const before = cold.condition.char_a.psyche.relaxation;
  applyFaults(cold, [{ character: "char_a", toward: "char_player", about: "told his secret" }], 10);
  check("a cold character registers no fault", !cold.condition.char_a.psyche.fault, cold.condition.char_a.psyche);
  check("...and takes no hit for it", cold.condition.char_a.psyche.relaxation === before);
  check("...and carries no guilt state", cold.condition.char_a.psyche.active_states.length === 0);
}

/* ── 3. the deterministic backstop: a cliff in the edge is somebody having done something ── */
{
  const st = world({ conscience: 0.8, style: "secure", warmth: 60 });
  const found = faultsThisTurn(st, { edges: [{ from: "char_player", to: "char_a", warmth_delta: -30, trust_delta: -25, note: "walked out mid-sentence" }] } as never);
  check("a hard edge drop names the one who caused it", found.some((f) => f.character === "char_a" && f.toward === "char_player"), found);
  const quiet = faultsThisTurn(st, { edges: [{ from: "char_player", to: "char_a", warmth_delta: -4, trust_delta: -2 }] } as never);
  check("an ordinary bad turn is not a fault", quiet.length === 0, quiet);
}

/* ── 4. THE PATTERN. Hurt, and the one doing the fixing anyway. ─────────────────── */
{
  const st = world({ conscience: 0.75, style: "anxious", warmth: 70, relax: 4 });
  const p = st.condition.char_a.psyche;
  // she is the one who was hurt — no fault of hers
  p.active_states = ["hurt by what he said"];
  p.state_ages = { "hurt by what he said": 6 };
  st.world.edges[0].last_rupture_turn = 9;

  tickRepair(st);
  check("she starts trying to fix it", (p.repairing ?? 0) > 0, p);
  check("...even though it was done to her", !p.fault, p);
  check("...and it becomes her live pursuit", /get things right with Vin/.test(st.characters.char_a.drive?.goal ?? ""), st.characters.char_a.drive);
  check("...whose approach does not mention being hurt",
    /does not mention being hurt/.test(st.characters.char_a.drive?.approach ?? ""));

  // AND THE POINT: she reads settled, and nothing releases.
  check("she looks settled", p.relaxation >= 3, p.relaxation);
  tickEmotions(st);
  check("but the hurt does NOT self-liberate while she is running",
    p.active_states.includes("hurt by what he said"), p.active_states);
  tickRepair(st);   // a second turn of it
  check("...and what she is outrunning is accruing", (p.unfelt ?? 0) > 0, p.unfelt);

  // the same body, not repairing, releases exactly as it always did
  const free = world({ conscience: 0.75, style: "anxious", warmth: 70, relax: 4 });
  free.condition.char_a.psyche.active_states = ["hurt by what he said"];
  free.condition.char_a.psyche.state_ages = { "hurt by what he said": 6 };
  tickEmotions(free);
  check("a settled body that is NOT running still releases",
    !free.condition.char_a.psyche.active_states.includes("hurt by what he said"),
    free.condition.char_a.psyche.active_states);
}

/* ── 5. and when they finally stop, it arrives ───────────────────────────────── */
{
  const st = world({ conscience: 0.75, style: "anxious", warmth: 70, relax: 4 });
  const p = st.condition.char_a.psyche;
  p.repairing = 9; p.repair_toward = "char_player"; p.unfelt = 3; p.repair_baseline = 70;
  const before = p.relaxation;
  tickRepair(st);
  check("the running stops", !p.repairing, p);
  check("...and it lands", p.relaxation < before, { before, after: p.relaxation });
  check("...as the thing they never registered", p.active_states.some((s: string) => /only now feeling it/.test(s)), p.active_states);
}

/* ── 6. being received ends it properly — forgiveness is a door, not another hit ── */
{
  const st = world({ conscience: 0.75, style: "anxious", warmth: 70 });
  const p = st.condition.char_a.psyche;
  p.repairing = 3; p.repair_toward = "char_player"; p.unfelt = 2;
  p.active_states = ["guilt toward Vin"];
  p.repair_baseline = 40;          // where he stood when she started
  st.world.edges[1].warmth = 60;   // and he has come back toward her since
  const before = p.relaxation;
  tickRepair(st);
  check("it completes when it is received", !p.repairing, p);
  check("...the guilt goes", !p.active_states.some((s: string) => /^guilt toward /.test(s)), p.active_states);
  check("...and they are better for it, not worse", p.relaxation > before);
}

/* ── 6b. A HIGH NUMBER IS NOT A RECONCILIATION, which is the bug this caught ───────
 *
 * Landing used to be an absolute check (their warmth >= 45). In exactly the relationships this
 * mechanism exists for — the close ones — their warmth is already above that before anything
 * happens, so every repair loop "succeeded" on its second turn having achieved nothing. Landing is
 * a MOVEMENT from wherever the rupture left them. */
{
  const st = world({ conscience: 0.75, style: "anxious", warmth: 70 });
  const p = st.condition.char_a.psyche;
  p.repairing = 3; p.repair_toward = "char_player"; p.unfelt = 2; p.repair_baseline = 70;
  tickRepair(st);
  check("warm-but-unmoved is not being let back in", (p.repairing ?? 0) > 3, p);
}

/* ── 7. what the narrator is told, and what it is never told ─────────────────── */
{
  const st = world({ conscience: 0.8, style: "anxious", warmth: 70 });
  st.condition.char_a.psyche.repairing = 2;
  st.condition.char_a.psyche.repair_toward = "char_player";
  const d = faultDirective(st);
  check("the repair loop reaches the narrator", d.length > 0, d);
  check("...told as behavior, never as a stated feeling", !/feels guilty|feels hurt/i.test(d), d);
  check("...including the part the player actually described",
    /answer about .* instead|does not raise what was done to THEM/i.test(d), d);

  const sec = world({ conscience: 0.8, style: "secure", warmth: 70 });
  sec.condition.char_a.psyche.fault = { toward: "char_player", about: "told his secret", turn: 10 };
  const sd = faultDirective(sec);
  check("a secure character is told to SAY the thing they did", /They SAY it|name the thing they actually did/.test(sd), sd);
  check("...without a justification riding behind it", /without a justification/.test(sd), sd);

  const avoid = world({ conscience: 0.8, style: "avoidant", warmth: 70 });
  avoid.condition.char_a.psyche.fault = { toward: "char_player", about: "x", turn: 10 };
  check("an avoidant one goes flat instead", /will not go near it|distance/.test(faultDirective(avoid)));

  const cold = world({ conscience: 0.2, style: "secure", warmth: 70 });
  cold.condition.char_a.psyche.fault = { toward: "char_player", about: "x", turn: 10 };
  check("and a cold one is never handed a conscience it does not have", faultDirective(cold) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
