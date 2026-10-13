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
import { EMPTY_READ, type ActionRead } from "../src/engine/actionread";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const ACTION = `I hand her the towel *and I hated her for doing that*`;
/** How much the feeling carries, and which way, comes from the turn's read (engine/actionread.ts).
 *  What a careful reader gives the towel: a good deal of it, and it tightens him. */
const HATED: ActionRead = { ...EMPTY_READ, thought: "and I hated her for doing that", inner: { charge: 0.7, direction: -1 } };
/** ...and a passing "hm": next to nothing, no way about it. */
const HM: ActionRead = { ...EMPTY_READ, thought: "hm", inner: { charge: 0.05, direction: 0 } };

/* ── 1. the split ─────────────────────────────────────────────────────────────── */
{
  const { outward, interior } = splitInterior(ACTION, HATED);
  check("the act survives", outward === "I hand her the towel", outward);
  check("the thought is out of the outward half", !/hated/i.test(outward), outward);
  check("...and is held for the bookkeeper", !!interior && /hated her/i.test(interior.content), interior);
  check("it reads as tightening", interior?.direction === -1, interior);
  check("without a read it carries nothing the narrator is told about", splitInterior(ACTION).interior?.charge === 0 && bearingDirective(splitInterior(ACTION).interior, -6) === "");

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

/* ── 1b. a feeling typed without marks ─────────────────────────────────────────── */
{
  // "Ah ha, the curse": the room answered a feeling the player never said aloud
  const CURSE = `I look at her feet and something in me changes, i feel the curse "Um... Sure"`;
  const read: ActionRead = { ...EMPTY_READ, said: ["Um... Sure"], did: "I look at her feet", thought: "something in me changes, I feel the curse", inner: { charge: 0.6, direction: -1 } };
  const { outward, interior } = splitInterior(CURSE, read);
  check("unmarked: the curse is out of the outward half", !/curse|changes/i.test(outward), outward);
  check("unmarked: the look survives", /look at her feet/.test(outward), outward);
  check("unmarked: the line survives", /"Um\.\.\. Sure"/.test(outward), outward);
  check("unmarked: the feeling is held for the bookkeeper", /curse/.test(interior?.content ?? ""), interior);
  check("unmarked: and replayed turns drop it too", !/curse/.test(outwardOnly(CURSE, read)), outwardOnly(CURSE, read));
  check("no thought in the read: the action passes untouched", splitInterior(`I open the door`, { ...EMPTY_READ, did: "opens the door" }).outward === "I open the door");
}

/* ── 2. nothing the narrator receives contains the words ──────────────────────── */
{
  const { interior } = splitInterior(ACTION, HATED);
  for (const [label, relax] of [["settled", 5], ["clenched", -6], ["middling", 0]] as const) {
    const d = bearingDirective(interior, relax);
    check(`${label}: the narrator is told something`, d.length > 0);
    check(`${label}: and it never contains the thought`, !/hated|her for doing/i.test(d), d);
    check(`${label}: nor names the feeling`, !/\bhatred\b|\banger\b/i.test(d), d);
    check(`${label}: and forbids a tell that decodes`, /DOESN'T GIVE IT AWAY|put a name to it/i.test(d), d);
  }
}

/* ── 3. the two roads: grip decides which ─────────────────────────────────────── */
{
  const { interior } = splitInterior(ACTION, HATED);
  const settled = bearingDirective(interior, 5);
  const clenched = bearingDirective(interior, -6);
  check("a settled body puts it into the act", /goes into what they do|completely/.test(settled), settled);
  check("...and nothing leaks", /Nothing leaks/.test(settled), settled);
  check("a clenched body leaks it sideways", /leaks out/.test(clenched), clenched);
  check("the two are actually different directives", settled !== clenched);
}

/* ── 4. a passing note is not a beat ──────────────────────────────────────────── */
{
  const faint = splitInterior(`I nod *hm*`, HM);
  check("two characters of interior raise nothing", bearingDirective(faint.interior, -6) === "", faint);
  check("an action with no private channel raises nothing", bearingDirective(splitInterior("I nod", HATED).interior, -6) === "");
  check("charge rises with what is actually carried", chargeOf(HATED) > chargeOf(HM));
  // "the thing about the door": mixed or unclear, so the reader gives it no direction
  check("an unreadable interior has no direction", directionOf({ ...EMPTY_READ, inner: { charge: 0.3, direction: 0 } }) === 0);
  check("an empty read carries nothing", chargeOf(EMPTY_READ) === 0 && directionOf(EMPTY_READ) === 0);
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
