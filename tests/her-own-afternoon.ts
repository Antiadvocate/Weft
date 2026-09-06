/* "IS ABIGAIL A HUMAN BEING?"
 *
 * The player's question, after four saves. The answer in the file was no, and not because she was
 * thin. Her offstage log, one day, every line of it hers and the player in another room:
 *
 *   11:40  gives up on the box fan pushing hot air around and starts a slow, deliberate pedicure
 *          campaign on the couch — bare feet up in the sightline of Max's open bedroom door
 *   13:01  Around 12:50 Abigail decides the couch campaign isn't working and relocates the whole
 *          operation to the entryway alcove — the four-foot choke point between the front door, the
 *          coat hooks and the bathroom, the only way out of the apartment
 *   13:29  Around 13:20 Abigail gets bored of the alcove and pushes at the six o'clock thing
 *          directly, from the stool — she texts rather than walking to his door, because moving
 *          means smudging two hours of work
 *   20:00  At about 19:50 Abigail finally comes off the stool and does the thing she's been putting
 *          off: she deals with the chicken, out of the fridge since sometime after four
 *   05:40  Sometime after five in the morning Abigail wakes up on the couch with her plate still on
 *          the coffee table, both portions gone gray and congealed in their own fat
 *
 * That is a person. Tactics, boredom, pride, self-sabotage, and a cold plate at five in the morning.
 * Her episodic memory at that point held twelve entries. Eleven named Max. The twelfth was about his
 * shoulder. None of the above was in it.
 *
 * TWO FAULTS, AND THEY COMPOUND.
 *
 *  1. runOffstage moves the ACTOR'S nervous system and then writes a memory for the WITNESSES only.
 *     The person who did the thing got the relaxation cost and no recollection. Alone in her own
 *     apartment, she was nobody's witness, so nothing was written at all.
 *  2. What did reach her — through the fact ledger — arrived in broken grammar. Every line the
 *     offstage pass writes opens with an unpunctuated time phrase, and the name→first-person
 *     conversion reads a fronted adverbial as an object position, so her own afternoon was stored
 *     in her own head as "me decides the couch campaign isn't working", "me finally comes off the
 *     stool", "me wakes up on the couch". The comment on that rule names "Eight a.m., Sarah is
 *     already at a corner table" as the case it fixed — and it never fired on it either, because
 *     the pattern refuses a full stop and "a.m.," has two.
 */
import { cleanMemoryContent, firstPersonVerb } from "../src/engine/memory";
import { rememberOwnAct } from "../src/engine/offstage";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const her = (t: string): string => cleanMemoryContent(t, { name: "Abigail Mercer", isPlayer: false }) ?? "";

/* ── 1. her own afternoon, in her own grammar ────────────────────────────────── */
{
  const REAL: [string, RegExp][] = [
    ["Around 12:50 Abigail decides the couch campaign isn't working and relocates the whole operation to the entryway alcove.",
      /^Around 12:50 I decide the couch campaign isn't working and relocate the whole operation/],
    ["At about 19:50 Abigail finally comes off the stool and deals with the chicken.",
      /^At about 19:50 I finally come off the stool and deal with the chicken/],
    ["Sometime after five in the morning Abigail wakes up on the couch with her plate still on the coffee table.",
      /^Sometime after five in the morning I wake up on the couch/],
    ["At 18:28 Abigail does the thing she's been rehearsing since the door shut yesterday.",
      /^At 18:28 I do the thing/],
    ["Abigail gives up on the box fan and starts a slow, deliberate pedicure campaign on the couch.",
      /^I give up on the box fan and start a slow, deliberate pedicure campaign/],
  ];
  for (const [raw, want] of REAL) check(`her own words: ${raw.slice(0, 44)}…`, want.test(her(raw)), her(raw));

  // the sentence the rule's own comment claims to have fixed, which it never did
  check("the comment's own example finally works",
    /^Eight a\.m\., I am already at a corner table/.test(her("Eight a.m., Abigail is already at a corner table.")),
    her("Eight a.m., Abigail is already at a corner table."));
}

/* ── 2. and an object is still an object ─────────────────────────────────────── */
{
  const OBJECT: [string, RegExp][] = [
    ["Max kissed Abigail at noon on the landing.", /Max kissed me at noon/],
    ["At noon Max kissed Abigail on the stairs outside.", /At noon Max kissed me on the stairs/],
    ["Marisol shouted at Abigail from the third-floor landing.", /shouted at me/],
  ];
  for (const [raw, want] of OBJECT) check(`still an object: ${raw.slice(0, 40)}…`, want.test(her(raw)), her(raw));

  // ...and a clause that supplies its own subject is left alone
  check("a second subject across the conjunction is untouched",
    /I told Rabi and he has not answered/.test(her("Abigail told Rabi and he has not answered her since.")),
    her("Abigail told Rabi and he has not answered her since."));
  check("...and so is a new noun subject",
    /the bread is stale/.test(her("Abigail went out and the bread is stale now.")),
    her("Abigail went out and the bread is stale now."));
  check("...and a named person doing their own thing",
    /Marisol watches/.test(her("Abigail let Max in and Marisol watches from the hallway door.")),
    her("Abigail let Max in and Marisol watches from the hallway door."));
}

/* ── 3. the verb, put back in the first person ───────────────────────────────── */
{
  const STEMS: [string, string | null][] = [
    ["takes", "take"], ["comes", "come"], ["gives", "give"], ["relocates", "relocate"],
    ["wakes", "wake"], ["decides", "decide"],
    // -es after a real sibilant stem is two letters; a lone s before it belongs to the stem
    ["passes", "pass"], ["misses", "miss"], ["watches", "watch"], ["boxes", "box"],
    ["uses", "use"], ["rises", "rise"], ["closes", "close"],
    ["carries", "carry"], ["tries", "try"],
    // and the words that only look like verbs
    ["is", null], ["was", null], ["has", null], ["does", null], ["always", null], ["dress", null],
  ];
  for (const [w, want] of STEMS) check(`${w} → ${want ?? "left alone"}`, firstPersonVerb(w) === want, firstPersonVerb(w));

  check("an adverb may stand between the subject and its verb",
    /I still watch the door/.test(her("Abigail still watches the door from the couch every evening.")),
    her("Abigail still watches the door from the couch every evening."));
  check("...and after the conjunction too",
    /and never use the lift/.test(her("Abigail always takes the stairs and never uses the lift.")),
    her("Abigail always takes the stairs and never uses the lift."));
}

/* ── 4. the person who did it remembers doing it ─────────────────────────────── */
{
  const world = (): SaveState => ({
    world: { current_time: "Day 1, 13:01 (Afternoon)" },
    characters: {
      char_player: { character_id: "char_player", name: "Max Mercer" },
      char_abi: { character_id: "char_abi", name: "Abigail Mercer" },
    },
    memory: {},
  } as unknown as SaveState);

  const WHAT = "Around 12:50 Abigail decides the couch campaign isn't working and relocates the whole "
    + "operation to the entryway alcove — the narrow four-foot choke point between the front door, the "
    + "coat hooks, and the bathroom door, the only way out of the apartment.";

  const s = world();
  check("it writes her one", rememberOwnAct(s, "char_abi", WHAT, "Unit 3B Living Room", 13));
  const m = s.memory["char_abi"].episodic[0];
  check("...in her own mouth", /^Around 12:50 I decide the couch campaign/.test(m.content), m.content);
  check("...as something she lived, not something she heard", m.source === "offstage", m.source);
  check("...above a witness's weight, because she did it", (m.importance ?? 0) > 7, m.importance);
  check("...stamped with where and when", m.where === "Unit 3B Living Room" && !!m.when_label, m);

  // the player is never authored from a report they were not in
  const p = world();
  check("the player is never given one", rememberOwnAct(p, "char_player", WHAT, "Unit 3B Living Room", 13) === false);
  check("...and nothing is written for them", !p.memory["char_player"]);
  // an actor the cast does not contain
  const g = world();
  check("a stranger the cast has no record of gets nothing",
    rememberOwnAct(g, "char_ghost", WHAT, "Unit 3B Living Room", 13) === false);
  check("and a blank event writes nothing", rememberOwnAct(world(), "char_abi", "", "", 13) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
