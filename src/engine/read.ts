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
import type { NpcIntent } from "./intent";  // type-only: erased at compile, no runtime cycle

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

const FACULTY_SYSTEM = `You work out, from a character card, how this person reads other people: the particular, biased habits of attention that this one person has. List the four to six habits of attention they really have, given who they are and what has happened to them.

Each habit gets:
- name: one to three words in the player's own way of talking, taken from their history, work, upbringing or body. For example, "THE FLINCH", "COUNTING THE EXITS", "MOTHER'S EAR" or "NIGHT-WATCH EYES". Never use a generic game stat name like "Empathy", "Perception", "Insight", "Logic" or "Intuition", and never use abstract words for virtues.
- notices: one plain sentence about the concrete kind of signal it picks up, such as faces, hands, clothes, distance, who eats first or whose voice drops. It has to be something a camera could record.
- distorts: one plain sentence naming the specific wrong conclusion it jumps to under pressure. "It can be inaccurate" isn't enough; name the mistake. For example, "Reads any pause as contempt", "Turns confusion into rejection", or "Gives people credit for kindness they haven't shown yet".

Some things aren't allowed. A habit pays attention to something a camera could record, like a hand, a pause, a distance, a change in pitch or where somebody looks. It can't be a way of knowing what's going on inside another person just by looking at them, and it can't be phrased as a comparison. Check every habit you write by asking whether a camera could capture what it pays attention to, and if not, rewrite it until it could.

The habits should disagree with each other, because habits that all point the same way are really just one habit. At least one should be generous and at least one should be suspicious, and they should be able to look at the same gesture and come to opposite conclusions.

Work from the card you're given: traits, values, attachment style, history, work and body. Someone who grew up hungry has a habit about food and who gets served first. Someone who spent years breaking up fights has one about the moment somebody stops arguing. Don't invent history that isn't on the card.

Reply with only JSON: {"faculties":[{"name":"","notices":"","distorts":""}]}`;

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
    typeof pc.conscience === "number" ? `CONSCIENCE: ${pc.conscience.toFixed(2)} (how much other people's experience matters to them)` : "",
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

const READ_SYSTEM = `You are one person's reading of another person in the moment, spoken by the named habits of attention that person has. You aren't the narrator. You have no access to the other person's mind and you don't pretend to. Everything you write is the player's own conclusion, drawn from what they could see and hear, and it can be wrong.

You're given who the player is, what state their body is in, what they already believe about this person, and what could be seen and heard in the scene, meaning what was said and done and nothing else. That's all the player has to go on, so it's all you get.

Write each read like this:
- In the first person and present tense, in the player's own voice. For example, "She's already decided." or "He wants me to ask."
- State it flatly, without hedging. Don't use "seems", "appears", "as if", "maybe", "I think" or "something in the way". Say each read as a conclusion. A wrong read is stated just as flatly as a right one, because a hedged read is no use here.
- One short sentence, about as long as a real thought.
- No new facts. You can't invent a gesture, an object, a line of dialogue, or anything else that wasn't already in what was seen and heard. You interpret what's there, so if there isn't much to go on, the read is thin too.
- If you use a comparison at all, it can only be about physical shape, movement, texture, sound or size. Never compare a person or an action to a role, a job, a ritual, a relationship or an intention, because a comparison like that hides a conclusion inside it. Usually, don't use a comparison at all.
- Read the person in front of them. Never predict events, never say what will happen next in the story, and never give the player advice.
- Different habits can flatly contradict each other. Two reads of the same gesture reaching opposite conclusions is right and welcome, so don't reconcile them and don't have the second one give way to the first.

The state of the player's body decides how complicated a read can be, and this matters more than anything else here. When the body is tense, a person gets reduced to one quality, whichever one matters most to the threat. When the body is relaxed, it can hold a person as two things at once that don't settle into a verdict.
- TENSE (relaxation at or below -3): each read names exactly one thing about the person and allows nothing else. Don't use "and", and don't add a qualifier, partial credit or an "on the other hand". Whatever else is true about them just isn't available. The read is confident and, in the direction that habit's distortion describes, wrong: it sees coldness where there's fear, rejection where there's confusion, or a decision where the other person hadn't decided anything. Never hint that it's unreliable, because it has to feel like knowledge.
- UNSETTLED (between -3 and 3): mostly one thing, but one read this turn can hold a second thing it can't reconcile with the first.
- SETTLED (3 and above): a read can hold two things side by side without resolving them, like "she is cold, and she kept the food for me". Don't reconcile them, don't let the second one soften or cancel the first, and don't draw a conclusion from the pair. Keep both, because a settled read that boils down to one tidy conclusion is just as wrong as a tense one that doesn't.

Reads arrive already formed. They come finished, mixed in with whatever the player is already feeling, and nobody thought them through. Don't write "I wonder", "I realize", "I notice", "it occurs to me", "part of me thinks", or any other phrase about arriving at a thought. No sentence describes the player thinking; the thought is simply the sentence.

Never mention relaxation, the habits as a system, the game, or anything about how the engine works. Never state the other person's inner life as a fact about them in a neutral voice. Every line belongs to the player and should sound like them.

These examples show the form. Never reuse their wording.

GOOD (first person or speaking directly, flat, no figure of speech, and a conclusion this player could be wrong about):
  "She's already decided. This is the part where she tells me."
  "He wants me to ask. I'm not going to ask."
  "That was the soft version. That's the part to be frightened of."
  "His hand is the size of my head and he hasn't put it down."
  "She's counting how many times I've lied to her tonight."

BAD, and why:
  "She is a machine built of facts, clicking through her internal gears." This is figurative: the whole line is a metaphor doing the job a plain sentence should do.
  "He is a giant container for secrets that hum." Same problem, and it says nothing a person could act on.
  "She watches him the way she reads a difficult passage." This compares her to an activity, which hides the conclusion inside the comparison.
  "Something in the way she says it makes me think she's angry." This is hedged. A read is stated flatly, in the player's own voice.
  "She seems uncertain, though it's hard to tell." This is hedged twice.
  "He is calculating what my sorting means for him." This narrates what's going on inside him. Say what the player concludes instead: "He's already worked out what I'm worth to him."

Reply with only JSON: {"reads":[{"faculty":"EXACT NAME GIVEN","line":""}]}`;

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
    (psy?.betrayals ?? 0) >= 2 ? `Has kept ${psy!.betrayals} things to themselves lately without saying them.` : "",
    ``,
    `=== WHO IS BEING READ (only what can be seen and heard, which is everything the player knows) ===`,
    target
      ? `${target.name}${target.pronouns ? ` (${target.pronouns})` : ""}. ${target.appearance_now || target.appearance_facts || ""}`
      : `Nobody here is someone the player has a history with. Read whoever is in front of them, meaning the one doing something or the one who spoke. Strangers get read hardest, because nothing about them can be predicted.`,
    about ? `The player expects them to feel ${about.predicted_warmth > 20 ? "warmly" : about.predicted_warmth < -20 ? "coldly" : "neutrally"} toward them, and reads them as ${about.predicted_stance}. Confidence ${about.confidence.toFixed(2)}.` : "",
    about?.held_false ? `The player wrongly believes: ${about.held_false}. This belief matters most here, so let it shape the reads without ever questioning it.` : "",
    (about?.surprise ?? 0) > 0.4 ? `This person has recently done things the player didn't expect.` : "",
    recalled ? `\nWhat the player remembers and believes about them:\n${recalled}` : "",
    beliefs ? `${beliefs}` : "",
    ``,
    `=== WHAT JUST HAPPENED, AS SEEN AND HEARD ===`,
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
    const user = `${lens(state, targetId, surface, relax)}\n\n=== HABITS SPEAKING THIS TURN (exactly these, in this order, one line each) ===\n${roster}`;

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

// ─────────────────────────────────────────────────────────────────────────────
// SOVEREIGN PERCEPTION — the one gate in the seal, and why it is there
//
// Everything above this line is built on withholding. `lens()` is sealed from the
// target's psyche, drive, mind model and authored intent, and the seal is the
// whole guarantee: the channel cannot leak what it was never handed. The intent
// pass is sealed in the other direction — "the narrator is never shown truth" —
// so a character's real want, real fear and real lie are computed every single
// turn and read by nobody but the bookkeeper.
//
// That is correct for a person in a room. It stops being correct the moment the
// player switches on god mode and declares that they are reading somebody's mind,
// because then the engine is holding the exact answer to a question the player has
// sovereign authority to ask, and refusing it on a rule written for mortals. From
// a save: ninety-three authored intents for one character — "she is terrified, but
// the terror is buried under exhaustion and a last-second calculation", "she wants
// to shake you awake, to tell you that is a lie she has been telling herself for
// years" — every one of them computed, filed, and never once shown to the player
// whose story it was.
//
// SO THE GATE IS NARROW AND IT IS TWO CONDITIONS, both required: god mode is on,
// and the player DECLARED the act this turn. God mode by itself does not open it —
// a sovereign player who never asks keeps the fallible faculties and keeps the
// game, which is the point of the faculties. Declaring it opens it completely,
// because that is what sovereignty means.
//
// The truth is passed through VERBATIM and deterministically. No model rewrites it
// on the way out: a mind-read that arrives paraphrased is a mind-read the player
// has to trust somebody about, and there is nobody left to trust.
// ─────────────────────────────────────────────────────────────────────────────

/** The faculty a sovereign read is attributed to. Deliberately not one of the player's five —
 *  those are named for how they are WRONG, and this one is never wrong. Owning the line still
 *  matters (unowned interpretation is the failure this whole channel exists to fix); what changes
 *  is that this owner cannot be discredited. */
export const SOVEREIGN_FACULTY = "WHAT IS ACTUALLY THERE";

/** A declared act of perception. Conservative on purpose — a false positive hands over an interior
 *  the player did not ask for, which is the exact failure the seal was built against. Every pattern
 *  needs an explicit object (a mind, a thought, a head) or an explicit "what they are really/
 *  actually X" construction; nothing fires off a bare "I look at her". */
const MINDREAD = [
  /\b(?:read|reads|reading|hear|hears|hearing|listen(?:s|ing)? to|sense|senses|scan|scans|see|sees|look(?:s|ing)? (?:in|into|inside)|peer(?:s|ing)? (?:in|into|inside)|reach(?:es|ing)? into|dip(?:s|ping)? into|search(?:es|ing)?)\b[^.!?]{0,40}\b(?:mind|minds|thoughts?|head|inner voice)\b/i,
  /\b(?:mind|thoughts?)\b[^.!?]{0,30}\b(?:open to me|laid bare|bare to me|mine to read|are mine|is mine)\b/i,
  /\b(?:know|knows|see|sees|hear|hears|find out|learn)\b[^.!?]{0,30}\bwhat\b[^.!?]{0,30}\b(?:really|actually|truly)\b[^.!?]{0,20}\b(?:think\w*|feel\w*|want\w*|mean\w*)\b/i,
  /\b(?:know|knows|see|sees|hear|hears|find out|learn)\b[^.!?]{0,30}\bwhat\b[^.!?]{0,40}\b(?:hiding|not saying|isn'?t saying|holding back|won'?t say|concealing|keeping from me)\b/i,
];

/** Whose interior is the object of the sentence. "She reads my mind" trips every pattern above and
 *  is the opposite act — somebody reading the PLAYER — so it must not open the player's channel. */
const OWN_MIND = /\b(?:my|mine|my own)\s+(?:mind|thoughts?|head|inner voice)\b/i;
const OTHER_MIND = /\b(?:his|her|their|its|\w+'s|\w+s')\s+(?:mind|thoughts?|head|inner voice)\b/i;

/** Did the player declare that they are reading somebody this turn? */
export function declaresMindRead(action: string): boolean {
  const a = String(action ?? "");
  if (OWN_MIND.test(a) && !OTHER_MIND.test(a)) return false;
  return MINDREAD.some((re) => re.test(a));
}

/**
 * Who is being read.
 *
 * A named person present in the scene, or — when the action carries only a pronoun and exactly one
 * other person is in the room — that person. Two people and a bare "her" resolves to nobody, and
 * nothing opens: guessing which of them to expose is the one mistake this must not make.
 */
export function mindReadTarget(state: SaveState, action: string): string | null {
  const a = String(action ?? "").toLowerCase();
  const present = (state.world.present ?? []).filter((id) => id !== "char_player" && state.characters[id]);
  for (const id of present) {
    const first = (state.characters[id]?.name ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first.length >= 3 && a.includes(first)) return id;
  }
  return present.length === 1 ? present[0] : null;
}

/** The intent pass writes for the bookkeeper and says "the player" out loud. Shown to the player it
 *  is an engine artifact in the middle of their own perception, so it becomes the name. */
function inPlainWords(truth: string, state: SaveState): string {
  const name = (state.characters["char_player"]?.name ?? "").split(/\s+/)[0] || "them";
  return String(truth ?? "").replace(/\bthe player\b/g, name).replace(/\bThe player\b/g, name);
}

/**
 * The read itself: the character's authored truth for THIS turn, handed over as written.
 *
 * Returns nothing at all unless both conditions hold, and nothing when the intent pass produced no
 * intent for this person — an empty result is a quiet turn, never an invented one.
 */
export function sovereignRead(
  state: SaveState, action: string, intents: NpcIntent[],
): { reads: Read[]; targetId: string | null } {
  if (!state.world_bible?.god_mode || !declaresMindRead(action)) return { reads: [], targetId: null };
  const targetId = mindReadTarget(state, action);
  if (!targetId) return { reads: [], targetId: null };
  const it = intents.find((i) => i.char_id === targetId);
  if (!it?.truth?.trim()) return { reads: [], targetId };
  const first = (state.characters[targetId]?.name ?? "").split(/\s+/)[0] || "they";
  const line = inPlainWords(it.truth.trim(), state)
    + (it.lying ? ` What ${first} is letting show is deliberate and different from this.` : "");
  return { reads: [{ faculty: SOVEREIGN_FACULTY, line }], targetId };
}

/**
 * What the NARRATOR is told when a mind is being read.
 *
 * The seal normally keeps `truth` away from the narrator entirely, and it stays that way in every
 * other turn. Here it has to cross, because the alternative is worse than the leak: the narrator is
 * about to write a scene in which the player reads somebody's mind, and with nothing in hand it
 * invents the thought — so the player gets the real answer in the read panel and a different,
 * fabricated one in the prose, and has no way to know which is theirs.
 */
export function mindReadNote(state: SaveState, action: string, intents: NpcIntent[]): string {
  const { reads, targetId } = sovereignRead(state, action, intents);
  if (!reads.length || !targetId) return "";
  const name = state.characters[targetId]?.name ?? "";
  const first = name.split(/\s+/)[0] || name;
  return `\nTHE PLAYER IS READING ${name.toUpperCase()}'S MIND THIS TURN, and in this world they can. This is exactly what is there: "${reads[0].line}"\n`
    + `The player now knows it, in those words, without ${first} saying anything. Write it as something the player simply knows. They don't ask, they don't work it out, they don't half-catch it from a gesture, and it doesn't differ from the sentence above. `
    + `${first} doesn't feel it happen and has no way of telling that anyone is inside their head, so ${first} carries on exactly like someone whose thoughts are still private, which they still are from everyone else in the room.`;
}
