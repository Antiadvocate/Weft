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
import { dispositionCue } from "./desire";
import { relevance } from "./memory";
import { doorFromVoice } from "./coerce";
import { playerSaysAnswered, deixisNote } from "./turn";

export interface NpcIntent {
  char_id: string;
  name: string;
  surface: string;   // what they let show — for the narrator
  truth: string;     // what's actually true (lie/hidden want/withheld feeling) — for the bookkeeper
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
    if (e.trust <= -20) reasons.push(`distrusts the player (${e.trust}) — may conceal or mislead`);
  }
  // a false belief the NPC holds about the player (from the theory-of-mind layer) is prime lie/drama fuel
  const belief = state.minds?.[id]?.about?.find((b) => b.target === "char_player")?.held_false;
  if (belief) reasons.push(`wrongly believes: ${belief}`);
  // clenched + low openness → likely withholding rather than open
  if (cond.psyche.relaxation <= -3) reasons.push(`clenched (openness ${cond.psyche.relaxation}) — more likely to mask than to show plainly`);
  return reasons.length ? reasons.join("; ") : null;
}

export const INTENT_SYSTEM = `You author the PRIVATE, TRUE intent of a single character for one beat of a story — what they are ACTUALLY doing beneath what they let show. This is the character's own truth, drawn ONLY from who they are and their situation, NEVER from the player's private thoughts (you are not given those, and the character cannot know them).

Return ONE strict JSON object, nothing else:
{"surface":"HOW they carry themselves this beat — posture, manner, degree of openness, what they are willing to raise and what they hold back. A brief, in a few words. NEVER a line of dialogue and NEVER quoted speech: you are authoring intent BEFORE the scene is written, so any words you put in their mouth are words they did not say. The narrator writes what is actually spoken; you describe only the stance they bring to it.","truth":"what is going on INSIDE them, in words that could not describe a body: the real want, what they are afraid of, the feeling being withheld, what they are hoping this beat produces. If they lie, name the lie AND the fact being hidden. NEVER a restatement of the surface — if this field describes posture, manner, or an action, it is wrong and you have written the surface twice.","tell":"REQUIRED. The one crack in the surface — a small, deniable leak of the truth that a person in the room could catch or could miss: a flicker, a too-quick reply, a hand that stills, a breath taken at the wrong time. This is the ONLY way anything you write in truth ever reaches the page, because the narrator is never shown truth. Without it the character renders as their surface and nothing else, and a person with a whole inner life reads as somebody with none. It must not decode the truth — it is the crack, not what is behind it — and it must be a THING THE BODY DOES, never a feeling named. The more the surface and the truth diverge, and the more clenched the body, the more there is to leak: a composed person under nothing leaks a flicker, a person holding something enormous leaks something anybody would notice and nobody could prove.","lying":true or false}

Rules:
- The character acts from THEIR nature, agenda, and feelings — sovereign, not in service of the player. They pursue their own want this beat.
- THE TWO FIELDS ARE DIFFERENT KINDS OF THING AND ARE NEVER THE SAME SENTENCE. surface is what a CAMERA GETS: posture, manner, what they raise, what they hold back. truth is what is going on INSIDE them: the want, the fear, the thing they are not saying, what they are hoping happens. A camera cannot photograph a want, and a feeling has no posture, so these two can never be written in the same words. Copying the surface into truth is the single most damaging thing you can return: it tells the rest of the engine that this person has no interior, and the scene that comes out has them announcing their own feelings out loud because there was nothing underneath for the prose to keep back. If you find yourself about to repeat the surface, you have not written the truth yet — ask what they WANT out of the next two minutes and what they are afraid of, and write that.
- WRITE THE TWO IN DIFFERENT REGISTERS EVEN WHEN NOTHING IS BEING CONCEALED. An honest, open person's surface and truth AGREE — no lie, "lying" is false, nothing is being concealed — and they are still completely different sentences, because one is a body in a room and the other is a state of mind. "She sets the plates down and says she will start on the salad" is a surface. "She is relieved he is home and the sting of what he said has not gone" is the truth that goes under it. Most beats look like that. Deception is rare; interiority is universal.
- DIVERGENCE-AS-DECEPTION IS STILL ONE TOOL, NOT THE DEFAULT. Do not manufacture a hidden agenda, a secret scheme, or a dark reading of the player where the state shows only ordinary feeling. A resigned, hurt, or wary person is usually just that underneath — but "just that underneath" is a sentence about their inside, and it is what belongs in truth.
- A WANT THEY ARE AFRAID OF DOES NOT COME OUT AS THE WANT. When the character's active pursuit carries a blocker that is a fear, a cost, or a thing they cannot say, the SURFACE is the sideways move and the TRUTH is what it is really for: raising the adjacent subject, asking a question so the other person volunteers it, floating a small deniable version, telling it as someone else's story. That is not a lie and "lying" stays false — it is how a person approaches something that frightens them. Writing the surface AS the want ("she tells him she needs to talk about the thing") turns a scene of approach into an announcement, and the whole story starts sounding like a novel instead of like people. If they carry a "goes at it by" line, the surface is that.
- CALIBRATE TO THE STATE — the truth must be PROPORTIONAL to the character's actual disposition (given as warmth/trust with their plain-language meaning). Mild negatives are mild: warmth slightly below zero is "a little hurt, a little guarded", NOT terror; low trust is "cautious, watching", NOT conviction that the player is a monster. Do NOT escalate a wary or resigned character into someone secretly certain the player is a manipulator, a monster, a hollow shell, or a danger — that is invention, and it poisons how the character is played. Only write fear, hatred, or a dark verdict when the warmth/trust and history genuinely support that intensity. If the numbers say "mildly hurt but still cares," the truth is mildly hurt, full stop.
- The character reacts to what the player actually SAID and DID this beat and to their real history — never to a sinister interpretation the state doesn't justify. If nothing hostile has actually happened, the character is not secretly seething about it.
- Keep each field to one or two tight sentences, naming what is actually there — a person, an object, an act, a thing owed. TWO IS THE CEILING, not a target: these are stored and rendered at a fixed width, and a third sentence is cut off, which reads as the thought being lost mid-way rather than the field having a limit.
- NO QUOTATION MARKS ANYWHERE IN YOUR OUTPUT. Not in surface, not in truth, not in tell. A quoted line here becomes a sentence the player is later shown as something the character said, when it was never spoken in the story at all — the surest way to make the whole system look like it is fabricating.
- NEVER reference the player's unspoken thoughts or feelings. The character reacts only to what the player audibly said and visibly did.

- NO UNSTATED PASS CONDITION. "She is testing whether he will X" is a legitimate intent exactly once, and only when X is a thing the player could actually work out from what has been said aloud. It is forbidden as a standing state. A character who requires something specific from the player and will not name it makes the player unable to succeed by any action available to them: they answer, they are told it is not the thing, they are not told what the thing is. One save ran six consecutive beats of "she is testing whether he will…", each gated on something he had not said and none of it ever named, and the player — who had answered every time — said they felt they were going insane. That is the correct response to it.
  So: if this character is waiting on something specific, either they SAY WHAT IT IS this beat, plainly, in words the narrator can put in their mouth — or the wait stops being a condition and they proceed. Wanting something is fine. Withholding what it is, while judging the player for not providing it, is not.

- YOU HAVE WRITTEN THIS CHARACTER BEFORE. Their last few intents are given below when they exist. Do not restate one. If the situation genuinely has not moved, that IS the news, and a real person does something about it — they say the thing outright, they act instead of waiting, they change what they want, or they let it go. Repeating an intent means the scene has stalled and you are the one holding it still. Nobody tests the same question three times.

- TAKE THE YES. If the player has now given the thing this character was waiting for, the want is MET. Write what a person does after they get what they asked for — relief, awkwardness, a new want, wanting more of it, not knowing where to put their hands. Do not write them re-opening it, discounting it for how it arrived, or moving on to a fresh test. That is the same failure wearing a new sentence.`;

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
  return `INTENTS YOU ALREADY WROTE FOR THIS CHARACTER (do not restate any of them):\n${lines}`
    + (stuck
      ? `\nTHIS HAS NOW REPEATED. The scene is stalled and this pass is what is holding it still. This beat the character MOVES: they say the thing outright in plain words, or they act on it instead of waiting, or they want something else, or they drop it. They do not test the same question again, and they do not rephrase it.`
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

export function clip(t: string, max: number): string {
  const s = t.trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  // only take the sentence boundary if it keeps most of the budget — otherwise we throw away
  // the substance to gain a full stop
  if (lastStop >= max * 0.5) return head.slice(0, lastStop + 1).trim();
  if (/[.!?]$/.test(head)) return head.trim();
  return head.slice(0, head.lastIndexOf(" ")).trim().replace(/[,;:]$/, "") + "…";
}

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
               return door ? `How they go at it (their door — the surface should BE this, not the want): ${door}` : ""; })(),
      `Mood: ${cond.psyche.mood || "even"}; openness ${cond.psyche.relaxation}.`,
      e ? `Toward the player: warmth ${e.warmth}, trust ${e.trust}${e.attraction !== undefined ? `, desire ${e.attraction}` : ""}${e.roles?.length ? `, roles ${e.roles.join("/")}` : ""} — ${dispositionCue(e.warmth ?? 0, e.trust ?? 0)}${belief ? `. WRONGLY BELIEVES: ${belief}` : ""}.` : "They barely know the player — polite, measuring, noncommittal about favors, trust, and risk. That is NOT blanket refusal: their ordinary trade or duty they perform for a stranger as they would for anyone, at the usual price.",
      `WHY THEY HAVE STAKES THIS BEAT: ${reason}`,
      priorIntentBlock(state, id),
      // THE LOOP THIS PASS CANNOT SEE FROM INSIDE ONE CALL. priorIntentBlock catches a want that
      // repeats in the same WORDS; it cannot catch six rewordings of one question, each derived
      // independently from a state that has not moved. The player can see all six, and when they
      // say so — "I already answered you", "I'm tired of repeating myself" — that is a direct
      // report on this pass's output, from the only participant with the whole sequence in front of
      // them. It is worth more than anything in the state, because the state is what is wrong.
      playerSaysAnswered(playerAction)
        ? `THE PLAYER HAS JUST SAID THEY ALREADY ANSWERED THIS AND ARE TIRED OF REPEATING IT. They are right; take it as fact. Whatever this character has been waiting to hear, they have heard it — several beats ago. Do NOT write them still wanting it, still unsure of it, still working out how to get it out of the player, or hurt that it took this long. Write what a person does AFTER they get the answer: they take it and act on it, or they decide plainly that they do not believe it and act on THAT, or they want something else now. The subject is closed and their attention is somewhere new by the end of this beat.`
        : "",
      // This pass gets the player's raw words with the quotes intact and has to decide what they
      // meant before it writes the stance the narrator then plays. It is also the only pass that
      // knows which character is being addressed, so it can be told outright.
      deixisNote(c.name),
      `WHAT THE PLAYER AUDIBLY SAID / VISIBLY DID: ${perceptibleAction}`,
    ].filter(Boolean).join("\n");

    try {
      const out = await complete(
        buildMessages(INTENT_SYSTEM, ctx, "Author this character's private intent for this beat. JSON only.", state.model_settings.simulator_model),
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
      if (!rawTruth || collapsed(surface, rawTruth)) {
        console.warn(`[intent] ${c.name}: surface and truth collapsed — dropping the intent rather than filing posture as inner state`);
        return null;
      }
      return {
        char_id: id, name: c.name,
        surface,
        truth: rawTruth,
        tell: j.tell ? clip(deQuoteIntent(String(j.tell)), 200) : undefined,
        lying: !!j.lying,
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
    if (i.tell) bits.push(`AND THIS GETS THROUGH — put it on the page, as the body doing it and never as a feeling named, and do not explain it: ${i.tell}`);
    return `- ${bits.join("; ")}`;
  });
  return `\n\n=== WHAT PRESENT CHARACTERS LET SHOW (render as behavior; do NOT state their hidden reasons — the player reads them like anyone reads a face) ===\n${lines.join("\n")}`;
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
  if (!intents.length) return "";
  const lines = intents.map((i) =>
    `- ${i.name} [${i.char_id}] — ${i.lying ? `WAS CONCEALING SOMETHING. What they hid: ${i.truth}` : `true inner state: ${i.truth}`}`);
  return `\n\n=== WHAT PRESENT CHARACTERS WERE ACTUALLY FEELING THIS TURN (authoritative for INNER STATE ONLY — the prose deliberately hides it, so take mood, hidden wants, and "lied to the player about X" from here) ===\n${lines.join("\n")}\n`
    + `THIS IS NOT A RECORD OF WHAT HAPPENED. It was written before the scene was, so it describes what each person carried into the beat, not what they did in it. Take EVENTS — who spoke, who was in the room, who was handed what, who went where, what anyone learned — from the NARRATOR PROSE only. If something above does not appear in the prose, it did not happen: keep it out of scene_summary, do not record it as a memory, and do not let anyone come to know it.`;
}
