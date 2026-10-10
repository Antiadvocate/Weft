/**
 * TRACKED QUESTIONS — the player's own variables, kept current by the story.
 *
 * Everything Weft tracks is something the engine decided to track: wants, clocks, bonds, debts.
 * A player often cares about one specific thing the engine has no field for — whether the bridge is
 * still standing, how much Mara owes the Hall, whether anyone has noticed the missing ledger — and
 * the only way to keep it in front of the narrator was to keep typing it.
 *
 * Talemate (an open-source roleplay engine) calls these state reinforcements: a question the player
 * pins, re-asked every few turns, its answer written back into the scene's context. Here the
 * question is answered from the record — recent turns, this turn's prose, the last answer — on a
 * small cheap call that runs ALONGSIDE the bookkeeper, the way the reviser does, so it costs no wait.
 * The answer is shown in the Journal and handed to the narrator as how things stand.
 *
 * The answer is held to the record: when the record doesn't settle it, the answer says so. A
 * tracked question is a lens on the state, never a way to author it.
 */
import type { SaveState } from "./types";
import { complete, isCancel, safeJson } from "../llm";
import { clipText } from "./text";
import { uid } from "./state";

export interface TrackedQuestion { id: string; question: string; every: number; created_turn: number; answer?: string; answered_turn?: number }

export const MAX_TRACKED = 6;

export const TRACKED_SYSTEM = `You keep running answers to questions a player is tracking about their own story. You're given each question with its last answer, the last few turns in summary, and what was just written this turn. For each question, write the answer as it stands now, in one or two plain sentences in the present tense. Build it only from what you were given: what the turns and the scene say happened, and the last answer where nothing since has changed it. When what you were given doesn't settle the question, say what it does show and say plainly that the rest isn't known yet. Don't fill a gap with what would usually happen, and don't add events.

Return only JSON: {"answers":[{"id":"","answer":""}]}`;

/** Add a question. Returns null when there are already MAX_TRACKED, or it is blank. */
export function addTracked(state: SaveState, question: string, every = 3): TrackedQuestion | null {
  const q = String(question ?? "").trim();
  const list = (state.world.tracked ??= []);
  if (!q || list.length >= MAX_TRACKED) return null;
  const t: TrackedQuestion = { id: uid("trk"), question: clipText(q, 200), every: Math.max(1, Math.min(20, Math.round(every) || 3)), created_turn: state.world.current_turn };
  list.push(t);
  return t;
}

export function removeTracked(state: SaveState, id: string): boolean {
  const list = state.world.tracked ?? [];
  const n = list.length;
  state.world.tracked = list.filter((t) => t.id !== id);
  return state.world.tracked.length < n;
}

/** Questions that are due this turn: never answered, or answered `every` turns ago or more. */
export function dueTracked(state: SaveState, turn: number): TrackedQuestion[] {
  return (state.world.tracked ?? []).filter((t) => t.answered_turn === undefined || turn - t.answered_turn >= t.every);
}

/** What the answering call reads. Built before the bookkeeper changes anything, from this turn's prose. */
export function trackedContext(state: SaveState, questions: TrackedQuestion[], prose: string): string {
  const recent = (state.history ?? []).filter((h) => h.summary).slice(-8)
    .map((h) => `turn ${h.turn} (${h.time_label ?? ""}): ${clipText(h.summary, 240)}`);
  const here = state.world.places[state.world.player_location]?.name;
  const present = (state.world.present ?? []).map((id) => state.characters[id]?.name).filter(Boolean);
  return [
    `NOW: turn ${state.world.current_turn}, ${state.world.current_time}${here ? `, at ${here}` : ""}${present.length ? `, with ${present.join(", ")}` : ""}.`,
    recent.length ? `THE LAST FEW TURNS:\n${recent.join("\n")}` : "",
    prose.trim() ? `THIS TURN, AS WRITTEN:\n${clipText(prose, 3000)}` : "",
    `QUESTIONS:\n${questions.map((t) => `[${t.id}] ${t.question}${t.answer ? `\n  last answer (turn ${t.answered_turn}): ${t.answer}` : "\n  not answered before"}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

/** Ask. Pure with respect to state: returns the answers, and `applyTracked` writes them at the commit. */
export async function askTracked(
  state: SaveState, prose: string, opts: { model: string; fallback: string; signal?: AbortSignal; turn?: number; force?: boolean },
): Promise<{ id: string; answer: string }[]> {
  const due = opts.force ? (state.world.tracked ?? []) : dueTracked(state, opts.turn ?? state.world.current_turn);
  if (!due.length) return [];
  try {
    const out = await complete(
      [{ role: "system", content: TRACKED_SYSTEM }, { role: "user", content: trackedContext(state, due, prose) }],
      opts.model, opts.fallback, true, Math.min(1200, 120 + due.length * 120),
      { providerSort: "throughput", omitReasoning: true, signal: opts.signal },
    );
    const j = safeJson<any>(out.text, null);
    const ids = new Set(due.map((t) => t.id));
    return (Array.isArray(j?.answers) ? j.answers : [])
      .filter((a: any) => ids.has(String(a?.id)) && typeof a?.answer === "string" && a.answer.trim())
      .map((a: any) => ({ id: String(a.id), answer: clipText(a.answer.trim(), 400) }));
  } catch (e) {
    if (isCancel(e)) throw e;
    console.warn(`[tracked] no answers this turn: ${e}`);
    return [];
  }
}

export function applyTracked(state: SaveState, answers: { id: string; answer: string }[], turn: number): number {
  let n = 0;
  for (const a of answers) {
    const t = (state.world.tracked ?? []).find((x) => x.id === a.id);
    if (!t) continue;
    t.answer = a.answer;
    t.answered_turn = turn;
    n++;
  }
  return n;
}

/** The narrator's block: the player's questions and where they stand. Empty when there are none. */
export function trackedBlock(state: SaveState): string {
  const done = (state.world.tracked ?? []).filter((t) => t.answer);
  if (!done.length) return "";
  return `=== WHAT THE PLAYER IS KEEPING TRACK OF (how each stands as of the turn shown; this is the state of things, so write consistently with it) ===\n${done.map((t) => `• ${t.question} — ${t.answer} (turn ${t.answered_turn})`).join("\n")}\n\n`;
}
