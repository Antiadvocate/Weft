/* Smoke test: ZERO ZOMBIES IN A ZOMBIE GAME.
 *
 * "This prose sucks ass. Zero zombies. Genre action zombies horror."
 *
 * Turn 8 of "The Wake of the USS Resolute" — tone "Horror, action, drama", pressure palette led by
 * "walkers converging on noise". Across all seven playable turns the beat selector returned
 * { kind: "none" } every single time, and every turn's directive therefore opened with:
 *
 *     NO EXTERNAL PUSH THIS TURN — this outranks the genre paragraph, the pressure reading,
 *     and your own sense of pace. Nothing new arrives, presses, or develops from outside.
 *
 * A line that explicitly outranks the genre, on every turn of the game, in a game about being eaten.
 *
 * Two causes. The grace window — "the first 8 turns establish a world; they do not besiege the
 * player who just arrived in it" — is genre-blind, and for a siege story that is the entire opening
 * act guaranteed silent. And the quiet line denied the SETTING rather than the EVENT: told nothing
 * arrives from outside, a narrator writes a world where nothing is outside.
 *
 * A drama earns its grace; the threat there is an intrusion into an ordinary life and arriving in
 * that life is the point of the first act. In a siege the threat IS the ordinary life. */
import { isBesieged, selectBeat, pressureDirective } from "../src/engine/pressure";
import type { BeatInput, PressureVerdict } from "../src/engine/pressure";
import type { Thread } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const RESOLUTE_PALETTE = [
  "walkers converging on noise",
  "dwindling ammunition and the arithmetic of every shot",
  "weather turning a beach landing into a drowning risk",
  "injury and infection with no antibiotics to spare",
];

/* ── 1. reading the world for what kind of story it is ───────────────────────── */
{
  check("the save that prompted this reads as besieged", isBesieged("Horror, action, drama", RESOLUTE_PALETTE));
  check("and on the palette alone, without the tone word", isBesieged("", RESOLUTE_PALETTE));
  check("a war story too", isBesieged("military drama", ["a shelling that never quite stops"]));
  check("and survival", isBesieged("survival", []));
}
{
  check("a neighbourhood romance is not besieged", !isBesieged("domestic drama, erotic", ["a neighbour's curiosity", "an unpaid favour"]));
  check("nor a court intrigue", !isBesieged("political intrigue", ["a rival's whisper campaign"]));
  check("nor a cosy mystery", !isBesieged("cosy mystery", ["a locked room", "an alibi that does not hold"]));
  check("undefined is not besieged", !isBesieged(undefined, undefined));
}

/* ── 2. the opening act ──────────────────────────────────────────────────────── */
const hot = (t: number): Thread[] => ([{ id: "t1", title: "Walkers on the shingle", description: "", status: "active", turn_started: 1, tension: 6 } as Thread]).slice(0, t);
const input = (over: Partial<BeatInput>): BeatInput => ({
  turn: 5, tension: 5, threads: hot(1), clocks: [], consequences: [], agents: [],
  last_beat_turn: 0, last_exo_turn: 0, rng: () => 0.1, ...over,
} as BeatInput);

{
  // the exact shape of the save: seven turns, a hot thread, nothing ever fires
  const quiet = [1, 2, 3, 4, 5, 6, 7].map((turn) => selectBeat(input({ turn, besieged: false })).kind);
  check("a drama's first turns really are all silent — this was the intended behaviour",
    quiet.every((k) => k === "none" || k === "reminder"), quiet);
}
{
  const besieged = [3, 4, 5, 6, 7].map((turn) => selectBeat(input({ turn, besieged: true })).kind);
  check("a siege gets beats in its opening turns", besieged.some((k) => k !== "none"), besieged);
}
{
  check("even turn 3 of a siege can discharge", selectBeat(input({ turn: 3, besieged: true })).kind !== "none");
  check("but turn 1 still establishes rather than besieging", selectBeat(input({ turn: 1, besieged: true, threads: [] })).kind === "none");
}
{
  // the grace window is not simply removed — a drama must be unchanged
  const d = selectBeat(input({ turn: 5, besieged: false }));
  check("a drama at turn 5 still gets no discharge", d.kind === "none" || d.kind === "reminder", d);
}

/* ── 3. quiet withholds the event, not the world ─────────────────────────────── */
{
  const v = { pressure: 2, band: "calm", source: "quiet — the world breathes" } as PressureVerdict;
  const t = pressureDirective(v, RESOLUTE_PALETTE, 5, "mortal", { kind: "none" });
  check("a quiet turn no longer claims to outrank the genre", !/outranks the genre/.test(t), t.slice(0, 200));
  check("it still forbids a new incident", /no rider|NO NEW INCIDENT/.test(t));
  check("but says the world itself stays on the page", /still true and still on the page/.test(t));
  check("and names the case directly — danger as the ordinary condition", /ordinary condition does not become a safe one/.test(t));
  check("the genre's own pressure palette still reaches the narrator", /walkers converging on noise/.test(t), t.slice(-200));
}
{
  // at tension 0 the player has asked for rest, and that must still be honoured absolutely
  const v = { pressure: 0, band: "calm", source: "quiet" } as PressureVerdict;
  const t = pressureDirective(v, RESOLUTE_PALETTE, 0, "mortal", { kind: "none" });
  check("tension 0 still means the world is at rest", /THE WORLD IS AT REST/.test(t));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
