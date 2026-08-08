/* Run the two instruments over a save file and print the report.
 *
 *   npx tsx tools/audit.ts path/to/save.weaver.json [--dark 25]
 *
 * No model calls, no network. Reads the file, builds every state-derived prompt the engine sends,
 * and reports what reaches the model and what crossed between subsystems. */
import fs from "node:fs";
import { sanitize } from "../src/engine/state";
import { coverageAudit, emergenceReport } from "../src/engine/audit";

const file = process.argv[2];
if (!file) { console.error("usage: npx tsx tools/audit.ts <save.json> [--dark N]"); process.exit(1); }
const darkN = Number((process.argv.find((a) => a.startsWith("--dark")) ?? "").split(/[= ]/)[1] ?? 25) || 25;

const state = sanitize(JSON.parse(fs.readFileSync(file, "utf8")));
const bar = (pct: number, w = 28) => "█".repeat(Math.round((pct / 100) * w)).padEnd(w, "·");

console.log(`\n${state.name} — turn ${state.world.current_turn}, ${Object.keys(state.characters).length} characters\n`);

/* ── 1. coverage ──────────────────────────────────────────────────────────────────────────── */
const cov = coverageAudit(state);
console.log("── COVERAGE ── does this field reach a prompt at all?\n");
console.log(`  ${bar(cov.pct)}  ${cov.pct}%   ${cov.reachedCount} of ${cov.totalCount} stored fields reach the model\n`);
for (const [name, n] of Object.entries(cov.byPrompt)) {
  console.log(`    ${name.padEnd(20)} ${String(n).padStart(5)} fields`);
}
console.log("  BY SUBSYSTEM — 0% means it never reaches the narrator or the bookkeeper.");
console.log("  (auxiliary passes build context inline and are not measured — e.g. `faculties` is read by the reads pass)\n");
for (const g of cov.bySubsystem) {
  if (g.total < 4) continue;
  console.log(`    ${bar(g.pct, 16)} ${String(g.pct).padStart(3)}%  ${g.name.padEnd(26)} ${String(g.reached).padStart(4)} / ${g.total}`);
}
console.log(`\n  DARK — written every turn, read by nobody (top ${darkN} groups):\n`);
for (const g of cov.darkGroups.slice(0, darkN)) {
  console.log(`    ${String(g.count).padStart(4)}×  ${g.group}`);
}
const darkTotal = cov.darkGroups.reduce((a, b) => a + b.count, 0);
console.log(`\n    ${cov.darkGroups.length} distinct dark shapes, ${darkTotal} fields total`);
if (cov.impurePaths.length) {
  console.log(`\n  IMPURE — building a prompt WRITES these (a build is supposed to be a read):`);
  for (const p of cov.impurePaths.slice(0, 8)) console.log(`    ${p}`);
}

/* ── 2. emergence ─────────────────────────────────────────────────────────────────────────── */
const em = emergenceReport(state);
console.log(`\n\n── EMERGENCE ── did anything cross between subsystems?\n`);

console.log(`  OFFSTAGE → ONSTAGE   the world sim invented it while you were elsewhere`);
console.log(`    events written        ${em.offstage.events}`);
console.log(`    later on the page     ${em.offstage.surfaced}  (${em.offstage.pct}%)`);
console.log(`    null model            ${em.offstage.nullRate}%   ← same test run backwards; anything at or below this is coincidence`);
for (const e of em.offstage.examples) {
  console.log(`      t${String(e.from).padEnd(4)}→ t${String(e.to).padEnd(4)} lag ${String(e.to - e.from).padEnd(4)} ${String(e.actor).padEnd(9)} via ${e.via.join(", ")}`);
}

console.log(`\n  RUMOUR DIFFUSION     reached them by cascade, not by being there`);
console.log(`    rumours               ${em.rumor.total}`);
console.log(`    never left a witness  ${em.rumor.witnessedOnly}`);
console.log(`    travelled at least 1× ${em.rumor.withToldHop}`);
console.log(`    hop distribution      ${JSON.stringify(em.rumor.hops)}`);
console.log(`    second-hand knower later on page with it   ${em.rumor.secondHandActed}`);

console.log(`\n  WANTS                pursued across turns, or replaced every turn?`);
console.log(`    new wants issued      ${em.drives.newWants} over ${em.turns} turns  → one every ${em.drives.perTurn} turns`);
console.log(`    survived 3+ turns     ${em.drives.survived3}`);
console.log(`    longest single want   ${em.drives.longestRun} turns`);
console.log(`    by character          ${JSON.stringify(em.drives.byChar)}`);

console.log(`\n  EDGES                (from telemetry snapshots)`);
console.log(`    tracked               ${em.edges.total}`);
console.log(`    moved 15+ points      ${em.edges.moved}`);
console.log(`    never moved at all    ${em.edges.neverMoved}`);
console.log(`    crossed zero          ${em.edges.signFlips}`);

console.log(`\n  TRAIT LEDGER`);
console.log(`    traits written        ${em.traits.written}`);
console.log(`    can ever be rendered  ${em.traits.everRendered}   (prompts show the first ${em.traits.renderedCap} per character)`);
console.log(`    unreachable           ${em.traits.written - em.traits.everRendered}\n`);
