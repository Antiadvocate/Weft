/* VERBALIZED SAMPLING — the parse, the threshold, and the promise that nothing here scolds.
 *
 * The pass itself is one network call and is not tested here. What is tested is everything around
 * it, because every one of these is a way the pass could quietly become useless without failing:
 * a parse that accepts the mode, a threshold that lets the peak through, or a directive that turns
 * back into the thing verbalized.ts exists to replace. */
import { parseCandidates, tail, candidateNote, TAU } from "../src/engine/verbalized";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

const RAW = `
<response><who>Emily</who><text>The rice is still out, by the way.</text><probability>0.04</probability></response>
<response><who>Emily</who><text>"Did you move my laundry."</text><probability>0.02</probability></response>
<response><who>Emily</who><text>That's the whole thing, right there.</text><probability>0.41</probability></response>
<response><who>Emily</who><text>Eight dollars for oat milk. Eight.</text><probability>0.06</probability></response>
<response><who>Max</who><text>I'll take the six-thirty instead.</text><probability>0.03</probability></response>
<response><who>Max</who><text>It's not nothing.</text><probability>0.55</probability></response>
<response><who>Max</who><text></text><probability>0.01</probability></response>
<response><who>Max</who><text>fine</text><probability>notanumber</probability></response>
`;

const cands = parseCandidates(RAW);
check("parses the well-formed responses", cands.length === 6, cands.length);
check("drops an empty <text>", !cands.some((c) => !c.text));
check("drops a non-numeric probability", !cands.some((c) => !Number.isFinite(c.p)));
check("strips quotation marks off a line",
  cands.some((c) => c.text === "Did you move my laundry."),
  cands.map((c) => c.text));

const picked = tail(cands);
check("keeps only what the model rated below the threshold", picked.every((c) => c.p < TAU), picked);
check("drops the two lines the model rated near the mode",
  !picked.some((c) => /whole thing|not nothing/i.test(c.text)), picked.map((c) => c.text));
check("covers both speakers", new Set(picked.map((c) => c.who)).size === 2);
check("caps how many are shown per speaker", picked.filter((c) => c.who === "Emily").length <= 3);
check("shows the least likely first",
  picked.filter((c) => c.who === "Emily")[0]?.p === 0.02, picked);

const note = candidateNote(picked);
check("the note carries the lines", note.includes("Eight dollars for oat milk"));
check("and names each speaker once", (note.match(/Emily:/g) ?? []).length === 1);
check("an empty tail produces no directive at all", candidateNote([]) === "");

/* THE ONE THAT MATTERS MOST. verbalized.ts is a reply to the finding that quoting a fault back and
 * elaborating on it primes the fault (arXiv 2511.12381) — so the moment this note starts telling
 * the narrator what to avoid, it has become the thing it replaced, and it will do it silently. */
const SCOLD = /\b(never|do not|don't|avoid|instead of|must not|no longer|stop|wrong|fail|aphorism|maxim|cliché|cliche|slogan|proverb|banned|forbidden)\b/i;
check("the note forbids nothing", !SCOLD.test(note), note.match(SCOLD)?.[0]);
check("the note quotes no bad example back", !/whole thing|not nothing/i.test(note));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
