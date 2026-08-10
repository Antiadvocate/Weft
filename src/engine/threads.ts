/** THREADS THAT NOBODY IS THINKING ABOUT ANY MORE.
 *
 *  One save reached turn 108 with fourteen threads: twelve still active, NONE ever resolved, nine
 *  sitting at exactly the tension they were created with. The oldest had been open since turn 1.
 *  Two were duplicates of a situation a later thread had superseded ("The first cramp" and "The
 *  cramp that outgrew the log"); three were the same Marcus/David deception split three ways; and
 *  one, still marked active, had a description reading "The old flinch is gone; she moves toward
 *  him without hesitation" — a thread whose own text says it is over.
 *
 *  Two causes, and the first is embarrassing. The JSON template the bookkeeper copies read
 *
 *      "threads_update":[{ ..., "status":"active", ..., "tension":3 }]
 *
 *  with those values as literals. A model filling in a template copies what it is shown, so every
 *  thread came back active at tension 3 — which is the histogram exactly. And the contract, in both
 *  its full and lean forms, explained when to OPEN a thread and never once mentioned closing one.
 *
 *  That half is fixed in the contract. This is the other half: the engine never checked either.
 *  Asking a model to remember to tidy up is how the list got to fourteen; a story where the pressure
 *  system chooses what to press from a pile of things that stopped mattering forty turns ago is one
 *  where the pressure is arbitrary, which is what it felt like.
 *
 *  Nothing is deleted. A dormant thread is out of the pressure pool and out of the digest, and any
 *  mention wakes it — because a buried box nobody has dug up in ninety turns is not gone, it is just
 *  not what the story is about this afternoon. */
import type { SaveState, Thread } from "./types";

/** Turns without a mention before a thread stops counting as live. Generous on purpose: stories here
 *  run a few days across a hundred-odd turns, and a situation can reasonably sit for a night. */
export const DORMANT_AFTER = 25;
/** Below this, a thread has cooled past the point of pressing on anybody. */
const COLD = 1;

/** Did this thread's subject show up in the prose? Matched on the distinctive words of its title and
 *  description, so "the dug corner" wakes on "the corner she had dug". */
function mentioned(t: Thread, prose: string): boolean {
  const stop = new Set(["that", "this", "with", "from", "known", "first", "then", "they", "them", "there", "into", "about", "still", "over", "what", "when", "have", "been", "would", "could", "than", "some", "made", "made"]);
  const words = [...new Set((`${t.title} ${t.description}`.toLowerCase().match(/[a-z]{4,}/g) ?? []))]
    .filter((w) => !stop.has(w))
    .slice(0, 12);
  if (!words.length) return false;
  const hay = prose.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  // a couple of incidental word matches is not the story returning to a subject
  return hits >= Math.max(2, Math.ceil(words.length * 0.34));
}

/** Run once per turn, after the diff has been applied and the prose is known.
 *
 *  Returns lines for the world-motion feed. A thread going quiet is worth one line — it is the
 *  engine saying "this stopped being what the story is about", which the player may disagree with,
 *  and disagreeing is as easy as mentioning it again. */
export function sweepThreads(state: SaveState, prose: string): string[] {
  const turn = state.world.current_turn;
  const log: string[] = [];

  for (const t of state.world.threads ?? []) {
    if (t.status === "resolved" || t.status === "abandoned") continue;

    // Touch first: anything the prose is actually about is live, including a dormant one waking.
    if (mentioned(t, prose)) {
      t.last_touched_turn = turn;
      if (t.status === "dormant") {
        t.status = "active";
        log.push(`Back in play: ${t.title}.`);
      }
      continue;
    }
    // A SAFE MIGRATION, NOT A GUESS. A thread carried over from before this field existed has no
    // touch on record. Reconstructing one from the prose does not work — a thread's identity does
    // not survive its wording, and trying it retired ten of twelve threads on a real save,
    // including the one the pressure system had cited two turns earlier. Anything else would be
    // inventing evidence. So the clock starts now: nothing is retired by the first sweep that ever
    // runs, and from here the bookkeeper's own threads_update is what marks a thread live.
    if (t.last_touched_turn === undefined) { t.last_touched_turn = turn; continue; }
    if (t.status !== "active") continue;

    const idle = turn - t.last_touched_turn;
    if (idle >= DORMANT_AFTER || (t.tension ?? 0) <= COLD) {
      t.status = "dormant";
      log.push(`Nobody has thought about it in a while: ${t.title}.`);
    }
  }
  return log;
}

/** The threads the rest of the engine should treat as live: what pressure may press on, and what the
 *  digest spends tokens describing. */
export function liveThreads(state: SaveState): Thread[] {
  return (state.world.threads ?? []).filter((t) => t.status === "active");
}
