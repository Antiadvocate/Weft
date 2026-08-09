/* Smoke test: A REBUFF DOES NOT CONVERT A SEDUCER INTO AN ENEMY.
 *
 * Clara was built to be the neighbour who pulls the player away from his wife. Her card says so in
 * every field: taste is "quiet, competent men who seem oblivious to their own appeal", conscience
 * 0.25, values include "desire is a game to be won", and her voice is "Sit. No, there. The light's
 * kinder there." Her want, at the turn this was taken from, is still "get Rabi alone in her house
 * this week — coffee over the vintage credenza — and get his hands on her."
 *
 * Then he drew a boundary, twice, and the second time it stung. State afterwards:
 *
 *     Clara → Rabi   warmth 19, trust -6, attraction 49, roles ["neighbor", "ENEMY"]
 *     psyche         relaxation -10, mood "stunned and cold", states [humiliation, resentment]
 *
 * The narrator was then handed a seducer's want and an enemy's role in the same card, and resolved
 * it toward the role every single turn. The player got an interrogator.
 *
 * Two things were wrong, and neither is the model's.
 *
 * 1. "enemy" is not a role. The bookkeeper's own contract says "roles are facts; warmth and trust
 *    are feelings" — and a verdict is a feeling wearing a role's clothes. Trust was already -6; the
 *    label carried no information and froze the relationship permanently, because roles never decay.
 * 2. Nothing told the narrator how to hold a want and a wound at once. */
import { applyEdgeDelta, getEdge } from "../src/engine/social";
import { narratorSystem } from "../src/engine/prompts";
import type { SocialEdge } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const edges = (): SocialEdge[] => {
  const es: SocialEdge[] = [];
  const e = getEdge(es, "char_clara", "char_player");
  Object.assign(e, { warmth: 19, trust: -6, attraction: 49, roles: ["neighbor"] });
  return es;
};
const setRoles = (es: SocialEdge[], roles: string[]) =>
  applyEdgeDelta(es, { from: "char_clara", to: "char_player", warmth_delta: 0, trust_delta: 0, power_delta: 0, roles_set: roles }, 56);

/* ── 1. a verdict is not a role ──────────────────────────────────────────────── */
{
  const es = edges();
  setRoles(es, ["neighbor", "enemy"]);
  const e = getEdge(es, "char_clara", "char_player");
  check("one bad evening does not make her an enemy", !(e.roles ?? []).some((r) => /enemy/i.test(r)), e.roles);
  check("and what she actually IS survives", (e.roles ?? []).includes("neighbor"), e.roles);
  check("the feeling is not lost — it was already in the numbers", e.trust < 0, e.trust);
}
{
  const es = edges();
  setRoles(es, ["victim", "prey", "traitor", "the obstacle"]);
  check("nor any of the other verdicts", (getEdge(es, "char_clara", "char_player").roles ?? []).length === 0,
    getEdge(es, "char_clara", "char_player").roles);
}
{
  // real positions must survive, including the ones that sound harsh
  const es = edges();
  setRoles(es, ["landlord", "rival", "creditor", "ex-wife"]);
  const r = getEdge(es, "char_clara", "char_player").roles ?? [];
  check("a position somebody actually holds is kept", r.includes("landlord") && r.includes("creditor") && r.includes("ex-wife"), r);
  check("and 'rival' stays, because in a court or a trade it is a standing", r.includes("rival"), r);
}
{
  const es = edges();
  setRoles(es, ["husband", "beloved"]);
  check("warm roles are untouched", (getEdge(es, "char_clara", "char_player").roles ?? []).length === 2);
}

/* ── 2. the want and the wound are held together ─────────────────────────────── */
for (const lean of [false, true]) {
  const t = narratorSystem(lean);
  const tag = lean ? "lean" : "full";
  check(`${tag}: a want and a wound coexist`, /A WANT AND A WOUND AT THE SAME TIME/.test(t));
  check(`${tag}: the want is what they do, the wound is how`, /want is what they DO/.test(t));
  check(`${tag}: a rebuffed pursuer re-approaches rather than converting`,
    /(comes? back|come back)/.test(t) && /(cooler|oblique)/.test(t));
  check(`${tag}: and one refusal does not make an adversary`, /(convert|converts) a neighbour into an adversary/.test(t));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
