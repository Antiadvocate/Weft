// src/engine/voiceforge.ts
//
// VOICE FORGE — a separate tail-sampled pass that overwrites each NPC's voice card.
//
// Why this exists: FORGE_SYSTEM builds the whole world in ONE call, which means the
// entire cast's voices are drawn from one forward pass at the centre of the model's
// distribution. The prompt already ORDERS variety ("write each npc's voice so far
// apart a reader could name the speaker blind") — and it doesn't work, because
// instruction-following can't move a distribution. Sampling can.
//
// Two rules make this work, and both are load-bearing:
//   1. ONE CALL PER CHARACTER. Batching the cast is what produces a matched set.
//   2. THE SELECTION HAPPENS HERE, IN TYPESCRIPT — never in the model. If you ask the
//      model to "pick the unusual one" it picks the typical one and calls it unusual.
//
// WHAT THIS PASS NO LONGER PRODUCES: example lines.
//
// It used to end every card with two or three sentences only that person could say, and they were
// the best writing in the engine. They were also the reason the same handful of lines came back for
// a hundred turns. A sample line is not a description of a voice, it is a LINE — finished, in the
// context, and cheaper for a model to reuse than to match. maxims.ts then printed one of them
// immediately before the request to write the scene, every single turn, which is the most reliable
// way anyone has found to make a model repeat something.
//
// So the card names the voice instead of demonstrating it. `idiolect` is this person's own way of
// using language, given a name — a non-linear visualiser, a reassuring interrupter — plus one
// sentence saying what that does to their sentences. A name has to be REALISED into whatever is
// actually happening in the room, freshly, every time it is used; a sample only has to be copied.
// The culture and the persona the example lines used to showcase now live in `diction`, which is
// the field that was always doing that work: what this person's world and trade gave them words for.
//
// Fails open: any error and the forge's original voice card is kept untouched.

import { buildMessages, complete, safeJson } from "../llm";

export interface VoiceCard {
  idiolect: string;
  idiolect_shows: string;
  diction: string;
  syntax: string;
  rhythm: string;
  tics: string[];
  never_says: string[];
  agenda: string;
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

THE SETTING IS A HARD FLOOR. Everything below happens INSIDE the world described in the WORLD block. Before writing anything, work out what this person could possibly have a word for: they name what their world contains and what their life has put in front of them, and nothing else. They cannot name a feeling their culture has no concept of, and they cannot reach for a comparison drawn from a thing that does not exist here. This covers ideas as much as vocabulary — a person from a world without clinics does not talk about processing, boundaries, holding space or unpacking; a person from a world without offices does not talk about handling it, managing it, or sorting the logistics. Their comparisons come from the work, weather, animals, food, faith, kin and violence of THEIR world. A candidate that borrows from outside it is not an unusual voice, it is a mistake, and it is the most common one.

WRITE NO DIALOGUE. Not one line, not a fragment, not a phrase in quotation marks anywhere in any field. You are describing a way of talking, never demonstrating it. This is the whole design of this pass: a sample line is a finished sentence sitting in the narrator's context, and it gets reused until the character is a broken record, which is exactly what happened when this card carried examples. Every field must be a DESCRIPTION that the narrator has to realise fresh into whatever is happening in the room. If any field of yours could be dropped into a scene as something somebody says, it is wrong.

THE IDIOLECT IS THE CARD. An idiolect is one person's own way of using language, and you are naming it: two to four words for the MOVE they make when they talk. It is never a mood, never a personality adjective, and never their job. Build it from the axes below, choosing whichever ones this life actually produced:
- how they get to the point — straight at it, spiralling in, by way of a picture, by way of a story about somebody else, by asking instead of saying, never at all
- what they do with the other person's turn — cut in, wait a beat too long, finish their sentence for them, answer the question they wish had been asked, leave the silence sitting there
- what they do when they disagree — restate it louder, go procedural, concede and come back to it, make it a joke, refuse the frame
- what they do with anything abstract — refuse it, translate it into something physical, live in it happily, get it slightly wrong and keep going
- what they do with their own feeling — name it flatly, route it through a third thing, deny it while doing it anyway, put it on somebody else
Two examples of the SHAPE, both used up — do not return either or anything near them: a non-linear visualiser; a reassuring interrupter. Yours comes from THIS person's background, trade, age and what their life has cost them.

Output FIVE candidates. Each carries a numeric "probability": your honest estimate of how likely that voice is to be the one a writer would reach for first for this character. Sample from the TAILS — every candidate should sit below 0.10.

BUT the unusualness must live on the RIGHT AXIS. Vary the idiolect, what they refuse to say, what they are angling for under the words, how much they leave out, how blunt or oblique they are, whether they talk to fill silence or make you wait. Do NOT vary the world. A candidate that is improbable because it reaches outside this setting scores zero.

A voice is the idiolect, the words this life gave them, and what they refuse to say. It is NOT their mood and NOT their personality restated. Two characters with identical traits should still speak nothing alike.

The fields, and what makes each one right:
- "idiolect": 2-4 words naming the move. A reader who watched this person talk for ten minutes would recognise the name.
- "idiolect_shows": ONE sentence on what that move does to their actual sentences — where they start, what they leave out, what shape the sentence ends up. This is what makes the name operable instead of decorative. Still no dialogue.
- "diction": what their life and their world gave them words for — the trade, the place, the people they answer to, the things they have handled all day. Which things they name directly and which they go around. This is where the culture of this world shows, so it carries the most weight after the idiolect.
- "syntax": how their sentences are built — roughly how long, whether they finish them, whether several run together before they stop.
- "rhythm": how their talking moves — interrupts themselves, trails off, answers in one word, keeps going past the answer.
- "tics": 0-2 recurring verbal HABITS, each written as a behaviour they perform — checking whether you followed before going on, say — and NEVER as a phrase they say. A tic written as a phrase becomes a catchphrase within three scenes.
- "never_says": 2-3 KINDS of construction this person would never produce, named as kinds — anything that states her own feeling outright, that shape of thing. Never a line, and nothing in quotation marks.
- "agenda": what they are usually angling for under the words.

Output ONLY this JSON:
{"candidates":[{"probability":0.04,"voice":{"idiolect":"","idiolect_shows":"","diction":"","syntax":"","rhythm":"","tics":[""],"never_says":["",""],"agenda":""}}]}`;

/** Uniform pick from the tail pool; falls back to the least-likely candidate. */
function pickFromTail(cands: Candidate[]): VoiceCard | null {
  const usable = cands.filter(
    (c) => String(c?.voice?.idiolect ?? "").trim() && Number.isFinite(c.probability),
  );
  if (!usable.length) return null;
  const tail = usable.filter((c) => c.probability <= TAIL);
  const pool = tail.length ? tail : [usable.sort((a, b) => a.probability - b.probability)[0]];
  return pool[Math.floor(Math.random() * pool.length)].voice;
}

/** The one-line summary of a card, used as the stored `speech_pattern` and anywhere a voice has to
 *  be stated in a sentence. Idiolect first, because it is the thing that decides a line. */
export function voiceSummary(v: Partial<VoiceCard> | undefined): string {
  if (!v) return "";
  const head = [v.idiolect?.trim(), v.idiolect_shows?.trim()].filter(Boolean).join(" — ");
  const parts = [head, v.diction?.trim(), v.syntax?.trim(), v.rhythm?.trim()].filter(Boolean);
  return parts.length ? `${parts.map((p) => String(p).replace(/[.\s]+$/, "")).join(". ")}.` : "";
}

/** One character, one call. `avoid` carries the idiolects already committed to this cast. */
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
    `WANTS: ${(npc.drive_goals ?? [npc.drive_goal]).filter(Boolean).join(" / ")}`,
    `WORLD — this is the floor, not decoration:\n${worldNote}`,
  ].join("\n");

  // Concrete exclusion, not an abstract instruction to "be different" — the model can
  // only avoid a voice it can actually see. These are the idiolects the rest of this cast
  // already holds, which is a far better anti-convergence signal than sample lines ever were:
  // it is the axis the cards actually collapse along, stated in the terms the card is written in.
  const exclusion = avoid.length
    ? `\n\nALREADY TAKEN BY THIS CAST — none of your candidates may name this move, or a near neighbour of it:\n${avoid.map((l) => `- ${l}`).join("\n")}`
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
 * each character sees which voices the previous ones have already taken, so the
 * exclusion list does real work. A 4-NPC cast is 4 small calls, once, at forge time.
 */
export async function forgeCastVoices(
  npcs: any[],
  bible: any,
  model: string,
): Promise<void> {
  const worldNote = typeof bible === "string" ? bible : worldBriefOf(bible);
  const taken: string[] = [];
  for (const npc of npcs) {
    const voice = await forgeVoice(npc, worldNote, model, taken);
    if (!voice) continue;                       // keep the forge's original card
    npc.voice = { ...(npc.voice ?? {}), ...voice };
    delete npc.voice.example_lines;             // a pre-change card must not smuggle samples through
    npc.speech_pattern = voiceSummary(voice) || npc.speech_pattern;
    if (voice.idiolect?.trim()) taken.push(voice.idiolect.trim());
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
// idiolect is OVERWRITTEN, not appended: keeping it would reintroduce the drifted voice as an
// exemplar, which is the exact loop this exists to break.

/** Turns between automatic refreshes for a character who is actually in scenes. */
export const VOICE_REFRESH_INTERVAL = 12;

export async function refreshVoice(
  state: any,
  charId: string,
  model: string,
): Promise<boolean> {
  const c = state.characters?.[charId];
  if (!c) return false;

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

  // Anti-set: the moves everyone ELSE in this cast already makes, so a refresh can't converge them.
  const avoid: string[] = [];
  for (const [id, other] of Object.entries<any>(state.characters ?? {})) {
    if (id === charId || id === "char_player") continue;
    const other_idiolect = String(other?.voice?.idiolect ?? "").trim();
    if (other_idiolect) avoid.push(other_idiolect);
  }

  const voice = await forgeVoice(npcView, worldNote, model, avoid.slice(0, 8));
  if (!voice) return false;

  c.voice = { ...(c.voice ?? {}), ...voice };      // idiolect REPLACED, deliberately
  delete c.voice.example_lines;                    // and a sample from an old save is dropped here
  c.speech_pattern = voiceSummary(voice) || c.speech_pattern;
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
    const last = c.voice_refreshed_turn ?? 0;
    if (turn - last < VOICE_REFRESH_INTERVAL) continue;
    if (await refreshVoice(state, id, model)) done.push(c.name);
  }
  return done;
}
