/**
 * STOCK PHRASES — the sentences a narrator writes because a thousand other narrators wrote them.
 *
 * "Took a deep breath." "Her voice barely above a whisper." "A shiver ran down his spine." None of
 * these is wrong, and none of them is anybody's: they are what a model reaches for when the scene
 * has given it nothing particular to put there, and a reader who has seen them in other stories
 * stops seeing this one. The reviser has always caught one family of narrator tics — the sentence
 * that claims to know what somebody felt — and it was mined by hand from real saves. This is the
 * other family, and it is too big to mine by hand, so it comes from a corpus: a ranked list of the
 * phrases language models over-produce relative to human writers (see stockphrases.ts for where it
 * came from and what was changed).
 *
 * HOW IT IS USED — and how it is never used. The list is never put in a prompt. A phrase pasted
 * into a prohibition is a phrase the model has just been handed (tests/prompt-echo.ts exists to
 * catch exactly that), so the list only ever reads OUTPUT:
 *
 *   · the reviser repairs a flagged narration sentence when the player has it on;
 *   · the next turn is shown ONE phrase the narrator itself wrote, when stock phrasing recurs —
 *     the same after-the-fact quote that maxims.ts uses, which is the only safe place to quote it;
 *   · on a local KoboldCpp, the literal list can be banned in the sampler itself (llm.ts), which
 *     backtracks before the phrase is ever written. Opt-in, because other servers reject the field.
 *
 * Only words outside quotation marks are read. "She said, her voice barely above a whisper" is the
 * narrator's sentence even though somebody speaks in it; what is inside the quotes was said, and
 * how people talk is not this module's business.
 */
import { STOCK_PHRASES } from "./stockphrases";

const POSS = new Set(["my", "his", "her", "their", "your", "its", "our"]);
const SUBJ = new Set(["i", "he", "she", "they", "you", "we"]);
const OBJ = new Set(["me", "him", "them", "us"]);

/** Words of a text, each with its folded form (pronouns collapsed so one phrase covers them all). */
function words(text: string): { raw: string; fold: string }[] {
  return (String(text ?? "").replace(/[’‘]/g, "'").match(/[A-Za-z']+/g) ?? []).map((raw) => {
    const w = raw.toLowerCase();
    return { raw, fold: POSS.has(w) ? "POSS" : SUBJ.has(w) ? "SUBJ" : OBJ.has(w) ? "OBJ" : w };
  });
}

/** The text with everything inside quotation marks removed — what the narrator wrote, not what
 *  anybody said. */
export function narrationOnly(sentence: string): string {
  return String(sentence ?? "").replace(/["“][^"“”]*["”]|«[^»]*»/g, " … ");
}

const PHRASES = STOCK_PHRASES.map((p, rank) => ({ toks: p.split(" "), rank }));
const FIRST = new Map<string, typeof PHRASES>();
for (const p of PHRASES) (FIRST.get(p.toks[0]) ?? FIRST.set(p.toks[0], []).get(p.toks[0])!).push(p);

/** Every stock phrase in this text, as the words actually written, most over-used first. */
export function stockIn(text: string): { phrase: string; rank: number }[] {
  const ws = words(text);
  const hits: { phrase: string; rank: number }[] = [];
  for (let i = 0; i < ws.length; i++) {
    for (const p of FIRST.get(ws[i].fold) ?? []) {
      if (i + p.toks.length > ws.length) continue;
      let ok = true;
      for (let k = 1; k < p.toks.length && ok; k++) ok = ws[i + k].fold === p.toks[k];
      if (ok) hits.push({ phrase: ws.slice(i, i + p.toks.length).map((w) => w.raw).join(" "), rank: p.rank });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank);
}

const SENT_SPLIT = /[^.!?]*[.!?]+["'”’]?\s*|[^.!?]+$/g;

export interface StockHit { phrase: string; sentence: string; rank: number }

/** One hit per sentence — its most over-used phrase — reading narration only. */
export function findStock(prose: string): StockHit[] {
  const out: StockHit[] = [];
  for (const para of String(prose ?? "").split(/\n\n+/)) {
    for (const raw of para.match(SENT_SPLIT) ?? [para]) {
      const sentence = raw.trim();
      if (sentence.length < 12) continue;
      const best = stockIn(narrationOnly(sentence))[0];
      if (best) out.push({ phrase: best.phrase, sentence, rank: best.rank });
    }
  }
  return out;
}

const key = (phrase: string) => words(phrase).map((w) => w.fold).join(" ");

/**
 * The one phrase to quote back next turn, or null. A single stock phrase in a turn is the cost of
 * writing prose; two in one turn, or the same one coming back, is the habit. Quoting every turn
 * would make the note wallpaper, and wallpaper is what the cached rules already are.
 */
export function stockToQuote(prose: string, recent: readonly string[]): StockHit | null {
  const hits = findStock(prose);
  if (!hits.length) return null;
  const distinct = new Map(hits.map((h) => [key(h.phrase), h]));
  const before = new Set(recent.slice(-5).flatMap((p) => findStock(p).map((h) => key(h.phrase))));
  const recurring = hits.find((h) => before.has(key(h.phrase)));
  if (recurring) return recurring;
  return distinct.size >= 2 ? hits.sort((a, b) => a.rank - b.rank)[0] : null;
}

/** The next turn's note: the narrator's own sentence, the phrase in it, and what to do instead. */
export function stockFix(hit: { phrase: string; sentence: string } | null | undefined): string {
  if (!hit) return "";
  return `\nA PHRASE YOU WROTE LAST TURN IS ONE THAT TURNS UP IN THOUSANDS OF OTHER STORIES: «${hit.phrase}», in "${hit.sentence.slice(0, 220)}". It was written because the moment needed something and that was nearest to hand, so it would fit any person in any room.
When a moment like that comes up this turn, look at what this particular person in this particular room is doing with their hands, their eyes and their feet, or at what is in front of them, and write that instead. If there is nothing particular to write, leave the moment out and go on to the next thing that happens.`;
}

/** True when `replacement` brings in a stock phrase `original` did not have. For the reviser's
 *  acceptance check: a repair may not trade one stock phrase for another. */
export function introducesStock(original: string, replacement: string): boolean {
  const had = new Set(stockIn(narrationOnly(original)).map((h) => key(h.phrase)));
  return stockIn(narrationOnly(replacement)).some((h) => !had.has(key(h.phrase)));
}
