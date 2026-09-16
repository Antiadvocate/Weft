/**
 * THE FIGURE CATALOGUE — one list of sentence shapes, read by everything that writes or screens text.
 *
 * Three parts of this engine were hunting the same shapes with three separate copies of the rules.
 * engine/maxims.ts scans committed prose for a character speaking in portable wisdom. tools/
 * promptlint.ts scans the instructions themselves, because an instruction written as an epigram
 * teaches the epigram. Neither one ever looked at the third corpus, which is the largest:
 *
 *     THE CARDS. voiceforge writes diction, syntax, rhythm, agenda and example_lines. driveforge
 *     writes a goal, an approach and a step. traitforge writes core traits. sketch fills a
 *     background. The bookkeeper writes a memory, a thread line and a new character's whole record.
 *     Every one of those strings is then printed into the narrator's prompt on every turn it is
 *     relevant, for the rest of the save.
 *
 * A maxim in committed prose is one bad line the player reads once. A maxim in `speech_pattern` is
 * a bad line the narrator is handed as a model of how this person talks, every turn, forever — and
 * voiceAnchor prints example_lines to the narrator under the heading ONE OF THEIR ACTUAL LINES.
 * The engine was catching the symptom on the way out and supplying the cause on the way in.
 *
 * WHAT IS IN HERE. The shapes below are the ones promptlint already proved on this codebase's own
 * instructions, moved here so the linter, the forge and the bookkeeper all read one list. Moving
 * them changed none of them: the counts in tests/prompt-shapes.ts are the same counts.
 *
 * WHAT IS NOT. The dialogue shapes stay in maxims.ts, where the length gate and the quoted-speech
 * scanner they depend on already live. A card's example_lines ARE dialogue, so the forge screens
 * those with findMaxims and screens everything else with this file. Two corpora, two gates, one
 * place each.
 *
 * HOW A CALLER USES IT. Rejection first, retry second, and never repair: a figure is a sentence
 * written the wrong way round, and an edit to it is a guess about what was meant. voiceforge has
 * five candidates and drops the ones that trip, the way it already drops the ones that say the same
 * thing four times. sketch has one answer and asks again for the field that tripped, the way it
 * already asks again for traits that name no act. Both fail open — a screened field that cannot be
 * replaced is kept, because a figure on a card still beats a blank one.
 */

/** A named sentence shape, with the reason a caller can print to a model. */
export interface Figure { name: string; re: RegExp; why: string }

/* THE ABSTRACT NOUNS. A figure needs one of these to be handed a verb, and the list is the closed
 * one promptlint arrived at — the feelings and qualities a narrator reaches for when nothing in the
 * room is doing anything. */
const ABSTRACTION = String.raw`contempt|silence|grief|shame|anger|hunger|want|pull|need|fear|desire|appetite|longing|tenderness|cruelty|kindness|distance|absence|memory|guilt|doubt|hope|dread|affection|resentment|violence|intimacy`;

/**
 * THE EPIGRAM BUILT OUT OF AN OPPOSITION.
 *
 * "X is not the same as Y." "It is not a bond, it is an appetite." The balanced pair is the single
 * most reliable marker of the register, and three independent parties say so: it is a SHAPE in
 * maxims.ts mined from a real save, it is 25% of the EQ-Bench Slop Score, and OpenAI's Astra
 * prompting guide bans it by name. Rewriting one is usually a matter of stating the positive
 * requirement and stopping.
 */
export const EPIGRAM_FIGURES: Figure[] = [
  { name: "is not the same as", re: /\b(?:is|are)\s+not\s+the\s+same\s+\w*\s*as\b/i, why: "a distinction asserted between two words instead of a thing named" },
  { name: "not a X, it is Y", re: /\b(?:is|are)\s+not\s+a\s+\w+[,;]\s*(?:it|they)\s+(?:is|are)\b/i, why: "the balanced correction — say the second half and drop the first" },
  { name: "never X, always Y", re: /\bnever\s+\w+[^.;]{2,30},\s*always\b/i, why: "a rule written as a slogan" },
  { name: "the X is not the Y", re: /\bthe\s+\w+\s+is\s+not\s+the\s+\w+\b/i, why: "a definition by denial" },
];

/** The same move in its commonest form. Kept as its own list because the linter reports it under
 *  its own name and carries its own count for it. */
export const CONTRASTIVE_FIGURES: Figure[] = [
  { name: "X, not Y", re: /\b\w+,\s+not\s+(?:a|an|the|what|who|whether|how|why|by|because|to|in|on|for|from|about|as)?\s*\w+/i, why: "the contrastive epigram; state the positive requirement and stop" },
  { name: "X — not Y", re: /\b\w+\s+—\s*not\s+(?:a|an|the)?\s*\w+\b/i, why: "the contrastive epigram with a dash" },
  { name: "is not a X; it", re: /\bis\s+not\s+(?:a|an|the)?\s*\w+[,;]\s*(?:it|they|and)\b/i, why: "the contrastive epigram across a semicolon" },
];

/**
 * THE EPIGRAM THAT USES NO OPPOSITION.
 *
 * Every shape above is a contrastive wearing a hat, so a detector built only from them scored zero
 * on the hostile-desire directive in engine/desire.ts — six clauses, six epigrams, no contrast
 * anywhere: "they stand nearer than the argument needs", "contempt that keeps coming back for more
 * of you", "needling as a way of making contact", "punishing you for a pull they will not own".
 *
 * Four families, each narrow on purpose. A bare "not" is ordinary, an abstract noun is ordinary,
 * and "as a way of" is ordinary; what is caught is the figure.
 */
export const FIGURED_FIGURES: Figure[] = [
  /* LITOTES — a quality asserted by negating its opposite. A first cut opened this family with
   * /(that|which) (is|are) not \w+/, which is the ordinary restrictive clause every rule in this
   * corpus is built from: "a room that is not in the bible", "events that are not in the raw
   * memories". Two thirds of everything it found was that, and a detector wrong two times in three
   * teaches a reader to skip its output. So the patterns kept are the ones where the negation is
   * doing rhetorical work — a manner phrase, an un- prefix, or the "no small thing" frame. */
  { name: "litotes: in ways that are not", re: /\bin\s+(?:a\s+way|ways)\s+that\s+(?:is|are)\s+not\b/i, why: "a quality asserted by denying its opposite; name the quality" },
  { name: "litotes: not un-", re: /\bnot\s+un\w{3,}/i, why: "a quality asserted by denying its opposite; name the quality" },
  { name: "litotes: no small thing", re: /\bno\s+(?:small|little|ordinary|accident|mistake)\b/i, why: "size asserted by denial; say what size" },
  { name: "abstraction with a verb", re: new RegExp(String.raw`\b(?:${ABSTRACTION})\s+(?:that|which)\s+(?!is\b|was\b|has\b|does\b|goes\b|seems\b)\w+s\b`, "i"), why: "an abstraction is doing the acting; put a person or an object in the subject" },
  { name: "the abstraction acts", re: new RegExp(String.raw`\b(?:the|a|an)\s+(?:${ABSTRACTION})\s+(?:does|did|keeps|kept|comes|came|goes|went|takes|took|arrives|arrived|answers|answered)\b`, "i"), why: "an abstraction is doing the acting; put a person or an object in the subject" },
  { name: "for a X they will not own", re: new RegExp(String.raw`\bfor\s+a\s+(?:${ABSTRACTION})\s+(?:they|he|she|it)\s+(?:will|would|do|does|did)\s+not\b`, "i"), why: "an abstraction is doing the acting; put a person or an object in the subject" },
  { name: "X-ing as a way of Y-ing", re: /\b\w+ing\s+as\s+(?:a\s+)?(?:way|form|kind|means|version|sort)\s+of\b/i, why: "an action restated as its own interpretation; give the action and stop" },
  { name: "measured against an abstraction", re: /\b(?:nearer|closer|longer|harder|softer|quieter|louder|slower|more|less)\s+than\s+the\s+\w+\s+(?:needs|need|warrants|warranted|requires|deserves|allows|asks|calls)\b/i, why: "a comparison whose yardstick is a concept; say the measurable thing" },
];

/**
 * THE PRONOUNCEMENT ABOUT THE WORLD.
 *
 * These come from maxims.ts, where they were mined out of committed dialogue, and they belong here
 * too because a card field carries them just as easily as a mouth does. A `speech_pattern` reading
 * "talks about everything as though it has a price" hands the narrator the register in the one
 * string it is asked to write the character out of.
 *
 * Kept to the shapes that survive OUTSIDE quotation marks — a universal verdict, an inanimate thing
 * given a life, a price standing in for a fact. The ones that depend on somebody being addressed
 * ("you'll see in time", "everyone knows") stay in maxims.ts with the speech scanner.
 */
export const PRONOUNCEMENT_FIGURES: Figure[] = [
  { name: "X is for those who Y", re: /\b(?:is|are)\s+for\s+(?:men|women|people|those|the\s+\w+|anyone|others)\s+who\b/i, why: "a general law about who a thing belongs to" },
  { name: "universal verdict", re: /\b(?:nothing|everything|no one|nobody|everyone|no man|every man|all men|all things)\s+(?:\w+\s+)?(?:is|are|was|ever|never|always|has|have|costs|takes|means|comes|stays|lasts|ends|dies|keeps)\b/i, why: "a verdict on the world in general; say the particular case" },
  { name: "has a way of", re: /\b(?:has|have|had)\s+a\s+way\s+of\s+\w+ing\b/i, why: "a habit stated as a general property; name the occasion it happens on" },
  { name: "the room is alive", re: /\b(?:this|the|a)\s+(?:house|room|city|town|road|river|stone|wall|door|night|pot|fire|hill|wood|water|sea|land|earth|sky)\s+(?:breathes|bleeds|remembers|forgets|eats|sings|dreams|hungers|weeps|sleeps|listens|waits|knows|speaks|watches|forgives)\b/i, why: "an inanimate thing given a living verb as a statement of fact" },
  { name: "there is no X, only Y", re: /\bthere\s+(?:is|are)\s+no\s+[\w' ]{2,24},\s*(?:only|just)\b/i, why: "the balanced pronouncement" },
  { name: "the cost of X", re: /\b(?:the\s+)?(?:cost|price|weight|shape|colour|color|sound|taste)\s+of\s+(?:the\s+)?(?:air|silence|waiting|nothing|everything|it\s+all|living|breathing)\b/i, why: "a figure standing in for a plain fact" },
  { name: "made of a thing and an abstraction", re: /\b(?:build|built|building|made|make|making|hold|holding|held\s+together|running|runs|run|stitch|stitched|glued|patched|cobbled|assembled)\s+(?:\w+\s+){0,3}(?:out\s+of|of|on|with|from)\s+[^.,;!?"]{2,40}\s+and\s+(?:a\s+|an\s+|the\s+)?(?:hope|prayer|prayers|faith|luck|spite|grief|memory|memories|silence|regret|shame|pride|fear|love|patience|nerve|denial|habit|instinct|momentum|inertia|goodwill|optimism|guesswork|willpower|stubbornness|wishful\s+thinking)\b/i, why: "a list of materials ending in a feeling; the line was written to be quoted" },
];

/**
 * THE SUBSET THAT SURVIVES CONTACT WITH RULE-WRITING.
 *
 * `universal verdict` is the one shape above that cannot be turned on instructions, and the first
 * run of the linter with the whole list attached says so plainly: 58 findings, of which
 * substantially all were prohibitions. "Nothing is invented that contradicts the state." "Nobody is
 * hurt, nobody acts on it, no new event begins." "No 'unknown' — everyone is somewhere." A
 * prohibition in English is written with a universal quantifier and a copula, which is the shape,
 * and every one of those sentences is doing exactly what an instruction should do.
 *
 * tools/promptlint.ts records the standard this is judged against, learned when the litotes family
 * was opened too wide: a detector wrong two times in three teaches a reader to skip its output,
 * which is worse than not having it. So the shape stays on the card screen, where a field is short
 * and declarative and "everything here has a price" means what it says, and comes off the linter.
 */
export const INSTRUCTION_PRONOUNCEMENTS: Figure[] = PRONOUNCEMENT_FIGURES.filter((f) => f.name !== "universal verdict");

/** Everything, in the order a caller should report it: the opposition shapes first, because they
 *  are the commonest and the easiest to rewrite. */
export const FIGURES: Figure[] = [...EPIGRAM_FIGURES, ...CONTRASTIVE_FIGURES, ...FIGURED_FIGURES, ...PRONOUNCEMENT_FIGURES];

/** What was caught, and enough to print back to a model that has to fix it. */
export interface FigureHit { shape: string; why: string; text: string }

/* A FIELD TOO SHORT TO CARRY A FIGURE. Four words is the floor maxims.ts uses on spoken lines and
 * the reason holds here: "Counts steps" cannot be an epigram. */
const MIN_WORDS = 4;

/** The first figure in one string, or null. Sentence by sentence, so a long background is judged on
 *  the clause that carries the figure rather than on its total length. */
export function figureIn(text: unknown): FigureHit | null {
  const whole = String(text ?? "").trim();
  if (!whole) return null;
  for (const raw of whole.split(/(?<=[.!?;])\s+|\s+—\s+/)) {
    const s = raw.trim();
    if (s.split(/\s+/).filter(Boolean).length < MIN_WORDS) continue;
    for (const f of FIGURES) if (f.re.test(s)) return { shape: f.name, why: f.why, text: s };
  }
  // ...and once across the whole string, for a figure that straddles a full stop the way the
  // antithesis does: "She is not a ghost. She is just tired." Only when the string is short enough
  // to be portable — a four-sentence background is not one epigram — and long enough to be a
  // sentence at all, which is the same floor the per-sentence pass uses.
  const words = whole.split(/\s+/).filter(Boolean).length;
  if (words >= MIN_WORDS && words <= 30) {
    for (const f of FIGURES) if (f.re.test(whole)) return { shape: f.name, why: f.why, text: whole };
  }
  return null;
}

/** True when this string carries one. */
export function figured(text: unknown): boolean {
  return figureIn(text) !== null;
}

/** Every figure across a list of strings, one per string at most. */
export function figuresIn(texts: readonly unknown[] | undefined): FigureHit[] {
  const out: FigureHit[] = [];
  for (const t of texts ?? []) { const h = figureIn(t); if (h) out.push(h); }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE CARD SCREEN — what the forge and the bookkeeper are allowed to write onto a person.
 *
 * Every field named below is printed into the narrator's prompt. prompts.ts assembles the character
 * card out of appearance_facts, core_traits, values, speech_pattern, the voice fingerprint,
 * example_lines, never_says, background and texture; maxims.ts prints speech_pattern again each
 * turn under TALKS LIKE THIS and one example line under ONE OF THEIR ACTUAL LINES. So a figure in
 * any of them is not a bad sentence, it is a standing instruction to write that way.
 *
 * example_lines are screened by a different gate. They are dialogue — the narrator copies them
 * verbatim — so they go through findMaxims, which is built for quoted speech and has the length
 * gate and the shape list that belong to it. Everything else is description and goes through the
 * figure catalogue above.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

import { findMaxims } from "./maxims";

/** A field the screen would not let through, and why. */
export interface CardFault { field: string; text: string; shape: string; why: string }

/** The description fields that reach the narrator. Anything not on this list is either a number, an
 *  id, or prose the player typed, and the player may write however they like. */
const SCREENED_FIELDS = [
  "speech_pattern", "background", "life_history", "appearance_facts", "taste", "current_goal",
] as const;

/** The list fields, same rule, one fault per entry. */
const SCREENED_LISTS = ["core_traits", "values", "texture"] as const;

/** The voice card's description fields. `tics` and `never_says` are excluded: a tic is a verbal
 *  habit quoted as one, and a never_says entry is a construction named in order to be banned —
 *  screening either would report the thing they exist to record. */
const SCREENED_VOICE = ["diction", "syntax", "rhythm", "agenda"] as const;

interface ScreenableCard {
  speech_pattern?: unknown; background?: unknown; life_history?: unknown; appearance_facts?: unknown;
  taste?: unknown; current_goal?: unknown;
  core_traits?: unknown; values?: unknown; texture?: unknown;
  // `tics` and `never_says` are accepted and ignored — see SCREENED_VOICE for why they are exempt.
  voice?: { diction?: unknown; syntax?: unknown; rhythm?: unknown; agenda?: unknown; example_lines?: unknown; tics?: unknown; never_says?: unknown } | null;
  example_lines?: unknown;
}

/**
 * Every figure on one character card, worst first.
 *
 * "Worst" is the example lines, then the speech pattern, then everything else, because that is the
 * order in which the field is put in front of the narrator at the moment of writing: an example
 * line is a sample sentence to copy, a speech pattern is a description to write from, and a
 * background is reference.
 */
export function screenCard(card: ScreenableCard | null | undefined): CardFault[] {
  if (!card) return [];
  const out: CardFault[] = [];

  // 1. THE SAMPLE LINES, through the dialogue gate. A sample is quoted for findMaxims because that
  //    scanner reads what is between quotation marks and a stored example line carries none.
  const lines = [...asStrings(card.voice?.example_lines), ...asStrings(card.example_lines)];
  for (const l of lines) {
    const hit = findMaxims(`"${l.replace(/["“”]/g, "")}"`)[0];
    if (hit) out.push({ field: "example_lines", text: l, shape: hit.shape, why: "the narrator copies this line to write everything this person says" });
    else { const f = figureIn(l); if (f) out.push({ field: "example_lines", text: l, shape: f.shape, why: f.why }); }
  }

  // 2. THE SPEECH PATTERN and the voice fingerprint, which describe how the mouth works.
  for (const f of ["speech_pattern"] as const) { const h = figureIn(card[f]); if (h) out.push({ field: f, text: h.text, shape: h.shape, why: h.why }); }
  for (const k of SCREENED_VOICE) { const h = figureIn(card.voice?.[k]); if (h) out.push({ field: `voice.${k}`, text: h.text, shape: h.shape, why: h.why }); }

  // 3. Everything else on the card.
  for (const f of SCREENED_FIELDS) {
    if (f === "speech_pattern") continue;
    const h = figureIn((card as Record<string, unknown>)[f]);
    if (h) out.push({ field: f, text: h.text, shape: h.shape, why: h.why });
  }
  for (const f of SCREENED_LISTS) {
    for (const item of asStrings((card as Record<string, unknown>)[f])) {
      const h = figureIn(item);
      if (h) out.push({ field: f, text: item, shape: h.shape, why: h.why });
    }
  }
  return out;
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  const s = String(v ?? "").trim();
  return s ? [s] : [];
}

/**
 * THE CORRECTION, for a caller that has a model call to spend.
 *
 * It quotes the sentence, names the shape, and says what to write instead — the three properties
 * maxims.ts records as the reason its per-turn note works where a style rule in the cached prefix
 * does not. It names no literary form: promptlint's own check 4 records why, which is that a prompt
 * saying "no aphorisms" has spent its tokens describing aphorisms and the model has to represent
 * one to avoid it. The positive requirement excludes the shape without introducing it.
 */
export function rewriteNote(faults: readonly CardFault[], who: string): string {
  if (!faults.length) return "";
  const rows = faults.slice(0, 6).map((f) => `- ${f.field}: “${f.text.slice(0, 160)}” — ${f.why}`);
  return `These came back as sentences about the world in general rather than about ${who}, so they fit any person in any story:\n${rows.join("\n")}\n`
    + `Rewrite each one so it names something a camera would catch: an object ${who} handles, a place they go, a person they know by name, something that happened to them on a particular day, a thing their hands do. A finished line passes when you can point at the thing in it. Keep every other field byte-identical.`;
}
