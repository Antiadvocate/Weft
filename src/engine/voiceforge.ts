// src/engine/voiceforge.ts
//
// VOICE FORGE — a separate tail-sampled pass that overwrites each NPC's voice card.
//
// Why this exists: FORGE_SYSTEM builds the whole world in ONE call, which means the
// entire cast's example_lines are drawn from one forward pass at the centre of the
// model's distribution. The prompt already ORDERS variety ("write each npc's voice so
// far apart a reader could name the speaker blind") — and it doesn't work, because
// instruction-following can't move a distribution. Sampling can.
//
// Two rules make this work, and both are load-bearing:
//   1. ONE CALL PER CHARACTER. Batching the cast is what produces a matched set.
//   2. THE SELECTION HAPPENS HERE, IN TYPESCRIPT — never in the model. If you ask the
//      model to "pick the unusual one" it picks the typical one and calls it unusual.
//
// Fails open: any error and the forge's original voice card is kept untouched.

import { buildMessages, complete, safeJson } from "../llm";

export interface VoiceCard {
  diction: string;
  syntax: string;
  rhythm: string;
  tics: string[];
  never_says: string[];
  agenda: string;
  example_lines: string[];
}

interface Candidate { probability: number; voice: VoiceCard }


/** The period brief. `name — era` was never enough: a voice pass that only knows the era STRING
 *  will happily write a 7th-century widow talking like someone in 2026, because nothing told it
 *  what her world does and doesn't contain. Technology and culture are what actually constrain
 *  vocabulary, so they go in. */
export function worldBriefOf(bible: any): string {
  return [
    bible?.name ? `Setting: ${bible.name}` : "",
    bible?.era ? `Period: ${bible.era}` : "",
    bible?.technology_level ? `Material world (nothing beyond this exists to be named): ${bible.technology_level}` : "",
    bible?.cultures_and_languages ? `Culture and speech: ${bible.cultures_and_languages}` : "",
    bible?.what_people_fear ? `What people here fear, and therefore talk around: ${bible.what_people_fear}` : "",
    bible?.tone ? `Register of the story: ${bible.tone}` : "",
  ].filter(Boolean).join("\n");
}

/** Tail threshold. Candidates at or below this are the usable pool. */
const TAIL = 0.10;

const VOICE_SYSTEM = `You produce candidate VOICE CARDS for one character in a story.

THE SETTING IS A HARD FLOOR. Everything below happens INSIDE the world described in the WORLD block. Before writing any line, work out what this person could possibly have a word for: they name what their world contains and what their life has put in front of them, and nothing else. They cannot name a feeling their culture has no concept of, and they cannot reach for a comparison drawn from a thing that does not exist here. This covers ideas as much as vocabulary — a person from a world without clinics does not talk about processing, boundaries, holding space or unpacking; a person from a world without offices does not talk about handling it, managing it, or sorting the logistics. Their comparisons come from the work, weather, animals, food, faith, kin and violence of THEIR world. A candidate that borrows from outside it is not an unusual voice, it is a mistake, and it is the most common one.

Output FIVE candidates. Each carries a numeric "probability": your honest estimate of how likely that voice is to be the one a writer would reach for first for this character. Sample from the TAILS — every candidate should sit below 0.10.

BUT the unusualness must live on the RIGHT AXIS. Vary: what they refuse to say, what they are angling for under the words, sentence length, whether they answer the question asked, how much they leave out, how blunt or oblique they are, whether they talk to fill silence or make you wait. Do NOT vary the world. A candidate that is improbable because it reaches outside this setting scores zero.

A voice is diction, syntax, rhythm, and what the person refuses to say. It is NOT their mood and NOT their personality restated. Two characters with identical traits should still speak nothing alike.

THE FOUR DESCRIPTIONS MUST DESCRIBE FOUR DIFFERENT THINGS. diction is which words this person has; syntax is how the sentence is built; rhythm is how the talking moves through time; agenda is what sits under it. Writing one observation four times is the commonest way this pass fails, and it fails hardest on the most vivid character. A card that came back reading syntax "imperative-heavy", rhythm "the last noun of every order stretched", tic "adds a smiling qualifier after an order", agenda "to get them to agree to a time and place" is one idea wearing four hats, and the narrator meets it four times a turn: everything that person said for eleven turns was an instruction. If the speech act is already named in syntax, the other three are about something else.

AND THE CARD YOU ARE GIVEN IS THE WHOLE CARD. A card built out of the most vivid trait alone describes a different person from the one on the page. The same character above was also written "charming and non antagonizing", and nothing in the voice was charming. A trait that describes how they SOUND is one input among all of them, never the brief.

example_lines are the proof and the only part that matters. The narrator copies these to write everything this person ever says, so a sample about life in general teaches them to talk about life in general. Four requirements, all of them checkable on the finished line:
- IT COMES OUT OF THIS PERSON'S OWN LIFE — the work they do, the people they know, the place they live, what they were doing an hour ago. A LINE MAY NOT BE BUILT OUT OF A PRICE, A COUNT OR AN INVENTORY unless money or stock is genuinely this person's subject: measured across one four-person cast, nine of thirteen samples named a number or a dollar amount, and a bartender, a print-shop manager, an eighteen-year-old and a stranger to the story all came out sounding like one person doing sums. A number is one way to be concrete and it has crowded out all the others — somebody's sister, a smell, a road, a dog, a grudge, last Tuesday, the thing their mother says. A line that reaches outside this person's own life is rewritten until it does not.
- IT IS UNSAYABLE BY ANYONE ELSE IN THIS CAST. If it would fit a generic sympathetic stranger, it is wrong. If it would still be true said by anyone, anywhere, to anyone, it is wrong.
- IT IS AIMED AT SOMETHING THE SPEAKER WANTS FROM WHOEVER IS LISTENING — to be paid, to be believed, to be left alone, to find out what the other person knows, to get back to work. Not at what the listener is really like underneath: nobody here restates what the listener just said, asks a question designed to walk them to a realization about themselves, or tells them what their behaviour means.
- IT IS NOT THE LAST LINE OF A SCENE. A sample that would work as the closing beat of a chapter teaches this person to end every exchange on one.
- AND ONE OF THEM IS AIMED AT NOTHING. Every line pulling something out of the listener makes a person who has no way of talking except to extract, which is what happens to anyone written as wanting leverage. One sample has to be a person saying a thing: a complaint about somebody who is not in the room, something at work that was funny or maddening, a piece of their day, an opinion nobody asked for. That is the line that proves they are a person rather than a lever.

Output ONLY this JSON:
{"candidates":[{"probability":0.04,"voice":{"diction":"","syntax":"","rhythm":"","tics":[""],"never_says":["",""],"agenda":"","example_lines":["","",""]}}]}`;

/** Words for the act of telling somebody to do something — the register this pass collapses into. */
const SPEECH_ACT = /\b(order|orders|ordering|ordered|command|commands|commanding|imperative|imperatives|demand|demands|demanding|instruct|instructs|instruction|instructions|directive|directives|dictate|dictates)\b/i;

/**
 * ONE IDEA WEARING FOUR HATS.
 *
 * diction, syntax, rhythm and agenda are four different questions, and the model answers them with
 * one observation whenever a character has a vivid enough trait to answer them all. From a save,
 * an eighteen-year-old written "charming and non antagonizing" alongside one trait about drawing
 * out syllables when giving an order:
 *
 *   syntax  "Second person, imperative-heavy. Frames requests as scheduling."
 *   rhythm  "...the last noun of every order stretched slightly longer than the rest."
 *   tic     "adds a smiling qualifier after an order"
 *   agenda  "To get the other person to agree to a specific time and place."
 *
 * The narrator reads all four every turn, so she spent eleven turns doing nothing but telling the
 * player what to do, and the player could not find the switch — because there was no switch, there
 * was a card that said the same thing four times. Nothing charming survived into any field.
 *
 * The prompt now says not to, and instruction-following does not move a distribution — which is the
 * argument this whole module is built on. So it is measured here instead: a candidate whose fields
 * keep restating one act, or one content word, loses to any candidate in the pool that does not.
 */
const CARD_VOCAB = new Set([
  "person", "people", "someone", "somebody", "something", "anything", "another", "others",
  "sentence", "sentences", "clause", "clauses", "phrase", "phrases", "speaking", "talking",
  "speech", "voice", "answer", "answers", "answering", "question", "questions", "listener",
  "before", "after", "around", "through", "without", "always", "never", "rather", "instead",
  "slightly", "longer", "shorter", "little", "enough", "really", "almost", "nearly", "mostly",
  "usually", "often", "whatever", "himself", "herself", "themselves",
]);

export function monotone(v: VoiceCard): boolean {
  const fields = [v.syntax ?? "", v.rhythm ?? "", (v.tics ?? []).join(" "), v.agenda ?? ""].map((x) => x.toLowerCase());
  const said = fields.filter((f) => f.trim());
  if (said.length < 3) return false;
  if (said.filter((f) => SPEECH_ACT.test(f)).length >= 3) return true;
  // ...or the same distinctive word carrying three of the four, which is the general shape of it.
  // Not counting the vocabulary every voice card is written IN: a healthy card says "second person"
  // in syntax, "the other person answers" in rhythm and "the most comfortable person in the room"
  // in agenda, and three different meanings of one common noun is not one idea four times.
  const counts = new Map<string, number>();
  for (const f of said) for (const w of new Set(f.match(/[a-z]{6,}/g) ?? [])) {
    if (CARD_VOCAB.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  for (const n of counts.values()) if (n >= 3) return true;
  return false;
}

/** Uniform pick from the tail pool, preferring candidates that are not one idea four times. */
export function pickFromTail(cands: Candidate[]): VoiceCard | null {
  const usable = cands.filter(
    (c) => c?.voice?.example_lines?.length && Number.isFinite(c.probability),
  );
  if (!usable.length) return null;
  const tail = usable.filter((c) => c.probability <= TAIL);
  const pool = tail.length ? tail : [usable.sort((a, b) => a.probability - b.probability)[0]];
  // Rejection, not repair: the tail is where the interesting voices are and there are five of them,
  // so dropping the collapsed ones usually leaves something. If every one of them collapsed, the
  // pool stands — a monotone voice still beats no voice, which is what failing closed would give.
  const varied = pool.filter((c) => !monotone(c.voice));
  const use = varied.length ? varied : pool;
  return use[Math.floor(Math.random() * use.length)].voice;
}

/** One character, one call. `avoid` carries the lines already committed to this cast. */
export async function forgeVoice(
  npc: any,
  worldNote: string,
  model: string,
  avoid: string[] = [],
): Promise<VoiceCard | null> {
  const brief = [
    `NAME: ${npc.name}`,
    `AGE: ${npc.age}`,
    `BACKGROUND: ${npc.background ?? ""}`,
    `CORE TRAITS: ${(npc.core_traits ?? []).join(", ")}`,
    `VALUES: ${(npc.values ?? []).join(", ")}`,
    `CONSCIENCE (0..1, how much others' pain registers): ${npc.conscience ?? 0.7}`,
    `UNDER THREAT: ${npc.attachment?.under_threat ?? ""}`,
    // NOT WHAT THEY CURRENTLY WANT. A voice is how a mouth works and outlives every objective the
    // character will ever hold; handing this pass a goal welds the two together, and the want moves
    // on while the voice stays shaped around it. It was also dead on the refresh path — drive_goals
    // and drive_goal are forge-output fields and are not on a stored Identity, so this line has
    // been rendering empty for every re-forge of every character in play.
    `WORDS THIS PERSON HAS TO TALK AT LENGTH ABOUT: ${Object.keys(npc.skills ?? {}).join(", ") || (npc.texture ?? []).join("; ")}`,
    `WORLD — this is the floor, not decoration:\n${worldNote}`,
  ].join("\n");

  // Concrete exclusion, not an abstract instruction to "be different" — the model can
  // only avoid a register it can actually see.
  const exclusion = avoid.length
    ? `\n\nALREADY SPOKEN BY THIS CAST — none of your lines may share their register, rhythm, or sentence shape:\n${avoid.map((l) => `- ${l}`).join("\n")}`
    : "";

  try {
    const msgs = buildMessages(VOICE_SYSTEM, "CHARACTER:", brief + exclusion, model);
    const out = await complete(msgs, model, model, true, 2000);
    const parsed = safeJson<{ candidates?: Candidate[] }>(out.text, {});
    return pickFromTail(parsed.candidates ?? []);
  } catch {
    return null;
  }
}

/**
 * Sequential pass over the cast. Sequential rather than Promise.all on purpose:
 * each character sees what the previous ones have already said, so the exclusion
 * list does real work. A 4-NPC cast is 4 small calls, once, at forge time.
 */
export async function forgeCastVoices(
  npcs: any[],
  bible: any,
  model: string,
): Promise<void> {
  const worldNote = typeof bible === "string" ? bible : worldBriefOf(bible);
  const spoken: string[] = [];
  for (const npc of npcs) {
    const voice = await forgeVoice(npc, worldNote, model, spoken);
    if (!voice) continue;                       // keep the forge's original card
    npc.voice = { ...(npc.voice ?? {}), ...voice };
    if (voice.example_lines?.length) {
      npc.speech_pattern = `${voice.diction}. ${voice.syntax}. ${voice.rhythm}.`;
      spoken.push(...voice.example_lines.slice(0, 2));
    }
  }
}

// ── THE FRESH READER ─────────────────────────────────────────────────────────
//
// Voice drift is self-conditioning: the narrator sees its own last paragraph and matches it, so
// every turn is a copy of a copy and the whole cast slides toward the model's default register —
// smooth, knowing, closing each speech on a portable maxim. Instructions can't stop it, because
// the thing being imitated is right there in the context and an instruction is not.
//
// So this pass never sees the prose. It reads the character card as it stands NOW — including
// who play has made them — and re-derives the voice from scratch, tail-sampled. It is the
// equivalent of handing the script to an actor who hasn't heard the previous takes. The old
// example_lines are OVERWRITTEN, not appended: keeping them would reintroduce the drifted voice
// as an exemplar, which is the exact loop this exists to break.

/** Turns between automatic refreshes for a character who is actually in scenes. */
export const VOICE_REFRESH_INTERVAL = 12;

export async function refreshVoice(
  state: any,
  charId: string,
  model: string,
): Promise<boolean> {
  const c = state.characters?.[charId];
  if (!c) return false;
  // A LOCKED VOICE IS NOT REFRESHED, BY THE CLOCK OR BY HAND. The button in Cast is hidden while
  // the lock is on, and this is the guard behind it: the whole point of the lock is that nothing
  // gets to rewrite what the player typed, and "nothing" has to include the deliberate path.
  if (c.voice_locked) return false;

  // Who play has made them — a woman who acquired "openly bitter about the raid" should sound like
  // it. The refresh reads the CURRENT card, so voices move with the character instead of resetting.
  const acquired = (state.traits?.[charId] ?? [])
    .filter((t: any) => (t.intensity ?? 0) >= 5)
    .slice(0, 4)
    .map((t: any) => `${t.label} (${t.behavioral_impact})`);

  const npcView = {
    ...c,
    core_traits: [...(c.core_traits ?? []), ...acquired],
  };

  const worldNote = worldBriefOf(state.world_bible);

  // Anti-set: what everyone ELSE currently sounds like, so a refresh can't converge the cast.
  const avoid: string[] = [];
  for (const [id, other] of Object.entries<any>(state.characters ?? {})) {
    if (id === charId || id === "char_player") continue;
    for (const l of other?.voice?.example_lines ?? []) avoid.push(l);
  }

  const voice = await forgeVoice(npcView, worldNote, model, avoid.slice(0, 8));
  if (!voice) return false;

  c.voice = { ...(c.voice ?? {}), ...voice };      // example_lines REPLACED, deliberately
  if (voice.example_lines?.length) {
    c.speech_pattern = `${voice.diction}. ${voice.syntax}. ${voice.rhythm}.`;
  }
  c.voice_refreshed_turn = state.world?.current_turn ?? 0;
  return true;
}

/** Refresh anyone in the scene who is overdue. Cheap: one small call per stale character. */
export async function refreshStaleVoices(state: any, model: string): Promise<string[]> {
  const turn = state.world?.current_turn ?? 0;
  const done: string[] = [];
  for (const id of state.world?.present ?? []) {
    if (id === "char_player") continue;
    const c = state.characters?.[id];
    if (!c) continue;
    if (c.voice_locked) continue;
    const last = c.voice_refreshed_turn ?? 0;
    if (turn - last < VOICE_REFRESH_INTERVAL) continue;
    if (await refreshVoice(state, id, model)) done.push(c.name);
  }
  return done;
}
