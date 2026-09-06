/* "IS EMILY A HUMAN BEING OR A NARRATOR? DOES EMILY NARRATE OR RELATE? IS SHE HUMAN? NO."
 *
 * A player, after nine turns of a dinner date with the only other person in the scene. He is right,
 * and the engine had already told the narrator she was not a person.
 *
 * Her card, forged by this engine's own voiceforge that same evening: eleven years in commercial
 * laundry and linen service, shift lead, runs a tunnel washer, can name the chemical a stain needs;
 * a year of powerlifting that ended in a torn labrum and a coach who owed her four hundred dollars;
 * "no metaphor unless it comes off a machine or a barbell"; "fills silence with inventory rather
 * than questions"; never says anything about how something made her feel; five example lines in her
 * own mouth, every one of them a number or a piece of equipment.
 *
 * What the narrator was given, every turn:
 *
 *     — Emily [char_…] (background) — present, even; a minor figure, simple and reactive,
 *       not a focus
 *
 * and her card was not in the cached prefix at all. Three renderers gate on `central === false`;
 * she was `central: false` and `tracked: true`.
 *
 * HOW SHE GOT THERE. `tracked` and `central` are two different claims — the engine spends upkeep on
 * this person, versus the narrator is told who they are — and four paths set `tracked` without ever
 * touching `central`: the bookkeeper writing a drive, the narrator's own track promotion, and
 * authoring a want or a schedule from the Cast screen. The promotion loop's gate was `!c.tracked`,
 * so any of them landing first shut the door permanently. The cap was six. She was the second
 * person in the cast. Nothing was full; the guard could not see her.
 *
 * So the narrator wrote her out of its defaults. It gave her a different job from the one on her
 * card (dental billing, not the laundry), a different family (an uncle who ran supers, not the
 * father who died in a delivery truck), and — the thing the player actually named — the default
 * voice for a woman in a tense dinner argument, which is fluent conversational analysis:
 *
 *     "I'm asking you a question, that's just — that's called talking, Max."
 *     "I asked you about the gym. I asked you if you were joking about the sex thing."
 *     "You just told me I narrate you and judge you in the same breath. And then you did it."
 *     "That's it. That's the line you're leaving on."
 */
import { findMetaTalk, metaTalkFix, META_RUN } from "../src/engine/maxims";
import { charCard, volatileDigest } from "../src/engine/prompts";
import { declaredMinutes } from "../src/engine/time";
import type { SaveState, Identity } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/background-person.json", "utf8")) as SaveState;
const EMILY = "char_mtp7snm7n5meg";
const load = (): SaveState => JSON.parse(JSON.stringify(FIX)) as SaveState;
const prose = (t: number): string => String(FIX.history.find((h) => h.turn === t)?.narrator_prose ?? "");
const acted = (t: number): string => String(FIX.history.find((h) => h.turn === t)?.player_action ?? "");

/* ── 1. the state that caused it ─────────────────────────────────────────────── */
{
  const e = FIX.characters[EMILY];
  check("she is tracked", e.tracked === true, e.tracked);
  check("...and background at the same time", e.central === false, e.central);
  check("...with a forged voice card the engine paid for",
    !!e.voice?.example_lines?.length && !!e.voice?.diction, e.voice?.diction);
  check("...naming her actual trade", /laundry|linen/i.test(String(e.background)), String(e.background).slice(0, 60));
  check("the cast cap was nowhere near full",
    Object.values(FIX.characters).filter((c) => c.character_id !== "char_player" && c.tracked).length < 6);
  // the prose gave her a different job entirely, which is what having no card looks like
  check("and the prose put her in dental billing instead", /dental (?:practice|billing)/i.test(prose(36)), prose(36).slice(0, 120));
}

/* ── 2. a tracked person is never rendered as furniture ──────────────────────── */
{
  const s = load();
  const card = charCard(EMILY, s.characters[EMILY], s.condition[EMILY], [], true);
  check("her card renders in full", card.length > 400, card.length);
  check("...carrying her trade", /laundry|linen|tunnel washer/i.test(card), card.slice(0, 200));
  check("...and her register", /barbell|metaphor|inventory/i.test(card), card);

  const digest = volatileDigest(s, "");
  check("the digest does not call her a minor figure",
    !/minor figure, simple and reactive/.test(digest), digest.slice(0, 300));
  check("...and does not reduce her to a mood", !/— Emily \(background\)/.test(digest), digest.slice(0, 300));
  check("she is in the scene properly", digest.includes("Emily"), digest.slice(0, 200));

  // ...and a genuinely background figure still costs nothing
  const extra = load();
  extra.characters["char_extra"] = { character_id: "char_extra", name: "The Barista", central: false } as Identity;
  extra.condition["char_extra"] = extra.condition[EMILY];
  extra.world.present = [EMILY, "char_extra"];
  const d2 = volatileDigest(extra, "");
  check("an untracked walk-on is still one line", /minor figure, simple and reactive/.test(d2), d2.slice(0, 400));
}

/* ── 3. narrating the conversation instead of having it ──────────────────────── */
{
  const s = load();
  const before = (t: number): string[] => FIX.history.filter((h) => h.turn < t).map((h) => String(h.narrator_prose ?? ""));

  const hit = findMetaTalk(s, [EMILY], before(43), prose(43));
  check("turn 43 is caught", !!hit, hit);
  check("...as a run, not one line", (hit?.runs ?? 0) >= META_RUN, hit);
  check("...quoting what she actually said",
    (hit?.lines ?? []).some((l) => /you just told me|that'?s literally the thing|you said/i.test(l)), hit?.lines);

  // THE ORDINARY TURNS OF THE SAME CONVERSATION, which must stay clean: 30–40 run 0–1 such
  // sentences each, and both of those are ordinary callbacks ("You said your body tells you when
  // to go.") rather than a woman explaining the exchange to the man in it.
  for (const t of [34, 36, 37, 38, 39, 40]) {
    check(`turn ${t} is ordinary conversation`, findMetaTalk(s, [EMILY], before(t), prose(t)) === null,
      findMetaTalk(s, [EMILY], before(t), prose(t)));
  }

  const fix = metaTalkFix(hit);
  check("the correction names the move", /describing the conversation instead of having it/i.test(fix), fix.slice(0, 120));
  check("...sends her back to her own life for material", /their own life and their own vocabulary/i.test(fix), fix);
  check("...and refuses the argument about the argument", /argument about the argument/i.test(fix), fix);
}

/* ── 4. and the seven days that passed between two sentences ─────────────────── */
{
  // The same dinner. Turn 38 is stamped Day 2, 18:54 and turn 39 is stamped Day 9, 18:54 — the
  // clock moved a week between two lines of one conversation, which is why she is then made to say
  // they met on an app four days ago, in the middle of the meal she arrived for.
  const line = acted(39);
  check("the player's line is the one that did it", /times a week/i.test(line), line);
  check("...and it is talking about the gym, not about spending a week",
    /gym|go daily|four times/i.test(line) || /times a week/i.test(line), line);
  check("a frequency no longer declares a span", declaredMinutes(line) === 0, declaredMinutes(line));

  for (const [l, want] of [
    ["I go to the gym four times a week", 0],
    ["she calls me twice a day", 0],
    ["I work every three days", 0],
    ['"I go four times a week"', 0],
  ] as [string, number][]) check(`rate: ${l}`, declaredMinutes(l) === want, declaredMinutes(l));

  // …and a real declaration still is one
  for (const [l, min] of [
    ["I wait three hours", 180],
    ["I stay for two days", 2880],
    ["I spend a week at my sister's", 10080],
    ["I sleep till morning", 480],
    ["I fly to Houston tonight", 180],
  ] as [string, number][]) check(`span: ${l}`, declaredMinutes(l) === min, declaredMinutes(l));

  // A CHARACTER TALKING IS NOT A PLAYER SPENDING. Quoted speech is masked everywhere else the
  // engine reads this input; it was not masked here.
  check("what he says out loud does not move the clock",
    declaredMinutes('"I was in Boston for three days" I sit back down') === 0,
    declaredMinutes('"I was in Boston for three days" I sit back down'));
  check("...and what he does still does",
    declaredMinutes('"Back in a bit" I drive four hours to the coast') === 240,
    declaredMinutes('"Back in a bit" I drive four hours to the coast'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
