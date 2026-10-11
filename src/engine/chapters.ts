/**
 * THE CHAPTERS IN THE CHRONICLE ARE ALSO WHAT THE NARRATOR READS.
 *
 * Every chapter summary is printed into the narrator's context as STORY SO FAR, the last six of them,
 * every turn. So a chapter that recaps a storyline the player is finished with keeps putting it in
 * front of the narrator for as long as it's one of the last six, and there was no way to change one:
 * the Chronicle only displayed them.
 *
 * They can be edited now, title and summary, and deleted. A deleted chapter is kept as an empty
 * marker rather than removed, because the next chapter is written from where the last one ended,
 * and taking the marker away would have the chapter writer summarise those turns all over again.
 */
import type { Chapter, SaveState } from "./types";

/** The chapters that still say something: what the narrator and the Chronicle show. */
export function liveChapters(state: { chapters?: Chapter[] }): Chapter[] {
  return (state.chapters ?? []).filter((c) => !(c as Chapter & { deleted?: boolean }).deleted);
}

export function editChapter(state: SaveState, idx: number, patch: { title?: string; summary?: string }): Chapter | null {
  const c = (state.chapters ?? []).find((x) => x.idx === idx);
  if (!c || (c as any).deleted) return null;
  if (typeof patch.title === "string" && patch.title.trim()) c.title = patch.title.trim().slice(0, 80);
  if (typeof patch.summary === "string") c.summary = patch.summary.trim().slice(0, 1200);
  return c;
}

/** Empty it and mark it, keeping the turn range so it isn't written again. */
export function deleteChapter(state: SaveState, idx: number): Chapter | null {
  const c = (state.chapters ?? []).find((x) => x.idx === idx);
  if (!c) return null;
  c.title = "";
  c.summary = "";
  delete (c as any).drift;
  delete (c as any).persona;
  (c as any).deleted = true;
  return c;
}
