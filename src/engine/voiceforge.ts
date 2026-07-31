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

/** Tail threshold. Candidates at or below this are the usable pool. */
const TAIL = 0.10;

const VOICE_SYSTEM = `You produce candidate VOICE CARDS for one character in a story.

Output FIVE candidates. Each carries a numeric "probability": your honest estimate of how likely that voice is to be the one a writer would reach for first for this character. Sample from the TAILS of the distribution — every candidate you emit should sit below 0.10. Do NOT emit a safe centre-of-distribution voice and label it improbable; if a candidate is the obvious read, it does not belong in the list.

A voice is diction, syntax, rhythm, and what the person refuses to say. It is NOT their mood and NOT their personality restated. Two characters with identical traits should still speak nothing alike.

example_lines are the proof and the only part that matters. Rules for them:
- Plain speech from a specific mouth. No aphorisms, no summaries of the character's own psychology, no line that would work as a chapter epigraph.
- A line must be UNSAYABLE by anyone else in the cast. If it would fit a generic sympathetic stranger, it is wrong.
- Nobody is a therapist. No reflecting feelings back, no "that sounds hard", no gently leading questions.
- These are BANNED outright, in any inflection: "that's not nothing", "it's a lot", "you're not wrong", "you do so much", "are you really doing this", "I'm not going to pretend", "let me be clear", echo-questions that repeat the last thing said back as a question, and any sentence whose job is to land as a closing beat.

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
    `WORLD: ${worldNote}`,
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
  worldNote: string,
  model: string,
): Promise<void> {
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

  const worldNote = `${state.world_bible?.name ?? ""} — ${state.world_bible?.era ?? ""}`;

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
