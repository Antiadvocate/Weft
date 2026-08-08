/* Smoke test: THE INSTRUMENTS THEMSELVES.
 *
 * These two measure the engine, so they are worth more than usual when correct and worse than
 * useless when wrong — a broken instrument does not fail loudly, it reports a comfortable number.
 * The first version of the coverage audit reported 99% because `volatileDigest` stamps
 * `last_accessed_turn` on every memory it surfaces (retrieval strengthening — a real mechanism, not
 * a bug). Each build changed the input to the next one, the baseline drifted under the test, and
 * every field after the first looked "reached". It agreed with nothing and looked like good news.
 *
 * So the load-bearing test here is not "does it produce a number" but:
 *   · does it agree with a fact established by reading the code (traits render at slice(0,4))?
 *   · does it leave the save byte-identical afterwards? */
import { newSave, registerCharacter } from "../src/engine/state";
import { coverageAudit, emergenceReport } from "../src/engine/audit";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("audit", {
    name: "The Arrangement",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa", character_id: "char_tessa" } as any);
  s.world.current_turn = 40;
  s.world.present = ["char_tessa"];            // she has to be in the room to be rendered
  s.characters.char_tessa.location = s.world.player_location;
  return s;
}

/* ── 1. it agrees with the code ──────────────────────────────────────────────── */
{
  const s = world();
  // eight traits; prompts.ts renders `traits.slice(0, 4)`, so 4-7 cannot reach the model
  s.traits.char_tessa = ["performative", "deceptive", "possessive", "fragile", "calculating", "Dominatrix", "authoritative", "unraveled"]
    .map((label, i) => ({ id: `trait_${i}`, label, origin: "", behavioral_impact: `impact of ${label}`, intensity: 4, self_weight: 1, last_reinforced_turn: 40, reinforcement_count: 1 }));

  const cov = coverageAudit(s);
  const at = (p: string) => cov.fields.find((f) => f.path === p);
  const reached = (i: number) => !!at(`traits.char_tessa.${i}.label`)?.reached.length;

  check("the first four traits reach the model", [0, 1, 2, 3].every(reached), [0, 1, 2, 3].map(reached));
  check("the rest cannot, and the audit says so", ![4, 5, 6, 7].some(reached), [4, 5, 6, 7].map(reached));
  check("a present character's name reaches the model", !!at("characters.char_tessa.name")?.reached.length);
  check("every field is accounted for", cov.reachedCount + cov.darkGroups.reduce((a, b) => a + b.count, 0) === cov.totalCount);
  check("the subsystem view adds up", cov.bySubsystem.reduce((a, b) => a + b.total, 0) === cov.totalCount);
}

/* ── 2. IT MUST NOT DAMAGE THE SAVE IT MEASURES ──────────────────────────────── */
{
  const s = world();
  s.memory.char_tessa.episodic.push(
    { id: "ep1", turn: 38, content: "He put the phone face down without reading it.", importance: 6, where: "the kitchen", when_label: "Day 5, 17:00 (Evening)" } as any,
    { id: "ep2", turn: 39, content: "She heard the shower start and knew he was not coming back to bed.", importance: 7, where: "the bedroom", when_label: "Day 5, 17:30 (Evening)" } as any,
  );
  const before = JSON.stringify(s);
  coverageAudit(s);
  check("the save is byte-identical after an audit", JSON.stringify(s) === before);
  // and it reports the impurity it had to work around rather than hiding it
  const cov = coverageAudit(s);
  check("and the audit names what the builders write while building",
    cov.impurePaths.some((p) => /last_accessed_turn/.test(p)), cov.impurePaths);
}

/* ── 3. the emergence counters find planted signals ──────────────────────────── */
{
  const s = world();
  s.world.current_turn = 12;
  // an offstage event with distinctive words, and a later turn whose prose carries them
  (s.world as any).offstage_log = [
    { turn: 3, time: "Day 1", what: "Mara telephoned the foreman about the scaffolding permit and left a voicemail.", actor: "Mara" },
  ];
  const filler = (n: number) => ({ turn: n, player_action: "", narrator_prose: "He waited. Nothing else happened that hour.", summary: "", present: [], shifts: [] } as any);
  s.history = [1, 2, 3, 4, 5, 6].map(filler);
  s.history.push({ ...filler(7), narrator_prose: "The foreman returned the voicemail about the scaffolding permit, three days late." });
  s.history.push(filler(8));

  const em = emergenceReport(s);
  check("an offstage event that later surfaces is counted", em.offstage.surfaced === 1, em.offstage);
  check("and the null model runs the same test backwards", em.offstage.nullRate === 0, em.offstage.nullRate);
}
{
  // the same event, but the prose never mentions it: the counter must stay at zero
  const s = world();
  s.world.current_turn = 12;
  (s.world as any).offstage_log = [
    { turn: 3, time: "Day 1", what: "Mara telephoned the foreman about the scaffolding permit and left a voicemail.", actor: "Mara" },
  ];
  s.history = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ turn: n, player_action: "", narrator_prose: "He waited. Nothing else happened that hour.", summary: "", present: [], shifts: [] } as any));
  const em = emergenceReport(s);
  check("an offstage event nobody ever mentions is not counted", em.offstage.surfaced === 0, em.offstage);
}
{
  // a rumour that travelled by cascade, and its second-hand knower later on the page with it
  const s = world();
  s.world.current_turn = 12;
  s.world.rumors = [{
    id: "rum1", content: "Tessa was seen leaving the Brackenridge hotel before dawn.", truth: "true", salience: 0.8,
    origin_char: "char_player", knowers: ["char_player", "char_tessa"], born_turn: 2, dead: false,
    path: [
      { to: "char_player", from: null, turn: 2, how: "witnessed", where: "the lobby" },
      { to: "char_tessa", from: "char_player", turn: 3, how: "told", where: "the kitchen" },
    ],
  } as any];
  s.history = [1, 2, 3, 4, 5].map((n) => ({ turn: n, player_action: "", narrator_prose: "Nothing much.", summary: "", present: [], shifts: [] } as any));
  s.history.push({ turn: 6, player_action: "", summary: "", present: [], shifts: [],
    narrator_prose: "Tessa said the Brackenridge hotel had been mentioned to her, and that leaving before dawn was not a thing she would explain." } as any);

  const em = emergenceReport(s);
  check("a rumour that travelled is counted as travelled", em.rumor.withToldHop === 1, em.rumor);
  check("and a second-hand knower acting on it is counted", em.rumor.secondHandActed === 1, em.rumor);
  check("a witnessed-only rumour is not", em.rumor.witnessedOnly === 0, em.rumor);
}
{
  // want churn: the number that says a drive is re-derived rather than pursued
  const s = world();
  s.world.current_turn = 10;
  s.history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    turn: n, player_action: "", narrator_prose: "…", summary: "", present: [],
    shifts: n % 2 === 0 ? ["Tessa wants something new: another thing entirely"] : [],
  } as any));
  const em = emergenceReport(s);
  check("new wants are counted", em.drives.newWants === 5, em.drives);
  check("and churn is expressed as turns-per-want", em.drives.perTurn === 2, em.drives);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
