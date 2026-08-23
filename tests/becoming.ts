/* A fact the world does not hold yet, and is going to.
 *
 * The player writes what will be true — "all the buildings are water" — and how many turns the
 * world has to get there. It does not simply happen: each turn the world has to move toward it
 * through its own causes, and only a turn that actually moved spends one off the clock. When the
 * clock runs out the claim enters world.canon, where the CANON OVERRIDES YOUR DEFAULTS block that
 * already exists binds every line of prose after it.
 *
 * This is the authored-want pattern pointed at the world instead of at a person, built with the
 * lesson that cost that feature twenty playthroughs: the instruction is not the mechanism. Nothing
 * here decides by string match whether a building became water — the simulator reads the turn and
 * says whether the world moved, judged by meaning, and a turn that did nothing gets named in the
 * next turn's direction. A fact this large is where a false credit would be worst: the clock would
 * run out on a world that had not changed and the prose would have to pretend it had.
 *
 * The player's side is asymmetric on purpose. In ordinary play they cannot stop it — they can be
 * frightened of it, refuse it, work against it the whole way, and it arrives. In god mode they are
 * sovereign, so repudiation works, and it costs the world a turn rather than the war: the clock
 * goes up by one and it comes again from somewhere else.
 */
import { newBecoming, liveBecomings, becomingDirective, arrivalDirective, becomingAsk, applyBecomingProgress, CLAIM_MAX, STALL_LIMIT } from "../src/engine/becoming";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const CLAIM = "All the buildings are water";
function world(god = false, turns = 4) {
  const s: any = newSave("t", { name: "Vin" } as any);
  s.world_bible.god_mode = god;
  s.world.places["loc_x"] = { id: "loc_x", name: "The loft", description_facts: "k", contains: [] };
  s.world.player_location = "loc_x";
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  s.world.present = ["char_player"];
  s.world.current_turn = 5;
  s.becomings = [newBecoming(CLAIM, turns, 1)];
  return { s, b: s.becomings[0] };
}
const report = (over: any = {}) => [{ claim: CLAIM, moved: false, ...over }];

/* ── 1. the shape of one ──────────────────────────────────────────────────────── */
{
  const b = newBecoming(CLAIM, 4, 1);
  check("the claim is kept as written", b.claim === CLAIM);
  check("the clock is what was asked for", b.remaining === 4 && b.turns === 4);
  check("a zero-turn clock is still one turn", newBecoming(CLAIM, 0, 1).remaining === 1);
  const long = newBecoming("alpha beta gamma delta ".repeat(40), 3, 1).claim;
  check("a very long claim is cut on a word", "alpha beta gamma delta ".repeat(40).startsWith(long.replace(/…$/, "")), long.slice(-24));
  check("...within the ceiling", long.length <= CLAIM_MAX + 1);


  const { s } = world();
  check("it is live", liveBecomings(s).length === 1);
  s.becomings[0].arrived_turn = 9;
  check("...and not once it has landed", liveBecomings(s).length === 0);
  s.becomings[0].arrived_turn = undefined; s.becomings[0].paused = true;
  check("...nor while paused", liveBecomings(s).length === 0);
}

/* ── 2. what the narrator is told on the way ──────────────────────────────────── */
{
  const { s } = world();
  const d = becomingDirective(s);
  check("the world is told what it is turning into", /WHAT THIS WORLD IS TURNING INTO/.test(d), d);
  check("...carrying the claim", d.includes(CLAIM));
  check("the step is an event with a cause", /the step is an EVENT, in the world, with a cause/.test(d));
  check("the end state is not written", /THE END STATE IS NOT WRITTEN AND IS NOT NAMED/.test(d));
  check("...and nobody in it understands the shape", /no character understands the shape of it/.test(d));
  check("...and it may not jump ahead", /not one step further/.test(d));
  check("...and is never a scene about itself", /never as a scene about itself/.test(d));

  check("early on it is deniable", /could still be explained away/.test(becomingDirective(world(false, 8).s)));
  const near = world(false, 4); near.s.becomings[0].remaining = 1;
  check("at the end it is the last thing giving way", /THE LAST STEP/.test(becomingDirective(near.s)));

  check("nothing at all when there is nothing coming", becomingDirective(newSave("x", { name: "V" } as any) as any) === "");
}

/* ── 3. what the player can do about it ───────────────────────────────────────── */
{
  check("in ordinary play their resistance fails", /write their resistance honestly and write it failing/.test(becomingDirective(world(false).s)));
  check("...without the world gloating", /without anyone gloating/.test(becomingDirective(world(false).s)));
  check("in god mode it costs the world a turn", /cost the world a turn, never the outcome/.test(becomingDirective(world(true).s)));
}

/* ── 4. only a turn that moved spends a turn ──────────────────────────────────── */
{
  const { s, b } = world(false, 4);
  applyBecomingProgress(s, 6, report({ moved: true, how: "a wall in the stairwell went soft" }));
  check("a turn that moved counts", b.remaining === 3 && b.moved === 1, b);
  check("...and what moved it is kept for the player", b.last_move === "a wall in the stairwell went soft");

  applyBecomingProgress(s, 7, report({ moved: false }));
  check("a turn that did not move spends nothing", b.remaining === 3, b);
  check("...and is counted as a stall", b.stalled === 1);
  applyBecomingProgress(s, 8, report({ moved: false }));
  check(`...and named at ${STALL_LIMIT}`, /nothing moved toward/.test(applyBecomingProgress(s, 9, report({ moved: false })).shifts[0] ?? ""));
  check("...to the narrator too", /NOTHING ABOUT THIS MOVED FOR/.test(becomingDirective(s)), becomingDirective(s));

  // no report at all is not a stall — the same rule the want detector learned
  const before = { r: b.remaining, st: b.stalled };
  applyBecomingProgress(s, 10, undefined);
  check("no report is not a verdict", b.remaining === before.r && b.stalled === before.st);
  applyBecomingProgress(s, 11, [{ claim: "something else entirely", moved: true }]);
  check("...nor is a report about something else", b.remaining === before.r);
  // but a clipped or re-punctuated echo of THIS claim is still this claim
  applyBecomingProgress(s, 12, [{ claim: "all the buildings are water.", moved: true }]);
  check("a re-punctuated echo still matches", b.remaining === before.r - 1, b.remaining);
}

/* ── 5. arrival ───────────────────────────────────────────────────────────────── */
{
  const { s, b } = world(false, 2);
  applyBecomingProgress(s, 6, report({ moved: true }));
  const out = applyBecomingProgress(s, 7, report({ moved: true, how: "the last stair gave" }));
  check("the clock runs out", b.remaining === 0 && b.arrived_turn === 7);
  check("it becomes canon", s.world.canon.includes(CLAIM), s.world.canon);
  check("...stamped with when and who saw it", !!s.world.canon_meta?.[CLAIM.toLowerCase()]);
  check("...and the player is told", /is now true of this world/.test(out.shifts[0] ?? ""), out.shifts);
  check("it is no longer live", liveBecomings(s).length === 0);
  check("...so the approach directive stops", becomingDirective(s) === "");

  const a = arrivalDirective(out.arrived);
  check("the turn after says it on the page", /THIS IS TRUE NOW, IN THIS TURN, AND FROM HERE ON/.test(a), a);
  check("...and then it stops being news", /it is not news and it is not a subject/.test(a));
  check("nothing to announce, nothing said", arrivalDirective([]) === "");

  // a second arrival of the same claim must not duplicate the canon line
  const c = s.world.canon.length;
  applyBecomingProgress(s, 8, report({ moved: true }));
  check("canon is not written twice", s.world.canon.length === c);
}

/* ── 6. repudiation ───────────────────────────────────────────────────────────── */
{
  const { s, b } = world(true, 4);
  const out = applyBecomingProgress(s, 6, report({ moved: true, opposed: true }));
  check("in god mode the player pushes it back", b.remaining === 5 && b.repudiations === 1, b);
  check("...and it does not count as progress", b.moved === 0);
  check("...and the player is told it is still coming", /still coming/.test(out.shifts[0] ?? ""), out.shifts);
  check("...and the narrator is told to come from elsewhere", /from a direction they did not block/.test(becomingDirective(s)));

  const mortal = world(false, 4);
  applyBecomingProgress(mortal.s, 6, report({ moved: true, opposed: true }));
  check("without god mode opposing it changes nothing", mortal.b.remaining === 3 && mortal.b.repudiations === 0, mortal.b);
}

/* ── 7. what the bookkeeper is asked ──────────────────────────────────────────── */
{
  const { s } = world();
  const ask = becomingAsk(s);
  check("it is asked, by claim", ask.includes(CLAIM));
  check("...to judge by meaning", /Judge by what the turn MEANS, not by whether the words above appear/.test(ask));
  check("...with discussing it explicitly not counting", /only mentioned it, worried about it, or discussed it did NOT move it/.test(ask));
  check("...and to answer for every line", /Report every line, including the ones nothing happened to/.test(ask));
  check("nothing asked when nothing is coming", becomingAsk(newSave("x", { name: "V" } as any) as any) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
