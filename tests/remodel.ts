/* Smoke test: SOMATIC REMODELLING, and mostly the proof that it cannot run away.
 *
 * The resting point is now a lived number instead of a constant. The failure mode of that is a
 * ratchet, and wear feeds itself — a lower resting point means more turns below −3, which earns more
 * wear — so the interesting tests here are not "does it move" but "what stops it". This engine has
 * been bitten by a runaway in this exact scalar twice (social.ts records both), and a cast of shells
 * at turn 200 is worse than the constant it replaced.
 *
 * So the load-bearing cases below are the long simulations: two hundred turns of unbroken cruelty,
 * and the same character afterward in a hundred turns of peace.
 */
import { newSave, registerCharacter, blankCondition } from "../src/engine/state";
import { tickPsyche, settleAfterDeltas } from "../src/engine/social";
import {
  tickRemodel, dampen, numbness, bornCapacity, remodelCue, remodelLine, ensureBorn,
  MAX_WEAR, MAX_GROWTH, WEAR_RUN, SETTLE_RUN, NUMB_CEILING,
} from "../src/engine/remodel";
import type { Psyche } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function body(capacity = 2): Psyche {
  const p = blankCondition(capacity).psyche;
  ensureBorn(p);
  return p;
}

/** One turn, in the order turn.ts runs it: baseline, drift + run counters, remodel, then the
 *  simulator's delta through the numbness gate, the grief drag it accrues, and the settle clamp.
 *
 *  The drag is not decoration in this harness and leaving it out is what made the first run of this
 *  file report that two hundred turns of cruelty changed nobody. `settleAfterDeltas` floors
 *  relaxation at the resting point minus four, so a character with a capacity of 2 and no drag
 *  cannot go below −2 and can never reach the braced line at all. Drag is the mechanism by which
 *  sustained loss lowers the effective point far enough for a body to be recorded as braced — which
 *  makes the temporary half of the system the thing that feeds the permanent half. That is what
 *  allostatic load actually is, and the simulation only tests the shipping path with it in. */
function turn(p: Psyche, t: number, delta: number) {
  p.prev_relaxation = p.relaxation;
  tickPsyche(p);
  tickRemodel(p, t);
  const d = dampen(p, delta);
  p.relaxation = Math.max(-10, Math.min(10, p.relaxation + d));
  if (d <= -3) p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + Math.abs(d) * 0.6);
  else if (d <= -1) p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + Math.abs(d) * 0.15);
  settleAfterDeltas(p);
}

/* ── 1. it moves at all ─────────────────────────────────────────────────────── */
{
  const p = body(2);
  for (let t = 1; t <= 40; t++) turn(p, t, -2.5);
  check("sustained bracing lowers the resting point", p.capacity < bornCapacity(p) - 0.5, p.capacity);
  const q = body(0);
  for (let t = 1; t <= 40; t++) turn(q, t, +1.5);
  check("sustained ease raises it", q.capacity > bornCapacity(q) + 0.5, q.capacity);
  // An untroubled forty turns is not a reward. Nothing is lifting this body above where it already
  // rests, so nothing widens — which is the whole reason growth is not keyed off `open_run`.
  const r = body(2);
  for (let t = 1; t <= 40; t++) turn(r, t, t % 2 ? +0.4 : -0.4);
  check("an ordinary quiet save moves nobody", Math.abs(r.capacity - bornCapacity(r)) < 0.4, r.capacity);
}

/* ── 2. THE RATCHET, which is what this file is really for ──────────────────── */
{
  const p = body(2);
  const born = bornCapacity(p);
  for (let t = 1; t <= 200; t++) turn(p, t, -3);
  check("200 turns of unbroken cruelty cannot breach the floor",
    p.capacity >= born - MAX_WEAR - 0.001, { cap: p.capacity, floor: born - MAX_WEAR });
  check("...and the person is still recognisably who they were",
    born - p.capacity <= MAX_WEAR, born - p.capacity);
  check("...and is not broken beyond reach", p.capacity > -10 && numbness(p) <= 1, { cap: p.capacity, numb: numbness(p) });

  // AND THE ROAD BACK IS REAL, which is the whole point of the restoring force.
  const before = p.capacity;
  for (let t = 201; t <= 300; t++) turn(p, t, +1.2);
  check("a hundred turns of peace brings them most of the way home",
    p.capacity > before + 1.0, { from: before, to: p.capacity, born });
  check("...without overshooting into somebody else",
    p.capacity <= born + MAX_GROWTH + 0.001, p.capacity);
}
{
  // The restoring force alone, with nothing happening at all: a worn body left in an empty room
  // does not stay worn. This is the default direction of the whole mechanism.
  const p = body(2);
  p.capacity = bornCapacity(p) - 2.0;
  for (let t = 1; t <= 120; t++) turn(p, t, 0);
  check("with nothing happening at all, a body drifts back toward itself",
    p.capacity > bornCapacity(p) - 0.7, p.capacity);
}
{
  // Growth is not free either — the pull home runs in both directions, so a widened threshold has
  // to be maintained rather than banked.
  const p = body(2);
  for (let t = 1; t <= 60; t++) turn(p, t, +2);
  const peak = p.capacity;
  for (let t = 61; t <= 160; t++) turn(p, t, -0.2);
  check("an unmaintained growth settles back too", p.capacity < peak - 0.5, { peak, now: p.capacity });
}

/* ── 2b. a run earned offscreen is still earned ─────────────────────────────── */
{
  // The run counters live in tickPsyche, so they keep counting through a time skip — where
  // continuity.ts runs drift and nothing else, and tickRemodel is deliberately not called. Steps are
  // owed as a debt rather than checked with a modulo so the week nobody watched still counts.
  const p = body(2);
  p.braced_run = 30;                       // a month offscreen, braced the whole time
  tickRemodel(p, 31);
  check("a run that completed while nobody was looking is paid on the next turn that looks",
    p.capacity <= bornCapacity(p) - 3 * 0.3 + 0.06, p.capacity);
  const at = p.capacity;
  tickRemodel(p, 32);
  check("...and only paid once", p.capacity >= at - 0.06, { at, now: p.capacity });
  p.braced_run = 0;
  for (let t = 33; t <= 40; t++) tickRemodel(p, t);
  check("...and the debt resets with the run", (p.wear_steps ?? 0) === 0, p.wear_steps);
}

/* ── 3. settling is easier to earn than wear ────────────────────────────────── */
check("the settle run is shorter than the wear run", SETTLE_RUN < WEAR_RUN, { SETTLE_RUN, WEAR_RUN });
{
  // Symmetric conditions, opposite signs: coming back must not be slower than going down.
  const down = body(2); for (let t = 1; t <= 60; t++) turn(down, t, -2.5);
  const up = body(2); for (let t = 1; t <= 60; t++) turn(up, t, +2.5);
  check("...and equal time earns at least as much settling as wear",
    (up.capacity - bornCapacity(up)) >= (bornCapacity(down) - down.capacity) - 0.5,
    { gained: up.capacity - bornCapacity(up), lost: bornCapacity(down) - down.capacity });
}

/* ── 4. numbness has a ceiling, and it is the safety property ───────────────── */
{
  const p = body(2);
  for (let t = 1; t <= 200; t++) turn(p, t, -3);      // as worn as this engine allows
  check("a worn body is worn", numbness(p) > 0.5, numbness(p));
  check("ordinary friction lands lighter", Math.abs(dampen(p, -1)) < 1, dampen(p, -1));
  check("but never below 45% of itself", Math.abs(dampen(p, -1)) >= 0.45, dampen(p, -1));
  check("a real blow lands in full, on the most hardened body in any save",
    dampen(p, -4) === -4 && dampen(p, 3) === 3, [dampen(p, -4), dampen(p, 3)]);
  check("the ceiling is where the ceiling says it is",
    dampen(p, -(NUMB_CEILING + 0.01)) === -(NUMB_CEILING + 0.01));
  const fresh = body(2);
  check("nobody undamaged is damped", dampen(fresh, -1) === -1);
  const grown = body(2); grown.capacity = bornCapacity(grown) + 2;
  check("and settling never blunts anybody", numbness(grown) === 0 && dampen(grown, -1) === -1);
}

/* ── 5. never the player ────────────────────────────────────────────────────── */
{
  const s: any = newSave("t", { name: "Vin" } as any);
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Amber", character_id: "char_a" } as any);
  s.condition["char_player"].psyche.relaxation = -8;
  s.condition["char_a"].psyche.relaxation = -8;
  for (let t = 1; t <= 40; t++) {
    for (const [id, c] of Object.entries<any>(s.condition)) {
      c.psyche.prev_relaxation = c.psyche.relaxation;
      tickPsyche(c.psyche);
      if (id !== "char_player") tickRemodel(c.psyche, t);
      c.psyche.relaxation = Math.max(-10, c.psyche.relaxation - 2.5);
      c.psyche.grief_drag = Math.min(6, (c.psyche.grief_drag ?? 0) + 2.5 * 0.15);
      settleAfterDeltas(c.psyche);
    }
  }
  const pl = s.condition["char_player"].psyche, npc = s.condition["char_a"].psyche;
  check("the same forty turns move an NPC's resting point", npc.capacity < bornCapacity(npc) - 0.5, npc.capacity);
  check("...and leave the player's exactly where it was", pl.capacity === bornCapacity(pl), pl.capacity);
}

/* ── 6. what anybody is allowed to see ──────────────────────────────────────── */
{
  const fresh = body(2);
  check("an unchanged body says nothing on the card", remodelCue(fresh, "Amber") === "");
  const worn = body(2); worn.capacity = bornCapacity(worn) - 1.4;
  const wc = remodelCue(worn, "Amber");
  check("a worn body is described by what it no longer reacts to", /no longer reacts to|does not land/.test(wc), wc);
  check("...and never by a number", !/-?\d+\.\d|\bcapacity\b|\brelaxation\b/.test(wc), wc);
  check("...and never as toughness or a mood", /never as a mood and never as toughness/.test(wc));
  const grown = body(2); grown.capacity = bornCapacity(grown) + 1.4;
  check("a settled body is described as a widened threshold", /widened threshold/.test(remodelCue(grown, "Leo")));
  check("...and never as cheerfulness", /never as cheerfulness/.test(remodelCue(grown, "Leo")));
  // The audit line is the opposite: numbers, because a slow hidden scalar has to be legible.
  check("the audit line carries the actual numbers", /2\.0 → 0\.60/.test(remodelLine(worn, "Amber")), remodelLine(worn, "Amber"));
  check("...including what still reaches them", /friction lands at \d+%/.test(remodelLine(worn, "Amber")), remodelLine(worn, "Amber"));
}

/* ── 7. release accrues, it does not fire ───────────────────────────────────── */
{
  const p = body(2);
  p.discharges = 1;
  for (let t = 1; t <= 3; t++) tickRemodel(p, t);
  check("one discharge is an opening, not a new nature", p.capacity <= bornCapacity(p) + 0.05, p.capacity);
  p.discharges = 3;
  tickRemodel(p, 4);
  check("three across a save move the resting point", p.capacity > bornCapacity(p) + 0.15, p.capacity);
  const at = p.capacity;
  tickRemodel(p, 5); tickRemodel(p, 6);
  check("...and are not paid twice", p.capacity <= at, { at, now: p.capacity });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
