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
import { addPromise, resolvePromise, getEdge, promisedPlace, promiseEvidence, creditPromiseEvidence } from "../src/engine/social";
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

/* ── 6. THE ENGINE CLOSES IT ITSELF WHEN THE POINTING IS IGNORED ──────────────
 *
 * "I need to be able to keep it because I've done it multiple times, it remains open."
 *
 * The second-look pass had the mechanism exactly backwards. Measured on the save:
 *
 *   t5  "Lucia will walk Rabi into the cookshop and stay as his guide."   overlap 0.257  <- FIRES
 *   t6   the player ARRIVES at the cookshop; the prose opens "The cookshop
 *        was a narrow room with a low ceiling blackened by years of smoke"  overlap 0.127
 *   t7 … t12                                                         overlap 0.04 – 0.17
 *
 * The threshold is 0.25. It pointed at the promise on the turn it was CREATED — nothing to close,
 * words at their freshest — and went silent on the turn it was fulfilled and every turn after. A
 * turn that states a promise shares its vocabulary; a turn that keeps one describes an event. It
 * was reading the restatement.
 *
 * Meanwhile the decisive signal sat unused: the ledger says "the cookshop", the world has a place
 * called "A cookshop in the Subura", and the travel log has the player arriving there on turn 6. */
{
  const s = world(5);
  s.world.places = {
    loc_offscene: { id: "loc_offscene", name: "elsewhere", contains: [] },
    loc_cook: { id: "loc_cook", name: "A cookshop in the Subura", contains: [] },
    loc_lucia: { id: "loc_lucia", name: "The house of Lucia Aelia Severa", contains: [] },
    loc_sub: { id: "loc_sub", name: "The Subura", contains: [] },
  } as any;
  s.world.player_location = "loc_sub";
  const p = addPromise(s, "char_lucia", "char_player",
    "Lucia will walk Rabi into the cookshop and stay as his guide in exchange for the gold.", 2)!;

  check("the promise is read as being about reaching the cookshop",
    promisedPlace(s, p.text) === "loc_cook", s.world.places[promisedPlace(s, p.text) ?? ""]?.name);
  check("...and not the house of the woman doing the walking",
    promisedPlace(s, p.text) !== "loc_lucia");

  // t5: the turn it was made. This is what the old signal fired on, and it is not evidence.
  check("the turn a promise is made is never evidence it was kept",
    promiseEvidence(s, p, "I ask her to take me somewhere I can sleep", "She named a cookshop in the Subura.") === null);

  // t6-t8: he is standing in the cookshop and nobody closes it
  const tick = (turn: number) => {
    s.world.current_turn = turn;
    s.world.player_location = "loc_cook";
    return creditPromiseEvidence(s, "I look around", "The cookshop was a narrow room with a low ceiling.", turn);
  };
  check("arrival is evidence", (s.world.current_turn = 6, s.world.player_location = "loc_cook",
    promiseEvidence(s, p, "I look around", "a narrow room") === "arrival"));
  check("one turn is not enough", tick(6).length === 0 && p.status === "open");
  check("nor two", tick(7).length === 0 && p.status === "open");
  const closed = tick(8);
  check("three turns of it looking done, and the engine stops asking", p.status === "kept", p.status);
  check("and says plainly that it closed it, not the story",
    closed.length === 1 && /closed by the engine after 3 turns/.test(closed[0]), closed);
  check("marked as settled on evidence", p.settled_by_evidence === true && p.settled_turn === 8);
  check("with the turns it saw", JSON.stringify(p.evidence_turns) === "[6,7,8]", p.evidence_turns);
  check("and Lucia gets the trust for it", getEdge(s.world.edges, "char_player", "char_lucia").trust > 0);
}

/* ── 7. what the engine will NOT close for you ────────────────────────────────
 *
 * A VOW is never closed on evidence. "Protect your son", "never leave" — the keeping of one of
 * those is the arc, and a scene that looks like the keeping of it is just a scene where it held.
 *
 * And a STANDING ARRANGEMENT has no signal at all: "Payment for lodgings through the Ides and past
 * them at five asses a night" names no destination and no deliverable, so nothing can ever look
 * like the keeping of it. That one sat open for seventeen turns in the save and still would. It is
 * what the retire button is for, and this pins that the engine does not pretend otherwise. */
{
  const s = world(5);
  s.world.places = {
    loc_offscene: { id: "loc_offscene", name: "elsewhere", contains: [] },
    loc_villa: { id: "loc_villa", name: "The villa on the Caelian", contains: [] },
  } as any;
  const vow = addPromise(s, "char_player", "char_lucia", "Come back to the villa for her, whatever it costs", 3)!;
  const standing = addPromise(s, "char_player", "char_clodia",
    "Payment for lodgings through the Ides and past them at five asses a night", 2)!;
  for (const t of [6, 7, 8, 9, 10]) {
    s.world.current_turn = t; s.world.player_location = "loc_villa";
    creditPromiseEvidence(s, "I walk in", "The villa was quiet.", t);
  }
  check("a vow is never closed by the engine, however it looks", vow.status === "open", vow.status);
  check("...though the engine still watches it", (vow.evidence_turns ?? []).length >= 3, vow.evidence_turns);
  check("a standing arrangement gathers no evidence at all", (standing.evidence_turns ?? []).length === 0);
  check("and stays open, which is what the retire button is for", standing.status === "open");
}

/* ── 8. the arrival signal does not fire on a place merely mentioned ──────────
 *
 * "I'll pay you back when I reach Rome" names a place and is not a promise to go there. The verb
 * gate is what separates them, and it is deliberately tight — this is the direction in which a
 * false positive costs the player something, since arriving would close a debt that is still owed. */
{
  const s = world(5);
  s.world.places = {
    loc_offscene: { id: "loc_offscene", name: "elsewhere", contains: [] },
    loc_rome: { id: "loc_rome", name: "Rome", contains: [] },
    loc_forum: { id: "loc_forum", name: "The Forum Romanum", contains: [] },
  } as any;
  check("a debt that happens to name a place is not a promise to go there",
    promisedPlace(s, "I will pay you back the twelve denarii once I am rich in Rome") === null);
  check("but walking someone somewhere is", promisedPlace(s, "I will walk you to the Forum Romanum before dark") === "loc_forum");
  check("and so is returning with something", promisedPlace(s, "Return to the Forum Romanum with the bread") === "loc_forum");
}

/* ── 9. the mirror above is not the real function ─────────────────────────────
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
