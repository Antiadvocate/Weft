/**
 * LINES THE PLAYER NEVER TYPED.
 *
 * Rainier Valley, turn 51. The player typed `"She can ask her" I get up and start heading home`, and
 * the narration answered with:
 *
 *     "Just—going home," you say. You don't bother with the rest of it.
 *
 * Turn 52 did it again ("Dana can ask Ellie," you say), and the bookkeeper then filed both as
 * things Rabi said, so a line the player never wrote became part of what the coworkers heard him
 * say. In the player's words: it keeps making me say and do random shit.
 *
 * The rule against it is in the narrator contract twice ("Never write the player's thoughts,
 * feelings, words or actions beyond exactly what they typed"), and both copies sit in the cached
 * prefix, where a rule is reference. So this is the check that runs on the output: a quoted line
 * attributed to "you" whose words aren't in what the player typed is cut from the prose before the
 * bookkeeper reads it, and the line is quoted back at the end of the next turn's direction, which
 * is the one thing in this engine that has reliably broken a narrator habit.
 *
 * It stays off when the player asked for their words to be written: on the story channel, and on
 * any turn whose action reports speech without quoting it ("I tell her I'm leaving"), because
 * there the narrator writing the line out is doing what it was asked. Which turns those are is the
 * turn read's to say (`reported_speech`, actionread.ts); it was a list of speech verbs after "I",
 * which every "I let her know" and "I point out" walked past.
 */
import type { ActionMode } from "./types";
import type { ActionRead } from "./actionread";
import { collapseSpaces, isDigit, isLetter, isSpace, paragraphs, quotedLines, words as wordsOf } from "./text";

export interface VoicedLine { line: string; sentence: string }

const SPEECH_VERB = String.raw`(?:say|tell|mutter|add|answer|reply|call|snap|ask|murmur|whisper|manage|offer|admit|insist|repeat|shout|yell|joke|sigh|breathe|start|begin|finish|go\s+on|hear\s+yourself\s+say)(?:s|es|ed|d)?`;
/** `"…," you say` — the attribution right after the closing quote. Lowercase "you" only, so a new
 *  sentence after somebody else's question ("Well?" You say nothing.) isn't read as one. */
const AFTER = new RegExp(String.raw`^\s*,?\s+you\s+${SPEECH_VERB}\b(?!\s+(?:nothing|anything|no\b|so\b))`);
/** `You tell her, "…"` — the attribution in front of the quote, with up to three words between. */
const BEFORE = new RegExp(String.raw`\byou\s+${SPEECH_VERB}(?:\s+[\w']+){0,3}\s*[,:]?\s*$`, "i");
const STOP = new Set("the and but for you your are was were with that this have has had not just what when then there they them she her him his its it's i'm don't can't won't i'll we're you're".split(" "));

function contentWords(s: string): string[] {
  return wordsOf(s.toLowerCase()).filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Letters and digits only, lowercased, one space between: what two lines are compared on. */
function plain(x: string): string {
  let out = "";
  for (const ch of x.toLowerCase()) out += isLetter(ch) || isDigit(ch) ? ch : " ";
  return collapseSpaces(out);
}

/** Most of this line's words came from what the player said aloud (`source`). */
function typed(line: string, source: string): boolean {
  if (plain(line) && plain(source).includes(plain(line))) return true;
  const w = contentWords(line);
  if (!w.length) return false;
  const have = new Set(contentWords(source));
  return w.filter((x) => have.has(x)).length / w.length >= 0.6;
}

/** Runs of two or more spaces or tabs closed up to one space; newlines are left where they are. */
function closeGaps(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " " && text[i] !== "\t") { out += text[i]; continue; }
    let j = i;
    while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
    out += j - i >= 2 ? " " : text[i];
    i = j - 1;
  }
  return out;
}

/** Quoted spans in a paragraph, as [open, close] indices, pairing marks in order. */
function quotes(para: string): [number, number][] {
  const out: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < para.length; i++) {
    const ch = para[i];
    if (ch === "“" || (ch === '"' && open < 0)) { if (open < 0) open = i; continue; }
    if ((ch === "”" || ch === '"') && open >= 0) { out.push([open, i]); open = -1; }
  }
  return out;
}

/** Where the sentence holding index `i` starts, scanning back to the last terminator outside quotes. */
function sentenceStart(para: string, i: number, spans: [number, number][]): number {
  for (let k = i - 1; k >= 0; k--) {
    if (!".!?".includes(para[k])) continue;
    if (spans.some(([a, b]) => k > a && k < b)) continue;
    return k + 1;
  }
  return 0;
}

/** Where the sentence that continues after index `i` ends, at the next terminator outside quotes. */
function sentenceEnd(para: string, i: number, spans: [number, number][]): number {
  for (let k = i; k < para.length; k++) {
    if (!".!?".includes(para[k])) continue;
    if (spans.some(([a, b]) => k > a && k < b)) continue;
    let e = k + 1;
    while (e < para.length && ".!?".includes(para[e])) e++;
    return e;
  }
  return para.length;
}

/** What follows a closing quote starts a new sentence: nothing but space, or space and then a
 *  capital, with an opening quote allowed in front of it. */
function opensSentence(rest: string): boolean {
  let i = 0;
  while (i < rest.length && isSpace(rest[i])) i++;
  if (i === rest.length) return true;
  if (i === 0) return false;
  if (rest[i] === '"' || rest[i] === "“") i++;
  const ch = rest[i] ?? "";
  return ch >= "A" && ch <= "Z";
}

/**
 * Cut every line of dialogue attributed to the player that the player didn't type. Returns the
 * prose unchanged when there is nothing to cut, on the story and think channels, and when the
 * action reported speech without quoting it.
 *
 * A narrated line is the player's own when it matches what they said aloud this turn (`read.said`).
 * When the read has no lines in it, the lines are the ones the player typed in quotation marks, or
 * the whole of it on the say channel, so a turn whose read failed never has the player's own words
 * cut out of it.
 */
export function scrubPlayerVoice(prose: string, action: string, mode: ActionMode, read: ActionRead): { prose: string; cut: VoicedLine[] } {
  const cut: VoicedLine[] = [];
  if (!prose || mode === "story" || mode === "think") return { prose, cut };
  if (read.reported_speech) return { prose, cut };
  const source = (read.said.length ? read.said : mode === "say" ? [String(action ?? "")] : quotedLines(action)).join("\n");
  const paras = paragraphs(prose);
  const rebuilt = paras.map((para) => {
    const spans = quotes(para);
    const drop: [number, number][] = [];
    for (const [a, b] of spans) {
      const line = para.slice(a + 1, b).trim();
      const after = para.slice(b + 1, b + 80);
      const before = para.slice(Math.max(0, a - 60), a);
      const attributed = AFTER.test(after) || BEFORE.test(before);
      if (!attributed || typed(line, source)) continue;
      const from = sentenceStart(para, a, spans);
      // `You tell her, "I'm done." She blinks.` — the line closed its own sentence, so the cut stops
      // at the quote mark and "She blinks." stays.
      const closed = BEFORE.test(before) && ".!?…".includes(line.slice(-1) || " ") && opensSentence(para.slice(b + 1));
      const to = closed ? b + 1 : sentenceEnd(para, b + 1, spans);
      drop.push([from, to]);
      cut.push({ line: line.slice(0, 160), sentence: para.slice(from, to).trim().slice(0, 240) });
    }
    if (!drop.length) return para;
    let out = "", at = 0;
    for (const [f, t] of drop.sort((x, y) => x[0] - y[0])) {
      if (f < at) continue;
      out += para.slice(at, f);
      at = t;
    }
    out = closeGaps(out + para.slice(at)).trim();
    // A cut that strands a quote mark is worse than the line it removed; keep the paragraph whole.
    if ([...out].filter((ch) => ch === '"' || ch === "“" || ch === "”").length % 2 === 1) return para;
    return out;
  });
  if (!cut.length) return { prose, cut };
  const out = rebuilt.filter((p) => p.trim()).join("\n\n");
  // Never empty a turn. If the narration was nothing but the player's invented lines, keep it as written.
  if (!out.trim()) return { prose, cut: [] };
  return { prose: out, cut };
}

/** Quoted back at the end of the next turn's direction. */
export function voicedFix(hit: VoicedLine | null | undefined): string {
  if (!hit) return "";
  return `\nLAST TURN THE NARRATION GAVE THE PLAYER A LINE THEY NEVER TYPED: "${hit.line}", in «${hit.sentence}». It was cut before anyone could hear it. The player's character says only what the player types, in quotes or as reported speech, so when the moment seems to want a reply from them, end the turn there and leave the reply to the player.`;
}
