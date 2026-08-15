/* Smoke test: THE PROMPT TOLD THE NARRATOR TO ECHO THE PLAYER, AND THEN TO STOP.
 *
 * The contract has said NEVER RESTATE THE PLAYER'S WORDS since early on, in three places. The
 * narrator echoed anyway, and on a local model it did something worse: it wrote the player's quoted
 * line back out, treated the turn as discharged, and emitted EOS. A recital of the input, and short.
 *
 * That is not a model defect. Two instructions elsewhere in the same prompt said, literally, to
 * reproduce the text:
 *
 *   INLINE_CHANNEL_NOTE   "MUST be rendered as the player saying it"
 *                         "render the player speaking those exact words"
 *   the section header    "=== PLAYER ACTION (render exactly, add no interiority) ==="
 *
 * Both were written to fix ATTRIBUTION — a narrator that took a line addressed to Rabi and put it in
 * Rabi's mouth — and neither was about repetition at all. But they sit in the LAST user message,
 * immediately before generation, some nine thousand tokens after the prohibition they contradict.
 * Recency decides that argument, and the further a model is from being able to hold fifteen thousand
 * tokens of rules in balance, the more decisively recency decides it.
 *
 * The lesson is the one prompt-echo.ts already records in a different key: a prohibition stated far
 * away loses to a phrasing stated close, every time. So the fix is not another prohibition. It is
 * that no instruction anywhere may READ as "reproduce the player's line", and this test is what
 * keeps it that way — the two requirements have to stay separated in the text, because they were
 * only ever conflated by accident.
 */
import { readFileSync } from "node:fs";
import { templateLiterals } from "../tools/promptlint";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FILES = ["src/engine/prompts.ts", "src/engine/turn.ts"];
/** Every string this engine can put in front of a model, comments stripped. */
const prompts = FILES.map((f) => ({ f, text: templateLiterals(readFileSync(f, "utf8")).join("\n") }));
/** …plus the section headers, which are built inline and are the closest text to generation. */
const headers = prompts.map((p) => p.text.match(/===[^=\n]+===/g) ?? []).flat();

/** The body of one named template constant. The narrator's two contracts are what this test is
 *  about; the engine has a dozen other prompts (image plans, the opening scene, the bookkeeper)
 *  that legitimately say things the narrator must not — an image plan telling a model to "render
 *  exactly this being", a standalone opening pass carrying its own word band because no TURN
 *  ENDINGS rule governs it. Scoping to the contracts is what keeps this test about the bug. */
function constBody(src: string, name: string): string {
  const m = new RegExp(`(?:export )?const ${name}\\s*=\\s*\``).exec(src);
  if (!m) throw new Error(`${name} not found — did it get renamed?`);
  let i = m.index + m[0].length;
  for (; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === "`") break; }
  return src.slice(m.index + m[0].length, i);
}
const promptsSrc = readFileSync("src/engine/prompts.ts", "utf8");
const CONTRACTS = {
  full: constBody(promptsSrc, "NARRATOR_SYSTEM"),
  lean: constBody(promptsSrc, "NARRATOR_SYSTEM_LEAN"),
};

/* ── NOTHING MAY READ AS "WRITE THE PLAYER'S LINE OUT AGAIN" ─────────────────── */
{
  // The exact constructions that produced the failure. Each one is a phrasing whose plain reading
  // is "reproduce the input", regardless of the sentence it was embedded in.
  const ECHO = [
    /render(?:ed|ing)?\s+(?:the\s+player\s+)?speaking\s+those\s+exact\s+words/i,
    /render(?:ed|ing)?\s+as\s+the\s+player\s+saying\s+it/i,
    /render\s+them\s+as\s+the\s+player\s+saying\s+it/i,
    /render\s+them\s+saying\s+it/i,
    // "render exactly" is fine about a BODY (an image plan says it of a non-humanoid being); it is
    // never fine about the player's input, so the check is scoped to sentences that mention them.
    /render exactly[^.]{0,120}\bplayer\b|\bplayer\b[^.]{0,120}render exactly/i,
  ];
  for (const { f, text } of prompts) {
    for (const re of ECHO) {
      const hit = re.exec(text);
      check(`${f}: nothing says ${re.source.slice(0, 34)}…`, !hit, hit?.[0]);
    }
  }
  check("no section header says 'render exactly'", !headers.some((h) => /render exactly/i.test(h)), headers.filter((h) => /render/i.test(h)));
}

/* ── THE PLAYER ACTION HEADER IS THE LAST THING READ BEFORE GENERATION ───────── */
{
  // The bookkeeper's own "=== PLAYER ACTION ===" is bare and stays bare — it transcribes state and
  // writes no prose, so none of this applies to it. The narrator's carries a parenthetical.
  const narratorHeaders = headers.filter((h) => /PLAYER ACTION\s*\(/i.test(h));
  check("the narrator's player-action header exists", narratorHeaders.length === 2, headers.filter((h) => /PLAYER ACTION/i.test(h)));
  // It still has to carry its real job — the player did this and NOTHING MORE — without carrying
  // an instruction to transcribe. "no more" is the operative half; "exactly" alone was the bug.
  check("and still forbids inventing actions for the player",
    narratorHeaders.every((h) => /no more|add no actions/i.test(h)), narratorHeaders);
  check("and still forbids inventing interiority",
    narratorHeaders.every((h) => /no interiority/i.test(h)), narratorHeaders);
  check("and no longer reads as a transcription order",
    narratorHeaders.every((h) => !/render exactly/i.test(h)), narratorHeaders);
}

/* ── THE PROHIBITION IS STATED WHERE IT IS ACTUALLY READ ─────────────────────── */
{
  const turn = prompts.find((p) => p.f.endsWith("turn.ts"))!.text;
  const proseFile = prompts.find((p) => p.f.endsWith("prompts.ts"))!.text;
  // In the inline channel note — the tail of the last user message, next to the action itself.
  check("the inline channel note says the line is already said",
    /ALREADY BEEN SAID/i.test(turn) && /do not reproduce the quoted line/i.test(turn));
  check("and says where to begin instead", /START AT THE MOMENT AFTER IT LANDED/i.test(turn));
  // …and the attribution rule it was conflated with must SURVIVE, stated on its own.
  check("attribution is still protected, separately",
    /NEVER put into another character's mouth/i.test(turn) && /ATTRIBUTION, not repetition/i.test(turn));
  check("and reassignment is still banned", /do not "fix" it by reassigning the line/i.test(turn));
  // Both contracts, full and lean, still carry the standing rule.
  check("the full contract still forbids restating", /NEVER RESTATE THE PLAYER'S WORDS/.test(proseFile));
  check("the lean contract still forbids restating", /Never restate the player's words/.test(proseFile));
}

/* ── NO WORD CEILING ─────────────────────────────────────────────────────────── */
{
  // "120–250 words; up to 350 only for a genuine set-piece" fought TURN ENDINGS for control of
  // where a turn stops, and a model with limited room to reconcile them takes the number, because
  // a number is the easiest instruction in the document to satisfy. Length is a consequence of
  // where the beat ends; it is not an input. The floor at 12 words (isRefusal) is a different
  // thing and stays — that one detects a stub, it does not shape prose.
  for (const [which, body] of Object.entries(CONTRACTS)) {
    const bands = body.match(/\b\d{2,4}\s*[–-]\s*\d{2,4}\s*words\b/gi) ?? [];
    check(`the ${which} contract states no word band`, bands.length === 0, bands);
    const caps = body.match(/\b(?:under|at most|no more than|up to)\s+\d{2,4}\s*words\b/gi) ?? [];
    check(`nor a one-sided ceiling`, caps.length === 0, caps);
    check(`the ${which} contract says there is no word count`, /no word count/i.test(body));
    check(`the ${which} contract hands length to TURN ENDINGS`, /TURN ENDINGS[^.]{0,40}decides/i.test(body));
    check(`the ${which} contract still forbids padding`, /do not pad to fill a length/i.test(body));
    // The failure mode being fixed is stopping EARLY, so this is the half that matters most.
    check(`the ${which} contract forbids stopping early`, /do not stop early/i.test(body));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
