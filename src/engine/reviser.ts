/**
 * THE REVISER — the second pass that repairs a tic instead of deleting it.
 *
 * The engine has detected these constructions for a long time (MOTIVE_LEAK below, mined family by
 * family out of real saves). What it did with the detection was asymmetric, and the asymmetry was
 * the bug: `scrubForReplay` DELETES the offending sentence, and only from the copy replayed back
 * into the model's own context. That is input hygiene — the narrator never reads its worst
 * sentence, so it cannot imitate it — and it was the right fix for drift. It was never a fix for
 * the player, who still read every one of them.
 *
 * So the detector had two possible consumers and only ever had one. This module is the other:
 * hand the flagged sentence to a small model with the matched phrase quoted, and get back the same
 * sentence with that phrase gone. Not a summary, not a simplification, not a plain-language
 * rewrite — a repair.
 *
 * WHY IT IS NOT A "WRITE THIS PLAINER" PASS. The obvious way to build this is to hand the whole
 * turn to a model and ask for plainer prose, and it is the wrong way twice over. It flattens the
 * narration's voice, which is a thing the player chose and the standing direction governs; and it
 * flattens the world's vocabulary, which the narrator contract restricts to things this setting
 * actually contains. A model asked to write plainly will reach for the plainest word it knows,
 * which is the word from OUR world. Sanding the prose into uniform grey is the same failure as the
 * tics, arrived at from the other side. The unit of work here is one flagged sentence and one
 * quoted phrase, and everything else on the page is untouchable.
 *
 * WHAT IT COSTS. Nothing on a clean turn: the detector runs first, locally, and a turn with no
 * flagged narration never opens a socket. When it does fire it is a few hundred tokens of prompt —
 * no digest, no cast, no contract — which makes it exactly the job a small local model does well,
 * and `local/…` routing already works per slot. In the turn loop it is started alongside the
 * bookkeeper and awaited before the commit, so on a normal turn it hides entirely inside a call
 * that was going to happen anyway.
 *
 * FAIL-OPEN, ABSOLUTELY. Every failure path returns the prose exactly as the narrator wrote it:
 * provider down, timeout, unparseable JSON, a replacement that lost a name, a replacement that
 * still trips the detector, a replacement that came back three times the length. A reviser that
 * can eat a sentence of somebody's story is worse than every tic it was built to remove.
 */
import { complete } from "../llm";
import { isCancel } from "../llm";

/** CHATLOG PROSE SCRUB — the loop that made the POV rule unenforceable.
 *
 *  In chatlog mode the narrator's own prior prose is replayed as ASSISTANT messages. That is
 *  the strongest style signal in the whole request: it is not a rule about how to write, it is
 *  an example of how this narrator already writes, authored by the role the model is playing.
 *  So a single escape on turn 1 ("the polite mask still in place, his eyes calculating") becomes
 *  the house style by turn 4 — the violation rate RISES with turn count, which is the tell.
 *  The same failure the fresh-reader voice pass exists to break: the narrator imitates its own
 *  last paragraph. Voice got a fix; prose never did.
 *
 *  This scrubs the REPLAY COPY only — state.history keeps every word, the Chronicle is untouched,
 *  nothing is rewritten after the fact. It is input hygiene, not post-hoc correction: the model
 *  never sees the bad sentence, so it has nothing to copy.
 *
 *  Sentences are the unit deliberately. Excising a clause leaves mangled grammar in context,
 *  which is its own kind of style signal; dropping a whole sentence costs a little continuity
 *  and can't corrupt anything. If a paragraph would lose most of itself the scrub backs off —
 *  a pattern that greedy is misfiring, and a thin replay is worse than a flawed one. */
/** The tic corpus itself, kept as its own list so a flagged sentence can be traced back to the
 *  exact construction that flagged it. The reviser hands that matched substring to the model —
 *  "this phrase, not this sentence" is the whole difference between a repair and a rewrite. */
export const LEAK_PATTERNS: string[] = [
  "\\bas (?:if|though) (?:he|she|they|it|xe|ze|the \\w+) (?:were|was|had|hadn|wanted|meant|knew|expected|did|didn|might|could)\\b",
  "\\bas if to \\b", "\\bwith the air of\\b",
  // DELIVERY SIMILE: "she said it like an accusation and a question folded together" — the narrator
  // decoding a tone and telling you what it meant. And the INTENT GAP: "the word came out smaller
  // than she'd meant it to" states what she intended, which is the interior in one clause.
  "\\bsaid it (?:like|as though|as if)\\b", "\\bcame out \\w+er than\\b",
  "\\bthan (?:he|she|they|xe)'?d? (?:meant|intended|wanted|planned)\\b",
  // ── families found in a 58-turn save, all of which walked through the first pass ──
  // ROLE COMPARISON via a person-noun: "the stillness of a man who has just heard...",
  // "the way a man watches a cliff edge". The earlier rule only caught "the way SHE watched";
  // swapping the pronoun for an indefinite person was enough to slip it, and it is the same move.
  "\\bthe (?:way|look|stillness|silence|patience|calm|care|expression|voice|smile) of (?:a|an|someone|somebody)\\b",
  "\\bthe way (?:a|an) (?:man|woman|boy|girl|person|child|someone)\\b",
  "\\blike (?:a|an) (?:man|woman|boy|girl|person|someone) who\\b",
  // THE UNIVERSALIZING SENTENCE: "men who have watched the impossible learn quickly that...".
  // A claim true of everyone everywhere, in the eternal present, dropped into a scene. It is the
  // single loudest marker of the narrator adjudicating, and it generalizes past the moment, which
  // narration is never allowed to do.
  "\\b(?:men|women|people|those|anyone|everyone|no ?one|a man|a woman) who \\w+(?:\\s+\\w+){0,4}\\s+(?:learn|learns|know|knows|understand|understands|never|always|tend|tends)\\b",
  // NEGATIVE DEFINITION: "not the stillness of X, but the stillness of Y" — the narrator ruling out
  // one interior reading in order to install another.
  "\\bnot the \\w+ of (?:a|an|someone)\\b", "\\bnot because (?:he|she|they|it) \\w+, but\\b",
  // UNSPOKEN SPEECH: "He did not say we didn't know you'd be here." Reporting the sentence someone
  // withheld is interior access with a negation in front of it.
  "\\b(?:he|she|they|xe) did not say\\b", "\\bwhatever (?:he|she|they) had been about to say\\b",
  // A CONTRACTION WAS ENOUGH TO SLIP IT. This required a bare pronoun followed by a word, so
  // "the way SHE watched" was caught and "the way she'D LOOKED at him when they were younger" —
  // the same move, reaching further, into a shared past and a feeling — sailed through. Allow the
  // contraction and the auxiliary.
  "\\bthe way (?:he|she|they|xe|ze|it)(?:'d|'s|'ll|'ve| had| has| would| always)?\\s+(?:\\w+ )?(?:watch|watche|read|handle|look|touch|move|speak|spoke|said|smile|hold|held)",
  // THE RELATIONSHIP AS A STANDING FACT: "the way it always was with him", "the way she always
  // did with him". A claim about how these two always are, asserted by the camera, in a scene.
  "\\bthe way it (?:always |usually )?(?:was|is|had been) with (?:him|her|them)\\b",
  // NEGATIVE DEFINITION, SECOND FORM. The list already catches "not the stillness of a man…";
  // this is the same construction with the ruling-out done first and the verdict landed last:
  // "not frightened, not grateful, just a woman doing arithmetic on a sum she hadn't expected".
  "\\bnot \\w+, (?:not \\w+, )?just (?:a|an|the) (?:man|woman|boy|girl|person|someone)\\b",
  "\\bjust (?:a|an) (?:man|woman|boy|girl|person|someone) (?:doing|working|reading|deciding|weighing|counting|thinking)\\b",
  // THE ACCOUNTING METAPHOR. Reported by a player as the one that gets used constantly, and it is
  // interior access wearing a bookkeeping costume: a sum, a ledger, arithmetic, numbers that do or
  // do not add up, all standing in for what somebody is privately concluding. This world contains
  // real ledgers and real tallies, so only the FIGURATIVE frames are listed.
  "\\b(?:doing|did|finished|running) (?:the )?arithmetic\\b", "\\ba sum (?:he|she|they|xe)\\b",
  "\\bthe (?:ledger|arithmetic|calculus|accounting|mathematics) of\\b",
  "\\bnumbers (?:that )?(?:did ?n[o']t|don'?t|would ?n[o']t) add up\\b", "\\badding (?:it|them|her|him) up\\b",
    "\\bthe way (?:he|she|they|xe|ze|it) (?:\\w+ )?(?:watch|watche|read|handle|look|touch|move|speak|spoke|said)",
  "\\bpretend(?:s|ing|ed)?\\b", "\\bto (?:hide|conceal|mask|cover)\\b", "\\bmask(?:ing)? (?:still |firmly )?in place\\b",
  "\\b(?:polite|careful|practised|practiced) mask\\b", "\\bcarefully (?:blank|neutral|still|empty)\\b",
  "\\bwhich meant\\b", "\\bwhat (?:he|she|they|xe) really\\b", "\\bdoes ?n[o']t say what\\b", "\\bdid ?n[o']t say what\\b",
  "\\btrying to (?:parse|read|work out|decide|figure|understand|place|reconcile)\\b",
  "\\b(?:weighing|calculating|measuring|gauging|deciding) (?:what|which|whether|how|him|her|them)\\b",
  "\\bshowing (?:his|her|their|xyr) (?:\\w+ )?(?:curiosity|doubt|fear|anger|interest|surprise)\\b",
  "\\breveal(?:s|ing|ed) (?:his|her|their|nothing|something)\\b",
  "—\\s*(?:weighing|calculating|measuring|deciding|wondering|trying|reading)\\b",
  "\\bsomething (?:quieter|softer|harder|colder|warmer|sharper|unspoken)\\b",
  "\\bsomething \\w+er than\\b", "\\b(?:held|carried|contained) something \\w+\\b",
  "\\bgone from \\w+ to something\\b", "\\ba look that had gone\\b",
  // ── THE THREE PLAINEST FORMS, WHICH THIS MISSED ENTIRELY ──────────────────────────────────
  // Every family above catches interiority smuggled through a hedge, a simile, or a comparison.
  // None of them caught it stated outright, which is what a model does when the scene gives it
  // nothing else to write. From one save, all three in two sentences, none detected:
  //   "she FELT a sudden sharp ACHE in her chest"          — the feeling, named
  //   "she LET HERSELF look at him"                        — her own permission, her own governance
  //   "WHEN SHE WAS SURE he was deep under"                — what she knew, and when she knew it
  // A NAMED FEELING. Kept to feeling-nouns on purpose: "she felt the blanket" is a hand on cloth
  // and belongs in the prose; "she felt a pang" is the inside of a head nobody can see into.
  "\\b(?:he|she|they|xe|ze)\\s+felt\\s+(?:a|an|the|her|his|their)?\\s*(?:\\w+\\s+){0,2}" +
    "(?:ache|pang|rush|surge|wave|knot|lurch|twist|weight|warmth|heat|chill|tightness|" +
    "relief|shame|guilt|dread|grief|panic|fury|longing|tenderness|revulsion)\\b",
  // SELF-PERMISSION AND SELF-DENIAL — the narrator adjudicating someone's inner governance.
  "\\b(?:let|lets|letting|allow|allows|allowed|allowing)\\s+(?:herself|himself|themselves|itself)\\b",
  "\\b(?:hadn'?t|didn'?t|wouldn'?t|couldn'?t)\\s+(?:let|allow|permit)\\s+(?:herself|himself|themselves)\\b",
  // STATED KNOWLEDGE AND STATED CERTAINTY. A third person's verb of cognition is the interior in
  // one word. Bounded to a pronoun subject so quoted first-person speech ("I knew it") is untouched.
  "\\b(?:when|once|until|after)\\s+(?:he|she|they|xe|ze)\\s+was\\s+(?:sure|certain|satisfied|convinced)\\b",
  "\\b(?:he|she|they|xe|ze)\\s+(?:knew|realiz|realis|understood|decided|wondered|hoped|feared|regretted|remembered that)\\w*\\b",
];

export const MOTIVE_LEAK = new RegExp(LEAK_PATTERNS.join("|"), "i");

export function scrubForReplay(prose: string): string {
  if (!prose) return prose;
  return prose.split(/\n\n+/).map((para) => {
    const sents = para.match(/[^.!?]*[.!?]+["']?\s*|[^.!?]+$/g) ?? [para];
    const kept = sents.filter((x) => !MOTIVE_LEAK.test(x));
    if (!kept.length) return "";
    if (kept.length < sents.length * 0.5 && sents.length > 2) return para; // too greedy — leave it
    return kept.join("").trim();
  }).filter(Boolean).join("\n\n");
}
/* ────────────────────────────────────────────────────────────────────────────────────────────
 * THE REPAIR PASS
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Same splitter `scrubForReplay` uses. Every match keeps its own trailing whitespace, so a
 *  paragraph is exactly `sents.join("")` and a repair can be spliced in without disturbing the
 *  spacing around it. */
const SENT_SPLIT = /[^.!?]*[.!?]+["']?\s*|[^.!?]+$/g;

/** NEVER TOUCH DIALOGUE. This is the one rule the deterministic tic guard learned the hard way —
 *  it once excised a fragment from inside a spoken line and left a bare quotation mark and an
 *  attribution for a line that was not there, on the first thing anybody said to the player in a
 *  new city. A model repairing the sentence instead of deleting it does not make that safer; it
 *  makes it likelier, because the model will happily "improve" a line somebody actually said.
 *
 *  So the test is deliberately crude and deliberately over-inclusive: any sentence carrying a
 *  double quote, a guillemet, or an OPENING single quote is dialogue as far as this module is
 *  concerned and is passed over untouched. A narration sentence that happens to quote two words
 *  keeps its tic. That is the correct trade — the cost of a miss is one unrepaired sentence, and
 *  the cost of a false positive is a mangled line of somebody's speech. */
const DIALOGUE_MARK = /["“”«»]|(?:^|[\s—–-])['‘](?=\w)/;

/** Precompiled so flagging a sentence doesn't rebuild eighty regexes. */
const LEAK_RES: RegExp[] = LEAK_PATTERNS.map((p) => new RegExp(p, "i"));

/** The exact substring that flagged this sentence — what the model is told to remove. Handing it
 *  the phrase rather than the family name is what keeps the repair local: the instruction becomes
 *  "this clause goes", not "this sentence is bad, try again". */
function matchedPhrase(sentence: string): string | null {
  for (const re of LEAK_RES) {
    const m = sentence.match(re);
    if (m && m[0].trim()) return m[0].trim();
  }
  return null;
}

export interface FlaggedSentence {
  para: number;      // paragraph index within the prose
  sent: number;      // sentence index within that paragraph
  text: string;      // the sentence, trimmed
  phrase: string;    // the matched construction
}

/** Everything the reviser would work on, computed locally and for free. A turn whose narration is
 *  clean returns [] and never opens a socket. */
export function flagTics(prose: string): FlaggedSentence[] {
  if (!prose) return [];
  const out: FlaggedSentence[] = [];
  const paras = prose.split(/\n\n+/);
  paras.forEach((para, pi) => {
    const sents = para.match(SENT_SPLIT) ?? [para];
    sents.forEach((raw, si) => {
      const text = raw.trim();
      // Short fragments carry no content worth repairing and are the ones a splitter gets wrong.
      if (text.length <= 25) return;
      if (DIALOGUE_MARK.test(text)) return;
      const phrase = matchedPhrase(text);
      if (phrase) out.push({ para: pi, sent: si, text, phrase });
    });
  });
  return out;
}

/** Past this many in one turn the narration is not ticcing, it is written in that register from end
 *  to end, and repairing it sentence by sentence would be rewriting the turn. Repair the worst and
 *  leave the rest — the directive still quotes one back next turn, which is the fix that generalizes. */
const MAX_REVISIONS = 6;

export const REVISER_SYSTEM = `You repair single sentences of third-person narrative prose. You are given sentences from one scene, each with ONE quoted phrase that must not appear in the finished prose.

Each quoted phrase is a place where the narration claimed access it does not have: it stated what a character felt, knew, decided, intended or was privately concluding, or it told the reader what a gesture or a tone MEANT, or it made a general claim about how people are. The camera only sees and hears. It does not know.

YOUR ONLY JOB IS TO REMOVE THAT PHRASE AND LEAVE A GRAMMATICAL SENTENCE. This is a repair, not a rewrite.

- Keep every proper name, number, object, place and physical detail exactly as written.
- Keep the sentence's own vocabulary. Do NOT reach for a plainer or more common word: this scene may be set in a world that does not contain the word you are about to use. If a word is already in the sentence you may keep it; you may not import one.
- Keep the length close to the original. A repaired sentence is the same sentence with a claim removed, not a shorter summary of it.
- Do not add anything: no new gestures, no new objects, no explanation of what was cut, no replacement interpretation.
- Preferred repair, in order: (1) cut the phrase and keep what is observable — what the body did, where the eyes went, what the hands were doing; (2) if the whole sentence was the claim, replace it with the plain physical fact it was dressed on top of; (3) if nothing observable survives, return an empty string and the sentence will be dropped.
- Never invent what the character was actually feeling. "She was afraid" is the same violation as the phrase you were given. If you cannot say it from outside the body, do not say it.
- Do not add or remove quotation marks. None of these sentences are dialogue and none may become dialogue.

Output ONLY JSON: {"revisions":[{"i":<the sentence's index>,"text":"<the repaired sentence, or an empty string>"}]}. Include every index you were given.`;

const REVISER_SCHEMA: object = {
  type: "object",
  properties: {
    revisions: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "number" }, text: { type: "string" } },
        required: ["i", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["revisions"],
  additionalProperties: true,
};

/** Capitalized words that are capitalized because they START a sentence rather than because they
 *  are somebody's name. Without this list every sentence donates its first word to the protected
 *  set and "The" has to survive the repair; with a blanket skip of the first word instead, a
 *  sentence that OPENS on a name ("Ettel watched the door") lets the repair quietly demote her to
 *  "She" — which in a scene with two women is a real loss, and exactly the kind a length check and
 *  a tic check both wave through. */
const SENTENCE_OPENERS = new Set([
  "The", "A", "An", "This", "That", "These", "Those", "There", "Here", "It", "Its",
  "He", "She", "They", "Him", "Her", "His", "Their", "Them", "Xe", "Ze", "You", "Your",
  "And", "But", "Or", "So", "Yet", "For", "Nor", "If", "Because", "Since", "Though", "Although",
  "When", "While", "After", "Before", "Until", "Once", "Then", "Now", "Later", "As", "By",
  "In", "On", "At", "From", "To", "Into", "Onto", "Over", "Under", "Behind", "Beside", "Across",
  "Outside", "Inside", "Down", "Up", "Out", "Off", "Above", "Below", "Beyond", "Through",
  "No", "Not", "Nothing", "Nobody", "None", "Neither", "Every", "Each", "Both", "One", "Two",
  "Something", "Someone", "Somebody", "Somewhere", "Anything", "Anyone", "Whatever", "Whoever",
  "What", "Where", "Why", "How", "Who", "Which", "Still", "Even", "Only", "Just", "Almost",
]);

/** Proper nouns the repair is not allowed to lose. */
function properNouns(sentence: string): string[] {
  const words = sentence.match(/\b[A-Z][A-Za-zà-ÿ'’-]{1,}\b/g) ?? [];
  const first = sentence.trim().split(/\s+/)[0]?.replace(/[^A-Za-zà-ÿ'’-]/g, "") ?? "";
  return [...new Set(words)].filter((w, i) => !(i === 0 && w === first && SENTENCE_OPENERS.has(w)));
}

/** INTERIORITY THE REPLACEMENT BROUGHT WITH IT.
 *
 *  MOTIVE_LEAK is tuned to catch what a NARRATOR writes unprompted, and it is deliberately bounded
 *  — "she felt a pang" is a leak, "she felt the blanket" is a hand on cloth, so the pattern needs a
 *  pronoun, the verb, and a feeling-noun in a row. A model asked to remove a claim reaches for a
 *  participle instead and walks straight through it: cut "she knew the answer already" and you get
 *  back "…, feeling a sudden sharp ache in her chest", which is the same violation in a costume the
 *  detector was never built to see.
 *
 *  So the replacement is held to a stricter standard than the prose it came from: it may not
 *  introduce interior vocabulary that was not already in the sentence. Being stricter here is free
 *  — a rejection costs one unrepaired sentence, which is what the player had before this module. */
const INTERIOR_WORDS = new RegExp([
  "\\b(?:feel|feels|feeling|felt|sensing|sensed|aware|awareness)\\b",
  "\\b(?:knowing|realizing|realising|understanding|deciding|wondering|hoping|fearing|regretting|remembering)\\b",
  "\\b(?:ache|pang|rush|surge|knot|lurch|dread|relief|shame|guilt|longing|tenderness|revulsion|panic|fury)\\b",
].join("|"), "i");

/** True when the replacement uses interior vocabulary the original did not. */
function reintroducesInterior(original: string, replacement: string): boolean {
  return INTERIOR_WORDS.test(replacement) && !INTERIOR_WORDS.test(original);
}

/** Everything that has to be true before a replacement is allowed to reach the page. Each rejection
 *  costs one unrepaired sentence, which is exactly what the player had before this module existed —
 *  so the bar is set high on purpose. */
export function acceptable(original: string, phrase: string, replacement: string): boolean {
  const r = replacement.trim();
  if (!r) return true;                                   // deliberate drop — handled by the caller
  if (r.length > original.length * 1.6) return false;    // it rewrote rather than repaired
  if (r.length < original.length * 0.25) return false;   // it summarized the sentence away
  if (DIALOGUE_MARK.test(r)) return false;               // narration must not become speech
  if (r.toLowerCase().includes(phrase.toLowerCase())) return false;  // the phrase survived
  if (MOTIVE_LEAK.test(r)) return false;                 // it traded one tic for another
  if (reintroducesInterior(original, r)) return false;   // ...or for one the detector can't see
  for (const n of properNouns(original)) if (!r.includes(n)) return false;  // a name went missing
  return true;
}

export interface RevisionResult {
  /** The prose as the player should read it. Identical to the input on every failure path. */
  prose: string;
  flagged: number;   // sentences the detector caught
  revised: number;   // sentences actually repaired
  dropped: number;   // sentences the model found nothing observable in, and which were cut
  /** Why nothing happened, when nothing happened. Surfaced to the player rather than swallowed. */
  skipped?: string;
}

export interface ReviseOpts {
  model: string;
  fallback: string;
  signal?: AbortSignal;
}

/**
 * Repair this turn's narration. Returns the prose unchanged — and `revised: 0` — on every path
 * that isn't a clean success.
 */
export async function reviseProse(prose: string, opts: ReviseOpts): Promise<RevisionResult> {
  const flagged = flagTics(prose);
  if (!flagged.length) return { prose, flagged: 0, revised: 0, dropped: 0 };

  // Worst first, so a turn over the cap repairs the sentences carrying the most claim.
  const work = [...flagged].sort((a, b) => b.text.length - a.text.length).slice(0, MAX_REVISIONS);

  const listing = work
    .map((f, i) => `[${i}] PHRASE TO REMOVE: «${f.phrase}»\nSENTENCE: ${f.text}`)
    .join("\n\n");

  let parsed: { revisions?: { i: number; text: string }[] };
  try {
    const res = await complete(
      [
        { role: "system", content: REVISER_SYSTEM },
        { role: "user", content: listing },
      ],
      opts.model,
      opts.fallback,
      { schema: REVISER_SCHEMA, name: "weft_revisions" },
      Math.min(1200, 160 + work.length * 140),
      { providerSort: "throughput", omitReasoning: true, signal: opts.signal },
    );
    parsed = JSON.parse(res.text);
  } catch (e) {
    if (isCancel(e)) throw e;   // a stop is a stop; it must unwind the turn, not fail open
    console.warn(`[reviser] pass failed, prose left exactly as written: ${e}`);
    return { prose, flagged: flagged.length, revised: 0, dropped: 0, skipped: "the reviser did not answer" };
  }

  const byIndex = new Map<number, string>();
  for (const r of parsed?.revisions ?? []) {
    if (typeof r?.i !== "number" || typeof r?.text !== "string") continue;
    const f = work[r.i];
    if (!f) continue;
    if (!acceptable(f.text, f.phrase, r.text)) {
      console.warn(`[reviser] rejected a replacement for «${f.phrase}» — keeping the original sentence`);
      continue;
    }
    byIndex.set(r.i, r.text.trim());
  }
  if (!byIndex.size) return { prose, flagged: flagged.length, revised: 0, dropped: 0, skipped: "no usable repair came back" };

  // Splice by (paragraph, sentence) so the rebuild cannot drift out of alignment with the flagging.
  const edits = new Map<string, string>();
  for (const [i, text] of byIndex) edits.set(`${work[i].para}:${work[i].sent}`, text);

  let revised = 0, dropped = 0;
  const out = prose.split(/\n\n+/).map((para, pi) => {
    const sents = para.match(SENT_SPLIT) ?? [para];
    const rebuilt = sents.map((raw, si) => {
      const edit = edits.get(`${pi}:${si}`);
      if (edit === undefined) return raw;
      if (!edit) { dropped++; return ""; }
      revised++;
      // Keep the original sentence's own leading and trailing whitespace — that spacing is the
      // paragraph's, not the sentence's, and losing it is how a repair announces itself.
      const lead = raw.match(/^\s*/)?.[0] ?? "";
      const tail = raw.match(/\s*$/)?.[0] ?? "";
      return lead + edit + tail;
    });
    // A paragraph the pass emptied is a pass that went wrong; keep the original rather than a hole.
    const joined = rebuilt.join("").trim();
    return joined || para;
  }).join("\n\n");

  // TOO GREEDY IS A MISFIRE, NOT A RESULT. `scrubForReplay` backs off when a paragraph would lose
  // most of itself, on the reasoning that a pattern matching that hard is wrong rather than right.
  // The same applies with more force here, because a drop is the reviser reporting that it found
  // nothing observable in a sentence — believable once, and a broken pass when it is most of them.
  if (dropped > revised && dropped * 2 > work.length) {
    console.warn(`[reviser] ${dropped} of ${work.length} sentences came back empty — discarding the pass`);
    return { prose, flagged: flagged.length, revised: 0, dropped: 0, skipped: "the repair came back mostly empty" };
  }

  return { prose: out, flagged: flagged.length, revised, dropped };
}

/** What the player should read for a given turn. Old saves — and every turn the reviser did not
 *  touch — have no revised copy and fall through to the narrator's own words. */
export function displayProse(h: { narrator_prose: string; narrator_prose_read?: string }): string {
  return h.narrator_prose_read || h.narrator_prose;
}
