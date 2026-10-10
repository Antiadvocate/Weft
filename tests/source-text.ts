/* Smoke test: A BOOK IS SAMPLED, NOT TRUNCATED.
 *
 * Forty thousand words pasted into the seed box either failed on the provider's limit or built a
 * world out of chapter one, because a model that is handed too much reads the beginning. Evenly
 * spaced excerpts mean the cast meets the people who only turn up at the end. */
import { sampleSource, chunkText, evenlySpaced, headAndTail, cleanSourceText, SOURCE_BUDGET } from "../src/engine/source";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* a long "novel": 120 chapters, each naming the one character it introduces */
const chapter = (n: number) => `Chapter ${n}.\n\n${`The rain kept on over the weir and nobody in the village said what they meant. `.repeat(18)}Here, for the first time, we meet Person${n} of the lower town.`;
const novel = Array.from({ length: 120 }, (_, i) => chapter(i + 1)).join("\n\n");

check("a short text goes through whole", (() => {
  const s = sampleSource("Mara keeps the mill. Ossian wants it.");
  return !s.sampled && s.text === "Mara keeps the mill. Ossian wants it.";
})());

const s = sampleSource(novel);
check("a long text is cut down to the budget", s.sampled && s.text.length <= SOURCE_BUDGET, s.text.length);
check("the opening is in it", /— part 1 of \d+ —\nChapter 1\./.test(s.text));
check("the end is in it", /Person120 of the lower town/.test(s.text));
check("and the middle", /Person(5\d|6\d)\b/.test(s.text), s.text.match(/Person\d+/g)?.slice(0, 40));
check("it says how it was cut", /cut into \d+ parts/.test(s.text) && s.parts > s.used);
check("the parts are labelled in order", (() => {
  const nums = [...s.text.matchAll(/— part (\d+) of/g)].map((m) => +m[1]);
  return nums.length === s.used && nums.every((n, i) => i === 0 || n > nums[i - 1]);
})());
check("the same text samples the same way twice", sampleSource(novel).text === s.text);

check("evenly spaced keeps both ends", (() => { const p = evenlySpaced(100, 5); return p[0] === 0 && p[p.length - 1] === 99 && p.length === 5; })());
check("fewer parts than slots keeps them all", evenlySpaced(3, 10).join() === "0,1,2");
check("a passage too long keeps its opening and its close", (() => {
  const h = headAndTail("BEGIN " + "x".repeat(5000) + " END", 400);
  return h.length <= 400 && h.startsWith("BEGIN") && h.endsWith("END") && h.includes("[…]");
})());
check("chunks break at paragraphs where they can", chunkText(novel).slice(0, -1).every((c) => /[.!?]$/.test(c)));
check("chunks lose nothing", chunkText(novel).join("").replace(/\s/g, "").length === novel.replace(/\s/g, "").length);
check("line endings and blank runs are normalised", cleanSourceText("﻿a\r\n\r\n\r\n\r\nb  \r\n") === "a\n\nb");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
