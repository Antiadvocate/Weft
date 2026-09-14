/* "CONSTANCE IS ACHING FOR ME. SPENDS THE ENTIRE BEGINNING COURTING ME. WHEN I SHOW MY POWER SHE
 *  STARTS LOSING HER MIND. SUDDENLY SHE DIDN'T WANT TO COURT ME, SHE WANTED… TO CLEAN MY GREENHOUSE."
 *
 * Nine turns of courtship — the ledger's own shift for turn 9 reads "Constance Wexford kept their
 * word: sit with Rabi and let him feed her grapes and play the fool without leaving". Warmth 49,
 * attraction 57, admissibility 0.68. Then he asks her, plainly, what she wants from him, and she
 * says she came about a glasshouse and had never wanted anything else: "Not a title. Not my
 * father's money. Not whatever it is you think a woman who stands near you must be after."
 *
 * Two systems were answering that question and only one of them is called "wants". The desire edge
 * said she ached for him. Her DRIVE — the field labelled wants, the one a direct question resolves
 * against — was about the glasshouse, because a pursuit want could not reach her.
 *
 * seedDrive gained a pursuit branch earlier in this project, for a report that read "most people
 * super attracted to someone will go after them". It sits behind `if (present) continue` in
 * regenerateDrives, on the reasoning that people in the room get their wants from the scene via the
 * bookkeeper — and the drives contract the bookkeeper reads says goals should point at the WORLD
 * rather than at the player. So the one mechanism in this engine that can produce "get them alone"
 * was unreachable for anybody actually standing in front of him.
 *
 * Measured across eleven saves: eleven characters hold attraction of 40 or more toward the player,
 * and NOT ONE carries a want that moves toward him. Six name him, and all six are escape or
 * surveillance — "put distance between herself and Rabi to salvage her dignity", "get clear of
 * Rabi's club and report what he saw", "walk away into the rain". The other five are errands. A
 * woman at attraction 100 and warmth 94 wanted a delivery of nail polish. */
import { pursuitWants, regenerateDrives } from "../src/engine/drives";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
function world(o: { warmth: number; attraction: number; adm?: number; goal?: string; present?: boolean }): SaveState {
  return {
    characters: {
      char_player: { name: "Rabi" },
      c: { name: "Constance Wexford", tracked: true, core_traits: [], values: [], background: "",
           drive: { goal: o.goal ?? "clear the beds in the glasshouse", progress: 10, priority: 2, updated_turn: 1 },
           drive_queue: [] },
    },
    condition: { c: { psyche: { relaxation: 1, active_states: [] } } },
    world: {
      current_turn: 20, present: o.present === false ? [] : ["c"], threads: [], clocks: [], rumors: [], places: {},
      edges: [{ from: "c", to: "char_player", warmth: o.warmth, trust: o.warmth, attraction: o.attraction,
                desire_admissibility: o.adm ?? 0.68, roles: [] }],
    },
  } as unknown as SaveState;
}

/* ── THE WANTS THEMSELVES, KEYED TO THE STATE ───────────────────────────────────────────────── */
check("fond and able to own it: she wants him to herself",
  /to themselves for an evening/.test(pursuitWants(world({ warmth: 49, attraction: 57 }), "c").join(" ")));
check("appetite with no attachment is direct and uncourtly",
  /get Rabi alone somewhere/.test(pursuitWants(world({ warmth: 5, attraction: 57 }), "c").join(" ")));
check("wanting somebody she is cross with is contact as friction",
  /make them deal with it/.test(pursuitWants(world({ warmth: -30, attraction: 57 }), "c").join(" ")));
check("a pull she cannot own comes out as claim",
  /keep Rabi within reach/.test(pursuitWants(world({ warmth: 40, attraction: 57, adm: 0.2 }), "c").join(" ")));
check("no real attraction, no pursuit want", pursuitWants(world({ warmth: 60, attraction: 10 }), "c").length === 0);

/* ── AND THEY REACH SOMEBODY STANDING IN THE ROOM ───────────────────────────────────────────── */
{
  const s = world({ warmth: 49, attraction: 57 });
  regenerateDrives(s, () => 0.3);
  const q = (s.characters.c.drive_queue ?? []).map((x) => x.goal);
  check("a woman in the room now carries a want that moves toward him", q.some((g) => /Rabi/.test(g)), q);
  check("…and it does not displace her own business",
    s.characters.c.drive?.goal === "clear the beds in the glasshouse", s.characters.c.drive?.goal);
}
/* NAMING SOMEBODY IS NOT WANTING THEM. Both of the clearest real cases hold a want that names him
 * and points away — and a first cut read the name alone and skipped exactly those two. */
for (const goal of ["Put distance between herself and Rabi to salvage her dignity.",
                    "distance myself from Rabi's influence",
                    "Get clear of Rabi's club and report what he saw to Bert"]) {
  const s = world({ warmth: -2, attraction: 100, goal });
  regenerateDrives(s, () => 0.3);
  check(`a fleeing want does not count as pursuit: "${goal.slice(0, 40)}"`,
    (s.characters.c.drive_queue ?? []).length === 1, s.characters.c.drive_queue);
}
{
  const s = world({ warmth: 49, attraction: 57, goal: "get Rabi to themselves for an evening" });
  regenerateDrives(s, () => 0.3);
  check("…but somebody already pursuing him is not given a second one",
    (s.characters.c.drive_queue ?? []).length === 0, s.characters.c.drive_queue);
}
{
  const s = world({ warmth: 60, attraction: 10 });
  regenerateDrives(s, () => 0.3);
  check("nobody who is merely fond is handed one", (s.characters.c.drive_queue ?? []).length === 0);
}
/* THE OFFSCREEN PATH IS UNTOUCHED — it already worked, and it is where seedDrive still runs whole. */
{
  const s = world({ warmth: 49, attraction: 57, present: false });
  s.characters.c.drive!.progress = 100;
  regenerateDrives(s, () => 0.1);
  check("somebody offscreen still gets a fresh want the old way", !!s.characters.c.drive?.goal);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
