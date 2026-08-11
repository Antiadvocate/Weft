/* Smoke test: HE ASKED A CITY OF A MILLION TO MARRY HIM AND NOBODY CAME.
 *
 * "Player broadcasts to all women of Rome he wants marriage, 0 women approach him. This is normal
 * because emperor of mankind wouldn't have a thousand women throw themselves at his feet even if he
 * was the cruelest thing on the planet."
 *
 * From the save, turns 13–16. He had that morning abolished slavery, put the army on public works,
 * and raised a school out of light in front of the Forum. Then:
 *
 *   t13  "Is there any woman here that would not manipulate me... if there is one around
 *         please come and say hi!"                                          — nobody came
 *   t14  "Go on and spread the news. I'm interested in a partner."          — nobody came
 *   t15  He puts the words into every mind in Rome and walks home.          — nobody came
 *   t16  "I wait to see what kind of women arrive."
 *        "The street gate stayed shut. No one knocked. […] The gate stayed shut."
 *
 * and the world's own report of those same hours was four separate people deciding NOT to approach:
 * a baker's boy who thought better of offering bread, a freedwoman crossing the lane, a tradesman
 * hardening a rumour into a warning, a matron telling her husband nobody went near the villa and
 * that was the right decision.
 *
 * Four things produced that, and every one of them is machinery rather than judgement:
 *
 * 1. THE ENGINE TOLD THE NARRATOR TO IGNORE HIM. power_witnessed was "mythic" from turn 1, and the
 *    tier gate hands a mythic player a standing line even at standing 0 — but the standing-0 band is
 *    written for an unremarkable stranger. Verbatim, on the turn he sat at his own gate to wait:
 *    "Strangers treat them as a stranger: neither afraid nor impressed, occupied with their own
 *    lives. Do not have crowds react to the player as a known quantity; they are not one yet."
 *
 * 2. NOTHING HE DID COULD MOVE HIS STANDING. PUBLIC_BOON was a list of emergency-rescue verbs —
 *    pull them out, put the fire out, hold the gate, stand between. It had no reading for a person
 *    who PROVIDES. Measured across all seventeen turns of this save: zero matches, standing 0.00.
 *    The harm list has always had both registers (murder AND enslave, terrorize), so the scale was
 *    legible in one direction only, and one murder would have moved him further than everything he
 *    actually did.
 *
 * 3. AN OPEN CALL HAD NO CHANNEL TO BE ANSWERED. Exactly two routes existed by which a new person
 *    could reach the player: arrivals_pending, which fires only for an already-carded character
 *    whose recorded drive already names him, and inbound, which fires only when the offstage pass
 *    volunteers a contact. The crowd — the tier with the million people in it — is licensed to react
 *    and explicitly forbidden a name unless the PLAYER singles someone out. Every route required him
 *    to reach first. A call inverts that, and nothing could hear one.
 *
 * 4. THE OFFSTAGE RULE BANNED APPROACH AND PERMITTED AVOIDANCE. "No stranger developing an opinion
 *    about them" — obeyed in one direction, because turning away reads as the world being busy while
 *    turning toward reads as staged for the player. Hence four avoidances and no approaches.
 */
import { openCallReach, openCallDirective, trackOpenCall, creditCallAnswer } from "../src/engine/population";
import { publicStandingDirective, updatePublicStanding } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FORUM = "loc_forum", VILLA = "loc_villa", ROOM = "loc_room";
function world(loc = FORUM, turn = 13, time = "Day 1, 10:25 (Morning)"): SaveState {
  return {
    world: {
      current_turn: turn, current_time: time, player_location: loc, present: [], edges: [],
      places: {
        [FORUM]: { id: FORUM, name: "The Forum Romanum", population: { scale: 5000, who: "advocates, litigants, priests, pickpockets" } },
        [VILLA]: { id: VILLA, name: "Rabi's villa", population: { scale: 2, who: "the villa's resident and few attendants" } },
        [ROOM]: { id: ROOM, name: "The back room", population: { scale: 4, who: "whoever is drinking here" } },
      },
    },
    characters: { char_player: { name: "Rabi" } },
  } as unknown as SaveState;
}

/* ── 1. the three calls he actually made are heard as calls ───────────────────── */
{
  const s = world();
  const CALLS = [
    `"Oh wow she's gone. Excellent. Now maybe I can find a real wife. Is there any woman here that would not manipulate me into giving her what she wants and would be genuinely in love with me? I'm open for dating. Just a nice woman if there is one around please come and say hi!"`,
    `"Well yea. I am the emperor of Rome. Go on and spread the news. I'm interested in a partner. A companion. If there's any woman that wants to sit at the healm of power let her know I'm open."`,
    `I broadcast the message into every mind in Rome. I'm interested in marriage. I'm looking for a specific type of person. And I list her. And then I stand up and head back to my villa.`,
    `"Anyone want to talk. Anyone at all. Let's talk engineering. Anyone here worth actually talking to"`,
  ];
  CALLS.forEach((c, i) => check(`call ${i + 1} is heard`, openCallReach(s, c) > 0, c.slice(0, 50)));
  check("the one that went into every mind reached past the room",
    openCallReach(s, CALLS[2]) > openCallReach(world(VILLA), CALLS[0]), [openCallReach(s, CALLS[2])]);
}

/* ── 2. ...and ordinary turns are not calls ───────────────────────────────────── */
{
  const s = world();
  const NOT = [
    "I walk outside to the city to see how things are going ignoring Marcella",
    "I sit and watch the crowd and make myself a latte.",
    "I tilt my head as well because I have no other means of conveying the same confusion",
    `"The house is yours. I am not yours. I am my own. You have lost me."`,
    `"I will find my way without you. Go find someone else to manipulate"`,
    "I wait to see what kind of women arrive",
    "I ask her if anyone has been to the villa",     // a question to ONE person about others
  ];
  NOT.forEach((a) => check(`not a call: "${a.slice(0, 40)}…"`, openCallReach(s, a) === 0, openCallReach(s, a)));
}

/* ── 3. a standing call is put to the narrator, with a floor that is not zero ─── */
{
  const s = world(FORUM, 15, "Day 1, 10:40 (Morning)");
  trackOpenCall(s, "I broadcast the message into every mind in Rome. I'm interested in marriage.");
  const d = openCallDirective(s);
  check("the call is on the state", !!s.world.open_call, s.world.open_call);
  check("and the narrator is told about it", /AN OPEN CALL IS STANDING/.test(d));
  check("with the reach", /thousands/.test(d), d.slice(0, 200));
  check("and told that unanimous refusal is not on the menu", /whole population declining in unison/.test(d));
  check("standing decides who and why, not whether", /a different scene, not an empty one/.test(d));
}

/* ── 4. and it escalates rather than evaporating ──────────────────────────────── */
{
  const s = world(FORUM, 15, "Day 1, 10:40 (Morning)");
  trackOpenCall(s, "I broadcast the message into every mind in Rome. I'm interested in marriage.");
  check("no nagging on the turn it is made", !/NOBODY HAS ANSWERED/.test(openCallDirective(s)));
  s.world.current_turn = 16; s.world.current_time = "Day 1, 12:40 (Afternoon)";
  trackOpenCall(s, "I wait to see what kind of women arrive");   // a non-call must not clear it
  check("waiting does not withdraw the call", !!s.world.open_call);
  const d = openCallDirective(s);
  check("a turn later it is overdue", /NOBODY HAS ANSWERED IT YET, a turn on/.test(d), d.slice(-200));
  check("and someone must answer on the page", /SOMEONE ANSWERS IT THIS TURN/.test(d));
}

/* ── 5. it closes when answered, and when it goes stale ───────────────────────── */
{
  const s = world(FORUM, 15, "Day 1, 10:40 (Morning)");
  trackOpenCall(s, "I broadcast the message into every mind in Rome. I'm interested in marriage.");
  creditCallAnswer(s); creditCallAnswer(s);
  check("two arrivals do not close a call to a city", !!s.world.open_call, s.world.open_call);
  creditCallAnswer(s);
  check("three do — the story has what it needed", !s.world.open_call);

  const small = world(ROOM, 15, "Day 1, 10:40 (Morning)");
  trackOpenCall(small, `"Anyone here want to talk? Come say hi"`);
  creditCallAnswer(small);
  check("but one answer closes a call put to a back room", !small.world.open_call);

  const stale = world(FORUM, 15, "Day 1, 10:40 (Morning)");
  trackOpenCall(stale, "I broadcast the message into every mind in Rome. I'm interested in marriage.");
  stale.world.current_time = "Day 4, 10:40 (Morning)";
  check("and a call nobody answered in three days is over", openCallDirective(stale) === "");
  trackOpenCall(stale, "I eat breakfast");
  check("...and is cleared off the state", !stale.world.open_call);
}

/* ── 6. a small room may genuinely answer with silence ────────────────────────── */
{
  const s = world(ROOM, 15, "Day 1, 10:40 (Morning)");
  trackOpenCall(s, `"Anyone here want to talk? Come say hi"`);
  const d = openCallDirective(s);
  check("four people can leave a call hanging, and it says so", /possibly nobody/.test(d), d.slice(0, 300));
  s.world.current_turn = 16;
  check("and it is never nagged about at that scale", !/SOMEONE ANSWERS IT THIS TURN/.test(openCallDirective(s)));
}

/* ── 7. a witnessed power is not an unremarkable stranger ─────────────────────── */
{
  const s = world();
  s.world.public_standing = 0;
  const mortal = publicStandingDirective(s, "mortal");
  const mythic = publicStandingDirective(s, "mythic");
  check("an ordinary unknown still gets no standing line at all", mortal === "");
  check("a mythic player at standing 0 is not written as ignorable",
    !/they are not one yet|neither afraid nor impressed/.test(mythic), mythic);
  check("the crowd reacts to the power as settled and the person as open",
    /WATCHED, AND NOT YET JUDGED/.test(mythic) && /never be written as indifference/.test(mythic));
  check("and the reactions are required to run both ways", /Someone approaches; someone else leaves/.test(mythic));
  s.world.public_standing = -7;
  check("a genuinely feared player still reads as feared", /FEARED/.test(publicStandingDirective(s, "mythic")));
  s.world.public_standing = 7;
  check("and a beloved one as beloved", /BELOVED/.test(publicStandingDirective(s, "mythic")));
}

/* ── 8. providing moves a reputation, not only rescuing ───────────────────────── */
{
  const bump = (action: string, prose = "") => {
    const s = world();
    s.world.public_standing = 0;
    updatePublicStanding(s, action, prose || "The crowd watched Rabi do it.", "mythic", "mythic");
    return s.world.public_standing!;
  };
  check("building a free school counts",
    bump(`"Done. That's an easy one" I create the building for the school. "Free lunches. Free schooling and they bring home grain everyday"`) > 0);
  check("abolishing slavery counts", bump("I abolish slavery across the empire") > 0);
  check("forgiving every debt counts", bump("I cancel all debts owed to the treasury") > 0);
  check("feeding the city counts", bump("I fed the city out of the new granary") > 0);
  // ...and a bug found while writing this, older than any of it: the rescue list's `pulled \w+
  // (out|free|clear)` could span exactly ONE word, so "pulled him clear" scored and "pulled the
  // child clear" — the commonest phrasing of the commonest rescue on the list — never did.
  check("rescuing still counts", bump("I pulled him clear of the fire") > 0);
  check("...including the phrasing that could never match before", bump("I pulled the child clear of the fire") > 0);
  check("...and the same for carrying someone out", bump("I carried the old woman to safety") > 0);
  check("and killing still costs", bump("I made an example of the man who spoke") < 0);

  // the guard on the other side: a wall to keep people out is not a benefaction
  check("a wall is not a school", bump("I build a wall around my villa to keep them out") === 0,
    bump("I build a wall around my villa to keep them out"));
  check("an ordinary turn moves nothing", bump("I sit and watch the crowd and make myself a latte.") === 0);
}

/* ── 9. a standing deed is not paid for twice ─────────────────────────────────
 *
 * This is the trap the fix walked into on its first draft. A rescue is an EVENT — narrated once,
 * never mentioned again. A building is a FACT: the school stands in the prose for the rest of the
 * story. Scored the same way, the second one pays out forever, and replaying this save the standing
 * climbed on turns 6 and 8 off "built a school" and "built a granary" in the NARRATION — one of
 * which had been built four months before the game began. The works family reads the action only. */
{
  const s = world();
  s.world.public_standing = 0;
  updatePublicStanding(s, "I tilt my head because I have no other way to convey confusion",
    "Rabi had built a school here, and the crowd still came to look at it. He had built a granary too.", "mythic", "mythic");
  check("the narrator mentioning the school he built last week pays nothing", s.world.public_standing === 0, s.world.public_standing);

  s.world.public_standing = 0;
  updatePublicStanding(s, "I put out the fire", "The crowd saw Rabi do it.", "mythic", "mythic");
  const byAction = s.world.public_standing!;
  s.world.public_standing = 0;
  updatePublicStanding(s, "I go over to look", "Rabi pulled the child clear of the blaze while the crowd watched.", "mythic", "mythic");
  check("but a rescue in the prose still counts, because it happens once", s.world.public_standing! > 0, [byAction, s.world.public_standing]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
