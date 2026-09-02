/**
 * SCHEDULE — the shape a person's week already had before the story turned up.
 *
 * Everything the engine knows about what somebody will do next is a WANT. Drives, authored wants,
 * epistemic pulls, faction objectives: all of them are things a character is trying to get, and all
 * of them are open-ended. Nothing in the model could say where a person simply HAS to be at nine on
 * a Tuesday, so nobody ever had to be anywhere. A character stood exactly where the last scene left
 * them until a model moved them, which produced two failures that look unrelated and are the same
 * one:
 *
 *   · A cast with jobs that never happen. A save whose central relationship was a woman with a
 *     shift at a bar had her at the player's flat at eleven on a weekday morning, at three in the
 *     afternoon, and at eight in the evening, on consecutive days, because "works at the bar" was a
 *     sentence in her background and the background is not a clock. Her employment existed only as
 *     something she could mention.
 *   · A world with no weekday. Nothing in the engine could tell Tuesday from Sunday, so every day
 *     ran the same way and the player could never plan around one — no "catch her before her
 *     shift", no "he'll be at the yard till six", no Friday that means anything.
 *
 * The fix is not a calendar app. It is one optional field per person, and three properties that
 * follow from it:
 *
 *   1. THEY KNOW WHAT IS COMING. The card carries the next thing on their day and how long they
 *      have, so a character can look at the hour, cut a conversation short, refuse an errand
 *      because it will not fit, or say they are free until five. This is the half that costs
 *      nothing and changes the most dialogue.
 *   2. THEY GO ON THEIR OWN. An offscreen character inside a block's hours is AT that block's
 *      place — the engine puts them there, deterministically, no tokens, no model asked. That is
 *      what makes a world where the market has stallholders at market hours and the yard has men in
 *      it at six.
 *   3. THE SCENE CAN COST THEM. When the person is in the room with the player, the engine never
 *      teleports them out of it — that is the vanishing-character bug this codebase has spent a lot
 *      of comments on. It hands the narrator a directive to write them leaving, and only if the
 *      scene has held them well past the hour does it act itself, and then it is late, and being
 *      late is a thing that happened to them.
 *
 * WEEKDAY AND WEEKEND come from engine/time.ts, which gives every save a week whether or not it has
 * a date (Day 1 is a Monday when the bible names no start_date). See weekdayIndex.
 *
 * Nothing here spends a token. The generator that WRITES a schedule from somebody's background is a
 * separate, optional model call — see engine/scheduleforge.ts — and once it has run, this file is
 * arithmetic on the world clock.
 */
import type { Identity, SaveState, Schedule, ScheduleBlock, ScheduleDays } from "./types";
import { absMinutes, clockLabel, dayOf, weekdayIndex, WEEKDAY_FULL } from "./time";
import { placeIntent } from "./places";
import { uid } from "./state";
import { clipText } from "./text";

/** Minutes past the hour a MANDATORY block is allowed to be held by a live scene before the engine
 *  stops waiting for the narrator to write the departure and writes it itself. Roughly two ordinary
 *  turns of story: long enough that a real goodbye can happen on the page, short enough that a shift
 *  is not silently abandoned because the conversation was interesting. */
export const LATE_GRACE_MIN = 30;
/** The same leash for an `expected` block — an hour and a half, i.e. the scene almost always wins. */
export const SOFT_GRACE_MIN = 90;
/** How far ahead a person is aware of their own day. Beyond this, the next thing is not on their
 *  mind and does not belong in the prompt; a character who mentions a shift nine hours out is a
 *  character reciting their card. */
export const HEADS_UP_MIN = 150;
/** Default commute when nothing in the world says how far it is. Fifteen minutes is "across town on
 *  foot" and is deliberately short: over-estimating means characters leave scenes too early. */
export const DEFAULT_TRAVEL_MIN = 15;

// ───────────────────────────── reading the week ─────────────────────────────

export function hasSchedule(c: Identity | undefined): boolean {
  return !!c?.schedule?.blocks?.some((b) => b?.what && !b.paused);
}

/** Does this block run on this day of the week? */
export function runsOn(days: ScheduleDays | undefined, wd: number): boolean {
  if (Array.isArray(days)) return days.map(Number).includes(wd);
  if (days === "weekdays") return wd >= 1 && wd <= 5;
  if (days === "weekends") return wd === 0 || wd === 6;
  return true;   // "daily", and anything a hand-edit left unreadable
}

/** How the day-spec reads on the card and in the prompt. */
export function daysLabel(days: ScheduleDays | undefined): string {
  if (Array.isArray(days)) {
    if (!days.length) return "never";
    return days.map(Number).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
      .map((d) => WEEKDAY_FULL[d].slice(0, 3)).join(" ");
  }
  if (days === "weekdays") return "weekdays";
  if (days === "weekends") return "weekends";
  return "every day";
}

/** How long the block lasts. An `end` at or before `start` runs past midnight; equal means a full
 *  day rather than a zero-length block nobody could ever be inside. */
export function blockMinutes(b: ScheduleBlock): number {
  const span = (Math.round(b.end) - Math.round(b.start) + 1440) % 1440;
  return span === 0 ? 1440 : span;
}

/** Minutes before the hour this person has to set out. An authored `travel_min` wins; otherwise a
 *  recorded distance between where they are and where they are due; otherwise the default. Read off
 *  `world.distances` directly rather than through turn.ts's travelMinutesBetween, which would make
 *  this module import the turn loop that imports it. */
export function travelFor(state: SaveState, b: ScheduleBlock, fromId?: string): number {
  if (Number.isFinite(Number(b.travel_min))) return Math.max(0, Math.round(Number(b.travel_min)));
  const from = state.world.places[fromId ?? ""]?.name?.trim().toLowerCase();
  const toId = existingBlockPlace(state, b);
  const to = state.world.places[toId ?? ""]?.name?.trim().toLowerCase() ?? String(b.where ?? "").trim().toLowerCase();
  if (from && to && from !== to) {
    for (const d of state.world.distances ?? []) {
      const f = String(d.from).trim().toLowerCase(), t = String(d.to).trim().toLowerCase();
      if ((f === from && t === to) || (f === to && t === from)) return Math.max(0, Math.round(d.minutes));
    }
  }
  return DEFAULT_TRAVEL_MIN;
}

/** The place this block names, if the world already has it. Never creates — see placeForBlock. */
export function existingBlockPlace(state: SaveState, b: ScheduleBlock): string | null {
  const ref = String(b?.where ?? "").trim();
  if (!ref) return null;
  if (state.world.places[ref]) return ref;
  const intent = placeIntent(state, ref, "schedule");
  return intent && "id" in intent ? intent.id : null;
}

/**
 * The place this block happens at, MINTED IF THE WORLD DOES NOT HAVE IT YET.
 *
 * Through the one gate (see engine/places.ts) like every other creation path, so a schedule that
 * says "the kitchen" folds into the house rather than becoming a sibling of it, and a schedule that
 * says "the tannery" gets a tannery. Returns null when the name is a room and there is nowhere to
 * fold it into — a block with no reachable place is inert rather than wrong.
 */
export function placeForRef(state: SaveState, where: string | undefined, what = ""): string | null {
  const ref = String(where ?? "").trim();
  if (!ref) return null;
  if (state.world.places[ref]) return ref;
  const intent = placeIntent(state, ref, "schedule");
  if (!intent) return null;
  if ("id" in intent) return intent.id;
  const id = uid("loc");
  state.world.places[id] = {
    id, name: clipText(ref, 80),
    description_facts: what.trim() ? `Where ${what.trim()} happens.` : "",
    contains: [], founding: false,
  };
  console.info(`[schedule] created "${ref}" for a standing commitment`);
  return id;
}

export function placeForBlock(state: SaveState, b: ScheduleBlock): string | null {
  return placeForRef(state, b?.where, b?.what ?? "");
}

export interface Occurrence {
  block: ScheduleBlock;
  day: number;        // the day number the block STARTS on
  leave: number;      // absolute minutes: when they have to set out
  start: number;      // absolute minutes
  end: number;        // absolute minutes (may fall on the next day)
}

/** This block's occurrence on a given day number, or null if it does not run that day.
 *
 *  `travelMin` is an escape hatch for the callers that walk nine days of one block at a time:
 *  the commute does not change from Tuesday to Wednesday, and working it out per day means running
 *  the gazetteer's fuzzy place match nine times for one answer. */
export function occurrenceOn(state: SaveState, b: ScheduleBlock, day: number, fromId?: string, travelMin?: number): Occurrence | null {
  const wd = weekdayIndex(`Day ${day}, 12:00`, state.world_bible?.start_date);
  if (!runsOn(b.days, wd)) return null;
  const start = (day - 1) * 1440 + Math.max(0, Math.min(1439, Math.round(b.start)));
  const travel = travelMin ?? travelFor(state, b, fromId);
  return { block: b, day, leave: start - travel, start, end: start + blockMinutes(b) };
}

/** What this character's week says about RIGHT NOW. */
export interface ScheduleRead {
  /** The block whose hours contain this moment — where they are supposed to be. */
  current?: Occurrence;
  /** A block whose hours (or travel window) have opened and which they have not set out for.
   *  `lateBy` is minutes past the start — negative while they are still inside the travel window,
   *  i.e. it is time to go but not yet time to be there. */
  pending?: Occurrence & { lateBy: number };
  /** The next thing on their day, whenever it is. */
  next?: Occurrence & { startsIn: number; leaveIn: number };
  /** Nothing running and nothing due within the heads-up window. */
  free: boolean;
}

/**
 * Read one person's week against the world clock.
 *
 * Looks one day BACK as well as forward, because a night shift that started at 22:00 yesterday is
 * the block containing four in the morning, and a schedule that could not express night work would
 * be a schedule for one kind of life.
 */
export function readSchedule(state: SaveState, id: string): ScheduleRead {
  const c = state.characters[id];
  const blocks = (c?.schedule?.blocks ?? []).filter((b) => b?.what && !b.paused);
  if (!blocks.length) return { free: true };

  const now = absMinutes(state.world.current_time);
  const today = dayOf(state.world.current_time);
  const at = c?.location;

  let current: Occurrence | undefined;
  let pending: (Occurrence & { lateBy: number }) | undefined;
  let next: (Occurrence & { startsIn: number; leaveIn: number }) | undefined;

  for (const b of blocks) {
    const travel = travelFor(state, b, at);
    // yesterday's occurrence can still be running; today's can be running or pending; the next
    // seven days cover "the next thing" for a block that runs once a week.
    for (let d = today - 1; d <= today + 7; d++) {
      const occ = occurrenceOn(state, b, d, at, travel);
      if (!occ) continue;
      if (now >= occ.start && now < occ.end) {
        if (!current || occ.start > current.start) current = occ;
      }
      if (b.excused_day === occ.day) continue;
      if (now >= occ.leave && now < occ.end && b.last_left_day !== occ.day) {
        const lateBy = now - occ.start;
        if (!pending || lateBy > pending.lateBy) pending = { ...occ, lateBy };
      }
      if (occ.leave > now) {
        const startsIn = occ.start - now, leaveIn = occ.leave - now;
        if (!next || occ.start < next.start) next = { ...occ, startsIn, leaveIn };
      }
    }
  }
  return { current, pending, next, free: !current && !pending && (!next || next.leaveIn > HEADS_UP_MIN) };
}

// ───────────────────────────── what the models are told ─────────────────────────────

const placeName = (state: SaveState, ref: string | null | undefined): string =>
  (ref && state.world.places[ref]?.name) || String(ref ?? "").trim() || "elsewhere";

/**
 * THE CARD LINE — this is the half that makes characters aware of their own day.
 *
 * One line, on the character sheet, beside their wants. It says what they are in the middle of,
 * what is coming and how long they have, and — when the next thing is not today — what tomorrow is,
 * because "it's Friday, I'm off tomorrow" is a whole register of ordinary conversation that the
 * engine could not previously produce a single sentence of.
 */
export function scheduleLine(state: SaveState, id: string): string {
  const c = state.characters[id];
  if (!hasSchedule(c)) return "";
  const r = readSchedule(state, id);
  const bits: string[] = [];
  const dur = (m: number) => (m >= 120 ? `${Math.round(m / 60)}h` : `${Math.max(1, Math.round(m))} min`);

  if (r.current) {
    const b = r.current.block;
    bits.push(`in the middle of ${b.what} at ${placeName(state, existingBlockPlace(state, b))} — until ${clockLabel(b.end)}, ${dur(r.current.end - absMinutes(state.world.current_time))} from now`);
  }
  if (r.pending) {
    const b = r.pending.block;
    const where = placeName(state, existingBlockPlace(state, b));
    bits.push(r.pending.lateBy >= 0
      ? `ALREADY DUE at ${where} for ${b.what} — ${dur(r.pending.lateBy)} past the hour and still here`
      : `has to set out for ${where} NOW (${b.what}, ${clockLabel(b.start)}${b.how ? `, ${b.how}` : ""})`);
  }
  if (r.next && !r.pending && r.next.leaveIn <= HEADS_UP_MIN) {
    const b = r.next.block;
    bits.push(`next: ${b.what} at ${clockLabel(b.start)} — sets out in ${dur(r.next.leaveIn)}${b.how ? ` (${b.how})` : ""}`);
  } else if (r.next && !r.current && !r.pending) {
    const b = r.next.block;
    const dayGap = r.next.day - dayOf(state.world.current_time);
    const when = dayGap <= 0 ? `at ${clockLabel(b.start)}` : dayGap === 1 ? `tomorrow at ${clockLabel(b.start)}` : `in ${dayGap} days`;
    bits.push(`free until then — next is ${b.what} ${when}`);
  }
  const wd = WEEKDAY_FULL[weekdayIndex(state.world.current_time, state.world_bible?.start_date)];
  const note = c?.schedule?.note?.trim();
  if (!bits.length) bits.push(`nothing on their week today (it is ${wd})`);
  return `  their day (${wd}): ${bits.join("; ")}${note ? ` — ${note}` : ""}`;
}

/**
 * THE PER-TURN DIRECTIVE — the only place the schedule is allowed to push on a live scene.
 *
 * A character standing in front of the player is never moved by the engine while there is still
 * room for the story to move them: a person who vanishes mid-conversation because a clock said so is
 * the exact failure that co-location presence and arrivals_pending were built to stop. So the
 * narrator gets told, plainly, that this person has somewhere to be and is aware of it — and the
 * instruction is written to leave the player's answer intact, because "she has to go to work" is a
 * situation, not a cutscene.
 *
 * It escalates: a heads-up while there is time, an active departure once the travel window opens,
 * and a flat statement of lateness after that. What it never does is decide FOR the player that the
 * character stays — staying is available, it just costs (see tickSchedule).
 */
/**
 * `guarded` — an intimate, dangerous or hushed turn (see register.ts). Only the HEADS-UP row below
 * is affected, and only its talking half. That row fires whenever anybody present is inside the
 * heads-up window before a scheduled block, and it says, among other things, "they may say how much
 * time they have". Nothing bounds how often, so a character with a work block ahead of them says it
 * every turn until they leave. On the save that prompted this the window covered a whole scene in a
 * shower and produced, in three consecutive turns of sex, "twenty minutes before I have to be a
 * professional person", "I've got like nineteen minutes", and "I have fourteen minutes".
 *
 * The hour is still real and the character still knows it — that is the point of the system, and
 * LATE and HAS-TO-SET-OUT are untouched, because a person who has to go really does go, mid-scene
 * and mid-sentence if that is what the schedule says. What stands down is only the licence to
 * narrate the countdown out loud, on the turns where saying it is the thing that breaks the scene.
 */
export function scheduleDirective(state: SaveState, presentIds: string[], guarded = false): string {
  const rows: string[] = [];
  for (const id of presentIds) {
    const c = state.characters[id];
    if (!c || id === "char_player" || !hasSchedule(c)) continue;
    if (c.status === "dead" || c.status === "departed") continue;
    const r = readSchedule(state, id);

    if (r.pending) {
      const b = r.pending.block;
      const where = placeName(state, existingBlockPlace(state, b));
      const how = b.how?.trim() ? ` They get there by: ${b.how.trim()}.` : "";
      const why = b.why?.trim() ? ` It is in their life because: ${b.why.trim()}.` : "";
      if (r.pending.lateBy >= 0) {
        const cost = b.rigidity === "mandatory"
          ? ` They are ${Math.round(r.pending.lateBy)} minutes late for something they cannot simply skip${b.stakes?.trim() ? `, and the cost is real: ${b.stakes.trim()}` : ""}. They go THIS TURN — the prose shows them going, mid-sentence if that is what it takes.`
          : ` They are ${Math.round(r.pending.lateBy)} minutes past when they meant to leave, and they know it.`;
        rows.push(`${c.name} — LATE FOR ${b.what.trim()} at ${where} (due ${clockLabel(b.start)}).${cost}${how}${why} Write the leaving as this person would do it, not as an announcement: what they pick up, who they cut off, what they say on the way out.`);
      } else {
        rows.push(`${c.name} — HAS TO SET OUT NOW for ${b.what.trim()} at ${where}, due ${clockLabel(b.start)}.${how}${why} They know the hour and they act on it themselves: they end what they are doing and go, this turn, without being asked and without waiting for permission. They may be sorry about it, brisk about it, or glad of the excuse. If the player gives them a real reason to stay, they can choose to stay, and staying COSTS THEM SOMETHING${b.stakes?.trim() ? ` (${b.stakes.trim()})` : ""}, which they weigh out loud or silently, but do not shrug off.`);
      }
      continue;
    }
    if (r.next && r.next.leaveIn <= HEADS_UP_MIN) {
      const b = r.next.block;
      rows.push(`${c.name} — knows they are due at ${placeName(state, existingBlockPlace(state, b))} for ${b.what.trim()} at ${clockLabel(b.start)}, and has about ${Math.round(r.next.leaveIn)} minutes before they have to leave. They are not going yet.${guarded
        ? ` They are also in the middle of something that the hour does not interrupt, and they do NOT say how much time they have — not the number, not a version of it, not a joke about it. It is not on the page this turn. They are where they are.`
        : ` It shapes what they are willing to start: they do not open anything long, they may say how much time they have, and the hour is somewhere in how they hold the conversation.`}`);
      continue;
    }
    if (r.current) {
      const b = r.current.block;
      const hereId = c.location;
      const dueId = existingBlockPlace(state, b);
      if (dueId && hereId && dueId !== hereId) {
        rows.push(`${c.name} — is supposed to be at ${placeName(state, dueId)} right now (${b.what.trim()}, until ${clockLabel(b.end)}) and is standing here instead. Somebody is covering for them, or nobody is, and they know which.`);
      }
    }
  }
  if (!rows.length) return "";
  return `\n[WHAT THESE PEOPLE HAVE TO DO TODAY — their own lives, running on their own clock, not the player's.
These are not suggestions the scene may override for being busy. A person with somewhere to be behaves like one, and the story does not get to pause their week.\n· ${rows.join("\n· ")}]`;
}

/** One clause for the offstage pass's cast list: where the week says this person is, right now.
 *  Without it, the world sim cheerfully writes a woman having a slow morning at home during the
 *  shift the engine has just put her at. */
export function scheduleDigestLine(state: SaveState, id: string): string {
  const c = state.characters[id];
  if (!hasSchedule(c)) return "";
  const r = readSchedule(state, id);
  if (r.current) return ` On the clock: ${r.current.block.what} at ${placeName(state, existingBlockPlace(state, r.current.block))} until ${clockLabel(r.current.block.end)}.`;
  if (r.pending) return ` Due right now at ${placeName(state, existingBlockPlace(state, r.pending.block))}: ${r.pending.block.what}.`;
  if (r.next && r.next.leaveIn <= HEADS_UP_MIN) return ` Due at ${placeName(state, existingBlockPlace(state, r.next.block))} for ${r.next.block.what} at ${clockLabel(r.next.block.start)}.`;
  return "";
}

// ───────────────────────────── the tick ─────────────────────────────

const OFFSCENE = "loc_offscene";

/** Take somebody out of the room the player is standing in, keeping the derived presence lists
 *  honest until the next rebuild. Only ever called for a departure the engine had to make itself —
 *  everything else moves people while nobody is looking at them. */
function dropFromScene(state: SaveState, id: string, from: string | undefined, to: string): void {
  state.world.present = (state.world.present ?? []).filter((x) => x !== id);
  const out = state.world.places[from ?? ""];
  if (out) out.contains = (out.contains ?? []).filter((x) => x !== id);
  const into = state.world.places[to];
  if (into && !into.contains.includes(id)) into.contains.push(id);
}

function remember(state: SaveState, id: string, content: string, importance: number, charge: string): void {
  const mem = (state.memory[id] ??= { character_id: id, core: [], episodic: [], beliefs: [], facts: [], knows: [] });
  mem.episodic.push({
    turn: state.world.current_turn,
    content: clipText(content, 280),
    importance,
    emotional_charge: charge,
    when_label: state.world.current_time,
    where: state.world.places[state.characters[id]?.location ?? ""]?.name,
    source: "witnessed",
    last_accessed_turn: state.world.current_turn,
  });
}

/**
 * THE WEEK, TICKED. Called once per turn, after the clock has moved. Returns world-motion lines.
 *
 * Three jobs, in this order:
 *
 *   1. PEOPLE NOBODY IS LOOKING AT GO WHERE THEY ARE SUPPOSED TO BE. An offscreen character inside a
 *      block's hours is at that block's place, and an offscreen character with nothing on is at
 *      home. This is the whole "they transition space on their own" mechanism and it is four lines
 *      of arithmetic: no model call, no travel simulation, no state machine for being on a bus.
 *   2. A SCENE THAT HAS HELD SOMEBODY TOO LONG STOPS HOLDING THEM. Only for blocks rigid enough to
 *      justify it, only well past the hour, and it writes the leaving into the world-motion log and
 *      into their memory so the next turn's prose has something to be continuous with.
 *   3. WHAT DIDN'T HAPPEN IS RECORDED. A block whose hours have passed with nobody in them is a
 *      missed shift: it is remembered by the person who missed it, and when it was something they
 *      could not afford to miss, the stated cost becomes a scheduled consequence like any other.
 *
 * The player is never moved, never made late, and never given a shift by this — the player's day is
 * the player's to spend. Only their consequences are the world's.
 */
/**
 * A SCHEDULED MOVE THAT LANDS SOMEBODY IN THE PLAYER'S ROOM IS AN ENTRANCE.
 *
 * arrivals_pending was queued in exactly one place — the drive-pursuit path, where somebody crosses
 * the map looking for the player. A schedule moves far more people than that, and queued nothing, so
 * a character whose shift started at the inn simply turned up in the next turn's PRESENT block
 * having never come through a door. A player: "characters will sometimes evaporate into the scene,
 * where they're just there all of a sudden, with zero prose about them entering."
 *
 * Safe to set here: tickSchedule runs after applyDiff has cleared the queue for this turn, so what
 * is queued now is read by the next turn's directive, which is the turn the entrance belongs in.
 */
function noteArrival(state: SaveState, name: string, dest: string): void {
  if (!name || dest !== state.world.player_location) return;
  const q = (state.world.arrivals_pending ??= []);
  if (!q.includes(name)) state.world.arrivals_pending = [...q, name].slice(-3);
}

export function tickSchedule(state: SaveState): string[] {
  const log: string[] = [];
  const now = absMinutes(state.world.current_time);
  const today = dayOf(state.world.current_time);
  const turn = state.world.current_turn;
  const tension = state.model_settings?.tension ?? 5;

  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player" || !c) continue;
    if (c.status === "dead" || c.status === "departed") continue;
    const sched = c.schedule;
    if (!sched?.blocks?.length) continue;
    const present = (state.world.present ?? []).includes(id);
    const r = readSchedule(state, id);

    // ── THE SCENE IS HOLDING THEM, and that is the fact everything below turns on.
    //
    // Without this the tick cannot tell two situations apart that look identical once the hour has
    // passed: a woman who was standing in front of the player while her shift started, and a woman
    // nobody has looked at since Tuesday whose shift the clock skipped over during a montage. The
    // first missed work. The second went to work — there was nobody there to stop her, and the
    // engine assuming otherwise would hand out a missed shift for every time-skip in the game.
    if (r.pending && present) r.pending.block.held_day = r.pending.day;

    // ── MISSED AND FINISHED — settle every occurrence whose hours are now behind us.
    for (const b of sched.blocks) {
      if (!b?.what || b.paused) continue;
      const travel = travelFor(state, b, c.location);
      for (const d of [today - 1, today]) {
        const occ = occurrenceOn(state, b, d, c.location, travel);
        if (!occ || now < occ.end) continue;
        if (b.last_left_day === occ.day) {
          if (b.last_done_day !== occ.day) b.last_done_day = occ.day;
          continue;
        }
        if (b.excused_day === occ.day || b.last_missed_day === occ.day) continue;
        // Offscreen for the whole window and never held: they went, and nobody watched them go.
        if (b.held_day !== occ.day) { b.last_left_day = occ.day; b.last_done_day = occ.day; continue; }
        b.last_missed_day = occ.day;
        remember(state, id, `Did not go to ${b.what.trim()}${b.stakes?.trim() ? ` — ${b.stakes.trim()}` : ""}.`,
          b.rigidity === "mandatory" ? 6 : 4, b.rigidity === "mandatory" ? "exposed" : "flat");
        log.push(`${c.name} missed ${b.what.trim()}.`);
        // A COST THAT ONLY EXISTS ON THE CARD IS NOT A COST. When the player wrote down what missing
        // this does to them, it becomes a scheduled consequence — the same machinery a broken
        // promise or a filled faction clock discharges through, so it lands in a scene rather than
        // in a log nobody reads. Suppressed at tension 0, where the engine originates nothing.
        if (b.rigidity === "mandatory" && b.stakes?.trim() && tension > 0) {
          state.world.consequences.push({
            id: uid("cons"),
            description: `${c.name} missed ${b.what.trim()}: ${b.stakes.trim()}`,
            fire_turn: turn + 2,
            fire_time: `Day ${today + 1}, ${clockLabel(b.start)}`,
            severity: "minor",
            source_char: id,
            status: "pending",
          });
        }
      }
    }

    // ── THEY GO. Offscreen: silently, correctly, on time. In the room with the player: only once
    // the scene has held them long past the hour, and then it is a late departure, not a teleport.
    if (r.pending) {
      const b = r.pending.block;
      const dest = placeForBlock(state, b);
      if (dest && dest !== c.location) {
        const grace = b.rigidity === "mandatory" ? LATE_GRACE_MIN : b.rigidity === "expected" ? SOFT_GRACE_MIN : Infinity;
        const forced = present && r.pending.lateBy > grace;
        if (!present || forced) {
          // Before the hour itself they are on the road, not at the door — hold them where they are
          // until the block actually starts, so nobody arrives at work before work.
          if (r.pending.lateBy >= 0 || present) {
            const fromId = c.location;
            const from = state.world.places[fromId ?? ""]?.name;
            c.location = dest;
            c.paged = false;
            b.last_left_day = r.pending.day;
            if (forced) {
              b.last_late_day = r.pending.day;
              dropFromScene(state, id, fromId, dest);
              (state.world.departures_pending ??= []).push({
                name: c.name, to: placeName(state, dest),
                why: `${b.what.trim()} — ${Math.round(r.pending.lateBy)} minutes late for it by the time they got out of the door`,
              });
              state.world.departures_pending = state.world.departures_pending.slice(-3);
              remember(state, id, `Left late for ${b.what.trim()}${from ? ` — got held up at ${from}` : ""}.`, 5, "pressed");
              log.push(`${c.name} broke off and went to ${placeName(state, dest)} — late for ${b.what.trim()}.`);
              console.info(`[schedule] ${c.name} forced out of the scene ${Math.round(r.pending.lateBy)} min late for "${b.what}"`);
            } else {
              log.push(`${c.name} is at ${placeName(state, dest)} for ${b.what.trim()}.`);
            }
            noteArrival(state, c.name, dest);
          }
        }
      }
    } else if (!r.current && !present && sched.home) {
      // ── AND THEY GO HOME. A shift that ends at midnight used to leave its worker standing in the
      // dark tannery until the next thing in their week started, because nothing said where a person
      // is when they are not anywhere in particular.
      const home = placeForRef(state, sched.home, "");
      if (home && c.location && c.location !== home && c.location !== OFFSCENE) {
        // only just after a block ended — not every idle turn, or nobody could ever go anywhere else
        const justFinished = sched.blocks.some((b) => {
          if (!b?.what || b.paused) return false;
          for (const d of [today - 1, today]) {
            const occ = occurrenceOn(state, b, d, c.location, travelFor(state, b, c.location));
            if (occ && b.last_done_day === occ.day && now >= occ.end && now - occ.end <= 120) return true;
          }
          return false;
        });
        if (justFinished) {
          c.location = home;
          log.push(`${c.name} has gone home to ${placeName(state, home)}.`);
          noteArrival(state, c.name, home);
        }
      }
    }
  }
  return log;
}

// ───────────────────────────── construction & repair ─────────────────────────────

/** Minutes-since-midnight from anything a person or a model might write: 930, "9:30", "9:30am",
 *  "0930", "half past nine" is not attempted. Returns null when it cannot be read, so a bad field
 *  drops the block rather than putting somebody at work at 00:00 forever. */
export function parseClock(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.round(v);
    return n >= 0 && n < 1440 ? n : null;
  }
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  const m = /^(\d{1,2})[:.h]?(\d{2})?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + min;
}

/** A block with the fields the UI does not ask for filled in, and every field clamped.
 *
 *  `start`/`end` are widened to accept a clock string, because every caller that is not the engine
 *  itself has one: the editor's text field, the forge's JSON, a hand-edited save. Normalising here
 *  is the whole reason this function exists — the alternative is three parsers that disagree. */
export function newBlock(
  b: Omit<Partial<ScheduleBlock>, "start" | "end"> & { what: string; where: string; start?: number | string; end?: number | string },
): ScheduleBlock {
  const start = parseClock(b.start) ?? 9 * 60;
  const end = parseClock(b.end) ?? (start + 8 * 60) % 1440;
  return {
    id: b.id ?? uid("blk"),
    what: clipText(b.what, 160),
    why: clipText(b.why, 320) || undefined,
    where: clipText(b.where, 100),
    how: clipText(b.how, 160) || undefined,
    travel_min: Number.isFinite(Number(b.travel_min)) ? Math.max(0, Math.min(600, Math.round(Number(b.travel_min)))) : undefined,
    start, end,
    days: normalizeDays(b.days),
    rigidity: b.rigidity === "mandatory" || b.rigidity === "optional" ? b.rigidity : "expected",
    stakes: clipText(b.stakes, 280) || undefined,
    paused: b.paused || undefined,
    last_left_day: b.last_left_day, last_done_day: b.last_done_day,
    last_missed_day: b.last_missed_day, last_late_day: b.last_late_day,
    held_day: b.held_day, excused_day: b.excused_day,
  };
}

/**
 * A WEEK WRITTEN AT NOON DOES NOT START THIS MORNING.
 *
 * Without this, writing "the early shift, 08:00" onto somebody at ten past ten makes them instantly
 * two hours late for a shift that did not exist when it began — and two hours is well past the
 * grace, so the first thing the feature would do is walk them out of the scene the player was in
 * the middle of, with no directive ever having been shown. The same goes for a schedule the forge
 * writes mid-afternoon.
 *
 * Today's occurrence is therefore excused for any block whose hour has already gone by when it is
 * written. Nothing is lost: it comes round again tomorrow, on its own, having cost nobody anything.
 */
export function excuseElapsedToday(state: SaveState, b: ScheduleBlock, fromId?: string): void {
  const today = dayOf(state.world.current_time);
  const occ = occurrenceOn(state, b, today, fromId);
  if (occ && absMinutes(state.world.current_time) >= occ.start) b.excused_day = today;
}

export function normalizeDays(d: unknown): ScheduleDays {
  if (Array.isArray(d)) {
    const days = [...new Set(d.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
    return days.length ? days : "daily";
  }
  const s = String(d ?? "").trim().toLowerCase();
  if (s === "weekdays" || s === "weekday") return "weekdays";
  if (s === "weekends" || s === "weekend") return "weekends";
  return "daily";
}

/**
 * HEAL A HAND-EDITED WEEK, on load.
 *
 * The schedule is exposed in the raw JSON editor along with everything else, and the same reasoning
 * that put a coercion pass on threads applies here with more force: this one runs arithmetic on
 * every turn, and a block with a string where a number belongs would put a character at NaN o'clock
 * — which compares false against everything, so they would simply never go anywhere again, silently.
 */
export function healSchedule(c: Identity): Schedule | undefined {
  const s: any = c.schedule;
  if (!s || typeof s !== "object") return undefined;
  const blocks = (Array.isArray(s.blocks) ? s.blocks : [])
    .filter((b: any) => b && typeof b === "object" && String(b.what ?? "").trim() && String(b.where ?? "").trim())
    .map((b: any) => newBlock(b))
    .slice(0, 12);   // a week, not a rota system
  if (!blocks.length && !String(s.home ?? "").trim()) return undefined;
  return {
    blocks,
    home: clipText(s.home, 110) || undefined,
    note: clipText(s.note, 300) || undefined,
  };
}
