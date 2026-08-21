/**
 * SEVERANCE — ending a bond is an ATTEMPT, not an announcement.
 *
 * From a save, turn 101. The player, to his wife: "I'm going to fill these docs out. Please sign."
 *
 *     "Sign." She said it to the form. "You want me to sign."
 *     Her thumb creased the corner of the page. She pressed it flat.
 *     "Okay."
 *     She picked up the pen and wrote her name on the line.
 *
 * A marriage ended on the first ask, in one word. The player's account of why that is wrong is the
 * only calibration this module needs: "You know how much I argued with my ex wife when she filed for
 * divorce? Do you think it was a single line?"
 *
 * AND THE ENGINE HAD THE ANSWER WRITTEN DOWN. Her card at that exact moment:
 *
 *     attachment    anxious
 *     under_threat  "Becomes hyper-vigilant and controlling, trying to manage the environment and
 *                    the people in it to prevent a perceived attack. She'll pick at a flaw in a plan
 *                    or a person relentlessly."
 *     states        ["fixated on Vin" — thirty-four turns old, "replaying it"]
 *     repairing     8   toward the player
 *     conscience    0.8
 *
 * An anxious woman, fixated on him for thirty-four turns, in the middle of a repair loop she cannot
 * stop, whose documented response to threat is to pick relentlessly — said okay and signed. Every
 * field contradicted the scene and none of them was load-bearing, because nothing in the engine
 * treats "I am ending this" as a thing that has to get PAST somebody.
 *
 * The rules were there, as usual. "Requests meet realistic resistance; no instant agreement." "An
 * instant uncomplicated yes from a character with an agenda is a rendering failure." At the highest
 * stakes in the story, both were ignored, because they are prose guidance and this is a plot event.
 *
 * SO IT IS RESOLVED BEFORE THE PROSE, the way attempt.ts resolves a stakes-bearing physical action:
 * the verdict is computed from state and handed to the narrator as law, and the narrator renders the
 * verdict rather than deciding it. What it computes is STAKE — what this person actually has in the
 * bond — and stake buys ROUNDS. A bond nobody was invested in ends when somebody says so. A marriage
 * of thirty-eight remembered scenes does not end because a sentence was said once, and a person who
 * is told it is over does not answer in one syllable; they argue the facts, they bargain, they get
 * furious, they go for the throat, they beg, and which of those they do is on their card already.
 *
 * This does not stop the player leaving. Nothing here can veto a severance and nothing here should:
 * the player's acts are law. What it says is that ending it TAKES the scenes it would really take,
 * and that the person losing it behaves like a person losing it.
 */
import type { SaveState } from "./types";

/** The player saying this is over. Deliberately narrow — a threat made in an argument is not this,
 *  and neither is talking about somebody else's marriage. It has to be addressed, and final. */
const SEVER = [
  /\b(?:i'?m|i am|we'?re|we are)\s+done\s+(?:with\s+)?(?:this|us|our|the)?\s*(?:marriage|relationship|thing)?\b/i,
  /\b(?:i want|i'?m getting|i'?m filing for|let'?s get)\s+a?\s*divorce\b/i,
  /\bdivorce\s+(?:papers?|forms?|docs?|documents?)\b/i,
  /\b(?:i'?m|i am)\s+(?:leaving|ending)\s+(?:you|this|us|our\s+\w+|the\s+marriage)\b/i,
  /\b(?:i'?m|i am)\s+ending\s+(?:our|this|the)\s+(?:friendship|marriage|relationship)\b/i,
  /\b(?:it'?s|this is|we'?re)\s+over\b/i,
  /\b(?:i want|i'?d like)\s+(?:to\s+)?(?:separate|split up|break up)\b/i,
  /\bbreak(?:ing)?\s+up\s+with\s+you\b/i,
  /\bwe'?re\s+finished\b/i,
];

/** THE LINE FROM THE SAVE DID NOT MATCH ANY OF THE ABOVE, and it is the one that matters:
 *  "I'm going to fill these docs out. Please sign." No "divorce", no object after the verb — the
 *  papers had been named two turns earlier and by now they are just "these docs". Asking somebody to
 *  sign is only an ending when there is a document in play, so it is matched as a pair. */
const SIGNING = /\b(?:sign|signature)\b/i;
const PAPERWORK = /\b(?:divorce|separation|dissolution|custody|settlement)\b|\b(?:these|the|those|them)\s+(?:docs?|papers?|forms?|documents?)\b|\b(?:docs?|papers?|forms?|documents?)\s+(?:out|in|over)\b/i;

/** …and the ways people say the same words without meaning them as an ending. */
const NOT_FINAL = /\b(?:if you|unless you|do you want|are we|is (?:this|it)|would (?:it|that) be|thinking about|wondering (?:if|whether)|what if|almost|nearly|felt like)\b/i;

export function detectSeverance(action: string): boolean {
  const a = String(action ?? "");
  if (!a.trim()) return false;
  if (SIGNING.test(a) && PAPERWORK.test(a) && !NOT_FINAL.test(a)) return true;
  return SEVER.some((re) => {
    const m = re.exec(a);
    if (!m) return false;
    // the clause it appeared in, so a conditional or a question does not read as a verdict
    const start = a.lastIndexOf(".", m.index) + 1;
    const clause = a.slice(start, m.index + m[0].length + 30);
    return !NOT_FINAL.test(clause);
  });
}

/**
 * HOLDING THE LINE, once it is already open.
 *
 * Opening a severance needs the strict test above, because mistaking an argument for an ending is
 * the expensive error. CONTINUING one does not: the context is established, both people know what
 * is being discussed, and a person who has said it once says it the second time in three words —
 * "Sign them." "I meant it." "No." Requiring the full form again meant the rounds stopped advancing
 * and the ending could never complete, which is the opposite failure and just as bad.
 */
const HOLDING = /\b(?:sign|signing|signature|done|over|final|finished|goodbye|i mean it|i meant it|i meant that|not changing my mind|nothing (?:more )?to (?:say|discuss)|it'?s decided|made up my mind|stand by (?:it|that))\b|^\s*"?no[.,!]/i;
/** …and the ways somebody takes it back, which close a severance instead of advancing it. */
const RETRACTING = /\b(?:i didn'?t mean|take (?:it|that) back|i'?m sorry[, ]|forget (?:it|i said)|can we|let'?s (?:try|talk)|stay|don'?t go|i love you|come back|wait)\b/i;

export function continuesSeverance(action: string): "hold" | "retract" | null {
  const a = String(action ?? "");
  if (!a.trim()) return null;
  if (RETRACTING.test(a)) return "retract";
  if (detectSeverance(a) || HOLDING.test(a)) return "hold";
  return null;
}

/**
 * What this person has in it, 0..1.
 *
 * Not their current warmth — a bond is not worth less because the last week was bad, and by the time
 * anybody says these words the numbers are always ugly. What makes it cost is INVESTMENT: how much
 * of their life is filed under this person, whether the world calls them a spouse, whether they are
 * still reaching for them, and how long they have been doing it.
 */
export function stakeOf(state: SaveState, id: string, toward: string): number {
  const e = state.world.edges.find((x) => x.from === id && x.to === toward);
  const cond = state.condition[id];
  const p = cond?.psyche;
  let stake = 0;

  // a life's worth of scenes with this person
  const mem = state.memory?.[id];
  const shared = (mem?.episodic ?? []).filter((m) => (m.content ?? "").toLowerCase().includes(
    (state.characters[toward]?.name ?? "").split(/\s+/)[0].toLowerCase())).length;
  stake += Math.min(0.3, shared * 0.012);

  // what the world calls them. A role is a fact and it outlives a bad month.
  const roles = (e?.roles ?? []).map((r) => String(r).toLowerCase());
  if (roles.some((r) => /husband|wife|spouse|partner|married/.test(r))) stake += 0.35;
  else if (roles.some((r) => /lover|boyfriend|girlfriend|fiancé|fiancee|betrothed/.test(r))) stake += 0.22;
  else if (roles.some((r) => /friend|brother|sister|mother|father|son|daughter/.test(r))) stake += 0.14;

  // the size of the bond, whichever way it currently points — hatred is investment too
  if (e) stake += Math.min(0.2, (Math.abs(e.warmth) + Math.abs(e.trust)) / 400);

  // still reaching: fixation, an active repair loop, a drive pointed at them
  if (p?.active_states?.some((s) => new RegExp(`fixated on|guilt toward`, "i").test(s))) stake += 0.12;
  if ((p?.repairing ?? 0) > 0 && p?.repair_toward === toward) stake += 0.15;
  const goal = state.characters[id]?.drive?.goal ?? "";
  if (goal && (state.characters[toward]?.name ?? "").split(/\s+/)[0] &&
      goal.toLowerCase().includes((state.characters[toward]!.name).split(/\s+/)[0].toLowerCase())) stake += 0.08;

  return Math.max(0, Math.min(1, stake));
}

/** How many scenes it takes to get past somebody, given what they have in it. */
export function roundsFor(stake: number): number {
  if (stake >= 0.7) return 4;
  if (stake >= 0.45) return 3;
  if (stake >= 0.25) return 2;
  return 1;
}

/** The shape resistance takes this round. Not a script — the beats a person actually moves through,
 *  so round three does not repeat round one, which is the other half of the failure. */
function roundShape(round: number): string {
  switch (round) {
    case 1: return "THEY DO NOT HEAR IT AS FINAL. Nobody does, the first time. They argue the facts of it — the specific claim, the number, the thing they are accused of — because if the facts are wrong then the conclusion is wrong. They do not agree, they do not sign anything, and they do not say a version of \"okay\".";
    case 2: return "IT IS LANDING AND THEY FIGHT IT. This is where the thing they are actually afraid of comes out, sideways or straight: what they will lose, what it says about them, who else will know. They bargain, or they go for the throat, or both in the same minute.";
    case 3: return "THEY STOP FIGHTING CLEAN. The composure goes. This is where somebody says the unforgivable thing, or asks the question they swore they would not ask, or names the year they gave to it. Not dignified.";
    default: return "IT IS OVER AND THEY KNOW IT. What is left is not agreement, it is grief with the fight gone out of it — and grief still has business: what they want back, what they will not give up, the one thing they need said before they go.";
  }
}

/**
 * The law, handed to the narrator before it writes.
 *
 * It never forbids the ending and never overrules the player's act. It says that this person has not
 * been got past yet, and it hands over the specific human being who is refusing — out of the fields
 * the forge already wrote, which is what makes the resistance THIS person's rather than generic.
 */
export function severanceDirective(state: SaveState): string {
  const sv = state.severance;
  if (!sv) return "";
  const c = state.characters[sv.toward];
  const cond = state.condition[sv.toward];
  if (!c || !cond) return "";
  const round = sv.rounds;
  const style = c.attachment?.style ?? "secure";
  const underThreat = c.attachment?.under_threat?.trim();
  const soothed = c.attachment?.soothed_by?.trim();

  const styleLine =
    style === "anxious" ? "They pursue. Silence is unbearable to them and distance is the thing they are trying to close, so they follow it, re-open it, and ask again in different words."
    : style === "avoidant" ? "They go cold and administrative — logistics, dates, who takes what — and the feeling comes out as precision. That is not acceptance; it is the only way they can hold it."
    : style === "disorganized" ? "They come at it and flinch from it inside the same exchange: furious in one line, pleading in the next, and unable to hold either position."
    : "They meet it directly and say the true thing, which is harder to be in the room with than a scene would be.";

  return `\n\n=== THIS IS NOT SETTLED YET ===\n`
    + `The player is ending it with ${c.name}, and ${c.name} has not been got past. `
    + `${roundShape(round)}\n`
    + `HOW THIS PARTICULAR PERSON RESISTS: ${styleLine}`
    + (underThreat ? ` Under threat, on their own card: ${underThreat} — that is what they do here, at full size.` : "")
    + (soothed ? ` What would actually reach them: ${soothed}. They may reach FOR it, and not get it.` : "")
    + `\nWhat is forbidden this turn is the shrug. No "okay". No signing it. No quiet dignified acceptance, no stepping back to let the player have their scene, and no wise sad little speech about how they always knew. `
    + `A person losing this does not become reasonable at the exact moment it would be convenient. Match the size of the reaction to the size of what is being taken.\n`
    + `THE PLAYER STILL GETS TO LEAVE — this never becomes the world refusing them, and nobody physically stops them. It costs the scenes it would really cost, and this is one of them.`;
}

/**
 * Open, advance, or close a severance. Called before the narrator writes.
 *
 * The player restating it on a later turn is the same severance continuing, not a new one — that is
 * how the rounds accumulate and how it eventually completes.
 */
export function tickSeverance(state: SaveState, action: string, presentIds: string[]): void {
  const sv = state.severance;
  const said = detectSeverance(action);

  if (sv) {
    if (!presentIds.includes(sv.toward)) { delete state.severance; return; }   // they are not in the room
    const move = continuesSeverance(action);
    if (move === "retract") { delete state.severance; return; }                 // they took it back
    if (move === "hold") sv.rounds++;
    if (sv.rounds > sv.needed) delete state.severance;                          // got past; it can land
    return;
  }
  if (!said) return;

  // whoever present has the most in it is the one being left
  let best: { id: string; stake: number } | null = null;
  for (const id of presentIds) {
    if (id === "char_player") continue;
    const c = state.characters[id];
    if (!c || c.central === false) continue;
    const stake = stakeOf(state, id, "char_player");
    if (!best || stake > best.stake) best = { id, stake };
  }
  if (!best || best.stake < 0.2) return;   // nothing much was being ended
  state.severance = { toward: best.id, rounds: 1, needed: roundsFor(best.stake), started_turn: state.world.current_turn };
}
