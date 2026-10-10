/**
 * INSTITUTIONS — a faction that says something, as well as one that does something.
 *
 * A faction in Weft is a clock: an objective, segments, a consequence, visible signs, a knowledge
 * gate. It acts, and it never speaks. So the Church that is quietly buying up the valley's debts had
 * no public position for its priest to repeat, nothing for a crier to read out, and no difference
 * between what the institution says and what the man in its robes privately thinks — which is where
 * most of the drama of an institution lives.
 *
 * A social simulator this was lifted from treats organisations as speakers in their own right — an
 * official account with a stance and a way of handling controversy, separate from the people in it.
 * Here that becomes two fields on the clock and one on the person:
 *
 *   · public_line — the reason the faction gives out loud. `objective` stays what it is actually
 *     doing; the two are allowed to differ, and that difference is the point.
 *   · speaks_through — how the line reaches ordinary people (a notice, a sermon, a crier).
 *   · affiliation — which faction a person belongs to. knowledge.factionMembers has always read it
 *     first; nothing ever wrote it.
 *
 * The narrator is told when someone in the scene speaks for a faction, and what its line is. A
 * canvass can put a question to the faction itself and get the public voice back — built only from
 * what is public, so it cannot leak the objective it was never given.
 */
import type { SaveState, FactionClock } from "./types";
import { factionMembers } from "./knowledge";
import { clipText } from "./text";

/** Does this save record membership explicitly? A forge that writes affiliations writes them for
 *  members and leaves everyone else blank, so in such a save a blank means "belongs to nothing". */
function affiliationsRecorded(state: SaveState): boolean {
  return Object.values(state.characters ?? {}).some((c) => !!c?.affiliation?.trim());
}

/** People who belong to this faction. Explicit affiliations when the save has them. Otherwise the
 *  old name-match against backgrounds — which is loose (in a lakeshore camp, everyone whose
 *  background mentions the lake "belongs" to The lake ice), so it is only the fallback. */
export function membersOf(state: SaveState, faction: string): string[] {
  if (!affiliationsRecorded(state)) return factionMembers(state, faction);
  const key = faction.trim().toLowerCase();
  return Object.entries(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed" && c.affiliation?.trim().toLowerCase() === key)
    .map(([id]) => id);
}

/** The live faction this person belongs to, if any. */
export function factionOf(state: SaveState, id: string): FactionClock | null {
  const clocks = (state.world.clocks ?? []).filter((k) => k.status !== "fired" && k.faction?.trim());
  return clocks.find((k) => membersOf(state, k.faction).includes(id)) ?? null;
}

/** The narrator's line for a present character who speaks for a faction, or "" when they don't. */
export function speaksForLine(state: SaveState, id: string): string {
  const k = factionOf(state, id);
  if (!k?.public_line?.trim()) return "";
  return `  speaks for ${k.faction} in public, and its line is: "${clipText(k.public_line, 200)}". With others listening, they hold to that line; alone with someone they trust, they may say what they actually think of it`;
}

/** Factions that can be asked a question: running, named, and an institution — one with a public
 *  line, or with people in the cast who are recorded as belonging to it. A clock can be a winter or
 *  a flood; the ice has no spokesperson. */
export function askableFactions(state: SaveState): FactionClock[] {
  const seen = new Set<string>();
  return (state.world.clocks ?? []).filter((k) => {
    const key = k.faction?.trim().toLowerCase();
    if (!key || seen.has(key) || k.status === "fired") return false;
    seen.add(key);
    return !!k.public_line?.trim() || (affiliationsRecorded(state) && membersOf(state, k.faction).length > 0);
  });
}

/** Stage words for how far along a clock is, as an outsider would see it from the signs. */
function stage(k: FactionClock): string {
  const f = k.segments ? k.filled / k.segments : 0;
  return f === 0 ? "nothing of it shows yet" : f < 0.4 ? "the first signs are showing" : f < 0.75 ? "it is plainly under way" : "it is close to done";
}

/**
 * What the faction's public voice is built from. Deliberately NOT the objective or the consequence:
 * a voice that was never handed the private aim cannot let it slip, the same reason agency.ts cuts a
 * person's context to what they know rather than asking them to un-know the rest.
 */
export function institutionContext(state: SaveState, k: FactionClock): string {
  const members = membersOf(state, k.faction).map((id) => state.characters[id]?.name).filter(Boolean);
  const shown = k.visible_signs?.length ? k.visible_signs.slice(0, Math.max(1, Math.ceil(k.visible_signs.length * (k.filled / Math.max(1, k.segments))))) : [];
  return [
    `INSTITUTION: ${k.faction}.`,
    k.public_line?.trim() ? `What it says in public: ${k.public_line.trim()}` : `It has made no public statement. Answer from what anyone can see of it.`,
    k.speaks_through?.trim() ? `How it speaks to people: ${k.speaks_through.trim()}` : "",
    shown.length ? `What anyone can see it doing (${stage(k)}): ${shown.join("; ")}` : `What anyone can see: ${stage(k)}.`,
    members.length ? `People known to belong to it: ${members.join(", ")}.` : "",
    state.world.canon?.length ? `Common knowledge in this world: ${state.world.canon.slice(0, 6).join(" ")}` : "",
    state.world_bible?.era ? `Era: ${state.world_bible.era}.` : "",
  ].filter(Boolean).join("\n");
}
