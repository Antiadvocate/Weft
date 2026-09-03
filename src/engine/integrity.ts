/**
 * INTEGRITY — the aggregate nobody was keeping.
 *
 * WHAT SIX SAVES OF ONE WORLD LOOK LIKE FROM ABOVE. 208 turns. A love story became a municipal
 * procedural, then a nine-turn argument about a plate of eggs, then a stalking thriller, then a
 * scene in which two women crossed two thousand miles in fifty-five minutes and the ledger swapped
 * which of them was in the room. Fifteen separate defects, every one of them real and most of them
 * now fixed one at a time.
 *
 * And in all 208 turns, across five chapter audits, the component whose entire job is to say "this
 * is no longer the story that was asked for" returned `on_contract: true` every single time.
 * `contract_drift` is null in all six saves. It has never once fired.
 *
 * THAT is why fixing the defects one at a time does not hold, and why a player who has done exactly
 * that on a previous game arrives back at the same nightmare on the next one. There is no closed
 * loop. Each detector in this engine — echo, maxims, leak, ooc, retold, anatomy, kinship, reprint —
 * catches its own failure, emits one correction into the next turn's prompt, and forgets. Nothing
 * counts them. Nothing asks whether six of them fired this week. So a story can come apart steadily,
 * with the engine noticing every individual crack and no part of it noticing the wall.
 *
 * The auditor cannot supply that, for a reason worth writing down: it reads the BOOKKEEPER'S SCENE
 * SUMMARIES. Those are the laundered record — the place where "Mara confronted Rabi ... telling him
 * that Emily had spent the night at her sister Priya's because the kid was sick" is stored as a
 * plain account of what happened. Fed that, an auditor sees a coherent domestic drama and certifies
 * it, correctly, on the evidence it was given. It is checking the story against the contract while
 * reading a transcript that the failures already rewrote.
 *
 * So the aggregate is kept here instead, deterministically, from the detectors that fire on the raw
 * output before anything launders it, plus the engine's own bookkeeping refusals — which are the
 * strongest signal in the system, because they are the moments the engine caught itself.
 *
 * This costs nothing and decides nothing. It counts, and when the rate crosses a line it tells the
 * PLAYER, because the player is the only party in this loop who can actually call it — reload, redirect,
 * rewrite a want, or stop. Every prior fix in this file's neighbourhood tries to make the engine
 * behave; this one exists to make sure the player finds out when it has not.
 */
import type { SaveState } from "./types";

/** One caught failure. `kind` groups them; `detail` is for the player, not for a model. */
export interface IntegrityFire {
  turn: number;
  kind: string;
  detail: string;
}

/** How the kinds read in a sentence to somebody who has not read this source file. */
const LABEL: Record<string, string> = {
  anatomy: "a body written against the record",
  kin: "a family invented for somebody",
  reprint: "a turn that reprinted the one before it",
  line: "a line of dialogue used twice",
  leak: "someone's private interior stated outright",
  echo: "the player's own words handed back to them",
  maxim: "dialogue that named nothing in the room",
  composed: "a line of dialogue that was composed rather than said",
  register: "one speaker's whole turn in a single narrow register",
  apparatus: "the machine named inside the fiction",
  retold: "a scene restaged rather than continued",
  arrival: "somebody placed where they could not have got to",
  phantom: "somebody moved into the scene the prose never showed arriving",
  swap: "the cast list disagreeing with the prose",
};

/** Turns the rolling window looks back over. */
const WINDOW = 8;
/** Distinct failures inside the window before the player is told. */
const ALARM = 3;
/** Turns of quiet before it will speak again, so a rough patch is reported once. */
const COOLDOWN = 10;

/** Record a caught failure. Cheap, append-only, trimmed. */
export function noteFire(state: SaveState, kind: string, detail: string): void {
  const turn = state.world?.current_turn ?? 0;
  const log = (state.integrity ??= { fires: [] });
  log.fires.push({ turn, kind, detail: String(detail ?? "").slice(0, 160) });
  if (log.fires.length > 60) log.fires = log.fires.slice(-60);
}

/**
 * Is the story coming apart, and has the player been told recently?
 *
 * Distinct KINDS, not raw count: the same detector firing three turns running is one problem being
 * corrected, which is the system working. Three different ones inside eight turns is the record and
 * the prose drifting apart faster than the corrections can close them.
 */
export function integrityAlarm(state: SaveState): string | null {
  const log = state.integrity;
  if (!log?.fires.length) return null;
  const turn = state.world?.current_turn ?? 0;
  const recent = log.fires.filter((f) => turn - f.turn < WINDOW);
  const kinds = [...new Set(recent.map((f) => f.kind))];
  if (kinds.length < ALARM) return null;
  if (log.said_turn !== undefined && turn - log.said_turn < COOLDOWN) return null;
  log.said_turn = turn;
  const named = kinds.map((k) => LABEL[k] ?? k);
  return `CONTINUITY: ${kinds.length} different kinds of contradiction caught in the last ${WINDOW} turns — ${named.join("; ")}. `
    + `Each one has been corrected for the next turn, but this many at once usually means the record and the prose have come apart, `
    + `and corrections work turn to turn rather than backwards. If the story stopped making sense a few turns ago, that is where it happened, `
    + `and rolling back to before it is cheaper than playing forward through it.`;
}

/** Everything caught, newest first — for the Chronicle and the inspector. */
export function integrityLog(state: SaveState, limit = 20): IntegrityFire[] {
  return [...(state.integrity?.fires ?? [])].reverse().slice(0, limit);
}
