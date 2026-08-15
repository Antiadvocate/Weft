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
import { salvageProse, cutRepetitionLoop, stripScriptTranscript, stripReasoningPreamble, parseSceneFooter } from "../src/engine/turn";
import { stripThinking } from "../src/llm";

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

/* ── THE DELIBERATION THAT NEVER CLOSED ──────────────────────────────────────────
 *
 * Second fixture, same setup, a later turn. The model opened `<analysis>`, worked through the scene
 * for nine hundred words — correctly; it even wrote "the player's spoken line is ALREADY SAID — I
 * must not reproduce it", which is the anti-echo fix landing — and then wrote the prose WITHOUT
 * ever closing the tag. No close tag means the stream filter has nothing to match on, so the whole
 * thing reached the page.
 */
{
  const RAW2 = readFileSync(join(import.meta.dirname, "fixtures/reasoning-preamble-turn.txt"), "utf8");
  const { prose, notes } = salvageProse(RAW2);

  check("the unclosed deliberation is reported", notes.some((n) => /never closed the block/.test(n)), notes);
  check("the prose starts at the scene", prose.startsWith("Titus Aelius Rufus stands near the muddy water's edge"), prose.slice(0, 90));
  check("no analysis tag survives", !/<analysis/i.test(prose));

  // Every one of these is a phrase from the model's working-out. None may reach the player.
  for (const leak of ["Let me break down", "Key constraints", "**What Titus would do**", "Let me draft", "you know what, let me just write it", "the language barrier", "at least one beat"]) {
    check(`no leak: ${leak.slice(0, 34)}`, !prose.includes(leak), prose.slice(0, 200));
  }
  check("and no numbered analysis list", !/^\s*\d+\.\s+\*\*/m.test(prose));

  // the whole scene survives — this must not become a fragment
  check("the dialogue survives", prose.includes("May Vulcan see that no man is lost to the river"));
  check("the closing beat survives", prose.includes("Livia Aelia stands behind him"));
  check("the markdown rule before the footer is gone", !/^\s*\*{3,}\s*$/m.test(prose));

  // The footer was truncated mid-attribute by the budget the reasoning ate. It must still parse —
  // losing it would leave the engine with no declaration of who is in the room.
  const footer = parseSceneFooter(prose).footer;
  check("the truncated footer still parses", footer?.place === "The Tiber Embankment", footer);
  check("with the full roster", footer?.here.length === 3, footer?.here);

  // THE DIAGNOSIS SURVIVES THE CUT. The leaked token sits inside the deliberation, so stripping the
  // preamble takes the evidence away with it — and this is the one bit of debris that tells the
  // player something they can act on about their own setup.
  check("the /no_think leak is still reported after the preamble is cut",
    notes.some((n) => /no_?think/.test(n) && /Tuning/.test(n)), notes);
  check("and the token itself never appears in the prose", !/no_?think/i.test(prose));
}

/* ── the pieces, on their own ────────────────────────────────────────────────── */
{
  const scene = "Titus stands near the water's edge, a bent nail between his fingers. He taps it against his teeth, then holds it up so the light catches the metal. His eyes do not blink, and they move slowly over your filthy shirt and torn jeans.";
  // gated on an opener: prose that merely contains a stray analytical word is never touched
  check("clean prose is never scanned at all", !stripReasoningPreamble(scene).cut);
  check("an opener alone is enough to look", stripReasoningPreamble(`<analysis>\nLet me think.\n\n${scene}`).cut);
  // NEVER GUESS THE SCENE AWAY — if too little survives, the structural read was wrong
  check("a response that is ALL reasoning is left alone", !stripReasoningPreamble("<think>\nLet me think about this scene.\n\nI should open on the cold.").cut);
  // dialogue is not evidence of thinking
  const withQuote = `<analysis>\nLet me think.\n\nHe held out his hand. "Let me see it," he said, and she gave him the nail without a word. The metal was still warm from the forge, and he turned it over twice before he spoke again.`;
  check("a character saying 'let me' is scene, not deliberation",
    stripReasoningPreamble(withQuote).text.includes("Let me see it"), stripReasoningPreamble(withQuote).text);
}

/* ── the stream filter learned more than one name for thinking ───────────────── */
{
  check("<think> still works", stripThinking("<think>hm</think>Prose.") === "Prose.");
  // the tag that produced this fixture
  check("<analysis> too", stripThinking("<analysis>hm</analysis>Prose.") === "Prose.");
  for (const tag of ["thinking", "reasoning", "thought", "scratchpad", "reflection"]) {
    check(`<${tag}> too`, stripThinking(`<${tag}>working</${tag}>Prose.`) === "Prose.");
  }
  check("an attribute on the tag doesn't defeat it", stripThinking('<think type="internal">hm</think>Prose.') === "Prose.");
  // an unclosed block is handed on intact — the prose salvage is the layer that can find the scene
  check("an unclosed block is passed through for the salvage layer",
    stripThinking("<analysis>going forever").includes("going forever"));
  check("a real tag-shaped word in prose is untouched", stripThinking("She read the plan. It was short.") === "She read the plan. It was short.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
