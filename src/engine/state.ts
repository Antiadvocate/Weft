/** Save-state lifecycle (browser): init, sanitize, snapshot ring. Persistence lives in src/store.ts. */
import { factGate, factOverlap } from "./facts";
import { reconcileStores } from "./memory";
import type { SaveState, Identity, Condition, CharMemory, WorldBible, AcquiredTrait } from "./types";
import { DEFAULT_MODELS } from "./types";
import { asText, asList, asNum } from "./coerce";

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
    tracked: ident.tracked, status: ident.status, location: ident.location, portrait_url: ident.portrait_url,
    // These were previously dropped, which (a) broke the central-character cap — every new
    // character silently entered as central because `central` never landed on the record —
    // and (b) erased life_history when carrying a cast into a new chapter.
    central: ident.central,
    life_history: ident.life_history ? asText(ident.life_history, " ") : undefined,
    appearance_now: ident.appearance_now ? asText(ident.appearance_now, " ") : undefined,
    knows_player_name: ident.knows_player_name,
    attracted_to: ident.attracted_to ? asText(ident.attracted_to) : undefined,
    taste: ident.taste ? asText(ident.taste) : undefined,
    aliases: ident.aliases ? asList(ident.aliases) : undefined,
    conscience: asNum(ident.conscience, 0, 1),
    voice: ident.voice,
    attachment: ident.attachment,
  };
  state.condition[id] = blankCondition((ident as any).capacity ?? 2);
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
  const lean = JSON.parse(JSON.stringify(rest)) as Omit<SaveState, "snapshots">;
  for (const c of Object.values(lean.characters)) if (c.portrait_url?.startsWith("data:")) delete c.portrait_url;
  for (const h of lean.history) if ((h as any).illustration_url?.startsWith?.("data:")) delete (h as any).illustration_url;
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
  // heal traits: LLM-written or raw-imported trait entries can arrive with null fields, which
  // crashes every renderer that calls intensity.toFixed. Coerce on load; drop the label-less.
  for (const id of Object.keys(state.traits ?? {})) state.traits[id] = healTraits(state.traits[id]);
  state.world.focus ??= null;
  for (const c of Object.values(state.condition ?? {})) (c as any).condition_age ??= {};
  state.telemetry ??= []; state.pressure_trace ??= []; state.snapshots ??= []; state.records ??= [];
  state.chapters ??= [];
  for (const c of Object.values(state.characters)) c.appearance_now ??= "";
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

  // Saves made before places were marked have no founding flag, so the place GC would happily forget
  // the world's original locations. Anything present with no flag is treated as founding: it either
  // came from the Forge, or it has already earned its place by surviving this long.
  {
    const ps = Object.values(state.world?.places ?? {});
    if (ps.length && !ps.some((p) => p.founding)) {
      for (const p of ps) if (p.id !== "loc_offscene") p.founding = true;
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
  state.minds ??= {};
  for (const id of Object.keys(state.characters)) {
    state.condition[id] ??= blankCondition();
    state.traits[id] ??= [];
    state.memory[id] ??= blankMemory(id);
    state.memory[id].facts ??= [];   // fact-ledger backfill for older saves
    state.condition[id].psyche ??= blankCondition().psyche;
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
      label: String(t.label).slice(0, 80),
      origin: typeof t.origin === "string" ? t.origin : "",
      behavioral_impact: typeof t.behavioral_impact === "string" ? t.behavioral_impact : "",
      intensity: Math.max(0, Math.min(10, num(t.intensity, 2))),
      self_weight: Math.max(0, Math.min(10, num(t.self_weight, 1))),
      last_reinforced_turn: num(t.last_reinforced_turn, 0),
      reinforcement_count: num(t.reinforcement_count, 1),
      ...(t.integrated !== undefined ? { integrated: !!t.integrated } : {}),
    })) as AcquiredTrait[];
}
