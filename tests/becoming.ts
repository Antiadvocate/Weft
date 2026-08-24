/* A fact the world does not hold yet, and is going to.
 *
 * The player writes what will be true — "all the buildings are water" — and how many turns the
 * world has to get there. THE COUNT IS THE INSTRUCTION: every turn spends one, and when the clock
 * runs out the claim enters world.canon, where the CANON OVERRIDES YOUR DEFAULTS block that already
 * exists binds every line of prose after it.
 *
 * The clock used to be conditional on the simulator reporting that the world had visibly moved, and
 * that was wrong in both directions. It is the same mistake that cost the authored wants twenty
 * playthroughs — gating a mandatory thing on a model report, when the report is the very thing that
 * fails — and it inverted the deal, because a turn the narrator skipped is a turn the player is
 * owed, not a turn that never happened. A narrator that never found a way in froze the clock
 * forever while the player watched it say "stalled" every turn and nothing approached.
 *
 * So the report is still read, and it is pressure rather than a brake: a becoming that has not
 * reached the page is BEHIND, and the next turn is told to carry the ground it missed as well as
 * its own. The last turn completes the whole change in full, on the page, however much was left.
 *
 * The player's side is asymmetric on purpose. In ordinary play they cannot stop it — they can be
 * frightened of it, refuse it, work against it the whole way, and it arrives on schedule. In god
 * mode they are sovereign, so repudiation holds the clock still for that turn, and it comes again
 * from somewhere else. They can hold it off forever by paying for it every turn.
 */
import { newBecoming, liveBecomings, arrivedBecomings, becomingDirective, becomingBehind, becomingLaw, arrivalDirective, becomingAsk, applyBecomingProgress, CLAIM_MAX, STALL_LIMIT, WORN_IN } from "../src/engine/becoming";
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
  check("the block is framed as mandatory", /NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE/.test(d), d);
  check("...and refuses every excuse by name", /too busy for it, that the conversation matters more, or that it would land better later/.test(d));
  check("...and leaves no version of the turn without it", /There is no version of this turn in which none of it can be seen/.test(d));
  check("...and says the count is a deadline", /THE COUNT IS A DEADLINE/.test(d));
  check("each beat is an event with a cause", /Each beat is an EVENT with a cause/.test(d));
  check("the world acts on its own", /THE WORLD DOES THIS NOW, on its own, without anybody deciding it/.test(d));
  check("the end state is not named", /DO NOT NAME THE END STATE/.test(d));
  check("...and nobody in it understands the shape", /no character understands the shape of it/.test(d));

  check("early on it is deniable", /could still be explained away/.test(becomingDirective(world(false, 8).s)));
  const near = world(false, 4); near.s.becomings[0].remaining = 1;
  check("at the end the whole change completes", /THE LAST TURN OF IT/.test(becomingDirective(near.s)), becomingDirective(near.s));
  check("...in full, on the page", /the whole change completing, physically, where somebody can see it/.test(becomingDirective(near.s)));

  check("nothing at all when there is nothing coming", becomingDirective(newSave("x", { name: "V" } as any) as any) === "");
}

/* ── 3. what the player can do about it ───────────────────────────────────────── */
{
  check("in ordinary play their resistance fails", /Write their resistance honestly and write it failing/.test(becomingDirective(world(false).s)));
  check("...without the world gloating", /without anyone gloating/.test(becomingDirective(world(false).s)));
  check("in god mode it costs the world a turn", /they can cost it a turn, never the outcome/.test(becomingDirective(world(true).s)));
}

/* ── 4. the clock is a clock ──────────────────────────────────────────────────── */
{
  // This was conditional on the simulator reporting movement, and it froze: a narrator that never
  // found a way in left the clock stopped forever while the player watched it report "stalled"
  // every turn. The count is the player's instruction — every turn spends one.
  const { s, b } = world(false, 4);
  applyBecomingProgress(s, 6, report({ moved: true, how: "a wall in the stairwell went soft" }));
  check("a turn that moved counts", b.remaining === 3 && b.moved === 1, b);
  check("...and what moved it is kept for the player", b.last_move === "a wall in the stairwell went soft");

  const out = applyBecomingProgress(s, 7, report({ moved: false }));
  check("a turn the prose skipped ALSO spends a turn", b.remaining === 2, b);
  check("...and says so plainly", /did not show this turn — it lands on schedule anyway, 2 turns to go/.test(out.shifts[0] ?? ""), out.shifts);
  check("...and is counted as behind", b.stalled === 1 && b.moved === 1);

  applyBecomingProgress(s, 8, report({ moved: false }));
  check("...and the narrator is told it is behind, not that it is frozen", /THIS HAS NOT REACHED THE PAGE FOR 2 TURNS while its clock ran/.test(becomingDirective(s)), becomingDirective(s));
  const behind = becomingBehind(s);
  check("...and gets a second, louder block of its own", /THIS WAS ORDERED AND THE TURNS CAME BACK WITHOUT IT/.test(behind), behind);
  check("...naming the count and what is left", /ordered for 2 turns and absent from all of them; 1 turn left/.test(behind), behind);
  check("...and putting it in the opening lines", /WRITE IT FIRST THIS TURN/.test(behind));
  check("...with no second block while it is keeping up", becomingBehind(world(false, 4).s) === "");
  check("...and told to make the ground up", /further along than one step would have left it/.test(becomingDirective(s)));

  // no report from the bookkeeper does not stop the world either
  const quiet = world(false, 3);
  applyBecomingProgress(quiet.s, 6, undefined);
  check("a silent bookkeeper does not stop the clock", quiet.b.remaining === 2, quiet.b);
  const other = world(false, 3);
  applyBecomingProgress(other.s, 6, [{ claim: "something else entirely", moved: true }]);
  check("...nor does a report about something else", other.b.remaining === 2 && other.b.moved === 0, other.b);
}

/* ── 5. arrival ───────────────────────────────────────────────────────────────── */
{
  const { s, b } = world(false, 2);
  applyBecomingProgress(s, 6, report({ moved: true }));
  const out = applyBecomingProgress(s, 7, report({ moved: true, how: "the last stair gave" }));
  check("the clock runs out", b.remaining === 0 && b.arrived_turn === 7);
  check("it becomes canon", s.world.canon.includes(CLAIM), s.world.canon);
  check("...stamped with when and who saw it", !!s.world.canon_meta?.[CLAIM.toLowerCase()]);
  check("...and the player is told", /is true of this world now/.test(out.shifts[0] ?? ""), out.shifts);
  check("it is no longer live", liveBecomings(s).length === 0);
  check("...so the approach directive stops", becomingDirective(s) === "");

  const a = arrivalDirective(out.arrived);
  check("the turn after says it on the page", /THIS IS TRUE NOW, IN THIS TURN, AND FROM HERE ON/.test(a), a);
  check("...and then it stops being news", /it is not news and it is not a subject/.test(a));
  check("nothing to announce, nothing said", arrivalDirective([]) === "");

  // IT LANDS ON THE TURN THE PLAYER SET, whether or not the prose ever kept up. The last turn's
  // direction is what carries the whole change; the clock does not wait for the narrator.
  const ignored = world(false, 3);
  applyBecomingProgress(ignored.s, 6, report({ moved: false }));
  applyBecomingProgress(ignored.s, 7, report({ moved: false }));
  const last = applyBecomingProgress(ignored.s, 8, report({ moved: false }));
  check("a becoming the prose ignored still lands on schedule", ignored.b.arrived_turn === 8, ignored.b);
  check("...and is canon", ignored.s.world.canon.includes(CLAIM));

  // a second arrival of the same claim must not duplicate the canon line
  const c = s.world.canon.length;
  applyBecomingProgress(s, 8, report({ moved: true }));
  check("canon is not written twice", s.world.canon.length === c);
}

/* ── 6. repudiation ───────────────────────────────────────────────────────────── */
{
  const { s, b } = world(true, 4);
  const out = applyBecomingProgress(s, 6, report({ moved: true, opposed: true }));
  check("in god mode the player holds the clock still", b.remaining === 4 && b.repudiations === 1, b);
  check("...and it does not count as progress", b.moved === 0);
  check("...and the player is told it is still coming", /still coming/.test(out.shifts[0] ?? ""), out.shifts);
  check("...and the narrator is told to come from elsewhere", /from a direction they did not block/.test(becomingDirective(s)));

  const mortal = world(false, 4);
  applyBecomingProgress(mortal.s, 6, report({ moved: true, opposed: true }));
  check("without god mode opposing it changes nothing", mortal.b.remaining === 3 && mortal.b.repudiations === 0, mortal.b);
  check("...the clock ran anyway", mortal.b.turns - mortal.b.remaining === 1);
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




/* ── 8. true, and nobody living in it ─────────────────────────────────────────── */
{
  // From the save that prompted this: three becomings reached the end of their clocks and entered
  // canon, two of them having never once been shown. The turn after all three were true produced a
  // laugh, a wine bottle and a conversation about dinner. When the player finally acted on one
  // himself, the character he did it to was written as STARTLED — against a canon line saying it is
  // as normal as breathing and nobody comments on it.
  //
  // Canon is a constraint against CONTRADICTION. It does nothing to make a scene contain a thing.
  // The authored wants have three phases; becomings had two, and this is the missing middle.
  const { s, b } = world(false, 2);
  applyBecomingProgress(s, 6, report({ moved: false }));
  applyBecomingProgress(s, 7, report({ moved: false }));
  check("it arrived without ever being shown", b.arrived_turn === 7 && b.moved === 0, b);
  check("...so it is not finished with", arrivedBecomings(s).length === 1);
  check("...and the approach directive is done", becomingDirective(s) === "");

  const law = becomingLaw(s);
  check("the world is told to be the place where it is true", /WHAT IS TRUE OF THIS WORLD NOW/.test(law), law);
  check("...carrying the claim", law.includes(CLAIM));
  check("...and saying it has never been seen", /has not been seen once; it shows in THIS scene/.test(law), law);
  check("nobody is surprised by it", /NOBODY IS SURPRISED BY THEM/.test(law));
  check("...and a startled character is named as the tell", /reacting to one as though it were new is the clearest possible sign/.test(law));
  check("nobody announces it either", /NOBODY ANNOUNCES THEM EITHER/.test(law));
  check("...it is visible only in what people do", /visible only in what people do without thinking about it/.test(law));
  check("...and the scene makes room", /make the room, in one sentence if that is all there is/.test(law));

  // showing it counts, and after enough of it the canon line carries it alone
  for (let t = 8; t < 8 + WORN_IN; t++) applyBecomingProgress(s, t, report({ moved: true, how: "she set her bare feet on the rail without looking" }));
  check(`after ${WORN_IN} showings it is worn in`, (b.shown ?? 0) >= WORN_IN, b);
  check("...and stops being pushed", becomingLaw(s) === "", becomingLaw(s));
  check("...while canon still holds it", s.world.canon.includes(CLAIM));

  // the bookkeeper is asked about arrived ones too, or `shown` could never move
  const { s: s2 } = world(false, 1);
  applyBecomingProgress(s2, 6, report({ moved: false }));
  check("an arrived becoming is still asked about", becomingAsk(s2).includes(CLAIM), becomingAsk(s2));
  check("...under a heading that covers both", /TURNING INTO, OR HAS TURNED INTO/.test(becomingAsk(s2)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
