/**
 * THE LINE BETWEEN THE STORY AND WHAT THE MODELS ARE STILL READING.
 *
 * `state.history` is two things at once: the transcript the player scrolls, and the recent-story
 * context nearly every pass slices a tail off. That is fine until a save gets long, at which point
 * the only lever for cutting the context was the Refresh Game button — which truncates history to
 * the last beat, and takes the readable story with it, and runs a memory-condensation call per
 * character on the way.
 *
 * A boundary is the non-destructive half of that. `world.context_from_turn` marks where the models'
 * view begins; everything before it stays on the page, in the export, and in the chapter record, and
 * simply stops being fed forward. Nothing is deleted, so moving the line back restores it.
 *
 * The rule for using this: a pass that answers "what has just been happening" reads through here. A
 * pass that answers "what happened in this story" reads `state.history` directly — the Chronicle,
 * the export, the illustration lookup, anything addressing a specific turn the player can still see.
 */
import type { SaveState, TurnHistoryEntry } from "./types";

/** The turns the models may still see. Identical to `state.history` until a line has been drawn. */
export function contextHistory(state: SaveState): TurnHistoryEntry[] {
  const from = state.world?.context_from_turn ?? 0;
  const all = state.history ?? [];
  if (!from) return all;
  return all.filter((h) => (h.turn ?? 0) >= from);
}

/** How many turns are on the far side of the line — 0 when there is no line. */
export function clearedTurnCount(state: SaveState): number {
  return (state.history?.length ?? 0) - contextHistory(state).length;
}
