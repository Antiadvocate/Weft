/**
 * SYNTACTIC TEMPLATES — measuring the shape of the register instead of listing its instances.
 *
 * THE PROBLEM WITH EVERY DETECTOR IN maxims.ts, stated as a measurement rather than an opinion.
 * Run findMaxims over the 74-turn save that prompted this file and it returns 23 hits, all of them
 * between turns 5 and 47, and nothing at all from 48 to 74 — which is the stretch the player was
 * reading when he reported that everybody sounded the same. The register had moved from the
 * antithesis to the deictic verdict ("That's the whole thing", "That's all there is", "That's not
 * nothing") and the shapes were still looking for the antithesis.
 *
 * That is the third time it has happened here. Each generation of hand-written shapes was mined out
 * of a real save, worked, and was then walked around. Paech et al. (Antislop, arXiv 2510.15061) hit
 * the identical wall at scale — phrase banning "becomes unusable at just 2,000 patterns" and their
 * fine-tuning stage exists specifically because suppression displaces rather than removes. A list
 * of instances can only ever describe a register that has already been seen.
 *
 * SO MEASURE THE SHAPE. Shaib, Elazar, Li & Wallace (Detection and Measurement of Syntactic
 * Templates in Generated Text, EMNLP 2024, arXiv 2407.00211) define a syntactic template as a
 * recurring part-of-speech sequence, extract POS n-grams of length 4–8, keep the most frequent, and
 * score a corpus on how much of it is templated. Instruction-tuned models run far higher template
 * rates than human writing; 76% of the templates in model text trace to pretraining data against
 * 35% for human text, and they survive RLHF. Their other finding is the one that settles the
 * argument about waiting for a better narrator model: as models get larger, templates-per-token
 * goes UP.
 *
 * WHY THIS ESCAPES THE SIEVE. Tag the two registers this save actually produced:
 *
 *     "That's the whole thing, right there."     PRON AUX DET ADJ NOUN
 *     "That's the whole prayer."                 PRON AUX DET ADJ NOUN
 *     "That's the whole religion."               PRON AUX DET ADJ NOUN
 *
 * Three different sentences, three different regexes needed, one template. Nobody writes that
 * template down — it is counted. When the register moves again, and it will, the counts move with
 * it and the list of what is hot regenerates itself. That is the whole difference between this file
 * and maxims.ts: there is no vocabulary of failures in here to fall out of date.
 *
 * AND THE BASELINE IS THE SAVE'S OWN PAST, not a corpus of human fiction. The published tooling
 * (sam-paech/slop-forensics, EQ-Bench's Slop Score) scores a model against a human reference, which
 * answers "does this model write like a machine" — a question with the same answer every time and
 * no bearing on any particular evening. The question here is narrower and much more useful: is THIS
 * story flattening, relative to how it was reading forty turns ago. A cast can start distinct and
 * converge, which is exactly what the player described, and only a per-save baseline can see it.
 *
 * WHAT THIS FILE DOES NOT DO. It does not correct anything, does not touch the directive, and never
 * speaks to the narrator. It is an instrument. The engine has thirteen tripwires and no gauge, and
 * a tripwire that has silently stopped firing looks exactly like a story that is going fine — which
 * is what turns 48 to 74 looked like from inside the code. Anything that acts on this reading is
 * somewhere else and is written knowing that quoting a fault back primes it (arXiv 2511.12381).
 */
import { spokenLines } from "./maxims";

/* ── THE TAGGER ────────────────────────────────────────────────────────────────────────────────
 * wink-nlp with the lite web model: 93.2% POS accuracy on WSJ22-24, ~525k tokens/sec, and the
 * whole thing runs in the browser with no service to call. It is also ~1MB gzipped, which is a lot
 * to hand somebody who never turns this on, so it is behind a dynamic import and loads exactly once
 * on the first turn that measures anything. Every failure path here returns null and the caller
 * degrades to no reading rather than to a broken turn.
 *
 * Universal POS tags rather than the Penn Treebank set the paper used. Coarser is better for this:
 * Penn separates VBZ/VBP/VBD, so "that's the whole thing" and "that was the whole thing" would be
 * different templates, and they are plainly the same move. */
type Tagger = (text: string) => string[];
let taggerPromise: Promise<Tagger | null> | null = null;

export function loadTagger(): Promise<Tagger | null> {
  if (!taggerPromise) {
    taggerPromise = (async () => {
      try {
        const [{ default: winkNLP }, { default: model }] = await Promise.all([
          import("wink-nlp"),
          import("wink-eng-lite-web-model"),
        ]);
        const nlp = winkNLP(model as never);
        const its = nlp.its;
        return (text: string) => nlp.readDoc(text).tokens().out(its.pos) as string[];
      } catch (e) {
        console.warn(`[templates] tagger unavailable, no reading this turn: ${e}`);
        return null;
      }
    })();
  }
  return taggerPromise;
}

/** Test seam: hand in a tagger and skip the dynamic import entirely. */
export function __setTagger(t: Tagger | null): void { taggerPromise = Promise.resolve(t); }

/* ── TEMPLATES ─────────────────────────────────────────────────────────────────────────────── */

/** The paper's range. Four is the shortest sequence that can carry a construction rather than a
 *  collocation; past eight a template is a whole sentence and stops recurring at all. */
export const NGRAM_MIN = 4;
export const NGRAM_MAX = 8;
/** Punctuation is dropped before n-gramming. Keeping it makes the comma in "That's the whole thing,
 *  right there" a different template from the full stop in "That's the whole prayer." */
const SKIP = new Set(["PUNCT", "SPACE", "SYM", "X"]);

export function tagsOf(tagger: Tagger, line: string): string[] {
  return tagger(line).filter((t) => !SKIP.has(t));
}

/** Every POS n-gram in one tagged line, across the whole length range. */
export function ngramsOf(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
    for (let i = 0; i + n <= tags.length; i++) out.push(tags.slice(i, i + n).join(" "));
  }
  return out;
}

export interface Profile {
  /** pattern → how many lines contained it (line count, never raw occurrences: a line that repeats
   *  one shape three times is one line written in that shape, not three pieces of evidence). */
  lines: Map<string, number>;
  /** pattern → the actual sentences, for showing a person what the pattern IS. A bare POS string is
   *  unreadable and nobody should be asked to act on "PRON AUX DET ADJ NOUN". */
  examples: Map<string, string[]>;
  lineCount: number;
  tokenCount: number;
}

export function profileOf(tagger: Tagger, lines: readonly string[]): Profile {
  const p: Profile = { lines: new Map(), examples: new Map(), lineCount: 0, tokenCount: 0 };
  for (const line of lines) {
    const tags = tagsOf(tagger, line);
    if (tags.length < NGRAM_MIN) continue;
    p.lineCount++;
    p.tokenCount += tags.length;
    for (const g of new Set(ngramsOf(tags))) {
      p.lines.set(g, (p.lines.get(g) ?? 0) + 1);
      const ex = p.examples.get(g) ?? [];
      if (ex.length < 3) { ex.push(line); p.examples.set(g, ex); }
    }
  }
  return p;
}

export interface HotTemplate {
  pattern: string;
  /** share of recent lines carrying it */
  now: number;
  /** share of baseline lines carrying it, or 0 when the save has no baseline yet */
  before: number;
  /** now − before */
  rise: number;
  examples: string[];
}

export interface Reading {
  /** THE HEADLINE, and the one measure validated against a real save.
   *
   *  Average share of lines carried by each of the top TOP_N templates. It answers "how much of the
   *  dialogue is coming out of how few shapes", which is what flattening IS, and it is the thing the
   *  first draft of this file got wrong: the failing stretch of the save that prompted all this is
   *  not MORE templated than the healthy stretch, it is more CONCENTRATED. Both eras run 9–11% on
   *  their single commonest template. What changed is how much of the register those few shapes
   *  cover, and how short the lines got — median 10 POS tags early, 8 late.
   *
   *  Measured on that save with a 12-turn window: 7.5% at turn 12, drifting up through 9–11%, and
   *  14.2% by turn 72. Almost double, no cliff, and legible the whole way — which is the point. The
   *  regex detector went from 22 hits to 1 across the same span and read as silence. */
  concentration: number;
  /** EVERYBODY SOUNDS THE SAME, measured directly: mean cosine similarity between the per-speaker
   *  template vectors. This is the literal complaint and nothing in the published tooling measures
   *  it, because slop-forensics and the Slop Score both compare a model against humanity rather
   *  than two characters against each other.
   *
   *  null when fewer than two people have said enough to compare, which is most scenes and was true
   *  of the whole save this was built on — Emily has 193 attributable lines across 74 turns and
   *  nobody else clears ten. So this one is reasoned, not validated, and is reported as null rather
   *  than as a flattering zero. */
  convergence: number | null;
  /** Template instances per token, length-normalised — the paper's templates-per-token. */
  perToken: number;
  /** The shapes that grew, worst first. Empty is a real and good answer. */
  hot: HotTemplate[];
  /** Lines measured, so a reading off nine lines can be told from one off ninety. */
  lines: number;
}

/** Templates summed for the concentration figure. Ten is enough to describe a register and few
 *  enough that a wide, healthy distribution scores low. */
export const TOP_N = 10;

/** CALIBRATED, NOT CHOSEN. The first draft used 15% and returned nothing at all on a save whose
 *  dialogue a reader had just called unbearable, because no single POS n-gram reaches 15% of lines
 *  in natural dialogue — the real ceiling on that save is 11%. These are set under the observed
 *  ceiling and above the noise. */
const MIN_LINES = 3;
const MIN_SHARE = 0.06;
const MIN_RISE = 0.03;
const TOP = 5;

function shareVector(p: Profile): Map<string, number> {
  const v = new Map<string, number>();
  if (!p.lineCount) return v;
  for (const [k, n] of p.lines) v.set(k, n / p.lineCount);
  return v;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of a) { na += x * x; const y = b.get(k); if (y) dot += x * y; }
  for (const [, y] of b) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** How much of the register comes out of the few commonest shapes. */
export function concentrationOf(p: Profile): number {
  if (!p.lineCount) return 0;
  const top = [...p.lines.values()].sort((x, y) => y - x).slice(0, TOP_N);
  if (!top.length) return 0;
  return top.reduce((a, n) => a + n, 0) / (p.lineCount * TOP_N);
}

/** Mean pairwise similarity of the speakers' template profiles, or null with fewer than two who
 *  have said enough to be worth comparing. */
export const MIN_SPEAKER_LINES = 10;
export function convergenceOf(tagger: Tagger, byWho: Record<string, string[]>): number | null {
  const who = Object.entries(byWho).filter(([, l]) => l.length >= MIN_SPEAKER_LINES);
  if (who.length < 2) return null;
  const vecs = who.map(([, l]) => shareVector(profileOf(tagger, l)));
  let sum = 0, pairs = 0;
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { sum += cosine(vecs[i], vecs[j]); pairs++; }
  return pairs ? sum / pairs : null;
}

/**
 * Compare the recent window against everything before it.
 *
 * `baseline` may be empty — a young save has no past to be flattening against, and then every hot
 * template reads as a pure rise, which is the honest answer for a story whose voice is still the
 * only voice it has had.
 */
export function compare(recent: Profile, baseline: Profile, convergence: number | null = null): Reading {
  if (!recent.lineCount) return { concentration: 0, convergence, perToken: 0, hot: [], lines: 0 };
  const cands: HotTemplate[] = [];
  for (const [pattern, n] of recent.lines) {
    if (n < MIN_LINES) continue;
    const now = n / recent.lineCount;
    if (now < MIN_SHARE) continue;
    const before = baseline.lineCount ? (baseline.lines.get(pattern) ?? 0) / baseline.lineCount : 0;
    const rise = now - before;
    if (rise < MIN_RISE) continue;
    cands.push({ pattern, now, before, rise, examples: recent.examples.get(pattern) ?? [] });
  }
  // THE LONGEST DESCRIPTION OF ONE REPEAT, not five substrings of it. An 8-gram and every 4-gram
  // inside it rise together, so dedup runs longest-first and drops anything contained in something
  // already kept; the survivors are re-sorted by rise for reporting.
  const kept: HotTemplate[] = [];
  for (const h of [...cands].sort((a, b) => b.pattern.length - a.pattern.length)) {
    if (kept.some((k) => k.pattern.includes(h.pattern))) continue;
    kept.push(h);
  }
  kept.sort((a, b) => b.rise - a.rise);
  const top = kept.slice(0, TOP);
  const hotSet = new Set(top.map((k) => k.pattern));
  let carrying = 0, instances = 0;
  for (const [pattern, n] of recent.lines) if (hotSet.has(pattern)) { instances += n; carrying = Math.max(carrying, n); }
  return {
    concentration: concentrationOf(recent),
    convergence,
    perToken: recent.tokenCount ? instances / recent.tokenCount : 0,
    hot: top,
    lines: recent.lineCount,
  };
}

/** How many turns of dialogue make up the "now" window. Small enough to move when the register
 *  moves, large enough that one terse scene does not read as a collapse. */
export const RECENT_TURNS = 12;
/** Below this there is not enough speech to say anything, and a reading off five lines would be
 *  noise presented as a measurement. */
const MIN_LINES_FOR_READING = 8;
/** How far back the baseline reaches, in turns before the recent window.
 *
 *  Bounded for two reasons. Tagging is cheap but not free, and re-tagging all of history on every
 *  turn is work that grows without limit — on a 300-turn save it is a quarter of a million tokens
 *  per turn to compute one number. And it is the wrong comparison anyway: turn 4 of a long campaign
 *  is a different story with a different cast, and drift means drift from the recent past, not from
 *  a stranger. Four times the recent window is enough to be stable and short enough to still be
 *  this story. */
export const BASELINE_TURNS = RECENT_TURNS * 4;

/**
 * The reading for a save, given its prose oldest-first and (optionally) who said what.
 *
 * Returns null when the tagger could not be loaded or there is too little dialogue — and null must
 * always be treated as "no reading", never as "clean". That distinction is the entire lesson of the
 * detector this replaces, which read as silence for twenty-seven turns.
 */
export async function measure(
  proseByTurn: readonly string[],
  attribute?: (prose: string) => Record<string, string[]>,
): Promise<Reading | null> {
  const tagger = await loadTagger();
  if (!tagger) return null;
  const linesFor = (turns: readonly string[]) => turns.flatMap((p) => spokenLines(p, 8, 400));
  const window = proseByTurn.slice(-RECENT_TURNS);
  const recent = linesFor(window);
  const cut = Math.max(0, proseByTurn.length - RECENT_TURNS);
  const before = linesFor(proseByTurn.slice(Math.max(0, cut - BASELINE_TURNS), cut));
  if (recent.length < MIN_LINES_FOR_READING) return null;
  let convergence: number | null = null;
  if (attribute) {
    const byWho: Record<string, string[]> = {};
    for (const p of window) {
      const a = attribute(p);
      for (const k of Object.keys(a)) byWho[k] = [...(byWho[k] ?? []), ...a[k]];
    }
    convergence = convergenceOf(tagger, byWho);
  }
  return compare(profileOf(tagger, recent), profileOf(tagger, before), convergence);
}

/** Concentration a save has to reach before this is worth interrupting anybody about.
 *
 *  A gauge that speaks every time it has a reading is the thing the player was already complaining
 *  about — see engine/shifts.ts, where one internal counter turned out to be a third of every
 *  notification a save ever produced. The healthy stretch of the save this was built on sits at
 *  7–11%; it is only past 12 that the register is visibly closing. So: silent below the bar, and
 *  the detail lives in the Chronicle where somebody has gone looking for it. */
export const NOTABLE = 0.12;

/** One line for the shift feed, or "" — which is the answer almost every turn.
 *
 *  No example sentence in it, deliberately. Partly so the wording is stable enough for the repeat
 *  filter to recognise this as the same piece of news two turns running, and partly because quoting
 *  a line back as a fault is the move the rebound work (arXiv 2511.12381) says primes it — the
 *  player reads these, but so does the person deciding what to write next. */
export function readingNote(r: Reading | null): string {
  if (!r || !r.hot.length || r.concentration < NOTABLE) return "";
  return `the dialogue is narrowing — ${Math.round(r.concentration * 100)}% of it is coming out of ten sentence shapes. The Chronicle shows which.`;
}
