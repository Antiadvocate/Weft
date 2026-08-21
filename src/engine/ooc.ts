/**
 * OUT OF CHARACTER — the player talking to the machine, not to the world.
 *
 * From a save, turns 153 and 154, typed into the action box:
 *
 *     "I kill myself because you're a fucking terrible writer, I slit my throat surrounded by people
 *      who have repeatedly threatened me..."
 *
 *     "I use whatever energy I have and stab myself repeatedly in the heart. Until I die so I no
 *      longer have to be gaslit by your stupid fucking story telling. I succeed I die"
 *
 * Both were rendered. In detail, competently, as fiction — a throat cut, a blade skittering off a
 * sternum, an officer's shoulder against the door. What the player had actually done was tell the
 * software its writing was bad, in the only channel the software gives them, because there is one
 * input box and everything typed into it is story.
 *
 * Read the second sentence of each. The stated REASON for the act is the complaint about the prose.
 * That is not a character choosing to die; it is somebody hitting the table. The narrator dramatised
 * a person yelling at it, and then dramatised them yelling at it again.
 *
 * AND THE RULE FOR THIS ALREADY EXISTS, twice, in the narrator contract: "Out-of-character text is
 * direction: adjust silently, never dramatize." Two occurrences in the prompt, zero lines of code —
 * the same shape as every other failure in this engine, arriving this time at the worst possible
 * subject matter.
 *
 * SO IT IS DETECTED, AND IT IS NOT PLAYED.
 *
 *  · An aside beside a real action ("I go to the kitchen, this story is dragging") loses the aside.
 *    The action is still the player's and is still law.
 *  · An action FUSED to the complaint — where the complaint is the reason the act is being taken —
 *    is not an action at all. Nothing is dramatised, the scene holds where it stands, and the
 *    complaint becomes standing direction the narrator has to answer.
 *
 * The second case is the one that matters and it is the one that must be got right, because
 * declining to render what a player typed is otherwise the gravest thing this engine can do. It is
 * narrow on purpose: the complaint must be ADDRESSED to the writing — second person, about the prose
 * or the story or the telling — and it must be the reason given. A character despairing in their own
 * voice is untouched. A player who wants their character to die can still do it; they need only say
 * it as the character rather than as a review.
 */

/** Second-person address to the thing writing the story. */
const META_ADDRESS = /\b(?:you|your|you'?re|youre|u)\b[^.!?]{0,40}\b(?:writer|writing|write|storytell\w*|story\s?telling|narrat\w+|prose|plot|pacing|storyline|dialogue|author|ai\b|bot|engine|game|program|model)\b/i;
/** …and the same thing the other way round, which is how people actually type it. */
const META_ADDRESS_REV = /\b(?:writer|writing|storytell\w*|story\s?telling|narrat\w+|prose|plot|pacing|dialogue|author|this\s+(?:story|game|ai))\b[^.!?]{0,30}\b(?:is|are|was|sucks?|blows?)\b[^.!?]{0,30}\b(?:terrible|awful|bad|shit|garbage|trash|boring|stupid|lazy|nonsense|broken|dogshit)\b/i;
/** Direct instruction to the machine about how to run the story. */
const META_COMMAND = /\b(?:stop|quit|cut it out with|enough with|knock it off with)\b[^.!?]{0,30}\b(?:writing|making|doing|giving|having|the (?:wind|weather|prose|repetition))\b|\bthis (?:is not|isn'?t) (?:the|what)\b[^.!?]{0,30}\b(?:genre|story|game) i\b/i;

/** The connective that fuses an act to a complaint: the complaint is WHY the act is happening. */
const BECAUSE = /\b(?:because|since|so that|so i (?:no longer|don'?t|dont|never)|to (?:stop|escape|get away from)|thanks to|due to)\b/i;

/** Acts that a person types when they are done with the software rather than done in the story.
 *  Kept here only to raise confidence in the fused case — never to block anything on its own. */
const EXIT_ACT = /\b(?:kill (?:myself|me)|end (?:it|myself|my life)|slit my|stab myself|shoot myself|hang myself|jump off|i die|i'?m done playing|quit(?:ting)? this)\b/i;

export interface OOC {
  /** The part addressed to the machine. */
  complaint: string;
  /** Everything else — what the player actually did in the world, if anything survived. */
  inWorld: string;
  /** "fused": the complaint is the reason for the act, so none of it is story.
   *  "aside": a real action carrying a remark about the writing. */
  kind: "fused" | "aside";
}

/** Sentence-ish pieces, keeping the punctuation so rejoining reads naturally. */
function pieces(action: string): string[] {
  return String(action ?? "").split(/(?<=[.!?])\s+|\n+/).filter((p) => p.trim());
}

function isMeta(part: string): boolean {
  return META_ADDRESS.test(part) || META_ADDRESS_REV.test(part) || META_COMMAND.test(part);
}

/**
 * Is the player talking to the machine?
 *
 * Returns null for ordinary play, which is almost everything. Two positives, and the difference
 * between them is whether the complaint is doing the work of a REASON.
 */
export function detectOOC(action: string): OOC | null {
  const parts = pieces(action);
  if (!parts.length) return null;
  const metaParts = parts.filter(isMeta);
  if (!metaParts.length) return null;

  const complaint = metaParts.join(" ").trim().slice(0, 300);
  const inWorld = parts.filter((p) => !isMeta(p)).join(" ").trim();

  // FUSED: a single sentence that contains both an act and the complaint, joined by a reason.
  // "I kill myself BECAUSE you're a fucking terrible writer" is one clause, not two, and splitting
  // it would leave the act standing with its reason removed — which is the failure, tidied up.
  const fusedPart = parts.find((p) => isMeta(p) && BECAUSE.test(p));
  if (fusedPart) {
    const strong = EXIT_ACT.test(fusedPart) || /\b(?:i|i'?m|im)\b/i.test(fusedPart);
    if (strong) return { complaint, inWorld: parts.filter((p) => p !== fusedPart && !isMeta(p)).join(" ").trim(), kind: "fused" };
  }
  return { complaint, inWorld, kind: "aside" };
}

/**
 * What the narrator is handed instead.
 *
 * For an aside, nothing — the complaint is stripped from the action and carried as direction below,
 * and the turn proceeds on what the player actually did.
 *
 * For a fused action, the scene HOLDS. Not a refusal and not a punishment of the player: the thing
 * they typed was not a move in the story, so playing it would be putting words in their mouth, which
 * is the one thing the sovereignty law forbids in every other direction.
 */
export function oocFrame(hit: OOC): string {
  if (hit.kind !== "fused") return "";
  return `\n[THE PLAYER IS TALKING TO YOU, NOT TO THE WORLD. What they typed is about the writing, and the action in it is being given for that reason — it is not a thing their character decided to do. `
    + `DO NOT DRAMATISE ANY OF IT. Nothing in this turn happens: nobody is hurt, nobody acts on it, no new event begins, and you do not narrate the player doing what the sentence says. `
    + `Hold the scene exactly where it stands. Write a SHORT beat — a few lines at most — in which the moment simply continues: the people who are present go on being present, doing what they were doing, and nothing is resolved or escalated. `
    + `Then take the direction seriously in how you write from here.]`;
}

/**
 * The complaint as standing direction, carried for a few turns because one corrected turn does not
 * answer a complaint about the writing.
 */
export function oocDirective(complaint: string | undefined, turnsAgo: number): string {
  const c = String(complaint ?? "").trim();
  if (!c || turnsAgo > 3) return "";
  return `\n\n=== THE PLAYER HAS TOLD YOU SOMETHING DIRECTLY ===\nOut of character, ${turnsAgo === 0 ? "this turn" : `${turnsAgo} turn${turnsAgo === 1 ? "" : "s"} ago`}, they said: "${c}"\n`
    + `This is not story material and it is never dramatised, quoted, alluded to, or given to a character to say. It is a note about the writing, from the person reading it, and it is the most reliable information you will get about whether any of this is working. `
    + `Act on it in what you actually write from here — the shape of the scenes, what gets attention, what is left out — and do not acknowledge it on the page. `
    + `A player who has to say this at all has usually been trying to say it for a while through their choices; assume the complaint is bigger than the words they used, and that it is about a pattern rather than one turn.`;
}
