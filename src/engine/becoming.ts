/**
 * A BECOMING — a fact the world does not hold yet, and is going to.
 *
 * The player writes what will be true ("all the buildings are water") and how many turns the world
 * has to get there. It does not simply happen. Each turn the world has to MOVE toward it through
 * its own causes — through what people do, what they notice, what starts going wrong — and only a
 * turn where it actually moved spends a turn off the clock. When the clock runs out the claim goes
 * into world.canon, where the existing CANON OVERRIDES YOUR DEFAULTS block already binds every line
 * of prose after it. From then on it is simply how this world is, and nobody remarks on it.
 *
 * THIS IS THE AUTHORED-WANT PATTERN POINTED AT THE WORLD instead of at a person, and it is built
 * with the lesson that cost that feature twenty playthroughs: the instruction is not the mechanism.
 * The mechanism is that the simulator READS the turn and says whether the world moved, the engine
 * counts it, and a turn that did nothing is named in the next turn's direction. No regex decides
 * whether a building became water — string matching cannot answer that, and a fact this large is
 * exactly where a false credit would be worst, because the clock would run out on a world that had
 * not changed at all and the prose would have to pretend it had.
 *
 * WHAT THE PLAYER CAN DO ABOUT IT is the other half, and it is asymmetric on purpose:
 *
 *  · Ordinary play: nothing. A character can be frightened of it, refuse to believe it, spend the
 *    whole clock trying to stop it, and it arrives anyway. That is what makes it weather rather
 *    than a plot the player is negotiating with.
 *  · God mode: the player is sovereign, so repudiation works — and it costs the world a turn rather
 *    than the war. Each turn the player uses what they have to hold it back, the clock goes UP by
 *    one and the world tries again. It never gives up, and they can hold it off forever if they
 *    keep paying for it every turn.
 */
import type { SaveState } from "./types";
import { clipWords } from "./coerce";

/** How much of a written claim is kept. Generous: this is a spec the player wrote by hand. */
export const CLAIM_MAX = 400;
/** Turns without visible movement before the stall is named in the direction. */
export const STALL_LIMIT = 2;

export interface Becoming {
  id: string;
  /** What will be true. Stored as written. */
  claim: string;
  /** Turns of movement the world needs. Never counts down on a turn that did not move. */
  remaining: number;
  /** What the player originally set, so the UI can show how far along it is. */
  turns: number;
  added_turn: number;
  /** Turns where the world visibly moved toward it. */
  moved: number;
  /** Consecutive turns where it did not. */
  stalled: number;
  /** God-mode pushbacks. Each one put a turn back on the clock. */
  repudiations: number;
  /** The last thing the world did about it, in the simulator's words — shown to the player. */
  last_move?: string;
  /** Set the turn it entered canon. */
  arrived_turn?: number;
  paused?: boolean;
}

/** A fresh becoming, with the fields the UI does not ask for filled in. */
export function newBecoming(claim: string, turns: number, turn: number): Becoming {
  const n = Math.max(1, Math.min(200, Math.round(turns) || 1));
  return {
    id: `bec_${turn}_${Math.random().toString(36).slice(2, 8)}`,
    claim: clipWords(claim, CLAIM_MAX),
    remaining: n,
    turns: n,
    added_turn: turn,
    moved: 0,
    stalled: 0,
    repudiations: 0,
  };
}

/** The ones still on their way. */
export function liveBecomings(state: SaveState): Becoming[] {
  return (state.becomings ?? []).filter((b) => b?.claim && !b.arrived_turn && !b.paused);
}

/** How near it is, as something to write rather than a number to show. */
function pressureOf(b: Becoming): string {
  const done = b.turns - b.remaining;
  const frac = b.turns <= 1 ? 1 : done / b.turns;
  if (b.remaining <= 1) return "THE LAST STEP. After this turn it is simply true, so this turn is where the last thing standing between the world and it gives way. Write that thing giving way.";
  if (frac >= 0.6) return "Well underway and no longer deniable to anyone paying attention: it is happening in more than one place at once, it is affecting what people can do today, and somebody has started planning around it rather than arguing about it.";
  if (frac >= 0.25) return "Past the point where it could be a coincidence. It has happened somewhere else as well, somebody with authority has had to say something about it, and the first practical consequence has landed on somebody's day.";
  return "Early. It shows up once, small, in a way that could still be explained away — and the person who notices is the wrong person to be believed, or does not think it is worth mentioning.";
}

/**
 * What the narrator is handed while a becoming is on its way.
 *
 * The hard part of this instruction is not the goal, it is the PROHIBITION: the end state must not
 * be stated, announced, predicted by a character, or arrive early. Left to itself a narrator handed
 * "all the buildings are water" writes somebody saying the buildings are turning to water, which
 * spends the whole thing in one line and leaves the clock nothing to do.
 */
export function becomingDirective(state: SaveState): string {
  const live = liveBecomings(state);
  if (!live.length) return "";
  const god = !!state.world_bible?.god_mode;
  const rows = live.map((b) => {
    const stall = b.stalled >= STALL_LIMIT
      ? ` NOTHING ABOUT THIS MOVED FOR ${b.stalled} TURNS. It moves in the opening lines of this one, in something that happens rather than something somebody says.`
      : "";
    const push = b.repudiations
      ? ` The player has held this back ${b.repudiations} time${b.repudiations === 1 ? "" : "s"} and it has not stopped coming; write it arriving from a direction they did not block.`
      : "";
    return `${b.claim} — ${pressureOf(b)}${stall}${push}`;
  });
  return `\n\nWHAT THIS WORLD IS TURNING INTO — not yet true, becoming true.\n· ${rows.join("\n· ")}\n`
    + `Each of these gets ONE step this turn and the step is an EVENT, in the world, with a cause: a thing that happens, a thing somebody finds, a thing that stops working, a thing somebody does about it. `
    + `THE END STATE IS NOT WRITTEN AND IS NOT NAMED. Nobody says what is coming, nobody predicts it, nobody explains it, and no character understands the shape of it — they meet the piece in front of them and are wrong about what it means, because they are inside it and it has no name yet. `
    + `Do not skip ahead: the world is at the step described above and not one step further, and a turn that jumps to the finished state has spent something the story needed. `
    + `Write it as the people there would meet it — as an inconvenience, a rumour, a fault, a thing somebody is angry about, a thing that ruins an afternoon — never as an omen and never as a scene about itself. `
    + (god
      ? `The player can push it back and it will cost the world a turn, never the outcome; if they act against it, write the world losing that particular ground and looking for another way in.`
      : `The player cannot stop it. They can be frightened of it, refuse it, work against it for the whole of it, and it arrives anyway — write their resistance honestly and write it failing, without anyone gloating and without the world seeming to intend anything.`);
}

/** The turn it lands. Handed to the narrator alongside the canon entry it just became. */
export function arrivalDirective(arrived: Becoming[]): string {
  if (!arrived.length) return "";
  return `\n\nTHIS IS TRUE NOW, IN THIS TURN, AND FROM HERE ON.\n· ${arrived.map((b) => b.claim).join("\n· ")}\n`
    + `The last of the way was covered in this turn and the prose shows it happening — the final change, physically, where somebody can see it. `
    + `After this it is not news and it is not a subject: it is how this world is, the people in it live in it as an ordinary condition, and nobody marvels at it, explains it, or refers back to when it was otherwise unless something in the scene genuinely turns on that. `
    + `Everything from here obeys it without being reminded to.`;
}

/**
 * Apply what the simulator saw. Returns the lines shown to the player.
 *
 * `report` is the simulator's read of this turn — never a string match. A becoming that did not
 * visibly move does not spend a turn: the clock measures how far the world has come, not how long
 * the player has been waiting, and a clock that ran out on a world that never changed would force
 * the prose to pretend.
 */
export function applyBecomingProgress(
  state: SaveState,
  turn: number,
  report: { claim?: string; moved?: boolean; how?: string; opposed?: boolean }[] | undefined,
): { shifts: string[]; arrived: Becoming[] } {
  const shifts: string[] = [];
  const arrived: Becoming[] = [];
  const live = liveBecomings(state);
  if (!live.length) return { shifts, arrived };
  const god = !!state.world_bible?.god_mode;
  // Match the simulator's line to a becoming by its claim. Absent or unmatched means no report for
  // it, and no report is NOT a miss — the same rule the want detector learned.
  const said = new Map<string, { moved?: boolean; how?: string; opposed?: boolean }>();
  for (const r of report ?? []) {
    const key = String(r?.claim ?? "").trim().toLowerCase();
    if (key) said.set(key, r);
  }
  for (const b of live) {
    // Matched by the claim the simulator echoed back. Lexical here and correctly so: this compares
    // its copy of the claim against the stored claim, not prose against meaning. Containment either
    // way covers a clipped or lightly re-punctuated echo. A line about some OTHER claim is not a
    // report about this one, however few of them there are.
    const key = b.claim.trim().toLowerCase();
    const r = said.get(key) ?? (() => {
      for (const [k, v] of said) if (k.length >= 12 && (k.includes(key) || key.includes(k))) return v;
      return undefined;
    })();
    if (!r) continue;

    if (r.opposed && god) {
      b.repudiations++;
      b.remaining++;
      b.stalled = 0;
      shifts.push(`you held back "${short(b.claim)}" — the world lost a turn on it and is still coming`);
      continue;
    }
    if (r.moved) {
      b.moved++;
      b.stalled = 0;
      b.remaining = Math.max(0, b.remaining - 1);
      if (r.how?.trim()) b.last_move = clipWords(r.how.trim(), 160);
      if (b.remaining === 0) {
        b.arrived_turn = turn;
        arrived.push(b);
        const canon = (state.world.canon ??= []);
        if (!canon.some((c) => c.trim().toLowerCase() === b.claim.trim().toLowerCase())) {
          canon.push(b.claim);
          (state.world.canon_meta ??= {})[b.claim.toLowerCase()] = { turn, witnesses: [...(state.world.present ?? [])] };
        }
        shifts.push(`"${short(b.claim)}" is now true of this world, and binds every turn from here`);
      } else {
        shifts.push(`the world moved toward "${short(b.claim)}" — ${b.remaining} turn${b.remaining === 1 ? "" : "s"} of it left`);
      }
      continue;
    }
    b.stalled++;
    if (b.stalled >= STALL_LIMIT) shifts.push(`nothing moved toward "${short(b.claim)}" for ${b.stalled} turns — telling the narrator again`);
  }
  return { shifts, arrived };
}

function short(claim: string): string {
  return claim.length > 54 ? claim.slice(0, 52).trimEnd() + "…" : claim;
}

/** The block added to the bookkeeper's request, only while something is on its way. */
export function becomingAsk(state: SaveState): string {
  const live = liveBecomings(state);
  if (!live.length) return "";
  return `\n\n=== WHAT THIS WORLD IS TURNING INTO (report on each, in becoming_progress) ===\n`
    + live.map((b) => `- "${b.claim}"`).join("\n")
    + `\nFor each line, copy its text into "claim" and answer two things about THIS TURN only.\n`
    + `moved: did the world get measurably closer to it — did something happen, change, fail, or get done that puts it nearer? Judge by what the turn MEANS, not by whether the words above appear: a claim about buildings is moved by a wall going soft, by a street closing, by somebody's ceiling coming down. A turn that only mentioned it, worried about it, or discussed it did NOT move it; a turn that showed it happening somewhere did.\n`
    + `how: if it moved, the one thing that moved it, in a few words.\n`
    + `opposed: did the PLAYER act against it this turn — try to stop, reverse, prevent, or undo it?\n`
    + `Report every line, including the ones nothing happened to.`;
}
