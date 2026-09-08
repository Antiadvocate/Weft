/* Smoke test: SHE WAS IN THE ROOM AND ELSEWHERE AT THE SAME TIME.
 *
 * "Nothing, and worse. The denise situation. I have no clue what is happening."
 *
 * From the save, turn 61. Amber is in `world.present`, in a coffee shop, with her hand on the
 * player's sleeve. The world report for that same turn opens:
 *
 *   "Elsewhere: Amber takes the receipt slip with the district number on it, folds it once, and
 *    gets up — not to the door, to the bulletin board by the restrooms... gets her right sneaker
 *    off standing up, heel against the baseboard, sock down, one foot bare on the floor..."
 *
 * Two hundred words of her being somewhere else while the player was looking at her. The offstage
 * cast filter excluded the player, the dead and the departed and nothing else, so a character
 * standing in the scene was handed to a pass whose own first line reads "you report what happened
 * ELSEWHERE, to people who were not thinking about the protagonist". Both versions are then filed
 * as memory — the bookkeeper wrote "Amber's history now carries 1 defining moment" off the one that
 * never happened.
 *
 * AND DENISE IS NOT A PERSON. The same report carries two hundred words of "Denise comes out of the
 * back at last... spends eleven minutes trying to shim the spindle", and three threads were opened
 * about her over twelve turns. There is no Denise in `state.characters`: no card, no location, no
 * memory, no voice. `actorId` is null for her, and every consequence downstream — the memory, the
 * edges, the witnesses — was already skipped on that basis. The narrative was not. It went to the
 * player in full, which is what having no clue what is happening is made of. */
import { worldDigest, applyOffstage, type OffstageEvent } from "../src/engine/offstage";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const world = (present: string[]) => ({
  world: { current_turn: 61, current_time: "Day 1, 12:20 (Afternoon)", present,
    player_location: "loc_shop", places: {
      loc_shop: { id: "loc_shop", name: "Coffee Shop" }, loc_home: { id: "loc_home", name: "The Living Room" },
      loc_offscene: { id: "loc_offscene", name: "elsewhere" } },
    threads: [], clocks: [], consequences: [], rumors: [], edges: [], canon: [] },
  characters: {
    char_player: { character_id: "char_player", name: "Joe", location: "loc_shop" },
    char_amber: { character_id: "char_amber", name: "Amber", pronouns: "she/her", location: "loc_shop", drive: { goal: "get the job" } },
    char_ruth: { character_id: "char_ruth", name: "Ruth", pronouns: "she/her", location: "loc_home", drive: { goal: "finish the letter" } },
  },
  memory: {}, condition: {}, traits: {}, model_settings: {}, world_bible: { name: "The Apartment", era: "contemporary" },
} as any);

/* ── 1. who the pass is allowed to write about ───────────────────────────────── */
{
  const d = worldDigest(world(["char_amber"]));
  check("SOMEBODY IN THE ROOM IS NOT ELSEWHERE", !/^- Amber/m.test(d), "Amber is still on the offstage roster");
  check("...while the person who really is offstage still is", /^- Ruth/m.test(d), d.slice(0, 400));
  const none = worldDigest(world([]));
  check("...and with an empty room everybody is available again", /^- Amber/m.test(none) && /^- Ruth/m.test(none));
}
{
  // the same exclusion on the witness roster: someone beside the player cannot witness an offstage act
  const d = worldDigest(world(["char_amber"]));
  const who = d.split("\n").filter((l) => /Coffee Shop:|Living Room:/.test(l)).join(" ");
  check("a present character is not offered as a witness to something elsewhere",
    !/Amber/.test(who), who);
}

/* ── 2. a person who does not exist does not get a life ──────────────────────── */
{
  const s = world([]);
  const events: OffstageEvent[] = [
    { actor: "Denise", what: "Denise comes out of the back with a box cutter and spends eleven minutes shimming the receipt spindle.", place: "Coffee Shop" } as any,
    { actor: "Ruth", what: "Ruth finishes the letter and leaves it propped against the kettle.", place: "The Living Room" } as any,
    { what: "Rain gathers in dirty puddles against the curb outside.", place: "Coffee Shop" } as any,
  ];
  const log = applyOffstage(s, events).join("\n");
  check("A PHANTOM'S SUBPLOT DOES NOT REACH THE PLAYER", !/Denise/.test(log), log);
  check("...a real character's does", /Ruth finishes the letter/.test(log), log);
  check("...and ambient weather, which has no actor, is the point of the pass",
    /Rain gathers in dirty puddles/.test(log), log);
}
{
  // and nothing is filed for the phantom either — no memory invented for somebody with no bank
  const s = world([]);
  applyOffstage(s, [{ actor: "Denise", what: "Denise takes the clipboard into the back.", place: "Coffee Shop" } as any]);
  const banks = Object.keys(s.memory ?? {});
  check("no memory bank is conjured for somebody who is not in the cast",
    !banks.some((k) => /denise/i.test(k)), banks);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
