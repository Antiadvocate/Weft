/**
 * NOVELTY — a trait's intensity persists; its NOVELTY decays.
 *
 * The engine already models how automatic a behavior is (habits.ts: strength,
 * firing, seen/unseen). What it did not model is how much narrative ATTENTION a
 * behavior still deserves. Those are different axes, and conflating them is why
 * a character who "loves basketball" delivers the same enthusiastic discovery on
 * the tenth court visit as on the first.
 *
 * How people actually work: the first expression is an event — it's about the
 * thing. Repetition turns it into ground. You still love basketball on the
 * hundredth game; you just don't announce it. You talk about your day while
 * playing. The trait moved from FIGURE to GROUND, and what surfaces instead is
 * whatever the trait now lets you do (a shared court, an easy silence, a place
 * to have a hard conversation).
 *
 * So: count expressions, derive a stage, and hand the narrator the stage as a
 * behavioral instruction — never the number. Same discipline as habits.ts: the
 * narrator receives a verdict, not a mechanic it could perform.
 */
import type { SaveState, CoreHabit } from "./types";

/** Where a trait sits on the figure→ground curve. */
export type NoveltyStage = "fresh" | "familiar" | "ground";

/** Expression counts at which a trait crosses into the next stage. */
const FAMILIAR_AT = 2;   // after the 2nd expression it stops being a discovery
const GROUND_AT = 5;     // by the 5th it is simply how this person lives

/**
 * Fraction of a trait's distinctive words that must appear in the prose for it to
 * count as expressed.
 *
 * NOTE: this deliberately does NOT use relevance() from memory.ts. That is cosine
 * similarity, which is right for ranking memories against each other but wrong
 * here: it normalizes by document length, so an unmistakable expression inside a
 * normal paragraph scores ~0.19 and gets weaker the longer the prose runs. What
 * we want is containment — did this trait's actual subject matter show up — which
 * is length-independent.
 */
const EXPRESSION_COVERAGE = 1;

const STOP = new Set([
  "loves", "love", "likes", "like", "hates", "hate", "enjoys", "enjoy", "wants", "want",
  "to", "the", "a", "an", "and", "or", "of", "in", "on", "at", "for", "with", "is", "are",
  "was", "were", "be", "being", "very", "always", "often", "when", "his", "her", "their",
  "they", "she", "he", "it", "about", "good", "really", "quite", "too", "playing", "play",
]);

/** The words in a trait that actually identify its subject ("basketball", "pens", "hums"). */
function distinctiveWords(trait: string): string[] {
  return trait.toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * FALLBACK ONLY — string containment, used when the simulator did not report for
 * this character (a failed or thin bookkeeping turn).
 *
 * This cannot see meaning. "Loves ice cream" will not match gelato, sorbet, or an
 * affogato; "loves basketball" will not match "shooting hoops"; "hums when
 * nervous" will not match "that tuneless sound he makes". Prose expresses a trait
 * through its SUBJECT, and a trait's own words usually never appear.
 *
 * That is why `recordExpressions` prefers the simulator's semantic judgment and
 * only falls back to this. When it does fall back, a miss means the trait stays
 * fresh a while longer — the safe failure direction (an over-narrated habit) as
 * opposed to a trait silently grounding when it never appeared.
 *
 * Two notes on the implementation:
 *  - NOT relevance() from memory.ts: that is cosine similarity, which normalizes
 *    by document length, so a plain expression inside a paragraph scores ~0.19 and
 *    gets WEAKER the longer the prose runs.
 *  - Strongest single match, not average coverage: a trait is a phrase but prose
 *    expresses it through one word ("he pocketed another pen" for "collects other
 *    people's pens" averages to 0.25 and would be missed).
 */
export function expressionCoverage(trait: string, prose: string): number {
  const words = distinctiveWords(trait);
  if (!words.length) return 0;
  const hay = ` ${prose.toLowerCase().replace(/[^a-z0-9\s']/g, " ")} `;
  for (const w of words) {
    if (w.length < 4) continue;
    const stem = w.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, "");
    if (stem.length < 3) continue;
    if (new RegExp(`\\b${stem}`, "i").test(hay)) return 1;
  }
  return 0;
}

/** Loose match between a reported trait string and a stored one — the simulator
 *  is asked for verbatim but will sometimes paraphrase or re-case. */
function sameTrait(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  if (A === B || A.includes(B) || B.includes(A)) return true;
  // tolerate collapsed spacing ("icecream" for "ice cream") — models do this
  const squash = (x: string) => x.replace(/\s+/g, "");
  const sa = squash(A), sb = squash(B);
  if (sa === sb || sa.includes(sb) || sb.includes(sa)) return true;
  const aw = new Set(distinctiveWords(A));
  const bw = new Set(distinctiveWords(B));
  if (!aw.size || !bw.size) return false;
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  return inter / Math.min(aw.size, bw.size) >= 0.6;
}

/* ── MANNERISMS ────────────────────────────────────────────────────────────────
 *
 * A trait can be a SUBJECT (loves basketball, cannot let a half-told story go) or a MANNER (a laugh
 * that starts as a sharp "Ha!", straightens a picture frame without noticing). The forge produces
 * both by design — the card spec's "PHYSICAL SIGNATURE" category asks for the second in as many
 * words, and the could-you-film-it test rewards it — and until now nothing downstream told them
 * apart. Both mishandled the manner kind, in opposite directions:
 *
 *   · habits.ts could never FIRE one. Opportunity is lexical relevance against the beat, and a laugh
 *     has no subject to appear in the player's typed action, so a mannerism sat at forge strength
 *     for the whole game with last_fired_turn -1: never fired, therefore never seen, therefore never
 *     weakened. The recognition mechanic could not reach the traits that most needed it.
 *
 *   · novelty.ts DID see them (it measures the prose, not the beat) and correctly called them
 *     ground — then handed over the wrong remedy. "Do not write a scene ABOUT these; write a scene
 *     that HAPPENS during them" is right for basketball and a no-op for a tic: the model reads it as
 *     keep doing the laugh, just stop commenting on it, which is exactly what a laugh in every one of
 *     twenty turns looks like. Grounding a subject reduces COMMENTARY. Grounding a manner has to
 *     reduce FREQUENCY, and nothing was reducing frequency.
 *
 * From the save that found this: one character's two mannerisms at expressions 8 and 9 over twenty
 * turns, strength frozen at 92 and 97, seen_fires 0. Every scene had the laugh and the straightening
 * in it, uncommented, as texture, because the card asserts them and nothing ever said enough. */

/** Words that mean a trait is about HOW a body moves rather than WHAT a person cares about. */
const MANNER = new RegExp([
  // the body itself
  "laugh|laughter|giggl|smil|grin|smirk|frown|wince|blink|nod|shrug|squint",
  "eyes?|eyebrows?|hands?|fingers?|thumbs?|knuckles?|jaw|shoulders?|chin|throat|posture|breath",
  // what it does to objects and to itself
  "straighten|re-?fold|folds?|adjusts?|smooth(?:s|es|ing)?|align(?:s|ed|ing)?|taps?|drums?|fidget",
  "twirl|picks? at|rubs?|chews?|bites?|hums?|whistl|wipes?|turns? it over|grip",
  // the framing a mannerism is written in
  "has a laugh|has a way of|without (?:realizing|realising|noticing)|under (?:his|her|their) breath",
].join("|"), "i");

/** Is this trait a manner rather than a subject? */
export function isMannerism(trait: string): boolean {
  return MANNER.test(String(trait ?? ""));
}

/** Turns that must pass before a mannerism is worth putting on the page again.
 *
 *  Not a ban: a tic the reader has never seen is characterisation, and the third time is still
 *  recognition. It is the ninth time in twenty turns that is wallpaper. The gap widens as the thing
 *  becomes known, which is the same figure→ground curve the subject traits ride, expressed in the
 *  axis a mannerism actually has. */
export function mannerismGap(h: CoreHabit): number {
  const n = h.expressions ?? 0;
  if (n < FAMILIAR_AT) return 0;   // still new — let it land
  if (n < GROUND_AT) return 3;
  return 6;
}

/** Has this mannerism been on the page too recently to be worth it again? */
export function mannerismSuppressed(h: CoreHabit, turn: number): boolean {
  if (h.dormant || !isMannerism(h.trait)) return false;
  const gap = mannerismGap(h);
  if (gap <= 0) return false;
  const last = h.last_expressed_turn;
  return typeof last === "number" && turn - last < gap;
}

/** The mannerisms of one character that this turn should leave alone. */
export function suppressedMannerisms(state: SaveState, id: string): string[] {
  const turn = state.world.current_turn;
  return (state.habits?.[id] ?? []).filter((h) => mannerismSuppressed(h, turn)).map((h) => h.trait);
}

export function noveltyStage(h: CoreHabit): NoveltyStage {
  const n = h.expressions ?? 0;
  if (n < FAMILIAR_AT) return "fresh";
  if (n < GROUND_AT) return "familiar";
  return "ground";
}

/**
 * Count expressions from a committed turn. Called after the prose exists, so it
 * measures what the scene actually did — not what the engine predicted.
 *
 * Only counts once per trait per turn: a scene that mentions basketball six times
 * is still one expression of the trait.
 */
export function recordExpressions(
  state: SaveState, id: string, proseText: string, turn: number,
  reported?: string[],
): void {
  const list = state.habits?.[id];
  if (!list?.length) return;
  const haveReport = Array.isArray(reported);
  for (const h of list) {
    if (h.dormant) continue;
    if (h.last_expressed_turn === turn) continue;
    // The simulator READ the prose and knows a gelato expresses "loves ice cream".
    // Trust it when it reported; only fall back to string matching when it didn't,
    // since that fallback is blind to synonym, category, and paraphrase.
    const fired = haveReport
      ? reported!.some((r) => sameTrait(r, h.trait))
      : (!!proseText && expressionCoverage(h.trait, proseText) >= EXPRESSION_COVERAGE);
    if (!fired) continue;
    h.expressions = (h.expressions ?? 0) + 1;
    h.last_expressed_turn = turn;
  }
}

/**
 * The narrator-facing line for one character's grounded traits.
 *
 * Returns behavioral guidance, never counts or stage names — the narrator must
 * not be able to map this onto a mechanic and start performing "the ground
 * stage". It reads as ordinary direction about how a person carries a long
 * habit, because that is what it is.
 */
export function noveltyNote(state: SaveState, id: string): string {
  const list = state.habits?.[id];
  if (!list?.length) return "";
  const c = state.characters[id];
  if (!c) return "";

  const turn = state.world.current_turn;
  // Mannerisms are handled on their own axis (frequency, below) and must NOT go into the grounding
  // paragraphs — those tell the narrator to keep doing the thing without commenting on it, which for
  // a tic is the instruction that produced the problem.
  const subject = (h: CoreHabit) => !h.dormant && !isMannerism(h.trait);
  const ground = list.filter((h) => subject(h) && noveltyStage(h) === "ground").map((h) => h.trait);
  const familiar = list.filter((h) => subject(h) && noveltyStage(h) === "familiar").map((h) => h.trait);
  const resting = list.filter((h) => mannerismSuppressed(h, turn)).map((h) => h.trait);
  if (!ground.length && !familiar.length && !resting.length) return "";

  const parts: string[] = [];
  if (resting.length)
    parts.push(
      `${c.name} has already shown these on the page recently, and they are established: ${resting.join("; ")}. ` +
      `DO NOT render any of them this turn — not as a beat, not as a gesture under a line of dialogue, not as ` +
      `a half-sentence of business while someone else talks. A physical signature is characterisation the first ` +
      `time and wallpaper by the ninth; the reader has it. ${c.name} is in this scene doing something else with ` +
      `their hands and their face, and what that something is comes from what they want right now.`,
    );
  if (ground.length)
    parts.push(
      `${c.name} has lived these a long time: ${ground.join("; ")}. ` +
      `They are the floor, not the subject. ${c.name} does them the way people do old things — ` +
      `without commentary, without selling them, without discovering them again. ` +
      `Do NOT write a scene ABOUT these; write a scene that HAPPENS during them: the talk over the activity ` +
      `is about something else entirely (the day, a worry, another person), and the habit is just where they are while it happens. ` +
      `If someone else is new to it, their reaction can be fresh — ${c.name}'s is not.`,
    );
  if (familiar.length)
    parts.push(
      `Less worn but no longer new for ${c.name}: ${familiar.join("; ")}. ` +
      `Some ease has set in — competence and comfort rather than enthusiasm. Half the airtime it got the first time.`,
    );
  return parts.join(" ");
}

/** Every present character's novelty guidance, assembled for the narrator prompt. */
export function noveltyDigest(state: SaveState): string {
  const lines = (state.world.present ?? [])
    .map((id) => noveltyNote(state, id))
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "";
}
