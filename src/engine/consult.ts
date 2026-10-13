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
 * language guarantee a miracle is described flatly and the regex never fires. This one read the
 * PLAYER'S typed input, with a list of sources, a list of question shapes, a list of reading verbs
 * and a list of pronouns to tell a person from a page, and the lists kept missing phrasings. The
 * turn's read (engine/actionread.ts, `consults`) now says what the player reads or asks, and what
 * they want from it. The directive still carries its own escape hatch in the last line, so a wrong
 * firing costs a paragraph the narrator can discard rather than a text invented out of nothing.
 */
import type { SaveState } from "./types";
import { clipText, collapseSpaces } from "./text";
import { turnRead } from "./actionread";

/** Whether the source the read names is one of the people the story knows. A person answering a
 *  question is dialogue, and the whole DIALOGUE spec already governs it: "I ask her about the
 *  letter" is a conversation that happens to mention a letter. */
function isPerson(state: SaveState, source: string): boolean {
  const s = collapseSpaces(source).toLowerCase();
  if (state.characters?.[source.trim()]) return true;
  return Object.values(state.characters ?? {}).some((c) => {
    const name = collapseSpaces(c?.name ?? "").toLowerCase();
    if (!name) return false;
    return s === name || s === name.split(" ")[0] || (c.aliases ?? []).some((a) => collapseSpaces(a).toLowerCase() === s);
  });
}

/**
 * What the player reached for, and what they asked it, or null. Exported so the test can name the
 * exact reads this fires on and the exact ones it leaves alone. The typed line isn't read here; the
 * turn's read is, and `action` stays only for the call sites.
 */
export function consultTarget(state: SaveState, _action?: string): string | null {
  const { source, question } = turnRead(state).consults;
  const src = collapseSpaces(source), q = collapseSpaces(question);
  if (!src || isPerson(state, src)) return null;
  return clipText(q ? `${src}: ${q}` : src, 220);
}

/**
 * The directive. It states what the source is, what it can know, how much of the turn it gets, and
 * who else hears it — and it ends by handing the narrator a way out, because the cost of firing on
 * a turn where nothing was actually read must be a discarded paragraph and never an invented text.
 */
export function consultDirective(state: SaveState, _action?: string): string {
  const target = consultTarget(state);
  if (!target) return "";
  const others = (state.world.present ?? [])
    .map((id) => state.characters[id]?.name)
    .filter(Boolean) as string[];

  return `\nTHE PLAYER ASKED A QUESTION OF SOMETHING THAT ANSWERS IN WORDS: "${target}"
The words it gives back are the main thing in this turn, and they go on the page as words the player reads. Write the sentences the thing actually produces, whether that's advice, figures, names, instructions, a price, a refusal, or nothing useful. A sentence saying that an answer came, that the screen filled up, that the page was covered in writing, or that he read what it told him gives the player nothing, so put the answer itself there instead. If an earlier turn said something answered but never gave the words, give them here.
First work out what this particular source could know, and then write only from that: when it was made, who made it, what it was built or written knowing, and what it has never had access to. Something brought here from somewhere else knows what it knew when it left, and nothing about this place, these people or this morning. If it's asked about the world around it, it answers the way anything answers about a place it has only read about: in general terms, out of date, confident, and wrong in ways it can't point out. A letter holds what its writer knew on the day they wrote it. A way of reading omens says what that tradition says.
What it says is only that source's claim, so writing it doesn't break the rule against inventing details about the setting. It can be thin, mistaken, dangerous or useless, and the player finds that out by reading it. It has no access to the record, so it can't report what someone here wants, who is lying, where anyone is, or what will happen next.
Keep the words the player reads to a few sentences, under eighty words, in the plainest form that source would produce, with no headings or numbered points, and then the turn goes back to the room.${others.length ? `\nWHO ELSE NOTICES: ${others.join(", ")} ${others.length === 1 ? "sees" : "see"} the player consulting the thing and ${others.length === 1 ? "reacts" : "react"} to that, out of their own state. None of them takes in a word of what it said unless the player reads it out loud.` : ""}
If the player didn't touch anything this turn that answers in words, this paragraph has come up on the wrong turn, so ignore it and write the scene. Don't put a text in his hands that wasn't already there.`;
}
