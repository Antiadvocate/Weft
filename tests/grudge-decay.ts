/* Smoke test: NOBODY TRUSTS THE PLAYER AND NOTHING EVER CHANGES THAT.
 *
 * Every edge toward the player, across three saves:
 *
 *   turn  5   Lucilla 0/0    Marcus 0/-8    Tigellinus 0/0    Sabina 0/-10   Marcella 0/0
 *   turn 25   Lucia 52/18    Marcus 12/7    Tigris -11/-5     Hadrian 0/0    Clodia 7/2
 *   turn 31   Marcella 86/48  Lucilla 0/0   Marcus 0/-8       Sabina 3/-8
 *
 * The -8 and the -10 at turn 5 were earned by asking a wineshop keeper where a man buys a slave in
 * Rome. Twenty-six turns and a chapter later, Marcus is still at exactly -8. He was never going to
 * be anything else: decayEdges exempted everything inside ±20 in BOTH directions, so a small bond
 * could not erode — right — and a small grudge could not heal, which is not. Two hundred idle turns
 * leaves -8 at -8.
 *
 * Souring needs no maintenance and warmth does. That is the asymmetry the exemption encoded, and it
 * is backwards: a first impression wears off unless something confirms it.
 *
 * The second half is a compositional error. Trust carries its own deliberate asymmetry — positive
 * deltas at 60% — and obduracy is a SECOND brake for guarded characters, and the two were being
 * multiplied. At obduracy 0.6 a +4 landed as 1.54 against a -4 at full strength. Since the forge
 * turns out to make most of a cast guarded (measured: 12 of 14 insecure, 7 avoidant), that was most
 * of a cast, and a character receiving forty turns of nothing but warmth topped out at trust 32.
 */
import { decayEdges, applyEdgeDelta, getEdge } from "../src/engine/social";
import type { Identity, SocialEdge } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const edge = (warmth: number, trust: number): SocialEdge[] =>
  [{ from: "a", to: "char_player", warmth, trust, power: 0, updated_turn: 0 } as SocialEdge];

function idle(e: SocialEdge[], turns: number) { for (let t = 1; t <= turns; t++) decayEdges(e, t); }

/* ── 1. the two numbers from the save ─────────────────────────────────────────── */
{
  const marcus = edge(0, -8), sabina = edge(0, -10);
  idle(marcus, 60); idle(sabina, 60);
  check("Marcus's -8 heals when nothing feeds it", marcus[0].trust === 0, marcus[0].trust);
  check("and Sabina's -10", sabina[0].trust === 0, sabina[0].trust);
}

/* ── 2. a quiet friendship is not a decaying one ──────────────────────────────── */
{
  const e = edge(12, 12);
  idle(e, 200);
  check("a small bond still holds forever", e[0].warmth === 12 && e[0].trust === 12, e[0]);
}

/* ── 3. a large bond still erodes toward the band, as before ──────────────────── */
{
  const e = edge(80, 80);
  idle(e, 60);
  check("a big warmth erodes when neglected", e[0].warmth < 80 && e[0].warmth >= 20, e[0].warmth);
  check("but never past the band", e[0].warmth >= 20, e[0].warmth);
}

/* ── 4. a real rupture takes a long time to fade, and does ────────────────────── */
{
  const e = edge(-70, -70);
  idle(e, 40);
  check("40 idle turns barely touches a betrayal", e[0].trust < -40, e[0].trust);
  idle(e, 400);
  check("but four hundred turns of nothing does reach zero", e[0].trust === 0, e[0].trust);
}

/* ── 5. an active edge is not decayed at all ──────────────────────────────────── */
{
  const e = edge(0, -8);
  e[0].updated_turn = 100;
  decayEdges(e, 104);   // only four turns idle, under the threshold
  check("a fresh grievance is untouched", e[0].trust === -8, e[0].trust);
}

/* ── 6. the brakes are no longer multiplied ───────────────────────────────────── */
{
  const guarded = { character_id: "a", name: "A", core_traits: ["guarded", "wary"], conscience: 0.3 } as unknown as Identity;
  const open = { character_id: "a", name: "A", core_traits: [], conscience: 0.8 } as unknown as Identity;
  const climb = (who: Identity) => {
    const edges: SocialEdge[] = [];
    for (let i = 0; i < 40; i++) {
      applyEdgeDelta(edges, { from: "a", to: "char_player", warmth_delta: 4, trust_delta: 4, power_delta: 0 }, i,
        { chars: { a: who }, traits: {} });
    }
    return getEdge(edges, "a", "char_player");
  };
  const g = climb(guarded), o = climb(open);
  check("a guarded character can still be reached", g.trust > 55, g.trust);
  check("but is still slower than an open one", g.trust < o.trust, [g.trust, o.trust]);
  check("and warmth is still braked for them, which is the point of obduracy", g.warmth < o.warmth, [g.warmth, o.warmth]);
  console.log(`     (40 turns of steady warmth: open reaches trust ${o.trust.toFixed(0)}, guarded ${g.trust.toFixed(0)} — was 32)`);
}

/* ── 7. trust still breaks faster than it builds, which is deliberate ─────────── */
{
  const edges: SocialEdge[] = [];
  const chars = { a: { character_id: "a", name: "A", core_traits: [], conscience: 0.8 } as unknown as Identity };
  applyEdgeDelta(edges, { from: "a", to: "char_player", warmth_delta: 10, trust_delta: 10, power_delta: 0 }, 1, { chars, traits: {} });
  const up = getEdge(edges, "a", "char_player").trust;
  applyEdgeDelta(edges, { from: "a", to: "char_player", warmth_delta: -10, trust_delta: -10, power_delta: 0 }, 2, { chars, traits: {} });
  const after = getEdge(edges, "a", "char_player").trust;
  check("a +10 lands smaller than a -10 removes", up < 10 && after < 0, [up, after]);
  check("...and warmth is symmetric for an open person", getEdge(edges, "a", "char_player").warmth === 0, getEdge(edges, "a", "char_player").warmth);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
