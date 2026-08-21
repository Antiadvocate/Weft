/* Smoke test: SARAH COMES AWAY GLAD IT'S OVER.
 *
 * A woman is told the friendship is finished, told to leave before the police are called, and served
 * a restraining order. Her card at turn 92:
 *
 *   relaxation  -8.15        grief_drag 6
 *   mood        "gutted, hollow relief, no longer chasing"
 *   states      ["guilt toward Vin", "shaken by the player's impossible power"]
 *   Sarah -> Vin   warmth  +4    trust -18.3
 *   note        "The restraining order is the final door; she knows it is over and is not chasing"
 *
 * The psyche is right — she is wrecked, and the fault channel caught what she did. Two things on
 * that card are not.
 *
 * WARMTH +4 TOWARD THE MAN WHO FILED IT. The note and the number disagree, which the engine already
 * has a rule for: "a rupture the note names gets a rupture-sized move." It did not fire, twice over.
 *   · Its vocabulary is FEELINGS — contempt, hatred, betrayal, withdrawal — and her note contains
 *     none of them. It names an EVENT. A bond can end without anybody feeling a listed feeling
 *     about it; what ends it is a thing that happened, and the note says the thing.
 *   · And the direction guard read `warmth_delta < 0`, so it fired only where the numbers were
 *     already moving the right way and merely too small. The case it exists for — a rupture note
 *     with a delta of 0, or omitted, which parses as 0 — is precisely the words and the numbers
 *     disagreeing, and it sat that one out.
 *
 * "SHAKEN BY THE PLAYER'S IMPOSSIBLE POWER." In a contemporary domestic romance. The power-tier
 * detector matched /across the (planet|world|continent|country)/ against the line "You flew across
 * the country in a towel, Vin" — a commercial flight to Seattle — classified it mythic, and stamped
 * every present character with a state that then persisted on their cards. The comment above that
 * pattern list already warns about exactly this class of false positive for "with a wave of her
 * hand". The distance was never the impossible part. The MANNER is.
 */
import { applyEdgeDelta } from "../src/engine/social";
import { detectPowerTier } from "../src/engine/pressure";
import type { SocialEdge } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const edge = (w: number, t: number): SocialEdge[] =>
  [{ from: "char_s", to: "char_player", warmth: w, trust: t, power: 0, attraction: 0 } as SocialEdge];

/* ── 1. the save's own edge ───────────────────────────────────────────────────── */
{
  const edges = edge(19, -3);
  applyEdgeDelta(edges, { from: "char_s", to: "char_player", warmth_delta: 0, trust_delta: -15,
    note: "The restraining order is the final door; she knows it is over and is not chasing" }, 91);
  check("an ending EVENT is a rupture even with no feeling word in it", edges[0].warmth < 5, edges[0]);
  check("...and it does not leave her fond of him", edges[0].warmth <= 4, edges[0].warmth);
}

/* ── 2. zero is not warming ───────────────────────────────────────────────────── */
{
  const zero = edge(40, 40);
  applyEdgeDelta(zero, { from: "char_s", to: "char_player", warmth_delta: 0, trust_delta: 0,
    note: "She holds him in open contempt now." }, 10);
  check("a rupture note with a zero delta still moves", zero[0].warmth < 40, zero[0].warmth);

  // ...but a genuinely positive delta still blocks it, which is all the direction rule needed
  const warming = edge(40, 40);
  applyEdgeDelta(warming, { from: "char_s", to: "char_player", warmth_delta: 6, trust_delta: 4,
    note: "She is moving past her contempt and choosing to align with him." }, 10);
  check("a warming turn is never inverted by a keyword", warming[0].warmth > 40, warming[0].warmth);

  const reconciling = edge(40, 40);
  applyEdgeDelta(reconciling, { from: "char_s", to: "char_player", warmth_delta: 0, trust_delta: 0,
    note: "She is getting over the betrayal and letting go of it." }, 10);
  check("nor is a note about getting over it", reconciling[0].warmth >= 40, reconciling[0].warmth);
}

/* ── 3. people fly ────────────────────────────────────────────────────────────── */
{
  check("flying across the country is not impossible power",
    detectPowerTier("You flew across the country in a towel, Vin.") === "mortal");
  check("nor is driving across a continent",
    detectPowerTier("She drove across the continent that summer.") === "mortal");
  check("nor is crossing state lines",
    detectPowerTier("individual traveled across state lines uninvited") === "mortal");
  check("but stepping across it in one breath is",
    detectPowerTier("She stepped across the world between one breath and the next.") === "mythic");
  check("...as is being instantly on the other side of the planet",
    detectPowerTier("He was instantly on the other side of the planet.") === "mythic");
  check("and the unambiguous ones are untouched",
    detectPowerTier("teleported them away") === "mythic" && detectPowerTier("unmade a star") === "cosmic");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
