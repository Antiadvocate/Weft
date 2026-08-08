/* Smoke test: THE WOMAN YOU LEFT CAN SEND YOU A TEXT.
 *
 * The player checked into a hotel. Tessa stayed in the apartment with the recorded want
 *
 *   "Get through the next day without calling him, and fail at it"
 *
 * and for twenty turns she did not exist. The offstage log for those turns is three background
 * regulars having busy evenings; her name appears nowhere in it.
 *
 * Two causes. The world-sim's first rule was "nothing you write may involve, mention, target,
 * describe, anticipate, or be caused by the player character" — written to stop the world orbiting
 * the protagonist, and so absolute that it forbade the pass from touching the one person whose
 * every want was about him. And even if it had written her, there was no channel: offstage events
 * reach the player only through witnesses and rumor, which models a village, not a phone. */
import { newSave, registerCharacter, sanitize } from "../src/engine/state";
import { OFFSTAGE_SYSTEM, worldDigest, offstageDue, offstageIntervalTurns, OFFSTAGE_INTERVAL_TURNS } from "../src/engine/offstage";
import { syncPresence } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("arr", { name: "The Arrangement", era: "contemporary" } as any);
  s.world.places["loc_apt"] = { id: "loc_apt", name: "The Apartment", description_facts: "Two rooms.", contains: [] };
  s.world.places["loc_hotel"] = { id: "loc_hotel", name: "Hotel", description_facts: "A room off a corridor.", contains: [] };
  s.world.player_location = "loc_hotel";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const t = registerCharacter(s, { name: "Tessa" } as any);
  s.characters[t].location = "loc_apt";
  s.characters[t].drive = { goal: "Get through the next day without calling him, and fail at it", progress: 20, priority: 1, updated_turn: 44,
    blocker: "next: she gets as far as the contact screen and puts the phone down, four times before noon" } as any;
  s.world.current_turn = 45;
  return s;
}

/* 1. the rule no longer forbids the cast's own wants */
{
  const P = OFFSTAGE_SYSTEM;
  check("inventing the player into the world is still banned", /you do not INVENT the player into the world/.test(P));
  check("no threat forming, no discovery planted", /no threat forming|no discovery planted/.test(P));
  check("but a recorded want about the player is required, not forbidden",
    /IT IS NOT A RULE ABOUT THE CAST'S OWN WANTS/.test(P));
  check("with the distinction stated", /never invent a relationship to the player\. Always honour one that is already written down/.test(P));
  check("and the case that exposed it", /without calling him, and fail at it/.test(P));
}

/* 2. she is visible to the pass, with her want intact */
{
  const dig = worldDigest(world());
  check("Tessa is in the cast digest", /Tessa/.test(dig), dig.slice(0, 200));
  check("with her actual want", /without calling him/.test(dig));
  check("and where she is", /The Apartment/.test(dig));
  check("and what she is stuck on", /contact screen/.test(dig));
}

/* 3. there is now a channel that is not witness-and-rumor */
{
  const P = OFFSTAGE_SYSTEM;
  check("the schema offers direct contact", /reaches_player/.test(P));
  check("only when the event IS the contact", /ONLY when this event IS somebody deliberately contacting the player/.test(P));
  check("naming the medium", /a text, a call, a letter, turning up at the door/.test(P));
  check("and carrying the words as sent", /typos and all/.test(P));
}

/* 4. what arrives is delivered, then cleared */
{
  const s = world();
  s.world.inbound = [{ from: "Tessa", how: "a text at 11:40", content: "i know you dont want to hear from me. i just need to know youre eating.", turn: 45 }];
  check("it survives a save round trip", (sanitize(JSON.parse(JSON.stringify(s))).world.inbound ?? []).length === 1);

  // syncPresence consumes it the way it consumes an arrival, so it is delivered exactly once
  syncPresence(s);
  check("it is cleared after the turn that renders it", (s.world.inbound ?? []).length === 0, s.world.inbound);
}

/* 5. an ordinary offstage event is unchanged — most events reach nobody */
{
  const P = OFFSTAGE_SYSTEM;
  check("omitting it is the default", /Omit entirely otherwise; most events are not aimed at anyone/.test(P));
  check("the cast is still the substance, not walk-ons", /Invented walk-ons .* are the SEASONING/.test(P));
}

/* 6. AND THE WORLD TICKS OFTEN ENOUGH TO BE A WORLD.
 *
 * A flat 25-turn interval is right for a kingdom and absurd for a kitchen. In this save the last
 * report was turn 32 and the player was on turn 45: thirteen turns in a hotel room with a
 * three-person cast, none of whom were allowed to do anything, and twelve more to wait. */
{
  const s = world();
  s.world.offstage_last_time = "Day 2, 08:45 (Morning)";
  s.world.offstage_last_turn = 32;
  s.world.current_time = "Day 2, 11:40 (Morning)";   // under the six-hour clock
  s.world.current_turn = 45;

  check("a two-person cast ticks fast", offstageIntervalTurns(s) === 6, offstageIntervalTurns(s));
  check("and this save is long overdue", offstageDue(s), { last: 32, now: 45 });

  // a crowded world does not need reports as often — the visible cast generates its own motion
  const big = world();
  for (let i = 0; i < 12; i++) registerCharacter(big, { name: `Extra${i}` } as any);
  check("a large cast keeps the old interval", offstageIntervalTurns(big) === OFFSTAGE_INTERVAL_TURNS, offstageIntervalTurns(big));

  const mid = world();
  for (let i = 0; i < 3; i++) registerCharacter(mid, { name: `Mid${i}` } as any);
  check("a middling cast sits in between", offstageIntervalTurns(mid) === 10, offstageIntervalTurns(mid));

  // the in-world clock still fires it regardless of turn count
  const slept = world();
  slept.world.offstage_last_time = "Day 1, 22:00 (Night)";
  slept.world.offstage_last_turn = 44;
  slept.world.current_time = "Day 2, 09:00 (Morning)";
  check("a long night still moves the world", offstageDue(slept));

  // and it does not fire every turn
  const fresh = world();
  fresh.world.offstage_last_time = "Day 2, 11:30 (Morning)";
  fresh.world.offstage_last_turn = 44;
  fresh.world.current_time = "Day 2, 11:40 (Morning)";
  fresh.world.current_turn = 45;
  check("one turn later is not due", !offstageDue(fresh));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
