/**
 * THE INSPECTOR — a typed, navigable editor for everything in a save.
 *
 * The raw JSON editor is the most-used debugging tool in the app and the least usable thing in it.
 * It is one monospace textarea holding a whole world: to change a belief you scroll past every
 * place description, every edge, and — once a portrait exists — a hundred kilobytes of base64 that
 * takes real seconds to scroll through and cannot be read, edited or usefully seen. Everything is
 * the same size and the same colour, so "where are the traits" is a text search in a box that has
 * no text search. And it only ever exposed a slice of the world; characters, memory, condition and
 * traits were not reachable at all.
 *
 * This module is the part of the fix that has no React in it: how a value should be edited, what to
 * call it, how to find it, and how to write it back. The view is a renderer over these decisions.
 */

/** How a value should be presented. The view maps each of these to a control. */
export type FieldKind =
  | "text"        // one line
  | "prose"       // multi-line
  | "number"
  | "boolean"
  | "list"        // string[]
  | "map"         // Record<string, string>
  | "image"       // a data: URI or an opaque blob — never rendered as text
  | "objects"     // an array of records
  | "group"       // a nested object
  | "unknown";    // anything else — falls back to JSON

/** Keys whose string values are long-form by nature, however short they happen to be right now. */
const PROSE_KEYS = /^(background|life_history|appearance_facts|appearance_now|description_facts|description|taste|narrator_direction|political_situation|what_people_fear|climate_and_geography|cultures_and_languages|magic_rules|technology_level|forbidden|absent|destination|tone|content|full_content|summary|narrator_prose|player_action|blocker|goal|objective|consequence|notes|stale_note|under_threat|soothed_by|agenda|rule|title|premise|art_direction|opening_scene_hint)$/;

/** Keys that hold image payloads. Their length is the problem, so they are never text. */
const IMAGE_KEYS = /(portrait_url|image_url|image|thumbnail|avatar|_url$)/i;

/** A data URI, or a string long enough that no human is editing it by hand. */
export function isImageData(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^data:image\//i.test(v) || (v.length > 2048 && !/\s/.test(v.slice(0, 200)));
}

export function classify(key: string, v: unknown): FieldKind {
  if (v === null || v === undefined) return "text";
  if (isImageData(v)) return "image";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") {
    if (IMAGE_KEYS.test(key) && (v.length > 512 || /^data:/i.test(v))) return "image";
    return PROSE_KEYS.test(key) || v.length > 80 || v.includes("\n") ? "prose" : "text";
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "list";                                  // assume string[] until proven otherwise
    if (v.every((x) => typeof x === "string")) return "list";
    if (v.every((x) => x && typeof x === "object" && !Array.isArray(x))) return "objects";
    return "unknown";
  }
  if (typeof v === "object") {
    const vals = Object.values(v as Record<string, unknown>);
    if (vals.length && vals.every((x) => typeof x === "string" || typeof x === "number")) return "map";
    return "group";
  }
  return "unknown";
}

/** "core_traits" → "Core traits". "drive_queue" → "Drive queue". Ids are left alone. */
export function labelFor(key: string): string {
  if (/^(id|character_id|char_id)$/.test(key)) return key;
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Read a value at a path. Returns undefined for any missing link. */
export function getPath(root: unknown, path: (string | number)[]): unknown {
  let cur: any = root;
  for (const k of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k as any];
  }
  return cur;
}

/**
 * Write a value at a path, returning a NEW root — the view holds a draft and diffs it, so mutating
 * in place would make every edit invisible to React and every cancel unrecoverable. Missing links
 * are created as objects, or arrays when the next key is a number.
 */
export function setPath<T>(root: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [head, ...rest] = path;
  const isIndex = typeof head === "number";
  const base: any = root ?? (isIndex ? [] : {});
  const copy: any = Array.isArray(base) ? [...base] : { ...base };
  copy[head as any] = rest.length ? setPath(copy[head as any], rest, value) : value;
  return copy;
}

/** Drop a key or splice an index out, returning a new root. */
export function deletePath<T>(root: T, path: (string | number)[]): T {
  if (!path.length) return root;
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  const parent: any = getPath(root, parentPath);
  if (parent === null || parent === undefined) return root;
  if (Array.isArray(parent)) {
    if (typeof last !== "number") return root;
    return setPath(root, parentPath, parent.filter((_, i) => i !== last));
  }
  const { [last as string]: _drop, ...rest } = parent;
  return setPath(root, parentPath, rest);
}

/**
 * Does this field match what the user typed in the filter box?
 *
 * Matches the key, the human label, the trailing path (so "mable beliefs" finds it), and the value
 * itself for anything short enough to be worth searching. Image payloads are never searched — the
 * whole point is that nobody reads them.
 */
export function matchesQuery(path: (string | number)[], value: unknown, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay: string[] = [];
  for (const seg of path) hay.push(String(seg), labelFor(String(seg)));
  if (typeof value === "string" && !isImageData(value)) hay.push(value.slice(0, 400));
  else if (typeof value === "number" || typeof value === "boolean") hay.push(String(value));
  else if (Array.isArray(value) && value.every((x) => typeof x === "string")) hay.push(value.join(" ").slice(0, 400));
  const blob = hay.join(" ").toLowerCase();
  // every whitespace-separated term must appear, so "mable belief" narrows rather than widens
  return q.split(/\s+/).every((term) => blob.includes(term));
}

/** Rough byte size of a payload, for showing what a portrait is costing. */
export function approxBytes(v: string): number {
  const b64 = v.indexOf(",");
  const body = /^data:/i.test(v) && b64 > 0 ? v.slice(b64 + 1) : v;
  return Math.round(body.length * 0.75);
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface Section {
  id: string;
  label: string;
  path: (string | number)[];
  /** Sub-entries, for the character list — one per person rather than one giant blob. */
  children?: Section[];
}

/**
 * The navigation tree. The old editor's failure was not only the font, it was that everything sat
 * in one scroll: a character's beliefs were three thousand lines below their traits, in a different
 * top-level key. Sections put each person's identity, condition, memory and traits together.
 */
export function sectionsFor(save: any): Section[] {
  const chars: Section[] = Object.entries<any>(save?.characters ?? {})
    .sort(([a], [b]) => (a === "char_player" ? -1 : b === "char_player" ? 1 : 0))
    .map(([id, c]) => ({
      id: `char:${id}`,
      label: `${c?.name ?? id}${id === "char_player" ? " (you)" : ""}`,
      path: ["characters", id],
      children: [
        { id: `char:${id}:identity`, label: "Identity", path: ["characters", id] },
        { id: `char:${id}:condition`, label: "Condition", path: ["condition", id] },
        { id: `char:${id}:memory`, label: "Memory", path: ["memory", id] },
        { id: `char:${id}:traits`, label: "Traits", path: ["traits", id] },
      ],
    }));
  return [
    { id: "bible", label: "World bible", path: ["world_bible"] },
    { id: "world", label: "World", path: ["world"] },
    { id: "cast", label: "Cast", path: ["characters"], children: chars },
    { id: "settings", label: "Model settings", path: ["model_settings"] },
    { id: "history", label: "History", path: ["history"] },
  ];
}

/** Keys never worth showing: pure bookkeeping, or enormous and derived. */
const HIDDEN = new Set(["snapshots", "telemetry", "pressure_trace", "context_anchor", "records"]);

/** The editable keys of an object, in a sensible order: named things first, ids and clocks last. */
export function fieldOrder(obj: Record<string, unknown>): string[] {
  const keys = Object.keys(obj).filter((k) => !HIDDEN.has(k));
  const rank = (k: string) => {
    if (/^(name|title|label)$/.test(k)) return 0;
    if (/^(id|character_id|char_id)$/.test(k)) return 9;
    if (/(_turn|_time|updated|created)$/.test(k)) return 8;
    if (IMAGE_KEYS.test(k)) return 7;
    return 4;
  };
  return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
