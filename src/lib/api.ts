
/** The engine, in your browser. Mirrors the old server API exactly so the views
 *  are unchanged: every method returns the same shapes; streamTurn runs the turn
 *  loop locally with callbacks instead of Server-Sent Events. */
import type {
  SaveState, ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
} from "../engine/types";
import { newSave, registerCharacter, rollback as doRollback, sanitize, uid, healTraits } from "../engine/state";
import { buildPreset, PRESET_LIST } from "../engine/presets";
import { runTurn, syncPresence, resolvePlace } from "../engine/turn";
import { runInterlude, embodyCharacter, condenseForNewChapter } from "../engine/continuity";
import { runMontage } from "../engine/montage-run";
import { preflightDirection } from "../engine/montage";
import { seedDrive } from "../engine/drives";
import { TIGHTNESS_ANCHOR } from "../engine/physiology";
import { beautyOf, applyBeautyChange } from "../engine/desire";
import { FORGE_SYSTEM, OPENING_SYSTEM, NEWSEASON_SYSTEM, MEMORY_CONDENSE_SYSTEM, INTERVIEW_SYSTEM, PERSONA_SYSTEM, buildPortraitPrompt, buildScenePrompt, stablePrefix, volatileDigest } from "../engine/prompts";
import { formatTime, parseTime } from "../engine/time";
import { compactMemoryDigest } from "../engine/memory";
import { groundMemoryContent, knownNameWhitelist } from "../engine/facts";
import { detectWorldPronoun } from "../engine/coerce";
import { buildMessages, complete, generateImage, safeJson } from "../llm";
import { getSave, putSave, deleteSave as dbDelete, listSaves as dbList, putSideRow, getSideRow, deleteSideRow } from "../store";

export type ClientSave = Omit<SaveState, "snapshots"> & { snapshot_turns: number[] };
export type {
  ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
};
export type { ActionMode } from "../engine/types";
import type { ActionMode } from "../engine/types";

export interface PresetInfo { id: string; name: string; blurb: string; era_theme: string }
export interface SaveListing { id: string; name: string; updated_at: string; turn: number; world_name: string }

const clampNum = (v: any, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

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

  /** Generate (or regenerate) the opening scene prose — the moment before turn 1. Stored as a kind:"opening" history entry. */
  generateOpening: async (id: string): Promise<ClientSave> => {
    const s = await need(id);
    const hint = (s.world.places[s.world.player_location]?.name ?? "") + ". " +
      Object.values(s.characters).filter((c) => c.character_id !== "char_player" && s.world.present.includes(c.character_id)).map((c) => c.name).join(", ");
    const msgs = buildMessages(OPENING_SYSTEM, stablePrefix(s), volatileDigest(s, "opening scene where the player arrives") + `\n\nWrite the opening scene now. Present: ${hint || "as the state dictates"}.`, s.model_settings.narrator_model);
    const out = await complete(msgs, s.model_settings.narrator_model, s.model_settings.fallback_model, false, 1200);
    const entry: TurnHistoryEntry = {
      turn: 0, kind: "opening", player_action: "", narrator_prose: out.text.trim(),
      summary: "The opening.", offscreen: [], time_label: s.world.current_time, weather: s.world.weather,
    };
    s.history = [entry, ...s.history.filter((h) => h.kind !== "opening")];
    await putSave(s);
    return clientView(s);
  },

  /** Save a hand-edited opening scene. */
  setOpening: async (id: string, prose: string): Promise<ClientSave> => {
    const s = await need(id);
    const rest = s.history.filter((h) => h.kind !== "opening");
    if (prose.trim()) {
      const entry: TurnHistoryEntry = {
        turn: 0, kind: "opening", player_action: "", narrator_prose: prose.trim(),
        summary: "The opening.", offscreen: [], time_label: s.world.current_time, weather: s.world.weather,
      };
      s.history = [entry, ...rest];
    } else {
      s.history = rest;
    }
    await putSave(s);
    return clientView(s);
  },

  /** Fork a long save into a NEW chapter: distill current world-state to a fresh start,
   *  carry forward evolved cast + relationships as background, open with a RECAP after a time skip. */
  forkNewSeason: async (id: string): Promise<ClientSave> => {
    const s = await need(id);
    // build a compact digest of the story so far for the model
    const cast = Object.entries(s.characters).filter(([cid, c]) => cid !== "char_player" && c.status !== "dead" && c.status !== "departed").map(([cid, c]) => {
      const edge = s.world.edges.find((e) => e.from === cid && e.to === "char_player");
      const traits = [...(c.core_traits ?? []), ...((s.traits[cid] ?? []).map((t) => t.label))];
      // relationship SHAPE, not just temperature: roles + qualitative notes carry estrangement,
      // warnings, debts, "you withdrew from her", etc. — the stuff the forge needs to not reset it.
      const rel = edge
        ? `toward you: warmth ${edge.warmth}, trust ${edge.trust}${edge.roles?.length ? `, role: ${edge.roles.join("/")}` : ""}${edge.notes ? ` — ${edge.notes}` : ""}`
        : "no established relationship with you";
      // the character's own strongest memories ABOUT the player — this is where "he told me they were
      // using me", "he left without saying why", "he pulled away" actually live. The recap must see them.
      const aboutPlayer = (s.memory[cid]?.episodic ?? [])
        .filter((m) => /\b(you|him|rabi|the player)\b/i.test(m.content) || (m.full_content && /\byou\b/i.test(m.full_content)))
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        .slice(0, 3)
        .map((m) => m.content.trim());
      // presence/distance: is this person actually still in the player's life, or pushed away/distant?
      const inScene = s.world.present.includes(cid);
      const distance = (edge && edge.warmth < 10 && edge.trust < 10) ? " [DISTANT/estranged — not currently close to the player]" : inScene ? " [was present at chapter's end]" : " [offscreen — not necessarily nearby]";
      return `${c.name} (${traits.slice(0, 6).join(", ")}) — ${rel}${c.drive?.goal ? `; wants: ${c.drive.goal}` : ""}${distance}${aboutPlayer.length ? `\n    remembers about you: ${aboutPlayer.join(" | ")}` : ""}`;
    }).join("\n");
    const recentBeats = s.history.filter((h) => h.kind !== "opening").slice(-16).map((h) => h.summary).filter(Boolean).join(" → ");
    // the player's OWN defining recent memories — their choices (leaving, isolating, warning people)
    // that shaped where things stand and that a recap must not overwrite with a generic reunion.
    const playerChoices = (s.memory["char_player"]?.episodic ?? [])
      .filter((m) => (m.importance ?? 0) >= 6)
      .sort((a, b) => (b.turn ?? 0) - (a.turn ?? 0))
      .slice(0, 6)
      .map((m) => m.content.trim());
    const player = s.characters["char_player"];
    const digest = [
      `WORLD: ${s.world_bible.name} — ${s.world_bible.era}. ${s.world_bible.political_situation}`,
      s.world_bible.narrator_direction ? `PLAYER'S STANDING DIRECTION (honor it): ${s.world_bible.narrator_direction}` : "",
      `PLAYER: ${player?.name}. ${player?.background ?? ""}`,
      `CAST:\n${cast}`,
      `CANON: ${(s.world.canon ?? []).join(" | ")}`,
      `OPEN THREADS: ${s.world.threads.map((t) => t.title).join("; ")}`,
      `RECENT EVENTS: ${recentBeats}`,
      `Turns played: ${s.world.current_turn}.`,
    ].filter(Boolean).join("\n\n");

    const msgs = buildMessages(NEWSEASON_SYSTEM, "A finished playthrough to carry into a new chapter:", digest, s.model_settings.forge_model);
    const out = await complete(msgs, s.model_settings.forge_model, s.model_settings.fallback_model, true, 4000);
    const g = safeJson<any>(out.text, null);
    if (!g?.recap || !g?.opening_scene) throw new Error("Couldn't distill a new chapter — try again, or use a stronger forge model.");

    // build the fresh save from the distilled bible (keep most of the original bible, overlay the updates)
    const bible: WorldBible = {
      ...s.world_bible,
      ...(g.world_bible ?? {}),
      name: g.world_bible?.name || `${s.world_bible.name} — Next Chapter`,
    };
    const ns = newSave(bible.name, bible);
    // player carries forward COMPLETE: full memory, full traits, nothing dropped or sanitized.
    // A new chapter is a time-skip, not a personality wipe — who they became persists entirely.
    const playerCarry = condenseForNewChapter(player, s.memory["char_player"], s.traits["char_player"]);
    registerCharacter(ns, {
      ...player, character_id: "char_player",
      background: `${player?.background ?? ""} ${g.player?.background_addition ?? ""}`.replace(/\s+/g, " ").trim(),
      drive: undefined, drive_queue: [],
    });
    ns.memory["char_player"] = { ...playerCarry.carried_memory, character_id: "char_player" }; // full memory intact
    ns.traits["char_player"] = playerCarry.carried_traits;                                       // full traits intact

    // place
    const lid = uid("loc");
    ns.world.places[lid] = { id: lid, name: g.starting_location_name || "a new place", description_facts: "", contains: [] };
    ns.world.player_location = lid;
    ns.characters["char_player"].location = lid;

    // surviving cast carry forward COMPLETE — full memory, full traits, full identity. The
    // background_addition is APPENDED as a "where they ended up" note, never replacing who they are.
    for (const c of (g.cast ?? [])) {
      if (c.still_present === false || !c.name) continue;
      const prev = Object.values(s.characters).find((x) => x.name.toLowerCase() === c.name.toLowerCase());
      const carry = prev ? condenseForNewChapter(prev, s.memory[prev.character_id], s.traits[prev.character_id]) : { carried_memory: { character_id: "", core: [], episodic: [], beliefs: [], knows: [] } as any, carried_traits: [] as any[] };
      const cid = registerCharacter(ns, {
        name: c.name,
        age: prev?.age ?? 30,
        appearance_facts: prev?.appearance_facts ?? "",
        background: `${prev?.background ?? ""} ${c.background_addition ?? ""}`.replace(/\s+/g, " ").trim(),
        life_history: prev?.life_history ?? "",          // the accreted defining-moments carry verbatim
        core_traits: prev?.core_traits ?? [],
        values: prev?.values ?? [],
        speech_pattern: prev?.speech_pattern ?? "plain",
        texture: prev?.texture ?? [],
        attracted_to: prev?.attracted_to,
        taste: prev?.taste,
        aliases: prev?.aliases,
        conscience: prev?.conscience,
        voice: prev?.voice,
        attachment: prev?.attachment,
        portrait_url: prev?.portrait_url,
        tracked: true,
        location: lid,
        drive: c.new_drive ? { goal: c.new_drive, progress: 0, priority: 1, updated_turn: 1 } : undefined,
      });
      const prevEdge = prev ? s.world.edges.find((e) => e.from === prev.character_id && e.to === "char_player") : undefined;
      ns.world.edges.push({ from: cid, to: "char_player", warmth: clampNum(c.warmth_to_player, -100, 100), trust: clampNum(c.trust_to_player, -100, 100), power: 0, attraction: prevEdge?.attraction, attraction_base: prevEdge?.attraction_base, notes: "carried from the last chapter", updated_turn: 1 });
      ns.memory[cid] = { ...carry.carried_memory, character_id: cid }; // full memory intact — nothing stripped
      ns.traits[cid] = carry.carried_traits;                            // full traits intact
    }
    // carry canon forward (the world-altering facts still happened)
    ns.world.canon = [...(s.world.canon ?? [])].slice(-12);
    // new threads
    for (const t of (g.threads ?? [])) {
      if (!t.title) continue;
      ns.world.threads.push({ id: uid("thr"), title: t.title, status: "active", description: t.description ?? "", turn_started: 1, tension: clampNum(t.tension ?? 3, 1, 10) });
    }
    // time + opening
    ns.world.weather = "";
    syncPresence(ns);
    const recapText = `RECAP: ${g.recap}${g.time_skip ? `\n\n${g.time_skip}.` : ""}\n\n${g.opening_scene}`;
    ns.history = [{ turn: 0, kind: "opening", player_action: "", narrator_prose: recapText, summary: "A new chapter begins.", offscreen: [], time_label: ns.world.current_time, weather: "" }];

    await putSave(ns);
    return clientView(ns);
  },

  /** CONTEXT REFRESH — NOT a time-skip. Same moment, same board: keep every character, their
   *  identity, traits, relationships (edges), the world bible, location, and turn count. What it
   *  does: (1) uses the BOOKKEEPER model to condense each character's long fragmented memory into a
   *  small POV summary while preserving the full factual record underneath (content = their reading;
   *  full_content = what actually happened, so stress-recall can still reach the whole scenario);
   *  (2) clears stale threads, consequences, and the recent-history log so a loaded queue can't
   *  regenerate a runaway plot. This is the "reload a clean save of exactly where I am" refresh. */
  refreshContext: async (id: string): Promise<ClientSave> => {
    const s = await need(id);
    const model = s.model_settings.simulator_model || s.model_settings.fallback_model; // the bookkeeper, per your choice
    const living = Object.entries(s.characters).filter(([, c]) => c.status !== "dead" && c.status !== "departed");
    for (const [cid, c] of living) {
      const mem = s.memory[cid];
      if (!mem || (mem.episodic?.length ?? 0) < 8) continue; // nothing to condense
      const edge = s.world.edges.find((e) => e.from === cid && e.to === "char_player");
      const rel = cid === "char_player" ? "(this is the player)" :
        (edge ? `toward the player: warmth ${edge.warmth}, trust ${edge.trust}${edge.roles?.length ? `, role: ${edge.roles.join("/")}` : ""}${edge.notes ? ` — ${edge.notes}` : ""}` : "no established bond with the player");
      const raw = mem.episodic.slice().sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0))
        .map((m) => `[T${m.turn}] ${m.full_content ?? m.content}`).join("\n");
      const info = `CHARACTER: ${c.name}. ${c.background ?? ""} ${c.life_history ?? ""}\nRELATIONSHIP: ${rel}\n\nRAW MEMORIES (oldest first):\n${raw}`;
      try {
        const out = await complete(buildMessages(MEMORY_CONDENSE_SYSTEM, "Condense this character's memory, preserving what truly happened:", info, model), model, s.model_settings.fallback_model, true, 2000);
        const g = safeJson<{ memories?: { content: string; importance?: number; emotional_charge?: string }[] }>(out.text, { memories: [] });
        if (!g?.memories?.length) continue;
        // the condensed POV summaries become the new episodic memory. full_content keeps the JOINED
        // factual record so state-gated stress-recall can still surface the whole scenario underneath.
        const factualUnderlayer = mem.episodic.map((m) => m.full_content ?? m.content).join(" ");
        // FIDELITY: the condensation is a cheap-model paraphrase of the whole history — the single
        // most dangerous place for a specific (a city, a name) to silently mutate across ALL of a
        // character's memory at once. Ground every condensed line against the raw record; a line
        // whose specifics can't be traced is repaired to the best verbatim source sentence.
        const wl = knownNameWhitelist(s);
        s.memory[cid].episodic = g.memories.slice(0, 12).map((m, i) => {
          const grounded = groundMemoryContent((m.content ?? "").trim(), undefined, raw, wl);
          return { turn: 0, content: grounded.content, full_content: grounded.content, importance: clampNum(m.importance ?? 5, 1, 10), emotional_charge: m.emotional_charge ?? "", last_accessed_turn: 0, decay_stage: 0 as const };
        });

        // …and stash the complete factual record as one deep-background memory kept vivid under stress
        s.memory[cid].episodic.push({
          turn: 0, content: "(the full history, as it actually happened)",
          full_content: factualUnderlayer.slice(0, 4000),
          importance: 7, emotional_charge: "", last_accessed_turn: 0, decay_stage: 0,
        } as any);
      } catch { /* leave this character's memory as-is on failure */ }
    }
    // clear the accumulated engine state that regenerates runaway plots — keep relationships & world
    s.world.threads = [];
    s.world.consequences = [];
    s.world.rumors = (s.world.rumors ?? []).slice(-3); // keep a few, drop the pile
    s.telemetry = (s.telemetry ?? []).slice(-20);
    s.pressure_trace = (s.pressure_trace ?? []).slice(-20);
    // keep the current scene beat as the sole recent-history anchor; drop the long log
    const lastBeat = s.history.filter((h) => h.kind !== "opening").slice(-1);
    s.history = lastBeat.length ? lastBeat : s.history.slice(-1);
    s.context_anchor = undefined; // chatlog anchor referenced the cleared history — force a fresh anchor
    await putSave(s);
    return clientView(s);
  },
  setFocus: async (id: string, label: string | null, opts?: { mode?: "build" | "active"; next_label?: string; auto_link?: boolean }): Promise<ClientSave> => {
    const s = await need(id);
    if (!label || !label.trim()) {
      s.world.focus = null;
    } else {
      const mode = opts?.mode ?? "build";
      let linked_consequence_id: string | undefined;
      if (opts?.auto_link !== false && mode === "build") {
        const pending = s.world.consequences.filter((c) => c.status === "pending");
        pending.sort((a, b) => (a.fire_time && b.fire_time ? (a.fire_time < b.fire_time ? -1 : 1) : a.fire_turn - b.fire_turn));
        linked_consequence_id = pending[0]?.id;
      }
      s.world.focus = {
        label: label.trim(), mode, linked_consequence_id,
        next_label: opts?.next_label?.trim() || (linked_consequence_id ? label.trim() : undefined),
        next_mode: "active",
      };
    }
    await putSave(s);
    return clientView(s);
  },

  /** Set the in-world clock by hand (the bookkeeper sometimes drifts from the prose). Accepts "Day N, HH:MM" or any parseable time. */
  setTime: async (id: string, time: string): Promise<ClientSave> => {
    const s = await need(id);
    if (time?.trim()) s.world.current_time = formatTime(parseTime(time));
    await putSave(s);
    return clientView(s);
  },

  rollback: async (id: string, to_turn: number): Promise<ClientSave> => {
    const s = await need(id);
    // SAFETY RAIL: stash the full pre-rollback state (snapshots included) BEFORE anything is
    // discarded. Rolling 174 turns to origin used to be one mistap with zero road back.
    await putSideRow(id, "recovery", s);
    const restored = await doRollback(s, to_turn);
    if (!restored) throw new Error("no snapshot covers that turn");
    await putSave(restored);
    return clientView(restored);
  },

  /** THE VETO. Strike something the narrator invented: roll back to before it happened, and record a
   *  standing correction so it is never regenerated, referred to, or "explained". Characters created
   *  by the struck turns are removed outright; canon they minted is dropped. Undo via undoRollback. */
  strike: async (id: string, text: string, to_turn?: number): Promise<ClientSave> => {
    const s = await need(id);
    const note = String(text || "").trim().slice(0, 240);
    if (!note) throw new Error("say what to strike");
    await putSideRow(id, "recovery", s);            // same safety rail as rollback
    let t = s;
    if (typeof to_turn === "number") {
      const restored = await doRollback(s, to_turn);
      if (!restored) throw new Error("no snapshot covers that turn");
      t = restored;
    }
    t.retcons = [...(t.retcons ?? []), { text: note, turn: t.world.current_turn }].slice(-12);
    // purge state the struck material left behind: non-central characters whose names the player named,
    // and any canon line that quotes the struck text.
    const words = note.toLowerCase().match(/[a-z']{4,}/g) ?? [];
    for (const [cid, c] of Object.entries(t.characters)) {
      if (cid === "char_player" || c.central) continue;
      const first = (c.name || "").split(/\s+/)[0].toLowerCase();
      if (first && note.toLowerCase().includes(first)) {
        delete t.characters[cid]; delete t.condition[cid]; delete t.memory[cid]; delete t.minds?.[cid];
        t.world.present = t.world.present.filter((p) => p !== cid);
        t.world.edges = t.world.edges.filter((e) => e.from !== cid && e.to !== cid);
        for (const p of Object.values(t.world.places)) p.contains = p.contains.filter((x) => x !== cid);
      }
    }
    if (words.length) t.world.canon = t.world.canon.filter((line) => !words.some((w) => line.toLowerCase().includes(w) && w.length > 5));
    // PURGE POISONED MEMORIES — the struck material's real damage is the episodic/core/belief/fact
    // memories the bookkeeper canonized from it (an invented death recorded across the whole cast).
    // Leaving those in place lets the narrator keep reading the struck event as true and regenerating
    // it. Strip any memory entry that substantially matches the struck note, across every character.
    // Match on distinctive content words (5+ letters) so a specific strike ("Marie's father is dead
    // in the garage") clears the related memories without nuking unrelated ones.
    const strongWords = words.filter((w) => w.length >= 5);
    const matchesStruck = (text: string): boolean => {
      if (!text) return false;
      const t2 = text.toLowerCase();
      const hits = strongWords.filter((w) => t2.includes(w)).length;
      // require a couple of distinctive words to overlap, so we target the struck event specifically
      return hits >= Math.min(2, strongWords.length) && hits >= 2;
    };
    if (strongWords.length >= 2) {
      let purged = 0;
      for (const mem of Object.values(t.memory)) {
        for (const key of ["episodic", "core", "beliefs", "facts"] as const) {
          const arr = (mem as any)[key];
          if (!Array.isArray(arr)) continue;
          const before = arr.length;
          (mem as any)[key] = arr.filter((m: any) => !matchesStruck(typeof m === "string" ? m : (m?.content ?? m?.fact ?? "")));
          purged += before - (mem as any)[key].length;
        }
      }
      if (purged) console.warn(`[retcon] purged ${purged} memory entr${purged === 1 ? "y" : "ies"} matching the struck material`);
    }
    await putSave(t);
    return clientView(t);
  },

  /** Drop a standing retcon by index (the struck thing is allowed back into the story). */
  unstrike: async (id: string, idx: number): Promise<ClientSave> => {
    const s = await need(id);
    s.retcons = (s.retcons ?? []).filter((_, i) => i !== idx);
    await putSave(s);
    return clientView(s);
  },

  /** RE-RUN THE BOOKKEEPER. The narrator's prose is kept; only the simulator runs again.
   *  A dead or empty diff means the turn happened in the prose but never in the world — nobody
   *  remembered it, no feelings moved. Rolls back to the state before the turn (the snapshot ring
   *  stores pre-turn state) and replays the SAME action and SAME prose through the full downstream
   *  pipeline: simulator, clamps, applyDiff, physiology, reflection. Costs one simulator call, no
   *  narrator call. Undo via undoRollback. */
  rerunBookkeeper: async (id: string, turn?: number, ev?: TurnEvents): Promise<ClientSave> => {
    const s = await need(id);
    const t = turn ?? s.world.current_turn;
    const entry = s.history.find((h) => h.turn === t && (h.kind ?? "turn") === "turn");
    if (!entry) throw new Error(`turn ${t} is not a re-runnable turn`);
    if (!entry.narrator_prose?.trim()) throw new Error("that turn has no prose to re-read");
    await putSideRow(id, "recovery", s);                 // same safety rail as rollback/strike
    // The snapshot for turn N is taken BEFORE N applies, so replaying N means restoring snapshot N
    // exactly. doRollback finds the nearest EARLIER snapshot, which would silently replay this prose
    // against a state several turns stale and destroy everything between — so demand an exact hit.
    if (!s.snapshots.some((snap) => snap.turn === t)) {
      throw new Error(`turn ${t} has aged out of the snapshot ring — only the last few turns can be re-run`);
    }
    const restored = await doRollback(s, t);
    if (!restored) throw new Error("no snapshot covers that turn");
    const gov = governorState(restored);
    await runTurn(restored, entry.player_action, {
      onPhase: (p) => ev?.onPhase?.(p),
      onDelta: () => { /* prose is not regenerated */ },
      onMeta: (m) => ev?.onMeta?.(m as Record<string, unknown>),
    }, (entry.action_mode as ActionMode) ?? "do", { eco: gov.eco, proseOverride: entry.narrator_prose });
    // the prose is unchanged, so its illustration is still valid — carry it across the replay
    // rather than making the player pay to regenerate an identical image.
    if (entry.illustration_url) {
      const fresh = restored.history.find((h) => h.turn === t);
      if (fresh && !fresh.illustration_url) fresh.illustration_url = entry.illustration_url;
    }
    await putSave(restored);
    return clientView(restored);
  },

  /** One level of rollback undo — restores the exact pre-rollback state. */
  undoRollback: async (id: string): Promise<ClientSave> => {
    const rec = await getSideRow(id, "recovery");
    if (!rec) throw new Error("no rollback to undo");
    await putSave(rec);
    await deleteSideRow(id, "recovery");
    return clientView(rec);
  },
  hasRollbackRecovery: async (id: string): Promise<{ available: boolean; turn?: number }> => {
    const rec = await getSideRow(id, "recovery");
    return rec ? { available: true, turn: rec.world.current_turn } : { available: false };
  },

  /** Rolling 25-turn checkpoint restore — bounds catastrophic loss without exports. */
  restoreBackup: async (id: string): Promise<ClientSave> => {
    const cur = await need(id);
    const bak = await getSideRow(id, "backup");
    if (!bak) throw new Error("no auto-backup exists yet");
    await putSideRow(id, "recovery", cur); // restoring a backup is itself undoable
    await putSave(bak);
    return clientView(bak);
  },
  backupInfo: async (id: string): Promise<{ turn?: number }> => {
    const bak = await getSideRow(id, "backup");
    return { turn: bak?.world.current_turn };
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
    if (patch.world_bible) {
      // Changing (or clearing) the destination invalidates any progress scored against the old one —
      // otherwise a fresh ending inherits the previous reading, or a cleared one stays "reached".
      const nextDest = patch.world_bible.destination;
      if (nextDest !== undefined && (nextDest ?? "").trim() !== (s.world_bible.destination ?? "").trim()) {
        s.destination_progress = null;
        s.world_bible.destination_reached = false;
        s.world_bible.destination_outcome = undefined;
        // the clock starts when the destination is named, not when the save began
        s.world_bible.destination_set_turn = (nextDest ?? "").trim() ? s.world.current_turn : undefined;
      }
      // changing only the budget re-bases the clock from now, so shortening it never
      // retroactively spends turns the player did not know were counted
      if (patch.world_bible.destination_turns !== undefined &&
          patch.world_bible.destination_turns !== s.world_bible.destination_turns &&
          !s.world_bible.destination_reached) {
        s.world_bible.destination_set_turn = s.world.current_turn;
      }
      s.world_bible = { ...s.world_bible, ...patch.world_bible };
    }
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

  /** Deterministic warnings for a montage direction. Zero tokens, zero writes. */
  montagePreflight: async (id: string, direction: string, days?: number): Promise<string[]> => {
    const s = await need(id);
    return preflightDirection(s, direction, days);
  },

  /** Directed montage — a plan executed in beats, every beat through the real ledgers. */
  montage: async (
    id: string, days: number, direction: string,
    granularity: "quick" | "standard" | "full",
    onPhase?: (p: string) => void,
  ): Promise<{ save: ClientSave; scorecard: { item: string; landed: boolean }[] }> => {
    const s = await need(id);
    const res = await runMontage(s, {
      days: Math.max(1, Math.min(120, days)), direction, granularity,
    }, { onPhase: onPhase ?? (() => {}) });
    await putSave(s);
    return { save: clientView(s), scorecard: res.scorecard };
  },

  advance: async (id: string, days: number): Promise<ClientSave> => {
    const s = await need(id);
    await runInterlude(s, Math.max(1, Math.min(30, days)), { onPhase: () => {} });
    await putSave(s);
    return clientView(s);
  },

  /** Full raw edit of one character: identity, condition, acquired traits, memory.
   *  Accepts the same shape getCharacterRaw returns. Validates types; missing keys are left as-is. */
  rawEditCharacter: async (id: string, char_id: string, raw: any): Promise<ClientSave> => {
    const s = await need(id);
    if (!s.characters[char_id]) throw new Error("unknown character");
    if (raw && typeof raw === "object") {
      if (raw.identity && typeof raw.identity === "object") {
        s.characters[char_id] = { ...s.characters[char_id], ...raw.identity, character_id: char_id };
      }
      if (raw.condition && typeof raw.condition === "object") {
        s.condition[char_id] = { ...s.condition[char_id], ...raw.condition };
        s.condition[char_id].psyche = { ...s.condition[char_id].psyche, ...(raw.condition.psyche ?? {}) };
      }
      if (Array.isArray(raw.traits)) s.traits[char_id] = healTraits(raw.traits);
      if (raw.memory && typeof raw.memory === "object") {
        const m = s.memory[char_id];
        if (Array.isArray(raw.memory.core)) m.core = raw.memory.core.filter(Boolean);
        if (Array.isArray(raw.memory.beliefs)) m.beliefs = raw.memory.beliefs;
        if (Array.isArray(raw.memory.episodic)) m.episodic = raw.memory.episodic;
        if (Array.isArray(raw.memory.knows)) m.knows = raw.memory.knows;
      }
    }
    await putSave(s);
    return clientView(s);
  },

  /** The editable slice of one character, for the raw editor. */
  getCharacterRaw: async (id: string, char_id: string): Promise<any> => {
    const s = await need(id);
    return {
      identity: s.characters[char_id],
      condition: s.condition[char_id],
      traits: s.traits[char_id] ?? [],
      memory: s.memory[char_id],
    };
  },

  /** The editable world slice for the raw world editor (no per-character data — use the character editor for that). */
  getWorldRaw: async (id: string): Promise<any> => {
    const s = await need(id);
    return {
      world_bible: s.world_bible,
      threads: s.world.threads,
      clocks: s.world.clocks,
      norms: s.world.norms,
      canon: s.world.canon,
      canon_meta: s.world.canon_meta,
      edges: s.world.edges,
      places: s.world.places,
      weather: s.world.weather,
      current_time: s.world.current_time,
      player_location: s.world.player_location,
      money: s.world.money,
    };
  },

  /** Full raw edit of the world. Validates types; missing keys are left untouched. Re-derives presence. */
  rawEditWorld: async (id: string, raw: any): Promise<ClientSave> => {
    const s = await need(id);
    if (raw && typeof raw === "object") {
      if (raw.world_bible && typeof raw.world_bible === "object") s.world_bible = { ...s.world_bible, ...raw.world_bible };
      if (Array.isArray(raw.threads)) s.world.threads = raw.threads;
      if (Array.isArray(raw.clocks)) s.world.clocks = raw.clocks;
      if (Array.isArray(raw.norms)) s.world.norms = raw.norms;
      if (Array.isArray(raw.canon)) s.world.canon = raw.canon.map(String).filter(Boolean).slice(0, 20);
      if (raw.canon_meta && typeof raw.canon_meta === "object") s.world.canon_meta = raw.canon_meta;
      if (Array.isArray(raw.edges)) s.world.edges = raw.edges;
      if (raw.places && typeof raw.places === "object") s.world.places = raw.places;
      if (typeof raw.weather === "string") s.world.weather = raw.weather;
      if (typeof raw.current_time === "string" && raw.current_time.trim()) s.world.current_time = formatTime(parseTime(raw.current_time));
      if (typeof raw.money === "string") s.world.money = raw.money;
      if (typeof raw.player_location === "string") {
        s.world.player_location = raw.player_location;
        if (s.characters["char_player"]) s.characters["char_player"].location = raw.player_location;
      }
      // re-derive room occupancy + scene from locations after any places/location change
      // (shared derivation — filters dead/departed and honors sub-room locales)
      syncPresence(s);
    }
    await putSave(s);
    return clientView(s);
  },

  /** Player control over a character's role: 'background' demotes from central to a low-footprint
   *  background figure; 'away' removes them from the story (departed) and the current scene; 'restore'
   *  brings a departed character back as active. Lets the player fix the engine over-promoting someone. */
  setCharacterStatus: async (id: string, char_id: string, action: "background" | "away" | "restore" | "central"): Promise<ClientSave> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c || char_id === "char_player") throw new Error("cannot change this character");
    if (action === "background") {
      c.central = false; c.tracked = false; c.drive = undefined; c.drive_queue = [];
    } else if (action === "away") {
      c.status = "departed"; c.central = false; c.tracked = false; c.drive = undefined; c.drive_queue = [];
      s.world.present = s.world.present.filter((p) => p !== char_id); // leave the scene now
    } else if (action === "restore") {
      c.status = "active";
    } else if (action === "central") {
      c.central = true; c.tracked = true; c.status = "active";
      if (!c.drive) { const d = seedDrive(s, char_id); if (d) c.drive = d; }
    }
    await putSave(s);
    return clientView(s);
  },


  /** TRUTH PANEL — the verified-fact ledger, readable and player-editable. Corrections here are
   *  authoritative: the engine treats ledger facts as verbatim truth in every future digest. */
  setFacts: async (id: string, char_id: string, facts: { content: string; quote?: string }[]): Promise<ClientSave> => {
    const s = await need(id);
    const mem = s.memory[char_id];
    if (!mem) throw new Error("no such character");
    mem.facts = facts
      .map((f) => ({ content: (f.content ?? "").trim().slice(0, 160), turn: s.world.current_turn, quote: f.quote?.slice(0, 160) }))
      .filter((f) => f.content)
      .slice(0, 40);
    await putSave(s);
    return clientView(s);
  },

  /** INTERVIEW MODE — talk to a character out of scene. Pure: no state mutation, no turn, no
   *  memory written; the character answers from their own digest on the cheap model. */
  interview: async (id: string, char_id: string, question: string, transcript: { q: string; a: string }[] = []): Promise<{ answer: string }> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c || char_id === "char_player") throw new Error("no such character");
    const cond = s.condition[char_id];
    const mem = s.memory[char_id];
    const edge = s.world.edges.find((e) => e.from === char_id && e.to === "char_player");
    const traits = (s.traits[char_id] ?? []).slice(0, 5).map((t) => `${t.label} — ${t.behavioral_impact}`).join("; ");
    const memDigest = mem ? compactMemoryDigest(mem, question, s.world.current_turn, 6, s.world.current_time, cond?.psyche.relaxation ?? 0) : "";
    const ctx = [
      `CHARACTER: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}. ${c.background}`,
      c.life_history ? `Since the story began: ${c.life_history}` : "",
      `Voice: ${c.speech_pattern}. Core: ${c.core_traits.join(", ")}.`,
      traits ? `Learned: ${traits}` : "",
      cond ? `Right now: mood ${cond.psyche.mood || "even"}; relaxation ${cond.psyche.relaxation} (colors every answer per the openness rules).` : "",
      edge ? `Toward the player: ${edge.roles?.length ? edge.roles.join(" & ") + ", " : ""}warmth ${edge.warmth}, trust ${edge.trust}${edge.attraction !== undefined ? `, desire ${edge.attraction} (separate from warmth — liking is not wanting)` : ""}${edge.notes ? ` — ${edge.notes}` : ""}.` : "They barely know the player.",
      memDigest,
    ].filter(Boolean).join("\n");
    const msgs: any[] = [{ role: "system", content: INTERVIEW_SYSTEM }, { role: "user", content: ctx }];
    msgs.push({ role: "assistant", content: "(I settle in, myself, ready to speak plainly or not at all.)" });
    for (const t of transcript.slice(-6)) { msgs.push({ role: "user", content: t.q }); msgs.push({ role: "assistant", content: t.a }); }
    msgs.push({ role: "user", content: question });
    const out = await complete(msgs, s.model_settings.simulator_model, s.model_settings.fallback_model, false, 500);
    return { answer: out.text.trim() };
  },


  /** BASELINE COMPLETION — one cheap call that fills the gaps in a thin appearance card
   *  (hair, eyes, skin, face, build, age, one unique mark). Every already-stated detail is
   *  kept verbatim; only the silences are invented, consistent with the world. Returns a
   *  suggestion — nothing is saved until the player weaves it in. */
  completeBaseline: async (id: string, char_id: string): Promise<{ baseline: string }> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("no such character");
    const b = s.world_bible;
    const premise = [b.era, b.cultures_and_languages].filter(Boolean).join(" · ");
    const out = await complete([
      { role: "system", content: "You complete a character's PHYSICAL BASELINE for a story engine. Required coverage: hair color AND texture/style, eye color, skin tone, face shape or one distinctive facial feature, build, apparent age, and ONE unique identifying mark (scar, crooked nose, gait, chipped tooth). Rules: every detail already stated in the current baseline is SACRED — keep it verbatim. Invent ONLY what is missing, consistent with the world and the character's background. PHYSICAL CONSTANTS ONLY — no clothing, no gear, no mood. Output ONLY the finished baseline as 1-3 plain sentences, nothing else." },
      { role: "user", content: `WORLD: ${premise || "unspecified"}\nCHARACTER: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}. Background: ${c.background.slice(0, 300)}\nCURRENT BASELINE: ${c.appearance_facts || "(empty)"}` },
    ], s.model_settings.simulator_model, s.model_settings.fallback_model, false, 300);
    return { baseline: out.text.trim().replace(/^"|"$/g, "").slice(0, 600) };
  },

  /** BEAUTY RESCORE — a small, cheap call that assigns intrinsic attractiveness (0-100) from a
   *  character's CURRENT physical baseline + age + height/weight. Species-agnostic: a machine, a
   *  beast, a disembodied voice can score high on presence and symmetry. Called automatically when
   *  a character's on-sight appearance changed this turn (scar, aging, weight, ruin, new dress) and
   *  available as a manual button. On return it delta-propagates the change to everyone already
   *  attracted to them (established bonds move least) rather than reseeding. `ids` omitted = flush
   *  the whole pending queue. Returns the new scores. */
  rescoreBeauty: async (id: string, ids?: string[]): Promise<{ scores: Record<string, number> }> => {
    const s = await need(id);
    const targets = (ids && ids.length ? ids : (s.pending_beauty_rescore ?? [])).filter((cid) => s.characters[cid]);
    const scores: Record<string, number> = {};
    for (const cid of targets) {
      const c = s.characters[cid];
      const dims = [
        c.height_cm ? `${c.height_cm}cm` : "",
        c.weight_kg ? `${c.weight_kg}kg` : "",
      ].filter(Boolean).join(", ");
      try {
        const out = await complete([
          { role: "system", content: "You assign a character's INTRINSIC ATTRACTIVENESS as a single integer 0-100 — the snap-judgment a stranger's nervous system makes on sight, before knowing them. Judge from physical form ONLY: symmetry, youthfulness/vitality, proportion, striking or distinctive features, presence. This is species-AGNOSTIC and body-agnostic: a machine, a beast, an angel, or a disembodied voice can be beautiful on presence and form alone — do not penalize non-human. Do not judge personality, clothing brand, or morality. Scale: 50 = ordinary/average, 65-75 = notably attractive, 85+ = stunning/head-turning, below 35 = plain or off-putting. Age and permanent marks (scars, ruin, aging, weight) shift the number as a stranger's eye would weigh them — sometimes down, sometimes not (a scar can be striking). Output ONLY the integer, nothing else." },
          { role: "user", content: `CHARACTER: ${c.name}, age ${c.age}${dims ? `, ${dims}` : ""}${c.pronouns ? `, ${c.pronouns}` : ""}.\nPHYSICAL BASELINE: ${c.appearance_facts || "(unspecified)"}\nCURRENT PRESENTATION: ${c.appearance_now || "(nothing notable)"}` },
        ], s.model_settings.simulator_model, s.model_settings.fallback_model, false, 12);
        const n = parseInt((out.text.match(/\d+/) ?? ["50"])[0], 10);
        const newB = Math.max(0, Math.min(100, isNaN(n) ? 50 : n));
        const oldB = typeof c.beauty === "number" ? c.beauty : beautyOf(c);
        c.beauty = newB;
        applyBeautyChange(s, cid, oldB, newB);
        scores[cid] = newB;
      } catch { /* leave beauty as-is on a failed call; it'll retry next change */ }
    }
    // clear the flushed ids from the pending queue
    if (s.pending_beauty_rescore?.length) {
      const done = new Set(targets);
      s.pending_beauty_rescore = s.pending_beauty_rescore.filter((cid) => !done.has(cid));
    }
    await putSave(s);
    return { scores };
  },


  /** FULL-HISTORY PERSONA READ — types the player as actually played, from every chapter plus a
   *  sample of their literal typed actions. One cheap call; stored on the save so Chronicle can
   *  show it, refreshable any time. */
  analyzePersona: async (id: string): Promise<{ turn: number; mbti: string; read: string; traits: string[]; arc: string }> => {
    const s = await need(id);
    const chapters = (s.chapters ?? []).map((c) => `Ch${c.idx} "${c.title}": ${c.summary}${c.persona ? ` [read then: ${c.persona.mbti}]` : ""}`).join("\n");
    const acts = s.history.filter((h) => h.kind !== "opening" && h.player_action);
    const step = Math.max(1, Math.floor(acts.length / 60));
    const sample = acts.filter((_, i) => i % step === 0).map((h) => `T${h.turn}: ${h.player_action.slice(0, 80)}`).join("\n");
    const out = await complete([
      { role: "system", content: PERSONA_SYSTEM },
      { role: "user", content: `CHAPTERS:\n${chapters || "(none yet — story is young)"}\n\nSAMPLED PLAYER ACTIONS (verbatim):\n${sample.slice(0, 8000)}` },
    ], s.model_settings.simulator_model, s.model_settings.fallback_model, true, 700);
    const parsed = safeJson<{ mbti?: string; read?: string; traits?: string[]; arc?: string }>(out.text, {});
    const reading = {
      turn: s.world.current_turn,
      mbti: String(parsed.mbti ?? "????").slice(0, 6).toUpperCase(),
      read: String(parsed.read ?? "").slice(0, 500),
      traits: (parsed.traits ?? []).slice(0, 6).map((t) => String(t).slice(0, 70)),
      arc: String(parsed.arc ?? "").slice(0, 400),
    };
    s.persona_reading = reading;
    await putSave(s);
    return reading;
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

  /** BASELINE TIGHTNESS — a player-only standing override of their own relaxation ceiling that
   *  HOLDS across turns (unlike the per-turn `tightness` opt, which is a one-turn spike). Level 0-5
   *  maps to a relaxation anchor via TIGHTNESS_ANCHOR; passing null/undefined clears it so the
   *  engine goes back to inferring the player's state from their words. The Play UI reads this back
   *  from condition.char_player.subjective_ceiling. */
  setBaselineTightness: async (id: string, level: number | null): Promise<ClientSave> => {
    const s = await need(id);
    const cond = s.condition.char_player;
    if (!cond) throw new Error("no player condition");
    if (level === null || level === undefined) {
      cond.subjective_ceiling = undefined;             // cleared → inference resumes
    } else {
      const n = Math.max(0, Math.min(5, Math.round(level)));
      cond.subjective_ceiling = TIGHTNESS_ANCHOR[n];
      // if the body currently reads looser than the new baseline, pull it down to match now
      if (cond.psyche.relaxation > cond.subjective_ceiling) cond.psyche.relaxation = cond.subjective_ceiling;
    }
    await putSave(s);
    return clientView(s);
  },

  embody: async (id: string, char_id: string): Promise<ClientSave> => {
    const s = await need(id);
    const r = await embodyCharacter(s, char_id);
    if (!r.ok) throw new Error(r.error);
    await putSave(s);
    return clientView(s);
  },

  portrait: async (id: string, char_id: string): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    c.portrait_url = await generateImage(buildPortraitPrompt(s, char_id), s.model_settings.image_model, [], "portrait");
    await putSave(s);
    return { url: c.portrait_url, save: clientView(s) };
  },

  illustrate: async (id: string, turn: number): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const entry = [...s.history].reverse().find((h) => h.turn === turn) ?? s.history[s.history.length - 1];
    if (!entry) throw new Error("no turn to illustrate");
    // feed the portraits of characters in this scene so they stay visually consistent
    const refs = ["char_player", ...s.world.present]
      .map((cid) => s.characters[cid]?.portrait_url)
      .filter((u): u is string => !!u && u.startsWith("data:"));
    entry.illustration_url = await generateImage(buildScenePrompt(s, entry.summary), s.model_settings.image_model, refs, "landscape");
    await putSave(s);
    return { url: entry.illustration_url, save: clientView(s) };
  },

  forge: async (seed: string, model = "deepseek/deepseek-chat-v3-0324", destinationTurns?: number, ground?: boolean, seedThreads?: { title: string; description?: string; tension?: number }[], tone?: string): Promise<ClientSave> => {
    // WEB SEARCH TARGET in the seed: ((real subject)) names exactly what to ground on and is
    // stripped from the seed text the forge actually builds from. Falls back to the whole seed as
    // the query when grounding is on without an explicit ((...)) — the seed IS the topic here, and
    // it's short, so Exa stays on-target (unlike the play loop's giant digest).
    let searchTarget = "";
    const cleanSeed = seed.replace(/\(\(([^)]+)\)\)/g, (_m, q) => { searchTarget += (searchTarget ? "; " : "") + String(q).trim(); return ""; }).replace(/\s{2,}/g, " ").trim();
    const online = ground || !!searchTarget;
    const searchQuery = searchTarget || (online ? cleanSeed.slice(0, 200) : undefined);
    const beatsBlock = (seedThreads?.length)
      ? `\n\nSTORY BEATS THE PLAYER WANTS SEEDED (build the world, cast, places, and clocks so these are POSSIBLE and primed — don't resolve them, just make the world ready for them to emerge; the player may still ignore them):\n${seedThreads.map((t, i) => `${i + 1}. ${t.title}${t.description ? ` — ${t.description}` : ""}`).join("\n")}`
      : "";
    const toneBlock = tone?.trim()
      ? `\n\nGENRE & TONE (the register this story must be built and written in — shape the world, threat, pressure palette, and cast to fit it): ${tone.trim()}`
      : "";
    const msgs = buildMessages(FORGE_SYSTEM, "SEED IDEA:", cleanSeed + toneBlock + beatsBlock, model);
    let g: any = null, lastErr = "";
    for (const m of [model, model, "google/gemini-2.0-flash-001"]) {
      try {
        const out = await complete(msgs, m, m, true, 8000, online ? { online: true, searchQuery } : undefined);
        g = safeJson<any>(out.text, null);
        // A world with three places is a world where the narrator has nowhere legal to move anyone,
        // so it invents "the kitchen doorway" and the resolver strands whoever went there. Demand a
        // real gazetteer; a model that gives two locations will do it again on the next seed, not
        // the next retry, so accept 6 rather than burn all three attempts on a strict 10.
        if (g?.world_bible?.name && g?.player?.name && (g.npcs?.length ?? 0) >= 1 && (g.places?.length ?? 0) >= 6) break;
        if (g && (g.places?.length ?? 0) < 6) lastErr = `model ${m} returned only ${g.places?.length ?? 0} locations (need at least 6)`;
        lastErr = `model ${m} returned an incomplete world`;
        g = null;
      } catch (e: any) { lastErr = `${m}: ${e.message}`; g = null; }
    }
    if (!g) throw new Error(`The forge failed after 3 attempts — ${lastErr}. Try a more concrete seed (place + people + problem) or a stronger forge model.`);

    const bible: WorldBible = {
      ...g.world_bible,
      difficulty_profile: g.world_bible.difficulty_profile ?? { lethality: "medium", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
    };
    // GENRE: an explicit player-set tone wins over whatever the forge model inferred, so the
    // narrator's GENRE line reflects what the player actually asked for.
    if (tone?.trim()) bible.tone = tone.trim();
    // FATE: a destination with a turn budget is a promise the engine keeps. The clock starts at 0.
    if (bible.destination?.trim() && destinationTurns && destinationTurns > 0) {
      bible.destination_turns = Math.round(destinationTurns);
      bible.destination_set_turn = 0;
    } else {
      delete bible.destination_turns;
    }
    const s = newSave(g.world_bible.name || seed.slice(0, 40), bible);
    // premise-as-constraint: the forge's canon lines land in world.canon, the strongest
    // channel in the engine — rendered to BOTH models every turn, forever
    s.world.canon = (Array.isArray(g.canon) ? g.canon : []).map(String).map((x: string) => x.trim()).filter(Boolean).slice(0, 6);
    registerCharacter(s, { ...g.player, character_id: "char_player" });
    s.memory["char_player"].core = [g.player.background].filter(Boolean);

    const nameToId: Record<string, string> = {};
    for (const p of g.places ?? []) {
      const lid = uid("loc");
      s.world.places[lid] = { id: lid, name: p.name, description_facts: p.description_facts ?? "", contains: [], founding: true };
      nameToId[p.name?.toLowerCase?.() ?? ""] = lid;
    }
    // PRONOUN BACKSTOP. If canon declares this world's people use a non-default pronoun set (a
    // premise like "everyone uses xe/xem, there are no men or women"), a model that slips and writes
    // "she/her" on the sheets poisons the whole cast — the narrator then renders every native as a
    // woman. Detect the declared set from canon and force it onto every native NPC. The player keeps
    // theirs; they are the outsider.
    const worldPronoun = detectWorldPronoun(s.world.canon);
    for (const n of g.npcs ?? []) {
      const cid = registerCharacter(s, { ...n, drive: n.drive_goal ? { goal: n.drive_goal, progress: 10, updated_turn: 1 } : undefined });
      if (worldPronoun && s.characters[cid]) s.characters[cid].pronouns = worldPronoun;
      s.memory[cid].core = [n.background].filter(Boolean);
      s.world.edges.push({ from: cid, to: "char_player", warmth: Math.max(-100, Math.min(100, n.warmth ?? 0)), trust: Math.max(-100, Math.min(100, n.trust ?? 0)), power: 0, notes: n.relation_to_player ?? "", updated_turn: 1 });
    }
    for (const c of g.clocks ?? []) {
      s.world.clocks.push({ id: uid("clk"), faction: c.faction ?? "", objective: c.objective ?? "", segments: Math.max(2, c.segments ?? 6), filled: 0, consequence: c.consequence ?? "", visible_signs: c.visible_signs ?? [], status: "running" });
    }
    for (const n of g.norms ?? []) {
      s.world.norms.push({ id: uid("nrm"), rule: n.rule ?? "", enforcement: n.enforcement ?? "gossip", holders: n.holders ?? "" });
    }
    // PLAYER-AUTHORED SEED THREADS — the chronicle beats the player set in the forge become real
    // active threads the pressure system draws from, so what emerges is anchored to their intent
    // rather than invented cold. They start at a modest tension so they surface as the story wants
    // them, not all at once; the player can always ignore them (they resolve/abandon like any thread).
    for (const t of seedThreads ?? []) {
      if (!t.title?.trim()) continue;
      s.world.threads.push({ id: uid("thr"), title: t.title.trim(), status: "active", description: t.description?.trim() ?? "", turn_started: 1, tension: clampNum(t.tension ?? 3, 1, 10) });
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
    // snapshots are device-local rollback state (and the biggest payload — full copies × image data).
    // They don't belong in a portable backup; strip them so exports stay small and share/copy reliably.
    const { snapshots, ...portable } = s;
    return { name: s.name.replace(/[^a-z0-9 _-]/gi, ""), json: JSON.stringify(portable, null, 1) };
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

/** The turn loop, run locally. Same signature the views already use.
 *  When opts.observe is set, the turn runs with no player action: the world and
 *  the player's own character act on their own, and you watch. */

/** Today's spend (USD) from telemetry — turns whose provider reported a cost, since local midnight. */
export function todaySpend(telemetry: { ts?: number; turn_cost?: number }[]): number {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const t0 = midnight.getTime();
  return telemetry.reduce((sum, t) => sum + ((t.ts ?? 0) >= t0 ? (t.turn_cost ?? 0) : 0), 0);
}

/** Governor verdict for the HUD and the turn loop. */
export function governorState(s: Pick<SaveState, "telemetry" | "model_settings">): { budget: number; spent: number; eco: boolean; over: boolean } {
  const budget = s.model_settings.daily_budget_usd ?? 0;
  const spent = todaySpend(s.telemetry);
  return { budget, spent, eco: budget > 0 && spent >= budget * 0.7, over: budget > 0 && spent >= budget };
}


/** TURN JOURNAL (write-ahead): iOS suspends web pages seconds after backgrounding; a mid-turn
 * death used to strand paid narrator prose with no bookkeeping and a hung UI. The journal
 * records the in-flight turn at two checkpoints (submission; prose-complete). On return,
 * resumePending() finishes the ledger from the exact point of death — only the cheap simulator
 * call re-fires; narrator tokens are never re-bought. */
interface TurnJournal { turn: number; action: string; mode: string; prose?: string; ts: number }
const journalKey = (id: string): string => "weft:journal:" + id;
function writeJournal(id: string, j: TurnJournal): void { try { localStorage.setItem(journalKey(id), JSON.stringify(j)); } catch { /* quota */ } }
function readJournal(id: string): TurnJournal | null { try { const r = localStorage.getItem(journalKey(id)); return r ? JSON.parse(r) as TurnJournal : null; } catch { return null; } }
function clearJournal(id: string): void { try { localStorage.removeItem(journalKey(id)); } catch { /* noop */ } }

export type PendingResolution =
  | { kind: "none" }
  | { kind: "restore_action"; action: string }
  | { kind: "completed"; save: ClientSave };

/** Finish a turn that died mid-flight. Call on app open / visibility resume. */
export async function resumePending(id: string, ev?: TurnEvents): Promise<PendingResolution> {
  const j = readJournal(id);
  if (!j) return { kind: "none" };
  const s = await need(id);
  if (s.world.current_turn !== j.turn || Date.now() - j.ts > 24 * 3600e3) { clearJournal(id); return { kind: "none" }; }
  if (!j.prose) {
    clearJournal(id);
    return { kind: "restore_action", action: j.action }; // partial prose is not a turn — words handed back
  }
  const gov = governorState(s);
  await runTurn(s, j.action, {
    onPhase: (p) => ev?.onPhase?.(p),
    onDelta: () => { /* prose already seen; history will render it */ },
    onMeta: (m) => ev?.onMeta?.(m as Record<string, unknown>),
  }, (j.mode as ActionMode) ?? "do", { eco: gov.eco, proseOverride: j.prose });
  await putSave(s);
  clearJournal(id);
  return { kind: "completed", save: clientView(s) };
}

export async function streamTurn(saveId: string, action: string, mode: ActionMode, ev: TurnEvents, opts?: { ground?: boolean; observe?: boolean; tightness?: number }): Promise<void> {
  let proseJournaled = false;
  try {
    const s = await need(saveId);
    const observe = !!opts?.observe;
    // In observe mode there is no player action; the engine is told to advance
    // the scene on its own, moving every actor (including the player's vessel).
    const act = observe
      ? "[OBSERVER] The player takes no action and only watches. Advance the scene on its own: let every present character — INCLUDING the player's own character — act, speak, and pursue their drives as they naturally would in this moment. Do not wait for the player. Move the story forward one concrete beat."
      : action;
    // COST GOVERNOR: past 70% of the daily budget the engine shifts to eco for the rest of the
    // day — lean prompts + tightened context — transparently, without touching saved settings.
    // Play is never blocked; over-budget just means eco + a visible HUD state.
    const gov = governorState(s);
    if (gov.eco) ev.onPhase?.("eco");
    writeJournal(saveId, { turn: s.world.current_turn, action: act, mode: observe ? "story" : mode, ts: Date.now() });
    let proseAcc = "";
    await runTurn(s, act, {
      onPhase: (p) => {
        if (!proseJournaled && p !== "pressure" && p !== "narrator" && p !== "eco" && proseAcc) {
          writeJournal(saveId, { turn: s.world.current_turn, action: act, mode: observe ? "story" : mode, prose: proseAcc, ts: Date.now() });
          proseJournaled = true;
        }
        ev.onPhase?.(p);
      },
      onDelta: (t) => { proseAcc += t; ev.onDelta?.(t); },
      onMeta: (m) => ev.onMeta?.(m as Record<string, unknown>),
    }, observe ? "story" : mode, { ...opts, eco: gov.eco });
    await putSave(s);
    // rolling checkpoint: every 25 turns, a full-state backup row — catastrophic loss is
    // bounded to <25 turns even with no export anywhere
    if (s.world.current_turn > 0 && s.world.current_turn % 25 === 0) { try { await putSideRow(s.id, "backup", s); } catch { /* best-effort */ } }
    clearJournal(saveId);
    ev.onDone?.(clientView(s));
  } catch (e: any) {
    // the words were handed back via onError; a stale journal would restore them a second
    // time on the next app open. Keep the journal only when paid prose is in it (resume path).
    if (!proseJournaled) clearJournal(saveId);
    ev.onError?.(e?.message ?? "turn failed");
  }
}

