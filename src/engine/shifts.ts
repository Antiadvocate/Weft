/**
 * WHAT THE PLAYER IS TOLD BETWEEN TURNS — and what the engine was telling them instead.
 *
 * A player, after seventy-four turns: "this nonsense of 'her wants have been skipped 9 turns' and
 * all these warnings mean nothing to me. You have random toasts about warnings instead of actual
 * stuff and it's pointless. Because they're literally every turn."
 *
 * Counted on that save's own history: 119 shift lines across 52 turns, of which 34 are distinct.
 *
 *     31x  Emily Brenner will remember that.
 *     11x  Emily Brenner relaxed a little.
 *     10x  Emily Brenner has been settled long enough that it has become where Emily rests.
 *     38x  Emily Brenner's standing want ... skipped 2/3/4/5/6 turns running   ← across five variants
 *
 * A THIRD OF EVERY NOTIFICATION THE PLAYER EVER RECEIVED was one internal counter. And it is not
 * even a rising sequence: "skipped 2 turns running" appears seven separate times, because the
 * counter resets at MISS_CEILING and climbs again. The player was watching a sawtooth in a
 * subsystem, reported as news.
 *
 * TWO POPULATIONS, ONE CHANNEL. The 130-odd `shifts.push` sites in this engine are writing two
 * completely different kinds of sentence into the same array:
 *
 *   things that happened in the story        "Ada is dead." "Thread resolved: the ledger."
 *                                            "Mara warmed toward you." "Ravi now knows your name."
 *   things that happened in the engine       "[cast] blocked Ada being moved back into the scene"
 *                                            "bookkeeping correction: Ravi stays"
 *                                            "the ledger held the line: Mara doesn't change"
 *                                            "X's standing want has now been skipped 4 turns running"
 *
 * Six of them literally carry a console-log prefix — [cast], [drift], [places], [weft], [ownership],
 * [templates] — which is the tell that they were written for whoever was debugging that subsystem
 * and were never meant to reach a toast. They reach a toast.
 *
 * AND REPETITION EMPTIES EVEN THE GOOD ONES. "Emily will remember that" fired on thirty-one turns.
 * Memory formation is continuous, so a notification every time it happens carries no information;
 * it is a progress bar for a process that never stops. The line is well written and correct and
 * should be rare, and the way to make it rare is not to rewrite it.
 *
 * SO: classify at the boundary, not at the 130 call sites. Everything still gets pushed, everything
 * is still available to whoever is debugging, and one function decides what a person sees. That
 * keeps the fix in one place and means a new push site cannot reintroduce the problem by forgetting
 * a convention.
 */

/** Engine-internal lines. Real, useful, and addressed to whoever is working on the engine — which
 *  on any given evening is nobody. These go to the console and stay out of the story feed.
 *
 *  Matching is on the SHAPE of the sentence rather than a list of exact strings, for the same
 *  reason engine/templates.ts exists: a list of exact strings describes the sentences that have
 *  already been written. */
const DIAGNOSTIC = [
  // the console-log prefixes, which say plainly who the line was written for
  /^\s*\[(?:cast|drift|places|weft|templates|ownership|memory|reviser|vs|llm|turn)\]/i,
  // the bookkeeper being corrected, which is the engine arguing with itself
  /^\s*bookkeeping correction\b/i,
  /^\s*bookkeeping is recording again\b/i,
  /\bthe ledger held the line\b/i,
  /\bthe record disagrees with what the story has been saying\b/i,
  /\bis flagged as out of date\b/i,
  /\baccumulated history was condensed\b/i,
  /\bre-?scored\b.*\bbeauty\b/i,
  // THE ONE THAT PROMPTED ALL THIS. A want the narrator did not stage is an instruction the engine
  // will repeat; the count is how it decides when to stop. staleWants already announces the part
  // that is actually news — that it has given up — and that one stays.
  /\bstanding want (?:did not reach the page|has now been skipped)\b/i,
  /\bwant\(s\) name their owner\b/i,
  // a subsystem reporting that it declined to do something
  /^\s*(?:refused|blocked|skipped)\b/i,
  /\bfailed this turn\b/i,
];

export function isDiagnostic(line: string): boolean {
  const s = String(line ?? "");
  return DIAGNOSTIC.some((re) => re.test(s));
}

/**
 * The signature two lines share when they are the same news.
 *
 * Numbers come out, because "skipped 4 turns running" and "skipped 5 turns running" are one message
 * being sent repeatedly rather than two pieces of news — and that is true of every counter, not
 * just the one that prompted this. Names stay in: "Mara warmed toward you" and "Ravi warmed toward
 * you" are genuinely two different things happening.
 */
export function signature(line: string): string {
  return String(line ?? "")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * HOW LONG A PIECE OF NEWS STAYS OLD.
 *
 * Chosen against the save, not picked: at a six-turn window the 119 lines that save actually showed
 * come down to 34, which is one every other turn and close to the count of distinct things that
 * genuinely happened. Shorter windows leave "will remember that" firing a dozen times; much longer
 * ones start hiding a bond that really is moving turn after turn.
 */
export const REPEAT_WINDOW = 6;

/** Lines that are always worth saying, however recently something like them was said. These are the
 *  irreversible ones — a death, an ending, a thread closing, a permanent mark. They are rare by
 *  nature, so this list is a guarantee rather than an exemption anybody will notice. */
const ALWAYS = [
  /\bis dead\b/i,
  /\bwill never forget\b/i,
  /\bthe ending\b/i,
  /^\s*CANON:/,
  /\bthread resolved\b/i,
  /\bnever existed\b/i,
  /\bis permanently marked\b/i,
  /\bhas run out\b/i,
  /\bphase change\b/i,
  /\bthe world itself has changed\b/i,
];
export function isAlways(line: string): boolean {
  return ALWAYS.some((re) => re.test(String(line ?? "")));
}

export interface Sifted {
  /** What the player sees, in the order it was pushed. */
  shown: string[];
  /** Everything held back, so nothing is lost and the Inspector can still show the full record. */
  held: string[];
}

/**
 * Sift one turn's shifts against what the recent turns already said.
 *
 * `recent` is the shifts of the preceding turns, any order — the caller passes the last
 * REPEAT_WINDOW turns of history. Nothing is deleted: `held` carries everything suppressed, and the
 * caller decides where that goes (the console, the Inspector, the stored history).
 */
export function sift(lines: readonly string[], recent: readonly string[] = []): Sifted {
  const seen = new Set(recent.map(signature));
  const shown: string[] = [];
  const held: string[] = [];
  for (const line of lines) {
    const text = String(line ?? "").trim();
    if (!text) continue;
    if (isDiagnostic(text)) { held.push(text); continue; }
    const sig = signature(text);
    if (!isAlways(text) && seen.has(sig)) { held.push(text); continue; }
    seen.add(sig);          // …and within this turn too: one push site can fire twice on one turn
    shown.push(text);
  }
  return { shown, held };
}
