/* Smoke test: CLEAR THE LOG WITHOUT LOSING THE STORY.
 *
 * `state.history` is two things at once — the transcript the player scrolls, and the recent-story
 * context that nearly every pass slices a tail off. So the only lever for cutting the context was
 * the Refresh Game button, which truncates history to the last beat: it takes the readable story
 * with it, and runs a memory-condensation call per character on the way.
 *
 * A boundary is the non-destructive half. `world.context_from_turn` marks where the models' view
 * begins; everything before it stays on the page, in the export and in the Chronicle, and simply
 * stops being fed forward. Nothing is deleted, so the line can be lifted again.
 *
 * The last beat stays on the models' side on purpose: a narrator handed no immediately preceding
 * turn writes the next one blind, which is a worse problem than a long context.
 */
import { contextHistory, clearedTurnCount } from "../src/engine/context";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(turns = 20): SaveState {
  const s = newSave("clear", { name: "Rome" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.current_turn = turns;
  s.history = Array.from({ length: turns }, (_, i) => ({
    turn: i + 1, kind: i === 0 ? "opening" : undefined,
    player_action: `did thing ${i + 1}`, narrator_prose: `prose for turn ${i + 1}`,
    summary: `turn ${i + 1}`, time_label: "Day 1, 09:00",
  })) as any;
  return s;
}

/** What the API action does, so this tests the real rule rather than a paraphrase. */
function clearLog(s: SaveState, restore = false): void {
  if (restore) { s.world.context_from_turn = undefined; return; }
  s.world.context_from_turn = Math.max(1, s.history.at(-1)?.turn ?? s.world.current_turn);
  s.context_anchor = undefined;
}

/* ── 1. with no line drawn, nothing changes at all ────────────────────────────── */
{
  const s = world();
  check("every turn is still context", contextHistory(s).length === s.history.length);
  check("and nothing is reported as cleared", clearedTurnCount(s) === 0);
}

/* ── 2. clearing cuts the context and keeps the story ─────────────────────────── */
{
  const s = world();
  const before = s.history.length;
  clearLog(s);
  check("the transcript is untouched", s.history.length === before, s.history.length);
  check("the models see only the last beat", contextHistory(s).length === 1, contextHistory(s).map((h) => h.turn));
  check("...and it is the last beat, so the next turn is not written blind",
    contextHistory(s)[0]?.turn === before, contextHistory(s)[0]?.turn);
  check("the count of what was cleared is reportable", clearedTurnCount(s) === before - 1, clearedTurnCount(s));
  check("the chatlog anchor is dropped, since it spanned the line", s.context_anchor === undefined);
}

/* ── 3. it is reversible, because nothing was destroyed ───────────────────────── */
{
  const s = world();
  clearLog(s);
  clearLog(s, true);
  check("the line lifts", contextHistory(s).length === s.history.length);
  check("and the whole story is context again", contextHistory(s)[0]?.turn === 1);
}

/* ── 4. the world is not touched — this is the log only ───────────────────────── */
{
  const s = world();
  s.world.threads = [{ id: "t1", title: "a thread", description: "", status: "active" } as any];
  s.world.consequences = [{ id: "c1", status: "pending" } as any];
  s.world.rumors = [{ id: "r1", content: "a rumor" } as any];
  const mem = (s.memory["char_player"] ??= { character_id: "char_player", core: [], episodic: [], beliefs: [], facts: [], knows: [] });
  mem.episodic.push({ turn: 2, content: "something remembered", importance: 5, emotional_charge: "", last_accessed_turn: 2 } as any);
  clearLog(s);
  check("threads survive", s.world.threads.length === 1);
  check("consequences survive", s.world.consequences.length === 1);
  check("rumors survive", (s.world.rumors ?? []).length === 1);
  check("memories survive", (s.memory["char_player"].episodic ?? []).length === 1);
  check("and the world clock is where it was", s.world.current_turn === 20);
}

/* ── 5. a fresh save with one turn cannot clear itself into nothing ───────────── */
{
  const s = world(1);
  clearLog(s);
  check("the only turn there is stays visible to the models", contextHistory(s).length === 1, contextHistory(s));
  check("and nothing is reported as cleared", clearedTurnCount(s) === 0);
}

/* ── 6. an empty save does not throw ──────────────────────────────────────────── */
{
  const s = world(0);
  check("no history is no context", contextHistory(s).length === 0);
  clearLog(s);
  check("clearing an empty log is harmless", contextHistory(s).length === 0 && clearedTurnCount(s) === 0);
}

/* ── 7. every pass that reads recent story goes through the boundary ──────────── */
{
  // The value of this is entirely in nothing being missed, so the wiring is asserted directly.
  const { readFileSync } = await import("node:fs");
  for (const f of ["turn.ts", "prompts.ts", "intent.ts", "witness.ts", "placedesc.ts"]) {
    const src = readFileSync(`src/engine/${f}`, "utf8");
    const raw = [...src.matchAll(/state\.history\.(slice\(-|at\(-1\))/g)].length;
    const bounded = [...src.matchAll(/contextHistory\(state\)/g)].length;
    check(`${f}: recent-story reads go through the boundary`, bounded > 0 && raw === 0, { raw, bounded });
  }
  // ...while the CHAPTER pass still reads the whole record: a chapter is what happened in the
  // story, not what the narrator is currently being shown.
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("chapter generation still sees the whole story", /state\.history\.filter\(\(h\) => h\.kind !== "opening" && h\.turn >= fromTurn\)/.test(turn));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
