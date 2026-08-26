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

example_lines are the proof and the only part that matters. The narrator copies these to write everything this person ever says, so a sample about life in general teaches them to talk about life in general. Four requirements, all of them checkable on the finished line:
- IT NAMES SOMETHING THIS PERSON COULD POINT AT OR HAS HANDLED — a person, an object, a price, a place, a job, an animal, a debt, a number, an errand. A line that names nothing of the kind is rewritten until it does.
- IT IS UNSAYABLE BY ANYONE ELSE IN THIS CAST. If it would fit a generic sympathetic stranger, it is wrong. If it would still be true said by anyone, anywhere, to anyone, it is wrong.
- IT IS AIMED AT SOMETHING THE SPEAKER WANTS FROM WHOEVER IS LISTENING — to be paid, to be believed, to be left alone, to find out what the other person knows, to get back to work. Not at what the listener is really like underneath: nobody here restates what the listener just said, asks a question designed to walk them to a realization about themselves, or tells them what their behaviour means.
- IT IS NOT THE LAST LINE OF A SCENE. A sample that would work as the closing beat of a chapter teaches this person to end every exchange on one.

Output ONLY this JSON:
{"candidates":[{"probability":0.04,"voice":{"diction":"","syntax":"","rhythm":"","tics":[""],"never_says":["",""],"agenda":"","example_lines":["","",""]}}]}`;

/** Uniform pick from the tail pool; falls back to the least-likely candidate. */
function pickFromTail(cands: Candidate[]): VoiceCard | null {
  const usable = cands.filter(
    (c) => c?.voice?.example_lines?.length && Number.isFinite(c.probability),
  );
  if (!usable.length) return null;
  const tail = usable.filter((c) => c.probability <= TAIL);
  const pool = tail.length ? tail : [usable.sort((a, b) => a.probability - b.probability)[0]];
  return pool[Math.floor(Math.random() * pool.length)].voice;
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
    `WANTS: ${(npc.drive_goals ?? [npc.drive_goal]).filter(Boolean).join(" / ")}`,
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
    const last = c.voice_refreshed_turn ?? 0;
    if (turn - last < VOICE_REFRESH_INTERVAL) continue;
    if (await refreshVoice(state, id, model)) done.push(c.name);
  }
  return done;
}
