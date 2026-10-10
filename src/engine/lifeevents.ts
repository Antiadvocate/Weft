/**
 * LIFE EVENTS — the things that happen between other people while the player is somewhere else.
 *
 * Between scenes the engine already moves numbers: tickBonds drifts warmth and trust between
 * offstage pairs, hearsay moves opinions, wants tick toward done. What it never did was let any of
 * that ARRIVE anywhere. Two people could sit at mutual attraction 70 for a season and never be
 * together, a marriage could fall to warmth −40 and still be a marriage, two friends could have the
 * worst week of their lives at each other and still be listed as friends — because a role (partner,
 * friend, ex) only ever changed when the bookkeeper wrote it, and the bookkeeper only reads scenes.
 *
 * Neighborly — the reconstruction of Talk of the Town — runs these as life events: each one has
 * preconditions over the relationship graph and a set of weighted considerations that make it more
 * or less likely, and when one fires it changes the graph and leaves a record. This is that, small
 * and in Weft's units:
 *
 *   · get together — mutual attraction and warmth, neither already with someone
 *   · break up     — partners who have gone cold or stopped trusting each other
 *   · fall out     — friends, and one of them just took a hard turn against the other
 *   · make up      — a falling-out that the numbers have since walked back
 *
 * Rates are per in-world day and scaled by the time that actually passed, so a turn that costs
 * minutes almost never produces one and a week's time skip can. Never the player — the player's
 * relationships move in scenes, by what they do. Never anyone in the player's scene: what happens
 * in front of the player is the narrator's to write. Zero tokens. What fires becomes a memory for
 * both people, a rumour they carry, and a line in the offstage log the World tab and the record read.
 */
import type { SaveState, SocialEdge, Rumor } from "./types";
import { getEdge } from "./social";
import { uid } from "./state";
import { minutesBetween } from "./time";

// An ex is not a partner: "ex-wife" contains "wife", and reading it as one keeps a divorce married.
const PARTNER = /(?<!ex-)(?<!ex )\b(partner|spouse|wife|husband|girlfriend|boyfriend|fianc\w*|lover)\b/i;
const FRIEND = /\b(best friend|friend)\b/i;
/** No second event for the same pair inside this many in-world days. */
const PAIR_COOLDOWN_DAYS = 3;

export type LifeEventKind = "together" | "breakup" | "fallout" | "makeup";
export interface LifeEventRec { kind: LifeEventKind; a: string; b: string; turn: number; time?: string }

interface Candidate { kind: LifeEventKind; a: string; b: string; perDay: number }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function edgeOf(state: SaveState, a: string, b: string): SocialEdge | undefined {
  return state.world.edges.find((e) => e.from === a && e.to === b);
}
const rolesOf = (e?: SocialEdge) => (e?.roles ?? []).join(" ");

/** Is this person with anyone (other than `except`)? */
function attached(state: SaveState, id: string, except: string): boolean {
  return state.world.edges.some((e) => ((e.from === id && e.to !== except) || (e.to === id && e.from !== except))
    && e.from !== e.to && PARTNER.test(rolesOf(e)));
}

/** Every event the state currently makes possible, with how likely it is per in-world day. */
export function lifeCandidates(state: SaveState): Candidate[] {
  const ids = Object.entries(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c && c.status !== "dead" && c.status !== "departed"
      && !(state.world.present ?? []).includes(id))
    .map(([id]) => id).sort();
  const log = state.world.life_events ?? [];
  const out: Candidate[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    const ab = edgeOf(state, a, b), ba = edgeOf(state, b, a);
    if (!ab && !ba) continue;                                   // strangers have no life together
    const near = state.characters[a]?.location && state.characters[a]?.location === state.characters[b]?.location;
    const reach = near ? 1.5 : 0.6;
    const minAtt = Math.min(ab?.attraction ?? 0, ba?.attraction ?? 0);
    const minWarm = Math.min(ab?.warmth ?? 0, ba?.warmth ?? 0);
    const minTrust = Math.min(ab?.trust ?? 0, ba?.trust ?? 0);
    const partners = PARTNER.test(rolesOf(ab)) || PARTNER.test(rolesOf(ba));
    const friends = FRIEND.test(rolesOf(ab)) || FRIEND.test(rolesOf(ba));

    if (!partners && minAtt >= 40 && minWarm >= 25 && !attached(state, a, b) && !attached(state, b, a)) {
      out.push({ kind: "together", a, b, perDay: 0.15 * (0.3 + clamp01((minAtt - 40) / 60)) * reach * (minTrust >= 0 ? 1 : 0.5) });
    }
    if (partners && (minWarm <= -10 || minTrust <= -25)) {
      const depth = clamp01((-minWarm - 10) / 50) + clamp01((-minTrust - 25) / 50);
      out.push({ kind: "breakup", a, b, perDay: 0.08 * (0.5 + depth) });
    }
    const hardTurn = [ab, ba].some((e) => e?.swing && (e.swing.warmth ?? 0) <= -12);
    if (friends && hardTurn) {
      out.push({ kind: "fallout", a, b, perDay: 0.3 * reach });
    }
    const fellOut = [...log].reverse().find((r) => r.kind === "fallout" && ((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    if (fellOut && !friends && minWarm >= 20) {
      out.push({ kind: "makeup", a, b, perDay: 0.2 * reach });
    }
  }
  return out;
}

const WORDS: Record<LifeEventKind, (a: string, b: string) => { log: string; memA: string; memB: string; charge: string; weight: number }> = {
  together: (a, b) => ({ log: `${a} and ${b} have started seeing each other.`, memA: `${b} and I are together now.`, memB: `${a} and I are together now.`, charge: "giddy, nervous", weight: 7 }),
  breakup: (a, b) => ({ log: `${a} and ${b} are finished with each other.`, memA: `${b} and I are finished.`, memB: `${a} and I are finished.`, charge: "raw, done", weight: 8 }),
  fallout: (a, b) => ({ log: `${a} and ${b} have fallen out, and they aren't speaking.`, memA: `${b} and I fell out, and we aren't speaking.`, memB: `${a} and I fell out, and we aren't speaking.`, charge: "hurt, stubborn", weight: 7 }),
  makeup: (a, b) => ({ log: `${a} and ${b} have patched it up.`, memA: `${b} and I patched it up.`, memB: `${a} and I patched it up.`, charge: "relief", weight: 6 }),
};

const EX: Record<string, string> = { wife: "ex-wife", husband: "ex-husband", spouse: "ex", partner: "ex", girlfriend: "ex", boyfriend: "ex", lover: "ex", fiance: "ex", "fiancé": "ex", "fiancée": "ex", fiancee: "ex" };

function apply(state: SaveState, c: Candidate, turn: number): string {
  const ab = getEdge(state.world.edges, c.a, c.b), ba = getEdge(state.world.edges, c.b, c.a);
  const na = state.characters[c.a]?.name ?? c.a, nb = state.characters[c.b]?.name ?? c.b;
  const setRoles = (e: SocialEdge, f: (rs: string[]) => string[]) => { e.roles = [...new Set(f(e.roles ?? []))].slice(0, 4); if (!e.roles.length) e.roles = undefined; e.updated_turn = turn; };
  const nudge = (d: number) => { for (const e of [ab, ba]) e.warmth = Math.max(-100, Math.min(100, e.warmth + d)); };
  if (c.kind === "together") { setRoles(ab, (rs) => [...rs.filter((r) => !/^ex/.test(r)), "partner"]); setRoles(ba, (rs) => [...rs.filter((r) => !/^ex/.test(r)), "partner"]); nudge(5); }
  if (c.kind === "breakup") { for (const e of [ab, ba]) setRoles(e, (rs) => rs.map((r) => PARTNER.test(r) ? (EX[r.toLowerCase()] ?? "ex") : r)); nudge(-5); }
  if (c.kind === "fallout") { for (const e of [ab, ba]) setRoles(e, (rs) => rs.filter((r) => !FRIEND.test(r))); nudge(-8); }
  if (c.kind === "makeup") { for (const e of [ab, ba]) setRoles(e, (rs) => [...rs, "friend"]); nudge(5); }

  const w = WORDS[c.kind](na, nb);
  const where = state.world.places[state.characters[c.a]?.location ?? ""]?.name;
  for (const [id, content] of [[c.a, w.memA], [c.b, w.memB]] as const) {
    state.memory[id]?.episodic.push({
      turn, content, full_content: content, importance: w.weight, emotional_charge: w.charge,
      last_accessed_turn: turn, when_label: state.world.current_time, where, source: "witnessed",
    });
  }
  // News: they both know, and they will tell people. Carried by the rumour field from here.
  const rumor: Rumor = { id: uid("rum"), content: w.log, truth: "true", salience: w.weight, origin_char: c.a, knowers: [c.a, c.b], born_turn: turn,
    path: [{ to: c.a, from: null, turn, how: "witnessed", where: where ?? null }, { to: c.b, from: null, turn, how: "witnessed", where: where ?? null }] };
  state.world.rumors.push(rumor);
  if (state.world.rumors.length > 40) state.world.rumors = state.world.rumors.slice(-40);
  (state.world.offstage_log ??= []).push({ turn, time: state.world.current_time, what: w.log, place: where, actor: na });
  (state.world.life_events ??= []).push({ kind: c.kind, a: c.a, b: c.b, turn, time: state.world.current_time });
  if (state.world.life_events.length > 40) state.world.life_events = state.world.life_events.slice(-40);
  return w.log;
}

/**
 * Let the time that has passed do what it does. `elapsedMinutes` is how much in-world time this
 * call covers; omitted, it is measured from the last call (state.world.life_clock). At most one
 * event per call — a single evening does not hold two weddings and a divorce.
 */
export function runLifeEvents(state: SaveState, rng: () => number = Math.random, elapsedMinutes?: number): string[] {
  const now = state.world.current_time;
  let since: number;
  if (elapsedMinutes === undefined) {
    since = state.world.life_clock ? Math.max(0, minutesBetween(state.world.life_clock, now)) : 0;
    state.world.life_clock = now;
  } else {
    // A time skip says how long it covers. It also drops the clock, so the first turn after the skip
    // starts measuring again from where the skip left the world instead of counting the skip twice.
    since = Math.max(0, elapsedMinutes);
    state.world.life_clock = undefined;
  }
  if (since <= 0) return [];
  const turn = state.world.current_turn;
  const days = since / 1440;
  const log = state.world.life_events ?? [];
  const cooling = (a: string, b: string) => log.some((r) => ((r.a === a && r.b === b) || (r.a === b && r.b === a))
    && (r.time && now ? minutesBetween(r.time, now) < PAIR_COOLDOWN_DAYS * 1440 : turn - r.turn < 6));
  for (const c of lifeCandidates(state)) {
    if (cooling(c.a, c.b)) continue;
    const p = 1 - Math.pow(1 - Math.min(0.95, c.perDay), days);
    if (rng() < p) return [apply(state, c, turn)];
  }
  return [];
}
