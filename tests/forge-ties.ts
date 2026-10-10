/* Smoke test: THE CAST KNOWS EACH OTHER BEFORE TURN ONE.
 *
 * The forge was told to give the cast "friction with each other as well as with the player" and
 * put that friction in background prose. It filed exactly one edge per NPC, toward the player, so two
 * people written as estranged siblings started the game as strangers to every system that reads the
 * graph. The presets never had this problem: whoever wrote them wrote Kildare → Mara and Mara →
 * Kildare as two edges with two different feelings. `ties` lets the forge do the same. */
import { applyForgeTies, resolveCastName } from "../src/engine/ties";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s = newSave("Hollow Weir", { name: "Hollow Weir" } as any);
registerCharacter(s, { name: "Vex Dahl", character_id: "char_player" } as any);
const kildare = registerCharacter(s, { name: "Kildare Moss" });
const mara = registerCharacter(s, { name: "Mara Quill" });
const ossian = registerCharacter(s, { name: "Ossian Quill" });

/* ── 1. names resolve the way the forge writes them ───────────────────────────── */
check("a full name resolves", resolveCastName(s, "Mara Quill") === mara);
check("a unique first name resolves", resolveCastName(s, "kildare") === kildare);
check("a shared surname is not a first name", resolveCastName(s, "Quill") === null);
check("a name nobody has resolves to nothing", resolveCastName(s, "Denise") === null);

/* ── 2. ties become directed edges with roles and a dated note ────────────────── */
const log = applyForgeTies(s, [
  { from: "Kildare Moss", to: "Mara Quill", relation: "her neighbour on the Ray Deck", warmth: -10, trust: -20, note: "thinks her firmware games bring drones down on everyone" },
  { from: "Mara", to: "Kildare", relation: "his neighbour", warmth: 0, trust: 10, note: "finds his superstition useful cover" },
  { from: "Mara Quill", to: "Ossian Quill", relation: "his older sister", warmth: 55, trust: -30, note: "still has the boat he says she stole" },
  // the player is relation_to_player's job, never a tie
  { from: "Mara Quill", to: "Vex Dahl", relation: "friend", warmth: 80, trust: 80 },
  // nonsense the model sometimes emits
  { from: "Mara Quill", to: "Mara Quill", warmth: 90 },
  { from: "Denise", to: "Mara Quill", warmth: 40 },
  "a string, not an object",
  // a second word on a pair already filed does not overwrite the first
  { from: "Kildare Moss", to: "Mara Quill", warmth: 99, trust: 99 },
]);
const edge = (a: string, b: string) => s.world.edges.find((e) => e.from === a && e.to === b);
check("three real ties in, three edges filed", log.length === 3, log);
check("two directions, two feelings", edge(kildare, mara)?.warmth === -10 && edge(mara, kildare)?.trust === 10,
  [edge(kildare, mara), edge(mara, kildare)]);
check("a family tie carries its role, so kinship checks can see it", edge(mara, ossian)?.roles?.includes("sister") === true, edge(mara, ossian)?.roles);
check("and the note says what is behind the number", /boat he says she stole/.test(edge(mara, ossian)?.notes ?? ""), edge(mara, ossian)?.notes);
check("the note is dated, so it ages like any other", edge(mara, ossian)?.notes_turn === 1);
check("nothing toward the player came through ties", !s.world.edges.some((e) => e.to === "char_player" || e.from === "char_player"));
check("nobody is tied to themself", !s.world.edges.some((e) => e.from === e.to));
check("the first word on a pair stands", edge(kildare, mara)?.warmth === -10);

/* ── 3. a forge that returned no ties is a forge that returned no ties ────────── */
check("missing ties is not an error", applyForgeTies(s, undefined).length === 0);
check("values are clamped to the edge range", (() => {
  const t = newSave("x", { name: "x" } as any);
  const a = registerCharacter(t, { name: "Ann" }), b = registerCharacter(t, { name: "Bo" });
  applyForgeTies(t, [{ from: "Ann", to: "Bo", warmth: 500, trust: -500 }]);
  const e = t.world.edges.find((x) => x.from === a && x.to === b);
  return e?.warmth === 100 && e?.trust === -100;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
