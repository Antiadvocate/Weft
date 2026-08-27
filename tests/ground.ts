/* Smoke test: THE CONTAINER AND ITS CONTENTS, plus the two other places the kernel wasn't reaching.
 *
 * Three findings, all measured:
 *
 *  1. A place was furniture. Of Amber's thirty episodic memories in the Ashford save, eighteen carry
 *     a `where` — the place is filed with the memory and fades out of it as the memory fades — and
 *     nothing in the engine ever connected one to a nervous system. You could walk into the room
 *     where the worst conversation of your life happened at exactly the relaxation you left the
 *     street with.
 *  2. Offstage events never touched a body. Zero references to relaxation or psyche in offstage.ts.
 *     A man could get the first call to his dead husband's brother since the funeral, file it as a
 *     memory, seed a rumour off it, and sit at the same number.
 *  3. `central` gated simulation as well as rendering, and the gated systems are all zero-token
 *     (0 LLM references across emotions.ts, desire.ts, fault.ts, social.ts, remodel.ts). Excluding
 *     background characters from them saved nothing; the card is what costs, and their card is one
 *     line either way.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { placeCharge, tickArrivals, groundCue, MAX_CHARGE } from "../src/engine/ground";
import { applyOffstage, eventImpact, actorValence, OFFSTAGE_SHOVE } from "../src/engine/offstage";
import { tickEmotions } from "../src/engine/emotions";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function mem(turn: number, where: string, charge: string, content = "something happened", importance = 5) {
  return { turn, content, importance, emotional_charge: charge, where, last_accessed_turn: turn, source: "witnessed" as const };
}

function world() {
  const s: any = newSave("t", { name: "Vin" } as any);
  s.world.places["loc_house"] = { id: "loc_house", name: "The house on Quarry Street", description_facts: "", contains: [] };
  s.world.places["loc_street"] = { id: "loc_street", name: "Ellis Street", description_facts: "", contains: [] };
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Amber", character_id: "char_a" } as any);
  registerCharacter(s, { name: "Leo", character_id: "char_l" } as any);
  s.world.current_turn = 40;
  s.characters["char_a"].location = "loc_street";
  return s;
}

/* ── 1. a room holds what happened in it ────────────────────────────────────── */
{
  const s = world();
  s.memory["char_a"].episodic = [
    mem(4, "The house on Quarry Street", "grief", "the argument that ended it", 8),
    mem(6, "The house on Quarry Street", "shame", "I said the unforgivable thing", 7),
  ];
  const c = placeCharge(s, "char_a", "loc_house");
  check("a place two bad things happened in has a charge", c.shove < -0.2, c);
  check("...and it names the one that carries most of it", /argument|unforgivable/.test(c.strongest?.content ?? ""), c.strongest?.content);

  const warm = world();
  warm.memory["char_a"].episodic = [
    mem(4, "The house on Quarry Street", "relief", "he came home", 7),
    mem(6, "The house on Quarry Street", "joy", "we laughed until it hurt", 7),
  ];
  check("a place good things happened in pulls the other way", placeCharge(warm, "char_a", "loc_house").shove > 0.2);

  const mixed = world();
  mixed.memory["char_a"].episodic = [
    mem(4, "The house on Quarry Street", "grief", "the argument", 7),
    mem(6, "The house on Quarry Street", "joy", "the good morning after", 7),
  ];
  check("a place that holds both mostly cancels", Math.abs(placeCharge(mixed, "char_a", "loc_house").shove) < 0.3,
    placeCharge(mixed, "char_a", "loc_house"));
}

/* ── 2. and the ways it cannot become a haunted world ───────────────────────── */
{
  const s = world();
  s.memory["char_a"].episodic = [mem(4, "The house on Quarry Street", "", "an ordinary Tuesday", 3)];
  check("one ordinary memory is not a charge", placeCharge(s, "char_a", "loc_house").shove === 0);

  const solo = world();
  solo.memory["char_a"].episodic = [mem(4, "The house on Quarry Street", "terror", "the night of the fire", 9)];
  check("...but one that mattered enough is", placeCharge(solo, "char_a", "loc_house").shove < 0, placeCharge(solo, "char_a", "loc_house"));

  const huge = world();
  huge.memory["char_a"].episodic = Array.from({ length: 12 }, (_, i) => mem(i, "The house on Quarry Street", "grief", "another bad night", 10));
  check("no amount of history exceeds the cap", Math.abs(placeCharge(huge, "char_a", "loc_house").shove) <= MAX_CHARGE + 0.001,
    placeCharge(huge, "char_a", "loc_house").shove);

  // HABITUATION, the term that stops a character being shoved by their own front door forever.
  const lived = world();
  lived.memory["char_a"].episodic = [
    mem(30, "The house on Quarry Street", "grief", "the argument", 8),
    mem(32, "The house on Quarry Street", "shame", "the second one", 8),
    mem(34, "The house on Quarry Street", "", "a Tuesday", 3),
    mem(36, "The house on Quarry Street", "", "another Tuesday", 3),
    mem(38, "The house on Quarry Street", "", "and another", 3),
  ];
  const avoided = world();
  avoided.memory["char_a"].episodic = [
    mem(2, "The house on Quarry Street", "grief", "the argument", 8),
    mem(3, "The house on Quarry Street", "shame", "the second one", 8),
  ];
  check("the room you are in every day stops doing this to you",
    Math.abs(placeCharge(lived, "char_a", "loc_house").shove) < Math.abs(placeCharge(avoided, "char_a", "loc_house").shove),
    { lived: placeCharge(lived, "char_a", "loc_house").shove, avoided: placeCharge(avoided, "char_a", "loc_house").shove });

  // IT IS THEIRS. The same room, two people.
  const two = world();
  two.memory["char_a"].episodic = [mem(2, "The house on Quarry Street", "grief", "the argument", 8), mem(3, "The house on Quarry Street", "shame", "the rest of it", 8)];
  two.memory["char_l"].episodic = [];
  check("the same room is charged for one person and inert for another",
    placeCharge(two, "char_a", "loc_house").shove < 0 && placeCharge(two, "char_l", "loc_house").shove === 0);

  check("nowhere is not a place", placeCharge(two, "char_a", "loc_offscene").shove === 0);
}

/* ── 3. arrival, and only arrival ───────────────────────────────────────────── */
{
  const s = world();
  s.memory["char_a"].episodic = [mem(2, "The house on Quarry Street", "grief", "the argument", 8), mem(3, "The house on Quarry Street", "shame", "the rest", 8)];
  const before = s.condition["char_a"].psyche.relaxation;
  const log = tickArrivals(s, [{ id: "char_a", to: "loc_house" }]);
  check("walking in moves the body before anybody speaks", s.condition["char_a"].psyche.relaxation < before,
    { before, after: s.condition["char_a"].psyche.relaxation });
  check("...and it is reported", log.length === 1 && /still had it/.test(log[0]), log);
  const after = s.condition["char_a"].psyche.relaxation;
  tickArrivals(s, []);       // a turn spent standing in the same room
  check("standing in it does not re-administer it", s.condition["char_a"].psyche.relaxation === after);
  check("...and the card cue goes quiet with it", groundCue(s, "char_a") === "");
}
{
  const s = world();
  s.memory["char_a"].episodic = [mem(2, "The house on Quarry Street", "grief", "the argument", 8), mem(3, "The house on Quarry Street", "shame", "the rest", 8)];
  tickArrivals(s, [{ id: "char_a", to: "loc_house" }]);
  const cue = groundCue(s, "char_a");
  check("the card says the room, not the feeling", /not neutral|the body knows the room/.test(cue), cue);
  check("...and never a number or a named emotion", !/-?\d/.test(cue) && !/grief|shame|afraid|sad/i.test(cue), cue);
  check("...and does not make them announce it", /does not have to mention it/.test(cue));
}

/* ── 4. offstage events move the bodies that lived them ─────────────────────── */
{
  check("a hard thing reads hard", eventImpact("Leo's brother died on Tuesday and the funeral is Friday") === -1);
  check("a good thing reads good", eventImpact("the loan was approved and she paid off the last of it") === 1);
  check("an ordinary thing moves nobody", eventImpact("the tram ran on the new timetable for the first time") === 0);
  check("this is a different question from what it makes you think of somebody",
    eventImpact("a fever went through the row houses and two children died") === -1 &&
    actorValence("a fever went through the row houses and two children died") === 0);

  const s = world();
  s.characters["char_a"].location = "loc_street";
  s.characters["char_l"].location = "loc_street";
  const before = { a: s.condition["char_a"].psyche.relaxation, l: s.condition["char_l"].psyche.relaxation, p: s.condition["char_player"].psyche.relaxation };
  applyOffstage(s, [{ actor: "Amber", place: "Ellis Street", what: "Amber's mother died on Tuesday", witnesses: ["Leo"] }] as any);
  check("the person it happened to takes it", s.condition["char_a"].psyche.relaxation < before.a - 1, s.condition["char_a"].psyche.relaxation);
  check("...and somebody who only watched takes half", 
    s.condition["char_l"].psyche.relaxation < before.l && s.condition["char_l"].psyche.relaxation > s.condition["char_a"].psyche.relaxation,
    { actor: s.condition["char_a"].psyche.relaxation, witness: s.condition["char_l"].psyche.relaxation });
  check("...and it lowers the resting point rather than washing out next turn", (s.condition["char_a"].psyche.grief_drag ?? 0) > 0);
  check("the player is never moved by something they were not in", s.condition["char_player"].psyche.relaxation === before.p);
  check("the shove is bounded", before.a - s.condition["char_a"].psyche.relaxation <= OFFSTAGE_SHOVE + 0.001);
}

/* ── 5. simulation LOD is not render LOD ────────────────────────────────────── */
{
  const s = world();
  s.characters["char_l"].central = false;              // furniture, by the card
  s.world.present = ["char_player", "char_a", "char_l"];
  for (const id of ["char_a", "char_l"]) {
    s.condition[id].psyche.relaxation = 5;
    s.condition[id].psyche.active_states = ["anger at the verdict"];
    s.condition[id].psyche.state_ages = { "anger at the verdict": 30 };
  }
  s.world.current_turn = 40;
  tickEmotions(s);
  check("a background character's held feeling resolves like anybody's",
    !s.condition["char_l"].psyche.active_states.includes("anger at the verdict"),
    s.condition["char_l"].psyche.active_states);
  check("...the same way the central one's did", !s.condition["char_a"].psyche.active_states.includes("anger at the verdict"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
