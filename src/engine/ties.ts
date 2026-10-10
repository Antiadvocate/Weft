/**
 * TIES — the cast's relationships to each other, written down at the Forge as data.
 *
 * The forge has always been told to make "2 to 4 other characters who want real things and have
 * friction with each other as well as with the player", and it does: the friction is there, in the
 * background paragraphs. What it never produced was an EDGE. `api.forge` pushed one edge per NPC,
 * toward the player, and nothing else — so two NPCs the forge wrote as estranged siblings started the
 * game at warmth 0, trust 0, no roles: strangers, as far as every system that reads the graph knows.
 *
 * And a lot reads the graph. The remote rumour channel (social.ts, diffuseRumors) only opens between
 * people who hold a real bond, so at turn 1 of a forged world it has nothing to carry anything along.
 * tickBonds drifts offstage pairs from 0 by card compatibility, which knows nothing about the grudge
 * written into the backgrounds. Kinship checks (kinship.ts) look for kin roles on edges and found none.
 * The narrator's lateral-edge block had nothing lateral to show.
 *
 * The hand-built presets never had this problem, because whoever wrote them wrote the edges:
 * Kildare → Mara at −10/−20, "thinks her firmware games bring drones down on everyone", and Mara →
 * Kildare at 0/+10, "finds his superstition useful cover". Two directions, two different feelings.
 * This module lets the forge do the same: it returns `ties`, one entry per direction, and they are
 * filed exactly the way the presets file theirs.
 *
 * Deterministic and defensive — the model's names are resolved against the cast it just built, and
 * anything that does not resolve, names the player, or names the same person twice is dropped.
 */
import type { SaveState, SocialEdge } from "./types";
import { rolesFromRelation } from "./coerce";
import { clipText } from "./text";

export interface ForgeTie {
  from?: unknown;
  to?: unknown;
  relation?: unknown;
  warmth?: unknown;
  trust?: unknown;
  note?: unknown;
}

const clamp100 = (v: unknown) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));

/** Resolve a name the forge wrote to a cast member: exact full name first, then a unique first name. */
export function resolveCastName(state: SaveState, raw: unknown): string | null {
  const name = String(raw ?? "").trim().toLowerCase();
  if (!name) return null;
  const cast = Object.entries(state.characters ?? {});
  const exact = cast.find(([, c]) => c.name?.toLowerCase() === name || (c.aliases ?? []).some((a) => a.toLowerCase() === name));
  if (exact) return exact[0];
  const first = name.split(/\s+/)[0];
  const byFirst = cast.filter(([, c]) => (c.name ?? "").toLowerCase().split(/\s+/)[0] === first);
  return byFirst.length === 1 ? byFirst[0][0] : null;
}

/**
 * File the forge's `ties` as directed edges between cast members. Returns a log line per edge filed.
 * Never touches the player: a tie naming them is the job of relation_to_player, which the forge
 * already fills and which is held to the stricter "strangers unless the seed says otherwise" rule.
 */
export function applyForgeTies(state: SaveState, ties: unknown, turn = 1): string[] {
  const log: string[] = [];
  if (!Array.isArray(ties)) return log;
  const edges: SocialEdge[] = (state.world.edges ??= []);
  for (const t of ties as ForgeTie[]) {
    if (!t || typeof t !== "object") continue;
    const from = resolveCastName(state, t.from), to = resolveCastName(state, t.to);
    if (!from || !to || from === to) continue;
    if (from === "char_player" || to === "char_player") continue;
    if (edges.some((e) => e.from === from && e.to === to)) continue;   // first word on a pair stands
    const relation = String(t.relation ?? "").trim();
    const note = String(t.note ?? "").trim();
    const roles = rolesFromRelation(relation);
    edges.push({
      from, to,
      warmth: clamp100(t.warmth),
      trust: clamp100(t.trust),
      power: 0,
      roles: roles.length ? roles : undefined,
      notes: clipText([relation, note].filter(Boolean).join(": "), 140),
      notes_turn: turn,
      updated_turn: turn,
    });
    log.push(`${state.characters[from]?.name} → ${state.characters[to]?.name}${roles.length ? ` (${roles.join(", ")})` : ""}`);
  }
  return log;
}
