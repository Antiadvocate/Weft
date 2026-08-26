/* "Everybody else sounds basically the same. Amber sounds like a 36-year-old programmer instead of
 *  what she actually is." — and: "Miranda apparently does not give a shit about the fact that she
 *  just got divorced. Nothing in her characterization showed up in the prose."
 *
 * TWO MECHANISMS, BOTH ALREADY IN THE ENGINE, BOTH MISSING THEIR CASE.
 *
 * ONE — THE VOICES WERE NEVER SENT. The forge writes superb, distinct voices: a 19-year-old
 * pharmacy tech whose words are the counter, the register, closing and the schedule; a designer who
 * talks in kerning, negative space and hex codes; a teacher who reaches for dumplings and innings.
 * All of it on the cards, all of it excellent.
 *
 * Measured over 91 turns of one save: 318 spoken lines between those five people, containing NONE
 * of their registers. Not a diluted amount — none.
 *
 * The block whose own heading is "WHO IS TALKING, AND WHY NONE OF THEM SHOULD SOUND ALIKE" was
 * sending an age, three core traits and the first sentence of a background. None of that says how
 * anybody SOUNDS. The fields that do were on the cached card and deliberately not repeated per turn
 * to save tokens — deriveVoice says so in as many words. That economy cost the entire voice system.
 *
 * AND THE FIX'S OWN FIX. What went into the slot first was one of the character's actual lines,
 * because a sample does more than a description. It does — it gets reused. A finished sentence
 * printed immediately before "now write the scene", every turn, came back as itself until the cast
 * were broken records saying their two lines forever. So the slot carries the IDIOLECT now: the
 * person's way of using language, NAMED, which has to be performed onto whatever is in the room
 * rather than pasted. The checks below pin both halves — the voice reaches the turn, and nothing
 * quotable does.
 *
 * TWO — GRIEF NEEDED ONE BIG BLOW. relaxation drifts back toward capacity every turn, so a hit that
 * is not caught by grief_drag is erased within a few turns. The trigger was a single delta of -3 or
 * worse: it catches a betrayal in one scene and misses a marriage ending across forty turns of -2s.
 *
 * The save: a woman whose husband took his ring off, left it on the table, walked out with his
 * suitcases and demanded she sign — memories charged "furious grief" and "devastated and bitter",
 * mood string "furious and aching", active states "fixated on Vin" and "replaying it" — sitting at
 * relaxation -0.5 against a capacity of +2, with no grief_drag whatsoever. Everything the bookkeeper
 * recorded was right. The one number the narrator renders from said nothing had happened.
 */
import { voiceAnchor } from "../src/engine/maxims";
import { tickPsyche } from "../src/engine/social";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the register reaches the turn ─────────────────────────────────────────── */
{
  // the real cards from the save
  // the real cards from the save, carried over to the shape the forge writes now — and one stale
  // example_lines, because a save made before the samples were removed still has them on disk
  const state = { characters: {
    amber: {
      name: "Amber Reyes", age: 19, core_traits: ["blunt"], background: "Amber grew up in a cramped apartment on the east side.",
      voice: {
        idiolect: "a stock-count deflector",
        idiolect_shows: "answers a question about herself with the state of something she is responsible for, then stops",
        diction: "pharmacy-line and shift-work vocabulary; the counter, the register, closing, the schedule",
        never_says: ["anything that sounds like a manager talking"],
        example_lines: ["I closed the counter at nine and I still smell like the place."],
      },
    },
    miranda: {
      name: "Miranda", age: 22, core_traits: ["exacting"], background: "Miranda is a successful graphic designer.",
      voice: {
        idiolect: "a measurement-first corrector",
        idiolect_shows: "names the discrepancy before she names the person, in numbers where she has them",
        diction: "design-shop vocabulary used literally — kerning, negative space, hex codes",
      },
    },
  } } as any;
  const v = voiceAnchor(state, ["amber", "miranda"]);

  check("the block still names who is talking", /WHY NONE OF THEM SHOULD SOUND ALIKE/.test(v), v);
  check("Amber's idiolect is sent", /HOW THEY TALK: a stock-count deflector/.test(v), v);
  check("...with what it does to her sentences", /answers a question about herself with the state of something/.test(v));
  check("...and the words her life gave her", /the counter, the register, closing, the schedule/.test(v));
  check("Miranda's idiolect is sent, and it is not Amber's", /a measurement-first corrector/.test(v));
  check("...and her own vocabulary with it", /kerning, negative space, hex codes/.test(v));
  check("the age is still there", /Amber Reyes — 19/.test(v));
  check("what she would never say survives", /Would never say: anything that sounds like a manager/.test(v));

  // THE POINT OF THE REWRITE: nothing in this block is a line anybody could paste into a scene.
  check("no sample line is sent, even when the card still has one",
    !/I closed the counter at nine/.test(v), v);
  check("nothing in the block is quoted speech at all", !/["\u201C]/.test(v), v);
  check("and it says the move is performed, not quoted", /HOW THEY TALK IS A MOVE THEY MAKE, NOT A LINE THEY HAVE/.test(v));
  check("...naming the failure it exists to prevent", /catchphrase/.test(v));
  check("the vocabulary is named as binding, not decoration", /THE WORDS THEIR LIFE GAVE THEM ARE NOT DECORATION/.test(v));
  check("...and says what writing without it produces", /everybody written as you is the same person/.test(v));

  // a card with nothing on it must not produce an empty row
  const bare = voiceAnchor({ characters: { x: { name: "X" } } } as any, ["x"]);
  check("a blank card produces nothing", bare === "", bare);
  const partial = voiceAnchor({ characters: { x: { name: "X", voice: { idiolect: "a clipped naval reporter" } } } } as any, ["x"]);
  check("...but an idiolect alone is enough to be worth sending", /a clipped naval reporter/.test(partial), partial);
}

/* ── 2. a life that comes apart slowly ────────────────────────────────────────── */
{
  // drag accumulation mirrors turn.ts: a hard blow at 0.6, sustained pressure at 0.15
  const hit = (p: any, d: number) => {
    if (d <= -3) p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + Math.abs(d) * 0.6);
    else if (d <= -1) p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + Math.abs(d) * 0.15);
    p.relaxation = Math.max(-10, p.relaxation + d);
  };
  const fresh = () => ({ relaxation: 2, capacity: 2, recovery: 0.18, state: "intact", break_mode: null, consecutive_clenched: 0, mood: "", mood_valence: 0, active_states: [], open_run: 0 }) as any;

  // ONE BAD AFTERNOON LEAVES NOTHING. This is the case the low threshold must not over-serve.
  const mild = fresh();
  hit(mild, -1);
  tickPsyche(mild);
  check("a single small knock leaves no lasting drag", mild.grief_drag === undefined, mild.grief_drag);

  // A MARRIAGE ENDING ACROSS FORTY TURNS OF -2s. Before, every one of these was erased by drift.
  const slow = fresh();
  for (let i = 0; i < 12; i++) { hit(slow, -2); tickPsyche(slow); }
  check("sustained loss builds real drag", (slow.grief_drag ?? 0) > 1.5, slow.grief_drag);
  check("...so she does not sit at her easy resting point", slow.relaxation < 0, slow.relaxation);
  check("...which is what the narrator renders from", slow.mood_valence < 0, slow.mood_valence);

  // AND IT LIFTS. Grief is a drag on the resting point, not a new personality.
  for (let i = 0; i < 50; i++) tickPsyche(slow);
  check("it lifts once the pressure stops", slow.grief_drag === undefined, slow.grief_drag);
  check("...and she comes back to her own capacity", slow.relaxation > 1, slow.relaxation);

  // a single hard blow still works exactly as it did
  const blow = fresh();
  hit(blow, -5);
  tickPsyche(blow);
  check("one hard blow still lowers the resting point", (blow.grief_drag ?? 0) >= 2.5, blow.grief_drag);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
