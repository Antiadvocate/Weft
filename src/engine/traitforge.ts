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
import { figured } from "./aphorism";

const TRAIT_SYSTEM = `You rewrite one existing character's core traits in more concrete terms. You aren't redesigning the character.

The traits you're given are adjectives that sum up how this person behaves. Name what they actually do underneath, so that the old adjectives follow obviously from it. It's the same person with the same nature, described one step more concretely.

Check every line you write by asking whether you could film it. Each trait has to name at least one concrete thing, like an object, an animal, a food, a place, a part of the body or a specific action, and say what the person visibly does. If a camera pointed at them for a week couldn't capture it, it's wrong.

There are three ways of writing a trait that leave nothing to show:
 (a) An adjective, either the one you were given or the same word put differently. It sums up behaviour instead of naming any.
 (b) A trait that names no object and no action, because it describes how the person holds something in their mind instead of what their hands do about it. Ask it what thing and which action. If there's no answer, it's empty.
 (c) A trait that lets them know accurately what's going on inside another person just by looking, or that describes what they do to people as a comparison instead of an action. Nobody can do the first, and the second doesn't name anything a writer could show.

Here is the right way to write each kind:
- Temperament, as behaviour: "Answers before the other person has finished, every time, and never notices." "Takes a full breath before saying anything at all, even to say yes."
- Something they avoid or are drawn to, naming the thing: "Will not eat anything from fresh water, and cannot say why." "Sleeps with the shutter open in any weather."
- A natural talent, naming the skill: "Could untangle any knot before she could read; still does it while thinking."
- A physical habit, naming the body part and the object: "Holds everything — cup, knife, child — in the same two-handed grip." "Counts under her breath while waiting: steps, birds, sheep."
- A place they feel drawn to, naming it: "Goes to the water when anything goes wrong, and only then."

Rules you can't break:
1. Send back exactly as many traits as you were given, no more. If you were given three, send back three. Each one has to correspond to one original, and you say which in "from". Don't split one adjective into several traits.
2. Don't invent a new nature. Only describe again what the background, values, attachment style and existing traits already establish. If the original says nothing about how they handle fear, don't decide it.
3. A mood isn't a trait. If an original describes a current state, like "homesick and lonely" or "exhausted", name the lasting habit that makes them prone to it, again as something you could film.
4. No moral judgments. "Honorable", "kind" and "cruel" are judgments. Write the behaviour and let the reader judge.
5. Use words this world has. Name the behaviour in the plainest words the setting you were given allows, with no clinical terms and no terms from a field of knowledge this world doesn't have. Someone who knew them would recognise it straight away and wouldn't think it was clever.

Each trait is one short concrete phrase of under about 14 words. At least one has to be inconvenient, meaning something that causes them trouble or is tiring to be around, even if all the originals are flattering.

Reply with only this JSON:
{"traits":[{"trait":"","from":"which original adjective this describes"}]}`;

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
    `EXISTING CORE TRAITS (rewrite all of these): ${before.join(" | ")}`,
    `VALUES: ${(c.values ?? []).join(", ")}`,
    `WHAT THEY DO UNDER THREAT: ${c.attachment?.under_threat ?? "unstated — do not invent"}`,
    `WHAT SETTLES THEM: ${c.attachment?.soothed_by ?? "unstated — do not invent"}`,
    `CONSCIENCE (0 to 1, how much other people's pain matters to them): ${c.conscience ?? 0.7}`,
    acquired.length ? `WHAT PLAYING THE STORY HAS MADE THEM (this is separate, so don't fold it into the core traits): ${acquired.join(" | ")}` : "",
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

  /* HARD CAP. The prompt asks for one-per-original; a model that ignores that produced seven traits
   * from three and buried the person in noise. Truncate rather than trust.
   *
   * AND THE FIGURED ONES GO LAST, NOT OUT. The prompt's own test is COULD YOU FILM IT, and a trait
   * written as a general statement about people fails it by construction: "kindness that keeps
   * coming back for more of you" names no object, no place and no act, so a camera pointed at this
   * person for a week catches nothing. Sorting rather than dropping is deliberate — this pass is
   * required to account for every original trait, and discarding one would silently change who the
   * character is, which is the single thing the file header forbids. So the filmable translations
   * take the slots first and a figure only survives when nothing better was written for it. */
  const after = traits
    .map((t) => String(t?.trait ?? "").trim())
    .filter((t) => t.length > 3)
    .sort((a, b) => Number(figured(a)) - Number(figured(b)))
    .slice(0, Math.max(2, Math.min(4, before.length)));
  // A translation that loses most of the person is a failed call, not a result worth keeping.
  if (after.length < Math.max(2, before.length - 1)) return null;
  const stillFigured = after.filter(figured);
  if (stillFigured.length) console.warn(`[traitforge] ${c.name}: kept ${stillFigured.length} trait(s) that name no act — ${JSON.stringify(stillFigured)}`);

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
