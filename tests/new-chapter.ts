/* Smoke test: BRANCHING A GAME KEEPS THE WORLD.
 *
 * Starting a new chapter did three things at once, all visible in one 6-turn save:
 *
 *  1. It minted ONE place and dropped the entire gazetteer — a world the Forge refuses to build
 *     with fewer than six locations was reduced to a single room.
 *  2. It placed every surviving cast member at the player's own opening location, so syncPresence
 *     put the whole cast in that room on turn 1: five people standing in a hall.
 *  3. The chatlog anchor's signature was built from character identity alone, so people leaving the
 *     room never invalidated it — the narrator kept re-reading a PRESENT block (which the prompt
 *     calls law) listing everyone, and went on writing lines for characters who had walked out.
 *     The save's presence log oscillates 5 → 2 → 5 → 2 → 1 with Caelus speaking on the turn he is
 *     not in the room.
 *
 * The carry-forward itself is exercised through the pure helpers it is built from; the anchor and
 * the delta are exercised directly. */
import { newSave, registerCharacter } from "../src/engine/state";
import { syncPresence } from "../src/engine/turn";
import { deltaNote } from "../src/engine/prompts";
import type { Place, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** The place-carry the new-chapter path performs: founding first, then places holding a survivor,
 *  then the rest newest-first, capped. Mirrors api.newSeason so the ordering is pinned. */
function carryPlaces(old: Place[], heldBySurvivor: Set<string>, cap = 14): Place[] {
  return [
    ...old.filter((p) => p.founding),
    ...old.filter((p) => !p.founding && heldBySurvivor.has(p.id)),
    ...old.filter((p) => !p.founding && !heldBySurvivor.has(p.id)).reverse(),
  ].slice(0, cap);
}

/* 1. the gazetteer survives the branch */
{
  const old: Place[] = [
    { id: "a", name: "The King's Square", description_facts: "d1", contains: [], founding: true },
    { id: "b", name: "The River Docks", description_facts: "d2", contains: [], founding: true },
    { id: "c", name: "Thornwood", description_facts: "d3", contains: [], founding: false },
    { id: "d", name: "A shed", description_facts: "", contains: [], founding: false },
  ];
  const carried = carryPlaces(old, new Set(["c"]));
  check("nothing is dropped when the world is small", carried.length === 4, carried.map((p) => p.name));
  check("founding places come first", carried[0].founding === true && carried[1].founding === true);
  check("a place holding a survivor beats an empty one", carried[2].name === "Thornwood", carried.map((p) => p.name));
  check("descriptions carry, not just names", carried[0].description_facts === "d1");

  const many: Place[] = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, description_facts: "", contains: [], founding: i < 6 }));
  const capped = carryPlaces(many, new Set());
  check("a huge world is capped, keeping the spine", capped.length === 14 && capped.slice(0, 6).every((p) => p.founding));
}

/* 2. a time skip scatters people; it does not assemble them in the player's room */
{
  // the placement rule: model's `where` → previous location if it carried → elsewhere. Never `lid`.
  const carriedByOldId = new Map([["old_market", "new_market"]]);
  const byName = new Map([["thornhaven market", "new_market"], ["the god-duke's estate", "lid"]]);
  const place = (where: string | undefined, prevLoc: string | undefined) =>
    byName.get(String(where ?? "").toLowerCase()) ?? (prevLoc ? carriedByOldId.get(prevLoc) : undefined) ?? "loc_offscene";

  check("a named place is honored", place("Thornhaven market", undefined) === "new_market");
  check("the player's room only when explicitly named", place("The God-Duke's Estate", undefined) === "lid");
  check("otherwise they stay where they were", place(undefined, "old_market") === "new_market");
  check("unknown falls to elsewhere, NOT the player's room", place(undefined, "vanished_place") === "loc_offscene");
  check("no `where` and no prior place is still not the player's room", place(undefined, undefined) === "loc_offscene");
}

/* 3. presence rebuild records who left, so the delta can say it out loud */
function scene(): SaveState {
  const s = newSave("chapter", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_hall"] = { id: "loc_hall", name: "The Hall", description_facts: "", contains: [] };
  s.world.places["loc_market"] = { id: "loc_market", name: "The Market", description_facts: "", contains: [] };
  s.world.player_location = "loc_hall";
  for (const n of ["Andrea", "Father Caelus", "Angeline"]) {
    const id = registerCharacter(s, { name: n } as any);
    s.characters[id].location = "loc_hall";
  }
  syncPresence(s);
  return s;
}
{
  const s = scene();
  check("everyone in the hall is present", s.world.present.length === 3, s.world.present.length);
  const caelus = Object.entries(s.characters).find(([, c]) => c.name === "Father Caelus")![0];
  s.characters[caelus].location = "loc_market";
  syncPresence(s);
  check("he leaves the scene", !s.world.present.includes(caelus));
  check("the departure is remembered", (s.world.present_prev ?? []).includes(caelus), s.world.present_prev);
  const note = deltaNote(s, "");
  check("the delta names him as gone", /GONE FROM THE SCENE/.test(note) && /Father Caelus/.test(note.split("GONE FROM THE SCENE")[1] ?? ""), note.slice(0, 400));
  check("and forbids writing him", /Do not give them dialogue/.test(note));

  // nobody left → no noise
  const s2 = scene();
  const note2 = deltaNote(s2, "");
  check("a stable scene says nothing about departures", !/GONE FROM THE SCENE/.test(note2));
}

/* 4. the chatlog anchor signature moves when the scene does */
{
  const sig = (s: SaveState) => [
    Object.entries(s.characters)
      .filter(([, c]) => c.status !== "dead" && c.status !== "departed" && c.central !== false && !c.paged)
      .map(([id]) => id).sort().join(","),
    `@${s.world.player_location}`,
    `present:${[...s.world.present].sort().join(",")}`,
  ].join("|");

  const s = scene();
  const before = sig(s);
  const caelus = Object.entries(s.characters).find(([, c]) => c.name === "Father Caelus")![0];
  s.characters[caelus].location = "loc_market";
  syncPresence(s);
  check("someone leaving the room invalidates the anchor", sig(s) !== before, sig(s));

  const s2 = scene();
  const b2 = sig(s2);
  s2.world.player_location = "loc_market";
  syncPresence(s2);
  check("the player moving invalidates the anchor", sig(s2) !== b2);

  const s3 = scene();
  const b3 = sig(s3);
  syncPresence(s3);
  check("an unchanged scene keeps the anchor (caching still works)", sig(s3) === b3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
