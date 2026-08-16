/* Smoke test: THE GUARD READ THREE FIELDS THAT ARE USUALLY EMPTY, AND A WORD IS AN ANACHRONISM TOO.
 *
 * Rome, 41 AD. The player is an engineer from 2026 whose card reads "He wears a modern t-shirt and
 * jeans, now filthy and torn, and carries an iPhone in an OtterBox case." Every turn of that save:
 *
 *     wearing: []   inventory: []   appearance_now: ""   →  visibleOnPlayer() === ""
 *
 * The three fields the guard read are the ones nothing fills — `wearing` and `inventory` are written
 * by the simulator only when something CHANGES, and `appearance_now` only when a look changes. The
 * field that is populated at creation, always, is `appearance_facts`, and the guard never looked at
 * it. So the entire anachronism comparison was dark for a playthrough whose premise is a man from
 * 2026 standing on the Tiber bank holding a phone.
 *
 * The failure that surfaced it was not an object. The player typed "if you have a sheet of paper and
 * a pencil I can draw it out", and a blacksmith in 41 AD answered "Paper and a pencil," then added a
 * detail of his own — not here, the muck gets into everything. Paper is centuries away; a graphite
 * pencil is fifteen hundred years away. By repeating the words back and building on them he made
 * both real, permanently, because the record now holds a Roman who has heard of them.
 *
 * The rule the engine already had runs one way only — nobody NAMES a thing this world lacks. That
 * governs what a character produces. Nothing governed what a character ACCEPTS, which is the
 * direction an anachronism travels when the player is the one out of time.
 */
import { visibleOnPlayer } from "../src/engine/reaction";
import { newSave, registerCharacter } from "../src/engine/state";
import { NARRATOR_SYSTEM, NARRATOR_SYSTEM_LEAN } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const APPEARANCE = "Short dark brown hair, clean-shaven, hazel eyes, light olive skin. He wears a modern t-shirt and jeans, now filthy and torn, and carries an iPhone in an OtterBox case.";

function rome(): SaveState {
  const s = newSave("anach", {
    name: "Rome, 41 AD",
    technology_level: "Iron Age Mediterranean; no electricity, no steam power, no printing press, no glass windows, no stirrups",
  } as any);
  registerCharacter(s, { name: "Marcus Valerius", character_id: "char_player", appearance_facts: APPEARANCE } as any);
  return s;
}

/* ── 1. the guard turns on from the field that is actually populated ─────────── */
{
  const s = rome();
  const cond = s.condition["char_player"];
  check("the save's real shape: nothing in the live fields",
    !cond.wearing.length && !cond.inventory.length && !s.characters["char_player"].appearance_now);

  const v = visibleOnPlayer(s);
  check("the guard fires anyway", v !== "", "still dark");
  check("...on what the card actually says he has", /iPhone/.test(v) && /jeans/.test(v), v.slice(0, 200));
  check("...against what this world can make", /no printing press/.test(v));

  // AND THE TAIL SURVIVES A LONG CARD. The clothing clause is last by construction, so a front
  // slice keeps the eyes and drops the phone. This card is deliberately overlong.
  {
    const long = rome();
    long.characters["char_player"].appearance_facts =
      "Short dark brown hair worn close, clean-shaven most days, hazel eyes that go green in strong light, light olive skin, a square jaw, an athletic build kept up by years of gym and hiking and long weekends walking hills, looks his age or a little under it, a small pale scar through his left eyebrow from a fall off a garden wall when he was seven. " + APPEARANCE.split(". ").pop();
    const vl = visibleOnPlayer(long);
    check("a long card keeps the anachronism instead of the eye colour",
      /iPhone/.test(vl) && /jeans/.test(vl), vl.split("\n")[1]?.slice(0, 200));
  }

  // and the live fields still win when something has filled them
  s.characters["char_player"].appearance_now = "stripped to the waist, mud to the elbow";
  cond.inventory = [{ name: "a bent iron nail" } as any];
  const v2 = visibleOnPlayer(s);
  check("a live look overrides the permanent one", /stripped to the waist/.test(v2) && !/hazel eyes/.test(v2), v2.slice(0, 160));
  check("...and carried things still ride along", /bent iron nail/.test(v2));
}

/* ── 2. the half that was never covered: a word he says is an anachronism too ── */
{
  const v = visibleOnPlayer(rome());
  check("what he SAYS is held against the same two lines", /HOLD THE SAME TWO LINES AGAINST WHAT HE SAYS/.test(v));
  check("the word does not become a thing by being said", /does not become a thing by being said out loud/.test(v));
  check("...and the four things a person does instead are named",
    /hears the nearest thing their own life holds/.test(v) && /asks him what it is/.test(v));
  check("the exact failure is forbidden: repeating it back, pricing it, adding to it",
    /repeat it back as a thing they know/.test(v) && /name a price for it/.test(v) && /add a detail of their own/.test(v));
  check("...and the reason is stated — it is permanent",
    /puts that object into this world permanently/.test(v));
  check("the player is named rather than called the player", /Marcus Valerius talks out of a world/.test(v));
}

/* ── 3. THE RULE WAS IN ONE PROMPT AND NOT THE OTHER ──────────────────────────
 *
 * "THE PLAYER'S ACTS ARE LAW; THE PLAYER'S CLAIMS ARE NOT" existed only in the LEAN prompt. The
 * full one — the quality ceiling, the one a player turns lean_mode off to get — had no rule
 * anywhere saying the world does not rearrange to agree with a player's presumption.
 */
{
  for (const [label, p] of [["full", NARRATOR_SYSTEM], ["lean", NARRATOR_SYSTEM_LEAN]] as const) {
    check(`${label}: the claims rule is present`, /THE PLAYER'S CLAIMS ARE NOT/.test(p));
    check(`${label}: the world does not rearrange to agree`, /does not rearrange to agree/.test(p));
    check(`${label}: a missing WORD is one of the kinds`, /A WORD FOR A THING THIS WORLD DOES NOT CONTAIN|word for a thing this world does not contain/i.test(p));
    check(`${label}: the pencil is the worked example`, /paper and a pencil/i.test(p));
    check(`${label}: agreeing once is named as permanent`, /every later turn inherits it/.test(p));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
