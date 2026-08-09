/* Smoke test: THE CLIFF AT EVERY RE-ANCHOR.
 *
 * The complaint was "this repeats the last dialogue twice." Turn 61 of one save re-staged turn 60
 * nearly word for word — the same two lines ("The dal's from last night." / "Also I've been home for
 * forty-five seconds.") and a woman taking off a shoe she had already taken off.
 *
 * Two obvious suspects were checked first and both were innocent. scrubForReplay keeps 100% of the
 * prose on those turns. echoBan's quote regex found both lines and named them, verbatim, as
 * forbidden. The rule was right and it was ignored.
 *
 * The actual cause was upstream of both. In chatlog mode the narrator gets an anchored snapshot plus
 * the recent turns replayed as user/assistant pairs. Those pairs were filtered `h.turn >= a.turn` —
 * and `a.turn` is set to the CURRENT turn the instant the anchor goes stale. So on every re-anchor
 * the filter matched nothing:
 *
 *     t59  (anchor goes stale, re-anchors to 59)   →  0 pairs
 *     t60                                          →  1 pair
 *     t61                                          →  2 pairs
 *
 * Once every `iframe_cadence` turns the narrator wrote the next beat of a scene it had not read one
 * word of, working from a state summary. Restaging the beat is the only move available to a writer
 * in that position — and then it is in the replay, so it happens again.
 *
 * Two fixes, tested here. Carry a couple of turns back across the boundary (they sit inside the same
 * fixed prefix, so the cache is untouched), and move the do-not-repeat list to where the model
 * actually reads it — it was sitting ~60k characters in with the whole POV block after it. */
import { replayPairs, lastWord, scrubForReplay } from "../src/engine/turn";
import type { SaveState, TurnHistoryEntry } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const CAD = 6;   // iframe_cadence default
const hist = (n: number): TurnHistoryEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    turn: i + 1,
    player_action: `action ${i + 1}`,
    narrator_prose: `She set the glass down. "Line ${i + 1}," she said.`,
  }));

/* ── 1. the cliff itself ─────────────────────────────────────────────────────── */
// history as it stands while turn T is being GENERATED: everything up to T-1, nothing of T itself.
// This is the off-by-one the bug hid behind — `h.turn >= a.turn` looks survivable until you notice
// the turn the anchor names has not been written yet.
const before = (t: number) => hist(t - 1);
{
  // the exact shape of the save: the anchor goes stale and re-sets to 59 as turn 59 is written
  const at59 = replayPairs(before(59), 59, CAD);
  check("a re-anchor turn is not handed an empty conversation", at59.length > 0, at59.length);
  check("it sees the turn immediately before it", at59.some((p) => /Line 58\b/.test(p.assistant)), at59.map((p) => p.assistant));
  check("and the one before that", at59.some((p) => /Line 57\b/.test(p.assistant)), at59.length);
}
{
  // and every turn in the cadence keeps growing from there rather than starting from nothing
  const counts = [59, 60, 61, 62, 63, 64].map((t) => replayPairs(before(t), 59, CAD).length);
  check("no turn in the cadence sees fewer than two turns of prose", Math.min(...counts) >= 2, counts);
  check("and the window still grows across the cadence", counts[counts.length - 1] > counts[0], counts);
}

/* ── 2. the carry does not become a leak ─────────────────────────────────────── */
{
  const h = hist(40);
  const p = replayPairs(h, 35, CAD);
  check("the replay window stays bounded", p.length <= CAD + 2, p.length);
  check("nothing older than the carry is dragged in", !p.some((x) => /Line 3[0-2]\b/.test(x.assistant)), p.map((x) => x.assistant));
}
{
  // openings and interludes are not turns and never were replayable pairs
  const h: TurnHistoryEntry[] = [
    { turn: 0, kind: "opening", player_action: "", narrator_prose: "The house was empty." },
    { turn: 1, kind: "interlude", player_action: "", narrator_prose: "Three days pass." },
    ...hist(4),
  ];
  const p = replayPairs(h, 1, CAD);
  check("the opening is still not replayed as a turn", !p.some((x) => /house was empty/.test(x.assistant)), p.map((x) => x.assistant));
  check("nor the interlude", !p.some((x) => /Three days pass/.test(x.assistant)), p.length);
}
{
  // a fresh game has nothing to carry and must not blow up asking for it
  check("turn 1 of a new story is fine with nothing behind it", replayPairs([], 1, CAD).length === 0);
}
{
  // the carried prose goes through the same scrub as everything else — a motive leak two turns back
  // is exactly the sentence the narrator would otherwise learn its house style from
  const h: TurnHistoryEntry[] = [{
    turn: 12,
    player_action: "sit down",
    narrator_prose: `She poured the tea.\n\nShe wanted him to stay, though she would never say it. She set the cup down.`,
  }];
  const p = replayPairs(h, 13, CAD);
  check("carried prose is scrubbed, not raw",
    p.length === 1 && p[0].assistant === scrubForReplay(h[0].narrator_prose), p[0]?.assistant);
}

/* ── 3. the last thing the model reads ───────────────────────────────────────── */
const st = (prose: string) => ({ history: [{ turn: 60, player_action: "x", narrator_prose: prose }] } as unknown as SaveState);
{
  const t = lastWord(st(`She pulled off one shoe. "The dal's from last night," she said. He didn't answer. "Also I've been home for forty-five seconds."`));
  check("the previous turn's spoken lines are named", /The dal's from last night/.test(t) && /forty-five seconds/.test(t), t);
  check("and named as forbidden to say again", /nobody says these again/i.test(t), t);
  check("paraphrase is closed too, not just the exact words", /paraphrase/i.test(t), t);
  check("an unanswered question is not re-asked in the same words", /re-asked in the same words/i.test(t), t);
  check("and the shoe does not come off twice", /physical is done twice/i.test(t), t);
}
{
  // the prose in play uses straight quotes; earlier saves and pasted openings use curly ones, and the
  // old regex in echoBan only ever matched straight
  const t = lastWord(st(`“You’re deflecting,” she said to the window pane.`));
  check("curly quotes are caught as well as straight", /You’re deflecting/.test(t), t);
}
{
  check("a wordless turn produces no rule at all", lastWord(st("She crossed the room and did not look back.")) === "");
  check("nor does an empty history", lastWord({ history: [] } as unknown as SaveState) === "");
  check("a fragment too short to be a line is ignored", lastWord(st(`He said "no." and left.`)) === "");
}
{
  // four lines is the cap — a long exchange must not push the rest of the directive out
  const many = Array.from({ length: 9 }, (_, i) => `"This is spoken line number ${i + 1}, at length."`).join(" ");
  const t = lastWord(st(many));
  check("at most the last four lines are quoted back", (t.match(/spoken line number/g) ?? []).length === 4, t);
  check("and they are the LAST four", /number 9/.test(t) && !/number 5\b/.test(t), t);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
