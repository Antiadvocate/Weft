/* THE SHOWER SCENE, AND THE FOUR THINGS THE ENGINE INSISTED ON SAYING DURING IT.
 *
 * "Who talks like this during sex? Who keeps moving people away from their dick during sex? ... Is
 *  she fucking him? No? Ok what is she doing exactly? ... And what is up with the fucking dialogue?"
 *
 * Eleven turns, one bathroom, two people. The complaints are four separate mechanisms, and none of
 * them is the narrator model having bad taste. Each is a per-turn injection built to be unrefusable
 * — because each was written to fix a narrator that ignored the thing — landing in the one register
 * that cannot carry it.
 *
 * 1. THE SILENCE DETECTOR WAS INVERTED. `spoke()` scores a quoted line as a character's when their
 *    name sits within ±90 characters of it. Good prose names somebody once and then writes "she",
 *    and in a two-hander the only NAME near her dialogue is the person she is talking TO. Sixty-one
 *    of Emily's lines across ten turns, every one scored as silence. MUTE_LIMIT is 2; her counter
 *    reached 10. So from turn three onward every turn carried "Emily has been in the room for N
 *    turns without a line ... asks the direct question ... Give Emily real speech this turn" — into
 *    a scene whose actual problem was that she would not stop talking.
 *
 * 2. THE CORE-TRAIT ROTATION IS A BLIND WHEEL. `(turn + id.length) % traits.length` over her card,
 *    emitted as "NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE ... If the scene seems to leave no
 *    room, that is the instruction — make the room." Her traits include "Talks to her plants by
 *    name and scolds them when they droop." The wheel reached it mid-blowjob and the narrator, doing
 *    as it was told, wrote: "Blanche needs water. That droopy bastard is judging us."
 *
 * 3. THE SCHEDULE SAYS THE HOUR OUT LOUD, EVERY TURN. The heads-up row licenses "they may say how
 *    much time they have" with nothing bounding how often. Three consecutive turns of sex: "twenty
 *    minutes before I have to be a professional person", "I've got like nineteen minutes", "I have
 *    fourteen minutes."
 *
 * 4. THE TURN CANNOT END WITHOUT DISENGAGING. TURN ENDINGS says an NPC never moves the player's body
 *    through a choice — "the turn stops at the grab, not after the player is relocated" — and that a
 *    turn ends where the fiction requires the player. Correct for a choice being taken from someone;
 *    catastrophic inside an act they declared themselves into, where the only legal ending left is
 *    to stop. Every turn from 2 to 10 ends by breaking contact and asking a question.
 *
 * And underneath all four: turn 10 is turn 9 with the first sentence deleted and the apostrophes
 * curled. The player typed "I'm just very confused about what's happening right now" and got the
 * previous page back.
 */
import { spoke, MUTE_LIMIT } from "../src/engine/speech";
import { sceneRegister } from "../src/engine/register";
import { findReprint, proseOverlap } from "../src/engine/echo";
import { habitDirective } from "../src/engine/authored";
import { scheduleDirective } from "../src/engine/schedule";
import { NARRATOR_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** The save's own prose, verbatim. */
const TURNS: Record<string, string> = JSON.parse(readFileSync("tests/fixtures/shower-turns.json", "utf8"));

/* ── 1. sixty-one lines that read as silence ─────────────────────────────────── */
{
  for (const t of ["5", "7", "8", "9", "10"]) {
    check(`turn ${t}: Emily is credited with speaking`, spoke(TURNS[t], "Emily", true), TURNS[t].slice(0, 80));
  }
  // Turn 9 is the hard case and the reason the ±90 window is not enough on its own: her name appears
  // exactly once, in the first sentence, and the only name beside her dialogue is the player's.
  check("turn 9 names Emily exactly once", (TURNS["9"].match(/Emily/g) ?? []).length === 1);
  check("...so neither the ±90 window nor the paragraph widening reaches it",
    !spoke(TURNS["9"], "Emily", false));
  check("the sole-speaker path is what carries it", spoke(TURNS["9"], "Emily", true));

  // Not a rubber stamp: somebody who genuinely is not in the room does not get credited.
  check("a character who is not the sole speaker and is unnamed is still silent",
    !spoke(TURNS["9"], "Priya", false));
  check("prose with no dialogue at all credits nobody",
    !spoke("The water ran. He stood under it a while and did not move.", "Emily", true));
  check("MUTE_LIMIT is still 2 — the fix is the detector, not the threshold", MUTE_LIMIT === 2);
}

/* ── 2. the register is read, and it reads this scene correctly ──────────────── */
{
  const r = sceneRegister(TURNS["9"]);
  check("the shower scene reads as intimate", r.intimate, r);
  check("...and therefore guarded", r.guarded, r);

  const kitchen = sceneRegister("Emily stood at the counter frowning at her phone. Rain ticked against the glass.");
  check("an ordinary domestic morning is not guarded", !kitchen.guarded, kitchen);

  const knife = sceneRegister("He had a knife out and nobody in the room moved.");
  check("danger is guarded too", knife.guarded && knife.dangerous, knife);
}

/* ── 3. the plant does not get scolded mid-sex ───────────────────────────────── */
{
  const state = {
    world: { current_turn: 9, present: ["char_player", "char_e"] },
    characters: {
      char_player: { name: "Rabi" },
      char_e: { name: "Emily", core_traits: [
        "Teases Rabi relentlessly when she's in a good mood, and checks on him quietly when she's not.",
        "Cannot resist a mirror; she checks her hair or her lipstick whenever she passes one.",
        "Talks to her plants by name and scolds them when they droop.",
      ] },
    },
    habits: {}, condition: {},
  } as unknown as SaveState;

  const ordinary = habitDirective(state, ["char_player", "char_e"], false);
  check("in an ordinary scene the trait rotation still fires", /NOT DECORATION/.test(ordinary), ordinary);
  check("...and it is still unrefusable when it does", /make the room/.test(ordinary));

  const guarded = habitDirective(state, ["char_player", "char_e"], true);
  check("in a guarded scene the rotation stands down", !/NOT DECORATION/.test(guarded), guarded);
  check("...and no trait is named at all", !/plants by name/.test(guarded), guarded);
}

/* ── 4. and nobody counts down the clock during it ───────────────────────────── */
{
  const mk = (): SaveState => ({
    world: { current_turn: 9, current_time: "Day 1, 08:36", present: ["char_player", "char_e"], places: {} },
    characters: {
      char_player: { name: "Rabi" },
      char_e: { name: "Emily", location: "loc_home", schedule: { blocks: [{
        id: "blk", what: "Grant-writing for the nonprofit", why: "it is the job",
        where: "the office", days: "weekdays", start: "09:00", end: "17:00", rigidity: "flexible",
      }] } },
    },
    world_bible: {}, condition: {},
  } as unknown as SaveState);

  const ordinary = scheduleDirective(mk(), ["char_player", "char_e"], false);
  const guarded = scheduleDirective(mk(), ["char_player", "char_e"], true);
  if (/minutes before they have to leave/.test(ordinary)) {
    check("ordinarily she may say how much time she has", /may say how much time they have/.test(ordinary), ordinary);
    check("in a guarded scene she does not say the number", !/may say how much time they have/.test(guarded), guarded);
    check("...and is told so in as many words", /do NOT say how much time they have/.test(guarded), guarded);
    check("she still knows the hour either way", /minutes before they have to leave/.test(guarded), guarded);
  } else {
    // The heads-up window did not open for this fixture; assert the shape of the text instead.
    check("the guarded branch exists in the shipped source",
      /do NOT say how much time they have/.test(readFileSync("src/engine/schedule.ts", "utf8")));
    check("...and the ordinary branch still licenses it",
      /may say how much time they have/.test(readFileSync("src/engine/schedule.ts", "utf8")));
  }
}

/* ── 5. an act already running does not stop so the turn can end ─────────────── */
{
  check("the carve-out is in the narrator's law",
    /DOES NOT GOVERN AN ACT ALREADY UNDERWAY/.test(NARRATOR_SYSTEM));
  check("...naming disengagement as the failure it is",
    /Do not disengage in order to end/.test(NARRATOR_SYSTEM));
  check("...and refusing the re-consent question as an ending",
    /re-authorise what they already declared/.test(NARRATOR_SYSTEM));
  check("...with the state of both bodies required on the page",
    /what is happening to whom/.test(NARRATOR_SYSTEM));
  check("the original rule it qualifies is still there",
    /the turn stops at the grab, not after the player is relocated/.test(NARRATOR_SYSTEM));
  check("the final check enforces it too",
    /is still running at the end of this turn/.test(NARRATOR_SYSTEM));

  // The off-topic-talk mandate is a cure, not a quota.
  check("small talk is no longer required in a scene that cannot hold it",
    /UNLESS the scene is intimate, dangerous, tense or hushed/.test(NARRATOR_SYSTEM));
}

/* ── 6. turn 10 was turn 9, and nothing noticed ──────────────────────────────── */
{
  const hit = findReprint(TURNS["9"], TURNS["10"]);
  check("the reprint is detected", !!hit, hit);
  check("...at very high overlap", (hit?.overlap ?? 0) >= 0.9, hit);
  check("...and quotes a real run back", (hit?.span ?? "").split(" ").length >= 8, hit);

  // Consecutive turns of the same conversation are NOT reprints — this is the false-positive guard.
  check("turn 8 following turn 7 is not a reprint", !findReprint(TURNS["7"], TURNS["8"]),
    proseOverlap(TURNS["7"], TURNS["8"]));
  check("turn 9 following turn 8 is not a reprint", !findReprint(TURNS["8"], TURNS["9"]),
    proseOverlap(TURNS["8"], TURNS["9"]));
  check("turn 7 following turn 5 is not a reprint", !findReprint(TURNS["5"], TURNS["7"]),
    proseOverlap(TURNS["5"], TURNS["7"]));
  check("a short held beat is never judged", !findReprint("She waited.", "She waited."));
  // The margin the REPRINT_FLOOR sits in, measured on this save: 0.99 for the reprint against
  // 0.31-0.53 for three pairs of genuine consecutive turns in the same room.
  check("the floor clears real consecutive turns by a wide margin",
    Math.max(proseOverlap(TURNS["7"], TURNS["8"]), proseOverlap(TURNS["8"], TURNS["9"])) < 0.6
    && proseOverlap(TURNS["9"], TURNS["10"]) > 0.95);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
