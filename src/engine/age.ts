/**
 * AGE — THE NUMBER THE PLAYER EDITS, AND THE DOZEN PLACES THE OLD ONE IS STILL WRITTEN DOWN.
 *
 * A player changed a character from 15 to 20 in her profile. The card printed 20 from that moment
 * on — `charCard` reads `ident.age` live, so did the speech block, so did the portrait prompt. And
 * the cast went on calling her fifteen, and she said it about herself.
 *
 * Age is stored twice. Once as a number, which the profile edits, and once — over and over — as
 * PROSE, which it does not:
 *
 *   - `appearance_facts`, the bedrock look, which the forge is explicitly told to give an
 *     "apparent age" and which is printed to the narrator marked "(constant)";
 *   - `background` and `life_history`, printed as her nature and what has happened to her since;
 *   - the memory banks of everyone who knows her — core memories, beliefs, the durable fact ledger,
 *     episodic recall — any of which may hold "Mira is fifteen" as settled knowledge;
 *   - edge notes, live rumors, and canon.
 *
 * Every one of those is read back into context every turn, and the sentence "she is fifteen" is a
 * far louder instruction to a language model than the token "20" sitting in a comma-separated card.
 * So the record said one thing and the story said another, and the story won.
 *
 * This module is the reconciliation. When the age on the record changes, PRESENT-TENSE claims about
 * the old one are restated wherever the engine stores them, in the form they were written in
 * (numeral stays numeral, "fifteen" becomes "twenty"). What is NOT touched:
 *
 *   - HISTORY. "She left home at fifteen", "her mother was fifteen when she had her", "on her
 *     fifteenth birthday" — these are true statements about the past and are still true after the
 *     edit. Only the constructions that assert a CURRENT age are rewritten, which is why the verb
 *     list here holds `is` and `looks` and refuses `was` and `turned`.
 *   - SOMEBODY ELSE'S AGE. A sentence in her background about her brother being fifteen is his
 *     fact, not hers. Matches behind another cast member's name or a possessive kin phrase are left
 *     alone and reported instead.
 *   - THE PROSE ALREADY PLAYED. `history` is the record of what was actually written; the engine
 *     does not go back and edit what happened. The recent-turns block will carry the old number for
 *     a few turns, which is exactly what the age-authority line in the cast block is for.
 *
 * Anything that matched a stale age but was deliberately left alone comes back in the report, so
 * the edit tells the player what it changed and what it wants a human to look at.
 */
import type { SaveState } from "./types";

const UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** An age as English. Past ninety-nine it stays a numeral — nobody writes "one hundred and four"
 *  into an appearance line, and a wrong guess there is worse than a digit. */
export function ageWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return UNITS[n];
  const t = TENS[Math.floor(n / 10)], u = n % 10;
  return u ? `${t}-${UNITS[u]}` : t;
}

/** Every written form of an age: the numeral, the word, and the un-hyphenated word. */
export function ageForms(n: number): string[] {
  const out = [String(n)];
  const w = ageWord(n);
  if (!/^\d+$/.test(w)) {
    out.push(w);
    if (w.includes("-")) out.push(w.replace("-", " "));
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Longest-first so "twenty-one" is tried before "twenty" would be, if both were ever in play. */
const alt = (n: number) => `(?:${ageForms(n).sort((a, b) => b.length - a.length).map(esc).join("|")})`;

/** Keep the form the author used: a numeral stays a numeral, a word stays a word, and a
 *  sentence-initial capital survives. */
function restate(token: string, to: number): string {
  const out = /^\d+$/.test(token) ? String(to) : ageWord(to);
  return /^[A-Z]/.test(token) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/** A bare number is a count far more often than an age. Nothing is rewritten when the next word
 *  makes it a measurement, a price, or a crowd. */
const NOT_AN_AGE =
  `(?!\\s*[-\\u2013\\u2014]?\\s*(?:year|month|week|day|hour|minute|second|mile|league|pace|step|yard|foot|feet|inch|` +
  `cm|kg|metre|meter|kilo|coin|piece|denari|sesterc|silver|gold|copper|men|women|people|others|of)e?s?\\b)`;

/** Relations — always somebody other than the person whose card this is. */
const RELATIVE = `mother|father|mum|mam|da|brother|sister|son|daughter|cousin|aunt|uncle|niece|nephew|` +
  `husband|wife|friend|neighbou?r|apprentice|master|mistress|twin`;
/** Words that name a person WITHOUT saying which one: "her girl" is her daughter, "the girl" in a
 *  character's own appearance line is the character. Only the possessive form marks a third party. */
const KIN = `${RELATIVE}|boy|girl|child|kid|lad|lass`;

/** Someone ELSE is the subject of this clause — a kin phrase sitting right in front of the match
 *  ("her brother is fifteen", "the mother is fifteen"). Their age is not this character's age. */
const OTHER_SUBJECT = [
  new RegExp(`\\b(?:his|her|their|its|my|your|our)\\s+(?:${KIN})(?:'s|s')?\\s+\\S*\\s*$`, "i"),
  new RegExp(`\\bthe\\s+(?:${RELATIVE})(?:'s|s')?\\s+\\S*\\s*$`, "i"),
];

export interface AgeFix { where: string; before: string; after: string }
export interface AgeReport {
  from: number;
  to: number;
  fixes: AgeFix[];
  /** Matched the old age and was deliberately left alone (history, or somebody else's age), or the
   *  old number is still sitting there in a shape no rule claims. For the player to read. */
  left: { where: string; text: string }[];
  /** Turns of already-played prose that still say the old age. Never rewritten; counted so the
   *  player knows why the cast may echo it for a beat. */
  prose_turns: number;
}

const snip = (text: string, at: number, len: number) => {
  const s = Math.max(0, at - 45), e = Math.min(text.length, at + len + 45);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).replace(/\s+/g, " ").trim()}${e < text.length ? "…" : ""}`;
};

/**
 * Restate present-tense claims of `from` as `to` in one piece of text.
 * Returns the new text, plus every spot that looked like the old age and was left standing.
 */
export function restateAge(text: string, from: number, to: number): { text: string; left: string[] } {
  if (!text || from === to || !Number.isFinite(from) || !Number.isFinite(to)) return { text: text ?? "", left: [] };
  const A = alt(from);
  const left: string[] = [];
  let out = text;

  // Each pass rewrites only the number and hands back every other character it matched, so
  // spacing, hyphens and the author's wording survive untouched.
  const passes: [RegExp, number][] = [
    // "a 15-year-old apprentice", "fifteen year old"
    [new RegExp(`\\b(${A})([-\\s])(year[-\\s]?old)\\b`, "gi"), 1],
    // "fifteen years old"
    [new RegExp(`\\b(${A})(\\s+years\\s+old)\\b`, "gi"), 1],
    // "age 15", "age: fifteen", "aged fifteen" — the shape the appearance schema asks for
    [new RegExp(`\\b(aged?)(\\s*:?\\s*)(${A})\\b${NOT_AN_AGE}`, "gi"), 3],
    // "a girl of fifteen" — the idiom, without catching "a party of fifteen"
    [new RegExp(`\\b((?:${KIN}|person|youth|woman|man)\\s+of\\s+)(${A})\\b${NOT_AN_AGE}`, "gi"), 2],
    // "she is fifteen", "I'm 15", "looks about fifteen", "barely fifteen".
    // PRESENT TENSE ONLY: `was`, `were` and `turned` are absent on purpose — those sentences are
    // history and stay true after the edit.
    [new RegExp(
      `(?<!\\bthere\\s)\\b(is|are|am|'s|\\u2019s|'m|\\u2019m|'re|\\u2019re|looks?|seems?|appears?|reads?\\s+as|` +
      `passes\\s+for|barely|only|just|about|around|roughly|nearly|almost|maybe|still)(\\s+)(${A})\\b${NOT_AN_AGE}`,
      "gi",
    ), 3],
  ];

  for (const [re, group] of passes) {
    out = out.replace(re, (...args) => {
      const m = args.slice(0, -2) as string[];
      const at = args[args.length - 2] as number;
      const whole = m[0];
      // somebody else's age, sitting in this character's prose
      const lead = out.slice(Math.max(0, at - 60), at + whole.indexOf(m[group]));
      if (OTHER_SUBJECT.some((re) => re.test(lead))) {
        left.push(snip(out, at, whole.length));
        return whole;
      }
      return m.slice(1).map((g, i) => (i + 1 === group ? restate(g, to) : g)).join("");
    });
  }

  // whatever still stands: history ("she left home at fifteen"), an odd construction, somebody
  // else's age. Reported, not touched. Measurements and counts are filtered out — "fifteen paces"
  // was never a claim about anybody's age.
  const bare = new RegExp(`\\b${A}\\b${NOT_AN_AGE}`, "gi");
  let hit: RegExpExecArray | null;
  while ((hit = bare.exec(out))) left.push(snip(out, hit.index, hit[0].length));
  return { text: out, left: [...new Set(left)] };
}

/** Does this line talk about the character at all? Their own bank may say "I"; everyone else's
 *  must name them, or the line is about somebody else who happens to be fifteen. */
function aboutSubject(text: string, names: string[], firstPerson: boolean): boolean {
  const t = text.toLowerCase();
  if (names.some((n) => n.length >= 3 && t.includes(n.toLowerCase()))) return true;
  return firstPerson && /\b(i|i'm|i’m|my|me|myself)\b/i.test(text);
}

/**
 * Restate a character's age everywhere the engine has written it down in prose.
 * Mutates `state`. Returns what changed and what a human should look at.
 */
export function reconcileAge(state: SaveState, charId: string, from: number, to: number): AgeReport {
  const rep: AgeReport = { from, to, fixes: [], left: [], prose_turns: 0 };
  const c = state.characters[charId];
  if (!c || from === to || !Number.isFinite(from) || !Number.isFinite(to)) return rep;

  const names = [c.name, ...(c.aliases ?? [])].filter((n) => typeof n === "string" && n.trim().length >= 3);
  const first = (c.name ?? "").trim().split(/\s+/)[0];
  if (first && first.length >= 3 && !names.includes(first)) names.push(first);

  const fix = (where: string, text: string, gated: boolean, firstPerson: boolean): string => {
    const t = String(text ?? "");
    if (!t.trim()) return t;
    if (gated && !aboutSubject(t, names, firstPerson)) return t;
    const { text: next, left } = restateAge(t, from, to);
    if (next !== t) rep.fixes.push({ where, before: t, after: next });
    for (const l of left) rep.left.push({ where, text: l });
    return next;
  };

  // ── 1. HER OWN CARD ─────────────────────────────────────────────────────────
  // The bedrock look is the loudest of these: it is printed to the narrator every single turn and
  // labelled "(constant)", so an apparent age written into it reads as more authoritative than the
  // number beside it.
  for (const k of ["appearance_facts", "appearance_now", "background", "life_history", "current_goal", "taste", "speech_pattern"] as const) {
    const v = (c as any)[k];
    if (typeof v === "string" && v) (c as any)[k] = fix(`${c.name} · ${k}`, v, false, false);
  }
  for (const k of ["core_traits", "values", "texture"] as const) {
    const arr = (c as any)[k];
    if (Array.isArray(arr)) (c as any)[k] = arr.map((x: unknown) => (typeof x === "string" ? fix(`${c.name} · ${k}`, x, false, false) : x));
  }
  if (c.voice) {
    // The voice card holds no lines any more, only descriptions of how somebody talks — but a
    // description can still carry a stale age ("the only woman of forty on the crew"), so the
    // string fields are walked too.
    for (const k of ["idiolect_shows", "diction"] as const) {
      const v = c.voice[k];
      if (typeof v === "string" && v) c.voice[k] = fix(`${c.name} · voice.${k}`, v, false, true);
    }
    for (const k of ["tics", "never_says"] as const) {
      const arr = c.voice[k];
      if (Array.isArray(arr)) c.voice[k] = arr.map((x) => (typeof x === "string" ? fix(`${c.name} · voice.${k}`, x, false, true) : x));
    }
  }

  // ── 2. WHAT EVERYONE KNOWS ──────────────────────────────────────────────────
  // Her own bank may hold it in the first person ("I'm fifteen"); everybody else's has to name her.
  for (const [holder, mem] of Object.entries(state.memory ?? {})) {
    if (!mem) continue;
    const who = state.characters[holder]?.name ?? holder;
    const self = holder === charId;
    const tag = self ? `${who} · memory (own)` : `${who} · memory`;
    if (Array.isArray(mem.core)) mem.core = mem.core.map((x) => (typeof x === "string" ? fix(`${tag}.core`, x, true, self) : x));
    for (const b of mem.beliefs ?? []) if (b && typeof b.content === "string") b.content = fix(`${tag}.belief`, b.content, true, self);
    for (const f of mem.facts ?? []) if (f && typeof f.content === "string") f.content = fix(`${tag}.fact`, f.content, true, self);
    for (const e of mem.episodic ?? []) if (e && typeof e.content === "string") e.content = fix(`${tag}.episodic`, e.content, true, self);
  }

  // ── 3. THE WORLD'S OWN SENTENCES ────────────────────────────────────────────
  const w = state.world;
  if (Array.isArray(w?.canon)) w.canon = w.canon.map((x) => (typeof x === "string" ? fix("canon", x, true, false) : x));
  for (const e of w?.edges ?? []) if (e && typeof e.notes === "string") e.notes = fix("relationship note", e.notes, true, false);
  for (const r of w?.rumors ?? []) {
    if (!r || r.dead || typeof r.content !== "string") continue;
    if (r.about_char && r.about_char !== charId) continue;
    r.content = fix("rumor", r.content, true, false);
  }
  for (const rec of state.records ?? []) if (rec && typeof rec.contents === "string") rec.contents = fix(`record · ${rec.title ?? rec.id}`, rec.contents, true, false);

  // ── 4. WHAT WAS ALREADY WRITTEN ─────────────────────────────────────────────
  // Counted, never edited. The played prose is the record of what happened; the fix for the cast
  // echoing it out of the recent-turns window is the age-authority line in the cast block.
  const bare = new RegExp(`\\b${alt(from)}\\b`, "i");
  for (const h of state.history ?? []) {
    const p = h?.narrator_prose ?? "";
    if (p && bare.test(p) && aboutSubject(p, names, false)) rep.prose_turns++;
  }

  rep.left = rep.left.slice(0, 12);
  return rep;
}

/** One line for the player, in the profile they just edited. */
/* ── THE OTHER WAY AN AGE GOES WRONG ─────────────────────────────────────────────
 *
 * Everything above reconciles a record the player EDITED. This catches the record that was never
 * coherent to begin with, which is a different failure and arrives from the forge rather than from
 * the profile panel.
 *
 * The Ashford save. Miranda, age 22, background:
 *
 *     "Miranda is a successful graphic designer who moved to Ashford a decade ago for art school
 *      and never left. She transitioned in her early twenties and has built a life she's proud of,
 *      brick by brick."
 *
 * A decade ago she was twelve. Her husband's background has them meeting six years ago at a party,
 * which puts her at sixteen and married not long after. None of that is what anyone meant, and
 * every one of those sentences is printed to the narrator every turn as her nature — while the
 * number 22 sits in a comma-separated card, being, as the header of this file says, the quieter of
 * the two instructions by a wide margin. The prose wins, so the cast plays a woman with a decade of
 * history who is twenty-two, and the seams show up as characters who do not quite add up.
 *
 * DELIBERATELY CONSERVATIVE, because this reports to a human rather than editing anything: it reads
 * only elapsed spans ("a decade ago", "for six years"), only in the character's own record, and it
 * stays quiet on any sentence that has already anchored itself to a younger age or to somebody
 * else's life — which is where almost every legitimate mention of a small number lives.
 */

/** Spans of elapsed time, as a biography writes them. */
const SPAN = /\b(?:(\d{1,2})|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(year|decade)s?\s+(?:ago|of|before|earlier)\b|\bfor\s+(?:(\d{1,2})|a|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+(year|decade)s?\b/gi;

/** …and the phrases that mean a sentence is already talking about childhood, or about somebody
 *  else. A background is full of both, and neither is an incoherent age. */
const NOT_THEIRS = /\b(?:as a (?:child|kid|girl|boy|baby)|growing up|childhood|when (?:he|she|they) was|when (?:he|she|they) were|at the age of|aged \d|born|mother|father|mom|dad|parents?|grandmother|grandfather|gran|nan|aunt|uncle|sister|brother|sibling|cousin|daughter|son|school days)\b/i;

/** Below this, a span describing an adult life has landed on somebody who was not one. */
const ADULT_FLOOR = 14;

const SPANWORD: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

export interface AgeClash {
  /** Which field it was written in. */
  where: string;
  /** The sentence, as written. */
  sentence: string;
  /** How old they would have been. Negative means the span is longer than their whole life. */
  at: number;
}

/**
 * Spans in a character's own record that their age cannot support.
 *
 * Returns an empty array for almost every character, which is the intent — a report a human reads
 * is only useful if it is usually silent.
 */
export function ageClashes(c: { age?: number; background?: unknown; life_history?: unknown }): AgeClash[] {
  const age = Number(c?.age);
  if (!Number.isFinite(age) || age <= 0 || age > 120) return [];
  const out: AgeClash[] = [];
  for (const where of ["background", "life_history"] as const) {
    const text = typeof (c as any)[where] === "string" ? String((c as any)[where]) : "";
    if (!text.trim()) continue;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (NOT_THEIRS.test(sentence)) continue;
      SPAN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SPAN.exec(sentence))) {
        const digits = m[1] ?? m[3];
        const unitRaw = (m[2] ?? m[4] ?? "year").toLowerCase();
        const word = m[0].trim().split(/\s+/)[0].toLowerCase();
        const n = digits ? Number(digits) : (SPANWORD[word] ?? 0);
        if (!n) continue;
        const years = unitRaw.startsWith("decade") ? n * 10 : n;
        const at = age - years;
        if (at < ADULT_FLOOR) out.push({ where, sentence: sentence.trim().slice(0, 200), at });
      }
    }
  }
  return out;
}

/** The clashes as one line for the player, or "" when the record hangs together. */
export function summarizeAgeClashes(clashes: AgeClash[], name: string, age: number): string {
  if (!clashes.length) return "";
  const worst = clashes.slice(0, 2).map((c) =>
    c.at < 0
      ? `"${c.sentence}" covers more years than ${name} has been alive`
      : `"${c.sentence}" puts ${name} at ${c.at} when it happened`);
  return `${name}'s age (${age}) and their written history disagree: ${worst.join("; ")}. `
    + `The prose is what the narrator reads every turn, so it is the half that will be played — `
    + `set the age to match the history, or rewrite the history to match the age.`;
}

export function summarizeAgeReport(rep: AgeReport, name: string): string {
  if (rep.from === rep.to) return "";
  const bits: string[] = [];
  if (rep.fixes.length) {
    bits.push(`${name} is now ${rep.to}: restated ${rep.fixes.length} stale mention${rep.fixes.length === 1 ? "" : "s"} of ${rep.from} (${[...new Set(rep.fixes.map((f) => f.where))].slice(0, 4).join(", ")}).`);
  } else {
    bits.push(`${name} is now ${rep.to}.`);
  }
  if (rep.left.length) bits.push(`${rep.left.length} mention${rep.left.length === 1 ? "" : "s"} of ${rep.from} left alone — they read as history or as somebody else's age: "${rep.left[0].text}"${rep.left.length > 1 ? " …" : ""}`);
  if (rep.prose_turns) bits.push(`${rep.prose_turns} already-played turn${rep.prose_turns === 1 ? "" : "s"} still say ${rep.from}; the record is not rewritten, and the cast is told the profile outranks it.`);
  return bits.join(" ");
}
