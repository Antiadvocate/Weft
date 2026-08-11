/* Smoke test: "HOW IS SHE NOT DRAWN TO ME? I SPENT HALF THE GAME WITH HER."
 *
 * From a save at turn 31. Marcella's edge toward the player:
 *
 *   warmth 86.5   trust 48.5   attraction 0   roles ["dependent", "possessive"]
 *
 * Two people who had barely met him sat at 58 and 62. Hers was not low, it was exactly zero, and it
 * had been exactly zero since the turn they met, because her card read:
 *
 *   attracted_to: "no one — currently too raw and survival-focused"
 *
 * `attracted_to` means who a person CAN desire at all, and orientationCap returns a hard 0 for "no
 * one": the seed is zero, every later reading is zero, and no amount of story moves it. The forge is
 * asked for one of four values — women / men / anyone / no one — and answered with a state and a
 * justification. Nothing validated it, and nothing could ever revise it, so she was structurally
 * incapable of being drawn to anybody for the whole game.
 *
 * The qualifier is the tell. Someone who does not experience attraction says so without a clock on
 * it. "Currently", "for now", "still", "after what happened", "too raw" all describe a person who is
 * not available YET — which is what warmth, trust and openness are for.
 */
import { orientationCap, seedAttraction } from "../src/engine/desire";
import { orientationIsMood } from "../src/engine/coerce";
import { newSave, registerCharacter, sanitize } from "../src/engine/state";
import { getEdge } from "../src/engine/social";
import type { Identity, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const him = { pronouns: "he/him" } as Identity;
const cap = (o: string) => orientationCap({ attracted_to: o } as Identity, him);

/* ── 1. the card from the save ────────────────────────────────────────────────── */
{
  const MARCELLA = "no one — currently too raw and survival-focused";
  check("it is recognised as a mood, not an orientation", orientationIsMood(MARCELLA));
  check("and it no longer pins her at zero", cap(MARCELLA) === null, cap(MARCELLA));
}

/* ── 2. a real orientation is still a real orientation ────────────────────────── */
{
  check("plain 'no one' still caps at zero", cap("no one") === 0);
  check("and so does one stated as lasting", cap("no one, and never has been") === 0);
  check("'nobody' too", cap("nobody") === 0);
  check("'anyone' is uncapped", cap("anyone") === null);
  check("a matching orientation is uncapped", cap("men") === null);
  check("a non-matching one is soft-capped, not zeroed", cap("women") === 5);
  check("an empty field does not gate", cap("") === null);
}

/* ── 3. the other dated phrasings a forge reaches for ─────────────────────────── */
{
  for (const o of [
    "no one right now",
    "no one for now",
    "no one at the moment",
    "no one — still grieving her husband",
    "no one, not yet",
    "no one after what happened to her",
    "no one — too hurt to want anybody",
  ]) check(`"${o.slice(0, 42)}" reads as a state`, cap(o) === null, cap(o));
}

/* ── 4. it does not fire on an ordinary orientation ───────────────────────────── */
{
  check("a woman who likes men, currently and always, is not misread", !orientationIsMood("men"));
  check("nor is anyone", !orientationIsMood("anyone"));
  check("nor is a blank field", !orientationIsMood(""));
  check("nor is undefined", !orientationIsMood(undefined));
}

/* ── 5. a fresh character can now be drawn to somebody ────────────────────────── */
{
  const s: SaveState = newSave("orient", { name: "Rome" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him", beauty: 78, age: 34 } as any);
  const her = registerCharacter(s, {
    name: "Marcella", pronouns: "she/her", age: 18, beauty: 55,
    attracted_to: "no one — currently too raw and survival-focused",
    taste: "evenness, a hand that does not lash out, a voice that does not rise",
  } as any)!;
  seedAttraction(s, her, "char_player");
  const a = getEdge(s.world.edges, her, "char_player").attraction ?? 0;
  check("she is no longer seeded at a structural zero", a > 0, a);
}

/* ── 6. ...and a genuine 'no one' still is ────────────────────────────────────── */
{
  const s: SaveState = newSave("orient", { name: "Rome" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him", beauty: 90 } as any);
  const her = registerCharacter(s, { name: "Vesta", pronouns: "she/her", attracted_to: "no one", beauty: 55 } as any)!;
  seedAttraction(s, her, "char_player");
  check("an asexual character is still seeded at zero", (getEdge(s.world.edges, her, "char_player").attraction ?? -1) === 0);
}

/* ── 7. and the save already frozen at zero is repaired on load ───────────────── */
{
  const s: SaveState = newSave("orient", { name: "Rome" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him", beauty: 78 } as any);
  const her = registerCharacter(s, {
    name: "Marcella", pronouns: "she/her", age: 18,
    attracted_to: "no one — currently too raw and survival-focused",
  } as any)!;
  const held = registerCharacter(s, { name: "Vesta", pronouns: "she/her", attracted_to: "no one" } as any)!;
  // the state the save was in: seeded to zero by the old hard cap
  s.world.edges.push({ from: her, to: "char_player", warmth: 86, trust: 48, power: 0, attraction: 0, roles: ["dependent"] } as any);
  s.world.edges.push({ from: held, to: "char_player", warmth: 10, trust: 5, power: 0, attraction: 0 } as any);

  sanitize(s);
  const hers = s.world.edges.find((e) => e.from === her)!;
  const theirs = s.world.edges.find((e) => e.from === held)!;
  check("the frozen zero is cleared so it can seed again", hers.attraction === undefined, hers.attraction);
  check("her warmth and trust are untouched", hers.warmth === 86 && hers.trust === 48, hers);
  check("and a genuine 'no one' keeps its zero", theirs.attraction === 0, theirs.attraction);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
