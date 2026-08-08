/* Smoke test: FOUR WAYS A CARD MISREPRESENTED ITS OWN CONTENTS.
 *
 * None of these are model failures. Each is the engine damaging or hoarding a record after the
 * model wrote it correctly.
 *
 * 1. THE GM "what they concealed" PANEL ATE ITS OWN SENTENCES. `deQuote` strips dialogue out of the
 *    intent pass (which runs BEFORE the narrator, so any line it drafts was never spoken). Its
 *    quoted-span pattern opened on a bare apostrophe, so in
 *      "a half-smile that doesn't quite reach his eyes. He's about to leave"
 *    it matched from the apostrophe in doesn't to the one in He's and deleted everything between —
 *    "doesns about to leave". A whole save's worth of intents read like this: "Het push or ask for
 *    anything", "Hes hostility", "as if the words havent reach for her hair", "shet fall apart".
 * 2. INJURIES NEVER HEALED AND NEVER DEDUPED. Conditions have had a timer since they existed;
 *    injuries had neither, so "cut palms from clenching fists" sat on the card three times over,
 *    each copy still labelled as having happened this turn, sixty turns after the fist.
 * 3. THE SAME PANEL STOPPED MID-THOUGHT. A hard slice at 300 characters left intents ending
 *    "…She wants to" and "…and she is terrified that space is".
 * 4. A COMMA IS NOT ALWAYS A SEPARATOR. One trait written as a sentence became three list items,
 *    two of which say nothing alone. */
import { newSave, registerCharacter } from "../src/engine/state";
import { splitLines, applyDiff, healMinorInjuries } from "../src/engine/turn";
import { deQuoteIntent, clip } from "../src/engine/intent";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. apostrophes are not quote marks ──────────────────────────────────────── */
{
  const real = "He pauses at the door, hand on the frame, looking back with a half-smile that doesn't quite reach his eyes. He's about to leave but something makes him linger.";
  const out = deQuoteIntent(real);
  check("a sentence full of contractions survives intact", out === real, out);
  check("and does not collapse into wreckage", !/doesns|Het |Hes hostility/.test(out), out);

  const two = "She's terrified he'll go before she can say it, and she doesn't know how to start.";
  check("three contractions in one line survive", deQuoteIntent(two) === two, deQuoteIntent(two));

  const curly = "He’s already halfway out, and he doesn’t look back.";
  check("curly apostrophes survive too", deQuoteIntent(curly) === curly, deQuoteIntent(curly));

  // what the stripper is actually FOR: dialogue the intent pass invented before the scene existed
  const spoken = 'She holds herself still and says, "I never meant for you to find out like that."';
  check("invented dialogue is still removed", !/never meant for you/.test(deQuoteIntent(spoken)), deQuoteIntent(spoken));
  const bare = 'Guarded and clipped. "You said you would be home by six." She will not look at him.';
  check("a bare quoted line is still removed", !/home by six/.test(deQuoteIntent(bare)), deQuoteIntent(bare));

  // a genuine single-quoted aside opens and closes at word boundaries
  const single = "He calls it 'the arrangement' when he has to name it at all.";
  check("a properly bounded single-quoted span is still removed", !/the arrangement/.test(deQuoteIntent(single)), deQuoteIntent(single));
}

/* ── 2. one hurt, and it heals ───────────────────────────────────────────────── */
function world(): SaveState {
  const s = newSave("cards", {
    name: "The Arrangement",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  s.world.current_turn = 40;
  return s;
}
const hurt = (s: SaveState, value: string) =>
  applyDiff(s, { facts: [{ char_id: "char_player", field: "injury", value }] } as any, "I clench my fists.", "His fists close until the nails bite.");

{
  const s = world();
  hurt(s, "cut palms from clenching fists");
  s.world.current_turn = 42;
  hurt(s, "cut palms from clenching fists");
  s.world.current_turn = 44;
  hurt(s, "cut palms from clenching fists");
  const inj = s.condition.char_player.injuries;
  check("the same hurt three times is one hurt", inj.length === 1, inj.map((i) => i.type));
  check("and re-earning it refreshes when it was taken", inj[0].turn === 44, inj[0]);
}
{
  const s = world();
  hurt(s, "cut palms from clenching fists");
  hurt(s, "twisted ankle");
  check("two different hurts are two hurts", s.condition.char_player.injuries.length === 2, s.condition.char_player.injuries.map((i) => i.type));
}

/* the healing timer */
{
  const s = world();
  hurt(s, "cut palms from clenching fists");
  const inj = s.condition.char_player.injuries[0];
  check("a new injury is stamped with the turn it was taken", inj.turn === 40, inj);
  check("and does not heal while it is still fresh", healMinorInjuries(s.condition.char_player, 45).length === 0);
  check("nor the turn before its time", healMinorInjuries(s.condition.char_player, 51).length === 0);
  const healed = healMinorInjuries(s.condition.char_player, 52);
  check("a scrape heals on its own eventually", healed.length === 1, healed);
  check("and leaves the body", s.condition.char_player.injuries.length === 0, s.condition.char_player.injuries);
}
{
  // the whole reason conditions got this treatment: the clock must never heal real damage
  const s = world();
  hurt(s, "compound fracture of the left forearm");
  hurt(s, "eviscerated and exposed");
  const healed = healMinorInjuries(s.condition.char_player, 400);
  check("severe damage never heals on a timer", healed.length === 0, healed);
  check("and stays on the body", s.condition.char_player.injuries.length === 2);
}
{
  const s = world();
  hurt(s, "cut palms from clenching fists");
  s.condition.char_player.injuries[0].permanent = true;
  check("a permanent injury is never on a clock", healMinorInjuries(s.condition.char_player, 400).length === 0);
}
{
  // an old save's injuries carry no stamp at all — they must not vanish the moment it is opened
  const s = world();
  hurt(s, "cut palms from clenching fists");
  delete (s.condition.char_player.injuries[0] as any).turn;
  check("an unstamped injury starts its clock now, not at zero", healMinorInjuries(s.condition.char_player, 90).length === 0);
  check("and is stamped so it heals from here", s.condition.char_player.injuries[0].turn === 90, s.condition.char_player.injuries[0]);
}

/* ── 3. a field with a ceiling does not stop mid-thought ─────────────────────── */
{
  const long = "She is terrified that his silence means he has already decided to leave her. She is scrambling to find any way to make him see that her affair was an act of love before he walks away for good. She wants to reach for him and cannot make her hands move.";
  const out = clip(long, 200);
  check("a long intent is cut at a sentence, not mid-word", /[.!?]$/.test(out), out);
  check("and keeps what it can", out.length > 100 && out.length <= 200, out.length);
  check("a short intent is untouched", clip("She holds herself very still.", 300) === "She holds herself very still.");

  // no sentence boundary anywhere in budget: fall back to a whole word plus an ellipsis
  const runOn = "she is terrified he will go before she can say it and she does not know how to start and the words keep arriving in the wrong order every single time she tries";
  const cut = clip(runOn, 60);
  check("a run-on is cut at a word boundary", !/\s$/.test(cut) && cut.endsWith("…"), cut);
  check("and never mid-word", runOn.startsWith(cut.slice(0, -1)), cut);
}

/* ── 4. a comma is not always a separator ────────────────────────────────────── */
{
  check("a real comma list still splits",
    JSON.stringify(splitLines("adhd, Hypercompetant when stressed, Keeps his emotions controlled"))
      === JSON.stringify(["adhd", "Hypercompetant when stressed", "Keeps his emotions controlled"]));

  const sentence = "Notices when someone's drink is empty and refills it without being asked, every time, in any room.";
  check("one trait written as a sentence stays one trait",
    JSON.stringify(splitLines(sentence)) === JSON.stringify([sentence]), splitLines(sentence));

  const palette = "The king's spies are everywhere, and Rabi's power could be seen as a threat or a tool.";
  check("a bible line is not shredded either",
    JSON.stringify(splitLines(palette)) === JSON.stringify([palette]), splitLines(palette));

  check("newlines always win", JSON.stringify(splitLines("a, b\nc, d")) === JSON.stringify(["a, b", "c, d"]));
  check("nothing stays nothing", splitLines("").length === 0);
  check("a lone item stays whole", JSON.stringify(splitLines("one item only")) === JSON.stringify(["one item only"]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
