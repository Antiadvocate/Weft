/** The engine, in your browser. Mirrors the old server API exactly so the views
 *  are unchanged: every method returns the same shapes; streamTurn runs the turn
 *  loop locally with callbacks instead of Server-Sent Events. */
import type {
  SaveState, ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
} from "../engine/types";
import { newSave, registerCharacter, rollback as doRollback, sanitize, uid } from "../engine/state";
import { buildPreset, PRESET_LIST } from "../engine/presets";
import { runTurn, syncPresence, resolvePlace } from "../engine/turn";
import { runInterlude, embodyCharacter } from "../engine/continuity";
import { seedDrive } from "../engine/drives";
import { FORGE_SYSTEM } from "../engine/prompts";
import { buildMessages, complete, generateImage, safeJson } from "../llm";
import { getSave, putSave, deleteSave as dbDelete, listSaves as dbList } from "../store";

export type ClientSave = Omit<SaveState, "snapshots"> & { snapshot_turns: number[] };
export type {
  ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
};
export type ActionMode = "do" | "say" | "story";

export interface PresetInfo { id: string; name: string; blurb: string; era_theme: string }
export interface SaveListing { id: string; name: string; updated_at: string; turn: number; world_name: string }

function clientView(s: SaveState): ClientSave {
  const { snapshots, ...rest } = s;
  return { ...rest, snapshot_turns: snapshots.map((x) => x.turn) };
}
async function need(id: string): Promise<SaveState> {
  const s = await getSave(id);
  if (!s) throw new Error("save not found");
  return s;
}

export const api = {
  presets: async (): Promise<PresetInfo[]> => PRESET_LIST,
  saves: (): Promise<SaveListing[]> => dbList(),
  save: async (id: string): Promise<ClientSave> => clientView(await need(id)),

  newFromPreset: async (presetId: string): Promise<ClientSave> => {
    const s = buildPreset(presetId);
    if (!s) throw new Error("unknown preset");
    await putSave(s);
    return clientView(s);
  },

  remove: async (id: string) => { await dbDelete(id); return { ok: true }; },

  rollback: async (id: string, to_turn: number): Promise<ClientSave> => {
    const s = await need(id);
    const restored = doRollback(s, to_turn);
    if (!restored) throw new Error("no snapshot covers that turn");
    await putSave(restored);
    return clientView(restored);
  },

  settings: async (id: string, patch: Partial<ModelSettings> & { era_theme?: string }): Promise<ClientSave> => {
    const s = await need(id);
    const { era_theme, ...flat } = patch as any;
    s.model_settings = { ...s.model_settings, ...flat };
    if (era_theme) s.world_bible.era_theme = String(era_theme);
    await putSave(s);
    return clientView(s);
  },

  edit: async (id: string, patch: { world_bible?: Partial<WorldBible>; characters?: Record<string, Partial<Identity>>; memory_core?: Record<string, string[]>; canon?: string[] }): Promise<ClientSave> => {
    const s = await need(id);
    if (patch.world_bible) s.world_bible = { ...s.world_bible, ...patch.world_bible };
    for (const [cid, p] of Object.entries(patch.characters ?? {})) {
      if (!s.characters[cid]) continue;
      s.characters[cid] = { ...s.characters[cid], ...p, character_id: cid };
    }
    if (Array.isArray(patch.canon)) s.world.canon = patch.canon.map(String).filter(Boolean).slice(0, 20);
    for (const [cid, core] of Object.entries(patch.memory_core ?? {})) {
      if (s.memory[cid] && Array.isArray(core)) s.memory[cid].core = core.filter(Boolean).slice(0, 8);
    }
    await putSave(s);
    return clientView(s);
  },

  advance: async (id: string, days: number): Promise<ClientSave> => {
    const s = await need(id);
    await runInterlude(s, Math.max(1, Math.min(30, days)), { onPhase: () => {} });
    await putSave(s);
    return clientView(s);
  },

  setTracked: async (id: string, char_id: string, tracked: boolean): Promise<ClientSave> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    c.tracked = tracked;
    if (tracked && (!c.drive || c.drive.progress >= 100) && !s.world.present.includes(char_id)) {
      const seeded = seedDrive(s, char_id);            // following someone idle gives them a want now
      if (seeded) c.drive = seeded;
    }
    if (!tracked) c.drive = undefined;                 // unfollowed: recede into the background
    await putSave(s);
    return clientView(s);
  },

  embody: async (id: string, char_id: string): Promise<ClientSave> => {
    const s = await need(id);
    const r = embodyCharacter(s, char_id);
    if (!r.ok) throw new Error(r.error);
    await putSave(s);
    return clientView(s);
  },

  portrait: async (id: string, char_id: string): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    const prompt = `Painterly character portrait, head and shoulders, moody chiaroscuro, muted palette, no text, no watermark. Setting: ${s.world_bible.era}, ${s.world_bible.name}. Subject: ${c.name}, age ${c.age}. ${c.appearance_facts}. Demeanor: ${c.core_traits.slice(0, 3).join(", ")}.`;
    c.portrait_url = await generateImage(prompt);
    await putSave(s);
    return { url: c.portrait_url, save: clientView(s) };
  },

  illustrate: async (id: string, turn: number): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const entry = [...s.history].reverse().find((h) => h.turn === turn) ?? s.history[s.history.length - 1];
    if (!entry) throw new Error("no turn to illustrate");
    const prompt = `Painterly cinematic scene illustration, wide shot, moody atmospheric light, muted palette, no text, no watermark. World: ${s.world_bible.name}, ${s.world_bible.era}. Scene: ${entry.summary}. Weather: ${s.world.weather}.`;
    entry.illustration_url = await generateImage(prompt);
    await putSave(s);
    return { url: entry.illustration_url, save: clientView(s) };
  },

  forge: async (seed: string, model = "deepseek/deepseek-chat-v3-0324"): Promise<ClientSave> => {
    const msgs = buildMessages(FORGE_SYSTEM, "SEED IDEA:", seed, model);
    let g: any = null, lastErr = "";
    for (const m of [model, model, "google/gemini-2.0-flash-001"]) {
      try {
        const out = await complete(msgs, m, m, true, 8000);
        g = safeJson<any>(out.text, null);
        if (g?.world_bible?.name && g?.player?.name && (g.npcs?.length ?? 0) >= 1) break;
        lastErr = `model ${m} returned an incomplete world`;
        g = null;
      } catch (e: any) { lastErr = `${m}: ${e.message}`; g = null; }
    }
    if (!g) throw new Error(`The forge failed after 3 attempts — ${lastErr}. Try a more concrete seed (place + people + problem) or a stronger forge model.`);

    const bible: WorldBible = {
      ...g.world_bible,
      difficulty_profile: g.world_bible.difficulty_profile ?? { lethality: "medium", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
    };
    const s = newSave(g.world_bible.name || seed.slice(0, 40), bible);
    registerCharacter(s, { ...g.player, character_id: "char_player" });
    s.memory["char_player"].core = [g.player.background].filter(Boolean);

    const nameToId: Record<string, string> = {};
    for (const p of g.places ?? []) {
      const lid = uid("loc");
      s.world.places[lid] = { id: lid, name: p.name, description_facts: p.description_facts ?? "", contains: [] };
      nameToId[p.name?.toLowerCase?.() ?? ""] = lid;
    }
    for (const n of g.npcs ?? []) {
      const cid = registerCharacter(s, { ...n, drive: n.drive_goal ? { goal: n.drive_goal, progress: 10, updated_turn: 1 } : undefined });
      s.memory[cid].core = [n.background].filter(Boolean);
      s.world.edges.push({ from: cid, to: "char_player", warmth: Math.max(-100, Math.min(100, n.warmth ?? 0)), trust: Math.max(-100, Math.min(100, n.trust ?? 0)), power: 0, notes: n.relation_to_player ?? "", updated_turn: 1 });
    }
    for (const c of g.clocks ?? []) {
      s.world.clocks.push({ id: uid("clk"), faction: c.faction ?? "", objective: c.objective ?? "", segments: Math.max(2, c.segments ?? 6), filled: 0, consequence: c.consequence ?? "", visible_signs: c.visible_signs ?? [], status: "running" });
    }
    for (const n of g.norms ?? []) {
      s.world.norms.push({ id: uid("nrm"), rule: n.rule ?? "", enforcement: n.enforcement ?? "gossip", holders: n.holders ?? "" });
    }
    const op = g.opening ?? {};
    s.world.current_time = op.time?.match(/day/i) ? `${op.time}` : "Day 1, 09:00 (Morning)";
    s.world.weather = op.weather ?? "";
    s.world.money = op.money ?? "";
    s.world.player_location = nameToId[(op.player_location_name ?? "").toLowerCase()] ?? Object.keys(s.world.places)[0] ?? "";
    s.characters["char_player"].location = s.world.player_location;
    const openingPresent = (op.present_npc_names ?? [])
      .map((nm: string) => Object.entries(s.characters).find(([cid, c]) => cid !== "char_player" && c.name.toLowerCase() === nm.toLowerCase())?.[0])
      .filter(Boolean) as string[];
    const seatHere = openingPresent.length ? openingPresent : Object.keys(s.characters).filter((cid) => cid !== "char_player").slice(0, 2);
    // everyone starts at the player's location if present, otherwise scattered to their own first place
    const otherPlaces = Object.keys(s.world.places).filter((p) => p !== s.world.player_location);
    let scatter = 0;
    for (const cid of Object.keys(s.characters)) {
      if (cid === "char_player") continue;
      if (seatHere.includes(cid)) s.characters[cid].location = s.world.player_location;
      else s.characters[cid].location = otherPlaces.length ? otherPlaces[scatter++ % otherPlaces.length] : s.world.player_location;
    }
    syncPresence(s);

    await putSave(s);
    return clientView(s);
  },

  /** export returns the full SaveState as a pretty JSON string for download */
  exportSave: async (id: string): Promise<{ name: string; json: string }> => {
    const s = await need(id);
    return { name: s.name.replace(/[^a-z0-9 _-]/gi, ""), json: JSON.stringify(s, null, 1) };
  },

  importSave: async (data: any): Promise<ClientSave> => {
    if (!data?.world_bible || !data?.world || !data?.characters) throw new Error("not a Weft save file");
    const s = sanitize(data as SaveState);
    s.id = uid("save");
    s.updated_at = new Date().toISOString();
    s.snapshots ??= []; s.telemetry ??= []; s.pressure_trace ??= []; s.history ??= [];
    await putSave(s);
    return clientView(s);
  },
};

export interface TurnEvents {
  onPhase?: (phase: string) => void;
  onDelta?: (text: string) => void;
  onMeta?: (meta: Record<string, unknown>) => void;
  onDone?: (save: ClientSave) => void;
  onError?: (message: string) => void;
}

/** The turn loop, run locally. Same signature the views already use. */
export async function streamTurn(saveId: string, action: string, mode: ActionMode, ev: TurnEvents): Promise<void> {
  try {
    const s = await need(saveId);
    await runTurn(s, action, {
      onPhase: (p) => ev.onPhase?.(p),
      onDelta: (t) => ev.onDelta?.(t),
      onMeta: (m) => ev.onMeta?.(m as Record<string, unknown>),
    }, mode);
    await putSave(s);
    ev.onDone?.(clientView(s));
  } catch (e: any) {
    ev.onError?.(e?.message ?? "turn failed");
  }
}
