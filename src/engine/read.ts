// ─────────────────────────────────────────────────────────────────────────────
// THE READ CHANNEL
//
// Weft's oldest prose failure is the narrator adjudicating other people: motive
// stated as fact ("Pell has put his shuttle down to listen and is pretending he
// hasn't"), gestures captioned with their meaning, similes whose vehicle imports
// the emotional verdict ("the way a physician takes a pulse"). Every version of
// the fix so far has been a PROHIBITION in the narrator prompt, and prohibitions
// do not survive generation: a model asked to write a person and forbidden to say
// anything about their interior writes camera-script, notices the flatness, and
// smuggles the interpretation back in through a subordinate clause.
//
// The failure is structural, not stylistic. The narrator holds every character's
// true inner state (it needs it to decide behavior) AND writes the page. Asking it
// to filter its own omniscience every sentence is asking it to hold two contexts
// and drop one, forever, under length pressure.
//
// So: split the job. The narrator writes ONLY the observable surface, at every
// relaxation level, with no graded license. Interpretation moves here — to a
// separate call that is never handed the NPC's psyche, drive, mind model, or
// intent, and therefore CANNOT leak them. It sees what the player saw and who the
// player is. Its output is attributed to a named faculty of the player's own
// perception, in first person, and is frequently wrong.
//
// This is the Disco Elysium arrangement, and worth being precise about why it
// works: DE's narrator is far MORE interpretive than Weft's, not less. It never
// reads as adjudication because every interpretation has an owner who can be
// discredited, and the owners contradict each other. Interpretation isn't the
// problem. UNOWNED interpretation is.
//
// The relaxation scalar changes jobs here too. It used to govern how much truth
// the narrator handed over — an invisible prose modulation the player could only
// perceive as tonal mush. Now it governs how ACCURATE the player's own faculties
// are, and how much they fight each other. Same number, visible mechanic.
//
// PROMPTS LIVE IN THIS FILE, deliberately, and not in prompts.ts: the sealed
// context is the whole guarantee, and keeping this prompt physically apart from
// the narrator's module removes the class of accident where a refactor folds a
// read prompt into narrator context and hands it the ground truth back.
// ─────────────────────────────────────────────────────────────────────────────

import type { SaveState } from "./types";
import { buildMessages, complete, safeJson } from "../llm";

/** One faculty of the player's perception — derived from their card, not a fixed skill list.
 *  Stable across a playthrough so the player learns to distrust specific ones by name. */
export interface Faculty {
  name: string;      // 1–3 words, the player's own idiom. Not an RPG stat.
  notices: string;   // what this faculty actually picks up on
  distorts: string;  // the specific direction it lies in when the body is clenched
}

/** One read of the focused character, this turn. Owned, first-person, possibly wrong. */
export interface Read {
  faculty: string;
  line: string;
}

// ── faculty derivation ───────────────────────────────────────────────────────

const FACULTY_SYSTEM = `You derive a person's PERCEPTUAL APPARATUS from their character card — the specific, biased ways THIS person reads other people. Not a skill list, not stats: the four to six habits of attention this particular nervous system actually has, given who they are and what happened to them.

Each faculty gets:
- name: 1–3 words in the PLAYER'S OWN IDIOM — drawn from their history, work, upbringing, or body. "OLD ARITHMETIC", "THE FLINCH", "COUNTING THE EXITS", "SHOPKEEPER'S EYE". Never a generic RPG stat name (no "Empathy", "Perception", "Insight", "Logic", "Intuition"). Never abstract virtue words.
- notices: one plain sentence — the concrete class of signal it catches. Faces, hands, money, distance, who eats first, whose voice drops. Filmable inputs.
- distorts: one plain sentence — the SPECIFIC wrong conclusion it reaches under pressure. Not "it can be inaccurate": name the error. "Reads any pause as contempt." "Turns confusion into rejection." "Credits kindness it hasn't been shown yet."

HARD BANS. A faculty attends to something a camera could record: a hand, a pause, a distance, a change of pitch, where somebody looks. It may not be a faculty for knowing another person's inside on sight, and it may not be stated as a comparison. THE TEST, applied to every faculty you write: could a camera capture what this one attends to? If not, rewrite it until it can.

The set should DISAGREE with itself. A person whose faculties all point the same way has one faculty. At least one should be generous, at least one should be suspicious, and they should be able to look at the same gesture and reach opposite conclusions.

Derive from the card given — traits, values, attachment, history, work, body. A person who grew up hungry has a faculty about food and who is served first. A person trained to close deals has one about the moment someone stops arguing. Do not invent history the card does not contain.

Output ONLY JSON: {"faculties":[{"name":"","notices":"","distorts":""}]}`;

/** Faculties are re-derived rarely — they are the player's apparatus, not their mood.
 *  Trigger: never derived, or the card has materially changed (traits acquired, vessel swapped). */
export function needsFaculties(state: SaveState): boolean {
  const f = state.faculties;
  if (!f || !f.list?.length) return true;
  const traitCount = (state.traits["char_player"] ?? []).length;
  return traitCount !== (f.trait_count ?? -1);
}

export async function deriveFaculties(state: SaveState): Promise<Faculty[]> {
  const pc = state.characters["char_player"];
  if (!pc) return [];
  const traits = (state.traits["char_player"] ?? [])
    .map((t) => `${t.label} (${t.behavioral_impact})`).join("; ");
  const card = [
    `NAME: ${pc.name}, age ${pc.age}`,
    `BACKGROUND: ${pc.background}`,
    pc.life_history ? `SINCE THEN: ${pc.life_history}` : "",
    `CORE TRAITS: ${(pc.core_traits ?? []).join("; ")}`,
    `VALUES: ${(pc.values ?? []).join("; ")}`,
    pc.texture?.length ? `TEXTURE: ${pc.texture.join("; ")}` : "",
    Object.keys(pc.skills ?? {}).length ? `SKILLS: ${Object.entries(pc.skills).map(([k, v]) => `${k} (${v})`).join("; ")}` : "",
    pc.attachment ? `ATTACHMENT: ${pc.attachment.style}${pc.attachment.under_threat ? ` — under threat: ${pc.attachment.under_threat}` : ""}` : "",
    typeof pc.conscience === "number" ? `CONSCIENCE: ${pc.conscience.toFixed(2)} (how much others' experience registers as mattering)` : "",
    `INTELLIGENCE: ${pc.intelligence}`,
    traits ? `ACQUIRED IN PLAY: ${traits}` : "",
    `WORLD: ${state.world_bible.name} — ${state.world_bible.era}. ${state.world_bible.tone ?? ""}`,
  ].filter(Boolean).join("\n");

  const msgs = buildMessages(FACULTY_SYSTEM, "", card, state.model_settings.simulator_model);
  const res = await complete(
    msgs, state.model_settings.simulator_model, state.model_settings.fallback_model,
    true, 1200, { providerSort: "throughput" },
  );
  const out = safeJson<{ faculties?: Faculty[] }>(res.text, {});
  return (out.faculties ?? [])
    .filter((f) => f?.name && f?.notices)
    .slice(0, 6)
    .map((f) => ({ name: f.name.toUpperCase(), notices: f.notices, distorts: f.distorts ?? "" }));
}

// ── per-turn reads ───────────────────────────────────────────────────────────

const READ_SYSTEM = `You are ONE PERSON'S read of another person, in the moment, spoken by named faculties of their own perception. You are not a narrator. You have no access to the other person's mind and you are not pretending to have any — everything you produce is this player's conclusion, drawn from a surface, and it can be wrong.

You are given: who the player is, what state their body is in, what they already believe about this person, and the OBSERVABLE SURFACE of the scene — what was said and done, nothing else. That is all you get, because that is all they got.

WRITE EACH READ LIKE THIS:
- First person, present tense, the player's own voice. "She's already decided." "He wants me to ask."
- FLAT AND UNHEDGED. No "seems", "appears", "as if", "maybe", "I think", "something in the way". A read is a verdict; verdicts are stated. Wrongness comes from BEING wrong, never from hedging — a hedged read is mush and it is the exact failure this channel exists to replace.
- Under 20 words. Usually well under. A read is a thought, not a paragraph.
- NO NEW FACTS. You may not invent a gesture, an object, a line of dialogue, or anything the surface did not already contain. You interpret what is there. If the surface is thin, the read is thin.
- COMPARISONS, IF ANY, TOUCH ONLY PHYSICAL FORM, MOTION, TEXTURE, SOUND, OR SCALE. Never compare a person or an act to a ROLE, a PROFESSION, a RITUAL, a RELATIONSHIP, or an INTENTION: a comparison of that kind states the verdict inside itself, which is the one thing a read must earn rather than assert. Default to no comparison at all.
- Read the PERSON, not the plot. Never predict events, never name what will happen next in the story, never advise the player.
- Faculties may CONTRADICT each other outright. Two reads of the same gesture reaching opposite conclusions is correct and desirable — do not reconcile them, do not have the second one defer to the first.

THE BODY SETS HOW MUCH A READ CAN HOLD. This is the primary axis, and it is not about being nice or being right. A clenched body collapses a person down to ONE attribute, and it is the attribute that matters to the threat. An eased body can hold a person as two things at once that do not resolve into a verdict.
- CLENCHED (relaxation at or below -3): each read names exactly ONE thing about the person and admits nothing else. No "and". No qualifier, no partial credit, no second hand. Whatever else is true of them is not available. The read is confident and, in the direction that faculty's distortion names, WRONG — coldness where there is fear, rejection where there is confusion, a verdict where the other person had not decided anything. Never signal that it is unreliable; it has to feel like knowledge.
- UNSETTLED (between -3 and 3): mostly singular, but one read this turn may carry a second thing it can't reconcile.
- SETTLED (3 and above): a read may hold two things that sit side by side without resolving — she is cold, and she kept the food for me. Do not reconcile them, do not let the second one soften or cancel the first, and do not draw a conclusion from the pair. Holding the contradiction IS the settled state; a settled read that arrives at one tidy verdict has collapsed the same way a clenched one does.

READS ARISE, THEY ARE NOT REACHED. They come already finished, mixed in with the feeling that is already there, and nobody deliberated. Forbidden: "I wonder", "I realize", "I notice", "it occurs to me", "part of me thinks", and every other verb of arriving at a thought. No sentence describes the player thinking. The thought is simply the sentence.

Never mention relaxation, faculties as a system, the game, or any engine term. Never write the other person's interior as a fact about THEM in a neutral voice — every line belongs to the player and sounds like it.

EXAMPLES. These are the register — never reuse the wording.

GOOD (first person or direct address, flat, no figure of speech, a verdict this player could be wrong about):
  "She's already decided. This is the part where she tells me."
  "He wants me to ask. I'm not going to ask."
  "That was the soft version. That's the part to be frightened of."
  "His hand is the size of my head and he hasn't put it down."
  "She's counting how many times I've lied to her tonight."

BAD, and why:
  "She is a machine built of facts, clicking through her internal gears." — figurative mush; the whole line is a metaphor doing the work a plain sentence should do.
  "He is a giant container for secrets that hum." — same, and it says nothing a person could act on.
  "She watches him the way she reads a difficult passage." — comparison to an ACTIVITY, which smuggles the verdict into the vehicle.
  "Something in the way she says it makes me think she's angry." — hedged; a read is stated, not attributed.
  "She seems uncertain, though it's hard to tell." — hedged twice; this is the mush this channel exists to replace.
  "He is calculating what my sorting means for him." — this is narration of his interior, not the player's read. Say what the PLAYER concludes: "He's already worked out what I'm worth to him."

Output ONLY JSON: {"reads":[{"faculty":"EXACT NAME GIVEN","line":""}]}`;

/** How many faculties fire, and which. Deterministic — the body decides.
 *  Clenched: three, arguing. Settled: one or two, agreeing. Rotates by turn so a
 *  long playthrough doesn't hear the same two voices every scene. */
export function pickFaculties(list: Faculty[], relax: number, turn: number): Faculty[] {
  if (!list.length) return [];
  const count = Math.min(list.length, relax <= -3 ? 3 : relax < 3 ? 2 : (turn % 3 === 0 ? 2 : 1));
  const start = turn % list.length;
  const out: Faculty[] = [];
  for (let i = 0; i < count; i++) out.push(list[(start + i) % list.length]);
  return out;
}

/** The SEALED context. Everything here is player-side.
 *
 *  What this function must never touch, in any future edit:
 *    state.condition[targetId]        — the target's psyche/relaxation/mood
 *    state.characters[targetId].drive — what they actually want
 *    state.minds[targetId]            — their model of the player
 *    gm_intents / the turn's authored surface-vs-truth split
 *
 *  The channel is safe because the data is absent, not because the prompt says
 *  not to use it. Keep it that way. */
function lens(state: SaveState, targetId: string | null, surface: string, relax: number): string {
  const pc = state.characters["char_player"];
  const target = targetId ? state.characters[targetId] : undefined;
  const psy = state.condition["char_player"]?.psyche;
  const mem = state.memory["char_player"];
  const about = state.minds?.["char_player"]?.about?.find((b) => b.target === targetId);

  // The player's own memories that name this person — their history with them, as
  // THEY hold it (already decayed, already reconstructed). Not the true record.
  const name0 = (target?.name ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  const recalled = (mem?.episodic ?? [])
    .filter((m) => name0 && m.content.toLowerCase().includes(name0))
    .sort((a, b) => (b.importance - a.importance) || (b.turn - a.turn))
    .slice(0, 4)
    .map((m) => `- ${m.content}${m.emotional_charge ? ` [${m.emotional_charge}]` : ""}`)
    .join("\n");
  const beliefs = (mem?.beliefs ?? [])
    .filter((b) => name0 && b.content.toLowerCase().includes(name0))
    .slice(0, 2).map((b) => `- ${b.content}`).join("\n");

  return [
    `=== WHO IS READING ===`,
    `${pc?.name ?? "the player"}, ${pc?.age ?? "?"}. ${pc?.background ?? ""}`,
    (pc?.core_traits ?? []).length ? `Traits: ${pc!.core_traits.join("; ")}` : "",
    (pc?.values ?? []).length ? `Values: ${pc!.values.join("; ")}` : "",
    pc?.attachment ? `Attachment: ${pc.attachment.style}${pc.attachment.under_threat ? ` — under threat, ${pc.attachment.under_threat}` : ""}` : "",
    ``,
    `=== THE BODY DOING THE READING ===`,
    `Relaxation: ${Math.round(relax)} (-10 clenched .. +10 open). Mood: ${psy?.mood ?? "—"}.`,
    psy?.active_states?.length ? `Carrying: ${psy.active_states.join(", ")}.` : "",
    (psy?.betrayals ?? 0) >= 2 ? `Has swallowed ${psy!.betrayals} things lately without saying them.` : "",
    ``,
    `=== WHO IS BEING READ (surface only — this is everything the player knows) ===`,
    target
      ? `${target.name}${target.pronouns ? ` (${target.pronouns})` : ""}. ${target.appearance_now || target.appearance_facts || ""}`
      : `Nobody here is someone the player has a history with. Read whoever the surface puts in front of them — the one doing something, the one who spoke. Strangers get read hardest, because nothing about them can be predicted.`,
    about ? `The player expects them to feel ${about.predicted_warmth > 20 ? "warmly" : about.predicted_warmth < -20 ? "coldly" : "neutrally"} toward them, and reads them as ${about.predicted_stance}. Confidence ${about.confidence.toFixed(2)}.` : "",
    about?.held_false ? `The player wrongly believes: ${about.held_false}. This belief is LOAD-BEARING — let it shape the reads without ever being examined.` : "",
    (about?.surprise ?? 0) > 0.4 ? `This person has recently done things the player did not predict.` : "",
    recalled ? `\nWhat the player carries about them:\n${recalled}` : "",
    beliefs ? `${beliefs}` : "",
    ``,
    `=== THE SURFACE (what just happened, as seen and heard) ===`,
    surface,
  ].filter((l) => l !== "").join("\n");
}

/** Fire the read channel. Runs CONCURRENTLY with the narrator stream — this is the
 *  work that fills the wait, and it is the player's own head, which is where a
 *  CRPG puts you while the world takes its turn.
 *
 *  Never throws: a failed read is a quiet turn, not a broken one. */
export async function runReads(
  state: SaveState, targetId: string | null, surface: string, turn: number,
): Promise<Read[]> {
  try {
    const list = state.faculties?.list ?? [];
    const relax = state.condition["char_player"]?.psyche?.relaxation ?? 0;
    const firing = pickFaculties(list, relax, turn);
    if (!firing.length) return [];

    const roster = firing
      .map((f) => `${f.name} — notices: ${f.notices}${f.distorts ? ` | under pressure: ${f.distorts}` : ""}`)
      .join("\n");
    const user = `${lens(state, targetId, surface, relax)}\n\n=== FACULTIES SPEAKING THIS TURN (exactly these, in this order, one line each) ===\n${roster}`;

    const msgs = buildMessages(READ_SYSTEM, "", user, state.model_settings.simulator_model);
    const res = await complete(
      msgs, state.model_settings.simulator_model, state.model_settings.fallback_model,
      true, 600, { providerSort: "throughput", omitReasoning: true },
    );
    const out = safeJson<{ reads?: Read[] }>(res.text, {});
    const valid = new Set(firing.map((f) => f.name));
    return (out.reads ?? [])
      .filter((r) => r?.line && valid.has((r.faculty ?? "").toUpperCase()))
      .slice(0, 3)
      .map((r) => ({ faculty: r.faculty.toUpperCase(), line: r.line.trim() }));
  } catch {
    return [];
  }
}
