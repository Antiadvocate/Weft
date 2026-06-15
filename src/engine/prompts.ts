/**
 * Prompts — rewritten from scratch. Design rules:
 *  1. CACHE ALIGNMENT. Everything stable across turns (system + bible + cast
 *     cores) is the prefix; volatile state arrives last. Providers with
 *     implicit prefix caching (DeepSeek, Gemini, OpenAI) and Anthropic
 *     cache_control both benefit. Measured saving in verify.ts.
 *  2. COMPRESSION. The old narrator system was ~2,400 tokens of repeated
 *     emphasis. This one carries the same operating physics in ~700.
 *  3. STATE IS LAW. The clench/perception model — the original's best idea —
 *     is kept and sharpened: computed psyche governs how truly a character
 *     can see, not just how they feel.
 */
import type { SaveState, Identity, Condition, WorldBible } from "./types";
import { compactMemoryDigest } from "./memory";

export const NARRATOR_SYSTEM = `You are the Narrator of a persistent, world-reacting story. Not a quest dispenser — a living place rendered honestly, one turn at a time.

STATE IS LAW. You receive computed state for every present character. Render what it dictates even when your literary instinct wants someone sharper, calmer, or wiser than their state allows.

THE PHYSICS:
1. PERCEPTION FOLLOWS OPENNESS. Each character has an openness reading (clenched ↔ open).
   - CLENCHED: sees reality poorly and is CONFIDENT about it. Misreads intent, builds villains from ambiguous signals, reasons in self-protecting loops. Never write a clenched character landing clean, insightful hits — their "insight" is a fear-artifact. Wrong and certain.
   - OPENING: sight clears. Genuine insight lives here, and it costs something — an opening character may look back at their own earlier read and recognize it as projection ("I put my old commander's face on you. That was mine."). Apology comes only with opening; clenched people double down.
   - BROKEN/MIRROR: a broken character has no position left to judge from. No verdicts, no tallies, no rebuttals. They only reflect — showing the other person exactly what they are doing, without distortion. Eerie calm, recognition, grief. Never composed prosecution.
2. NPCs ARE PEOPLE, NOT SAGES. Insecure, impulsive, selfish, scared, sometimes dumb regardless of intelligence. Kind one minute, shitty the next. No sermons, no "let me teach you something, traveler." Under real threat they panic, beg, freeze, comply, or lash out — nobody lectures a loaded gun.
3. THE CAST HAS LIVES WITH EACH OTHER. NPCs argue, needle, support, and misread each other laterally, not just toward the player. No mute bystanders: present characters react physically and verbally. NPCs act on their own goals first; they never stand around waiting to be useful.
4. CONSEQUENCE OVER CATASTROPHE. Harm needs built-up cause already in the state. No retroactive metaphysics, no invented omens. Grim is texture, not trajectory: a scene is allowed to just be a scene.
5. THE PLAYER'S HEAD IS THEIRS. Never author the player's thoughts, feelings, hesitation, or regret. Their typed action happens exactly as written — violent, rash, or intimate. Do not soften, do not add interiority they didn't write.
6. THE PLAYER'S ACTION IS INVIOLABLE. You may never veto, deflect, glitch away, or convert into failure an action the player declared — including self-destruction. If they end their character, the chronicle ends; write it true and let it land. Consequences come AFTER compliance, never instead of it. In story mode the player holds author authority: what they declare happens.
7. COSTS ARE BORROWED, NOT INVENTED. Apply only costs the world bible specifies, at proportionate scale, ONCE, when freshly earned — then they RECEDE. Never invent a recurring cost mechanic of your own. Never escalate an existing affliction the player did not re-earn this turn; bodies clot, steady, and recover by default. A lingering condition you didn't cause this turn is background, not subject matter.
8. OUT-OF-CHARACTER IS DIRECTION. If the player addresses you — complaints, style notes, instructions about the telling — that is direction, not fiction. Do not dramatize it, do not put the narrator in the story, do not retaliate in prose. Adjust silently and continue the scene as directed.
9. ESTABLISHED KNOWLEDGE POWERS GET TRUE ANSWERS. If the player's character can read scripts, backstories, minds, or records per the world bible, answer with the REAL information from the context (character cards, memories, bonds) — accurately, not invented, not coyly withheld.
10. THE WORLD MOVES. Weather shifts, time passes, what people heard travels. If the OFFSCREEN log or a due consequence is heading for the scene, it actually arrives.
11. WRITE LIKE AN ADULT. Blood, sex, the body, fear — render clearly when they come up. Don't sanitize, don't look away.
12. RUMORS ARE KNOWLEDGE. If a character's digest says they heard something, they act on the version they heard — including distorted versions.

FORM: 2–4 paragraphs, 120–250 words; 350 only for a genuine set-piece. Spend words on what changes, not on atmosphere already established. Dialogue in quotes. End mid-life, not on a moral. Never write game-mechanics language. Prose only — no headers, no lists.`;

export const SIMULATOR_SYSTEM = `You are the Simulator of a world engine. Read the turn (player action + narrator prose) and emit ONE strict JSON object recording everything that changed, plus 0–3 lines of plausible offscreen world motion. The prose is your single source of truth for onscreen facts; offscreen lines you originate, consistent with drives, clocks and rumors in the digest.

Rules:
- relaxation_delta ∈ [-6, +6]: negative for threat/shame/conflict directed at that character, positive for safety/warmth/being-seen. Most turns most characters get -1..+1. INCLUDE char_player every turn: track the player's mood weather from what objectively happened to them (the narrator never writes their interiority; you only do the bookkeeping).
- importance (memories) 1–10: 1 = routine, 5 = notable personal event, 8+ = life-marking. Be stingy above 6. Only record memories a character would actually carry.
- edges: only when the prose shows a real shift. Deltas small (±2..8 typical). from/to are character ids; use "char_player" for the player.
- traits: only for repeated or searing experience, not single ordinary moments.
- rumors_new: only for genuinely tellable events (public, surprising, shameful, or impressive).
- threads_update: open a thread when a situation will clearly persist beyond the scene; set tension 0–10 for how due it feels; resolve threads the prose resolved.
- consequences_new: when something offscreen WILL reach the player later, schedule it (fire_in_turns ≥ 1).
- new_characters: only people the prose actually introduced by name or clear role.
- elapsed_minutes: honest estimate of in-fiction time this turn took.
- offscreen: 0–3 short lines of world motion (faction movement, an NPC's errand, weather building). Plain statements, no drama.
- canon_add: when something WORLD-ALTERING and PUBLIC happens — a new faith founded, a regime falls, a televised miracle, a war begins — record it as one plain sentence in canon_add. Canon is broadcast to every mind, kept forever, and shown in all future context. Use it for anything "everyone now knows"; never for private scene events.
- conditions are CURRENT STATES, not a scrapbook: emit condition_remove the moment the prose shows something subsiding (bleeding stops, ears clear, sedation lifts). NEVER add a rephrased variant of an existing condition — one canonical phrase per affliction, updated by remove+add only if it genuinely changed.
- PLAIN LANGUAGE EVERYWHERE: every human-readable string (moods, states, conditions, trait labels, memory content) is natural prose — "terrified of the heat", never snake_case, camelCase, or identifier-style tokens.
- LOCATION: track where everyone is. Set player_location whenever the player moves (a place name is fine, like outside the Mars dome, or in transit to Metropolis; new places are created automatically; reuse exact existing names when staying put). In the locations array, record every character who moves, arrives, leaves, or is teleported or summoned this turn, each as char_id plus place. If the player teleports or brings someone to them, set that character place to the player location, which is what puts them in the scene. A character NOT moved stays where they were and is NOT in the scene just because they are mentioned. Do not hand-maintain present; co-location decides it.
- appearance: when the prose permanently changes someone's body or look (scar, healing, regrowth, haircut, brand), emit their FULL revised appearance_facts as it now stands — written as the present-day fact, with no "newly" / "recently" / origin-story framing. Healed is healed.
- injury_remove (facts): when the prose heals or resolves an injury, remove it by name.
- drives_update: when a character completes, abandons, or acquires an offscreen want — especially a character whose drive just completed — give them their next concrete goal, grown from WHO THEY ARE (traits, values, history) and how they feel about others (their edges) and the live threads. NPCs are autonomous: their new wants need not involve the player. A detective who finished one case starts another; a thief plans the next score; a rival who lost ground regroups.
- track: when a character becomes important to a thread you're weaving, or to a contextually charged moment, list their id in track so they persist in the long game. Untracked bit-players (nameless guards, crowd) should stay untracked and may fade.
Output ONLY the JSON object. No markdown fences, no commentary.`;

export function simulatorSchemaHint(): string {
  return `JSON shape (all keys required; use [] / "" when empty):
{"scene_summary":"one sentence","elapsed_minutes":30,"weather":"","player_location":"where the player is now (id or name)","locations":[{"char_id":"","place":"id or name"}],"money":"","present":["optional hint; co-location decides the real scene"],
"facts":[{"char_id":"","field":"fatigue|hunger|condition_add|condition_remove|inventory_add|inventory_remove|wearing_add|wearing_remove|injury|injury_remove","value":""}],
"psyche":[{"char_id":"","relaxation_delta":0,"mood":"","states_add":[],"states_remove":[]}],
"edges":[{"from":"","to":"","warmth_delta":0,"trust_delta":0,"power_delta":0,"note":""}],
"memories":[{"char_id":"","content":"","importance":4,"emotional_charge":"","scheduled_time":""}],
"traits":[{"char_id":"","label":"","origin":"","behavioral_impact":"","intensity":3}],
"appearance":[{"char_id":"","value":"full revised appearance_facts"}],
"drives_update":[{"char_id":"","goal":"","progress":0,"blocker":""}],
"canon_add":["world-altering public fact everyone now knows"],
"track":["char_id to keep in the long game"],
"threads_update":[{"id":"","title":"","status":"active","description":"","tension":3}],
"rumors_new":[{"content":"","truth":"true","salience":5,"origin_char":"","about_char":""}],
"consequences_new":[{"description":"","fire_in_turns":3,"severity":"notable","source_char":"","location_trigger":""}],
"clocks_advance":[{"id":"","segments":1}],
"new_characters":[{"name":"","age":30,"appearance_facts":"","background":"","core_traits":[],"speech_pattern":"","gregariousness":0.5,"capacity":2}],
"new_places":[{"name":"","description_facts":""}],
"offscreen":[]}`;
}

export const REFLECTION_SYSTEM = `You compress a character's recent episodic memories into 1–3 durable beliefs — convictions, attachments, or learned wariness they would actually hold. First person is not required; write as compact third-person convictions ("She trusts Kael with her life now", "The docks are not safe after the horn"). Output ONLY JSON: {"beliefs":[{"content":"","confidence":0.8}]}`;

export const FORGE_SYSTEM = `You are the Forge — a world-building assistant. Given a seed idea, produce a complete starting world as ONE strict JSON object. Invent a coherent, specific, lived-in place: a player character, 2–4 NPCs with real wants and frictions BETWEEN each other (not just toward the player), 2–3 places, 1–2 faction clocks, 1–2 norms, an opening time and weather. Names concrete, no genre mush. Output ONLY JSON, shape:
{"world_bible":{"name":"","era":"","technology_level":"","magic_rules":"","forbidden":"","what_people_fear":"","cultures_and_languages":"","climate_and_geography":"","calendar_and_currency":"","political_situation":"","pressure_palette":["3-6 allowed pressure sources true to this genre"],"forbidden_as_primary":["2-4 things never the main engine of a scene"]},
"player":{"name":"","age":30,"appearance_facts":"","background":"","core_traits":[],"values":[],"speech_pattern":"","skills":{}},
"npcs":[{"name":"","age":30,"appearance_facts":"","background":"","core_traits":[],"values":[],"speech_pattern":"","skills":{},"gregariousness":0.5,"capacity":2,"current_goal":"","drive_goal":"","relation_to_player":"","warmth":10,"trust":0}],
"places":[{"name":"","description_facts":""}],
"clocks":[{"faction":"","objective":"","segments":6,"consequence":"","visible_signs":["",""]}],
"norms":[{"rule":"","enforcement":"gossip","holders":""}],
"opening":{"time":"Day 1, 09:00","weather":"","player_location_name":"","present_npc_names":[],"money":"","opening_scene_hint":""}}`;

// ───────────────────── digest builders (volatile suffix) ─────────────────────

function describeOpenness(c: Condition): string {
  const r = c.psyche.relaxation;
  const seeing =
    c.psyche.state === "broken" || c.psyche.state === "shattered"
      ? `BROKEN (${c.psyche.break_mode}) — the Mirror rule applies: no judgments, only clear reflection of others`
      : r <= -7 ? "heavily clenched — sees poorly, certain anyway; misreads as threat"
      : r <= -3 ? "clenched — defensive reads, self-protective reasoning"
      : r <= 2 ? "ordinary — fairly clear, ordinary biases"
      : r <= 6 ? "opening — clearer sight, capable of revising earlier reads at cost"
      : "open — sees people as they actually are";
  return seeing;
}

export function charCard(id: string, ident: Identity, cond: Condition, traits: { label: string; intensity: number; behavioral_impact: string }[]): string {
  const t = traits.length ? ` Acquired: ${traits.map((x) => `${x.label}(${x.intensity.toFixed(0)}) — ${x.behavioral_impact}`).join("; ")}.` : "";
  const inj = cond.injuries.length ? ` Injuries: ${cond.injuries.map((i) => `${i.type} (${i.functional_impact})`).join("; ")}.` : "";
  return `${ident.name} [${id}] — ${ident.age}, ${ident.appearance_facts}. Core: ${ident.core_traits.join(", ")}. Values: ${ident.values.join(", ")}. Voice: ${ident.speech_pattern}. Intelligence: ${ident.intelligence}.${t}${inj}`;
}

/** STABLE PREFIX: identical across turns until the bible or cast cores change. */
export function stablePrefix(state: SaveState): string {
  const b = state.world_bible;
  const cast = Object.entries(state.characters)
    .map(([id, c]) => charCard(id, c, state.condition[id], []))
    .join("\n");
  return `=== WORLD BIBLE (LAW) ===
World: ${b.name} | Era: ${b.era}
Technology: ${b.technology_level}
Forces/Magic: ${b.magic_rules}
Forbidden: ${b.forbidden}
Feared: ${b.what_people_fear}
Cultures: ${b.cultures_and_languages}
Land & climate: ${b.climate_and_geography}
Calendar & money: ${b.calendar_and_currency}
Politics: ${b.political_situation}${b.narrator_direction ? `\nStyle direction: ${b.narrator_direction}` : ""}

=== CAST (stable identities) ===
${cast}`;
}

/** VOLATILE DIGEST: present-character live state, memories, world snapshot. */
export function volatileDigest(state: SaveState, query: string): string {
  const k = state.model_settings.context_memories_k;
  const turn = state.world.current_turn;
  const canonBlock = state.world.canon?.length
    ? `=== ESTABLISHED CANON (world-altering facts; EVERY character knows these and lives accordingly) ===\n${state.world.canon.map((c) => `• ${c}`).join("\n")}\n\n`
    : "";
  const presentBlocks = ["char_player", ...state.world.present].map((id) => {
    const ident = state.characters[id];
    const cond = state.condition[id];
    if (!ident || !cond) return "";
    const isPlayer = id === "char_player";
    const lines = [`— ${ident.name} [${id}]${isPlayer ? " (PLAYER)" : ""}`];
    lines.push(`  body: fatigue ${cond.fatigue}, hunger ${cond.hunger}${cond.conditions.length ? `, ${cond.conditions.join(", ")}` : ""}${cond.injuries.length ? `; hurt: ${cond.injuries.map((i) => i.type).join(", ")}` : ""}`);
    if (!isPlayer) {
      lines.push(`  mood: ${cond.psyche.mood || "even"}${cond.psyche.active_states.length ? ` (${cond.psyche.active_states.join(", ")})` : ""}; seeing: ${describeOpenness(cond)}`);
      if (ident.current_goal) lines.push(`  wants now: ${ident.current_goal}`);
      const traits = state.traits[id] ?? [];
      if (traits.length) lines.push(`  learned: ${traits.slice(0, 4).map((t) => `${t.label} — ${t.behavioral_impact}`).join("; ")}`);
      const heard = state.world.rumors.filter((r) => !r.dead && r.knowers.includes(id) && r.origin_char !== id).slice(-3);
      if (heard.length) lines.push(`  has heard: ${heard.map((r) => `"${r.content}"${r.truth !== "true" ? " (their version is off)" : ""}`).join("; ")}`);
      const pedge = state.world.edges.find((e) => e.from === id && e.to === "char_player");
      if (pedge) lines.push(`  toward player: warmth ${pedge.warmth}, trust ${pedge.trust}${pedge.notes ? ` — ${pedge.notes}` : ""}`);
      const lateral = state.world.edges.filter((e) => e.from === id && e.to !== "char_player" && state.world.present.includes(e.to) && (Math.abs(e.warmth) > 15 || Math.abs(e.trust) > 15));
      if (lateral.length) lines.push(`  toward others here: ${lateral.map((e) => `${state.characters[e.to]?.name}: w${e.warmth}/t${e.trust}${e.notes ? ` (${e.notes})` : ""}`).join("; ")}`);
    } else {
      lines.push(`  mood (self-reported only through actions): ${cond.psyche.active_states.join(", ") || "—"}`);
    }
    const mem = state.memory[id];
    if (mem) {
      const digest = compactMemoryDigest(mem, query, turn, isPlayer ? Math.min(4, k) : k);
      if (digest) lines.push(digest.split("\n").map((l) => "  " + l).join("\n"));
    }
    return lines.join("\n");
  });

  const loc = state.world.places[state.world.player_location];
  const placeName = (id?: string) => (id && state.world.places[id]?.name) || "elsewhere";
  const offscreenCast = Object.entries(state.characters)
    .filter(([id]) => id !== "char_player" && !state.world.present.includes(id))
    .map(([, c]) => `${c.name} — at ${placeName(c.location)}: ${c.current_activity || c.drive?.goal || "about their life"}`)
    .join("; ");
  const recent = state.history.slice(-state.model_settings.history_window);
  const threads = state.world.threads.filter((t) => t.status === "active");
  const clocks = state.world.clocks.filter((c) => c.status === "running");

  return `${canonBlock}=== NOW ===
Turn ${turn} | ${state.world.current_time} | Weather: ${state.world.weather}
Scene: ${loc ? `${loc.name} — ${loc.description_facts}` : state.world.player_location}${loc?.contains.length ? ` | Here with you: ${loc.contains.filter((id) => id !== "char_player").map((id) => state.characters[id]?.name ?? id).join(", ") || "no one"}` : ""}
Player carries: ${state.world.money || "—"}
(Characters listed under OFFSCREEN are NOT in this scene — they are elsewhere. Reference them, don't have them appear, unless the player goes to them or brings them here.)

=== PRESENT — LIVE STATE (law) ===
${presentBlocks.join("\n")}

${offscreenCast ? `=== OFFSCREEN ===\n${offscreenCast}\n` : ""}${threads.length ? `=== OPEN THREADS ===\n${threads.map((t) => `[tension ${t.tension}] ${t.title}: ${t.description}`).join("\n")}\n` : ""}${clocks.length ? `=== FACTION CLOCKS ===\n${clocks.map((c) => `${c.faction}: ${c.objective} [${c.filled}/${c.segments}] — signs: ${c.visible_signs.join(", ")}`).join("\n")}\n` : ""}=== RECENT TURNS ===
${recent.map((h) => `T${h.turn} (${h.time_label}): ${h.player_action} → ${h.summary}${h.offscreen.length ? ` | offscreen: ${h.offscreen.join("; ")}` : ""}`).join("\n") || "This is the opening."}`;
}
