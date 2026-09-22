/* "THEY SEE ME MAKE GOLD, REFUSE IT. REFUSE CASH. ROLL THEIR EYES AT ME MAKING A CAR."
 *
 * Turn 6 of that save: power_witnessed is stamped `cosmic`. Turn 10: the player puts a plate of
 * 24-carat gold on a table at the Ritz, out of nothing, in front of a maître d', a waiter, and a
 * man reading the Financial Times. What came back:
 *
 *   "May I ask how you'd like it valued?"
 *   "The kitchen doesn't have a till for it. And I can't make change for a sovereign."
 *   "Sir, I can't carry a plate of sovereigns through the dining room."
 *
 * Matter appeared from nowhere and the answer was a BILLING QUESTION.
 *
 * TWO SOURCES DISAGREED AND THE WRONG ONE WON. reactionDirective tells the narrator, correctly, to
 * measure the act against canon. Canon, written at world creation and never revisited, said: "the
 * only anomalies are Rabi's phone and matter creator, which are unknown to anyone but him." So it
 * measured a man conjuring gold against a line saying nobody knows he can, and wrote a room where
 * nobody knows. Meanwhile the tier reached the prompt through one channel only — a standing
 * modifier inside dispositionCue, which adjusts how much deference a character shows. A politeness
 * number, carrying the fact that this man rewrites matter. */
import { witnessedDirective } from "../src/engine/reaction";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
const world = (tier: string | null, canon: string[] = [], turn = 6, now = 33) => ({
  power_witnessed: tier ? { tier, turn } : undefined,
  world: { canon, current_turn: now },
} as unknown as SaveState);

/* ── AN ORDINARY WORLD CARRIES NONE OF THIS ─────────────────────────────────────────────────── */
check("nothing witnessed, nothing said", witnessedDirective(world(null)) === "");
check("mortal is nothing witnessed", witnessedDirective(world("mortal")) === "");

/* ── AND A WORLD THAT HAS SEEN IT SAYS SO, EVERY TURN ───────────────────────────────────────── */
{
  const d = witnessedDirective(world("cosmic"));
  check("cosmic names what they actually watched", /make matter appear and disappear at will/.test(d), d.slice(0, 120));
  check("…says they saw it rather than heard about it", /Not been told about it. Watched it/.test(d));
  check("…and dates it, so it reads as standing rather than new", /turn 6/.test(d) && /27 turns ago/.test(d), d.slice(0, 160));
  check("…names the failure it exists to stop", /NEVER TREAT IT AS A PROCEDURAL PROBLEM/i.test(d));
  check("…and quotes the real one", /the till, making change/.test(d));
  check("…gives the behaviours that replace it", /want something from it|ask him to do it again/.test(d));
  check("…and sends the choice back to the character's own card", /comes off their own card/.test(d));
}
check("mythic is a different fact from cosmic",
  /cannot be explained/.test(witnessedDirective(world("mythic"))) && !/matter appear/.test(witnessedDirective(world("mythic"))));
check("empowered is milder still", /no ordinary person can do/.test(witnessedDirective(world("empowered"))));

/* ── TAKING IT IS THE DEFAULT ────────────────────────────────────────────────────────────────
 * A dresser in 1932 handed five thousand guineas said "I don't want it. I didn't ask for it." That
 * is a stance, and a costly one, and it needs a reason on her card. Refusal as the reflex is the
 * moral-verdict failure this project has been chasing since its first report. */
{
  const d = witnessedDirective(world("cosmic"));
  check("refusing is named as a position rather than the default", /PEOPLE TAKE WHAT HE GIVES BY DEFAULT/.test(d));
  check("…it has to be grounded in their own state", /their own state has to say why/.test(d));
  check("…and it does not get to be the scene's verdict", /is not written as the scene's moral judgment/.test(d));
}

/* ── AND REPETITION DOES NOT MAKE IT ORDINARY ───────────────────────────────────────────────── */
{
  const d = witnessedDirective(world("cosmic"));
  check("the tenth time is accommodation, not a shrug", /never as a shrug or a rolled eye/.test(d), d.slice(-200));
  check("…and the accommodation is behavioural", /what they now ask him for/.test(d));
}

/* ── THE CANON OVERRIDE, WHICH IS THE ACTUAL MECHANISM ───────────────────────────────────────
 * The line is not struck. It was true when written, the story may make it true again, and editing
 * somebody's world bible to record what happened in it is the same lossy move as editing a
 * character card to record an injury. Overridden per turn, from state, reversibly. */
{
  const secret = "There is no magic in this world; the only anomalies are Rabi's phone and matter creator, which are unknown to anyone but him.";
  const d = witnessedDirective(world("cosmic", [secret]));
  check("a canon line claiming secrecy is named and dated", /CANON SAYS OTHERWISE AND CANON IS OUT OF DATE/.test(d), d.slice(-300));
  check("…quoted, so there is no doubt which line", d.includes("unknown to anyone but him"));
  check("…and said to have held until the turn it stopped", /It held until turn 6/.test(d));
  check("…while the rest of canon is left standing", /Everything else in canon still stands/.test(d));
  check("…and nothing is struck from the record", d.length > 0);
}
check("ordinary canon triggers no override",
  !/CANON SAYS OTHERWISE/.test(witnessedDirective(world("cosmic", [
    "Class determines almost everything: how you speak, where you live, who you marry.",
    "The British Empire still stands, but it is under strain.",
  ]))));
check("a secrecy line about something else is left alone",
  !/CANON SAYS OTHERWISE/.test(witnessedDirective(world("cosmic", ["The location of the vault is known only to the family."]))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
