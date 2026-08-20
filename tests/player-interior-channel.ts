/* Smoke test: *AND I HATED HER FOR DOING THAT*
 *
 * A player types a private thought inside an ordinary action:
 *
 *     I hand her the towel *and I hated her for doing that*
 *
 * and the scene answers the hatred — the narrator puts it on the page, the woman in the room reacts
 * to it directly. The player's report: "there's no way for me to internalize thoughts."
 *
 * The rules were never missing. Four separate places say asterisks are private and no character may
 * perceive, react to or act on them: the narrator contract, the point-of-view law, the inline
 * channel note, and the bookkeeper prompt. What was missing was any MECHANISM. MODE_FRAME.do handed
 * the narrator the action verbatim and attached two hundred words explaining that nobody could
 * perceive part of it. This codebase has learned the same lesson three times — the tic guard,
 * maxims.ts, echo.ts — that a rule in the prompt does not hold, and that a phrase attached to a
 * prohibition is still a phrase the model has been handed.
 *
 * So the words are not handed over. What the narrator gets is a BEARING, decided by the player's own
 * grip, which is the rule desire.ts has always run on everybody else: the same feeling expresses
 * cleanly in a settled body and leaks sideways in a clenched one. Same energy, two roads, decided by
 * openness — and no reason the player should have been exempt from it.
 *
 * AND THE OTHER HALF, which is the half the player actually asked for: what they feel now BECOMES
 * something. turn.ts skipped char_player for trait decay and consolidation entirely, so a stated
 * feeling could move relaxation and mood and then evaporate, forever. Sovereignty had been
 * implemented as "the player is not modelled", when what it forbids is the ENGINE deciding who the
 * player is. A trait grown from the player's own repeated report is their account, kept — so it
 * forms, and the narrator never receives it.
 */
import { splitInterior, outwardOnly, bearingDirective, chargeOf, directionOf } from "../src/engine/interior";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const ACTION = `I hand her the towel *and I hated her for doing that*`;

/* ── 1. the split ─────────────────────────────────────────────────────────────── */
{
  const { outward, interior } = splitInterior(ACTION);
  check("the act survives", outward === "I hand her the towel", outward);
  check("the thought is out of the outward half", !/hated/i.test(outward), outward);
  check("...and is held for the bookkeeper", !!interior && /hated her/i.test(interior.content), interior);
  check("it reads as tightening", interior?.direction === -1, interior);

  // parentheses are the same channel
  const paren = splitInterior(`he walked out. (I was pissed, didn't want her to see me)`);
  check("(parentheses) are private too", !/pissed/i.test(paren.outward), paren.outward);
  check("...and the act survives", /walked out/.test(paren.outward), paren.outward);

  // ((double parens)) are a search directive with its own handler — left alone
  const dbl = splitInterior(`I look around ((find the ledger))`);
  check("((search directives)) are not eaten as interior", dbl.interior === null, dbl);

  // speech stays outward: it was said, everyone heard it, and attribution depends on it
  const spoken = splitInterior(`"Thanks love" I take the towel *she has no idea*`);
  check("quoted speech stays in the outward half", /Thanks love/.test(spoken.outward), spoken.outward);
  check("...while the thought beside it does not", !/no idea/.test(spoken.outward), spoken.outward);
}

/* ── 2. nothing the narrator receives contains the words ──────────────────────── */
{
  const { interior } = splitInterior(ACTION);
  for (const [label, relax] of [["settled", 5], ["clenched", -6], ["middling", 0]] as const) {
    const d = bearingDirective(interior, relax);
    check(`${label}: the narrator is told something`, d.length > 0);
    check(`${label}: and it never contains the thought`, !/hated|her for doing/i.test(d), d);
    check(`${label}: nor names the feeling`, !/\bhatred\b|\banger\b/i.test(d), d);
    check(`${label}: and forbids a tell that decodes`, /DOES NOT DECODE|could name it/i.test(d), d);
  }
}

/* ── 3. the two roads: grip decides which ─────────────────────────────────────── */
{
  const { interior } = splitInterior(ACTION);
  const settled = bearingDirective(interior, 5);
  const clenched = bearingDirective(interior, -6);
  check("a settled body puts it into the act", /goes into the ACT|wholly/.test(settled), settled);
  check("...and nothing leaks", /Nothing leaks/.test(settled), settled);
  check("a clenched body leaks it sideways", /LEAKS|crookedness/.test(clenched), clenched);
  check("the two are actually different directives", settled !== clenched);
}

/* ── 4. a passing note is not a beat ──────────────────────────────────────────── */
{
  const faint = splitInterior(`I nod *hm*`);
  check("two characters of interior raise nothing", bearingDirective(faint.interior, -6) === "", faint);
  check("an action with no private channel raises nothing", bearingDirective(splitInterior("I nod").interior, -6) === "");
  check("charge rises with what is actually carried",
    chargeOf("and I hated her for doing that") > chargeOf("hm"));
  check("an unreadable interior has no direction", directionOf("the thing about the door") === 0);
}

/* ── 5. THE HISTORY LEAK, which is the one that would have made all of this pointless ──
 *
 * volatileDigest replays past turns to the narrator as "T14: <player_action> → <summary>". Sealing
 * this turn's thought while last turn's is handed back one turn later seals nothing. */
{
  check("a past turn's action is replayed without its interior",
    outwardOnly(ACTION) === "I hand her the towel", outwardOnly(ACTION));
  check("...and with the act intact", /towel/.test(outwardOnly(ACTION)));
  check("an action that was all interior replays as nothing",
    outwardOnly("*I can't stand this*") === "", JSON.stringify(outwardOnly("*I can't stand this*")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
