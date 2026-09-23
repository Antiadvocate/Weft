/* Smoke test: THE ENGINE PICKED THE STORY'S SUBJECT AND THE NARRATOR NEVER SAW IT.
 *
 * A fresh save, twenty-two turns, and the player's report was "22 turns not a single fire". The
 * telemetry column added the turn before said otherwise:
 *
 *   T9   beat=palette: The voice from Amber's feet becoming more insistent and seductive
 *   T13  beat=palette: The growing intimacy and tension between Joe and Amber
 *   T16  beat=palette: The voice from Amber's feet becoming more insistent and seductive
 *   T20  beat=palette: The growing intimacy and tension between Joe and Amber
 *
 * Four beats, two of them the voice, and the prose on T9 and T16 is domestic banter about eggs and
 * candles with the voice nowhere in it. So the selector was right and the narrator ignored it.
 *
 * The reason is position. fullDirective in turn.ts concatenates about forty instruction blocks and
 * the pressure directive — the one carrying the beat — is the fifth, followed by thirty-seven more,
 * nearly all of them constraints on what NOT to write. prompts.ts already wrote down the rule this
 * breaks, about a different field: "a rule in the middle of a thirty-thousand-character digest is
 * reference and a rule at the end is an instruction."
 *
 * So the beat body comes out of that block and goes last, against the player's own typed line,
 * under its own header. Nothing about what it says changed. */
import { pressureDirective, beatDirective, type Beat } from "../src/engine/pressure";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FEET = "The voice from Amber's feet becoming more insistent and seductive";
const V = { pressure: 7, band: "danger", source: "palette" } as any;
const palette: Beat = { kind: "palette", ref: FEET } as any;
const quiet: Beat = { kind: "palette", ref: FEET, quiet: true } as any;
const clock: Beat = { kind: "clock", ref: "the co-op: take the building", filled: 3, segments: 6, signs: ["a notice taped in the stairwell"] } as any;

// ---- the beat body actually comes back out of beatDirective ----------------------------------
const d = beatDirective(palette, 9);
check("beat directive carries the palette line", d.includes("THE STORY'S MAIN PRESSURE ARRIVES NOW"), d);
check("beat directive names the source verbatim", d.includes(FEET), d);
check("beat directive is headed as the turn's job", d.includes("=== WHAT THIS TURN IS FOR ==="), d);
check("beat directive starts with a break, so it cannot glue to the block above", d.startsWith("\n\n"), JSON.stringify(d.slice(0, 6)));
// The first version of this function rebuilt the body by slicing pressureDirective's output at its
// first newline — but that function joins with spaces, and the only newlines in it come from INSIDE
// a clock beat's own signs list. On a clock beat it returned the signs and threw away the beat.
const dc = beatDirective(clock, 9);
check("a clock beat keeps its own opening line", dc.includes("PRESSURE BEAT from a maturing faction clock"), dc);
check("a clock beat still carries its signs", dc.includes("a notice taped in the stairwell"), dc);
check("the quiet palette form survives", beatDirective(quiet, 9).includes("TOUCHES THE SCENE, lightly and unprompted"), beatDirective(quiet, 9));
check("no beat at all is still said out loud", beatDirective(undefined, 9).includes("NOTHING FROM OUTSIDE THIS TURN"), beatDirective(undefined, 9));
check("kind none is still said out loud", beatDirective({ kind: "none" } as Beat, 9).includes("NO NEW INCIDENT THIS TURN"));

// ---- at rest the beat is silent, because pressureDirective already speaks for the world --------
/* A PALETTE BEAT IS THE ONE THING THAT STILL LANDS HERE AT REST, and the reason is the reason this
 * whole block exists: the last position is where an instruction goes and the middle is where
 * reference goes. Returning "" put the one source the player wrote by hand into the digest while
 * the paragraph saying the world is at rest kept the end of the document. Everything the ENGINE
 * invented is still silent at rest. See restingPalette in pressure.ts. */
check("a palette beat lands here even at rest", beatDirective(palette, 0).includes("WHAT THIS TURN IS FOR"), beatDirective(palette, 0));
check("...and nothing the engine invented does",
  beatDirective(clock, 0) === "" && beatDirective({ kind: "thread", ref: "x" } as Beat, 0) === "");
check("tension undefined behaves like the mid dial", beatDirective(palette).length > 0);

// ---- the deferred call no longer says it too ---------------------------------------------------
const deferred = pressureDirective(V, [FEET], 9, "mortal", palette, true);
check("deferred: the beat body is gone", !deferred.includes("THE STORY'S MAIN PRESSURE ARRIVES"), deferred);
check("deferred: and it does NOT claim there is no source", !deferred.includes("NOTHING FROM OUTSIDE THIS TURN"), deferred);
check("deferred: the pressure reading stays", deferred.includes("PRESSURE 7/10"), deferred);
check("deferred: the palette filter stays", deferred.includes("Draw pressure only from"), deferred);

// The old callers pass five arguments and must be untouched by any of this.
const inline = pressureDirective(V, [FEET], 9, "mortal", palette);
check("undeferred: the beat body is where it always was", inline.includes("THE STORY'S MAIN PRESSURE ARRIVES"), inline);
/* Undeferred at rest, a palette beat is carried rather than overridden — the rest paragraph used to
 * tell the narrator to introduce nothing in the same breath as handing it the story's own subject,
 * and a rule that long and that absolute wins against an exception. Everything else the engine
 * could have invented is still refused there. */
check("undeferred: a palette beat at rest is carried, not overridden",
  pressureDirective(V, [FEET], 0, "mortal", palette).includes("THE STORY'S MAIN PRESSURE ARRIVES"));
check("undeferred: and the rest paragraph stops arguing with it",
  !pressureDirective(V, [FEET], 0, "mortal", palette).includes("Do NOT introduce any new threat"));
check("undeferred: a turn with nothing in it is unchanged",
  pressureDirective(V, [FEET], 0, "mortal", { kind: "none" } as Beat).includes("Do NOT introduce any new threat"));
check("undeferred and deferred say the same thing minus the beat",
  inline.replace(beatDirective(palette, 9).split("\n").pop()!, "").replace(/ +/g, " ").trim() === deferred.replace(/ +/g, " ").trim(),
  { inline, deferred });

// ---- and turn.ts actually places it last -------------------------------------------------------
const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
check("turn.ts defers the beat out of the pressure block", /pressureDirective\(verdict,[^)]*standingTier, beat, true\)/.test(src));
// The third "=== PLAYER ACTION" in the file is the bookkeeper's prompt, which records state and
// writes no prose — the beat is a narrator instruction and has no business in it.
const prompts = src.split("\n").filter((l) => l.includes("=== PLAYER ACTION") && l.includes("=== DIRECTION ==="));
check("both prompt templates were found", prompts.length === 2, prompts.length);
for (const [i, line] of prompts.entries()) {
  check(`prompt ${i + 1}: the beat is in it`, line.includes("${beatNote}"), line.slice(0, 120));
  check(`prompt ${i + 1}: nothing stands between the beat and the player's line`,
    line.includes("${beatNote}\\n\\n=== PLAYER ACTION"), line.slice(0, 200));
  const before = line.indexOf("${beatNote}");
  check(`prompt ${i + 1}: the beat is not fifth of forty`, before > line.indexOf("${fullDirective}") || line.indexOf("${fullDirective}") < 0);
}
check("beatNote is built from the same beat the turn selected", /const beatNote = beatDirective\(beat,/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
