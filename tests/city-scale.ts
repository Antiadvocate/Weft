/* THE WIFE WHO COULD NOT WALK FOUR BLOCKS HOME, AND THE BARISTA WHO LET HERSELF IN.
 *
 * "Mara finds my text. She has telepathy. She then follows me into the house. Invents keys. I barely
 *  know her. Not just that but she knows my conversation with Ming. Not just that but now Emily has
 *  fucking disappeared."
 *
 * Turn 36 of the Seattle save. Emily walked out of the front door at 19:58 on Day 1. From turn 28
 * her drive carried the pursuit blocker "must find Rabi first — they are elsewhere" and
 * `pursuit_since: 28`. By turn 36 she had not come home, and could not:
 *
 *   travelMinutesBetween("Columbia City Farmers Market", "Rabi and Emily's House") = 1440
 *
 * No authored distance for the pair, no shared name token, not both interiors — so the gate quoted
 * DEFAULT_TRAVEL_MIN, a full day, against 120 minutes elapsed. At roughly ten in-world minutes per
 * turn that is another hundred and thirty turns before the player's wife is allowed to cross
 * Columbia City. Meanwhile Mara and Drea stood at `elsewhere` rather than at any place, went through
 * no gate at all, and turned up in the dining room twice.
 *
 * The measurement was in the save the whole time. travel_log: the house, then the Copper Kettle
 * Diner at turn 30, then the house again at turn 32 — thirty-five in-world minutes for a hop across
 * this world's map. Eleven places, all Seattle. A world that has shown its places are half an hour
 * apart is not one where an unmeasured pair is a day away.
 *
 * AND THE CAP THAT SHOULD HAVE STOPPED DREA WAS COUNTING WRONG. `central` is written in exactly one
 * place — the promotion loop — so a character the forge authored at world creation has it undefined
 * forever: they arrive already `tracked` and never reach the branch that stamps it. Every other
 * reader in the engine treats undefined as central (they all test `=== false`); the cap counted it
 * as not-cast. So with five people in the cast it read 1 of 6, and a barista named in one line of
 * prose at turn 30 — "The barista's name tag says Drea" — was a full central character by 33, with
 * a card, a drive about a coffee cart, and a place in the player's dining room.
 */
import { travelMinutesBetween, worldScale, DEFAULT_TRAVEL_MIN, ARRIVAL_PATIENCE } from "../src/engine/turn";
import { minutesBetween } from "../src/engine/time";
import { OFFSTAGE_SYSTEM } from "../src/engine/offstage";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/city-scale.json", "utf8"));
const save = (): SaveState => ({
  travel_log: FIX.travel_log,
  characters: FIX.characters,
  world: { places: FIX.places, time_at_turn: FIX.time_at_turn, current_time: FIX.current_time, current_turn: FIX.current_turn },
} as unknown as SaveState);

const HOUSE = "Rabi and Emily's House";
const MARKET = "Columbia City Farmers Market";

/* ── 1. the world says how big it is ─────────────────────────────────────────── */
{
  const s = save();
  const scale = worldScale(s);
  check("the observed scale is read off the player's own hops", typeof scale === "number", scale);
  check("...and it is a town, not a continent", (scale ?? 0) > 0 && (scale ?? 0) < 4 * 60, scale);
  check("...well under the day the default assumed", (scale ?? 0) < DEFAULT_TRAVEL_MIN, { scale, DEFAULT_TRAVEL_MIN });
}

/* ── 2. so the wife can come home ────────────────────────────────────────────── */
{
  const s = save();
  const needed = travelMinutesBetween(s, MARKET, HOUSE);
  check("the market-to-house hop is no longer a day", needed < DEFAULT_TRAVEL_MIN, needed);
  check("...and is not free either", needed > 0, needed);

  const emily = FIX.characters["char_mtggvs9t2dhp3"];
  const since = emily.drive.pursuit_since as number;
  check("she really was in pursuit since turn 28", since === 28, since);
  const elapsed = minutesBetween(FIX.time_at_turn[String(since)], FIX.current_time);
  check("she has been patient long enough", FIX.current_turn - since >= ARRIVAL_PATIENCE);
  check("AND SHE ARRIVES", elapsed >= needed, { elapsed: Math.round(elapsed), needed });
  check("...which under the old default she could not have", elapsed < DEFAULT_TRAVEL_MIN, Math.round(elapsed));
}

/* ── 3. a world of real journeys keeps its day ───────────────────────────────── */
{
  // Same machinery, a map whose observed hops are long: the day survives, because the guard it was
  // written for — a wife crossing a sea nobody wrote — is still the right guard there.
  const far = {
    travel_log: [{ turn: 1, place: "p1" }, { turn: 4, place: "p2" }],
    characters: {},
    world: {
      places: { p1: { id: "p1", name: "Thornwood" }, p2: { id: "p2", name: "Calder Port" } },
      time_at_turn: { 1: "Day 1, 06:00", 4: "Day 1, 17:00" },
      current_time: "Day 2, 06:00", current_turn: 6,
    },
  } as unknown as SaveState;
  const scale = worldScale(far);
  check("a long observed hop reports a large scale", (scale ?? 0) >= 10 * 60, scale);
  check("...and an unknown pair there still costs the full day",
    travelMinutesBetween(far, "Thornwood", "Somewhere Unwritten") === DEFAULT_TRAVEL_MIN);

  // No evidence at all — the day stands, as before.
  const blank = { travel_log: [], characters: {}, world: { places: {}, time_at_turn: {}, current_time: "Day 1, 09:00", current_turn: 2 } } as unknown as SaveState;
  check("a world with no observed travel keeps the day", worldScale(blank) === undefined);
  check("...and its unknown pairs cost a day", travelMinutesBetween(blank, "A", "B") === DEFAULT_TRAVEL_MIN);
}

/* ── 4. a measurement is a measurement, not a gap ────────────────────────────── */
{
  // A hop recorded across a night's sleep measures the sleep, not the road.
  const slept = {
    travel_log: [{ turn: 1, place: "p1" }, { turn: 2, place: "p2" }],
    characters: {},
    world: {
      places: { p1: { id: "p1", name: "The House" }, p2: { id: "p2", name: "The Shop" } },
      time_at_turn: { 1: "Day 1, 22:00", 2: "Day 3, 22:00" },
      current_time: "Day 3, 23:00", current_turn: 3,
    },
  } as unknown as SaveState;
  check("a two-day gap is not read as a two-day journey", worldScale(slept) === undefined, worldScale(slept));
}

/* ── 5. the cap counts the cast the story was built with ─────────────────────── */
{
  // The filter as it now stands, run over the save's real cast.
  const live = Object.values(FIX.characters).filter((x: any) =>
    x.character_id !== "char_player" && x.central !== false && x.tracked && x.status !== "dead" && x.status !== "departed");
  const names = live.map((x: any) => x.name).sort();
  check("Emily counts toward the central cap", names.includes("Emily"), names);
  check("...as does Mara", names.includes("Mara"), names);
  check("...while departed characters do not", !names.includes("Dev") && !names.includes("Priya"), names);

  // The old filter — `x.central` truthy — is what made room for a barista.
  const old = Object.values(FIX.characters).filter((x: any) =>
    x.character_id !== "char_player" && x.central && x.status !== "dead" && x.status !== "departed");
  check("the old count missed the player's own wife", !old.map((x: any) => x.name).includes("Emily"), old.map((x: any) => x.name));
  check("...and so undercounted the cast", old.length < live.length, { old: old.length, now: live.length });
}

/* ── 6. and nobody offstage knows what they were not told ────────────────────── */
{
  check("the offstage pass is given the epistemic rule at all",
    /NOBODY OFFSTAGE KNOWS ANYTHING THEY WERE NOT TOLD/.test(OFFSTAGE_SYSTEM));
  check("...naming the player's private words specifically",
    /do not know what the player typed, texted, said on a phone call/i.test(OFFSTAGE_SYSTEM));
  check("...and refusing the explanation-as-invention move",
    /the explanation IS the invention/.test(OFFSTAGE_SYSTEM));
  check("...with the productive alternative spelled out",
    /they call and get voicemail/.test(OFFSTAGE_SYSTEM));
  check("the witness rule it sits beside still stands",
    /WITNESSES ARE HOW ANY OF THIS REACHES THE STORY/.test(OFFSTAGE_SYSTEM));
  check("and the faction-clock rule after it survived the insert",
    /FACTION CLOCKS ADVANCE HERE, OR NOWHERE/.test(OFFSTAGE_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
