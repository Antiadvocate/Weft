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
import { salvageProse, cutRepetitionLoop, stripScriptTranscript, stripReasoningPreamble, dropDiscardedDrafts, collapseRepeatedSpeech, dropUnclosedReasoningTail, parseSceneFooter, isRefusal } from "../src/engine/turn";
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

/* ── IT WROTE THE SCENE TWICE, AND SAID EVERY LINE TWICE INSIDE EACH ─────────────
 *
 * Third fixture, third save, `/no_think` switched off this time — so no deliberation leaked, and
 * the failure moved. The model wrote a complete scene, then:
 *
 *     Here is a response to the instruction, written as the scene's next beat:
 *
 * and wrote the entire scene again. And WITHIN each draft, Titus delivers both his lines, then
 * delivers both of them again verbatim a paragraph later ("he repeats, the words flat and even").
 *
 * Neither draft is broken prose. That is what makes this one different from the envelope and the
 * deliberation: there is nothing malformed to detect, only too much of something well-formed.
 */
{
  const RAW3 = readFileSync(join(import.meta.dirname, "fixtures/redraft-turn.txt"), "utf8");
  const { prose, notes } = salvageProse(RAW3);

  check("the redraft is reported", notes.some((n) => /wrote the scene twice/.test(n)), notes);
  check("the doubled speech is reported", notes.some((n) => /same line twice/.test(n)), notes);
  check("the announcement itself is gone", !/Here is a response to the instruction/i.test(prose));

  // the LAST draft is the one kept — it is the model's own final answer, and the better prose
  check("the surviving draft is the second one", prose.includes("the stench of open sewage rides the west wind"), prose.slice(0, 120));
  check("and the first draft is gone", !prose.includes("the smell of open sewage rolls up from the reeds"));

  // each line survives exactly once
  check("Vulcan is invoked once, not twice", (prose.match(/May Vulcan see the make of this/g) ?? []).length === 1);
  check("and the Subura line lands once", (prose.match(/You are not from the Subura/g) ?? []).length === 1);
  check("the 'he repeats' paragraph is gone", !/he repeats/.test(prose), prose);

  // and the scene is still whole — beginning, action, dialogue, closing beat
  check("the scene still opens on the river", prose.startsWith("The river mud works up against the hem"));
  check("the business with the nail survives", prose.includes("He taps the nail against his teeth a second time"));
  check("and Livia still closes it", prose.includes("drops into the mud with a soft thud"));
  check("it is still a full turn", prose.length > 900, prose.length);
}

/* ── the two new pieces, on their own ────────────────────────────────────────── */
{
  const a = "She crossed the yard and put the bucket down by the door. The water had gone still by the time she straightened up, and the light was going out of the sky behind the roofline.";
  // over 200 characters on purpose: the salvage refuses to cut down to less than a turn's worth of
  // prose, so a fixture shorter than that would test the guard rather than the thing being guarded
  const b = "He came out with the lamp already lit and did not look at her. The dog followed him as far as the step, then sat down in the cold and would not come further. She heard the latch go and then nothing at all, and the yard stayed dark a long while after.";

  check("a redraft announcement keeps what follows", dropDiscardedDrafts(`${a}\n\nHere is my revised version:\n\n${b}`).text === b);
  check("and reports the cut", dropDiscardedDrafts(`${a}\n\nHere is my revised version:\n\n${b}`).cut);
  // a truncated response can end ON the announcement — then the draft already written is all there is
  check("an announcement with nothing after it keeps the draft", !dropDiscardedDrafts(`${a}\n\nHere is the revised scene:`).cut);
  check("ordinary prose has no marker", !dropDiscardedDrafts(`${a}\n\n${b}`).cut);

  const line = `"You are not from the Subura, and I will not ask you again,"`;
  const dup = `${a}\n\n${line} he says.\n\n${b}\n\n${line} he repeats.`;
  check("a line spoken twice loses its second outing", collapseRepeatedSpeech(dup).cut);
  check("and the first one stays", collapseRepeatedSpeech(dup).text.includes(line));
  check("and the narration around it is untouched", collapseRepeatedSpeech(dup).text.includes(b));
  // short lines genuinely recur — a name, a refusal, a call across a yard
  check("a short line may repeat", !collapseRepeatedSpeech(`${a}\n\n"No," he said.\n\n${b}\n\n"No," he said again.`).cut);
  // a paragraph that repeats a line but also carries NEW speech is doing something
  check("a paragraph with a new line as well is kept",
    !collapseRepeatedSpeech(`${a}\n\n${line} he says.\n\n${b}\n\n${line} he says, "and you will not come back here either."`).cut);
  check("prose with no dialogue at all is never touched", !collapseRepeatedSpeech(`${a}\n\n${b}`).cut);
}

/* ── AN INSTRUCTION ABOUT THE ANSWER, INSTEAD OF THE ANSWER ──────────────────────
 *
 * Fourth save. Turn 3's stored prose, complete and entire:
 *
 *     (Write your response in plain text.
 *
 * Nine output tokens, then EOS. It is not a refusal and not a truncated scene — it is the model
 * continuing the PROMPT rather than answering it, the same root as the chat envelope. And the
 * engine stored it as the scene and ran a full bookkeeping pass against it, because the stub guard
 * has an escape hatch for a terse-but-real beat and this cleared it on a technicality: six words,
 * ending in a full stop.
 */
{
  check("the real one is caught", isRefusal("(Write your response in plain text."));
  for (const stub of [
    "Write your response below:",
    "(Now write the scene in plain prose.)",
    "Please respond with the narration only.",
    "Continue the scene in the following format:",
    "Your response should be two to four paragraphs.",
  ]) check(`stub: ${stub.slice(0, 38)}`, isRefusal(stub), stub);

  // seven words is not a turn however cleanly it ends
  check("a seven-word 'turn' is not a turn", isRefusal("He set the cup down and left."));
  // …but real prose of any length is prose
  const short = "He set the cup down, looked at her once, and walked out into the rain without another word.";
  check("a terse but real beat survives", !isRefusal(short), short);
  const full = "The mud sucks at your boots. Titus does not look up from the nail in his fingers, and the river keeps moving behind him, brown and slow and full of the city's leavings.";
  check("ordinary narration is never a refusal", !isRefusal(full));
  // the existing guards still hold
  check("empty is still a failure", isRefusal(""));
  check("a refusal stem is still a refusal", isRefusal("I'm sorry, but I can't continue that scene."));
  // a scene that merely CONTAINS an instruction-shaped line is not a stub
  const embedded = `"Write it down for me," she said, and pushed the wax tablet across the table. He did not touch it. The lamp guttered once between them and neither of them moved to trim it.`;
  check("dialogue that sounds like an instruction is still a scene", !isRefusal(embedded), embedded);
}

/* ── THE KOBOLD LOG'S TWO OUTPUTS ────────────────────────────────────────────────
 *
 * Straight off the server log, both ending in EOS well under the budget:
 *
 *   (continue the existing prose; continue the line after the last prose ended: continue the line
 *   after ". He spits the nail back onto the mud, his gaze still locked on the /no_think
 *
 *   <think>
 *   Let me parse what's happening here. The player (Marcus Valerius) just said a long, rambling…
 *
 * and
 *
 *   (Write only the interior monologue / chain of thought that leads to the constraints, then the
 *   final story prose. Write the outside of the room: the river, the mud, a washerwoman wringing
 *   linen in the brown water, a washerwoman wringing linen in the chain
 *
 * Both are the model writing instructions AT itself rather than answering — and the first carries
 * an unclosed <think> that does not start the response, so neither the stream filter nor the
 * preamble stripper can reach it.
 */
{
  const one = `(continue the existing prose; continue the line after the last prose ended: continue the line after ". He spits the nail back onto the mud, his gaze still locked on the /no_think\n\n<think>\nLet me parse what's happening here. The player (Marcus Valerius) just said a long, rambling, modern-sounding speech to Livia Aelia. Now I need to write what happens NEXT. The prose continues from where it left off. Key constraints: the player's words are ALREADY SAID.`;
  const two = `(Write only the interior monologue / chain of thought that leads to the constraints, then the final story prose. Write the outside of the room: the river, the mud, a washerwoman wringing linen in the brown water, a washerwoman wringing linen in the chain`;

  // A LENGTH BOUND ON THE WHOLE RESPONSE WAS THE WRONG SHAPE: the stub is the first line, and the
  // deliberation behind it makes the response long. Testing the line is what catches these.
  check("the self-instruction with a think block behind it is caught", isRefusal(one), one.slice(0, 60));
  check("the interior-monologue instruction is caught", isRefusal(two), two.slice(0, 60));
  check("neither is stored as a scene", isRefusal(one) && isRefusal(two));

  // and the tail dropper, for the arrangement where real prose DOES precede the break
  const scene = "Titus wipes the soot from his palms onto a rag and does not look up. The nail turns over once between his fingers, then again, and he sets it down on the flat of the anvil where the light can reach it. Livia stays where she is, the pot held against her chest.";
  const broken = `${scene}\n\n<think>\nWait, let me reconsider how Livia would react to that, because her card says`;
  check("prose followed by an unclosed think block keeps the prose", dropUnclosedReasoningTail(broken).text === scene);
  check("and reports it", dropUnclosedReasoningTail(broken).cut);
  check("a CLOSED block is left to the stream filter", !dropUnclosedReasoningTail(`${scene}\n\n<think>hm</think>`).cut);
  check("no tag at all changes nothing", !dropUnclosedReasoningTail(scene).cut);
  // all deliberation and no scene: hand it back whole so isRefusal sees it and the turn is retried
  check("a response that is only a break-off is left for the refusal path",
    !dropUnclosedReasoningTail("<think>\nLet me reconsider the whole thing from the top.").cut);

  // salvage routes it, and the note says what happened
  const { prose, notes } = salvageProse(broken);
  check("salvage cuts the tail", prose === scene, prose);
  check("and names it", notes.some((n) => /unclosed deliberation/.test(n)), notes);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
