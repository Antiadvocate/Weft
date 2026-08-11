/* Smoke test: "AND I'M TIRED OF TELLING YOU."
 *
 * From a save set in Rome. A noblewoman bargained one question out of the player in exchange for a
 * tour of the city. He answered it in an alley on turn 16. She then asked it again on 17, 18, 19,
 * 20, 21 and 22 — never the same words twice, always the same question:
 *
 *   t17  "…she still has not gotten a straight answer about Tigris"
 *   t18  "…she is not going to let the bookstore distract her from that"
 *   t19  "You did not tell me what the secret was. A secret has content."
 *   t20  "…she cannot shake the feeling that he is giving her a story, not the truth"
 *   t21  "…she is done with the soft answers; she wants the plain truth about Tigris"
 *
 * Nothing in the engine could see it. Her DRIVE was elsewhere the whole time (a bookseller), so the
 * nag guard — which fires off a stale drive — never looked at her. The intent pass re-derived the
 * want from scratch every turn out of a state that had not moved, and its loop check compared each
 * intent only to the one immediately before it, which read as six different beats.
 *
 * The player could see it perfectly well and said so, three times:
 *
 *   t19  "What's your question about her? I already answered you earlier I believe?"
 *   t22  "And I'm tired of telling you… it's becoming hard for me to constantly repeat myself."
 *   t23  "Thankfully I was getting very exhausted saying the same thing over and over and over."
 *
 * None of that is an action, so nothing in the engine consumed a word of it. It is the best signal
 * available — the only participant who can see the whole sequence, reporting on it directly — and
 * it is now read as what it is: a statement that a want the engine believes is open was satisfied
 * several turns ago.
 */
import { playerSaysAnswered, answeredDirective } from "../src/engine/turn";
import { repeatedIntent } from "../src/engine/intent";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the three lines from the save ─────────────────────────────────────────── */
{
  for (const line of [
    `"What's your question about her? I already answered you earlier I believe? You need to haggle? I can give you whatever gold you need"`,
    `"And I'm tired of telling you. She literally said 5 lines to me. I offered her freedom so she wouldn't reveal my powers. And it's becoming hard for me to constantly repeat myself."`,
    `"Thankfully I was getting very exhausted saying the same thing over and over and over. Please lead the way."`,
  ]) check(`heard: ${line.slice(1, 46)}…`, playerSaysAnswered(line), line);
}

/* ── 2. the other ways a player says it ───────────────────────────────────────── */
{
  for (const line of [
    "I told you already.",
    "I've said this three times now",
    "I already explained that to her",
    "how many times do I have to say it",
    "asked and answered",
    "stop asking me about the gold",
    "For the third time: no.",
    "I'm sick of repeating myself",
  ]) check(`"${line}"`, playerSaysAnswered(line), line);
}

/* ── 3. and the ordinary turns that must not trip it ──────────────────────────── */
{
  for (const line of [
    `"Hi. I'm Rabi. I'm trying to find out where I can go to find some lodgings."`,
    "I ask her what she meant by that",
    "I tell her the truth about the gold",
    "I said nothing and kept walking",
    "I answer the door",
    `"What was the question I asked?" I follow her.`,
    "I explain the aqueduct to him while we walk",
  ]) check(`not a complaint: "${line.slice(0, 40)}…"`, !playerSaysAnswered(line), line);
}

/* ── 4. what it puts in front of the narrator ─────────────────────────────────── */
{
  const d = answeredDirective("I already answered you earlier I believe?");
  check("the directive fires", d.length > 0);
  check("and it closes the subject rather than softening it", /asks the question again this turn/i.test(d), d);
  check("it bars the reword, which is the form it always takes", /rephrased/.test(d), d);
  check("and it bars handing the question to somebody else", /different character to ask/i.test(d), d);
  // The directive is deliberately written flat. An instruction phrased as an epigram teaches the
  // narrator an epigram, and the prose comes back sounding like the rules document.
  check("and it is not itself written as an aphorism", !/^.*\b(is the end of|is not a|the turn is about)\b/i.test(d.replace(/\n/g, " ")), d);
  check("an ordinary turn gets nothing", answeredDirective("I follow her down the stairs") === "");
}

/* ── 5. a loop that skips a beat is still a loop ──────────────────────────────── */
{
  // her intents, three beats apart, with a pleased beat in between — pairwise, three different
  // scenes; in fact one question asked three times
  const circling = [
    "She is testing whether he will give her a straight answer about the gladiator.",
    "She is pleased he offered the gold so freely and is warming to him.",
    "She is waiting to see whether he will finally say what the secret actually was.",
  ];
  check("consecutive beats read as different", !repeatedIntent(circling.slice(1)));
  check("but the newest matches the one three beats back", repeatedIntent([circling[0], circling[2]]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
