/* Smoke test: WHAT HAPPENS BETWEEN OTHER PEOPLE WHILE THE PLAYER IS ELSEWHERE.
 *
 * Numbers moved offstage and never arrived anywhere: two people at mutual attraction 70 for a season
 * were never together, a marriage at warmth −40 was still a marriage, because a role only changed
 * when the bookkeeper wrote it and the bookkeeper only reads scenes. Life events (after Neighborly's
 * precondition + consideration events) let the numbers arrive — never for the player, never in the
 * player's scene, scaled by in-world time. */
import { lifeCandidates, runLifeEvents } from "../src/engine/lifeevents";
import { simulateForward } from "../src/engine/continuity";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const e = (from: string, to: string, o: any = {}) => ({ from, to, warmth: 0, trust: 0, power: 0, notes: "", updated_turn: 1, ...o });
const world = (edges: any[], o: any = {}) => ({
  world: { current_turn: 20, current_time: "Day 3, 10:00 (Morning)", present: ["char_player"], edges, rumors: [], places: { loc_mill: { id: "loc_mill", name: "The Mill" } },
    threads: [], clocks: [], consequences: [], canon: [], offstage_log: [], ...o },
  characters: {
    char_player: { character_id: "char_player", name: "Joe Arden", location: "loc_road" },
    char_mara: { character_id: "char_mara", name: "Mara Quill", location: "loc_mill" },
    char_ossian: { character_id: "char_ossian", name: "Ossian Hale", location: "loc_mill" },
    char_di: { character_id: "char_di", name: "Di Stroud", location: "loc_mill" },
  },
  memory: { char_mara: { episodic: [] }, char_ossian: { episodic: [] }, char_di: { episodic: [] }, char_player: { episodic: [] } },
  condition: {}, traits: {},
} as any);
const kinds = (s: any) => lifeCandidates(s).map((c) => `${c.kind}:${c.a}:${c.b}`);
const always = () => 0;

/* ── 1. preconditions ────────────────────────────────────────────────────────── */
{
  const s = world([e("char_mara", "char_ossian", { attraction: 70, warmth: 40, trust: 20 }), e("char_ossian", "char_mara", { attraction: 60, warmth: 35 })]);
  check("mutual attraction and warmth, neither attached: they can get together", kinds(s).includes("together:char_mara:char_ossian"), kinds(s));
  s.world.edges.push(e("char_ossian", "char_di", { roles: ["husband"] }));
  check("not if one of them is already married to someone else", !kinds(s).some((k) => k.startsWith("together")), kinds(s));
}
{
  const s = world([e("char_mara", "char_player", { attraction: 90, warmth: 80 }), e("char_player", "char_mara", { attraction: 90, warmth: 80 })]);
  check("never the player", kinds(s).length === 0, kinds(s));
}
{
  const s = world([e("char_mara", "char_ossian", { attraction: 70, warmth: 40 }), e("char_ossian", "char_mara", { attraction: 60, warmth: 35 })]);
  s.world.present = ["char_player", "char_mara"];
  check("never someone standing in the player's scene", kinds(s).length === 0, kinds(s));
}
{
  const s = world([e("char_mara", "char_ossian", { roles: ["wife"], warmth: -40, trust: -30 }), e("char_ossian", "char_mara", { roles: ["husband"], warmth: -20 })]);
  check("a marriage gone cold can end", kinds(s).includes("breakup:char_mara:char_ossian"), kinds(s));
  const warm = world([e("char_mara", "char_ossian", { roles: ["wife"], warmth: 30 }), e("char_ossian", "char_mara", { roles: ["husband"], warmth: 25 })]);
  check("a warm one can't", !kinds(warm).some((k) => k.startsWith("breakup")), kinds(warm));
}
{
  const s = world([e("char_mara", "char_di", { roles: ["friend"], warmth: 20, swing: { since_turn: 19, warmth: -18, trust: -5 } }), e("char_di", "char_mara", { roles: ["friend"], warmth: 40 })]);
  check("friends, one of whom just took a hard turn against the other, can fall out", kinds(s).includes("fallout:char_di:char_mara"), kinds(s));
}

/* ── 2. what an event does ───────────────────────────────────────────────────── */
{
  const s = world([e("char_mara", "char_ossian", { attraction: 70, warmth: 40, trust: 20 }), e("char_ossian", "char_mara", { attraction: 60, warmth: 35 })]);
  runLifeEvents(s, always);                                 // first call only sets the clock
  check("the first call measures nothing and fires nothing", (s.world.life_events ?? []).length === 0);
  s.world.current_time = "Day 5, 10:00 (Morning)";          // two days later
  const log = runLifeEvents(s, always);
  const ab = s.world.edges.find((x: any) => x.from === "char_mara" && x.to === "char_ossian");
  check("they get together", log[0] === "Mara Quill and Ossian Hale have started seeing each other.", log);
  check("the roles say so, both ways", ab.roles?.includes("partner") && s.world.edges.find((x: any) => x.from === "char_ossian")?.roles?.includes("partner"));
  check("both of them remember it", s.memory.char_mara.episodic.at(-1)?.content === "Ossian Hale and I are together now." && s.memory.char_ossian.episodic.length === 1);
  check("they both know, and it's news now", s.world.rumors.length === 1 && s.world.rumors[0].knowers.length === 2);
  check("the offstage log has it, for the World tab and the record", s.world.offstage_log.at(-1)?.what === log[0]);
  s.world.current_time = "Day 5, 18:00 (Evening)";
  check("one pair, one milestone at a time: no second event inside the cooldown", runLifeEvents(s, always).length === 0);
}
{
  const s = world([e("char_mara", "char_ossian", { roles: ["wife", "neighbor"], warmth: -50, trust: -40 }), e("char_ossian", "char_mara", { roles: ["husband"], warmth: -30 })]);
  runLifeEvents(s, always, 2 * 1440);
  const ab = s.world.edges.find((x: any) => x.from === "char_mara");
  check("a breakup turns wife into ex-wife and keeps everything else", ab.roles?.includes("ex-wife") && ab.roles?.includes("neighbor") && !ab.roles?.includes("wife"), ab.roles);
  check("and a time skip drops the clock, so the next turn won't count the skip twice", s.world.life_clock === undefined);
  check("an ex is not a partner: no second breakup is queued", !kinds(s).some((k) => k.startsWith("breakup")), kinds(s));
  s.world.edges.push(e("char_mara", "char_di", { attraction: 70, warmth: 40 }), e("char_di", "char_mara", { attraction: 65, warmth: 40 }));
  check("and an ex-wife is free to be with someone new", kinds(s).includes("together:char_di:char_mara"), kinds(s));
}

/* ── 3. time is the rate ─────────────────────────────────────────────────────── */
{
  let fired = 0;
  for (let i = 0; i < 200; i++) {
    const s = world([e("char_mara", "char_ossian", { attraction: 50, warmth: 30 }), e("char_ossian", "char_mara", { attraction: 45, warmth: 30 })]);
    let seed = i * 9301 + 49297;
    const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    fired += runLifeEvents(s, rng, 10).length;            // a ten-minute turn
  }
  check("a turn that costs minutes almost never produces one", fired <= 2, fired);
  const s = world([e("char_mara", "char_ossian", { attraction: 90, warmth: 60, trust: 30 }), e("char_ossian", "char_mara", { attraction: 85, warmth: 60, trust: 30 })]);
  simulateForward(s, 14, always);
  check("a fortnight's time skip can", (s.world.life_events ?? []).some((r: any) => r.kind === "together"), s.world.life_events);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
