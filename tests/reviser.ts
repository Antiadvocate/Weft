/* Smoke test: THE REPAIR PASS.
 *
 * The engine has caught the interiority tic for a long time and only ever did one thing with the
 * catch — keep the sentence out of the model's own replayed context, so it wouldn't imitate itself.
 * The player read it anyway. reviseProse is the other consumer of the same detector: the flagged
 * sentence goes to a small model with the offending phrase quoted, and comes back repaired.
 *
 * Everything here is offline. The model call is stubbed, because none of the interesting failures
 * are in the model — they are in what the module is willing to ACCEPT back from it. A reviser that
 * can drop a name, mangle a spoken line, or swap one tic for another is worse than the tic it was
 * built to remove, so the accept/reject rules are the thing under test.
 */
import { flagTics, reviseProse, displayProse, acceptable, scrubForReplay } from "../src/engine/reviser";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the detector splits narration from dialogue ─────────────────────────────────────────── */
{
  const prose = `Ettel set the cup down and did not pick it up again. She was looking at him the way she'd looked at him when they were younger.

"You knew what she wanted," Marcus said, and turned the stylus over. He knew exactly what she meant by it.`;

  const flagged = flagTics(prose);
  const texts = flagged.map((f) => f.text);

  check("narration tic is flagged", texts.some((t) => t.includes("the way she'd looked")), texts);
  check("second narration tic is flagged", texts.some((t) => t.startsWith("He knew exactly")), texts);
  check("the spoken line is NOT flagged", !texts.some((t) => t.includes("You knew what she wanted")), texts);
  check("clean sentence is untouched", !texts.some((t) => t.includes("set the cup down")), texts);
  check("every flag carries the matched phrase", flagged.every((f) => f.phrase.length > 0), flagged);
  check("a clean turn flags nothing", flagTics("She set the cup down. Rain came in under the door.").length === 0);
}

/* ── 2. a clean turn never opens a socket ───────────────────────────────────────────────────── */
/* The detector runs first and locally, so prose with nothing flagged returns before any provider is
 * touched. This is the whole cost story: the pass is free on the turns it has nothing to do on, and
 * it points at a model id that does not exist to prove it. */
{
  const clean = "She set the cup down. Rain came in under the door.";
  const res = await reviseProse(clean, { model: "test/does-not-exist", fallback: "test/does-not-exist" });
  check("clean prose returns unchanged", res.prose === clean, res.prose);
  check("clean prose reports nothing flagged", res.flagged === 0 && res.revised === 0, res);
}

/* ── 3. the accept/reject rules ─────────────────────────────────────────────────────────────── */
/* These run against the real `acceptable`, not a restatement of it — the whole value of this module
 * is what it REFUSES, and a test that re-implements the refusals tests nothing. Every replacement
 * below is one a model actually tends to hand back. */
{
  const original = "Ettel watched the door, and she knew the answer already.";
  const flagged = flagTics(original);
  check("the test sentence is flagged", flagged.length === 1, flagged);
  const phrase = flagged[0]?.phrase ?? "";

  const rules: [string, string, boolean][] = [
    ["keeps the name and drops the claim", "Ettel watched the door.", true],
    ["a deliberate drop is allowed", "", true],
    ["loses a name that opened the sentence", "She watched the door.", false],
    ["turns narration into speech", '"Ettel watched the door."', false],
    ["keeps the flagged phrase", original, false],
    ["trades one tic for another the detector sees", "Ettel watched the door and felt a sudden pang.", false],
    ["trades one tic for a participle the detector does not", "Ettel watched the door, feeling a sudden sharp ache in her chest.", false],
    ["rewrites rather than repairs", "Ettel stood at the threshold for a long moment, her hand resting on the frame, watching the door as though it might open of its own accord at any second.", false],
    ["summarizes the sentence away", "She looked.", false],
  ];
  for (const [name, replacement, want] of rules) {
    check(`${want ? "accepted" : "rejected"}: ${name}`, acceptable(original, phrase, replacement) === want, replacement);
  }

  // A sentence that ALREADY talks about a feeling may keep the word — the rule is that the repair
  // must not IMPORT interiority, not that the word is banned outright.
  const felt = "Marcus rubbed at the ache in his shoulder, and he knew it would not pass.";
  const fp = flagTics(felt)[0]?.phrase ?? "";
  check("interior word already present is not held against the repair",
    acceptable(felt, fp, "Marcus rubbed at the ache in his shoulder."), fp);
}

/* ── 4. displayProse falls back for every save written before the reviser ───────────────────── */
{
  check("no repaired copy → the narrator's words",
    displayProse({ narrator_prose: "original" }) === "original");
  check("repaired copy wins when present",
    displayProse({ narrator_prose: "original", narrator_prose_read: "repaired" }) === "repaired");
  check("an empty repaired copy is not trusted",
    displayProse({ narrator_prose: "original", narrator_prose_read: "" }) === "original");
}

/* ── 5. the replay scrub still behaves exactly as it did ────────────────────────────────────── */
{
  const leak = "She was looking at him the way she'd looked at him when they were younger.";
  check("scrubForReplay still deletes a leak", scrubForReplay(leak).trim() === "");
  const clean = "She set the cup down. Rain came in under the door.";
  check("scrubForReplay still keeps clean prose", scrubForReplay(clean).trim() === clean.trim());
  const literal = "He counted four bushels against the tally stick and came up short.";
  check("a real tally survives the scrub", scrubForReplay(literal).includes("tally stick"), scrubForReplay(literal));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
