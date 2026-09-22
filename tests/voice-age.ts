/* Smoke test: A TEN-YEAR-OLD SOUNDING LIKE A GUNSLINGER.
 *
 * The player: "I've got 10 year old kids in the game talking like it's the Good, the Bad and the
 * Ugly." Probed on a default save with a ten-year-old present, three things were true at once.
 *
 *   1. voice_cards is OFF by default — prompts.ts made it so, and recorded why: on a four-person
 *      cast every syntax field said short, declarative, no hedging, and nine of thirteen samples
 *      named a number or a price. charCard therefore printed no voice at all.
 *   2. voiceAnchor, which runs at the END of the per-turn directive, printed her whole forged
 *      register anyway — "TALKS LIKE THIS: Short, flat sentences. Says the thing and stops." — and
 *      a sample line in her mouth: ONE OF THEIR ACTUAL LINES: "He knows what he did." It never
 *      read the switch. So turning voice cards off did not remove the register, it MOVED it, out of
 *      the cached prefix and into the directive, which by maxims.ts's own argument is where a rule
 *      stops being reference and starts being an instruction.
 *   3. ageBand — the only place in the engine that knows a ten-year-old is ten — was gated on the
 *      same switch, so it contributed nothing. And what it would have contributed was "a child's
 *      plain, direct cadence", which is the laconic register named outright.
 *
 * Three of its four bands were: plain, direct / measured / settled, unhurried. All of them mean
 * says less, and short weighty speech delivered flat is the shape maxims.ts exists to strike out of
 * the finished page. The engine was asking for it on the way in. */
import { newSave, registerCharacter } from "../src/engine/state";
import { voiceAnchor, registerOf } from "../src/engine/maxims";
import { charCard, deriveVoice, voiceCardsOn } from "../src/engine/prompts";
import { pointsAtNothing, screenCard } from "../src/engine/aphorism";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const KID_VOICE = {
  diction: "plain, few words", syntax: "short declaratives, no hedging",
  rhythm: "says it once and waits", tics: [], never_says: ["please"],
  agenda: "to be taken seriously", example_lines: ["He knows what he did.", "I'm not the one who lied."],
};

function makeState(age = 10): { s: SaveState; kid: string } {
  const s = newSave("voice-age", {
    name: "Arden", era: "frontier", technology_level: "iron", magic_rules: "none", forbidden: "",
    what_people_fear: "the winter", cultures_and_languages: "common",
    climate_and_geography: "high plains", calendar_and_currency: "standard", political_situation: "thin law",
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const kid = registerCharacter(s, {
    name: "Nell", age, background: "Lives with her aunt above the feed store. Collects bottle caps.",
    core_traits: ["stubborn", "watchful"], values: ["her dog"],
    speech_pattern: "Short, flat sentences. Says the thing and stops. Does not soften it.",
    voice: { ...KID_VOICE },
  } as any);
  s.characters[kid].location = s.world.player_location;
  s.world.present = [kid];
  return { s, kid };
}

const anchorOf = (s: SaveState) => voiceAnchor(s as any, s.world.present);
const voiceOf = (s: SaveState, id: string) =>
  deriveVoice(s.characters[id], s.condition[id], [], undefined, voiceCardsOn(s, s.characters[id]));

/* ── 1. THE LENGTH PRESCRIPTION COMES OUT, THE VOCABULARY GOES THROUGH ────────
 *
 * The first attempt here was to gate this block on voice_cards, and tests/voice-and-grief.ts is
 * the reason that is wrong: 318 spoken lines across 91 turns of one save carried NONE of five
 * excellent registers, because the fields that say how somebody sounds were on the cached card and
 * never repeated where the line gets written. Suppressing the register brings that straight back.
 *
 * What those five have in common is that every one is a STOCK OF WORDS — the counter, the register,
 * closing, the schedule; kerning, negative space, hex codes. None says how long a sentence is.
 * voiceforge builds speech_pattern as `diction. syntax. rhythm.`, so a forged card arrives with a
 * vocabulary welded to a length prescription, and the length prescription is the complaint. */
{
  const { s } = makeState();
  const anchor = anchorOf(s);

  check("the length prescription does not reach the directive",
    !/Short, flat sentences|Says the thing and stops|Does not soften it/.test(anchor), anchor);
  check("...and a card that is nothing but one contributes no register at all",
    !anchor.includes("TALKS LIKE THIS"), anchor);

  check("her age stays", anchor.includes("10"));
  check("what she is like stays", anchor.includes("stubborn"));
  check("the life she has stays", anchor.includes("feed store"));
  check("what she could not produce stays", anchor.includes("Would never say"));
  check("the procedure stays", anchor.includes("LENGTH COMES FROM THAT"));
}

/* ── 2. A REGISTER THAT NAMES A SUBJECT SURVIVES WHOLE ───────────────────────── */
{
  const cases: [string, string][] = [
    ["pharmacy-line and shift-work vocabulary; the counter, the register, closing, the schedule", "the counter"],
    ["design-shop vocabulary used literally — kerning, negative space, hex codes", "kerning"],
    ["Talks in dumplings, innings and the third-period bell.", "dumplings"],
    // manner AND a vocabulary in one phrase: naval shorthand is a real stock of words, and a
    // whole-sentence drop took it out with the length. This is why the test is per-word.
    ["clipped naval shorthand", "naval shorthand"],
    // mixed: the shape sentence goes, the subject sentence stays
    ["Short sentences. Talks in dumplings and innings.", "dumplings"],
  ];
  for (const [sp, want] of cases) {
    check(`kept: ${sp.slice(0, 44)}`, registerOf({ speech_pattern: sp }).includes(want), registerOf({ speech_pattern: sp }));
  }
  for (const sp of ["Short, flat sentences. Says the thing and stops.", "Terse. Never hedges. Says less than she means.",
                    "Speaks quietly. Short lines. Long pauses."]) {
    check(`stripped: ${sp.slice(0, 44)}`, registerOf({ speech_pattern: sp }) === "", registerOf({ speech_pattern: sp }));
  }
  check("a card stripped to nothing falls back to the words voiceforge put in diction",
    registerOf({ speech_pattern: "Terse. Never hedges.", voice: { diction: "feed-store words: sacks, the scale, the latch" } })
      .includes("the latch"));
}

/* ── 3. A VOICE SOMEBODY WROTE BY HAND IS STILL THEIRS ───────────────────────── */
{
  const { s, kid } = makeState();
  s.characters[kid].voice_locked = true;
  s.characters[kid].speech_pattern = "Feed-store words: sacks, the scale, the latch, whose dog got in.";
  check("a register somebody wrote by hand goes through whole",
    anchorOf(s).includes("whose dog got in"), anchorOf(s));
}

/* ── 4. BEING TEN REACHES THE NARRATOR ON A DEFAULT SAVE ─────────────────────── */
{
  const { s, kid } = makeState(10);
  const v = voiceOf(s, kid);
  check("the age band fires with voice cards off", v.includes("AGE: child"), v);
  check("it says what a child's mouth does", /runs at one thing|and then/.test(v), v);
  check("and it does not ask for the register the detectors strike out",
    !/plain, direct|laconic|clipped|measured cadence/.test(v), v);
  check("it names the failure it exists to stop", v.includes("short, weighty lines with a double meaning"), v);
}

/* ── 5. EVERY BAND IS SOMETHING A MOUTH DOES ─────────────────────────────────── */
{
  // Three of the four old bands said says-less: plain/direct, measured, settled/unhurried.
  for (const [age, want] of [[5, "small child"], [10, "child"], [16, "adolescent"], [60, "older adult"], [80, "old"]] as const) {
    const { s, kid } = makeState(age as number);
    const v = voiceOf(s, kid);
    check(`${age}: named`, v.includes(`AGE: ${want}`), v.slice(0, 120));
    check(`${age}: no adjective for how it sounds`,
      !/\b(plain, direct|measured|settled, unhurried|slangy|terse|laconic)\b/.test(v), v.slice(0, 200));
  }
  const { s, kid } = makeState(35);
  check("an ordinary adult gets no band at all", !voiceOf(s, kid).includes("AGE:"));
}

/* ── 6. A LOCKED VOICE TAKES NO BAND ─────────────────────────────────────────── */
{
  const { s, kid } = makeState(10);
  s.characters[kid].voice_locked = true;
  check("somebody who wrote the voice by hand has already answered this",
    !voiceOf(s, kid).includes("AGE: child"));
}

/* ── 7. THE LINE THAT POINTS AT NOTHING ──────────────────────────────────────── */
{
  /* Not a maxim, so maxims.ts passes it. No figure, so the catalogue passes it. It is the other
   * movie line: weight from naming nothing, which is what a model writes when asked for a line
   * only one person could say. */
  for (const l of ["He knows what he did.", "I'm not the one who lied.", "You already know the answer.",
                   "That is not the point.", "I did what I had to do.", "You are not the only one."]) {
    check(`caught: ${l}`, pointsAtNothing(l));
  }
  /* Narrow in two directions: a question is somebody talking, and anything unfinished is speech
   * rather than delivery. Ordinary filler that names nothing is filler, which is the opposite
   * failure and must not be touched. */
  for (const l of ["The dog got into the feed again.", "Aunt Rhoda says the latch was already broke.",
                   "Did you eat yet?", "Yeah, no, I dunno.", "I was gonna, and then—",
                   "You know what he did with the tongs.", "Tell me the truth about the money.",
                   "That is the whole point of a latch.", "My knee says rain.", "It costs four and a half."]) {
    check(`left alone: ${l}`, !pointsAtNothing(l));
  }
}

/* ── 8. AND THE FORGE SCREEN CATCHES IT BEFORE IT REACHES A CARD ─────────────── */
{
  const faults = screenCard({ voice: KID_VOICE } as any);
  check("both of the kid's samples are struck",
    faults.filter((f) => f.field === "example_lines").length === 2, faults);
  check("the reason says what the narrator does with it",
    faults.some((f) => f.why.includes("naming nothing")), faults);

  const good = screenCard({ voice: { ...KID_VOICE, example_lines: [
    "The dog got into the feed again and Aunt Rhoda says it's my fault.",
    "I'm not going till you tell me what happened to the caps.",
  ] } } as any);
  check("a sample that names something passes", !good.some((f) => f.field === "example_lines"), good);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
