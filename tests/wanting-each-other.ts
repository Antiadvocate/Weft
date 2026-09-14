/* "CAN PEOPLE CHEAT ON THE PLAYER? OR CAN THEY BE POLY, OR LESBIAN OR GAY?"
 *
 * The engine's answer was yes in the state and no on the page.
 *
 * WHAT WAS ALREADY THERE. Orientations are real and are not all straight — across the casts in
 * eleven saves, 27 "women", 11 "men", 5 "anyone" — and orientationCap gates desire by them.
 * seedAttraction runs for every pair that shares a scene, not just pairs involving the player, so
 * NPC-to-NPC desire is seeded and drifts like any other. Fifty such edges exist in those saves,
 * nineteen at attraction 30 or above: Olga toward Emily at 54, Ames at 53, Bert at 54, Betty at 49.
 * tickRivalry already makes people jealous over a shared target. Nothing anywhere enforces
 * exclusivity, so nothing forbids poly or forbids cheating.
 *
 * WHAT MADE ALL OF IT INVISIBLE. One line in the present block is the only place the narrator
 * learns how one person in the room feels about another, and it rendered warmth and trust and
 * nothing else. Attraction was not shown, and it was not even a reason to show the line: the filter
 * asked for |warmth| > 15, |trust| > 15, or a named role. Olga wanting Emily at 54 with warmth 0,
 * trust 0 and no role between them failed every clause and the line never appeared.
 *
 * So the cast could not cheat, could not want each other, and could not be jealous over anybody but
 * the player — not because the engine forbade it, but because it never mentioned it. */
import { volatileDigest } from "../src/engine/prompts";
import { orientationCap } from "../src/engine/desire";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
function scene(edge: { warmth: number; trust: number; attraction?: number; roles?: string[] }): { s: SaveState; lateral: string } {
  const s: any = newSave("poly", { name: "England", era: "1932", technology_level: "interwar", magic_rules: "none",
    forbidden: "", what_people_fear: "the means test", cultures_and_languages: "english",
    climate_and_geography: "wet", calendar_and_currency: "sterling", political_situation: "the slump" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const olga = registerCharacter(s, { name: "Olga Reiter", age: 34, attracted_to: "women" } as any);
  const emily = registerCharacter(s, { name: "Emily Clarke", age: 19, attracted_to: "men" } as any);
  s.world.present = [olga, emily];
  s.world.edges.push({ from: olga, to: emily, ...edge, roles: edge.roles ?? [] });
  const line = volatileDigest(s, "").split("\n").find((l: string) => /toward others here/.test(l)) ?? "";
  return { s, lateral: line.trim() };
}

/* ── DESIRE BETWEEN TWO NPCS NOW REACHES THE PAGE ───────────────────────────────────────────── */
{
  const { lateral } = scene({ warmth: 0, trust: 0, attraction: 54 });
  check("a woman wanting another woman is rendered at all", lateral.length > 0, lateral);
  check("…naming who", /Emily Clarke/.test(lateral), lateral);
  check("…and that she wants her", /wants them|aches for them|drawn to them/.test(lateral), lateral);
}
check("indifference between two people stays unmentioned", scene({ warmth: 0, trust: 0, attraction: 5 }).lateral === "");
check("a strong feeling that is not desire still shows, as before",
  /w40/.test(scene({ warmth: 40, trust: 20 }).lateral));
check("a named role still shows, as before", /wife/.test(scene({ warmth: 0, trust: 0, roles: ["wife"] }).lateral));
/* THE THRESHOLD MATCHES THE ONE THE REST OF THE MODULE USES — 30 is where desire.ts starts calling
 * a pull real, and a mild noticing is not something the room should be told about. */
check("mild interest is below the line", scene({ warmth: 0, trust: 0, attraction: 25 }).lateral === "");
check("real desire is above it", scene({ warmth: 0, trust: 0, attraction: 35 }).lateral !== "");

/* ── AND THE ORIENTATION GATE IS REAL, IN BOTH DIRECTIONS ───────────────────────────────────── */
{
  const woman = { name: "Olga", pronouns: "she/her", attracted_to: "women" } as never;
  const man = { name: "Bert", pronouns: "he/him", attracted_to: "women" } as never;
  const anyone = { name: "Ames", pronouns: "they/them", attracted_to: "anyone" } as never;
  const nobody = { name: "Betty", pronouns: "she/her", attracted_to: "no one" } as never;
  const emily = { name: "Emily", pronouns: "she/her" } as never;
  check("a woman who likes women is not capped toward a woman", orientationCap(woman, emily) === null);
  check("a man who likes women is not capped toward a woman", orientationCap(man, emily) === null);
  check("somebody who likes anyone is never capped", orientationCap(anyone, emily) === null);
  check("and 'no one' is a hard gate", (orientationCap(nobody, emily) ?? 99) <= 5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
