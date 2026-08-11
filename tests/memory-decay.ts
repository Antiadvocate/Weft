/* Smoke test: THE FADE THAT WAS NEVER WRITTEN.
 *
 * memory.ts has described four decay stages since the first commit in this repository —
 *
 *   0 vivid: full somatic detail, exact words, place, the works
 *   1 gist + person + place: you have the shape of it, not the exact words
 *   2 gist + person, PLACE LOST
 *   3 person + bare gist: just who, and a compacted sense of what
 *
 * — and ends "The text itself is rewritten to its faded form lazily, at reflection." Nothing ever
 * rewrote it. `tickMemoryDecay` advanced `decay_stage`, cleared `where`, and returned.
 * `applyReflection` pruned the store and never touched a character's words. `git log -S` finds no
 * commit that ever wrote the fade: the step has never once run.
 *
 * Everything downstream assumed it had. The digest renders `content` for a faded memory and
 * `full_content` only for the two the moment strongly cues — but with the fade missing those were
 * the same string, so a "dim, distant impression" shipped to the narrator at full length, and the
 * only compression anywhere was `raw.slice(0, 170)` at render: a hard mid-word cut that severs a
 * memory before its own object. Measured on a save at turn 24: fifteen memories had reached stage 2
 * or 3 and every one still held its complete original text.
 *
 * It takes reconsolidation with it, too. `reconsolidate` pulls a memory two stages back toward
 * vivid when new detail is folded in — recalling something and re-storing it changed, which is the
 * whole point. There was nothing to change: the gist it would re-cohere from never existed.
 */
import { fadeToStage, tickMemoryDecay, reconsolidate, compactGist } from "../src/engine/memory";
import type { CharMemory, EpisodicMemory } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* the longest real memory from the save */
const FULL = "I confronted Rabi in the wineshop, deducing that his secret was not godhood but that he "
  + "made gold for Clodia unseen, and demanded he demonstrate the gold-making before my eyes as proof of his claim.";

function bank(m: Partial<EpisodicMemory>): CharMemory {
  return {
    character_id: "char_x", core: [], beliefs: [], facts: [], knows: [],
    episodic: [{
      turn: 1, content: FULL, full_content: FULL, decay_stage: 0, importance: 4,
      emotional_charge: "", last_accessed_turn: 1, where: "the wineshop", ...m,
    } as EpisodicMemory],
  };
}

/* ── 1. each stage is actually shorter than the one before ────────────────────── */
{
  const lens = ([0, 1, 2, 3] as const).map((s) => fadeToStage(FULL, s).length);
  check("stage 0 is the memory itself", lens[0] === FULL.length, lens);
  check("every stage is shorter than the last", lens[1] < lens[0] && lens[2] < lens[1] && lens[3] < lens[2], lens);
  check("terminal decay is a fraction of the original", lens[3] < FULL.length * 0.45, lens);
  for (const s of [1, 2, 3] as const) {
    const out = fadeToStage(FULL, s);
    // the render-time `slice(0, 170)` this replaces regularly severed a word; nothing the fade
    // emits may be a fragment that never appeared in the original
    const lastWord = (out.replace(/…$/, "").trim().split(/\s+/).pop() ?? "").replace(/[^A-Za-z'’-]/g, "");
    check(`stage ${s} never cuts mid-word`, !lastWord || new RegExp(`\\b${lastWord}\\b`).test(FULL), out);
    check(`stage ${s} keeps who it is about`, /Rabi/.test(out), out);
  }
}

/* ── 2. compactGist alone could never have done this ──────────────────────────── */
{
  // the latent reason the fade would have been a no-op even if it had been called: compactGist
  // cuts on SENTENCE boundaries and takes the first sentence whole however long it is, and a
  // memory is almost always one sentence.
  check("compactGist leaves a single long sentence untouched", compactGist(FULL, 110) === FULL, compactGist(FULL, 110).length);
  check("the fade does not", fadeToStage(FULL, 2).length <= 110, fadeToStage(FULL, 2));
}

/* ── 3. the exact words go first, and the sentence survives losing them ───────── */
{
  const spoken = `Rabi said "you already know what I am" and I did not answer him, only watched his hands.`;
  const faded = fadeToStage(spoken, 1);
  check("the quoted line stops being exact", !/you already know what I am/.test(faded), faded);
  check("and the speech verb is not left dangling", !/\bsaid and\b/.test(faded) && /said something/.test(faded), faded);
  check("the rest of the account survives", /did not answer him/.test(faded), faded);

  const allSpeech = `"Five asses a night, paid in advance, and I want it before the Ides."`;
  check("a memory that is ALL speech is not erased", fadeToStage(allSpeech, 1).length > 20, fadeToStage(allSpeech, 1));
  const cut = fadeToStage(allSpeech, 3);
  check("and a cut inside a quote never leaves an orphan mark", (cut.match(/["“”]/g) ?? []).length % 2 === 0, cut);
}

/* ── 4. the tick actually rewrites the stored text now ────────────────────────── */
{
  const mem = bank({ turn: 1, importance: 3, last_accessed_turn: 1 });
  tickMemoryDecay(mem, 40);
  const m = mem.episodic[0];
  check("a memory left alone for forty turns has decayed", (m?.decay_stage ?? 0) >= 2, m?.decay_stage);
  check("and its text is shorter than the original", (m?.content.length ?? 0) < FULL.length, m?.content.length);
  check("the vivid original is kept for full recall", m?.full_content === FULL, m?.full_content);
  check("the place is dropped from the record at stage 2", m?.where === undefined, m?.where);
}

/* ── 5. importance is what holds a memory vivid ───────────────────────────────── */
{
  const trivial = bank({ importance: 1, last_accessed_turn: 1 });
  const searing = bank({ importance: 10, last_accessed_turn: 1 });
  tickMemoryDecay(trivial, 30);
  tickMemoryDecay(searing, 30);
  check("a searing memory outlasts a trivial one",
    (searing.episodic[0]?.decay_stage ?? 0) < (trivial.episodic[0]?.decay_stage ?? 3),
    [searing.episodic[0]?.decay_stage, trivial.episodic[0]?.decay_stage]);
}

/* ── 6. reconsolidation has something to re-cohere FROM ───────────────────────── */
{
  const mem = bank({ turn: 1, importance: 4, last_accessed_turn: 1 });
  tickMemoryDecay(mem, 40);
  const faded = mem.episodic[0].content;
  check("the memory is a gist before it is discussed", faded.length < FULL.length, faded);

  const ok = reconsolidate(mem, "the wineshop and the gold Rabi made for Clodia", "and Marcus was at the next table", 41);
  const after = mem.episodic[0];
  check("discussing it rebuilds the trace", ok && after.content !== faded, after.content);
  check("the supplied detail is now part of the memory", /Marcus was at the next table/.test(after.content), after.content);
  check("it is pulled back toward vivid", (after.decay_stage ?? 3) < 2, after.decay_stage);
  // this is the point of the whole design: what comes back is the FADED version plus what was
  // supplied, not the original — the character can no longer tell which parts they witnessed
  check("what comes back is the gist plus the addition, not the original",
    after.content.length < FULL.length && after.full_content === after.content, [after.content.length, FULL.length]);
}

/* ── 7. "PENDING" IS NOT A LIVE COMMITMENT, AND THAT IS WHY NOTHING FADED ──────
 *
 * decayStageFor exempted every memory flagged `commitment_status: "pending"`, and commitmentBoost
 * a few lines below it documents what that flag means in practice: "set scheduled_time whenever
 * something is left unfinished" reads to the simulator as EVERYTHING, measured at 98-100% of
 * episodic memories in a live save. The retrieval side was fixed for that saturation. The decay
 * side never was. In the Rome save, 21 of 45 memories carried `scheduled_time: "unresolved"` and
 * sat at stage 0 forever — replayed to turn 150 they were still at stage 0, and the whole store's
 * size flattened out at 22% below its original instead of 56%.
 *
 * `folded` was the other half: it marks a memory whose gist is ALREADY in the character's
 * life_history, which makes the episodic copy the least valuable thing in the bank to keep at full
 * fidelity, not the most. */
{
  const old = { turn: 1, importance: 4, last_accessed_turn: 1 };
  const unclocked = bank({ ...old, commitment_status: "pending", scheduled_time: "unresolved" });
  const clocked = bank({ ...old, commitment_status: "pending", scheduled_time: "Day 9, 09:00" });
  const folded = bank({ ...old, folded: true });

  tickMemoryDecay(unclocked, 8);
  check("an unclocked loop is still vivid while it is fresh", unclocked.episodic[0].decay_stage === 0, unclocked.episodic[0].decay_stage);

  for (const b of [unclocked, clocked, folded]) tickMemoryDecay(b, 60);
  check("an unclocked loop decays once it stops being fresh", (unclocked.episodic[0]?.decay_stage ?? 0) >= 2, unclocked.episodic[0]?.decay_stage);
  check("a memory folded into life_history decays too", (folded.episodic[0]?.decay_stage ?? 0) >= 2, folded.episodic[0]?.decay_stage);
  check("a commitment with a real clock on it stays vivid", clocked.episodic[0].decay_stage === 0, clocked.episodic[0].decay_stage);
  check("and the unclocked one's text actually got shorter",
    unclocked.episodic[0].content.length < FULL.length, unclocked.episodic[0].content);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
