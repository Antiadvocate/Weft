/* Smoke test: A CHAPTER SUMMARY DOES NOT GET TO REWRITE THE STORY'S GENRE.
 *
 * Starting a new chapter merged whatever `world_bible` the model returned, unbounded — but the
 * schema asks for exactly five fields. A model that volunteered a sixth silently overwrote the
 * player's own setting with it, permanently and invisibly.
 *
 * The field that did the damage is `tone`. prompts.ts renders it at the top of every narrator call
 * as "GENRE — the register this whole story is written in". A model distilling a playthrough wrote
 * an editorial thesis about the protagonist into it —
 *
 *   "The world answers him with fear, never warmth. Power is rendered as empty, connection as
 *    impossible without transaction. Let the loneliness sit heavy."
 *
 * — and that became a standing order to the narrator for the rest of the game. It explains a great
 * deal of behavior that had been reported as broken: the world being uniformly cold, and an
 * innkeeper who would not sell a drink without making it a negotiation. */
import type { WorldBible } from "../src/engine/types";

/** The merge api.newSeason performs. Mirrored here so the whitelist is pinned. */
const CHAPTER_FIELDS = ["name", "political_situation", "what_people_fear", "narrator_direction", "start_date"] as const;
function mergeChapterBible(prev: WorldBible, returned: any): WorldBible {
  const carried: Partial<WorldBible> = {};
  for (const f of CHAPTER_FIELDS) {
    const v = (returned ?? {})[f];
    if (typeof v === "string" && v.trim()) (carried as any)[f] = v.trim();
  }
  return { ...prev, ...carried, name: carried.name || `${prev.name} — Next Chapter` };
}

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const base = {
  name: "Veridun", era: "medieval", technology_level: "iron", magic_rules: "rare",
  forbidden: "no gunpowder", what_people_fear: "the tax men", cultures_and_languages: "common",
  climate_and_geography: "temperate", calendar_and_currency: "standard", political_situation: "strained",
  tone: "warm picaresque adventure",
  god_mode: true,
  difficulty_profile: { lethality: "low", friction_density: "sparse", antagonist_aggression: "slow_burn", protagonist_competence: "hardened" },
  destination: "he finds somewhere to belong", destination_turns: 200,
} as unknown as WorldBible;

/* 1. the exact payload that overwrote the genre */
{
  const out = mergeChapterBible(base, {
    name: "Veridun — After the Burning",
    political_situation: "The barons are arming.",
    what_people_fear: "the duke",
    tone: "Dark, introspective, unsanitized. The world answers him with fear, never warmth. Power is rendered as empty, connection as impossible without transaction. Let the loneliness sit heavy.",
  });
  check("the player's genre survives the chapter", out.tone === "warm picaresque adventure", out.tone);
  check("what WAS asked for still lands", out.political_situation === "The barons are arming.");
  check("and the name updates", out.name === "Veridun — After the Burning");
}

/* 2. nothing else the model volunteers gets through either */
{
  const out = mergeChapterBible(base, {
    forbidden: "nothing is forbidden now",
    god_mode: false,
    difficulty_profile: { lethality: "high", friction_density: "dense", antagonist_aggression: "hostile", protagonist_competence: "soft" },
    destination: "he dies alone",
    destination_turns: 5,
    magic_rules: "magic is everywhere",
    era: "far future",
  });
  check("forbidden is the player's", out.forbidden === "no gunpowder", out.forbidden);
  check("god mode is not switched off under them", out.god_mode === true);
  check("the difficulty they chose stands", (out.difficulty_profile as any).lethality === "low");
  check("the destination is not rewritten", out.destination === "he finds somewhere to belong");
  check("nor its budget", out.destination_turns === 200);
  check("nor the world's own rules", out.magic_rules === "rare" && out.era === "medieval");
}

/* 3. the five requested fields all still work, and blanks do not wipe anything */
{
  const out = mergeChapterBible(base, {
    political_situation: "  ", what_people_fear: "", narrator_direction: "keep it quiet and small",
    start_date: "1187-04-02",
  });
  check("a blank does not erase the previous value", out.political_situation === "strained", out.political_situation);
  check("narrator_direction carries", out.narrator_direction === "keep it quiet and small");
  check("start_date carries", out.start_date === "1187-04-02");
  check("an absent world_bible entirely is survivable", mergeChapterBible(base, undefined).tone === "warm picaresque adventure");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
