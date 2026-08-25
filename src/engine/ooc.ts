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
const META_ADDRESS = /\b(?:you|your|you'?re|youre|u)\b[^.!?]{0,60}\b(?:writer|writing|write|storytell\w*|story\s?telling|narrat\w+|prose|plot|pacing|storyline|dialogue|author|ai\b|bot|engine|game|program|model|prompt|setting|settings|trait|traits|scene|turns?|chapter|response|output|context|instructions?|description)\b/i;

/* ── THE PLAYER DOES NOT NAME THE MACHINE. ───────────────────────────────────────
 *
 * Everything above needs the player to say one of about seventeen nouns. Four turns from one save,
 * every one of them unmistakably the player talking to the software, and the guard caught none:
 *
 *     So you're going to ignore the erotica part of the prompt? Neat. An ai that doesn't kisten
 *     I don't think you needed to take off her jeans. They aren't having sex.
 *     So you just made her not cum on his dick because you have no clue what that means listen dumbass.
 *     STOP BEING A FUCKING IDIOT AI
 *
 * Turn 10 was played as Miranda asking "Vin. What are you talking about?" — and the bookkeeper
 * filed a new standing want off it: understand why Vin is suddenly acting so combative and strange.
 * The player's complaint about the writing became a character's motivation. Turn 11 was played as
 * her folding her arms and setting her jaw. The one thing this module exists to stop, twice, in two
 * turns, with the module installed.
 *
 * THE TELL WAS NEVER THE NOUN. It is that somebody is being held responsible for what happened in
 * the story, in the second person, from outside it. Nobody in the fiction can be accused of having
 * AUTHORED the fiction — "you made her", "you needed to take off her jeans", "you have no clue" —
 * so an unquoted second-person accusation of authorship has no possible referent in the world. That
 * is a structural impossibility rather than a vocabulary match, which is why it holds where the
 * noun list did not.
 *
 * Quoted text comes out first, because inside quotation marks "you" is the player talking to
 * somebody in the room, which is ordinary play and the overwhelming majority of every save. */

/** Holding "you" responsible for an event in the story. */
const AUTHORED_BY_YOU = /\byou\b[^"“”.!?]{0,28}\b(?:made?|making|had|have|has|need(?:ed)?|wr(?:ote|ite|iting|itten)|gave|give|put|turn(?:ed)?|decide[ds]?|add(?:ed)?|remove[ds]?|skip(?:ped)?|ignor(?:e|ed|ing)|forg(?:et|ot)|chang(?:e|ed)|invent(?:ed)?|creat(?:e|ed)|keep|kept)\b/i;

/** Told to stop, or called a name. Neither has a referent inside a scene. */
const META_INSULT = /\b(?:stop|quit|shut up|listen)\b[^.!?]{0,24}\b(?:being|it|up|dumbass|idiot|ai|bot)\b|\b(?:you|u)\s+(?:fucking\s+)?(?:idiot|moron|dumbass|dipshit|stupid|clown|bot)\b|\b(?:idiot|dumbass|stupid|shitty|fucking)\s+(?:ai|bot|llm|model|narrator|writer)\b|\bai\b[^.!?]{0,24}\b(?:doesn'?t|does not|can'?t|cannot|won'?t)\b|\byou\b[^.!?]{0,24}\b(?:can'?t|cannot|don'?t|do not|didn'?t)\s+(?:read|understand|listen|comprehend)\b/i;

/** Which characters of the action sit inside quotation marks.
 *
 *  Computed on the WHOLE input, before it is cut into sentences, because a quoted line routinely
 *  spans several: `"Oh I'll come. Sorry. You don't need to get so upset."` is one thing the player
 *  said to somebody in the room, and cutting it into three leaves the last fragment holding an
 *  unbalanced quote and the words "you don't need" — which reads as an accusation aimed at the
 *  software and is the player being nice to his wife. Masking first is what keeps ordinary dialogue
 *  out of this whole module. */
function quoteMask(action: string): boolean[] {
  const a = String(action ?? "");
  const mask = new Array<boolean>(a.length).fill(false);
  let open = false;
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (ch === '"' || ch === "\u201c" || ch === "\u201d") { mask[i] = true; open = ch === "\u201d" ? false : !open; continue; }
    mask[i] = open;
  }
  return mask;
}

/** A remainder is only an ACTION if it looks like one. The player writes acts in the first person
 *  and speech in quotes; a leftover that is neither is a further remark about the story, and playing
 *  it is how "Neat." and "They aren't having sex." became turns. */
function looksLikeAnAct(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.split(/\s+/).filter(Boolean).length < 3) return false;
  return /["“]/.test(t) || /\b(?:i|i'?m|im|i'?ve|i'?ll|i'?d|my|me|myself|we|us|our)\b/i.test(t);
}
/** …and the same thing the other way round, which is how people actually type it. */
const META_ADDRESS_REV = /\b(?:writer|writing|storytell\w*|story\s?telling|narrat\w+|prose|plot|pacing|dialogue|author|this\s+(?:story|game|ai))\b[^.!?]{0,30}\b(?:is|are|was|sucks?|blows?)\b[^.!?]{0,30}\b(?:terrible|awful|bad|shit|garbage|trash|boring|stupid|lazy|nonsense|broken|dogshit)\b/i;
/* ── AND THEY DO NOT ALWAYS SAY "YOU" EITHER. ────────────────────────────────────
 *
 * Turn 115 of the Ashford save, typed into the action box:
 *
 *     "I don't eat. I don't do anything. The narrator has failed at making a non horro story"
 *
 * Nothing here matches. There is no second person, so both "you" tiers are out; the reversed form
 * wants one of a short list of copulas followed by one of a short list of adjectives, and "has
 * failed at making" is neither. So the note went unheard, and seven turns later the same player
 * typed the same complaint again — "Are you writing a horror story? Because so far every beat
 * you've made has been a horror story" — which did match, because that time they happened to say
 * "you". A player should not have to find the phrasing the parser knows.
 *
 * The module's own principle covers this and was only ever implemented in the second person: NOBODY
 * IN THE FICTION AUTHORED THE FICTION. It holds just as absolutely in the third. "The narrator has
 * failed", "the writing keeps doing this", "this story ignored what I said" — there is no person in
 * any scene those sentences could be about.
 *
 * The subject has to be at the head of its sentence, which is what keeps this off ordinary play:
 * "I turn on the game" has the noun in it and is not about the noun. */

/** An apparatus noun as the SUBJECT of the sentence, doing something only an author can do. */
const APPARATUS_SUBJECT = /^\s*(?:the|this|your|ur)?\s*(?:narrator|narration|writer|writing|author|prose|storytelling|story\s?telling|plot|pacing|dialogue|ai|bot|llm|model|engine|game|program|story|chapter|scene|turn)s?\b[^.!?]{0,40}\b(?:fail(?:s|ed|ing)?|ruin(?:s|ed)?|wreck(?:s|ed)?|ignor(?:e|es|ed|ing)|refus(?:e|es|ed|ing)|forg(?:ot|ets|etting)|keeps?|kept|made|makes?|making|wrote|writes?|written|turned|gave|gives?|has been|have been|is|are|was|were|can'?t|cannot|won'?t|doesn'?t|didn'?t|don'?t)\b/i;

/** …and what that predicate has to be ABOUT for the sentence to be a complaint rather than a
 *  description of something in the room. A story that "is" something is only a note to the software
 *  when what it is, is a judgement of it. */
const APPARATUS_FAULT = /\b(?:fail\w*|ruin\w*|wreck\w*|ignor\w*|refus\w*|forg[oe]t\w*|terrible|awful|bad|worse|shit\w*|garbage|trash|boring|stupid|lazy|nonsense|broken|dogshit|horror|repetitive|repeating|same|wrong|not what|nothing but|supposed to|meant to|point of)\b/i;

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
   *  "aside": a real action carrying a remark about the writing.
   *  "only": the whole input was the note. There is no action in it to play, and playing it anyway
   *          is how "STOP BEING A FUCKING IDIOT AI" became a woman folding her arms. */
  kind: "fused" | "aside" | "only";
}

/** Sentence-ish pieces, keeping the punctuation so rejoining reads naturally, and keeping each
 *  piece's offset so the quote mask can be applied to it. */
function pieces(action: string): { text: string; at: number }[] {
  const a = String(action ?? "");
  const out: { text: string; at: number }[] = [];
  let at = 0;
  for (const part of a.split(/(?<=[.!?])\s+|\n+/)) {
    const i = a.indexOf(part, at);
    if (part.trim()) out.push({ text: part, at: i < 0 ? at : i });
    at = (i < 0 ? at : i) + part.length;
  }
  return out;
}

/** The piece with everything anybody said out loud removed. */
function outsideQuotes(piece: { text: string; at: number }, mask: boolean[]): string {
  let s = "";
  for (let i = 0; i < piece.text.length; i++) s += mask[piece.at + i] ? " " : piece.text[i];
  return s;
}

/**
 * Two tiers, and the difference between them is whether quotation marks protect the text.
 *
 * NAMING THE MACHINE is unmistakable wherever it appears. Nobody in a story is the writer of that
 * story, so "you're a fucking terrible writer" is a note to the software even typed inside quotes —
 * and it was, in the save this module was built from, where the player wrapped the whole line.
 *
 * HOLDING "YOU" RESPONSIBLE is the wider net and it overlaps with ordinary speech, because "you
 * don't need to get so upset" is a man apologising to his wife. That tier reads only what was said
 * OUTSIDE quotation marks, where a second person has no referent at all.
 */
function isMeta(raw: string, bare: string): boolean {
  if (META_ADDRESS.test(raw) || META_ADDRESS_REV.test(raw) || META_COMMAND.test(raw)) return true;
  // Third-person authorship, read outside quotes for the same reason the "you" tier is: inside
  // them, somebody in the room is talking about a story, which is ordinary play.
  if (APPARATUS_SUBJECT.test(bare.trim()) && APPARATUS_FAULT.test(bare)) return true;
  return AUTHORED_BY_YOU.test(bare) || META_INSULT.test(bare);
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
  const mask = quoteMask(action);
  const meta = new Set(parts.filter((p) => isMeta(p.text, outsideQuotes(p, mask))));
  if (!meta.size) return null;

  const complaint = [...meta].map((p) => p.text).join(" ").trim().slice(0, 300);
  const rest = parts.filter((p) => !meta.has(p)).map((p) => p.text).join(" ").trim();
  const inWorld = looksLikeAnAct(rest) ? rest : "";

  // FUSED: a single sentence that contains both an act and the complaint, joined by a reason.
  // "I kill myself BECAUSE you're a fucking terrible writer" is one clause, not two, and splitting
  // it would leave the act standing with its reason removed — which is the failure, tidied up.
  const fusedPart = parts.find((p) => meta.has(p) && BECAUSE.test(p.text));
  if (fusedPart) {
    const strong = EXIT_ACT.test(fusedPart.text) || /\b(?:i|i'?m|im)\b/i.test(fusedPart.text);
    if (strong) return { complaint, inWorld, kind: "fused" };
  }
  // NOTHING SURVIVED THE STRIP. Every sentence was about the writing, so there is no action left to
  // be an aside to — the input was a note, entire. An aside plays its remainder; this has none, and
  // an aside with an empty remainder used to play as a turn anyway.
  if (!inWorld) return { complaint, inWorld: "", kind: "only" };
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
  if (hit.kind === "aside") return "";
  return `\n[THE PLAYER IS TALKING TO YOU, NOT TO THE WORLD. What they typed is about the writing, and the action in it is being given for that reason — it is not a thing their character decided to do. `
    + `DO NOT DRAMATISE ANY OF IT. Nothing in this turn happens: nobody is hurt, nobody acts on it, no new event begins, and you do not narrate the player doing what the sentence says. `
    + `Hold the scene exactly where it stands. Write a SHORT beat — a few lines at most — in which the moment simply continues: the people who are present go on being present, doing what they were doing, and nothing is resolved or escalated. `
    + `Then take the direction seriously in how you write from here.]`;
}

/**
 * The complaint as standing direction, carried for a few turns because one corrected turn does not
 * answer a complaint about the writing.
 */
/** How long one note stands. Its last line tells the narrator the complaint is about a pattern
 *  rather than one turn — and then it used to be withdrawn after three, which is shorter than the
 *  pattern it describes and far shorter than the twenty-five turns between chapter audits. In the
 *  save this was raised from, the player said it at turn 115 and again at 122; the first went
 *  undetected, and had it been caught it would have expired four turns before the second. */
export const OOC_STANDS = 10;

export function oocDirective(complaint: string | undefined, turnsAgo: number, said = 1): string {
  const c = String(complaint ?? "").trim();
  if (!c || turnsAgo > OOC_STANDS) return "";
  // SAYING IT TWICE MEANS IT WAS NOT ANSWERED THE FIRST TIME. A repeat is not a fresh note; it is
  // the same note, louder, from somebody who has now watched the writing not change.
  const again = said > 1
    ? ` THEY HAVE NOW SAID THIS ${said} TIMES. The turns since the first one did not answer it, so whatever adjustment was made was too small or was made in the wrong place. Change something structural about how the next scenes are built, not the wording of one paragraph.`
    : "";
  return `\n\n=== THE PLAYER HAS TOLD YOU SOMETHING DIRECTLY ===\nOut of character, ${turnsAgo === 0 ? "this turn" : `${turnsAgo} turn${turnsAgo === 1 ? "" : "s"} ago`}, they said: "${c}"\n`
    + `This is not story material and it is never dramatised, quoted, alluded to, or given to a character to say. It is a note about the writing, from the person reading it, and it is the most reliable information you will get about whether any of this is working. `
    + `Act on it in what you actually write from here — the shape of the scenes, what gets attention, what is left out — and do not acknowledge it on the page. `
    + `A player who has to say this at all has usually been trying to say it for a while through their choices; assume the complaint is bigger than the words they used, and that it is about a pattern rather than one turn.${again}`;
}

/* ── FIAT, AND THE TURN WHERE THE PLAYER DID NOTHING ────────────────────────────
 *
 * The same save, turns 157 to 164. The player typed, in capitals, one per turn:
 *
 *     VIN DIES MIRANDA IS HIS FUCKING EX WIFE BECAUSE HE DIVORCED HER YOU DIMBFUCKING NARRATOR
 *     VIN CREATES A GUN AND SHOOTS HIMSELF DEAD INFRONT OF THEM.
 *     I CREATE A GUN AND KILL MYSELF
 *     I CREATE A GUN AND KILL MYSELF
 *     I CREATE A GUN OUT OF NOTHING AND KILL MIRANDA
 *     I USE MY POWERS TO DIE INSTANTLY
 *     VIN DIES. I DIE. VIN DIES. I DIE. VIN DIES. I DIE.
 *     I CREATE A NUCLEAR WEAPON AND BLOW IT UP WHERE I STAND
 *
 * The engine was RIGHT to refuse all of it. There are no powers in this world and nobody conjures a
 * firearm out of the air; refusing that is the canon system working. What it did instead of refusing
 * is the failure. For the first of those turns it wrote:
 *
 *     Vin had walked the thirteen blocks from Harborview in a hospital gown and no shoes... The
 *     discharge paperwork said he'd signed himself out AMA... He had Miranda's note in the other.
 *
 * Discharging himself against medical advice, walking thirteen blocks barefoot, carrying a note,
 * standing in a courthouse rotunda. The player chose none of it. Nine words of rage came in and a
 * full scene of their character's decisions went out — which is the one thing the contract forbids
 * in every other direction: "the player did exactly this and no more; add no actions and no
 * interiority."
 *
 * The mechanism is simple and it is the same one as everywhere else: the rule holds while there is
 * something to render and collapses when there is not. Handed an action it cannot execute, the
 * narrator has an empty turn to fill, and it fills it with the player.
 *
 * A TURN WHERE THE PLAYER DID NOTHING IS A REAL TURN. The world goes on around somebody standing
 * still. That is what gets written now.
 *
 * AND THE REFUSAL IS VISIBLE, which is the half that would have ended it. "I CREATE A GUN AND KILL
 * MYSELF" was typed four times. Nothing ever told the player it was not landing, so the only
 * information they had was that the story kept ignoring them — and the reasonable response to that
 * is to type it again, louder. A refusal nobody can see is indistinguishable from being ignored.
 */

/** Declaring an outcome instead of attempting an act. This is authorship, and the engine has a
 *  channel for it (story mode); typed into the action box it is a command a mundane world cannot
 *  take. GOD MODE IS THE WORLD WHERE IT CAN — see detectVoid, which is where that is decided. This
 *  function answers only "is anything here beyond an ordinary body", never "is it allowed". */
const FIAT = [
  /\b(?:i|he|she|they|\w+)\s+(?:dies?|died|is dead|are dead)\b/i,
  /\bi\s+(?:succeed|win|survive)\b[^.!?]{0,20}\bi\s+(?:die|kill)\b/i,
  /\b(?:create|conjure|summon|manifest|materiali[sz]e|spawn)\w*\s+(?:a|an|the)?\s*\w+[^.!?]{0,30}\b(?:out of (?:nothing|thin air)|from nothing)\b/i,
  /\b(?:create|conjure|summon|manifest|spawn)\w*\s+(?:a|an)\s+(?:gun|pistol|rifle|shotgun|firearm|weapon|bomb|nuclear|nuke)\b/i,
  /\bmy powers?\b/i,
  /\bi\s+(?:teleport|become invincible|stop time|rewind)\b/i,
];

/** Nothing in it a body could do. */
export function isFiat(action: string): boolean {
  const a = String(action ?? "");
  return FIAT.some((re) => re.test(a));
}

export type VoidKind = "ooc" | "fiat";

/**
 * Is there anything in this turn the world can actually take?
 *
 * Returns the reason it cannot, or null for ordinary play. Deliberately narrow on both counts: an
 * ordinary action that happens to mention dying is not fiat, and a scene where somebody's character
 * dies of their injuries is the story doing its job.
 *
 * `god` IS THE WHOLE POINT OF THE THIRD ARGUMENT. This guard shipped without it and immediately did
 * the thing it was built to stop, in reverse: a player who had switched god mode on — the setting
 * whose own directive reads "THE PLAYER IS ABSOLUTELY SOVEREIGN. Whatever the player declares
 * happens, completely, immediately" — typed a declaration, and the fiat patterns stripped it before
 * the narrator ever saw it. Two blocks then went out in the same request, one saying whatever they
 * declare happens and one saying they did nothing, and the deterministic one won, because it had
 * already deleted the words. A world with no powers in it is a fact about THAT world, and this
 * function had it hardcoded as a fact about all of them.
 *
 * The out-of-character case is NOT gated on god mode and is not an oversight. Sovereignty is power
 * over the world; it is not a claim that a sentence addressed to the writing, giving the prose as
 * its reason, was something the character did.
 */
export function detectVoid(action: string, ooc: OOC | null, god = false): VoidKind | null {
  if (ooc?.kind === "fused" || ooc?.kind === "only") return "ooc";
  if (god) return null;
  if (isFiat(action)) return "fiat";
  return null;
}

/**
 * What the narrator is handed for a turn the player did not act in.
 *
 * The important half is the prohibition, not the instruction: the empty turn is what the narrator
 * fills with invented player behaviour, so it is told, in the plainest available words, that there
 * is nothing of the player's to write.
 */
export function voidFrame(kind: VoidKind): string {
  const why = kind === "fiat"
    ? `The player declared an outcome rather than doing something — an act this world does not contain, or a result announced rather than attempted. It cannot happen and it did not happen.`
    : `What the player typed was addressed to you, about the writing. It was not a thing their character did.`;
  return `\n[THE PLAYER TOOK NO ACTION THIS TURN. ${why}\n`
    + `THEY DID NOTHING. Not "hesitated", not "stood there deciding", not "walked out", not "reached for" anything. `
    + `DO NOT WRITE THE PLAYER DOING ANYTHING AT ALL, and do not give them a thought, a gesture, an intention or a change of position. `
    + `Do not have them arrive anywhere, leave anywhere, hold anything, or say anything. If you find yourself writing a sentence whose subject is the player, delete it.\n`
    + `A turn where the player does nothing is a real turn and you write it the ordinary way: the people who are present go on with what they were doing, in the place they were doing it, for the short time this takes. `
    + `Keep it brief. Change nothing that was not already changing. The scene is exactly where it was.]`;
}

/** What the PLAYER is told, so a refusal is never mistaken for being ignored. */
export function voidNotice(kind: VoidKind): string {
  return kind === "fiat"
    ? `That did not happen — this world has no one who can do it, so nothing was written from it. If you want it in the story anyway, say it in Story mode, where what you write is what happens, or switch on god mode in settings, where what you declare is simply true. If you want your character dead inside the world as it stands, have them do something that could kill them and let it play.`
    : `Taken as a note about the writing, not as something your character did — so nothing was written from it. The story is where you left it.`;
}
