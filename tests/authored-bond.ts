/* Smoke test: AUTHORED BONDS vs. the stranger's first read.
 *
 * seedAttraction models a stranger's nervous system at contact — intrinsic beauty, then personal
 * taste. Applied to a character whose own card already states the relationship (a wife, a lover,
 * someone written as obsessed with this person) it overwrites the authorship with a beauty score,
 * and the result is a partner seeded at zero desire who then, correctly and permanently, behaves
 * like someone who feels nothing.
 *
 * These cases pin the repair: authorship raises the floor, orientation still outranks it, an
 * unauthored acquaintance gets nothing for free, earned hostility is never laundered, and the
 * repair runs exactly once per edge so a real falling-out stays fallen. */
import { newSave, registerCharacter } from "../src/engine/state";
import { authoredPull, authoredRole, seedAttraction, repairAuthoredBonds, desireLine, tickDesire } from "../src/engine/desire";
import { bondStrength } from "../src/engine/social";
import { rememberPowerTier } from "../src/engine/pressure";
import type { SaveState } from "../src/engine/types";

function makeState(): SaveState {
  const state = newSave("bond-test", {
    name: "Test World", era: "now", technology_level: "modern", magic_rules: "none",
    forbidden: "", what_people_fear: "nothing", cultures_and_languages: "english",
    climate_and_geography: "mild", calendar_and_currency: "standard", political_situation: "stable",
  } as any);
  registerCharacter(state, { name: "Rabi", character_id: "char_player", age: 30, pronouns: "he/him" } as any);

  // the authored partner: her card says what she is to him, in three separate places
  const wife = registerCharacter(state, {
    name: "Andrea", age: 18, pronouns: "she/her", beauty: 95, attracted_to: "men",
    background: "Created by Rabi as his wife, embodying his exact qualities. She is his better half.",
    core_traits: ["Focused", "obsessed with rabi"],
    values: ["making rabi happy", "a world shaped by her and rabi"],
    taste: "Rabi's qualities — power, vision, decisiveness",
  } as any);
  // player-created, named in her own background, but oriented away from desire entirely
  const captain = registerCharacter(state, {
    name: "Angeline", age: 30, pronouns: "she/her", beauty: 40,
    attracted_to: "no one", taste: "No romantic or sexual attraction.",
    background: "Created by Rabi to serve as the city guard captain.",
  } as any);
  // an ordinary warm acquaintance — no authorship anywhere
  const cook = registerCharacter(state, {
    name: "Marta", age: 40, pronouns: "she/her", beauty: 55, attracted_to: "men", taste: "steady hands, a quiet voice",
    background: "Runs the kitchens. Grateful for the work.",
  } as any);
  // someone whose card names him without a shred of devotion: a rival, not a lover
  const rival = registerCharacter(state, {
    name: "Osric", age: 50, pronouns: "he/him", beauty: 50, attracted_to: "women",
    background: "Means to see Rabi broken and the duchy back in his own hands.",
    values: ["outliving Rabi"],
  } as any);

  state.world.present = ["char_player", wife, captain, cook, rival];
  (globalThis as any).__ids = { wife, captain, cook, rival };
  return state;
}

const ids = () => (globalThis as any).__ids;
const edge = (s: SaveState, a: string, b: string) => s.world.edges.find((e) => e.from === a && e.to === b);

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. the card is read: taste naming a person, with devotion vocabulary, is the strongest signal */
{
  const s = makeState();
  const { wife, captain, cook, rival } = ids();
  const P = s.characters["char_player"];
  check("authored wife: strong pull", authoredPull(s.characters[wife], P) === 65, authoredPull(s.characters[wife], P));
  check("authored wife: role extracted", authoredRole(s.characters[wife], P) === "wife", authoredRole(s.characters[wife], P));
  check("manufactured servant: no pull ('created by' alone is not devotion)", authoredPull(s.characters[captain], P) === 0);
  check("unrelated acquaintance: no pull", authoredPull(s.characters[cook], P) === 0);
  check("named without devotion (a rival): no pull", authoredPull(s.characters[rival], P) === 0, authoredPull(s.characters[rival], P));
}

/* 2. seeding honors authorship — and orientation still outranks it absolutely */
{
  const s = makeState();
  const { wife, captain, cook } = ids();
  seedAttraction(s, wife, "char_player");
  seedAttraction(s, captain, "char_player");
  seedAttraction(s, cook, "char_player");
  check("wife seeds at the authored floor", (edge(s, wife, "char_player")!.attraction ?? 0) >= 65, edge(s, wife, "char_player")!.attraction);
  check("wife's base lifts too (no companionate ceiling)", (edge(s, wife, "char_player")!.attraction_base ?? 0) >= 65);
  check("'attracted to no one' stays at zero despite being player-made", edge(s, captain, "char_player")!.attraction === 0);
  check("acquaintance keeps the ordinary stranger read", (edge(s, cook, "char_player")!.attraction ?? 99) < 40, edge(s, cook, "char_player")!.attraction);
}

/* 3. the repair pass rescues saves seeded before authorship was consulted */
{
  const s = makeState();
  const { wife, cook } = ids();
  // the shape the bug leaves behind: warm, long-established, and recorded as wanting nothing
  s.world.edges.push({ from: wife, to: "char_player", warmth: 33, trust: 14, power: 0, notes: "", updated_turn: 100, attraction: 3.6, attraction_base: 0 });
  s.world.edges.push({ from: cook, to: "char_player", warmth: 14, trust: 6, power: 0, notes: "", updated_turn: 100, attraction: 0, attraction_base: 0 });
  const shifts = repairAuthoredBonds(s);
  check("repair fires for the authored partner", shifts.length === 1, shifts);
  check("repair raises attraction to the floor", edge(s, wife, "char_player")!.attraction === 65, edge(s, wife, "char_player")!.attraction);
  check("repair stamps the stated role on the edge", (edge(s, wife, "char_player")!.roles ?? []).includes("wife"));
  check("repair leaves the unauthored acquaintance alone", edge(s, cook, "char_player")!.attraction === 0);
  check("repair is idempotent", repairAuthoredBonds(s).length === 0);

  // and it is one-way: a couple who genuinely fall apart stay apart
  edge(s, wife, "char_player")!.attraction = 5;
  repairAuthoredBonds(s);
  check("a real falling-out is not re-inflated", edge(s, wife, "char_player")!.attraction === 5, edge(s, wife, "char_player")!.attraction);
}

/* 4. a low number is not an absent bond — the narrator is never told a partner feels nothing */
{
  const s = makeState();
  const { wife, cook } = ids();
  s.world.edges.push({ from: wife, to: "char_player", warmth: 33, trust: 14, power: 0, notes: "", updated_turn: 100, attraction: 3.6, attraction_base: 0, roles: ["wife"] });
  s.world.edges.push({ from: cook, to: "char_player", warmth: 4, trust: 2, power: 0, notes: "", updated_turn: 100, attraction: 2, attraction_base: 2 });
  const partner = desireLine(s, wife), stranger = desireLine(s, cook);
  check("established bond is never rendered as 'desire: none'", !/desire toward you: none/.test(partner), partner);
  check("established bond forbids the wall reading", /NEVER write them as indifferent/.test(partner));
  check("an actual stranger still gets the honest 'none'", /desire toward you: none/.test(stranger), stranger);
}

/* 5. warmth earns desire on a ramp, not at a cliff — warmth 33 used to be frozen forever */
{
  const s = makeState();
  const { wife } = ids();
  s.world.edges.push({ from: wife, to: "char_player", warmth: 33, trust: 14, power: 0, notes: "", updated_turn: 100, attraction: 10, attraction_base: 10 });
  s.world.present = ["char_player", wife];
  const before = edge(s, wife, "char_player")!.attraction!;
  for (let i = 0; i < 5; i++) tickDesire(s);
  check("warmth just under the old gate now drifts", edge(s, wife, "char_player")!.attraction! > before, edge(s, wife, "char_player")!.attraction);
}

/* 6. bondStrength: warm-but-guarded is a bond; a stated role counts for itself */
{
  const guarded = { warmth: 33, trust: 14, roles: [] as string[] };
  const withRole = { warmth: 33, trust: 14, roles: ["wife"] };
  const hostile = { warmth: -17, trust: -17, roles: [] as string[] };
  check("warmth carries more than trust", bondStrength(guarded) > (33 + 14) / 2, bondStrength(guarded));
  check("a stated bond clears the witness gate", bondStrength(withRole) >= 25, bondStrength(withRole));
  check("hostility is still hostility", bondStrength(hostile) <= -15, bondStrength(hostile));
}

/* 7. the world remembers a power it has witnessed, and forgets it a rung at a time */
{
  let mem: any = undefined;
  const step = (seen: any, turn: number) => { const r = rememberPowerTier(seen, mem, turn); mem = r.memory; return r.tier; };
  check("witnessed tier holds the turn it is seen", step("cosmic", 10) === "cosmic");
  check("holds through quiet turns", step("mortal", 30) === "cosmic");
  check("decays one rung, not to nothing", step("mortal", 60) === "mythic");
  check("keeps decaying", step("mortal", 95) === "empowered");
  check("eventually forgotten", step("mortal", 140) === "mortal");
  let none: any = undefined;
  check("an ordinary story stores nothing", rememberPowerTier("mortal", none, 5).memory === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
