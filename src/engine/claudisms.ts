/**
 * THE CLAUDISM — a line that was composed instead of said.
 *
 * The player's whole report, verbatim: "I hate. Hate. The way the ai makes people talk. I don't
 * understand what person talks like this. What person?! Just Claude."
 *
 * They are right, and the tell is that they wrote their own complaint IN the register to make the
 * point — "That's pretty much the whole ask" — because the save they had just sent contains, in a
 * turn with six spoken lines in it:
 *
 *     "Friday. That's the whole ask."
 *     "Forty-two sixty-eight. Not my month."
 *     "Read it. Mark it up. Tell me where the bride's mother spelled her own daughter's middle
 *      name wrong…"
 *     "So can you look at it tonight, or — ?"
 *
 * WHAT THIS IS NOT, AND WHY NOTHING CAUGHT IT.
 *
 *   · IT IS NOT A MAXIM. maxims.ts catches a line that makes a claim about the world in general —
 *     "Everything has a price." Run over these four, it returns nothing, correctly: "Friday. That's
 *     the whole ask" asserts nothing about anything. There is no wisdom in it. It is a scheduling
 *     request. The defect is entirely in its SHAPE.
 *   · IT IS NOT INTERIORITY. reviser.ts holds this engine's tic corpus — eighty-odd families mined
 *     out of real saves — and every one of them is about narration claiming access to a head. None
 *     of it applies to a woman asking her neighbour to proofread a wedding programme.
 *   · AND THE REVISER COULD NOT HAVE TOUCHED IT ANYWAY. `DIALOGUE_MARK` (reviser.ts:172) passes over
 *     any sentence carrying a quotation mark, deliberately and correctly — the deterministic guard
 *     once excised a fragment from inside a spoken line and left a bare quotation mark with an
 *     attribution for a line that was not there. So the engine's entire repair apparatus points at
 *     narration, and the complaint is entirely about speech. That is the gap. This module is it.
 *
 * WHAT A CLAUDISM ACTUALLY IS. Every family below is one behaviour: THE LINE KNOWS IT IS A LINE.
 * It has been given a shape a person would have had to plan — a summing-up tag on the speaker's own
 * sentence, a parallel series, a repetition with an increment, a verbless fragment held back for
 * the end. Nobody talks like this because nobody knows how their own sentence is going to finish
 * until it finishes. Real speech runs on, doubles back, says the boring part out loud, and stops
 * without landing. A Claudism is a line edited by somebody who could see the whole of it at once,
 * which no speaker can.
 *
 * MINED, NOT GUESSED. The player named a site cataloguing these; it is unreachable from here, so
 * the corpus was built the way reviser.ts's was — out of their own data. 3,208 quoted lines across
 * thirteen saves, 947 of them distinct. Each family below carries its measured rate and at least one
 * line the engine really wrote. Nothing here is a family that sounded plausible; a rule fitted to
 * how a thing MIGHT be phrased is the mistake pressure.ts's power-tier regex already made once.
 *
 * PRECISION OVER RECALL, LOUDLY. maxims.ts states the reason and it applies with more force here:
 * a false positive puts a real line of dialogue in front of the narrator labelled as a fault, and
 * teaches it to avoid something that was fine. The families that survived are the ones that hit
 * eight lines out of nine hundred and forty-seven and were the tic all eight times. Three candidate
 * families were measured and DROPPED for failing that bar, and they are recorded at the bottom of
 * this file, because a rejected detector is evidence too.
 *
 * DETECT ON OUTPUT, CORRECT ON THE NEXT TURN. The standing idiom — echo.ts, maxims.ts, anatomy.ts,
 * kinship.ts, threshold.ts — and here it is not a preference but the only option: a prohibition
 * carrying a quoted example is an example the model has been handed (tests/prompt-echo.ts), and
 * these are so short and so memorable that pasting them into the prefix would be teaching them.
 */
import type { SaveState } from "./types";
import { spokenLines } from "./speech";

/** The unit a shape is tested against: one sentence of one spoken line. */
function sentences(line: string): string[] {
  return line.split(/(?<=[.!?…])[\s—–]+/).map((s) => s.trim()).filter(Boolean);
}

/** Words, apostrophes kept, punctuation dropped. */
function words(s: string): string[] {
  return s.replace(/[^\w'’\s-]/g, " ").split(/\s+/).filter(Boolean);
}

/** A finite verb, roughly. Used only to tell a fragment from a sentence, so it is allowed to be
 *  generous: the cost of calling a fragment a sentence is one missed tic, and the cost of the
 *  reverse is scolding somebody for a line that had a verb in it.
 *
 *  IT MUST NOT COUNT A PLURAL NOUN. An earlier version ended `\\w+(?:ed|ing|s)`, and the trailing `s`
 *  made "Lemons." a sentence — which is to say it made the corpus's clearest fragment coda,
 *  "Sunday chicken. Lemons.", invisible. Plural nouns are the commonest word in a verbless scrap;
 *  the participle endings are not. */
const FINITE = new RegExp(
  "\\b(?:is|are|was|were|am|be|been|do|does|did|have|has|had|can|could|will|would|shall|should|may" +
  "|might|must|ai\\s?n['’]?t|don['’]?t|doesn['’]?t|didn['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t|can['’]?t|won['’]?t)\\b" +
  "|['’](?:s|re|m|ll|ve|d)\\b" +
  "|\\b\\w+(?:ed|ing)\\b",
  "i",
);

/** Consecutive-sentence openers that mean the speaker is building a figure rather than talking.
 *  A PRONOUN SUBJECT REPEATED IS NOT ON THIS LIST, and that exclusion is most of the precision:
 *  "You okay? You sound like shit." and "They liked the program. They just want the numbers
 *  tighter." are two people talking, and an anaphora rule that fired on a repeated `I` or `They`
 *  flagged 45 lines in the corpus of which roughly half were ordinary speech. Restricted to
 *  negators and demonstratives it flags eleven, and eleven out of eleven are the tic. */
const FIGURE_OPENER = /^(?:not|no|never|nothing|nobody|none|that['’]s|this is|it['’]s|every|all|maybe|just)$/i;

/** Fixed idioms that open on a negator and are simply how people speak. Without these the negation
 *  series rule eats "Not that I'm complaining", which is a hedge, not a parallel construction. */
const NEGATOR_IDIOM = /^not\s+(?:that|even|really|exactly|quite|yet|anymore|any\s?more|now|here|to\s+worry)\b/i;

export interface ClaudismHit {
  /** The offending unit, quoted back to the narrator exactly as it was written. */
  line: string;
  /** Which family caught it — used to pick the right correction, and logged for the player. */
  shape: string;
}

type Shape = { name: string; find: (line: string, ss: string[], cast: Set<string>) => string | null };

/**
 * The families. Each `find` returns the exact span to quote back, or null.
 *
 * Quoting the SPAN rather than the whole line matters for the same reason reviser.ts hands the model
 * a phrase instead of a sentence: "this construction" is a correction, "this line of dialogue is
 * bad, try again" is a rejection, and a rejection is what produces the next turn's blander line.
 */
const SHAPES: Shape[] = [
  // ── 1. THE SUMMING-UP TAG ─────────────────────────────────────────────── 10 / 947 measured ──
  // "Friday. That's the whole ask."  ·  "That's the whole thing. That's the two hours."
  // "That's the question you should've opened with."  ·  "That's what I want."
  // The speaker stops and tells you what their own sentence was FOR. It is the single loudest one
  // in the corpus and it is the one the player quoted back at me, which is how I know it is the
  // one that reads as machine from the outside. A person who has just asked for something does not
  // then classify the asking.
  {
    name: "summing up their own sentence",
    find: (line) => {
      const m = line.match(
        /\b(?:that['’]s|this is)\s+(?:pretty much\s+)?(?:the\s+)?(?:whole\s+|entire\s+|only\s+)?(?:ask|point|thing|deal|it|all|story|job|offer|trade|question|answer|price|difference|arrangement)\b[^.!?]{0,20}[.!?]?/i,
      ) ?? line.match(/\b(?:that['’]s|this is)\s+(?:what|why|all)\s+I(?:['’]m)?\s+(?:want|wanted|need|needed|mean|meant|asking|saying|after)\b[^.!?]{0,16}/i);
      return m ? m[0].trim() : null;
    },
  },

  // ── 2. THE SERIES OF NOTS ─────────────────────────────────────────────── 8 / 947 measured ──
  // "I didn't send anyone. Not Mara. Not Drea."  ·  "I haven't laughed. Not once. Not at any of it."
  // "That's what I want. Not the toast. Not the eggs on the plate."
  // Two or more verbless negations in parallel, appended to a finished sentence. This is a rhetorical
  // figure — anaphora — and it requires knowing both items before you begin the first. Somebody
  // denying something in a kitchen produces one negation and then either repeats it or goes quiet.
  {
    name: "a series of parallel negations",
    find: (_line, ss) => {
      for (let i = 0; i + 1 < ss.length; i++) {
        const a = ss[i], b = ss[i + 1];
        if (!/^not\b/i.test(a) || !/^not\b/i.test(b)) continue;
        if (NEGATOR_IDIOM.test(a) || NEGATOR_IDIOM.test(b)) continue;
        if (words(a).length > 7 || words(b).length > 7) continue;
        return `${a} ${b}`;
      }
      return null;
    },
  },

  // ── 3. THE SAME OPENING, SAID TWICE ───────────────────────────────────── 11 / 947 measured ──
  // "You're fine. You're fine with it. All of it."  ·  "So no. Not weird. Not about that, anyway."
  // The line restates its own opening and adds to it. It reads as a person finding the words, and
  // it is the opposite: finding the words is messy and this is a clean increment, the second half
  // built on the first because both were available at once.
  {
    name: "the same opening said twice",
    find: (_line, ss) => {
      for (let i = 0; i + 1 < ss.length; i++) {
        const A = words(ss[i]), B = words(ss[i + 1]);
        if (!A.length || !B.length) continue;
        if (A.length > 8 || B.length > 8) continue;
        // Two ways in, and the second is the one that carries the precision.
        //
        // A REPEATED FIGURE OPENER — "Maybe Anya. Maybe not." — where the repeated word is a negator
        // or a demonstrative rather than a subject.
        const figure = A[0].toLowerCase() === B[0].toLowerCase() && FIGURE_OPENER.test(A[0]);
        // OR THE SECOND SENTENCE CONTAINS THE WHOLE FIRST ONE AND ADDS TO IT — "You're fine. You're
        // fine with it." That containment is the actual tic, and it is what separates it from the
        // way an upset person really repeats themselves. "I don't know how she got here. I don't
        // know how Mara got here." shares four opening words and is somebody at the end of their
        // rope; neither sentence contains the other, they differ in the middle. A rule keyed to a
        // shared two-word opening flagged that line, which is exactly the false positive this file
        // exists to avoid.
        const a = A.map((w) => w.toLowerCase()).join(" "), b = B.map((w) => w.toLowerCase()).join(" ");
        const extended = b.length > a.length && b.startsWith(a + " ");
        if (figure || extended) return `${ss[i]} ${ss[i + 1]}`;
      }
      return null;
    },
  },

  // ── 4. THREE IN A ROW ─────────────────────────────────────────────────── 1 / 947 measured ──
  // "Read it. Mark it up. Tell me where the bride's mother spelled her own daughter's middle name
  //  wrong, which she did, because I already spotted it…"
  // Rare and kept anyway, because it is one of the four lines the player put in front of me and
  // because a tricolon is the most planned thing a sentence can be. Three imperatives in series is
  // a speech; two is somebody telling you what to do.
  {
    name: "three commands in a row",
    find: (_line, ss) => {
      const IMP = /^(?:go|get|come|take|put|tell|give|look|listen|stop|wait|sit|stand|read|mark|eat|drink|open|close|call|write|hold|leave|move|turn|watch|show|find|bring|keep|say|do|don['’]t|make|pick|drop|start|finish|check|ask|try|let|pull|push|hand|pass|send|sign|count|breathe)\b/i;
      for (let i = 0; i + 2 < ss.length; i++) {
        // The first two beats are short; the THIRD is where the elaboration goes, and bounding it
        // hid the corpus's only real tricolon behind its own subordinate clause.
        if (![0, 1, 2].every((k) => IMP.test(ss[i + k]))) continue;
        if (words(ss[i]).length > 9 || words(ss[i + 1]).length > 9) continue;
        return `${ss[i]} ${ss[i + 1]} ${ss[i + 2]}`;
      }
      return null;
    },
  },

  // ── 5. THE FRAGMENT HELD BACK FOR THE END ─────────────────────────────── 9 / 947 measured ──
  // "Forty-two sixty-eight. Not my month."  ·  "Sunday chicken. Lemons."
  // A finished sentence, then a verbless scrap with nothing after it. The scrap is doing the work
  // of a closing beat, which means somebody decided where the line would end before writing it.
  // Bounded hard: it must FOLLOW something (a line that is only a fragment is somebody being
  // interrupted, which is fine and common), it must not be a name, an interjection, or a yes/no,
  // and it must not trail off — "I just—" is a person losing the thread and is left alone.
  // The run-up is deliberately NOT required to be a full sentence: "Forty-two sixty-eight. Not my
  // month." is two fragments, and two fragments in a row with the second one landing is the purest
  // form of the shape, not an exception to it.
  {
    name: "a fragment kept back for the last word",
    find: (line, ss, cast) => {
      if (ss.length < 2) return null;
      if (/[—–,;:]\s*$/.test(line.trim())) return null;      // trailing off, not landing
      const last = ss[ss.length - 1].replace(/[.!?…]+$/, "").trim();
      const prev = ss[ss.length - 2];
      const w = words(last);
      if (w.length < 1 || w.length > 4) return null;
      if (FINITE.test(last)) return null;                     // it has a verb; it is a sentence
      if (/^(?:yes|no|yeah|nope|okay|ok|right|sure|please|thanks|sorry|god|jesus|christ|fuck|shit|hey|oh|ah|hm+|mm+|well|alright)\b/i.test(last)) return null;
      // A FRAGMENT HAS NO SUBJECT. FINITE is a word list and a word list has holes — it does not
      // contain "sound", so "You okay? You sound like shit." read as a four-word verbless coda and
      // was flagged, which is two people talking. Anything opening on a personal pronoun is a clause
      // whose verb the list simply missed, and none of the real codas has a subject at all.
      if (/^(?:I|you|he|she|it|we|they|there|that|this)\b/i.test(last)) return null;
      // A NAME SAID ON ITS OWN is somebody being addressed — "You have to eat something. Rabi." —
      // and checking capitalisation alone is not enough, because "Lemons." is capitalised too and
      // is the corpus's clearest coda. So the exclusion is keyed to the actual cast, the way every
      // other record-reading guard in this engine works: a known name is a vocative, and anything
      // else that happens to start a sentence is just a word.
      if (cast.has(last.toLowerCase().replace(/[^\w'’-]/g, ""))) return null;
      return `${prev} ${ss[ss.length - 1]}`;
    },
  },

  // ── 6. THE ANTITHESIS ─────────────────────────────────────────────────── 3 / 947 measured ──
  // "That's not a job, that's a tide."
  // The balanced correction: reject the listener's noun, supply the better one, in one breath, with
  // the halves the same length. maxims.ts has a version of this scoped to pronouncements about the
  // world; this is the version aimed at the person in the room, which walked straight past it.
  {
    name: "not that, but this",
    find: (line) => {
      const m = line.match(/\b(?:it['’]s|that['’]s|this is|you['’]re)\s+not\s+(?:a|an|the)?\s?[\w'’ -]{2,26}[,;]\s*(?:it['’]s|that['’]s|this is|you['’]re)\s+(?:a|an|the)?\s?[\w'’ -]{2,26}/i);
      return m ? m[0].trim() : null;
    },
  },

  // ── 7. ANNOUNCING THE SENTENCE BEFORE SAYING IT ───────────────────────── 4 / 947 measured ──
  // "Here's what we're going to do,"  ·  "Here's what I actually want,"  ·  "So I need you to decide."
  // A preamble that contains no information and exists to frame what follows. It is the register of
  // somebody chairing a meeting, and it turns up in this engine in a kitchen at eight in the morning.
  {
    name: "announcing the sentence before saying it",
    find: (line) => {
      const m = line.match(/\b(?:here['’]s\s+(?:the\s+thing|what|why|how)|let me be clear|to be clear|I need you to (?:understand|know|hear me)|I'?m going to say (?:something|this)|the thing is)\b[^.!?,]{0,24}/i);
      return m ? m[0].trim() : null;
    },
  },

  // ── 8. THE APPROVED CONCESSION ────────────────────────────────────────── 1 / 947 measured ──
  // "Okay. That's fair."
  // Rare in this corpus and included on the player's evidence rather than mine: it is the phrase
  // set of somebody managing a conversation rather than being in one, and it is the most recognisable
  // thing on any list of these. Held to the exact phrases, which is why it can afford to be here.
  {
    name: "conceding in the approved phrasing",
    find: (line) => {
      const m = line.match(/\b(?:that['’]s fair(?: enough)?|fair enough|you['’]re not wrong|I['’]ll give you that|I hear you|noted)\b/i);
      return m ? m[0].trim() : null;
    },
  },
];

/**
 * Every Claudism in this turn's dialogue, worst first.
 *
 * `action` is the player's own text and is excluded: the narrator sometimes carries a line of it
 * into the prose, and scolding the model for the player's phrasing is both wrong and unfixable.
 */
export function findClaudisms(prose: string, action = "", names: string[] = []): ClaudismHit[] {
  const hits: ClaudismHit[] = [];
  const mine = String(action ?? "").toLowerCase();
  const cast = new Set(names.map((n) => String(n ?? "").trim().split(/\s+/)[0].toLowerCase()).filter(Boolean));
  for (const said of spokenLines(prose)) {
    if (said.length < 12) continue;                         // nothing this short is composed
    if (mine && mine.includes(said.toLowerCase().slice(0, 40))) continue;
    const ss = sentences(said);
    for (const sh of SHAPES) {
      const span = sh.find(said, ss, cast);
      if (!span) continue;
      if (hits.some((h) => h.line === span)) break;
      hits.push({ line: span.slice(0, 180), shape: sh.name });
      break;                                                // one fault per line; the worst is enough
    }
  }
  // Shortest first: the most portable one is the most quotable, and the most quotable one is the
  // one worth showing back. Same ordering rule, same reason, as maxims.ts.
  return hits.sort((a, b) => a.line.length - b.line.length);
}

/** How much of this turn's dialogue was composed rather than spoken — for the shift toast, so the
 *  player can see it was caught rather than wondering whether anybody noticed. */
export function claudismRate(prose: string, action = "", names: string[] = []): number {
  const lines = spokenLines(prose);
  if (!lines.length) return 0;
  return findClaudisms(prose, action, names).length / lines.length;
}

/** What is wrong with each family, in one clause, in the second person. Kept per-shape because the
 *  general note ("that sounded written") is exactly the correction that produces a flatter line
 *  next turn instead of a truer one. */
const FAULT: Record<string, string> = {
  "summing up their own sentence":
    "they stopped and told the listener what their own sentence had been for. Nobody classifies their own request while making it — they ask, and then they wait, or they ask again worse",
  "a series of parallel negations":
    "two denials in matching shape, one after the other. A figure like that needs both halves in mind before the first is spoken; a person denying something gets one out and then repeats it or goes quiet",
  "the same opening said twice":
    "the line restated its own opening and added to it — a clean increment, built because the whole of it was available at once. Somebody genuinely finding the words does not find them in ascending order",
  "three commands in a row":
    "three instructions in series, evenly weighted. That is a speech. Somebody telling another person what to do says the first thing, and the next only if the first did not take",
  "a fragment kept back for the last word":
    "the line ended on a verbless scrap held back as a closing beat, which means where it would end was decided before it was written. Real speech stops when the speaker runs out, not when the line is complete",
  "not that, but this":
    "the listener's word rejected and a better one supplied, in one balanced breath. That is an edit, performed out loud",
  "announcing the sentence before saying it":
    "a preamble carrying no information, framing what was coming. That is somebody chairing a meeting",
  "conceding in the approved phrasing":
    "a stock concession. It is the sound of a conversation being managed rather than had",
};

/**
 * THE CORRECTION, at the end of the directive where instructions live.
 *
 * Three properties, the ones that make `last_leak` and `maximFix` work where a style rule in the
 * cached prefix does not: it quotes the actual span, it says what is structurally wrong with it,
 * and it says what to do instead.
 *
 * AND THE POSITIVE HALF IS THE OPPOSITE OF WHAT A MODEL DOES WHEN SCOLDED. Told a line sounded
 * artificial, a model writes a SHORTER, plainer, more clipped one — and every family above is
 * already short, clipped and plain. Terseness is the disease. So the instruction has to say the
 * unintuitive thing outright: make the line longer, messier, and worse-organised than you want to.
 * That is also what this engine's own measurements say real dialogue is missing — speech.ts found
 * half of all spoken lines at six words or fewer, and named the fragment as the defect.
 */
export function claudismFix(last: { line: string; shape: string } | null | undefined): string {
  if (!last?.line) return "";
  const fault = FAULT[last.shape] ?? "it was shaped like a written line rather than a spoken one";
  return `\nA LINE YOU WROTE LAST TURN WAS COMPOSED, NOT SPOKEN: "${last.line}" — ${fault}.
This is the failure the player has named more than any other: everyone in this story talks like the same careful writer. The mark of it is always the same — THE LINE KNOWS IT IS A LINE. It has a shape somebody would have had to plan: a tag summing up what they just said, two clauses in matching form, a phrase repeated with something added, a verbless fragment saved for the end. Nobody can do that out loud, because nobody knows how their own sentence finishes until it finishes.
THIS TURN, DO THE OPPOSITE OF WHAT THAT INSTRUCTION USUALLY MAKES YOU DO. Do not write shorter, flatter, more clipped lines — short and clipped is what the failure already looks like. Write LONGER and WORSE ORGANISED. A person says the boring part out loud, puts the important thing in the middle of the sentence where it gets lost, repeats a word they already used because they have not thought of another one, gives the unnecessary detail, and stops without landing anywhere. Nobody sums up. Nobody balances a clause against another clause. Nobody saves the good bit for last.
Concretely, for every line anybody speaks this turn: no sentence in it explains what the speaker is doing by saying it; no two consecutive sentences begin the same way; nothing arrives in a series of three; and the line does not end on a fragment. If a line would be improved by cutting it, leave it uncut — the version with the extra clause in it is the one a person said.`;
}

/**
 * THE STANDING RULE, on every turn, whether or not anything fired.
 *
 * `claudismFix` only bites AFTER a line has been printed and read, and this failure is not
 * occasional — the player's report is that it is how everybody in the story talks, all the time.
 * A detector that corrects one line a turn cannot outrun a register.
 *
 * WHY IT IS NOT IN THE CACHED PREFIX, where it would be free. Because maxims.ts already ran that
 * experiment and wrote down the result: every rule that would have stopped the maxim was ALREADY in
 * the prefix — "no slogans or aphorisms" in the style block, "if what you are about to write for
 * them is smoother, wiser, or more quotable than these, it is wrong" on the card — and both sat
 * tens of thousands of characters back, where a rule is reference rather than instruction. This
 * costs about seventy tokens a turn at the end of the directive, which is the only place in this
 * request anything has ever been obeyed.
 *
 * AND IT QUOTES NOTHING. Every family in this file is short, closed and memorable, which is exactly
 * what makes a banned example dangerous: a phrase attached to a prohibition is still a phrase the
 * model has been handed (echo.ts, tests/prompt-echo.ts). So the rule is stated structurally — what
 * a spoken line may not be SHAPED like — and the concrete evidence only ever arrives after the fact,
 * in the narrator's own words, via `claudismFix`.
 */
export function spokenShape(): string {
  return `\n[CHECK THE SHAPE OF EVERY SPOKEN LINE, SEPARATELY FROM WHAT IT SAYS.
Nobody knows how their own sentence is going to end until it ends. So no line anybody speaks this turn may be built the way a written line is built: nobody sums up what they have just said or explains what they meant by saying it; nobody puts two clauses in matching form; nobody repeats their own opening and adds to it; nothing arrives in a series of three; and no line ends on a fragment held back to land on.
IF A LINE FEELS TIGHT, IT IS WRONG. Speech is longer than it needs to be and badly organised: the important thing turns up in the middle where it gets lost, the boring part is said out loud, a word already used gets used again because nothing better came, and the sentence stops because the speaker ran out rather than because it was finished. Where you would cut a clause to sharpen a line, leave the clause in — the untidy version is the one somebody said.]`;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * MEASURED AND DROPPED — kept because a rejected detector is evidence about the corpus.
 *
 *  · THE TRAILING EM-DASH ("So can you look at it tonight, or — ?", "I just—"). 30 hits, the
 *    third-largest family, and the player quoted one of them. Dropped anyway: reading them all,
 *    they are somebody being interrupted or losing the thread, and they cluster in the corpus's
 *    most agitated turns. Flagging them would teach the narrator to write more composed dialogue,
 *    which is this entire file's disease. The one the player quoted is bad for a different reason
 *    — it is deferential filler — and that is a want-and-register problem, not a shape.
 *  · THE STACCATO LINE (three or more sentences, half of them five words or fewer). 123 hits,
 *    which is 29% of every multi-sentence line in the corpus. At that rate it is not detecting a
 *    tic, it is detecting dialogue. Most of the hits are people talking.
 *  · REPETITION ANYWHERE IN THE LINE (a two-word phrase reused in the next sentence). 69 hits,
 *    matching on "in the", "she was", "mad at". Repetition at the SENTENCE OPENING is the actual
 *    figure and survives above as family 3; repetition in the middle is how English works.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Cleared once shown, same as every other one-shot correction in this engine. */
export function clearClaudism(state: SaveState): void {
  state.last_claudism = null;
}
