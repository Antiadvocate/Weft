/**
 * THE CONTAINER AND ITS CONTENTS — a place is not neutral to the person walking into it.
 *
 * Every system in this engine moves a body from the inside: the simulator's delta for what was said
 * to them, co-regulation from who is standing there, grief drag from what they lost, the aperture
 * from how open they are. The room itself was furniture. A character could walk into the kitchen
 * where the worst conversation of their life happened and arrive at exactly the relaxation they left
 * the street with, because nothing in the engine connected a place to a nervous system.
 *
 * The data for it was already there and dense. Measured on the Ashford save at turn 29: of Amber's
 * thirty episodic memories, EIGHTEEN carry a `where` — the place name is filed with the memory and
 * decays out of it as the memory fades, which is exactly the right behaviour and was being used for
 * nothing but display. Four of those eighteen are in one house.
 *
 * So: what a place holds for somebody is what happened to them in it, and walking in gets some of
 * it. Not as a mood the narrator is told to write — as a shove on the one number, before anybody
 * says anything, which is how it actually works. You are already braced by the time you notice the
 * hallway.
 *
 * ── WHAT MAKES IT SAFE ────────────────────────────────────────────────────────────────────────
 *
 * The failure mode here is a haunted world: every room somebody was ever unhappy in becomes a
 * pressure system, and the cast walks around getting shoved by architecture. Five things prevent it.
 *
 *  1. IT FIRES ON ARRIVAL ONLY. Standing in a room does not re-administer it every turn. A place
 *     you are already in is the place you are in.
 *  2. IT NEEDS MORE THAN ONE MEMORY, or one that actually mattered. A single ordinary afternoon
 *     somewhere is not a charge; the bar is a weighted mass, not a hit.
 *  3. IT IS SMALL. Clamped to ±1.2 — about a fifth of what a bad conversation does. This is the
 *     prickle walking in, not the event. The scene that follows is what carries weight.
 *  4. IT HABITUATES. The charge is divided by how often this person has been here lately: the room
 *     you enter every day stops doing this, which is why home is not a trigger and the place you
 *     have avoided for thirty turns is. This is the single most important term in the file — without
 *     it, a character living in a charged house gets shoved every time they walk through their own
 *     front door forever.
 *  5. IT IS THEIRS. Computed from each person's own memory bank. The same room is charged for one
 *     of two people standing in it and inert for the other, which is the whole point.
 *
 * Zero tokens: all of it is arithmetic over memory the engine already keeps.
 */
import type { SaveState, EpisodicMemory } from "./types";

/** The most a room may move a body on the way in. A fifth of what being shouted at does. */
export const MAX_CHARGE = 1.2;
/** Weighted mass a place must hold before walking in does anything at all. */
const CHARGE_FLOOR = 0.55;
/** Visits inside the habituation window after which a place stops announcing itself. */
const HABITUATE_AT = 3;
/** How far back visits are counted for habituation. */
const HABITUATE_WINDOW = 25;
/** Memories older than this contribute at a reduced weight — the room forgets with you. */
const FADE_AFTER = 60;

/** Charge words, and the sign each carries. Read off `emotional_charge`, which the bookkeeper fills
 *  with a plain feeling word, and off the memory's own text when the field is empty (offstage
 *  memories arrive with it blank). Deliberately short: an unmatched memory contributes nothing
 *  rather than being guessed at. */
const DARK = /\b(fear|afraid|terror|dread|grief|griev|sorrow|loss|lost|shame|humiliat|anger|angry|rage|fury|betray|hurt|pain|panic|despair|disgust|hate|hated|cruel|violent|wound|threat|scared|frightened|bitter|regret|guilt|abandon)\b/i;
const WARM = /\b(joy|joyful|love|loved|tender|relief|relieved|safe|safety|warm|warmth|happy|happiness|delight|gratitude|grateful|peace|peaceful|held|home|belonging|pride|proud|comfort|laughter|laughing|ease)\b/i;

/** One memory's contribution: which way, and how much. Zero when it says nothing either way. */
function charged(m: EpisodicMemory, turn: number): number {
  const text = `${m.emotional_charge ?? ""} ${m.content ?? ""}`;
  const dark = DARK.test(text), warm = WARM.test(text);
  if (dark === warm) return 0;                        // neither, or a memory pulling both ways
  const weight = Math.max(1, Math.min(10, m.importance ?? 5)) / 10;
  const age = Math.max(0, turn - (m.turn ?? turn));
  const faded = age > FADE_AFTER ? 0.4 : 1;
  return (dark ? -1 : 1) * weight * faded;
}

/** How many times this person has been in this place lately. The player's own path is on file; for
 *  everybody else, their memories of the place are the record of having been in it. */
function recentVisits(state: SaveState, id: string, placeName: string, turn: number): number {
  if (id === "char_player") {
    return (state.travel_log ?? []).filter((t) =>
      turn - t.turn <= HABITUATE_WINDOW && state.world.places?.[t.place]?.name === placeName).length;
  }
  return (state.memory[id]?.episodic ?? []).filter((m) =>
    turn - (m.turn ?? 0) <= HABITUATE_WINDOW && sameplace(m.where, placeName)).length;
}

function sameplace(a: string | undefined, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What this place holds for this person, and what walking into it does to them.
 *
 * Returns the shove and the memory that carries most of it — the second is for the audit trail and
 * for the card cue, never for arithmetic.
 */
export function placeCharge(state: SaveState, id: string, placeId: string): { shove: number; mass: number; strongest: EpisodicMemory | null } {
  const place = state.world.places?.[placeId];
  const none = { shove: 0, mass: 0, strongest: null };
  if (!place?.name || placeId === "loc_offscene") return none;
  const turn = state.world.current_turn;
  const mine = (state.memory[id]?.episodic ?? []).filter((m) => sameplace(m.where, place.name));
  if (mine.length < 2) {
    // One memory is only a charge if it was a big one. Below that a room is a room.
    const solo = mine[0];
    if (!solo || (solo.importance ?? 0) < 7) return none;
  }
  let sum = 0, mass = 0, best: EpisodicMemory | null = null, bestAbs = 0;
  for (const m of mine) {
    const c = charged(m, turn);
    if (!c) continue;
    sum += c; mass += Math.abs(c);
    if (Math.abs(c) > bestAbs) { bestAbs = Math.abs(c); best = m; }
  }
  if (mass < CHARGE_FLOOR) return none;

  // HABITUATION. The room you are in every day stops doing this to you.
  const visits = recentVisits(state, id, place.name, turn);
  const familiar = 1 / (1 + Math.max(0, visits - 1) / HABITUATE_AT);
  const shove = Math.max(-MAX_CHARGE, Math.min(MAX_CHARGE, sum * familiar));
  if (Math.abs(shove) < 0.15) return none;
  return { shove: +shove.toFixed(3), mass: +mass.toFixed(2), strongest: best };
}

/**
 * Apply it, on arrival, to everybody who just moved. Returns audit lines for the shift feed.
 *
 * The player is included and this is deliberate, unlike remodelling: this does not decide anything
 * about who the player is or how they feel — it moves the same scalar their own tightness anchor
 * already caps, on the strength of events THE PLAYER PLAYED THROUGH and the engine recorded at the
 * time. Walking back into a room is not a claim about their interior; it is the room.
 */
export function tickArrivals(state: SaveState, moved: { id: string; to: string }[]): string[] {
  const out: string[] = [];
  state.last_ground = [];        // once a turn: this is a record of arrivals, not an accumulating log
  for (const { id, to } of moved) {
    const cond = state.condition[id]; if (!cond) continue;
    const { shove, strongest } = placeCharge(state, id, to);
    if (!shove) continue;
    cond.psyche.relaxation = Math.max(-10, Math.min(10, cond.psyche.relaxation + shove));
    (state.last_ground ??= []).push({
      id, place: state.world.places?.[to]?.name ?? to, shove,
      about: strongest?.content?.slice(0, 90) ?? "", turn: state.world.current_turn,
    });
    const who = id === "char_player" ? state.characters[id]?.name ?? "you" : state.characters[id]?.name ?? id;
    out.push(shove < 0
      ? `${who} walked back into ${state.world.places?.[to]?.name} and the room still had it.`
      : `${who} walked back into ${state.world.places?.[to]?.name} and it was easier there.`);
  }
  return out;
}

/**
 * The card line, for somebody standing in a place that holds something for them. Behavioural and
 * about the ROOM, never a number and never a named feeling — the body is already braced, the
 * narrator writes what a braced body does here, and the memory is theirs to raise or not.
 */
export function groundCue(state: SaveState, id: string): string {
  const rec = (state.last_ground ?? []).find((g) => g.id === id && g.turn === state.world.current_turn);
  if (!rec) return "";
  const name = state.characters[id]?.name ?? "they";
  return rec.shove < 0
    ? `  this place is not neutral to ${name}: something happened to ${name} here and the body knows the room before the mind does. `
      + `Render it in what ${name} does with the space — where ${name} stands, what ${name} does not sit on, the door ${name} keeps in view — never as a stated memory and never as a mood. ${name} does not have to mention it and probably will not.`
    : `  ${name} is easier in this place than elsewhere; good things happened to ${name} here. Render it as ease with the room itself — moving through it without looking, using it like somewhere that belongs to ${name} — never as a comment about the place.`;
}

