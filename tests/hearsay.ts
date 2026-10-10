/* Smoke test: HEARING ABOUT SOMEBODY CHANGES WHAT YOU THINK OF THEM.
 *
 * The rumour field was a careful ledger of who knows — co-presence, a remote channel along real
 * bonds, travel-time gating, provenance on every hop — and it stopped there. A woman who heard from
 * her brother that Rabi burned the mill held exactly the opinion of Rabi she had before. Offstage,
 * where nearly all hearing happens, nothing moved. Two people who couldn't stand each other also
 * passed stories across a room as freely as old friends, and a story that grew in the telling was
 * marked as grown for nobody. */
import { hearsayValence, rumorSubject, credence, resistance, hearsayShift, tellBias } from "../src/engine/hearsay";
import { diffuseRumors } from "../src/engine/social";
import type { Rumor } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const psyche = (relaxation: number) => ({ psyche: { relaxation, capacity: 0 } });
function world(edges: any[] = [], relax = 0) {
  return {
    world: {
      current_turn: 20, current_time: "Day 3, 10:00 (Morning)", present: ["char_player"], player_location: "loc_road",
      places: { loc_mill: { id: "loc_mill", name: "The Mill" }, loc_road: { id: "loc_road", name: "Coast Road" } },
      rumors: [] as Rumor[], edges, threads: [], clocks: [], consequences: [], canon: [], public_standing: 0,
    },
    characters: {
      char_player: { character_id: "char_player", name: "Joe Arden", location: "loc_road" },
      char_mara: { character_id: "char_mara", name: "Mara Quill", location: "loc_mill", gregariousness: 1 },
      char_ossian: { character_id: "char_ossian", name: "Ossian Quill", location: "loc_mill", gregariousness: 1 },
      char_rabi: { character_id: "char_rabi", name: "Rabi Tal", location: "loc_road", aliases: ["the miller"] },
    },
    condition: { char_mara: psyche(relax), char_ossian: psyche(relax), char_rabi: psyche(0), char_player: psyche(0) },
    memory: {}, traits: {}, minds: {} as any,
  } as any;
}
const rumor = (content: string, extra: Partial<Rumor> = {}): Rumor => ({
  id: "rum_1", content, truth: "true", salience: 10, origin_char: "char_mara", knowers: ["char_mara"], born_turn: 19, ...extra,
});

/* ── 1. what a story says about the person who did the thing ─────────────────── */
check("burning a mill is harm", hearsayValence("I watched Rabi burn down the mill") === -1);
check("saving a boy is good", hearsayValence("Rabi pulled the miller's boy out and saved him") === 1);
check("being sick says nothing bad about you", hearsayValence("Mara is sick with the fever") === 0);
check("being robbed is not robbing", hearsayValence("Ossian was robbed on the coast road") === 0);
check("an act written backwards still counts", hearsayValence("the mill was burned by Rabi") === -1);
check("a plan is not an act", hearsayValence("Rabi says he will kill the next man who crosses him") === 0);
check("a well-loved player's violence reads as a deed", hearsayValence("Joe killed the raiders at the ford", 4) === 0);

/* ── 2. who the story is about ───────────────────────────────────────────────── */
{
  const s = world();
  check("the one a witness saw doing it", rumorSubject(s, rumor("I watched Rabi burn down the mill")) === "char_rabi");
  check("not the one it was done to", rumorSubject(s, rumor("I saw Rabi Tal beat Ossian behind the mill")) === "char_rabi");
  check("the doer after 'by'", rumorSubject(s, rumor("Ossian was beaten by Rabi")) === "char_rabi");
  check("an alias resolves", rumorSubject(s, rumor("the miller betrayed his own brother")) === "char_rabi");
  check("'I' is the witness", rumorSubject(s, rumor("I stole the boat from the landing")) === "char_mara");
  check("a victim alone is nobody's act", rumorSubject(s, rumor("Ossian was robbed on the coast road")) === null);
  check("a surname two people share names nobody", rumorSubject(s, rumor("Quill stole the boat")) === null);
  check("about_char wins when the writer set it", rumorSubject(s, rumor("the boat is gone", { about_char: "char_ossian" })) === "char_ossian");
}

/* ── 3. who told you, and what you already thought ───────────────────────────── */
{
  const s = world([
    { from: "char_ossian", to: "char_mara", warmth: 40, trust: 80, power: 0, notes: "", updated_turn: 1 },
    { from: "char_player", to: "char_mara", warmth: 0, trust: -100, power: 0, notes: "", updated_turn: 1 },
  ]);
  check("a stranger is believed at half weight", credence(s.world.edges, "char_rabi", "char_mara") === 0.5);
  check("a trusted sister nearly whole", credence(s.world.edges, "char_ossian", "char_mara") === 0.9);
  check("someone you distrust barely at all", credence(s.world.edges, "char_player", "char_mara") === 0.15);

  s.world.edges.push({ from: "char_ossian", to: "char_rabi", warmth: 70, trust: 50, power: 0, notes: "", updated_turn: 1 });
  check("news that agrees with you lands whole", resistance(s, "char_ossian", "char_rabi", 1) === 1);
  const open = resistance(s, "char_ossian", "char_rabi", -1);
  s.minds.char_ossian = { character_id: "char_ossian", about: [{ target: "char_rabi", predicted_warmth: 60, predicted_stance: "ally", surprise: 0, confidence: 0.9, updated_turn: 19 }] };
  const settled = resistance(s, "char_ossian", "char_rabi", -1);
  check("news against a fond opinion is damped", open < 1, open);
  check("and damped harder when the picture is settled", settled < open, { open, settled });
  check("but never sealed", settled >= 0.2, settled);
}

/* ── 4. the rumour field, end to end ─────────────────────────────────────────── */
{
  // Ossian trusts his sister; Mara tells him what she saw. Every roll succeeds.
  const s = world([{ from: "char_ossian", to: "char_mara", warmth: 40, trust: 80, power: 0, notes: "", updated_turn: 1 }]);
  s.world.rumors.push(rumor("I watched Rabi burn down the mill"));
  const log = diffuseRumors(s, () => 0);
  const e = s.world.edges.find((x: any) => x.from === "char_ossian" && x.to === "char_rabi");
  check("Ossian heard it", s.world.rumors[0].knowers.includes("char_ossian"), s.world.rumors[0].knowers);
  check("and thinks less of Rabi for it", (e?.warmth ?? 0) < 0 && (e?.trust ?? 0) < 0, e);
  check("the move is small — talk shades a reputation, it does not set one", (e?.warmth ?? 0) >= -6, e?.warmth);
  check("the narrator is told why", log.some((l) => /Ossian Quill thinks less of Rabi Tal now, going by what Mara Quill told them/.test(l)), log);
  check("the witness's own opinion was not touched by her own story",
    !s.world.edges.some((x: any) => x.from === "char_mara" && x.to === "char_rabi"));
}
{
  // Same story, a fond brother with a settled picture of Rabi: it lands, but smaller.
  const s = world([
    { from: "char_ossian", to: "char_mara", warmth: 40, trust: 80, power: 0, notes: "", updated_turn: 1 },
    { from: "char_ossian", to: "char_rabi", warmth: 75, trust: 60, power: 0, notes: "", updated_turn: 1 },
  ]);
  s.minds.char_ossian = { character_id: "char_ossian", about: [{ target: "char_rabi", predicted_warmth: 60, predicted_stance: "ally", surprise: 0, confidence: 0.9, updated_turn: 19 }] };
  s.world.rumors.push(rumor("I watched Rabi burn down the mill"));
  diffuseRumors(s, () => 0);
  const e = s.world.edges.find((x: any) => x.from === "char_ossian" && x.to === "char_rabi");
  check("a fond opinion is shaded, not reversed", e.warmth < 75 && e.warmth >= 72, e.warmth);
}
{
  // A story that says nothing about anybody's conduct moves nobody.
  const s = world([{ from: "char_ossian", to: "char_mara", warmth: 40, trust: 80, power: 0, notes: "", updated_turn: 1 }]);
  s.world.rumors.push(rumor("Rabi is sick with the fever"));
  diffuseRumors(s, () => 0);
  check("illness is news, not a verdict", !s.world.edges.some((x: any) => x.to === "char_rabi"));
}

/* ── 5. who tells whom ───────────────────────────────────────────────────────── */
{
  const s = world([
    { from: "char_mara", to: "char_ossian", warmth: -80, trust: -50, power: 0, notes: "", updated_turn: 1 },
    { from: "char_ossian", to: "char_mara", warmth: -60, trust: -70, power: 0, notes: "", updated_turn: 1 },
  ]);
  check("strangers trade stories at the rate the field always had", tellBias(world(), "char_mara", "char_ossian", null) === 1);
  check("people who can't stand each other trade far fewer", tellBias(s, "char_mara", "char_ossian", null) < 0.6, tellBias(s, "char_mara", "char_ossian", null));
  const f = world([
    { from: "char_mara", to: "char_ossian", warmth: 60, trust: 60, power: 0, notes: "", updated_turn: 1 },
    { from: "char_mara", to: "char_rabi", warmth: -50, trust: 0, power: 0, notes: "", updated_turn: 1 },
    { from: "char_ossian", to: "char_rabi", warmth: -40, trust: 0, power: 0, notes: "", updated_turn: 1 },
  ]);
  const agree = tellBias(f, "char_mara", "char_ossian", "char_rabi");
  f.world.edges[2].warmth = 40;
  const disagree = tellBias(f, "char_mara", "char_ossian", "char_rabi");
  check("two people who agree about someone trade stories about them more", agree > disagree, { agree, disagree });
}

/* ── 6. a story that grew on the way is grown for the one who got it grown ──── */
{
  const s = world([{ from: "char_ossian", to: "char_mara", warmth: 40, trust: 80, power: 0, notes: "", updated_turn: 1 }], -8);
  s.world.rumors.push(rumor("I watched Rabi burn down the mill", { salience: 8 }));
  diffuseRumors(s, () => 0);
  const r = s.world.rumors[0];
  check("in a clenched room the story grows", r.salience > 8 - 0.3, r.salience);
  check("and the one it grew on the way to holds the grown version", r.distorted?.includes("char_ossian") === true, r.distorted);
  check("the witness still holds what she saw", !r.distorted?.includes("char_mara"));
  check("the event itself is still true", r.truth === "true");
  check("hearing about yourself is not this mechanism", hearsayShift(s, r, "char_rabi", "char_mara") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
