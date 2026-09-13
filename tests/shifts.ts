/* WHAT THE PLAYER IS TOLD BETWEEN TURNS.
 *
 * "this nonsense of 'her wants have been skipped 9 turns' and all these warnings mean nothing to
 * me. You have random toasts about warnings instead of actual stuff and it's pointless. Because
 * they're literally every turn."
 *
 * Counted on that save's stored history: 119 shift lines over 52 turns, 34 distinct. Thirty-eight
 * of the 119 — a third of every notification the player ever got — were one internal counter, and
 * not even a rising one: it resets at MISS_CEILING and climbs again, so "skipped 2 turns running"
 * appears seven separate times.
 *
 * Sifted at a six-turn window, those 119 become 32. The window is not a guess: 3 leaves the
 * repeats in, and past 6 the curve is flat (6 -> 32, 10 -> 29, 20 -> 28). */
import { sift, signature, isDiagnostic, isAlways, REPEAT_WINDOW } from "../src/engine/shifts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

// ── the line that started it, and its whole family ───────────────────────────────────────────
const ENGINE = [
  "Emily Brenner's standing want has now been skipped 9 turns running",
  "Emily Brenner's standing want did not reach the page — the narrator is being told again",
  "[cast] auto-registered unannounced speaker \"the doorman\" — the simulator did not declare them",
  "[cast] blocked held Ada returning from the roof with no release in the prose",
  "[drift] refused memory: Mara doesn't change against her grain",
  "[places] the atrium depopulated at turn 41",
  "[weft] chaptering failed this turn (turn continues):",
  "[templates] gauge failed, turn unaffected: no tagger",
  "[ownership] 2 want(s) name their owner: Ada",
  "bookkeeping correction: Ravi stays — the prose never showed them leave",
  "bookkeeping is recording again.",
  "the ledger held the line: Mara doesn't change against their grain without cause.",
  "Emily Brenner's accumulated history was condensed.",
  "the record disagrees with what the story has been saying — the ledger says otherwise",
];
for (const l of ENGINE) check(`held as engine noise: ${l.slice(0, 52)}`, isDiagnostic(l));

// ── and the lines that are actually news ─────────────────────────────────────────────────────
const NEWS = [
  "Emily Brenner will remember that.",
  "Emily Brenner warmed toward you.",
  "Emily Brenner wants something new: get Max to his knees.",
  "Ada is dead.",
  "Thread resolved: the missing ledger.",
  "A new rumor is spreading — and it isn't true.",
  "Emily Brenner now knows your name.",
  "Emily Brenner is developing a new trait: \"quick to cover trouble with a lie\".",
  "CANON: the terrace is reservation-only now (news will spread over time)",
];
for (const l of NEWS) check(`shown as news: ${l.slice(0, 52)}`, !isDiagnostic(l));

// ── the counter is one message, not nine ─────────────────────────────────────────────────────
check("a counter's every value shares one signature",
  signature("skipped 2 turns running") === signature("skipped 9 turns running"));
check("but two different people are two different pieces of news",
  signature("Mara warmed toward you.") !== signature("Ravi warmed toward you."));

// ── suppression ──────────────────────────────────────────────────────────────────────────────
const recent = ["Emily Brenner will remember that.", "Emily Brenner relaxed a little."];
const now = ["Emily Brenner will remember that.", "Emily Brenner warmed toward you.", "[cast] blocked something"];
const s1 = sift(now, recent);
check("a repeat inside the window is held", !s1.shown.includes("Emily Brenner will remember that."));
check("fresh news still lands", s1.shown.includes("Emily Brenner warmed toward you."));
check("engine noise is held", !s1.shown.some((x) => x.startsWith("[cast]")));
check("nothing is lost — held carries both", s1.held.length === 2, s1.held);
check("shown + held accounts for every line", s1.shown.length + s1.held.length === now.length);

check("one turn cannot say the same thing twice",
  sift(["Ada relaxed a little.", "Ada relaxed a little."]).shown.length === 1);
check("with no history, everything sayable is said", sift(NEWS).shown.length === NEWS.length);
check("blank lines are dropped without counting", sift(["", "   "]).shown.length === 0);

// ── the irreversible always gets through ─────────────────────────────────────────────────────
for (const l of ["Ada is dead.", "Emily Brenner will never forget this.", "Thread resolved: the ledger."]) {
  check(`always said, even as a repeat: ${l.slice(0, 40)}`, isAlways(l) && sift([l], [l]).shown.includes(l));
}
check("an ordinary line is NOT always-said", !isAlways("Emily Brenner relaxed a little."));

check("the window is the measured one", REPEAT_WINDOW === 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
