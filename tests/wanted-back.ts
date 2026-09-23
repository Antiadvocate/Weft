/* "WOMEN DO NOT DESIRE ME."
 *
 * One number decides which of three renderings the player ever sees. At 0.6 and up a woman "flirts,
 * teases, angles for closeness, makes and takes openings". In the middle she "surfaces in small
 * glances and half-gestures". At 0.35 and below the wanting "leaks as grasping — possessiveness,
 * sharpness, a claim dressed as care". Only the top band looks like being wanted.
 *
 * Measured across nine saves of two games, every edge toward the player carrying real attraction:
 * nine of thirteen sat below 0.5. The clearest case is not even the game that produced the report —
 * it is a woman at warmth NINETY-FOUR with attraction 100 and ordinary relaxation, rendered as
 * small glances and half-gestures.
 *
 * TWO CAUSES. The target read only the body — 0.5 + relaxation × 0.05 — and whether wanting
 * somebody can reach your own self-report is not a fact about how tense you are in general, it is
 * about whether it is safe with that person. The ledger held warmth 94 and this line never looked
 * at it. And the drift was a ratchet rather than a slope: up 0.02 a turn against down 0.06, so one
 * clenched turn cost three good ones and the equilibrium sat far below the target instead of at it.
 *
 * WHAT THIS FILE DOES NOT CLAIM. The first pass at this report blamed the warmth bands in
 * desireLine and moved the whole ceiling to zero, which broke two older fixes — the dead-zone one
 * (a maxed-out woman told not to pursue) and wanting-without-liking. Both of those tests were
 * right. The bands were fine. Only `sore`, which called any dip below zero anger, actually needed
 * moving, and it moved to −8. */
import { tickDesire, desireLine } from "../src/engine/desire";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
function world(warmth: number, attraction: number, relaxation: number, adm: number): SaveState {
  return {
    characters: { c: { name: "Emily" }, char_player: { name: "Rabi" } },
    condition: { c: { psyche: { relaxation, active_states: [] } } },
    world: {
      present: ["c"], current_turn: 1,
      edges: [{ from: "c", to: "char_player", warmth, trust: warmth, attraction, attraction_base: attraction, desire_admissibility: adm, roles: [] }],
    },
  } as unknown as SaveState;
}
const settle = (warmth: number, relax: number, start: number, turns = 40) => {
  const s = world(warmth, 60, relax, start);
  for (let i = 0; i < turns; i++) tickDesire(s);
  return s.world.edges[0].desire_admissibility!;
};
const band = (a: number) => (a >= 0.6 ? "flirts" : a <= 0.35 ? "grasping" : "half-gestures");

/* ── THE CASE THAT MADE IT OBVIOUS ──────────────────────────────────────────────────────────
 * Warmth 94, attraction 100, relaxation −1, and she was rendering as half-gestures. */
{
  const a = settle(94, -1, 0.46);
  check("a woman who loves him ends up able to show it", band(a) === "flirts", a);
  const line = desireLine(world(94, 100, -1, a), "c");
  check("…and the line she gets is the one that acts", /they flirt, tease, angle to get close/.test(line), line.slice(0, 90));
  check("…rather than small glances", !/small glances and half-gestures/.test(line));
}

/* ── SAFETY WITH THIS PERSON, NOT GENERAL CALM ──────────────────────────────────────────────
 * Same body, same turns, different relationship. The old target could not tell these apart. */
{
  const warm = settle(60, 0, 0.3), cold = settle(-60, 0, 0.3);
  check("warmth carries the wanting up", band(warm) === "flirts", warm);
  check("…and its absence does not", band(cold) === "grasping", cold);
  check("…the two diverge from an identical start", warm - cold > 0.4, [warm, cold]);
}
for (const [w, want] of [[40, "flirts"], [20, "flirts"], [0, "half-gestures"], [-30, "grasping"]] as const)
  check(`warmth ${String(w).padStart(3)} settles at ${want}`, band(settle(w, 0, 0.14)) === want, settle(w, 0, 0.14));
check("it is monotonic in warmth", (() => {
  const xs = [-60, -30, -10, 0, 20, 60].map((w) => settle(w, 0, 0.3));
  return xs.every((v, i) => i === 0 || v >= xs[i - 1]);
})(), [-60, -30, -10, 0, 20, 60].map((w) => settle(w, 0, 0.3)));

/* ── A SLOPE, NOT A RATCHET ─────────────────────────────────────────────────────────────────
 * Collapse is still faster than recovery, which is true of people. What it is no longer is
 * unrecoverable: eighteen unbroken turns to climb what three bad ones undid. */
{
  const climbed = settle(40, 0, 0.10, 12);
  check("a collapsed bond can be rebuilt inside a scene's worth of turns", climbed >= 0.55, climbed);
  const dropped = settle(-40, -6, 0.9, 12);
  check("…and it still collapses under real coldness", dropped <= 0.3, dropped);
  check("losing it is still quicker than earning it",
    (0.9 - settle(-40, -6, 0.9, 4)) > (settle(40, 0, 0.1, 4) - 0.1), [settle(-40, -6, 0.9, 4), settle(40, 0, 0.1, 4)]);
}

/* ── AND WHAT WAS LEFT ALONE ────────────────────────────────────────────────────────────────
 * `sore` called any dip below zero anger. Emily at warmth −3 — three below a stranger — was being
 * described as having "no goodwill left" and being "angry at you". Eight is where the older tests
 * put annoyance, so that is where the line went; the bands themselves did not move. */
check("warmth -3 is no longer called anger",
  !/annoyed with you|angry at you/.test(desireLine(world(-3, 52, -2, 0.5), "c")), desireLine(world(-3, 52, -2, 0.5), "c").slice(0, 120));
check("…and warmth -8 still is", /annoyed with you/.test(desireLine(world(-8, 60, 0, 0.5), "c")));
check("a stranger with no attraction is still not given one",
  desireLine(world(2, 5, 0, 0.5), "c").includes("desire toward you: none"), desireLine(world(2, 5, 0, 0.5), "c"));
// …and an established bond with low heat keeps its own branch, which is not this one.
check("a settled bond with banked heat is left to its own line",
  /the bond between you is real/.test(desireLine(world(40, 5, 0, 0.5), "c")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
