/** The engine, in your browser. Mirrors the old server API exactly so the views
 *  are unchanged: every method returns the same shapes; streamTurn runs the turn
 *  loop locally with callbacks instead of Server-Sent Events. */
import type {
  SaveState, ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
} from "../engine/types";
import { DEFAULT_MODELS } from "../engine/types";
import { newSave, registerCharacter, rollback as doRollback, sanitize, uid, healTraits, addCanon, healCharacterTypes } from "../engine/state";
import { relevance, pruneEmptyMemories } from "../engine/memory";
import { buildPreset, PRESET_LIST } from "../engine/presets";
import { dischargeFiredClocks } from "../engine/pressure";
import { runTurn, syncPresence, resolvePlace, pruneParseArtifacts, repairStrandedCast, repairPlaceDescriptions, repairBibleLists, salvageProse } from "../engine/turn";
import { runInterlude, embodyCharacter, condenseForNewChapter, appendBackground } from "../engine/continuity";
import { runMontage } from "../engine/montage-run";
import { preflightDirection } from "../engine/montage";
import { seedDrive } from "../engine/drives";
import { resolvePromise } from "../engine/social";
import { fetchJob, getRelay, newJobId } from "../relay";
import { newAuthored, setback, findSameWant, retireLabel, crystallizedLabel, repairAuthoredHabitCounts } from "../engine/authored";
import { newBecoming, liveBecomings, CLAIM_MAX } from "../engine/becoming";
import { excuseElapsedToday, newBlock, placeForBlock, placeForRef, readSchedule } from "../engine/schedule";
import { forgeSchedule } from "../engine/scheduleforge";
import { TIGHTNESS_ANCHOR } from "../engine/physiology";
import { beautyOf, applyBeautyChange } from "../engine/desire";
import { stampFor, describeStamp, type SaveStamp } from "../engine/version";
import { completeSketch, pendingSketches, characterFromBrief } from "../engine/sketch";
import { completePlaceDescription, pendingPlaces } from "../engine/placedesc";
import { FORGE_SYSTEM, OPENING_SYSTEM, NEWSEASON_SYSTEM, MEMORY_CONDENSE_SYSTEM, INTERVIEW_SYSTEM, PERSONA_SYSTEM, buildPortraitPrompt, buildScenePrompt, buildPortraitDiffusion, buildSceneDiffusion, visualSignature, sceneReferencePortraits, portraitBodyPlan, stablePrefix, volatileDigest } from "../engine/prompts";
import { generateLocalImage, shrinkDataUrl } from "./diffusion";
import { getLocalImage, isLocalModel, localModelId } from "../config";
import { formatTime, parseTime } from "../engine/time";
import { compactMemoryDigest } from "../engine/memory";
import { groundMemoryContent, knownNameWhitelist } from "../engine/facts";
import { detectWorldPronoun, rolesFromRelation } from "../engine/coerce";
import { buildMessages, complete, generateImage, safeJson, isCancel } from "../llm";
import { getSave, putSave, deleteSave as dbDelete, listSaves as dbList, putSideRow, getSideRow, deleteSideRow } from "../store";
import { forgeCastVoices, refreshVoice, refreshStaleVoices } from "../engine/voiceforge";
import { stripScaffolding } from "../engine/echo";
import { retraitCast, retraitCharacter, type RetraitResult } from "../engine/traitforge";
import { refreshDrives } from "../engine/driveforge";
import { reconcileAge, summarizeAgeReport } from "../engine/age";

/** `edit_notice` is transient — never stored, set only on the value an edit hands straight back, so
 *  the view that made the change can tell the player what the engine did behind it. */
export type ClientSave = Omit<SaveState, "snapshots"> & { snapshot_turns: number[]; edit_notice?: string };
export type {
  ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
};
export type { ActionMode } from "../engine/types";
/** What the player should be shown for a turn — the reviser's repaired copy when there is one,
 *  the narrator's own words otherwise. The views go through this rather than reading
 *  `narrator_prose` directly, so a save written before the reviser existed renders unchanged. */
export { displayProse } from "../engine/reviser";
import type { ActionMode } from "../engine/types";

export interface PresetInfo { id: string; name: string; blurb: string; era_theme: string }
export interface SaveListing { id: string; name: string; updated_at: string; turn: number; world_name: string }

const clampNum = (v: any, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

function clientView(s: SaveState): ClientSave {
  const { snapshots, ...rest } = s;
  return { ...rest, snapshot_turns: snapshots.map((x) => x.turn) };
}

/** IMAGE SPEND — per-image billing, counted where it happens so the spend meter sees it.
 *  Real provider cost when reported; otherwise the gemini-2.5-flash-image list price (~$0.039). */
function trackImageSpend(s: SaveState, realCost?: number): void {
  const a = (s.aux_spend ??= { images: 0, montage_calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 });
  a.images++;
  a.cost += realCost ?? 0.039;
}
/** KEEP THE LAST FEW PICTURES, NOT ALL OF THEM.
 *
 *  Illustration was a button, so a long campaign held a handful of images and nobody had to think
 *  about it. Automatic illustration makes it one per turn, and each one is a couple of hundred
 *  kilobytes of base64 living INSIDE the save object — which store.ts writes on every api call and
 *  IndexedDB structured-clones on every write. Two hundred turns of that is a save that takes
 *  seconds to write and eventually takes the tab with it.
 *
 *  So older turns keep the record of having been illustrated and lose the bytes: the picture is
 *  gone from the scrollback, the turn is not. Only inline data URLs are dropped — an http URL from
 *  a cloud model costs nothing to keep. */
function forgetOldPictures(s: SaveState): void {
  const keep = s.model_settings.illustration_keep ?? 12;
  if (keep <= 0) return;
  let seen = 0;
  for (let i = s.history.length - 1; i >= 0; i--) {
    const h = s.history[i] as { illustration_url?: string; illustrated?: boolean };
    if (!h.illustration_url?.startsWith("data:")) continue;
    if (++seen <= keep) continue;
    h.illustration_url = undefined;
    h.illustrated = true;
  }
}

async function need(id: string): Promise<SaveState> {
  const s = await getSave(id);
  if (!s) throw new Error("save not found");
  // A MEMORY ENTRY WITH NOTHING IN IT ENDS A PLAYTHROUGH. One save reached turn 15 and stored a
  // belief that was only a confidence and a turn number — the sentence never arrived — and after
  // that every turn threw while building the memory digest, with no way to clear it from inside the
  // game. The write path refuses these now; this repairs the saves that already hold one, which is
  // the only route back for a save that cannot take another turn. Cheap, and a no-op for the ones
  // that are fine.
  const pruned = pruneEmptyMemories(s);
  // AND THE HABIT COUNTS THE BROKEN CREDIT PATH INVENTED. A want scored past "ground" on phantom
  // expressions stops being demanded, and nothing can bring it back from inside the game, because
  // the count only rises and the want can no longer be expressed to correct it. See authored.ts.
  const reset = repairAuthoredHabitCounts(s);
  if (reset) console.warn(`[authored] reset ${reset} phantom expression count${reset === 1 ? "" : "s"} on load — the wants are being asked for again`);
  if (pruned) console.warn(`[memory] removed ${pruned} empty memory entr${pruned === 1 ? "y" : "ies"} on load`);
  if (pruned || reset) await putSave(s);
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
      // THE OPENING GOT THE WEAK CLEANER. `stripScaffolding` removes tagged blocks, markdown
      // headers, and a leading "Okay, here's…" line; every other turn in the engine runs
      // `salvageProse`, which is the whole apparatus built for models that plan in the open. The
      // opening — the first page anyone reads, and the one turn a player cannot retry into
      // existence — was the only prose in the app that never saw it. One save's turn 0 is 865
      // words of a model talking to itself about word counts.
      turn: 0, kind: "opening", player_action: "", narrator_prose: salvageProse(stripScaffolding(out.text)).prose,
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
  forkNewSeason: async (id: string, direction?: string): Promise<ClientSave> => {
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
    // THE FORBIDDEN LIST HAS TO REACH THE CHAPTER FORGE. It never did — the digest carried the
    // world, the cast, canon and threads, and nothing about what the player has banned. So a player
    // who filled in `forbidden` precisely to get rid of a storyline, and then branched to be free of
    // it, got a new chapter whose opening scene, world bible and threads were built out of the
    // banned material, faithfully carried forward from the canon and threads the forge WAS shown.
    // The ban is the most load-bearing instruction in the bible and it was the one thing omitted.
    const bans = [s.world_bible.forbidden, ...(s.world_bible.forbidden_as_primary ?? [])].map((x) => String(x ?? "").trim()).filter(Boolean);
    // ── THE PLAYER DIRECTS THE CHAPTER ───────────────────────────────────────────────────────
    // Branching had no steering at all: the forge read the save and decided by itself what came
    // next. For an ordinary protagonist that lands somewhere reasonable. For a protagonist who has
    // become untouchable it reliably lands on the one antagonist left standing — the player's own
    // interior — and the chapter becomes six threads about emptiness, boredom, and whether anyone
    // really loves him. A player who can see that happening needs to be able to say "no, this
    // chapter is a war" and have it be a war.
    const brief = String(direction ?? "").trim().slice(0, 1200);
    const digest = [
      brief ? `DIRECTION FOR THE NEW CHAPTER — the player's brief, binding, outranking everything but the forbidden list:\n${brief}` : "",
      `WORLD: ${s.world_bible.name} — ${s.world_bible.era}. ${s.world_bible.political_situation}`,
      bans.length ? `FORBIDDEN IN THIS WORLD — BINDING ON EVERYTHING YOU WRITE, and on what you carry forward: ${bans.join(" | ")}. Anything in the material below that matches this is material the player has since banned. It does not go in the recap, the opening, the threads or the bible. The time skip is where it ends; write the chapter as being about something else.` : "",
      s.world_bible.narrator_direction ? `PLAYER'S STANDING DIRECTION — obey it, never rewrite or restate it: ${s.world_bible.narrator_direction}` : "",
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

    // ── THE MODEL ONLY GETS TO CHANGE WHAT IT WAS ASKED FOR ──────────────────
    // This spread accepted whatever `world_bible` the model returned, unbounded. The new-chapter
    // schema asks for five fields; a model that volunteered a sixth silently overwrote the player's
    // own setting with it, permanently.
    //
    // The field that did the damage is `tone`, because prompts.ts renders it as "GENRE — the
    // register this whole story is written in" at the top of every single narrator call. A model
    // distilling a playthrough wrote an editorial thesis about the protagonist into it — "the world
    // answers him with fear, never warmth; connection as impossible without transaction" — and that
    // became a standing order to the narrator for the rest of the game, explaining a great deal of
    // behavior the player had been reporting as broken. Nobody asked for it and nothing showed it.
    //
    // Whitelist. `tone`, `forbidden`, `god_mode`, `difficulty_profile`, `destination` and the rest
    // belong to the player and the Forge, and a chapter summary does not get to touch them.
    //
    // `narrator_direction` was on this list and should never have been. It is the same category as
    // `tone` — a standing instruction the narrator reads on every call — and the digest above even
    // labels it "PLAYER'S STANDING DIRECTION (honor it)" before inviting the model to replace it.
    // A player deleted theirs (it had acquired an editorial thesis about their character that
    // nobody asked for), branched the story, and got a freshly generated one back saying the same
    // thing. Clearing a field is a choice; a chapter summary does not get to overrule it.
    // `what_people_fear` came off for the same reason. It is a hand-editable register line — one
    // player's read "Hunger, illness, death, etc typical of medieval era issues" — and the chapter
    // forge replaced it with "The God-Duke's mood. That a gift has a hidden price. That the thing
    // worshipped at Thornwood might one day look their way": a verdict on the player installed as a
    // standing law of the world, and, in that save, the reason every gift the player made was met
    // with a demand for payment. What ordinary people fear does not need a model to restate it
    // across a time skip, and every time one did, it came back pointed at the protagonist.
    const CHAPTER_FIELDS = ["name", "political_situation", "start_date"] as const;
    const carried: Partial<WorldBible> = {};
    for (const f of CHAPTER_FIELDS) {
      const v = (g.world_bible ?? {})[f];
      if (typeof v !== "string" || !v.trim()) continue;
      // ── THE WORLD IS NOT ADDRESSED TO THE PLAYER ────────────────────────────────────────────
      // These two fields describe the world: what the factions did, what ordinary people worry
      // about at night. The prompt says so, and the prompt was not enough — one branch turned
      // "King Aldric's authority is collapsing inward, the northern barons have gone from
      // withholding tribute to raising their own levies" into "King Aldric's crown is a ruin held
      // together by fear of YOU", and turned a plain line about hunger and illness into "the
      // God-Duke's mood. That a gift has a hidden price." Both then feed the narrator every turn
      // as standing world-truth, which is how a whole world comes to be about the player's moral
      // condition. Second person here is the reliable tell, so enforce it in code: a field written
      // AT the player is not a description of the world, and the previous chapter's stands.
      if (f === "political_situation" && /\byou(r|rs|rself)?\b/i.test(v)) {
        console.warn(`[chapter] rejected ${f} — written at the player rather than about the world: ${v.slice(0, 120)}`);
        continue;
      }
      (carried as any)[f] = v.trim();
    }
    const dropped = Object.keys(g.world_bible ?? {}).filter((k) => !CHAPTER_FIELDS.includes(k as any));
    if (dropped.length) console.info(`[chapter] ignored unrequested world_bible fields: ${dropped.join(", ")}`);
    // keep most of the original bible, overlay only the updates that were actually asked for
    const bible: WorldBible = {
      ...s.world_bible,
      ...carried,
      name: carried.name || `${s.world_bible.name} — Next Chapter`,
    };
    const ns = newSave(bible.name, bible);
    // player carries forward COMPLETE: full memory, full traits, nothing dropped or sanitized.
    // A new chapter is a time-skip, not a personality wipe — who they became persists entirely.
    const playerCarry = condenseForNewChapter(player, s.memory["char_player"], s.traits["char_player"]);
    registerCharacter(ns, {
      ...player, character_id: "char_player",
      background: appendBackground(player?.background ?? "", g.player?.background_addition),
      drive: undefined, drive_queue: [],
    });
    ns.memory["char_player"] = { ...playerCarry.carried_memory, character_id: "char_player" }; // full memory intact
    ns.traits["char_player"] = playerCarry.carried_traits;                                       // full traits intact

    // ── THE WORLD KEEPS ITS GEOGRAPHY ──────────────────────────────────────────
    // This used to mint ONE place and drop the entire gazetteer. The Forge refuses to build a world
    // with fewer than six locations — "a world with three places is a world where the narrator has
    // nowhere legal to move anyone, so it invents 'the kitchen doorway' and the resolver strands
    // whoever went there" — and then a new chapter reduced that world to a single room. Every place
    // the story had built, every founding location, gone in one call.
    //
    // Carry them: the Forge's own spine first, then anywhere a surviving cast member was standing,
    // then whatever else the world had, newest first. Names and descriptions come across intact, so
    // the map, the distances and every "go there" the player already knows still work.
    const survivorNames = new Set((g.cast ?? []).filter((c: any) => c?.still_present !== false && c?.name).map((c: any) => String(c.name).toLowerCase()));
    const heldBySurvivor = new Set<string>();
    for (const c of Object.values(s.characters)) {
      if (survivorNames.has(c.name.toLowerCase()) && c.location) heldBySurvivor.add(c.location);
    }
    const oldPlaces = Object.values(s.world.places).filter((p) => p.id !== "loc_offscene");
    const ranked = [
      ...oldPlaces.filter((p) => p.founding),
      ...oldPlaces.filter((p) => !p.founding && heldBySurvivor.has(p.id)),
      ...oldPlaces.filter((p) => !p.founding && !heldBySurvivor.has(p.id)).reverse(),
    ];
    // The holding pen has to exist before anyone can be put in it — newSave() starts with no places
    // at all, and a character pointed at a location that isn't there is a character nothing can find.
    ns.world.places["loc_offscene"] ??= { id: "loc_offscene", name: "elsewhere", description_facts: "", contains: [] };
    const carriedByOldId = new Map<string, string>();   // old place id → new place id
    for (const p of ranked.slice(0, 14)) {
      const nid = uid("loc");
      ns.world.places[nid] = {
        id: nid, name: p.name, description_facts: p.description_facts ?? "",
        contains: [], founding: true, population: p.population,
      };
      carriedByOldId.set(p.id, nid);
    }
    const findByName = (name: string | undefined): string | undefined => {
      const k = String(name ?? "").toLowerCase().trim();
      if (!k) return undefined;
      return Object.values(ns.world.places).find((p) => p.name.toLowerCase().trim() === k)?.id;
    };
    // The opening's location: an existing place by name when the model named one, otherwise new.
    let lid = findByName(g.starting_location_name);
    if (!lid) {
      lid = uid("loc");
      ns.world.places[lid] = { id: lid, name: g.starting_location_name || "a new place", description_facts: "", contains: [], founding: true };
    }
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
        background: appendBackground(prev?.background ?? "", c.background_addition),
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
        // WHERE THEY ARE. Every carried character used to be placed at `lid` — the player's own
        // opening location — so syncPresence put the ENTIRE surviving cast in the room on turn 1,
        // five people standing in a hall the chapter had just introduced. A time skip scatters
        // people; it does not assemble them. Take the model's `where` when it names a real place,
        // else the place they were standing in last chapter if it carried over, else elsewhere.
        // The player's room is never the fallback — being with the player has to be stated.
        location: findByName(c.where)
          ?? (prev?.location ? carriedByOldId.get(prev.location) : undefined)
          ?? "loc_offscene",
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
  /**
   * CLEAR THE LOG — draw a line the models read from, without deleting the story.
   *
   * `history` is the transcript the player scrolls AND the recent-story context nearly every pass
   * slices a tail off, so the only existing lever for cutting the context was refreshContext, which
   * truncates history to the last beat and takes the readable story with it (and runs a memory
   * condensation call per character on the way). This is the cheap, instant, reversible half: set a
   * boundary, keep everything.
   *
   * The last beat stays on the models' side of the line on purpose — a narrator with no immediately
   * preceding turn writes the next one blind, which is a worse problem than a long context.
   * Nothing else is touched: memories, edges, threads, consequences, drives and the world are what
   * they were. Pass `restore` to lift the line again.
   */
  clearLog: async (id: string, opts?: { restore?: boolean }): Promise<ClientSave> => {
    const s = await need(id);
    if (opts?.restore) {
      s.world.context_from_turn = undefined;
    } else {
      const last = s.history.at(-1)?.turn ?? s.world.current_turn;
      s.world.context_from_turn = Math.max(1, last);
    }
    // the chatlog anchor was built over turns that are now on the far side of the line
    s.context_anchor = undefined;
    await putSave(s);
    return clientView(s);
  },
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
    t.retcons = [...(t.retcons ?? []), { text: note, turn: t.world.current_turn, kind: "veto" as const }].slice(-12);
    // purge state the struck material left behind: non-central characters whose names the player named,
    // and any canon line that substantially RESTATES the struck text. (This used to drop a canon line
    // for sharing any single 6+ letter word — "pleasure" deleted the player's own biology law, which
    // is how a veto misfired as a correction erased the rule from the world. Now it takes real overlap.)
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
    if (words.length) t.world.canon = t.world.canon.filter((line) => relevance(line, note) < 0.5);
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

  /** THE CORRECTION. The mirror of strike, for the opposite failure: the narrator BROKE a rule that
   *  is true (a law of body, culture, or physics it ignored or explained away). The text is affirmed
   *  as world law — recorded as a correction (rendered to the narrator as supreme truth, never to be
   *  litigated) and canonized so it rides the digest like any other world fact. Nothing is rolled
   *  back, nothing is purged: the fiction so far stands; the law simply binds from here on. */
  correct: async (id: string, text: string): Promise<ClientSave> => {
    const s = await need(id);
    const note = String(text || "").trim().slice(0, 240);
    if (!note) throw new Error("say what is true");
    s.retcons = [...(s.retcons ?? []), { text: note, turn: s.world.current_turn, kind: "correction" as const }].slice(-12);
    addCanon(s, note);
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
    // Same reasoning for the reviser's copy: the prose is byte-identical, so the repair still holds.
    // The replay runs with proseOverride and deliberately does not re-buy the pass, so without this
    // a re-read would quietly hand the player back the unrepaired sentences.
    if (entry.narrator_prose_read) {
      const fresh = restored.history.find((h) => h.turn === t);
      if (fresh && !fresh.narrator_prose_read) fresh.narrator_prose_read = entry.narrator_prose_read;
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
    // AGE IS STORED TWICE — as the number on the card, and as prose in every description, memory and
    // rumor that ever stated it. Editing the number alone left the second copy standing, and prose
    // outshouts a field: the profile said 20 and the whole cast went on saying fifteen. See engine/age.
    const notices: string[] = [];
    for (const [cid, p] of Object.entries(patch.characters ?? {})) {
      if (!s.characters[cid]) continue;
      const wasAge = s.characters[cid].age;
      s.characters[cid] = { ...s.characters[cid], ...p, character_id: cid };
      const nowAge = s.characters[cid].age;
      if (typeof wasAge === "number" && typeof nowAge === "number" && wasAge !== nowAge) {
        const rep = reconcileAge(s, cid, wasAge, nowAge);
        const line = summarizeAgeReport(rep, s.characters[cid].name);
        if (line) notices.push(line);
      }
    }
    if (Array.isArray(patch.canon)) s.world.canon = patch.canon.map(String).filter(Boolean).slice(0, 20);
    for (const [cid, core] of Object.entries(patch.memory_core ?? {})) {
      if (s.memory[cid] && Array.isArray(core)) s.memory[cid].core = core.filter(Boolean).slice(0, 8);
    }
    await putSave(s);
    return { ...clientView(s), edit_notice: notices.join(" ") || undefined };
  },

  /** Deterministic warnings for a montage direction. Zero tokens, zero writes. */
  // MIGRATE CORE TRAITS. Re-expresses adjective-form traits ("Proud and honorable") as the
  // constitutional dispositions underneath them. A translation, not a re-roll: the same person,
  // described one level deeper, with the originals preserved in core_traits_legacy.
  retraitCast: async (id: string, force = false): Promise<{ save: ClientSave; changed: RetraitResult[] }> => {
    const s = await need(id);
    const changed = await retraitCast(s, s.model_settings.forge_model, force);
    if (changed.length) await putSave(s);
    return { save: clientView(s), changed };
  },

  retraitOne: async (id: string, char_id: string, force = true): Promise<ClientSave> => {
    const s = await need(id);
    const r = await retraitCharacter(s, char_id, s.model_settings.forge_model, force);
    if (!r) throw new Error("Couldn't re-express those traits — try again.");
    await putSave(s);
    return clientView(s);
  },

  // Re-read one character's script cold. The refresher sees the card as it stands now — core traits
  // plus what play has made them — and never sees a line of prose, so it cannot inherit the drift.
  // example_lines are REPLACED: keeping the old ones would feed the drifted voice back in as an
  // exemplar, which is the loop this exists to break.
  refreshVoice: async (id: string, char_id: string): Promise<ClientSave> => {
    const s = await need(id);
    const ok = await refreshVoice(s, char_id, s.model_settings.forge_model);
    if (!ok) throw new Error("Couldn't re-derive that voice — try again.");
    await putSave(s);
    return clientView(s);
  },

  // ── PLACES, BY HAND ──────────────────────────────────────────────────────────
  // The Forge names ten places and the resolver only ever mints more from narrator prose,
  // so anything the PLAYER builds — a house, a camp, a compound — has no way to become a
  // location. It gets described, lived in, changed, and then quietly isn't anywhere, because
  // presence is derived from co-location and there is no location to be co-located at.
  // Hand-made places are marked `founding` so the place-cap GC can never evict them: a
  // location the player deliberately created is by definition not junk.

  addPlace: async (id: string, name: string, description = ""): Promise<ClientSave> => {
    const s = await need(id);
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("A place needs a name.");
    const existing = Object.values(s.world.places).find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) throw new Error(`"${existing.name}" already exists.`);
    const pid = uid("loc");
    s.world.places[pid] = { id: pid, name: clean, description_facts: description.trim(), contains: [], founding: true };
    await putSave(s);
    return clientView(s);
  },

  /**
   * RETIRE A THREAD the player is done with.
   *
   * A thread is read by the narrator every single turn as a live question the story is carrying,
   * and until now there was no way to close one except the raw JSON editor. That is how a player
   * who deleted every mention of the supernatural from their world bible kept getting it anyway:
   * the material had long since moved into threads — "a shadow-creature approaches the northern
   * road", tension 8 — where editing the bible could not reach it, and the engine dutifully fed it
   * back on every call. Retiring marks the thread resolved rather than deleting it, so the history
   * stays honest about what the story once was.
   */
  retireThread: async (id: string, thread_id: string): Promise<ClientSave> => {
    const s = await need(id);
    const t = s.world.threads.find((x) => x.id === thread_id);
    if (!t) throw new Error("No such thread.");
    t.status = "resolved";
    t.turn_resolved = s.world.current_turn;
    // The pressure system re-opens a thread it still sees momentum behind, so drain the tension
    // too — a resolved thread at tension 8 is an invitation to revive it.
    t.tension = 0;
    s.updated_at = new Date().toISOString();
    await putSave(s);
    return clientView(s);
  },

  /**
   * SETTLE A PROMISE BY HAND.
   *
   * The ledger is written by the bookkeeper and closed by the bookkeeper, and it does not always
   * close. Two ways it stalls, both from one save:
   *
   *   t5   "Lucia will walk Rabi into the cookshop and stay as his guide in exchange for the gold."
   *        She walked him into the cookshop on turn 6. Twenty turns later it is still open — the
   *        deliverable was done and nobody filed it. This is a MISS, and the second half of the
   *        sentence is why: a compound promise ("walk him in AND stay as his guide") has no single
   *        moment that satisfies all of it, so no turn ever looks like the one that closed it.
   *
   *   t8   "Payment for lodgings through the Ides and past them at five asses a night."
   *        This is not a promise, it is a standing arrangement. There is no event that can ever be
   *        the keeping of it, so it can never leave the ledger by any automatic route at all.
   *
   * Either way the player is looking at a job they consider done, sitting in their journal as owed,
   * and being fed to the bookkeeper every turn as an open commitment. So: a manual close.
   *
   * `kept` and `broken` go through resolvePromise, which is the same path the bookkeeper uses — the
   * edge moves, the pattern count updates, the other person forms a memory of it. `retired` does
   * none of that and is the one for the standing arrangement and the promise the story has simply
   * moved past: it leaves the ledger and changes nothing between anybody. Nothing is deleted; the
   * record keeps what was sworn and how it ended.
   */
  settlePromise: async (id: string, promise_id: string, outcome: "kept" | "broken" | "retired"): Promise<{ save: ClientSave; log: string }> => {
    const s = await need(id);
    const p = (s.world.promises ?? []).find((x) => x.id === promise_id);
    if (!p) throw new Error("No such promise.");
    if (p.status !== "open") throw new Error(`That promise is already ${p.status}.`);
    let log: string;
    if (outcome === "retired") {
      p.status = "retired";
      log = `Retired: "${p.text}" — closed by hand, with no consequence between anyone.`;
    } else {
      log = resolvePromise(s, p, outcome, s.world.current_turn) || `Marked ${outcome}: "${p.text}".`;
    }
    p.settled_turn = s.world.current_turn;
    p.settled_by_hand = true;
    s.updated_at = new Date().toISOString();
    await putSave(s);
    return { save: clientView(s), log };
  },

  /**
   * FIRE A CLOCK NOW.
   *
   * A clock does not *do* anything when it fills. `dischargeFiredClocks` converts it into a PENDING
   * CONSEQUENCE, and beat selection checks due consequences before cooldowns and grace — that is
   * what forces the promised thing into a scene at full scale. So firing by hand means filling the
   * clock and letting the engine's own discharge run, never setting `status` and hoping.
   *
   * Setting `status: "fired"` by hand is in fact the one edit that PREVENTS it firing: the discharge
   * guard requires `running`, so a hand-fired clock is skipped, no consequence is ever queued, and
   * the clock goes quiet having promised something that never arrives. This exists so nobody has to
   * know that.
   */
  fireClock: async (id: string, clock_id: string): Promise<{ save: ClientSave; log: string[] }> => {
    const s = await need(id);
    const c = s.world.clocks.find((x) => x.id === clock_id);
    if (!c) throw new Error("No such clock.");
    if (c.status === "fired") throw new Error("That clock has already fired.");
    c.filled = c.segments;
    c.status = "running";                       // discharge only picks up running clocks
    c.last_advanced_time = s.world.current_time;
    const log = dischargeFiredClocks(s, s.world.current_turn);
    // Land it on the NEXT turn rather than turn+1, so "fire now" means the next thing that happens.
    for (const x of s.world.consequences) {
      if (x.id === `clockfire_${c.id}` && x.status === "pending") x.fire_turn = s.world.current_turn;
    }
    s.updated_at = new Date().toISOString();
    await putSave(s);
    return { save: clientView(s), log };
  },

  editPlace: async (id: string, place_id: string, patch: { name?: string; identity?: string; description_facts?: string; population?: { scale: number; who: string } }): Promise<ClientSave> => {
    const s = await need(id);
    const p = s.world.places[place_id];
    if (!p) throw new Error("No such place.");
    if (patch.name !== undefined && patch.name.trim()) p.name = patch.name.trim().slice(0, 60);
    // The fixed half. Only ever written here — the simulator is told it is not its to write, and
    // nothing in the turn loop touches it. See Place.identity.
    if (patch.identity !== undefined) p.identity = patch.identity.trim().slice(0, 200);
    if (patch.description_facts !== undefined) p.description_facts = patch.description_facts.trim();
    // Explicit population beats inference, including an explicit 0 for "this really is deserted".
    if (patch.population !== undefined) {
      p.population = { scale: Math.max(0, Math.round(patch.population.scale || 0)), who: String(patch.population.who ?? "").slice(0, 200) };
    }
    p.founding = true;                       // touched by hand = protected from the cap
    await putSave(s);
    return clientView(s);
  },

  deletePlace: async (id: string, place_id: string): Promise<ClientSave> => {
    const s = await need(id);
    if (place_id === s.world.player_location) throw new Error("You're standing there.");
    const occupied = Object.values(s.characters).filter((c: any) => c.location === place_id).map((c: any) => c.name);
    if (occupied.length) throw new Error(`${occupied.join(", ")} ${occupied.length === 1 ? "is" : "are"} there — move them first.`);
    delete s.world.places[place_id];
    await putSave(s);
    return clientView(s);
  },

  // Force a character (or the player) into a place, overriding whatever the bookkeeper inferred.
  // This is the manual counterpart to the travelling-companion rule: when the engine strands
  // someone, you put them back yourself instead of editing raw JSON.
  setLocation: async (id: string, char_id: string, place_id: string): Promise<ClientSave> => {
    const s = await need(id);
    if (!s.world.places[place_id]) throw new Error("No such place.");
    if (char_id === "char_player") s.world.player_location = place_id;
    const c = s.characters[char_id];
    if (c) (c as any).location = place_id;
    syncPresence(s);                          // presence is derived, so recompute it now
    await putSave(s);
    return clientView(s);
  },

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
    const wasAge = s.characters[char_id].age;
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
    // same reconciliation as the profile editor: the number and the prose copies of it move together
    const nowAge = s.characters[char_id].age;
    let notice = "";
    if (typeof wasAge === "number" && typeof nowAge === "number" && wasAge !== nowAge) {
      notice = summarizeAgeReport(reconcileAge(s, char_id, wasAge, nowAge), s.characters[char_id].name);
    }
    await putSave(s);
    return { ...clientView(s), edit_notice: notice || undefined };
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

  /**
   * THE WHOLE SAVE, for the Inspector. `getWorldRaw` below exposes one slice — bible, threads,
   * clocks, places, canon, edges — and characters, memory, condition and traits were not reachable
   * from the editor at all. Snapshots are stripped: they are device-local rollback copies of the
   * entire save and would multiply the payload by their count.
   */
  getSaveRaw: async (id: string): Promise<any> => {
    const s = await need(id);
    const { snapshots, ...rest } = s as any;
    return JSON.parse(JSON.stringify(rest));
  },

  /**
   * Write a set of edits back, each addressed by path. One round trip, one save, then the same
   * healing every other write path gets — types repaired, presence re-derived from co-location — so
   * a hand edit cannot leave the save in a shape the engine will not read.
   *
   * `undefined` as a value means DELETE: dropping a key or splicing an array entry is half of what
   * the raw editor was being used for.
   */
  applySavePatches: async (id: string, patches: { path: (string | number)[]; value: unknown }[]): Promise<ClientSave> => {
    const s = await need(id);
    const agesBefore = new Map(Object.entries(s.characters).map(([cid, c]) => [cid, c.age]));
    for (const { path, value } of patches) {
      if (!Array.isArray(path) || !path.length) continue;
      if (path[0] === "id" || path[0] === "snapshots") continue;   // identity and rollback are not editable
      let cur: any = s;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (cur[k] === null || typeof cur[k] !== "object") cur[k] = typeof path[i + 1] === "number" ? [] : {};
        cur = cur[k];
      }
      const last = path[path.length - 1];
      if (value === undefined) {
        if (Array.isArray(cur) && typeof last === "number") cur.splice(last, 1);
        else delete cur[last as any];
      } else cur[last as any] = value;
    }
    healCharacterTypes(s);
    sanitize(s);
    syncPresence(s);
    // an age edited by hand in the raw editor is the same edit as one made in the profile
    const notices: string[] = [];
    for (const [cid, c] of Object.entries(s.characters)) {
      const was = agesBefore.get(cid);
      if (typeof was === "number" && typeof c.age === "number" && was !== c.age) {
        const line = summarizeAgeReport(reconcileAge(s, cid, was, c.age), c.name);
        if (line) notices.push(line);
      }
    }
    s.updated_at = new Date().toISOString();
    await putSave(s);
    return { ...clientView(s), edit_notice: notices.join(" ") || undefined };
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

  /** REPAIR — clean up ledger damage in place, without an export/import round trip. Drops cast
   *  members that are parse debris, and sends home anyone the bookkeeper parked in a scene the
   *  prose never wrote them into. Returns what it did, so the player can see it. */
  repairSave: async (id: string): Promise<{ save: ClientSave; log: string[] }> => {
    const s = await need(id);
    const log = [
      ...pruneParseArtifacts(s).map((n) => `Removed "${n}" — a fragment of someone's description, not a person.`),
      ...repairStrandedCast(s),
      ...repairPlaceDescriptions(s),
      ...repairBibleLists(s),
    ];
    if (log.length) { s.updated_at = new Date().toISOString(); await putSave(s); }
    return { save: clientView(s), log };
  },

  /** SKETCH COMPLETION — finish the records of people who entered from prose and were never
   *  written down. One small call per hollow character, run after the turn commits, non-blocking.
   *  Only ever fills EMPTY fields; anything the story established stays. See engine/sketch.ts. */
  completeSketches: async (id: string, ids?: string[]): Promise<ClientSave> => {
    const s = await need(id);
    const targets = (ids && ids.length ? ids : pendingSketches(s)).filter((cid) => s.characters[cid]).slice(0, 4);
    let wrote = false;
    for (const cid of targets) {
      try { wrote = (await completeSketch(s, cid, s.model_settings.forge_model, s.model_settings.fallback_model)) || wrote; }
      catch { /* leave the sketch; it will be retried after the next turn */ }
    }
    if (wrote) { s.updated_at = new Date().toISOString(); await putSave(s); }
    return clientView(s);
  },

  /** ADD A PERSON, FROM A SENTENCE.
   *
   *  The story is meant to introduce people and often does not — a name turns up in the prose with
   *  no record behind it, and the player has no way to say "there is a woman who runs the ferry and
   *  she and Greta do not speak". This is that way. The brief is binding; everything around it is
   *  built from the world, the cast, the open situations and the places, so the person arrives
   *  already attached to the story rather than standing in it waiting to be introduced.
   *
   *  Full fidelity on purpose: this goes through the same record schema and the same merge rules as
   *  every other character, so somebody the player asked for is not a second-class citizen of the
   *  cast. See engine/sketch.ts. */
  addCharacter: async (id: string, brief: string): Promise<{ save: ClientSave; added: { name: string; where: string; tie: string } | null }> => {
    const s = await need(id);
    const r = await characterFromBrief(s, brief, s.model_settings.forge_model, s.model_settings.fallback_model);
    if (!r) return { save: clientView(s), added: null };
    syncPresence(s);                                   // co-location decides the scene; recompute it
    s.updated_at = new Date().toISOString();
    await putSave(s);
    // A voice, so they can speak the moment they are in a room. Best-effort: a person with a full
    // record and no voice card still plays; a failed forge call must not lose the character.
    try { await refreshVoice(s, r.id, s.model_settings.forge_model); await putSave(s); } catch { /* they can still talk */ }
    return { save: clientView(s), added: { name: r.name, where: r.where, tie: r.tie } };
  },

  /** PLACE DESCRIPTIONS — write the physical record for places the story has played in but never
   *  written down, and rewrite the ones flagged as out of date. The bookkeeper is asked for these
   *  in-turn; this is the backstop for what it misses. One small call per place, after the turn. */
  describePlaces: async (id: string, ids?: string[]): Promise<ClientSave> => {
    const s = await need(id);
    const targets = (ids && ids.length ? ids : pendingPlaces(s)).filter((pid) => s.world.places[pid]).slice(0, 3);
    let wrote = false;
    for (const pid of targets) {
      try { wrote = (await completePlaceDescription(s, pid, s.model_settings.forge_model, s.model_settings.fallback_model)) || wrote; }
      catch { /* leave it; retried after the next turn */ }
    }
    if (wrote) { s.updated_at = new Date().toISOString(); await putSave(s); }
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

  /** THAT NEVER HAPPENED — remove a memory or a belief from somebody's head.
   *
   *  The engine writes what it INFERS, not only what it was shown, and until now nothing could take
   *  any of it back. One save had a character remember unwrapping a bandage and seeing "the wound
   *  beneath" when the record held no injury at all; another filed the player's own furious
   *  out-of-character complaint — "What the hell are you talking about about doing a field wrap?" —
   *  as something she remembered him saying. Both then fed reflection, which turns memories into
   *  beliefs, which are permanent. Every wrong inference compounded and none could be corrected.
   *
   *  Constraining what may be written is worth doing and has been done in several places, but it
   *  will never be sufficient — the engine is a machine for making inferences about a story, and
   *  some of them will be wrong. What was missing is the other half: the player is the ground truth
   *  about their own game, and needed a way to say so.
   *
   *  Matched on exact content because that is what the UI has in hand, and deleting the wrong
   *  memory would be a worse bug than the one this fixes. */
  forget: async (id: string, char_id: string, what: { episodic?: string; belief?: string }): Promise<ClientSave> => {
    const s = await need(id);
    const mem = s.memory[char_id];
    if (!mem) throw new Error("no memory for that character");
    if (what.episodic) {
      const before = mem.episodic.length;
      mem.episodic = mem.episodic.filter((m) => m.content !== what.episodic && m.full_content !== what.episodic);
      if (mem.episodic.length === before) throw new Error("that memory is already gone");
    }
    if (what.belief) {
      const before = mem.beliefs.length;
      mem.beliefs = mem.beliefs.filter((b) => b.content !== what.belief);
      if (mem.beliefs.length === before) throw new Error("that belief is already gone");
    }
    await putSave(s);
    return clientView(s);
  },

  /** AUTHOR A STANDING WANT onto somebody — the injector. See engine/authored.ts for the whole
   *  argument; briefly, this is the tool that was missing between "do nothing" and "rewrite who
   *  they are", and its absence is why core_traits was being used to record things that had never
   *  happened.
   *
   *  Tracking comes along with it. An untracked character is explicitly one the engine spends no
   *  upkeep on — no drive regeneration, no offstage presence — so a want written onto somebody
   *  nobody is following would sit on the card and never once act. */
  /** A FACT THIS WORLD DOES NOT HOLD YET.
   *
   *  The player writes what will be true and how many turns the world has to get there. It is not
   *  granted: each turn the world has to move toward it through its own causes, and only a turn
   *  that actually moved spends one off the clock — so a claim the story cannot find a way into
   *  simply takes longer, rather than arriving on schedule in a world that never changed. When the
   *  clock runs out the claim enters world.canon, where the existing CANON OVERRIDES YOUR DEFAULTS
   *  block binds every line after it.
   *
   *  Passing null for `claim` removes it. An index removes or replaces that one; without an index a
   *  claim that matches an existing one replaces it, so rewording is an edit rather than a second
   *  copy of the same future. See engine/becoming.ts. */
  setBecoming: async (id: string, claim: string | null, opts: { turns?: number; index?: number; paused?: boolean } = {}): Promise<ClientSave> => {
    const s = await need(id);
    const list = (s.becomings ??= []);
    const at = opts.index;
    if (!claim?.trim()) {
      if (typeof at === "number" && at >= 0 && at < list.length) list.splice(at, 1);
      else s.becomings = [];
      await putSave(s);
      return clientView(s);
    }
    const norm = (t: string) => t.trim().toLowerCase();
    const same = typeof at === "number" ? -1 : list.findIndex((b) => norm(b.claim) === norm(claim));
    const slot = typeof at === "number" ? at : same;
    const prev = slot >= 0 ? list[slot] : undefined;
    const made = newBecoming(claim, opts.turns ?? prev?.turns ?? 10, s.world.current_turn);
    if (prev) {
      // Rewording a claim keeps the ground the world has already covered; changing the length of
      // the clock does not reset it either, it just moves where the finish line is.
      made.id = prev.id;
      made.added_turn = prev.added_turn;
      made.moved = prev.moved;
      made.repudiations = prev.repudiations;
      made.last_move = prev.last_move;
      made.remaining = Math.max(0, Math.min(made.turns, made.turns - prev.moved));
    }
    if (opts.paused !== undefined) made.paused = opts.paused;
    if (slot >= 0 && slot < list.length) list[slot] = made;
    else list.push(made);
    await putSave(s);
    return clientView(s);
  },

  setAuthored: async (id: string, char_id: string, want: null | {
    goal: string; approach?: string; because?: string;
    rate?: "slow" | "steady" | "fast"; stage?: number; crystallize?: boolean; paused?: boolean;
    inhabit_turns?: number;
    /** Which existing want to replace. Omit to ADD a new one — a person can be building more than
     *  one habit at a time, and this used to be a single field so every new want silently replaced
     *  the last. Pass null as `want` with an index to remove just that one. */
    index?: number;
  }, index?: number): Promise<ClientSave> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    if (char_id === "char_player") throw new Error("author wants onto other people, not yourself");
    const list = (c.authored ??= []);
    const at = want?.index ?? index;

    if (!want || !want.goal.trim()) {
      if (typeof at === "number" && at >= 0 && at < list.length) list.splice(at, 1);
      else c.authored = [];
      await putSave(s);
      return clientView(s);
    }
    // REWRITING A WANT EDITS IT. Without this, a player whose want has not been showing up types it
    // again a little stronger and gets a second one — same act, two entries, two clipped copies on
    // the character card, and the habit ladder splitting its count across two keys. See sameWant.
    const same = typeof at === "number" ? -1 : findSameWant(list, want.goal);
    if (same >= 0) {
      const old = list[same];
      if (old.crystallized_turn) retireLabel(s, char_id, crystallizedLabel(old));
    }
    const slot = typeof at === "number" ? at : same;
    const prev = slot >= 0 ? list[slot] : undefined;
    const made = newAuthored(want.goal, s.world.current_turn, {
      ...want,
      stage: want.stage ?? prev?.stage ?? 0,
      acted: want.stage !== undefined ? undefined : prev?.acted,
      turns_live: want.stage !== undefined ? undefined : prev?.turns_live,
      added_turn: prev?.added_turn,   // rewording a want does not restart it
    });
    if (prev?.crystallized_turn && want.stage === undefined) made.crystallized_turn = prev.crystallized_turn;
    if (slot >= 0 && slot < list.length) list[slot] = made;
    else list.push(made);
    c.tracked = true;
    await putSave(s);
    return clientView(s);
  },

  /** THE WEEK SOMEBODY ALREADY HAS. Write, revise, or delete one standing commitment. See
   *  engine/schedule.ts for what the engine then does with it — briefly: they know it is coming,
   *  they go there on their own, and a scene that holds them past it costs them something.
   *
   *  Tracking comes along with it, for the same reason authoring a want does: an untracked
   *  character is one the engine spends no upkeep on, and a week nobody runs is a note on a card. */
  setScheduleBlock: async (id: string, char_id: string, block: null | {
    what: string; where: string; why?: string; how?: string; travel_min?: number;
    start?: number | string; end?: number | string;
    days?: "daily" | "weekdays" | "weekends" | number[];
    rigidity?: "optional" | "expected" | "mandatory";
    stakes?: string; paused?: boolean;
  }, index?: number): Promise<ClientSave> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    if (char_id === "char_player") throw new Error("the player's day is the player's to spend");
    const sched = (c.schedule ??= { blocks: [] });

    if (!block || !block.what.trim() || !block.where.trim()) {
      if (typeof index === "number" && index >= 0 && index < sched.blocks.length) sched.blocks.splice(index, 1);
      else sched.blocks = [];
      if (!sched.blocks.length && !sched.home && !sched.note) delete c.schedule;
      await putSave(s);
      return clientView(s);
    }
    const prev = typeof index === "number" ? sched.blocks[index] : undefined;
    // Rewording a block does not wipe what it has already done — a shift somebody missed on Tuesday
    // stays missed after the player fixes a typo in its name.
    const made = newBlock({ ...prev, ...block, what: block.what, where: block.where, id: prev?.id });
    // A commitment written after its hour has passed starts tomorrow — see excuseElapsedToday.
    if (made.excused_day === undefined) excuseElapsedToday(s, made, c.location);
    if (typeof index === "number" && index >= 0 && index < sched.blocks.length) sched.blocks[index] = made;
    else sched.blocks.push(made);
    // Mint the place now rather than on the first tick, so the player can see where they have just
    // sent this person and the gazetteer's one gate has folded a room into its building already.
    placeForBlock(s, made);
    c.tracked = true;
    await putSave(s);
    return clientView(s);
  },

  /** Where they end up when nothing claims them, and the one line about the week the blocks cannot
   *  hold. Either may be cleared by passing an empty string. */
  setScheduleFrame: async (id: string, char_id: string, frame: { home?: string; note?: string }): Promise<ClientSave> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    const sched = (c.schedule ??= { blocks: [] });
    if (frame.home !== undefined) sched.home = frame.home.trim().slice(0, 80) || undefined;
    if (frame.note !== undefined) sched.note = frame.note.trim().slice(0, 200) || undefined;
    if (sched.home) placeForRef(s, sched.home);
    if (!sched.blocks.length && !sched.home && !sched.note) delete c.schedule;
    await putSave(s);
    return clientView(s);
  },

  /** LET THEM OFF, for today only. The honest button for "she doesn't have to go in, she's with me"
   *  — it is a decision the player made rather than a shift that quietly stopped existing, so the
   *  block stays on the card and comes round again tomorrow. */
  excuseSchedule: async (id: string, char_id: string, index: number): Promise<ClientSave> => {
    const s = await need(id);
    const b = s.characters[char_id]?.schedule?.blocks?.[index];
    if (!b) throw new Error("no such commitment");
    b.excused_day = parseTime(s.world.current_time).day;
    await putSave(s);
    return clientView(s);
  },

  /** READ THE WEEK OFF WHO THEY ALREADY ARE — one cheap model call. Returns null when the model
   *  gave nothing usable, and the character is left exactly as they were. See scheduleforge.ts. */
  forgeSchedule: async (id: string, char_id: string): Promise<{ save: ClientSave; blocks: number } | null> => {
    const s = await need(id);
    const r = await forgeSchedule(s, char_id, s.model_settings.forge_model);
    if (!r) return null;
    for (const b of s.characters[char_id]?.schedule?.blocks ?? []) {
      placeForBlock(s, b);
      excuseElapsedToday(s, b, s.characters[char_id]?.location);
    }
    await putSave(s);
    return { save: clientView(s), blocks: r.blocks };
  },

  /** What this person's week says about right now — for the Cast drawer, which should show the
   *  same reading the narrator is given rather than a second implementation of it. */
  scheduleNow: async (id: string, char_id: string) => {
    const s = await need(id);
    const r = readSchedule(s, char_id);
    const name = (ref?: string) => (ref && s.world.places[ref]?.name) || ref || "";
    return {
      current: r.current ? { what: r.current.block.what, until: r.current.block.end } : null,
      pending: r.pending ? { what: r.pending.block.what, lateBy: Math.round(r.pending.lateBy), where: name(r.pending.block.where) } : null,
      next: r.next ? { what: r.next.block.what, leaveIn: Math.round(r.next.leaveIn), day: r.next.day } : null,
      free: r.free,
    };
  },

  /** Knock an authored want back a rung — the character was faced down and it cost them. */
  authoredSetback: async (id: string, char_id: string, index = 0): Promise<ClientSave> => {
    const s = await need(id);
    const a = s.characters[char_id]?.authored?.[index];
    if (!a) throw new Error("no authored want");
    setback(a);
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
    if (isLocalModel(s.model_settings.image_model)) {
      // THE SAMPLER UNDER THE DESK. Different prompt dialect, different plumbing, no bill — but the
      // same job, and the same body-plan stamp at the end of it.
      const ep = getLocalImage();
      const d = buildPortraitDiffusion(s, char_id, ep?.prompt_style ?? "natural");
      const img = await generateLocalImage({
        prompt: d.prompt, negative: d.negative, seed: d.seed, aspect: "portrait",
        checkpoint: localModelId(s.model_settings.image_model),
      });
      c.portrait_url = img.url;
      c.portrait_seed = img.seed;
      trackImageSpend(s, 0);
    } else {
      const img = await generateImage(buildPortraitPrompt(s, char_id), s.model_settings.image_model, [], "portrait");
      c.portrait_url = img.url;
      trackImageSpend(s, img.cost);
    }
    // LOCK THE WORDS THAT DREW THIS FACE. Written on whichever path made the portrait, because the
    // scene path may well be the other one — a cloud portrait with local scenes is an ordinary
    // setup, and it is exactly the case where the scenes need to know what the face was made from.
    // Never overwritten: a signature that moves is a character who stops being themselves.
    if (!c.visual_signature?.trim()) c.visual_signature = visualSignature(s, char_id);
    // stamp the body plan this portrait was made under, so scene illustrations never attach a
    // stale person-shaped portrait as a reference for a non-human character (see prompts.ts)
    c.portrait_plan = portraitBodyPlan(s, c).humanoid ? "humanoid" : "nonhuman";
    await putSave(s);
    return { url: c.portrait_url, save: clientView(s) };
  },

  illustrate: async (id: string, turn: number, signal?: AbortSignal): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const entry = [...s.history].reverse().find((h) => h.turn === turn) ?? s.history[s.history.length - 1];
    if (!entry) throw new Error("no turn to illustrate");
    // feed the portraits of characters in this scene so they stay visually consistent —
    // but only portraits whose body plan still matches (a stale woman-portrait attached for a
    // foot-person outvotes the whole prompt; see sceneReferencePortraits).
    // The cast is the paragraph's OWN present list when it has one — illustrating an old turn
    // after the scene ended must render that scene's cast, not whoever is around today.
    const castIds = [...new Set(["char_player", ...(entry.present ?? s.world.present)])];
    const refs = sceneReferencePortraits(s, castIds);
    if (isLocalModel(s.model_settings.image_model)) {
      const ep = getLocalImage();
      // Asking again for a turn that already has a picture means "another take", so the seed lock
      // that keeps a scene looking like itself is broken on purpose for that one call.
      const d = buildSceneDiffusion(s, entry.summary, entry.present, ep?.prompt_style ?? "natural", {
        lockSeed: ep?.lock_seed !== false,
        vary: entry.illustration_url ? 1 + Math.floor(Math.random() * 100000) : 0,
      });
      const img = await generateLocalImage({
        prompt: d.prompt, negative: d.negative, seed: d.seed, aspect: "landscape", refs, signal,
        checkpoint: localModelId(s.model_settings.image_model),
      });
      entry.illustration_url = img.url;
      trackImageSpend(s, 0);
    } else {
      const img = await generateImage(buildScenePrompt(s, entry.summary, entry.present), s.model_settings.image_model, refs, "landscape");
      // Re-encoded on the way in for the same reason the local path is (see forgetOldPictures): a
      // returned image is a megabyte or two of base64 that lives inside the save from here on, and
      // a 1280px JPEG of the same frame is a fifth of that at the size it is ever displayed.
      entry.illustration_url = await shrinkDataUrl(img.url, 1280);
      trackImageSpend(s, img.cost);
    }
    forgetOldPictures(s);
    await putSave(s);
    return { url: entry.illustration_url, save: clientView(s) };
  },

  forge: async (seed: string, model = DEFAULT_MODELS.forge_model, destinationTurns?: number, ground?: boolean, seedThreads?: { title: string; description?: string; tension?: number }[], tone?: string): Promise<ClientSave> => {
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
await forgeCastVoices(g.npcs ?? [], g.world_bible, model);
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
      // The fixed half, written once at the Forge and never again. Falls back to the opening
      // sentence of the description for a model that skipped the field — that is where a
      // description says what a place IS before it says what state it is in.
      const ident = String(p.identity ?? "").trim()
        || (String(p.description_facts ?? "").trim().split(/(?<=[.!?])\s+/)[0] ?? "").trim();
      s.world.places[lid] = { id: lid, name: p.name, identity: ident.slice(0, 200), description_facts: p.description_facts ?? "", contains: [], founding: true, population: p.population && typeof p.population.scale === "number" ? { scale: Math.max(0, Math.round(p.population.scale)), who: String(p.population.who ?? "").slice(0, 200) } : undefined };
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
      // relation_to_player is a sentence and it names the standing fact: "his wife of six years"
      // contains "wife". Until now it went into notes, which is prose nobody parses, and the edge
      // was born with no roles — see coerce.rolesFromRelation.
      const seededRoles = rolesFromRelation(n.relation_to_player);
      s.world.edges.push({ from: cid, to: "char_player", warmth: Math.max(-100, Math.min(100, n.warmth ?? 0)), trust: Math.max(-100, Math.min(100, n.trust ?? 0)), power: 0, notes: n.relation_to_player ?? "", roles: seededRoles.length ? seededRoles : undefined, updated_turn: 1 });
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
      s.world.threads.push({ id: uid("thr"), title: String(t.title ?? "").trim(), status: "active", description: t.description?.trim() ?? "", turn_started: 1, tension: clampNum(t.tension ?? 3, 1, 10) });
    }
    // DISTANCES: what the engine uses to answer "could word have got there and back by now?"
    // Without a table the check has no basis and silently passes, which is how a mother three days'
    // ride west heard about the player and answered inside one afternoon.
    for (const dd of (g as any).distances ?? []) {
      if (!dd?.from || !dd?.to) continue;
      const mins = clampNum(Number(dd.minutes) || 0, 0, 60 * 24 * 90);
      if (mins > 0) (s.world.distances ??= []).push({ from: String(dd.from).trim(), to: String(dd.to).trim(), minutes: mins });
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
    // PROVENANCE. An export used to carry no build identity, so a save attached to a bug report was
    // undatable — no way to tell a live bug from one already fixed two builds ago except by reading
    // the shape of the data and guessing. `_weft` goes first in the object so it is the first thing
    // visible when the file is opened.
    const stamped = { _weft: stampFor(s.world?.current_turn ?? 0), ...portable };
    return { name: s.name.replace(/[^a-z0-9 _-]/gi, ""), json: JSON.stringify(stamped, null, 1) };
  },

  /** What produced a save file, read back from its stamp. Safe on unstamped (pre-provenance) saves. */
  describeSave: (data: any): string => describeStamp(data?._weft),

  importSave: async (data: any): Promise<ClientSave> => {
    if (!data?.world_bible || !data?.world || !data?.characters) throw new Error("not a Weaver save file");
    console.info(`[import] ${describeStamp(data?._weft)}`);
    const { _weft, ...rest } = data;
    const s = sanitize(rest as SaveState);
    s.id = uid("save");
    s.updated_at = new Date().toISOString();
    s.imported_from = _weft;   // keep the provenance of what was imported, for bug reports
    s.snapshots ??= []; s.telemetry ??= []; s.pressure_trace ??= []; s.history ??= [];
    // Saves written before the footer parser was fixed carry cast members made out of fragments of
    // somebody's description. Drop the ones nothing is attached to; see pruneParseArtifacts.
    const junk = pruneParseArtifacts(s);
    if (junk.length) console.info(`[import] removed ${junk.length} parse artifact(s) from the cast: ${junk.join(", ")}`);
    repairPlaceDescriptions(s);
    const stranded = repairStrandedCast(s);
    if (stranded.length) console.info(`[import] ${stranded.length} stranded character(s) sent home: ${stranded.join(" ")}`);
    await putSave(s);
    return clientView(s);
  },
};

export interface TurnEvents {
  onPhase?: (phase: string) => void;
  onDelta?: (text: string) => void;
  onMeta?: (meta: Record<string, unknown>) => void;
  onRead?: (reads: { faculty: string; line: string }[]) => void;
  onDone?: (save: ClientSave) => void;
  onError?: (message: string) => void;
  /** The player pressed stop. Not an error: nothing was written, and their words come back. */
  onCancel?: () => void;
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
interface TurnJournal { turn: number; action: string; mode: string; prose?: string; partial?: boolean; ts: number;
  /** The relay job this turn's narration was handed to, if any. Written BEFORE the request goes
   *  out — it is the only way a cold-booted app can find a completion it already paid for. */
  job?: string }

/** Prose below this is a fragment, not a scene: hand the words back and let them re-run rather than
 *  committing a two-sentence turn to history. Above it, there is a beat worth keeping. */
export const PARTIAL_MIN = 400;
const journalKey = (id: string): string => "weft:journal:" + id;
function writeJournal(id: string, j: TurnJournal): void { try { localStorage.setItem(journalKey(id), JSON.stringify(j)); } catch { /* quota */ } }
function readJournal(id: string): TurnJournal | null { try { const r = localStorage.getItem(journalKey(id)); return r ? JSON.parse(r) as TurnJournal : null; } catch { return null; } }
function clearJournal(id: string): void { try { localStorage.removeItem(journalKey(id)); } catch { /* noop */ } }

export type PendingResolution =
  | { kind: "none" }
  | { kind: "restore_action"; action: string }
  | { kind: "completed"; save: ClientSave; cutShort?: boolean };

/** Finish a turn that died mid-flight. Call on app open / visibility resume. */
export async function resumePending(id: string, ev?: TurnEvents): Promise<PendingResolution> {
  const j = readJournal(id);
  if (!j) return { kind: "none" };
  const s = await need(id);
  if (s.world.current_turn !== j.turn || Date.now() - j.ts > 24 * 3600e3) { clearJournal(id); return { kind: "none" }; }
  // A FRAGMENT IS NOT A SCENE, BUT MOST OF ONE IS.
  //
  // This used to hand the words back whenever the prose was incomplete, and on iOS that was the
  // common case rather than the rare one: the narrator phase is the long one, a home-screen web app
  // is terminated seconds after you leave it, so the kill almost always lands mid-narration. The
  // player got their action back and paid for the tokens anyway.
  //
  // Now the stream is journaled as it arrives. If enough of it landed to be a beat, the turn is
  // finished from what there is, trimmed back to the last complete paragraph so it ends on a whole
  // sentence rather than mid-word. Short of that it is still words-back — a three-sentence turn in
  // permanent history is worse than re-running one.
  // ── THE RELAY STILL HAS IT ────────────────────────────────────────────────────────────────
  // This is the case the whole relay exists for. The app was killed during narration — on iOS,
  // seconds after you switched to something else — but the request was never being made by this
  // device, so it kept running. Ask for it. A finished completion here means the turn is whole
  // rather than truncated, and nothing was paid for twice.
  let relayed: string | null = null;
  const relay = j.job ? getRelay() : null;
  if (relay && j.job) {
    try {
      const r = await fetchJob(relay, j.job);
      if (r.status === "done" && r.text.trim()) relayed = r.text;
      // STILL WRITING. Leave everything exactly as it is and come back — the journal is the only
      // record of which job this turn belongs to, so clearing it here would strand a completion
      // that is still being paid for, and the fallthrough below would commit a truncated local
      // copy of a turn that is about to arrive whole.
      else if (r.status === "running") return { kind: "none" };
    } catch { /* relay unreachable — fall back to whatever the local journal caught */ }
  }

  const prose = relayed ?? (j.prose && j.partial ? trimToParagraph(j.prose) : j.prose);
  if (!prose || (!relayed && j.partial && prose.length < PARTIAL_MIN)) {
    clearJournal(id);
    return { kind: "restore_action", action: j.action };
  }
  const gov = governorState(s);
  await runTurn(s, j.action, {
    onPhase: (p) => ev?.onPhase?.(p),
    onDelta: () => { /* prose already seen; history will render it */ },
    onMeta: (m) => ev?.onMeta?.(m as Record<string, unknown>),
  }, (j.mode as ActionMode) ?? "do", { eco: gov.eco, proseOverride: prose });
  await putSave(s);
  clearJournal(id);
  return { kind: "completed", save: clientView(s), cutShort: !!j.partial && !relayed };
}

/** Back up to the last paragraph break so a killed stream ends on a finished thought. Falls back to
 *  the last sentence end, then to the raw text — a turn cut mid-word is still better than no turn,
 *  and the caller has already decided there is enough here to keep. */
export function trimToParagraph(prose: string): string {
  const para = prose.lastIndexOf("\n\n");
  if (para > PARTIAL_MIN) return prose.slice(0, para).trim();
  const m = /[\s\S]*[.!?]["”]?/.exec(prose);
  return (m?.[0] ?? prose).trim();
}

export async function streamTurn(saveId: string, action: string, mode: ActionMode, ev: TurnEvents, opts?: { ground?: boolean; observe?: boolean; tightness?: number; signal?: AbortSignal }): Promise<void> {
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
    // The job id exists before the call does, so the journal can point at it even if the app dies
    // during the very first second of narration.
    const job = getRelay() ? newJobId() : undefined;
    writeJournal(saveId, { turn: s.world.current_turn, action: act, mode: observe ? "story" : mode, ts: Date.now(), job });
    let proseAcc = "";
    let lastJournaled = 0;
    await runTurn(s, act, {
      onPhase: (p) => {
        if (!proseJournaled && p !== "pressure" && p !== "narrator" && p !== "eco" && proseAcc) {
          writeJournal(saveId, { turn: s.world.current_turn, action: act, mode: observe ? "story" : mode, prose: proseAcc, ts: Date.now(), job });
          proseJournaled = true;
        }
        ev.onPhase?.(p);
      },
      // The stream is checkpointed as it arrives, not only when it finishes. Narration is the long
      // phase and iOS terminates a backgrounded home-screen app during it, so this is the window
      // where turns were being lost outright. Throttled by size rather than by time: localStorage
      // writes are synchronous and this fires per token.
      onDelta: (t) => {
        proseAcc += t;
        if (!proseJournaled && proseAcc.length - lastJournaled >= 1200) {
          lastJournaled = proseAcc.length;
          writeJournal(saveId, { turn: s.world.current_turn, action: act, mode: observe ? "story" : mode, prose: proseAcc, partial: true, ts: Date.now(), job });
        }
        ev.onDelta?.(t);
      },
      onMeta: (m) => ev.onMeta?.(m as Record<string, unknown>),
      onRead: (rs) => ev.onRead?.(rs),
    }, observe ? "story" : mode, { ...opts, eco: gov.eco, signal: opts?.signal, jobId: job });
    // FRESH READER. After the turn, re-derive the voice of anyone in the scene whose card hasn't
    // been re-read in VOICE_REFRESH_INTERVAL turns. Runs on the card only — it never sees a line of
    // narrator prose — so it can't inherit the drift it exists to undo. Best-effort and silent:
    // a failed refresh just leaves the existing voice in place.
    // Anyone with no want, or a want that only exists in relation to the player, gets a real one —
    // derived from their own life, in a pass that never sees the player or the transcript.
    // SIDE BY SIDE, NOT ONE AFTER THE OTHER. These two are independent — one gives a want to
    // somebody who has none, the other re-reads a voice off the card — and they were awaited in
    // sequence on the forge model, which on a real save is Opus. Two Opus round trips end to end,
    // after the narrator and the bookkeeper have already finished, while the player watches
    // "recording changes". Neither reads what the other writes; running them together costs one
    // wait instead of two.
    const [drives, voices] = await Promise.allSettled([
      refreshDrives(s, s.model_settings.forge_model),
      refreshStaleVoices(s, s.model_settings.forge_model),
    ]);
    if (drives.status === "fulfilled" && drives.value.length) console.info(`[drives] ${drives.value.join(" | ")}`);
    if (voices.status === "fulfilled" && voices.value.length) console.info(`[voice] re-read from the card: ${voices.value.join(", ")}`);
    await putSave(s);
    // rolling checkpoint: every 25 turns, a full-state backup row — catastrophic loss is
    // bounded to <25 turns even with no export anywhere
    if (s.world.current_turn > 0 && s.world.current_turn % 25 === 0) { try { await putSideRow(s.id, "backup", s); } catch { /* best-effort */ } }
    clearJournal(saveId);
    ev.onDone?.(clientView(s));
  } catch (e: any) {
    // STOPPED ON PURPOSE. The turn threw before applyDiff, so `s` — a throwaway copy read from
    // storage at the top — is simply discarded unwritten. The journal MUST go too: it exists to
    // finish a turn the app died in the middle of, and left behind it would resurrect on the next
    // visibility change the very turn the player just cancelled.
    if (isCancel(e)) { clearJournal(saveId); ev.onCancel?.(); return; }
    // the words were handed back via onError; a stale journal would restore them a second
    // time on the next app open. Keep the journal only when paid prose is in it (resume path).
    if (!proseJournaled) clearJournal(saveId);
    ev.onError?.(e?.message ?? "turn failed");
  }
}
