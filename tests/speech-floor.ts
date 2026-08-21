/* Smoke test: "regular people do not use one liners."
 *
 * Measured over one save — 178 turns, 154 of them with somebody else in the room:
 *
 *   · median turn is 12% spoken words. 71% of turns are under 20%. 32% are under 5%.
 *   · 29 turns have people present and not one line of dialogue in them. Turn 139: 447 words,
 *     two people in the room, nobody speaks.
 *   · Miranda is present for 136 turns and has no line in 87 of them. Sixty-four percent.
 *   · of the 691 lines anybody does say, half are six words or fewer, a third are four or fewer.
 *   · somebody goes "very still" 100 times across 80 turns — 45% of every turn in the game.
 *
 * Two engine causes, and in both of them the engine was instructing exactly this.
 *
 * ONE. The relaxation band for a clenched character read "clipped, guarded, or barbed". Every one
 * of those words means says less, and it is on a card the narrator reads every turn — so the
 * engine's answer to a character being angry was that they stop talking. Two fields down the same
 * record sits the attachment model, which says half of all people escalate under threat: they
 * pursue, they re-check, they protest. Miranda's own record says anxious, hyper-vigilant,
 * controlling. She was silent in 87 turns. The band was overriding the model.
 *
 * TWO. Every character introduced after the opening was built by a pass whose entire instruction
 * for core_traits was "2-4 real personality traits, not plot function". The four people it made:
 *
 *   'patient to the point of immovability', 'observant of small physical tells', 'quietly weary'
 *   'level-headed under pressure', 'watchful, reads people before rooms', 'quietly stubborn'
 *   'procedurally exact', 'flatly unshockable', 'quietly humane', 'conserving her energy'
 *   'unflappable', 'guarded', 'quietly kind under a bureaucratic surface', 'stubborn'
 *
 * Sixteen adjectives, none of which names a thing a hand does. The world forge has had the answer
 * in its prompt since it was written — the COULD YOU FILM IT test, with ADJECTIVES named as failure
 * mode (a) — and the pass that needed it had never seen it. And five of the five people that pass
 * built answer fear by getting quieter: goes flatter and slower, goes flatter and more procedural,
 * drops her voice. A cast that all falls silent under pressure is a horror film, which is what the
 * player called it.
 *
 * Both of those are prompt fixes. Prompt fixes do not hold, so this is the detector.
 */
import { dialogueShare, shortLineShare, spokenLines, spoke, speechDirective, trackSilence, DIALOGUE_FLOOR, SHORT_LINE } from "../src/engine/speech";
import { filmableTrait, unfilmableTraits } from "../src/engine/coerce";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the traits the mid-game pass actually produced ────────────────────────── */
{
  const MADE_BY_THE_SKETCH_PASS = [
    "direct", "warm", "over-responsible", "hard to shock",
    "protective to the point of overstepping", "emotionally clenched", "stubborn", "quietly loyal",
    "patient to the point of immovability", "observant of small physical tells", "quietly weary",
    "fair by rule rather than by sympathy", "procedurally exact", "flatly unshockable",
    "quietly humane under the boredom", "conserving her energy", "level-headed under pressure",
    "watchful, reads people before rooms", "wry — deflects strain with understatement",
    "quietly stubborn", "unflappable", "guarded", "quietly kind under a bureaucratic surface",
  ];
  const MADE_BY_THE_WORLD_FORGE = [
    "Will re-fold a napkin or straighten a picture frame in a restaurant without realizing she's doing it.",
    "Has a laugh that starts as a surprised, sharp 'Ha!' before dissolving into silent, shoulder-shaking giggles.",
    "Asks deeply personal questions with the same cheerful, detached curiosity she'd use to ask about a book you're reading.",
    "Cannot sit still; she's always tapping a foot, twisting a ring, or re-arranging the objects on a table.",
    "Shows affection by including you. If she loves you, you will be invited to everything.",
    "Listens more than he speaks, and when he does speak, it's usually to ask a question that gently reframes the entire conversation.",
    "Has a habit of polishing his glasses on his shirt when he's buying time to think.",
    "Will always, always take the seat facing the door in any room.",
    // and the contract's own worked examples
    "Answers before the other person has finished, every time, and never notices.",
    "Takes a full breath before she says anything at all, even to say yes.",
    "Will not eat anything from fresh water, and cannot say why.",
    "Sleeps with the shutter open in any weather.",
    "Could untangle any knot before she could read; still does it while thinking.",
    "Mimics any accent she hears within a day, badly at first, then perfectly.",
    "Holds everything — cup, knife, child — in the same two-handed grip.",
    "Counts under her breath when she is waiting: steps, coins, sheep.",
    "Goes to the water when anything goes wrong, and only then.",
    "Cannot pass a dog without stopping.",
  ];
  const missed = MADE_BY_THE_SKETCH_PASS.filter(filmableTrait);
  const lost = MADE_BY_THE_WORLD_FORGE.filter((t) => !filmableTrait(t));
  check(`all ${MADE_BY_THE_SKETCH_PASS.length} temperatures are caught`, missed.length === 0, missed);
  check(`all ${MADE_BY_THE_WORLD_FORGE.length} behaviours are kept`, lost.length === 0, lost);
  check("a whole cast's worth comes back named", unfilmableTraits(MADE_BY_THE_SKETCH_PASS).length === 23);
  check("...and a good one comes back empty", unfilmableTraits(MADE_BY_THE_WORLD_FORGE).length === 0);
  check("an empty list is not a failure", unfilmableTraits(undefined).length === 0 && unfilmableTraits([]).length === 0);
  check("blanks are not traits", !filmableTrait("") && !filmableTrait("   "));
}

/* ── 2. measuring a turn ──────────────────────────────────────────────────────── */
{
  // turn 143 of the save, opening — 394 words, two people present, no dialogue at all
  const SILENT = `The locks were already thrown. He checked them anyway — the deadbolt at the front door, the chain, the back door's latch. There was no gun safe under the bed. There was no Keltec shotgun. There had never been either. He stood in the guest room with his hand on the bedframe, fingers curling against the quilt.`;
  check("a turn with nobody speaking measures zero", dialogueShare(SILENT) === 0);
  check("...and no lines to be short", shortLineShare(SILENT) === 0);
  check("...and it is under the floor", dialogueShare(SILENT) < DIALOGUE_FLOOR);

  const TALKY = `"You knew," Miranda said. "You knew for a week and you sat at that table and let me tell you about the fellowship like it was good news, and you let me finish." She did not sit down. "Say something. Say the thing you have been not saying since Tuesday, because I would rather hear it than watch you decide how to phrase it."`;
  check("a turn that is mostly talking measures high", dialogueShare(TALKY) > 0.6, dialogueShare(TALKY));
  check("...and clears the floor", dialogueShare(TALKY) >= DIALOGUE_FLOOR);
  check("...with lines that are not fragments", shortLineShare(TALKY) < 0.5, shortLineShare(TALKY));
  check("both her lines are found", spokenLines(TALKY).length === 2, spokenLines(TALKY));

  // A DIALOGUE TAG DOES NOT MAKE TWO LINES. This is the false positive that would have had the
  // guard scolding the narrator for writing dialogue properly.
  const INTERRUPTED = `"You knew," Miranda said, "and you let me finish the whole story about the fellowship before you said one word about it."`;
  check("an interrupted line counts once", spokenLines(INTERRUPTED).length === 1, spokenLines(INTERRUPTED));
  check("...and is not a fragment", shortLineShare(INTERRUPTED) === 0, shortLineShare(INTERRUPTED));
  const TWO_PEOPLE = `"You knew." She did not sit down. "Say something."`;
  check("two finished lines stay two", spokenLines(TWO_PEOPLE).length === 2, spokenLines(TWO_PEOPLE));

  const FRAGMENTS = `"Okay," she said. He looked at the table. "Fine." A car went past outside and the light moved across the wall and neither of them said anything for a while. "Sure."`;
  check("a turn of one-liners is caught as fragments", shortLineShare(FRAGMENTS) === 1, shortLineShare(FRAGMENTS));
  check(`...where a fragment is ${SHORT_LINE} words or fewer`, spokenLines(FRAGMENTS).every((l) => l.split(/\s+/).length <= SHORT_LINE));

  check("a line is attributed by the name beside it", spoke(TALKY, "Miranda"));
  check("...and not to somebody who was only in the room", !spoke(TALKY, "Marcus"));
  check("curly quotes count too", spokenLines(`“I heard you,” he said.`).length === 1);
}

/* ── 3. the correction fires on the evidence, and only on the evidence ─────────── */
{
  function scene() {
    const s: any = newSave("t", { name: "Vin" } as any);
    s.world.places["loc_x"] = { id: "loc_x", name: "The kitchen", description_facts: "k", contains: [] };
    s.world.player_location = "loc_x";
    registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
    const m = registerCharacter(s, { name: "Miranda", age: 38, background: "b", core_traits: ["t"] } as any);
    s.characters[m].location = "loc_x";
    s.characters[m].attachment = { style: "anxious", under_threat: "hyper-vigilant and controlling", soothed_by: "x" };
    s.world.present = ["char_player", m];
    s.world.current_turn = 10;
    return { s, m };
  }

  const { s, m } = scene();
  const SILENT = `He put the kettle on. She stood by the window with her arms folded and did not move. The light went orange on the wall and the kettle began to tick as it heated.`;
  trackSilence(s, SILENT);
  check("the count is written down", s.last_speech?.share === 0 && s.last_speech?.turn === 10, s.last_speech);
  check("her silence is counted", s.speech_silence?.[m] === 1);
  s.world.current_turn = 11;
  check("one silent turn is not yet the thing to fix", !/without a line/.test(speechDirective(s)), speechDirective(s));
  check("...but the thin turn is named immediately", /0% of the words were spoken aloud/.test(speechDirective(s)), speechDirective(s));

  trackSilence(s, SILENT);
  s.world.current_turn = 12;
  const d = speechDirective(s);
  check("two turns mute and she is named", /Miranda has been in the room for 2 turns without a line/.test(d), d);
  check("...with her own way of escalating, from her own record", /asks again, follows them across the room/.test(d), d);
  check("...and the instruction is to give her speech", /Give Miranda real speech this turn/.test(d));

  // a turn that is actually a conversation says nothing at all
  const { s: s2, m: m2 } = scene();
  trackSilence(s2, `"You knew," Miranda said, "and you let me finish the whole story about the fellowship before you said one word about it."`);
  s2.world.current_turn = 11;
  check("a good turn draws no correction", speechDirective(s2) === "", speechDirective(s2));
  check("...and her counter is reset", s2.speech_silence?.[m2] === 0);

  // nobody in the room is not a silence
  const { s: s3 } = scene();
  s3.world.present = ["char_player"];
  trackSilence(s3, `He sat in the car for a while with the engine off.`);
  s3.world.current_turn = 11;
  check("an empty room is not somebody refusing to talk", speechDirective(s3) === "");

  // stale evidence is not evidence
  const { s: s4 } = scene();
  trackSilence(s4, SILENT);
  s4.world.current_turn = 40;
  check("a measurement from thirty turns ago is not used", speechDirective(s4) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
