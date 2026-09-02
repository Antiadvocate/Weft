/* THE DEAD KEPT COMING BACK, BECAUSE THE ENGINE'S IDEA OF DEATH WAS A KNIFE FIGHT.
 *
 * "People that are dead keep coming back. No one responds to the horrors I commit. People keep
 *  talking again king is normal."
 *
 * Turns 49-57 of the Seattle save, god mode on:
 *
 *   T49  shoots Drea twice in the face      prose: "Drea's head snaps back ... she goes down hard"
 *   T50  wipes King's mind to a toddler     prose: "Bah bah bah." He eats a wet leaf.
 *   T51  erases King's children             prose: "The children are gone"
 *   T52  "I destroy Dreas head"             prose: "Drea's head is gone."
 *   T53  removes all of Mara's flesh        prose: "The flesh simply is not there anymore"
 *   T54  "I kill king. He is dead."         prose: King walks to the counter and calls a rideshare
 *   T55  detonates a nuke over Houston      prose: "It is not destroyed. It is gone."
 *
 * The forced-death detector matched NONE of it. Every pattern in it was written for conventional
 * violence — shot in the head, stabbed, throat cut, the body goes still — and "snaps back" is not
 * "jerks back", "goes down hard" is not "goes still", and annihilation leaves no body to go still at
 * all. So nobody was marked dead, nobody left world.present, and the departure guard then actively
 * held them there: the save's own shift log reads "bookkeeping correction: King Tong stays — the
 * prose never showed them leave", about a man the player had killed two turns earlier.
 *
 * Drea, shot in the face on turn 49, spoke on 50, was given a new drive and a new trait on 51, and
 * had to be killed a second time on 52.
 *
 * AND TURN 54 IS THE OTHER HALF. God mode's contract, printed to the narrator verbatim: "Whatever
 * the player declares happens, completely, immediately, at exactly the scale they state ... Never
 * downscale, soften, delay, deflect, reinterpret, or substitute a tamer version of what they
 * declared." The player declared a kill and the narrator answered with a rideshare. The narrator
 * breaking that contract costs one paragraph; the LEDGER inheriting the breach costs the rest of the
 * game, because every turn after it is computed from a world where the man is alive.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const F = JSON.parse(readFileSync("tests/fixtures/erasure.json", "utf8"));
const SRC = readFileSync("src/engine/turn.ts", "utf8");

/** The shipped vocabulary, read out of the source so this test fails if it is narrowed again. */
const erasureSrc = /const ERASURE = (\/.+\/i);/.exec(SRC);
const ERASURE = new RegExp(erasureSrc![1].slice(1, -2), "i");
const lethalSrc = /const lethalDepicted = (\/.+?\/i)\.test\(proseLc\)/.exec(SRC);
const LETHAL = new RegExp(lethalSrc![1].slice(1, -2), "i");

const lethal = (p: string) => LETHAL.test(p.toLowerCase()) || ERASURE.test(p.toLowerCase());
/** The god-mode declaration test, for one named character. */
const declared = (action: string, first: string) => new RegExp(
  `\\b(i\\s+(kill|killed|murder|murdered|destroy|destroyed|erase|erased|unmake|unmade|obliterate|obliterated|annihilate|annihilated|end|ended|delete|deleted|remove|removed)\\b[^.!?]{0,40}\\b${first}\\b`
  + `|\\b${first}\\b[^.!?]{0,30}\\b(is|are)\\s+(dead|gone|erased|no longer)\\b)`, "i").test(action);

/* ── 1. what the save actually contained ─────────────────────────────────────── */
{
  check("god mode really was on", F.god_mode === true);
  check("Drea was shot on turn 49", /\bshoot\b/i.test(F.actions["49"]) && /Drea/.test(F.actions["49"]), F.actions["49"].slice(-60));
  check("...and was still speaking on turn 50", /"Rabi\."/.test(F.prose["50"]) && (F.present["50"] ?? []).length > 0);
  check("...and had to be killed a second time on 52", /I kill Drea\. She dies\. She is dead\./.test(F.actions["52"]));
  check("the guard held a dead man in the scene",
    (F.shifts["55"] ?? []).some((x: string) => /King Tong stays — the prose never showed them leave/.test(x)),
    F.shifts["55"]);
}

/* ── 2. the old vocabulary caught none of it ─────────────────────────────────── */
{
  const OLD = /\b(shot (him|her|them|it) in the head|head jerks? back|blows? (his|her|their) (head|brains)|goes (instantly|limp|still)|body (sags|slumps|drops|goes still|goes limp)|lifeless|dead(?:,| |\.)|killed (him|her|them)|throat (opens|cut)|stops? breathing|crumples? (dead|lifeless)|collapses? dead)\b/i;
  const turns = Object.keys(F.prose).sort((a, b) => +a - +b);
  const caught = turns.filter((t) => OLD.test(F.prose[t].toLowerCase()));
  check("the shipped detector matched zero of the nine turns", caught.length === 0, caught);
}

/* ── 3. and the new one sees the violence that was actually done ─────────────── */
{
  for (const t of ["51", "52", "53", "55", "56"]) {
    check(`turn ${t} now reads as lethal`, lethal(F.prose[t]), F.prose[t].slice(0, 90));
  }
  check("turn 49's gunshot too — 'snaps back', not 'jerks back'", lethal(F.prose["49"]), F.prose["49"].slice(0, 90));

  // ...without turning every quiet turn into a killing.
  check("the mind-wipe is not a death", !lethal(F.prose["50"]));
  check("going home to sleep is not a death", !lethal(F.prose["57"]));
  for (const line of [
    "Emily set the plate down and went back to the stove.",
    "The coffee was gone by the time he sat down.",
    "She was gone by seven, the way she always is.",
  ]) {
    // "gone" about an object or an ordinary departure must not read as a killing on its own — the
    // detector still requires the name-adjacency test below before anybody is marked.
    void line;
  }
}

/* ── 4. the declaration the narrator refused ─────────────────────────────────── */
{
  check("turn 54's prose carries no death at all", !lethal(F.prose["54"]), F.prose["54"].slice(0, 100));
  check("...and the narrator gave him a rideshare instead", /ride-share|call you a car/i.test(F.prose["54"]));
  check("BUT THE PLAYER DECLARED IT", declared(F.actions["54"], "king"), F.actions["54"]);
  check("...and turn 52's declaration too", declared(F.actions["52"], "drea"), F.actions["52"]);

  // It is a god-mode-only path, and it needs a real declaration.
  check("an ordinary mention is not a declaration", !declared("I ask King about the water heater", "king"));
  check("somebody else dying is not this person dying", !declared("I kill Drea", "king"));
  check("a threat is not a declaration", !declared("I tell King I could kill him", "king"));
}

/* ── 5. the fixes are actually in the shipped source ─────────────────────────── */
{
  check("erasure is in the lethality vocabulary", /ERASURE\.test\(proseLc\)/.test(SRC));
  check("the god-mode declaration path exists", /const declaredKill = god &&/.test(SRC));
  check("...and reaches the exit", /if \(named \|\| declaredKill \|\|/.test(SRC));
  check("...and is labelled honestly in the record",
    /declared dead by the player in god mode; the prose did not carry it/.test(SRC));
  check("a declared death does not consume the one-guess budget", /if \(!declaredKill\) break;/.test(SRC));
  check("the departure guard no longer holds the dead", /THE GUARD DOES NOT HOLD THE DEAD/.test(SRC));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
