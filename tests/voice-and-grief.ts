/* "Everybody else sounds basically the same. Amber sounds like a 36-year-old programmer instead of
 *  what she actually is." — and: "Miranda apparently does not give a shit about the fact that she
 *  just got divorced. Nothing in her characterization showed up in the prose."
 *
 * TWO MECHANISMS, BOTH ALREADY IN THE ENGINE, BOTH MISSING THEIR CASE.
 *
 * ONE — THE VOICES WERE NEVER SENT. The forge writes superb, distinct registers: a 19-year-old
 * pharmacy tech whose vocabulary is "the counter, the register, closing, the schedule"; a designer
 * who talks in kerning, negative space and hex codes; a teacher whose register is dumplings and
 * innings; a shop owner with dry retail sarcasm. All of it on the cards, all of it excellent.
 *
 * Measured over 91 turns of one save: 318 spoken lines between those five people, containing NONE
 * of their registers. Not a diluted amount — none.
 *
 * The block whose own heading is "WHO IS TALKING, AND WHY NONE OF THEM SHOULD SOUND ALIKE" was
 * sending an age, three core traits and the first sentence of a background. None of that says how
 * anybody SOUNDS. The fields that do were on the cached card and deliberately not repeated per turn
 * to save tokens — deriveVoice says so in as many words. That economy cost the entire voice system.
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
  const state = { characters: {
    amber: {
      name: "Amber Reyes", age: 19, core_traits: ["blunt"], background: "Amber grew up in a cramped apartment on the east side.",
      speech_pattern: "pharmacy-line and shift-work vocabulary; the counter, the register, closing, the schedule",
      voice: { example_lines: ["I closed the counter at nine and I still smell like the place."], never_says: ["synergy"] },
    },
    miranda: {
      name: "Miranda", age: 22, core_traits: ["exacting"], background: "Miranda is a successful graphic designer.",
      speech_pattern: "design-shop vocabulary used literally — kerning, negative space, hex codes",
      voice: { example_lines: ["Your frame's off true by about a degree — see the gap over the radiator."] },
    },
  } } as any;
  const v = voiceAnchor(state, ["amber", "miranda"]);

  check("the block still names who is talking", /WHY NONE OF THEM SHOULD SOUND ALIKE/.test(v), v);
  check("Amber's register is sent", /TALKS LIKE THIS: pharmacy-line and shift-work vocabulary/.test(v), v);
  check("...and one of her actual lines", /I closed the counter at nine/.test(v));
  check("Miranda's register is sent", /design-shop vocabulary used literally/.test(v));
  check("...and one of hers", /off true by about a degree/.test(v));
  check("the age is still there", /Amber Reyes — 19/.test(v));
  check("what she would never say survives", /Would never say: synergy/.test(v));
  check("the register is named as binding, not decoration", /AND THE REGISTER IS NOT DECORATION/.test(v));
  check("...and says what writing without it produces", /everybody written as you is the same person/.test(v));

  // a card with nothing on it must not produce an empty row
  const bare = voiceAnchor({ characters: { x: { name: "X" } } } as any, ["x"]);
  check("a blank card produces nothing", bare === "", bare);
  const partial = voiceAnchor({ characters: { x: { name: "X", speech_pattern: "clipped naval shorthand" } } } as any, ["x"]);
  check("...but a register alone is enough to be worth sending", /clipped naval shorthand/.test(partial), partial);
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
