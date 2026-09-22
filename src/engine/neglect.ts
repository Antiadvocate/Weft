/**
 * A WANT YOU KEEP SETTING ASIDE STOPS BEING A WANT AND BECOMES A WEIGHT.
 *
 * From the player who built this engine, describing his own afternoon: the cat is sick and that is
 * the day's job, then an email lands about his son's birthday and now there is a cake to buy, then
 * the cake needs decorations, then his mother needs collecting at a time already agreed — and by
 * nightfall the cat is still sick and he has no energy left, and the cat has been on the list the
 * whole time getting heavier.
 *
 * Four things in that the engine had no model for:
 *
 *  1. YOU DO NOT DO THE MOST IMPORTANT THING. You do the one the moment affords. The cake got done
 *     because a shop was open and it was buyable; the cat did not, because it was harder.
 *  2. HARD OUTRANKS IMPORTANT AT THE WRONG END. Past a certain weight, importance stops pulling you
 *     toward a thing and starts pushing you off it. The engine assumed the opposite everywhere.
 *  3. THE SET-ASIDE THING ACCRUES. "The hard task builds its own associated tension such that
 *     anytime it's remembered or recalled it can greatly shift your mental state."
 *  4. AND IT LANDS ON RECALL, NOT CONTINUOUSLY. You are fine until you walk past the cat.
 *
 * So: neglect is measured from the turn a want last actually MOVED (progress_turn, which exists
 * precisely because the bookkeeper restamps updated_turn every time it rewrites a blocker). Dread
 * accrues from that, faster for a want that is important and blocked. And it is charged as a drop
 * in openness only on the turn the scene RECALLS it — the person it needs walks in, or the place it
 * belongs to is where they are standing. Between those moments it costs nothing and sits there.
 *
 * This is also the honest answer to a toast the player found useless — "her wants have been skipped
 * 9 turns" — which the engine emitted as a warning every turn and which was suppressed as noise.
 * Skipping is not a fault. Nobody deals with the cat while they are buying the cake. What was
 * missing is that it should cost something by the time you get home.
 */
import type { SaveState, Identity, NPCDrive, Condition } from "./types";
import { clamp } from "./num";

/** Turns since this want last actually moved. Not since it was last written about. */
export function neglectOf(d: NPCDrive | undefined, turn: number): number {
  if (!d) return 0;
  const since = d.progress_turn ?? d.updated_turn ?? turn;
  return Math.max(0, turn - since);
}

/** Neglect after which a want has become a weight rather than a plan. */
const PATIENCE = 6;
/** Turns of neglect at which dread is at full strength. */
const SATURATES = 30;

/**
 * 0..1. How heavily this want is sitting on them.
 *
 * Weighted by priority and by whether it is BLOCKED, because a blocker is what makes a thing hard,
 * and hard is what gets set aside. A low-priority unblocked errand can go untouched for a month and
 * weigh nothing; that is correct, and it is why this is not simply a staleness counter.
 */
export function dreadOf(d: NPCDrive | undefined, turn: number): number {
  if (!d || d.progress >= 100) return 0;
  const n = neglectOf(d, turn);
  if (n <= PATIENCE) return 0;
  const ramp = Math.min(1, (n - PATIENCE) / (SATURATES - PATIENCE));
  const weight = clamp(((d.priority ?? 1) + (d.blocker ? 1.5 : 0)) / 4, 0.25, 1);
  return +(ramp * weight).toFixed(3);
}

/**
 * Does anything in the room bring it back to mind?
 *
 * The player's own phrasing: "some goals only appear when you're in the space itself, and if you
 * don't write it down then it vanishes until you come back to that space." A want names what it
 * needs — a person, a place, a thing — so the cheapest honest test of recall is whether the room
 * contains a word the want is built out of. Deliberately blunt: this decides when a feeling lands,
 * never what anybody does, so a miss costs one quiet turn and nothing else.
 */
export function recallOf(state: SaveState, goal: string): { by: string; strength: number } | null {
  const person = personRecall(state, goal);
  if (person) return { by: person, strength: 2 };
  const place = placeRecall(state, goal);
  // A PERSON IS A SHARPER PROMPT THAN A ROOM, and it has to score that way or a standing errand
  // about the room somebody is in outranks the hard thing they came here to say to the person in
  // front of them. You can act on a person. A place only reminds you.
  return place ? { by: place, strength: 1 } : null;
}

export function recalledBy(state: SaveState, goal: string): string | null {
  return recallOf(state, goal)?.by ?? null;
}

function placeRecall(state: SaveState, goal: string): string | null {
  const g = String(goal ?? "").toLowerCase();
  if (!g.trim()) return null;
  const here = state.world.places?.[state.world.player_location];
  // The SPACE recalls it, and a space is rarely referred to by its full registered name. A want
  // written "get the lobby desk cleared before six" is about the room somebody is standing in even
  // though the room is filed as "the Ritz lobby". Match on the naming words, skipping the ones that
  // name nothing.
  const STOP = new Set(["the", "a", "an", "of", "at", "in", "on", "and", "old", "new", "big", "little"]);
  for (const w of String(here?.name ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    if (new RegExp(`\\b${w}`, "i").test(g)) return here!.name;
  }
  return null;
}

function personRecall(state: SaveState, goal: string): string | null {
  const g = String(goal ?? "").toLowerCase();
  if (!g.trim()) return null;
  for (const id of ["char_player", ...(state.world.present ?? [])]) {
    const n = String(state.characters?.[id]?.name ?? "").split(/\s+/)[0];
    if (n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(g)) {
      return state.characters[id].name;
    }
  }
  return null;
}

/** What a neglected want has become, in words the narrator can put on a page. */
export function neglectCue(d: NPCDrive, turn: number): string {
  const dread = dreadOf(d, turn);
  if (dread < 0.25) return "";
  const n = neglectOf(d, turn);
  return dread >= 0.7
    ? `${n} turns of not dealing with it, and they no longer really intend to — they flinch off the subject, get short when it is near, and do the easy thing in front of them instead`
    : dread >= 0.45
      ? `${n} turns of putting it off; it now feels bigger than it really is, and they would rather be given something else to do`
      : `${n} turns of not getting to it, and they are aware of that`;
}

/**
 * Charge the recall. Called once a turn, before the narrator writes.
 *
 * Only for people in the room, only when something in the room names the want, only once per want
 * per recall — an active_state carries the fact so a want cannot be charged twice for standing in
 * the same lobby two turns running.
 */
export function tickNeglect(state: SaveState, turn: number): string[] {
  const log: string[] = [];
  for (const id of state.world.present ?? []) {
    const c: Identity | undefined = state.characters?.[id];
    const cond: Condition | undefined = state.condition?.[id];
    if (!c || !cond || c.status === "dead" || c.status === "departed") continue;
    const d = c.drive;
    if (!d) continue;
    const dread = dreadOf(d, turn);
    if (dread < 0.25) continue;
    const by = recalledBy(state, d.goal);
    if (!by) continue;
    const mark = `the thing they have not done`;
    const already = cond.psyche.active_states.includes(mark);
    if (already) continue;
    // "The more ignored, the harder it drops your comfort." Capped so a very old want cannot take
    // somebody from settled to shattered in one glance across a room.
    const drop = +(0.6 + dread * 2.2).toFixed(2);
    cond.psyche.relaxation = clamp(+(cond.psyche.relaxation - drop).toFixed(2), -10, 10);
    cond.psyche.active_states.push(mark);
    (cond.psyche.state_ages ??= {})[mark] = turn;
    log.push(`${c.name} is reminded of what they have been putting off, and it hits them.`);
  }
  return log;
}

/**
 * WHICH WANT THEY ACTUALLY TAKE UP THIS TURN.
 *
 * Not the most important one. "If you don't have the energy reserve, or you're caught up in a
 * current task, even if the current task priority is lower because it's easier, you might set the
 * hard one aside."
 *
 * So the ordering is: what the room affords, then what they can face, and importance only decides
 * between things that pass both. A person who is exhausted or badly clenched takes the easy thing
 * in front of them and leaves the heavy one where it is — which increases its neglect, which
 * increases its dread, which makes it harder to face next time. That loop is not a bug to damp; it
 * is the thing being modelled, and the way out of it is the story giving them a turn where the want
 * is both afforded and bearable.
 */
export function liveWant(state: SaveState, id: string, turn: number): { goal: string; why: string } | null {
  const c = state.characters?.[id];
  const cond = state.condition?.[id];
  if (!c?.drive) return null;
  const all = [c.drive, ...(c.drive_queue ?? [])].filter((d) => d && d.progress < 100);
  if (!all.length) return null;
  const spent = cond ? cond.fatigue === "exhausted" || cond.fatigue === "tired" || cond.psyche.relaxation <= -5 : false;
  const scored = all.map((d) => {
    const afforded = recallOf(state, d.goal)?.strength ?? 0;
    const dread = dreadOf(d, turn);
    // THE INVERSION. Below the line importance pulls; above it, weight pushes away, and having
    // nothing left to spend is what decides which side of the line somebody is on.
    //
    // The spent multiplier has to be able to beat the affordance bonus outright, and that is the
    // whole cat: walking past the thing you have been avoiding does not make you do it, it makes
    // you feel it and keep walking. At full dread a spent person scores the heavy want below an
    // errand even with the person it concerns standing in front of them. Rested, the same want with
    // the same person in the room wins easily — which is the story's way out of the loop.
    const push = spent ? dread * 4.5 : dread * 1.2;
    return { d, score: afforded + (d.priority ?? 1) * 0.5 - push };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;
  // WHY THEY PICKED IT, ANSWERED WITH THE DEEPER OF THE TRUE REASONS. A want can be both afforded
  // by the room and picked because the alternative is unfaceable, and "the room put it in front of
  // them" is the less interesting half of that: it does not tell the narrator somebody is dodging.
  const dread = dreadOf(top.d, turn);
  const dodging = scored.slice(1).some((x) => dreadOf(x.d, turn) > dread + 0.15);
  const why = spent && dodging
    ? `they do not have the energy for the harder one, and this is what they can face`
    : recalledBy(state, top.d.goal)
      ? `the room has put it in front of them`
      : `it is what they are on`;
  return { goal: top.d.goal, why };
}
