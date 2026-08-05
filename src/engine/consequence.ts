// ─────────────────────────────────────────────────────────────────────────────
// SUCCESSES MAKE WORK
//
// Threads only ever came from problems the simulator noticed. The world could
// push on the player; the player could not change the world in a way that made
// new work. So a playthrough where someone drains a town, wires it for light,
// walls it and rebuilds the keep ends up with a standing-source pool of exactly
// three items — a heretic, some rebels, a grain-tax riot — and the pressure
// selector rotates those three faithfully forever, because nothing the player
// accomplished ever entered the pool.
//
// That is also why "pressure" reads as harassment rather than as a world. Real
// consequence runs in both directions: a thing that works creates maintenance,
// jurisdiction, envy, precedent, dependence, and people who now want the same
// thing. None of that is a threat, all of it is demand, and demand is what the
// pressure controller should have been measuring all along.
//
// This pass looks at what the turn ESTABLISHED — canon added, places built,
// threads resolved, people raised up — and authors obligations from it. Not
// backlash: the point is not that every success is punished, it is that a
// success is load-bearing and things now rest on it.
//
// Rationed hard. It runs only on turns that established something durable, at
// most every ESTABLISH_COOLDOWN turns, and authors at most two. A world that
// spawns an obligation per turn is worse than one that spawns none.
// ─────────────────────────────────────────────────────────────────────────────

import type { SaveState, SimulatorDiff, Thread } from "./types";
import { buildMessages, complete, safeJson } from "../llm";
import { uid } from "./state";

export const ESTABLISH_COOLDOWN = 12;

/** The kinds of standing source a world can hold. `threat` is one flavour of demand, not the axis.
 *  Stored on the thread so the pressure selector can weight for spread instead of drawing whatever
 *  happens to be hottest — which, in a world whose only threads are threats, is always a threat. */
export type ThreadKind = "obligation" | "opportunity" | "relationship" | "institution" | "threat";

const SYSTEM = `You author the ORDINARY CONSEQUENCES OF SOMETHING WORKING.

The player has accomplished something in this world. Your job is not to punish it, undermine it, or reveal a hidden cost. Your job is the plain fact that a thing which works becomes load-bearing, and load-bearing things generate WORK: upkeep, jurisdiction, precedent, dependence, envy, imitation, disputes over who owns and who pays, people who now want the same thing or want a share of it, and people whose position the accomplishment quietly changed.

Author 1–2 standing threads. Each must be:
- ORDINARY. The dull business of a working world. Who maintains it. Who claims it. Who was made redundant by it. Which office has to be told. What the neighbouring holding now wants. What precedent it just set that someone will cite. NOT a betrayal, NOT a saboteur, NOT a hidden flaw, NOT anyone plotting against the player.
- SPECIFIC TO THIS ACCOMPLISHMENT and to this world's actual machinery — its offices, its distances, its seasons, its ranks, its money. A thing that would read identically in another setting is wrong.
- MADE OF PEOPLE. Name who wants what. Prefer people already in the cast; a new figure is allowed only if the accomplishment plainly implies one (an office that must now be staffed).
- SLOW. These sit in the world and mature. They do not demand a response this turn and several may never be resolved at all.

kind: pick the one that fits — obligation (upkeep, duty, a thing owed), opportunity (something now possible that wasn't), relationship (someone's standing toward the player or each other has shifted), institution (an office, a rule, a body that must now exist or respond). Do NOT use threat here; threats are authored elsewhere and are not what a success produces.

tension: 1–4. These start LOW. They are not urgent and must not begin urgent — a thread that opens at 7 is a crisis wearing a ledger's clothes.

Output ONLY JSON: {"threads":[{"title":"","description":"","kind":"","tension":2}]}`;

/** Did this turn establish something durable enough to rest weight on? */
export function establishedSomething(diff: SimulatorDiff): string {
  const parts: string[] = [];
  for (const c of diff.canon_add ?? []) parts.push(`Established as public fact: ${c}`);
  for (const p of diff.new_places ?? []) parts.push(`Built or opened: ${p.name} — ${p.description_facts}`);
  for (const t of diff.threads_update ?? []) {
    if (t.status === "resolved") parts.push(`Resolved: ${t.title}${t.description ? ` — ${t.description}` : ""}`);
  }
  return parts.slice(0, 6).join("\n");
}

/** Author obligations from what just worked. Never throws; a failure is simply a quiet world. */
export async function threadsFromSuccess(
  state: SaveState, diff: SimulatorDiff, action: string, prose: string,
): Promise<Thread[]> {
  try {
    const established = establishedSomething(diff);
    if (!established) return [];

    const turn = state.world.current_turn;
    const last = state.last_establish_turn ?? -999;
    if (turn - last < ESTABLISH_COOLDOWN) return [];

    const open = state.world.threads.filter((t) => t.status === "active");
    if (open.length >= 8) return [];   // a world with eight live threads does not need a ninth

    const cast = Object.values(state.characters)
      .filter((c) => c.character_id !== "char_player")
      .slice(0, 12)
      .map((c) => `${c.name}${c.current_goal ? ` — wants: ${c.current_goal}` : ""}`)
      .join("; ");

    const user = [
      `WORLD: ${state.world_bible.name} — ${state.world_bible.era}. ${state.world_bible.tone ?? ""}`,
      state.world.canon?.length ? `CANON: ${state.world.canon.slice(-14).join("; ").slice(0, 900)}` : "",
      `\nWHAT THE PLAYER JUST ESTABLISHED:\n${established}`,
      `\nHOW IT HAPPENED (this turn):\n${action}\n${prose.slice(0, 900)}`,
      cast ? `\nPEOPLE ALREADY IN THIS WORLD: ${cast}` : "",
      open.length ? `\nALREADY OPEN (do not duplicate or restate these): ${open.map((t) => t.title).join("; ")}` : "",
    ].filter(Boolean).join("\n");

    const msgs = buildMessages(SYSTEM, "", user, state.model_settings.simulator_model);
    const res = await complete(
      msgs, state.model_settings.simulator_model, state.model_settings.fallback_model,
      true, 900, { providerSort: "throughput" },
    );
    const out = safeJson<{ threads?: { title: string; description: string; kind: string; tension: number }[] }>(res.text, {});

    return (out.threads ?? [])
      .filter((t) => t?.title && t?.description)
      .slice(0, 2)
      .map((t) => ({
        id: uid("thr"),
        title: t.title.slice(0, 90),
        description: t.description.slice(0, 400),
        status: "active" as const,
        turn_started: turn,
        // Clamped low regardless of what came back. An obligation that opens hot is a crisis with
        // a ledger's vocabulary, and the whole point is that these mature slowly or never.
        tension: Math.max(1, Math.min(4, Math.round(t.tension ?? 2))),
        kind: (["obligation", "opportunity", "relationship", "institution"].includes(t.kind) ? t.kind : "obligation") as ThreadKind,
      })) as Thread[];
  } catch {
    return [];
  }
}
