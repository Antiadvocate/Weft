/** Save-state lifecycle (browser): init, sanitize, snapshot ring. Persistence lives in src/store.ts. */
import { factGate, factOverlap } from "./facts";
import { reconcileStores, migrateToFirstPerson } from "./memory";
import { ensureHabits } from "./habits";
import { mergePhantomPlaces } from "./places";
import { healSchedule } from "./schedule";
import { cleanMood } from "./emotions";
import { ensureBorn } from "./remodel";
import type { SaveState, Identity, Condition, CharMemory, WorldBible, AcquiredTrait } from "./types";
import { DEFAULT_MODELS } from "./types";
import { asText, asList, asNum, detectWorldPronoun, tidyPhrase, inferPronouns, orientationIsMood, clipWords, LABEL_MAX } from "./coerce";

/** Mirror of social.ts VERDICT_ROLE, so opening a save does not pull in the whole social module. */
const VERDICT_ROLE_HEAL = /^(the\s+)?(enemy|enemies|foe|nemesis|adversary|antagonist|traitor|betrayer|victim|prey|target|threat|obstacle|nuisance|burden)$/i;

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function blankCondition(capacity = 2): Condition {
  return {
    injuries: [], conditions: [], fatigue: "fresh", hunger: "fed", inventory: [], wearing: [],
    psyche: { relaxation: capacity, capacity, recovery: 0.18, state: "intact", break_mode: null, consecutive_clenched: 0, mood: "even", mood_valence: capacity, active_states: [] },
  };
}

export function blankMemory(id: string): CharMemory {
  return { character_id: id, core: [], episodic: [], beliefs: [], facts: [], knows: [] };
}

export function registerCharacter(state: SaveState, ident: Partial<Identity> & { name: string }): string {
  const id = ident.character_id ?? uid("char");
  // Everything here may have come straight from a model, which does not respect the schema's types:
  // `taste` arrives as an array, `core_traits` as a comma-joined sentence. Coerce at the boundary so
  // a bad value never reaches state and never crashes a system three layers away.
  state.characters[id] = {
    character_id: id, name: asText(ident.name), age: asNum(ident.age, 0, 200) ?? 30,
    appearance_facts: asText(ident.appearance_facts, " "), background: asText(ident.background, " "),
    core_traits: asList(ident.core_traits), values: asList(ident.values),
    speech_pattern: asText(ident.speech_pattern) || "plain", skills: ident.skills ?? {},
    texture: asList(ident.texture),
    pronouns: ident.pronouns ? asText(ident.pronouns) : undefined,
    height_cm: asNum(ident.height_cm, 30, 300), weight_kg: asNum(ident.weight_kg, 2, 500),
    intelligence: ident.intelligence ?? "average",
    gregariousness: asNum(ident.gregariousness, 0, 1) ?? 0.5,
    current_goal: ident.current_goal ? asText(ident.current_goal) : undefined,
    current_activity: ident.current_activity ? asText(ident.current_activity) : undefined,
    drive: ident.drive, drive_queue: ident.drive_queue,
    // MIGRATION: authored was a single want before it was a list. Saves written then hold an object.
    authored: Array.isArray(ident.authored) ? ident.authored : ident.authored ? [ident.authored as any] : undefined,
    tracked: ident.tracked, status: ident.status, location: ident.location, portrait_url: ident.portrait_url,
    // These were previously dropped, which (a) broke the central-character cap — every new
    // character silently entered as central because `central` never landed on the record —
    // and (b) erased life_history when carrying a cast into a new chapter.
    central: ident.central,
    // PROVISIONAL SURVIVES REGISTRATION. Three creation sites set `provisional: true` to mark a
    // record as a sketch the machinery is supposed to finish — and this function dropped the field
    // on the floor, so nothing downstream could ever tell a stub from a finished character and no
    // backfill was possible. A person created from prose kept a name, a location, and nothing else,
    // permanently: no appearance, no traits, no values. See engine/sketch.ts.
    provisional: ident.provisional,
    life_history: ident.life_history ? asText(ident.life_history, " ") : undefined,
    appearance_now: ident.appearance_now ? asText(ident.appearance_now, " ") : undefined,
    knows_player_name: ident.knows_player_name,
    attracted_to: ident.attracted_to ? asText(ident.attracted_to) : undefined,
    taste: ident.taste ? asText(ident.taste) : undefined,
    aliases: ident.aliases ? asList(ident.aliases) : undefined,
    conscience: asNum(ident.conscience, 0, 1),
    beauty: typeof ident.beauty === "number" ? Math.max(0, Math.min(100, ident.beauty)) : undefined,
    voice: ident.voice,
    attachment: ident.attachment,
  };
  // CAPACITY = resting openness the person's nature drifts toward. When the forge gives an explicit
  // sensible value, honor it; otherwise derive it from nature so a cold, guarded, or predatory
  // character doesn't default to a relaxed, open baseline (which the perception gate then reads as
  // serene — the bug where a 0.15-conscience inquisitor ran permanently placid). Low conscience and
  // hostile/guarded traits lower the resting point; warm, secure natures raise it.
  const explicitCap = typeof (ident as any).capacity === "number" ? (ident as any).capacity : undefined;
  let cap = explicitCap ?? 2;
  if (explicitCap === undefined) {
    const consc = asNum(ident.conscience, 0, 1) ?? 0.6;
    const traitBlob = `${asList(ident.core_traits).join(" ")} ${asText((ident.voice as any)?.agenda ?? "")} ${asText(ident.attachment?.under_threat ?? "")}`.toLowerCase();
    const guarded = /\b(cold|hollow|vindictive|cruel|ruthless|predatory|paranoid|hostile|guarded|calculating|manipulat|menac|instrument|vicious|contempt|sadis|controlling|suspicious|wary|hardened|brutal)\b/.test(traitBlob);
    // base on conscience: dark (≤0.3) rests tense (~-2), ordinary (~2), warm (≥0.8) rests open (~4)
    cap = consc <= 0.3 ? -2 : consc >= 0.8 ? 4 : 2;
    if (guarded) cap -= 2;               // a guarded/predatory nature rests tenser still
    cap = Math.max(-6, Math.min(6, cap));
  }
  state.condition[id] = blankCondition(cap);
  state.traits[id] = [];
  state.memory[id] = blankMemory(id);
  return id;
}

export function newSave(name: string, bible: WorldBible): SaveState {
  const now = new Date().toISOString();
  return {
    id: uid("save"), name, created_at: now, updated_at: now,
    world_bible: bible,
    model_settings: { ...DEFAULT_MODELS },
    world: {
      current_turn: 1, current_time: "Day 1, 09:00 (Morning)", weather: "",
      player_location: "", money: "", present: [], places: {}, canon: [],
      threads: [], consequences: [], clocks: [], norms: [], rumors: [], edges: [],
    },
    characters: {}, traits: {}, condition: {}, memory: {}, minds: {},
    history: [], telemetry: [], pressure_trace: [], records: [], snapshots: [],
  };
}

/** gzip a string → base64 (browser CompressionStream); returns null when unavailable. */
async function gz(text: string): Promise<string | null> {
  try {
    if (typeof CompressionStream === "undefined") return null;
    const cs = new CompressionStream("gzip");
    const stream = new Blob([text]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch { return null; }
}
async function gunz(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

/** Snapshot ring for rollback. Origin (turn 1) is pinned forever. Image data URLs are stripped
 *  (a rollback point doesn't need portrait bytes), and the JSON is gzip-compressed when the
 *  browser supports CompressionStream — long campaigns with fact ledgers and life histories
 *  would otherwise carry 7 full-state copies per save. Falls back to plain JSON silently. */
export async function pushSnapshot(state: SaveState): Promise<void> {
  if (state.snapshots.some((s) => s.turn === state.world.current_turn)) return;
  const { snapshots, ...rest } = state;
  // STRIP THE IMAGES WITHOUT COPYING THEM FIRST. This deep-cloned the entire save — base64
  // portraits and scene illustrations included, tens of megabytes on a long campaign — purely so
  // that the next two lines could delete those exact fields from the copy. The clone's peak cost
  // was the whole save twice over, once a turn, to produce something that deliberately excludes
  // the expensive half. Shallow copies down to just the objects being edited cost nothing and
  // leave the original untouched, which is all the clone was ever for.
  const lean: Omit<SaveState, "snapshots"> = {
    ...rest,
    characters: Object.fromEntries(Object.entries(rest.characters).map(([id, c]) =>
      [id, c.portrait_url?.startsWith("data:") ? { ...c, portrait_url: undefined } : c])),
    history: rest.history.map((h) =>
      (h as { illustration_url?: string }).illustration_url?.startsWith?.("data:")
        ? { ...h, illustration_url: undefined } : h),
  };
  const blob = JSON.stringify(lean);
  const zipped = await gz(blob);
  state.snapshots.push(zipped ? { turn: state.world.current_turn, blob: zipped, z: true } : { turn: state.world.current_turn, blob });
  while (state.snapshots.length > 7) state.snapshots.splice(1, 1);
}

export async function rollback(state: SaveState, toTurn: number): Promise<SaveState | null> {
  const snap = [...state.snapshots].reverse().find((s) => s.turn <= toTurn);
  if (!snap) return null;
  const raw = snap.z ? await gunz(snap.blob) : snap.blob;
  const restored = JSON.parse(raw) as SaveState;
  restored.snapshots = state.snapshots.filter((s) => s.turn < snap.turn);
  return restored;
}

/** Force every model-authored character field to the type the rest of the engine assumes.
 *
 *  The schema says `taste: string`; models send `["strength", "directness"]`. `?? ""` does not catch
 *  that — it only catches null — so the array reaches state and `.trim` throws three systems away,
 *  in the desire engine, with no clue where it came from. This runs on every read AND every write,
 *  because healing on read alone leaves the bad value on disk for whatever reads it next.
 *
 *  Idempotent and cheap: a correctly-typed save touches nothing. */
export function healCharacterTypes(state: SaveState): void {
  for (const c of Object.values(state.characters ?? {})) {
    if (!c) continue;
    if (c.taste !== undefined && typeof c.taste !== "string") c.taste = asText(c.taste);
    if (c.attracted_to !== undefined && typeof c.attracted_to !== "string") c.attracted_to = asText(c.attracted_to);
    if (c.pronouns !== undefined && typeof c.pronouns !== "string") c.pronouns = asText(c.pronouns);
    if (c.name !== undefined && typeof c.name !== "string") c.name = asText(c.name);
    if (c.appearance_facts !== undefined && typeof c.appearance_facts !== "string") c.appearance_facts = asText(c.appearance_facts, " ");
    if (c.appearance_now !== undefined && typeof c.appearance_now !== "string") c.appearance_now = asText(c.appearance_now, " ");
    if (c.background !== undefined && typeof c.background !== "string") c.background = asText(c.background, " ");
    if (c.life_history !== undefined && typeof c.life_history !== "string") c.life_history = asText(c.life_history, " ");
    if (c.speech_pattern !== undefined && typeof c.speech_pattern !== "string") c.speech_pattern = asText(c.speech_pattern);
    if (c.current_goal !== undefined && typeof c.current_goal !== "string") c.current_goal = asText(c.current_goal);
    if (c.current_activity !== undefined && typeof c.current_activity !== "string") c.current_activity = asText(c.current_activity);
    if (c.core_traits !== undefined && !Array.isArray(c.core_traits)) c.core_traits = asList(c.core_traits);
    if (c.values !== undefined && !Array.isArray(c.values)) c.values = asList(c.values);
    if (c.texture !== undefined && !Array.isArray(c.texture)) c.texture = asList(c.texture);
    if (c.aliases !== undefined && !Array.isArray(c.aliases)) c.aliases = asList(c.aliases);
  }
}

export function sanitize(state: SaveState): SaveState {
  // Imported saves can be missing whole maps — a partial file used to crash sanitize on
  // Object.values(undefined). Initialize every top-level container before touching it.
  state.characters ??= {}; state.condition ??= {}; state.memory ??= {}; state.traits ??= {};
  state.world ??= {} as any;
  state.world.places ??= {};
  state.history ??= [];
  state.model_settings = { ...DEFAULT_MODELS, ...state.model_settings };
  state.world.rumors ??= []; state.world.edges ??= []; state.world.clocks ??= [];
  state.world.norms ??= []; state.world.threads ??= []; state.world.consequences ??= []; state.world.canon ??= []; state.world.canon_meta ??= {};
  // ── HEAL THE WORLD'S LISTS ───────────────────────────────────────────────────────────────────
  // Threads, clocks, promises and consequences are all hand-editable now, and nothing validated
  // them on the way in. A thread with no `title` is the one that bites: ten separate places call
  // `t.title.toLowerCase()` on stored threads, one of them on every single turn, so a single blank
  // title in the editor turned into "undefined is not an object (evaluating 'z.title.toLowerCase')"
  // on every turn thereafter — an unplayable save from one field. Coerce here, on load, so a save
  // already carrying the damage repairs itself the next time it is opened.
  state.world.threads = (state.world.threads ?? [])
    .filter((t: any) => t && typeof t === "object")
    .map((t: any) => ({
      ...t,
      id: String(t.id ?? uid("thr")),
      title: String(t.title ?? "").trim(),
      description: String(t.description ?? "").trim(),
      status: ["active", "resolved", "abandoned"].includes(t.status) ? t.status : "active",
      tension: Number.isFinite(Number(t.tension)) ? Math.max(0, Math.min(10, Number(t.tension))) : 3,
      turn_started: Number.isFinite(Number(t.turn_started)) ? Number(t.turn_started) : (state.world.current_turn ?? 0),
    }))
    // A thread with neither a title nor a description is not a thread; it is a row somebody added
    // and never filled in, and it would be invisible in every view while still being matched against.
    .filter((t: any) => t.title || t.description);
  state.world.clocks = (state.world.clocks ?? [])
    .filter((c: any) => c && typeof c === "object" && (c.faction || c.objective))
    .map((c: any) => ({
      ...c,
      id: String(c.id ?? uid("clk")),
      faction: String(c.faction ?? "").trim(),
      objective: String(c.objective ?? "").trim(),
      consequence: String(c.consequence ?? "").trim(),
      visible_signs: Array.isArray(c.visible_signs) ? c.visible_signs.map((x: any) => String(x)) : [],
      segments: Math.max(1, Math.round(Number(c.segments) || 6)),
      filled: Math.max(0, Math.round(Number(c.filled) || 0)),
      status: ["running", "fired", "stalled"].includes(c.status) ? c.status : "running",
    }));
  state.world.promises = (state.world.promises ?? [])
    .filter((p: any) => p && typeof p === "object" && String(p.text ?? "").trim())
    .map((p: any) => ({
      ...p,
      id: String(p.id ?? uid("promise")),
      text: String(p.text).trim(),
      status: ["open", "kept", "broken"].includes(p.status) ? p.status : "open",
      weight: [1, 2, 3].includes(Number(p.weight)) ? Number(p.weight) : 1,
    }));
  state.world.consequences = (state.world.consequences ?? [])
    .filter((c: any) => c && typeof c === "object" && String(c.description ?? "").trim())
    .map((c: any) => ({
      ...c,
      id: String(c.id ?? uid("cons")),
      description: String(c.description).trim(),
      status: ["pending", "fired", "cancelled"].includes(c.status) ? c.status : "pending",
      fire_turn: Number.isFinite(Number(c.fire_turn)) ? Number(c.fire_turn) : (state.world.current_turn ?? 0),
      severity: ["minor", "notable", "major"].includes(c.severity) ? c.severity : "notable",
    }));

  // heal traits: LLM-written or raw-imported trait entries can arrive with null fields, which
  // crashes every renderer that calls intensity.toFixed. Coerce on load; drop the label-less.
  for (const id of Object.keys(state.traits ?? {})) state.traits[id] = healTraits(state.traits[id]);
  state.world.focus ??= null;
  for (const c of Object.values(state.condition ?? {})) (c as any).condition_age ??= {};
  state.telemetry ??= []; state.pressure_trace ??= []; state.snapshots ??= []; state.records ??= [];
  state.chapters ??= [];
  for (const c of Object.values(state.characters)) c.appearance_now ??= "";
  // HABIT ENGINE backfill (experimental, flag-gated): populate firing-strength habits from each
  // character's core_traits so an existing save can opt in. Inert unless habit_engine is set.
  if (state.model_settings?.habit_engine) {
    for (const id of Object.keys(state.characters)) { try { ensureHabits(state, id); } catch { /* best-effort */ } }
  }
  // PROVENANCE backfill: saves that predate source-tracking have memories/facts with no `source`.
  // Default them to "witnessed" — for existing memories that's the safe assumption (they were formed
  // in play, in scene), and it keeps the GM "how do they know this?" view from showing blanks.
  for (const mem of Object.values(state.memory ?? {})) {
    for (const m of (mem.episodic ?? [])) if (!(m as any).source) (m as any).source = "witnessed";
    for (const f of (mem.facts ?? [])) if (!(f as any).source) (f as any).source = "witnessed";
  }
  for (const cond of Object.values(state.condition)) { cond.hunger_meter ??= 2; cond.thirst_meter ??= 2; cond.awake_minutes ??= 0; }
  // NAME-KNOWLEDGE backfill for saves that predate epistemics: a character who has the player's
  // name in their memories/facts, or a real relationship, clearly knows it; everyone else doesn't.
  {
    const pfirst = state.characters["char_player"]?.name.split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const [id, c] of Object.entries(state.characters)) {
      if (id === "char_player") { c.knows_player_name = true; continue; }
      if (c.knows_player_name !== undefined) continue;
      const mem = state.memory[id];
      const inMem = !!pfirst && !!mem && [...mem.episodic, ...mem.core.map((x) => ({ content: x })), ...(mem.facts ?? []), ...mem.beliefs]
        .some((m: any) => (m.content ?? "").toLowerCase().includes(pfirst));
      const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
      c.knows_player_name = inMem || (!!e && Math.abs(e.warmth) + Math.abs(e.trust) >= 15);
    }
  }
  state.contract_drift ??= null;
  state.retcons ??= [];

  healCharacterTypes(state);

  // ── EVERY PLACE GETS A HALF THAT DOES NOT MOVE ──────────────────────────────────────────────
  //
  // Saves written before Place.identity existed have only description_facts, which the world
  // rewrites wholesale whenever a place materially changes. Seed the fixed half from the opening
  // sentence of what is already recorded — that is where a place's description says what it IS,
  // before it goes on to say what state it is in — so an existing story stops drifting from the
  // next turn rather than the next playthrough. The player can correct it by hand; nothing else
  // ever writes it again.
  for (const p of Object.values(state.world?.places ?? {})) {
    if (!p || p.id === "loc_offscene") continue;
    if (typeof p.identity === "string" && p.identity.trim()) continue;
    const first = String(p.description_facts ?? "").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
    p.identity = first.trim().slice(0, 200);
  }

  // ── A MODEL-SHAPED OBJECT WHERE A LINE OF TEXT BELONGS ──────────────────────────────────────
  //
  // SimulatorDiff.offscreen is typed string[] and is written by a model, which is not the same
  // thing as being strings. One returned its world-motion lines as objects — {char_id, where} —
  // and they went into the log unread, were stored on the history entry, and Play renders each
  // one directly as a React child. React refuses to render an object, so the save crashed on
  // every load from then on: the bad turn is persisted, so re-opening it fails the same way.
  //
  // Ingestion coerces these now, but that does not help a save already holding one. Repair on
  // load, which is what this function is for.
  for (const h of state.history ?? []) {
    if (Array.isArray(h?.offscreen) && h.offscreen.some((x) => typeof x !== "string")) h.offscreen = asList(h.offscreen, 64);
    if (Array.isArray(h?.shifts) && h.shifts.some((x) => typeof x !== "string")) h.shifts = asList(h.shifts, 64);
    if (h && typeof (h as { narrator_prose?: unknown }).narrator_prose !== "string") {
      (h as { narrator_prose?: unknown }).narrator_prose = asText((h as { narrator_prose?: unknown }).narrator_prose, " ");
    }
  }

  // A HAND-EDITED WEEK RUNS ARITHMETIC ON EVERY TURN, so it is coerced on load for the same reason
  // threads are. The failure mode is quiet and total: a start time left as a string makes every
  // comparison against it false, so the character never goes anywhere again and nothing says why.
  for (const c of Object.values(state.characters)) {
    if (!c?.schedule) continue;
    const healed = healSchedule(c);
    if (healed) c.schedule = healed; else delete c.schedule;
  }

  // Saves made before places were marked have no founding flag, so the place GC would happily forget
  // the world's original locations. Anything present with no flag is treated as founding: it either
  // came from the Forge, or it has already earned its place by surviving this long.
  {
    const ps = Object.values(state.world?.places ?? {});
    if (ps.length && !ps.some((p) => p.founding)) {
      for (const p of ps) if (p.id !== "loc_offscene") p.founding = true;
    }
  }

  mergePhantomPlaces(state);

  // ── WORLD-PRONOUN HEAL ── a save forged before the pronoun backstop can hold a whole cast of
  // "she/her" in a world whose canon says everyone uses xe/xem. Only act when canon is unambiguous
  // (declares the set AND says there are no men/women), and only overwrite a DEFAULT binary pronoun —
  // never touch a character deliberately given something else, and never touch the player.
  {
    const wp = detectWorldPronoun(state.world?.canon);
    const canonText = (state.world?.canon ?? []).join(" ").toLowerCase();
    const noBinary = /\bno (?:men|man|women|woman|gender|sex)\b|no concept of (?:man|woman|gender)/.test(canonText);
    if (wp && noBinary) {
      for (const [id, c] of Object.entries(state.characters ?? {})) {
        if (id === "char_player" || !c) continue;
        const pr = (c.pronouns ?? "").toLowerCase();
        if (!pr || pr.startsWith("she/") || pr.startsWith("he/") || pr === "she" || pr === "he") c.pronouns = wp;
      }
    }
  }

  // ── GAZETTEER MIGRATION ── older saves let the simulator mint a place for any string it produced,
  // so one house became "Tessa's house", "Tessa's house (kitchen)", and "Tessa's house (outside in
  // the yard)", and characters scattered across rooms that were never real. Fold every sub-room back
  // into its parent, and move anyone standing in one to the parent. Places are whole places now.
  {
    const places = state.world.places ?? {};
    const parentOf = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+[-–—]\s+.*$/, "").trim();
    const byName = new Map<string, string>();
    for (const p of Object.values(places)) if (p.id !== "loc_offscene") byName.set(p.name.trim().toLowerCase(), p.id);
    const remap = new Map<string, string>();
    for (const p of Object.values(places)) {
      if (p.id === "loc_offscene") continue;
      const parent = parentOf(p.name);
      if (!parent || parent.toLowerCase() === p.name.trim().toLowerCase()) continue;
      const pid = byName.get(parent.toLowerCase());
      if (pid && pid !== p.id) remap.set(p.id, pid);
    }
    if (remap.size) {
      for (const c of Object.values(state.characters)) {
        if (c.location && remap.has(c.location)) c.location = remap.get(c.location)!;
      }
      if (remap.has(state.world.player_location)) state.world.player_location = remap.get(state.world.player_location)!;
      for (const t of state.travel_log ?? []) if (remap.has(t.place)) t.place = remap.get(t.place)!;
      for (const id of remap.keys()) delete places[id];
      console.warn(`[places] merged ${remap.size} sub-room(s) back into their parent locations`);
    }
    // the offscene record is named plainly now
    const off = places["loc_offscene"];
    if (off && off.name !== "elsewhere") off.name = "elsewhere";
  }
  state.destination_progress ??= null;
  // a destination that predates the clock has no start turn; anchor it to 0 so the budget,
  // if one is later set, does not retroactively count turns already played
  if (state.world_bible?.destination?.trim() && state.world_bible.destination_set_turn === undefined) {
    state.world_bible.destination_set_turn = 0;
  }
  state.pressure_state ??= { last_beat_turn: 0, last_exo_turn: 0 };
  // LEDGER HYGIENE (retroactive): the quality gate and fuzzy dedupe also sweep existing saves
  // on load, so junk written before the gate existed drains out instead of accumulating.
  for (const mem of Object.values(state.memory)) {
    if (!mem.facts?.length) continue;
    const kept: typeof mem.facts = [];
    for (const f of mem.facts) {
      if (!factGate(f.content).ok) continue;
      const near = kept.find((x) => factOverlap(x.content, f.content) >= 0.6);
      if (near) { if (f.content.length > near.content.length + 12) near.content = f.content; continue; }
      kept.push(f);
    }
    mem.facts = kept.slice(-30);
    reconcileStores(mem);
  }
  // HEAL A LOOPED OR SEVERED WANT ON LOAD. These are short model-written fields that render on the
  // card and go straight back into the next prompt, so a save already carrying one re-seeds it every
  // turn until something breaks the cycle. Repaired when the file is opened, like the mood loop.
  for (const c of Object.values(state.characters)) {
    for (const d of [c.drive, ...(c.drive_queue ?? [])]) {
      if (!d) continue;
      const goal = tidyPhrase(d.goal, 160);
      if (goal && goal !== d.goal) d.goal = goal;
      if (d.approach) { const a = tidyPhrase(d.approach, 140); if (a !== d.approach) d.approach = a || undefined; }
      if (d.blocker) { const b = tidyPhrase(d.blocker, 140); if (b !== d.blocker) d.blocker = b || undefined; }
    }
  }
  // A VERDICT ALREADY WRITTEN INTO AN EDGE STAYS THERE FOREVER — roles never decay. Strip them on
  // load so a save carrying "enemy" from one bad evening is not stuck with it. The feeling it stood
  // for is in warmth and trust, which are right there beside it.
  for (const e of state.world.edges ?? []) {
    if (!e.roles?.length) continue;
    const kept = e.roles.filter((r) => !VERDICT_ROLE_HEAL.test(String(r ?? "").trim()));
    if (kept.length !== e.roles.length) e.roles = kept;
  }
  state.minds ??= {};
  for (const id of Object.keys(state.characters)) {
    state.condition[id] ??= blankCondition();
    state.traits[id] ??= [];
    state.memory[id] ??= blankMemory(id);
    state.memory[id].facts ??= [];   // fact-ledger backfill for older saves
    // WHAT THEY SAW WHILE THE PLAYER WAS ELSEWHERE. The offstage pass used to file its witness
    // memories as plain "witnessed", which left them indistinguishable from anything that happened
    // in a scene and competing for a retrieval slot they never won. They are marked now, and this
    // recovers the ones already in a save: an exact match against the offstage log, which is where
    // the text came from verbatim (`content: ev.what.slice(0, 200)`), so nothing else can match.
    {
      const offstage = new Set((state.world.offstage_log ?? []).map((e) => String(e.what ?? "").slice(0, 200)));
      if (offstage.size) {
        for (const m of state.memory[id].episodic) {
          if (m.source === "witnessed" && offstage.has(m.content)) m.source = "offstage";
        }
      }
    }
    // A MOOD IN THE ORIENTATION FIELD FROZE SOMEBODY AT ZERO DESIRE. Attraction seeds exactly once,
    // so a character the old hard cap zeroed stays at zero even after the cap stops applying — the
    // seed sees a defined value and returns. Clear the zeroes it left so they read fresh. Only the
    // exact signature of the bug is touched: a card whose orientation is a dated statement, and an
    // outgoing attraction of precisely 0. A real 0 arrived at through play is not a 0 written by a
    // gate, but it is also not a value the story can no longer move, so re-seeding is the safe side.
    if (orientationIsMood(state.characters[id].attracted_to)) {
      for (const e of state.world.edges) {
        if (e.from === id && e.attraction === 0) e.attraction = undefined;
      }
    }
    // NOBODY GOES WITHOUT A PRONOUN SET. The forge is asked for one and sometimes does not give it,
    // and every pass that writes a permanent record reads the roster where it is printed. Backfilled
    // from what the character's own background and appearance already say about them; left unset
    // when that text does not clearly lean one way. See coerce.inferPronouns.
    if (!state.characters[id].pronouns) {
      const guess = inferPronouns(`${state.characters[id].background ?? ""} ${state.characters[id].appearance_facts ?? ""}`);
      if (guess) state.characters[id].pronouns = guess;
    }
    // A MEMORY IS WRITTEN IN THE FIRST PERSON NOW — see cleanMemoryContent rule 4. Saves written
    // before that hold third-person accounts of their own owner, and a bank with both in it is
    // exactly the ambiguity the change exists to remove: "Lucia agreed…" beside "I agreed…" beside
    // a bare "she" that could be either. Converted once, on load, name-only.
    if (id !== "char_player" && !state.memory[id].first_person) {
      migrateToFirstPerson(state.memory[id], state.characters[id]?.name ?? "", false);
      state.memory[id].first_person = true;
    }
    state.condition[id].psyche ??= blankCondition().psyche;
    // THE RESTING POINT THEY WERE MADE WITH. Saves written before capacity had a history carry no
    // baseline to measure drift against or return to, so the current value becomes it — which is
    // correct for exactly those saves, since nothing had ever moved it. See engine/remodel.ts.
    ensureBorn(state.condition[id].psyche);
    // A MOOD THAT DEGENERATED INTO A LOOP IS A STUCK RECORD, NOT WEATHER. It renders on the card and
    // goes back into the next prompt as the character's current state, so it re-seeds itself: one
    // save held "…not the quiet after the door closes. The quiet after the door closes, the quiet
    // after the door closes. The quiet after the door closes." Healed on load, so a save already
    // carrying one repairs itself the next time it is opened rather than waiting for a new mood.
    const mood = state.condition[id].psyche.mood;
    if (mood) {
      const clean = cleanMood(mood);
      if (clean && clean !== mood) state.condition[id].psyche.mood = clean;
    }
  }
  // backfill the location model for saves made before it existed
  const placeIds = Object.keys(state.world.places);
  if (!state.world.player_location && placeIds.length) state.world.player_location = placeIds[0];
  if (state.characters["char_player"] && !state.characters["char_player"].location) {
    state.characters["char_player"].location = state.world.player_location;
  }
  const anyMissing = Object.entries(state.characters).some(([id, c]) => id !== "char_player" && !c.location);
  if (anyMissing) {
    const wasPresent = new Set(state.world.present ?? []);
    const others = placeIds.filter((p) => p !== state.world.player_location);
    let scatter = 0;
    for (const [id, c] of Object.entries(state.characters)) {
      if (id === "char_player" || c.location) continue;
      c.location = wasPresent.has(id)
        ? state.world.player_location
        : (others.length ? others[scatter++ % others.length] : state.world.player_location);
    }
  }
  // recompute room occupancy + scene from the source of truth (the gone occupy nothing)
  if (placeIds.length && state.characters["char_player"]) {
    for (const p of Object.values(state.world.places)) p.contains = [];
    for (const [id, c] of Object.entries(state.characters)) {
      if (c.status === "dead" || c.status === "departed") continue;
      if (c.location && state.world.places[c.location]) state.world.places[c.location].contains.push(id);
    }
    state.world.present = Object.entries(state.characters)
      .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed" && c.location === state.world.player_location)
      .map(([id]) => id);
  }
  // travel-log backfill for saves made before the story map existed: drop entries whose
  // place is gone, collapse consecutive repeats, and seed with the current location so
  // the map always has at least the "you are here" node.
  state.travel_log = (state.travel_log ?? []).filter((t) => state.world.places[t.place]);
  state.travel_log = state.travel_log.filter((t, i, a) => i === 0 || t.place !== a[i - 1].place);
  if (!state.travel_log.length && state.world.player_location && state.world.places[state.world.player_location]) {
    state.travel_log.push({ turn: state.world.current_turn ?? 0, place: state.world.player_location });
  }
  return state;
}


/** CANON ENTRY + EVICTION — canon is capped, but a world-altering fact evicted at the cap must not
 *  simply vanish (the narrator would drift from a truth that still holds). On eviction the fact is
 *  FOLDED into the world bible field it most resembles — the bible is the permanent home for what
 *  the world IS; canon is the working set. Also records witness metadata at entry: knowledge
 *  propagates (the rumor system already models this), so a fresh fact is known only to those who
 *  were there until news has had time to travel. */
const BIBLE_FOLD_FIELDS = ["political_situation", "what_people_fear", "technology_level", "cultures_and_languages", "magic_rules", "climate_and_geography"] as const;

function wordSet(x: string): Set<string> {
  return new Set(x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
}

export function addCanon(state: SaveState, line: string): boolean {
  const l = line.trim().slice(0, 200);
  if (!l || state.world.canon.some((x) => x.toLowerCase() === l.toLowerCase())) return false;
  state.world.canon.push(l);
  state.world.canon_meta ??= {};
  state.world.canon_meta[l.toLowerCase()] = { turn: state.world.current_turn, witnesses: ["char_player", ...state.world.present] };
  while (state.world.canon.length > 20) {
    const evicted = state.world.canon.shift()!;
    delete state.world.canon_meta[evicted.toLowerCase()];
    // fold into the most-overlapping bible field so the truth persists as law, not as a lost line
    const b = state.world_bible as any;
    let bestF: string | null = null, bestO = 0;
    const ev = wordSet(evicted);
    for (const f of BIBLE_FOLD_FIELDS) {
      const fs = wordSet(String(b[f] ?? ""));
      let o = 0; for (const w of ev) if (fs.has(w)) o++;
      if (o > bestO) { bestO = o; bestF = f; }
    }
    const target = bestF ?? "political_situation";
    const cur = String(b[target] ?? "");
    if (!cur.toLowerCase().includes(evicted.toLowerCase()) && cur.length < 1400) b[target] = (cur ? cur + " ◦ " : "") + evicted;
  }
  return true;
}

/** ALIAS EXPANSION — retrieval and name matching are lexical; "the captain" never finds Sorena's
 *  memories unless something maps the handle to the name. This appends canonical names to any text
 *  that mentions a known alias, so downstream token-overlap scoring hits. */
export function expandAliases(state: SaveState, text: string): string {
  if (!text) return text;
  const lower = text.toLowerCase();
  const extra: string[] = [];
  for (const c of Object.values(state.characters)) {
    if (!c.aliases?.length || c.status === "dead") continue;
    if (lower.includes(c.name.toLowerCase())) continue; // already named
    for (const a of c.aliases) {
      const al = a.toLowerCase().trim();
      if (al.length >= 3 && lower.includes(al)) { extra.push(c.name); break; }
    }
  }
  return extra.length ? `${text} (${extra.join(", ")})` : text;
}


/** Coerce a trait list into a safe shape: numbers finite, strings present, label required. */
export function healTraits(list: unknown): AcquiredTrait[] {
  if (!Array.isArray(list)) return [];
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return (list as any[])
    .filter((t) => t && typeof t.label === "string" && t.label.trim())
    .map((t) => ({
      id: typeof t.id === "string" ? t.id : `trait_${Math.random().toString(36).slice(2, 8)}`,
      // The same cut crystallize uses, at the same length: an 80-character mid-word clip here made
      // the stored trait a different string from the label the want carries, so the habit ladder
      // counted the same habit under two keys and found it worn under neither. See clipWords.
      label: clipWords(String(t.label), LABEL_MAX),
      origin: typeof t.origin === "string" ? t.origin : "",
      behavioral_impact: typeof t.behavioral_impact === "string" ? t.behavioral_impact : "",
      intensity: Math.max(0, Math.min(10, num(t.intensity, 2))),
      self_weight: Math.max(0, Math.min(10, num(t.self_weight, 1))),
      last_reinforced_turn: num(t.last_reinforced_turn, 0),
      reinforcement_count: num(t.reinforcement_count, 1),
      ...(t.integrated !== undefined ? { integrated: !!t.integrated } : {}),
    })) as AcquiredTrait[];
}
