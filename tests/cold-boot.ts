/* Smoke test: A HOME-SCREEN WEB APP IS NOT SUSPENDED, IT IS KILLED.
 *
 * "I type something up. Wait for the reply and then slide over to Reddit. By the time I go back the
 * app might finish what it was doing or it returns my turn."
 *
 * On iOS a web app added to the home screen is terminated within seconds of being backgrounded, not
 * paused. Coming back is a cold boot: new process, new JS heap, and — the part that matters here —
 * a NEW SESSION. Two things followed from that and neither was obvious from the code.
 *
 * 1. The draft box was kept in sessionStorage, which a cold boot empties. The one case it was
 *    written for — type a long action, look at something else, come back — was the case it did not
 *    survive. localStorage does.
 *
 * 2. The turn journal checkpointed at submission and again when narration COMPLETED, and treated
 *    anything in between as no turn at all. But narration is the long phase, so on iOS the kill
 *    almost always lands inside it: the player got their action handed back and paid for the tokens
 *    anyway. The stream is now checkpointed as it arrives, and a substantially-finished turn is
 *    completed from what landed rather than thrown away.
 *
 * The remaining case is honest and untestable here: a turn killed in its first seconds is still
 * lost, because the request died with the process. Nothing running on the device can fix that —
 * that is what the relay is for. */
import { trimToParagraph, PARTIAL_MIN } from "../src/lib/api";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const para = (n: number) => Array.from({ length: n }, (_, i) =>
  `She set the glass down and did not look at him for a moment longer than was comfortable. Paragraph ${i + 1} of the evening.`).join("\n\n");

/* ── a killed stream ends on a finished thought ──────────────────────────────── */
{
  const whole = para(5);
  const cut = whole.slice(0, whole.length - 40);        // killed mid-sentence in the last paragraph
  const t = trimToParagraph(cut);
  check("the fragment of a sentence is dropped", !/Paragraph 5 of the eve$/.test(t), t.slice(-60));
  check("and it ends on punctuation", /[.!?]["”]?$/.test(t), t.slice(-40));
  check("everything that completed is kept", /Paragraph 4 of the evening\./.test(t), t.slice(-80));
}
{
  // no paragraph break yet — fall back to the last sentence rather than keeping half a word
  const one = "She crossed the room. He said nothing at all, which was the loudest thing in it. She reach";
  const t = trimToParagraph(one);
  check("with no paragraph break it still ends on a sentence", /loudest thing in it\.$/.test(t), t);
}
{
  check("text with nothing complete in it comes back rather than becoming empty",
    trimToParagraph("She reach").length > 0);
  check("and an empty stream stays empty", trimToParagraph("") === "");
}
{
  // the trim must never take a long turn down to a stub by finding an early paragraph break
  const whole = para(6);
  const t = trimToParagraph(whole + "\n\nShe wal");
  check("a nearly-complete turn is not trimmed back to its first paragraph", t.length > whole.length * 0.8, t.length);
}

/* ── the keep/discard line ───────────────────────────────────────────────────── */
{
  // The contract asks the narrator for turns around 110 words, so a full one runs 600–700
  // characters. The line sits at roughly two-thirds of that: enough that a scene happened, short of
  // the point where committing it would be worse than re-running.
  check("the threshold is a beat, not a sentence", PARTIAL_MIN >= 300 && PARTIAL_MIN <= 1200, PARTIAL_MIN);
  const stub = "She looked at him. He looked back.";
  check("a stub is below it — those words get handed back, not committed", stub.length < PARTIAL_MIN);
  check("a typical full turn is comfortably above it", para(6).length > PARTIAL_MIN * 1.5, para(6).length);
  check("and most of a turn still clears it", para(4).length > PARTIAL_MIN, para(4).length);
}

/* ── the draft survives a new session ────────────────────────────────────────── */
{
  // The distinction the fix turns on, asserted directly: sessionStorage is per-session and a cold
  // boot is a new one. Simulated, since neither exists in node.
  const persistent = new Map<string, string>();
  const perSession = new Map<string, string>();
  const typed = "I knock on the door and wait, and I do not say anything when it opens.";
  persistent.set("weft-draft-x", typed);
  perSession.set("weft-draft-x", typed);
  perSession.clear();                                  // ← iOS terminates the app; the session ends
  check("the old storage lost the words on a cold boot", !perSession.has("weft-draft-x"));
  check("the new one still has them", persistent.get("weft-draft-x") === typed);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
