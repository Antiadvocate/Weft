/* "THE NARRATOR LOVES CRAZY."
 *
 * It does not. It was being handed the strongest, most concrete, most emphatic instruction in the
 * character block and told to run it every turn, on more than one person at once, for the length of
 * a game.
 *
 * The hostile-desire branch is good writing and it is doing a real job — wanting somebody you
 * cannot stand is ordinary and the engine should be able to produce it. What it could not do was
 * treat it as rare. Entry was warmth ≤ −20 and attraction ≥ 30: mild dislike and mild interest.
 * Measured across one game's saves, over every edge toward the player carrying any attraction:
 *
 *   turn  19    0 of 1 in the quadrant
 *   turn  48    1 of 2      Emily (warmth −48, attraction 100)
 *   turn  83    2 of 3      Emily (−100, 95)   Olga (−28, 38)
 *   turn 108    1 of 3
 *   turn 168    1 of 3
 *
 * Olga, on numbers that describe a woman who finds you slightly irritating and slightly attractive,
 * was handed "contempt that keeps coming back for more of you". And Emily entered at turn 48 and
 * was still in it at 168 — a hundred and twenty consecutive turns of needling, standing too close,
 * and punishing him for a pull she will not own.
 *
 * The numbers drift there by themselves, which is the part that makes it structural rather than bad
 * luck: warmth slides down as a story gets rough, and attraction is held up by its own floors. Play
 * long enough and the cast walks into that quadrant one at a time and never walks out.
 *
 * So the bar now sits where the words are, there is a real intermediate band for the commoner
 * condition, and at most one person in the cast runs the extreme version at a time. */
import { desireLine } from "../src/engine/desire";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
type E = { from: string; warmth: number; attraction: number; roles?: string[] };
function world(...edges: E[]): SaveState {
  const characters: any = { char_player: { name: "Rabi" } };
  const condition: any = {};
  for (const e of edges) { characters[e.from] = { name: e.from[0].toUpperCase() + e.from.slice(1) }; condition[e.from] = { psyche: { relaxation: -6 } }; }
  return { characters, condition, world: { edges: edges.map((e) => ({ ...e, to: "char_player", trust: e.warmth, roles: e.roles ?? [] })) } } as unknown as SaveState;
}
const kindOf = (s: SaveState, id: string) => {
  const l = desireLine(s, id);
  return /CANNOT STAND YOU|while they dislike you/.test(l) ? "obsession"
    : /alongside genuine dislike/.test(l) ? "distance"
    : /and they do not like you/.test(l) ? "outranked"
    : l ? "other" : "none";
};

/* ── MILD DISLIKE AND MILD INTEREST IS NOT OBSESSION ────────────────────────────────────────
 * Olga's real numbers from the save. She is not coming apart; she finds him irritating and she
 * notices him. That is a completely ordinary thing to be, and it has its own behaviour. */
{
  const w = world({ from: "olga", warmth: -28, attraction: 38 });
  check("Olga's actual numbers no longer buy the extreme line", kindOf(w, "olga") === "distance", desireLine(w, "olga"));
  const l = desireLine(w, "olga");
  check("…what she gets instead is avoidance", /keep away from you more than they need to/.test(l), l);
  check("…and the dislike governs, not the pull", /the dislike governs the behaviour/.test(l));
  check("…and it is still forbidden to become banter", /NEVER write this as tension that is going somewhere/.test(l));
  check("…and she does not touch him", /do not touch you/.test(l));
}

/* ── BUT THE REAL THING STILL WORKS, BECAUSE IT IS REAL ─────────────────────────────────────
 * Emily at −100 warmth and 95 attraction is genuinely that person, and softening her would be a
 * different failure. The fix is the threshold, never the branch. */
{
  const w = world({ from: "emily", warmth: -100, attraction: 95 });
  check("Emily's actual numbers still do", kindOf(w, "emily") === "obsession", desireLine(w, "emily"));
  check("…and it still refuses to resolve into liking", /do not turn into a relationship|do not make them nicer/.test(desireLine(w, "emily")));
  check("…and it is written flat, with no figures left in it",
    !/as a way of|than the argument needs|in ways that are not|contempt that keeps/.test(desireLine(w, "emily")), desireLine(w, "emily"));
}
check("hostile but not attracted is just hostile", kindOf(world({ from: "x", warmth: -80, attraction: 5 }), "x") !== "obsession");
check("attracted but not hostile is not it either", kindOf(world({ from: "x", warmth: 40, attraction: 95 }), "x") !== "obsession");
for (const [w_, a] of [[-44, 95], [-60, 54], [-30, 90], [-95, 29]] as const)
  check(`just under the bar (w${w_} a${a}) is not obsession`, kindOf(world({ from: "x", warmth: w_, attraction: a }), "x") !== "obsession");

/* ── AND ONLY ONE OF THEM AT A TIME ─────────────────────────────────────────────────────────
 * Not a taste rule. One person in this state is a story; three is a genre, and it is not the genre
 * anybody chose. The worst case keeps it and the others get the milder line, which is still true
 * of them — nobody is being made to feel something they do not. */
{
  const w = world(
    { from: "emily", warmth: -60, attraction: 80 },
    { from: "olga", warmth: -95, attraction: 70 },
    { from: "vera", warmth: -50, attraction: 95 },
  );
  const kinds = ["emily", "olga", "vera"].map((id) => kindOf(w, id));
  check("three qualify and exactly one runs it", kinds.filter((k) => k === "obsession").length === 1, kinds);
  check("…and it is the most hostile of them", kindOf(w, "olga") === "obsession", kinds);
  check("…the others are told to keep away", kinds.filter((k) => k === "outranked").length === 2, kinds);
  check("…and they are not told they feel nothing",
    ["emily", "vera"].every((id) => /desire toward you: real/.test(desireLine(w, id))));
}
/* STABLE ACROSS TURNS. A cap that flickers is worse than no cap — the cast would take turns being
 * the obsessive one, which is the same problem wearing a rota. */
{
  const w = world({ from: "emily", warmth: -70, attraction: 90 }, { from: "olga", warmth: -70, attraction: 90 });
  const first = ["emily", "olga"].map((id) => kindOf(w, id));
  const w2 = world({ from: "olga", warmth: -70, attraction: 90 }, { from: "emily", warmth: -70, attraction: 90 });
  const second = ["emily", "olga"].map((id) => kindOf(w2, id));
  check("a dead tie resolves the same way whatever order the edges are in", JSON.stringify(first) === JSON.stringify(second), [first, second]);
  check("…and still only one of them", first.filter((k) => k === "obsession").length === 1, first);
}
check("one person alone keeps it", kindOf(world({ from: "emily", warmth: -70, attraction: 90 }), "emily") === "obsession");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
