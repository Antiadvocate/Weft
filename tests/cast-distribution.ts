/* Smoke test: EVERY WOMAN COMES OUT DAMAGED AND UNAVAILABLE.
 *
 * "Any game where a girl is in a position to actually care for me, the best thing it does is
 * 'I need freedom immediately' → multiple resilience traits instantly → avoidant personality
 * instantly."
 *
 * Counted across three of that player's saves, every NPC the forge produced:
 *
 *     avoidant       7
 *     anxious        4
 *     disorganized   1
 *     secure         2
 *
 * Twelve of fourteen insecure, half of them avoidant. Secure attachment is roughly half to two
 * thirds of any real population; here it is one in seven. Alongside it, two characters carried
 * attracted_to: "no one — currently too raw and survival-focused", which the engine reads as a
 * permanent hard cap of zero desire.
 *
 * Neither field had any guidance. attachment offered four options and said nothing about which is
 * ordinary, and a model writing "interesting" people reaches for damage every time — insecure reads
 * as depth and is in fact the fastest way to make a cast identical, because every one of them then
 * handles closeness by managing it. attracted_to listed four values without saying the engine treats
 * one of them as irreversible.
 *
 * This is a prompt fix and it cannot be asserted on outcomes without spending money on the forge,
 * so what is pinned here is that the guidance exists everywhere the fields are defined — the failure
 * before was that nothing said anything at all, in any of the four places.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const prompts = readFileSync("src/engine/prompts.ts", "utf8");
const sketch = readFileSync("src/engine/sketch.ts", "utf8");

/* ── 1. every definition of the attachment field says what is ordinary ────────── */
{
  const defs = [...prompts.matchAll(/"(?:attachment_style|style)":"secure \/ anxious \/ avoidant \/ disorganized([^"]*)"/g)]
    .map((m) => m[1]);
  check("both definitions in prompts.ts were found", defs.length === 2, defs.length);
  check("each one states that most people are secure",
    defs.every((d) => /most people are secure/i.test(d)), defs);
  const full = defs.find((d) => d.length > 200) ?? "";
  check("and says why a cast without it goes wrong", /every relationship in the story becomes a repair job/.test(full), full.slice(0, 120));
  check("and names avoidant as the over-reached one", /Avoidant in particular is over-reached for/.test(full), full.slice(0, 120));

  const sk = /"attachment_style": "secure \/ anxious \/ avoidant \/ disorganized([^"]*)"/.exec(sketch)?.[1] ?? "";
  check("the sketch pass says it too", /most people are secure/i.test(sk), sk);
}

/* ── 2. every definition of attracted_to says the gate is permanent ───────────── */
{
  const defs = [
    ...[...prompts.matchAll(/"attracted_to":"women \/ men \/ anyone \/ no one([^"]*)"/g)].map((m) => m[1]),
    /"attracted_to": "women \/ men \/ anyone \/ no one([^"]*)"/.exec(sketch)?.[1] ?? "",
  ];
  check("all three definitions were found", defs.length === 3 && defs.every(Boolean), defs.length);
  check("each says the field is permanent", defs.every((d) => /permanent/i.test(d)), defs);
  check("each says a mood does not belong in it",
    defs.every((d) => /do not qualify (?:it|this field) with a mood/i.test(d)), defs);
  const full = defs.find((d) => d.length > 300) ?? "";
  check("and the full one sends unavailability somewhere it can lift",
    /belongs in under_threat, in taste, or in what they want/.test(full), full.slice(0, 160));
  check("...naming the exact shape that broke a save", /too raw/.test(full), full.slice(0, 200));
}

/* ── 3. and it did not smuggle in a quotable line ─────────────────────────────
 *
 * Adding a rule with a ready-made example attached is the failure prompt-echo.ts exists for, and
 * its ratchet counts the whole file — so the assertion lives there, at a budget these edits did not
 * move. Nothing to duplicate here. */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
