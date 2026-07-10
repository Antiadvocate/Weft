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
