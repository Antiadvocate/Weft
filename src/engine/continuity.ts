
/**
 * CONTINUITY â€” the world does not need you.
 *
 *   simulateForward(state, days)  â€” pure deterministic world-advance, no tokens:
 *       drives tick (and complete), rumors cascade to saturation, psyche drifts
 *       home, traits fade, conditions heal, clocks fill and FIRE, due
 *       consequences come due. Returns a report of everything that moved.
 *
 *   runInterlude(...)             â€” ONE LLM call turns the report into 2â€“3
 *       paragraphs of world-scale passage-of-time prose + grounded memories.
 *
 *   embodyCharacter(state, id)    â€” the player leaves their vessel and steps
 *       into another. Full id-swap across every ledger: you inherit their
 *       memories, bonds, wounds, traits, wants. Your old self remains in the
 *       world as a person the world remembers.
 */
import type { SaveState, TurnTelemetry, Identity, CharMemory, AcquiredTrait } from "./types";
import { absMinutes, advance } from "./time";
import { consolidateBackground, consolidateTraits, decayTraits, diffuseRumors, tickDrives, tickPsyche, tickBonds } from "./social";
import { regenerateDrives } from "./drives";
import { syncPresence } from "./turn";
import { buildMessages, complete, safeJson } from "../llm";
import { stablePrefix } from "./prompts";
import { pushSnapshot, uid } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface ForwardReport {
  days: number;
  drive_log: string[];        // progress + completions
  rumor_log: string[];        // diffusion notes
  clocks_fired: string[];     // consequences unleashed
  clocks_moved: string[];
  consequences_due: string[]; // pending things now at the door
  conditions_healed: string[];
  traits_faded: string[];
}

/** Pure, deterministic, zero tokens. One call advances the world `days` days. */
export function simulateForward(state: SaveState, days: number, rng: () => number = Math.random): ForwardReport {
  const report: ForwardReport = {
    days, drive_log: [], rumor_log: [], clocks_fired: [], clocks_moved: [],
    consequences_due: [], conditions_healed: [], traits_faded: [],
  };
  const turn = state.world.current_turn;

  // nobody stands in one room for a week â€” the scene disperses
  state.world.present = [];

  const rounds = Math.max(1, Math.round(days * 2)); // two world-rounds per day
  for (let r = 0; r < rounds; r++) {
    for (const id of Object.keys(state.condition)) tickPsyche(state.condition[id].psyche); // kernel drift, per character
    report.drive_log.push(...tickDrives(state, rng));
    report.drive_log.push(...regenerateDrives(state, rng)); // tracked idle NPCs get fresh wants across the days
    report.rumor_log.push(...diffuseRumors(state, rng));
    report.drive_log.push(...tickBonds(state, rng)); // offscreen same-place pairs drift closer/cooler
  }
  // psyche valence resettles
  for (const id of Object.keys(state.condition)) {
    const ps = state.condition[id].psyche;
    ps.mood_valence = Math.round(ps.relaxation);
  }

  // bodies recover across days
  for (const [id, c] of Object.entries(state.condition)) {
    c.fatigue = "fresh"; c.hunger = "fed";
    const healed = c.conditions.filter(() => true); // all transient conditions resolve over multi-day spans
    if (days >= 2 && healed.length) {
      report.conditions_healed.push(...healed.map((h) => `${state.characters[id]?.name}: ${h}`));
      c.conditions = []; c.condition_age = {};
    }
    // non-permanent injuries close over a week+
    if (days >= 7) {
      const closed = c.injuries.filter((i) => !i.permanent);
      if (closed.length) report.conditions_healed.push(...closed.map((i) => `${state.characters[id]?.name}: ${i.type} (healed)`));
      c.injuries = c.injuries.filter((i) => i.permanent);
    }
  }

  // traits fade with disuse, and long stretches can consolidate deeply-held ones into identity
  for (const id of Object.keys(state.traits)) {
    const { kept, log } = decayTraits(state.traits[id] ?? [], turn + Math.ceil(days / 2));
    state.traits[id] = kept;
    report.traits_faded.push(...log.map((l) => `${state.characters[id]?.name}: ${l}`));
    if (state.characters[id]) {
      const { kept: ck, log: clog } = consolidateTraits(state.characters[id], state.traits[id], turn);
      state.traits[id] = ck;
      report.traits_faded.push(...clog);
      if (state.memory[id]) report.traits_faded.push(...consolidateBackground(state.characters[id], state.memory[id]));
    }
  }

  // faction clocks fill on their own schedule: one segment per ~2 days
  for (const c of state.world.clocks) {
    if (c.status !== "running") continue;
    const fill = Math.floor(days / 2) + (rng() < (days % 2) / 2 ? 1 : 0);
    if (fill > 0) {
      c.filled = clamp(c.filled + fill, 0, c.segments);
      report.clocks_moved.push(`${c.faction}: ${c.filled}/${c.segments} toward "${c.objective}"`);
      if (c.filled >= c.segments) {
        c.status = "fired";
        report.clocks_fired.push(`${c.faction} ACHIEVED IT: ${c.consequence}`);
      }
    }
  }

  // the calendar moves
  const newTime = advance(state.world.current_time, days * 24 * 60);

  // consequences whose moment arrives inside the skip come due NOW.
  // time-scheduled ones fire when the post-skip clock has reached their fire_time;
  // legacy turn-only ones fall back to the turn floor.
  for (const cq of state.world.consequences) {
    if (cq.status !== "pending") continue;
    const arrived = cq.fire_time
      ? absMinutes(newTime) >= absMinutes(cq.fire_time)
      : cq.fire_turn <= turn + 1;
    if (arrived) {
      report.consequences_due.push(cq.description);
      cq.status = "fired";
    }
  }

  state.world.current_time = newTime;
  return report;
}

const INTERLUDE_SYSTEM = `You are the Narrator writing a PASSAGE-OF-TIME interlude for a world simulation. The player stepped away; the world kept moving. You receive a deterministic report of what actually happened (drives, clocks, rumors, healing). Write from it â€” invent texture, never contradict it.

CRITICAL â€” MEMORIES ARE PERSONAL. Each character's memory is only what THAT character personally lived through or would plausibly have heard where they were during these days. A character does NOT remember a distant event (a faction's clock firing three towns over, a rumor spreading in a place they weren't) unless they were there or someone credibly carried the news to them. A companion who spent these days beside the player remembers the ordinary days beside the player â€” NOT a battle in a city they never visited. Do not hand a character a memory of something they have no way of knowing; when in doubt, give them the small, local, personal version (what they did, where they were, who they were with), not the world-scale event. World-scale events belong in the interlude prose (which is the omniscient narrator's view), not in any individual's memory.

Output ONLY strict JSON:
{"interlude":"2-3 paragraphs of world-scale prose. Days passing, seasons of small life, the report's events landing among real people. NO player interiority â€” they were absent. End on the player's return: where they are as the world comes back into focus.",
"events":["3-6 one-line happenings drawn from the report, plain statements"],
"memories":[{"char_id":"","content":"what THIS character personally lived these days â€” local and first-hand, never a distant event they couldn't know","importance":4}],
"character_updates":[{"char_id":"","line":"one plain sentence: what this character has been doing / where their head is after these days (first-hand, local)","new_location":"OPTIONAL place name if they moved","drive_nudge":"OPTIONAL short new want that grew from these days"}],
"present_on_return":["names of 0-3 characters plausibly near the player when play resumes"],
"weather":"the weather on the day of return"}`;

export async function runInterlude(state: SaveState, days: number, ev: { onPhase: (p: string) => void }): Promise<void> {
  const t0 = Date.now();
  const turn = state.world.current_turn;
  await pushSnapshot(state);

  ev.onPhase("world-turning");
  const report = simulateForward(state, days);

  ev.onPhase("interlude");
  const spanLabel = days === 1 ? "a day passes" : days < 7 ? `${days} days pass` : days === 7 ? "a week passes" : `${days} days pass`;
  const reportText = [
    `SPAN: ${spanLabel} (now ${state.world.current_time})`,
    report.drive_log.length ? `DRIVES:\n${report.drive_log.slice(0, 10).join("\n")}` : "",
    report.clocks_fired.length ? `CLOCKS FIRED (these HAPPENED):\n${report.clocks_fired.join("\n")}` : "",
    report.clocks_moved.length ? `CLOCKS MOVING:\n${report.clocks_moved.join("\n")}` : "",
    report.consequences_due.length ? `NOW AT THE DOOR:\n${report.consequences_due.join("\n")}` : "",
    report.rumor_log.length ? `TALK SPREADING:\n${report.rumor_log.slice(0, 6).join("\n")}` : "",
    report.conditions_healed.length ? `HEALED: ${report.conditions_healed.slice(0, 6).join("; ")}` : "",
  ].filter(Boolean).join("\n\n");

  let interlude = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  let parsed: { interlude?: string; events?: string[]; memories?: { char_id: string; content: string; importance?: number }[]; character_updates?: { char_id: string; line?: string; new_location?: string; drive_nudge?: string }[]; present_on_return?: string[]; weather?: string } = {};
  try {
    const msgs = buildMessages(INTERLUDE_SYSTEM, stablePrefix(state), reportText, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 2500);
    usage = res.usage;
    parsed = safeJson(res.text, {});
    interlude = parsed.interlude ?? "";
  } catch { /* deterministic fallback below */ }
  if (!interlude) {
    const uniq = [...new Set([...report.clocks_fired, ...report.drive_log])].slice(0, 4);
    interlude = `${spanLabel[0].toUpperCase()}${spanLabel.slice(1)}. ${uniq.join(" ")}`.trim()
      || `${spanLabel[0].toUpperCase()}${spanLabel.slice(1)}. The world kept its own books.`;
  }

  // apply grounded memories â€” with a deterministic guard against the model handing a character a
  // memory of a distant event they couldn't know (a companion who was beside the player "remembering"
  // a faction battle three towns over). If the memory names a faction, clock, or thread the character
  // has no recorded connection to, and they weren't co-located with that event, drop it. World-scale
  // events live in the interlude prose, not in an individual's head.
  const factionNames = new Set(state.world.clocks.map((c) => c.faction.toLowerCase()));
  const threadTitles = state.world.threads.map((t) => t.title.toLowerCase());
  for (const m of parsed.memories ?? []) {
    const id = state.characters[m.char_id] ? m.char_id
      : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(m.char_id).toLowerCase())?.[0];
    if (!id || !m.content) continue;
    const content = String(m.content).toLowerCase();
    // does this memory reference a distant faction/thread event?
    const namesDistantEvent = [...factionNames].some((f) => f && content.includes(f))
      || threadTitles.some((t) => t && t.length > 6 && content.includes(t));
    if (namesDistantEvent) {
      // allow it only if this character has a prior recorded source for that subject (already has a
      // memory/fact mentioning it) â€” otherwise they have no way to know it happened.
      const mem = state.memory[id];
      const hasSource = !!mem && [...(mem.episodic ?? []), ...(mem.facts ?? [])].some((e) => {
        const txt = String((e as any).content ?? (e as any).fact ?? "").toLowerCase();
        return [...factionNames].some((f) => f && txt.includes(f) && content.includes(f))
          || threadTitles.some((t) => t && content.includes(t) && txt.includes(t));
      });
      if (!hasSource) {
        console.warn(`[interlude] dropped a memory for ${state.characters[id].name} referencing a distant event they have no source for: "${String(m.content).slice(0, 60)}"`);
        continue;
      }
    }
    state.memory[id]?.episodic.push({
      turn, content: m.content, importance: clamp(m.importance ?? 4, 1, 10),
      emotional_charge: "", last_accessed_turn: turn,
      source: "inferred", // written by the passage-of-time pass; the character lived it offscreen, not witnessed in play
    });
  }
  // per-character vignettes: a line of what they were up to, an optional move, an optional new want.
  // Applied under the same "first-hand / local" spirit as memories â€” these are things the character
  // themselves lived, so they're always self-sourced (inferred = offscreen but personally experienced).
  for (const cu of parsed.character_updates ?? []) {
    const id = state.characters[cu.char_id] ? cu.char_id
      : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(cu.char_id).toLowerCase())?.[0];
    if (!id || state.characters[id].status === "dead" || state.characters[id].status === "departed") continue;
    // a move: only to a place that exists (don't invent geography here)
    if (cu.new_location) {
      const pid = Object.entries(state.world.places).find(([, p]) => p.name.toLowerCase() === String(cu.new_location).toLowerCase())?.[0];
      if (pid) state.characters[id].location = pid;
    }
    // a new want that grew over the days â€” only if they don't already have a live drive
    if (cu.drive_nudge && !state.characters[id].drive?.goal) {
      state.characters[id].drive = { goal: String(cu.drive_nudge).slice(0, 160), progress: 0, updated_turn: turn } as any;
    }
    // a first-hand memory of their own days (self-sourced, personally lived â†’ inferred/offscreen)
    if (cu.line && state.memory[id]) {
      state.memory[id].episodic.push({
        turn, content: String(cu.line).slice(0, 240), importance: 3,
        emotional_charge: "", last_accessed_turn: turn, source: "inferred",
      });
    }
  }
  if (parsed.weather) state.world.weather = parsed.weather;
  const back = (parsed.present_on_return ?? [])
    .map((nm) => Object.entries(state.characters).find(([id, c]) => id !== "char_player" && c.name.toLowerCase() === String(nm).toLowerCase())?.[0])
    .filter((x): x is string => !!x && state.characters[x].status !== "dead" && state.characters[x].status !== "departed");
  // present is DERIVED from co-location everywhere else in the engine. Setting present without
  // moving anyone meant the very next turn's syncPresence wiped this list. Move the returners
  // to the player's location, then derive the scene the normal way.
  for (const id of new Set(back)) state.characters[id].location = state.world.player_location;
  syncPresence(state);

  const shifts = [
    ...report.clocks_fired.map((c) => `While you were away: ${c}`),
    ...report.consequences_due.map((c) => `Waiting for you: ${c}`),
  ].slice(0, 8);

  state.history.push({
    turn, kind: "interlude", span_label: spanLabel,
    player_action: `â€” ${spanLabel} â€”`, action_mode: "story",
    narrator_prose: interlude,
    summary: `Interlude: ${spanLabel}.`,
    shifts,
    offscreen: (parsed.events ?? report.drive_log).slice(0, 6),
    weather: state.world.weather,
    time_label: state.world.current_time,
  });

  const tel: TurnTelemetry = {
    turn, pressure: 1, pressure_source: `interlude â€” ${spanLabel}`,
    narrator_tokens_in: 0, narrator_tokens_out: 0,
    simulator_tokens_in: usage.prompt_tokens, simulator_tokens_out: usage.completion_tokens,
    reflection_tokens: 0, duration_ms: Date.now() - t0,
    word_count: interlude.split(/\s+/).filter(Boolean).length,
    player_mood_valence: state.condition["char_player"]?.psyche.mood_valence ?? 0,
    present: [...state.world.present], time_label: state.world.current_time,
    edge_snapshot: state.world.edges
      .filter((e) => e.to === "char_player" && state.characters[e.from])
      .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust })),
  };
  state.telemetry.push(tel);
  state.pressure_trace.push(1);
  state.world.current_turn++;
}

/**
 * NEW-CHAPTER CONDENSATION â€” carry who a character BECAME into the next chapter.
 *
 * The new-chapter flow used to drop acquired traits entirely and replace each character's
 * whole memory with a single line of background. This distills the real thing: a character's
 * traits, the heaviest episodic memories, their formed beliefs, and any accreted life_history
 * are folded into (a) a compact durable BACKGROUND paragraph and (b) a small set of preserved
 * high-self-weight traits â€” the parts of identity that are load-bearing enough to persist a
 * time-skip. Deterministic, zero tokens; the prose recap stays the player-facing layer, this is
 * the mechanical inheritance underneath it.
 */
export function condenseForNewChapter(ident: Identity, mem: CharMemory | undefined, traits: AcquiredTrait[] | undefined): {
  carried_memory: CharMemory;      // the COMPLETE memory, carried intact â€” nothing dropped, nothing sanitized
  carried_traits: AcquiredTrait[]; // the COMPLETE trait list, carried intact
} {
  // A new chapter is a time-skip, not a personality wipe. Who a character BECAME â€” every memory,
  // every acquired trait, including the violent, the carnal, the dark, the appetites they developed
  // â€” is exactly what should persist. We carry the full memory and full traits forward UNCHANGED.
  // The only adjustment is resetting the trait reinforcement clock so decay measures from the new
  // chapter's start rather than instantly aging everything across the skip.
  const carried_traits = (traits ?? []).map((t) => ({ ...t, last_reinforced_turn: 1 }));
  const carried_memory: CharMemory = mem
    ? { ...mem, episodic: mem.episodic.map((m) => ({ ...m, last_accessed_turn: 1 })) }
    : { character_id: ident.character_id, core: [], episodic: [], beliefs: [], knows: [] };
  return { carried_memory, carried_traits };
}

export async function embodyCharacter(state: SaveState, targetId: string): Promise<{ ok: boolean; error?: string }> {
  if (targetId === "char_player") return { ok: false, error: "you are already wearing this one" };
  if (!state.characters[targetId]) return { ok: false, error: "no such character" };

  await pushSnapshot(state); // unravel-able, like everything else

  const turn = state.world.current_turn;
  const oldId = uid("char");
  const swap = (id: string): string =>
    id === "char_player" ? oldId : id === targetId ? "char_player" : id;

  const fromName = state.characters["char_player"].name;
  const toName = state.characters[targetId].name;

  // re-key the three per-character ledgers + identity card ids
  for (const map of [state.characters, state.condition, state.memory, state.traits] as Record<string, any>[]) {
    const a = map["char_player"], b = map[targetId];
    delete map["char_player"]; delete map[targetId];
    if (a !== undefined) map[oldId] = a;
    if (b !== undefined) map["char_player"] = b;
  }
  state.characters[oldId].character_id = oldId;
  state.characters["char_player"].character_id = "char_player";
  if (state.memory[oldId]) state.memory[oldId].character_id = oldId;
  if (state.memory["char_player"]) state.memory["char_player"].character_id = "char_player";
  // knows lists reference character ids â€” remap them
  for (const mem of Object.values(state.memory)) mem.knows = [...new Set((mem.knows ?? []).map(swap))];
  // theory-of-mind models are keyed by believer id and reference target ids â€” remap both.
  // Left stale, the new player body kept its old model of "the player" (now itself) and
  // every other mind kept modeling the wrong person.
  if (state.minds) {
    const remapped: typeof state.minds = {};
    for (const [mid, model] of Object.entries(state.minds)) {
      const nid = swap(mid);
      remapped[nid] = {
        character_id: nid,
        about: (model.about ?? [])
          .map((b) => ({ ...b, target: swap(b.target) }))
          .filter((b) => b.target !== nid), // nobody models themselves
      };
    }
    state.minds = remapped;
  }

  // the abandoned vessel becomes a full citizen: needs a social pulse + a want
  state.characters[oldId].gregariousness ??= 0.5;
  state.characters[oldId].drive ??= {
    goal: `make sense of what just happened to ${fromName}`, progress: 0, updated_turn: turn,
  };

  // every reference in the world graph
  for (const e of state.world.edges) { e.from = swap(e.from); e.to = swap(e.to); }
  // collapse any duplicate edges created by the swap (keep latest)
  const seen = new Set<string>();
  state.world.edges = state.world.edges.filter((e) => {
    const k = `${e.from}â†’${e.to}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  for (const r of state.world.rumors) {
    r.origin_char = swap(r.origin_char);
    if (r.about_char) r.about_char = swap(r.about_char);
    r.knowers = [...new Set(r.knowers.map(swap))];
  }
  for (const cq of state.world.consequences) if (cq.source_char) cq.source_char = swap(cq.source_char);
  // the player now inhabits the target's body â†’ the world's player_location is wherever that body is
  state.world.player_location = state.characters["char_player"].location ?? state.world.player_location;
  // rebuild room occupancy + scene from locations (shared derivation â€” filters the dead, honors sub-rooms)
  syncPresence(state);

  // both souls keep the moment â€” written neutrally; the fiction is yours to define
  state.memory["char_player"]?.episodic.push({
    turn, content: `A change of perspective: I now live as ${toName}. ${fromName} continues elsewhere as their own person.`,
    importance: 7, emotional_charge: "vertigo", last_accessed_turn: turn,
  });
  state.memory[oldId]?.episodic.push({
    turn, content: `A strange gap in memory around this moment; ${fromName} is themselves again.`,
    importance: 7, emotional_charge: "unmoored", last_accessed_turn: turn,
  });

  (state.vessel_history ??= []).push({ turn, from_name: fromName, to_name: toName, time_label: state.world.current_time });
  return { ok: true };
}

