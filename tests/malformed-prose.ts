/* Smoke test: THE TURN A PLAYER ACTUALLY READ.
 *
 * The fixture beside this file is verbatim `history[1].narrator_prose` from a real save — Rome,
 * 41 AD, narrated by a Q3 quant of a 27B served locally. It is not a reconstruction. It is what the
 * engine stored and put on the page as that player's story, and it contains three failures at once:
 *
 *   1. THE CHAT ENVELOPE. The response opens `[{"role": "assistant", "content": "…` — the model
 *      serialized the API message format instead of answering in it. That happens when the chat
 *      template did not put the model in the assistant's turn: it sees a transcript of JSON and
 *      goes on writing JSON.
 *   2. A DEGENERATE LOOP. "a fisherman's boat drifts sideways" three times, then the token budget
 *      ran out mid-phrase. The classic end state of an over-quantized model with nothing on the
 *      sampler to penalise repetition.
 *   3. A SCRIPT TRANSCRIPT appended after the envelope closed, whose FIRST LINE is the player's own
 *      input handed back verbatim — the echo failure, in the same response.
 *
 * The prose inside the wrapper is good. That is the whole reason this code exists rather than a
 * rejection: the failure is formatting, not refusal, so re-rolling buys the same garbage (and in
 * this save the fallback model was the same local model, so it buys it twice).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { salvageProse, cutRepetitionLoop, stripScriptTranscript, parseSceneFooter } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const RAW = readFileSync(join(import.meta.dirname, "fixtures/malformed-local-turn.txt"), "utf8");
const PLAYER_LINE = "Hmm where am I... is this ancient times?";

/* ── the real thing, end to end ──────────────────────────────────────────────── */
{
  const { prose, notes } = salvageProse(RAW);
  // Two notes, not three: the appended transcript sat OUTSIDE the JSON, so unwrapping the envelope
  // discards it in the same step. What matters is that neither failure is silent.
  check("both surviving failures are reported, not silently swallowed", notes.length === 2, notes);
  check("the envelope is named in the report", notes.some((n) => /envelope/.test(n)), notes);
  check("the loop is named in the report", notes.some((n) => /repetition loop/.test(n)), notes);

  check("the envelope is gone", !prose.trimStart().startsWith("[") && !/"role"\s*:\s*"assistant"/.test(prose), prose.slice(0, 80));
  check("no JSON escaping survives into the prose", !prose.includes('\\"') && !prose.includes("\\n"), prose.slice(0, 120));

  check("the loop is cut", (prose.match(/a fisherman's boat drifts sideways/gi) ?? []).length <= 1, prose.slice(-160));
  check("and the sentence it was cut at is closed", /[.!?"']$/.test(prose.trim()), JSON.stringify(prose.slice(-40)));

  check("the script transcript is gone", !/^\s*Marcus Valerius:/m.test(prose) && !/^\s*Livia Aelia:/m.test(prose), prose.slice(-200));
  check("so the player's own line is not read back to them", !prose.includes(PLAYER_LINE), prose);

  // what survives has to be the actual scene, not a stub
  check("the real prose survives", prose.includes("The mud under his jeans is cold and wet"), prose.slice(0, 80));
  check("including the dialogue inside it", prose.includes("May Vulcan see what has been made here"));
  check("and it is still a whole turn, not a fragment", prose.length > 700, prose.length);
}

/* ── a healthy turn must pass through untouched ──────────────────────────────── */
{
  const good = `The sun beats down on the banks of the Tiber.\n\nTitus stops his pacing. "May Vulcan grant me patience, girl," he mutters.\n\n<<<SCENE place="The Tiber Embankment" here="Titus Aelius Rufus" entered="" left="" new="" alias="">>>`;
  const { prose, notes } = salvageProse(good);
  check("clean prose is not touched", prose === good && notes.length === 0, notes);
  // ORDER MATTERS: the footer can be INSIDE the envelope, so salvage has to run first or the turn
  // silently loses its presence declaration and nobody can tell why.
  const wrapped = JSON.stringify([{ role: "assistant", content: good }]);
  const footer = parseSceneFooter(salvageProse(wrapped).prose).footer;
  check("a footer inside an envelope is still found after salvage", footer?.place === "The Tiber Embankment", footer);
  check("with the roster intact", footer?.here?.includes("Titus Aelius Rufus"), footer);
  // WORSE THAN LOSING IT. Parsed straight out of the envelope, the escaped quotes defeat the
  // attribute regex and the footer comes back non-null with NO place and an EMPTY roster — which
  // the engine reads as the narrator declaring an empty room, and presence gets wiped. So salvage
  // running first is not a tidiness preference; it is what stops a formatting failure from
  // emptying the scene.
  const naive = parseSceneFooter(wrapped).footer;
  check("without salvage it would parse as an empty-room declaration",
    naive !== null && !naive.place && naive.here.length === 0, naive);
}

/* ── the loop cutter, on its own ─────────────────────────────────────────────── */
{
  check("three repeats is a loop", cutRepetitionLoop("She waited by the door. He is gone. He is gone. He is gone. He is").cut);
  // twice is a figure of speech people write on purpose, and the engine must not edit it
  check("twice is rhetoric, not a loop", !cutRepetitionLoop("She waited, and waited, by the door for a long while.").cut);
  check("ordinary prose is untouched", !cutRepetitionLoop("The mud is cold. The stench pulls up from the stones. He turns the nail over.").cut);
  // a short repeated unit is punctuation or a tic, not a cycle worth cutting a scene for
  check("a repeated short word is not a loop", !cutRepetitionLoop("No, no, no, she said, and turned away from him.").cut);
  const cut = cutRepetitionLoop("A boat drifts sideways, a boat drifts sideways, a boat drifts sideways, a boat");
  check("the first occurrence is kept", cut.text.startsWith("A boat drifts sideways") && (cut.text.match(/drifts sideways/g) ?? []).length === 1, cut.text);
}

/* ── the transcript stripper, on its own ─────────────────────────────────────── */
{
  const body = "The mud under his jeans is cold and wet, and the stench of the river pulls up from the cracks in the embankment stones. He turns the nail over.";
  const withScript = `${body}\n\nMarcus Valerius: "Where am I?"\nTitus Aelius Rufus: "You are in Rome."`;
  check("a trailing name-colon-quote block is stripped", stripScriptTranscript(withScript).text === body);
  // prose dialogue is attributed the normal way and must never be mistaken for screenplay
  const prose = `${body}\n\n"Where am I?" he said. Titus did not answer him.`;
  check("real dialogue is left alone", !stripScriptTranscript(prose).cut);
  // one line is an ambiguous case (a sign, a label, a letter) — needs a block to be sure
  check("a single line is not enough to be a transcript", !stripScriptTranscript(`${body}\n\nTitus: "You are in Rome."`).cut);
  // never leave the player with nothing
  check("a response that is ONLY a transcript is left for the refusal path",
    !stripScriptTranscript(`Marcus: "a"\nTitus: "b"\nLivia: "c"`).cut);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
