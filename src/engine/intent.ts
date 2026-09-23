// ── INTENT PASS ──────────────────────────────────────────────────────────────
// The layer that separates TRUTH from TELLING. Before the narrator renders a turn,
// each present NPC who has something at stake privately commits to what they are
// ACTUALLY doing this beat — the lie they'll tell, the want they're hiding, the
// feeling they're withholding — authored from THEIR OWN state (drive, agenda, edges,
// mood), never from the player's thoughts. This is what makes NPCs sovereign: their
// intent exists independently of what the player typed or thought.
//
// The output is split across the pipeline's three consumers, each getting only what
// it should:
//   • surface  → the NARRATOR renders it as deniable behavior (the player sees the
//                bitten teeth, not the lie).
//   • truth    → the BOOKKEEPER records it ("lied to Rabi about the shipment", builds
//                the deceit trait) — it reads from truth, not from the opaque prose.
//   • tell     → an optional deniable behavioral leak the narrator MAY show (a flicker,
//                a too-quick answer) that the player can read, or misread.
//
// Cost discipline: this fires ONLY for present NPCs with genuine stakes this turn, and
// runs on the cheap model. Most turns it fires for zero or one character. No stakes →
// no call → zero added cost.

import type { SaveState } from "./types";
import { contextHistory } from "./context";
import { complete, buildMessages, safeJson } from "../llm";
import { effectiveStanding, dispositionCue } from "./desire";
import { relevance } from "./memory";
import { clipText } from "./text";
import { doorFromVoice } from "./coerce";
import { playerSaysAnswered, deixisNote } from "./turn";

export interface NpcIntent {
  char_id: string;
  name: string;
  surface: string;   // what they let show — for the narrator
  /** What is actually true underneath — for the BOOKKEEPER only, and absent when the model failed
   *  to write one distinct from the surface. See the collapse handling in runIntentPass: an intent
   *  with no truth is still a committed stance for the narrator to render, and the bookkeeper
   *  simply hears nothing about this person's interior that turn. */
  truth?: string;
  tell?: string;     // optional deniable behavioral leak — the narrator may show it, the player may read/misread it
  lying: boolean;    // convenience flag: is the surface a deliberate deception?
}

/** Does this NPC have something at stake THIS turn worth authoring a hidden intent for?
 *  Stakes = they carry an agenda/drive, OR they hold a charged edge toward the player
 *  (secret want, distrust, a false belief), OR they're withholding under stress. Cheap,
 *  synchronous gate — no model call. Returns the reason (for the prompt) or null. */
function stakesFor(state: SaveState, id: string): string | null {
  const c = state.characters[id];
  const cond = state.condition[id];
  if (!c || !cond) return null;
  const reasons: string[] = [];
  const agenda = c.voice?.agenda?.trim();
  if (agenda) reasons.push(`under-the-surface agenda: ${agenda}`);
  if (c.drive?.goal && !c.drive.goal.toLowerCase().includes("relax")) reasons.push(`active pursuit: ${c.drive.goal}`);
  // charged edge toward the player: strong desire they may be hiding, or distrust
  const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
  if (e) {
    if (e.attraction !== undefined && e.attraction >= 30) reasons.push(`carries desire toward the player (${e.attraction}) they may not show`);
    if (e.trust <= -20) reasons.push(`distrusts the player (${e.trust}) and may hide things or mislead them`);
  }
  // a false belief the NPC holds about the player (from the theory-of-mind layer) is prime lie/drama fuel
  const belief = state.minds?.[id]?.about?.find((b) => b.target === "char_player")?.held_false;
  if (belief) reasons.push(`wrongly believes: ${belief}`);
  // clenched + low openness → likely withholding rather than open
  if (cond.psyche.relaxation <= -3) reasons.push(`tense and guarded (openness ${cond.psyche.relaxation}), so more likely to cover up what they feel than show it plainly`);
  return reasons.length ? reasons.join("; ") : null;
}

export const INTENT_SYSTEM = `You write down what one character privately and truly intends for one moment of a story: what they are really doing underneath what they let other people see. This comes from the character alone, from who they are and the situation they're in. It never comes from the player's private thoughts. You aren't given those, and the character couldn't know them anyway.

Reply with one strict JSON object and nothing else:
{"surface":"How they carry themselves in this moment: their posture, their manner, how open they are, what they're willing to bring up and what they keep back. Keep it brief, a few words. It is never a line of dialogue and never quoted speech. You're writing this before the scene is written, so any words you put in their mouth would be words they never actually said. The narrator writes what gets spoken, and you only describe the attitude they bring to it.","truth":"What is going on inside them: what they want out of the next few minutes, what they're afraid of, and what they aren't saying. Write it the way this person would put it to themselves, in their own words, and name something specific in it, such as a person, a place, an object, or a sentence they want to hear or dread hearing. For example: a nineteen-year-old dresser thinks she wants him to take it back in front of Ames, she is freezing, and she will walk out if he takes Rabi's side. If they're lying, say what the lie is and what fact they're hiding. This is never a second description of the surface. If this field describes posture, manner or an action, it's wrong, because you've written the surface twice.","tell":"Required. The one place the surface cracks: a small leak of the truth that someone in the room might catch or might miss, and that the character could deny, such as a flicker, an answer given too fast, a hand that goes still, or a breath taken at the wrong moment. This is the only way anything in truth ever reaches the page, because the narrator is never shown the truth field. Without it the character only ever shows their surface and seems to have no inner life. It shows the crack without explaining what's behind it, and it has to be something the body does, never the name of a feeling. The further the surface is from the truth, and the tenser the body, the more leaks out: a composed person with nothing much underneath shows a flicker, while someone hiding something big lets slip something obvious that they could still deny.","lying":true or false}

Rules:
- The character acts out of their own nature, plans and feelings, and they are in charge of their own moment. They go after what they themselves want.
- The surface and the truth are two different kinds of thing, and they are never the same sentence. The surface is what a camera could record: posture, manner, what they bring up and what they hold back. The truth is what is going on inside them: the want, the fear, what they aren't saying, what they're hoping will happen. You can't photograph a want, and a feeling has no posture, so the two fields should never use the same words. Copying the surface into the truth is the worst thing you can send back. It tells the rest of the engine this person has no inner life, and the scene that comes out of it has them announcing their feelings out loud, because there was nothing underneath for the prose to hold back. If you're about to repeat the surface, you haven't written the truth yet. Ask yourself what they want out of the next two minutes and what they're afraid of, and write that.
- Write the two fields differently even when nothing is being hidden. An honest, open person's surface and truth agree: there's no lie, "lying" is false and nothing is concealed. They are still completely different sentences, because one describes a body in a room and the other describes a state of mind. "She sets the plates down and says she will start on the salad" is a surface. "She is glad he is home and she still wants an apology for what he said about her sister" is the truth underneath it. The truth names a person and a specific grievance and uses no imagery, and most moments look like that. Most characters aren't deceiving anybody, and every character has something going on inside.
- Don't assume deception. Don't invent a hidden agenda, a secret plan, or a dark opinion of the player when their state only shows ordinary feelings. Someone who is resigned, hurt or wary is usually just that underneath. Even so, "just that underneath" is still a sentence about what's inside them, and it belongs in the truth.
- A character doesn't come right out and say what they want when wanting it scares them. When what they're after is blocked by a fear, a risk or something they can't say, the surface is the roundabout approach and the truth is what it's really for. They bring up a related subject, ask a question so the other person offers it themselves, try out a small version they could deny, or tell it as if it happened to someone else. That isn't lying, and "lying" stays false, because that's simply how people approach things that frighten them. If you write the surface as the want itself ("she tells him she needs to talk about the thing"), the scene turns into an announcement and the characters sound fake. If the character has a "goes at it by" line, use that as the surface.
- Match the character's actual state. The truth should be in proportion to how they really feel, which you're given as warmth and trust along with what those numbers mean in plain words. Mild negatives are mild. Warmth just below zero means "a little hurt, a little guarded", not terror, and low trust means "careful, watching", not a conviction that the player is a monster. Don't turn a wary or resigned character into someone who is secretly sure the player is a manipulator, a monster, an empty shell or a danger, because that's invented and it warps how the character gets played. Only write fear, hatred or a dark judgment when their warmth, trust and history really support feeling that strongly. If the numbers say "mildly hurt but still cares", the truth is that they're mildly hurt and nothing more.
- The character reacts to what the player actually said and did in this moment, and to their real shared history. They never react to some sinister reading of the player that their state doesn't support. If nothing hostile has actually happened, the character isn't secretly seething about it.
- In the truth field, the person is the subject of every sentence: she wants, she is afraid, she has decided, she can't say. If a sentence starts with a thing instead, such as the accusation, the invitation, the laugh, the silence or her own confusion, you've stopped reporting a mind and started describing from the outside what the scene is doing to her, which is the narrator's job and not this field's. Written from inside her, the same moment reads like this: she wants to say yes and she's frightened of what will happen if she does.
- Use plain words. The bookkeeper reads this field, and it is the character's own mind, so write it the way a person thinks and not the way a novel narrates. Don't use figures of speech, don't let an image stand in for a feeling, don't balance one clause against another, and don't make an abstract noun the subject of a verb. Say what she wants, say what she's scared of, name the person or thing it's about, and stop there. A nineteen-year-old and a sixty-year-old magistrate don't use the same words about the same trouble, so use the words that fit the person on this character's card.
- Keep each field to one or two short sentences that name what is really there, such as a person, an object, an act or a promise. Two sentences is the most, and one is often enough. These fields are stored and displayed at a fixed width, and a third sentence gets cut off, which looks as though the thought was lost halfway through instead of the field having a limit.
- Don't use quotation marks anywhere in your reply, whether in surface, truth or tell. A quoted line here later gets shown to the player as something the character said, when it was never spoken in the story at all, and that makes the whole system look as if it's making things up.
- Never refer to the player's unspoken thoughts or feelings. The character only reacts to what the player said out loud and what they visibly did.

- Don't give the character a test the player can't know about. "She is testing whether he will do X" is a fair intent once, and only when X is something the player could actually work out from what has been said aloud. It can't be a standing state. A character who needs something specific from the player and won't say what it is leaves the player with no way to succeed: they answer, they're told the thing was something else, and the something else is never named. In one save, six moments in a row read "she is testing whether he will…", each one waiting on something he hadn't said and none of it ever named, and the player, who had answered every single time, said they felt like they were going insane.
  So if this character is waiting for something specific, then either they say what it is in this moment, plainly, in words the narrator can put in their mouth, or they stop treating it as a condition and carry on. They can want something, but they have to say what it is before they judge the player for not giving it to them.

- You've written this character before. Their last few intents are listed below when there are any, and you shouldn't repeat one of them. If the situation hasn't changed, the character does something about it: they say the thing outright, they act instead of waiting, they change what they want, or they let it go. Repeating an intent stalls the scene, and nobody tests someone with the same question three times.

- Accept it when the player says yes. If the player has now given the character what they were waiting for, the want has been met. Write what a person does after they get what they asked for, which might be relief, awkwardness, a new want, wanting more of the same, or not knowing what to do with their hands. Don't have them reopen it, decide it doesn't count because of how it arrived, or move on to a new test, because each of those is the same mistake in a different form.`;

/* WHOSE SENTENCE IS IT.
 *
 * A `truth` field reports one person's mind, so the subject of it should be that person. Measured
 * across 283 of them written in play, 42% open on something else — "The accusation of cowardice
 * stings worse than the lost post", "The bold parting invitation leaves her flustered", "Absolute
 * bewilderment has blown through her caution". Each is the narrator outside her describing what the
 * scene did to her, which is a review of a beat rather than the inside of a person, and it is the
 * whole of a player's report that his cast's inner lives were "dripping in maxim".
 *
 * Kept as a measurement rather than a gate. At 42% it would reject too much to drop, and a truth
 * written from outside is still information the bookkeeper can use; what it is not is her. The rule
 * itself lives in INTENT_SYSTEM where it costs nothing, and this is how to check whether it landed.
 */
export function narratedFromOutside(truth: string, name?: string): boolean {
  const t = String(truth ?? "").trim();
  if (!t) return false;
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  if (/^(?:she|he|they|her|him|them|his|their)\b/i.test(t)) return false;
  if (first.length > 2 && new RegExp(`^${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) return false;
  return true;
}

/** What was written for this character on the last few beats, newest last. */
export function priorIntents(state: SaveState, id: string, n = 4): string[] {
  const out: string[] = [];
  for (const h of contextHistory(state).slice(-n)) {
    const hit = (h.gm_intents ?? []).find((g) => g.char_id === id);
    if (hit?.truth) out.push(hit.truth);
  }
  return out;
}

/**
 * THE PASS HAD NO MEMORY OF ITSELF.
 *
 * Each call is built from the character, their nature, their want, their mood, their edge, and the
 * player's action this beat. Nothing about what was written for them last turn. So when the
 * standing state does not move — a want only the player can satisfy, a warm-but-guarded edge — six
 * independent calls derive the same intent six times, and "she is testing whether he will…" is the
 * obvious thing to derive. Read consecutively from one save:
 *
 *   t19  She is testing whether he will meet her as a person or keep her at arm's length.
 *   t20  She is testing whether he can drop the ceremony and say something real to her.
 *   t21  She is testing whether his hurt is real or another deflection.
 *   t22  She is testing whether he will trust her enough to be honest.
 *   t23  She needs the reason he left, the one he has not said.
 *   t24  She is testing whether he will offer it freely.
 *
 * The player answered every one of them and was told each time that it was not the thing, without
 * ever being told what the thing was. Even on the beat where the confession lands and she says
 * outright "that's what I was waiting for", the next beat opens another test. Nothing in the loop
 * could end it, because nothing in the loop could see it.
 *
 * Meanwhile her own drive blocker read: "tells him plainly what she has kept for him and what she
 * now requires in return." The engine already had the answer and the intent pass talked over it.
 */
function priorIntentBlock(state: SaveState, id: string): string {
  const prior = priorIntents(state, id);
  if (!prior.length) return "";
  const lines = prior.map((p, i) => `  [${prior.length - i} beats ago] ${p}`).join("\n");
  // A LOOP DOES NOT HAVE TO BE CONSECUTIVE. The check compared the newest intent to the one
  // immediately before it, so a want that came back every other beat never registered as a repeat:
  // ask, get an answer, be pleased for a beat, ask again. Six turns of one woman asking one
  // question read, pairwise, as six different beats. Compare the newest against everything still
  // in the window instead — if the character is where they were three beats ago, they are circling.
  const latest = prior[prior.length - 1];
  const stuck = prior.length >= 2 && prior.slice(0, -1).some((p) => repeatedIntent([p, latest]));
  return `INTENTS YOU HAVE ALREADY WRITTEN FOR THIS CHARACTER (don't repeat any of them):\n${lines}`
    + (stuck
      ? `\nThese intents have started repeating, and the scene has stalled because of it. In this moment the character does something new: they say the thing outright in plain words, act on it instead of waiting, want something else, or drop it. They don't test the same question again, and they don't rephrase it.`
      : "");
}

/** Have the last intents been saying the same thing? Token overlap, no call. */
/**
 * STRIP INVENTED SPEECH. The intent pass runs BEFORE the narrator writes, so any dialogue it drafts
 * is dialogue that was never spoken — and the GM view renders `surface` to the player as the stance
 * a real character brought to a real beat. Cheaper to remove quoted lines than to trust the
 * instruction not to write them.
 *
 * AN APOSTROPHE IS NOT A QUOTE MARK. The pattern this replaces opened a quoted span on a bare ' or ’
 * anywhere at all, so in "a half-smile that doesn't quite reach his eyes. He's about to leave" it
 * matched from the apostrophe in doesn't to the one in He's and deleted everything in between,
 * leaving "doesns about to leave". Clauses vanished out of the middle of sentences and a whole
 * save's GM panel filled with wreckage: "Het push or ask for anything", "Hes hostility", "as if the
 * words havent reach for her hair", "shet fall apart". Double quotes are unambiguous and go first;
 * a single-quoted span only counts as one when it OPENS and CLOSES at a word boundary. Where that
 * is not certain the text is left alone — a stray quoted phrase on a card is a far smaller failure
 * than a deleted clause.
 */
export function deQuoteIntent(t: string): string {
  return String(t ?? "")
    .replace(/\s*[,:]?\s*(?:and\s+)?(?:she|he|they)?\s*says?,?\s*["“][^"“”]*["”]/gi, "")
    .replace(/["“][^"“”]{4,}["”]/g, "")
    .replace(/(^|[\s(\[])['‘]([^'‘’\n]{4,})['’](?=$|[\s.,!?;:)\]])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

/** Cut to a length without cutting mid-sentence. A hard slice left the GM panel full of intents that
 *  simply stop — "…and she is terrified that space is", "…She wants to" — which reads as the engine
 *  losing the thread rather than the field having a ceiling. Prefer the last completed sentence;
 *  fall back to the last whole word with an ellipsis. */
/**
 * Is this "truth" just the surface again?
 *
 * Byte-identical is the common case and the cheap check. The other case is a near-copy — the same
 * sentence with a word moved — so content-word overlap catches it too. Deliberately generous about
 * what counts as different: two fields that genuinely describe an inside and an outside share almost
 * no vocabulary, so a real pair scores far below this and only a copy trips it.
 */
export function collapsed(surface: string, truth: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(surface), b = norm(truth);
  if (!a || !b) return true;
  if (a === b) return true;
  const words = (x: string) => new Set(x.split(" ").filter((w) => w.length > 3));
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return a === b;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.75;
}

/** @see clipText — one clipper for the whole engine now; this name is kept for its callers. */
export const clip = clipText;

export function repeatedIntent(prior: string[]): boolean {
  const last = prior[prior.length - 1] ?? "";
  const prev = prior[prior.length - 2] ?? "";
  if (!last || !prev) return false;
  // A shared frame counts even when the object differs: "testing whether he will meet her as a
  // person" and "testing whether he will trust her enough" are the same beat twice, and plain
  // token overlap scores them low because the tails diverge.
  const frame = /\b(test(?:ing|s)?|waiting (?:for|to see)|see(?:ing)? (?:if|whether)|whether he|whether she|whether they)\b/i;
  if (frame.test(last) && frame.test(prev)) return true;
  return relevance(prev, last) >= 0.4 || relevance(last, prev) >= 0.4;
}

/** Run the intent pass for all present NPCs with stakes. Returns their private intents.
 *  Fires zero calls when nobody has stakes. One cheap call per staked NPC (usually 0–1). */
export async function runIntentPass(state: SaveState, playerAction: string): Promise<NpcIntent[]> {
  const present = state.world.present.filter((id) => {
    const c = state.characters[id];
    return c && c.status !== "dead" && c.status !== "departed" && c.central !== false;
  });
  const staked = present
    .map((id) => ({ id, reason: stakesFor(state, id) }))
    .filter((x): x is { id: string; reason: string } => !!x.reason);
  if (!staked.length) return [];

  // What the player AUDIBLY said / VISIBLY did — the only player input an NPC may react to.
  // Strip *private thoughts* and (parenthetical inner state); keep "speech" and plain action.
  const perceptibleAction = playerAction
    .replace(/\*[^*]*\*/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[:;,]\s*$/, "")
         .replace(/\s{2,}/g, " ")
    .trim() || "(the player did nothing others could perceive this beat)";

  const results = await Promise.all(staked.map(async ({ id, reason }) => {
    const c = state.characters[id];
    const cond = state.condition[id];
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    const belief = state.minds?.[id]?.about?.find((b) => b.target === "char_player")?.held_false;
    const ctx = [
      `CHARACTER: ${c.name}${c.pronouns ? ` (${c.pronouns})` : ""}, age ${c.age ?? "?"}.`,
      c.core_traits?.length ? `Nature: ${(Array.isArray(c.core_traits) ? c.core_traits.join(", ") : c.core_traits)}.` : "",
      c.voice?.agenda ? `Agenda (their subtext): ${c.voice.agenda}` : "",
      // The rule above turns on the blocker and the door, and this pass was never shown either of
      // them — the same shape as every other bug this engine has had: a pass told to act on state it
      // is not given. Without the blocker it cannot know the want is frightening; without the
      // approach it invents a door the character does not use.
      c.drive?.goal ? `Wants: ${c.drive.goal}${c.drive.blocker ? ` — but: ${c.drive.blocker}` : ""}` : "",
      // the want's own door if it has one, otherwise the person's — see doorFromVoice. A pass with
      // no door writes the surface AS the want, which is the announcement this rule exists to stop.
      (() => { const door = c.drive?.approach?.trim() || doorFromVoice(c);
               return door ? `How they go about it (the surface should be exactly this): ${door}` : ""; })(),
      `Mood: ${cond.psyche.mood || "even"}; openness ${cond.psyche.relaxation}.`,
      e ? `Toward the player: warmth ${e.warmth}, trust ${e.trust}${e.attraction !== undefined ? `, desire ${e.attraction}` : ""}${e.roles?.length ? `, roles ${e.roles.join("/")}` : ""} — ${dispositionCue(e.warmth ?? 0, e.trust ?? 0, effectiveStanding(e.power ?? 0, state.power_witnessed?.tier))}${belief ? `. WRONGLY BELIEVES: ${belief}` : ""}.` : "They barely know the player, so they are polite, sizing the player up, and noncommittal about favours, trust and risk. They still do their ordinary work or duty for a stranger the way they would for anyone.",
      `WHY THIS MOMENT MATTERS TO THEM: ${reason}`,
      priorIntentBlock(state, id),
      // THE LOOP THIS PASS CANNOT SEE FROM INSIDE ONE CALL. priorIntentBlock catches a want that
      // repeats in the same WORDS; it cannot catch six rewordings of one question, each derived
      // independently from a state that has not moved. The player can see all six, and when they
      // say so — "I already answered you", "I'm tired of repeating myself" — that is a direct
      // report on this pass's output, from the only participant with the whole sequence in front of
      // them. It is worth more than anything in the state, because the state is what is wrong.
      playerSaysAnswered(playerAction)
        ? `THE PLAYER HAS JUST SAID THEY ALREADY ANSWERED THIS AND ARE TIRED OF REPEATING THEMSELVES. They're right, so treat it as fact. Whatever this character has been waiting to hear, they heard it several moments ago. Don't write them still wanting it, still unsure about it, still working out how to get it out of the player, or hurt that it took so long. Write what a person does after they've got their answer: they accept it and act on it, or they decide plainly that they don't believe it and act on that, or they want something else now. The subject is closed, and by the end of this moment their attention has moved somewhere new.`
        : "",
      // This pass gets the player's raw words with the quotes intact and has to decide what they
      // meant before it writes the stance the narrator then plays. It is also the only pass that
      // knows which character is being addressed, so it can be told outright.
      deixisNote(c.name),
      `WHAT THE PLAYER SAID OUT LOUD OR VISIBLY DID: ${perceptibleAction}`,
    ].filter(Boolean).join("\n");

    try {
      const out = await complete(
        buildMessages(INTENT_SYSTEM, ctx, "Write this character's private intent for this moment. Reply with JSON only.", state.model_settings.simulator_model),
        state.model_settings.simulator_model, state.model_settings.fallback_model,
        { schema: INTENT_JSON_SCHEMA, name: "npc_intent" }, 400,
      );
      const j = safeJson<Partial<NpcIntent> | null>(out.text, null);
      if (!j || !j.surface) return null;
      const surface = clip(deQuoteIntent(String(j.surface)), 300);
      // A COLLAPSED INTENT IS WORSE THAN NO INTENT, and this used to be written as a convenience:
      // `j.truth ?? j.surface`. When the model omitted truth the engine handed the surface back as
      // the character's inner life, and nothing anywhere could tell the difference between "this
      // person's interior was authored" and "this person has no interior". In one 47-turn save 29
      // of 43 intents came back with the two fields byte-identical, including the scene the whole
      // story turned on — and the bookkeeper was then told that a description of her posture was her
      // "true inner state", so the prose had her announcing her feelings aloud because there was
      // nothing underneath to keep back. Now a collapse is detected and the intent is dropped: the
      // character gets rendered normally, which is honest, instead of carrying a hollow interior.
      const rawTruth = j.truth === undefined || j.truth === null ? "" : clip(deQuoteIntent(String(j.truth)), 300);
      /* A COLLAPSE COSTS THE TRUTH. IT USED TO COST THE WHOLE INTENT, AND THAT WAS THE EXPENSIVE HALF.
       *
       * Filing a description of somebody's posture as their "true inner state" is a real harm — the
       * bookkeeper reads this block as authoritative about interiority, and a hollow interior makes
       * the prose have people announce their feelings aloud because there is nothing underneath to
       * keep back. So the truth goes. But `return null` threw the SURFACE away with it, and the
       * surface is the only thing the narrator ever sees: intentForNarrator is deliberately given
       * surface and tell and never truth. Dropping it puts the character back to being written
       * free-hand from the card, which is the failure this whole module exists to prevent.
       *
       * Measured across five saves of one game — every present, living, central character-turn,
       * counted against the intents actually recorded — a character in the room got a committed
       * stance on 22-27% of their turns, and it decayed with game length: 50% at turn 20, 24% by
       * turn 169. Three turns in four, the narrator was choosing what everybody in the room was
       * doing, with nothing pre-committed to hold it. The pass was firing; the results were being
       * binned. The player's report on those saves was that the cast made no sense and the story
       * came apart the longer it ran.
       *
       * So: keep the stance, withhold the interior. The narrator gets what it was always given, the
       * bookkeeper hears nothing rather than something false, and `lying` goes false because a
       * concealment claim with no concealed fact behind it is the same lie in the other direction. */
      const clean = rawTruth && !collapsed(surface, rawTruth);
      if (!clean) console.warn(`[intent] ${c.name}: no distinct inner state came back — keeping the stance, filing no interior`);
      return {
        char_id: id, name: c.name,
        surface,
        truth: clean ? rawTruth : undefined,
        tell: j.tell ? clip(deQuoteIntent(String(j.tell)), 200) : undefined,
        lying: clean ? !!j.lying : false,
      } as NpcIntent;
    } catch {
      return null; // a failed intent call just means this NPC gets rendered normally this turn
    }
  }));

  return results.filter((x): x is NpcIntent => !!x);
}

export const INTENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["surface", "truth", "tell", "lying"],
  properties: {
    surface: { type: "string" },
    truth: { type: "string" },
    tell: { type: "string" },
    lying: { type: "boolean" },
  },
} as const;

/** Format the intents for the NARRATOR: surface + optional tell ONLY. The narrator must NOT
 *  receive `truth` — it renders deniable behavior so the player sees the surface and reads (or
 *  misreads) the tell, never the decoded answer. */
export function intentForNarrator(intents: NpcIntent[]): string {
  if (!intents.length) return "";
  const lines = intents.map((i) => {
    const bits = [`${i.name} — shows: ${i.surface}`];
    // THE TELL IS THE WHOLE CHANNEL. The narrator is never shown `truth` — deliberately, and
    // correctly — so the tell is the only route by which anything happening inside a character
    // reaches the reader at all. It was optional, its description ended "omit if they mask cleanly",
    // and across 206 recorded intents in three saves not one carried one. The cast rendered as pure
    // surface for an entire playthrough, which is exactly what "they have the emotional range of a
    // horse fly" describes. It is required now, and it is not a suggestion here either.
    if (i.tell) bits.push(`AND THIS SHOWS. Put it on the page as something the body does, never as the name of a feeling, and don't explain it: ${i.tell}`);
    return `- ${bits.join("; ")}`;
  });
  return `\n\n=== WHAT THE CHARACTERS PRESENT LET SHOW (write it as behaviour and don't state their hidden reasons; the player reads them the way anyone reads a face) ===\n${lines.join("\n")}`;
}

/**
 * Format the intents for the BOOKKEEPER: the TRUTH, and ONLY the truth.
 *
 * `surface` used to go too, under a header calling the whole block authoritative and telling the
 * bookkeeper to record from it "not from the prose". Read what that combination actually says: a
 * plan written BEFORE the scene existed outranks the scene. It does not describe a turn. It
 * describes what each person was going to bring to one.
 *
 * A player handed one pair of shoes to one woman in an upstairs room. Two other characters were
 * downstairs and the narrator said so plainly — "Tigris had not moved from her corner. Clodia's rag
 * kept its slow circle on the counter." Their intents, drafted before any of that was written, had
 * them each accepting a pair. The bookkeeper obeyed the header, and the turn went into the record
 * as "Tigris and Clodia receive their own pairs with guarded reactions". Nine turns later the woman
 * who had actually been given the shoes said, to the player's face, "I watched you give Tigris
 * shoes" — and the player had to argue with the engine about something he had never done.
 *
 * The split the module was designed around is the right one and this is it enforced: `surface` is a
 * stance for the NARRATOR to render, `truth` is inner state for the BOOKKEEPER to file. Interiority
 * is the one thing prose genuinely hides and the one thing this pass is authoritative about.
 * Events are the prose's job and nothing else's.
 */
export function intentForBookkeeper(intents: NpcIntent[]): string {
  // Only the ones that came back with an interior distinct from the posture. A stance-only intent
  // is real and useful and it is the narrator's; there is nothing here for the bookkeeper to file.
  intents = intents.filter((i) => i.truth?.trim());
  if (!intents.length) return "";
  const lines = intents.map((i) =>
    `- ${i.name} [${i.char_id}] — ${i.lying ? `WAS CONCEALING SOMETHING. What they hid: ${i.truth}` : `true inner state: ${i.truth}`}`);
  return `\n\n=== WHAT THE CHARACTERS PRESENT WERE REALLY FEELING THIS TURN (trust this for their inner state only; the prose deliberately hides it, so take mood, hidden wants, and "lied to the player about X" from here) ===\n${lines.join("\n")}\n`
    + `THIS IS NOT A RECORD OF WHAT HAPPENED. It was written before the scene was, so it only describes what each person brought into the moment. Take events, meaning who spoke, who was in the room, who was given what, who went where and what anyone found out, from the NARRATOR PROSE only. If something above doesn't appear in the prose, it didn't happen: leave it out of scene_summary, don't record it as a memory, and don't let anyone find out about it.`;
}
