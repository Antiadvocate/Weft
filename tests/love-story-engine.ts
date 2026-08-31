/* THE LOVE STORY THAT BECAME A MUNICIPAL PROCEDURAL.
 *
 * "Gaslighting, making stuff up, singular focused story creating drama when the whole story is a
 *  love story with erotica, creating issues out of nothing."
 *
 * Turn 57 of "Seattle, Washington — Present Day". The bible is unambiguous about what this is:
 *
 *   tone                 "Love, romance, erotica, slice of life"
 *   pressure_palette     five lines, all domestic — an unspoken need at the wrong moment, a work
 *                        emergency that pulls a partner away, a neighbour who misreads the
 *                        marriage, two tired people, a moment that asks for more honesty
 *   forbidden_as_primary "Violence or physical danger", "Infidelity as a plot engine",
 *                        "External villains", "Miscommunication that could be solved by one
 *                        sentence but is stretched for drama"
 *
 * What the telemetry says happened. Thirty-six of the fifty-seven turns carried non-zero pressure.
 * Every one of them named the utility plot: twenty-four named a faction clock by objective
 * ("Complete the Delridge substation upgrade", "Stop the new condo development from breaking
 * ground"), the rest named threads hanging off one. Not one turn in fifty-seven was pressured by
 * anything on the palette the player actually wrote. Eight threads were open at the end and seven
 * were about clearance signatures, gate logs and countersignatures.
 *
 * Three separate mechanisms, each of which had the right idea and the wrong scope:
 *
 *  1. fictionHeat's staleness damping and forbidden_engine gate were wired to the threads branch
 *     only. A clock's heat is (filled / segments) * 8 — it never cools and never repeats itself
 *     into fatigue, so from the moment it passed the hottest thread it owned the headline until it
 *     fired. Both gates now apply to clocks.
 *  2. The chapter auditor was shown the open threads and asked which the world was pressing
 *     through. The thing supplying the pressure was in a table it never saw, so it answered "no
 *     thread is the engine" — correctly — and passed both chapters on_contract while a romance ran
 *     on a substation upgrade. Clocks are on the list now and carry the same mark.
 *  3. The genre mandate in the digest was written for worlds with a body count and shipped to all
 *     of them: the world "kills", and the named failure to avoid was "a scene whose only cost is an
 *     awkward conversation". In this genre that is not the failure, it is the form. It also carried
 *     a standing per-turn debt — no pressure lately means pressure now — which a slice of life can
 *     only pay by manufacturing a crisis.
 */
import { fictionHeat, selectBeat, isBesieged } from "../src/engine/pressure";
import { mentioned } from "../src/engine/threads";
import { stablePrefix } from "../src/engine/prompts";
import type { Thread, FactionClock, ConsequenceEvent, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PALETTE = [
  "A spouse's unspoken need surfacing at the wrong moment",
  "A work emergency that pulls one partner away from a planned evening",
  "A friend or neighbor who misunderstands the marriage",
  "The small domestic friction of two people who love each other but are tired",
  "A moment of vulnerability that asks for more honesty than either planned",
];
const NEVER = [
  "Violence or physical danger",
  "Infidelity as a plot engine",
  "External villains",
  "Miscommunication that could be solved by one sentence but is stretched for drama",
];
const TONE = "Love, romance, erotica, slice of life";

/** The two clocks the forge wrote for this world, verbatim. */
const clocks = (): FactionClock[] => [
  { id: "clk_a", faction: "Seattle City Light", objective: "Complete the Delridge substation upgrade before the winter load hits",
    segments: 6, filled: 5, consequence: "the substation fails during the first cold snap", visible_signs: [], status: "running" },
  { id: "clk_b", faction: "Columbia City Neighborhood Association", objective: "Stop the new condo development from breaking ground",
    segments: 6, filled: 4, consequence: "the neighborhood loses its character", visible_signs: [], status: "running" },
];
const threads = (): Thread[] => [
  { id: "thr_a", title: "Whose name is in the block", description: "Kristi signed herself as engineer of record.", status: "active", tension: 3, turn_started: 17 },
];
const noConsequences: ConsequenceEvent[] = [];

/* ── 1. the save as it stood: one clock owned the headline ──────────────────── */
{
  const CLOCK_A = "clock: Seattle City Light — Complete the Delridge substation upgrade before the winter load hits";
  const cold = fictionHeat(threads(), clocks(), noConsequences, 40, undefined, []);
  check("with nothing recent, the maturing clock is the source", cold.source === CLOCK_A, cold);

  // Eight turns running it has been the answer. Under the old code the ninth was the same again.
  const stale = fictionHeat(threads(), clocks(), noConsequences, 48, undefined, Array(8).fill(CLOCK_A));
  check("a clock that has headlined eight turns straight yields the headline", stale.source !== CLOCK_A, stale);
  check("...and the heat it earned is not thrown away with it", stale.heat > 0, stale);

  // Damping, not banning: two mentions is not eight, and a clock at 5/6 still outweighs a thread at 3.
  const mild = fictionHeat(threads(), clocks(), noConsequences, 42, undefined, [CLOCK_A, CLOCK_A]);
  check("a clock named twice recently still wins — the gate damps, it does not ban", mild.source === CLOCK_A, mild);
}

/* ── 2. the auditor's mark reaches a clock ──────────────────────────────────── */
{
  const marked = clocks();
  marked[0].forbidden_engine = true;      // the auditor named it: this romance was running on it
  const v = fictionHeat(threads(), marked, noConsequences, 40, undefined, []);
  check("a clock marked as the forbidden engine stops being the reason for a scene",
    !v.source.includes("Delridge substation"), v);
  check("...and the next-best source takes over", v.source.includes("Columbia City"), v);

  const beat = selectBeat({
    turn: 60, tension: 5, threads: [], clocks: [{ ...marked[0], filled: 6 }], consequences: [], agents: [],
    last_beat_turn: 0, last_exo_turn: 0, recent: [], rng: () => 0.5,
  });
  check("a marked clock is not offered as a beat either", beat.kind !== "clock", beat);
}

/* ── 3. a marked clock is still a real clock ────────────────────────────────── */
{
  const marked = clocks();
  marked[0].forbidden_engine = true;
  check("marking does not stop it running", marked[0].status === "running");
  check("marking does not touch its progress", marked[0].filled === 5);
}

/* ── 4. the genre mandate speaks this world's register ──────────────────────── */
{
  check("this world does not read as besieged", !isBesieged(TONE, PALETTE));
  check("...while the horror save it was written for still does",
    isBesieged("Horror, action, drama", ["walkers converging on noise"]));

  const state = {
    world_bible: { name: "Seattle, Washington — Present Day", era: "Contemporary (2020s)", tone: TONE,
      what_people_fear: "Losing the person they love to silence or drift",
      pressure_palette: PALETTE, forbidden_as_primary: NEVER },
    world: { current_turn: 57, threads: [], clocks: [], canon: [], places: {}, present: [] },
    characters: {}, condition: {}, traits: {}, memory: {}, minds: {}, history: [],
    model_settings: {}, records: [], habits: [], chapters: [],
  } as unknown as SaveState;
  const digest = stablePrefix(state);

  check("the mandate no longer tells a romance that its world kills", !/it takes, it kills/.test(digest), );
  check("it no longer names an awkward conversation as the failure to avoid",
    !/only cost is an awkward conversation/.test(digest));
  check("it says outright that an awkward conversation IS this world acting",
    /whole cost is an awkward conversation/.test(digest));
  check("the per-turn drama quota is gone for this genre", /there is no quota/i.test(digest));
  check("rest is no longer a debt to be repaid", /you do not owe it a crisis/i.test(digest));
  check("the palette is named as the complete set of allowed pressures",
    /complete set of ways it is allowed to/.test(digest));

  // The never-the-engine list reached the narrator only through one soft parenthetical at the tail
  // of the per-turn directive, while the loud all-caps block above demanded pressure. Now they are
  // read together.
  check("the never-the-engine list is in the digest at all", /External villains/.test(digest));
  check("...and beside the mandate, not somewhere else entirely",
    digest.indexOf("External villains") - digest.indexOf("WHAT THIS WORLD DOES TO PEOPLE") < 2000
    && digest.indexOf("External villains") > digest.indexOf("WHAT THIS WORLD DOES TO PEOPLE"));
}

/* ── 5. a besieged world keeps every word of the original mandate ───────────── */
{
  const siege = {
    world_bible: { name: "The Wake of the USS Resolute", era: "Now", tone: "Horror, action, drama",
      what_people_fear: "Being eaten", pressure_palette: ["walkers converging on noise", "dwindling ammunition"],
      forbidden_as_primary: ["tone-policing the player's manner"] },
    world: { current_turn: 8, threads: [], clocks: [], canon: [], places: {}, present: [] },
    characters: {}, condition: {}, traits: {}, memory: {}, minds: {}, history: [],
    model_settings: {}, records: [], habits: [], chapters: [],
  } as unknown as SaveState;
  const digest = stablePrefix(siege);
  check("a siege is still told the world kills", /it takes, it kills/.test(digest));
  check("a siege still carries the standing debt", /this turn is where it does/.test(digest));
  check("a siege gets the never-the-engine list too", /tone-policing/.test(digest));
}

/* ── 6. the bookkeeper echoing a thread back is not news about it ───────────────
 *
 * sweepThreads demoted four stale clearance threads every turn from 50 to 56, and every turn the
 * bookkeeper re-listed them (it is handed the open threads in its own context) and the re-listing
 * woke them again. So the player read the same four lines of "Nobody has thought about it in a
 * while: Initials she hasn't got." in the offscreen log of seven consecutive turns, mid-scene, at
 * four in the morning, in the kitchen — and all four stayed `active`, in the pressure pool and in
 * the narrator's context, indefinitely.
 *
 * This exercises the predicate directly; the wiring in applyDiff is the same three clauses. */
{
  const stored = { id: "thr_a", title: "Initials she hasn't got", description: "The Thursday clearance can't be reissued in Kristi's name.", status: "dormant", tension: 3, turn_started: 23, last_touched_turn: 24 } as unknown as Thread;
  const echoOnly = (tu: { status: string; description?: string; tension?: number }, prose: string) =>
    !mentioned(stored, prose)
    && tu.status !== "resolved"
    && (!tu.description || tu.description.trim() === String(stored.description ?? "").trim())
    && (typeof tu.tension !== "number" || tu.tension === (stored.tension ?? 3));

  const KITCHEN = "Emily stood at the stove with her back to the hallway, the flatbread wrapped in a tea towel.";
  check("a verbatim re-listing during an unrelated scene is an echo",
    echoOnly({ status: "active", description: stored.description, tension: 3 }, KITCHEN));
  check("a re-listing with no description or tension at all is an echo",
    echoOnly({ status: "active" }, KITCHEN));
  check("a moved tension is news", !echoOnly({ status: "active", tension: 5 }, KITCHEN));
  check("a rewritten description is news",
    !echoOnly({ status: "active", description: "Masterson signed it after all." }, KITCHEN));
  check("a resolution is always news", !echoOnly({ status: "resolved" }, KITCHEN));
  check("and prose that is actually about it is news",
    !echoOnly({ status: "active" }, "Kristi needed the Thursday clearance reissued in her own name and Masterson would not initial the sheet."));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
