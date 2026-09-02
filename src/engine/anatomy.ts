/**
 * ANATOMY — what body the record actually gives a character, stated as a negative.
 *
 * THE FAILURE, REPORTED ACROSS SEVERAL SAVES OF THE SAME WORLD. A character's record says, in the
 * player's own words, "She never had bottom surgery", "she loves her feet and her penis", "she only
 * has sex with Rabi by penetrating him", and — as an authored drive the player typed by hand —
 * "Tries to force her penis into Rabi's urethra." The narrator wrote her with a vulva anyway:
 *
 *     she lifts one foot up onto the edge of the tub, opening herself to the steam and the spray,
 *     and her fingers part the wet hair between her legs
 *
 * The player had to correct it by typing "I take her cock in my mouth" the following turn. And it
 * does not stop at the page: the bookkeeper files what the narrator wrote, so her life_history now
 * permanently reads "I lifted my foot up and opened myself for him" — the error becomes the record,
 * and the record teaches the next turn. That is why it recurs.
 *
 * WHY THE EXISTING RULES DO NOT CATCH IT. The narrator's law already says the right thing twice:
 * FINAL CHECK 15, "Every body rendered with only the anatomy the record gives it", and the digest's
 * CANON OVERRIDES YOUR DEFAULTS block. Both are written for non-human bodies — the discs and
 * columns and toes — and both are general statements. The engine's own negative-canon field says
 * exactly why a general statement is not enough, in the sentence that is the whole design of this
 * module:
 *
 *     "Absence cannot be inferred from description: a body described by its disc, column and toes
 *      still gets a mouth, a face, and hair supplied by default the moment it speaks. So state it
 *      outright."
 *
 * That doctrine is applied at world scale (`world_bible.absent`) and to non-humanoids. It was never
 * applied to a human body whose configuration is not the one a category name implies. So the record
 * said penis, over and over, and the model supplied the other thing the moment a scene reached for
 * one, because nothing had ever said the words "she does not have".
 *
 * ── WHAT THIS MODULE WILL AND WILL NOT INFER ───────────────────────────────────────────────────
 *
 * It reads ONLY what the record names. It never reasons from a category to a body: "trans woman",
 * "trans man", "woman", "man", "intersex" tell it nothing, and a record that names no genital
 * anatomy produces no statement at all — the narrator is told nothing and nothing is enforced. That
 * is not timidity, it is the actual fix: substituting a category default for the written record is
 * the entire bug, and a module that did the same thing in the other direction would be the same bug
 * with different politics. Whatever the player wrote is what the character has.
 *
 * The one inference it does make is exhaustiveness, and only where the record has spoken. If the
 * record names a character's genital anatomy at all, that naming is treated as complete for this
 * purpose: what it lists, they have; what it does not list, the narrator does not get to supply. A
 * player who wants a character to have both writes both, both are named, and no negative fires.
 * This is the same bargain the engine already strikes with `absent` — the author states the body,
 * and the stated body is the one that gets written.
 */
import type { Identity, SaveState } from "./types";

export type Part = "penis" | "vulva";

/** Terms that NAME the part, in a record or in prose. Deliberately narrow: clinical, common and
 *  vulgar registers for the organ itself, and nothing that merely gestures at a region. "Between
 *  her legs", "her sex", "down there" and the rest are genuinely ambiguous — a penis is between the
 *  legs too — and a detector that fired on them would fire on correct prose. */
const TERMS: Record<Part, RegExp> = {
  penis: /\b(penis|penile|cock|cocks|dick|phallus|phallic|shaft|testicles?|scrotum|ballsack)\b/i,
  vulva: /\b(vagina|vaginal|vulva|vulval|clitoris|clitoral|clit|labia|labial|pussy|cunt)\b/i,
};

/** THE WORD IS ALMOST NEVER THE WORD. On the save that prompted this, the narrator did not write
 *  "vagina" once. It wrote:
 *
 *      she lifts one foot up onto the edge of the tub, opening herself to the steam and the spray,
 *      and her fingers part the wet hair between her legs
 *
 *  A detector built only on TERMS above would have passed that turn clean, which is most of why the
 *  failure kept surviving: prose in this register reaches for the oblique phrase, and the oblique
 *  phrase is the one that carries the wrong body onto the page.
 *
 *  So a second, much narrower set — only for a vulva, only phrases that describe an act no other
 *  configuration supports. Parting, spreading and opening are the tell: a penis is not parted, and
 *  it is not what a hand opens. Anything that a penis ALSO answers to ("between her legs", "her
 *  sex", "down there", "inside her" — a body without a vulva can still be entered) is deliberately
 *  absent, because a detector that fires on correct prose teaches the narrator to write worse.
 *
 *  `context` guards the one loose member: "opened herself" is also an ordinary emotional idiom, so
 *  it counts only in a sentence that is already about a body. */
const SOFT_VULVA: { re: RegExp; context?: boolean }[] = [
  { re: /\b(?:her|his|their|xer)\s+(?:folds|slit|wetness|slickness|entrance|opening)\b/i },
  { re: /\bpart(?:s|ed|ing)?\b[^.!?]{0,40}\bbetween\s+(?:her|his|their|xer)\s+legs\b/i },
  { re: /\bspread(?:s|ing)?\b[^.!?]{0,20}\b(?:herself|himself|themselves|open)\b/i },
  { re: /\b(?:open|opens|opened|opening)\s+(?:herself|himself|themselves)\b/i, context: true },
];

/** Is this sentence about a body at all? Gates the loose pattern above. */
const PHYSICAL = /\b(finger|fingers|hand|hands|tongue|mouth|thigh|thighs|legs|hips?|tub|shower|bed|skin|wet|naked|bare|knees?|taste|lick|touch|stroke)\b/i;

/** Every way the prose can put this part on a body, explicit and oblique. Returns where in the
 *  sentence it landed, so ownsIt can ask who was named before it, or -1 for no appearance. */
function partAppears(part: Part, sentence: string): number {
  const direct = sentence.match(TERMS[part]);
  if (direct?.index !== undefined) return direct.index;
  if (part !== "vulva") return -1;
  for (const p of SOFT_VULVA) {
    const m = sentence.match(p.re);
    if (m?.index !== undefined && (!p.context || PHYSICAL.test(sentence))) return m.index;
  }
  return -1;
}

/** The opposite part, for the negative statement. */
const OTHER: Record<Part, Part> = { penis: "vulva", vulva: "penis" };

/** How the negative is spelled out. Listing the synonyms is the point: the failure arrives in
 *  whichever register the scene is in, and a prohibition on "vagina" is not read as covering
 *  "pussy" by a model reaching for the vulgar word mid-scene. */
const DENIAL: Record<Part, (poss: string, obj: string) => string> = {
  vulva: (poss, obj) => `no vagina, no vulva, no labia, no clitoris — nothing on ${poss} body to enter, penetrate, part, spread or be wet, and none of those words describes any part of ${obj}`,
  penis: (poss, obj) => `no penis, no cock, no shaft, no testicles — nothing on ${poss} body that hardens, enters, or can be taken into a mouth or a hand as one, and none of those words describes any part of ${obj}`,
};

/** This character's own possessive and object pronoun, off the card. The digest's pronoun lock is
 *  absolute — "never substitute the set your training reaches for" — and a block about somebody's
 *  body written in the wrong set is the last place to break it. Falls back to they/them, which is
 *  also what an unstated set gets. */
function pronounsOf(raw: string | undefined): { poss: string; obj: string; subj: string } {
  const p = String(raw ?? "").toLowerCase();
  if (/\bshe\b|\bher\b/.test(p)) return { poss: "her", obj: "her", subj: "she" };
  if (/\bhe\b|\bhim\b/.test(p)) return { poss: "his", obj: "him", subj: "he" };
  if (/\bxe\b|\bxer\b/.test(p)) return { poss: "xer", obj: "xem", subj: "xe" };
  if (/\bit\b/.test(p)) return { poss: "its", obj: "it", subj: "it" };
  return { poss: "their", obj: "them", subj: "they" };
}

/** An explicit statement that a surgery did NOT happen. This phrase is why the module exists: it is
 *  what the player wrote, it is decisive about the configuration, and it is the exact sentence the
 *  model read and then overrode. Handled as evidence in its own right, never as a fact about any
 *  category of person. */
const NO_BOTTOM_SURGERY = /\b(?:never|not|no|hasn'?t|has not|didn'?t|did not|without)\b[^.;]{0,40}\bbottom surgery\b|\bbottom surgery\b[^.;]{0,20}\b(?:never|not)\b/i;

export interface AnatomyRecord {
  /** Parts the record names. */
  has: Part[];
  /** Parts the narrator must not supply, because the record named the body and did not name these. */
  lacks: Part[];
  /** The sentence from the record that settled it — quoted back so the instruction is never a bare
   *  assertion the narrator has to take on faith. */
  evidence: string;
}

/** A fragment of the record, and whether it is inherently ABOUT this character. A card field is:
 *  it is their background, their trait, their authored drive, and an unattributed "her penis" in it
 *  is theirs. A canon line is not: it is a world fact that merely happens to name them, so a term
 *  in it must be attributed before it counts. */
interface Fragment { text: string; owned: boolean }

/** Every place a character's body is on the record, in the order a reader would trust them. */
function recordText(state: SaveState, id: string, c: Identity): Fragment[] {
  const bits: Fragment[] = [];
  const push = (s: unknown, owned: boolean) => { const t = String(s ?? "").trim(); if (t) bits.push({ text: t, owned }); };
  push(c.appearance_facts, true);
  push(c.background, true);
  for (const t of c.core_traits ?? []) push(t, true);
  for (const v of c.values ?? []) push(v, true);
  for (const a of (c as { authored?: { goal?: string; because?: string }[] }).authored ?? []) { push(a.goal, true); push(a.because, true); }
  // World canon that names this person. Canon outranks a card and routinely carries exactly this
  // kind of line ("Emily loves her feet and her penis").
  const first = (c.name ?? "").split(/\s+/)[0] ?? "";
  if (first.length >= 3) {
    for (const line of state.world?.canon ?? []) {
      if (String(line).toLowerCase().includes(first.toLowerCase())) push(line, false);
    }
  }
  // NOT life_history, and not appearance_now. life_history is written from the narrator's own prose,
  // so a turn that got the body wrong would otherwise become the evidence that it was right — which
  // is precisely how this error made itself permanent on the save that prompted the module.
  return bits;
}

/** WHOSE PART IS THIS? A record is full of other people's bodies, and the first version of this
 *  module read Rabi's own core trait — "Loves Emily's cock, fondly nuzzles it" — as evidence about
 *  Rabi. It happened to reach the right answer for him and would reach a catastrophically wrong one
 *  for the next character, whose record mentions only a partner's anatomy.
 *
 *  So: sentence-scoped. Take the names of the cast that appear in the same sentence BEFORE the term.
 *  The last of them is who the part belongs to. When none appear, the sentence has no other claimant
 *  and an owned fragment is about its owner — which is what makes "She loves her feet and her penis,
 *  and Rabi's acceptance of her body is a cornerstone" read correctly for Emily and not for Rabi. */
function attributed(frag: Fragment, term: RegExp, selfFirst: string, castFirsts: string[]): boolean {
  const self = selfFirst.toLowerCase();
  for (const sentence of frag.text.split(/(?<=[.!?;])\s+/)) {
    const m = sentence.match(term);
    if (!m || m.index === undefined) continue;
    const before = sentence.slice(0, m.index).toLowerCase();
    // The nearest claimant, by position — not by the order the cast happens to be stored in.
    let bestAt = -1, last = "";
    for (const n of castFirsts) {
      const re = new RegExp(`\\b${n}('s)?\\b`, "g");
      for (const hit of before.matchAll(re)) {
        if (hit.index !== undefined && hit.index > bestAt) { bestAt = hit.index; last = n; }
      }
    }
    if (last) { if (last === self) return true; continue; }
    if (frag.owned) return true;
  }
  return false;
}

/** Read a character's genital anatomy off their record. Returns null when the record does not name
 *  it, which is the common case and means: say nothing, enforce nothing. */
export function readAnatomy(state: SaveState, id: string, c: Identity): AnatomyRecord | null {
  const bits = recordText(state, id, c);
  const selfFirst = ((c.name ?? "").split(/\s+/)[0] ?? "").toLowerCase();
  if (selfFirst.length < 2) return null;
  const castFirsts = Object.values(state.characters ?? {})
    .map((o) => ((o?.name ?? "").split(/\s+/)[0] ?? "").toLowerCase())
    .filter((n) => n.length >= 3);
  const has: Part[] = [];
  let evidence = "";
  for (const part of ["penis", "vulva"] as Part[]) {
    const hit = bits.find((b) => TERMS[part].test(b.text) && attributed(b, TERMS[part], selfFirst, castFirsts));
    if (hit) {
      has.push(part);
      if (!evidence) evidence = hit.text;
    }
  }
  if (!has.length) return null;
  const lacks = has.length === 1 ? [OTHER[has[0]]] : [];
  // The surgery statement, when present, is the better quote: it is the one the player wrote to
  // settle the question, and it says outright that nothing was changed.
  const surgical = bits.find((b) => b.owned && NO_BOTTOM_SURGERY.test(b.text));
  if (surgical) {
    const sentence = surgical.text.split(/(?<=[.!?;])\s+/).find((x) => NO_BOTTOM_SURGERY.test(x));
    evidence = sentence ?? surgical.text;
  }
  return { has, lacks, evidence: evidence.trim().slice(0, 200) };
}

/** The binding line for the character card. Empty when the record says nothing. */
export function anatomyNote(rec: AnatomyRecord | null, name: string, pronouns?: string): string {
  if (!rec || !rec.lacks.length) return "";
  const hasList = rec.has.join(" and ");
  const { poss, obj, subj } = pronounsOf(pronouns);
  return ` ANATOMY (BINDING, AND THE NEGATIVE HALF IS THE BINDING HALF): the record gives ${name} a ${hasList}, and gives ${name} nothing else of the kind: ${DENIAL[rec.lacks[0]](poss, obj)}. This is not a detail to be tactful about or a gap for you to fill in — it is the body this person has, it is the body the player wrote, and it does not change to suit a scene. Where your training would supply the other configuration because of what ${name} is called, what pronouns ${name} uses, how ${subj} is dressed, or what is being done to ${obj}, that default is WRONG HERE and you catch it before it lands. Every act, every touch, every description and every line of dialogue about this body uses only what is named above. If a moment cannot be written without the part ${name} does not have, write a different moment.${rec.evidence ? ` The record's own words: "${rec.evidence}"` : ""}`;
}

/** Whose body is this sentence about?
 *
 *  Positionally, for the same reason the record side is: "Nadia's vulva was none of Emily's
 *  business" names Emily, and a test that only asked whether her name appears would charge that
 *  sentence to her. The claimant is the nearest cast name BEFORE the part. Failing that — nobody
 *  named ahead of it — the sentence is theirs only when they are the one other person in the room,
 *  and the possessive matches the pronouns their card prints. */
function ownsIt(sentence: string, at: number, name: string, pronoun: string, sole: boolean, castFirsts: string[]): boolean {
  const first = ((name ?? "").split(/\s+/)[0] ?? "").toLowerCase();
  const before = sentence.slice(0, at).toLowerCase();
  let bestAt = -1, last = "";
  for (const n of castFirsts) {
    for (const hit of before.matchAll(new RegExp(`\\b${n}('s)?\\b`, "g"))) {
      if (hit.index !== undefined && hit.index > bestAt) { bestAt = hit.index; last = n; }
    }
  }
  if (last) return last === first;
  if (!sole) return false;
  const { poss } = pronounsOf(pronoun);
  return new RegExp(`\\b${poss}\\b`).test(before);
}

export interface AnatomyHit { name: string; part: Part; sentence: string; pronouns?: string }

/**
 * Anatomy in the prose that the record contradicts. Sentence-scoped, because a paragraph routinely
 * holds two bodies and the possessive is what tells them apart.
 */
export function findAnatomyBreach(state: SaveState, prose: string): AnatomyHit | null {
  const present = (state.world?.present ?? []).filter((id) => id !== "char_player" && state.characters?.[id]);
  const sole = present.length === 1;
  const castFirsts = Object.values(state.characters ?? {})
    .map((o) => ((o?.name ?? "").split(/\s+/)[0] ?? "").toLowerCase())
    .filter((n) => n.length >= 3);
  const sentences = String(prose ?? "").split(/(?<=[.!?])\s+|\n+/);
  for (const id of present) {
    const c = state.characters[id];
    if (!c) continue;
    const rec = readAnatomy(state, id, c);
    if (!rec?.lacks.length) continue;
    const part = rec.lacks[0];
    for (const sentence of sentences) {
      const at = partAppears(part, sentence);
      if (at < 0) continue;
      if (!ownsIt(sentence, at, c.name ?? "", c.pronouns ?? "", sole, castFirsts)) continue;
      return { name: c.name ?? "", part, sentence: sentence.trim().slice(0, 200), pronouns: c.pronouns };
    }
  }
  return null;
}

/** The correction, quoting the model back to itself on the following turn — the same mechanism as
 *  echo.ts and maxims.ts, and for the same reason: this can only be said once the model has already
 *  written it, and naming the failure in advance would only paste the wrong words into the prompt. */
export function anatomyFix(hit: AnatomyHit | null | undefined): string {
  if (!hit?.sentence) return "";
  const { obj, subj } = pronounsOf(hit.pronouns);
  return `\nLAST TURN THE PROSE GAVE ${hit.name.toUpperCase()} A BODY THE RECORD DOES NOT GIVE ${obj.toUpperCase()}: "${hit.sentence}…"
${hit.name} has no ${hit.part === "vulva" ? "vagina, vulva, labia or clitoris" : "penis, cock or testicles"}, and never did. That sentence is void: it did not happen, nobody remembers it, and no one refers back to it — do not correct it in the fiction, do not have anyone remark on it, do not write a scene explaining it. Continue as though the body had been written correctly all along. THIS TURN, and every turn after it, ${hit.name}'s body is only what the record names, in narration and in every character's mouth alike, in whatever register the scene is in — the clinical word, the affectionate word and the crude word are all the same prohibition. If the scene reached for that part because of what ${hit.name} is called or how ${subj} is dressed, that is the default you are here to catch.`;
}
