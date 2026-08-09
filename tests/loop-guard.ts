/* Smoke test: A DECODER THAT FALLS INTO A LOOP, AND THE FIELD THAT KEEPS IT FOREVER.
 *
 * From a save, Jess's active want:
 *
 *   "Continue to nurture the quiet intimacy with Rabi, deepening the shared private language with
 *    Jess and Jess's and Rabi's and Rabi's and Rabi's Rabi and Rabi and Rabi and Rabi and Rabi and
 *    Rabi and Rabi and Rabi and Rabi and Rabi and Rabi and Rabi and Rabi…"   — for six hundred chars
 *
 * Degeneration is ordinary; models do it. In PROSE it is obvious and the player rerolls. In a short
 * STATE field it is quiet and permanent: it renders on the card, it goes back into the next prompt as
 * the character's current want, and it re-seeds itself every turn.
 *
 * `cleanMood` already handles exactly this for moods — and could not have caught this one, because it
 * splits on punctuation and this loop is a repeated n-gram inside a single clause. coerce.ts is the
 * module whose stated job is that nothing model-authored reaches state without passing through it;
 * this went around it, along with the truncation that left Clara's approach ending "a favour that
 * requires". */
import { deLoop, tidyPhrase } from "../src/engine/coerce";
import { newSave, registerCharacter, sanitize } from "../src/engine/state";
import { applyDiff } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const LOOPED = "Continue to nurture the quiet intimacy with Rabi, deepening the shared private language with Jess and Jess's"
  + " and Rabi's and Rabi's and Rabi's Rabi" + " and Rabi".repeat(60);

/* ── 1. the loop ─────────────────────────────────────────────────────────────── */
{
  const out = deLoop(LOOPED);
  check("a six-hundred-character loop is cut down", out.length < 130, out.length);
  check("and the loop does not survive", (out.match(/and Rabi/g) ?? []).length <= 1, out);
  check("while what it was actually saying is kept", out.startsWith("Continue to nurture the quiet intimacy with Rabi"), out);
  check("and it does not end on a dangling connective", !/\b(and|or|with|the|a|of|to)$/i.test(out), out);
}
{
  check("an ordinary want is untouched",
    deLoop("Get Rabi alone in her house this week, on the pretext of the vintage business.")
      === "Get Rabi alone in her house this week, on the pretext of the vintage business.");
  check("so is a short one", deLoop("Find the right words.") === "Find the right words.");
  check("and repetition that is not a loop survives",
    deLoop("She wants him to stay, and to say so, and to mean it.").length > 40);
  check("nothing stays nothing", deLoop("") === "" && deLoop(undefined as any) === "");
  // a field that is ALL loop must not vanish — an empty want is a different bug from a noisy one
  check("a field that is nothing but loop keeps one copy", deLoop("and Rabi ".repeat(20)).length > 0);
}

/* ── 2. the ceiling does not read as a lost thought ──────────────────────────── */
{
  const long = "Catches him over the fence and asks his opinion on which of two heavy sideboards he'd help her shift into the study — a favour that requires two people and twenty minutes";
  const out = tidyPhrase(long, 140);
  check("a long approach is cut at a word, not mid-word", out.endsWith("…") && !/\srequ…$/.test(out), out);
  check("and stays inside its ceiling", out.length <= 142, out.length);
  check("a short one is returned whole", tidyPhrase("Asks him to rub her feet.", 140) === "Asks him to rub her feet.");
  check("and a looped one is de-looped before it is measured", tidyPhrase(LOOPED, 160).length < 130);
}

/* ── 3. it reaches state through every door a drive has ──────────────────────── */
function world(): SaveState {
  const s = newSave("loop", {
    name: "CuldeSac of the Heart",
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Jess", character_id: "char_jess" } as any);
  s.world.current_turn = 47;
  s.world.present = ["char_jess"];
  const pid = "loc_kitchen";
  s.world.places[pid] = { id: pid, name: "the kitchen", description_facts: "A table.", contains: [] } as any;
  s.world.player_location = pid;
  s.characters.char_jess.location = pid;
  return s;
}
{
  const s = world();
  applyDiff(s, { drives_update: [{ char_id: "char_jess", goal: LOOPED, progress: 10 }] } as any,
    "I ask what she wants.", "Jess looks up from the table. Jess says nothing for a moment.");
  const d = s.characters.char_jess.drive!;
  check("the bookkeeper cannot write a looped want into state", d.goal.length < 170, d.goal.length);
  check("and the want is still legible", /Continue to nurture/.test(d.goal), d.goal);
}
{
  const s = world();
  applyDiff(s, { drives_update: [{ char_id: "char_jess", goal: "Tell him tonight.", approach: LOOPED, progress: 0 }] } as any,
    "I ask what she wants.", "Jess looks up from the table.");
  check("nor a looped approach", (s.characters.char_jess.drive?.approach ?? "").length < 150, s.characters.char_jess.drive);
}
{
  // and a save already carrying one repairs itself when it is opened
  const s = world();
  s.characters.char_jess.drive = { goal: LOOPED, progress: 30, priority: 1, updated_turn: 46 };
  s.characters.char_jess.drive_queue = [{ goal: LOOPED, progress: 0, priority: 1, updated_turn: 46 }];
  const healed = sanitize(JSON.parse(JSON.stringify(s)));
  check("an existing save heals on load", healed.characters.char_jess.drive!.goal.length < 170, healed.characters.char_jess.drive!.goal.length);
  check("including the queued wants behind it", healed.characters.char_jess.drive_queue![0].goal.length < 170);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
