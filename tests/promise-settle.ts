/* Smoke test: PROMISES DON'T FINISH.
 *
 * From one save, at turn 25, the ledger:
 *
 *   [open]   w2  made t5   Lucia → Rabi:  "Lucia will walk Rabi into the cookshop and stay as his
 *                                          guide in exchange for the gold."
 *   [open]   w2  made t8   Rabi → Clodia: "Payment for lodgings through the Ides and past them at
 *                                          five asses a night"
 *   [kept]   w2  made t10  Lucia → Rabi:  "Lucia will give Rabi a tour of the city…"
 *   [kept]   w1  made t11  Rabi → Lucia:  "Rabi will accompany Lucia on the walk…"
 *
 * Two of the four never closed, for two different reasons, and neither is a reason more prompting
 * would fix:
 *
 *   The first is a MISS with a structural cause. She walked him into the cookshop on turn 6 — the
 *   travel log says so. But the promise is COMPOUND: walk him in AND stay as his guide. There is no
 *   single turn that satisfies all of it, so no turn ever looks like the one that closed it, and it
 *   sat open for twenty turns while the player watched it in his journal.
 *
 *   The second is not a promise at all. "Payment for lodgings … at five asses a night" is a standing
 *   arrangement. No event can ever be the keeping of it, so no automatic route can ever close it.
 *
 * Both were still being handed to the bookkeeper every turn as live commitments, under a heading
 * that tells it a promise the player has already kept and that stays open is a bug the player sees.
 *
 * The engine cannot infer its way out of either. What it needs is a door.
 */
import { readFileSync } from "node:fs";
import { addPromise, resolvePromise, getEdge } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(turn = 25): SaveState {
  return {
    world: { current_turn: turn, current_time: "Day 1, 10:00 (Morning)", promises: [], edges: [], present: ["char_lucia"] },
    characters: {
      char_player: { character_id: "char_player", name: "Rabi", core_traits: [], conscience: 0.7 },
      char_lucia: { character_id: "char_lucia", name: "Lucia", core_traits: [], conscience: 0.7 },
      char_clodia: { character_id: "char_clodia", name: "Clodia", core_traits: [], conscience: 0.7 },
    },
    traits: {},
    memory: { char_player: { episodic: [] }, char_lucia: { episodic: [] }, char_clodia: { episodic: [] } },
  } as unknown as SaveState;
}

/** The API's settle path, without the storage layer. Mirrors lib/api.ts settlePromise. */
function settle(s: SaveState, id: string, outcome: "kept" | "broken" | "retired"): string {
  const p = (s.world.promises ?? []).find((x) => x.id === id)!;
  if (p.status !== "open") throw new Error(`already ${p.status}`);
  const log = outcome === "retired"
    ? (p.status = "retired", `Retired: "${p.text}"`)
    : resolvePromise(s, p, outcome, s.world.current_turn);
  p.settled_turn = s.world.current_turn;
  p.settled_by_hand = true;
  return log;
}

/* ── 1. the two that stalled, closed by hand ──────────────────────────────────── */
{
  const s = world();
  const compound = addPromise(s, "char_lucia", "char_player",
    "Lucia will walk Rabi into the cookshop and stay as his guide in exchange for the gold.", 2)!;
  const standing = addPromise(s, "char_player", "char_clodia",
    "Payment for lodgings through the Ides and past them at five asses a night", 2)!;
  check("both are on the ledger, open", [compound, standing].every((p) => p.status === "open"));

  settle(s, compound.id, "kept");
  check("the one she actually did can be marked kept", compound.status === "kept");
  check("and it moves the relationship, exactly as the engine would have",
    getEdge(s.world.edges, "char_player", "char_lucia").trust > 0,
    getEdge(s.world.edges, "char_player", "char_lucia"));
  check("...and the player remembers it happening", (s.memory.char_player.episodic ?? []).length === 1,
    s.memory.char_player.episodic);

  settle(s, standing.id, "retired");
  check("the standing arrangement can be retired", standing.status === "retired");
  check("and retiring costs nobody anything", !s.world.edges.some((e) => e.from === "char_clodia" || e.to === "char_clodia"),
    s.world.edges);
  check("nor writes anyone a memory of it", (s.memory.char_clodia.episodic ?? []).length === 0);
  check("both are marked as closed by hand", [compound, standing].every((p) => p.settled_by_hand === true));
  check("with the turn it happened", [compound, standing].every((p) => p.settled_turn === 25));
}

/* ── 2. a settled promise leaves every model's view ───────────────────────────── */
{
  const s = world();
  const a = addPromise(s, "char_player", "char_lucia", "Walk her home after the market", 1)!;
  const b = addPromise(s, "char_player", "char_clodia", "Pay for the room by the Ides", 2)!;
  const open = () => (s.world.promises ?? []).filter((p) => p.status === "open");
  check("two open", open().length === 2);
  settle(s, a.id, "kept");
  settle(s, b.id, "retired");
  check("neither is fed forward any more", open().length === 0, open().map((p) => p.text));
  check("but the record keeps them", (s.world.promises ?? []).length === 2);
}

/* ── 3. retiring is not keeping, and the ledger knows the difference ──────────── */
{
  // promiseHistory counts kept and broken to scale the next one. A retired promise must not read as
  // a kept one — closing the books on a standing arrangement is not a demonstration of reliability.
  const s = world();
  const r = addPromise(s, "char_player", "char_lucia", "Board and lodging at five asses a night", 2)!;
  settle(s, r.id, "retired");
  const next = addPromise(s, "char_player", "char_lucia", "Bring her the sealed letter from the Palatine", 2)!;
  settle(s, next.id, "kept");
  const afterRetire = getEdge(s.world.edges, "char_lucia", "char_player").trust;

  const t = world();
  const n2 = addPromise(t, "char_player", "char_lucia", "Bring her the sealed letter from the Palatine", 2)!;
  settle(t, n2.id, "kept");
  const clean = getEdge(t.world.edges, "char_lucia", "char_player").trust;
  check("a retired promise does not count toward a reliability record", afterRetire === clean, [afterRetire, clean]);
}

/* ── 4. breaking still costs, by hand as much as by engine ────────────────────── */
{
  const s = world();
  const p = addPromise(s, "char_player", "char_lucia", "Protect her brother, whatever it takes", 3)!;
  settle(s, p.id, "broken");
  const e = getEdge(s.world.edges, "char_lucia", "char_player");
  check("a broken vow lands hard", e.trust < -8, e.trust);
  check("and she remembers it", (s.memory.char_lucia.episodic ?? []).length === 1);
}

/* ── 5. nothing can be settled twice ──────────────────────────────────────────── */
{
  const s = world();
  const p = addPromise(s, "char_player", "char_lucia", "Walk her home after the market", 1)!;
  settle(s, p.id, "kept");
  const trustAfterFirst = getEdge(s.world.edges, "char_lucia", "char_player").trust;
  let threw = false;
  try { settle(s, p.id, "kept"); } catch { threw = true; }
  check("a second settle is refused", threw);
  check("and the relationship did not move twice",
    getEdge(s.world.edges, "char_lucia", "char_player").trust === trustAfterFirst);
}

/* ── 6. the mirror above is not the real function ─────────────────────────────
 *
 * settlePromise lives in lib/api.ts behind IndexedDB, so it cannot be called here and `settle` is a
 * paraphrase of it — which is worth exactly nothing if the two drift. Pin the shape of the real one
 * against its source: the three claims the sections above depend on. */
{
  const src = readFileSync("src/lib/api.ts", "utf8");
  const fn = src.slice(src.indexOf("settlePromise: async"), src.indexOf("FIRE A CLOCK NOW"));
  check("settlePromise exists", fn.length > 200 && fn.length < 4000, fn.length);
  check("it refuses anything not open", /if \(p\.status !== "open"\) throw/.test(fn), fn.slice(0, 400));
  const retiredBranch = fn.slice(fn.indexOf(`if (outcome === "retired")`), fn.indexOf("} else {"));
  check("retired sets the status directly", /p\.status = "retired"/.test(retiredBranch), retiredBranch);
  check("...and that branch never touches resolvePromise", !/resolvePromise/.test(retiredBranch), retiredBranch);
  check("kept and broken go through resolvePromise, the engine's own path",
    /resolvePromise\(s, p, outcome, s\.world\.current_turn\)/.test(fn));
  check("and both record that a hand closed it", /p\.settled_by_hand = true/.test(fn) && /p\.settled_turn = /.test(fn));

  // and the UI must not offer the buttons on something already settled
  const journal = readFileSync("src/views/Journal.tsx", "utf8");
  check("the Journal only offers them while open", /p\.status === "open" && \(/.test(journal));
  check("and offers all three ways out", /"kept"[\s\S]{0,200}"broken"[\s\S]{0,200}"retired"/.test(journal));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
