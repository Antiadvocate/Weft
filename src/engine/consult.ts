/**
 * THE ANSWER IS THE TURN.
 *
 * From a save, Rome 41 AD, turns 1 and 2. The player character is an engineer from 2026 with a
 * phone in his pocket and a local model running on it — the one thing he brought and the only
 * thing in the world that will answer him. He types:
 *
 *   t1  "Hi. I must be in Rome" I take my phone out of my pocket and turn on the local LLM
 *       "I am in Rome... how do I... I don't know survive. I have no money or anything"
 *   t2  I watch the reply from the ai. What does it say?
 *
 * What came back:
 *
 *   t1  The phone's screen brightened in the sun, too dim against the white glare off the river.
 *   t2  The screen lit with the LLM's answer — clean paragraphs of survival advice in a world with
 *       no word for any of it. The glare threw a pale rectangle across the mud.
 *
 * Twice the narration reported that an answer existed and never showed one word of it. The player
 * asked the question in plain English, in the action channel, as the entire content of his turn,
 * and got back a description of a lit screen. What he wrote next was not a third attempt.
 *
 * WHY THE NARRATOR ELIDES IT, WHICH IS THE INTERESTING PART: every force in its context pushes this
 * way, and none of them is wrong on its own.
 *
 *   · THE SETTING'S FACTS ARE FIXED tells it that what it does not have, it does not get to make
 *     up, and to write around the gap instead. The content of the reply is not in any block of the
 *     state, so the honest-looking move is to write around it.
 *   · THE CAMERA REPORTS, IT DOES NOT EXPLAIN restricts every clause to something a person in the
 *     room could point at. A screenful of text is not a body, a hand, or a distance — but the lit
 *     rectangle on the mud is, so the camera photographs the glare and skips the words.
 *   · END ON A PERSON, and the paragraph rule under it, pull the sentence back to the room the
 *     moment it drifts toward a page.
 *
 * So the elision is produced by rules that are individually correct, and no amount of general
 * emphasis on quality will dislodge it. It needs a rule that says the specific thing none of them
 * says: WHEN THE PLAYER READS SOMETHING, THE READING GOES ON THE PAGE.
 *
 * And the carve-out has to be stated, because "the setting's facts are fixed" is the rule doing the
 * most damage here: writing what a source SAYS is not the narration asserting a fact of the world.
 * A source is a thing with an author and a horizon — it was built or written knowing certain things
 * at a certain time, it has never seen this room, and it can be out of date, thin, or flatly wrong.
 * That is precisely why rendering it is safe: the claim has an owner who can be discredited, which
 * is the same arrangement engine/read.ts uses for interpretation. Unowned assertion is the problem;
 * owned assertion is content.
 *
 * ON DETECTING THIS AT ALL. engine/reaction.ts is a long argument against detectors, and it is
 * right: the thing it refused to detect was the MODEL'S prose, where the rules that forbid purple
 * language guarantee a miracle is described flatly and the regex never fires. This detector reads
 * the PLAYER'S typed input, which no rule constrains and which nothing else is competing to phrase
 * differently. "What does it say" is a thing a person types when they want to be told what it says.
 * The directive still carries its own escape hatch in the last line, so a false positive costs a
 * paragraph the narrator can discard rather than a text invented out of nothing.
 */
import type { SaveState } from "./types";

/** Things that answer in words. Not an inventory — the player names the source themselves, and this
 *  only has to recognise the kind of thing it is. */
const SOURCE =
  /\b(?:phone|screen|display|device|app|ai|llm|assistant|chatbot|model|terminal|console|computer|laptop|tablet|watch|reply|replies|response|answer|output|message|inbox|email|letter|note|notes|scroll|codex|book|page|pages|ledger|manifest|receipt|invoice|contract|deed|will|testament|map|chart|sign|placard|poster|notice|inscription|plaque|graffiti|papyrus|parchment|document|papers|dossier|file|report|journal|diary|logbook|newspaper|dispatch|telegram|label|instructions|manual|recipe|prophecy|oracle|omen|omens|entrails|runes|augury|dial|gauge|readout|compass)\b/i;

/** A question about what something SAYS. The verb list is what a person types when they want the
 *  words themselves rather than a report that words arrived. */
const CONTENT_QUESTION =
  /\bwhat(?:'s|s|ever)?\b[^?.!\n]{0,80}?\b(?:say|says|said|read|reads|written|write|show|shows|showed|tell|tells|told|reply|replies|respond|responds|answer|answers|answered)\b/i;

/** The player's hand going to the thing: the act of consulting it. The subject anchor is loose on
 *  purpose — "I take out my phone and ask it" puts five words between the pronoun and the verb, and
 *  that is the sentence the save was actually lost on. What keeps it honest is that the same
 *  sentence must also name a source, and must not be aimed at a person. */
const ACT_OF_READING =
  /\b(?:i|we)\b[^.?!\n]{0,70}?\b(?:re-?read|reread|reads?|check|checked|consult|consulted|open|opened|unfold|unfolded|unroll|unrolled|study|studied|scan|scanned|skim|skimmed|glance|look|looked|peer|examine|examined|search|searched|scroll|swipe|tap|type|typed|ask|asked|query|queried|prompt|prompted|translate|turns? on|switch(?:es)? on|power(?:s)? (?:on|up)|boot|wake|unlock|pull up|bring up|load|launch|use|used)\b/i;

/** The head of a question: "what", however the player spells the contraction. */
const QUESTION_HEAD = /\bwhat(?:'s|s|ever)?\b/i;

/** Whoever the question is aimed at, when it is aimed at a person. A person answering a question is
 *  dialogue, and the whole DIALOGUE spec already governs it. */
const PERSON_TARGET = /\b(?:you|he|she|they|him|her|them|everyone|anybody|anyone|nobody)\b/i;

/** ...and the same for the ask-family, where the object decides it: "I ask her about the letter" is
 *  a conversation that happens to mention a letter. */
const ASKS_A_PERSON = /\b(?:ask|asked|tell|told|question|questioned)\s+(?:the\s+)?(?:you|him|her|them|everyone|anyone|somebody|someone)\b/i;

const strip = (s: string) =>
  String(s ?? "")
    .replace(/\*[^*]*\*/g, " ")        // private thought is still the player reading; keep the act, drop the marks
    .replace(/\(\([^)]*\)\)/g, " ")    // a search directive is not story text
    .replace(/\s+/g, " ")
    .trim();

/**
 * The sentence in which the player reached for a source, or null. Exported so the test can name the
 * exact inputs this fires on and the exact ones it leaves alone.
 */
export function consultTarget(state: SaveState, action: string): string | null {
  const a = strip(action);
  if (!a) return null;

  const names = Object.entries(state.characters)
    .filter(([id]) => id !== "char_player")
    .map(([, c]) => String(c?.name ?? "").split(/\s+/)[0])
    .filter((n) => n.length > 2);
  const namesRe = names.length ? new RegExp(`\\b(?:${names.join("|")})\\b`, "i") : null;

  for (const raw of a.split(/(?<=[.?!])\s+/)) {
    const s = raw.trim();
    if (s.length < 6) continue;

    // (1) a question about what something says — either by the verb ("what does it say") or by
    //     naming the thing ("what's on the screen") — so long as the something is not a person
    const q = s.search(QUESTION_HEAD);
    if (q >= 0 && (CONTENT_QUESTION.test(s) || SOURCE.test(s))) {
      const head = s.slice(0, q + 60);
      const aimedAtPerson = PERSON_TARGET.test(head) || (namesRe?.test(head) ?? false);
      if (!aimedAtPerson) return s.slice(0, 160);
    }

    // (2) the act of consulting a thing that answers in words
    if (ACT_OF_READING.test(s) && SOURCE.test(s) && !ASKS_A_PERSON.test(s)) {
      if (!(namesRe?.test(s) ?? false)) return s.slice(0, 160);
    }
  }
  return null;
}

/**
 * The directive. It states what the source is, what it can know, how much of the turn it gets, and
 * who else hears it — and it ends by handing the narrator a way out, because the cost of firing on
 * a turn where nothing was actually read must be a discarded paragraph and never an invented text.
 */
export function consultDirective(state: SaveState, action: string): string {
  const target = consultTarget(state, action);
  if (!target) return "";
  const others = (state.world.present ?? [])
    .map((id) => state.characters[id]?.name)
    .filter(Boolean) as string[];

  return `\nTHE PLAYER PUT A QUESTION TO SOMETHING THAT ANSWERS IN WORDS: "${target}"
THE WORDS IT GIVES BACK ARE THE SUBSTANCE OF THIS TURN, and they go on the page as words the player reads. Write the sentences the thing actually produces — the advice, the figures, the names, the instruction, the price, the refusal, the nothing-useful. A sentence saying that an answer arrived, that the screen filled, that the page was covered in writing, or that he read what it told him has withheld the one thing the player asked for: replace it with the answer itself. If an earlier turn already said something answered and never gave the words, they are given here.
WORK OUT FIRST WHAT THIS PARTICULAR SOURCE CAN KNOW, then write only from that: when it was made, who made it, what it was built or written knowing, and what it has never had access to. A thing carried in from somewhere else knows what it knew when it left and has never seen this place, these people, this morning, or one price paid here — asked about the world around it, it answers the way anything answers about a place it has only read about: in generalities, out of date, confident, and wrong in places it cannot flag. A letter holds what its writer knew on the day they wrote it. A practice that reads omens says what that practice says.
WHAT IT SAYS IS ITS OWN CLAIM AND NOT A FACT OF THIS WORLD, which is why writing it does not breach the rule against inventing setting detail: it may be thin, mistaken, dangerous, or useless, and the player discovering that is the information. It has no access to the state — it cannot report what a person here wants, who is lying, where anyone is, or what happens next.
HOW MUCH: the words the player reads run a few sentences, under eighty of them, in the plainest form that source produces — no headings, no numbered points — and then the turn returns to the room.${others.length ? `\nWHO ELSE GETS IT: ${others.join(", ")} ${others.length === 1 ? "sees" : "see"} the player consulting the thing and answer${others.length === 1 ? "s" : ""} THAT, out of their own state — none of them takes in a word of what it said unless the player reads it out loud.` : ""}
IF THE PLAYER TOUCHED NOTHING THIS TURN THAT ANSWERS IN WORDS, this paragraph has fired on the wrong turn: ignore it and write the scene. Do not put a text in his hands that was not already there.`;
}
