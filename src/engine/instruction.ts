/**
 * AN INSTRUCTION ABOUT THE STORY, TYPED WHERE THE STORY GOES.
 *
 * Rainier Valley, chapter two, turn 14, typed into the action box:
 *
 *     Rabi's not the point of contact. Ellie is. Change the story to adjust. Remove beacon works
 *     from Rabi and anything having to do with it should no longer appear in the story.
 *
 * That isn't anything Rabi does. It went in as his action, the out-of-character guard didn't fire
 * (it looks for the player complaining about the writing, and this complains about nothing), and
 * the turn played as Rabi standing in a towel reading his email while a coworker let herself in.
 *
 * The engine has the tools for what was asked: a correction (a fact that is true from now on) and a
 * nuke (a storyline wiped from everything the models read). Nothing pointed the request at them.
 * This reads the action for the shape of an instruction about the story, and the Play view offers
 * those tools before sending anything, with "play it as an action anyway" one tap away.
 *
 * Narrow on purpose: it needs the story, the plot or the game to be the object of the sentence, or
 * an order to remove something from it. Quoted speech is ignored, because a character can say
 * anything.
 */

export interface StoryInstruction {
  /** The sentence that gave it away. */
  line: string;
  /** What to wipe, when it asked for something to be removed. */
  terms: string;
  /** What it asserted as true alongside, which can go in as a correction. */
  correction: string;
}

const OBJECT = String.raw`(?:the|this|my|our) (?:story|plot|storyline|story ?line|game|narrative|world|chapter|campaign)`;
const INSTRUCTION = new RegExp([
  String.raw`\b(?:change|rewrite|adjust|edit|fix|update|retcon|alter) ${OBJECT}\b`,
  String.raw`\bremove\b[^.!?]{1,80}\bfrom ${OBJECT}\b`,
  String.raw`\b(?:should|must|will|is to|needs? to|has to) (?:no longer|not|never) (?:appear|be mentioned|come up|exist|show up|be (?:in|part of))(?: in| from)? ${OBJECT}\b`,
  String.raw`\b(?:no longer|never again) (?:appear|be mentioned|come up|show up) in ${OBJECT}\b`,
  String.raw`\b(?:delete|erase|wipe|purge|nuke|cut)\b[^.!?]{1,60}\b(?:storyline|story ?line|plot ?line|subplot|plot thread)\b`,
  String.raw`\b(?:delete|erase|wipe|purge|nuke|cut|remove)\b[^.!?]{1,60}\b(?:out of|from) ${OBJECT}\b`,
  String.raw`^\s*\(?\s*(?:ooc|out of character|note to (?:the )?(?:narrator|ai|game|story))\b`,
].join("|"), "i");

const REMOVE_WHAT = /\b(?:remove|delete|erase|wipe|purge|nuke|cut|drop|get rid of)\s+(?:all\s+|any\s+|every\s+)?(?:(?:of\s+)?(?:the\s+)?(?:mentions?|references?|traces?)\s+(?:of|to)\s+)?(?:everything|anything)?\s*(?:(?:about|to do with|related to|having to do with)\s+)?(.{2,60}?)(?=\s+(?:from|out of|entirely|completely|altogether|and\b|so\b|because\b)|[.,;!?]|$)/i;

/** Read the action. Null when it reads like play. */
export function storyInstruction(action: string): StoryInstruction | null {
  const text = String(action ?? "").replace(/["“][^"”]*["”]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const hits = sentences.filter((s) => INSTRUCTION.test(s));
  if (!hits.length) return null;
  let terms = "";
  for (const s of hits) {
    const m = s.match(REMOVE_WHAT);
    const what = m?.[1]?.replace(/^(?:the|all|any)\s+/i, "").replace(/\s+(?:storyline|story ?line|plot ?line|subplot|plot thread|plot)$/i, "").trim();
    if (what && what.length >= 3 && !/^(?:it|this|that|them|everything|anything)$/i.test(what)) { terms = what; break; }
  }
  // Short statements of fact around the instruction ("Rabi's not the point of contact. Ellie is.")
  // are what the player says is true; they can go in as a correction.
  const facts = sentences.filter((s) => !INSTRUCTION.test(s) && !/^(?:change|rewrite|adjust|remove|delete|make|please|fix)\b/i.test(s) && s.split(/\s+/).length <= 20);
  return { line: hits[0].slice(0, 240), terms, correction: facts.join(" ").slice(0, 300) };
}
