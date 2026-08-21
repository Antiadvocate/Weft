/* Smoke test: "Error after every response."
 *
 * A sixteen-turn save that could not take a seventeenth. The whole cause, from its memory ledger:
 *
 *     Vin beliefs[0] = {"confidence": 0.7, "formed_turn": 15, "evidence_turns": []}
 *
 * A belief with no belief in it. The reflection pass returned the scaffolding around a conviction —
 * a confidence, a turn, an empty evidence list — and no sentence; `content` came through undefined,
 * and JSON.stringify dropped the key entirely on the way to disk.
 *
 * From turn 15 onward, every turn rebuilds the memory digest, and beliefLine opened with
 *
 *     const text = content.length > 180 ? ... : content;
 *
 * so every turn read `.length` on undefined. In Safari that prints as "undefined is not an object
 * (evaluating 'e.length')", which names no file, no line and no variable, and there was no way to
 * clear the entry from inside the game. One malformed object from one model call, and the save was
 * finished.
 *
 * `strict: true` did not catch it and could not: `content` is typed string, and the value came off
 * a parsed save. Every ledger entry in this engine is model-authored and arrives the same way.
 *
 * So it is fixed in three places, because an entry this shape must not be able to end a playthrough
 * whichever of them it slips past: the writer refuses a belief with no sentence, the reader treats a
 * missing one as an empty line and drops it, and loading a save takes the bad entries back out —
 * which is the only route home for a save that already holds one.
 */
import { beliefLine, applyReflection, compactMemoryDigest, pruneEmptyMemories } from "../src/engine/memory";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const mem = (over: any = {}) => ({ episodic: [], core: [], beliefs: [], facts: [], ...over }) as any;

/* ── 1. the entry from the save ───────────────────────────────────────────────── */
{
  const THE_ENTRY = { confidence: 0.7, formed_turn: 15, evidence_turns: [] } as any;
  let threw = "";
  try { beliefLine(THE_ENTRY.content, new Map()); } catch (e: any) { threw = e?.message ?? "threw"; }
  check("reading it no longer throws", !threw, threw);
  check("...and it renders as nothing", beliefLine(THE_ENTRY.content, new Map()) === "");

  const m = mem({ beliefs: [THE_ENTRY, { content: "Miranda is the only one who says it straight.", confidence: 0.8 }] });
  let digest = "", boom = "";
  try { digest = compactMemoryDigest(m, "", 16, 6); } catch (e: any) { boom = e?.message ?? "threw"; }
  check("the digest builds with it in the ledger", !boom, boom);
  check("...printing the real belief", /says it straight/.test(digest), digest);
  check("...and not an empty slot beside it", !/\|\s*\|/.test(digest) && !/BELIEFS:\s*\|/.test(digest), digest);

  const onlyEmpty = mem({ beliefs: [THE_ENTRY] });
  check("a ledger of nothing but empties prints no BELIEFS line", !/BELIEFS/.test(compactMemoryDigest(onlyEmpty, "", 16, 6)));
}

/* ── 2. it is never written in the first place ────────────────────────────────── */
{
  const m = mem();
  applyReflection(m, [{ confidence: 0.7 } as any, { content: "   ", confidence: 0.9 } as any], 15);
  check("a belief with no sentence is not stored", m.beliefs.length === 0, m.beliefs);

  const m2 = mem();
  applyReflection(m2, [{ content: "Chloe will keep showing up whether or not she is asked.", confidence: 0.8 } as any], 15);
  check("a real one still is", m2.beliefs.length === 1, m2.beliefs);
  check("...stamped with the turn", m2.beliefs[0].formed_turn === 15);

  // the merge path reads the stored content too, and a legacy ledger may already hold a bad one
  const m3 = mem({ beliefs: [{ confidence: 0.7, formed_turn: 3 } as any] });
  let boom = "";
  try { applyReflection(m3, [{ content: "Miranda is waiting for him to say it first.", confidence: 0.8 } as any], 15); }
  catch (e: any) { boom = e?.message ?? "threw"; }
  check("merging against a legacy empty does not throw", !boom, boom);
  check("...and the new belief lands", m3.beliefs.some((b: any) => /waiting for him/.test(b.content ?? "")), m3.beliefs);
}

/* ── 3. a save already holding one becomes playable again ─────────────────────── */
{
  const state: any = { memory: {
    char_player: mem({
      beliefs: [{ confidence: 0.7, formed_turn: 15, evidence_turns: [] }, { content: "She means it.", confidence: 0.8 }],
      episodic: [{ content: "I dried the dishes while she talked.", turn: 2, importance: 3 }, { turn: 3, importance: 1 }],
      facts: [{ fact: "Gwen's dinner is on Friday.", turn: 3 }, { turn: 4 }],
      core: ["I fix things instead of saying them.", "", "   "],
    }),
    char_other: mem(),
  } };
  const removed = pruneEmptyMemories(state);
  check("every empty entry is counted", removed === 5, removed);
  const m = state.memory.char_player;
  check("the real belief is kept", m.beliefs.length === 1 && /She means it/.test(m.beliefs[0].content));
  check("the real memory is kept", m.episodic.length === 1);
  check("the real fact is kept", m.facts.length === 1);
  check("the real core line is kept", m.core.length === 1);
  check("a clean ledger is left alone", pruneEmptyMemories({ memory: { a: mem({ core: ["x"] }) } }) === 0);
  check("running it twice changes nothing", pruneEmptyMemories(state) === 0);
  check("a save with no memory at all is fine", pruneEmptyMemories({}) === 0);

  // a ledger whose arrays are missing entirely — an older or hand-edited save
  const odd: any = { memory: { a: { core: undefined, beliefs: undefined, episodic: undefined, facts: undefined } } };
  pruneEmptyMemories(odd);
  check("missing arrays become empty ones", ["core", "beliefs", "episodic", "facts"].every((k) => Array.isArray(odd.memory.a[k])));
  let boom = "";
  try { compactMemoryDigest(odd.memory.a, "", 1, 6); } catch (e: any) { boom = e?.message ?? "threw"; }
  check("...and the digest builds off it", !boom, boom);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
