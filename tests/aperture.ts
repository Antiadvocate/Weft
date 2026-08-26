/* Smoke test: THE APERTURE — a settled woman who talks like a deposition.
 *
 * From the save this was built on, turns 21–28: 65% of the spoken lines are about the deed and the
 * money, 3% touch any of the four standing interests on her card, she has the last word in 15 turns
 * of 17, and four turns running end with her telling the player what happens next. Her relaxation
 * is +2.51 against a resting point of 2, with a 28-turn settled run behind it.
 *
 * The player's words: "There is zero flexibility. The environment doesn't affect her pattern."
 *
 * Fixture prose below is trimmed from that save. What is being tested is that the engine can now
 * SEE all four of those numbers, that a vocative does not hand her lines to the man she is talking
 * to, and that a character behaving perfectly ordinarily still gets no note at all.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import {
  apertureOf, attributeLines, wantSaturation, steeringStreak, driftSubject,
  apertureNote, heardYouNote, isInstruction, SATURATED_AT, STEERING_AT,
} from "../src/engine/aperture";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* Four turns of a woman doing exactly one thing. Each paragraph's subject is the speaker and every
 * line she says has HIS name inside the quotation marks — the shape that breaks a proximity test. */
const TURNS = [
  `Amber laid the pen flat beside the deed.\n"How do I have a house. I bought it, Vin. Six years of clinic splits and a down payment I saved the way you're supposed to."\nDana shifted in her chair.\n"I can leave you two a minute."\nAmber did not look away from him.\n"Sign the paper, Vin. Then we go get gas."`,
  `Amber's eyes followed the deed the whole way across the desk.\n"Forty-two. Recording fee. You'll want the county copy stamped before the notary Thursday."\nShe leaned in close to his ear.\n"You're on the deed. That's half a house, Vin. Now let's go get gas. I'll explain the mortgage to you at the pump."`,
  `Amber unfolded the envelope against the roof of the car.\n"Principal, interest, escrow. Eleven eighty-two. That's what the house costs every month. I put twenty percent down, so there's no PMI, and the rate's fixed."\nA man in a canvas apron walked past with a box of glassware.\n"Half the payment, half the roof. Get in, Vin. We'll get gas and then I'm making you lunch."`,
  `Amber sat with both hands on the wheel and did not start the engine.\n"Equity's maybe a hundred and ten after the realtor's six. Except I don't want to sell the house, Vin. Half of a hundred and ninety-two is ninety-six thousand dollars. That's what you signed."\nThe dash lights glowed across her forearms.\n"Start the car, Vin. Take me home."`,
];

function world() {
  const s: any = newSave("t", { name: "Vin" } as any);
  s.world.places["loc_bank"] = { id: "loc_bank", name: "Credit Union", description_facts: "A small desk area and a black card reader.", contains: [] };
  s.world.places["loc_gym"] = { id: "loc_gym", name: "The Rock Climbing Gym", description_facts: "Towering textured walls of bright colors, the smell of chalk dust and sweat.", contains: [] };
  s.world.player_location = "loc_bank";
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  registerCharacter(s, {
    name: "Amber Rey", character_id: "char_amber", age: 27,
    core_traits: ["Spots people's injuries on sight and says so unasked"], values: ["fairness"],
    speech_pattern: "Money and materials only.", skills: {},
    texture: [
      "Trad climbing and old bolted routes she's proud of ticking off",
      "Cheap diners and the correct ranking of their breakfasts",
      "Pour-over coffee and her contempt for anyone using a pod machine",
      "Rubs the scar on her eyebrow with a thumb when she's holding something back",
    ],
  } as any);
  s.characters["char_amber"].central = true;
  s.characters["char_amber"].drive = { goal: "Keep the house and make Vin feel at home in it, without letting him pay her back", progress: 0, priority: 1, updated_turn: 28 };
  s.characters["char_player"].location = "loc_bank";
  s.characters["char_amber"].location = "loc_bank";
  s.world.present = ["char_player", "char_amber"];
  s.world.current_turn = 29;
  s.condition["char_amber"].psyche = { ...s.condition["char_amber"].psyche, relaxation: 2.51, capacity: 2, open_run: 28, mood: "relieved and tender" };
  s.history = TURNS.map((prose, i) => ({ turn: 25 + i, kind: "turn", player_action: "", narrator_prose: prose, summary: "", offscreen: [], time_label: "", weather: "" }));
  return s;
}

/* ── bands ─────────────────────────────────────────────────────────────────── */
check("a braced body is narrowed", apertureOf(-6) === "narrowed");
check("the middle is working", apertureOf(-1) === "working" && apertureOf(1.9) === "working");
check("an ordinary settled body is wide", apertureOf(2.51) === "wide", apertureOf(2.51));

/* ── attribution: the vocative must not steal the line ─────────────────────── */
{
  const at = attributeLines(TURNS[0], ["Vin", "Amber Rey", "Dana"]);
  check("her lines are hers even when she says his name inside them", (at["amber"] ?? []).length === 2, at);
  check("the man she is talking to is not credited with them", !(at["vin"] ?? []).length, at["vin"]);
  check("a second speaker in the same turn keeps her own line", (at["dana"] ?? []).length === 1, at["dana"]);
}

/* ── still talking about it ────────────────────────────────────────────────── */
{
  const s = world();
  const run = wantSaturation(s, "char_amber");
  check("four turns on the same want is measured as saturation", run >= SATURATED_AT, run);
  // The same woman with the same mouth and a want about something else is not saturated: the
  // detector has to be reading the want, not the fact that she talks a lot.
  const t = world();
  t.characters["char_amber"].drive = { goal: "find out who has been leaving the gate open at the clinic", progress: 0, priority: 1, updated_turn: 28 };
  check("a want the talking is NOT about does not fire", wantSaturation(t, "char_amber") < SATURATED_AT, wantSaturation(t, "char_amber"));
}

/* ── and still running the scene ───────────────────────────────────────────── */
{
  const s = world();
  check("\"Start the car, Vin.\" reads as an instruction", isInstruction("Start the car, Vin."));
  check("\"Now let's go get gas.\" reads as one too", isInstruction("Now let's go get gas."));
  check("a plain statement does not", !isInstruction("Equity's maybe a hundred and ten after the realtor's six."));
  const run = steeringStreak(s, "char_amber");
  check("closing every turn with the next step is measured", run >= STEERING_AT, run);
}

/* ── what else is in there ─────────────────────────────────────────────────── */
{
  const s = world();
  const d = driftSubject(s, "char_amber");
  check("a standing interest is offered", !!d && /climbing|diner|coffee/i.test(d.subject), d);
  check("the tic is not offered as a subject", !!d && !/scar|thumb/i.test(d.subject), d);
  const gym = [0, 1, 2].map((i) => { const t = world(); t.world.current_turn = 29 + i; return driftSubject(t, "char_amber"); })
    .find((x) => /climbing/i.test(x?.subject ?? ""));
  check("a real place in this world is named for it", gym?.place === "The Rock Climbing Gym", gym);
  check("nobody with no texture and no skills gets a subject", driftSubject(s, "char_player") === null);
}

/* ── the note ──────────────────────────────────────────────────────────────── */
{
  const s = world();
  const note = apertureNote(s, s.world.present);
  check("the note fires", note.includes("HOW WIDE THE ATTENTION IS"), note.slice(0, 80));
  check("it says the card is the shape she takes under load", /UNDER LOAD/.test(note));
  check("it names the turns she has been on the want", /4 turns running/.test(note), note);
  check("it takes the last word away from her", /DOES NOT HAND OVER THE NEXT STEP/.test(note));
  check("it offers her attention somewhere else", /CATCHABLE/.test(note));
  check("it does not forbid the want", /NOT forbidden|does not have to lead anywhere/i.test(note));
  check("the player is never given a note of their own", !note.includes("[char_player]") && !/· Vin/.test(note));

  // A settled person who has been talking about four different things is working correctly.
  const quiet = world();
  quiet.history = quiet.history.map((h: any) => ({ ...h, narrator_prose: `Amber turned the cup around twice.\n"The pour-over at that place on Quarry is the only one in this town anybody warmed the filter for."` }));
  const qnote = apertureNote(quiet, quiet.world.present);
  check("an ordinary settled turn still gets the open register", qnote.includes("UNDER LOAD"), qnote.slice(0, 60));
  check("and gets no saturation or steering finding", !/turns running/.test(qnote) && !/HAND OVER/.test(qnote), qnote);

  // A braced body doing what a braced body does is not a finding.
  const tight = world();
  tight.condition["char_amber"].psyche.relaxation = -6;
  tight.history = quiet.history;
  check("a clenched, unremarkable turn is silent", apertureNote(tight, tight.world.present) === "", apertureNote(tight, tight.world.present));
}

/* ── I already know ────────────────────────────────────────────────────────── */
check("the player's own line fires it",
  heardYouNote("\"I'm a grownup Amber... I understand how a mortgage works hah but sure.\"").includes("ALREADY KNOW"));
check("so does being told twice", heardYouNote("you already told me that last night").includes("ALREADY KNOW"));
check("an ordinary line does not", heardYouNote("I pull up my ID \"here you go\"") === "");
check("nor does asking to be told", heardYouNote("\"How does the mortgage work?\"") === "");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
