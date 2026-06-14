/** Save-state lifecycle (browser): init, sanitize, snapshot ring. Persistence lives in src/store.ts. */
import type { SaveState, Identity, Condition, CharMemory, WorldBible } from "./types";
import { DEFAULT_MODELS } from "./types";

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
  return { character_id: id, core: [], episodic: [], beliefs: [], knows: [] };
}

export function registerCharacter(state: SaveState, ident: Partial<Identity> & { name: string }): string {
  const id = ident.character_id ?? uid("char");
  state.characters[id] = {
    character_id: id, name: ident.name, age: ident.age ?? 30,
    appearance_facts: ident.appearance_facts ?? "", background: ident.background ?? "",
    core_traits: ident.core_traits ?? [], values: ident.values ?? [],
    speech_pattern: ident.speech_pattern ?? "plain", skills: ident.skills ?? {},
    intelligence: ident.intelligence ?? "average",
    gregariousness: ident.gregariousness ?? 0.5,
    current_goal: ident.current_goal, current_activity: ident.current_activity, drive: ident.drive,
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
    characters: {}, traits: {}, condition: {}, memory: {},
    history: [], telemetry: [], pressure_trace: [], records: [], snapshots: [],
  };
}

/** Snapshot ring for rollback (plain JSON; IndexedDB handles the size). Origin (turn 1) is pinned forever. */
export function pushSnapshot(state: SaveState): void {
  if (state.snapshots.some((s) => s.turn === state.world.current_turn)) return;
  const { snapshots, ...rest } = state;
  const blob = JSON.stringify(rest);
  state.snapshots.push({ turn: state.world.current_turn, blob });
  while (state.snapshots.length > 7) state.snapshots.splice(1, 1);
}

export function rollback(state: SaveState, toTurn: number): SaveState | null {
  const snap = [...state.snapshots].reverse().find((s) => s.turn <= toTurn);
  if (!snap) return null;
  const restored = JSON.parse(snap.blob) as SaveState;
  restored.snapshots = state.snapshots.filter((s) => s.turn < snap.turn);
  return restored;
}

export function sanitize(state: SaveState): SaveState {
  state.model_settings = { ...DEFAULT_MODELS, ...state.model_settings };
  state.world.rumors ??= []; state.world.edges ??= []; state.world.clocks ??= [];
  state.world.norms ??= []; state.world.threads ??= []; state.world.consequences ??= []; state.world.canon ??= [];
  for (const c of Object.values(state.condition ?? {})) (c as any).condition_age ??= {};
  state.telemetry ??= []; state.pressure_trace ??= []; state.snapshots ??= []; state.records ??= [];
  for (const id of Object.keys(state.characters)) {
    state.condition[id] ??= blankCondition();
    state.traits[id] ??= [];
    state.memory[id] ??= blankMemory(id);
    state.condition[id].psyche ??= blankCondition().psyche;
  }
  return state;
}
