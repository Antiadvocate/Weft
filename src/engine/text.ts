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

/* ── PLAIN TEXT, BY HAND ───────────────────────────────────────────────────────────────────────
 *
 * Nothing in this engine reads text with a regular expression. What a sentence MEANS is the
 * models' to judge, and it reaches the engine as structured fields (see actionread.ts and the
 * bookkeeper's schema); a pattern over words was always a guess at that, and a narrator that can
 * phrase anything any way outruns every list. What's left is handling text as text: spaces, words,
 * sentences, paragraphs, quoted lines. These do that by walking the characters. */

const SPACES = new Set([" ", "\n", "\t", "\r", "\f", "\v", "\u00a0", "\u1680", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"]);
export function isSpace(ch: string): boolean {
  return SPACES.has(ch) || (ch >= "\u2000" && ch <= "\u200a");
}
export function isDigit(ch: string): boolean { return ch >= "0" && ch <= "9"; }
/** A letter in any script that has case, plus the caseless scripts (CJK, Arabic, Hebrew, Thai and so on). */
export function isLetter(ch: string): boolean {
  if (!ch) return false;
  if (ch.toLowerCase() !== ch.toUpperCase()) return true;
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x0590 && !(c >= 0x2000 && c <= 0x2bff) && !(c >= 0x3000 && c <= 0x303f) && !(c >= 0xfe30 && c <= 0xfe4f) && !(c >= 0xff00 && c <= 0xff20);
}
export function isWordChar(ch: string): boolean { return isLetter(ch) || isDigit(ch) || ch === "_"; }

/** Whitespace runs collapsed to one space, ends trimmed. */
export function collapseSpaces(text: unknown): string {
  const s = String(text ?? "");
  let out = "", gap = false;
  for (const ch of s) {
    if (isSpace(ch)) { gap = out.length > 0; continue; }
    if (gap) { out += " "; gap = false; }
    out += ch;
  }
  return out;
}

/** Trim any of `chars` (and whitespace) off the end. */
export function trimEndOf(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && (chars.includes(text[end - 1]) || isSpace(text[end - 1]))) end--;
  return text.slice(0, end);
}
/** Trim any of `chars` (and whitespace) off both ends. */
export function trimOf(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && (chars.includes(text[start]) || isSpace(text[start]))) start++;
  return trimEndOf(text.slice(start), chars);
}

/** The words in it: runs of letters, digits and inner apostrophes ("don't", "Isolde's"). */
export function words(text: unknown): string[] {
  const s = String(text ?? "");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const apostrophe = (ch === "'" || ch === "\u2019") && cur && isWordChar(s[i + 1] ?? "");
    if (isWordChar(ch) || apostrophe) { cur += ch; continue; }
    if (cur) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Index of `phrase` in `text` as whole words, case-insensitive, from `from`; -1 when absent. */
export function indexOfWords(text: string, phrase: string, from = 0): number {
  const hay = text.toLowerCase(), needle = phrase.toLowerCase().trim();
  if (!needle) return -1;
  let at = hay.indexOf(needle, from);
  while (at !== -1) {
    const before = at === 0 ? "" : hay[at - 1];
    const after = hay[at + needle.length] ?? "";
    if (!isWordChar(before) && !isWordChar(after)) return at;
    at = hay.indexOf(needle, at + 1);
  }
  return -1;
}
/** Whether `phrase` appears in `text` as whole words, case-insensitive. */
export function hasWords(text: unknown, phrase: string): boolean {
  return indexOfWords(String(text ?? ""), phrase) !== -1;
}

const TERMINAL = ".!?\u2026";
const CLOSERS = "\"\u201d')]\u2019";

/** Sentences, each with its own end mark and any closing quote; a quoted line isn't split inside. */
export function sentences(text: unknown): string[] {
  const s = String(text ?? "");
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    buf += s[i];
    if (!TERMINAL.includes(s[i])) continue;
    while (i + 1 < s.length && TERMINAL.includes(s[i + 1])) buf += s[++i];
    while (i + 1 < s.length && CLOSERS.includes(s[i + 1])) buf += s[++i];
    if (i + 1 < s.length && !isSpace(s[i + 1])) continue;
    const t = buf.trim();
    if (t) out.push(t);
    buf = "";
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}

/** Paragraphs: blocks separated by a blank line. */
export function paragraphs(text: unknown): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (line.trim() === "") { if (cur.length) { out.push(cur.join("\n")); cur = []; } continue; }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

/** Every span between `open` and `close`, without the marks. Unclosed spans run to the end. */
export function between(text: unknown, open: string, close: string): string[] {
  const s = String(text ?? "");
  const out: string[] = [];
  let at = s.indexOf(open);
  while (at !== -1) {
    const end = s.indexOf(close, at + open.length);
    out.push(s.slice(at + open.length, end === -1 ? undefined : end));
    if (end === -1) break;
    at = s.indexOf(open, end + close.length);
  }
  return out;
}
/** The text with every span between `open` and `close` (marks included) replaced by `fill`. */
export function without(text: unknown, open: string, close: string, fill = " "): string {
  const s = String(text ?? "");
  let out = "", from = 0;
  let at = s.indexOf(open);
  while (at !== -1) {
    out += s.slice(from, at) + fill;
    const end = s.indexOf(close, at + open.length);
    if (end === -1) return out;
    from = end + close.length;
    at = s.indexOf(open, from);
  }
  return out + s.slice(from);
}

/** The lines spoken in quotation marks, straight or curly. */
export function quotedLines(text: unknown): string[] {
  const s = String(text ?? "");
  const out: string[] = [];
  let buf = "", open: string | null = null;
  for (const ch of s) {
    if (open === null) { if (ch === '"' || ch === "\u201c") { open = ch; buf = ""; } continue; }
    if ((open === '"' && ch === '"') || (open === "\u201c" && (ch === "\u201d" || ch === '"'))) { const t = buf.trim(); if (t) out.push(t); open = null; continue; }
    buf += ch;
  }
  return out;
}
/** The text with every quoted line replaced by a space: what was done, as opposed to what was said. */
export function unquoted(text: unknown): string {
  const s = String(text ?? "");
  let out = "", open: string | null = null;
  for (const ch of s) {
    if (open === null) { if (ch === '"' || ch === "\u201c") { open = ch; out += " "; } else out += ch; continue; }
    if ((open === '"' && ch === '"') || (open === "\u201c" && (ch === "\u201d" || ch === '"'))) open = null;
  }
  return out;
}

/** Whitespace collapsed, ends trimmed. Model output arrives with stray newlines and doubled spaces
 *  more often than not, and they make every length measurement below lie. */
function normalize(text: unknown): string {
  return collapseSpaces(text);
}

/** Where a sentence ends, inside `head`. Handles the ellipsis and the closing quote that a line of
 *  dialogue ends on, so a quoted sentence counts as a whole statement. */
function lastSentenceEnd(head: string): number {
  let best = -1;
  for (let i = 0; i < head.length; i++) {
    if (!TERMINAL.includes(head[i])) continue;
    let end = i + 1;
    if (end < head.length && CLOSERS.includes(head[end])) end++;
    // a terminal mark at the very end of the head counts too: there is no trailing space to find
    if (end === head.length || isSpace(head[end])) best = Math.max(best, end);
  }
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

  const clause = Math.max(head.lastIndexOf("; "), head.lastIndexOf(", "), head.lastIndexOf(" \u2014 "));
  if (clause >= max * 0.6) return trimEndOf(head.slice(0, clause).trim(), ",;") + "\u2026";

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
  return trimEndOf(sp > 0 ? head.slice(0, sp) : head, ",;:\u2014-") + "\u2026";
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
  const parts = sentences(s);
  if (parts.length <= n) return s;
  return parts.slice(0, n).join(" ").trim();
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
  let start = -1;
  for (let i = 0; i + 2 < cut.length; i++) {
    if (TERMINAL.includes(cut[i]) && isSpace(cut[i + 1]) && !isSpace(cut[i + 2])) { start = i; break; }
  }
  return `\u2026${(start >= 0 ? cut.slice(start + 1) : cut).trim()}`;
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
    new Set(words(String(v ?? "").toLowerCase()).map((w) => w.split("'").join("").split("\u2019").join("")).filter((w) => w.length > 3 && !OVERLAP_STOP.has(w)));
  const a = toks(rawA), b = toks(rawB);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Split a paragraph into sentences, treating a quoted line as one indivisible thing.
 *
 * The obvious version cuts "Hi. I'm Rabi." into three pieces and hands them to callers that may drop
 * one, which leaves an opening quote mark with no line behind it and an attribution for words nobody
 * said. Full stops inside quotation marks are not sentence ends as far as any caller here is
 * concerned: the unit is the spoken line plus whatever attribution follows it.
 */
export function splitSentencesOutsideQuotes(para: string): string[] {
  const out: string[] = [];
  let buf = "", inQuote = false;
  for (let i = 0; i < para.length; i++) {
    const ch = para[i];
    buf += ch;
    if (ch === '"' || ch === "\u201c" || ch === "\u201d") { inQuote = ch === "\u201d" ? false : ch === "\u201c" ? true : !inQuote; continue; }
    if (inQuote || !".!?".includes(ch)) continue;
    // run out any repeated terminals and the whitespace that follows, so the split lands cleanly
    while (i + 1 < para.length && ".!?".includes(para[i + 1])) buf += para[++i];
    while (i + 1 < para.length && isSpace(para[i + 1])) buf += para[++i];
    out.push(buf); buf = "";
  }
  if (buf) out.push(buf);
  return out.length ? out : [para];
}
