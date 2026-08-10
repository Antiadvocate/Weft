/** AUTHORED WANTS — changing a person by giving them something to want.
 *
 *  See AuthoredDrive in types.ts for why this exists and why it does not live in `drive`.
 *
 *  This module owns three things: the ladder a standing want climbs, the sentence the rest of the
 *  engine reads it as, and the moment it stops being a want and becomes part of the person.
 *
 *  Nothing here spends a token. Escalation is arithmetic on a turn counter; the world-sim and the
 *  narrator get the want in the same shape they already get every other want, and do what they were
 *  always going to do with it. That is the point — the injector is a manual entry point to
 *  machinery that already works, not a second pathway that has to be kept in step with the first. */
import type { AuthoredDrive, Identity, SaveState } from "./types";

/** IN-WORLD HOURS PER RUNG — not turns.
 *
 *  This was turn-counted, and calibrated against a story that runs for weeks. Real games do not:
 *  the save this was built against covered Day 1 to Day 3 in a hundred and eight turns, about a
 *  quarter of an hour of story per turn, and almost nothing on file has ever run past a week. A
 *  want that needed "a few weeks" to mature would simply never mature — it would sit at the bottom
 *  rung until the story ended.
 *
 *  Turns are also the wrong unit in principle. Ten turns is two hours of a slow conversation or
 *  three days across a montage, and a neighbour's late-night parties escalate on nights, not on how
 *  much the player happened to type. The clock already exists; this reads it.
 *
 *  Tuned so all three fit inside a story of a few days: fast lands within one, steady over a couple,
 *  slow needs most of a week and is the one to pick when the story is going to be long. */
const STEP_HOURS: Record<AuthoredDrive["rate"], number> = { slow: 40, steady: 16, fast: 6 };

/** Four rungs and no more. Past this it is not escalation any more, it is a different story, and the
 *  player can write that one themselves. */
export const MAX_STAGE = 3;

/** HOW HARD THEY ARE GOING AT IT, in words the world-sim can act on.
 *
 *  Generic on purpose. The goal is free text the player wrote — it can be parties, phone calls,
 *  showing up at the shop, leaving notes — so the ladder cannot describe the ACT, only the nerve.
 *  What changes across the rungs is how settled the person is in doing it and how much they now
 *  expect to get away with, which is exactly what separates a first attempt from a standing
 *  grievance, whatever the act happens to be. */
/* HABITUATION, NOT A SWITCH.
 *
 *  "When it hit the turn it's supposed to happen Dana randomly just... brought it up. The goal is
 *   that the personality aspect showcases itself in small ways leading to the emergent trait. So
 *   when it's like 10% shown, the trait might show that she's looking at doing something. The way
 *   humans build through habituation towards an eventual end... so when it does happen it's not a
 *   shock."
 *
 *  The old bottom rung read "the first time they have gone at it", which is already the ACT. So the
 *  ladder ran from doing-it-once to doing-it-always, and 10% meant "do it, tentatively" — which a
 *  model renders as raising it out of nowhere and then retreating. There was no rung for the part
 *  that matters: the weeks before a person does a thing, when they are circling it.
 *
 *  These four are now orientation → approach → attempt → habit. Only the third does the thing. The
 *  first two are what makes the third land as inevitable rather than random, and they are where a
 *  scene is actually built: noticing, positioning, testing the ground, the almost-ask that turns
 *  into something else. That is the ramp the player asked for. */
const NERVE = [
  "NOT DOING IT YET, and must not this scene. It is on their mind and nowhere else: they notice the openings for it, they position themselves near one, they let their attention go there and pull it back. Anyone watching closely would see only that something is occupying them. If they get close to raising it they change the subject themselves — the retreat IS the beat.",
  "CIRCLING IT. Still not the thing itself. They test the ground for it sideways: a joke that is nearly the subject, a question that would make sense if the answer were yes, a small liberty taken to see whether it is allowed. They are finding out what happens before they risk the real version, and a refusal here costs them almost nothing.",
  "THEY GO AT IT. The first real attempt, in the open, meant — and it should land as something the last several scenes were quietly building toward, not as a swerve. If nothing has been building, build it here and go at it NEXT time rather than making this the moment.",
  "SIMPLY WHAT THEY DO NOW. No approach, no working up to it; it is part of how they are with this person, and being refused would surprise them.",
];

/** HOW MUCH OF THIS IS SHOWING, 0.1 to 1.
 *
 *  With `inhabit_turns` set, escalation is a deterministic function of turns since the want was
 *  written: 10% immediately, full by the deadline, on a logarithmic curve so the first sign appears
 *  at once and the rest arrives on schedule. Without it, the four in-world-hour rungs are used and
 *  this reports where they sit.
 *
 *  The point of the turn budget is not that turns are the truer unit — they are not — but that a
 *  want you cannot see moving is indistinguishable from a want that is broken, and this engine has
 *  produced enough of the second that the first is not worth defending. */
export function intensity(a: AuthoredDrive, turn: number): number {
  if (a.inhabit_turns && a.inhabit_turns > 0) return 0.1 + 0.9 * elapsedFraction(a, turn);
  return Math.max(0.1, Math.min(1, ((a.stage ?? 0) + 1) / (MAX_STAGE + 1)));
}

/** How far through the budget, 0..1. */
function elapsedFraction(a: AuthoredDrive, turn: number): number {
  if (!a.inhabit_turns || a.inhabit_turns <= 0) return 0;
  return Math.max(0, Math.min(1, (turn - a.added_turn) / a.inhabit_turns));
}

/** WHERE ON THE RAMP, and the shape of the ramp is the whole feature.
 *
 *  The first version put the percentage on a logarithmic curve, because "escalating logarithmically"
 *  was what was asked for. That was a misreading, and it produced precisely the failure it was meant
 *  to fix: a log curve is steepest at the start, so two turns into a ten-turn budget the want was
 *  already at 55% and the ladder said GO AT IT. Dana brought it up out of nowhere, which is what
 *  prompted all of this.
 *
 *  Habituation is the other shape. Nearly HALF the window is spent not doing it at all — noticing
 *  the openings, changing the subject away from it. Then circling. The attempt belongs in the last
 *  quarter, by which point several scenes have quietly been about it and nobody is surprised. The
 *  displayed percentage stays linear so it visibly moves every single turn, which is what makes the
 *  thing checkable; it is the STAGE that waits. */
function rampStage(a: AuthoredDrive, turn: number): number {
  const p = elapsedFraction(a, turn);
  if (p >= 1) return 3;      // simply what they do now
  if (p >= 0.75) return 2;   // the first real attempt, in the last quarter
  if (p >= 0.45) return 1;   // circling it
  return 0;                  // not doing it yet, and must not
}

/** True when this person has a live authored want that should be acting on the world. */
export function hasAuthored(c: Identity | undefined): c is Identity & { authored: AuthoredDrive } {
  return !!c?.authored?.goal && !c.authored.crystallized_turn;
}

/** The want as one line, in the same grammar as every other want on the card.
 *
 *  Provenance is deliberately absent. The narrator must not be told a human typed this — told that,
 *  a model plays it as an instruction to satisfy rather than as something a person wants, and the
 *  result is a character who announces it and gets it over with. The Inspector shows the player
 *  their own hand; the prompt shows a want. */
export function authoredLine(a: AuthoredDrive, turn?: number): string {
  const i = turn === undefined ? undefined : intensity(a, turn);
  const stage = turn === undefined || !a.inhabit_turns
    ? Math.max(0, Math.min(MAX_STAGE, a.stage | 0))
    : rampStage(a, turn);
  const bits = [a.goal];
  if (a.approach) bits.push("goes at it by: " + a.approach);
  if (a.because) bits.push("started because: " + a.because);
  bits.push("where they are with it: " + NERVE[Math.max(0, stage)]);
  // A deadline is stated plainly so the escalation is legible rather than a vibe — and so that a
  // want written by the player is visibly ON A CLOCK rather than optional.
  if (i !== undefined && a.inhabit_turns) {
    bits.push(`${Math.round(i * 100)}% of the way to being simply how they are, and still climbing. Something of it is visible THIS scene at exactly that strength — no more. Below half that means it is only ever an inclination they have not acted on, and rushing to the act because a number is rising is the one way to get this wrong: the point is that by the time it happens nobody is surprised`);
  }
  return bits.join(" — ");
}

/** Every authored want in the cast, as the world-sim's `wantsOf` wants them: id → line. */
export function authoredWants(state: SaveState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player" || !hasAuthored(c)) continue;
    if (c.status === "dead" || c.status === "departed") continue;
    if (c.authored.paused) continue;
    out.set(id, authoredLine(c.authored, state.world.current_turn));
  }
  return out;
}

/** THE RATCHET.
 *
 *  Called once per turn. A standing want is standing whether or not the player was in the room, so
 *  the counter moves on turns rather than on witnessed events — the neighbour's Friday nights happen
 *  during the Tuesday you spent somewhere else. Paused wants hold where they are; a dead or departed
 *  character stops wanting anything.
 *
 *  Returns the lines worth telling the player about, in the same voice as the rest of the world-motion
 *  feed. Crossing a rung is the interesting moment and the only one that reports. */
export function tickAuthored(state: SaveState, minutesElapsed = 0): string[] {
  const log: string[] = [];
  const turn = state.world.current_turn;
  // A standing want stands through time, not through turns. A montage that skips two days moves it
  // two days; a turn spent staring at each other across a table barely moves it at all.
  const elapsed = Math.max(0, minutesElapsed);
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player") continue;
    const a = c.authored;
    if (!a?.goal || a.crystallized_turn) continue;
    if (c.status === "dead" || c.status === "departed") continue;
    if (a.paused) continue;

    // `acted` is in-world MINUTES the want has been standing, accumulated from the clock.
    a.acted = (a.acted ?? 0) + Math.max(0, elapsed);
    const step = 60 * (STEP_HOURS[a.rate] ?? STEP_HOURS.steady);
    const reached = Math.min(MAX_STAGE, Math.floor(a.acted / step));
    if (reached > (a.stage ?? 0)) {
      a.stage = reached;
      log.push(`${c.name} is further into it than they were: ${a.goal}.`);
    }
    // With a turn budget, "fully themselves" is the deadline, not an hours-based rung.
    if (a.inhabit_turns && turn - a.added_turn >= a.inhabit_turns) a.stage = MAX_STAGE;
    if (a.stage >= MAX_STAGE && a.crystallize && !a.crystallized_turn) {
      const t = crystallize(state, id, turn);
      if (t) log.push(`${c.name} does not think of it as a thing they started any more: ${t}.`);
    }
  }
  return log;
}

/** THE WANT BECOMES THE PERSON.
 *
 *  The endpoint the player was typing by hand at the start. A want carried at full stretch for long
 *  enough stops being something someone is doing and becomes something they are — which is the one
 *  honest way to write a core trait, because by the time it lands the story contains the evenings
 *  that earned it.
 *
 *  The want is retired in the same motion. Leaving both would double-count the person: a standing
 *  want driving the world-sim AND a trait describing the same behaviour, so every pass sees it twice
 *  and weights it twice. */
export function crystallize(state: SaveState, id: string, turn: number): string | null {
  const c = state.characters[id];
  const a = c?.authored;
  if (!c || !a?.goal || a.crystallized_turn) return null;

  const label = a.goal.trim().replace(/^(start|starts|begin|begins|try to|tries to)\s+/i, "").replace(/\.$/, "");
  const traits = (c.core_traits ??= []);
  if (!traits.some((t) => t.toLowerCase() === label.toLowerCase())) traits.push(label);

  (state.traits[id] ??= []).push({
    id: `authored_${turn}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    origin: a.because
      ? `${a.because} — and what started there became the way they live`
      : `did it once, then kept doing it, and stopped noticing they had decided anything`,
    behavioral_impact: `Acts on this without deliberating. It is not a plan they are executing; it is how their week is shaped.`,
    intensity: 7,
    self_weight: 0.6,
    last_reinforced_turn: turn,
    reinforcement_count: Math.max(1, Math.floor((a.acted ?? 0) / 3)),
  });
  a.crystallized_turn = turn;
  return label;
}

/** Knock a rung off — what the player reaches for when the character has been faced down and it
 *  should cost them something. At the bottom rung it stops rather than going negative: a want that
 *  has been opposed all the way back to nothing is a want to delete, and deleting it is a different
 *  button with different consequences. */
export function setback(a: AuthoredDrive, rate: AuthoredDrive["rate"] = a.rate): void {
  const step = 60 * (STEP_HOURS[rate] ?? STEP_HOURS.steady);
  a.stage = Math.max(0, (a.stage ?? 0) - 1);
  a.acted = a.stage * step;
}

/** A fresh authored want, with the fields the UI does not ask for filled in.
 *
 *  `acted` defaults to the floor of whatever stage was asked for rather than to zero. Starting a
 *  want at stage 2 and leaving the counter at 0 looks harmless and quietly means it must now serve
 *  the full climb again before it reaches 3 — the player would have set it high precisely because
 *  they did not want to wait. */
export function newAuthored(goal: string, turn: number, opts: Partial<AuthoredDrive> = {}): AuthoredDrive {
  const rate = opts.rate ?? "steady";
  const stage = Math.max(0, Math.min(MAX_STAGE, opts.stage ?? 0));
  return {
    goal: goal.trim().slice(0, 200),
    approach: opts.approach?.trim().slice(0, 200) || undefined,
    because: opts.because?.trim().slice(0, 240) || undefined,
    rate,
    stage,
    acted: Math.max(stage * 60 * (STEP_HOURS[rate] ?? STEP_HOURS.steady), opts.acted ?? 0),
    paused: opts.paused,
    inhabit_turns: opts.inhabit_turns && opts.inhabit_turns > 0 ? Math.round(opts.inhabit_turns) : undefined,
    crystallize: opts.crystallize ?? true,
    added_turn: opts.added_turn ?? turn,
  };
}
