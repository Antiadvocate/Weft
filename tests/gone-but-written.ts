/* THE LEDGER SAID DEAD AND THE DIGEST SAID SHE LIVES THREE BLOCKS AWAY.
 *
 * "Mara is not entered but narrator keeps putting her into the prose again. And again. And again."
 *
 * Turn 81, and every ledger fix is working: Mara is status "dead", at loc_offscene, absent from
 * world.present, never registered again. And the narrator went on writing her — in the middle of a
 * quiet scene with somebody else entirely, in a world the player had made from nothing:
 *
 *     Mara, torn and cut, one arm held tight against her ribs, her feet finding the packed ground
 *     like she had walked a long way.
 *
 * Fourteen mentions of her in the anchor the narrator was reading, and not one of them saying she is
 * dead. What it DID say:
 *
 *   - Mara's House — The small bungalow three blocks away where Mara lives with her son and her dog,
 *     Biscuit. — ordinarily a handful of people about: Mara, her teenage son, and Biscuit
 *   - Rabi and Emily's House — ... ordinarily a handful of people about: Rabi and Emily, and
 *     occasionally Mara or Priya visiting
 *
 * plus two chapter summaries with her in them, a present character's memory of watching her arm
 * opened, and eight replayed beats.
 *
 * THE FILTER THAT DROPS THE DEAD FROM THE CAST IS WHY. It is correct and it is the whole bug: it
 * removes the one line that could have said she is dead and puts nothing in its place, while five
 * other parts of the same document go on describing a world she lives in. This engine states the
 * doctrine itself, in its negative-canon field: "Absence cannot be inferred from description ... So
 * state it outright." Dropping somebody from a list states nothing at all.
 *
 * And `population.who` is static text written at world creation and never revised, so a place goes
 * on naming the people ordinarily found there long after the story has buried them. That is not
 * background colour; it is an instruction about who you meet at that address.
 */
import { populationLine } from "../src/engine/population";
import { stablePrefix } from "../src/engine/prompts";
import type { SaveState, Place } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const F = JSON.parse(readFileSync("tests/fixtures/gone-but-written.json", "utf8"));
const state = () => ({
  characters: JSON.parse(JSON.stringify(F.characters)),
  world: { places: JSON.parse(JSON.stringify(F.places)), present: [], current_turn: F.current_turn, canon: [], edges: [], threads: [], clocks: [], consequences: [], rumors: [], norms: [], player_location: "loc_mtggvs9r4vmyf", current_time: "Day 3, 09:00", weather: "overcast" },
  world_bible: { name: "Seattle", era: "now", tone: "Love, romance", difficulty_profile: {} },
  condition: {}, traits: {}, memory: {}, minds: {}, history: [], model_settings: {}, records: [], habits: [], chapters: [],
} as unknown as SaveState);
const gone = Object.values(F.characters).filter((c: any) => c.name && (c.status === "dead" || c.status === "departed")).map((c: any) => c.name);

/* ── 1. the state was right and the page was wrong ───────────────────────────── */
{
  const mara = Object.values(F.characters).find((c: any) => c.name === "Mara") as any;
  check("the ledger has her dead", mara.status === "dead");
  check("...and offscene", mara.location === "loc_offscene");
  check("...and she was never re-registered", Object.values(F.characters).filter((c: any) => c.name === "Mara").length === 1);
  check("AND SHE IS IN THE PROSE ANYWAY", /\bMara\b/.test(F.mara_in_prose), F.mara_in_prose.slice(-160));
  check("the anchor the narrator read was 28 turns stale", F.current_turn - F.anchor_turn >= 25, { anchor: F.anchor_turn, now: F.current_turn });
}

/* ── 2. the digest now says it outright ──────────────────────────────────────── */
{
  const d = stablePrefix(state());
  check("there is a block for the ones who are gone", /WHO IS NO LONGER IN THIS STORY \(ABSOLUTE\)/.test(d));
  check("...naming her", /Mara — DEAD/.test(d));
  check("...distinguishing dead from merely gone", /Priya — GONE FROM THIS STORY/.test(d));
  check("...and refusing the doorway specifically", /Not in a doorway, not at the edge of a scene/.test(d));
  check("...naming the trap: the rest of the document still describes their world",
    /that is the record of a world that HAD them/.test(d));
  check("...while leaving grief and memory available", /The living may still think of them, grieve them/.test(d));
  check("...with a physical test rather than a vibe", /is ever the subject of a verb that happens in the present scene/.test(d));
  check("the block sits high, before the world bible", d.indexOf("WHO IS NO LONGER") < d.indexOf("=== WORLD BIBLE"));
  check("she is still off the cast list", !/^Mara \[/m.test(d));

  // A story that has lost nobody carries no block at all.
  const clean = state();
  for (const c of Object.values(clean.characters)) (c as { status?: string }).status = undefined;
  check("a story with no dead carries no block", !/WHO IS NO LONGER IN THIS STORY/.test(stablePrefix(clean)));
}

/* ── 3. and the places stop listing them ─────────────────────────────────────── */
{
  const P = (name: string) => Object.values(F.places).find((p: any) => p.name === name) as Place;
  const line = (name: string) => populationLine(P(name), gone);

  check("Mara is no longer ordinarily at her own house", !/\bMara\b/.test(line("Mara's House")), line("Mara's House"));
  check("...and her son and dog still are", /teenage son/.test(line("Mara's House")) && /Biscuit/.test(line("Mara's House")));
  check("she is no longer visiting the player's house", !/\bMara\b/.test(line("Rabi and Emily's House")), line("Rabi and Emily's House"));
  check("...and the people who live there still live there", /Rabi and Emily/.test(line("Rabi and Emily's House")));
  check("Dev is off the substation", !/\bDev\b/.test(line("The Substation on Delridge")), line("The Substation on Delridge"));
  check("...and the crew is not evicted with him", /Utility workers/.test(line("The Substation on Delridge")));

  // THE POSSESSIVE IS SOMEBODY ELSE'S ADDRESS. "Priya's parents and their regular customers" is two
  // sets of living people located by a dead woman's name; the first pass emptied a working grocery.
  const grocery = line("The Central District Grocery");
  check("a possessive does not empty a shop", /regular customers/.test(grocery), grocery);
  check("...and the parents keep their name on it", /Priya's parents/.test(grocery), grocery);

  // Untouched places are untouched.
  check("a place naming nobody gone is unchanged",
    populationLine(P("Seward Park"), gone) === populationLine(P("Seward Park")));
  check("and with nobody gone at all, nothing changes",
    Object.values(F.places).every((p: any) => populationLine(p, []) === populationLine(p)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
