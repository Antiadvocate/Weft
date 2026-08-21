/* Smoke test: THE WIND, IN FORTY OF FORTY-SEVEN TURNS.
 *
 * The player: "there's so. much. fucking. prose. If I have to hear about her fucking Henley or the
 * wind I'm going to lose it." Measured off the save they sent:
 *
 *   wind 40 turns of 47   window 27   glass 20   frame 17   rattle 15
 *
 *   T13  the wind rattling the old factory frame
 *   T17  The wind rattled the factory windows, a low, persistent sound against the glass.
 *   T45  The wind came against the windows. One of the frames rattled and settled.
 *   T46  The wind came hard against the glass and the whole frame shuddered.
 *
 * The prose is not actually long: that save averages 234 words a turn and never once passes 400.
 * What is wrong is density — the same weather beat every turn, until the reader skips a paragraph on
 * sight and no piece of setting means anything any more.
 *
 * THE RULE EXISTS AND IS BEING OBEYED. "Do not END a turn on weather, rooms, or ambient sound. End on
 * a person." Every one of those stings is in the MIDDLE of its turn. The clause that would stop it —
 * "setting appears only when someone acts on it or it changes the situation" — asks the model to
 * judge its own sentence, which is the instruction shape this engine has learned repeatedly does not
 * hold.
 *
 * TWO HALVES, AND ONLY ONE OF THEM CAN BE CUT. A free-standing setting sentence can be excised
 * safely. A setting CLAUSE hung off a person's sentence cannot — that is how the tic guard once left
 * a bare quotation mark and an attribution for a line that was not there. So clauses are reported to
 * the next turn instead, the way maxims.ts and echo.ts report.
 */
import { trimAmbient, hasPerson, isAmbient, overusedAmbient, ambientFix } from "../src/engine/ambient";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const CAST = ["Vin", "Miranda", "Chloe", "Leo"];

/* ── 1. who is in the sentence ────────────────────────────────────────────────── */
{
  check("nobody is in the wind", !hasPerson("The wind came against the windows.", CAST));
  check("a pronoun is a person", hasPerson("The kettle clicked off behind her.", CAST));
  check("a name is a person", hasPerson("The lamp lit the side of Miranda's face.", CAST));
  check("speech is always the scene", hasPerson(`"Bedtime."`, CAST));
}

/* ── 2. THE LINE THE DRY RUN MOVED. Person-less is not the same as atmospheric ───
 *
 * The first draft cut any sentence with nobody in it, and over that save it took "The phone on the
 * counter lit up, its screen flashing against the concrete island" — which is not atmosphere at all,
 * it is Chloe's text arriving, which is the plot. A guard that trims the story to fix the wallpaper
 * is worse than the wallpaper. */
{
  check("the wind is atmosphere", isAmbient("The wind came against the windows."));
  check("the glass in its frame is atmosphere", isAmbient("The glass gave a long, low creak."));
  check("a phone lighting up is an EVENT, not atmosphere",
    !isAmbient("The phone on the counter lit up, its screen flashing against the concrete island."));
  check("...so is a kettle", !isAmbient("The kettle clicked off."));
  check("...and a door", !isAmbient("The door swung wide."));
}

/* ── 3. one is atmosphere, four is wallpaper ─────────────────────────────────── */
{
  const para = "The wind came against the windows. The glass gave a long creak. The room was cold. She set the book down.";
  const r = trimAmbient(para, CAST, "");
  check("the first setting sentence survives", /The wind came against the windows\./.test(r.prose), r.prose);
  check("the rest go", r.cuts === 2, r);
  check("and the person is never touched", /She set the book down\./.test(r.prose), r.prose);
}

/* ── 4. and none at all if last turn already used it ─────────────────────────── */
{
  const prev = "The wind rattled the factory windows. She poured the tea.";
  const now = "The wind came hard against the glass. She looked up.";
  const r = trimAmbient(now, CAST, prev);
  check("a motif repeated from last turn gets no allowance", r.cuts === 1, r);
  check("...and it is the wind that went", !/wind/i.test(r.prose), r.prose);
  check("...while the person stays", /She looked up\./.test(r.prose), r.prose);

  const fresh = trimAmbient("The rain started against the glass. She looked up.", CAST, prev);
  check("a DIFFERENT motif still gets its one", fresh.cuts === 0, fresh);
}

/* ── 5. the guards, which matter more than the cutting ───────────────────────── */
{
  const lone = "The wind came against the windows.";
  check("a paragraph that is one sentence is never emptied", trimAmbient(lone, CAST, lone).prose === lone);
  const long = "The wind came against the windows and the frames took it the way they had taken it every winter since the mill closed, which was the sound she had gone to sleep to as a child.";
  check("a long sentence is carrying something and is left",
    trimAmbient(`${long} The glass creaked. She stood.`, CAST, "").prose.includes(long));
  const quoted = `"Bedtime," she said. The wind came. The glass creaked. The room was cold.`;
  const q = trimAmbient(quoted, CAST, "");
  check("quotes stay balanced", (q.prose.match(/["“”]/g) ?? []).length % 2 === 0, q.prose);
}

/* ── 6. the clause case, which is reported rather than cut ───────────────────── */
{
  // the real shape: a setting clause riding a sentence that has a person in it
  const clause = "She was quiet for a moment, the wind rattling the factory windows, the river dark beyond the glass.";
  check("a setting clause on a person's sentence is NOT cut",
    trimAmbient(clause + " She looked at him.", CAST, "").cuts === 0);

  const recent = [
    "She poured the tea, the wind against the glass.",
    "He read on, the wind rattling the frame.",
    "The kettle clicked. She said nothing, the wind still at the windows.",
  ];
  const over = overusedAmbient(recent, CAST);
  check("but three turns running is caught", over.includes("wind"), over);
  const fix = ambientFix(over, "She said nothing, the wind still at the windows.");
  check("...and the next turn is told, quoting what it wrote", /wind still at the windows/.test(fix), fix);
  check("...told not to use it in a clause either", /in a clause/.test(fix), fix);
  check("...and given somewhere else to go", /what someone is doing with their hands|smells like/.test(fix), fix);

  check("one mention across three turns is not overuse",
    !overusedAmbient(["The wind came.", "She poured the tea.", "He read on."], CAST).includes("wind"));

  // AND NOT EVERY AMBIENT WORD CAN BE TAKEN AWAY. The trim can afford a broad vocabulary — it only
  // removes a whole sentence nobody is in, and the first one always survives. A ban cannot: the dry
  // run over the save wanted to forbid "sound", "creak" and "morning" alongside the wind, and prose
  // needs those. Only concrete scenery the reader pictures is bannable.
  const generic = ["The sound came again in the morning light.", "A sound in the morning light.", "The morning light, and a sound."];
  const g = overusedAmbient(generic, CAST);
  check("a sound is never banned", !g.includes("sound"), g);
  check("nor the light", !g.includes("light"), g);
  check("nor the time of day", !g.includes("morning"), g);
  check("but the wind is", overusedAmbient(["the wind", "the wind again", "the wind still"], CAST).includes("wind"));
  check("and a correction names two things at most, not four",
    overusedAmbient(["wind glass window rain", "wind glass window rain", "wind glass window rain"], CAST).length <= 2);
  check("and nothing to say means nothing said", ambientFix([], "") === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
