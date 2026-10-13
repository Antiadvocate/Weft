/* NO REGULAR EXPRESSIONS IN THE GAME.
 *
 * The player, after a turn in which "I skin her so she is nothing but a skeleton" wasn't violence
 * because "skin" wasn't on a list: "Don't use any regex anywhere in the code. LLMs are beyond being
 * constrained by word choice filters."
 *
 * What something MEANS (violence, leaving, turning someone away, talking to the game, who's still in
 * the room) is the models' to judge, and reaches the engine as structured fields: the small model's
 * read of the turn before it's written (engine/actionread.ts) and the bookkeeper's after. Handling
 * text as text (spaces, words, sentences, quoted lines) is done by walking characters, in
 * engine/text.ts.
 *
 * This counts what's left in src/ and holds the number: it may fall and never rise, and it ends at
 * zero. Dev tooling under tools/ and the tests themselves are outside it. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** A regex literal, a RegExp constructor or a String.raw pattern source, outside comments. */
const SITE = /(new RegExp|RegExp\(|String\.raw`|(?<![\w)\]$])\/(?![/*\s])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuy]*(?=\s*[.,;)\]}:?]|\s*$|\.test|\.exec))/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

export function regexSites(root = "src"): { total: number; byFile: [string, number][] } {
  const byFile: [string, number][] = [];
  for (const f of walk(root)) {
    let n = 0, inBlock = false;
    for (const raw of readFileSync(f, "utf8").split("\n")) {
      let line = raw;
      if (inBlock) { const end = line.indexOf("*/"); if (end === -1) continue; line = line.slice(end + 2); inBlock = false; }
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*")) continue;
      if (t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue; }
      n += (line.match(SITE) ?? []).length;
    }
    if (n) byFile.push([relative(".", f), n]);
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total: byFile.reduce((s, [, n]) => s + n, 0), byFile };
}

/** May fall, never rise. Lower it in the commit that removes them. */
const BUDGET = 1699;
{
  const { total, byFile } = regexSites();
  console.log(`     (regex sites left in src: ${total}, budget ${BUDGET})`);
  check(`src holds at most ${BUDGET} regex sites`, total <= BUDGET, byFile.slice(0, 12));
  check("the turn's own text helpers use none", !byFile.some(([f]) => f.endsWith("engine/text.ts")), byFile.find(([f]) => f.endsWith("engine/text.ts")));
  check("nor does the reading of the turn", !byFile.some(([f]) => f.endsWith("engine/actionread.ts") || f.endsWith("engine/instruction.ts")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
