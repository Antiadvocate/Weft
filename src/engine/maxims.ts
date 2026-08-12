/**
 * THE MAXIM — a character speaking in portable wisdom instead of talking.
 *
 * From a real save, an inn in the Alban Hills, four consecutive turns:
 *
 *     "Shock has a price, Rabi." … "This house breathes without a lung. We're just counting the
 *     cost of the air."
 *     "Metaphors are for men who have time for ghosts, Rabi."
 *     "She speaks in the price of things." … "She just has a way of looking at a stone and seeing
 *     the wall it came from." … "the pot has a way of teaching you that nothing is ever just what
 *     it looks like."
 *
 * The player typed "That's a big metaphor that means nothing to me" and got another metaphor. He
 * then asked a second character whether the first only speaks in maxims, and she answered — in
 * maxims. That is the tell that it is not a character voice at all: it is the narrator's register,
 * wearing whichever mouth is open.
 *
 * WHAT IT IS NOT. It is not the forge. The cards in that save are specific and good and contain no
 * aphorism anywhere: Lucia's voice reads "argumentative, theological, she disputes the gods'
 * arrangements like a woman haggling over a bad cut of meat", her syntax "builds a case in clauses,
 * if this then that, then knocks it down herself", and her example lines are concrete and
 * quarrelsome ("A crown you keep by murder — is that worship?"). Nothing she said in play resembled
 * any of it. The card was right and was not being read.
 *
 * WHY IT HAPPENS ANYWAY, and this is the whole point:
 *
 *   · EVERY RULE THAT WOULD STOP IT LIVES IN THE CACHED PREFIX. "No slogans or aphorisms" is in the
 *     style block. "If what you are about to write for them is smoother, wiser, or more quotable
 *     than these, it is wrong" is on the character card. Both are excellent and both sit tens of
 *     thousands of characters back, and this engine has already learned once, painfully, and
 *     written down (see authored.ts, habitDirective) that a rule in the middle of a long document
 *     is REFERENCE and a rule at the end is an INSTRUCTION. Nothing in the per-turn directive said
 *     one word about how anybody talks.
 *   · THE BAN WAS SCOPED TO NARRATION. "That register must never appear in the narration" is about
 *     the prose voice. A character SAYING a maxim out loud is not obviously covered by it, and the
 *     model read it that way — the narration in that save is clean, and every offence is in dialogue.
 *   · A MAXIM IS THE PATH OF LEAST RESISTANCE OUT OF "BE OBLIQUE". The engine tells the narrator, in
 *     many places and rightly, never to state a want, never to narrate a feeling, to come at things
 *     sideways. Metaphor is the cheapest way to say a thing without saying it, and a compressed
 *     metaphor delivered flat is a maxim. The instruction is right; this is its exhaust.
 *
 * AND IT IS NOT HISTORY. Romans do not talk like this, and neither does anyone else. What survives
 * of ordinary Roman speech — Plautus, Cicero's letters, the Vindolanda tablets, the graffiti at
 * Pompeii — is transactional, litigious, gossipy, obscene and extremely specific: prices, names,
 * lawsuits, someone's brother, a bad batch of fish sauce. The oracular register is a modern
 * screen-and-prestige-novel convention for "ancient", and a model reaches for it whenever nothing
 * more specific is holding the mouth open. The cards WERE more specific. They just were not being
 * enforced anywhere near the point of writing.
 *
 * So: catch it in the committed prose, quote it back next turn. Exactly the mechanism `last_leak`
 * uses for stated interiors, which is the one thing in this engine that has reliably stopped a
 * narrator habit — because it is specific, it is evidence, and it arrives at the end.
 */

/** Only ever run against spoken text. The narration has its own rules and its own guards, and a
 *  metaphor in description is a style choice; a metaphor in somebody's mouth is a character being
 *  replaced by an oracle. */
export function spokenLines(prose: string): string[] {
  const out: string[] = [];
  for (const m of prose.matchAll(/[“"]([^“”"]{12,400})[”"]/g)) {
    const said = m[1].trim();
    if (said) out.push(said);
  }
  return out;
}

/** The shapes, each one lifted from prose this actually produced. Kept narrow on purpose: a false
 *  positive puts a real line of dialogue in front of the narrator labelled as a fault, which teaches
 *  it to avoid something that was fine. */
const SHAPES: { name: string; re: RegExp }[] = [
  // "Metaphors are for men who have time for ghosts." — the classic maxim frame.
  { name: "X is for those who Y", re: /\b(?:is|are)\s+for\s+(?:men|women|people|those|the\s+\w+|anyone|others)\s+who\b/i },
  // "Shock has a price." "Everything has a price." — abstraction as the subject of a general law.
  { name: "abstraction takes a verb", re: /(?:^|[.!?;]\s+|,\s+)(?:[A-Z]?[a-z]+\s+)?(?:shock|grief|fear|hunger|silence|debt|price|truth|love|death|time|memory|hope|mercy|justice|blood|winter|money|gold|power|faith|mercy|pride|shame|sorrow|patience)\s+(?:has|is|does|comes|takes|costs|buys|keeps|makes|teaches|finds|waits)\b/i },
  // "nothing is ever just what it looks like" — the universal quantifier as a verdict on the world.
  // "has" belongs here as much as "is": "Everything has a price" is the single most common shape
  // this failure takes, and a verb list built only from the copula walked straight past it. The
  // optional word between subject and verb is for "everything HERE has a price" — one adverb was
  // enough to slip the whole rule.
  { name: "universal verdict", re: /\b(?:nothing|everything|no one|nobody|everyone|no man|every man|all men|all things)\s+(?:\w+\s+)?(?:is|are|was|ever|never|always|has|have|costs|takes|means|comes|stays|lasts|ends|dies|keeps)\b/i },
  // "She just has a way of looking at a stone and seeing the wall it came from."
  { name: "has a way of", re: /\b(?:has|have|had)\s+a\s+way\s+of\s+\w+ing\b/i },
  // "This house breathes without a lung." — an inanimate subject given a living verb, as assertion.
  { name: "the room is alive", re: /\b(?:this|the|a)\s+(?:house|room|city|town|road|river|stone|wall|door|night|pot|fire|hill|wood|water|sea|land|earth|sky)\s+(?:breathes|bleeds|remembers|forgets|eats|sings|dreams|hungers|weeps|sleeps|listens|waits|knows|speaks|watches|forgives)\b/i },
  // "She's not a ghost. She's just tired of the ones she has to live with." — the antithesis, which
  // is also the register these very instructions are written in. See the note in the header.
  { name: "not X, but Y", re: /\b(?:is|are|'s|'re|was|were)\s+not\s+(?:a|an|the)?\s?[\w' ]{2,28}[.,;]\s*(?:it|he|she|they|that)?\s*(?:'s|is|are|just|only)\b/i },
  // "There is no dark here, only lamps and neighbors." — the balanced pronouncement.
  { name: "there is no X, only Y", re: /\bthere\s+(?:is|are)\s+no\s+[\w' ]{2,24},\s*(?:only|just)\b/i },
  // "We're just counting the cost of the air." — a metaphor standing in for a plain answer.
  { name: "the cost/weight/price of X", re: /\b(?:the\s+)?(?:cost|price|weight|shape|colour|color|sound|taste)\s+of\s+(?:the\s+)?(?:air|silence|waiting|nothing|everything|it\s+all|living|breathing)\b/i },
];

export interface MaximHit { line: string; shape: string }

/**
 * Aphorisms in this turn's dialogue, worst first.
 *
 * A LENGTH GATE DOES MOST OF THE WORK. Ordinary speech that happens to contain one of these shapes
 * is usually embedded in a longer, messier sentence with a specific subject; a maxim is short,
 * closed, and could be printed on its own. So a match only counts inside a short spoken clause.
 */
export function findMaxims(prose: string): MaximHit[] {
  const hits: MaximHit[] = [];
  for (const said of spokenLines(prose)) {
    // Sentence by sentence, plus the whole line when it is short — the antithesis often straddles a
    // full stop ("She's not a ghost, Rabi. She's just tired of the ones she has to live with."), and
    // split per sentence neither half matches anything.
    const whole = said.split(/\s+/).filter(Boolean).length <= 30 ? [said] : [];
    for (const raw of [...said.split(/(?<=[.!?])\s+/), ...whole]) {
      const s = raw.trim();
      const words = s.split(/\s+/).filter(Boolean).length;
      if (words < 4 || words > 30) continue;      // too short to be a maxim, too long to be portable
      if (/\?$/.test(s)) continue;                // a question is not a pronouncement
      for (const sh of SHAPES) {
        if (sh.re.test(s) && !hits.some((h) => h.line === s || s.includes(h.line))) {
          hits.push({ line: s, shape: sh.name }); break;
        }
      }
    }
  }
  // Shorter is more quotable, and the most quotable one is the one worth showing back.
  return hits.sort((a, b) => a.line.length - b.line.length);
}

/**
 * THE CORRECTION, at the end of the directive where instructions live.
 *
 * Quotes the actual sentence, names what is wrong with it structurally, and says what to do
 * instead — the three properties that make the `last_leak` note work where a general style rule in
 * the prefix does not. It also carries the positive half: these people have example lines on their
 * cards, written in their own registers, and the fix is to talk like THAT, not to talk less.
 */
export function maximFix(last: string | null | undefined): string {
  if (!last) return "";
  return `\nYOU PUT A MAXIM IN SOMEBODY'S MOUTH LAST TURN: "${last}" — a short, closed sentence stating a general truth about the world, which could be lifted out of this scene and still mean something. Nobody talks like this. Writing it means you did not know what this specific person would say and reached for wisdom to cover the gap. People answer the question they were asked, about the thing in front of them, using names, prices, and their own business.
THIS TURN, every character speaks in plain specifics: what they want, what it costs, who they mean, what they are going to do about it. NO aphorism, NO proverb, NO metaphor standing in for a plain answer, NO sentence that could be lifted out of this scene and still mean something. Test each line by printing it on its own: if it still means something out of context, cut it and write what the person actually says. When a character is asked a direct question, they answer it or refuse it in plain words. Answering a direct question with an image is the failure quoted above.`;
}

/** How much of this turn's dialogue was pronouncement rather than speech — for the shift toast, so
 *  the player can see the engine caught it rather than wondering whether anyone noticed. */
export function maximRate(prose: string): number {
  const lines = spokenLines(prose);
  if (!lines.length) return 0;
  return findMaxims(prose).length / lines.length;
}

/**
 * THE POSITIVE HALF — the speaker's own lines, at the point of writing.
 *
 * Banning a register leaves a vacuum, and a model fills a vacuum with its defaults, which for
 * "ancient world" is the oracle. The cards in the save that prompted all this already held the
 * answer — Lucia argues in clauses and haggles with her goddess, Marcus answers with a date and
 * nothing else, Gnaeus frames every grievance as a lawsuit he could win — and every one of those
 * lines was sitting in the cached prefix behind thirty thousand characters, which this engine has
 * already learned means REFERENCE rather than instruction (see authored.ts, habitDirective).
 *
 * So the exemplars come down here too, for present speakers only, at a couple of lines each. It is
 * the cheapest possible intervention: it costs a hundred-odd tokens, it says nothing new, and it
 * puts the one concrete sample of how this person talks next to the request to write them talking.
 */
export function voiceAnchor(
  state: { characters: Record<string, { name: string; voice?: { example_lines?: string[] } }> },
  presentIds: string[],
): string {
  const rows: string[] = [];
  for (const id of presentIds.slice(0, 4)) {
    const c = state.characters[id];
    const ex = c?.voice?.example_lines?.filter((l) => l?.trim()).slice(0, 2) ?? [];
    if (!ex.length) continue;
    rows.push(`${c.name} sounds like this: ${ex.map((l) => `"${l.trim()}"`).join(" · ")}`);
  }
  if (!rows.length) return "";
  return `\n[HOW THESE PEOPLE ACTUALLY TALK — write new lines in these registers, never these lines.
· ${rows.join("\n· ")}
Match the diction, the sentence length and the roughness. If what you are about to give one of them is smoother, wiser, more compressed or more quotable than their own lines above, it belongs to nobody and it is wrong — write what THIS person would say about the thing actually in front of them.]`;
}
