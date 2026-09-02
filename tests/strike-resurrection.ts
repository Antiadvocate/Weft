/* THE STRIKE WAS THE RESURRECTION.
 *
 * "I want to understand why the fuck does it keep remaking Mara"
 *
 * Here is the whole loop, from the save that carries the evidence.
 *
 * The player killed Mara. She kept talking (her status had been written "Dead" with a capital D,
 * which no `=== "dead"` check in the engine can read). So he used the tool the engine gives him for
 * exactly this, and struck the material:
 *
 *     retcons: [{ "text": "Mara is alive", "turn": 58, "kind": "veto" }]
 *
 * Meaning: this did not happen, she is not alive. And the strike handler did this:
 *
 *     if (cid === "char_player" || c.central) continue;
 *     const first = (c.name || "").split(/\s+/)[0].toLowerCase();     // "mara"
 *     if (first && note.toLowerCase().includes(first)) {              // "mara is alive" → true
 *       delete t.characters[cid]; ...                                 // her record is gone
 *
 * A strike about a person contains that person's name. That is what a strike about a person IS. So
 * striking her deleted her record — and her record was the only thing stopping the name being
 * reused, because findCharByName can refuse a name a LIVING character holds and cannot refuse one
 * that belongs to nobody.
 *
 * Later that same turn 58 the narrator wrote a knock at the front door. The bookkeeper emitted a new
 * character named Mara. Nothing objected. The engine built a stranger — born above a laundromat in
 * South Seattle, raised by her grandmother, collects 1962 transit maps — gave her the dead woman's
 * name, and made her central: true.
 *
 * So every attempt to erase her destroyed the only guard against her return, and the player's
 * natural response — strike her again — minted another one. "DO NOT MAKE ANY MORE MARAS" was
 * written after several rounds of exactly this.
 *
 * AND `central` WAS THE WRONG SHIELD. It is set by a cap on how many people the engine tracks
 * closely, not by whether somebody matters — and here it was exactly backwards: the woman with ten
 * years of history was central:false, while the stranger who replaced her was created central:true.
 * The guard protected the phantom and exposed the real person.
 */
import { retireName, nameIsRetired } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const API = readFileSync("src/lib/api.ts", "utf8");

/* ── 1. the shape of the trap, in the shipped source ─────────────────────────── */
{
  check("a strike no longer frees the name", /retireName\(t, c\.name\);/.test(API));
  check("...and says why", /THE NAME IS RETIRED WHETHER OR NOT THE RECORD SURVIVES/.test(API));
  check("the old central-only shield is gone", !/if \(cid === "char_player" \|\| c\.central\) continue;/.test(API));
  check("...replaced by whether the story actually lived with them", /const attached = movedEdge \|\| c\.portrait_url/.test(API));
  check("an attached person is ended rather than unmade", /the story lived with this person; end them, do not unmake them/.test(API));
  check("...and taken out of the scene either way", /t\.world\.present = t\.world\.present\.filter\(\(p\) => p !== cid\);/.test(API));
  check("a two-letter name still cannot trigger it", /first\.length < 3/.test(API));
}

/* ── 2. the tombstone is what actually breaks the loop ───────────────────────── */
{
  const s = {
    characters: {
      char_player: { name: "Rabi" },
      char_old: { name: "Mara", status: "departed", central: false },
    },
    world: { present: [], places: {}, edges: [], canon: [] },
  } as unknown as SaveState;

  retireName(s, "Mara");
  check("the struck name is retired", nameIsRetired(s, "Mara"));
  // ...and it holds once the record is gone, which is the exact state the strike used to leave.
  delete (s.characters as Record<string, unknown>).char_old;
  check("AND IT HOLDS AFTER THE RECORD IS DELETED", nameIsRetired(s, "Mara"));
  check("which is the state the old strike left behind", Object.keys(s.characters).length === 1);
  check("an unrelated name is untouched", !nameIsRetired(s, "Felicity"));
}

/* ── 3. the two Maras were not the same woman ────────────────────────────────── */
{
  const F = JSON.parse(readFileSync("tests/fixtures/dead-mara.json", "utf8"));
  const replacement = F.characters["char_mtju2zz0wc7nw"];
  const original = Object.values(F.old_mara)[0] as { background: string };
  check("the original was a landscape architect three blocks away", /landscape architect/i.test(original.background));
  check("the replacement was raised above a laundromat", /laundromat/i.test(replacement.background));
  check("the replacement was made CENTRAL while the original was not", replacement.central === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
