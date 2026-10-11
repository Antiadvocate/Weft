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

/** Turns without a touch before a thread stops counting as live.
 *
 *  It was 12, which is shorter than the world can possibly come back round. The beat selector picks
 *  ONE source a turn out of everything standing, and at six live threads plus a palette line and a
 *  clock, any given thread is chosen about once in forty turns. So eleven turns after a thread was
 *  the subject of the scene it went dormant, dormant threads were unpickable, and the pool drained
 *  to whichever one had been chosen most recently — which then went dormant too. The window has to
 *  be longer than the rotation it is measuring, or it is not a dormancy rule, it is a countdown. */
export const DORMANT_AFTER = 25;
/** Live threads the pressure system may choose from. Past this, the oldest untouched ones go quiet
 *  regardless of the clock: a story is about a handful of things at once, and a list of twelve is
 *  not a world with twelve live situations in it, it is a list. */
export const MAX_LIVE = 6;
/** Below this, a thread has cooled past the point of pressing on anybody. */
const COLD = 1;

/** Did this thread's subject show up in the prose? Matched on the distinctive words of its title and
 *  description, so "the dug corner" wakes on "the corner she had dug". */
export function mentioned(t: Thread, prose: string): boolean {
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
export function sweepThreads(state: SaveState, prose: string, beatThreadId?: string): string[] {
  const turn = state.world.current_turn;
  const log: string[] = [];
  // Taken BEFORE anything is demoted. A thread must actually spend time dormant — where a single
  // mention brings it back — before it can be let go. Without this snapshot a long-idle active
  // thread would pass through dormant and out the other side inside one sweep, and the player would
  // never get the turn where it was set aside and could still be picked up.
  const wasDormant = new Set((state.world.threads ?? []).filter((t) => t.status === "dormant").map((t) => t.id));

  for (const t of state.world.threads ?? []) {
    if (t.status === "resolved" || t.status === "abandoned") continue;

    // THE ENGINE ALREADY KNOWS WHAT THIS TURN WAS ABOUT — IT CHOSE IT.
    //
    // Everything below this is `mentioned`, which reads the prose and guesses. That guess was the
    // only way a thread could stay alive, and it is wrong most of the time by construction: it
    // wants a third of a thread's distinctive words back verbatim, and a scene that IS the thread
    // rarely repeats its wording. Three scenes written straight at their own thread — the shut door
    // at the end of the hall, the phone screen going dark too fast, the envelope nobody opens —
    // score zero between them.
    //
    // So the thread the beat selector NAMED as this turn's subject is touched because the engine
    // assigned it, not because a word count agreed afterwards. That is the one signal in the loop
    // that is a fact rather than an inference, and it was the one thing not being used. Without it
    // a thread was picked as the subject of the scene and demoted for inactivity on the same turn.
    if (beatThreadId && t.id === beatThreadId) {
      t.last_touched_turn = turn;
      delete t.last_cooled_turn;
      if (t.status === "dormant") { t.status = "active"; log.push(`Back in play: ${t.title}.`); }
      continue;
    }

    // Touch first: anything the prose is actually about is live, including a dormant one waking.
    if (mentioned(t, prose)) {
      t.last_touched_turn = turn;
      delete t.last_cooled_turn;
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
      log.push(`Nobody has thought about this in a while: ${t.title}.`);
    }
  }

  // AND DORMANT IS NOT A RESTING PLACE — BUT LETTING GO IS SOMETHING THAT HAPPENS TO A THREAD, NOT
  // SOMETHING A TIMER DOES TO IT.
  //
  // This used to abandon anything untouched for four dormancy windows, full stop. With the world
  // picking one source a turn out of eight or nine, a thread waits about forty turns between visits
  // and a hundred is ordinary variance — so a situation still sitting at tension 8, that the engine
  // would have been happy to press on any turn it came up, was quietly retired for having lost a
  // few coin flips. Abandonment is final; nothing was ever the story's fault.
  //
  // So a thread nobody comes back to COOLS, a point per dormancy window, and is let go when it
  // reaches nothing. A situation genuinely nobody is thinking about does fade like that, which is
  // the fiction as well as the bookkeeping — and a hot one simply waits, still on the list, still
  // pickable, for however long it takes the world to come round to it. Nothing is deleted either
  // way: the text stays in the Chronicle.
  for (const t of state.world.threads ?? []) {
    if (t.status !== "dormant" || !wasDormant.has(t.id)) continue;
    const idle = turn - (t.last_touched_turn ?? t.turn_started ?? turn);
    const sinceCooled = turn - (t.last_cooled_turn ?? t.last_touched_turn ?? t.turn_started ?? turn);
    // Slowly: two dormancy windows a point, so a situation the world has not come back to in a
    // hundred and fifty turns is the one that fades, not one that lost a few coin flips.
    if (sinceCooled >= DORMANT_AFTER * 2 && (t.tension ?? 0) > 0) {
      t.tension = Math.max(0, (t.tension ?? 0) - 1);
      t.last_cooled_turn = turn;
    }
    if ((t.tension ?? 0) <= 0 && idle >= DORMANT_AFTER * 2) {
      t.status = "abandoned";
      t.turn_resolved = turn;
      log.push(`Let go: ${t.title}.`);
    }
  }
  // TOO MANY LIVE THREADS IS THE SAME FAILURE AS NEVER CLOSING ONE. Even with a cooldown, a save
  // reached twelve active threads at once — "lots of threads, nothing has happened" — because each
  // was touched just often enough to stay alive while none was ever the thing the story was about.
  // The pressure controller picks ONE source per beat, so twelve live threads is not twelve times
  // the pressure, it is one twelfth the chance of returning to any of them.
  const live = (state.world.threads ?? []).filter((t) => t.status === "active");
  if (live.length > MAX_LIVE) {
    live.sort((a, b) => (b.last_touched_turn ?? b.turn_started ?? 0) - (a.last_touched_turn ?? a.turn_started ?? 0)
      || (b.tension ?? 0) - (a.tension ?? 0));
    for (const t of live.slice(MAX_LIVE)) {
      t.status = "dormant";
      log.push(`Set aside for now: ${t.title}.`);
    }
  }
  return log;
}

/** The threads the rest of the engine should treat as live: what pressure may press on, and what the
 *  digest spends tokens describing. */
export function liveThreads(state: SaveState): Thread[] {
  return (state.world.threads ?? []).filter((t) => t.status === "active");
}

/* ── DELETING A THREAD, AND KEEPING IT DELETED ─────────────────────────────────────────────────
 *
 * Retiring a thread marks it resolved and leaves it in the record, and that was the only way out.
 * A player who wanted one gone, not finished, found it reopened under a reworded title: the
 * bookkeeper matches threads by title, a deleted one has no title left to match, and a new "The
 * Beacon load review" is just a new thread. Story sifting reopens a pattern the moment its key is
 * free. So a deleted thread leaves a tombstone, its title and its sifted key, and nothing opens a
 * thread that matches one. */

/** Words in a title that say what it's about, for comparing a new title with a deleted one. */
function titleWords(t: string): Set<string> {
  return new Set((String(t ?? "").toLowerCase().match(/[a-z0-9']{4,}/g) ?? []).filter((w) => !["with", "from", "that", "this", "about", "their", "they", "them", "what", "into", "over"].includes(w)));
}

/** Whether a thread with this title (or sifted key) was deleted by the player. */
export function isDeletedThread(state: SaveState, title: string, sifted?: string): boolean {
  const dead = (state.world as any).deleted_threads as { title: string; sifted?: string }[] | undefined;
  if (!dead?.length) return false;
  if (sifted && dead.some((d) => d.sifted === sifted)) return true;
  const mine = titleWords(title);
  if (!mine.size) return false;
  return dead.some((d) => {
    if (String(d.title).trim().toLowerCase() === String(title).trim().toLowerCase()) return true;
    const theirs = titleWords(d.title);
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    return shared >= Math.max(2, Math.ceil(Math.min(mine.size, theirs.size) * 0.6));
  });
}

/** Remove a thread for good, leaving the tombstone. Returns the thread removed, or null. */
export function deleteThread(state: SaveState, id: string): Thread | null {
  const list = state.world.threads ?? [];
  const t = list.find((x) => x.id === id);
  if (!t) return null;
  state.world.threads = list.filter((x) => x.id !== id);
  const dead = ((state.world as any).deleted_threads ??= []) as { title: string; sifted?: string; turn: number }[];
  dead.push({ title: t.title, sifted: (t as any).sifted, turn: state.world.current_turn });
  if (dead.length > 60) dead.splice(0, dead.length - 60);
  // a beat aimed at it, or the pressure system's memory of it, would point at nothing
  if (state.pressure_state?.recent) state.pressure_state.recent = state.pressure_state.recent.filter((r) => r.ref !== t.title);
  // The ending's own thread is rebuilt from the destination every turn, so deleting it means the
  // player is done with the destination.
  if (t.id === "thread_fate" && state.world_bible) state.world_bible.destination = "";
  return t;
}

/** Edit any part of a thread the player can see. Unknown fields are ignored. */
export function editThread(state: SaveState, id: string, patch: { title?: string; description?: string; tension?: number; status?: string }): Thread | null {
  const t = (state.world.threads ?? []).find((x) => x.id === id);
  if (!t) return null;
  if (typeof patch.title === "string" && patch.title.trim()) t.title = patch.title.trim().slice(0, 160);
  if (typeof patch.description === "string") t.description = patch.description.trim().slice(0, 600);
  if (typeof patch.tension === "number" && Number.isFinite(patch.tension)) t.tension = Math.max(0, Math.min(10, Math.round(patch.tension)));
  if (patch.status && ["active", "dormant", "resolved", "abandoned"].includes(patch.status)) {
    t.status = patch.status as Thread["status"];
    if (patch.status === "resolved" || patch.status === "abandoned") { t.turn_resolved = state.world.current_turn; t.tension = Math.min(t.tension ?? 0, patch.tension ?? 0); }
    else delete (t as any).turn_resolved;
  }
  t.last_touched_turn = state.world.current_turn;
  return t;
}
