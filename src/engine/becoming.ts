/**
 * A BECOMING — a fact the world does not hold yet, and is going to.
 *
 * The player writes what will be true ("all the buildings are water") and how many turns the world
 * has to get there. THE COUNT IS THE INSTRUCTION: every turn spends one, and when the clock runs
 * out the claim goes into world.canon, where the existing CANON OVERRIDES YOUR DEFAULTS block
 * already binds every line of prose after it. From then on it is simply how this world is, and
 * nobody remarks on it.
 *
 * Each turn the world takes a step toward it through its own causes — through what people do, what
 * they notice, what starts going wrong. Whether the step actually reached the page is read from the
 * simulator and used as PRESSURE on the next turn, never as a brake on the clock: see the note at
 * applyBecomingProgress for why the other way round was wrong.
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
  /** Turns it has actually been SEEN in the prose since arriving. A becoming that is true and has
   *  never once been shown is a canon line nobody is living in — see becomingLaw. */
  shown?: number;
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

/** Turns an arrived becoming keeps being pushed onto the page before the canon line carries it
 *  alone. The authored wants have exactly this third phase — live, settled, ground — and becomings
 *  had only the first two, which is the whole of the failure this fixes. */
export const WORN_IN = 3;

/** The ones still on their way. */
export function liveBecomings(state: SaveState): Becoming[] {
  return (state.becomings ?? []).filter((b) => b?.claim && !b.arrived_turn && !b.paused);
}

/** True now, and not yet part of how the place feels. */
export function arrivedBecomings(state: SaveState): Becoming[] {
  return (state.becomings ?? []).filter((b) => b?.claim && b.arrived_turn && !b.paused && (b.shown ?? 0) < WORN_IN);
}

/** THE RUNGS, in the shape the authored-want ladder uses — because that is the block in this engine
 *  that demonstrably reaches the page, and this one was not.
 *
 *  Each rung names ONE CONCRETE THING that has to be on the page and says what a reader would be
 *  able to point at. A rung that describes a mood produces nothing; a rung that names an event
 *  produces an event. */
const RUNGS = [
  "FIRST SIGN, ONE CONCRETE THING. It happens once, small, somewhere ordinary, and it could still be explained away \u2014 a fault, a mess, a thing gone wrong that somebody has to deal with today. Whoever notices is the wrong person to be believed, or does not think it worth mentioning. NOT MENTIONING IT IS NOT THE SAME AS IT NOT HAPPENING: if a reader could not point at the sentence where it occurred, this rung has not been written.",
  "AGAIN, SOMEWHERE ELSE, and now it costs somebody something. It has happened in a second place, it is on somebody's day \u2014 a job that cannot be done, a route that is closed, a thing that has to be replaced \u2014 and somebody with a reason to know has been asked about it and has answered badly.",
  "NOT A COINCIDENCE ANY MORE. Several places at once, and the people here start behaving differently because of it: they plan around it, they move something, they stop doing a thing they always did. Somebody in authority says something official and it does not help.",
  "IT IS THE CONDITION NOW, not an event. Most of what the scene contains is already like this, ordinary life is arranged around it, and whatever is still holding out is visibly the last of it.",
  "THE LAST TURN OF IT. Everything still standing between the world and this gives way here, in full, on the page \u2014 the whole change completing, physically, where somebody can see it. Not a threshold about to be crossed and not a promise: it finishes in this turn's prose. After this it is simply true.",
];

/** Which rung this turn is on. Counted from the END, so one turn left is always the last rung
 *  whatever the clock's total length, and a long clock spends its extra turns on the early rungs
 *  rather than sitting still. */
function rungOf(b: Becoming): string {
  if (b.remaining <= 1) return RUNGS[RUNGS.length - 1];
  const done = b.turns - b.remaining;
  const frac = b.turns <= 1 ? 1 : done / Math.max(1, b.turns - 1);
  return RUNGS[Math.max(0, Math.min(RUNGS.length - 2, Math.floor(frac * (RUNGS.length - 1))))];
}

/**
 * What the narrator is handed while a becoming is on its way.
 *
 * FRAMED LIKE habitDirective, deliberately and nearly word for word. That block is the one thing in
 * this engine measured getting a mandatory beat onto the page; this one said much the same in
 * gentler words and produced nothing at all. What differs is the bracket, refusing each excuse for
 * skipping it BY NAME, and a rung that says what a reader could point at rather than how the turn
 * should feel.
 *
 * The prohibitions are kept and cut to a tail. Four prohibitions against one instruction reads as an
 * instruction not to do it, which is roughly what came back.
 */
export function becomingDirective(state: SaveState): string {
  const live = liveBecomings(state);
  if (!live.length) return "";
  const god = !!state.world_bible?.god_mode;
  const rows = live.map((b) => {
    const behind = b.stalled >= STALL_LIMIT
      ? ` THIS HAS NOT REACHED THE PAGE FOR ${b.stalled} TURNS while its clock ran, so the world is behind on it: this turn opens on it, and it is further along than one step would have left it.`
      : "";
    const push = b.repudiations
      ? ` The player has held this back ${b.repudiations} time${b.repudiations === 1 ? "" : "s"} and it has not stopped coming; it arrives from a direction they did not block.`
      : "";
    return `THE WORLD DOES THIS NOW, on its own, without anybody deciding it: ${b.claim} \u2014 ${rungOf(b)}${behind}${push}`;
  });
  return `\n\n[WHAT THIS WORLD IS TURNING INTO \u2014 NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE.
Each line below gets a beat in THIS scene, at the strength named and no more. You do not get to decide that this scene is too busy for it, that the conversation matters more, or that it would land better later: the clock is running whether it is written or not, and a turn that skips it does not pause it \u2014 it only makes the next one arrive with more to carry. If the scene seems to leave no room, that is the instruction \u2014 make the room. One sentence is enough. There is no version of this turn in which none of it can be seen.
THE COUNT IS A DEADLINE: the player set how many turns this takes, and it becomes true when the clock runs out however much ground is left.
\u00b7 ${rows.join("\n\u00b7 ")}
Each beat is an EVENT with a cause \u2014 a thing that happens, a thing somebody finds, a thing that stops working, a thing somebody does about it \u2014 met the way the people there would meet it: an inconvenience, a rumour, a fault, a thing somebody is angry about.
DO NOT NAME THE END STATE. Nobody says what is coming, nobody predicts it, and no character understands the shape of it; they meet the piece in front of them and are wrong about what it means. ${god
      ? `If the player acts against it the world loses that ground and looks for another way in \u2014 they can cost it a turn, never the outcome.`
      : `The player cannot stop it. Write their resistance honestly and write it failing, without anyone gloating and without the world seeming to intend anything.`}]`;
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
  const settled = arrivedBecomings(state);
  if (!live.length && !settled.length) return { shifts, arrived };
  const god = !!state.world_bible?.god_mode;
  // Match the simulator's line to a becoming by its claim. Absent or unmatched means no report for
  // it, and no report is NOT a miss — the same rule the want detector learned.
  const said = new Map<string, { moved?: boolean; how?: string; opposed?: boolean }>();
  for (const r of report ?? []) {
    const key = String(r?.claim ?? "").trim().toLowerCase();
    if (key) said.set(key, r);
  }
  // Matched by the claim the simulator echoed back. Lexical here and correctly so: this compares its
  // copy of the claim against the stored claim, not prose against meaning. Containment either way
  // covers a clipped or lightly re-punctuated echo. A line about some OTHER claim is not a report
  // about this one, however few of them there are.
  const matched = (b: Becoming) => {
    const key = b.claim.trim().toLowerCase();
    if (said.has(key)) return said.get(key);
    for (const [k, v] of said) if (k.length >= 12 && (k.includes(key) || key.includes(k))) return v;
    return undefined;
  };
  for (const b of live) {
    const r = matched(b);

    if (r?.opposed && god) {
      b.repudiations++;
      b.stalled = 0;
      shifts.push(`you held back "${short(b.claim)}" — the world lost a turn on it and is still coming`);
      continue;
    }

    // THE CLOCK IS A CLOCK. It was conditional on the simulator reporting movement, and that was
    // wrong twice over. It is the same mistake that cost the authored wants twenty playthroughs:
    // gating a mandatory thing on a model's report, when the report is the very thing that fails.
    // And it inverts the deal — the player said HOW MANY TURNS, and a turn where the narrator
    // skipped the step is a turn the narrator owes them, not a turn that never happened. Under the
    // old rule a narrator that never found a way in froze the clock forever and the player watched
    // it report "stalled" every turn while nothing approached.
    //
    // So every turn spends one, and whether it SHOWED is kept separately — as pressure on the next
    // turn's direction, not as a brake on the clock. Only a god-mode repudiation puts a turn back,
    // because that is the player paying for it.
    b.remaining = Math.max(0, b.remaining - 1);
    if (r?.moved) {
      b.moved++;
      b.stalled = 0;
      if (r.how?.trim()) b.last_move = clipWords(r.how.trim(), 160);
    } else {
      b.stalled++;
    }

    if (b.remaining === 0) {
      b.arrived_turn = turn;
      arrived.push(b);
      const canon = (state.world.canon ??= []);
      if (!canon.some((c) => c.trim().toLowerCase() === b.claim.trim().toLowerCase())) {
        canon.push(b.claim);
        (state.world.canon_meta ??= {})[b.claim.toLowerCase()] = { turn, witnesses: [...(state.world.present ?? [])] };
      }
      shifts.push(`"${short(b.claim)}" is true of this world now, and binds every turn from here`);
      continue;
    }
    const left = `${b.remaining} turn${b.remaining === 1 ? "" : "s"} to go`;
    shifts.push(r?.moved
      ? `the world moved toward "${short(b.claim)}" — ${left}`
      : `"${short(b.claim)}" did not show this turn — it lands on schedule anyway, ${left}`);
  }

  // AND THE ONES ALREADY TRUE. A fact the world is supposed to be living in that has never once
  // reached the page is the failure this phase exists to catch, so it is counted the same way.
  for (const b of settled) {
    const r = matched(b);
    if (r?.moved) {
      b.shown = (b.shown ?? 0) + 1;
      if (r.how?.trim()) b.last_move = clipWords(r.how.trim(), 160);
      if ((b.shown ?? 0) >= WORN_IN) shifts.push(`"${short(b.claim)}" is simply how this world is now`);
    }
  }
  return { shifts, arrived };
}

function short(claim: string): string {
  return claim.length > 54 ? claim.slice(0, 52).trimEnd() + "…" : claim;
}

/** The block added to the bookkeeper's request, only while something is on its way. */
export function becomingAsk(state: SaveState): string {
  // Arrived ones are asked about too. `shown` is how the engine knows whether a fact the world is
  // supposed to be living in has ever actually reached the page, and without asking it never moves.
  const live = [...liveBecomings(state), ...arrivedBecomings(state)];
  if (!live.length) return "";
  return `\n\n=== WHAT THIS WORLD IS TURNING INTO, OR HAS TURNED INTO (report on each, in becoming_progress) ===\n`
    + live.map((b) => `- "${b.claim}"`).join("\n")
    + `\nFor each line, copy its text into "claim" and answer two things about THIS TURN only.\n`
    + `moved: did the world get measurably closer to it — did something happen, change, fail, or get done that puts it nearer? Judge by what the turn MEANS, not by whether the words above appear: a claim about buildings is moved by a wall going soft, by a street closing, by somebody's ceiling coming down. A turn that only mentioned it, worried about it, or discussed it did NOT move it; a turn that showed it happening somewhere did.\n`
    + `how: if it moved, the one thing that moved it, in a few words.\n`
    + `opposed: did the PLAYER act against it this turn — try to stop, reverse, prevent, or undo it?\n`
    + `Report every line, including the ones nothing happened to.`;
}


/**
 * THE SEPARATE, LOUDER BLOCK when the world is behind — the same second mechanism the authored
 * wants have in missDirective, and for the same reason: a note buried inside the standing
 * instruction is read as part of that instruction, and the standing instruction is the thing that
 * just got skipped. This arrives on its own, after everything else, naming the count.
 *
 * The escalation is not louder adjectives. It is the two facts the narrator cannot argue with: how
 * many turns have gone, and how few are left.
 */
export function becomingBehind(state: SaveState): string {
  const rows = liveBecomings(state)
    .filter((b) => (b.stalled ?? 0) >= STALL_LIMIT)
    .map((b) => `${b.claim} — ordered for ${b.stalled} turns and absent from all of them; ${b.remaining} turn${b.remaining === 1 ? "" : "s"} left before it is simply true.`);
  if (!rows.length) return "";
  return `\n\nTHIS WAS ORDERED AND THE TURNS CAME BACK WITHOUT IT.\n· ${rows.join("\n· ")}\n`
    + `The scenes written instead were real scenes and they went where this was supposed to be. `
    + `WRITE IT FIRST THIS TURN: the thing happening, in the opening lines of the prose, before the conversation, before whatever the room was in the middle of. Then carry on with the rest of the turn around it. `
    + `The clock did not wait, so there is less room left than there was — what shows now is as far along as the turns already spent should have carried it.`;
}

/**
 * WHAT IS TRUE HERE NOW — the phase that was missing, and the reason a becoming could land and
 * change nothing.
 *
 * From a save: three becomings reached the clock's end and entered world.canon. Two of them had
 * `moved: 0` — the world had never once shown them — and after all three were canon the next turn
 * produced a laugh, a wine bottle and a conversation about dinner. When the player finally acted on
 * one himself, the character he did it to was written as STARTLED, against a canon line saying it
 * is as normal as breathing and nobody comments on it.
 *
 * Canon is a constraint against CONTRADICTION. The block that carries it tells the narrator not to
 * write the default meaning where canon redefines a thing, which is exactly right and does nothing
 * whatever to make a scene contain it. A fact nobody is living in reads as a fact that is not true.
 *
 * The authored wants have three phases — climbing, settled-and-still-ordered, then worn in and left
 * to the novelty note. Becomings had climbing and then silence. This is the middle one: for a few
 * turns after it lands, the world is told to be a place where this is ordinary, and told what
 * ordinary means — nobody explains it, nobody is surprised by it, and it shows in what people DO.
 */
export function becomingLaw(state: SaveState): string {
  const here = arrivedBecomings(state);
  if (!here.length) return "";
  const rows = here.map((b) => {
    const never = !(b.shown ?? 0)
      ? ` This has been true since turn ${b.arrived_turn} and has not been seen once; it shows in THIS scene, in something somebody does.`
      : "";
    return `${b.claim}${never}`;
  });
  return `\n\n[WHAT IS TRUE OF THIS WORLD NOW — write the place where these are ordinary.\n· ${rows.join("\n· ")}\n`
    + `These are not news, not a subject, and not a thing anybody has an opinion about: they are the water these people have always swum in. `
    + `NOBODY IS SURPRISED BY THEM. Nobody remarks on one, explains one, apologises for one, is startled or embarrassed by one, or treats it as a thing that has just started — a character reacting to one as though it were new is the clearest possible sign the world has not actually changed. `
    + `NOBODY ANNOUNCES THEM EITHER. They are not stated, quoted, or described as facts; they are visible only in what people do without thinking about it, the way anybody behaves about the ordinary conditions of their own life. `
    + `Each of these is somewhere in this scene — in a posture, a habit, an arrangement, something somebody reaches for or does not, something that goes without saying between them. If the scene seems to leave no room, that is the instruction: make the room, in one sentence if that is all there is.]`;
}
