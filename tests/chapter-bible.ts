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
import { NEWSEASON_SYSTEM } from "../src/engine/prompts";

/** The merge api.newSeason performs. Mirrored here so the whitelist is pinned. */
const CHAPTER_FIELDS = ["name", "political_situation", "start_date"] as const;
function mergeChapterBible(prev: WorldBible, returned: any): WorldBible {
  const carried: Partial<WorldBible> = {};
  for (const f of CHAPTER_FIELDS) {
    const v = (returned ?? {})[f];
    if (typeof v !== "string" || !v.trim()) continue;
    if (f === "political_situation" && /\byou(r|rs|rself)?\b/i.test(v)) continue;
    (carried as any)[f] = v.trim();
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

/* 3. the requested fields all still work, and blanks do not wipe anything */
{
  const out = mergeChapterBible(base, {
    political_situation: "  ", what_people_fear: "", narrator_direction: "keep it quiet and small",
    start_date: "1187-04-02",
  });
  check("a blank does not erase the previous value", out.political_situation === "strained", out.political_situation);
  check("narrator_direction is no longer the model's to write", out.narrator_direction === undefined, out.narrator_direction);
  check("start_date carries", out.start_date === "1187-04-02");
  check("an absent world_bible entirely is survivable", mergeChapterBible(base, undefined).tone === "warm picaresque adventure");
}

/* 5. THE PLAYER'S STANDING DIRECTION IS THE PLAYER'S.
 *
 * `narrator_direction` was on the whitelist and is the same category as `tone`: a standing order
 * the narrator reads on every call. A player deleted theirs — it had acquired an editorial thesis
 * about their character that nobody asked for — branched the story, and got a regenerated one back
 * saying the same thing. Clearing a field is a choice. */
{
  const authored = { ...base, narrator_direction: "" } as WorldBible;
  const out = mergeChapterBible(authored, {
    political_situation: "The barons field open armies.",
    narrator_direction: "Rabi is lonely, lethal, and privately ruled by his hunger for women's bare feet — write him plainly, self-loathing and dangerous. The world answers him with fear.",
  });
  check("a direction the player deleted stays deleted", out.narrator_direction === "", out.narrator_direction);
  check("the world update still lands", out.political_situation === "The barons field open armies.");

  const kept = { ...base, narrator_direction: "Keep it light. No gore." } as WorldBible;
  const out2 = mergeChapterBible(kept, { narrator_direction: "Let the loneliness sit heavy." });
  check("a direction the player wrote is not overwritten", out2.narrator_direction === "Keep it light. No gore.", out2.narrator_direction);
}

/* 6. THE WORLD IS DESCRIBED, NOT ADDRESSED TO THE PLAYER.
 *
 * These two fields feed the narrator every turn as standing world-truth. One branch turned a plain
 * account of a succession crisis into "a crown held together by fear of YOU", and turned "hunger,
 * illness, death, typical of the medieval era" into "the God-Duke's mood. That a gift has a hidden
 * price." — which is a moral verdict on the player installed as a law of the world, and, in that
 * save, the reason every gift the player gave was met with a demand for payment. */
{
  const out = mergeChapterBible(base, {
    political_situation: "King Aldric's crown is a ruin held together by fear of you — the barons field open armies.",
    what_people_fear: "The God-Duke's mood. That a gift has a hidden price.",
  });
  check("a political situation written at the player is rejected", out.political_situation === "strained", out.political_situation);
  // No second person to catch here, and no reliable way to spot a verdict in code — so this field
  // simply stops being the chapter forge's to write. The player's own line stands.
  check("what people fear is not regenerated at all", out.what_people_fear === "the tax men", out.what_people_fear);

  const clean = mergeChapterBible(base, {
    political_situation: "The northern barons have gone from withholding tribute to raising their own levies; the succession is unsettled.",
  });
  check("an actual description of the world is carried", /northern barons/.test(clean.political_situation), clean.political_situation);
  check("'your' is caught as well as 'you'",
    mergeChapterBible(base, { political_situation: "The barons move against your holdings." }).political_situation === "strained");
  check("a word merely containing 'you' is not a false positive",
    /young/.test(mergeChapterBible(base, { political_situation: "The young king is dying of fever." }).political_situation));
}

/* 7. THE CHAPTER PROMPT'S CONTRACT.
 *
 * Everything that decides what a new chapter is ABOUT lives in this one string, so the clauses
 * that were added because a real chapter came out wrong are pinned here. Six threads came back
 * from one branch and five of them were the protagonist's interior — a god with nothing to do, a
 * wife waiting to be named, a congregation wanting something he hasn't got, a tithe ledger. The
 * threads spec at the time was `{"title":"","description":"","tension":3}` and nothing else: the
 * Forge has three paragraphs on what makes a thread and the chapter forge had none, so it summarised
 * the save's mood. With a protagonist nothing can threaten, that mood is emptiness. */
{
  const P = NEWSEASON_SYSTEM;
  check("a thread has to have somebody acting in it", /WHO IS ACTING/.test(P));
  check("a thread has to move without the player", /WHAT HAPPENS IF THE PLAYER NEVER TOUCHES IT/.test(P));
  check("a thread has to be actionable this week", /COULD THE PLAYER ACT ON IT THIS WEEK/.test(P));
  check("the interior-as-antagonist failure is named outright",
    /FORBIDDEN as threads: the player's boredom, emptiness/.test(P));
  check("and it says the pull is strongest exactly when the player is untouchable",
    /THE MORE POWERFUL THE PLAYER, THE STRONGER THE PULL TOWARD THIS FAILURE/.test(P));
  check("it says what to write instead", /A god has plenty to fight, and none of it is his feelings/.test(P));
  check("a chapter does not open as an epilogue", /opens as an epilogue/.test(P));

  check("the player's brief is declared binding", /THE PLAYER MAY DIRECT THIS CHAPTER/.test(P));
  check("the brief outranks the model's own reading", /it outranks your reading of the material/.test(P));
  check("the forbidden list still outranks the brief", /everything in this prompt except the forbidden list/.test(P));

  check("unsanitized is still demanded", /DO NOT SANITIZE/.test(P));
  check("and judging the player is refused separately", /EQUALLY CRITICAL — DO NOT JUDGE/.test(P));
  check("the settings the player owns are named as off-limits", /THE PLAYER'S OWN SETTINGS ARE NOT YOURS TO WRITE/.test(P));
  check("the forbidden list binds the recap too", /THE FORBIDDEN LIST BINDS THE NEW CHAPTER AND THE RECAP/.test(P));

  // the schema and the whitelist have to agree, or the model spends tokens on a field that is dropped
  check("the schema no longer asks for narrator_direction", !/"narrator_direction":/.test(P));
  check("the schema no longer asks for what_people_fear", !/"what_people_fear":/.test(P));
  for (const f of CHAPTER_FIELDS) {
    check(`the schema still asks for ${f}`, new RegExp(`"${f}"\\s*:`).test(P));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
