// KNOWLEDGE — who actually knows a thing, and by what route.
//
// The rumor system was a DIFFUSION engine with no SOURCE. `diffuseRumors` spreads what exists
// across the co-presence graph, correctly and cheaply, and nothing ever created the seeds: the
// only writer was the simulator's optional `rumors_new`, which in an eleven-turn save that
// included levitating forty men in public produced exactly zero entries. So every consumer
// downstream was starved, and the faction clock that decided Lord Áedán had "heard of a
// stranger" was reading from an empty table.
//
// Two changes here:
//   1. SEEDS ARE DETERMINISTIC. A character who witnessed something big already forms an
//      episodic memory with an importance score and source: "witnessed". That IS the seed. No
//      extra model call, no reliance on the simulator remembering to emit a field.
//   2. PROVENANCE IS RECORDED. Every hop stores who told whom, when, and where. So the question
//      "how does this guy even know?" has an answer you can print, and if the chain doesn't
//      exist, the engine can tell that it doesn't rather than assuming.
//
// Clocks then advance on KNOWLEDGE, not on pressure. A faction that has learned nothing new
// cannot be closing in on you, however tense the scene is.

import type { SaveState, Rumor, Identity } from "./types";
import { uid } from "./state";
import { minutesBetween } from "./time";

/** Importance at which a witnessed memory is worth repeating to someone else. */
export const GOSSIP_THRESHOLD = 7;

const words = (s: string) => (s || "").toLowerCase().match(/[a-z']{4,}/g) ?? [];
const STOP = new Set(["that", "this", "with", "from", "they", "them", "have", "been", "were", "what", "when", "will", "would", "there", "their", "about", "into", "than", "then", "some", "such", "only", "over", "very", "does", "made", "make", "take", "come", "went", "said", "know", "knows", "known"]);
const content = (s: string) => words(s).filter((w) => !STOP.has(w));

/** Overlap of distinctive words. Cheap, deterministic, good enough to ask "is this the same news?" */
export function topicMatch(a: string, b: string): number {
  const A = new Set(content(a)), B = new Set(content(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

// ── FACTION MEMBERSHIP ───────────────────────────────────────────────────────
// There is no membership table in the save — `faction` exists only as a string on the clock.
// So: an explicit `affiliation` when one has been set, otherwise a name match against the
// faction's distinctive words in the character's background. Áedán's Warband matches a man
// whose background says "a warrior in the warband of Lord Áedán".

export function factionMembers(state: SaveState, faction: string): string[] {
  const key = content(faction);
  if (!key.length) return [];
  const out: string[] = [];
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || c.status === "dead" || c.status === "departed") continue;
    const aff = (c as { affiliation?: string }).affiliation ?? "";
    const hay = `${aff} ${c.background ?? ""} ${(c.core_traits ?? []).join(" ")}`.toLowerCase();
    if (key.some((k) => hay.includes(k))) out.push(id);
  }
  return out;
}

/**
 * Has anyone in this world ever belonged to this faction — living, dead or departed?
 *
 * The knowledge gate exists to stop a faction acting on something nobody told it, and the example
 * it was written for is exact: "armed men who somehow knew about a stranger nobody had reported."
 * That is a gate on a faction of PEOPLE. Applied to a faction that has no people in the save at all
 * it says something different and false — that a body the player has never met cannot get on with
 * its own business until someone has gossiped about the player. A municipal works department does
 * not need to have heard of you to finish rewiring a substation.
 *
 * And the forge writes every clock at world creation, before a single character exists to match its
 * name, so `factionMembers` is empty for all of them and the gate closes on every clock in the game
 * from turn one. Twelve turns later the stall path rewrites the objective to "ordinary business" and
 * sets the status to stalled, which nothing anywhere sets back. That is the whole life of a faction
 * clock in this engine: invisible at 0, dead at 13.
 *
 * So the gate holds where it has meaning — a faction with members, none of whom knows anything, and
 * a faction whose members are all dead, which is the case it was written to protect. It stands down
 * for a faction that is pure offstage machinery, where there is nobody to be omniscient.
 */
export function factionEverInPlay(state: SaveState, faction: string): boolean {
  const key = content(faction);
  if (!key.length) return false;
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player") continue;
    const aff = (c as { affiliation?: string }).affiliation ?? "";
    const hay = `${aff} ${c.background ?? ""} ${(c.core_traits ?? []).join(" ")}`.toLowerCase();
    if (key.some((k) => hay.includes(k))) return true;
  }
  return false;
}

// ── SEEDING ──────────────────────────────────────────────────────────────────

/**
 * Turn this turn's big witnessed memories into rumors. Called once per turn, after memories land.
 *
 * A rumor is created only when a real person, who was really there, formed a real memory of it.
 * That is the whole point: kill every witness and no rumor exists, so nothing propagates and no
 * faction can act on it. The information path is the constraint, not a flavor note.
 */
export function seedWitnessRumors(state: SaveState, turn: number): string[] {
  const log: string[] = [];
  for (const [cid, mem] of Object.entries(state.memory ?? {})) {
    if (cid === "char_player") continue;
    const c = state.characters[cid];
    if (!c || c.status === "dead" || c.status === "departed") continue;
    for (const ep of mem.episodic ?? []) {
      if (ep.turn !== turn) continue;
      if ((ep.importance ?? 0) < GOSSIP_THRESHOLD) continue;
      if (ep.source && ep.source !== "witnessed") continue;   // hearsay doesn't re-seed as first-hand
      // already circulating?
      if (state.world.rumors.some((r) => !r.dead && topicMatch(r.content, ep.content) >= 0.5)) continue;
      const r: Rumor = {
        id: uid("rum"),
        content: ep.content.slice(0, 200),
        truth: "true",                                   // first-hand at birth; diffusion distorts it
        salience: Math.min(10, ep.importance ?? 7),
        origin_char: cid,
        knowers: [cid],
        born_turn: turn,
      };
      (r as Rumor & { path?: unknown[] }).path = [{ to: cid, from: null, turn, how: "witnessed", where: ep.where ?? null }];
      state.world.rumors.push(r);
      log.push(`${c.name} witnessed something worth repeating.`);
    }
  }
  return log;
}

/** Record a hop when diffusion moves a rumor to a new knower. */
export function recordHop(rumor: Rumor, from: string, to: string, turn: number, where?: string): void {
  const r = rumor as Rumor & { path?: { to: string; from: string | null; turn: number; how: string; where?: string | null }[] };
  (r.path ??= []).push({ to, from, turn, how: "told", where: where ?? null });
}

// ── THE GATE ─────────────────────────────────────────────────────────────────

export interface KnowledgeVerdict {
  knows: boolean;
  /** Readable chain, oldest hop first — this is what you print when you want to ask "how?" */
  chain: string[];
  /** Why it failed, when it failed. */
  gap?: string;
}

/**
 * Does this faction actually know enough to be pursuing this objective?
 *
 * Satisfied when some member of the faction holds a rumor, or a memory, whose subject overlaps
 * the clock's objective. Anything else — including a tense scene, a high pressure reading, or a
 * dramatic sense that the lord OUGHT to be closing in — is not knowledge and does not count.
 */
export function factionKnows(state: SaveState, faction: string, objective: string): KnowledgeVerdict {
  const members = factionMembers(state, faction);
  if (!members.length) {
    return { knows: false, chain: [], gap: `no living member of ${faction} exists in the world to have learned anything` };
  }
  const nameOf = (id: string | null | undefined) => (id ? state.characters[id]?.name ?? id : "no one");

  for (const m of members) {
    for (const r of state.world.rumors) {
      if (r.dead || !r.knowers.includes(m)) continue;
      if (topicMatch(r.content, objective) < 0.28) continue;
      const path = (r as Rumor & { path?: { to: string; from: string | null; turn: number; how: string; where?: string | null }[] }).path ?? [];
      const chain = path.length
        ? path.map((h) => h.how === "witnessed"
            ? `${nameOf(h.to)} saw it${h.where ? ` at ${h.where}` : ""} (turn ${h.turn})`
            : `${nameOf(h.from)} told ${nameOf(h.to)} (turn ${h.turn})`)
        : [`${nameOf(r.origin_char)} started it (turn ${r.born_turn})`, `it reached ${nameOf(m)}`];
      return { knows: true, chain };
    }
    // first-hand: a member who was there themselves needs no rumor
    for (const ep of state.memory?.[m]?.episodic ?? []) {
      if (topicMatch(ep.content, objective) < 0.28) continue;
      return { knows: true, chain: [`${nameOf(m)} was there — ${ep.when_label ?? `turn ${ep.turn}`}${ep.where ? `, at ${ep.where}` : ""}`] };
    }
  }
  return {
    knows: false,
    chain: [],
    gap: `${faction} has ${members.length} member(s) in play (${members.map(nameOf).join(", ")}) and none of them has witnessed or been told anything matching "${objective.slice(0, 60)}"`,
  };
}

/**
 * When a clock can't legitimately advance, it should not simply freeze forever — a faction with
 * real offscreen life is still doing SOMETHING, just not the thing that requires knowing about
 * you. This returns the objective the faction could pursue on what it actually knows, so the
 * clock is rewritten rather than fired on a fiction.
 *
 * Deterministic and deliberately mundane: routine business is the honest fallback for a faction
 * that has learned nothing. A surprising event should come from a chain the player can trace
 * backwards, not from the engine needing something to happen.
 */
// ── DISTANCE ────────────────────────────────────────────────────────────────
// Word does not teleport. Three separate times this engine has had a distant person hear about the
// player and reply inside a single day, and the last time it wrote a paragraph JUSTIFYING it —
// naming the distance as three days' ride in the same breath as explaining how the answer beat
// them home. A prompt line cannot fix that, because the narrator will always find a gallop and a
// change of horses. So the world records how far away a place is, and the engine answers the
// question instead.

/** Travel time in in-world minutes between two named places, when the world knows it. */
export function travelMinutes(state: SaveState, fromName: string, toName: string): number | null {
  const norm = (x: string) => (x || "").trim().toLowerCase();
  const table = (state.world as { distances?: { from: string; to: string; minutes: number }[] }).distances ?? [];
  const a = norm(fromName), b = norm(toName);
  for (const d of table) {
    if ((norm(d.from) === a && norm(d.to) === b) || (norm(d.from) === b && norm(d.to) === a)) return d.minutes;
  }
  return null;
}

/**
 * Could word have physically travelled from `fromName` to `toName` by now, given it started at
 * `sinceTime`? A round trip (they heard AND answered) needs twice the one-way time.
 *
 * Returns null when the world has no distance on record — unknown is not the same as false, and
 * the engine should not invent a constraint it has no basis for.
 */
export function wordCouldReach(
  state: SaveState,
  fromName: string,
  toName: string,
  sinceTime: string,
  roundTrip = false,
): { possible: boolean; needed: number; elapsed: number } | null {
  const one = travelMinutes(state, fromName, toName);
  if (one == null) return null;
  const needed = roundTrip ? one * 2 : one;
  const elapsed = minutesBetween(sinceTime, state.world.current_time);
  return { possible: elapsed >= needed, needed, elapsed };
}

/**
 * A STALL IS NOT A FUNERAL, AND IT HAD NO WAY BACK.
 *
 * When a faction has members and none of them knows anything, the clock's objective is rewritten to
 * ordinary business and its status set to "stalled" — which is honest, and was final. Every consumer
 * in the engine filters on `status === "running"`: beat selection, the headline, the digests handed
 * to the narrator and the bookkeeper, and the advance loop itself. Nothing anywhere set a clock back
 * to running except a player clicking "fire this clock" in the inspector. So the moment a faction's
 * information dried up for twelve turns, the storyline the forge wrote for it was over, permanently,
 * and the player was never told.
 *
 * Word arrives late all the time — that is what the rumor graph is FOR. When it does, the faction
 * picks up what it was doing. Run once a turn, costs nothing, and reports so the player sees it.
 */
export function reviveStalledClocks(state: SaveState): string[] {
  const log: string[] = [];
  for (const c of state.world.clocks ?? []) {
    if (c.status !== "stalled" || !c.original_objective?.trim()) continue;
    if (!factionKnows(state, c.faction, c.original_objective).knows) continue;
    c.objective = c.original_objective;
    delete c.original_objective;
    delete c.stalled_since;
    c.status = "running";
    log.push(`${c.faction} has heard something, and is back on what it was doing.`);
  }
  return log;
}

export function mundaneObjective(faction: string): string {
  return `${faction} goes about its ordinary business — collections, patrols, disputes, and its standing quarrels — with no knowledge of the player to act on.`;
}
