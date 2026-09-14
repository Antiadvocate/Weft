/**
 * BODY SEVERITY — how badly a body is wrecked, and what that does to the person in it.
 *
 * The engine had two channels for bodily state and no notion of degree in either:
 *
 *   • `injuries` are typed, carry a free-text `functional_impact`, gate physical attempts, and
 *     reach the narrator with a rendering instruction ("let it show in how they hold the body").
 *   • `conditions` are free strings. They reach the narrator as a bare comma-joined list, gate
 *     nothing, and the narrator contract explicitly demotes them: "conditions not caused this turn
 *     are background, not the subject." They also expire on a fixed ten-turn timer.
 *
 * A sprained wrist and an evisceration were the same shape in both. So a man recorded as
 * "eviscerated and exposed" — intestines on the stone, by the player's own hand — kept delivering
 * composed multi-clause arguments with rhetorical figures, planted and arms-crossed, because
 * nothing in the state said a catastrophic body should dominate the performance. Ten turns later
 * the condition would have silently expired and he would have been well.
 *
 * This grades what is recorded and says what it means. Deterministic, zero tokens.
 *
 * A NOTE ON SOVEREIGNTY. In god mode a player can declare someone cannot die, and that declaration
 * is honored absolutely — nothing here kills anyone or overrides it. Being kept alive is not the
 * same as being unharmed, and that is exactly the distinction the engine was missing: the body
 * persists in its state rather than transcending it.
 */
import type { Condition } from "./types";

export type BodySeverity = 0 | 1 | 2 | 3 | 4;

/** Damage that ends a person as a functioning social actor, whether or not they are still breathing. */
// Both word orders, because the recorded string is whatever the bookkeeper happened to write:
// "exposed muscle" and "muscle exposed" are the same body.
const CATASTROPHIC = /\b(eviscerat\w*|disembowel\w*|entrails?|gutted|intestines?|inside?s? out|turned inside out|flay\w*|skinned|skin (removed|peeled|stripped|flayed|gone)|degloved?|dismember\w*|decapitat\w*|beheaded|impaled|torn (in half|apart|open)|crushed|burn(ed|t) alive|charred|liquef\w*|unmade|bisect\w*|split open|viscera\w*)\b|\b(exposed|open|spilling|out|removed) (muscle|viscera|bone|organs?|flesh)\b|\b(muscle|viscera|bone|organs?|flesh) (exposed|showing|spilling|out|removed)\b/i;

/** Damage that dominates behavior but leaves a person recognisably operating. */
const SEVERE = /\b(sever\w*|amputat\w*|shattered|compound fracture|broken (leg|legs|back|spine|hip|pelvis|skull|jaw|ribs?)|punctured|collapsed lung|gunshot|stabbed|impalement|haemorrhag\w*|hemorrhag\w*|bleeding out|arterial|gouged|blinded|deaf(ened)?|maimed|mutilat\w*|third[- ]degree|gangren\w*|septic|paralys\w*|paralyz\w*)\b/i;

/** Real damage that shows and costs, without taking the body out of service. */
const MODERATE = /\b(broken|fractur\w*|dislocat\w*|deep (cut|gash|wound)|lacerat\w*|concussion|burn(s|ed|t)?|poisoned|feverish|bleeding|stab wound|torn (muscle|ligament)|sprained badly|cracked rib)\b/i;

/** Everyday wear the story can carry in the background — the case the old model assumed for all of it. */
const MILD = /\b(bruis\w*|scrap\w*|graz\w*|sore|ach\w*|sprain\w*|winded|blister\w*|scratch\w*|nosebleed|shaken|hungover|chilled|drenched|limping)\b/i;

/* ── THE PART THAT IS NOT A WORD LIST ────────────────────────────────────────────────────────
 *
 * Every list above is a synonym set, and the bookkeeper does not write synonyms — it writes plain
 * English. From a real save, a woman the player had taken apart limb by limb:
 *
 *     injuries : "missing left arm" · "missing right arm" · "missing both legs"
 *     conditions: "quadriplegic" · "partially blind"
 *
 * All five scored 1. MILD. The lists know "amputated" and got "missing left arm"; they know
 * "paralysed" and got "quadriplegic"; they know "blinded" and got "partially blind". Three
 * near-misses on one body, and the default for unrecognised text was 1, so every miss failed in the
 * direction of "she is fine".
 *
 * WHAT THAT COST, because it is not one bug, it is four:
 *   · bodySeverity read 1, so `[BODY WRECKED — dominates everything they do]` never rendered;
 *   · bodyMarks returned EMPTY, so the directive that names a wrecked body had nothing to name;
 *   · fadesOnItsOwn is `severity <= 2`, so at CONDITION_LIFESPAN the engine HEALED HER — ten turns
 *     after the mutilation the ledger silently dropped all five records, with nothing in the prose
 *     restoring anything. The comment on fadesOnItsOwn predicted this exact failure and was gated
 *     on this exact function;
 *   · and with the ledger empty the narrator's line read `body: fatigue fresh, hunger peckish`,
 *     beside an inventory holding a basket and a trait reading "cannot sit still; she is always
 *     adjusting something, a hem, a cushion, her own hair". The prose then had her walk across a
 *     hotel lobby with the basket over her arm.
 *
 * So grade the SHAPE as well as the vocabulary. A part of a body plus a word for it being gone is
 * catastrophic whatever verb the bookkeeper reached for, and a faculty plus a word for its loss is
 * severe. These run BEFORE the lists, because a list that has already been walked around cannot be
 * the thing that decides. */

/** Parts whose loss ends a body as a functioning one. */
const PART = String.raw`arms?|legs?|hands?|feet|foot|fingers?|thumbs?|toes?|limbs?|eyes?|ears?|jaw|face|tongue|spine|head|shoulders?|knees?|elbows?`;
/** Ways the bookkeeper writes "it is not there any more". */
const GONE = String.raw`missing|lost|loss of|gone|removed|taken|severed|cut off|torn off|blown off|amputated|absent|no longer has|without`;
/** "missing left arm", "both legs gone", "loss of the right hand", "no longer has arms". */
const PART_GONE = new RegExp(
  String.raw`\b(?:${GONE})\b[^.;]{0,24}\b(?:${PART})\b|\b(?:${PART})\b[^.;]{0,16}\b(?:${GONE})\b`, "i");

/** Faculties whose loss dominates behaviour without ending the body. */
const FACULTY = String.raw`sight|vision|hearing|speech|voice|balance|the use of \w+`;
const FACULTY_GONE = new RegExp(
  String.raw`\b(?:${GONE}|cannot|can't|unable to|no)\b[^.;]{0,20}\b(?:${FACULTY}|see|hear|speak|walk|stand|move|talk)\b`
  + String.raw`|\b(?:quadripleg\w*|parapleg\w*|hemipleg\w*|tetrapleg\w*|blind|deaf|mute|crippled|immobile|bedridden|comatose|unconscious)\b`
  /* HELD, BY WHATEVER DID IT. A player froze somebody where she stood and it was filed as "held
   * fast" — which graded as an ordinary condition, never reached bodyMarks, and so mapped to no
   * lost faculty and let her walk out of the room. A body that cannot move is a body that cannot
   * move; the cause is the story's business and the grading is not. These are severe, so they wait
   * for the prose to lift them rather than ageing off a timer — the contract now asks the
   * bookkeeper to record the release with condition_remove. */
  + String.raw`|\b(?:immobilis\w*|immobiliz\w*|rooted to the spot)\b|\bfrozen (?:in place|solid|stiff|where (?:he|she|they) stood)\b|\bheld (?:fast|in place|rigid)\b`, "i");

/**
 * Grade one recorded string.
 *
 * UNRECOGNISED TEXT NO LONGER SCORES MILD BY DEFAULT — not for an injury. Somebody wrote it down
 * because something happened to a body, and "we do not have a word for it" is not evidence that it
 * was a scratch. An unclassified CONDITION is still 1 (conditions carry ordinary states — "tired",
 * "peckish", "damp" — and grading those as real damage would put the whole cast in a hospital), so
 * the caller says which channel it is reading.
 */
export function severityOfText(text: string, kind: "injury" | "condition" = "condition"): BodySeverity {
  const t = String(text ?? "");
  if (!t.trim()) return 0;
  if (CATASTROPHIC.test(t) || PART_GONE.test(t)) return 4;
  if (SEVERE.test(t) || FACULTY_GONE.test(t)) return 3;
  if (MODERATE.test(t)) return 2;
  if (MILD.test(t)) return 1;
  return kind === "injury" ? 2 : 1;
}

/** The worst thing currently true of this body, across BOTH channels. */
export function bodySeverity(cond: Condition | undefined): BodySeverity {
  if (!cond) return 0;
  let worst: BodySeverity = 0;
  for (const c of cond.conditions ?? []) { const s = severityOfText(c); if (s > worst) worst = s; }
  for (const i of cond.injuries ?? []) {
    const s = severityOfText(`${i.type} ${i.functional_impact ?? ""}`, "injury");
    if (s > worst) worst = s;
  }
  return worst;
}

/** The recorded strings at or above a severity — so a directive can name what it is talking about. */
export function bodyMarks(cond: Condition | undefined, min: BodySeverity = 3): string[] {
  if (!cond) return [];
  const out: string[] = [];
  for (const c of cond.conditions ?? []) if (severityOfText(c) >= min) out.push(c);
  for (const i of cond.injuries ?? []) if (severityOfText(`${i.type} ${i.functional_impact ?? ""}`, "injury") >= min) out.push(i.type);
  return out;
}

/**
 * A condition that only fades on a timer if it is the kind of thing that fades on a timer.
 * CONDITION_LIFESPAN quietly healing "eviscerated and exposed" after ten turns is not recovery,
 * it is the ledger forgetting. Anything severe or worse waits for the prose to remove it.
 */
export function fadesOnItsOwn(text: string): boolean {
  return severityOfText(text) <= 2;
}

/**
 * What the narrator is told about a wrecked body. Empty below the moderate line — an ordinary
 * bruise needs no paragraph, and the existing condition list already carries it.
 *
 * These say what to SHOW, in the codebase's own idiom, and each one closes the specific door the
 * failure walks through: at the top, that a person kept alive by fiat can still be composed.
 */
export function bodyDirective(cond: Condition | undefined, name: string): string {
  const sev = bodySeverity(cond);
  if (sev < 2) return "";
  const marks = bodyMarks(cond, Math.min(sev, 3) as BodySeverity);
  const what = marks.length ? marks.join(", ") : "their injuries";
  if (sev === 4) {
    return `\nBODY — ${name.toUpperCase()} IS CATASTROPHICALLY WRECKED (${what}). This is not a detail of the scene, it IS the scene for them, this turn and every turn it remains true. A body in this state does not produce composed speech: no measured cadence, no multi-clause arguments, no rhetorical figures, no rolling a word around to test it, no wry constructions. If they speak at all it is fragments — a few words at a time, forced out between what the body is doing, and often the wrong words. They do not stand planted, cross their arms, tap fingers, hold a considered silence, or perform steadiness; the body has taken that away and cannot be asked for it. Every action they attempt is dominated, interrupted, or defeated by their state. Never use anatomy the damage has destroyed or displaced. If the player has decreed that they cannot die, they DO NOT die — but being kept alive is not being unharmed, and it is not being unaffected: they persist inside this, they do not rise above it. Do not let them recover, stabilise, or normalise because the conversation would be easier if they did; the state says otherwise and the state is true.`;
  }
  if (sev === 3) {
    return `\nBODY — ${name} is severely hurt (${what}). It shows in everything: speech comes shorter and breaks, attention keeps returning to the damage, and any action that would use the hurt part fails, costs, or is done badly some other way. Do not let it recede into background because the scene has moved on to talk.`;
  }
  return `\nBODY — ${name} is carrying real damage (${what}); let it cost them visibly in movement and attention rather than being mentioned once and dropped.`;
}

/* ══ WHAT A BODY CAN NO LONGER DO, AND WHAT ON THE CARD DEPENDED ON IT ═══════════════════════
 *
 * A character card is written once, at the moment the person enters the story, and it describes the
 * body they had then. The condition ledger is what has happened to them since. Nothing reconciles
 * the two, and the narrator contract makes that actively dangerous, because it declares core traits
 * supreme: "where a trait and the rest of that character's block disagree — the running log, the
 * relationship note, the mood — the TRAIT wins."
 *
 * From the save that produced the coherence gate. Emily Clarke, recorded as quadriplegic, partially
 * blind, missing both arms and both legs, still carrying the card she was written with:
 *
 *   trait  "Touches people when she talks to them — a hand on the arm, a brush of the shoulder —
 *           and does not notice she is doing it."
 *   trait  "Cannot sit still; she is always adjusting something, a hem, a cushion, her own hair."
 *   skill  "Sewing and dressmaking — Expert. She can copy any garment from a picture."
 *   skill  "Hairdressing — Good. She cuts and sets her own hair and her friends'."
 *
 * Every turn, the engine handed the narrator those four things and told it they outrank the body
 * block. She reached for people with arms she does not have because she was ordered to. That is not
 * the model failing to reason; it is the document.
 *
 * THE FIX IS NOT TO REWRITE THE CARD, and the player who found this said why: "these are her
 * original things, but now she has no legs. So maybe if her legs are restored she can dance again."
 * Editing traits out is lossy and one-way — it destroys who the person is to record what happened
 * to them, and it cannot be undone if the story gives the part back. A card is not a status report.
 *
 * So the card is left exactly as written and filtered at render time, every turn, against the body
 * as it currently is. Restore the arms and the trait comes back by itself, because nothing was ever
 * removed. It is the same mechanism the mannerism-resting pass already uses for a different reason:
 * the cached prefix cannot vary per turn, so the volatile block is where a card gets qualified.
 *
 * A blocked trait is not deleted from the prompt either — it is moved out of the binding line and
 * shown as what it now is, which is usually the better scene anyway. A woman who touched everyone
 * she talked to and cannot any more is a specific person in a specific grief. A woman whose card
 * simply never mentioned it is nobody.
 */
export type Faculty = "hands" | "legs" | "sight" | "speech" | "hearing";

export const FACULTY_LOSS: Record<Faculty, string> = {
  hands: "has no working arms or hands",
  legs: "cannot move under their own power",
  sight: "cannot see",
  speech: "cannot speak",
  hearing: "cannot hear",
};

/** A recorded mark saying a part is not merely hurt but gone or dead. */
const LOSS = /\b(?:missing|lost|loss|no|none|without|amputat\w*|sever\w*|remov\w*|gone|destroyed|crushed|mangled|useless|paralys\w*|paralyz\w*|nonfunctional|non-functional)\b/i;
/** "Partially blind" is not blind, and "deaf in one ear" is not deaf. */
const PARTIAL = /\b(?:partial\w*|part|half|near\w*|almost|going|legally|colou?r|night|one\s+(?:eye|ear)|in\s+one)\b/i;

const marked = (marks: readonly string[], re: RegExp) => marks.some((m) => re.test(m));
/** Marks that name a part AND say it is gone — "missing left arm", never "aching left arm". */
const lost = (marks: readonly string[], part: RegExp) => marks.some((m) => part.test(m) && LOSS.test(m));

/**
 * The faculties this body has ENTIRELY lost.
 *
 * Entirely is the whole word. One missing arm still reaches for the teacup with the other; a woman
 * partially blind can see the door; deaf in one ear is a person who hears you. A rule that reads
 * `blind` and stops there takes away the only things a half-sighted character still has, which is
 * the opposite of the point. So a faculty counts as gone only when both sides are named, the part
 * is written in the plural, or the diagnosis covers it outright.
 */
export function lostFaculties(cond: Condition | undefined): Faculty[] {
  const m = bodyMarks(cond);
  if (!m.length) return [];
  const out: Faculty[] = [];
  if (marked(m, /\b(?:quadripleg|tetrapleg)/i) || lost(m, /\b(?:arms|hands)\b/i)
    || (lost(m, /\b(?:left|l\.?)\s+(?:arm|hand)\b/i) && lost(m, /\b(?:right|r\.?)\s+(?:arm|hand)\b/i))) out.push("hands");
  /* HELD IN PLACE IS LOST MOBILITY, however it got that way. The list below was written for
   * diagnoses and amputations, so a player who froze somebody where they stood — and had it filed
   * as "frozen in place, cannot move" — got nothing, and the coherence gate let her walk off. What
   * matters to the gate is that the legs do not work, not why. */
  if (marked(m, /\b(?:quadripleg|tetrapleg|parapleg|bedridden|immobile|immobilis|immobiliz)/i)
    || marked(m, /\b(?:cannot|can't|cant|unable to|no longer able to)\s+(?:move|walk|stand)\b|\bfrozen (?:in place|where|solid|stiff)\b|\bheld (?:fast|in place|rigid)\b|\brooted to the spot\b/i)
    || lost(m, /\b(?:legs|feet)\b/i)
    || (lost(m, /\b(?:left|l\.?)\s+(?:leg|foot)\b/i) && lost(m, /\b(?:right|r\.?)\s+(?:leg|foot)\b/i))) out.push("legs");
  if (m.some((x) => /\bblind\b/i.test(x) && !PARTIAL.test(x)) || lost(m, /\beyes\b/i)) out.push("sight");
  if (marked(m, /\bmute\b|\baphasi|\bcannot\s+speak\b|\bunable\s+to\s+speak\b|\bvocal\s+cords?\b/i)
    || lost(m, /\btongue\b|\bjaw\b|\bvoice\b|\blarynx\b|\bthroat\b/i)) out.push("speech");
  if (m.some((x) => /\bdeaf\b/i.test(x) && !PARTIAL.test(x)) || lost(m, /\bears\b|\beardrums?\b|\bhearing\b/i)) out.push("hearing");
  return out;
}

/* WHAT A LINE OF CARD TEXT NEEDS A BODY FOR.
 *
 * Deliberately narrower than it could be, and it errs toward saying nothing. Getting this wrong
 * does not delete anybody's prose — it moves one line of a card into a different paragraph — but a
 * trait wrongly filed as impossible is a person quietly diminished, and that is worth avoiding.
 * So: only verbs and nouns that plainly require the part, and no inference from tone.
 *
 * The near-misses are instructive, and several words were cut for being idioms far more often than
 * they are bodies. "Carry" flagged Emily's Singing skill, whose card value reads "she can carry a
 * tune"; "hold" is hold forth, "reach" is reach for the right word, "carriage" is a vehicle,
 * "notice" and "pitch" are not organs. What is left names the part or the craft outright.
 *
 * "Reading people" is perception rather than eyesight, and a blind woman does it by ear; it still
 * matches `sight` through `read`, and that is the acceptable cost of not writing a parser.
 * "Restless" is not legs. "Warm" is not hands. */
const NEEDS: Record<Faculty, RegExp> = {
  hands: /\b(?:hands?|fingers?|arms?|touch\w*|grip\w*|grab\w*|sew\w*|stitch\w*|knit\w*|needlework|embroider\w*|dressmak\w*|tailor\w*|garment|hairdress\w*|barber\w*|cook\w*|bak(?:e|es|ing)|writ(?:e|es|ing)|handwriting|draw(?:s|ing)?|sketch\w*|paint\w*|whittl\w*|carpentr\w*|joiner\w*|blacksmith\w*|mend\w*|repair\w*|adjust\w*|fiddl(?:e|es|ing)\s+with|tinker\w*|fidget\w*|brush\w*|comb\w*|typ(?:e|es|ing)|pour\w*|shoot\w*|marksman\w*|box(?:es|ing)|punch\w*|wield\w*|dext\w*|deft\w*|nimble\s+finger\w*|play(?:s|ing)?\s+(?:the\s+)?(?:piano|fiddle|violin|guitar|cards)|pickpocket\w*)\b/i,
  legs: /\b(?:walk\w*|run(?:s|ning)?|ran|danc\w*|strid\w*|pac(?:e|es|ing)|gait|footwork|feet|step\w*|climb\w*|kick\w*|athlet\w*|roam\w*|wander\w*|prowl\w*|stand\w*|kneel\w*|sit\s+still|light\s+on\s+(?:her|his|their)\s+feet|quick\s+on\s+(?:her|his|their)\s+feet)\b/i,
  sight: /\b(?:see(?:s|ing)?|saw|sight|eyes?|eyesight|look\w*|watch\w*|observ\w*|read(?:s|ing)?|glanc\w*|stare\w*|marksman\w*|paint\w*|sketch\w*|draw(?:s|ing)?)\b/i,
  speech: /\b(?:talk\w*|speak\w*|speech|says?|said|sing(?:s|ing|er)?|song|voice|chatter\w*|orat\w*|banter|gossip\w*|storytell\w*|jokes?|preach\w*)\b/i,
  hearing: /\b(?:hear\w*|listen\w*|ears?|overhear\w*|eavesdrop\w*)\b/i,
};

/** Which of the given faculties this piece of card text depends on. Empty is the common answer. */
export function needsFaculty(text: string, among: readonly Faculty[]): Faculty[] {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  return among.filter((f) => NEEDS[f].test(t));
}

/* ══ A LIMB IS NOT A MOOD ═══════════════════════════════════════════════════════════════════
 *
 * `conditions` is one array of free strings holding two completely different kinds of thing: what
 * a body is doing this hour ("winded", "shivering", "in shock") and what has been permanently
 * taken off it ("missing left arm"). Everything that manages the array was written for the first
 * kind, and applies to the second without noticing.
 *
 * Traced through one save, Emily Clarke at turn 83:
 *
 *   quadriplegic, partially blind, missing left arm, missing right arm, missing both legs
 *
 * and at turn 108, alive, fatigue "fresh":
 *
 *   (nothing)
 *
 * Four separate mechanisms will do that, and none of them needs a timer:
 *
 *  1. THE DEDUPE. addCondition treats a new condition as a variant of an old one when they share
 *     any content word. "missing left arm" and "missing right arm" share `missing`, so recording
 *     the second DELETES the first; recording the legs then deletes the arm. Amputations
 *     annihilate one another pairwise and the ledger keeps whichever came last.
 *  2. THE CAP. Six conditions maximum, oldest evicted. Five limbs and two states of shock, and a
 *     limb falls off the end of the list.
 *  3. condition_remove MATCHES LOOSELY — substring either way, or one shared word. A single fact
 *     removing "missing" or "shock" takes the amputations with it.
 *  4. A MULTI-DAY GAP wipes every condition wholesale, on a comment that says "all transient
 *     conditions resolve over multi-day spans". Nothing checked that any of them were transient.
 *
 * So the player who reported "Emily. Arm removed. Still questioning me" was not looking at a
 * narrator ignoring the ledger. By then the ledger agreed with the narrator: she had her arms back.
 *
 * lossKey is what tells the two kinds apart. It returns a stable identity for a structural loss —
 * side and part, or the diagnosis — and null for everything else, which is nearly everything. Two
 * losses are the same record only when they name the same part, so a left arm and a right arm can
 * never stand in for each other. A loss is never evicted by the cap, never wiped by a passing week,
 * and only removed by a fact that names it.
 *
 * IT REMAINS REMOVABLE, and that is deliberate. A story may give a limb back — surgery, a
 * prosthesis, magic, the player rewriting the world — and when it does, `condition_remove: missing
 * left arm` still works and everything that depended on the arm returns by itself, because nothing
 * downstream was ever edited. The card gate and the coherence gate both read this live.
 */
const LOSS_DX = /\b(quadripleg|tetrapleg|parapleg|hemipleg|paralys|paralyz|amputat|blind|deaf|mute|aphasi|crippled|bedridden|immobile)\w*/i;
/* GONE is deliberately not widened for this: it feeds severityOfText, which is graded against a
 * test suite. A part that was destroyed rather than removed is still a part that is not coming
 * back, so lossKey reads a slightly longer list of its own. */
const LOSS_VERB = new RegExp(String.raw`\b(?:${GONE}|destroyed|crushed|mangled|ruined|shattered|useless|shot off|burned away|burnt away|dead)\b`, "i");
const PART_LOST = new RegExp(
  String.raw`${LOSS_VERB.source}[^.;]{0,24}\b(?:${PART})\b|\b(?:${PART})\b[^.;]{0,16}${LOSS_VERB.source}`, "i");

export function lossKey(text: string): string | null {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (!PART_LOST.test(t) && !FACULTY_GONE.test(t) && !LOSS_DX.test(t)) return null;
  const part = t.match(new RegExp(String.raw`\b(?:${PART})\b`, "i"))?.[0]
    ?.replace(/^feet$/, "foot").replace(/^teeth$/, "tooth").replace(/s$/, "");
  const side = t.match(/\b(left|right|both|upper|lower)\b/)?.[1] ?? "";
  if (part) return `${side}|${part}`;
  const dx = t.match(LOSS_DX)?.[1];
  return dx ? `dx|${dx}` : null;
}

/** True for anything the ledger must not lose by accident — see lossKey. */
export const isPermanentLoss = (text: string): boolean => lossKey(text) !== null;
