/* Smoke test: "MARCELLA WAS BOUGHT BY A WOMAN."
 *
 * The player is Rabi, pronouns he/him, set at world creation. On turn 3 he bought a slave at the
 * Forum. What went into her record, as an episodic memory AND as her life_history — which is
 * permanent and read back to the narrator every turn after:
 *
 *   "Marcella was bought by a woman who said 'hey' instead of a greeting, then asked her name,
 *    then said she would take off the collar."
 *
 * The narrator did nothing wrong. It writes the player in the SECOND PERSON — "She looked at you",
 * "you said" — so the player's gender does not appear anywhere in the prose, correctly. The only
 * gendered pronouns on the page belonged to the slaver and to Marcella.
 *
 * The bookkeeper's roster is its entire description of who anybody is, and it read:
 *
 *   CHARACTERS (use these exact ids): Rabi=char_player [IN SCENE] @The Forum; ...
 *
 * A name, an id and a place. No gender, for anyone, ever. So the pass that writes memories,
 * life_history, edge notes and rumors had to guess, and guessed off the women in the surrounding
 * prose.
 *
 * The same blindness in the other two writing passes, from two more saves:
 *
 *   offstage:   "Tigris wakes in the Subura and tries to remember what HE can sell for breakfast"
 *               "Clodia asks HIM where Rabi and Lucia have gone"     — Tigris is she/her
 *   reflection: "Rabi conducts HERSELF like a soldier ... SHE is the kind of initiative he would
 *               recruit for"                                          — Rabi is he/him
 *
 * Meanwhile the NARRATOR's digest prints pronouns beside every name and carries a rule calling them
 * binding in every clause. Only the passes that write permanent records were left blind.
 */
import { readFileSync } from "node:fs";
import { simulatorContext } from "../src/engine/prompts";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): { s: SaveState; her: string } {
  const s = newSave("pronouns", { name: "Rome" } as any);
  s.world.places["loc_forum"] = { id: "loc_forum", name: "The Forum", description_facts: "Stone.", contains: [] };
  s.world.player_location = "loc_forum";
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him" } as any);
  const her = registerCharacter(s, { name: "Marcella", pronouns: "she/her" } as any)!;
  s.characters[her].location = "loc_forum";
  s.world.present = [her];
  return { s, her };
}

/* ── 1. the bookkeeper — the pass that wrote the line ─────────────────────────── */
{
  const { s } = world();
  const ctx = simulatorContext(s);
  const roster = ctx.split("\n").find((l) => l.startsWith("CHARACTERS")) ?? "";
  check("the player's pronouns are on the roster", /Rabi=char_player \(he\/him\)/.test(roster), roster);
  check("and every NPC's", /Marcella=\S+ \(she\/her\)/.test(roster), roster);
  check("the ids the diff must write to are still there", /char_player/.test(roster) && /=char_/.test(roster), roster);
  check("it is told they bind what it writes", /BINDING for every line you write/.test(ctx));
  check("...and told why the prose cannot supply the player's", /second person and never genders them/.test(ctx));
  check("life_history and memories are named, since that is where it landed", /memories, life_history/.test(ctx));
}

/* ── 2. a character with no pronouns on record does not break the line ────────── */
{
  const { s } = world();
  const anon = registerCharacter(s, { name: "The slaver" } as any)!;
  s.characters[anon].location = "loc_forum";
  const roster = simulatorContext(s).split("\n").find((l) => l.startsWith("CHARACTERS")) ?? "";
  check("an unrecorded set is simply absent, not invented", /The slaver=\S+ \[/.test(roster), roster);
  check("and the ones that are recorded still print", /\(she\/her\)/.test(roster), roster);
}

/* ── 3. the other two writing passes ──────────────────────────────────────────── */
{
  const offstage = readFileSync("src/engine/offstage.ts", "utf8");
  check("the offstage cast list carries pronouns", /\$\{c\.name\}\$\{c\.pronouns \? ` \(\$\{c\.pronouns\}\)` : ""\}/.test(offstage));

  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("the reflection pass names the subject's own set", /Character: \$\{state\.characters\[id\]\?\.name\}\$\{state\.characters\[id\]\?\.pronouns/.test(turn));
  check("and every person it holds a standing with", /const who = `\$\{oc\.name\}\$\{oc\.pronouns/.test(turn));
  check("and is told a belief is permanent", /PRONOUNS ARE BINDING/.test(turn));
}

/* ── 4. the narrator was never the problem and is unchanged ───────────────────── */
{
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  check("the narrator still carries its own binding rule", /The pronouns printed beside each name are BINDING/.test(prompts));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
