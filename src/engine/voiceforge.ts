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
import { screenCard, rewriteNote } from "./aphorism";

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
    bible?.technology_level ? `What exists in this world (nothing beyond this exists, so nobody can name it): ${bible.technology_level}` : "",
    bible?.cultures_and_languages ? `Culture and speech: ${bible.cultures_and_languages}` : "",
    bible?.what_people_fear ? `What people here are afraid of, and so talk around: ${bible.what_people_fear}` : "",
    bible?.tone ? `Register of the story: ${bible.tone}` : "",
  ].filter(Boolean).join("\n");
}

/** Tail threshold. Candidates at or below this are the usable pool. */
const TAIL = 0.10;

const VOICE_SYSTEM = `You write possible voice cards for one character in a story, describing how they talk.

Their age has to shape how they talk, and this step often gets that wrong. The brief gives you a number, and nothing here used to say what to do with it, so a ten-year-old came back sounding like a small adult with good timing: "He knows what he did." Children don't talk in short, weighty lines. Under about twelve, they take several runs at one thing, start in the middle, string it together with "and then", tell you things nobody asked about, get a word wrong and keep using it, and get to the point after the listener has already guessed it, so write the long, clumsy version. From thirteen to nineteen, they hedge a sentence while they're still saying it and take the edge off their own line before anyone else can, and the thing they care about most comes last and quietly. Past about seventy, people take the long way round because they find the detours interesting. Match the age you were given.

The setting also has to shape how they talk. Everything below happens inside the world described in the WORLD section. Before writing any line, work out what this person could possibly have a word for. They can name what their world contains and what their life has shown them, and nothing else. They can't name a feeling their culture has no idea of, and they can't reach for a comparison with something that doesn't exist here. That applies to ideas as much as to words. Someone from a world without clinics doesn't talk about processing, boundaries, holding space or unpacking things, and someone from a world without offices doesn't talk about handling it, managing it or sorting out the logistics. Their comparisons come from the work, weather, animals, food, faith, family and violence of their own world. A candidate that borrows from outside that world is a mistake, and it's the most common one.

Write five candidates. Each one has a number called "probability", which is your honest guess at how likely it is that a writer would think of that voice first for this character. Pick unusual ones, so every candidate should be below 0.10.

But make them unusual in the right way. Vary what they refuse to say, what they're really after, how long their sentences are, whether they answer the question they were asked, how much they leave out, how blunt or roundabout they are, and whether they talk to fill a silence or make you wait. Don't vary the world. A candidate that's unusual because it reaches outside this setting scores zero.

How someone talks means the words they use, how they build sentences, the rhythm of their speech, and what they refuse to say, separately from their mood and personality. Two characters with identical traits should still sound nothing alike.

The four descriptions have to describe four different things. "diction" is which words this person has. "syntax" is how they build a sentence. "rhythm" is how their talking moves along in time. "agenda" is what's underneath it. Writing the same observation four times is the most common way this step goes wrong, and it goes wrong worst for the most vivid character. One card came back with syntax "imperative-heavy", rhythm "the last noun of every order stretched", tic "adds a smiling qualifier after an order", and agenda "to get them to agree to a time and place". That's one idea written four times, and the narrator ran into it four times a turn, so for eleven turns everything that person said was an instruction. If the kind of thing they say is already covered in syntax, the other three should be about something else.

And the card you're given is the whole card. A voice built only from the most vivid trait describes a different person from the one on the page. The same character was also described as "charming and non antagonizing", and nothing in the voice was charming. A trait that describes how they sound is one input among all the others, never the whole brief.

The example_lines matter most. The narrator copies these to write everything this person ever says, so a sample about life in general teaches them to talk about life in general. There are five requirements, and you can check each one on the finished line:
- It comes from this person's own life: the work they do, the people they know, the place they live, what they were doing an hour ago. A line can't be built around a price, a count or a list of stock unless money or stock really is this person's subject. In one four-person cast, nine of the thirteen samples mentioned a number or an amount of money, and a bartender, a print-shop manager, an eighteen-year-old and a stranger to the story all sounded like the same person doing arithmetic. Use other concrete details instead, like somebody's sister, a smell, a road, a dog, a grudge, last Tuesday, or the thing their mother always says. If a line reaches outside this person's own life, rewrite it until it doesn't.
- What makes it theirs is what it mentions, and the way it's put together stays ordinary. A line belongs to them because of the dog, the latch, the aunt, the road or the neighbour's goat, the particular stuff of their life. The shape stays the shape of someone talking: they can ramble, answer half the question, start again, say something obvious, or leave a sentence hanging. Trying to make the shape distinctive instead of the content produces the line that withholds a fact, like "He knows what he did", "I'm not the one who lied" or "You already know the answer", which only sounds weighty because it doesn't name anything, and this step produces that kind of line more than any other. Every line has to include something a person could point at.
- It's aimed at something the speaker wants from whoever is listening, such as being believed, being left alone, finding out what the other person knows, or getting back to work. It isn't aimed at what the listener is really like underneath. Nobody here repeats back what the listener just said, asks a question meant to lead them to some realisation about themselves, or tells them what their behaviour means.
- It isn't the last line of a scene. A sample that would work as the closing line of a chapter teaches this person to end every exchange on one.
- And one of them isn't aimed at anything. If every line is trying to get something out of the listener, you get a person who only ever talks to extract things, so one sample has to be someone just saying something: a complaint about somebody who isn't there, something at work that was funny or maddening, a bit of their day, or an opinion nobody asked for. That line shows they have a life beyond getting things from people.

Reply with only this JSON:
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

/**
 * Uniform pick from the tail pool, after two rejections.
 *
 * THE SECOND REJECTION IS THE APHORISM. Everything this file already does is aimed at the register
 * a model defaults to when nothing more specific is holding the mouth open, and the tail sample is
 * what moves it. The tail has its own failure: an improbable voice is often improbable because it
 * is WRITTEN UP, and a written-up voice card carries an epigram in the one field the narrator
 * copies from. An example_line reading "Everything here has a price" is sampled at 0.03 and is the
 * exact sentence maxims.ts spends six hundred lines catching on the way out — arriving on the way
 * in, stamped onto the card, printed to the narrator every turn under ONE OF THEIR ACTUAL LINES.
 *
 * So the same mechanism as monotone, for the same reason: five candidates, drop the ones that trip,
 * fail open if they all do. A figured card still beats no card, which is what the fallback gives.
 */
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
  const plain = varied.filter((c) => screenCard({ voice: c.voice }).length === 0);
  const use = plain.length ? plain : varied.length ? varied : pool;
  return use[Math.floor(Math.random() * use.length)].voice;
}

/** What the screen would strike off this card — exported so a caller can report it rather than
 *  discovering it in play. */
export function voiceFaults(v: VoiceCard | null | undefined): string[] {
  return screenCard(v ? { voice: v } : null).map((f) => `${f.field}: ${f.text}`);
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
    `CONSCIENCE (0 to 1, how much other people's pain matters to them): ${npc.conscience ?? 0.7}`,
    `UNDER THREAT: ${npc.attachment?.under_threat ?? ""}`,
    // NOT WHAT THEY CURRENTLY WANT. A voice is how a mouth works and outlives every objective the
    // character will ever hold; handing this pass a goal welds the two together, and the want moves
    // on while the voice stays shaped around it. It was also dead on the refresh path — drive_goals
    // and drive_goal are forge-output fields and are not on a stored Identity, so this line has
    // been rendering empty for every re-forge of every character in play.
    `SUBJECTS THIS PERSON CAN TALK ABOUT AT LENGTH: ${Object.keys(npc.skills ?? {}).join(", ") || (npc.texture ?? []).join("; ")}`,
    `WORLD (everything below happens inside this world and nowhere else):\n${worldNote}`,
  ].join("\n");

  // Concrete exclusion, not an abstract instruction to "be different" — the model can
  // only avoid a register it can actually see.
  const exclusion = avoid.length
    ? `\n\nLINES THIS CAST HAS ALREADY SPOKEN (none of your lines can share their way of talking, their rhythm or their sentence shape):\n${avoid.map((l) => `- ${l}`).join("\n")}`
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
