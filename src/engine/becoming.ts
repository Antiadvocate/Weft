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
import { findDeclaredMiss } from "./declared";
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
  /** Final turns already given back because the prose came back without it. Capped at GRACE_TURNS
   *  so a narrator that never finds a way in cannot freeze the clock, which is the objection the
   *  deadline was built against. */
  grace?: number;
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
  "STAGE ONE: THE FIRST SIGN, ONE CONCRETE THING. It happens once, in a small way, somewhere ordinary, and it could still be explained away as a fault, a mess, or something gone wrong that somebody has to deal with today. Whoever notices it is the wrong person to be believed, or doesn't think it's worth mentioning. It still has to happen on the page even if nobody mentions it. If a reader couldn't point at the sentence where it happened, this stage hasn't been written.",
  "STAGE TWO: IT HAPPENS AGAIN SOMEWHERE ELSE, and this time it causes somebody a real problem. It has now happened in a second place, and it gets in the way of somebody's day, as a job that can't be done, a road that's closed, or something that has to be replaced. Somebody who ought to know about it has been asked, and their answer wasn't good enough.",
  "STAGE THREE: IT'S NO LONGER A COINCIDENCE. It's happening in several places at once, and the people here start behaving differently because of it: they plan around it, move things, or stop doing something they've always done. Somebody in charge makes an official statement, and it doesn't help.",
  "STAGE FOUR: IT'S NOW THE NORMAL STATE OF THINGS. Most of what's in the scene is already like this, ordinary life is organised around it, and whatever is still holding out is clearly the last of it.",
  "STAGE FIVE: THE LAST STEP. Everything still standing between the world and this change gives way here, completely and on the page, as the whole change finishes physically where somebody can see it. It's completed in this turn's prose, and after this it's simply true.",
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
/** Extra turns a becoming may be granted when its final turn produced nothing on the page.
 *  Bounded, because the objection the clock was built against is real: a narrator that never finds
 *  a way in must not be able to freeze a becoming forever. */
export const GRACE_TURNS = 2;

/**
 * THE LAST TURN OF THE CLOCK IS NOT A REQUEST.
 *
 * becomingDirective is a strong block and it escalates: past STALL_LIMIT it tells the narrator the
 * world is behind and this turn opens on it. Measured on a save, a becoming with a three-turn clock
 * came back `moved: 0, stalled: 3`. It was asked three times, ignored three times, and then the
 * engine converted the request into a fact of the world.
 *
 * Asking harder is not the remaining move — the block already asks as hard as prose can. What the
 * engine has that it was not using is the shape it uses everywhere something MUST be on the page:
 * state it as a fact, name the specific ways it gets declined, and put it last, where this codebase
 * has repeatedly written down that a rule stops being reference and becomes an instruction.
 *
 * So the final turn of a clock gets the treatment a player's own declaration gets. Same three
 * declines, because they are how any ordered event gets skipped without ever being refused: the
 * interruption that arrives, the "almost" that renders the act as an approach to itself, and the
 * milder adjacent thing in the same room.
 */
export function becomingFinalLaw(state: SaveState): string {
  const last = liveBecomings(state).filter((b) => b.remaining <= 1);
  if (!last.length) return "";
  const rows = last.map((b) => {
    const grace = b.grace ? ` The turn before this one was given to it as well and came back without it.` : "";
    return `${b.claim}${grace}`;
  });
  return `\n\n=== THE LAST TURN BEFORE THIS CLOCK RUNS OUT ===\n· ${rows.join("\n· ")}\n`
    + `The player chose how many turns this would take, and this is the last one. Whatever these lines describe happens in this turn's prose, on the page, as an event with a cause, and it is met by the people who are actually here.\n`
    + `There are three ways of avoiding writing it, and none of them is allowed this turn:\n`
    + `- Nothing turns up to interrupt it: no phone, no knock, no footsteps in the hall, no third person in the doorway.\n`
    + `- Nobody almost does it. Don't write "almost", "nearly", "started to", "was about to", "for a moment" or "seemed to".\n`
    + `- Nothing milder happens in its place, however well it would suit the room. A smaller act with the same people is a different event.\n`
    + `Write it at the start of the turn, before the conversation and before whatever the room was in the middle of, and then carry on around it. Nobody in the scene understands what it means or says what it's turning into; they just deal with the part that's in front of them.`;
}

export function becomingDirective(state: SaveState): string {
  const live = liveBecomings(state);
  if (!live.length) return "";
  const god = !!state.world_bible?.god_mode;
  const rows = live.map((b) => {
    const behind = b.stalled >= STALL_LIMIT
      ? ` This hasn't appeared in the prose for ${b.stalled} turns while its clock kept running, so it's behind schedule. This turn opens with it, and it has got further along than a single step would have taken it.`
      : "";
    const push = b.repudiations
      ? ` The player has held this back ${b.repudiations} time${b.repudiations === 1 ? "" : "s"}, and it hasn't stopped coming, so it arrives from a direction they didn't block.`
      : "";
    return `THE WORLD NOW DOES THIS on its own, without anybody deciding it: ${b.claim} — ${rungOf(b)}${behind}${push}`;
  });
  return `\n\n[WHAT THIS WORLD IS TURNING INTO. Every line here goes on the page this turn.
Each line below gets a moment in this scene, at the strength given and no stronger. It isn't up to you to decide that this scene is too busy for it, that the conversation matters more, or that it would work better later. The clock keeps running whether or not it gets written, so skipping it just means the next moment has more ground to cover. If the scene seems to have no room, make room. One sentence is enough, but some of it has to be visible this turn.
The number of turns is a deadline. The player chose how many turns this takes, and once the clock runs out it becomes true, however much of the way is still left.
· ${rows.join("\n· ")}
Each moment is an event with a cause: something that happens, something somebody finds, something that stops working, or something somebody does about it. The people there deal with it the way they would deal with any inconvenience, rumour or fault, or something they're angry about.
Don't say where it's heading. Nobody says what's coming, nobody predicts it, and no character understands the overall pattern. They deal with the part in front of them and get wrong what it means. ${god
      ? `If the player acts against it, the world loses that ground and looks for another way in. The player can delay it by a turn, but they can't change how it ends.`
      : `The player can't stop it. Write their resistance honestly and write it failing, without anyone gloating and without the world seeming to intend anything.`}]`;
}


/** The turn it lands. Handed to the narrator alongside the canon entry it just became. */
export function arrivalDirective(arrived: Becoming[]): string {
  if (!arrived.length) return "";
  return `\n\nTHIS IS TRUE NOW, FROM THIS TURN ON.\n· ${arrived.map((b) => b.claim).join("\n· ")}\n`
    + `The last part of the change happened this turn, and the prose shows it happening, as the final change, physically, where somebody can see it. `
    + `From now on this is simply how the world is. The people in it live with it as an ordinary fact, and nobody marvels at it, explains it, or mentions a time when things were different, unless something in the scene really depends on that. `
    + `Everything from here on follows it without needing a reminder.`;
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
  /** The turn's committed prose. When given, the final turn of a clock is checked against it before
   *  the becoming is allowed to arrive. See the note at the decrement. */
  prose?: string,
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
      shifts.push(`you held back "${short(b.claim)}", so it was delayed by a turn, but it's still coming`);
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
    /* THE LAST TURN IS CHECKED AGAINST THE PROSE, AND IT IS THE ONLY ONE THAT IS.
     *
     * The comment above is right that gating the clock on the simulator's report was wrong: the
     * report is the thing that fails, and a becoming frozen on a model's judgement waits forever.
     * That objection is to gating on a JUDGEMENT. findDeclaredMiss is not one — it reads the
     * committed prose for the claim's own content words and for the three shapes an ordered event
     * takes when it is skipped, the way maxims, echo, anatomy and kinship all read the page. Free,
     * lexical, and it does not have an opinion.
     *
     * So every turn but the last spends itself regardless, exactly as before. The last one is given
     * again — at most GRACE_TURNS times — when the prose came back without the thing in it. The
     * deadline the player set still holds; what it stops meaning is "and then it is true whether or
     * not anybody saw it", which is the state that made a save's dialogue stop making sense. */
    const finalTurn = b.remaining <= 1;
    const missed = finalTurn && prose ? findDeclaredMiss(b.claim, prose) : null;
    if (missed && (b.grace ?? 0) < GRACE_TURNS) {
      b.grace = (b.grace ?? 0) + 1;
      b.stalled++;
      shifts.push(`"${short(b.claim)}" was due this turn and the prose came back without it, so the clock waits one more turn for it (${b.grace} of ${GRACE_TURNS})`);
      continue;
    }

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
      // AN HONEST LINE. "is true of this world now" reads as an achievement, and for a becoming that
      // stalled through its whole clock it is the opposite — the player is owed the fact that the
      // world never showed it and it landed on the calendar alone.
      shifts.push(b.moved
        ? `"${short(b.claim)}" is now true of this world, and every turn from here on follows it`
        : `"${short(b.claim)}" is now true of this world. Its clock ran out without the prose ever showing it, so the next turn has to`);
      continue;
    }
    const left = `${b.remaining} turn${b.remaining === 1 ? "" : "s"} to go`;
    shifts.push(r?.moved
      ? `the world moved toward "${short(b.claim)}" — ${left}`
      : `"${short(b.claim)}" didn't show up this turn, but it arrives on schedule anyway, ${left}`);
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
  return `\n\n=== WHAT THIS WORLD IS TURNING INTO, OR HAS ALREADY TURNED INTO (report on each one in becoming_progress) ===\n`
    + live.map((b) => `- "${b.claim}"`).join("\n")
    + `\nFor each line, copy its text into "claim" and answer two questions about this turn only.\n`
    + `moved: did the world get noticeably closer to it? Did something happen, change, break or get done that brings it nearer? Judge by what the turn means, whatever words it used. A claim about buildings is moved by a wall going soft, a street being closed, or somebody's ceiling coming down. A turn that only mentioned it, worried about it or talked about it didn't move it, but a turn that showed it happening somewhere did.\n`
    + `how: if it moved, the one thing that moved it, in a few words.\n`
    + `opposed: did the player act against it this turn, by trying to stop, reverse, prevent or undo it?\n`
    + `Report on every line, including the ones where nothing happened.`;
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
    .map((b) => `${b.claim}. This was asked for in the last ${b.stalled} turns and left out of all of them, and there ${b.remaining === 1 ? "is" : "are"} ${b.remaining} turn${b.remaining === 1 ? "" : "s"} left before it becomes simply true.`);
  if (!rows.length) return "";
  return `\n\nTHIS WAS ASKED FOR, AND THE TURNS CAME BACK WITHOUT IT.\n· ${rows.join("\n· ")}\n`
    + `The scenes that got written used up the space this was meant to have. `
    + `So write it first this turn: the thing happening, in the opening lines of the prose, before the conversation and before whatever the room was in the middle of. Then write the rest of the turn around it. `
    + `The clock kept running, so there's less time left, and what shows now should be as far along as the turns already used would have taken it.`;
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

  /* ── ARRIVED WITHOUT EVER REACHING THE PAGE ───────────────────────────────────────────────────
   *
   * The block below is written for a becoming the world grew into: it landed after some turns that
   * showed it, so treating it as old and beneath comment is right, and the only remaining job is to
   * stop anybody being startled by their own furniture.
   *
   * It was being applied to every arrival equally, including the ones the prose never once
   * rendered. From a save, the second of two becomings: `moved: 0, stalled: 3, turns: 3` — it
   * stalled on every turn of its life, the clock spent all three anyway because a deadline is a
   * deadline, and it entered canon. From that turn on the narrator was told these are "the water
   * these people have always swum in: old, unremarkable, and beneath comment", that "NOBODY IS
   * SURPRISED", and that they are "visible only in what people do without thinking about it".
   *
   * So the engine promoted an event the player never saw into a background condition, and then
   * forbade anybody from mentioning it. Every line after that is written against something that
   * has not happened on the page, which is the player's report: the dialogue stopped making sense.
   *
   * One clause did say "it shows in THIS scene" — inside a paragraph whose other four sentences
   * say do not announce it, do not remark on it, keep it beneath comment. The louder half wins.
   *
   * A becoming that never moved is not a condition of the world yet. It is an event that is now
   * TRUE and still owes its own rendering, and those need opposite instructions, so they are
   * separated. Nobody is startled by it either way — it is canon — but one of them has to be
   * visible before it can be assumed. */
  const unshown = here.filter((b) => !(b.moved ?? 0) && !(b.shown ?? 0));
  const grown = here.filter((b) => !unshown.includes(b));

  const owed = unshown.length
    ? `\n\n[TRUE OF THIS WORLD, BUT NEVER ONCE SHOWN IN THE PROSE.\n· ${unshown.map((b) => `${b.claim}. Its clock ran out on turn ${b.arrived_turn} without the prose ever showing it happen.`).join("\n· ")}\n`
      + `Each of these is now a fact of this world, so nobody is startled by it, nobody explains it, and nobody treats it as news. But the reader has never seen it either, so it can't be hinted at, taken for granted, or mentioned as something these people already understand between them. `
      + `Write it happening this turn, in the prose: the thing itself, in this room, involving the people who are actually here, at the start of the turn and before whatever else the scene was doing. Then carry on around it. `
      + `Show it plainly, because the reader has never seen it, and have people treat it as normal, because it already is.]`
    : "";

  if (!grown.length) return owed;

  const rows = grown.map((b) => `${b.claim}`);
  return owed + `\n\n[WHAT IS TRUE OF THIS WORLD NOW. Write the place as somewhere these things are ordinary.\n· ${rows.join("\n· ")}\n`
    + `To these people they're old news, unremarkable and not worth mentioning. `
    + `Nobody is surprised by them. Nobody comments on one, explains one, apologises for one, is startled or embarrassed by one, or treats it as something that has just started, because a character reacting to one as if it were new makes it look as though the world hasn't really changed. `
    + `Nobody announces them either. They aren't stated, quoted or described as facts. They only show in the things people do without thinking, the way anyone behaves about the ordinary conditions of their own life. `
    + `Each of these shows up somewhere in this scene, in a posture, a habit, the way something is arranged, something somebody reaches for or doesn't, or something that goes without saying between them. If the scene seems to have no room, make room, in one sentence if necessary.]`;
}
