// Coercion for model-supplied fields.
//
// The JSON schema says `taste: string` and `core_traits: string[]`, and models ignore that constantly.
// A prompt that says "2-3 plain phrases" gets an array back about as often as a string, and a prompt
// that says "a list" gets a comma-joined sentence. Both land in state and both crash later, far from
// where they came in: `(i.taste ?? "").trim is not a function` fires in the desire engine, three
// systems away from the Forge call that accepted the bad value.
//
// So nothing model-authored reaches state without passing through here. `?? ""` is not a guard — it
// only catches null and undefined, and the problem is never null. It is an array where a string
// belongs.

/** Any model value → string. Arrays join, objects stringify, numbers render, nullish → "". */
export function asText(v: unknown, joiner = ", "): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => asText(x, joiner)).filter(Boolean).join(joiner);
  if (typeof v === "object") {
    const vals = Object.values(v as Record<string, unknown>).map((x) => asText(x, joiner)).filter(Boolean);
    return vals.join(joiner);
  }
  return "";
}

/** Any model value → string[]. Strings split on commas/semicolons/newlines; nullish → []. */
export function asList(v: unknown, cap = 12): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => asText(x)).map((s) => s.trim()).filter(Boolean).slice(0, cap);
  if (typeof v === "string") return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, cap);
  const one = asText(v);
  return one ? [one] : [];
}

/** Any model value → number in [lo, hi], or undefined when it isn't a usable number. */
export function asNum(v: unknown, lo: number, hi: number): number | undefined {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    // strip units ("170cm") but never let a value with no digits become 0 — Number("") is 0, which
    // would silently turn conscience:"unknown" into conscience:0 and make the character a sociopath.
    const digits = v.replace(/[^0-9.\-]/g, "");
    n = /[0-9]/.test(digits) ? Number(digits) : NaN;
  } else n = NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(lo, Math.min(hi, n));
}

/** If canon declares that this world's people use a specific pronoun set — "they use xe/xem",
 *  "everyone uses ze/zir", "only they/them" — return that set as a "subj/obj/poss" string the
 *  narration layer understands. Returns undefined when canon says nothing, i.e. an ordinary world.
 *
 *  This exists because a model, told a world has no men or women, still tends to stamp "she/her" on
 *  every sheet out of habit, and the narrator then writes the whole cast as women. Canon is the
 *  premise's own voice, so canon is where we look for the world's real pronouns. */
export function detectWorldPronoun(canon: string[] | undefined): string | undefined {
  const text = (canon ?? []).join(" ").toLowerCase();
  if (!text) return undefined;
  // only treat anything as world-wide if canon frames it as the norm, not a single character's preference
  const framed = /\b(use|uses|only|all|every|no (?:men|man|women|woman|gender)|no concept)\b/.test(text);
  if (!framed) return undefined;
  // a pronoun set the premise explicitly names, e.g. "xe/xem/xer", "ze/zir", "they/them"
  const m = text.match(/\b(xe\s*\/\s*x[ei]m(?:\s*\/\s*x[ei]r)?|ze\s*\/\s*zir|ey\s*\/\s*em|they\s*\/\s*them)\b/);
  if (m) {
    const set = m[1].replace(/\s+/g, "");
    // normalize the common trio
    if (/^xe\/x[ei]m/.test(set)) return "xe/xem/xer";
    if (set.startsWith("ze/zir")) return "ze/zir/zir";
    if (set.startsWith("they/them")) return "they/them";
    return set;
  }
  // the same sets written out in words, any order: "the pronouns are xe, xer, and xem".
  // Word form needs a stronger frame than the slash form: the bare word "pronouns" also appears in
  // personal preferences ("John prefers xe/xem pronouns for himself"), which are not world law.
  const strongFrame = /\b(use|uses|only|all|every|no (?:men|man|women|woman|gender)|no concept)\b/.test(text) || /\bpronouns?\s+(are|is|:)/.test(text);
  if (!strongFrame) return undefined;
  if (/\bxe\b/.test(text) && /\bxe[rm]\b/.test(text)) return "xe/xem/xer";
  if (/\bze\b/.test(text) && /\bzir\b/.test(text)) return "ze/zir/zir";
  if (/\bey\b/.test(text) && /\bem\b/.test(text)) return "ey/em/em";
  return undefined;
}

/** When the world uses one pronoun set, natives cannot speak "he/him/his/she/her/hers" — those words
 *  don't exist for them. The narrator still slips them into DIALOGUE. This repairs only inside quotes,
 *  never in narration (where an outsider player with different pronouns legitimately takes "him"), and
 *  leaves the player's own name-adjacent references alone. Returns the fixed prose and a count.
 *
 *  Deliberately conservative: a wrong correction is worse than a missed one, so it only fires on the
 *  common set xe/xem/xer and only rewrites a gendered pronoun that is NOT within two words of the
 *  player's name (so "Rabi said he was lost", spoken by a native quoting the outsider, is left be —
 *  that is a marked moment, not a slip). */
export function repairNativePronouns(prose: string, worldPronoun: string | undefined, playerName: string): { prose: string; fixed: number } {
  if (!worldPronoun) return { prose, fixed: 0 };
  const parts = worldPronoun.split("/");
  const subj = parts[0] || "xe", obj = parts[1] || "xem", poss = parts[2] || parts[1] || "xer";
  const name = (playerName || "").split(/\s+/)[0];
  let fixed = 0;

  // operate only inside "..." dialogue spans
  const out = prose.replace(/"([^"]*)"/g, (whole, inner: string) => {
    const repaired = inner.replace(/\b(he|him|his|she|her|hers)\b/gi, (m: string, _g: string, offset: number) => {
      // leave alone if the player's name is within ~12 chars either side (likely about the outsider)
      const around = inner.slice(Math.max(0, offset - 14), offset + m.length + 14);
      if (name && around.toLowerCase().includes(name.toLowerCase())) return m;
      const low = m.toLowerCase();
      let repl = low === "he" || low === "she" ? subj : low === "him" || low === "her" ? obj : poss;
      if (low === "her") { // "her" is ambiguous (obj or poss); default to obj
        repl = obj;
      }
      // preserve capitalization
      if (m[0] === m[0].toUpperCase()) repl = repl.charAt(0).toUpperCase() + repl.slice(1);
      fixed++;
      return repl;
    });
    return `"${repaired}"`;
  });
  return { prose: out, fixed };
}

/**
 * A MODEL THAT FALLS INTO A LOOP, AND THE FIELD THAT KEEPS IT FOREVER.
 *
 * Decoding degenerates sometimes — the same phrase, over and over, until the token budget runs out.
 * In prose it is obvious and the player just rerolls. In a short STATE field it is quiet and
 * permanent: it renders on the card, it goes back into the next prompt as the character's current
 * want, and it re-seeds itself. One save had a want reading
 *
 *   "Continue to nurture the quiet intimacy with Rabi, deepening the shared private language with
 *    Jess and Jess's and Rabi's and Rabi's and Rabi's Rabi and Rabi and Rabi and Rabi and Rabi…"
 *
 * for six hundred characters. `cleanMood` already handles this for moods, but it splits on
 * punctuation and a loop like this one has none — it is a repeated n-gram in a single clause.
 *
 * Finds the shortest unit (1–6 words) that repeats back to back three or more times and cuts the
 * text where the repetition begins, then tidies a dangling connective off the end. Text with no
 * loop in it comes back untouched.
 */
export function deLoop(text: string): string {
  const words = String(text ?? "").trim().split(/\s+/);
  if (words.length < 6) return String(text ?? "").trim();
  const at = (i: number, n: number) => words.slice(i, i + n).join(" ").toLowerCase();
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + n * 3 <= words.length; i++) {
      const unit = at(i, n);
      if (!unit) continue;
      let reps = 1;
      while (at(i + reps * n, n) === unit) reps++;
      if (reps >= 3) {
        const cut = words.slice(0, i).join(" ").trim();
        // never return nothing: a field that is ALL loop keeps one copy of the unit rather than
        // vanishing, because an empty want is a different bug from a repetitive one
        const kept = cut || words.slice(i, i + n).join(" ");
        return kept.replace(/[\s,;:]*\b(and|or|with|the|a|an|of|to|for|in|by)\s*$/i, "").replace(/[\s,;:]+$/, "").trim();
      }
    }
  }
  return words.join(" ");
}

/** Cut to a length at a sentence or word boundary. A hard slice left one save's want-approach ending
 *  "a favour that requires" — the field has a ceiling, which should not read as a lost thought. */
/** Words that date a statement — the difference between "no one" and "no one at the moment". */
const TEMPORARY_STATE = /\b(currently|right now|for now|at the moment|at present|these days|just now|still|not yet|temporarily|since|until|after|too (?:raw|hurt|tired|frightened|scared|new)|survival|grieving|mourning|recovering)\b/i;

/**
 * Does this `attracted_to` value describe a MOOD rather than an orientation?
 *
 * The field means who a person can desire at all, and "no one" in it is a permanent hard cap in
 * desire.orientationCap. The forge is asked for one of four values and sometimes answers with a
 * state and a justification — "no one — currently too raw and survival-focused" — which then
 * freezes that character at zero desire for the rest of the game whatever happens in it.
 *
 * A qualifier that puts a clock on the statement is the tell. Someone who does not experience
 * attraction says so without one.
 */
export function orientationIsMood(attractedTo: unknown): boolean {
  const o = asText(attractedTo).toLowerCase();
  return /\b(no ?one|none|nobody)\b/.test(o) && TEMPORARY_STATE.test(o);
}

/**
 * THE PRONOUNS THE RECORD ALREADY IMPLIES.
 *
 * The forge is asked for a pronoun set per character and the schema says gender must never be
 * ambiguous, and models still leave it off: one save reached turn 31 with every single NPC carrying
 * `pronouns: undefined` while their own backgrounds said "the daughter of a freedman farmer",
 * "leaving her a widow", "a Campanian farmer's son". Nothing backfilled it, so the roster the
 * bookkeeper reads printed no gender for anybody and it guessed — which is how a he/him player got
 * recorded as the woman who bought a slave.
 *
 * This does not guess. It reads what the character's OWN record already says about them and adopts
 * it, and only when one set is overwhelming — a background that leans both ways is left blank
 * rather than decided by a coin toss, because a wrong set asserted confidently is worse than none.
 */
export function inferPronouns(text: string): string | undefined {
  const blob = String(text ?? "");
  if (blob.length < 20) return undefined;
  const fem = (blob.match(/\b(she|her|hers|herself)\b/gi) ?? []).length;
  const masc = (blob.match(/\b(he|him|his|himself)\b/gi) ?? []).length;
  const they = (blob.match(/\b(they|them|their|themselves)\b/gi) ?? []).length;
  const top = Math.max(fem, masc, they);
  if (top < 3) return undefined;                       // too little evidence to call
  const rest = fem + masc + they - top;
  if (top < rest * 2) return undefined;                // not overwhelming — leave it unset
  return top === fem ? "she/her" : top === masc ? "he/him" : "they/them";
}

export function tidyPhrase(text: unknown, max = 140): string {
  const t = deLoop(asText(text));
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (stop >= max * 0.5) return head.slice(0, stop + 1).trim();
  const sp = head.lastIndexOf(" ");
  return (sp > 0 ? head.slice(0, sp) : head).replace(/[\s,;:]+$/, "").trim() + "…";
}

/**
 * A WANT IS WHAT THEY DO, NOT A SENTENCE ABOUT THEM.
 *
 * The bookkeeper writes many characters' fields in one JSON object, bound to a person by nothing but
 * an id — so it slips. Measured across every save to hand: 4% of drives had a goal naming their own
 * owner. "Mable makes Rabi kneel and worship her feet" is Mable's own goal written from outside her;
 * "deepening the shared private language with Jess" is Jess's own goal treating Jess as the other
 * party, and that one had also degenerated into a loop, which is what confusion tends to precede.
 *
 * The engine taught it the format. `seedDrive` had a fallback reading "pursue what matters most to
 * Hewitt right now", so a card could show a goal in the third person naming its owner, and the model
 * copied what it saw.
 *
 * Two shapes, two answers, because they are not equally safe to touch:
 *   · LEADING — "Mable makes Rabi kneel…" — strip the name and lower-case what follows. The meaning
 *     is unchanged and the result is the imperative a goal is supposed to be.
 *   · MID-SENTENCE — the name buried inside a clause. Never rewritten: any edit is a guess about
 *     what was meant. Reported instead, so it can be corrected where it was written.
 */
export function ownWant(ownerName: string, text: unknown): { goal: string; slipped: boolean } {
  const goal = asText(text).trim();
  const first = (ownerName || "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, "");
  if (!goal || !first || first.length < 3) return { goal, slipped: false };
  const lead = new RegExp(`^${first}(?:'s)?\\s+`, "i");
  let out = goal;
  if (lead.test(out)) {
    out = out.replace(lead, "");
    out = out.charAt(0).toLowerCase() + out.slice(1);
  }
  const stillThere = new RegExp(`\\b${first}(?:'s)?\\b`, "i").test(out);
  return { goal: out, slipped: stillThere };
}

/** EVERY LIST FIELD IS ACTUALLY A LIST.
 *
 *  The diff schema declares ~30 array fields and the engine reads them as arrays: `(diff.psyche ??
 *  []).filter(...)`. That guard covers null and undefined and nothing else, so when a model emits a
 *  single record where a list was asked for —
 *
 *      "psyche": { "char_id": "char_dana", "relaxation_delta": -2 }
 *
 *  — instead of wrapping it in brackets, the turn dies with "(Xe.psyche ?? []).filter is not a
 *  function" and the player loses the whole turn to a missing pair of square brackets.
 *
 *  One object where a list belongs is a list of one; that reading is never wrong. Normalising once
 *  at the boundary is also the only version that stays fixed — guarding the call sites means
 *  guarding all of them forever, and there are thirty, and the next one added will not be guarded. */
export function normalizeDiffArrays<T extends Record<string, unknown>>(diff: T): T {
  for (const [k, v] of Object.entries(diff)) {
    if (v === null || v === undefined || Array.isArray(v)) continue;
    // Only fields the engine iterates. A scalar (elapsed_minutes, scene_summary) stays a scalar;
    // wrapping those would turn a number into [number] and break arithmetic downstream.
    if (typeof v === "object") (diff as Record<string, unknown>)[k] = [v];
  }
  return diff;
}

/**
 * THE DOOR, WHEN THE WANT DOES NOT COME WITH ONE.
 *
 * A drive's `approach` is how somebody goes at a want — the sideways move, the adjacent subject, the
 * small deniable version floated first. Without it the intent pass has nothing to make a surface out
 * of except the want itself, and a surface that IS the want is an announcement: the character walks
 * in and states their business, every time, which is exactly what a 47-turn save read like when all
 * three of its people carried `approach: null`.
 *
 * They go missing constantly and legitimately. The approach only survives a bookkeeper rewrite while
 * the GOAL is unchanged, and goals change often — so any turn a want moves on, the door is gone
 * unless the bookkeeper wrote a new one, which it usually does not.
 *
 * But the door was never really a property of the want. It is a property of the PERSON, and the
 * forge already wrote it down twice: `voice.agenda` is what they are angling for under the words,
 * and `voice.tics` are the moves they make to get there. One character's card carried "to steer any
 * conversation off the closed door and back to something she can point at", "swerves to the physical
 * environment when pressed", and "asks about logistics to stop a personal question" — a complete
 * account of how she approaches anything, sitting unused while she announced her feelings in plain
 * sentences for forty turns.
 *
 * Derived at the point of use and never written into state: this is not the bookkeeper's authorship
 * and must not come to look like it.
 */
export function doorFromVoice(c: { voice?: { agenda?: string; tics?: string[] } } | undefined): string | undefined {
  const agenda = c?.voice?.agenda?.trim();
  const tics = (c?.voice?.tics ?? []).map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, 2);
  if (!agenda && !tics.length) return undefined;
  const parts = [agenda, tics.join("; ")].filter(Boolean);
  return `their usual way of getting at anything — ${parts.join(", by ")}`;
}

/**
 * THE ROLES NOBODY EVER SET.
 *
 * A role is a standing fact about a relationship — husband, sister, employer, neighbour — and the
 * engine reads them for a dozen things: how a scene addresses somebody, what a severance costs, what
 * the narrator may assume. Nothing ever created one. The forge writes `relation_to_player` as a
 * sentence and drops it into the edge's NOTES, which is prose nobody parses, and the only other
 * writer is the bookkeeper's `roles_set` — which was erasing them (see social.ts).
 *
 * So a world whose canon reads "Vin and Miranda have a strong, loving, and stable marriage that is
 * the bedrock" reached turn 114 with not one role on any edge anywhere in it.
 *
 * The sentence is right there and it says the thing. "His wife of six years" contains "wife".
 */
const RELATION_WORDS = [
  "wife", "husband", "spouse", "partner", "fiancé", "fiancée", "fiancee", "girlfriend", "boyfriend",
  "mother", "father", "mom", "mum", "dad", "parent", "son", "daughter", "child",
  "sister", "brother", "sibling", "aunt", "uncle", "niece", "nephew", "cousin", "grandmother", "grandfather",
  "friend", "best friend", "neighbour", "neighbor", "colleague", "coworker", "co-worker", "boss",
  "employer", "employee", "landlord", "tenant", "teacher", "student", "doctor", "patient",
  "lawyer", "client", "mentor", "apprentice", "rival", "ex-wife", "ex-husband", "ex",
];

/** The standing roles a relation sentence actually names. Longest first, so "best friend" wins over
 *  "friend", and capped at two because a person is not a list of labels. */
export function rolesFromRelation(relation: unknown): string[] {
  const t = String(relation ?? "").toLowerCase();
  if (!t.trim()) return [];
  const found: string[] = [];
  for (const w of [...RELATION_WORDS].sort((a, b) => b.length - a.length)) {
    if (found.some((f) => f.includes(w))) continue;                 // "friend" inside "best friend"
    if (new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}\\b`, "i").test(t)) found.push(w);
    if (found.length >= 2) break;
  }
  return found;
}
