/**
 * TEXT BUDGETS — one place that decides how a written field gets shortened.
 *
 * THE BUG THIS FILE EXISTS FOR. A model cannot count its own characters. Ask for "250–300
 * characters" and you get somewhere between 180 and 700, because the number is not something it can
 * check while it writes — it is a target it approximates. Every field in this engine was then cut
 * with a bare `slice(0, N)`, which is a guillotine at a byte offset: it lands mid-word about
 * four times in five, and the sentence it severs is very often the one carrying the point.
 *
 * Real examples pulled out of saves:
 *
 *   "Miranda accepts Vin's request to keep his cum on his penis instead of"
 *   "…regardless of context or situation and doesn't ev"
 *   "He arrived in Rome three days ago, disoriented and terr"
 *
 * The first is not a shorter record of the turn, it is a different and wrong one, and it goes back
 * into the next prompt reading as complete. The second is a want the player wrote by hand, stopped
 * mid-word, and handed to the narrator on every turn afterwards. None of these are display bugs:
 * the truncated text IS the state from that point on.
 *
 * So: two rules everywhere.
 *
 *   1. THE BUDGET IS GENEROUS ENOUGH THAT A COMPLIANT ANSWER IS NEVER CUT. If the prompt asks for
 *      three sentences, the budget holds four. Clipping is the guard against a runaway, not the
 *      normal path — a field that clips on ordinary output has the wrong budget, not the wrong
 *      clipper.
 *   2. WHEN IT DOES CLIP, IT CLIPS WHERE A READER WOULD. A sentence boundary first, so what
 *      survives is a whole statement; a clause boundary next; a word boundary as the floor. Never
 *      mid-word, and never silently — a cut that is not on a sentence end is marked with an
 *      ellipsis so the next reader (model or person) can tell there was more.
 *
 * Six near-identical versions of this used to live in intent.ts, coerce.ts, authored.ts and three
 * separate closures inside prompts.ts, each with slightly different thresholds. They are all this
 * function now.
 */

/** Whitespace collapsed, ends trimmed. Model output arrives with stray newlines and doubled spaces
 *  more often than not, and they make every length measurement below lie. */
function normalize(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Where a sentence ends, inside `head`. Handles the ellipsis and the closing quote that a line of
 *  dialogue ends on, so a quoted sentence counts as a whole statement. */
function lastSentenceEnd(head: string): number {
  let best = -1;
  for (const m of head.matchAll(/[.!?…]["”')\]]?(?=\s)/g)) {
    const end = m.index! + m[0].length;
    if (end > best) best = end;
  }
  // a terminal mark at the very end of the head counts too — there is no trailing space to match
  if (/[.!?…]["”')\]]?$/.test(head)) best = head.length;
  return best;
}

/**
 * Cut `text` to at most `max` characters without severing a statement.
 *
 * Prefers, in order: the last sentence end that keeps at least half the budget (returned whole, no
 * ellipsis — nothing was lost mid-thought); the last clause boundary that keeps 60% (marked); the
 * last word boundary (marked). Text already inside the budget is returned untouched apart from
 * whitespace normalization.
 */
export function clipText(text: unknown, max: number): string {
  const s = normalize(text);
  if (!s || s.length <= max) return s;
  const head = s.slice(0, max);

  const stop = lastSentenceEnd(head);
  if (stop >= max * 0.5) return head.slice(0, stop).trim();

  const clause = Math.max(head.lastIndexOf("; "), head.lastIndexOf(", "), head.lastIndexOf(" — "));
  if (clause >= max * 0.6) return head.slice(0, clause).trim().replace(/[,;]$/, "") + "…";

  // `s`, not `head`: clipWords measures against the budget, and a head that is already exactly
  // `max` long looks to it like text that fits — which returned the mid-word cut untouched.
  return clipWords(s, max);
}

/** Whole words only, always marked. The floor `clipText` falls back to, and the right tool on its
 *  own for a short label where a sentence boundary will never turn up inside the budget. */
export function clipWords(text: unknown, max: number): string {
  const s = normalize(text);
  if (!s || s.length <= max) return s;
  const head = s.slice(0, max);
  const sp = head.lastIndexOf(" ");
  return (sp > 0 ? head.slice(0, sp) : head).replace(/[\s,;:—-]+$/, "") + "…";
}

/**
 * Keep at most `n` whole sentences, and nothing else.
 *
 * For the fields a prompt asks for in sentences, which is the one unit a model reliably counts. A
 * two-sentence answer to a "two sentences" instruction passes through untouched; a model that
 * wrote six gets the first two, whole.
 */
export function firstSentences(text: unknown, n: number): string {
  const s = normalize(text);
  if (!s) return s;
  const parts = s.match(/[^.!?…]+(?:[.!?…]+["”')\]]?|$)/g);
  if (!parts || parts.length <= n) return s;
  return parts.slice(0, n).map((x) => x.trim()).join(" ").trim();
}

/**
 * THE TAIL of an accreting log, cut on a sentence boundary at the FRONT.
 *
 * A running history is append-only, so what a reader needs from it is where the person has just got
 * to, not where they started. Cutting from the end keeps the recent part; starting at the first
 * sentence boundary inside the window means it opens on a whole sentence rather than mid-clause.
 */
export function clipTail(text: unknown, max: number): string {
  const s = normalize(text);
  if (!s || s.length <= max) return s;
  const cut = s.slice(s.length - max);
  const start = cut.search(/[.!?…]\s+\S/);
  return `…${(start >= 0 ? cut.slice(start + 1) : cut).trim()}`;
}

/**
 * Content-word overlap between two short strings, 0..1, as a fraction of the SMALLER one.
 *
 * The near-duplicate test every subsystem that can open a record needs: two thread titles, two
 * consequence descriptions, two wants. Coerces on the way in on purpose — every caller passes a
 * hand-editable field, and one of them being blank is a real state rather than a programming error,
 * so it scores zero instead of taking the turn down.
 */
const OVERLAP_STOP = new Set(
  ("the a an of in on and with from to for by at as that this it is are was were be has have had who "
    + "which their they them his her its if when then now up down two one").split(" "),
);

export function overlapRatio(rawA: unknown, rawB: unknown): number {
  const toks = (v: unknown) =>
    new Set(String(v ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !OVERLAP_STOP.has(w)));
  const a = toks(rawA), b = toks(rawB);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}
