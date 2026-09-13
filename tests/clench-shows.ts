/* THE PSYCHE LAYER WAS ONE CLAUSE LONG.
 *
 * relaxation, capacity, recovery, consecutive_clenched, grief_drag, four break states, a resting
 * climate, per-state ages — the most developed system in the engine, and what reached the narrator
 * was the tail of a line: "misreads as threat" against "receiving, not assessing".
 *
 * Measured by rendering ONE identical scene at relaxation -8, -4, 0, +4 and +8 and diffing the
 * character block: four lines moved, two of them the mood word repeating. bodyDirective had already
 * learned this for the body and says it at length, because a state that does not change the
 * sentences does not exist on the page. The mind had no equivalent.
 *
 * And the missing piece was the one the player named: "the reaction or reactivity or clenching with
 * misinterpreting needs to be better shown". "Misreads as threat" is a note about somebody's inner
 * life. The renderable version is that they ANSWER A SENTENCE THAT WAS NOT SAID, and the person
 * opposite can hear the gap. Prose can do that. It cannot do "she misreads it as a threat" except
 * by asserting it. */
import { clenchDirective } from "../src/engine/clench";
import type { Condition } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const at = (relaxation: number, state = "intact") =>
  ({ psyche: { relaxation, state, mood: "", active_states: [] } } as unknown as Condition);

/* ── THE ORDINARY BAND COSTS NOTHING ────────────────────────────────────────────────────────
 * Most people, most turns. A paragraph asserting that somebody is unremarkable is budget spent to
 * say nothing, and it would drown the characters who ARE somewhere. */
for (const r of [-2, -1, 0, 1, 2]) check(`ordinary at ${r}: silent`, clenchDirective(at(r), "Olga") === "");
check("no condition, nothing said", clenchDirective(undefined, "Olga") === "");

/* ── AND EVERY OTHER BAND SAYS SOMETHING DIFFERENT ─────────────────────────────────────────── */
const bands = [-9, -8, -4, -3, 3, 5, 7, 9].map((r) => clenchDirective(at(r), "Olga"));
check("every off-neutral band produces a directive", bands.every((b) => b.length > 200), bands.map((b) => b.length));
// The exact number is interpolated, so strip it before counting distinct bands — the degree
// varying inside a band is wanted, four bands of BEHAVIOUR is the claim.
check("…and they collapse to exactly four bands of behaviour",
  new Set(bands.map((b) => b.replace(/-?\d+/g, "N"))).size === 4,
  [...new Set(bands.map((b) => b.replace(/-?\d+/g, "N")))].length);
check("…each one names the person", bands.every((b) => b.includes("OLGA")));
check("…and prints the actual number, so the narrator can see the degree",
  clenchDirective(at(-8), "Olga").includes("-8"));

/* ── THE MISREADING, WHICH IS THE WHOLE POINT ─────────────────────────────────────────────── */
{
  const hard = clenchDirective(at(-8), "Olga");
  check("badly clenched: they answer a sentence nobody said", /answer THAT/.test(hard), hard.slice(0, 200));
  check("…a question arrives as an accusation", /question lands as an accusation/.test(hard));
  check("…kindness arrives as a setup", /[Kk]indness lands as setup/.test(hard));
  check("…and they hold it after being corrected", /do not take it the first time|hold the misread/.test(hard));
  /* THE GUARDRAIL. A misreading the words cannot support is not fear, it is the narrator writing
   * somebody insane — and this engine has form for turning a state into a caricature. */
  check("…but the misread must be available in the actual words",
    /a reading a reasonable person could get from the actual words/.test(hard), hard);
  check("…and they never narrate their own fear", /[Dd]o not have them explain any of this|name their own fear/.test(hard));
  const mid = clenchDirective(at(-4), "Olga");
  check("merely clenched: the same move, weaker", /second-worst reading/.test(mid), mid);
  check("…and they can be talked off it, which the worse band cannot", /CAN be talked off it/.test(mid));
}

/* ── OPENNESS IS NOT A REWARD, IT IS A DIFFERENT EXPOSURE ─────────────────────────────────── */
{
  const open = clenchDirective(at(9), "Olga");
  check("wide open: they answer what they would normally deflect", /would ordinarily deflect/.test(open), open);
  check("…and being worked actually works on them", /if somebody is working them, it works/.test(open));
  check("…and it is not flagged for the reader", /nothing in the prose flags it/.test(open));
  check("…and they still do not read the room out loud", /no read delivered out loud/.test(open));
  const settling = clenchDirective(at(5), "Olga");
  check("settling: they let a sentence finish", /let a sentence finish/.test(settling));
  check("…and volunteer something unasked-for that is not a confession",
    /not a confession and not a lesson/.test(settling));
}

/* ── A SPENT GUARD IS ITS OWN STATE ON TOP ─────────────────────────────────────────────────── */
{
  const spent = clenchDirective(at(-8, "shattered"), "Olga");
  check("a broken guard adds the thing that gets through", /arrives instead of being deflected/.test(spent), spent);
  check("…and an intact one does not", !/arrives instead of being deflected/.test(clenchDirective(at(-8), "Olga")));
}

/* ── THE RATCHET ────────────────────────────────────────────────────────────────────────────
 * Before this existed, the whole difference between cornered and unguarded was the tail of the
 * `seeing:` line — 65 characters at the clenched end. If that is ever true again, this fails. */
for (const r of [-8, -4, 4, 8])
  check(`relaxation ${r} carries real weight`, clenchDirective(at(r), "Olga").length >= 400,
    clenchDirective(at(r), "Olga").length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
