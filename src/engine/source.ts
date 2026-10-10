/**
 * SOURCE TEXT — building a world out of somebody's book instead of out of one line.
 *
 * The Forge takes a seed idea, and a seed idea is a sentence. A player who wants to start inside a
 * story that already exists — the first chapters of a novel, a campaign's setting document, a story
 * bible they wrote themselves — had nowhere to put it but the seed box, and the seed box was sent
 * whole. Paste forty thousand words and the request either fails on the provider's limit or, worse,
 * succeeds on a model that silently reads the opening and builds the world out of chapter one.
 *
 * The fix is borrowed from a document-to-simulation pipeline that had the same problem with novels:
 * don't truncate, SAMPLE. Cut the text into chunks, take chunks evenly spaced from the first to the
 * last so the beginning, the middle and the end are all represented, and when even one chunk is too
 * long, keep its opening and its close and drop its middle. A cast assembled from evenly spaced
 * excerpts meets the people who only turn up in act three, and a cast assembled from the head meets
 * nobody but the narrator's family.
 *
 * Pure and deterministic: the same text and budget produce the same excerpt, so a forge that fails
 * and is retried is retried on the same material.
 */

/** Characters of source text a forge request carries. ~10k tokens: room for a real sample, and well
 *  inside every model the forge is offered on, with the 8k-token world still to be written. */
export const SOURCE_BUDGET = 40_000;
const CHUNK = 6_000;
const MIN_EXCERPT = 600;
const MAX_CHUNKS = 24;

export interface SourceSample {
  /** What the forge reads: the whole text when it fits, otherwise the labelled excerpts. */
  text: string;
  /** True when the text was cut down to fit. */
  sampled: boolean;
  /** Characters in the original. */
  total: number;
  /** How many parts the original was cut into, and how many of them are represented. */
  parts: number;
  used: number;
}

/** Normalise what a file reader hands back: line endings, BOMs, runs of blank lines. */
export function cleanSourceText(raw: string): string {
  return String(raw ?? "")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut text into chunks of about `size`, breaking at a paragraph if one is near, else a sentence. */
export function chunkText(text: string, size = CHUNK): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const window = text.slice(i + Math.floor(size * 0.6), end);
      const para = window.lastIndexOf("\n\n");
      const sent = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"), window.lastIndexOf("? "), window.lastIndexOf("! "));
      const cut = para >= 0 ? para + 2 : sent >= 0 ? sent + 2 : -1;
      if (cut >= 0) end = i + Math.floor(size * 0.6) + cut;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    i = end;
  }
  return out;
}

/** `count` indexes spread evenly from 0 to n−1, first and last always included. */
export function evenlySpaced(n: number, count: number): number[] {
  if (n <= count) return [...Array(n).keys()];
  if (count <= 1) return [0];
  const picked = new Set<number>();
  for (let k = 0; k < count; k++) picked.add(Math.round((k * (n - 1)) / (count - 1)));
  return [...picked].sort((a, b) => a - b);
}

/** Keep the opening and the close of a passage that is too long, and say what was dropped. */
export function headAndTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[…]\n";
  const room = Math.max(0, limit - marker.length);
  const head = Math.ceil(room / 2), tail = room - head;
  return `${text.slice(0, head).trimEnd()}${marker}${text.slice(text.length - tail).trimStart()}`;
}

/** The excerpt of a source text the forge is given. See the file header. */
export function sampleSource(raw: string, budget = SOURCE_BUDGET): SourceSample {
  const text = cleanSourceText(raw);
  if (text.length <= budget) return { text, sampled: false, total: text.length, parts: 1, used: 1 };
  const chunks = chunkText(text);
  const picks = evenlySpaced(chunks.length, MAX_CHUNKS);
  const header = 200, perLabel = 40;
  const per = Math.max(MIN_EXCERPT, Math.floor((budget - header - perLabel * picks.length) / picks.length));
  const body = picks.map((i) => `— part ${i + 1} of ${chunks.length} —\n${headAndTail(chunks[i], per)}`).join("\n\n");
  const lead = `(${text.length.toLocaleString("en")} characters, cut into ${chunks.length} parts; ${picks.length} parts are excerpted below, spaced evenly from the first to the last, so the people and places from the middle and the end of the text are here as well as the opening.)`;
  return { text: `${lead}\n\n${body}`.slice(0, budget), sampled: true, total: text.length, parts: chunks.length, used: picks.length };
}
