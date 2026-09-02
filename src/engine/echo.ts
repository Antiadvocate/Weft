/**
 * ECHO — a character handing the player's own line back to them.
 *
 * Two moves, one failure. A character asks the player to say it again, or a character repeats what
 * the player just said back at them. Both spend a turn producing nothing: the player already knows
 * what they typed, and a scene that answers a line by reflecting it has not answered it.
 *
 * WHY THIS IS CODE AND NOT A RULE IN THE PROMPT. There was a rule. It listed the four wordings the
 * failure had been played in — "say it again", "say that again", "tell me again", "I want to hear
 * you say it" — and that list is four ready-made lines sitting in the context, which is the failure
 * tests/prompt-echo.ts exists to catch: a vivid phrase attached to a prohibition is still a phrase
 * the model has been handed. Removing the list was right and the rule got weaker, because the
 * general statement ("the player's line is spent") does not fire on the specific move the way a
 * quoted example does.
 *
 * So the specimen goes where specimens belong: in a detector that reads the OUTPUT. Nothing is
 * pasted into the prompt in advance. When the narrator does it, the next turn is told what it wrote
 * and what to write instead — which is how engine/maxims.ts already works, and it is the only place
 * a banned line can be quoted safely, because by then the model has already written it.
 */
import type { SaveState } from "./types";
import { clipText } from "./text";
/**
 * Quoted speech, with NO minimum length. maxims.ts has its own spokenLines with a length floor,
 * because a two-word line cannot be an aphorism — but it can very easily be "Again." So this reads
 * every quoted run, however short.
 */
function quotedLines(prose: string): string[] {
  return [...String(prose ?? "").matchAll(/["\u201C\u201D]([^"\u201C\u201D\n]{1,400})["\u201C\u201D]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** "Say it again" and its family — a demand that the player repeat what they just typed. */
const REPEAT_DEMAND = [
  /\bsay (?:it|that|those words|the words) again\b/i,
  /\b(?:tell|say) (?:it to )?me again\b/i,
  /\bi want to hear you say (?:it|that)\b/i,
  /\bsay (?:it|that) (?:one more time|once more|louder|to my face)\b/i,
  /\brepeat (?:it|that|yourself)\b/i,
  /\bagain\b[.?!]?$/i,
];

/** Words too common to count as evidence that a line was copied. */
const STOP = new Set(
  ("a an and are as at be been but by can did do for from had has have he her him his i if in is it its me my no not of on or our she so than that the their them then there these they this to too us was we were what when which who will with would you your".split(" ")),
);

/** Content words, lowercased, in order. */
function contentWords(s: string): string[] {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** The longest run of the player's content words reproduced, in order, inside one spoken line. */
export function longestEchoRun(playerLine: string, spoken: string): number {
  const a = contentWords(playerLine), b = contentWords(spoken);
  if (!a.length || !b.length) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagPrev = 0;
    for (let j = 1; j <= b.length; j++) {
      const cur = a[i - 1] === b[j - 1] ? diagPrev + 1 : 0;
      diagPrev = prev[j];
      prev[j] = cur;
      if (cur > best) best = cur;
    }
  }
  return best;
}

/** Three content words in a row is a quotation, not a coincidence.
 *
 *  This was four, and four is one too many. Content words are what survives STOP, so a line built
 *  mostly of small words reduces further than it looks: "Thanks for sharing about your day", handed
 *  back verbatim to a player who had just typed it, reduces to thanks/sharing/day — a run of three,
 *  under the floor, undetected. The lines that read most hollow when parroted are exactly the
 *  courteous ones, and courtesy is made of stopwords. A false positive here costs one advisory line
 *  in the next prompt; a false negative costs the turn. */
const RUN_FLOOR = 3;

/** Normalized for a literal-quotation test: case, punctuation and spacing folded away, words kept
 *  — stopwords included, because in a verbatim lift the stopwords are part of the evidence. */
function flatten(s: string): string {
  return ` ${String(s ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** A spoken line that appears INSIDE the player's own line, word for word.
 *
 *  The content-run test measures how much distinctive vocabulary two lines share, which is the right
 *  question for a paraphrase and the wrong one for a lift. A lift needs no distinctive vocabulary at
 *  all: it is the player's sentence, returned. So this asks the simpler question directly — is what
 *  the character said a contiguous span of what the player just said — and it does not care how many
 *  of the words were small ones. Floored at five words so an ordinary "come here" or "I know" is not
 *  a quotation of anybody. */
const VERBATIM_WORD_FLOOR = 5;

export function verbatimParrot(playerLine: string, spoken: string): boolean {
  const said = flatten(playerLine), line = flatten(spoken);
  if (line.trim().split(" ").filter(Boolean).length < VERBATIM_WORD_FLOOR) return false;
  return said.includes(line.trim());
}

export interface EchoHit { line: string; kind: "demand" | "parrot" }

/**
 * What the narrator did with the player's words this turn.
 *
 * Only SPOKEN lines are read. Narration that restates the player's action is a different failure
 * with its own rule, and policing it here would flag every legitimate description of what happened.
 */
export function findEcho(prose: string, playerSaid: string): EchoHit | null {
  for (const line of quotedLines(prose)) {
    if (REPEAT_DEMAND.some((re) => re.test(line))) return { line: clipText(line, 220), kind: "demand" };
  }
  const said = String(playerSaid ?? "").trim();
  if (!said) return null;
  // a literal span of the player's own sentence, whatever it is made of
  for (const line of quotedLines(prose)) {
    if (verbatimParrot(said, line)) return { line: clipText(line, 220), kind: "parrot" };
  }
  if (contentWords(said).length < RUN_FLOOR) return null;   // nothing long enough to be copied
  for (const line of quotedLines(prose)) {
    if (longestEchoRun(said, line) >= RUN_FLOOR) return { line: clipText(line, 220), kind: "parrot" };
  }
  return null;
}

/**
 * The correction, quoting what was actually written. Handed to the next turn, never before.
 */
export function echoFix(hit: EchoHit | null | undefined): string {
  if (!hit?.line) return "";
  const shared = `\nWHAT TO DO WITH A LINE THE PLAYER HAS ALREADY SAID: nothing. It has been said, everyone in the room heard it, and it does not come back. Whether it landed is shown by what the listener DOES next — closes the distance, sits down, goes quiet, hands something over, answers a different question, leaves. A character who genuinely did not catch it acts on the half they did catch and gets it slightly wrong, which is what actually happens when somebody mishears.`;
  if (hit.kind === "demand") {
    return `\nLAST TURN A CHARACTER ASKED THE PLAYER TO SAY IT AGAIN: "${hit.line}"
The player typed a line, it reached the person it was aimed at, and instead of the world answering it the world handed it back and asked for it louder. Do not write this again in any wording, and not as a tease, a tenderness, a test, or a way to raise the temperature.${shared}`;
  }
  return `\nLAST TURN A CHARACTER REPEATED THE PLAYER'S OWN WORDS BACK AT THEM: "${hit.line}"
The player already knows what they said. A line that returns their words to them — quoted, turned over, weighed, or reframed more kindly — is a line in which nothing happened.${shared}`;
}

/**
 * MODEL SCAFFOLDING THAT IS NOT THE STORY.
 *
 * Reasoning models emit their working, and some emit it inside the answer: a <thinking> block, a
 * "Let me consider…" preamble, a markdown header announcing the scene, a trailing note about what
 * the writer was going for. The opening scene is generated by one call with no turn loop around it,
 * so nothing had ever cleaned it and the player was deleting the model's notes by hand before they
 * could start playing.
 *
 * Deliberately conservative: it removes only wrappers that are unambiguously scaffolding, and it
 * never touches the prose itself. If stripping would leave nothing, the original is returned —
 * showing the player a preamble is better than showing them an empty scene.
 */
export function stripScaffolding(raw: string): string {
  let t = String(raw ?? "");
  // tagged reasoning blocks, closed or left open
  t = t.replace(/<(thinking|thought|think|reasoning|scratchpad)>[\s\S]*?<\/\1>/gi, "");
  t = t.replace(/<(thinking|thought|think|reasoning|scratchpad)>[\s\S]*$/i, "");
  // a fenced block whose language tag says it is working, not prose
  t = t.replace(/```(?:thinking|thought|reasoning|scratchpad)[\s\S]*?```/gi, "");
  // markdown headers announcing the piece ("## The Opening Scene", "**Opening:**")
  t = t.replace(/^\s{0,3}#{1,6}\s.*$/gm, "");
  t = t.replace(/^\s*\*\*(?:opening|opening scene|scene|turn \d+)[^*\n]{0,40}\*\*:?\s*$/gim, "");
  // a leading paragraph that talks about the writing rather than being it
  t = t.replace(/^\s*(?:okay|alright|let me|i'll|i will|here(?:'s| is))\b[^\n]{0,200}\n+/i, "");
  // and a trailing note about choices made
  t = t.replace(/\n+\s*(?:\(|\[)?(?:note|n\.b\.|i (?:kept|tried|aimed|left)|this (?:opening|scene) (?:sets|establishes|leaves))\b[\s\S]{0,400}$/i, "");
  const out = t.replace(/\n{3,}/g, "\n\n").trim();
  return out.length >= 40 ? out : String(raw ?? "").trim();
}

/**
 * THE WORD "PLAYER" ON THE PAGE.
 *
 * From a save, turn 46, mid-paragraph:
 *
 *     The trembling Vin's player couldn't see was not trembling — her fingers were still...
 *
 * Vin is the point-of-view character. "Vin's player" is the person holding the keyboard, and for one
 * sentence the prose addressed the machinery instead of the story. Nothing caught it, and it sits in
 * the save as canon.
 *
 * This is not a lapse the narrator can be talked out of. Its own instructions say "the player"
 * several hundred times — the point-of-view law, the sovereignty block, the channel note — so the
 * phrase is the single most common noun in its context window, and a model reaching for a way to say
 * "the person whose view this is" has it right there. A rule against writing it would add one more
 * instance of the phrase to the same context.
 *
 * So it is repaired on the output. Deliberately narrow: a world can contain a piano player, a card
 * player, a player in a company of players, and none of those are this. Only the two forms that can
 * only ever be the machinery are touched — the meta-possessive ("Vin's player"), and a BARE "the
 * player" with no qualifier in front of it, which is a phrase prose has no other use for.
 */
const QUALIFIED_PLAYER = /\b(piano|card|chess|lute|horn|fiddle|flute|dice|ball|team|other|fellow|travelling|traveling|strolling|stage|company|game|instrument|record|music|tape|cd|dvd)\s+players?\b/i;

export function stripMetaPlayer(prose: string, playerName: string): { prose: string; fixed: number } {
  const name = String(playerName ?? "").trim();
  let fixed = 0;
  let out = String(prose ?? "");
  if (name) {
    // "Vin's player" — the possessive can only be the machinery
    const poss = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}'s\\s+player\\b`, "gi");
    out = out.replace(poss, () => { fixed++; return name; });
  }
  // a BARE "the player" — leave every qualified player alone
  out = out.replace(/\bthe\s+players?\b/gi, (m, offset: number, whole: string) => {
    const window = whole.slice(Math.max(0, offset - 24), offset + m.length);
    if (QUALIFIED_PLAYER.test(window)) return m;
    fixed++;
    return name || "they";
  });
  return { prose: out, fixed };
}

/* ── THE NARRATOR ECHOING ITSELF ────────────────────────────────────────────────────────────────
 *
 * Everything above is about a character handing the player's own line back. There is a louder
 * version of the same failure and nothing was watching for it: the narrator handing back its own
 * previous turn.
 *
 * Turn 10 of one save is turn 9 with the first sentence deleted and the apostrophes curled. Same
 * four paragraphs, same seven lines of dialogue, same closing beat — 1489 characters against 1539,
 * otherwise identical. What the player had typed to earn it was "I'm just very confused about what's
 * happening right now", so the answer to "what is happening" was the previous page, again. The
 * turn's own spent_subjects re-spent the same words (fourteen, deadline, questions, blanche) and
 * nothing flagged it, because every detector in the engine reads this turn's prose against the
 * player's line, the world state, or a phrase list — never against what the narrator itself wrote
 * last time. FINAL CHECK item 12 covers it ("no scene replayed in new words"), and item 12 is a
 * self-check: the model that just reprinted a page is not the thing that will notice.
 *
 * So it goes where the other specimens go — a detector on the output, quoting the model back to
 * itself on the following turn.
 */

/** Distinctive-word overlap between two passages, as a fraction of the shorter one. Stopwords are
 *  dropped: two turns in one room share their furniture, and it is the content that gives a reprint
 *  away. */
export function proseOverlap(a: string, b: string): number {
  const wa = new Set(contentWords(a)), wb = new Set(contentWords(b));
  if (wa.size < 20 || wb.size < 20) return 0;      // too short to judge; a held beat is allowed to rhyme
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

/** Above this, the turn is a reprint rather than a continuation. Set high on purpose: a scene that
 *  stays in one room with two people genuinely repeats a lot of nouns, and the cost of a false
 *  positive is one advisory paragraph in the next prompt. The observed reprint scores ~0.97; ordinary
 *  consecutive turns of the same conversation measured 0.3–0.5. */
const REPRINT_FLOOR = 0.8;

/** The longest run of words this turn reproduces verbatim from last turn — the unambiguous half of
 *  the evidence, and what gets quoted back. */
export function longestSharedSpan(prev: string, now: string): string {
  const a = flatten(prev).trim().split(" ").filter(Boolean);
  const b = flatten(now).trim().split(" ").filter(Boolean);
  if (!a.length || !b.length) return "";
  let bestLen = 0, bestEnd = 0;
  let prev_ = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev_[j - 1] + 1;
        if (cur[j] > bestLen) { bestLen = cur[j]; bestEnd = j; }
      }
    }
    prev_ = cur;
  }
  return bestLen >= 8 ? b.slice(bestEnd - bestLen, bestEnd).join(" ") : "";
}

/** Did this turn reprint the last one? Returns the shared span to quote back, or null. */
export function findReprint(prevProse: string, prose: string): { span: string; overlap: number } | null {
  const prev = String(prevProse ?? "").trim(), now = String(prose ?? "").trim();
  if (!prev || !now) return null;
  const overlap = proseOverlap(prev, now);
  if (overlap < REPRINT_FLOOR) return null;
  const span = longestSharedSpan(prev, now);
  if (!span) return null;
  return { span: span.slice(0, 180), overlap: +overlap.toFixed(2) };
}

/** The correction, handed to the following turn. */
export function reprintFix(hit: { span: string; overlap: number } | null | undefined): string {
  if (!hit?.span) return "";
  return `\nLAST TURN REPRINTED THE TURN BEFORE IT. ${Math.round(hit.overlap * 100)}% of its distinctive words were the previous turn's, including this run word for word: "${hit.span}…"
That is not a scene. Whatever the player typed, the world had already moved past that page and did not move back. THIS TURN STARTS FROM WHERE THE LAST ONE ENDED and goes somewhere the story has not been: the bodies are in different positions than they were, or somebody has said the thing they had not said, or the act is further along, or someone has arrived, moved, or stopped. Do not re-establish what is already established, do not restage the same gesture in new words, and do not re-run a line of dialogue in a new wording. If the player's input was a question about what is happening, ANSWER IT INSIDE THE FICTION — state plainly, in the prose, where everyone is and what is being done to whom right now — and then move.`;
}
