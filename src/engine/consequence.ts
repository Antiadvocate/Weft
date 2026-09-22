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
import { clipText } from "./text";

export const ESTABLISH_COOLDOWN = 12;

/** The kinds of standing source a world can hold. `threat` is one flavour of demand, not the axis.
 *  Stored on the thread so the pressure selector can weight for spread instead of drawing whatever
 *  happens to be hottest — which, in a world whose only threads are threats, is always a threat. */
export type ThreadKind = "obligation" | "opportunity" | "relationship" | "institution" | "threat";

const SYSTEM = `You write the ordinary consequences of something that works.

The player has achieved something in this world. Don't punish it, undermine it or reveal a hidden cost. Write the ordinary effects that follow from something that works and that people now rely on: upkeep, who's in charge of it, the precedent it sets, people depending on it, envy, imitation, arguments over who controls it, people who now want the same thing or a share of it, and people whose position it quietly changed.

Write one or two ongoing threads. Each one has to be:
- Ordinary: everyday business that follows on from it, like who looks after it, who claims it, whose job it replaced, who has to be told, what the neighbours want now, and what precedent it sets that someone will point to later. Keep the cause ordinary, like an office, a claim, or a rule somebody has to apply.
- Specific to this achievement and to how this world actually works: its offices, its distances, its seasons, its customs, its people. Something that would read exactly the same in a different setting is wrong.
- About people. Say who wants what. Prefer people who are already in the cast. A new person is only allowed if the achievement clearly implies one, like an office that now needs someone in it.
- Slow. These sit in the world and develop over time. They don't need a response this turn, and several of them may never be resolved at all.

For "kind", pick whichever fits: obligation (upkeep, a duty, a promise to keep), opportunity (something that's now possible and wasn't before), relationship (how someone stands toward the player, or toward each other, has changed), or institution (an office, a rule or a group that now has to exist or respond). Don't use threat here, because threats are written somewhere else and aren't what a success produces.

For "tension", use 1 to 4. These start low. They aren't urgent and mustn't start out urgent, because a thread that starts at 7 is a crisis and belongs somewhere else.

Reply with only JSON: {"threads":[{"title":"","description":"","kind":"","tension":2}]}`;

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
      open.length ? `\nALREADY OPEN (don't duplicate or repeat these): ${open.map((t) => t.title).join("; ")}` : "",
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
        title: clipText(t.title, 120),
        description: clipText(t.description, 500),
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
