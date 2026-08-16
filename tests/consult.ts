/* Smoke test: WHEN THE PLAYER READS SOMETHING, THE READING GOES ON THE PAGE.
 *
 * Rome, 41 AD. The player character is an engineer from 2026 with a phone in his pocket and a local
 * model running on it — the only thing in the world that will answer him. Turn 1 he switches it on
 * and asks it how to survive. Turn 2 he types, as his entire action:
 *
 *     I watch the reply from the ai. What does it say?
 *
 * and the narration answers: "The screen lit with the LLM's answer — clean paragraphs of survival
 * advice in a world with no word for any of it. The glare threw a pale rectangle across the mud."
 * Twice the prose reported that an answer existed and never gave one word of it.
 *
 * The elision is manufactured by rules that are each correct on their own — the setting's facts are
 * fixed, the camera reports what a person could point at, paragraphs end on something in the room —
 * so it takes a rule that says the thing none of them says. Two halves are tested here: that the
 * question is recognised from the PLAYER'S own typed words (where no other rule is competing to
 * phrase it differently), and that a question put to a person is still just dialogue.
 */
import { consultTarget, consultDirective } from "../src/engine/consult";
import { newSave, registerCharacter } from "../src/engine/state";
import { NARRATOR_SYSTEM, NARRATOR_SYSTEM_LEAN } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("consult", {
    name: "Rome, 41 AD",
    technology_level: "Iron Age Mediterranean; no electricity, no printing press",
  } as any);
  registerCharacter(s, { name: "Marcus Valerius", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Titus Aelius Rufus", character_id: "char_t", pronouns: "he/him" } as any);
  registerCharacter(s, { name: "Livia Aelia", character_id: "char_l", pronouns: "she/her" } as any);
  s.world.places.loc_bank = { id: "loc_bank", name: "The Tiber Embankment", description_facts: "", contains: [] } as any;
  s.world.player_location = "loc_bank";
  for (const id of ["char_player", "char_t", "char_l"]) s.characters[id].location = "loc_bank";
  s.world.present = ["char_t", "char_l"];
  s.world.current_turn = 3;
  return s;
}

/* ── 1. the turn that caused this ────────────────────────────────────────────── */
{
  const s = world();
  const t2 = "I watch the reply from the ai. What does it say?";
  check("the question is seen", !!consultTarget(s, t2), consultTarget(s, t2));

  const d = consultDirective(s, t2);
  check("the words are named as the substance of the turn", /SUBSTANCE OF THIS TURN/.test(d));
  check("...and the exact evasion is named", /the screen filled/i.test(d) && /read what it told him/i.test(d), d.slice(0, 400));
  check("the source's horizon is established before anything is written", /WORK OUT FIRST WHAT THIS PARTICULAR SOURCE CAN KNOW/.test(d));
  check("its claim is not made a fact of the world", /NOT A FACT OF THIS WORLD/.test(d));
  check("it cannot read the state", /cannot report what a person here wants/.test(d));
  check("the reading is bounded so it does not eat the turn", /under eighty/.test(d));
  check("the room does not overhear it", /Titus Aelius Rufus, Livia Aelia/.test(d) && /unless the player reads it out loud/.test(d), d.slice(-400));
  check("a wrong firing costs a paragraph, never an invented text",
    /IF THE PLAYER TOUCHED NOTHING THIS TURN THAT ANSWERS IN WORDS/.test(d) && /Do not put a text in his hands/.test(d));
}

/* ── 2. the shapes a player actually types ───────────────────────────────────── */
{
  const s = world();
  const fires = [
    "What does the ai say",
    "What does it say?",
    "I read the letter",
    "I unroll the scroll and see what is written on it",
    "I check my phone again",
    "I ask the phone how to say bread in Latin",
    "I look at the map he gave me",
    "What's on the screen?",
    `"Hi. I must be in Rome" I take out my phone and ask the local llm what it knows about this place`,
    // turn 1 of the save, verbatim — the turn the debt was first incurred: he switches the thing on
    // and puts the question to it in the speech channel, and the prose answered with a lit screen
    `"Hi. I must be in Rome" I take my phone out of my pocket and turn on the local LLM "I am in Rome... how do I... I don't know survive. I have no money or anything"`,
  ];
  for (const f of fires) check(`fires: ${f.slice(0, 48)}`, !!consultTarget(s, f), consultTarget(s, f));
}

/* ── 3. and what it leaves alone — a question put to a PERSON is dialogue ────── */
{
  const s = world();
  const quiet = [
    `"What do you say, then?"`,
    "What does she say to that?",
    "I ask Livia what her father decided",
    "I ask her about the letter",
    "I read her face for a moment",
    "I tell Titus I can carry wood",
    "I sit down on the bank and wait",
    "I look around the market for bread",
  ];
  for (const q of quiet) check(`quiet: ${q.slice(0, 48)}`, consultTarget(s, q) === null, consultTarget(s, q));
  for (const q of quiet) check(`...and emits nothing: ${q.slice(0, 34)}`, consultDirective(s, q) === "");
}

/* ── 4. THE STANDING LAW, because a directive only fires on the turn it fires ──
 *
 * The per-turn paragraph catches the player asking. What it cannot catch is a source the PROSE
 * puts in front of the player — a notice on a wall, a tablet handed over — so the rule has to be
 * law in the narrator's own document as well, in both the full prompt and the lean one, and the
 * carve-out has to sit next to the rule it is a carve-out from.
 */
{
  for (const [label, p] of [["full", NARRATOR_SYSTEM], ["lean", NARRATOR_SYSTEM_LEAN]] as const) {
    check(`${label}: the law is stated`, /WHAT IS READ GOES ON THE PAGE/.test(p));
    check(`${label}: it sits with the rule it excepts`, (() => {
      const fixed = p.indexOf("setting's facts are fixed") >= 0 ? p.indexOf("setting's facts are fixed") : p.indexOf("SETTING'S FACTS ARE FIXED");
      const read = p.indexOf("WHAT IS READ GOES ON THE PAGE");
      return fixed >= 0 && read > fixed && read - fixed < 2600;
    })(), "the carve-out drifted away from the rule it carves out of");
    check(`${label}: the evasion is named`, /screen lit with its answer/.test(p));
    check(`${label}: the source's horizon binds it`, /never seen this place, these people/.test(p));
    check(`${label}: the final check asks for it`, /actual words on the page/.test(p.split("FINAL CHECK")[1] ?? ""));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
