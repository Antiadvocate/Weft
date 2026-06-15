/** Drive regeneration — NPC autonomy without an author.
 *
 *  A tracked character who has finished their drive (or never had one) is never
 *  left idle: seedDrive() reads their whole self — identity, traits, values, their
 *  edges (warmth/trust toward the player and toward others), the live threads, and
 *  the world's pressure palette — and hands them a concrete new want. It's
 *  deterministic and free, so nobody is ever stranded; the Simulator's
 *  `drives_update` then enriches it into something in-voice on the next tick.
 *
 *  Tracking is opt-in: the player follows a character in the Cast view, or the
 *  Simulator promotes one (diff.track) when a thread makes them matter. Untracked
 *  bit-players recede — no drive, no upkeep — until something elevates them. */
import type { Identity, SaveState } from "./types";

const pick = <T,>(xs: T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)];

/** Build a fresh drive for a character from their relational + narrative context. */
export function seedDrive(state: SaveState, id: string, rng: () => number = Math.random): { goal: string; progress: number; updated_turn: number } | null {
  const c = state.characters[id];
  if (!c) return null;
  const turn = state.world.current_turn;
  const nm = (x: string) => state.characters[x]?.name ?? x;

  // strongest feelings this character holds toward others (their outgoing edges)
  const out = state.world.edges.filter((e) => e.from === id && e.to !== id);
  const hottest = [...out].sort((a, b) => Math.abs(b.warmth) - Math.abs(a.warmth))[0];
  const coldest = [...out].sort((a, b) => a.warmth - b.warmth)[0];
  const distrusted = [...out].sort((a, b) => a.trust - b.trust)[0];

  const traits = (c.core_traits ?? []).map((t) => t.toLowerCase()).join(" ");
  const values = (c.values ?? []).map((t) => t.toLowerCase()).join(" ");
  const blob = `${traits} ${values} ${c.background ?? ""}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => blob.includes(w));

  const candidates: string[] = [];

  // 1) relational pulls — the engine of most autonomous behavior
  if (coldest && coldest.warmth <= -20) {
    if (has("protect", "guard", "loyal", "justice", "shield"))
      candidates.push(`keep ${nm(coldest.to)} from doing more harm`);
    if (has("venge", "ruthless", "cruel", "dark", "exploit", "calculating", "possessive"))
      candidates.push(`undermine ${nm(coldest.to)} before they become a problem`);
    candidates.push(`find out what ${nm(coldest.to)} is really doing`);
  }
  if (distrusted && distrusted.trust <= -20)
    candidates.push(`watch ${nm(distrusted.to)} from a careful distance`);
  if (hottest && hottest.warmth >= 25) {
    if (has("possessive", "control", "anchor", "obsess"))
      candidates.push(`make sure ${nm(hottest.to)} needs no one but them`);
    else candidates.push(`look out for ${nm(hottest.to)} without being asked`);
  }

  // 2) live threads they could insert themselves into
  for (const th of state.world.threads.filter((t) => t.status === "active")) {
    if (th.tension >= 4) candidates.push(`get to the bottom of ${th.title.toLowerCase()}`);
  }

  // 3) clocks still running — ambient stakes to push or resist
  for (const k of state.world.clocks.filter((k) => k.status === "running")) {
    if (has("protect", "justice", "guard", "detective", "law"))
      candidates.push(`disrupt ${k.faction}'s plans before they finish`);
  }

  // 4) trait/value-driven standing wants (always available, lowest priority)
  if (has("ambition", "power", "climb", "control")) candidates.push("expand their hold over the territory");
  if (has("justice", "detective", "law", "protect")) candidates.push("chase the case the others are ignoring");
  if (has("survi", "street", "thief", "cat")) candidates.push("line up the next score and stay unseen");
  if (has("heal", "doctor", "care", "mend")) candidates.push("tend to someone the city has written off");
  if (has("chaos", "wild", "unpredict")) candidates.push("stir something up just to see what breaks");
  candidates.push(`pursue what matters most to ${c.name} right now`);

  if (!candidates.length) return null;
  // weight toward the front (relational/thread goals) but keep it stochastic
  const idx = Math.min(candidates.length - 1, Math.floor((rng() ** 1.7) * candidates.length));
  return { goal: candidates[idx], progress: 0, updated_turn: turn };
}

/** Ensure every TRACKED, offscreen, idle character has a want. Returns world-motion lines. */
export function regenerateDrives(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || !c.tracked) continue;
    if (c.drive && c.drive.progress < 100) continue;       // already wanting something
    if (state.world.present.includes(id)) continue;        // in-scene; the narrator drives them
    const seeded = seedDrive(state, id, rng);
    if (!seeded) continue;
    c.drive = seeded;
    log.push(`${c.name} turns to something new: ${seeded.goal}.`);
  }
  return log;
}
