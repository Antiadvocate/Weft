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
import { parseSceneFooter, splitOutsideParens, isPersonName, pruneParseArtifacts, applyDiff, repairPlaceDescriptions } from "../src/engine/turn";
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
  const p = s.world.places["loc_town"];
  check("an unrevised transformed place is flagged stale", /predates that/.test(p.stale_note ?? ""), p.stale_note);
  check("the note is NOT inside the description", !/predates that/.test(p.description_facts), p.description_facts);
  check("the description itself is untouched", /curtain wall of dressed stone/.test(p.description_facts));

  // an ordinary turn does not touch it
  const s2 = placeState();
  applyDiff(s2, {} as unknown as SimulatorDiff, "I walk to the market and buy bread", "You buy bread.");
  check("an ordinary action leaves it alone", !s2.world.places["loc_town"].stale_note);
}

/* 7b. the false positives that put a quote of the player's own dialogue in a description */
{
  // a figure of speech, inside dialogue, in a place with no description yet
  const s = placeState();
  s.world.places["loc_town"].description_facts = "";
  const shifts = applyDiff(s, {} as unknown as SimulatorDiff,
    `I sit on the ground and hold my face in my hands. "You walk around barefoot destroying my ability to even think."`,
    "He sat.");
  check("a metaphor inside dialogue is not demolition", !s.world.places["loc_town"].stale_note, s.world.places["loc_town"].stale_note);
  check("and an empty description stays empty", s.world.places["loc_town"].description_facts === "", s.world.places["loc_town"].description_facts);
  check("nothing is reported", !shifts.some((x) => /out of date/.test(x)), shifts);

  // a threat is not an act either
  const s2 = placeState();
  applyDiff(s2, {} as unknown as SimulatorDiff, `I stay where I am. "I could level this whole place and you'd still stand there."`, "She did not move.");
  check("a threat to level a place does not level it", !s2.world.places["loc_town"].stale_note);

  // ...but the real thing still lands
  const s3 = placeState();
  applyDiff(s3, {} as unknown as SimulatorDiff, "I destroy the town", "It came apart.");
  check("an actual demolition is still caught", !!s3.world.places["loc_town"].stale_note, s3.world.places["loc_town"].stale_note);
  const s4 = placeState();
  applyDiff(s4, {} as unknown as SimulatorDiff, "I raze Thornwood to the ground", "Nothing stood.");
  check("naming the place works too", !!s4.world.places["loc_town"].stale_note);
}

/* 8. the repair lifts old engine notes back out of descriptions */
{
  const s = placeState();
  // exactly what one save carried: a place whose entire description is the note
  s.world.places["loc_bare"] = {
    id: "loc_bare", name: "San Pietro", contains: [],
    description_facts: `[turn-48 change] The player: "I sit on the ground. And hold my face in my hands." — this description predates that and is no longer reliable; render what the recent prose established, not the text above.`,
  };
  // and one where the note was merely appended to a real description
  s.world.places["loc_town"].description_facts += `\n[turn-12 change] The player: "I burn the whole thing down" — this description predates that and is no longer reliable.`;

  const log = repairPlaceDescriptions(s);
  check("both places are repaired", log.length === 2, log);
  check("a description that was only a note is cleared", s.world.places["loc_bare"].description_facts === "", JSON.stringify(s.world.places["loc_bare"].description_facts));
  check("and the repair says it needs writing", log.some((l) => /needs writing/.test(l)), log);
  check("a real description survives with the note lifted out", /curtain wall of dressed stone/.test(s.world.places["loc_town"].description_facts));
  check("the note is gone from the description", !/turn-12 change/.test(s.world.places["loc_town"].description_facts), s.world.places["loc_town"].description_facts);
  check("but it is remembered beside it", !!s.world.places["loc_town"].stale_note);
  check("running it again is a no-op", repairPlaceDescriptions(s).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
