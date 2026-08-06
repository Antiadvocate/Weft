/* Smoke test: NOBODY ASKS THE SAME QUESTION FOUR TIMES.
 *
 * Mable, three turns running, in almost the same words:
 *
 *   t122 "I want to know what I am to you when you are not afraid and not hoping."
 *   t123 "What am I to you when you're not afraid and not hoping?"
 *   t124 "I asked what I am to you when you're not afraid and not hoping."
 *
 * Her drive was "Get Rabi to give her a concrete place in his life" — a want that cannot be
 * advanced by anything she DOES, only by the player answering. tickDrives documents this failure
 * exactly and has an escape hatch for it... measured against `drive.updated_turn`.
 *
 * Which the bookkeeper restamps every single turn the question is live, because it rewrites the
 * blocker each turn ("his answer was warm but vague, and the horn interrupted"). So the staleness
 * counter read 2 forever, the abandonment could never fire, and the threshold was forty turns
 * anyway. The escape hatch was disarmed by the loop it exists to break — the same shape as the
 * arrival timer measured against a field stamped every turn. */
import { newSave, registerCharacter } from "../src/engine/state";
import { tickDrives, edgeNote, applyEdgeDelta, getEdge, STALLED_WANT_TURNS, NOTE_FRESH_TURNS, NOTE_STALE_TURNS } from "../src/engine/social";
import { nagDirective } from "../src/engine/turn";
import { beliefLine } from "../src/engine/memory";
import { REFLECTION_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function withWant(goal: string, progress = 30): { s: SaveState; id: string } {
  const s = newSave("stall", { name: "V" } as any);
  s.world.places["loc_room"] = { id: "loc_room", name: "Rabi's floor", description_facts: "", contains: [] };
  s.world.player_location = "loc_room";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, { name: "Mable" } as any);
  s.characters[id].location = "loc_room";
  s.characters[id].drive = { goal, progress, priority: 1, updated_turn: 1 };
  s.world.current_turn = 1;
  return { s, id };
}

/* 1. the loop, reproduced: the bookkeeper restamps updated_turn every turn */
{
  const { s, id } = withWant("Get Rabi to give her a concrete place in his life, not just feelings.");
  for (let t = 2; t <= 2 + STALLED_WANT_TURNS + 2; t++) {
    s.world.current_turn = t;
    // exactly what the bookkeeper does while the question is on the table: rewrite the blocker,
    // restamp updated_turn, and leave progress where it was
    if (s.characters[id].drive) {
      s.characters[id].drive!.blocker = `his answer was warm but vague (turn ${t})`;
      s.characters[id].drive!.updated_turn = t;
    }
    tickDrives(s, () => 0.5);
  }
  check("the want is eventually given up on", !s.characters[id].drive, s.characters[id].drive);
  check("giving up is remembered", (s.memory[id]?.episodic ?? []).some((m: any) => /stopped asking/i.test(m.content)),
    (s.memory[id]?.episodic ?? []).map((m: any) => m.content));
}

/* 2. ...and it happens on a human timescale, not forty turns */
{
  const { s, id } = withWant("Get Rabi to say what she is to him.");
  for (let t = 2; t <= 1 + STALLED_WANT_TURNS; t++) {
    s.world.current_turn = t;
    if (s.characters[id].drive) s.characters[id].drive!.updated_turn = t;
    tickDrives(s, () => 0.5);
  }
  check(`it does not fire before ${STALLED_WANT_TURNS} turns of no progress`, !!s.characters[id].drive);
  s.world.current_turn = 2 + STALLED_WANT_TURNS;
  if (s.characters[id].drive) s.characters[id].drive!.updated_turn = s.world.current_turn;
  tickDrives(s, () => 0.5);
  check("and it does fire once the window passes", !s.characters[id].drive, s.characters[id].drive);
}

/* 3. a want that is actually MOVING is never taken away */
{
  const { s, id } = withWant("Finish the north wall before the frost.", 10);
  for (let t = 2; t <= 2 + STALLED_WANT_TURNS * 3; t++) {
    s.world.current_turn = t;
    const d = s.characters[id].drive;
    if (d) { d.progress = Math.min(95, d.progress + 5); d.updated_turn = t; }   // real work, every turn
    tickDrives(s, () => 0.5);
  }
  check("a want being worked on survives", !!s.characters[id].drive, s.characters[id].drive);
  check("its progress clock tracks the movement", (s.characters[id].drive!.progress ?? 0) > 30);
}

/* 4. a want that is nearly done is not abandoned for stalling at the end */
{
  const { s, id } = withWant("Get the charter signed.", 80);
  for (let t = 2; t <= 2 + STALLED_WANT_TURNS + 3; t++) {
    s.world.current_turn = t;
    if (s.characters[id].drive) s.characters[id].drive!.updated_turn = t;
    tickDrives(s, () => 0.5);
  }
  check("something 80% done is not thrown away", !!s.characters[id].drive, s.characters[id].drive);
}

/* 5. the progress clock is seeded for saves written before it existed */
{
  const { s, id } = withWant("An old want from a save with no progress clock.");
  delete (s.characters[id].drive as any).progress_turn;
  s.world.current_turn = 50;
  tickDrives(s, () => 0.5);
  check("an unseeded drive is not instantly abandoned", !!s.characters[id].drive, s.characters[id].drive);
  check("and it now carries a progress clock", s.characters[id].drive!.progress_turn === 50, s.characters[id].drive);
}

/* A FEELING NEEDS A DATE ON IT OR IT IS NOT A FEELING, IT IS LAW.
 *
 * `notes` is one 140-char slot holding the last thing the bookkeeper said about a relationship, and
 * the bookkeeper writes at moments of friction, because friction is what it notices. It was served
 * to the narrator every turn with no date, sitting right beside the current warmth and trust — and
 * it is far the more vivid of the two, so it won.
 *
 * The save that exposed it: Mable at warmth 59.2, trust 19.7. The cue for those numbers says in as
 * many words "the warmth is real and shows... do not write a caring character as a distant
 * stranger". Beside it sat, undated, "The offer was made while walking away, which deepens her
 * sense of being offered a role rather than chosen as a person" — written on turn 127. On turn 164
 * she was still being played from it: thirty-seven turns of scenes derived from one bad evening,
 * with the ledger calling her fond the whole way. From the chair that is a person who cannot be
 * reached and will not say why. */
{
  const edges: any[] = [];
  const mable = () => {
    const e = getEdge(edges, "char_mable", "char_player");
    e.warmth = 59.2; e.trust = 19.7;
    e.notes = "The offer was made while walking away, which deepens her sense of being offered a role rather than chosen as a person.";
    e.notes_turn = 127;
    return e;
  };

  const e = mable();
  check("a note written this turn is served as it is", edgeNote(e, 127) === e.notes);
  check("and still is while it is fresh", edgeNote(e, 127 + NOTE_FRESH_TURNS) === e.notes);

  const dated = edgeNote(e, 140);
  check("past the fresh window it is dated", /13 turns ago/.test(dated), dated);
  check("and the numbers are said to outrank it", /warmth and trust above are current and outrank it/.test(dated), dated);
  check("the note itself is still there", dated.startsWith("The offer was made"), dated);

  check("the exact case: at turn 164 it is gone", edgeNote(e, 164) === "", edgeNote(e, 164));
  check("it survives right up to the staleness line", edgeNote(e, 127 + NOTE_STALE_TURNS) !== "");

  // a cold edge keeps its note forever — there "old rivals" is simply true, not a stale mood
  const cold = getEdge(edges, "char_doren", "char_player");
  cold.warmth = -30; cold.trust = -20;
  cold.notes = "Old rivals; he has never forgiven the business with the mill.";
  cold.notes_turn = 10;
  check("a note on a cold edge is never dropped", edgeNote(cold, 400) !== "", edgeNote(cold, 400));
  check("it is dated all the same", /390 turns ago/.test(edgeNote(cold, 400)));

  // an unstamped note from a save made before this existed reads as fresh rather than ancient
  const legacy = getEdge(edges, "char_x", "char_player");
  legacy.warmth = 50; legacy.notes = "She is waiting for him to say it plainly.";
  check("a legacy note is not treated as infinitely old", edgeNote(legacy, 900) === legacy.notes);

  // and an empty note is nothing
  const blank = getEdge(edges, "char_y", "char_player");
  blank.warmth = 10; blank.notes = "";
  check("no note, nothing rendered", edgeNote(blank, 50) === "");

  // writing a note now stamps it, so the clock starts
  const fresh = getEdge(edges, "char_z", "char_player");
  applyEdgeDelta(edges, { from: "char_z", to: "char_player", warmth_delta: -4, trust_delta: 0, power_delta: 0, note: "He said it walking away." }, 200);
  check("writing a note stamps the turn", fresh.notes_turn === 200, fresh.notes_turn);
  check("and a delta with no note leaves the old stamp alone", (() => {
    applyEdgeDelta(edges, { from: "char_z", to: "char_player", warmth_delta: 2, trust_delta: 0, power_delta: 0 }, 240);
    return fresh.notes_turn === 200;
  })(), fresh.notes_turn);
}

/* THE GOALPOST DOES NOT MOVE ON DELIVERY.
 *
 *   t126  She asks what she is to him. He answers about somebody else.
 *         "I didn't ask about Andrea. I asked about me. That's an answer too." She leaves.
 *   t127  He gives her the answer, exactly the one she asked for: wife, co-ruler.
 *         "Co-ruler. You say it walking away, like it's a thing you're leaving on the table."
 *
 * The condition for success was revealed only after it had been failed. No action available on
 * turn 127 could have counted, because the requirement was never the words. */
{
  check("no outstanding asks, no directive", nagDirective([]) === "");

  const d = nagDirective(["Mable", "Andrea"]);
  check("it names who is waiting", /Mable, Andrea/.test(d), d.slice(0, 80));
  check("the question does not get asked a third time", /DO NOT ASK IT AGAIN/.test(d));
  check("taking the answer given is one of the ways out", /they take the answer they were given and act on it/.test(d));

  check("and a delivered yes is a delivered yes", /THE PLAYER GIVES IT, THEY HAVE GIVEN IT/.test(d), d);
  check("being hurt by HOW it came stays available", /may absolutely be hurt by HOW it came/.test(d));
  check("what is refused is keeping the want open on that ground", /keep the want open, and go on being owed it/.test(d));
  check("an unwinnable condition is named as the harm",
    /the condition for success is revealed only after they have failed it/.test(d), d);
  check("a still-open want has to name what is concretely missing", /name it in one clause/.test(d));
  check("and the manner is explicitly not that thing", /"It wasn't said the right way" is not a concrete thing missing/.test(d));
}

/* MY OWN BELIEFS MAKE NO SENSE. I BELIEVE ANDREA?
 *
 * The player's belief ledger, straight out of the save:
 *
 *   t145  "Andrea sees what I cannot — she may be the only one who will tell me the truth."
 *   t155  "Andrea is right that I have moved too fast for them to trust me."
 *   t175  "Andrea is the only one who speaks plainly to me, and her advice to slow down was right."
 *
 * Their edge toward Andrea on those exact turns, read off the telemetry: -97, -98.5, -100. She had
 * also been dead for the last one. The reflection pass was given a name, an acquaintance label, a
 * goal, its existing beliefs and twenty episodic memories — and nothing about how the character
 * stands with anyone, or who is still alive. Andrea did say useful things in those memories, so
 * with no counterweight the model concluded she was the truth-teller, while the ledger recorded
 * total hatred and the world recorded a corpse. */
{
  const gone = new Map<string, string>([["andrea", "dead"], ["father caelus", "departed"]]);

  const live = beliefLine("Andrea is the only one who speaks plainly to me, and her advice to slow down was right.", gone);
  check("a belief about the dead is marked as such", /Andrea is dead/.test(live), live);
  check("and marked as history rather than a live read", /not a live read of the present/.test(live), live);
  check("the belief itself is not destroyed", live.startsWith("Andrea is the only one"), live);

  check("someone who merely left is marked too",
    /Father Caelus is departed/i.test(beliefLine("Father Caelus will bring the Church down on me.", gone)));

  const clean = "The peasants are slow to trust and need time to come to me on their own terms.";
  check("a belief about nobody in particular is untouched", beliefLine(clean, gone) === clean);
  check("a belief about the living is untouched",
    beliefLine("Mable is waiting for me to say it plainly.", gone) === "Mable is waiting for me to say it plainly.");
  check("no dead cast, nothing annotated", beliefLine("Andrea was right.", new Map()) === "Andrea was right.");

  // substring collisions must not fire — "Andreas" is not "Andrea"
  check("a longer name containing the dead one does not match",
    beliefLine("Andreas the mason still owes me for the winter.", gone) === "Andreas the mason still owes me for the winter.",
    beliefLine("Andreas the mason still owes me for the winter.", gone));

  const long = "x".repeat(300);
  check("an over-long belief is still clipped", beliefLine(long, gone).length < 200);

  // and the pass that WRITES beliefs is now told the standing, so these cannot be born
  const R = REFLECTION_SYSTEM;
  check("the standing block is declared binding on beliefs", /A BELIEF MAY NOT CONTRADICT HOW THIS PERSON ACTUALLY STANDS/.test(R));
  check("it says the standing outranks the memories", /That block outranks your reading of the memories, always/.test(R));
  check("it names the helpful-but-hated case explicitly", /the conviction that forms is NOT "she was the only one who told me the truth"/.test(R));
  check("and the dead are required to be past tense", /THE DEAD AND THE GONE ARE PAST TENSE/.test(R));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
