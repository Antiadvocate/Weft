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

The traits you are given are adjectives — summaries of how this person BEHAVES. Name what they DO underneath, such that the old adjectives are the obvious consequence. Same person, same nature, one level more concrete.

THE TEST, applied to every line you write: COULD YOU FILM IT? Each trait must name at least one concrete thing — an object, an animal, a food, a place, a part of the body, a specific action — and say what the person observably does. If a camera pointed at them for a week could not capture it, it is wrong.

THREE WAYS OF WRITING ONE THAT LEAVE NOTHING TO SHOW:
 (a) AN ADJECTIVE — the word you were given, or the same word rephrased. It summarises behaviour instead of naming any.
 (b) A TRAIT THAT NAMES NO OBJECT AND NO ACTION — one that describes how this person holds something in their mind rather than what their hands do about it. Ask it: what thing? which action? If there is no answer, it is empty.
 (c) A TRAIT THAT GIVES THEM ACCURATE KNOWLEDGE OF ANOTHER PERSON'S INSIDE ON SIGHT, or that states what they do to people as a comparison rather than as an act. Nobody can do the first, and the second names nothing to write.

Right form, by kind:
- TEMPERAMENT AS CONDUCT: "Answers before the other person has finished, every time, and never notices." "Takes a full breath before saying anything at all, even to say yes."
- AVERSION OR PULL, naming the thing: "Will not eat anything from fresh water, and cannot say why." "Sleeps with the shutter open in any weather."
- UNEARNED APTITUDE, naming the skill: "Could untangle any knot before she could read; still does it while thinking."
- PHYSICAL SIGNATURE, naming body and object: "Holds everything — cup, knife, child — in the same two-handed grip." "Counts under her breath while waiting: steps, coins, sheep."
- AFFINITY, naming the place: "Goes to the water when anything goes wrong, and only then."

HARD CONSTRAINTS:
1. RETURN EXACTLY AS MANY TRAITS AS YOU WERE GIVEN. Not more. If you were given three, return three. Each must account for one original — say which in "from". Do not split one adjective into several traits.
2. INVENT NO NEW NATURE. Re-describe only what the background, values, attachment and existing traits already establish. If the original says nothing about how they handle fear, do not decide.
3. A MOOD IS NOT A TRAIT. If an original is a current state ("homesick and lonely", "exhausted"), name the standing habit that makes them prone to it — again as something filmable.
4. NO MORAL VERDICTS. "Honorable", "kind", "cruel" are judgements. Write the conduct; let the reader judge.
5. USE WORDS THIS WORLD HAS. Name the conduct in the plainest terms available in the setting you were given: no clinical vocabulary, and no term from a body of knowledge this world does not have. A person who knew them would recognise it at once and would not call it clever.

Each trait: one short concrete phrase, under about 14 words. At least one must be INCONVENIENT — something that costs them or is tiring to be near. If the originals are all flattering, the honest version still is not.

Output ONLY this JSON:
{"traits":[{"trait":"","from":"which original adjective this expresses"}]}`;

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
    c.voice?.idiolect?.trim() ? `HOW THEY TALK: ${c.voice.idiolect.trim()}${c.voice.idiolect_shows?.trim() ? ` — ${c.voice.idiolect_shows.trim()}` : ""}` : "",
  ].filter(Boolean).join("\n");

  let traits: { trait?: string; from?: string }[] = [];
  try {
    const msgs = buildMessages(TRAIT_SYSTEM, "CHARACTER:", brief, model);
    const out = await complete(msgs, model, model, true, 1200);
    traits = safeJson<{ traits?: { trait?: string; from?: string }[] }>(out.text, {}).traits ?? [];
  } catch {
    return null;
  }

  // HARD CAP. The prompt asks for one-per-original; a model that ignores that produced seven traits
  // from three and buried the person in noise. Truncate rather than trust.
  const after = traits
    .map((t) => String(t?.trait ?? "").trim())
    .filter((t) => t.length > 3)
    .slice(0, Math.max(2, Math.min(4, before.length)));
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
