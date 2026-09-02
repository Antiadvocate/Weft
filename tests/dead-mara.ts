/* THREE PLACES SAID SHE WAS DEAD, AND ONE CAPITAL LETTER OUTVOTED ALL OF THEM.
 *
 * "look at what I wrote as instructions for the narrator. In the world bible in canon in her status"
 *
 * Turn 67. The player had written it everywhere the engine offers:
 *
 *   narrator_direction  "MARA IS DEAD. DREA IS DEAD. KING IS DEAD. DO NOT MAKE ANY MORE MARAS.
 *                        MARAS STORY IS OVER. DO NOT FUCKING MAKE HER EXIST."
 *   canon               "Mara, King and Drea are dead" — and, again, "MARA IS DEAD."
 *   her status field    "Dead"
 *
 * She was in his living room, central: true, tracked: true, with a fresh drive about tracking down a
 * 1962 Seattle Transit Authority route overlay.
 *
 * TWO BUGS, BOTH SMALL, BOTH TOTAL.
 *
 * ONE: `status` is written straight from the bookkeeper's `kind`. The schema asks for "dead"; the
 * model returned "Dead". Every check in this engine is `c.status === "dead"` — exact, case
 * sensitive, in about twenty places: the roster filter, the arrival guard, the departure exemption,
 * drive re-planning, the central-cast count, the cast card, the auditor's own living-cast list.
 * "Dead" fails all of them. A character whose record says Dead in plain sight was alive to every
 * line of code that asked.
 *
 * TWO: it is not the same Mara. The original — char_mtggvs9vfhh5e, Emily's best friend, a landscape
 * architect living three blocks away — was no longer on the roster. findCharByName refuses to register a name a LIVING character holds, and cannot refuse one
 * whose record is gone. So the bookkeeper created char_mtju2zz0wc7nw: a different woman entirely,
 * raised above a laundromat in South Seattle by her grandmother, who collects vintage transit maps.
 * It gave her the dead woman's name and put her in the player's house.
 *
 * The bookkeeper is shown the standing direction in full — simulatorContext puts it first, labelled
 * SUPREME. It read "DO NOT FUCKING MAKE HER EXIST" and made her. Which is the whole argument for a
 * list instead of a sentence.
 */
import { repairStatuses, nameIsRetired, normalizeStatus, retireName } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const F = JSON.parse(readFileSync("tests/fixtures/dead-mara.json", "utf8"));
const MARA = "char_mtju2zz0wc7nw";
const fresh = (): SaveState => JSON.parse(JSON.stringify({
  characters: F.characters, world: { present: [...F.present], places: JSON.parse(JSON.stringify(F.places)), canon: F.canon, edges: [] },
  world_bible: { narrator_direction: F.narrator_direction },
})) as unknown as SaveState;

/* ── 1. the player said it in every channel there is ─────────────────────────── */
{
  check("the standing direction says it", /MARA IS DEAD/.test(F.narrator_direction));
  check("...and says it twice, angrier", /DO NOT FUCKING MAKE HER EXIST/.test(F.narrator_direction));
  check("canon says it", F.canon.some((c: string) => /Mara, King and Drea are dead/.test(c)));
  check("...and says it again on its own line", F.canon.some((c: string) => /^MARA IS DEAD\.$/.test(c)));
  check("her status field says it", F.characters[MARA].status === "Dead");
  check("AND SHE IS IN THE PLAYER'S LIVING ROOM ANYWAY",
    (F.places["loc_mtggvs9r4vmyf"].contains ?? []).includes(MARA), F.places["loc_mtggvs9r4vmyf"].contains);
  check("...on the scene roster", F.present.includes(MARA), F.present);
  check("...as a central, tracked character", F.characters[MARA].central === true);
}

/* ── 2. one capital letter ───────────────────────────────────────────────────── */
{
  check("the engine's own comparison fails on it", (F.characters[MARA].status as string) !== "dead");
  check("normalizeStatus reads it", normalizeStatus("Dead") === "dead");
  check("...and the other shapes a model reaches for", normalizeStatus("Killed") === "dead" && normalizeStatus("DEPARTED") === "departed");
  check("...and refuses what it does not understand", normalizeStatus("asleep") === undefined && normalizeStatus("") === undefined);

  const s = fresh();
  const log = repairStatuses(s);
  check("the repair corrects the record", s.characters[MARA].status === "dead", s.characters[MARA].status);
  check("...and says why, in the player's terms", log.some((l) => /every check that asked was told they were alive/.test(l)), log);
  check("...takes her out of the room", !(s.world.places["loc_mtggvs9r4vmyf"].contains ?? []).includes(MARA));
  check("...and off the roster", !s.world.present.includes(MARA), s.world.present);
  check("a status it cannot read is reported rather than guessed", (() => {
    const t = fresh(); (t.characters[MARA] as { status?: string }).status = "resting";
    return repairStatuses(t).some((l) => /does not recognise/.test(l));
  })());
  check("...and such a character is left alone", (() => {
    const t = fresh(); (t.characters[MARA] as { status?: string }).status = "resting";
    repairStatuses(t); return (t.characters[MARA] as { status?: string }).status === "resting";
  })());
}

/* ── 3. and it is not even the same woman ────────────────────────────────────── */
{
  const original = Object.values(F.old_mara)[0] as { background: string };
  check("the original Mara was a landscape architect three blocks away",
    /landscape architect/i.test(original.background), original.background.slice(0, 120));
  check("the new one was raised above a laundromat", /laundromat/i.test(F.characters[MARA].background), F.characters[MARA].background.slice(0, 120));
  check("they share nothing but the name",
    original.background.slice(0, 60) !== F.characters[MARA].background.slice(0, 60));
}

/* ── 4. so the name is retired, record or no record ──────────────────────────── */
{
  const s = fresh();
  repairStatuses(s);
  check("every ended name is on the tombstone list", (s.world.retired_names ?? []).includes("mara"), s.world.retired_names);
  check("...including the ones who merely departed", (s.world.retired_names ?? []).includes("drea"));
  check("a new Mara is refused", nameIsRetired(s, "Mara"));
  check("...however it is capitalised", nameIsRetired(s, "  MARA "));
  check("the living are not refused", !nameIsRetired(s, "Emily"));
  check("nor is a genuinely new name", !nameIsRetired(s, "Yusuf"));

  // The point of the tombstone: it holds when the record itself is gone, which is the case that
  // let a stranger inherit the name in the first place.
  const gone = fresh();
  repairStatuses(gone);
  delete (gone.characters as Record<string, unknown>)[MARA];
  check("AND IT HOLDS AFTER THE RECORD IS DELETED", nameIsRetired(gone, "Mara"));

  // A short name is not a tombstone — "Al" would retire half the alphabet.
  const s2 = fresh();
  retireName(s2, "Al");
  check("a two-letter name is not retired", !(s2.world.retired_names ?? []).includes("al"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
