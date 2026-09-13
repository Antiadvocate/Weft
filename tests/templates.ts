/* THE GAUGE THAT REPLACES A TRIPWIRE THAT HAD STOPPED FIRING.
 *
 * Measured on the 74-turn save this was built from, with a 12-turn window:
 *
 *   turn      T48  T52  T56  T60  T64  T68  T72
 *   findMaxims  9    9    3    0    0    0    0      ← reads as a story going fine
 *   concentration 10.9 11.9 10.2 8.6 8.5 12.0 14.2%  ← reads as a register closing in
 *
 * The register had moved to shapes the hand-written detector did not cover, and a detector that
 * has stopped firing is indistinguishable from clean prose. A number is not.
 *
 * These tests run against the real tagger, because a stub tagger would only prove the arithmetic. */
import {
  loadTagger, profileOf, compare, ngramsOf, tagsOf, concentrationOf,
  cosine, convergenceOf, measure, readingNote, NGRAM_MIN, NGRAM_MAX, TOP_N,
} from "../src/engine/templates";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

async function main() {
  const tagger = await loadTagger();
  if (!tagger) { console.log("FAIL tagger did not load"); process.exit(1); }

  // ── the point of the whole file: different words, one shape ────────────────────────────────
  const a = tagsOf(tagger, "That's the whole thing, right there.").slice(0, 5).join(" ");
  const b = tagsOf(tagger, "That's the whole prayer.").slice(0, 5).join(" ");
  const c = tagsOf(tagger, "That's the whole religion.").slice(0, 5).join(" ");
  check("three sentences no regex shares collapse to one template", a === b && b === c, { a, b, c });
  check("and that template is the deictic verdict", a === "PRON AUX DET ADJ NOUN", a);

  // ── mechanics ──────────────────────────────────────────────────────────────────────────────
  check("punctuation is dropped before n-gramming", !tagsOf(tagger, "Stay there, Max.").includes("PUNCT"));
  const g = ngramsOf(["A", "B", "C", "D", "E"]);
  check("n-grams span the paper's 4..8 range", g.includes("A B C D") && g.includes("A B C D E") && !g.includes("A B C"), g);
  check("nothing longer than the corpus", ngramsOf(["A", "B"]).length === 0);
  check("range constants are the paper's", NGRAM_MIN === 4 && NGRAM_MAX === 8);

  // ── concentration: the headline ────────────────────────────────────────────────────────────
  const flat = Array.from({ length: 12 }, (_, i) => `That's the whole ${["thing", "prayer", "religion", "point", "deal", "story"][i % 6]}.`);
  const varied = [
    "Eight dollars for oat milk.", "Did you move my laundry?", "I'll take the six-thirty instead.",
    "There's rice in the fridge if you want it.", "My shift got moved to Thursday.",
    "Who left the window open all night?", "It cost more than the whole cabinet did.",
    "Tell Rosa the hem came out crooked.", "I'm not paying that twice.",
    "The bus was forty minutes late again.", "She wants the deposit back by Friday.", "Put it on the top shelf.",
  ];
  const cFlat = concentrationOf(profileOf(tagger, flat));
  const cVaried = concentrationOf(profileOf(tagger, varied));
  check("a cast reaching for one shape scores far above a cast that isn't", cFlat > cVaried * 2, { cFlat, cVaried });
  check("concentration stays a share", cFlat <= 1 && cVaried >= 0);
  check("top-N is the documented ten", TOP_N === 10);
  check("no lines is zero, not NaN", concentrationOf(profileOf(tagger, [])) === 0);

  // ── rising templates ───────────────────────────────────────────────────────────────────────
  const r = compare(profileOf(tagger, flat), profileOf(tagger, varied));
  check("the shape that took over is reported", r.hot.length > 0, r.hot.map((h) => h.pattern));
  check("it is the deictic verdict", r.hot.some((h) => h.pattern.startsWith("PRON AUX DET ADJ NOUN")), r.hot[0]?.pattern);
  check("with a real sentence attached, so the number can be read", !!r.hot[0]?.examples[0]);
  check("and the rise is against the baseline", r.hot[0].before < r.hot[0].now);
  check("no substring of a reported template is also reported",
    r.hot.every((h, i) => r.hot.every((k, j) => i === j || !k.pattern.includes(h.pattern))), r.hot.map((h) => h.pattern));
  // the reverse direction must be quiet: varied dialogue after flat dialogue is not a failure
  check("dialogue opening OUT reports nothing", compare(profileOf(tagger, varied), profileOf(tagger, flat)).hot.length === 0);

  // ── convergence ────────────────────────────────────────────────────────────────────────────
  const v1 = new Map([["A B C D", 0.5], ["E F G H", 0.5]]);
  check("cosine of a vector with itself is 1", Math.abs(cosine(v1, v1) - 1) < 1e-9);
  check("cosine of disjoint vectors is 0", cosine(v1, new Map([["X Y Z W", 1]])) === 0);
  check("two speakers on the same shapes score high",
    (convergenceOf(tagger, { emily: flat, max: [...flat] }) ?? 0) > 0.9);
  check("two speakers on different shapes score lower",
    (convergenceOf(tagger, { emily: flat, max: varied }) ?? 1) < (convergenceOf(tagger, { emily: flat, max: [...flat] }) ?? 0));
  check("one speaker is null, never a flattering zero", convergenceOf(tagger, { emily: flat }) === null);
  check("a speaker under the floor does not count", convergenceOf(tagger, { emily: flat, max: ["Yeah.", "Okay."] }) === null);

  // ── absent is not clean ────────────────────────────────────────────────────────────────────
  check("too little dialogue returns null rather than a zero reading",
    (await measure(["He crossed the room.", "The kettle clicked off."])) === null);
  check("null produces no toast", readingNote(null) === "");
  const rn = readingNote(r);
  check("a reading produces one descriptive line", rn.includes("%"), rn);
  check("and it does not tell anybody to stop",
    !/\b(never|do not|don't|avoid|must|stop|wrong|instead)\b/i.test(rn), rn);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
