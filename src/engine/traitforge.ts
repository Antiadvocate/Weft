// TRAITFORGE — re-expressing an existing person's core traits as dispositions.
//
// The forge now writes core traits as standing dispositions rather than adjectives, but every
// character already in a save carries the old form: "Proud and honorable", "Gentle and patient",
// "Intelligent and inquisitive". Those are verdicts a neighbour would render after a month. They
// describe the OUTPUT of a person and give the narrator nothing to generate from, which is why
// four such characters blur into one another in play.
//
// THIS IS A TRANSLATION, NOT A RE-ROLL. That distinction is the whole design. Core traits are
// constitutional — the engine's own rules forbid acquired traits from ever erasing or reversing
// them, and a save where everyone's fundamental nature silently changed is a save whose history
// stopped making sense. So this pass is required to account for every existing trait, re-expressed
// as the disposition UNDERNEATH it, and forbidden from introducing anyone new. Bridei stays
// exactly as proud as he was; "proud" stops being the label and becomes the thing that produces it.
//
// The originals are preserved in core_traits_legacy. Nothing is destroyed.

import { buildMessages, complete, safeJson } from "../llm";

const TRAIT_SYSTEM = `You re-express one existing character's core traits. You are NOT redesigning them.

The traits you are given are adjectives — summaries of how this person BEHAVES. Your job is to name what they ARE underneath, such that the old adjectives would be the natural consequence. Same person, same nature, described one level deeper.

A core trait in the required form is a disposition the person did not choose, cannot explain, would not list about themselves, and had before they had reasons for anything. Not a mood, not an opinion, not a current situation, not a moral verdict. Kinds that qualify:
- DEFAULT SETTING OF THE NERVOUS SYSTEM — resting temperament, reaction speed, present since childhood ("slow to anger and slower to let it go", "goes quiet and practical the instant a voice rises").
- AN AVERSION OR PULL WITH NO CAUSE — an intense dislike or draw with no incident behind it ("cannot sleep with a door at her back and has never known why").
- AN UNEARNED APTITUDE — something they were good at before anyone taught them ("reads a room's mood before anyone speaks, and is never wrong").
- A PHYSICAL OR BEHAVIOURAL SIGNATURE — a mannerism recurring under every mood ("holds everything, cup or knife or child, in the same careful two-handed grip").
- AN INSTINCTIVE AFFINITY — recognition arriving faster than thought ("knows within a breath whether a man is lying, and cannot say how").

HARD CONSTRAINTS:
1. ACCOUNT FOR EVERY ORIGINAL TRAIT. Each one must be visible in your output as the disposition that produces it. State which in the "from" field. Do not drop a trait because you found it dull.
2. INVENT NO NEW NATURE. You may only re-describe what the background, values, attachment and existing traits already establish. If the original says nothing about how they handle fear, do not decide.
3. A MOOD IS NOT A TRAIT. If an original is a current state rather than a constitution ("homesick and lonely", "exhausted"), find the standing disposition that makes them prone to it and name that instead — the mood is what their nature is doing right now, not the nature.
4. NO MORAL VERDICTS. "Honorable", "kind", "loyal", "cruel" are judgements. Write the disposition; let the reader judge.
5. Written in the period's own terms — plain concrete language, nothing clinical, no modern psychology vocabulary.

Each trait: one short concrete phrase, under about 14 words. Give the same number you were given, or one more if two originals genuinely collapse into one disposition and a separate one is needed to cover the rest.

At least one should be INCONVENIENT — something that costs them, or is tiring to be near. If the originals are all flattering, the honest translation still is not: find what the flattering version costs.

Output ONLY this JSON:
{"traits":[{"trait":"","from":"which original adjective(s) this expresses"}]}`;

export interface RetraitResult {
  name: string;
  before: string[];
  after: string[];
}

/**
 * Re-express one character's core traits. Returns null on any failure, leaving them untouched.
 * Idempotent-ish: a character already migrated (core_traits_legacy present) is skipped unless
 * `force` is set, so running this twice doesn't translate a translation.
 */
export async function retraitCharacter(
  state: any,
  charId: string,
  model: string,
  force = false,
): Promise<RetraitResult | null> {
  const c = state.characters?.[charId];
  if (!c) return null;
  if (c.core_traits_legacy && !force) return null;

  const before: string[] = [...(c.core_traits ?? [])];
  if (!before.length) return null;

  const acquired = (state.traits?.[charId] ?? [])
    .map((t: any) => `${t.label} — ${t.behavioral_impact}`)
    .slice(0, 5);

  const b = state.world_bible ?? {};
  const brief = [
    `NAME: ${c.name}`,
    `AGE: ${c.age}`,
    `SETTING: ${b.name ?? ""} — ${b.era ?? ""}`,
    `BACKGROUND: ${c.background ?? ""}`,
    `EXISTING CORE TRAITS (translate all of these): ${before.join(" | ")}`,
    `VALUES: ${(c.values ?? []).join(", ")}`,
    `WHAT THEY DO UNDER THREAT: ${c.attachment?.under_threat ?? "unstated — do not invent"}`,
    `WHAT SETTLES THEM: ${c.attachment?.soothed_by ?? "unstated — do not invent"}`,
    `CONSCIENCE (0..1, how much others' pain registers): ${c.conscience ?? 0.7}`,
    acquired.length ? `WHAT PLAY HAS MADE THEM (overlay — do not fold into core): ${acquired.join(" | ")}` : "",
    c.voice?.example_lines?.length ? `HOW THEY TALK: ${c.voice.example_lines.slice(0, 2).map((l: string) => `"${l}"`).join(" ")}` : "",
  ].filter(Boolean).join("\n");

  let traits: { trait?: string; from?: string }[] = [];
  try {
    const msgs = buildMessages(TRAIT_SYSTEM, "CHARACTER:", brief, model);
    const out = await complete(msgs, model, model, true, 1200);
    traits = safeJson<{ traits?: { trait?: string; from?: string }[] }>(out.text, {}).traits ?? [];
  } catch {
    return null;
  }

  const after = traits.map((t) => String(t?.trait ?? "").trim()).filter((t) => t.length > 3);
  // A translation that loses most of the person is a failed call, not a result worth keeping.
  if (after.length < Math.max(2, before.length - 1)) return null;

  c.core_traits_legacy = before;      // nothing is destroyed
  c.core_traits = after;
  return { name: c.name, before, after };
}

/** Whole cast, sequentially. Skips anyone already migrated. */
export async function retraitCast(state: any, model: string, force = false): Promise<RetraitResult[]> {
  const out: RetraitResult[] = [];
  for (const id of Object.keys(state.characters ?? {})) {
    if (id === "char_player") continue;
    const c = state.characters[id];
    if (!c || c.status === "dead") continue;
    const r = await retraitCharacter(state, id, model, force);
    if (r) out.push(r);
  }
  return out;
}
