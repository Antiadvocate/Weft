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
  + String.raw`|\b(?:quadripleg\w*|parapleg\w*|hemipleg\w*|tetrapleg\w*|blind|deaf|mute|crippled|immobile|bedridden|comatose|unconscious)\b`, "i");

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
