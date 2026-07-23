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

  const ground = list.filter((h) => !h.dormant && noveltyStage(h) === "ground").map((h) => h.trait);
  const familiar = list.filter((h) => !h.dormant && noveltyStage(h) === "familiar").map((h) => h.trait);
  if (!ground.length && !familiar.length) return "";

  const parts: string[] = [];
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
