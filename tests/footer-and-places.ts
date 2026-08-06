/* Smoke test: NAMES ARE NAMES, AND GROUND CAN CHANGE.
 *
 * Two unrelated failures with the same root shape — state that could only be written one way.
 *
 * 1. The scene footer's `new="Pell (a weaver, mends nets on the quay)"` was split on every comma
 *    BEFORE the parenthetical was read, so a gist containing a comma — as the documented example
 *    itself does — was torn in half and each half registered as a person. That is how a cast
 *    acquires members named "wary and calculating)" and "broad and grey-bearded": fragments of
 *    somebody's own description, given voices and drives.
 *
 * 2. A place's description_facts had exactly one writer after creation: the player editing it by
 *    hand. The simulator could create a place and never revise one, so a town the player levelled
 *    went on being described as walled, lit and quiet in every prompt for the rest of the game. */
import { newSave, registerCharacter } from "../src/engine/state";
import { parseSceneFooter, splitOutsideParens, isPersonName, pruneParseArtifacts, applyDiff } from "../src/engine/turn";
import type { SaveState, SimulatorDiff } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const created = (attrs: string) => parseSceneFooter(`Some prose. <<<SCENE ${attrs}>`).footer?.created ?? [];

/* 1. the split respects parentheses */
{
  check("plain list splits", JSON.stringify(splitOutsideParens("Hana, Ito")) === '["Hana","Ito"]');
  check("commas inside parens are not separators",
    JSON.stringify(splitOutsideParens("Pell (a weaver, mends nets), Ito")) === '["Pell (a weaver, mends nets)","Ito"]');
}

/* 2. the documented example survives — it did not before */
{
  const c = created(`new="Pell (a weaver, mends nets on the quay)"`);
  check("one person, not two", c.length === 1, c);
  check("the name is the name", c[0]?.name === "Pell", c[0]);
  check("the gist is kept whole", c[0]?.gist === "a weaver, mends nets on the quay", c[0]);
}

/* 3. the exact shape that produced the junk cast members */
{
  const c = created(`new="Osric (broad and grey-bearded, wary and calculating)"`);
  check("a description with a comma yields ONE character", c.length === 1, c);
  check("named Osric, not a trait fragment", c[0]?.name === "Osric", c);
  check("no character is named after a clause", !c.some((x) => /wary and calculating/.test(x.name)), c);

  const two = created(`new="Hana (a nurse, night shift), Ito (a clerk, tired)"`);
  check("two entries still parse as two people", two.length === 2 && two[0].name === "Hana" && two[1].name === "Ito", two);
}

/* 4. fragments are rejected outright, even if they reach the creation path some other way */
{
  check("a real name passes", isPersonName("Osric") && isPersonName("Lady Marchess"));
  check("a trait clause is not a name", !isPersonName("wary and calculating"));
  check("an appearance fragment is not a name", !isPersonName("broad and grey-bearded"));
  check("a bare role is not a name", !isPersonName("the captain"));
  check("a sentence is not a name", !isPersonName("a man who has watched a wall become a door"));
  check("an all-lowercase scrap is not a name", !isPersonName("mends nets on the quay"));
  check("orphaned parens never survive onto a name", created(`new="(broad and grey-bearded, wary and calculating)"`).length === 0);
}

/* 5. saves already carrying the debris get cleaned, but only where nothing is attached */
{
  const s = newSave("prune", { name: "W" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const junk = registerCharacter(s, { name: "wary and calculating)", background: "INCOMPLETE RECORD — the narrator brought them into the story." } as any);
  const junk2 = registerCharacter(s, { name: "broad and grey-bearded", background: "INCOMPLETE RECORD — the narrator brought them into the story." } as any);
  const real = registerCharacter(s, { name: "Osric", background: "Lord of the castle." } as any);
  // a fragment the player actually built a relationship with is NOT data to throw away
  const kept = registerCharacter(s, { name: "the captain", background: "INCOMPLETE RECORD — the narrator brought them in." } as any);
  s.world.edges.push({ from: kept, to: "char_player", warmth: 30, trust: 10, power: 0, notes: "", updated_turn: 4 });

  const removed = pruneParseArtifacts(s);
  check("both parse artifacts are removed", removed.length === 2, removed);
  check("the real character is untouched", !!s.characters[real]);
  check("a fragment with a relationship is kept", !!s.characters[kept]);
  check("their records go too", !s.characters[junk] && !s.characters[junk2] && !s.memory[junk]);
  check("pruning is idempotent", pruneParseArtifacts(s).length === 0);
}

/* 6. a place can be rewritten by play, and stops asserting what is no longer true */
function placeState(): SaveState {
  const s = newSave("places", { name: "Veridun" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.places["loc_town"] = {
    id: "loc_town", name: "Thornwood", contains: [], founding: true,
    description_facts: "Thornwood sits inside a curtain wall of dressed stone. At night the town is lit and quiet.",
  };
  s.world.player_location = "loc_town";
  s.characters["char_player"].location = "loc_town";
  return s;
}
{
  const s = placeState();
  const diff = { places_update: [{ place: "Thornwood", description_facts: "Thornwood is a burn scar inside a broken ring of scorched stone. Nothing stands above knee height.", note: "levelled by the duke" }] } as unknown as SimulatorDiff;
  const shifts = applyDiff(s, diff, "I destroy the town", "The wall came apart.");
  check("the description is replaced, not appended", s.world.places["loc_town"].description_facts.startsWith("Thornwood is a burn scar"), s.world.places["loc_town"].description_facts);
  check("the old text is gone", !/lit and quiet/.test(s.world.places["loc_town"].description_facts));
  check("the change is reported", shifts.some((x) => /Thornwood is not what it was/.test(x)), shifts);
  check("the turn is stamped", s.world.places["loc_town"].changed_turn === s.world.current_turn);

  // resolving by id works too
  const s2 = placeState();
  applyDiff(s2, { places_update: [{ place: "loc_town", description_facts: "Rubble." }] } as unknown as SimulatorDiff, "x", "y");
  check("a place resolves by id as well as name", s2.world.places["loc_town"].description_facts === "Rubble.");
}

/* 7. and when the bookkeeper misses it, the record stops claiming the old truth */
{
  const s = placeState();
  applyDiff(s, {} as unknown as SimulatorDiff, "I destroy the town and everyone in it", "The ground opened.");
  const d = s.world.places["loc_town"].description_facts;
  check("an unrevised transformed place is flagged stale", /no longer reliable/.test(d), d);
  check("the original text is preserved for the rewrite to build on", /curtain wall of dressed stone/.test(d));

  // an ordinary turn does not touch it
  const s2 = placeState();
  applyDiff(s2, {} as unknown as SimulatorDiff, "I walk to the market and buy bread", "You buy bread.");
  check("an ordinary action leaves the description alone", !/no longer reliable/.test(s2.world.places["loc_town"].description_facts));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
