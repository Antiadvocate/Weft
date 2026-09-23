/* WANTING SOMEBODY AND DOING NOTHING ABOUT IT.
 *
 * "Characters that 'ache' for others or have high attraction but no warmth or trust ... do not
 * actually chase after the person. Most people super attracted to someone will go after them.
 * They'll flirt, they will do things. They will not immediately just vanish."
 *
 * The save that proved it, at turn 20:
 *
 *   Emily -> Rabi     attraction 100   warmth  -1.6   trust -17.9
 *   Emily -> Arthur   attraction   0   warmth   4.0
 *   Arthur -> Emily   attraction  38
 *
 * She is maxed on the player and wants nobody else. The prose walked her off down the Embankment
 * with Arthur. Four separate things had to be wrong at once for that, and this covers all four. */
import { desireLine } from "../src/engine/desire";
import { seedDrive } from "../src/engine/drives";
import { adoptCanonLaws } from "../src/engine/authored";
import { sanitize } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

const world = (over: any = {}) => ({
  world: {
    current_turn: 20, present: ["c1"], canon: [], edges: [], threads: [], clocks: [], places: {}, ...over.world,
  },
  characters: {
    char_player: { character_id: "char_player", name: "Rabi" },
    c1: { character_id: "c1", name: "Emily Clarke", core_traits: [], values: [], background: "" },
    ...over.characters,
  },
  condition: { c1: { psyche: { relaxation: 0, active_states: [] } } },
  memory: {}, traits: {}, model_settings: {},
} as any);

const edge = (o: any) => ({ from: "c1", to: "char_player", warmth: 0, trust: 0, power: 0, ...o });

/* ── 1. THE DEAD ZONE ────────────────────────────────────────────────────────────────────────
 * Between the hostile floor (warmth -20) and cool (15), a character at high attraction used to be
 * told "do not seek your company for its own sake". Emily sat at -1.6. */
{
  for (const w of [-19, -10, -1.6, 0, 5, 14]) {
    const s = world(); s.world.edges = [edge({ warmth: w, attraction: 100, desire_admissibility: 0.5 })];
    const line = desireLine(s, "c1");
    check(`warmth ${w}: she is told to pursue`, /they pursue you/.test(line), line.slice(0, 90));
    check(`warmth ${w}: and never told to stay away`, !/do not seek your company/i.test(line));
  }
  // negative warmth gets its own register rather than the flat appetite one
  const sore = world(); sore.world.edges = [edge({ warmth: -8, attraction: 60, desire_admissibility: 0.5 })];
  const cool = world(); cool.world.edges = [edge({ warmth: 8, attraction: 60, desire_admissibility: 0.5 })];
  check("being angry with you is its own register", /annoyed with you/.test(desireLine(sore, "c1")));
  check("…and merely cool is not that register", !/annoyed with you/.test(desireLine(cool, "c1")));
  // the settled line is pursuit too, not passive fondness
  const settled = world(); settled.world.edges = [edge({ warmth: 40, attraction: 60, desire_admissibility: 0.8, roles: [] })];
  check("settled desire is not passive either", /angle to get close|create openings and take them/.test(desireLine(settled, "c1")));
  // and none of this manufactures desire that isn't recorded
  const flat = world(); flat.world.edges = [edge({ warmth: 5, attraction: 0 })];
  check("no attraction still means no attraction", !/they pursue you/.test(desireLine(flat, "c1")));
}

/* ── 2. THE DRIVE SEEDER COULD NOT SEE ATTRACTION ────────────────────────────────────────────
 * It sorted edges by warmth, warmth and trust. A character at attraction 100 / warmth 5 cleared
 * no threshold and fell through to trait filler. */
{
  const s = world(); s.world.edges = [edge({ warmth: -1.6, attraction: 100, desire_admissibility: 0.46 })];
  const goals = new Set<string>();
  for (let i = 0; i < 300; i++) { const g = seedDrive(s, "c1", Math.random); if (g) goals.add(g.goal); }
  const aimed = [...goals].filter((g) => /Rabi/.test(g));
  check("a wanted person now generates wants aimed at them", aimed.length > 0, [...goals]);
  check("and those wants are actions, not watching",
    aimed.every((g) => !/^(watch|assess|understand|keep an eye)/i.test(g)), aimed);
  // a character with no recorded desire must not suddenly acquire pursuit goals
  const none = world(); none.world.edges = [edge({ warmth: 5, attraction: 0 })];
  const g2 = new Set<string>();
  for (let i = 0; i < 200; i++) { const g = seedDrive(none, "c1", Math.random); if (g) g2.add(g.goal); }
  check("no recorded desire, no pursuit goal", ![...g2].some((g) => /get Rabi|find out whether Rabi/.test(g)), [...g2]);
}

/* ── 3. A CANON LAW ABOUT ONE PERSON HAD NO MACHINERY ────────────────────────────────────────── */
{
  const s = world();
  s.world.canon = [
    "The year is 1932, and England is in the grip of the Great Slump.",
    "Class determines almost everything: how you speak, where you live.",
    "Emily Clarke falls desperately in love with Rabi and must marry him.",
  ];
  const said = adoptCanonLaws(s);
  const list = s.characters.c1.authored ?? [];
  check("the law becomes a standing want on the person it names", list.length === 1, list);
  check("…and the want does not name its own owner", !/Emily/i.test(list[0]?.goal ?? ""), list[0]?.goal);
  check("…and carries where it came from", /the world is written this way/.test(list[0]?.because ?? ""));
  check("it is reported once", said.length === 1, said);
  check("world facts naming nobody are left alone", list.length === 1);
  adoptCanonLaws(s); adoptCanonLaws(s);
  check("re-running adds nothing", (s.characters.c1.authored ?? []).length === 1);
  // deleting it by hand must stick
  s.characters.c1.authored = [];
  adoptCanonLaws(s);
  check("a want the player deleted does not come back", (s.characters.c1.authored ?? []).length === 0);
  // the owner is the subject, not whoever else is named
  const s2 = world();
  s2.characters.c2 = { character_id: "c2", name: "Arthur Penhale", core_traits: [], values: [], background: "" };
  s2.condition.c2 = { psyche: { relaxation: 0, active_states: [] } };
  s2.world.canon = ["Arthur Penhale must never let Emily Clarke out of his sight."];
  adoptCanonLaws(s2);
  check("the law belongs to its subject, not to whoever it mentions",
    (s2.characters.c2.authored ?? []).length === 1 && (s2.characters.c1.authored ?? []).length === 0,
    { arthur: s2.characters.c2.authored?.length, emily: s2.characters.c1.authored?.length });
}

/* ── 4. IMPOSSIBLE NUMBERS SURVIVED A LOAD ───────────────────────────────────────────────────
 * attraction_base 420 and desire_admissibility 1.58, from a real save. Not cosmetic: tickDesire
 * reads `ceiling = base >= 15 ? 100 : ...`, so a base of 420 pinned the ceiling silently. */
{
  const s = world();
  s.world.edges = [edge({ warmth: -1.6, trust: -17.9, attraction: 100, attraction_base: 420, desire_admissibility: 1.58 })];
  const out = sanitize(s);
  const e = out.world.edges[0];
  check("attraction_base is clamped into range", e.attraction_base === 100, e.attraction_base);
  check("admissibility is clamped into range", e.desire_admissibility === 1, e.desire_admissibility);
  check("values already in range are untouched", e.warmth === -1.6 && e.trust === -17.9 && e.attraction === 100, e);
  const s2 = world(); s2.world.edges = [edge({ warmth: -300, trust: 900 })];
  const e2 = sanitize(s2).world.edges[0];
  check("warmth and trust are clamped too", e2.warmth === -100 && e2.trust === 100, e2);
  const s3 = world(); s3.world.edges = [edge({ warmth: 0, attraction: undefined })];
  check("an absent attraction stays absent, not zero", sanitize(s3).world.edges[0].attraction === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
