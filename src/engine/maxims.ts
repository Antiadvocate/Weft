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

import { attributeLines } from "./aperture";

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

  // ── THE SECOND GENERATION ──────────────────────────────────────────────────────────────────
  // Everything above was reverse-engineered from one save's exact sentences, which is the same
  // mistake as the power-tier regex in pressure.ts: a detector fitted to how a thing was PHRASED
  // rather than to what it IS. Measured against the next thirty turns of the same story it caught
  // seven lines out of a hundred and thirty-eight, every one of them from before it shipped. The
  // register had simply moved, into these:
  //
  //   "A bench that's never been sat on. It's like a loaf that's never been cut."
  //   "The beetle rolls with its back legs. Everyone knows that."
  //   "The fever doesn't take a roof off. It takes the hands that hold the roof up."
  //   "You stay long enough, you'll see."
  //
  // Not one is an aphorism by the shapes above. All four are the same behaviour: answering the
  // person in front of you with a figure instead of an answer.

  // SIMILE AS AN ANSWER. "It's like a loaf that's never been cut." A comparison offered as the
  // reply, where the thing compared to is not present and has nothing to do with the question.
  { name: "simile as an answer", re: /\b(?:it['’]?s|that['’]?s|you['’]?re|he['’]?s|she['’]?s|we['’]?re|they['’]?re)\s+like\s+(?:a|an|the)\s+\w+/i },

  // THE PARALLEL FOLK SAYING. "X doesn't take A. It takes B." The two-beat correction structure is
  // the single most reliable marker of wisdom-voice in this engine's output.
  // Both apostrophes, everywhere: see the note above about matching spellings.
  { name: "not this, but that", re: /\b(?:does\s?n['’]?t|do\s?n['’]?t|never)\s+\w+[^.;!?]{2,40}\.\s*(?:It|They|He|She)\s+\w+s?\b/ },

  // THE APPEAL TO COMMON KNOWLEDGE. "Everyone knows that." "That's what they say." Tags that turn a
  // remark into received wisdom, usually attached to something nobody asked about.
  { name: "everyone knows", re: /\b(?:everyone|everybody|any\s?one)\s+knows\s+(?:that|it|this)\b|\bthat['’]?s\s+what\s+(?:they|people)\s+say\b/i },

  // THE PROPHECY. "You stay long enough, you'll see." "Give it time and you'll know." Deferring the
  // answer to the listener's future instead of giving it now.
  { name: "you'll see in time", re: /\byou(?:['’]ll| will)\s+(?:see|know|learn|find out|understand)\b(?!\s+(?:her|him|them|it|the\s+\w+\s+(?:at|in|on)))/i },

  // AND THE WORST ONE: THE NARRATOR DEFENDING THE REGISTER THROUGH A CHARACTER'S MOUTH.
  //
  // The player wrote, in plain words, that the characters were not referencing what was happening
  // in front of them. The reply: "A beetle and a fever and a roof aren't maxims. They're the room
  // we're standing in. You keep asking me to say it plain, and I keep saying it plain, and you keep
  // hearing a lesson." That is the model using a character to tell the player they are wrong about
  // the model's own failure, and it is worse than the failure. It gets its own shape so the
  // correction can name it.
  { name: "arguing that it is not a maxim", re: /\b(?:are\s?n['’]?t|is\s?n['’]?t|not)\s+(?:a\s+)?(?:maxims?|metaphors?|riddles?|lessons?|proverbs?)\b|\bkeep\s+hearing\s+a\s+lesson\b|\bI\s+(?:am|keep)\s+(?:saying|speaking)\s+it\s+plain/i },
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
  // THE ONE THAT NEEDS ITS OWN CORRECTION. When the caught line is the narrator arguing, through a
  // character, that its figures are not figures, a general note about aphorism will not reach it —
  // the model has already constructed a defence and will apply it to the note. Name the move.
  const defending = SHAPES.find((sh) => sh.name === "arguing that it is not a maxim")!.re.test(last);
  if (defending) {
    return `\nSTOP. LAST TURN A CHARACTER ARGUED WITH THE PLAYER ABOUT HOW THE CHARACTERS TALK: "${last}" — the player had just said the characters were not answering what was in front of them, and the reply put a defence of that in somebody's mouth. Nobody in this world has an opinion about how the writing works. The player is right and the argument is over. THIS TURN nobody in the scene refers to how anybody talks, defends how they talk, or comments on being misunderstood. They answer the actual question in the actual words a person would use: names, numbers, prices, what they will do, what they will not do, what they are afraid of said as the plain thing rather than as an image of the plain thing. If a character genuinely does not want to answer, they refuse in one flat sentence and change the subject to something concrete.`;
  }
  return `\nA LINE YOU WROTE LAST TURN NAMED NOTHING THAT WAS IN THE ROOM: "${last}" — a sentence about the world in general rather than about anything in that room. It came out when you did not know what this specific person would say next, and it fits any character in any scene, which is what makes it wrong here.
THIS TURN, EVERY LINE ANYONE SPEAKS NAMES SOMETHING PHYSICALLY PRESENT: a person, an object, a price, a door, a name, a number, an errand, somewhere they could point at. Before you keep a line, find the thing in it that somebody standing there could put a hand on. If there is nothing, the line is about the world in general instead of about this minute — rewrite it until it is about something here. When a character is asked a direct question they answer it, or they refuse it in plain words and say what they are going to do instead. If they answer by describing something that is not in the room, that is the failure quoted above.`;
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
  state: { characters: Record<string, { name: string; age?: number; core_traits?: string[]; background?: string; speech_pattern?: string; voice?: { never_says?: string[]; diction?: string; example_lines?: string[] } }> },
  presentIds: string[],
): string {
  const rows: string[] = [];
  /* WHO GETS A ROW WHEN THE ROOM IS FULL.
   *
   * This took the first four ids in array order, which is the order the world happens to store
   * presence in — so the fifth person in a busy scene got no register, no sample and no never-says,
   * and the narrator wrote them out of its own defaults. That is the exact failure this block was
   * built to stop, reappearing as soon as a scene has five people in it.
   *
   * The cap stays (this is per-turn context and it is paid for every turn), but it is filled by
   * whoever has something distinguishing on file rather than by whoever was stored first: a
   * character with a recorded register and a line in their own mouth is the one whose absence from
   * this block actually costs a voice. Anyone with a blank card contributes nothing here anyway. */
  const ranked = [...presentIds].sort((a, b) => {
    const has = (id: string) => {
      const c = state.characters[id];
      if (!c) return 0;
      return (String(c.speech_pattern ?? c.voice?.diction ?? "").trim() ? 2 : 0)
        + (c.voice?.example_lines?.some((l) => String(l ?? "").trim()) ? 1 : 0);
    };
    return has(b) - has(a);
  });
  for (const id of ranked.slice(0, 6)) {
    const c = state.characters[id];
    if (!c) continue;
    // THE REGISTER, WHICH THIS BLOCK DID NOT CARRY.
    //
    // A block headed "WHY NONE OF THEM SHOULD SOUND ALIKE" was sending an age, three traits and the
    // first sentence of a background — none of which tells anybody how a person SOUNDS. The fields
    // that do were on the cached card, deliberately, to avoid paying for them twice: deriveVoice's
    // own comment says "diction/syntax/rhythm/never-says live on the (cached) card — don't repeat
    // them per turn". That economy cost the whole voice system.
    //
    // Measured on one save: 91 turns, five characters with superb distinct registers on their cards
    // — a pharmacy tech at 19 with "the counter, the register, closing, the schedule", a designer
    // with kerning and negative space, a teacher with dumplings and innings — and 318 spoken lines
    // between them containing NONE of it. The player's report was that everybody sounds the same
    // and a nineteen-year-old shop worker sounds like a thirty-six-year-old programmer.
    //
    // The example line matters most and is the cheapest: one sentence in a person's actual mouth
    // does more than any description of how they talk.
    const sound = String(c.speech_pattern ?? c.voice?.diction ?? "").trim();
    const sample = c.voice?.example_lines?.find((l) => String(l ?? "").trim());
    const bits = [
      c.age ? `${c.age}` : "",
      c.core_traits?.length ? c.core_traits.slice(0, 3).join("; ") : "",
      c.background?.trim() ? String(c.background).trim().split(/(?<=\.)\s/)[0].slice(0, 120) : "",
    ].filter(Boolean);
    if (!bits.length && !sound && !sample) continue;
    const never = c.voice?.never_says?.length ? ` Would never say: ${c.voice.never_says.slice(0, 2).join("; ")}.` : "";
    const talks = sound ? `\n  TALKS LIKE THIS: ${sound.slice(0, 180)}` : "";
    const line = sample ? `\n  ONE OF THEIR ACTUAL LINES: "${String(sample).trim().slice(0, 150)}"` : "";
    rows.push(`${c.name} — ${bits.join(" · ")}.${never}${talks}${line}`);
  }
  if (!rows.length) return "";
  return `\n[WHO IS TALKING, AND WHY NONE OF THEM SHOULD SOUND ALIKE.
· ${rows.join("\n· ")}
Decide two things per speaker before writing their line. What do they want out of THIS exchange, right now — aim the line at that. And what state are they in: somebody frightened, furious, humiliated, or looking at a thing they have no word for repeats themselves, stops halfway, asks the same question twice, goes quiet, swears, says the wrong thing, or calls for somebody else.
LENGTH COMES FROM THAT, NOT FROM A STYLE. Somebody who has explained this a hundred times explains it again at length; somebody who wants to leave uses six words. If everyone in this scene is brief, they have all been written by the same person, which is you.
If two of these people would produce the same line in this moment, at least one is wrong — go back to what each of them separately wants right now.
AND THE REGISTER IS NOT DECORATION. Where a speaker has a TALKS LIKE THIS, their lines this turn come out of that vocabulary and that rhythm — the words their own life gave them, reached for without thinking, about whatever is actually in front of them. A shop worker counts in shifts and stock; a designer sees a room in margins and alignment; a teacher reaches for the classroom and the kitchen. Somebody written without their register is written as you, and everybody written as you is the same person.
BUT A REGISTER IS WHERE THE WORDS COME FROM, NOT A FILTER EVERY LINE PASSES THROUGH. It says what this person reaches for first and what they have vocabulary for — not that every sentence they produce must be on that subject. A woman whose money-and-materials vocabulary is all she is given still has a body, a day, a view out of the window and three standing interests printed on her card; a settled person reaches for those between the sentences that are business. Run at a hundred percent, money and materials produces a woman who can only say what things cost. How much of it is load-bearing this turn is printed on each speaker's card after right now: — braced means all of it, open means the same vocabulary without the same subject.]`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIGURE IN THE NARRATION — the same failure, one layer out.
 *
 * Everything above only ever runs against quoted speech, and the header says why: "a metaphor in
 * description is a style choice; a metaphor in somebody's mouth is a character being replaced by an
 * oracle." That was right about a metaphor. It is not right about a FRAME, and here is the frame,
 * from the Elm Street save, five consecutive turns, narration only:
 *
 *   T29  "Which friends." She said it flat, like the word had a price on it.
 *   T30  "You have friends outside work." She said it like she was reading a line off a form and
 *        checking a box.
 *   T31  "Sarah." She said it flat, like she was putting it somewhere.
 *   T32  "Both sometimes." She repeated it quietly, like she was checking the weight of it.
 *   T34  "Missed it." She said it like she was testing the word on her tongue.
 *
 * Two things are wrong with it and they compound.
 *
 *   · IT IS A TIC. One turn is a nice line. Five turns running is a machine: the frame never
 *     changes, only the tail does, and the tail is doing all the characterisation the character is
 *     not being given. A reader's report of this reads "no characterization, no personality, no
 *     uniqueness" — correctly, because the personality is in the narrator's similes rather than in
 *     anything she does or wants.
 *   · IT IS AN INTERIOR LEAK WITH ONE WORD IN FRONT OF IT. "like she was checking the weight of it"
 *     is a claim about what she was privately doing, and MOTIVE_LEAK does not catch it because the
 *     sentence is grammatically a comparison. The engine's oldest and most reliable guard is walked
 *     straight past by the word "like".
 *
 * So this fires on RECURRENCE, not on the instance. A simile after a speech verb is ordinary
 * writing; the same construction on three turns out of the last four is the narrator's hand, and
 * the fix is the same one that works everywhere else — the actual sentences, quoted, at the end.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Narration only: everything outside the quotation marks. */
function narration(prose: string): string {
  return String(prose ?? "").replace(/[“"][^“”"]*[”"]/g, " ");
}

/** The two shapes this takes, kept apart so a run is counted against the frame that actually
 *  repeated rather than against "any simile anywhere". */
const FIGURE_FRAMES: { key: string; re: RegExp }[] = [
  // "She said it flat, like the word had a price on it." — the attribution plus a comparison.
  { key: "said-it-like", re: /\b(?:said|says|repeated|repeats|asked|asks|answered|replied|murmured|whispered|added)\b[^.?!\n]{0,60}?\blike\s+(?:a|an|the|she|he|they|it|somebody|someone|you)\b[^.?!\n]{0,80}/i },
  // "Her voice came out low and unhurried, like she was talking most of the way to herself."
  { key: "voice-like", re: /\b(?:voice|words?|tone|the sound)\b[^.?!\n]{0,40}?\b(?:came out|went|was|sounded|dropped)\b[^.?!\n]{0,50}?,\s*like\b[^.?!\n]{0,80}/i },
];

export interface FigureHit { line: string; frame: string; runs: number }

/** Every figure-frame in one turn's narration, by key. */
function figuresIn(prose: string): Map<string, string> {
  const out = new Map<string, string>();
  const bare = narration(prose);
  for (const sentence of bare.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (s.length < 15) continue;
    for (const f of FIGURE_FRAMES) {
      const m = f.re.exec(s);
      if (m && !out.has(f.key)) out.set(f.key, m[0].trim().slice(0, 160));
    }
  }
  return out;
}

/** How many turns running this frame has been used. Three is a hand; two is a coincidence. */
export const FIGURE_RUN = 3;
/** How far back a run may be interrupted and still count — the save's own run skipped turn 33. */
const FIGURE_WINDOW = 5;

/**
 * A narration frame this turn that the last few turns have also used.
 *
 * `previous` is the prose of the preceding turns, oldest first. Returns the worst offender: the
 * frame with the longest run, quoted from THIS turn, so the correction shows the narrator its own
 * most recent sentence rather than an old one it can disown.
 */
export function findFigure(previous: readonly string[], prose: string): FigureHit | null {
  const now = figuresIn(prose);
  if (!now.size) return null;
  const window = previous.slice(-FIGURE_WINDOW).map((p) => figuresIn(p));
  let best: FigureHit | null = null;
  for (const [key, line] of now) {
    const runs = 1 + window.filter((m) => m.has(key)).length;
    if (runs < FIGURE_RUN) continue;
    if (!best || runs > best.runs) best = { line, frame: key, runs };
  }
  return best;
}

export function figureFix(hit: FigureHit | null | undefined): string {
  if (!hit) return "";
  return `\nTHE SAME SENTENCE SHAPE HAS NOW CARRIED ${hit.runs} OF THE LAST FEW TURNS: "${hit.line}" — somebody speaks, and then the narration explains the line with a comparison. `
    + `It is one move, repeated, and it is doing two things it should not. It is a tic, so the writing has a signature the characters do not. And "like she was —" states what a person was privately doing with the word "like" in front of it, which is the one thing the narration may never do; a simile is not a loophole in it. `
    + `THIS TURN NO SPOKEN LINE IS FOLLOWED BY A COMPARISON EXPLAINING IT. What a line meant is carried by what the person does with their hands, their face, where they go, what they pick up, how long they take to answer, or by the next thing they say — or it is not carried at all and the line stands on its own, which is usually right. `
    + `If a sentence in this turn contains "like" after somebody speaks, cut it and put a physical action in its place.`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * NEVER_SAYS, WHICH NOTHING HAS EVER CHECKED.
 *
 * Every character card carries a never_says list. voiceAnchor prints it to the narrator as
 * reference, above, and that is the entire enforcement: a line in the prompt. From the same save —
 *
 *   card:  never_says: ["I don't know", "that's your business"]
 *   T29:   "Now I'm— I don't know. Confused about whether I'm supposed to be flattered or insulted."
 *
 * One hit in two hundred and fifty-five spoken sentences, which is exactly why it is worth
 * catching: never_says entries are short authored phrases, so a substring test on them is close to
 * free of false positives, and the one line that slips through is the line where the character
 * stops being the person on the card. Hers is a woman whose whole register is questions she already
 * knows the answers to, saying she does not know, in the turn a reader reported her as having no
 * characterisation left.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface NeverSaidHit { name: string; said: string; forbidden: string }

function normalise(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A line somebody spoke this turn that their own card forbids them.
 *
 * Attribution is by paragraph (aperture.attributeLines), which is how the narrator actually writes
 * — the subject of the paragraph is the speaker, and a name inside the quotes is who is being
 * spoken to. A phrase shorter than three words is skipped: "no" and "sorry" appear inside ordinary
 * sentences and a card that lists them is asking for a false positive, not for enforcement.
 */
export function findNeverSaid(
  state: { characters: Record<string, { name: string; voice?: { never_says?: string[] } }> },
  presentIds: readonly string[],
  prose: string,
): NeverSaidHit | null {
  const names = Object.values(state.characters ?? {}).map((c) => c?.name).filter(Boolean) as string[];
  const byWho = attributeLines(prose, names);
  for (const id of presentIds) {
    const c = state.characters?.[id];
    const forbidden = (c?.voice?.never_says ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!c || !forbidden.length) continue;
    const first = (c.name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const line of byWho[first] ?? []) {
      const hay = normalise(line);
      for (const f of forbidden) {
        const needle = normalise(f);
        if (needle.split(" ").length < 3) continue;
        if (hay.includes(needle)) return { name: c.name, said: line.slice(0, 180), forbidden: f };
      }
    }
  }
  return null;
}

export function neverSaidFix(hit: NeverSaidHit | null | undefined): string {
  if (!hit) return "";
  // The two quoted spans are kept in separate sentences on purpose: a run of prose BETWEEN two
  // quotation marks inside one instruction is a ready-made line, which is the thing tests/prompt-echo.ts
  // exists to ratchet down.
  return `\n${hit.name.toUpperCase()} SAID A LINE THEIR OWN CARD LISTS UNDER NEVER SAYS. It was: "${hit.said}".\nTheir card's entry: ${hit.forbidden}. `
    + `That list is not a style preference. It is the short definition of who this person is: the thing they will not admit, will not concede, will not hand over. The line came out because the scene wanted somebody to be uncertain there, and ${hit.name} was the mouth that was open. `
    + `THIS TURN ${hit.name.toUpperCase()} DOES NOT SAY IT OR ANY VERSION OF IT. Whatever pressure produced it is still real and still has to land somewhere — it goes into the body, into a refusal, into changing the subject, into an answer that is not the one asked for, into leaving the room. `
    + `A person who cannot say that does something else instead, and what they do instead is the character.`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * NARRATING THE CONVERSATION INSTEAD OF HAVING IT.
 *
 * A player, after nine turns of a dinner date, in his own words and then to the character's face:
 * "Is Emily a human being or a narrator? Does Emily narrate or relate? Is she human? No." And in
 * the scene: "Do you usually narrate the other person? It's kinda weird." / "Most people relate.
 * They don't narrate. You narrate."
 *
 * He was right, and here is what she was actually saying, turns 41–44:
 *
 *   "I'm asking you a question, that's just — that's called talking, Max."
 *   "I asked you about the gym. I asked you if you were joking about the sex thing. Those are
 *    questions, Max, that's it, that's the whole —"
 *   "you've spent the last five minutes telling me what I'm doing wrong while I sit here eating
 *    bread"
 *   "You just told me I narrate you and judge you in the same breath. And then you did it. You
 *    said, and then you do exactly what I told you — that's narrating. That's literally the thing."
 *   "That's it. That's the line you're leaving on."
 *
 * Every one of those is a sentence ABOUT the exchange: what was asked, what was said, what the
 * other person is doing by saying it, what kind of thing this is. Nobody is talking about the gym,
 * or the bread, or the six dollars, or the boiler she runs at work. It is a transcript with
 * opinions, and it is the most reliable thing a model produces when it has been given a scene and
 * no person to put in it.
 *
 * MEASURED ON THAT SAVE, turn by turn, spoken sentences that are about the exchange itself:
 *   T30–T40   0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0     — of which both are ordinary callbacks
 *                                                    ("You said your body tells you when to go.")
 *   T41–T44   4 of 8, 5 of 13, 4 of 11, 2 of 4
 *
 * So it fires on a RUN of turns above a rate, never on a single line: real people do sometimes say
 * "that is not what I asked", and an argument about what somebody meant is a legitimate scene. What
 * is not a scene is two people in a restaurant discussing the structure of their conversation while
 * the food gets cold.
 *
 * AND THE CAUSE IS USUALLY UPSTREAM. In that save this character's card — eleven years in
 * commercial laundry, sodium percarbonate, a torn labrum, five example lines in her own mouth —
 * was never sent to the narrator at all, because she was `central: false` (see the promotion loop
 * in turn.ts). With nothing to write her out of, the model wrote her out of its defaults, and this
 * is what the default is. The fix for that is in turn.ts and prompts.ts; this catches the residue.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** A spoken sentence whose subject is the exchange: what was said, asked, meant, or what the other
 *  person is doing by saying it. */
const META_TALK = new RegExp([
  // "that's called talking" / "that's narrating" / "that's literally the thing" / "that's the whole thing"
  String.raw`\bthat'?s (?:not )?(?:called |literally |just |me |you )?(?:talking|narrating|judging|a question|questions|the whole thing|the thing|it)\b`,
  // reciting the transcript: "I asked you about the gym", "I told you", "I laughed at"
  String.raw`\bi (?:asked|said|told|answered|laughed at)\s+you\b`,
  // handing it back: "you just told me", "you said, and then you"
  String.raw`\byou (?:just )?(?:said|told me|asked me|called me|are saying|were saying)\b`,
  // scoring the scene: "you've spent the last five minutes"
  String.raw`\byou'?ve spent the last\b`,
  String.raw`\bthose are questions\b`,
  String.raw`\bthat'?s the (?:line|whole)\b`,
  String.raw`\bin (?:the same|one) breath\b`,
].join("|"), "i");

/** How much of a turn must be about the talking before the turn counts. Measured: the failing turns
 *  ran 36–50%, the ordinary ones 0–14%, with nothing in between. */
export const META_RATE = 0.25;
/** …and at least this many, so a short exchange of two lines cannot trip it on one remark. */
const META_MIN = 3;
/** Turns running before it is a habit rather than an argument. */
export const META_RUN = 2;

export interface MetaTalkHit { name: string; lines: string[]; runs: number }

/** The exchange-about-the-exchange sentences one speaker produced in one turn. */
function metaLinesFor(prose: string, names: string[], first: string): { hits: string[]; total: number } {
  const said = attributeLines(prose, names)[first] ?? [];
  const sentences = said.flatMap((l) => l.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean));
  return { hits: sentences.filter((x) => META_TALK.test(x)), total: sentences.length };
}

function metaTurn(prose: string, names: string[], first: string): string[] | null {
  const { hits, total } = metaLinesFor(prose, names, first);
  if (hits.length < META_MIN || !total) return null;
  return hits.length / total >= META_RATE ? hits : null;
}

/**
 * A present character who has spent this turn and the last one describing the conversation.
 *
 * `previous` is the prose of the preceding turns, oldest first — the same shape findFigure takes.
 */
export function findMetaTalk(
  state: { characters: Record<string, { name: string }> },
  presentIds: readonly string[],
  previous: readonly string[],
  prose: string,
): MetaTalkHit | null {
  const names = Object.values(state.characters ?? {}).map((c) => c?.name).filter(Boolean) as string[];
  for (const id of presentIds) {
    const c = state.characters?.[id];
    const first = (c?.name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!c || first.length < 3) continue;
    const now = metaTurn(prose, names, first);
    if (!now) continue;
    let runs = 1;
    for (let i = previous.length - 1; i >= 0 && runs < META_RUN + 3; i--) {
      if (!metaTurn(previous[i], names, first)) break;
      runs++;
    }
    if (runs >= META_RUN) return { name: c.name, lines: now.slice(0, 3), runs };
  }
  return null;
}

export function metaTalkFix(hit: MetaTalkHit | null | undefined): string {
  if (!hit) return "";
  return `\nFOR ${hit.runs} TURNS ${hit.name.toUpperCase()} HAS BEEN DESCRIBING THE CONVERSATION INSTEAD OF HAVING IT: ${hit.lines.map((l) => `"${l}"`).join(" ")} `
    + `Those are sentences about the exchange — what was asked, what was said, what the other person is doing by saying it, what kind of thing this is. `
    + `Nobody in that room is talking about anything that is in it. A person mid-argument does not recite the transcript back; they say the thing they actually want, or the thing they are actually angry about, or they stop talking. `
    // No specimen sentences here on purpose: a forbidden line pasted into the directive is a line
    // the model has been supplied with. See tests/prompt-echo.ts.
    + `THIS TURN ${hit.name.toUpperCase()} SAYS NOTHING ABOUT THE CONVERSATION — no correction of what was or was not asked, no quoting the other person back to themselves, no summary of the last five minutes, no naming what the other person is doing by saying it. `
    + `What they say instead comes from their own life and their own vocabulary — the work they do, the money on the table, the food, what they came here for, what they are going to do next — or they say very little and their body does the rest. `
    + `If the player is arguing about how the conversation is going, that is an argument nobody in the world has an opinion about: ${hit.name} answers the substance, refuses it in one flat sentence, or leaves. They do not take up the argument about the argument.`;
}
