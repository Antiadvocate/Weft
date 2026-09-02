/* QUANTUM TELEPORTATION, AS THE PLAYER NAMED IT.
 *
 * "Lies upon lies upon lies upon lies can't maintain story at all."
 * "Somehow Mara got here two fucking days before I flew in even though I WAS TALKING TO HER IN
 *  SEATTLE EARLIER TODAY. Nice quantum teleportation. No quantum cloning?"
 *
 * Turn 41 of the Seattle save. The player typed:
 *
 *     "After hours of travel. I finally arrive in Houston and take an uber to kings house."
 *
 * The bookkeeper billed TWO MINUTES. time_at_turn went 19:08 to 19:10. Everything after that
 * followed from that one number, because as far as every other system was concerned the player was
 * still in Seattle on the same evening, twenty minutes from his own front door:
 *
 *   turn 44  Mara walks into the Houston kitchen — "I got the last flight I could"
 *   turn 46  King is made to say she "showed up two days ago", of a woman who was on the player's
 *            porch in Seattle forty minutes earlier
 *   turn 48  Mara arrives AGAIN by Uber, repeating her line from turn 44 word for word
 *
 * AND THE LEDGER SWAPPED TWO PEOPLE. Mara is the one written as flying — her own life_history reads
 * "I flew on the last possible flight to Houston" — and she ends at `loc_offscene`. Drea, who was
 * never written as travelling anywhere, ends at "Kings house in Houston". So from turn 45 the
 * roster said Drea was in the room and Mara was not, and the narrator, reading it, put Mara's
 * speech in Drea's mouth: turn 47 has Drea saying "I didn't know Drea a year ago. I didn't know
 * Drea a week ago."
 *
 * The arrival guard let it happen because its only question was whether the prose MENTIONS the
 * person. The pursuit walk in replanDrives has consulted travelMinutesBetween since it existed —
 * it is why a wife three miles away waits for the clock — and the bookkeeper's location diff, which
 * moves far more people far more often, never consulted it once.
 */
import { travelMinutesBetween, worldScale, DEFAULT_TRAVEL_MIN } from "../src/engine/turn";
import { declaredMinutes, minutesBetween } from "../src/engine/time";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/teleport.json", "utf8"));
const HOUSE = "Rabi and Emily's House";
const HOUSTON = "Kings house in Houston";
const MARKET = "Columbia City Farmers Market";

/* ── 1. the two minutes ──────────────────────────────────────────────────────── */
{
  const t40 = FIX.time_at_turn["40"], t41 = FIX.time_at_turn["41"];
  check("the flight really was billed at minutes", minutesBetween(t40, t41) <= 5, { t40, t41 });

  const declared = declaredMinutes(FIX.actions["41"]);
  check("the player's own words declare hours", declared >= 3 * 60, { declared, action: FIX.actions["41"] });
  check("...and the declaration outranks the bill", declared > minutesBetween(t40, t41));

  // The floor reads the PLAYER, never the prose — a narrator writing "hours later" is a guess.
  check("an ordinary turn declares nothing", declaredMinutes("I sit down and eat my eggs") === 0);
  check("a counted span is read", declaredMinutes("I wait three hours") === 180);
  check("a flight is read even unnumbered", declaredMinutes("I fly to Houston tonight") >= 180);
  check("...but only when it is a journey", declaredMinutes("I think about the airport") === 0);
}

/* ── 2. one world, two scales ────────────────────────────────────────────────── */
{
  // The log with the flight billed properly, which is what the floor above produces.
  const fixed = {
    travel_log: FIX.travel_log, characters: {},
    world: {
      places: FIX.places,
      time_at_turn: { ...FIX.time_at_turn, "41": "Day 2, 23:08 (Night)" },
      current_time: FIX.current_time,
    },
  } as unknown as SaveState;

  const scale = worldScale(fixed);
  check("the world's ordinary scale is still a city", (scale ?? 0) < 4 * 60, scale);
  check("...even with a cross-country flight in the log", (scale ?? 0) < DEFAULT_TRAVEL_MIN, scale);

  const walk = travelMinutesBetween(fixed, MARKET, HOUSE);
  check("an unmeasured Seattle pair stays walkable", walk < 4 * 60, walk);

  const flight = travelMinutesBetween(fixed, HOUSE, HOUSTON);
  check("and the flight is priced as a flight", flight > 6 * 60, flight);
  check("...because the player actually flew it and it was measured", flight !== DEFAULT_TRAVEL_MIN, flight);
  check("the two coexist — the same world holds a walk and a flight", walk * 4 < flight, { walk, flight });
}

/* ── 3. so the arrival guard can refuse ──────────────────────────────────────── */
{
  const fixed = {
    travel_log: FIX.travel_log, characters: {},
    world: { places: FIX.places, time_at_turn: { ...FIX.time_at_turn, "41": "Day 2, 23:08 (Night)" }, current_time: FIX.current_time },
  } as unknown as SaveState;
  const needed = travelMinutesBetween(fixed, HOUSE, HOUSTON);

  // Mara was on the porch in Seattle at 19:08 and in the Houston kitchen at 20:05.
  const had = minutesBetween("Day 2, 19:08", "Day 2, 20:05");
  check("she had under an hour", had < 60, had);
  check("AND THE JOURNEY IS LONGER THAN THAT", had < needed, { had, needed });

  // Somebody who has genuinely had the time is not blocked.
  const enough = minutesBetween("Day 1, 06:00", "Day 2, 20:05");
  check("a traveller with a day and a half is let through", enough >= needed, { enough, needed });
}

/* ── 4. the swap the roster made ─────────────────────────────────────────────── */
{
  const mara = Object.values(FIX.characters).find((c: any) => c.name === "Mara") as any;
  const drea = Object.values(FIX.characters).find((c: any) => c.name === "Drea") as any;

  check("Mara is the one the story flew to Houston", /flew on the last possible flight to Houston/.test(mara.life_history ?? ""), mara.life_history);
  check("...and the ledger has her offscene", mara.location === "loc_offscene", mara.location);
  check("Drea was never written as travelling", !/flew|flight/i.test(drea.life_history ?? ""), drea.life_history);
  check("...and the ledger has her in Houston", FIX.places[drea.location]?.name === HOUSTON, drea.location);

  // Which is what the roster then told the narrator, turn after turn.
  const names = (t: string) => (FIX.present[t] ?? []).map((id: string) => FIX.characters[id]?.name);
  check("turn 44 has Mara in the room, correctly", names("44").includes("Mara"), names("44"));
  check("turn 45 has swapped her for Drea", !names("45").includes("Mara") && names("45").includes("Drea"), names("45"));
  check("and never puts her back", ["46", "47", "48"].every((t) => !names(t).includes("Mara")),
    ["46", "47", "48"].map(names));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
