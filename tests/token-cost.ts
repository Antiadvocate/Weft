/* Smoke test: WHAT THE NARRATOR IS BILLED FOR EVERY TURN.
 *
 * Measured across a 121-turn save: 37,138 tokens per turn, of which the narrator's INPUT was 26,491
 * — 71% of everything. Output, the actual prose, was 0.7%. Twenty input tokens for every one out.
 *
 * The breakdown was the surprise:
 *
 *     narrator contract   14,455   55%     <- the rules document, sent every turn
 *     volatile digest      4,949   19%
 *     stable prefix        4,021   15%
 *     6 history pairs      2,058    8%
 *     delta + direction    1,008    4%
 *
 * All of that is cacheable and it was caching at 31%, because the contract and the anchored snapshot
 * were concatenated into ONE system message. Prefix caching works on prefixes: gluing a block that
 * never changes to a block that changes every few turns means they share a fate, and every re-anchor
 * threw away the cache on the rules too. Splitting them changes nothing about what the model is told
 * — only where the boundaries fall.
 *
 * Making it worse, `present:` was in the cache signature, so every entrance and exit rewrote a
 * 23,000-token prefix. Who is in the room is the most volatile field in the story and it was pinned
 * to the most expensive one. */
import { buildChatlogMessages } from "../src/llm";
import { newSave, registerCharacter } from "../src/engine/state";
import { deltaNote } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const CONTRACT = "THE NARRATOR CONTRACT. ".repeat(40);
const pairs = [{ user: "I sit down.", assistant: "She looks up." }];

/* ── the contract is its own block, so a re-anchor cannot evict it ───────────── */
{
  const a = buildChatlogMessages(CONTRACT, "SNAPSHOT AT TURN 6", pairs, "now", "deepseek/deepseek-v4-pro");
  const b = buildChatlogMessages(CONTRACT, "A COMPLETELY DIFFERENT SNAPSHOT AT TURN 12", pairs, "now", "deepseek/deepseek-v4-pro");
  check("the contract is message 0, alone", a[0].content === CONTRACT, String(a[0].content).slice(0, 60));
  check("and survives a re-anchor byte-identical", a[0].content === b[0].content);
  check("the snapshot is its own block", /WORLD STATE/.test(String(a[1].content)) && /SNAPSHOT AT TURN 6/.test(String(a[1].content)));
  check("and is the only thing a re-anchor rewrites", a[1].content !== b[1].content);
  check("the conversation still follows", a[2].role === "user" && a[3].role === "assistant" && a.at(-1)!.role === "user");
}
{
  // Anthropic pays for cache breakpoints explicitly rather than by prefix; both blocks get one
  const m = buildChatlogMessages(CONTRACT, "SNAP", pairs, "now", "anthropic/claude-sonnet-5");
  const marked = m.filter((x: any) => Array.isArray(x.content) && x.content.some((c: any) => c.cache_control));
  check("anthropic marks both stable blocks for caching", marked.length >= 2, marked.length);
}
{
  // appending a turn must leave everything before it untouched, or the whole scheme is pointless
  const one = buildChatlogMessages(CONTRACT, "SNAP", pairs, "turn 7", "deepseek/deepseek-v4-pro");
  const two = buildChatlogMessages(CONTRACT, "SNAP", [...pairs, { user: "I stand.", assistant: "She does not." }], "turn 8", "deepseek/deepseek-v4-pro");
  const shared = one.slice(0, -1).every((m, i) => JSON.stringify(m) === JSON.stringify(two[i]));
  check("a new turn appends and never rewrites what came before", shared);
}

/* ── presence is a delta now, measured against the anchor ────────────────────── */
function room(): SaveState {
  const s = newSave("cost", {
    name: "The Arrangement",
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa", character_id: "char_tessa" } as any);
  registerCharacter(s, { name: "John", character_id: "char_john" } as any);
  s.world.current_turn = 20;
  const pid = "loc_kitchen";
  s.world.places[pid] = { id: pid, name: "the kitchen", description_facts: "A table.", contains: [] } as any;
  s.world.player_location = pid;
  return s;
}
{
  // the case the old code could not express: someone left THREE turns ago, and the snapshot the
  // model is reading as law still has them standing in the room
  const s = room();
  s.context_anchor = { turn: 17, digest: "…", cast_sig: "x", present: ["char_tessa", "char_john"] };
  s.world.present = ["char_tessa"];
  s.world.present_prev = ["char_tessa"];      // nothing changed since LAST turn
  const d = deltaNote(s, "");
  check("someone who left before last turn is still reported gone", /GONE FROM THE SCENE/.test(d) && /John/.test(d), d.slice(0, 300));
}
{
  const s = room();
  s.context_anchor = { turn: 17, digest: "…", cast_sig: "x", present: ["char_tessa"] };
  s.world.present = ["char_tessa"];
  check("nobody gone means nothing said about it", !/GONE FROM THE SCENE/.test(deltaNote(s, "")));
}
{
  // an older save has no roster on its anchor — fall back to the previous behaviour, never crash
  const s = room();
  s.context_anchor = { turn: 17, digest: "…", cast_sig: "x" };
  s.world.present = ["char_tessa"];
  s.world.present_prev = ["char_tessa", "char_john"];
  const d = deltaNote(s, "");
  check("a save with no anchor roster still reports last turn's departures", /John/.test(d), d.slice(0, 300));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
