/* Smoke test: THE PRIVACY LABEL COVERED ONE SENTENCE OF SIX.
 *
 * Rome, 41 AD, turn 33. A woman the player met three minutes earlier opens with:
 *
 *     "You have been in Rome three days."
 *
 * She was not guessing. The PRESENT block printed the player's background twice. The first copy
 * carried the label — "PRIVATE authorial background… no character knows the player's job, history,
 * hometown, or anatomy until the player reveals it aloud" — and was cut to `background.split(/[.!?]/)[0]`,
 * the first sentence: "An electrical engineer from 2026, he worked on power grid automation."
 *
 * Eight lines below, the same block printed the player's memory CORE, which is the whole background
 * verbatim, under a bare `CORE:` that reads like established fact:
 *
 *     CORE: An electrical engineer from 2026… He arrived in Rome three days ago, disoriented and
 *     terrified, and has been sleeping rough near the Tiber.
 *
 * So the one sentence the cast kept quoting existed in the narrator's context exactly once, in the
 * copy with no label on it. Measured on the real save: six matches for the private background in
 * one digest, and "three days ago" appeared only in the unlabelled one.
 */
import { volatileDigest } from "../src/engine/prompts";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const BACKGROUND = "An electrical engineer from 2026, he worked on power grid automation. He has no family in this time, no Latin beyond a few phrases, and no legal status. He arrived in Rome three days ago, disoriented and terrified, and has been sleeping rough near the Tiber.";

function rome(): SaveState {
  const s = newSave("private", { name: "Rome, 41 AD", era: "Early Roman Empire" } as any);
  registerCharacter(s, { name: "Marcus Valerius", character_id: "char_player", background: BACKGROUND } as any);
  registerCharacter(s, { name: "Claudia Antonia", character_id: "char_c", pronouns: "she/her", background: "Wife of a freedman of the imperial household." } as any);
  s.world.places.loc_forum = { id: "loc_forum", name: "The Forum Romanum", identity: "The heart of Rome.", description_facts: "", contains: [] } as any;
  s.world.player_location = "loc_forum";
  s.characters["char_player"].location = "loc_forum";
  s.characters["char_c"].location = "loc_forum";
  s.world.present = ["char_c"];
  s.world.current_turn = 33;
  s.memory["char_player"].core = [BACKGROUND];
  s.memory["char_player"].facts = [{ content: "Titus says there is work at the baths carrying wood for the furnaces.", turn: 1, source: "inferred" } as any];
  s.memory["char_c"].core = ["Wife of a freedman of the imperial household."];
  return s;
}

/* ── 1. the sentence the cast was reading off ────────────────────────────────── */
{
  const d = volatileDigest(rome(), "");
  const copies = [...d.matchAll(/three days ago/gi)];
  check("the fact appears exactly once", copies.length === 1, copies.length);
  check("...and it is inside the privacy label", (() => {
    const at = copies[0]?.index ?? -1;
    if (at < 0) return false;
    const label = d.lastIndexOf("PRIVATE authorial background", at);
    // nothing else may open between the label and the fact
    return label >= 0 && !d.slice(label, at).includes("\n  ");
  })(), "the fact escaped its label");

  check("no bare CORE line for the player", !/\n\s*CORE: An electrical engineer/.test(d), "the unlabelled duplicate is still printed");
  check("the label now names how long he has been here", /how long they have been here/.test(d));
  check("what he does know is marked as his own",
    /WHAT THE PLAYER HIMSELF KNOWS AND REMEMBERS/.test(d) && /nobody here has access to any of it unless he said it out loud/.test(d));
}

/* ── 2. and the rest of the cast is untouched — NPC memory is the room's ─────── */
{
  const s = rome();
  s.memory["char_c"].core = ["Wife of Gaius Antonius Felix, born a slave in the household of Antonia Minor."];
  const d = volatileDigest(s, "");
  check("an NPC still carries a plain CORE", /CORE: Wife of Gaius Antonius Felix/.test(d));
  check("...and is not wrapped in the player's privacy frame",
    (d.match(/WHAT THE PLAYER HIMSELF KNOWS/g) ?? []).length === 1);
}

/* ── 3. a background with no sentence break is not truncated to nothing ──────── */
{
  const s = rome();
  s.characters["char_player"].background = "A man with no past anyone here can name";
  s.memory["char_player"].core = [];
  const d = volatileDigest(s, "");
  check("the whole line survives", /A man with no past anyone here can name/.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
