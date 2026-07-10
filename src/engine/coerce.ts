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
  // a pronoun set the premise explicitly names, e.g. "xe/xem/xer", "ze/zir", "they/them"
  const m = text.match(/\b(xe\s*\/\s*x[ei]m(?:\s*\/\s*x[ei]r)?|ze\s*\/\s*zir|ey\s*\/\s*em|they\s*\/\s*them)\b/);
  if (!m) return undefined;
  // only treat it as world-wide if canon frames it as the norm, not a single character's preference
  if (!/\b(use|uses|only|all|every|no (?:men|man|women|woman|gender)|no concept)\b/.test(text)) return undefined;
  const set = m[1].replace(/\s+/g, "");
  // normalize the common trio
  if (/^xe\/x[ei]m/.test(set)) return "xe/xem/xer";
  if (set.startsWith("ze/zir")) return "ze/zir/zir";
  if (set.startsWith("they/them")) return "they/them";
  return set;
}
