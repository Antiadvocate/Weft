/**
 * The turn loop. Per turn:
 *   0. pushSnapshot (rollback ring)
 *   1. decidePressure        — deterministic, 0 tokens (was: Threat Director call)
 *   2. NARRATOR              — streamed, cache-aligned prefix  [LLM call 1]
 *   3. SIMULATOR             — one strict-JSON diff merging the old Bookkeeper,
 *                              World Tick and memory-writer    [LLM call 2]
 *   4. apply diff + deterministic systems: psyche drift, trait decay,
 *      rumor diffusion, drive ticks, clock/consequence bookkeeping — 0 tokens
 *   5. reflection (every R turns, importance-gated)            [occasional small call]
 */
import type { ActionMode, SaveState, SimulatorDiff, TurnTelemetry, Belief, Stance, WorldBible } from "./types";
import { decidePressure, isDue, pressureDirective, detectPowerTier, selectBeat, type Beat } from "./pressure";
import { readFate, enforceFate, fateDirective, fatePressureFloor, outcomeOf } from "./fate";
import { detectWorldPronoun } from "./coerce";
import { narratorSystem, simulatorSystem, REFLECTION_SYSTEM, CHAPTER_SYSTEM, simulatorSchemaHint, stablePrefix, volatileDigest, simulatorContext, deltaNote, ledgerSnapshot } from "./prompts";
import { updateMind } from "./mind";
import { buildMessages, buildChatlogMessages, complete, completeStream, safeJson, setLLMPrefs } from "../llm";
import { runIntentPass, intentForNarrator, intentForBookkeeper, type NpcIntent } from "./intent";
import { tickHabits, habitVerdicts, regrooveHabits, absorbContradiction, dissolveWornHabits } from "./habits";
import { noveltyDigest, recordExpressions } from "./novelty";
import { advance, heuristicMinutes, advanceWeather } from "./time";
import { applyEdgeDelta, capMemory, consolidateBackground, consolidateTraits, decayTraits, diffuseRumors, needsHistoryCompaction, reinforceOrMergeTrait, tickDrives, playerEdgeSnapshot, tickPsyche, getEdge, addPromise, resolvePromise } from "./social";
import { seedAttraction, orientationCap, tickDesire } from "./desire";
import { addCanon, expandAliases, pushSnapshot, registerCharacter, uid } from "./state";
import { tickEmotions, tickCoRegulation } from "./emotions";
import { regenerateDrives } from "./drives";
import { reflectionDue, applyReflection, tickMemoryDecay, reconsolidate, integrationGate, compactGist, relevance } from "./memory";
import { knownNameWhitelist, groundMemoryContent, addFact, filterSuspectBeliefs, factOverlap } from "./facts";
import { extractHeuristics, backfillDiff, DEPART_IN_PROSE } from "./extract";
import { accruePhysiology, applyMeal, applyDrink, applySleep, applyRelaxationCeiling, physioLabel, reconcilePlayerTightness } from "./physiology";
import { SIMULATOR_JSON_SCHEMA } from "./schema";
import { neutralUndertow } from "./undertow";

export interface TurnEvents {
  onPhase: (phase: string) => void;
  onDelta: (text: string) => void;
  onMeta: (meta: object) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Appended after the player's action every turn — the last thing the model reads before writing.
 *  Exists because mid-tier narrator models resolve scene momentum by moving the player's body
 *  (an NPC says "shower first," the player replies with words, the model writes them showering).
 *  The rulebook says never; recency makes it stick. */
function sovereignty(state: SaveState): string {
  const n = state.characters["char_player"]?.name ?? "the player";
  return `\n[${n} does ONLY what the input above states — no added actions, words, feelings, or decisions. Dialogue-only input means ${n} spoke and did nothing else. If the scene is waiting on ${n} (an instruction, a question, an invitation), the world WAITS: end at the waiting point. Never resolve it for them.]`;
}

/** Does a trait label describe ACQUIRED EXPERTISE (skill built over years) rather than temperament?
 *  Temperament (guarded, cruel, brave, loyal) forms at any age; expertise needs time to develop. */
function impliesExpertise(label: string): boolean {
  const l = label.toLowerCase();
  return /(master|expert|seasoned|skilled|veteran|accomplished|practiced|trained|scholar|strateg|tactician|analyst|surgeon|marksman|sniper|negotiat|diplomat|engineer|architect|virtuoso|professional|adept|connoisseur|specialist|polymath|erudite|learned|sage|encyclopedic|fluent in|mastery|expertise)/.test(l);
}
/** Minimum plausible age for a given expertise level — the harder the mastery word, the older. */
function expertiseFloor(label: string): number {
  const l = label.toLowerCase();
  if (/(master|veteran|seasoned|virtuoso|accomplished|polymath|erudite|encyclopedic|mastery|sage)/.test(l)) return 22; // deep mastery
  if (/(expert|specialist|surgeon|strateg|tactician|negotiat|diplomat|architect|connoisseur)/.test(l)) return 20;
  return 16; // basic competence/training
}


/**
 * STRIP LEAKED META — strained models sometimes emit their own working notes into the prose
 * (a trailing parenthetical of craft vocabulary: "(110 words. Action, reaction, escalation. No
 * interiority...)") or a stray instruction-echo line. The player must never see this. We remove a
 * trailing parenthetical block that reads as self-commentary, and any standalone line that is
 * clearly the model talking about its own writing rather than narrating the scene.
 */
/** The narrator ends each turn with a one-line footer naming where the scene is and who came or went:
 *
 *      <<<SCENE place="The Rusty Anchor" entered="Drew Calloway" left="Marisol Vega">>>
 *
 *  It exists because the SIMULATOR cannot see a scene, only prose, and it guessed — inventing moves
 *  nobody wrote and inventing places that did not exist ("the kitchen doorway"), which the resolver
 *  then dumped into `elsewhere`, taking the player with it. The narrator knows where it just set the
 *  scene. Asking it directly is cheaper and truer than inferring. The footer is stripped before the
 *  prose is ever shown or stored. Parsing is deliberately truncation-tolerant: the footer is the last
 *  thing emitted, so it's the first thing lost to an output-cap cut — a footer missing its closing
 *  `>`s or even its final quote is still parsed for whatever survived, rather than dropped (which
 *  would hand the scene back to the simulator to guess). */
export interface SceneFooter { place?: string; entered: string[]; left: string[] }

export function parseSceneFooter(text: string): { prose: string; footer: SceneFooter | null } {
  // Find the LAST `<<<SCENE` marker — the real footer is always at the very end, and if a model
  // erroneously emits two, its final word on the scene is the one that counts. A stray `<<<SCENE`
  // buried mid-narration is not a thing models do, but the last-match rule also naturally ignores
  // any earlier one in favor of the true trailing footer.
  const markers = [...text.matchAll(/<<<\s*SCENE\b/gi)];
  if (!markers.length) return { prose: text, footer: null };
  const at = markers[markers.length - 1].index!;
  // guard: the true footer lives in the final stretch. If the last marker somehow sits far from the
  // end with lots of text after it, it's not a footer (freak case) — bail rather than eat prose.
  if (text.length - at > 400) return { prose: text, footer: null };
  return splitAt(text, at);
}

/** Split prose from a footer starting at `at`, parsing whatever attributes survived truncation. */
function splitAt(text: string, at: number): { prose: string; footer: SceneFooter } {
  const attrs = text.slice(at).replace(/^<<<\s*SCENE\b/i, "").replace(/>+\s*$/, "").trim();
  // tolerant grab: closing quote optional (truncation may have eaten it), value runs to the next
  // attribute keyword, a closing `>`, or end-of-string.
  const grab = (k: string): string => {
    const r = new RegExp(`${k}\\s*=\\s*"([^"]*)(?:"|(?=\\s+(?:place|entered|left)\\s*=)|>|$)`, "i").exec(attrs);
    return r ? r[1].trim() : "";
  };
  const names = (v: string) => v.split(/[,;]/).map((x) => x.trim()).filter((x) => x && !/^(none|nobody|no ?one|-)$/i.test(x));
  return {
    prose: text.slice(0, at).trimEnd(),
    footer: { place: grab("place") || undefined, entered: names(grab("entered")), left: names(grab("left")) },
  };
}

function stripMeta(text: string): string {
  if (!text) return text;
  let t = text.trim();
  const META = /\b(word count|words?\.|interiority|kinetic|action,?\s*reaction|escalation|concrete development|ends? on|begins? on|second person|paragraphs?\.|no dialogue|prose only|the player'?s? (declaration|action) is (absolute|inviolable)|per the directive|as instructed|word-?count|beat sheet|tone:|register:|pacing:)\b/i;
  // 1) trailing parenthetical note packed with craft vocabulary
  t = t.replace(/\s*\(([^()]{0,400})\)\s*$/,(m, inner) => META.test(inner) ? "" : m).trim();
  // 2) trailing bracketed note
  t = t.replace(/\s*\[([^\[\]]{0,400})\]\s*$/,(m, inner) => META.test(inner) ? "" : m).trim();
  // 3) standalone meta lines anywhere (a whole line that is craft-talk, not scene)
  t = t.split("\n").filter((ln) => {
    const s = ln.trim();
    if (!s) return true;
    // a line is meta if it's short-ish AND hits craft vocabulary AND isn't obviously in-scene prose (no quotes/sentence flow)
    const looksMeta = META.test(s) && s.length < 220 && !/["“”]/.test(s) && (/^\(|^\[|^—\s|^\d+\s*words/i.test(s) || (s.match(/[.;]/g)?.length ?? 0) >= 2 && /\b(no |ends? on|begins? on|direct\.|kinetic\.)\b/i.test(s));
    return !looksMeta;
  }).join("\n").trim();
  return t;
}


/** Stable small hash of a character id — staggers reflection so the cast doesn't all reflect
 *  on the same turn (which produced a burst of LLM calls and a visible stall every R turns). */
function reflectSalt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}

/** MEMGPT-STYLE PAGING — cold central characters' identity cards page OUT of the cached prefix
 *  to a one-line stub, and page back IN the moment they matter (present, or named in the action
 *  or recent prose, or strongly bonded to the player). The prefix only changes on transitions,
 *  which are rare, so cache stability holds between them. Memory/traits are untouched — this
 *  pages only the identity card's place in context, not the character's mind. */
export function updatePaging(state: SaveState, action: string): void {
  if (state.model_settings.paging === false) return;
  const AWAY_TURNS = 12, BOND_FLOOR = 40;
  const turn = state.world.current_turn;
  const recentText = (state.history.slice(-3).map((h) => h.narrator_prose).join(" ") + " " + action).toLowerCase();
  const lastSeen = new Map<string, number>();
  for (const t of state.telemetry) for (const pid of t.present) lastSeen.set(pid, t.turn);
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || c.central === false || c.status === "dead" || c.status === "departed") continue;
    const first = c.name.split(/\s+/)[0]?.toLowerCase() ?? "";
    const named = first.length >= 3 && recentText.includes(first);
    const present = state.world.present.includes(id);
    if (present || named) { if (c.paged) c.paged = false; continue; }
    if (c.paged) continue; // stays paged until presence/mention wakes them
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    const bond = e ? Math.abs(e.warmth) + Math.abs(e.trust) : 0;
    const away = turn - (lastSeen.get(id) ?? 0);
    if (away >= AWAY_TURNS && bond < BOND_FLOOR) c.paged = true;
  }
}

/** The world may grow, but not without limit. Above this, the oldest unused, non-founding place is
 *  forgotten — the Forge's own locations are the spine and are never taken. */
export const PLACE_CAP = 16;

/** PLACE GC — resolvePlace creates a record for every unmatched name and nothing ever cleaned
 *  them up, so long campaigns accumulate junk locations. Sweep: over a soft cap, evict places
 *  that are unoccupied, aren't anyone's location, and aren't referenced in recent play —
 *  oldest first (creation time is embedded in the uid). */
export function gcPlaces(state: SaveState, cap = PLACE_CAP): void {
  const ids = Object.keys(state.world.places);
  if (ids.length <= cap) return;
  const used = new Set<string>([state.world.player_location]);
  for (const c of Object.values(state.characters)) if (c.location) used.add(c.location);
  const recentText = state.history.slice(-8).map((h) => `${h.narrator_prose} ${h.summary}`).join(" ").toLowerCase();
  const bornAt = (id: string): number => {
    const m = /^loc_([0-9a-z]+)/.exec(id);
    if (!m) return 0;
    return parseInt(m[1].slice(0, m[1].length - 5), 36) || 0;
  };
  const evictable = ids
    .filter((id) => id !== OFFSCENE && !state.world.places[id].founding && !used.has(id) && !(state.world.places[id].contains?.length) && !recentText.includes(state.world.places[id].name.toLowerCase()))
    .sort((a, b) => bornAt(a) - bornAt(b));
  for (const id of evictable) {
    if (Object.keys(state.world.places).length <= cap) break;
    delete state.world.places[id];
  }
}

const RESTORE_INTENT = /\b(sleep|nap|doze|rest|bed down|turn in|lie down|go to bed|call it a night|eat|meal|breakfast|lunch|dinner|supper|cook and eat|bathe|bath|shower|wash up|soak|unwind|relax|a few hours to (?:myself|ourselves)|quiet (?:hour|morning|evening|day))\b/i;


/** DRIVE RE-PLANNING (deterministic layer) — background characters must not chase ghosts.
 *  Three stale states, three responses:
 *   • target DEAD/DEPARTED  → the goal is impossible: rotate to the next queued goal.
 *     Exception: HIGH-PRIORITY goals (≥8) are never dropped — they get re-approached with a
 *     blocker note instead ("X is gone; the goal outlives them").
 *   • target ELSEWHERE (incl. the player) and not seen for 12+ turns → the goal stands but the
 *     OPERATIVE step becomes pursuit: blocker := "must find X first" — which the digest renders,
 *     so the narrator (and the pressure system's agent beats) drive them to seek, not to mime
 *     handing something to an empty room.
 *   • progress ≥ 100 → complete: rotate the queue.
 *  The LLM layer (reflection) handles what determinism can't: judging completion from events
 *  and inventing genuinely NEW goals when the queue runs dry. */
export function replanDrives(state: SaveState): void {
  const turn = state.world.current_turn;
  const lastSeen = new Map<string, number>();
  for (const t of state.telemetry) for (const pid of t.present) lastSeen.set(pid, t.turn);
  const nameToId = new Map<string, string>();
  for (const [id, c] of Object.entries(state.characters)) {
    const first = c.name.split(/\s+/)[0]?.toLowerCase();
    if (first && first.length >= 3) nameToId.set(first, id);
  }
  const playerFirst = state.characters["char_player"]?.name.split(/\s+/)[0]?.toLowerCase() ?? "";
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || c.central === false || c.status === "dead" || c.status === "departed" || !c.drive?.goal) continue;
    const d = c.drive;
    const g = d.goal.toLowerCase();
    const rotate = (why: string): void => {
      const next = c.drive_queue?.shift();
      c.drive = next ?? undefined;
      console.warn(`[drives] ${c.name}: "${d.goal.slice(0, 50)}" ${why} — ${next ? `next goal: "${next.goal.slice(0, 50)}"` : "queue empty (reflection will invent)"}`);
    };
    if (d.progress >= 100) { rotate("complete"); continue; }
    // find a referenced person in the goal text
    let targetId: string | undefined;
    for (const [first, tid] of nameToId) if (tid !== id && g.includes(first)) { targetId = tid; break; }
    if (playerFirst && g.includes(playerFirst)) targetId = "char_player";
    if (/\bthe player\b/.test(g)) targetId = "char_player";
    if (!targetId) continue;
    const target = state.characters[targetId];
    if (target.status === "dead" || target.status === "departed") {
      if ((d.priority ?? 1) >= 8) {
        if (!d.blocker?.includes("gone")) d.blocker = `${target.name} is gone — the goal outlives them; another way must be found`;
      } else rotate(`impossible (${target.name} is ${target.status})`);
      continue;
    }
    // target elsewhere: co-located? seen recently?
    const together = target.location && target.location === c.location;
    const seenGap = turn - (lastSeen.get(id) ?? 0);
    if (!together && seenGap >= 12 && targetId === "char_player") {
      const pursuit = `must find ${target.name} first — they are elsewhere`;
      if (d.blocker !== pursuit) { d.blocker = pursuit; d.updated_turn = turn; }
    }
  }
}

function emptyDiff(): SimulatorDiff {
  return {
    scene_summary: "", elapsed_minutes: 20, facts: [], psyche: [], edges: [], memories: [], appearance: [], drives_update: [],
    traits: [], threads_update: [], rumors_new: [], consequences_new: [], clocks_advance: [],
    new_characters: [], new_places: [], offscreen: [],
  };
}

const INLINE_CHANNEL_NOTE = `\n[How to read the player's input: text in "double quotes" is spoken ALOUD BY THE PLAYER — it is the PLAYER'S OWN voice and MUST be rendered as the player saying it, NEVER put into another character's mouth, even if the words are about, addressed to, or name that character. If the player's quoted line is confusing, self-contradictory, or names other people, the player still SAID IT — render the player speaking those exact words and let the other characters REACT to having heard them; do not "fix" it by reassigning the line to whoever it seems to be about. text in *asterisks* is a PRIVATE THOUGHT that NO ONE in the scene can perceive, react to, or know — not even by intuition; text in (parentheses) is the player's PRIVATE INNER STATE driving the action — the feeling, motive, or thought behind what they do ("he walked out. (I was pissed, didn't want her to see me)"): use it to shape HOW the action lands and what their body does, but it is invisible to everyone in the scene — never state it in the prose, never let another character know or correctly infer it; they see only the outward act and read it through their own eyes, which may be wrong; everything else is physical action the player takes. Honor these channels exactly: never let a character respond to or act on a thought in *asterisks* or a state in (parentheses), never have someone "overhear" something the player only thought or felt, and never speak the player's quoted words as another character. If the player mixes channels in one message, treat each part on its own channel.]`;

const MODE_FRAME: Record<ActionMode, (a: string) => string> = {
  // Always attach the channel note. It used to attach only when an asterisk appeared, which meant a
  // turn mixing speech and plain-prose interiority ("I thought I was average height") was read as
  // wholly spoken and acted upon. The note costs a few tokens and is the only thing telling the
  // narrator which parts of a single message were audible.
  do: (a) => `${a}${INLINE_CHANNEL_NOTE}\n[If the player's action includes how they FEEL or why (an inner state, motive, or reaction — "I keep reading because I feel ignored"), that feeling is PRIVATE. Use it to shape what the player's body actually does, but do NOT state the feeling in the prose and do NOT let any other character be handed it. Others see only the outward act (the player kept reading, didn't reply) and must interpret it themselves through their own read — which may be wrong. Never convert the player's stated feeling into a visible tell that decodes it exactly.]`,
  say: (a) => `The player speaks aloud, in their own voice: "${a}"`,
  think: (a) => `PRIVATE INTERIOR — the player's unspoken thought, sensed by NO ONE: ${a}\nThis is internal only. The player did NOT say or do this. No character can hear it, react to it, or know it — not even characters present, not even by intuition. Do NOT have anyone respond to it or act on its content. Render only the player's own private experience of the thought and, if anything, what is already happening around them; the thought itself changes nothing others perceive.`,
  story: (a) => `The player narrates what happens next (treat as authorial intent, weave it in, keep the world's logic): ${a}`,
};

/** A proper name (multi-word, or Capitalized non-generic) — used only as a hint for auto-tracking. */
function looksNamed(name: string): boolean {
  const generic = /^(the |a |an )?(guard|thug|man|woman|figure|stranger|officer|cop|patron|crowd|bystander|clerk|driver|waiter|nurse|soldier|guy|girl|boy|kid|person|someone)s?$/i;
  if (generic.test(name.trim())) return false;
  return /\s/.test(name.trim()) || /^[A-Z]/.test(name.trim());
}

/** Detect a model safety-refusal returned in place of narration, so we can retry on the fallback
 *  rather than storing it as the turn's prose. Catches: a refusal in the model's native language
 *  (unexpected CJK when the story isn't written in an East-Asian language), common English refusal
 *  stems, and a suspiciously tiny response where a full narrator turn was expected. */
function isRefusal(text: string, bible?: WorldBible): boolean {
  const t = (text ?? "").trim();
  if (!t) return true; // empty is a failed generation
  // Unexpected CJK: deepseek/qwen/etc emit a native-language refusal. If the world's own language
  // isn't East-Asian and a meaningful chunk of the response is CJK, it's almost certainly a refusal.
  const cjk = (t.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const storyLang = `${bible?.cultures_and_languages ?? ""}`.toLowerCase();
  const storyIsEastAsian = /chinese|mandarin|cantonese|japanese|korean|hanzi|kanji|hangul/.test(storyLang);
  if (cjk >= 4 && !storyIsEastAsian && cjk / t.length > 0.15) return true;
  // Common refusal stems (English and a few localized), especially when the whole response is short.
  const low = t.toLowerCase();
  const refusalStem = /^(i'?m sorry,? but|i cannot|i can'?t (provide|assist|help|continue|generate|write|create)|i am unable to|i won'?t be able to|i must decline|sorry, i can'?t|as an ai|i can'?t comply|我无法|我不能|抱歉|对不起|申し訳|죄송)/i.test(low);
  if (refusalStem && t.length < 400) return true;
  // A full narrator turn is 120–350 words; a response under ~12 words is not narration (a refusal,
  // an error echo, or a stub). Guard against storing it.
  if (t.split(/\s+/).filter(Boolean).length < 12 && !/[.!?]"?\s*$/.test(t)) return true;
  return false;
}

/** DRIFT VETO — the structural fix for "moral cancer": the narrator can write a weak, out-of-character
 *  moment (statistical gravity pulls every world toward our-world defaults), but the real damage is the
 *  BOOKKEEPER canonizing that moment as growth — "she realized kindness felt good" becomes a memory,
 *  then a trait, and next turn the character genuinely HAS changed because the ledger says so. Killing
 *  the persistence removes the drift's substrate: the moment can happen in prose, but it evaporates
 *  instead of compounding into a rewritten person. This checks a proposed memory/trait/edge write
 *  against the character's own grain and rejects the ones that would soften a constitutionally-hard
 *  character or reverse their nature WITHOUT the earned door (reflection, which bypasses this veto).
 *
 *  Conservative by design: a missed drift is far cheaper than a murdered arc, so it only fires on
 *  clear reversal language against a clear cold/hard nature, and every rejection is logged. */
const SOFTENING_PATTERN = /\b(soften(ed|ing|s)?|realized? (that )?(kindness|caring|warmth|mercy|being (kind|good|gentle))|began to (care|feel|soften)|learned to (care|love|trust|feel)|guilt|remorse|redemption|redeem\w*|touched by|melted|warmed to|opened (his|her|their) heart|found (his|her|their) humanity|no longer (so )?(cold|cruel|hard|ruthless)|a better (man|woman|person)|change of heart|conscience (stirred|awoke|pricked))\b/i;
const NORM_REVERSAL_PATTERN = /\b(was (strange|odd|wrong|pointless)|felt (right|nice|good|freeing)|kinda nice|no longer (made sense|needed)|stopped doing|why do we even|questioned (the|their|whether)|doubted (the|their)|began to wonder if)\b/i;

function isColdNatured(state: SaveState, id: string): boolean {
  const c = state.characters[id];
  return !!c && typeof c.conscience === "number" && c.conscience <= 0.35;
}

/** Returns a rejection reason if this content would illegitimately drift the character, else null. */
function driftVeto(state: SaveState, id: string, content: string, opts?: { isReflection?: boolean }): string | null {
  if (opts?.isReflection) return null; // the earned door: reflection may move identity against the grain
  if (id === "char_player") return null; // the player is who the player plays
  const text = content.toLowerCase();
  // a constitutionally cold character (rudra-type) being written as softening/redeeming
  if (isColdNatured(state, id) && SOFTENING_PATTERN.test(text)) {
    return `${nameOf2(state, id)} is cold by nature; a softening/redemption write was refused (no earned turning point this turn)`;
  }
  // anyone's core trait being flatly reversed by a memory that narrates the reversal as fact
  const core = (state.characters[id]?.core_traits ?? []) as string[];
  const HARD = /\b(cruel|ruthless|cold|merciless|brutal|vicious|callous)\b/i;
  if (core.some((t) => HARD.test(t)) && SOFTENING_PATTERN.test(text)) {
    return `${nameOf2(state, id)}'s hard nature was reversed by an unearned softening write — refused`;
  }
  return null;
}
function nameOf2(state: SaveState, id: string): string { return state.characters[id]?.name ?? "someone"; }

/** Derive serviceable default values for a spawned character whose bookkeeper record left them empty.
 *  Not a substitute for authored depth — a floor so a character is never a valueless plot-label. */
function deriveDefaultValues(traits: string[], background: string): string[] {
  const blob = `${traits.join(" ")} ${background}`.toLowerCase();
  const out: string[] = [];
  if (/child|son|daughter|kid|family|mother|father|parent/.test(blob)) out.push("the people they've lost or protect");
  if (/surviv|scrap|steal|hungr|cold|edge|forest|wild/.test(blob)) out.push("staying alive one more day");
  if (/proud|honor|warrior|fight|soldier|raider/.test(blob)) out.push("not being seen as weak");
  if (/lonely|alone|trust no|wary|suspicious/.test(blob)) out.push("finding someone safe to trust");
  if (/faith|god|spirit|sacred|priest/.test(blob)) out.push("their faith");
  while (out.length < 2) out.push(out.length === 0 ? "being treated as a person, not a problem" : "a small dignity of their own");
  return out.slice(0, 3);
}

/** Derive a minimal but non-empty voice so a spawned character can actually speak in-character. */
function deriveDefaultVoice(traits: string[], age: string): { diction?: string; example_lines?: string[]; never_says?: string[] } {
  const blob = traits.join(" ").toLowerCase();
  const young = parseInt(age, 10) <= 16;
  const rough = /desperate|fading|hard|grim|raider|hungry|feral/.test(blob);
  return {
    diction: young ? "simple, concrete, a child's directness" : rough ? "clipped, plain, spends words like they cost something" : "plain and direct, no flourish",
    example_lines: young
      ? ["You have food? Real food?", "I know these woods. You don't."]
      : rough
        ? ["I don't want your pity. I want to move.", "You think I haven't seen worse?"]
        : ["Say what you mean.", "I've got my own troubles."],
    never_says: ["long philosophical speeches", "clever wordplay they'd have no schooling for"],
  };
}

export async function runTurn(state: SaveState, action: string, ev: TurnEvents, mode: ActionMode = "do", opts?: { ground?: boolean; eco?: boolean; proseOverride?: string; tightness?: number }): Promise<void> {
  const t0 = Date.now();
  // WEB SEARCH TARGET — the player can name exactly what to ground on with ((double parens)):
  //   "I lead the Imperial Guard into the breach ((Warhammer 40k Astra Militarum tactics))"
  // The ((...)) is a directive to the search layer, NOT story text, so it's stripped from the
  // action before framing/rendering — the narrator never sees it, the prose never contains it.
  // Multiple ((...)) blocks join into one query. When present it forces grounding on for the turn.
  let searchTarget = "";
  const cleanedAction = action.replace(/\(\(([^)]+)\)\)/g, (_m, q) => { searchTarget += (searchTarget ? "; " : "") + String(q).trim(); return ""; }).replace(/\s{2,}/g, " ").trim();
  action = cleanedAction;
  const framedAction = MODE_FRAME[mode](action);
  const turn = state.world.current_turn;
  setLLMPrefs({ routeByPrice: !!state.model_settings.route_by_price });
  // ECO (cost governor): a transient posture, never a persisted setting — lean prompts and a
  // tightened context ceiling for this turn only.
  const eco = !!opts?.eco;
  const lean = !!state.model_settings.lean_mode || eco;
  await pushSnapshot(state);

  // 1 ── the undertow turns first: strategy, chaos, catastrophe (deterministic, 0 tokens)
  ev.onPhase("undertow");
  // ── KERNEL: psyche is driven by the relaxation scalar itself, recovered toward capacity.
  //    (The cusp-catastrophe/Kuramoto layer that used to OVERWRITE relaxation here has been
  //    removed — it severed the generative kernel. Relaxation is the driver again: the
  //    simulator's per-character relaxation_delta moves it, tickPsyche drifts it toward
  //    capacity and derives state. Emergence from one scalar, as originally designed.) ──
  // INVENTORY DEDUP — older saves (and repeated inventory_add before the guard existed) can hold the
  // same item twice ("KSG shotgun" x2). Collapse by name so nobody carries a phantom duplicate.
  for (const cond of Object.values(state.condition)) {
    if (!cond.inventory?.length) continue;
    const seen = new Set<string>();
    cond.inventory = cond.inventory.filter((i) => {
      const k = i.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }
  // CAPACITY HEAL — older saves (and forge slips) left some characters with a resting openness that
  // contradicts their nature: a cold, predatory character sitting at capacity 3+ drifts to serene
  // openness and the perception gate reads them as placid. Recompute capacity from conscience+traits
  // for any character whose current capacity is clearly too high for who they are, then let the
  // faster above-capacity decay in tickPsyche pull their inflated relaxation back down.
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player") continue;
    const cond = state.condition[id]; if (!cond) continue;
    const consc = typeof c.conscience === "number" ? c.conscience : 0.6;
    const traitBlob = `${(Array.isArray(c.core_traits) ? c.core_traits.join(" ") : c.core_traits ?? "")} ${(c.voice as any)?.agenda ?? ""} ${c.attachment?.under_threat ?? ""}`.toLowerCase();
    const guarded = /\b(cold|hollow|vindictive|cruel|ruthless|predatory|paranoid|hostile|guarded|calculating|manipulat|menac|instrument|vicious|contempt|sadis|controlling|suspicious|wary|hardened|brutal)\b/.test(traitBlob);
    let natural = consc <= 0.3 ? -2 : consc >= 0.8 ? 4 : 2;
    if (guarded) natural -= 2;
    natural = Math.max(-6, Math.min(6, natural));
    // only heal DOWNWARD and only when clearly off (>2 too high), so we don't churn every turn
    if (cond.psyche.capacity > natural + 2) {
      cond.psyche.capacity = natural;
      if (cond.psyche.relaxation > natural + 2) cond.psyche.relaxation = natural + 1; // nudge the inflated reading down now
    }
  }
  for (const id of Object.keys(state.condition)) tickPsyche(state.condition[id].psyche);
  for (const id of Object.keys(state.memory)) tickMemoryDecay(state.memory[id], state.world.current_turn);
  const undertow = neutralUndertow();

  // 1b ── FATE. When a destination has a turn budget, the ending is not optional. Fate reads the
  // clock, seizes the world's machinery as the budget burns (threads that don't serve the ending
  // lose their grip; clocks turn toward it), and puts a floor under pressure so the world cannot
  // doze while the ending waits. No destination or no budget → returns inert, nothing changes.
  const fate = readFate(state);
  const fateLog = enforceFate(state, fate);
  // Progress is the clock. Write it every turn so it never waits on a chapter, an audit, or a model
  // noticing anything. `missing` and `gained` are left alone; only the auditor touches those.
  if (fate.active) {
    const prev = state.destination_progress;
    state.destination_progress = { pct: fate.pct, gained: prev?.gained ?? "", missing: prev?.missing ?? "", turn, reached: false, act: prev?.act };
  }

  // 1c ── pressure (deterministic), heat amplified when the world is primed
  ev.onPhase("pressure");
  const verdict = decidePressure({
    turn, now: state.world.current_time, trace: state.pressure_trace, difficulty: state.world_bible.difficulty_profile,
    threads: state.world.threads, consequences: state.world.consequences, clocks: state.world.clocks, action,
    instability: undertow.instability,
    focusMode: state.world.focus?.mode ?? null, focusLabel: state.world.focus?.label ?? null,
    tension: state.model_settings.tension ?? 5,
  });
  // fate's floor: the ending is coming and the world knows it. Never lowers pressure, only raises.
  const floor = fatePressureFloor(fate);
  if (floor > verdict.pressure) {
    verdict.pressure = floor;
    verdict.source = fate.forceArrival ? "the ending, arriving" : "the ending, closing in";
  }
  state.pressure_trace.push(verdict.pressure);

  // ── SOURCE-DRIVEN BEAT: pressure must name where it comes from, or stay silent.
  // Agent candidates: offscreen central characters whose active drive plausibly intersects the
  // player's orbit — the goal names the player, someone present, or the current locale.
  const orbitNames = ["char_player", ...state.world.present]
    .map((pid) => state.characters[pid]?.name?.split(/\s+/)[0]?.toLowerCase())
    .filter((n): n is string => !!n && n.length >= 3);
  const hereName = (state.world.places[state.world.player_location]?.name ?? "").toLowerCase();
  const agents = Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && c.central !== false && c.status !== "dead" && c.status !== "departed" && !state.world.present.includes(id) && c.drive?.goal)
    .map(([, c]) => ({ name: c.name, goal: c.drive!.goal, priority: c.drive!.priority ?? 1 }))
    .filter((a) => {
      const g = a.goal.toLowerCase();
      return orbitNames.some((n) => g.includes(n)) || (hereName.length >= 4 && g.includes(hereName));
    });
  state.pressure_state ??= { last_beat_turn: 0, last_exo_turn: 0 };
  const beat: Beat = selectBeat({
    turn, now: state.world.current_time, tension: state.model_settings.tension ?? 5,
    threads: state.world.threads, clocks: state.world.clocks, consequences: state.world.consequences,
    agents, last_beat_turn: state.pressure_state.last_beat_turn, last_exo_turn: state.pressure_state.last_exo_turn,
    restoration: RESTORE_INTENT.test(action),
  });
  if (["consequence", "clock", "thread", "agent", "exogenous"].includes(beat.kind)) state.pressure_state.last_beat_turn = turn;
  if (beat.kind === "exogenous") state.pressure_state.last_exo_turn = turn;
  ev.onMeta({ pressure: verdict.pressure, band: verdict.band, source: verdict.source, beat: beat.kind });

  // 2 ── narrator (streamed)
  ev.onPhase("narrator");
  // INTENT PASS — before the narrator writes, each present NPC with something at stake privately
  // commits to their true intent this beat (the lie, the hidden want, the withheld feeling),
  // authored from their OWN state, never from the player's thoughts. Split downstream: the narrator
  // gets only the SURFACE (renders deniable behavior — the player reads a face, not a decoded
  // answer); the bookkeeper gets the TRUTH (records what really happened). Fires 0 calls when nobody
  // has stakes, 1 cheap call per staked NPC otherwise (usually 0–1).
  // ── HABIT ENGINE (experimental, flag-gated) ── Core traits fire as physics before the intent pass,
  // so intent authors from a world where the automatic behavior has already occurred. The narrator
  // receives ONLY concrete fire verdicts (no numbers, no lexicon); seen/unseen and all strength math
  // stay engine-side. Change moves in the dark; only an observer can ever surface it.
  let habitVerdict = "";
  const habitShifts: string[] = [];
  if (state.model_settings.habit_engine) {
    const presentForHabits = state.world.present.filter((pid) => pid !== "char_player");
    const beatText = `${action} ${state.history.slice(-1)[0]?.narrator_prose ?? ""}`.slice(0, 800);
    const hb = tickHabits(state, presentForHabits, beatText, verdict.pressure ?? 3);
    habitVerdict = habitVerdicts(hb.fires, state);
    for (const s of hb.shifts) habitShifts.push(s);
    for (const d of hb.dwellings) {
      const ps = state.condition[d.char_id]?.psyche;
      if (ps && !ps.active_states.includes(d.label)) ps.active_states.push(d.label);
    }
    regrooveHabits(state);
  }
  // NOVELTY — a trait keeps its intensity forever; what fades is its narrative airtime.
  // Without this the tenth basketball scene is written like the first (all discovery, all
  // commentary) instead of the habit becoming the floor the scene stands on.
  const novelty = noveltyDigest(state);
  const noveltyNote = novelty ? `\n\n=== LONG-WORN BEHAVIOR ===\n${novelty}` : "";

  const intents: NpcIntent[] = await runIntentPass(state, action);
  replanDrives(state);
  updatePaging(state, action);
  const prefix = stablePrefix(state);
  const memQuery = expandAliases(state, action); // "the captain" retrieves Sorena's memories
  const digest = volatileDigest(state, memQuery, eco ? { budgetOverride: Math.min(state.model_settings.token_budget || 4000, 3500) } : undefined);
  const god = !!state.world_bible.god_mode;
  // tier is a light gate (blocks the "throw troops at a god" category error); it does NOT script
  // behavior — that emerges from each character's relaxation state via the perception gate.
  const recentText = [
    ...state.history.slice(-3).map((h) => h.narrator_prose ?? ""),
    state.history.slice(-1)[0]?.player_action ?? "",
  ].join(" ");
  const tier = detectPowerTier(god, recentText);
  // WITNESS STAMP — when the player wields genuinely impossible power in front of others, that
  // witnessing durably rewrites how each present character relates to them. Stamp an active_state so
  // the reorientation PERSISTS across later turns (not just the turn of the act): a character who saw
  // a planet-scale teleport keeps reacting as someone who saw it, even turns afterward, until it
  // decays. This is what stops the incoherent "wounded peer scolds the god" beat — their standing
  // state now says otherwise. Only non-god-mode: in god mode the whole world already knows the frame.
  if ((tier === "mythic" || tier === "cosmic") && !god) {
    const witnessState = tier === "cosmic" ? "awestruck by the player's impossible power" : "shaken by the player's impossible power";
    for (const wid of state.world.present) {
      if (wid === "char_player") continue;
      const wc = state.condition[wid];
      if (!wc) continue;
      // replace any prior witness-stamp so the freshest reading holds, and re-age it
      wc.psyche.active_states = wc.psyche.active_states.filter((s) => !/impossible power/.test(s));
      wc.psyche.active_states.push(witnessState);
      (wc.psyche.state_ages ??= {})[witnessState] = state.world.current_turn;
      if (wc.psyche.active_states.length > 5) wc.psyche.active_states = wc.psyche.active_states.slice(-5);
    }
  }
  let directive = pressureDirective(verdict, state.world_bible.pressure_palette, state.model_settings.tension ?? 5, tier, beat);
  // CROSS-TALK NUDGE — when two or more NPCs share the scene, the narrator tends to line them all up
  // facing the player. Remind it they have each other: with 2+ present NPCs, at least one exchange this
  // turn should run NPC↔NPC (they address, answer, needle, or side-deal with each other), not everyone
  // aimed at the player. Fires only when there's actually more than one other person in the room.
  const presentNpcs = state.world.present.filter((id) => id !== "char_player" && state.characters[id]);
  // CROSS-TALK should NOT fire when the scene's context makes NPC banter wrong: an intimate or
  // tender moment, an acutely dangerous or violent beat, a tense standoff, stealth, or the hush after
  // something shocking. In those turns the correct amount of NPC-to-NPC chatter is often ZERO —
  // forcing an exchange breaks the moment. This is a DEFAULT nudge against player-orbit, not a mandate
  // to chatter through every scene. Suppress it when the recent prose or the player's action signals
  // one of those contexts; otherwise nudge as before.
  const ctx = recentText.toLowerCase();
  const suppressChatter =
    /\b(kiss|kissed|naked|undress|bare|caress|breath|whisper|moan|trembl|skin|intimate|tender|make love|between them|close enough to|foreheads?)\b/.test(ctx) || // intimacy
    /\b(gun|knife|blade|blood|scream|silence|frozen|frozen still|don'?t move|hold your breath|creeping|sneak|stalk|hiding|hidden|hunt|predator|snarl|growl|aim|barrel|trigger|corpse|body|dying|dead)\b/.test(ctx) || // danger / stealth
    /\b(standoff|stared|staring|neither (spoke|moved)|no one (spoke|moved)|held (his|her|their|xer) breath|dead quiet|deathly|shock|stunned|reeling|grief|sobb|weeping)\b/.test(ctx) || // standoff / shock / grief
    (verdict as any)?.mode === "escalate"; // active pressure spike
  if (presentNpcs.length >= 2 && !suppressChatter) {
    directive += `\nCROSS-TALK: ${presentNpcs.length} other characters share this scene — they have EACH OTHER, not just the player. When the moment allows it, at least one exchange this turn runs between two NPCs (one addresses, answers, needles, contradicts, or makes a quiet side-deal with another), driven by their own wants. Do not aim every present character's attention at the player. But read the room: if the scene is intimate, dangerous, tense, or stunned, silence or a single held beat is correct — do not force banter that breaks it.`;
  }
  // ── PRESSURE QUEUE ── At most ONE new pressure aimed at the player is released per turn. Multiple
  // injectors (an NPC's drive executing, the genre threat coming onscreen, a due consequence) can all
  // be live at once; releasing them together manufactures a cascade — arrival + approach + demand all
  // in one narrator call, which overruns the turn and ends it mid-escalation. Instead we collect the
  // candidate pressures, order them by urgency, and inject only the top one. The rest stay pending and
  // surface on later turns. A due consequence carried by the pressure verdict already occupies the
  // slot, so the discretionary injectors below defer to it.
  const pressureCandidates: { prio: number; text: string }[] = [];
  const consequenceHoldsSlot = !!verdict.due_consequence;

  // Is the player supplying momentum this turn, or inert? (Defined here so the drive system can cede
  // the wheel to a desiring character when the player does nothing.)
  const playerInert = !action.trim() || /^\s*(\[observer\]|continue|i watch|i wait|i observe|i look|i listen|watch|wait|observe|keep going|go on|\.\.\.)\b/i.test(action.trim());

  // ── DRIVE IS THE DEFAULT ── Centrality is not assigned to the player; it EMERGES from desire.
  // Every present character who wants something pursues it THIS turn, by their own means — this is the
  // engine's baseline, not an occasional nudge. The character with the strongest active drive is the
  // one the scene naturally turns around, especially when the player supplies no momentum of their
  // own. A character's relationships are INSTRUMENTS of their drive, not substitutes for it: someone
  // who loves the player pursues their goal in a way that routes through the player (asking, waiting a
  // beat, carrying them along), but the goal still drives — affection is a method, not the objective.
  const drivers = presentNpcs
    .map((id) => ({ id, c: state.characters[id] }))
    .filter(({ c }) => c.drive?.goal)
    .sort((a, b) => (b.c.drive!.priority ?? 1) - (a.c.drive!.priority ?? 1));

  if (drivers.length) {
    const lead = drivers[0];
    // The scene's prime mover this turn: the highest-desire present character. When the player is
    // inert, this character sets the turn's direction and the player is carried, asked, or given
    // something to react to — the world does not stall waiting on a passive player, it flows with
    // whoever wants something. When the player DID act, the driver still advances their goal, woven
    // against what the player just did.
    const relToPlayer = state.world.edges.find((e) => e.from === lead.id && e.to === "char_player");
    const loves = relToPlayer && (relToPlayer.warmth ?? 0) >= 55;
    const carriesPlayer = loves || (relToPlayer?.roles?.some((r) => /partner|lover|friend|ally|protector|sister|brother|parent|guardian/i.test(r)) ?? false);
    const leadText = playerInert
      ? `\nSCENE IS DRIVEN BY ${lead.c.name.toUpperCase()} (the player gave no direction this turn, so the character who WANTS something drives the scene — the world does not wait on a passive player). ${lead.c.name} pursues their goal ("${lead.c.drive!.goal}") by a concrete means of their own choosing this turn — using whatever they have (their abilities, position, knowledge, allies, force, words), MAKING the next thing happen rather than discussing it. ${carriesPlayer ? `Because ${lead.c.name} cares about the player, their method ROUTES THROUGH the player — they bring the player along, ask "you coming?", press a task into their hands, or simply pull them into motion — and if the player has spoken, ${lead.c.name} genuinely listens and it bends their approach. But the goal still drives; the player is carried by ${lead.c.name}'s momentum, not orbited by the scene.` : `The player is one object in the world ${lead.c.name} moves through — carried along, worked around, or addressed, but not the center the scene orbits.`} END THE TURN the moment ${lead.c.name}'s move creates a genuine demand on the player SPECIFICALLY — their body must move or react, a question is put to them, or the next beat cannot resolve without their input. If ${lead.c.name}'s action does not actually require the player this turn, the world simply moves and carries them; do not manufacture a decision point just to hand the player the wheel.`
      : `\n${lead.c.name} is pursuing their goal ("${lead.c.drive!.goal}") and acts toward it THIS turn by a concrete means of their own — woven against what the player just did, not set aside to react to the player. Advance their aim; let it intersect the player's action rather than orbit it.`;
    pressureCandidates.push({ prio: 5, text: leadText });
  }

  // GENRE-THREAT ESCALATION — a lethal-threat world must not let its danger sit offstage for many
  // turns. Candidate, not immediate.
  {
    const fear = (state.world_bible.what_people_fear ?? "").toLowerCase();
    const lethalWorld = /\b(eaten|eat|devour|hunt|predator|prey|killed|kill|maul|attack|torn|blood|beast|creature|monster|dinosaur|claw|teeth)\b/.test(fear)
      || (state.world_bible.pressure_palette ?? []).some((p) => /predator|threat|attack|hunt|violence|kill/i.test(p));
    if (lethalWorld && (state.model_settings.tension ?? 5) >= 3) {
      const recentProse = state.history.slice(-4).map((h) => h.narrator_prose ?? "").join(" ").toLowerCase();
      const threatWords = /\b(attack|charged|lunged|screamed|blood|ran|running|chased|seized|dragged|killed|teeth|claw|roar|bit|torn|maw|predator|creature|beast|dinosaur|raptor|slaughter|panic|fled)\b/;
      if (!threatWords.test(recentProse)) {
        pressureCandidates.push({ prio: 7, text: `\nGENRE-THREAT ESCALATION: this world's core danger (${state.world_bible.what_people_fear?.trim() || "the predator threat"}) has been offstage too long — recent turns stayed domestic while the lethal threat is reduced to distant sound. THIS TURN the threat becomes PRESENT and REAL at its full scale: the predator is seen, heard closing, or acts — it moves in, takes or menaces someone, forces flight or defense. Do not soften it to "wrong birdsong." End the turn the instant the threat lands and the next beat needs a response — do not narrate the player's response for them.` });
      }
    }
  }

  // Release only the top candidate, and only if a due consequence isn't already occupying the turn's
  // one-pressure slot. Everything else waits for a future turn.
  if (!consequenceHoldsSlot && pressureCandidates.length) {
    pressureCandidates.sort((a, b) => b.prio - a.prio);
    directive += pressureCandidates[0].text;
  }

  // ── RESTORATION DETECTION ── sleeping, eating, bathing, quiet hours. To the stall detector,
  // a character asleep is indistinguishable from a stalled scene — low event density, passive
  // player — so at any nonzero tension the engine was injecting complications into every night
  // and meal. Restoration is a recognized state, not a stall: the drama gets gated below, and
  // the physiology credit is guaranteed mechanically regardless of what the prose does.
  const restoration = RESTORE_INTENT.test(action);

  // ── PLOT-STALL DETECTION ── A scene has no engine of its own when nothing is pushing the PLOT
  // outward. The subtlety: a thread can carry high tension while being purely INTERNAL — a
  // character's awe, collapse, or realization. That kind of tension generates lush reaction-prose
  // that goes nowhere. So we don't ask "is there tension," we ask "is there tension pointed at an
  // external situation." When the only live threads are emotional, no consequence is pending, no
  // clock is live, AND the player is passive, the scene is stalled even if it looks intense.
  const INTERNAL_THREAD = /\b(collaps|awe|realiz|understand|awaken|existential|feeling|inner|spiritual|grief|accept|reckon|contempl|peace|doubt|faith|recogni|devotion|worship|reverence)\b/i;
  const plotThreads = (state.world.threads ?? []).filter((t) => (t.tension ?? 0) >= 3 && !INTERNAL_THREAD.test(`${t.title} ${t.description}`));
  const liveThread = plotThreads.length > 0;
  const pendingCons = (state.world.consequences ?? []).some((c) => c.status === "pending");
  const liveClock = (state.world.clocks ?? []).some((c: any) => c?.threshold && (c.progress ?? 0) < c.threshold);
  // stalled: no OUTWARD plot pressure of any kind, and the player isn't supplying momentum either
  const stalled = !liveThread && !pendingCons && !liveClock && playerInert;
  // STALL_BREAK only when there is truly no momentum: no outward pressure, a passive player, AND no
  // present character with a drive to carry the scene. If a present character wants something, the
  // drive system above already handed them the wheel — inventing an external event on top would be a
  // manufactured cascade. STALL_BREAK is the last resort for a genuinely dead scene.
  const stallDirective = (stalled && !restoration && drivers.length === 0)
    ? `\nAPPLY POLICY STALL_BREAK${tier === "cosmic" || tier === "mythic" ? " (beyond-threat variant)" : ""} — nothing external is pushing the plot, the player is passive, and no present character has a goal to pursue: advance a STANDING source (an open thread, a maturing clock, an offscreen character's goal) concretely into the scene and end on it. Only if truly nothing stands may a small ambient development occur — witnessed nearby, never targeted at the player.`
    : "";

  // ── DITHER-BREAK ── The opposite failure to a stall: the PLAYER is actively pushing (long
  // dialogue, a direct demand, a plea for a choice) but the NARRATOR keeps writing the same
  // on-the-verge beat every turn — a character opens and closes their mouth, "stops," swallows,
  // "couldn't," trails off, and the decision is deferred AGAIN. Rules 30/90 (feeling → fragments,
  // trailing off) plus rule 15's "let unfinished beats continue" collude into an infinite
  // hesitation loop that reaction-prose happily sustains. Detect it structurally: the last few
  // narrator beats are saturated with verge-markers and NOBODY lands anything. When that holds and
  // the player is NOT passive (they're the ones demanding motion), force the decision to land now.
  const VERGE = /\b(swallow(?:ed|s|ing)?|stopped\.|(?:she|he|they) stopped|trail(?:ed|ing)? off|didn'?t finish|opened.{0,8}closed|mouth (?:opened|worked|closed)|couldn'?t (?:speak|answer|say)|the words (?:hung|wouldn'?t|caught|died)|on the verge|voice cracked|not yet\.|almost said)\b/i;
  const recentProse = state.history.slice(-4).filter((h) => h.narrator_prose).map((h) => h.narrator_prose as string);
  const vergeTurns = recentProse.filter((p) => VERGE.test(p)).length;
  // dithering = 3+ of the last 4 narrator beats are verge-saturated, the player is actively pushing
  // (not passive), and this isn't a deliberately quiet restoration scene.
  const dithering = vergeTurns >= 3 && !playerInert && !restoration && recentProse.length >= 3;
  const ditherDirective = dithering
    ? `\nAPPLY POLICY DITHER_BREAK — a character has been ON THE VERGE of a decision or admission for several turns now (mouth opening and closing, swallowing, stopping mid-sentence, the moment endlessly deferred), and the player is actively pushing for it to land. STOP deferring. This turn, the character in question MAKES THE DECISION or SPEAKS THE THING and ACTS on it — concretely, in words and body, with consequences that change the situation. The feeling has already been established across the prior beats; do not re-establish it. No more "she stopped," no more trailing off, no more "not yet," no fresh hesitation to replace the old one. They choose, they say it plainly, they do something about it, and the scene MOVES to what is true after the choice. A character can decide clumsily, partially, or against their own interest — but they DECIDE. Landing the beat imperfectly is the goal; hovering at the edge one more turn is the failure.`
    : "";

  // ── ATMOSPHERE_BREAK ── The failure where a story becomes ALL mood and no plot: turn after turn of
  // mist, wet moss, dripping branches, a rigid silent character — sensory texture standing in for
  // events, nothing ever happening, no one pursuing anything. Distinct from DITHER_BREAK (a character
  // stuck mid-decision): here the WORLD is inert, drowned in atmosphere. Detect it structurally — the
  // recent beats are saturated with ambient/sensory description AND carry almost no event verbs (no one
  // acts, decides, moves on a goal, arrives, takes, changes anything). When that holds for several
  // turns, force a concrete development this turn — whether the player is pushing or quiet, because an
  // atmosphere-locked story fails the player either way.
  const ATMOS = /\b(mist|fog|drizzl|damp|moss|sphagnum|birch|pine|drip(?:ping|s)?|grey light|diffuse|the (?:air|silence|quiet|cold)|scent of|metallic tang|clung? to the skin|rain-soaked|sodden|wet earth|churned mud|low-hanging)\b/i;
  const EVENTVERB = /\b(grab|grabb|seize|seized|strike|struck|hit|throw|threw|pull|pulled|push|shoved?|run|ran|flee|fled|draw|drew|fire|fired|shot|stab|swing|swung|lunge|charge|arrive|arrived|burst|enter|reach|reached|take|took|hand|gave|open|opened|break|broke|shout|scream|yell|demand|order|attack|kill|walk(?:ed)? (?:in|up|over|to|toward)|steps? (?:in|out|toward|into)|crosses?|climbs?|kneel|stand|stood up|turns? and)\b/i;
  const atmosSaturated = recentProse.filter((p) => ATMOS.test(p)).length >= 3;
  const eventStarved = recentProse.filter((p) => EVENTVERB.test(p)).length <= 1;
  // present characters who could actually generate an event (have a drive, or are hostile/threatening)
  const canGenerateEvent = drivers.length > 0 || presentNpcs.some((id) => {
    const cc = state.characters[id];
    return cc && (cc.conscience ?? 0.6) <= 0.35;
  });
  const atmosphereLocked = atmosSaturated && eventStarved && recentProse.length >= 3 && !restoration;
  if (atmosphereLocked) {
    directive += `\nATMOSPHERE_BREAK — the last several turns have been almost entirely MOOD: mist, wet moss, dripping branches, silence, a character standing rigid — sensory texture where events should be. Atmosphere is not plot, and a story that is only atmosphere has stalled. THIS TURN something concrete HAPPENS and changes the situation: ${canGenerateEvent ? `a present character ACTS on what they want (moves, takes, demands, threatens, reaches for something, forces the issue) — pick the one with the strongest drive or the most menace and let them MAKE a beat` : `a standing pressure lands — an arrival, a discovered thing, a threat closing, a consequence of what was already set in motion`}. Not another sensory paragraph, not a character "listening to the trees," not a held silence — an actual event with a before and an after. End the turn on what changed, not on the weather.`;
  }

  // ── POV INTERIORITY FILTER ── The scene is the player's to READ, not the narrator's to explain.
  // The cardinal leak: the narrator states another character's sealed interior as fact to the player
  // ("xe doesn't say what xe actually meant, which is that xe...") — handing over exactly the private
  // thing the character withheld. That removes all epistemic friction: the player never has to read
  // anyone, never risks being wrong, always wins. Fix: the narrator's ACCESS to other minds is bounded
  // by the PLAYER'S own openness, the inverse of the mind-layer perception gate. A clenched, dysregulated
  // player does not receive clean telemetry on others' feelings — a clenched nervous system is a bad
  // reader of other people, projecting and missing. So the render must degrade: surface only, and where
  // feeling is implied it is the PLAYER'S (possibly wrong) read, free to omit, misattribute, or fixate
  // on the wrong signal. Only a relaxed player earns accurate insight into what others feel.
  const pcRelax = state.condition["char_player"]?.psyche.relaxation ?? 0; // -10..+10
  // INTERIOR-HEAVY GUARD — when a "do" action is mostly the player thinking/planning/musing with
  // little actual physical action, the narrator is most tempted to mine that interior for plot
  // (player muses about electrician work → an NPC volunteers electrician leads). Detect the shape —
  // first-person plan/wish/rumination language, especially "I keep thinking / I should / I could /
  // maybe / I'll ... later" — and, when present, hard-remind that this turn's interior is inert:
  // it may color the player's own body and experience, but the world must not answer or be built
  // around it. Only speech and physical acts are inputs.
  const musingHits = (action.match(/\b(i keep thinking|i should|i could|i need to|maybe i|i'?ll (?:find|go|see|look|try)|i want to|i'?m thinking|thinking about|i wonder|part of me|i tell myself)\b/gi) ?? []).length;
  const spoke = /"[^"]+"/.test(action);
  const interiorHeavy = mode === "do" && musingHits >= 2 && !spoke;
  const interiorGuard = interiorHeavy
    ? `\nINTERIOR IS INERT THIS TURN — the player's action is mostly private thought/planning (musing about what they might do, where they might go, what they could become). This interior is NOT a story input: it shapes only the player's own experience and what their body does, and the world CANNOT see, answer, or be built around it. Do NOT have any character raise, offer, or respond to the subject of the player's private thoughts (a job they mused about, a plan they turned over, a wish). Render only the physical action the player actually took, and let the world proceed from its OWN standing state — the present character's own want and the live threads — indifferent to what the player was thinking. If the only physical act was small (finishing food, walking over), the scene stays small; do not manufacture a development to match the player's rumination.`
    : "";
  const povFilter = pcRelax <= -3
    ? `\nPOV — READ, DON'T REPORT (player is clenched, relaxation ${Math.round(pcRelax)}): The player is dysregulated and is therefore a BAD reader of other people right now. Do NOT state any other character's inner feelings, motives, or unspoken meaning as fact. Forbidden absolutely: narrator lines that reveal what someone "really" means, "doesn't say," "actually feels," or is thinking behind their words — especially a character's withheld or sealed interior. Render only what the player can SEE and HEAR: face, posture, tone, motion, the words actually spoken, the body. Where feeling colors the scene at all, it is the PLAYER'S projection onto them — and a clenched read is often WRONG: it may misattribute (see coldness where there's fear, rejection where there's confusion), fixate on the wrong signal, or miss what the other person is plainly feeling. You MAY let the player misread. You may omit an emotion the other character is actually having if the player wouldn't catch it. Leave the others' interiors OPAQUE — a surface the player has to interpret, and can get wrong.`
    : pcRelax < 3
    ? `\nPOV — mostly surface (player relaxation ${Math.round(pcRelax)}): Render other characters from the OUTSIDE — what shows in face, voice, and act. You may imply feeling through behavior but do NOT hand the player a character's exact unspoken thought or sealed interior as narrator-fact. If someone is withholding something, let it stay withheld and visible only as a pressure under their surface; the player has to read it, and may read it wrong.`
    : `\nPOV — clear-eyed (player relaxation ${Math.round(pcRelax)}): The player is open and reads people well right now, so their INFERENCES about others tend to be ACCURATE — but they are still inferences, made from the outside, never omniscient fact. You may let the player's read land close to the truth (a correct sense of what's under someone's surface), framed as the player perceiving/sensing it, NOT as the narrator declaring another mind's sealed contents. Still never write "xe doesn't say what xe really means, which is X" — instead "something in how xe says it makes him think X," leaving the player the one reading, and leaving room to be wrong.`;

  // forbidden_as_primary stops the NARRATOR from reaching for a theme unprompted as a lazy
  // plot-solver. In god mode it is suppressed entirely (the player is sovereign). Outside god
  // mode it restrains the narrator's own plotting only — never an action the player declares.
  const forbid = (!god && state.world_bible.forbidden_as_primary?.length)
    ? `\nNever the primary engine of this scene: ${state.world_bible.forbidden_as_primary.join("; ")}. (This restrains your own unprompted plotting; it does not override an action the player explicitly declares.)`
    : "";
  // HARD FORBIDDEN GATE: the bible's `forbidden` list is banned content for this world, and unlike
  // forbidden_as_primary it isn't merely "not the focus" — it must not be INTRODUCED by you at all.
  // This was previously only a passive line at the top of the prompt with no enforcement, so the
  // thread/tension system could spin up forbidden plot (e.g. a stalker/violence thread in a world
  // whose bible says "no violence as plot driver"). Enforce it per-turn at the high-compliance spot.
  const forbiddenGate = (!god && state.world_bible.forbidden?.trim())
    ? `\nFORBIDDEN IN THIS WORLD — do NOT introduce, escalate toward, or build a thread around any of these, even if a tension or thread seems to point that way: ${state.world_bible.forbidden.trim()}. If an existing thread or the current momentum is heading into forbidden territory, steer the scene away from it rather than into it. This restrains YOUR plotting; it does not punish something the player themselves explicitly chose to make happen.`
    : "";
  // NAMED-ENTITY FABRICATION GUARD — a recurring catastrophic failure: a stray name or passing mention
  // ("David Attenborough" in a joke, an offhand "my ex") gets reconstructed under pressure into a
  // fully-formed person with a backstory and a threat. Block that explicitly at the high-compliance spot.
  // (fabrication guard now lives in the cached system prompt as an every-turn rule)

  if (god) {
    // detect an ONGOING / escalating declaration vs a discrete one-and-done act. "I will kill this
    // realm", "I begin unmaking the city", "I start tearing it all down" initiate a PROCESS that must
    // visibly unfold and accelerate this turn — not be rendered as a single tremor and a promise of
    // more later. This is the milquetoast trap: the player supplies huge momentum and the narrator
    // spends it on atmosphere and reaction instead of delivering the escalating event.
    const lowerAct = action.toLowerCase();
    const ongoing = /\b(i('?m| am| will| shall|'ll)?\s*(going to|begin|start|am beginning|will begin)\b|\bkill (this|the) (realm|world|planet|city|place)\b|\bunmak\w*|\btear\w* (it|this|the) .*(down|apart|realm|world|place)|\bbring\w* (it|this|them|the|this) (whole )?(place|realm|world|city)?\s*(all )?down|\bend (this|the) (realm|world|place|everything)|\bdestroy\w* (everything|it all|the realm|the world|this place|the place))/i.test(lowerAct);
    directive += `\nGOD MODE — THE PLAYER IS ABSOLUTELY SOVEREIGN. Whatever the player declares happens, completely, immediately, at exactly the scale and intensity they state, with no cost unless they narrate one. This overrides everything else: the magic rules, the difficulty profile and its lethality setting, the forbidden list, "consequence not catastrophe," "fair scale," and your own instinct to keep things small or safe. Never downscale, soften, delay, deflect, reinterpret, or substitute a tamer version of what they declared. If they kill millions, millions die as real bodies. If they remake a city, the city is remade.`;
    if (ongoing) {
      directive += `\nTHE PLAYER HAS INITIATED A LARGE, ONGOING ACTION — it must VISIBLY UNFOLD AND ACCELERATE this turn, not be rendered as a hint of things to come. The single worst failure here is decompressing a declared cataclysm into atmosphere: one tremor, a flickering torch, a character who "doesn't finish the sentence," a promise that it will happen soon. NO. If they said they are killing the realm, the realm is DYING NOW and fast — show it concretely and at scale this turn: structures failing, the ground opening, the sky changing, people dying en masse, the physical process tearing through everything, escalating paragraph by paragraph. Deliver the event in progress, not the warning before it. Reaction is at most a sentence amid the cataclysm; the cataclysm itself is the turn. End mid-acceleration with the thing well underway, not poised to begin.`;
    } else {
      directive += `\nThe player's act is done as declared. Now show the world's honest reaction to it — drawn from each present character's own state and relationship to the player, never from a script, and never by undoing or shrinking what happened. But reaction is not a substitute for events: if the moment calls for the story to keep moving, move it.`;
    }
  }

  // (dialogue + agenda duties now live in the cached system prompt as every-turn rules)
  const earnedResponse = (tier === "mythic" || tier === "cosmic")
    ? `\nAPPLY POLICY EARNED_RESPONSE — the player operates at extraordinary scale; the world responds at that scale.\nCONTINUITY UNDER THE IMPOSSIBLE: the player just did something reality-bending (moved someone, undid a thing, bent space). Render that act cleanly and literally — but the REST of the world stays COHERENT. Every character keeps their established identity, name, role, and relationships exactly as the ledger has them; do not let anyone's status silently flip (an apprentice does not become a master, a stranger does not become a friend) unless the player's act explicitly caused it. Track WHO IS PRESENT precisely: if the player removed someone from the scene, they are GONE until brought back; if the player returned them, they are present again, unchanged. One impossible thing happened; everything else obeys normal continuity. Do not spawn random events, reassign lines between characters, or let the scene dissolve — anchor hard to the established cast and their standing state.\nWITNESS REACTION MUST FLOW FROM WHAT THEY SAW — this is the crucial one. Any character who just WITNESSED the player do the impossible has their entire relationship to the player REWRITTEN by it in that instant. They are no longer dealing with a peer, a rival, or someone they can scold, bargain with as an equal, or lecture. A person who watched someone get snapped off the planet with a gesture does NOT plant their feet and argue with the one who did it — that is a scripted "someone challenges the protagonist" beat imported regardless of the facts, and it is FORBIDDEN here. Instead the witness reacts as a real person confronted with overwhelming power: fear, awe, flight, careful submission, stunned silence, frantic appeasement, worship, or a very cautious approach — whichever their NATURE produces under the genuinely impossible. Wounded pride, indignation, and moral confrontation are only available to someone who has NOT grasped what they just saw, or whose nature is recklessly defiant to the point of self-destruction — and even then it reads as terror or denial underneath, never casual equality. Do NOT manufacture a confrontation or a moral challenge against a being the character has just seen wield godlike power. Their behavior bends around the fact of that power, always.`
    : "";
  // CONTRACT GOVERNOR: when the last chapter audit found the story drifting from its standing
  // direction, every turn carries a course-correction until the next audit passes. This is the
  // machinery that was missing when a "romantic/erotic literary fiction" ran 163 turns of
  // tribunal procedure with nobody noticing.
  const contractFix = state.contract_drift
    ? `\nCOURSE-CORRECTION (the story has drifted from its contract): ${state.contract_drift} Steer back through present characters' wants and the standing direction — not with a lurch, but starting THIS turn.`
    : "";
  // ── REST PROTECTION, scaled by tension. Low tension: rest is sacred, the world holds its
  // breath. Mid tension: one soft knock at most, and whatever interrupts must let them finish —
  // the meal gets eaten, the night gets slept, THIS turn. High tension (7+): the world is
  // genuinely on fire and may not care — but the mechanical credit below still lands.
  const tensionNow = state.model_settings.tension ?? 5;
  const restProtection = restoration
    ? tensionNow <= 3
      ? `\nREST IS SACRED at this tension: the player is restoring (sleep, food, bath, quiet). Do NOT interrupt, complicate, or truncate it — no knocks, no summons, no discoveries. Let it complete in full, let time pass gently, and hold all friction at the threshold for when they rise.`
      : tensionNow <= 6
        ? `\nREST PROTECTION: the player is restoring (sleep, food, bath, quiet). An interruption is permitted ONLY if it is brief, resolvable, and the restoration RESUMES AND COMPLETES within this same turn — a knock, never a siege; once, never twice. The meal gets finished; the night gets slept. Do not convert rest into an incident.`
        : ""
    : "";
  // FATE LAST. It outranks rest-protection and the quiet-scene rules: a story whose budget is spent
  // does not get to be asleep. Everything above may shape the scene; fate decides that it happens.
  const fateNote = fateDirective(fate, state.destination_progress?.missing);
  // PRONOUN LOCK. When canon declares the world's people all use one non-default set (xe/xem etc.),
  // the narration tag on each sheet isn't enough: characters keep saying "him"/"her" in DIALOGUE,
  // because the player has their own pronouns and the narrator sees those words as valid nearby. So
  // reassert it loudly every turn, name the specific failure, and separate narration from speech.
  const worldPro = detectWorldPronoun(state.world.canon);
  const playerPro = (state.characters["char_player"]?.pronouns ?? "").trim();
  const pronounLock = worldPro
    ? `\n\nPRONOUN LAW — this world's people use ${worldPro} and NOTHING ELSE. This is not a preference; their language contains no other pronoun. Two separate rules:\n1) NARRATION: refer to every ${worldPro.split("/")[0]}-using character with ${worldPro}. Never "he/him/his" or "she/her/hers" for them, not once.\n2) DIALOGUE: a ${worldPro.split("/")[0]}-speaker CANNOT say "he", "him", "his", "she", "her", or "hers" — those words do not exist for them. When one of them refers to anyone, they say ${worldPro}. This includes referring to the player.${playerPro && playerPro !== worldPro ? ` The player uses ${playerPro}, and the player may use those words about himself — but a native hearing them finds them alien and does not adopt them. If a native repeats the player's odd word, that is a deliberate, marked moment (curiosity, mockery, testing), never a casual slip.` : ""}\nIf you catch yourself about to write a native saying "him" or "her", stop: they would say ${worldPro.split("/")[1] ?? worldPro}.`
    : "";
  const fullDirective = directive + forbid + forbiddenGate + earnedResponse + stallDirective + ditherDirective + povFilter + interiorGuard + (fate.forceArrival || fate.act === "convergence" ? "" : restProtection) + contractFix + "\n" + (restoration && tensionNow <= 3 && !fate.active ? "" : undertow.directive) + fateNote + pronounLock;
  // A player-supplied ((query)) forces grounding on for this turn even if the toggle was off.
  const groundOn = opts?.ground === true || !!searchTarget;
  // RESOLVED QUERY — prefer the player's explicit ((target)). Otherwise, when grounding is on via
  // the toggle, derive a focused query from the SCENE (place + freshest canon) rather than letting
  // Exa auto-derive from the whole digest — that auto-query is exactly what pulled off-topic links.
  const resolvedQuery = searchTarget
    || (opts?.ground === true
        ? [state.world.player_location, ...(state.world.canon ?? []).slice(-2)].filter(Boolean).join(" — ").slice(0, 200)
        : "");
  const groundNote = groundOn ? `\n\n=== GROUNDING (this turn) ===\nThis story is set in a real place / based on real subject matter. Use web search to get the real-world facts right${resolvedQuery ? ` about: ${resolvedQuery}` : ""} — actual locations, layouts, names, how things really work, accurate period or setting detail — and weave that accuracy naturally into the prose. Do not cite sources or break the fiction; just be correct.` : "";
  // ── CONTEXT MODE ──────────────────────────────────────────────────────────
  // "digest" (classic): system + stable prefix + full digest rebuilt each turn. Correct, but only
  //   the prefix rides the provider cache.
  // "chatlog" (append-only): the SillyTavern economics. The conversation IS the context: a full
  //   state I-frame is anchored into the system message every `iframe_cadence` turns, and each
  //   turn thereafter appends only [player action] / [prose] pairs plus a small P-frame delta of
  //   live state. Between anchors the entire growing history is byte-identical, so providers with
  //   implicit prefix caching (DeepSeek ~0.1x, Gemini ~0.25x, Anthropic cache_control) bill almost
  //   all input at the cached rate. Re-anchoring resets the cache once per window — amortized.
  const chatlog = state.model_settings.context_mode === "chatlog";
  let narratorMsgs: any[];
  if (chatlog) {
    const cad = Math.max(2, state.model_settings.iframe_cadence ?? 6);
    const castSig = Object.entries(state.characters)
      .filter(([, c]) => c.status !== "dead" && c.status !== "departed" && c.central !== false && !c.paged)
      .map(([id]) => id).sort().join(",");
    const anchor = state.context_anchor;
    const stale = !anchor || (turn - anchor.turn) >= cad || anchor.cast_sig !== castSig;
    if (stale) state.context_anchor = { turn, digest: `${prefix}\n\n${digest}`, cast_sig: castSig, ledger: ledgerSnapshot(state) };
    const a = state.context_anchor!;
    const pairs = state.history
      .filter((h) => h.kind !== "opening" && h.kind !== "interlude" && h.turn >= a.turn)
      .slice(-cad)
      .map((h) => ({ user: h.player_action, assistant: h.narrator_prose }));
    narratorMsgs = buildChatlogMessages(
      narratorSystem(lean), a.digest, pairs,
      `${deltaNote(state, memQuery)}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}${intentForNarrator(intents)}${habitVerdict}${noveltyNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}${sovereignty(state)}`,
      state.model_settings.narrator_model,
    );
  } else {
    narratorMsgs = buildMessages(
      narratorSystem(lean), prefix,
      `${digest}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}${intentForNarrator(intents)}${habitVerdict}${noveltyNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}${sovereignty(state)}`,
      state.model_settings.narrator_model,
    );
  }
  let prose = "";
  let narratorUsage: import("../llm").Usage = { prompt_tokens: 0, completion_tokens: 0 };
  let narratorTruncated = false;
  if (opts?.proseOverride) {
    // RESUME PATH: the narrator already ran (and was paid for) before the app was killed —
    // iOS suspends web pages the moment they background, so a mid-turn death strands the prose
    // with no bookkeeping. The journaled prose re-enters here and everything downstream —
    // simulator, applyDiff, physiology, reflection, chapters, telemetry — runs identically.
    prose = opts.proseOverride;
  } else {
    const stream = completeStream(narratorMsgs, state.model_settings.narrator_model, state.model_settings.fallback_model, 5000, groundOn, resolvedQuery || undefined);
    let narratorSources: { url: string; title?: string }[] | undefined;
    while (true) {
      const { done, value } = await stream.next();
      if (done) { prose = value.text; narratorUsage = value.usage; narratorSources = value.annotations; narratorTruncated = !!value.truncated; break; }
      ev.onDelta(value);
    }
    // DEAD-TAB GUARD (iOS). Safari suspends/kills a backgrounded page within seconds; if it dies
    // mid-narrator-stream we get back an EMPTY prose — which is NOT a refusal. Running the refusal
    // path here would buy a whole fallback paragraph to replace a stream that was merely interrupted,
    // and commit it. An empty stream means "the tab died", so abort silently: nothing is committed,
    // the world is unchanged, and the turn can be cleanly retried/resumed when the user returns.
    if (!prose || !prose.trim()) {
      console.warn("[turn] empty narrator stream — treating as an interrupted/dead tab, not a refusal; aborting turn cleanly");
      return;
    }
    // REFUSAL → FALLBACK. The narrator model can hit its own safety filter on legitimate in-fiction
    // content (a violent threat, dark material) and return a canned refusal — often in the model's
    // native language (e.g. a Chinese model emitting "我无法给到相关内容"), or a terse "I can't provide
    // that." Left unchecked, that refusal gets stored AS the turn's narration and poisons the save.
    // Detect it and re-run the SAME turn on the fallback model, which usually isn't gated the same way.
    if (isRefusal(prose, state.world_bible)) {
      console.warn(`[turn] narrator refusal detected ("${prose.slice(0, 40)}…") — retrying on fallback model`);
      ev.onMeta?.({ shifts: [`narrator model declined this turn — retrying on fallback`] });
      const fb = state.model_settings.fallback_model || "google/gemini-2.5-flash";
      try {
        const retry = completeStream(narratorMsgs, fb, fb, 5000, groundOn, resolvedQuery || undefined);
        let rprose = "";
        while (true) {
          const { done, value } = await retry.next();
          if (done) { rprose = value.text; if (value.usage) narratorUsage = value.usage; narratorTruncated = !!value.truncated; break; }
          ev.onDelta(value);
        }
        if (rprose && !isRefusal(rprose, state.world_bible)) prose = rprose;
        else { prose = ""; ev.onMeta?.({ shifts: [`both narrator models declined this turn — no narration written; try rephrasing`] }); }
      } catch (e) {
        prose = "";
        console.warn(`[turn] fallback narrator also failed: ${e}`);
      }
    }
    // GROUNDING RECEIPT — the search is invisible unless we show it. Cited sources prove it ran;
    // zero sources is worth saying out loud too, so "grounded" never silently means "wasn't".
    if (groundOn) {
      const hosts = [...new Set((narratorSources ?? []).map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return s.url; } }))];
      const qTag = resolvedQuery ? ` [${resolvedQuery.length > 48 ? resolvedQuery.slice(0, 48) + "…" : resolvedQuery}]` : "";
      ev.onMeta({ shifts: [hosts.length
        ? `web-grounded${qTag} — ${hosts.length} source${hosts.length > 1 ? "s" : ""}: ${hosts.slice(0, 3).join(", ")}`
        : `web grounding${qTag}: search returned no sources — this turn wrote from memory`] });
    }
  }
  // BOTH MODELS REFUSED — if we have no prose after the fallback retry, do NOT run the bookkeeper on
  // nothing or commit an empty turn (which would poison the save the way the raw refusal string did).
  // Abort cleanly: the world is unchanged, the player can rephrase and try again.
  if (!prose.trim()) {
    ev.onMeta?.({ shifts: ["no narration this turn — both models declined. The scene is unchanged; try rephrasing your action."] });
    return;
  }
  // TELEMETRY BACKSTOP — some streaming routes omit the usage block on the final chunk, so
  // narratorUsage can come back all-zeros even though the narrator clearly ran (we have prose).
  // Rather than log a phantom "0 tokens" turn, estimate from text length (~4 chars/token): prompt
  // from the assembled narrator messages, completion from the prose. Marked approximate via cost 0.
  if ((narratorUsage.prompt_tokens ?? 0) === 0 && (narratorUsage.completion_tokens ?? 0) === 0 && prose) {
    const est = (s: string) => Math.max(1, Math.round((s?.length ?? 0) / 4));
    const promptChars = JSON.stringify(narratorMsgs ?? []).length;
    narratorUsage = { ...narratorUsage, prompt_tokens: est(" ".repeat(promptChars)), completion_tokens: est(prose) };
  }
  // The narrator's own account of where the scene is and who moved. Authoritative — it wrote the scene.
  const parsedScene = parseSceneFooter(prose);
  prose = stripMeta(parsedScene.prose);
  // ── TURN-ENDING GUARDS ── Deterministic, zero-cost backstops for the two overrun patterns the
  // prompt can't fully prevent: a CASCADE (the turn keeps escalating past the first new pressure) and
  // a PREEMPT (an NPC resolves the player's choice by moving their body after a demand). Both are
  // detectable in the final paragraph. When caught, we TRIM to the paragraph before the overrun rather
  // than regenerate — output is prose paragraphs, so a paragraph cut is safe, and stopping earlier is
  // exactly the fix. We only ever trim the LAST paragraph, and only when 2+ remain, so a turn always
  // keeps its substance.
  {
    const paras = prose.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (paras.length >= 2) {
      const last = paras[paras.length - 1];
      const priorText = paras.slice(0, -1).join(" ").toLowerCase();
      // PREEMPT: after a demand/grab was already in play, the final paragraph moves the PLAYER'S body
      // for them ("pulling you", "drags you", "grabs your wrist/arm", "hauls you", "shoves you").
      const bodyMoved = /\b(pull(s|ing|ed)?|drag(s|ging|ged)?|haul(s|ing|ed)?|shov(e|es|ing|ed)|yank(s|ing|ed)?|drav?g(s|ging)?|steer(s|ing|ed)?|march(es|ing|ed)?|forc(e|es|ing|ed))\b[^.?!]{0,30}\byou(r)?\b[^.?!]{0,20}\b(wrist|arm|hand|shoulder|collar|toward|into|through|down|away|along|to (his|her|their|the))\b/i.test(last);
      const demandInPlay = /\b(stop|halt|come with|hand it|give me|on your knees|don'?t move|now|or (i|we|you)|drop it|move|get (up|down|back))\b/i.test(priorText) || /["""][^"""]*[?!][^"""]*["""]/.test(priorText);
      // CASCADE: the final paragraph introduces a NEW named arrival AND has them speaking/acting —
      // i.e. a fresh pressure stacked on top of whatever the turn already delivered.
      const newArrivalActing = /\b(appear(s|ed|ing)?|arriv(e|es|ed|ing)|burst(s|ing)?|storm(s|ed|ing)? (in|through)|round(s|ed)? the corner|step(s|ped|ping)? (in|into|through)|enter(s|ed|ing)?|in the doorway|behind (you|them|him|her))\b/i.test(last)
        && /["""][^"""]{2,}["""]/.test(last);

      if ((bodyMoved && demandInPlay) || newArrivalActing) {
        prose = paras.slice(0, -1).join("\n\n");
        console.warn(`[turn] ending guard: trimmed a ${bodyMoved ? "preempt" : "cascade"} tail paragraph so the turn ends on the first pressure`);
      }
    }
  }
  let footer = parsedScene.footer;
  // TRUNCATION SAFETY NET. If the narrator hit the output cap, its tail (the scene footer) may have
  // been cut past even the tolerant parser's reach. Rather than let the simulator GUESS the scene
  // (the resolver then dumps invented moves to `elsewhere`, dragging the player with them), synthesize
  // a conservative footer: the scene stayed where it was, nobody moved. Any real move the prose
  // actually describes is still caught downstream by the quote-evidence check on the simulator's own
  // locations[]. A no-op footer is always safe; a guessed one is not.
  let truncationNote = "";
  if (narratorTruncated && !footer) {
    const hereName = state.world.places[state.world.player_location]?.name;
    footer = { place: hereName, entered: [], left: [] };
    truncationNote = "(the narrator's reply ran long and was cut off — the scene was held in place; if someone should have entered or left, say so next turn)";
  } else if (narratorTruncated) {
    truncationNote = "(the narrator's reply ran long and may have been cut short)";
  }

  // 3 ── simulator (one JSON call: bookkeeper + world tick + memory writes)
  ev.onPhase("simulator");
  // The bookkeeper gets its OWN minimal context (roster, ledgers, open bookkeeping objects) —
  // not the narrator's prefix+digest. This cuts its input by more than half AND removes the
  // prose-adjacent noise a small model confabulates from. The prose it must transcribe is the
  // last thing it reads.
  // Light models (flash/lite/mini/haiku/nano tiers) reliably fail the FULL 23k-char contract —
  // they return bare or malformed diffs and the story silently stops being recorded. The LEAN
  // contract carries the same schema with half the instruction mass; give it to them always.
  const lightSim = /flash|lite|mini|nano|haiku|8b|9b/i.test(state.model_settings.simulator_model);
  // The bookkeeper needs the player's RAW action (channels intact, WITHOUT the narrator-facing
  // instruction brackets that MODE_FRAME adds) — those brackets tell the NARRATOR to hide the
  // player's feeling from the page, and a bookkeeper reading "do NOT state the feeling" could wrongly
  // drop it from the ledger too. The opposite is required: the player's interior — their stated
  // thoughts, feelings, and (parenthetical) inner state — is the AUTHORITATIVE signal for the
  // player's own valence, truer than anything inferable from the deliberately-opaque prose. The
  // narrator hides it; the bookkeeper must consume it directly.
  const bookkeeperAction = `${action}\n[The above is the player's own input across channels: "quotes" = said aloud, *asterisks* = private thought, (parentheses) = private inner state, the rest = physical action. For char_player's relaxation_delta and mood, READ THE PLAYER'S INTERIOR DIRECTLY — their thoughts, stated feelings, and (parenthetical) state are the truest evidence of how the player feels this turn, even though the narrator deliberately kept it off the page. Do not infer the player's mood only from the neutral prose; the interior here is the primary signal. (Other characters still cannot know this interior — it drives only the player's own valence, never what others learned or how they react.)]`;
  const simMsgs = buildMessages(
    simulatorSystem(lean || lightSim) + "\n\n" + simulatorSchemaHint(),
    simulatorContext(state),
    `${(state.retcons ?? []).length ? `=== STRUCK FROM THE STORY (never happened; if the prose references any of these, IGNORE that part entirely — record nothing from it) ===\n${(state.retcons ?? []).map((r) => `- ${r.text}`).join("\n")}\n\n` : ""}=== LOCATIONS (the places this world knows; use one exactly where it fits, or "elsewhere") ===\n${Object.values(state.world.places).filter((p) => p.id !== OFFSCENE).map((p) => `- ${p.name}`).join("\n")}\n- elsewhere (not in a tracked place)\n\n=== PLAYER ACTION ===\n${bookkeeperAction}${intentForBookkeeper(intents)}\n\n=== NARRATOR PROSE (what was RENDERED — deliberately hides the ground truth above; when the GROUND TRUTH and the prose differ, the TRUTH is authoritative for what to record) ===\n${prose}`,
    state.model_settings.simulator_model,
  );
  let simUsage: import("../llm").Usage = { prompt_tokens: 0, completion_tokens: 0 };
  let diff = emptyDiff();
  let simOk = false;
  // shared vitality measure — a diff can PARSE fine yet carry nothing that changes the world
  // (just scene_summary + elapsed_minutes). That is the quiet form of the dead-black-hole bug:
  // simOk=true, watchdog counts it dead, but nothing was ever done to recover the turn. We use
  // this both to trigger a recovery pass here and for the watchdog below.
  const vitalityOf = (d: Partial<SimulatorDiff>): number =>
    (d.memories?.length ?? 0) + (d.facts?.length ?? 0) + ((d as any).facts_learned?.length ?? 0) +
    (d.offscreen?.length ?? 0) + (d.new_characters?.length ?? 0) + (d.canon_add?.length ?? 0) +
    (d.psyche?.filter((x) => (x.relaxation_delta ?? 0) !== 0 || x.mood || x.states_add?.length || x.states_remove?.length).length ?? 0) +
    (d.edges?.filter((x) => (x.warmth_delta ?? 0) !== 0 || (x.trust_delta ?? 0) !== 0 || ((x as any).attraction_delta ?? 0) !== 0 || x.roles_set?.length).length ?? 0);
  const proseWords = prose.split(/\s+/).filter(Boolean).length;
  try {
    // constrained decoding: providers that support json_schema enforce the diff shape at the
    // decoder; `complete` transparently falls back to json_object where unsupported.
    const simOpts = state.model_settings.sim_route_speed !== false ? { providerSort: "throughput" as const } : undefined;
    // ADAPTIVE ESCALATION — if the simulator has been failing (see watchdog below), temporarily route
    // bookkeeping to the fallback model for a few turns. A different model often clears whatever context
    // was choking the primary; it auto-clears after a healthy streak. Only meaningful when they differ.
    const escalated = (state.sim_escalated_until ?? 0) >= turn && state.model_settings.fallback_model && state.model_settings.fallback_model !== state.model_settings.simulator_model;
    const simModel = escalated ? state.model_settings.fallback_model : state.model_settings.simulator_model;
    const res = await complete(simMsgs, simModel, state.model_settings.fallback_model, { schema: SIMULATOR_JSON_SCHEMA, name: "weft_diff" }, 3000, simOpts);
    simUsage = res.usage;
    const parsed = safeJson<Partial<SimulatorDiff> | null>(res.text, null);
    if (parsed && Object.keys(parsed).length) { diff = { ...emptyDiff(), ...parsed }; simOk = true; }
    else if (res.text.trim()) {
      // RESCUE: a malformed diff used to be swallowed silently — the turn applied NOTHING and
      // every character quietly failed to remember it (a major source of "amnesia"). One cheap
      // repair round-trip fixes most cases.
      const fix = await complete(
        [{ role: "system", content: "The following was supposed to be one strict JSON object but failed to parse. Re-emit it as VALID JSON only — same content, no commentary, no markdown fences." },
         { role: "user", content: res.text.slice(0, 6000) }],
        state.model_settings.simulator_model, state.model_settings.fallback_model, true, 3000);
      simUsage.prompt_tokens += fix.usage.prompt_tokens; simUsage.completion_tokens += fix.usage.completion_tokens;
      const reparsed = safeJson<Partial<SimulatorDiff> | null>(fix.text, null);
      if (reparsed && Object.keys(reparsed).length) { diff = { ...emptyDiff(), ...reparsed }; simOk = true; }
    }
    // VITALITY-DEAD RECOVERY: the diff parsed, but a substantial scene produced zero world
    // change. Constrained decoding + disabled reasoning starves small/reasoning-tier models into
    // emitting only the two mandatory keys. Re-run ONCE in plain json_object with reasoning ON
    // and an explicit instruction to record what changed — the single most effective cure for
    // the "everything is a black hole" report. Skipped for genuinely quiet turns (short prose).
    if (simOk && proseWords >= 120 && vitalityOf(diff) === 0 && mode !== "think") {
      try {
        const retry = await complete(
          [ simMsgs[0],
            simMsgs[1],
            { role: "user", content: "Your previous diff recorded no changes, but the scene above clearly contains them. Re-read the NARRATOR PROSE and emit a COMPLETE diff as one valid JSON object: every memory a present character would form, every warmth/trust/attraction shift the prose implies, mood/relaxation deltas, facts learned, locations. Do not return only scene_summary and elapsed_minutes. JSON only, no fences." } ],
          state.model_settings.simulator_model, state.model_settings.fallback_model, true, 3000,
          { ...simOpts, omitReasoning: false });
        simUsage.prompt_tokens += retry.usage.prompt_tokens; simUsage.completion_tokens += retry.usage.completion_tokens;
        const rediff = safeJson<Partial<SimulatorDiff> | null>(retry.text, null);
        if (rediff && vitalityOf(rediff) > 0) diff = { ...emptyDiff(), ...rediff };
      } catch (e: any) { console.warn(`[turn] vitality-recovery pass failed (kept thin diff): ${e.message}`); }
    }
  } catch (e: any) {
    console.warn(`[turn] simulator failed entirely: ${e.message} — applying heuristics only`);
  }
  if (!simOk) console.warn("[turn] simulator diff unusable — this turn's bookkeeping is thin");
  // REGEX-FIRST BACKFILL: deterministic extraction of the mechanical, patterned changes
  // (movement, hand-offs, conditions subsiding, elapsed-time cues). The LLM diff always wins;
  // heuristics only fill what it missed — and when the diff failed entirely, they turn a
  // silent-amnesia turn into a "basics still recorded" turn. Zero tokens.
  try { diff = backfillDiff(diff, extractHeuristics(state, action, prose)); }
  catch (e: any) { console.warn(`[turn] heuristic extraction failed (skipped): ${e.message}`); }

  // ── THE NARRATOR'S FOOTER WINS ── it wrote the scene; it knows where the scene is and who walked
  // in or out. The simulator only reads prose and guesses, so when the two disagree the footer is
  // right. When the narrator gives a footer we rebuild the movement diff from it entirely, which
  // means the simulator can no longer invent a place, teleport a speaking character, or drop anyone
  // into `elsewhere` by accident.
  if (footer) {
    const findChar = (nm: string) => {
      const first = nm.split(/\s+/)[0].toLowerCase();
      return Object.entries(state.characters).find(([id, c]) =>
        id !== "char_player" && (c.name.toLowerCase() === nm.toLowerCase() || c.name.toLowerCase().split(/\s+/)[0] === first))?.[0];
    };
    if (footer.place) {
      const pid = resolvePlace(state, footer.place, { keepIfUnknown: true });
      diff.player_location = state.world.places[pid]?.name ?? undefined;
      if (state.world.places[pid] && pid !== state.world.player_location) {
        console.info(`[places] narrator set the scene at "${state.world.places[pid].name}"`);
      }
    }
    const rebuilt: { char_id: string; place: string; said?: string }[] = [];
    const hereName = state.world.places[state.world.player_location]?.name ?? "";
    for (const nm of footer.entered) {
      const id = findChar(nm);
      if (id) rebuilt.push({ char_id: id, place: footer.place || hereName, said: "narrator: entered" });
    }
    for (const nm of footer.left) {
      const id = findChar(nm);
      if (id) rebuilt.push({ char_id: id, place: "elsewhere", said: "narrator: left" });
    }
    // keep any simulator move for a character the footer said nothing about (offscreen world motion)
    const spoken = new Set(rebuilt.map((r) => r.char_id));
    for (const l of diff.locations ?? []) if (!spoken.has(l.char_id) && l.char_id !== "char_player") rebuilt.push(l);
    diff.locations = rebuilt;
  }

  // ── MOVEMENT NEEDS EVIDENCE ── every location change must quote the prose that describes it. The
  // simulator invents moves the narrator never wrote: a character speaking in this very turn gets
  // sent to "elsewhere", drops out of the scene, and vanishes from the story. So each entry in
  // locations[] carries `said`, and that quote has to appear in the prose. If it doesn't, the move
  // didn't happen. This replaces the old verb-list backstop, which guessed and was often wrong.
  {
    const hay = prose.toLowerCase().replace(/\s+/g, " ");
    const quoted = (said?: string): boolean => {
      const q = (said ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, "").trim();
      if (q.length < 6) return false;
      if (hay.includes(q)) return true;
      // models paraphrase lightly; accept when most of the quote's distinctive words are present in order
      const words = q.split(" ").filter((w) => w.length > 3);
      if (words.length < 2) return false;
      let at = 0, hit = 0;
      for (const w of words) { const i = hay.indexOf(w, at); if (i >= 0) { hit++; at = i + w.length; } }
      return hit / words.length >= 0.75;
    };
    let vetoed = 0;
    diff.locations = (diff.locations ?? []).filter((l) => {
      if (l.char_id === "char_player") return true;               // the player's own movement is the action
      const said = (l as { said?: string }).said ?? "";
      if (said.startsWith("narrator:")) return true;              // the narrator declared it; no quote needed
      if (quoted(said)) return true;
      vetoed++;
      return false;
    });
    // an exit needs grounding in the prose. A DEATH of someone who was PRESENT can be accepted (the
    // scene depicted it). But a death of an OFF-SCENE character cannot come from a line of dialogue —
    // a grieving character saying "my dad's dead" is a claim, not an event, and the narrator may have
    // invented it to fill emotional space (the state may even hold their fate explicitly open). Killing
    // someone off-scene requires the prose to actually DEPICT the death, not merely have someone assert
    // it. Otherwise the claim is left as just that — a claim — and the character stays alive until the
    // world actually resolves them.
    diff.character_exits = (diff.character_exits ?? []).filter((e) => {
      if (e.kind === "dead") {
        const present = state.world.present.includes(e.char_id);
        if (present) return true;
        const name = state.characters[e.char_id]?.name;
        const depicted = DEPART_IN_PROSE(prose, name); // reuse: was their leaving/end actually shown?
        if (!depicted) { vetoed++; console.warn(`[turn] death clamp: refused to kill off-scene ${name} on a dialogue claim alone`); }
        return depicted;
      }
      const ok = DEPART_IN_PROSE(prose, state.characters[e.char_id]?.name);
      if (!ok) vetoed++;
      return ok;
    });
    if (vetoed) console.warn(`[turn] movement clamp: dropped ${vetoed} move(s) the prose never described`);
  }

  // ── EARSHOT CLAMP ── the simulator reads the prose and cannot tell who was in the room, so it
  // hands memories to people who weren't there: someone in the kitchen "remembers" a line the
  // player said alone in the yard, then acts on it. Presence at the START of the turn is the list
  // of who could see and hear it. Anyone else gets no memory, no learned fact, no feeling-shift
  // from this turn's events. They may still be MOVED here (locations/exits are how they arrive).
  // Characters the simulator newly created this turn are exempt — they have no prior location.
  {
    const witnesses = new Set<string>([...(state.world.present ?? []), "char_player"]);
    // Presence here is last turn's — i.e. who stood in the room when the player acted. But if the
    // player MOVED this turn, or the diff moves someone to the player, those people witness it too.
    // Resolve the player's post-move place and admit anyone who shares it.
    try {
      const destName = diff.player_location;
      // read-only: this only works out who witnessed the turn. Creating a place here would be a side
      // effect during a lookup, and applyDiff is about to resolve these names for real anyway.
      const destId = destName ? resolvePlace(state, destName, { keepIfUnknown: true, noCreate: true }) : state.world.player_location;
      const movedTo = new Map<string, string>();
      for (const l of diff.locations ?? []) movedTo.set(l.char_id, resolvePlace(state, l.place, { noCreate: true }));
      for (const [id, c] of Object.entries(state.characters)) {
        if (id === "char_player") continue;
        const where = movedTo.get(id) ?? c.location;
        if (where && where === destId) witnesses.add(id);
      }
    } catch { /* witness expansion is best-effort; the base set still holds */ }
    const newIds = new Set((diff.new_characters ?? []).map((c) => c.name.toLowerCase()));
    const known = (id: string) => !!state.characters[id];
    const isNew = (id: string) => !known(id) || newIds.has((state.characters[id]?.name ?? "").toLowerCase());
    const absent = (id: string) => known(id) && !witnesses.has(id) && !isNew(id);
    let blocked = 0;
    diff.memories = (diff.memories ?? []).filter((m) => { const bad = absent(m.char_id); if (bad) blocked++; return !bad; });
    diff.facts_learned = (diff.facts_learned ?? []).filter((f) => { const bad = absent(f.char_id); if (bad) blocked++; return !bad; });
    diff.edges = (diff.edges ?? []).filter((e) => { const bad = absent(e.from); if (bad) blocked++; return !bad; });
    diff.psyche = (diff.psyche ?? []).filter((p) => { const bad = absent(p.char_id); if (bad) blocked++; return !bad; });
    if (blocked) console.warn(`[turn] earshot clamp: dropped ${blocked} write(s) for characters who were not in the scene`);
  }

  // FALSE-DEATH GUARD — the narrator sometimes invents that an off-scene, still-living character died
  // ("my dad's dead") and the bookkeeper canonizes it into memories/facts across the cast, poisoning
  // the store and driving a hallucination loop. A memory may only assert a character's death if that
  // character is actually dead/departed in state, OR the prose DEPICTED their death this turn. An
  // assertion about a roster-alive character who was not onscreen-killed is dropped — the claim can
  // live in dialogue, but it does not become a recorded fact that later turns treat as true.
  {
    const assertsDeath = (text: string): string | null => {
      const m = text?.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)('s)?\b[^.]*\b(is dead|is gone|died|was killed|killed|dead on the|corpse|body)\b/);
      return m ? m[1] : null;
    };
    const livingByName = (name: string) => Object.entries(state.characters).find(([, c]) =>
      c.status !== "dead" && c.status !== "departed" && (c.name.toLowerCase() === name.toLowerCase() || c.name.toLowerCase().startsWith(name.toLowerCase() + " ")));
    const deathDepicted = (name: string) => DEPART_IN_PROSE(prose, name);
    let falseDeath = 0;
    const scrubDeath = (text: string): boolean => {
      const who = text ? assertsDeath(text) : null;
      if (!who) return false;
      const hit = livingByName(who);
      if (!hit) return false;                       // not a living roster character — leave it
      if (state.world.present.includes(hit[0])) return false; // present: the scene could have shown it
      if (deathDepicted(hit[1].name)) return false; // prose actually depicted the death — allow
      falseDeath++; return true;                    // living, off-scene, not depicted → drop the claim
    };
    diff.memories = (diff.memories ?? []).filter((m) => !scrubDeath(m.content));
    diff.facts_learned = (diff.facts_learned ?? []).filter((f) => !scrubDeath(f.fact));
    if (falseDeath) console.warn(`[turn] false-death guard: dropped ${falseDeath} record(s) asserting a living off-scene character died`);
  }

  // 4 ── apply diff + deterministic systems
  ev.onPhase("apply");
  const shifts = applyDiff(state, diff, action, prose);
  for (const s of habitShifts) shifts.push(s);
  if (truncationNote) shifts.push(truncationNote);
  // PLAYER TIGHTNESS ANCHOR — the player's own body reading (0–5) corrects the simulator's guess at
  // where they sit. Applied AFTER applyDiff (so the sim's relaxation_delta is the baseline it overrides)
  // and BEFORE the physiology ceiling below (which can still clamp them further for sleep/hunger). It
  // only ever caps them TIGHTER, never looser — a brutal scene's earned low stands. Untouched → inference.
  {
    const pc = state.condition["char_player"];
    if (pc) {
      const anchored = reconcilePlayerTightness(pc, opts?.tightness);
      if (anchored !== null && anchored <= -4) shifts.push("You came in tight.");
    }
  }
  if (!simOk) shifts.push("(bookkeeping failed this turn — records are incomplete; re-run the turn or edit memory by hand)");
  // fate's grip on the world, made visible — threads falling away, clocks closing in
  for (const line of fateLog) shifts.push(line);
  if (fate.active && fate.forceArrival) shifts.push("the ending is due this turn");
  else if (fate.active && fate.turnsLeft <= 3) shifts.push(`${fate.turnsLeft} turn${fate.turnsLeft === 1 ? "" : "s"} until the ending`);
  // BACKSTOP. The narrator gets one turn to write the ending after the clock runs out. If it writes
  // around it instead, the ending is recorded anyway — a weak model's reluctance is not a veto. One
  // turn of grace, not three: on a five-turn budget, three would be most of the story.
  if (fate.active && fate.turnsLeft <= -1 && !state.world_bible.destination_reached) {
    state.world_bible.destination_reached = true;
    state.world_bible.destination_outcome = "forced";
    state.destination_progress = { pct: 100, gained: state.destination_progress?.gained ?? "", missing: "", turn, reached: true };
    shifts.push("the ending has come to pass");
  }
  // Offscreen world-motion from the simulator — but drop lines that just repeat a recent one. The
  // model tends to re-narrate the same standing activity every turn ("Sarn continues her sweep..."),
  // which reads as the world stuck in a loop. Compare against the last few turns' offscreen lines and
  // keep only genuinely new motion.
  const recentOffscreen = state.history.slice(-4).flatMap((h) => h.offscreen ?? []);
  const offscreenLog = [...(diff.offscreen ?? []).filter((line) =>
    !recentOffscreen.some((prev) => overlapRatio(prev, line) >= 0.5))];
  // present, named characters the player is actually engaging join the long game
  const capCentral = state.model_settings.max_central_characters ?? 6;
  for (const id of state.world.present) {
    const c = state.characters[id];
    // Keep each present character's story-so-far (life_history) CURRENT every turn — the defining
    // beats they just lived fold in immediately, instead of waiting for the reflection cadence to come
    // around (which could miss a cluster of major beats entirely, e.g. a heartbreak that all happens
    // in the last few turns before they leave). Deterministic, zero-token string work; safe to run
    // every turn. This is why a character's "what's happened so far" could freeze early: the fold was
    // gated on reflection timing and on the character being in that loop.
    if (c && id !== "char_player" && state.memory[id]) {
      const blog = consolidateBackground(c, state.memory[id]);
      for (const l of blog) offscreenLog.push(l);
    }
    if (c && id !== "char_player" && !c.tracked && looksNamed(c.name)) {
      // a named character in the scene becomes central (tracked, full fidelity) — but only if
      // there's room under the cap. If we're full, they stay a background/non-central figure.
      const nCentral = Object.values(state.characters).filter((x) => x.character_id !== "char_player" && x.central && x.status !== "dead" && x.status !== "departed").length;
      if (nCentral < capCentral) { c.tracked = true; c.central = true; }
      else if (c.central === undefined) c.central = false;
    }
  }
  // ── BOOKKEEPING WATCHDOG ── a failing simulator model doesn't crash: it returns near-empty
  // JSON, the engine accepts it, and the story quietly stops being recorded — edges freeze,
  // memories stop, shift toasts vanish, while prose keeps flowing. (Observed in the wild: 11
  // consecutive dead turns.) So measure each diff's vitality; substantial prose that yields
  // nothing, three turns running, is announced instead of swallowed.
  {
    const vitality = vitalityOf(diff);
    const substantialProse = proseWords >= 120;
    if (substantialProse && vitality === 0 && mode !== "think") {
      state.sim_dry_runs = (state.sim_dry_runs ?? 0) + 1;
      // after 2 consecutive dead turns, escalate: route bookkeeping to the fallback model for the next
      // 5 turns. Self-healing on the cheap model — a different model usually breaks the failure loop.
      if ((state.sim_dry_runs ?? 0) >= 2 && state.model_settings.fallback_model && state.model_settings.fallback_model !== state.model_settings.simulator_model) {
        if ((state.sim_escalated_until ?? 0) < turn) shifts.push("bookkeeping kept coming back empty — switching to the backup model for a few turns to recover.");
        state.sim_escalated_until = turn + 5;
      }
      if (state.sim_dry_runs % 3 === 0) shifts.push(`bookkeeping has come back empty ${state.sim_dry_runs} turns running — the simulator model may be struggling with this save's context; consider a stronger simulator model in Settings`);
    } else if (vitality > 0) {
      if ((state.sim_dry_runs ?? 0) >= 3) shifts.push("bookkeeping is recording again.");
      state.sim_dry_runs = 0;
      // healthy again past the escalation window → drop back to the primary simulator
      if (state.sim_escalated_until && turn > state.sim_escalated_until) state.sim_escalated_until = undefined;
    }
  }
  offscreenLog.push(...tickDrives(state));   // completion events (progress already moved by QRE stances)
  // Deterministic emotional systems, each fault-isolated: a bug in any one of them must degrade
  // that system for a turn, never abort the turn's tail (history, telemetry, the shifts toasts).
  const safeTick = (name: string, fn: () => string[]) => {
    try { for (const l of fn()) shifts.push(l); }
    catch (err) { console.error(`[weft] ${name} failed this turn (turn continues):`, err); }
  };
  // desire drift + grasping: warmth slowly earns attraction (under its conditioned ceiling);
  // strong pull in a clenched body becomes fixation, which taxes relaxation until it settles.
  safeTick("desire", () => tickDesire(state));
  // co-regulation first (who is in the room moves the body), then the emotion lifecycle
  // (what the body does with what it is carrying) reads the post-company relaxation.
  safeTick("co-regulation", () => tickCoRegulation(state));
  safeTick("emotions", () => tickEmotions(state));

  // ── THEORY-OF-MIND UPDATE ── reconnect the mind layer that was orphaned when the undertow (which
  // used to call it, off the deleted QRE stance game) was removed. Without this, characters' models
  // of each other never update and mindDigest is empty. We now derive the inputs from the live
  // relaxation kernel instead of the deleted math: a character's OBSERVABLE stance is read from how
  // clenched they are (clenched → press/guard, open → yield/warm), and DISPERSION is the spread of
  // relaxation across the present cast (high spread = pulling apart, which erodes settled confidence).
  if ((state.model_settings.tension ?? 5) > 0) {
    const presentReal = state.world.present.filter((pid) => state.characters[pid] && pid !== "char_player");
    const relVals = presentReal.map((pid) => state.condition[pid]?.psyche?.relaxation ?? 0);
    // dispersion: normalized spread (std-dev-ish) of openness across the room, 0..1
    let dispersion = 0;
    if (relVals.length >= 2) {
      const mean = relVals.reduce((a, b) => a + b, 0) / relVals.length;
      const variance = relVals.reduce((a, b) => a + (b - mean) ** 2, 0) / relVals.length;
      dispersion = clamp(Math.sqrt(variance) / 10, 0, 1); // relaxation is ~-10..10, so /10 normalizes
    }
    const stanceOf = (pid: string): Stance => {
      const r = state.condition[pid]?.psyche?.relaxation ?? 0;
      return r <= -6 ? "press" : r <= -2 ? "hold" : r >= 4 ? "yield" : "maneuver";
    };
    const observedStances: Record<string, Stance> = {};
    for (const pid of presentReal) observedStances[pid] = stanceOf(pid);
    for (const id of presentReal) {
      if (!state.characters[id]?.central) continue; // only central characters carry full theory-of-mind
      const r = updateMind(state, id, observedStances, turn, dispersion);
      if (r.lines.length) shifts.push(...r.lines.slice(0, 1)); // surface at most one belief-shift line
    }
  }

  if ((state.model_settings.tension ?? 5) > 0) offscreenLog.push(...regenerateDrives(state, Math.random, undertow.epistemic_pulls ?? [], { dispersion: undertow.dispersion, sharedTarget: undertow.shared_target })); // tracked + idle → a fresh want; epistemic pulls steer toward "find out" goals; dispersion spreads the cast off any shared magnet; suppressed entirely at tension 0
  offscreenLog.push(...diffuseRumors(state));
  for (const id of Object.keys(state.characters)) {
    // conditions decay for EVERYONE incl. the player — a nosebleed is not a life sentence
    const cc = state.condition[id];
    if (!cc) continue; // defensive: imported saves can lack a condition record
    cc.condition_age ??= {};
    const expired = cc.conditions.filter((x) => turn - (cc.condition_age![x] ?? turn) >= CONDITION_LIFESPAN);
    if (expired.length) {
      cc.conditions = cc.conditions.filter((x) => !expired.includes(x));
      for (const x of expired) delete cc.condition_age![x];
      offscreenLog.push(`${state.characters[id].name}: ${expired.map((e) => e.toLowerCase()).join(", ")} — faded.`);
    }
    if (id === "char_player") continue;
    const { kept, log } = decayTraits(state.traits[id] ?? [], turn);
    state.traits[id] = kept;
    offscreenLog.push(...log.map((l) => `${state.characters[id].name}: ${l}`));
    // earned identity change: only on the reflection cadence, never per-turn
    if (reflectionDue(state.memory[id], state.model_settings.reflection_cadence, turn, reflectSalt(id))) {
      const { kept: ck, log: clog } = consolidateTraits(state.characters[id], state.traits[id], turn);
      state.traits[id] = ck;
      for (const l of clog) { offscreenLog.push(l); shifts.push(l); }
      // identity-defining memories fold permanently into background (survive eviction, shape who they are)
      const blog = consolidateBackground(state.characters[id], state.memory[id]);
      for (const l of blog) { offscreenLog.push(l); shifts.push(l); }
      // HABIT DISSOLUTION — the reflection cadence is the only door identity moves through. A habit
      // worn below threshold by being seen goes dormant here (not deleted — it can relapse). The space
      // it leaves is filled by what the character STILL wants, never a moral pole: the fist stops, the
      // desire it served remains and finds another shape. Written neutrally in third person.
      if (state.model_settings.habit_engine) {
        for (const l of dissolveWornHabits(state, id, turn)) { offscreenLog.push(l); shifts.push(l); }
      }
    }
  }
  for (const id of Object.keys(state.condition)) {
    const ps = state.condition[id].psyche;
    ps.mood_valence = Math.round(ps.relaxation);
  }
  // fired consequences retire
  for (const c of state.world.consequences) if (isDue(c, turn, state.world.current_time) && verdict.due_consequence?.id === c.id) c.status = "fired";

  // PHASE auto-advance: when the event a build-phase was converging on actually fires,
  // the phase becomes the next one (e.g. "prepare for war" → "fighting the war"), flipping the
  // tension default from suppressed to hot — generically, driven by the consequence, not by words.
  const focus = state.world.focus;
  if (focus?.linked_consequence_id) {
    const linked = state.world.consequences.find((c) => c.id === focus.linked_consequence_id);
    if (linked && linked.status === "fired") {
      if (focus.next_label) {
        state.world.focus = { label: focus.next_label, mode: focus.next_mode ?? "active" };
        shifts.push(`Phase change: now ${focus.next_label}.`);
      } else {
        state.world.focus = null;   // the event passed and there's no next phase — release focus
      }
    }
  }
  // fired clocks
  for (const c of state.world.clocks) if (c.status === "running" && c.filled >= c.segments) c.status = "fired";

  // history + time
  const minutes = diff.elapsed_minutes > 0 ? clamp(diff.elapsed_minutes, 1, 12 * 60) : heuristicMinutes(action, prose);
  state.world.current_time = advance(state.world.current_time, minutes);

  // ── PHYSIOLOGY: the clock feeds the body. Player + present cast accrue hunger/thirst/sleep
  // pressure from elapsed time (offscreen people are assumed to feed themselves); then the
  // relaxation CEILING clamps every present psyche — a body running on no sleep or no water
  // cannot be at ease, no matter how sweet the scene.
  const sleptIds = new Set((diff.facts ?? []).filter((f) => f.field === "slept").map((f) => resolveId(state, f.char_id)).filter(Boolean) as string[]);
  // GUARANTEED RESTORATION CREDIT — decoupled from drama. If the player set out to sleep and
  // hours passed, the sleep happened, interruption or not: credit = elapsed. Same for meals,
  // unless the prose explicitly destroyed the food. A knock at hour six does not un-sleep six
  // hours, and the bookkeeper forgetting to emit "slept" must never wreck a body for days.
  const SLEEP_INTENT = /\b(sleep|nap|doze|bed down|turn in|go to bed|rest (?:for|until|through)|call it a night|lie down)\b/i;
  const EAT_INTENT = /\b(eat|meal|breakfast|lunch|dinner|supper|cook and eat)\b/i;
  const MEAL_RUINED = /\b(plate (?:shatters|clatters to)|food (?:is )?(?:ruined|abandoned|untouched|forgotten|knocked)|never (?:get|gets) to (?:eat|finish)|meal (?:is )?(?:interrupted and )?(?:left|abandoned))\b/i;
  const pcond = state.condition["char_player"];
  if (pcond) {
    if (SLEEP_INTENT.test(action) && minutes >= 150 && !sleptIds.has("char_player")) {
      applySleep(pcond, Math.min(9, minutes / 60));
      sleptIds.add("char_player");
    }
    if (EAT_INTENT.test(action) && !MEAL_RUINED.test(prose) && !(diff.facts ?? []).some((f) => f.field === "hunger" && resolveId(state, f.char_id) === "char_player")) {
      applyMeal(pcond, "meal");
    }
  }
  for (const pid of ["char_player", ...state.world.present]) {
    const cond = state.condition[pid]; if (!cond) continue;
    accruePhysiology(cond, state.characters[pid], minutes, state.world.weather, sleptIds.has(pid));
    if (applyRelaxationCeiling(cond) && pid === "char_player") {
      const why = physioLabel(cond);
      if (why) shifts.push(`Your body is limiting you now — ${why}.`);
    }
  }
  // NOVELTY BOOKKEEPING — count which traits this turn actually put on screen, measured
  // against the committed prose rather than what the engine predicted. Only the FIRST
  // expression per trait per turn counts; a scene that mentions basketball six times is
  // still one expression. Strength (habits.ts) is untouched: how automatic a behavior is
  // and how much airtime it still deserves are different axes.
  if (state.model_settings.habit_engine) {
    // Prefer the simulator's semantic read (it knows a gelato expresses "loves ice cream");
    // fall back to string matching only for characters it didn't report on.
    const reportedBy = new Map<string, string[]>();
    for (const r of diff.traits_expressed ?? []) {
      const cid = resolveId(state, r.char_id);
      if (cid && Array.isArray(r.traits)) reportedBy.set(cid, r.traits.map(String));
    }
    for (const pid of state.world.present)
      recordExpressions(state, pid, prose, turn, reportedBy.get(pid));
  }

  state.history.push({
    turn, player_action: action, action_mode: mode, narrator_prose: prose,
    summary: diff.scene_summary || prose.slice(0, 120),
    shifts: shifts.slice(0, 8), weather: state.world.weather, directive: fullDirective.slice(0, 240),
    offscreen: offscreenLog.slice(0, 6), time_label: state.world.current_time,
    gm_intents: intents.length ? intents.map((i) => ({ char_id: i.char_id, name: i.name, surface: i.surface, truth: i.truth, lying: i.lying })) : undefined,
    // Health of this turn's bookkeeping, so a silent failure is visible and re-runnable. Quiet turns
    // (short prose) legitimately change nothing — only flag a dead diff when the scene had substance.
    bookkeeping: !simOk ? "failed" : (vitalityOf(diff) === 0 && proseWords >= 120 && mode !== "think") ? "thin" : "ok",
  });

  // 5 ── reflection (occasional, importance-gated)
  let reflectionTokens = 0;
  for (const id of Object.keys(state.memory)) {
    const mem = state.memory[id];
    if (!reflectionDue(mem, state.model_settings.reflection_cadence, turn, reflectSalt(id))) continue;
    ev.onPhase("reflection");
    try {
      const recent = mem.episodic.slice(-20).map((m) => `[T${m.turn}, imp ${m.importance}] ${m.content}`).join("\n");
      const msgs = [
        { role: "system", content: REFLECTION_SYSTEM },
        { role: "user", content: `Character: ${state.characters[id]?.name}\nACTIVE GOAL: ${state.characters[id]?.drive?.goal ?? "none"}${state.characters[id]?.drive?.blocker ? ` (blocked: ${state.characters[id]!.drive!.blocker})` : ""}\nQueued goals: ${(state.characters[id]?.drive_queue ?? []).map((q) => q.goal).join(" | ") || "none"}\nExisting beliefs: ${mem.beliefs.map((b) => b.content).join(" | ") || "none"}\nNervous system this period: ${(() => { const ps = state.condition[id]?.psyche; if (!ps) return "unknown"; if ((ps.consecutive_clenched ?? 0) >= 3) return `clenched for ${ps.consecutive_clenched} straight turns — a body bracing this long hardens protective, suspicious convictions`; if ((ps.open_run ?? 0) >= 3) return `settled for ${ps.open_run} straight turns — a body at ease this long can afford generous, revisable convictions`; return "mixed — neither braced nor at ease for long"; })()}\nRecent memories:\n${recent}` },
      ];
      const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 600);
      reflectionTokens += res.usage.prompt_tokens + res.usage.completion_tokens;
      const parsed = safeJson<{ beliefs: { content: string; confidence: number }[]; drive_review?: { status?: string; new_goal?: string; blocker?: string } }>(res.text, { beliefs: [] });
      // DRIVE REVIEW (LLM layer of re-planning): the reflection judged the character's active
      // pursuit against what actually happened. Completion/impossibility rotates the queue;
      // a dry queue adopts the invented goal. High-priority goals are never dropped here either.
      const dr = parsed.drive_review;
      const ch = state.characters[id];
      if (dr && ch?.drive) {
        const highPri = (ch.drive.priority ?? 1) >= 8;
        if ((dr.status === "complete" || dr.status === "impossible") && !highPri) {
          const next = ch.drive_queue?.shift();
          ch.drive = next ?? (dr.new_goal ? { goal: dr.new_goal.slice(0, 120), progress: 0, priority: 3, updated_turn: turn } : undefined);
        } else if (dr.blocker && dr.blocker.trim()) {
          ch.drive.blocker = dr.blocker.slice(0, 120);
          ch.drive.updated_turn = turn;
        }
      }
      let beliefs: Belief[] = parsed.beliefs.slice(0, 3).map((b) => ({ content: b.content, confidence: clamp(b.confidence ?? 0.7, 0, 1), formed_turn: turn, evidence_turns: [] }));
      // FIDELITY GATE: a belief is a paraphrase by a cheap model — if it contains a proper noun
      // that appears nowhere in the episodic memories it was distilled from (nor in the world's
      // known names), the model invented a specific. Drop that belief; keep the rest.
      {
        const wl = knownNameWhitelist(state);
        const src = mem.episodic.map((m) => `${m.content} ${m.full_content ?? ""}`).join(" ") + " " + (mem.facts ?? []).map((f) => f.content).join(" ");
        const { kept, dropped } = filterSuspectBeliefs(beliefs, src, wl);
        beliefs = kept;
        if (dropped.length) console.warn(`[reflection] dropped ${dropped.length} confabulated belief(s) for ${state.characters[id]?.name}`);
      }
      if (beliefs.length) applyReflection(mem, beliefs, turn);

      // history compaction: when the accreted life_history has grown long, re-summarize it into
      // tighter prose (preserve the throughline, lose verbatim detail). Bedrock background untouched.
      const ident = state.characters[id];
      if (ident && needsHistoryCompaction(ident)) {
        try {
          const cmsg = [
            { role: "system", content: `You compress a character's accumulated life-history into tighter prose. Preserve every identity-defining throughline (relationships formed, who they became, irreversible changes, key losses and bonds) but collapse repetitive or minor beats and lose verbatim detail. Keep it under 120 words, past tense, plain prose, no list. Output ONLY the rewritten history paragraph.` },
            { role: "user", content: `Character: ${ident.name}\nTheir core identity (do NOT repeat this, it's already known): ${ident.background}\nAccumulated history to compress:\n${ident.life_history}` },
          ];
          const cres = await complete(cmsg, state.model_settings.simulator_model, state.model_settings.fallback_model, false, 300);
          reflectionTokens += cres.usage.prompt_tokens + cres.usage.completion_tokens;
          const tightened = cres.text.trim();
          if (tightened && tightened.length < (ident.life_history?.length ?? 0)) {
            ident.life_history = tightened;
            shifts.push(`${ident.name}'s accumulated history was condensed.`);
          }
        } catch (e: any) {
          // if the rewrite fails, fall back to a hard tail-trim so it can't grow unbounded
          if (ident.life_history && ident.life_history.length > 1400) ident.life_history = ident.life_history.slice(-1400);
        }
      }
    } catch (e: any) {
      console.warn(`[turn] reflection failed for ${id}: ${e.message}`);
    }
  }

  // ── NAME-KNOWLEDGE SPREAD: the player's name becomes speakable for present characters only
  // when the player introduces themselves, or when the name is spoken aloud (inside quotes) in
  // the scene by someone who knows it. Narration using the name never teaches it.
  {
    const pfirst = state.characters["char_player"]?.name.split(/\s+/)[0] ?? "";
    if (pfirst.length >= 2) {
      const introduced = new RegExp(`\\b(i'?m|i am|my name is|call me|the name'?s)\\s+${pfirst}\\b`, "i").test(action);
      const spokenAloud = new RegExp(`["“][^"”]*\\b${pfirst}\\b[^"”]*["”]`).test(prose);
      if (introduced || spokenAloud) {
        for (const pid of state.world.present) {
          const c = state.characters[pid];
          if (c && !c.knows_player_name) { c.knows_player_name = true; shifts.push(`${c.name} now knows your name.`); }
        }
      }
    }
  }

  gcPlaces(state);

  // ── CHAPTERING: every chapter_cadence turns, one cheap call turns the last stretch of
  // summaries into a titled chapter — shown in Chronicle and carried as one line each in
  // context, so the verbatim history window can stay small without losing the arc.
  const chapCad = state.model_settings.chapter_cadence ?? 25;
  // Fate needs to KNOW where it stands, and the cadence is far too slow for a closing story: a
  // budget can be spent entirely between two audits, so the ending would arrive unmeasured and
  // never be recognized as having happened. Once the story is converging, audit every turn.
  // The auditor supplies one thing fate needs: a sentence naming what still stands in the way. That
  // is worth a call when the act changes (the story has entered a new phase and the gap has moved),
  // not on every turn of the endgame — this is an LLM call, not a free read. The clock, which owns
  // progress and arrival, never needs it at all.
  const lastAct = state.destination_progress?.act;
  const fateAudit = fate.active && fate.act !== "open" && fate.act !== lastAct;
  if ((chapCad > 0 && turn > 0 && turn % chapCad === 0) || fateAudit) {
    try {
      ev.onPhase("reflection");
      state.chapters ??= [];
      const fromTurn = (state.chapters.at(-1)?.to_turn ?? 0) + 1;
      const beats = state.history.filter((h) => h.kind !== "opening" && h.turn >= fromTurn)
        .map((h) => `T${h.turn}: [did: ${(h.player_action || "").slice(0, 90)}] ${h.summary}`).join("\n");
      if (beats.trim()) {
        const contract = state.world_bible.narrator_direction?.trim() || "";
        const destination = state.world_bible.destination?.trim() || "";
        const priorPct = state.destination_progress?.pct;
        const destLine = destination
          ? `DESTINATION (the stated ending this story is written toward): "${destination}"\nPROGRESS AT LAST CHAPTER: ${priorPct == null ? "none recorded (this is the first reading)" : `${priorPct}%`}\n`
          : "DESTINATION: none — this is an open story with no stated ending. Omit the destination object.\n";
        const res = await complete([
          { role: "system", content: CHAPTER_SYSTEM },
          { role: "user", content: `STANDING DIRECTION (the contract): "${contract || "none given"}"\n${destLine}PRIOR PLAYER READING: ${state.chapters.at(-1)?.persona ? `${state.chapters.at(-1)!.persona!.mbti} — ${state.chapters.at(-1)!.persona!.read}` : "none"}\n\nChapter ${state.chapters.length + 1}. Beats:\n${beats.slice(0, 7000)}` },
        ], state.model_settings.simulator_model, state.model_settings.fallback_model, true, 500);
        reflectionTokens += res.usage.prompt_tokens + res.usage.completion_tokens;
        const ch = safeJson<{ title?: string; summary?: string; on_contract?: boolean; drift?: string; canon_add?: string[]; destination?: { pct?: number; gained?: string; missing?: string; reached?: boolean }; persona?: { mbti?: string; read?: string; traits?: string[]; shift?: string } }>(res.text, {});
        // CANON BACKSTOP: the chapter audit ratifies public world-scale events the per-turn
        // bookkeeper missed — news that spread across a whole chapter is public by now.
        for (const cn of (ch.canon_add ?? []).slice(0, 2)) {
          const line = String(cn).trim();
          if (line && addCanon(state, line)) {
          }
        }
        // ── THE GAP ── the auditor reads the story and says what still stands between here and the
        // ending. That is all it does. It does not score progress (turns do) and it does not decide
        // when the ending lands (the clock does), except to confirm an ending the prose already
        // wrote — a player can arrive early, and the story should not keep pushing them toward a
        // place they have reached.
        if (destination && !state.world_bible.destination_reached && ch.destination) {
          const d = ch.destination;
          const arrivedEarly = d.reached === true;
          state.destination_progress = {
            pct: fate.budget > 0 ? fate.pct : Math.max(0, Math.min(100, Math.round(Number(d.pct) || 0))),
            gained: String(d.gained ?? "").slice(0, 120),
            missing: String(d.missing ?? "").slice(0, 120),
            turn, reached: arrivedEarly, act: fate.act,
          };
          if (arrivedEarly) {
            state.destination_progress.pct = 100;
            state.world_bible.destination_reached = true;
            state.world_bible.destination_outcome = "earned";
            shifts.push(`the story has reached its ending — ${destination}`);
          }
        }
        const onCadence = chapCad > 0 && turn > 0 && turn % chapCad === 0;
        if (ch.summary && onCadence) {
          const persona = ch.persona && ch.persona.mbti && ch.persona.read
            ? { mbti: String(ch.persona.mbti).slice(0, 6).toUpperCase(), read: String(ch.persona.read).slice(0, 300), traits: (ch.persona.traits ?? []).slice(0, 5).map((t) => String(t).slice(0, 60)), shift: ch.persona.shift && String(ch.persona.shift).trim() ? String(ch.persona.shift).slice(0, 160) : undefined }
            : undefined;
          state.chapters.push({ idx: state.chapters.length + 1, from_turn: fromTurn, to_turn: turn, title: (ch.title ?? `Chapter ${state.chapters.length + 1}`).slice(0, 60), summary: ch.summary.slice(0, 400), on_contract: ch.on_contract !== false, drift: ch.drift?.slice(0, 200), persona });
          // arm or clear the governor
          state.contract_drift = ch.on_contract === false && ch.drift?.trim() ? ch.drift.trim().slice(0, 200) : null;
          // HISTORY COMPACTION — a chapter summary now covers this span, so old entries shed their
          // hidden bloat (directive, offscreen log). Prose stays: it IS the transcript the player
          // reads. Ribot applied to the story: the summary is the semantic residue.
          for (const h of state.history) {
            if (h.turn <= turn - 30) { if (h.directive) delete (h as any).directive; if (h.offscreen && h.offscreen.length > 2) h.offscreen = h.offscreen.slice(0, 2); }
          }
        }
      }
    } catch (e: any) { console.warn(`[turn] chaptering failed: ${e.message}`); }
  }

  // telemetry
  const tel: TurnTelemetry = {
    turn, ts: Date.now(), pressure: verdict.pressure, pressure_source: verdict.source,
    narrator_tokens_in: narratorUsage.prompt_tokens, narrator_tokens_out: narratorUsage.completion_tokens,
    simulator_tokens_in: simUsage.prompt_tokens, simulator_tokens_out: simUsage.completion_tokens,
    cached_tokens: (narratorUsage.cached_tokens ?? 0) + (simUsage.cached_tokens ?? 0),
    turn_cost: (narratorUsage.cost ?? 0) + (simUsage.cost ?? 0) || undefined,
    reflection_tokens: reflectionTokens, duration_ms: Date.now() - t0,
    word_count: prose.split(/\s+/).filter(Boolean).length,
    player_mood_valence: state.condition["char_player"]?.psyche.mood_valence ?? 0,
    present: [...state.world.present], time_label: state.world.current_time,
    edge_snapshot: playerEdgeSnapshot(state),
    lyapunov: undertow.lyapunov, coherence: undertow.coherence,
    regime: undertow.regime, early_warning: undertow.early_warning,
  };
  state.telemetry.push(tel);
  // sliding window: long campaigns (thousands of turns) would otherwise bloat every save with raw
  // per-turn telemetry. Keep a generous recent window — the charts don't need more, and lifetime
  // counts that matter are derived elsewhere. Same for the pressure trace.
  const TEL_WINDOW = 300;
  if (state.telemetry.length > TEL_WINDOW) state.telemetry = state.telemetry.slice(-TEL_WINDOW);
  if (state.pressure_trace.length > TEL_WINDOW) state.pressure_trace = state.pressure_trace.slice(-TEL_WINDOW);
  state.world.current_turn++;
  ev.onMeta({ telemetry: tel, offscreen: offscreenLog.slice(0, 6), shifts: shifts.slice(0, 8), weather: state.world.weather, time: state.world.current_time });
}

const TRANSIENT_RE = /\b(currently|right now|at the moment|for now|bleeding|blood(y|ied)?|nosebleed|fatigued?|exhausted|tears?|crying|sweat(ing)?|panting|trembling|shaking|wincing|sedat\w*|bandag\w*|restrained)\b/i;

/** Appearance is identity, not status. Strip sentences describing transient state. */
export function stripTransient(value: string): string {
  const kept = value
    .split(/(?<=[.;!?])\s+/)
    .filter((sent) => !TRANSIENT_RE.test(sent));
  return kept.join(" ").trim();
}

function wordOverlap(a: string, b: string): boolean {
  const STOP = new Set(["the","a","an","of","in","on","and","with","from","severe","slowly","slow","heavy","mild","light"]);
  const wa = a.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w));
  const wb = b.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w));
  return wb.some((w) => wa.some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
}

/** Fraction of significant words shared between two strings (Jaccard-ish over content words).
 *  Used to detect NEAR-DUPLICATE threads and consequences the model re-emits with reworded titles
 *  ("The Inquisitorius (Sarn Veylo) — locate and claim the anomaly" vs "Sarn Veylo — locate and
 *  claim the anomaly"). Returns 0..1; ~0.5+ means they're the same beat wearing different words. */
function overlapRatio(a: string, b: string): number {
  const STOP = new Set(["the","a","an","of","in","on","and","with","from","to","for","by","at","as","that","this","it","is","are","was","were","be","has","have","had","who","which","their","they","them","his","her","its","if","when","then","now","up","down","fast","two","one"]);
  const toks = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w)));
  const sa = toks(a), sb = toks(b);
  if (!sa.size || !sb.size) return 0;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / Math.min(sa.size, sb.size); // fraction of the SMALLER set covered
}

/** Add a condition with dedupe: a variant of an existing condition REPLACES it instead of stacking. */
export function addCondition(c: { conditions: string[]; condition_age?: Record<string, number> }, value: string, turn: number): void {
  value = typeof value === "string" ? value : String(value ?? "");
  if (!value) return;
  c.condition_age ??= {};
  const dup = c.conditions.find((x) => typeof x === "string" && (x.toLowerCase() === value.toLowerCase() || wordOverlap(x, value)));
  if (dup) {
    delete c.condition_age[dup];
    c.conditions = c.conditions.filter((x) => x !== dup);
  }
  c.conditions.push(value);
  c.condition_age[value] = turn;
  // hard cap: oldest fall off
  while (c.conditions.length > 6) {
    const oldest = c.conditions.reduce((m, x) => ((c.condition_age![x] ?? 0) < (c.condition_age![m] ?? 0) ? x : m), c.conditions[0]);
    c.conditions = c.conditions.filter((x) => x !== oldest);
    delete c.condition_age[oldest];
  }
}

const CONDITION_LIFESPAN = 10; // turns; afflictions heal unless re-earned

function findCharByName(state: SaveState, name: string): string | null {
  const n = name.toLowerCase().trim();
  for (const [id, c] of Object.entries(state.characters)) if (c.name.toLowerCase() === n) return id;
  for (const [id, c] of Object.entries(state.characters)) if (c.aliases?.some((a) => a.toLowerCase().trim() === n)) return id;
  // fuzzy containment only for names long enough to be meaningful — a 1-2 character name
  // ("P", "Al") is a substring of half the alphabet and used to swallow every new character
  for (const [id, c] of Object.entries(state.characters)) {
    const cn = c.name.toLowerCase();
    if (cn.length < 3 || n.length < 3) continue;
    if (cn.includes(n) || n.includes(cn)) return id;
  }
  return null;
}

function resolveId(state: SaveState, ref: string): string | null {
  if (!ref) return null;
  if (state.characters[ref]) return ref;
  return findCharByName(state, ref);
}

/** Find a place by id or (case-insensitive) name; create it on first mention. Returns the place id. */
/** The LOCALE of a place name — the building/area, stripping a " - subroom" suffix. So "House - kitchen",
 *  "House - porch", and "House" all share locale "house". Used for presence: people in different rooms
 *  of the same building are in the same scene, instead of flickering apart on sub-room drift. */
/** Is this a transient motion/state label rather than a real place? "walking home", "driving away",
 *  "in transit" — these shouldn't become persistent place records or break co-location. */
function isTransientLabel(name: string): boolean {
  return /\b(walking|driving|heading|moving|running|traveling|travelling|in transit|en route|on (the|their) way|leaving|departing|fleeing)\b/i.test(name) &&
    /\b(home|away|off|out|back|toward|towards|to|from)\b/i.test(name);
}

export const OFFSCENE = "loc_offscene";

/** The offscene record — one place, outside every locale, for everyone who is not in a named
 *  location. Characters there are never in the player's scene and never re-seated by locale merging. */
export function ensureOffscene(state: SaveState): string {
  if (!state.world.places[OFFSCENE]) {
    state.world.places[OFFSCENE] = { id: OFFSCENE, name: "elsewhere", description_facts: "", contains: [] };
  }
  return OFFSCENE;
}

/** THE GAZETTEER IS CLOSED. The world has the locations it was forged with and no others.
 *
 *  This used to mint a new place for any string a model produced, so "the yard", "outside in the
 *  yard", and "Tessa's house (outside in the yard)" became three rooms of one house and presence
 *  fractured across them. Now a reference either names a place that exists or it means `elsewhere`.
 *  Rooms, thresholds, and doorways are prose, not geography.
 *
 *  Matching is deliberately generous — exact id, exact name, then the strongest substring overlap —
 *  because the cost of a near-miss is a character standing in the wrong room, while the cost of a
 *  new place is the maze. */
export function resolvePlace(state: SaveState, ref: string, opts?: { keepIfUnknown?: boolean; noCreate?: boolean }): string {
  if (!ref) return state.world.player_location;
  if (state.world.places[ref]) return ref;

  const raw = ref.trim();
  if (!raw) return state.world.player_location;

  // explicit ways of saying "not in a tracked place"
  if (/^(elsewhere|somewhere else|off[\s-]?screen|away|out|outside|out of (?:the )?(?:room|scene|house)|unknown|nowhere)\b/i.test(raw)) return ensureOffscene(state);

  // strip motion and articles: "walking back to the Iron Roof" -> "iron roof"
  const norm = raw
    .replace(/^(walking|heading|moving|going|running|traveling|travelling|driving|riding|in transit|en route|on (?:the|their) way)\s+(?:to|toward|towards|into|through|back to|out|outside|past|along|near|by)?\s*/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")            // "Tessa's house (kitchen)" -> "Tessa's house"
    .replace(/\s+[-–—]\s+.*$/, "")               // "Warehouse - stairwell" -> "Warehouse"
    .replace(/[.,;:]+$/, "")
    .trim();
  if (!norm) return ensureOffscene(state);

  const key = norm.toLowerCase();
  const real = Object.values(state.world.places).filter((p) => p.id !== OFFSCENE);
  if (!real.length) return state.world.player_location;

  for (const p of real) {
    const pn = p.name.toLowerCase();
    if (pn === key || pn === raw.toLowerCase()) return p.id;
  }

  const scored = real
    .map((p) => ({ id: p.id, score: placeSimilarity(key, p.name.toLowerCase()) }))
    .sort((a, b) => b.score - a.score);
  // Require a clear winner, not merely a passing score: "north service center" scores 0.39 against
  // "Sole Service" on the word `service` alone, which would be the wrong place if the right one were
  // missing. A strong match (>=0.6) stands on its own; a weak one must also beat the runner-up.
  const top = scored[0], next = scored[1];
  if (top && (top.score >= 0.6 || (top.score >= 0.34 && (!next || top.score >= next.score * 1.5)))) return top.id;

  // Nothing resembles this. Two very different things look identical at this point:
  //
  //   "the kitchen doorway"  — a corner of a place that already exists. Making it a location splits
  //                            one house into three rooms and scatters everyone across them.
  //   "the Old Cannery"      — somewhere the story genuinely needs and the Forge never named.
  //
  // A part-name is the first; anything else is the second. Parts get folded into the place the scene
  // is already in. Real new places are created, up to a cap, after which the world is full and the
  // oldest unused non-founding place is evicted to make room.
  if (isPartOfAPlace(raw)) {
    console.info(`[places] "${raw}" is part of a place, not a place — keeping the scene where it is`);
    return state.world.player_location;
  }
  if (opts?.noCreate) {
    console.warn(`[places] "${raw}" matches nothing and creation is off`);
    return opts?.keepIfUnknown ? state.world.player_location : ensureOffscene(state);
  }
  return createPlace(state, norm);
}

/** Is this the name of a ROOM, CORNER, or THRESHOLD rather than a place you travel to?
 *  "the kitchen", "upstairs", "the back of the bar", "outside the door" are all parts of somewhere. */
export function isPartOfAPlace(ref: string): boolean {
  const bare = ref.trim().replace(/^(the|a|an)\s+/i, "").trim();
  // A proper name is a place, even when its last word is an ordinary one: "Kubota Garden" and
  // "Interbay Yard" are somewhere you go; "the garden" and "the yard" are part of where you are.
  // Two or more capitalized words, or a possessive, means somebody named this.
  const capped = bare.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length;
  if (capped >= 2 || /'s\b/.test(bare)) return false;
  const r = bare.toLowerCase();
  const PART = /\b(kitchen|bedroom|bathroom|washroom|restroom|toilet|hallway|hall|corridor|landing|stairs|stairwell|staircase|doorway|door|threshold|porch|stoop|yard|garden|lawn|driveway|garage|attic|basement|cellar|loft|balcony|terrace|patio|deck|roof|rooftop|closet|pantry|cupboard|corner|booth|table|bar top|counter|window|windowsill|fireplace|hearth|couch|sofa|bed|desk|floor|ceiling|wall|upstairs|downstairs|inside|indoors|back room|front room|living room|dining room|sitting room|spare room|back office|storeroom|storage|foyer|entryway|entrance|lobby|vestibule|alley|alleyway|sidewalk|pavement|curb|parking lot|car ?park)\b/;
  if (PART.test(r)) return true;
  // "edge of X", "back of X", "near the X", "just outside X" — a position relative to a place
  return /^(edge|side|back|front|middle|centre|center|top|bottom|foot|head|end|corner|far end|other side)\s+of\b/.test(r)
    || /^(just )?(outside|inside|behind|beside|beneath|under|above|across from|next to|near|by|toward|towards)\b/.test(r);
}

export function createPlace(state: SaveState, name: string): string {
  const clean = name.trim().replace(/^(the|a|an)\s+/i, "").slice(0, 60);
  const title = clean.charAt(0).toUpperCase() + clean.slice(1);
  const id = uid("loc");
  state.world.places[id] = { id, name: title, description_facts: "", contains: [] };
  console.info(`[places] created "${title}" (${Object.keys(state.world.places).length - 1} places)`);
  // gcPlaces runs at the end of every turn and holds the cap by forgetting the oldest place nobody
  // is in and nothing has mentioned. Founding locations are never forgotten.
  return id;
}

/** How much two place names look like the same place. Token overlap weighted toward the rarer,
 *  longer words, so "kitchen doorway" scores 0 against "The Rusty Anchor" but "the rusty anchor bar"
 *  scores high. Substring matching alone was useless here — "kitchen" shares no substring with
 *  "Tessa's house" even though a model meant the latter. */
export function placeSimilarity(a: string, b: string): number {
  // Generic nouns are everywhere in place names ("service", "center", "house", "street"), so two
  // unrelated places share them and score a false match. They count for a fraction of their length.
  // Coverage is measured in BOTH directions and the better taken: a reference may carry extra words
  // ("sole service front counter") or fewer ("the anchor") than the place name it names.
  const GENERIC = new Set(["service", "center", "centre", "house", "street", "road", "avenue", "place",
    "building", "office", "shop", "store", "station", "hall", "room", "club", "bar", "cafe", "market", "north",
    "south", "east", "west", "old", "new", "great", "little", "upper", "lower", "main", "city", "town"]);
  const STOP = new Set(["the", "a", "an", "of", "at", "in", "on", "near", "by", "and", "to"]);
  const toks = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  const weight = (w: string) => (GENERIC.has(w) ? w.length * 0.15 : w.length);

  const side = (X: Set<string>, Y: Set<string>) => {
    let shared = 0, distinctive = false;
    for (const w of X) {
      if (Y.has(w)) { shared += weight(w); if (!GENERIC.has(w)) distinctive = true; continue; }
      for (const v of Y) if (v.length > 3 && w.length > 3 && (v.startsWith(w) || w.startsWith(v))) {
        shared += Math.min(weight(v), weight(w)) * 0.7;
        if (!GENERIC.has(w) && !GENERIC.has(v)) distinctive = true;
        break;
      }
    }
    const total = [...X].reduce((n, w) => n + weight(w), 0);
    if (!total) return 0;
    const cov = Math.min(1, shared / total);
    // A place whose whole name is ordinary words ("Sole Service") must still match itself, so high
    // coverage alone can carry it. A reference that merely brushes a generic word is held down.
    return distinctive ? cov : cov >= 0.85 ? cov : cov * 0.35;
  };
  return Math.max(side(A, B), side(B, A));
}

/** present is DERIVED: whoever shares the player's place is in the scene. Rebuilds every place's
 *  occupancy from each character's location. A `hint` (the diff's `present`) only nudges defaults
 *  for characters who don't yet have a location set. */
export function syncPresence(state: SaveState, hint?: string[]): void {
  const ploc = state.world.player_location;
  ensureOffscene(state);
  // seed locations for anyone the narrator named as present but who has no place yet
  if (hint) {
    for (const ref of hint) {
      const id = resolveId(state, ref);
      if (id && id !== "char_player" && !state.characters[id].location) state.characters[id].location = ploc;
    }
  }
  state.characters["char_player"].location = ploc;
  // rebuild contains[] from the source of truth (each character's location); the gone don't occupy rooms
  for (const p of Object.values(state.world.places)) p.contains = [];
  for (const [id, c] of Object.entries(state.characters)) {
    if (c.status === "dead" || c.status === "departed") continue;
    if (c.location && state.world.places[c.location]) state.world.places[c.location].contains.push(id);
  }
  // The scene is the player's location. Nothing else. Locations are whole places now — a house, not
  // its kitchen — so there is no locale to merge and no sub-room to argue about. Same place or absent.
  state.world.present = Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed" && c.location === ploc)
    .map(([id]) => id);
}


export function applyDiff(state: SaveState, diff: SimulatorDiff, action: string, prose: string): string[] {
  const turn = state.world.current_turn;
  const shifts: string[] = [];
  const nameOf = (id: string) => state.characters[id]?.name ?? id;

  // MASTER TENSION DIAL — origination clamp. At tension 0 the engine introduces NOTHING new on its
  // own: no new consequences, no brand-new threads, no new faction clocks. The world still RESPONDS
  // (existing threads can resolve/shift, conditions heal, edges move, people react) — it just stops
  // manufacturing fresh trouble in the background. Low tension (1–2) also blocks new consequences.
  const tension = state.model_settings.tension ?? 5;
  if (tension <= 0) {
    diff = { ...diff,
      consequences_new: [],
      // at rest: no fresh people wander in either, unless the PLAYER's own action summoned them
      new_characters: (diff.new_characters ?? []).filter(() => /\b(summon|conjure|create|bring|call|invite|make)\b/i.test(action)),
      threads_update: (diff.threads_update ?? []).filter((t) => {
        const exists = state.world.threads.some((x) => x.id === t.id || x.title.toLowerCase() === t.title.toLowerCase());
        return exists; // allow updates/resolutions to existing threads, block brand-new ones
      }),
    } as SimulatorDiff;
  } else if (tension <= 2) {
    diff = { ...diff, consequences_new: [] } as SimulatorDiff;
  }

  // new characters & places first so later refs resolve
  // BIBLE UPDATE — when canon/actions fundamentally change what the WORLD IS, revise the world
  // bible itself (not just append a canon fact). The bible is the foundational description the
  // narrator reads as law; if it stays static while canon says reality was rewritten, the narrator
  // trusts the static bible and the world renders unchanged. This is what makes a transformed world
  // actually get depicted as transformed.
  {
    const bu = (diff as any).bible_update;
    if (bu && typeof bu === "object") {
      const fields = ["political_situation", "what_people_fear", "technology_level", "cultures_and_languages", "magic_rules"] as const;
      for (const f of fields) {
        const v = bu[f];
        if (typeof v === "string" && v.trim() && v.trim() !== (state.world_bible as any)[f]) {
          (state.world_bible as any)[f] = v.trim();
          shifts.push(`The world itself has changed: ${f.replace(/_/g, " ")}.`);
        }
      }
    }
  }

  // RENAME — a placeholder-named character ("the stranger") given a real name in the prose. Update
  // the actual character record (and rumor/canon references) so they're known by their real name now.
  for (const rn of (diff as any).rename ?? []) {
    if (!rn?.who || !rn?.new_name) continue;
    const id = resolveId(state, rn.who) || findCharByName(state, rn.who);
    if (!id || !state.characters[id]) continue;
    const oldName = state.characters[id].name;
    const newName = String(rn.new_name).trim();
    if (!newName || newName.toLowerCase() === oldName.toLowerCase()) continue;
    // don't collide with an existing different character
    const clashId = findCharByName(state, newName);
    if (clashId && clashId !== id) continue;
    state.characters[id].name = newName;
    shifts.push(`${oldName} is named: ${newName}.`);
  }

  const maxCentral = state.model_settings.max_central_characters ?? 6;
  const centralCount = () => Object.values(state.characters).filter((c) => c.character_id !== "char_player" && c.central && c.status !== "dead" && c.status !== "departed").length;
  for (const nc of diff.new_characters ?? []) {
    if (!nc?.name || findCharByName(state, nc.name)) continue;
    // CENTRAL-CHARACTER CAP: a new character joins as central (full fidelity) only if there's room
    // under the cap. Beyond it, they register as NON-CENTRAL — a background/environment figure with
    // minimal footprint and simple handling — until something promotes them.
    // EXCEPTION: a REFERENCED person being promoted (they carry established memories/relationships —
    // the simulator supplied seed memories or an established_reference flag) is story-load-bearing,
    // not a walk-on. They may take a central slot even at the cap, because a blank memoryless version
    // of an established person is exactly the amnesia bug (e.g. "Ellen's mother" not knowing anyone).
    const isReferenced = !!(nc as any).established_reference || ((nc as any).memories?.length ?? 0) > 0;
    const canBeCentral = centralCount() < maxCentral || isReferenced;
    const aStyle = String((nc as any).attachment_style ?? "").toLowerCase();
    const attachment = ["secure", "anxious", "avoidant", "disorganized"].includes(aStyle)
      ? { style: aStyle as any, under_threat: (nc as any).under_threat ? String((nc as any).under_threat).slice(0, 160) : undefined }
      : undefined;
    const vFlat = { example_lines: (nc as any).example_lines, never_says: (nc as any).never_says };
    const voice = vFlat.example_lines?.length || vFlat.never_says?.length ? { example_lines: vFlat.example_lines?.slice(0, 4), never_says: vFlat.never_says?.slice(0, 3) } : undefined;
    // MULTIPLE GOALS — a character is several live wants, not one. Take drive_goals[] if the bookkeeper
    // supplied it; else fall back to the single drive_goal/current_goal. The first becomes the active
    // drive, the rest seed the queue as simultaneous wants the narrator can surface by context. A lone
    // goal is what makes a spawned character a broken record (the farmer who only says "raiders, my son").
    const goalList: string[] = (Array.isArray((nc as any).drive_goals) ? (nc as any).drive_goals : [])
      .map((g: any) => String(g).trim()).filter(Boolean);
    const singleGoal = String((nc as any).drive_goal ?? (nc as any).current_goal ?? "").trim();
    const allGoals = (goalList.length ? goalList : (singleGoal ? [singleGoal] : []))
      .filter((g, i, a) => a.indexOf(g) === i).slice(0, 3);
    const drive = allGoals.length ? { goal: allGoals[0], priority: 3, progress: 0, updated_turn: turn } : undefined;
    const driveQueue = allGoals.slice(1).map((g, i) => ({ goal: g, priority: 2 - i, progress: 0, updated_turn: turn }));
    // HOLLOW-CHARACTER FLOOR — if the bookkeeper spawned a thin character (no voice, no values), give
    // them serviceable defaults derived from their nature so they are never a plot-label with nothing
    // to render. This is a floor, not a replacement: real authored depth is always better, but an
    // empty character can never be a person, and a null voice literally cannot be reactive.
    const values: string[] = Array.isArray((nc as any).values) && (nc as any).values.length
      ? (nc as any).values.map((v: any) => String(v)).slice(0, 4)
      : deriveDefaultValues(nc.core_traits ?? [], nc.background ?? "");
    const floorVoice = voice ?? (nc.speech_pattern ? undefined : deriveDefaultVoice(nc.core_traits ?? [], String((nc as any).age ?? 30)));
    const floorAttachment = attachment ?? { style: "secure" as any, under_threat: "goes quiet and watchful, keeps their distance until they read the room" };
    registerCharacter(state, { ...nc, values, character_id: undefined as any, voice: floorVoice, attachment: floorAttachment, gregariousness: clamp(nc.gregariousness ?? 0.5, 0, 1), central: canBeCentral, tracked: canBeCentral && ((nc as any).tracked ?? isReferenced) });
    // apply the multi-goal drive after registration (registerCharacter doesn't take drive_queue)
    if (drive) {
      const newId = findCharByName(state, nc.name);
      if (newId) { state.characters[newId].drive = drive; state.characters[newId].drive_queue = driveQueue; }
    }
    if (!canBeCentral) shifts.push(`${nc.name} enters as a background figure (cast is at ${maxCentral} central characters).`);
  }
  for (const np of diff.new_places ?? []) {
    if (!np?.name) continue;
    const exists = Object.values(state.world.places).some((p) => p.name.toLowerCase() === np.name.toLowerCase());
    if (!exists) {
      const id = uid("loc");
      state.world.places[id] = { id, name: np.name, description_facts: np.description_facts ?? "", contains: [] };
    }
  }

  // WEATHER CONTINUITY — the bookkeeper's raw weather jumps (clear → storm → clear in three turns).
  // Weather should EVOLVE: a storm doesn't vanish in one turn, clear skies don't become a blizzard
  // without a build-up. Accept the new weather only if it's a plausible neighbor of the current one
  // within the elapsed time; otherwise nudge one step toward it. Fully skipped for dramatic jumps the
  // fiction explicitly caused (a storm the player summoned) — those come through as-is when elapsed is large.
  if (diff.weather) state.world.weather = advanceWeather(state.world.weather, diff.weather, diff.elapsed_minutes ?? 30);
  if (diff.money) state.world.money = diff.money;

  // ── LOCATION: the bookkeeper records where everyone is. Places auto-resolve by
  //    id or name and are created on first mention (incl. "in-between" places like
  //    "walking outside the dome"). present is DERIVED from co-location, never authored. ──
  if (diff.player_location) {
    // the player never lands in `elsewhere`: an unrecognized name means they stayed put
    state.world.player_location = resolvePlace(state, diff.player_location, { keepIfUnknown: true });
    state.characters["char_player"].location = state.world.player_location;
  }
  for (const mv of diff.locations ?? []) {
    const cid = resolveId(state, mv.char_id);
    if (!cid || !mv.place) continue;
    const fromPid = state.characters[cid].location;
    const pid = resolvePlace(state, mv.place);
    if (pid !== fromPid) {
      // a move is an event the character remembers: where from, where to, when
      const fromName = (fromPid && state.world.places[fromPid]?.name) || "elsewhere";
      const toName = state.world.places[pid]?.name ?? mv.place;
      const mem = state.memory[cid];
      if (mem && fromPid) {
        // "elsewhere" is not a place, so the memory has to carry the detail: the words the narrator
        // used for where they went. Without this the character simply disappears with no account of it.
        const said = String((mv as { said?: string }).said ?? "").trim();
        const content = pid === OFFSCENE
          ? `Left ${fromName}${said ? ` — ${said.replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, "")}` : ""}.`
          : `Left ${fromName} and went to ${toName}.`;
        mem.episodic.push({
          turn, content: content.slice(0, 200),
          importance: 4, emotional_charge: "", when_label: state.world.current_time,
          where: pid === OFFSCENE ? fromName : toName,
          last_accessed_turn: turn,
        });
        mem.episodic = capMemory(mem.episodic);
      }
    }
    state.characters[cid].location = pid;
    if (cid === "char_player") state.world.player_location = pid;
  }
  // ── TRAVEL LOG ── the player's path through places, in order. Feeds the story map:
  //    each visited place is a node, each move an edge. Skips "elsewhere" (not a place)
  //    and consecutive repeats (staying put is not travel). Capped so old saves stay small.
  {
    const pid = state.world.player_location;
    if (pid && pid !== OFFSCENE) {
      const log = (state.travel_log ??= []);
      if (!log.length || log[log.length - 1].place !== pid) {
        log.push({ turn, place: pid });
        if (log.length > 400) log.splice(0, log.length - 400);
      }
    }
  }

  // ── EXITS: someone died or left the story for good. Mark them, pull them from the
  //    scene and any room, and stop the engine from seeding them new wants. ──
  // FORCED-DEATH DETECTOR — the death clamp prevents FALSE deaths (a live off-scene character
  // "dying" on a dialogue claim). This is its missing half: a REAL death the prose clearly depicts but
  // the bookkeeper failed to record. When that happens, status stays alive and the corpse stays in
  // world.present — so next turn the narrator keeps animating a dead body ("his fingers twitch"). If
  // the prose unambiguously kills a PRESENT character this turn and no exit was emitted for them, we
  // synthesize the exit so the engine marks them dead and removes them from the scene.
  {
    const alreadyExiting = new Set((diff.character_exits ?? []).map((e) => resolveId(state, e.char_id)).filter(Boolean));
    const proseLc = prose.toLowerCase();
    // a clear killing blow depicted this turn (the player shooting/stabbing, or the body going still/dead)
    const lethalDepicted = /\b(shot (him|her|them|it) in the head|head jerks? back|blows? (his|her|their) (head|brains)|goes (instantly|limp|still)|body (sags|slumps|drops|goes still|goes limp)|lifeless|dead(?:,| |\.)|killed (him|her|them)|throat (opens|cut)|stops? breathing|crumples? (dead|lifeless)|collapses? dead)\b/i.test(proseLc);
    if (lethalDepicted) {
      for (const pid of [...state.world.present]) {
        if (pid === "char_player" || alreadyExiting.has(pid)) continue;
        const c = state.characters[pid];
        if (!c || c.status === "dead" || c.status === "departed") continue;
        const name = c.name;
        // require the death to be attributable to THIS character: their name near a death verb, OR the
        // player's action this turn targeted them and the prose shows a body going still.
        const firstName = name.split(/\s+/)[0]?.toLowerCase() ?? name.toLowerCase();
        const esc = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Tightened: the death word must sit CLOSE to the name (<=25 chars, not 60), and we exclude the
        // common false positive where an inanimate object of theirs is what's "dead"/"still" — "Mara's
        // phone is dead", "his radio went still", "her lamp died". Without this, an object dying marks
        // the person dead. We also drop the bare "still/limp" verbs from the name-adjacency test (too
        // easy to hit in intimacy or collapse-from-exhaustion); those only count in the explicit
        // player-killed branch below.
        const inanimate = new RegExp(`\\b${esc}('s|s')?\\s+\\w{0,3}\\s*(phone|radio|signal|light|lamp|lantern|torch|fire|engine|battery|line|comm|screen|candle|voice|hope|eyes?|smile|arm|leg|hand)\\b`, "i").test(prose);
        const named = !inanimate && (
          new RegExp(`\\b${esc}\\b[^.!?]{0,25}\\b(is dead|lies dead|dies|died|is killed|was killed|lifeless|stops breathing|stopped breathing)\\b`, "i").test(prose)
          || new RegExp(`\\b(shot|stabbed?|killed?|struck down|put (a|the) (round|bullet|blade) (in|through))\\b[^.!?]{0,25}\\b${esc}\\b`, "i").test(prose)
        );
        // the stranger case: unnamed present target + player action was an explicit kill + a body goes still
        const playerKilled = /\b(i (shoot|shot|stab|stabbed|kill|killed|execute|executed)|shoot (him|her|it|them)|in the head)\b/i.test(action.toLowerCase());
        const bodyStill = /\b(goes (instantly|limp|still)|body (sags|slumps|goes still|goes limp)|head jerks? back|lifeless|crumples? (dead|to the ground))\b/i.test(proseLc);
        if (named || (playerKilled && bodyStill)) {
          (diff.character_exits ??= []).push({ char_id: pid, kind: "dead", note: "killed onscreen (recovered by forced-death detector — bookkeeper missed the exit)" });
          console.warn(`[turn] forced-death detector: recorded ${name}'s depicted death that the bookkeeper failed to emit`);
          break; // one forced death per turn is plenty; avoid a cascade of guesses
        }
      }
    }
  }

  for (const ex of diff.character_exits ?? []) {
    const cid = resolveId(state, ex.char_id);
    if (!cid || cid === "char_player") continue;
    const c = state.characters[cid];
    if (!c) continue;
    c.status = ex.kind;
    c.exit_turn = turn;
    if (ex.note) c.exit_note = ex.note;
    c.tracked = false;
    c.drive = undefined;
    c.drive_queue = [];
    // remove from whatever room held them
    const pid = c.location;
    if (pid && state.world.places[pid]) {
      state.world.places[pid].contains = state.world.places[pid].contains.filter((x) => x !== cid);
    }
    shifts.push(ex.kind === "dead" ? `${c.name} is dead.` : `${c.name} is gone.`);
  }

  syncPresence(state, diff.present);

  // FIRST READ — the moment two people share a scene, each gets a conditioned read of the
  // other: taste meeting what the person actually is. Set once; never authors the player's.
  for (const a of state.world.present) {
    if (state.characters[a]?.central === false) continue;
    seedAttraction(state, a, "char_player");
    for (const b of state.world.present) if (a !== b && state.characters[b]?.central !== false) seedAttraction(state, a, b);
  }

  // ── DEATH LOCK ── the dead stay dead. A weak simulator can re-emit a killed character as present
  // or alive on a later turn (it sees them lingering in a scene and writes them acting), which
  // resurrects them. Nothing above guards against that, so enforce it here as an absolute floor:
  // any character marked dead is stripped from the scene, every room, all tracking and drives, and
  // can never be reactivated by a diff. This runs AFTER syncPresence so it wins unconditionally.
  for (const [cid, c] of Object.entries(state.characters)) {
    if (c.status !== "dead") continue;
    state.world.present = state.world.present.filter((p) => p !== cid);
    for (const p of Object.values(state.world.places)) p.contains = p.contains.filter((x) => x !== cid);
    if (c.tracked || c.drive || (c.drive_queue?.length ?? 0)) { c.tracked = false; c.drive = undefined; c.drive_queue = []; }
  }

  // a new standing quirk/interest the story earned (kept small; capped so it never becomes a list)
  for (const tx of diff.texture_add ?? []) {
    const cid = resolveId(state, tx.char_id);
    if (!cid || !tx.item?.trim()) continue;
    const c = state.characters[cid];
    c.texture ??= [];
    const item = tx.item.trim();
    if (!c.texture.some((t) => t.toLowerCase() === item.toLowerCase())) {
      c.texture.push(item);
      if (c.texture.length > 5) c.texture = c.texture.slice(-5);
    }
  }


  for (const f of diff.facts ?? []) {
    const id = resolveId(state, f.char_id); if (!id) continue;
    const c = state.condition[id]; if (!c) continue;
    // COERCE VALUE — the model sometimes emits a fact value as a number, array, or object instead of
    // a string (e.g. thirst as 7, or a condition as ["cold","wet"]). Downstream handlers call
    // .toLowerCase()/regex on it, which throws "a.toLowerCase is not a function" and crashes the whole
    // bookkeeper apply. Normalize to a string once, here, so every case below is safe.
    if (Array.isArray((f as any).value)) (f as any).value = (f as any).value.map((v: any) => String(v)).join(", ");
    else if (f.value != null && typeof f.value !== "string") (f as any).value = String((f as any).value);
    else if (f.value == null) (f as any).value = "";
    switch (f.field) {
      case "fatigue": if (["fresh","tired","exhausted"].includes(f.value)) c.fatigue = f.value as any; break;
      case "hunger": {
        if (["fed","peckish","hungry","starving"].includes(f.value)) {
          c.hunger = f.value as any;
          c.hunger_meter = { fed: 1, peckish: 5, hungry: 7, starving: 9.5 }[f.value as "fed"|"peckish"|"hungry"|"starving"];
        } else applyMeal(c, /feast|banquet/i.test(f.value) ? "feast" : /snack|bite|morsel/i.test(f.value) ? "snack" : "meal");
        break;
      }
      case "thirst": {
        if (/quench|drank|drink|hydrat|water|sated/i.test(f.value)) applyDrink(c);
        else if (/parch|dehydrat|dry/i.test(f.value)) c.thirst_meter = 8.5;
        else { const n = parseFloat(f.value); if (!isNaN(n)) c.thirst_meter = clamp(n, 0, 10); }
        break;
      }
      case "slept": {
        const hrs = parseFloat(f.value);
        applySleep(c, isNaN(hrs) ? 7 : clamp(hrs, 1, 14));
        break;
      }
      case "condition_add": addCondition(c, f.value, turn); break;
      case "condition_remove": {
        const q = f.value.toLowerCase();
        c.conditions = c.conditions.filter((x) => {
          const keep = !(x.toLowerCase().includes(q) || q.includes(x.toLowerCase()) || wordOverlap(x, f.value));
          if (!keep) delete c.condition_age?.[x];
          return keep;
        });
        break;
      }
      case "inventory_add": if (f.value && !c.inventory.some((i) => i.name.toLowerCase() === f.value.toLowerCase())) c.inventory.push({ id: uid("itm"), name: f.value }); break;
      case "inventory_remove": c.inventory = c.inventory.filter((i) => i.name.toLowerCase() !== f.value.toLowerCase()); break;
      case "wearing_add": {
        if (!f.value) break;
        const v = f.value.toLowerCase();
        // drop any existing garment that shares a head noun (coat, jacket, dress…) so layers replace, not pile up
        const noun = (s: string) => (s.toLowerCase().match(/\b(coat|jacket|dress|shirt|gown|cloak|robe|suit|armor|armour|trousers|pants|boots|shoes|gloves|mask|hat)\b/)?.[1]) ?? "";
        const vn = noun(v);
        if (vn) c.wearing = c.wearing.filter((w) => noun(w) !== vn);
        if (!c.wearing.some((w) => w.toLowerCase() === v)) c.wearing.push(f.value);
        if (c.wearing.length > 10) c.wearing = c.wearing.slice(-10);
        break;
      }
      case "wearing_remove": {
        const v = (f.value || "").toLowerCase();
        c.wearing = c.wearing.filter((w) => { const lw = w.toLowerCase(); return lw !== v && !lw.includes(v) && !v.includes(lw); });
        break;
      }
      case "injury": if (f.value) c.injuries.push({ id: uid("inj"), type: f.value, cause: "this turn", permanent: false, functional_impact: f.value }); break;
      case "injury_remove": {
        const q = f.value.toLowerCase();
        c.injuries = c.injuries.filter((inj) => !(inj.type.toLowerCase().includes(q) || q.includes(inj.type.toLowerCase())));
        break;
      }
    }
  }

  for (const p of diff.psyche ?? []) {
    const id = resolveId(state, p.char_id); if (!id) continue;
    const c = state.condition[id]; if (!c) continue;
    c.psyche.relaxation = clamp(c.psyche.relaxation + clamp(p.relaxation_delta ?? 0, -6, 6), -10, 10);
    if (p.mood) c.psyche.mood = p.mood;
    for (const s of p.states_add ?? []) if (s && !c.psyche.active_states.includes(s)) { c.psyche.active_states.push(s); (c.psyche.state_ages ??= {})[s] = turn; }
    if (p.mood) c.psyche.mood_set_turn = turn;
    for (const s of p.states_remove ?? []) c.psyche.active_states = c.psyche.active_states.filter((x) => x !== s);
    if (c.psyche.active_states.length > 5) c.psyche.active_states = c.psyche.active_states.slice(-5);
    const d = clamp(p.relaxation_delta ?? 0, -6, 6);
    if (id !== "char_player" && Math.abs(d) >= 3) shifts.push(d > 0 ? `${nameOf(id)} relaxed a little.` : `${nameOf(id)} tensed up.`);
  }

  const explicitEdges = new Set((diff.edges ?? []).map((e) => `${resolveId(state, e.from)}|${resolveId(state, e.to)}`));
  for (const e of diff.edges ?? []) {
    const from = resolveId(state, e.from), to = resolveId(state, e.to);
    if (!from || !to || from === to) continue;
    applyEdgeDelta(state.world.edges, { from, to, warmth_delta: e.warmth_delta ?? 0, trust_delta: e.trust_delta ?? 0, power_delta: e.power_delta ?? 0, note: e.note, roles_set: e.roles_set }, turn);
    // ATTRACTION — its own axis, never bundled into warmth and NEVER echoed back (desire isn't
    // mutual). Orientation-gated: a stated orientation is a hard cap the simulator can't move past.
    // The player's own desire is never authored (rule 5) — their edge only moves if they're the target.
    const rawAttr = (e as any).attraction_delta ?? 0;
    if (rawAttr && from !== "char_player") {
      const fromC = state.characters[from], toC = state.characters[to];
      if (fromC && toC) {
        const edge = getEdge(state.world.edges, from, to);
        if (edge.attraction === undefined) seedAttraction(state, from, to);
        const cap = orientationCap(fromC, toC);
        let next = clamp((edge.attraction ?? 0) + clamp(rawAttr, -8, 8), -100, 100);
        if (cap !== null) next = Math.min(next, cap);
        edge.attraction = next;
        if (edge.attraction_base === undefined) edge.attraction_base = next;
        if (to === "char_player") {
          if (rawAttr >= 4) shifts.push(`${nameOf(from)} is drawn to you a little more.`);
          else if (rawAttr <= -4) shifts.push(`${nameOf(from)}'s pull toward you fades.`);
        }
      }
    }
    // RECIPROCAL ECHO: relationships move both ways, but the simulator usually emits one
    // direction. A meaningful shift echoes back at reduced strength — unless the diff moved
    // the reverse explicitly, and never INTO the player's own head (their feelings are theirs;
    // rule 5). Power echoes inverted: standing gained over someone is standing they ceded.
    const w = e.warmth_delta ?? 0, tr = e.trust_delta ?? 0, pw = e.power_delta ?? 0;
    if (to !== "char_player" && !explicitEdges.has(`${to}|${from}`) && (Math.abs(w) >= 4 || Math.abs(tr) >= 4 || Math.abs(pw) >= 4)) {
      applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: Math.round(w * 0.3), trust_delta: Math.round(tr * 0.25), power_delta: Math.round(-pw * 0.5) }, turn);
    }
    if (to === "char_player") {
      const w = e.warmth_delta ?? 0, tr = e.trust_delta ?? 0;
      if (w <= -5) shifts.push(`${nameOf(from)} cooled toward you.`);
      else if (w >= 5) shifts.push(`${nameOf(from)} warmed toward you.`);
      if (tr <= -5) shifts.push(`${nameOf(from)} trusts you less.`);
      else if (tr >= 5) shifts.push(`${nameOf(from)} trusts you more.`);
    }
  }

  // GROUNDING: everything the bookkeeper writes to memory is checked against the turn's actual
  // text. A proper noun in a memory that appears in neither the source nor the world's known
  // names was confabulated (the "told him Seattle, it saved Portland" bug); we repair it by
  // swapping in the best verbatim source sentence — truth by construction, zero tokens.
  const sourceText = `${action}\n${prose}`;
  // What the PLAYER actually said aloud this turn — the only channel through which the world can
  // learn the player's private background. Facts about the player that trace only to NARRATION are
  // leaks: the narrator wrote "you're an engineer" and then a character "learned" it. Reject those.
  const playerSpeech = (action.match(/"([^"]*)"/g) ?? []).join(" ").toLowerCase();
  const bg = `${state.characters["char_player"]?.background ?? ""} ${state.characters["char_player"]?.life_history ?? ""}`.toLowerCase();
  const bgTokens = new Set((bg.match(/[a-z][a-z']{4,}/g) ?? []).filter((w) => !["their","there","which","would","about","other","being","these","those","after","before","because","service"].includes(w)));
  const isPrivateBackgroundLeak = (factText: string, learnerId: string): boolean => {
    if (learnerId === "char_player") return false; // the player knowing their own background is fine
    const ft = factText.toLowerCase();
    // does this fact repeat a distinctive word from the player's private dossier?
    const hits = [...bgTokens].filter((t) => ft.includes(t));
    if (!hits.length) return false;
    // allowed only if the player themselves said that word aloud this turn
    return !hits.some((t) => playerSpeech.includes(t));
  };
  const whitelist = knownNameWhitelist(state);
  for (const fl of diff.facts_learned ?? []) {
    const id = resolveId(state, fl.char_id); if (!id || !fl.fact) continue;
    const mem = state.memory[id]; if (!mem) continue;
    if (isPrivateBackgroundLeak(fl.fact, id)) {
      console.warn(`[facts] BLOCKED background leak: ${nameOf(id)} cannot know "${fl.fact.slice(0, 60)}" — the player never revealed it`);
      continue;
    }
    const quoteOk = !!fl.quote && sourceText.toLowerCase().includes(fl.quote.trim().toLowerCase());
    const g = groundMemoryContent(fl.fact, quoteOk ? fl.quote : undefined, sourceText, whitelist);
    // a fact whose specifics can't be traced to the source at all is not stored as fact —
    // it degrades to an ordinary low-importance memory of the exchange, and we log it.
    if (!g.repaired && g.suspects.length) {
      console.warn(`[facts] unverifiable fact for ${nameOf(id)} (suspects: ${g.suspects.join(", ")}) — not ledgered`);
      continue;
    }
    if (addFact(mem, g.content, turn, quoteOk ? fl.quote : undefined, state.world.present.includes(id) ? "witnessed" : "inferred") && id !== "char_player") shifts.push(`${nameOf(id)} now knows: ${g.content}`);
  }
  for (const m of diff.memories ?? []) {
    const id = resolveId(state, m.char_id); if (!id || !m.content) continue;
    const mem = state.memory[id]; if (!mem) continue;
    if (isPrivateBackgroundLeak(m.content, id)) {
      console.warn(`[memory] BLOCKED background leak in ${nameOf(id)}'s memory — the player never revealed it`);
      continue;
    }
    { const v = driftVeto(state, id, m.content); if (v) { console.warn(`[drift] refused memory: ${v}`); shifts.push(`the ledger held the line: ${nameOf(id)} doesn't change against their grain without cause.`); continue; } }
    const g = groundMemoryContent(m.content, m.anchor, sourceText, whitelist);
    if (g.repaired) m.content = g.content;
    else if (g.suspects.length) console.warn(`[memory] suspect specifics in ${nameOf(id)}'s memory (${g.suspects.join(", ")}) — no source sentence matched; stored as-is`);
    const wherePid = state.characters[id]?.location;
    // HYBRID TEMPORAL MODEL. Time is verbatim detail — it decays FIRST (fastest), fuzzing from an
    // exact stamp to a widening range as the memory fades (handled at DISPLAY time by decay_stage, so
    // the stored value stays intact for sorting). What survives the fade is the GIST anchor: a sticky
    // landmark-relative placement ("before the outbreak") the bookkeeper supplies, which NEVER decays
    // and keeps the memory's before/after ordering even when the clock dissolves. This is faithful to
    // reconstructive memory (verbatim time fuzzes, semantic gist persists) and guards against a faded
    // memory drifting into the wrong point in the timeline. A normal now-memory needs neither field.
    const suppliedLabel = (m as any).when_label?.trim();
    const anchorRel = (m as any).anchor_rel?.trim() || undefined;
    // event_turn is for chronological SORT only (so recalled-past events sit in the past), never for
    // display precision. If the bookkeeper gave a past label or a "before …" anchor, treat the event
    // as older than now; otherwise it happened this turn.
    const isPast = !!anchorRel && /\b(before|prior|earlier|ago|used to|back (when|then)|once|years?|childhood|outbreak|the note|arriv)/i.test(anchorRel);
    mem.episodic.push({
      turn, event_turn: isPast ? 0 : turn, anchor_rel: anchorRel,
      content: compactGist(m.content), full_content: m.content, decay_stage: 0,
      importance: clamp(m.importance ?? 3, 1, 10),
      emotional_charge: m.emotional_charge ?? "", last_accessed_turn: turn,
      when_label: suppliedLabel || state.world.current_time,
      where: (wherePid && state.world.places[wherePid]?.name) || undefined,
      // PROVENANCE — a character present this turn witnessed it first-hand; one not in the scene who
      // still gets a memory (rare, and gated elsewhere) only inferred/heard it. This is what makes
      // "how does she know that?" answerable and lets hearsay be weighted below witnessed later.
      source: state.world.present.includes(id) ? "witnessed" : "inferred",
      ...(m.scheduled_time ? { scheduled_time: m.scheduled_time, commitment_status: "pending" as const } : {}),
    });
    mem.episodic = capMemory(mem.episodic);
    // CORE PROMOTION: life-defining events (model-flagged core, or importance 9+) become part of
    // the immutable autobiography AND a durable ledger fact — immune to decay, condensation, and
    // retrieval burial. A character's first-in-a-lifetime event must never fade like a Tuesday.
    // CORE PROMOTION — requires the DELIBERATE flag, not just a hot number: models rate every
    // intense beat a 9, and permanence must be chosen, not inferred. Then a quality gate:
    // no quote shards, no fragments, no near-duplicates of an entry already held (one life
    // event = one line, however many turns it took to happen).
    if (m.core) {
      const line = m.content.replace(/\s+/g, " ").trim().slice(0, 200);
      const shard = line.split(/\s+/).length < 6 || /["“”]/.test(line);
      const nearDup = mem.core.some((c) => c.toLowerCase() === line.toLowerCase() || factOverlap(c, line) >= 0.55);
      if (line && !shard && !nearDup) {
        mem.core.push(line);
        if (mem.core.length > 14) mem.core.splice(4, 1); // keep the founding four, trim the middle
        addFact(mem, line, turn, m.anchor);
        shifts.push(`${nameOf(id)} will never forget this.`);
      }
    } else if (id !== "char_player" && (m.importance ?? 3) >= 6) shifts.push(`${nameOf(id)} will remember that.`);
  }

  // reconsolidation: discussed past events get rebuilt with supplied detail (recall rewrites the
  // trace) — BUT only if the receiver credits the source. Whether the detail integrates is gated by
  // the receiver's warmth+trust toward whoever supplied it, against their own clench-resistance.
  for (const rc of (diff as any).memory_recohere ?? []) {
    const id = resolveId(state, rc.char_id); if (!id || !rc.about || !rc.added_detail) continue;
    const mem = state.memory[id]; if (!mem) continue;
    // integration gate: do they believe this source?
    const srcId = rc.source_char ? resolveId(state, rc.source_char) : null;
    const relax = state.condition[id]?.psyche?.relaxation ?? 0;
    let integrates = true;
    if (srcId && srcId !== id) {
      const edge = state.world.edges.find((e) => e.from === id && e.to === srcId);
      integrates = integrationGate(relax, edge?.warmth ?? 0, edge?.trust ?? 0);
    }
    if (!integrates) {
      // they hold their own version; the correction bounces off
      if (id !== "char_player") shifts.push(`${nameOf(id)} isn't buying that version.`);
      continue;
    }
    const merged = reconsolidate(mem, rc.about, rc.added_detail, turn);
    if (!merged) {
      // nothing close enough to recohere — it was effectively a new recollection; store it
      mem.episodic.push({
        turn, content: rc.added_detail, full_content: rc.added_detail, decay_stage: 1,
        importance: 4, emotional_charge: "", last_accessed_turn: turn, when_label: state.world.current_time,
        // came from someone else supplying the detail in conversation → told_by that source
        source: srcId && srcId !== id ? { told_by: srcId } : "witnessed",
      });
      mem.episodic = capMemory(mem.episodic);
    }
  }

  // ALIASES — the fiction coined a handle ("the captain", "Sor"); record it so name resolution
  // and memory retrieval map the handle to the person. Guarded: ≥3 chars, capped, never another
  // character's name or existing alias.
  for (const al of diff.aliases_add ?? []) {
    const id = resolveId(state, al?.id ?? "");
    const a = (al?.alias ?? "").trim();
    if (!id || !state.characters[id] || a.length < 3 || a.length > 40) continue;
    const lower = a.toLowerCase();
    const taken = Object.entries(state.characters).some(([oid, oc]) =>
      (oid !== id && oc.name.toLowerCase() === lower) || (oid !== id && oc.aliases?.some((x) => x.toLowerCase() === lower)));
    if (taken) continue;
    const c = state.characters[id];
    c.aliases ??= [];
    if (c.name.toLowerCase() === lower || c.aliases.some((x) => x.toLowerCase() === lower)) continue;
    c.aliases.push(a);
    if (c.aliases.length > 6) c.aliases.shift();
  }

  for (const cn of diff.canon_add ?? []) {
    if (!cn || !addCanon(state, cn)) continue;
    // Canon is world-altering and PUBLIC, but knowledge of it PROPAGATES — it does not teleport
    // into every mind at once. Those PRESENT witnessed it and remember it now. Everyone else learns
    // it the way news travels: seeded as a fast-spreading rumor that reaches other minds over turns.
    // (Destroy a city, then flee to another country, and the people there don't know yet.)
    for (const id of state.world.present) {
      if (!state.memory[id]) continue;
      state.memory[id].episodic.push({
        turn, content: `I was there when it happened: ${cn}`, full_content: `I was there when it happened: ${cn}`,
        decay_stage: 0, importance: 9, emotional_charge: "awe", last_accessed_turn: turn,
        when_label: state.world.current_time,
        where: (state.characters[id]?.location && state.world.places[state.characters[id].location!]?.name) || undefined,
      });
    }
    // seed the spread: a true, high-reach rumor so the wider world finds out as news, not by fiat
    const origin = state.world.present.find((id) => id !== "char_player") ?? "char_player";
    state.world.rumors.push({
      id: uid("rum"), content: cn, truth: "true", salience: 10, origin_char: origin,
      knowers: [...state.world.present], born_turn: turn, dead: false,
    });
    if (state.world.rumors.length > 40) state.world.rumors = state.world.rumors.slice(-40);
    shifts.push(`CANON: ${cn} (news will spread over time)`);
  }

  const beautyDirty = new Set<string>(); // chars whose on-sight appearance changed this turn → rescore
  for (const a of diff.appearance ?? []) {
    const id = resolveId(state, a.char_id); if (!id || !a.value) continue;
    const c = state.characters[id];
    if (a.permanent) {
      // BEDROCK is append-only. A scar, a lost finger, a brand — one sentence joins the
      // baseline; face, eyes, hair, build stay exactly as written at creation. The old code
      // replaced appearance_facts wholesale here, and every partial "revision" from the
      // bookkeeper erased the character's actual face. Never again.
      const cleaned = stripTransient(a.value);
      if (!cleaned) continue;
      const sentence = cleaned.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "") + ".";
      if (!c.appearance_facts.toLowerCase().includes(sentence.toLowerCase().slice(0, -1))) {
        c.appearance_facts = `${c.appearance_facts.replace(/[.\s]+$/, "")}. ${sentence}`.slice(0, 700);
        shifts.push(`${nameOf(id)} is permanently marked — ${cleaned}`);
        beautyDirty.add(id); // a permanent bodily change alters the on-sight read → rescore beauty
      }
    } else {
      // presentation layer: freely replaced, never touches the baseline. A stranger still judges
      // it on sight (revealing dress, armor, ruin), so a genuine CHANGE of presentation also
      // triggers a rescore — but only when the text actually changed, so unchanging outfits
      // (the common case, turn after turn) never fire a call.
      const next = a.value.replace(/\s+/g, " ").trim().slice(0, 300);
      if (next && next.toLowerCase() !== (c.appearance_now ?? "").toLowerCase()) {
        c.appearance_now = next;
        beautyDirty.add(id);
      }
    }
  }
  state.pending_beauty_rescore = [...new Set([...(state.pending_beauty_rescore ?? []), ...beautyDirty])];

  // group drives_update by character; highest priority becomes active, rest become the queue (max 2)
  const drivesByChar = new Map<string, typeof diff.drives_update>();
  for (const du of diff.drives_update ?? []) {
    const id = resolveId(state, du.char_id); if (!id || id === "char_player" || !du.goal) continue;
    (drivesByChar.get(id) ?? drivesByChar.set(id, []).get(id)!).push(du);
  }
  for (const [id, dus] of drivesByChar) {
    const sorted = [...dus].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
    const mk = (d: typeof sorted[number]) => ({ goal: d.goal, progress: clamp(d.progress ?? 0, 0, 100), blocker: d.blocker, priority: d.priority ?? 1, updated_turn: turn });
    state.characters[id].drive = mk(sorted[0]);
    if (sorted.length > 1) state.characters[id].drive_queue = sorted.slice(1, 3).map(mk);
    state.characters[id].tracked = true;
    if (!sorted[0].progress) shifts.push(`${nameOf(id)} wants something new: ${sorted[0].goal}.`);
  }

  // the narrator can promote characters into the long game
  for (const tk of diff.track ?? []) {
    const id = resolveId(state, tk); if (!id || id === "char_player") continue;
    if (!state.characters[id].tracked) {
      state.characters[id].tracked = true;
      shifts.push(`${nameOf(id)} is now tracked as a recurring character.`);
    }
  }

  for (const t of diff.traits ?? []) {
    const id = resolveId(state, t.char_id); if (!id || id === "char_player" || !t.label) continue;
    // age plausibility: temperament/disposition can form at any age (guarded, cruel, brave), but
    // ACQUIRED EXPERTISE needs years a child hasn't lived. Block mastery-type traits on the young.
    const age = state.characters[id]?.age ?? 30;
    if (age < 16 && impliesExpertise(t.label) && age < expertiseFloor(t.label)) continue; // too young for this expertise
    { const v = driftVeto(state, id, t.label); if (v) { console.warn(`[drift] refused trait "${t.label}": ${v}`); continue; } }
    // HABIT ENGINE: a trait that contradicts an established habit doesn't flip the person — it credits
    // the arc. The dramatic moment feeds the slow dissolution instead of skipping it.
    if (state.model_settings.habit_engine) {
      const absorbed = absorbContradiction(state, id, t.label, 6);
      if (absorbed) { console.warn(`[habit] "${t.label}" absorbed as a seen-fire credit against "${absorbed}" (not planted — arcs are earned, not flipped)`); continue; }
    }
    reinforceOrMergeTrait(state.traits[id] ?? (state.traits[id] = []), t, turn);
    shifts.push(`${nameOf(id)} is developing a new trait: "${t.label}".`);
  }

  // SELF-HEAL — collapse any near-duplicate active threads already in the world (from before dedup
  // existed). Keep the oldest (lowest turn_started), fold the rest into it. Runs cheaply each turn.
  {
    const act = state.world.threads.filter((t) => t.status === "active");
    const drop = new Set<string>();
    for (let i = 0; i < act.length; i++) {
      if (drop.has(act[i].id)) continue;
      for (let j = i + 1; j < act.length; j++) {
        if (drop.has(act[j].id)) continue;
        if (overlapRatio(act[i].title, act[j].title) >= 0.6) {
          const keep = (act[i].turn_started ?? 0) <= (act[j].turn_started ?? 0) ? act[i] : act[j];
          const lose = keep === act[i] ? act[j] : act[i];
          keep.tension = Math.max(keep.tension ?? 3, lose.tension ?? 3);
          drop.add(lose.id);
        }
      }
    }
    if (drop.size) state.world.threads = state.world.threads.filter((t) => !drop.has(t.id));
  }

  // ── PROMISES ── new promises land on the ledger; resolved ones apply their weight-and-pattern
  // scaled relationship change. The player's own kept/broken word is the biggest driver here.
  for (const pn of diff.promises_new ?? []) {
    const from = resolveId(state, pn.from), to = resolveId(state, pn.to);
    if (from && to) addPromise(state, from, to, pn.text, pn.weight, pn.due_time);
  }
  for (const pr of diff.promises_resolved ?? []) {
    let target = pr.id ? (state.world.promises ?? []).find((p) => p.id === pr.id && p.status === "open") : undefined;
    if (!target) {
      const from = pr.from ? resolveId(state, pr.from) : undefined;
      const to = pr.to ? resolveId(state, pr.to) : undefined;
      const open = (state.world.promises ?? []).filter((p) => p.status === "open" && (!from || p.from === from) && (!to || p.to === to));
      target = pr.text ? open.find((p) => relevance(p.text, pr.text!) >= 0.5) : open[0];
    }
    if (target) { const line = resolvePromise(state, target, pr.outcome, turn); if (line) shifts.push(line); }
  }

  for (const tu of diff.threads_update ?? []) {
    if (!tu?.title) continue;
    const existing = state.world.threads.find((t) => t.id === tu.id || t.title.toLowerCase() === tu.title.toLowerCase()
      // near-duplicate: same beat with a reworded title (subject + action overlap heavily)
      || (t.status === "active" && overlapRatio(t.title, tu.title) >= 0.6));
    if (existing) {
      existing.status = tu.status;
      if (tu.description) existing.description = tu.description;
      if (typeof tu.tension === "number") existing.tension = clamp(Math.min(tu.tension, (existing.tension ?? 3) + 2), 0, 10); // escalation is earned: +2/turn max
      if (tu.status === "resolved") existing.turn_resolved = turn;
    } else if (tu.status === "active") {
      // BIRTH CALIBRATION: a thread is born as POTENTIAL, not a mature crisis. New threads cap
      // at tension 6 (5 in the game's first 10 turns — arrivals establish, they don't besiege);
      // a real crisis earns its 9 turn by turn. This is the fix for "the world was born armed":
      // a turn-1 manhunt at tension 9 with no history contradicts any bible it lives in.
      const birthCap = turn <= 10 ? 5 : 6;
      state.world.threads.push({ id: uid("thr"), title: tu.title, status: "active", description: tu.description ?? "", turn_started: turn, tension: clamp(Math.min(tu.tension ?? 3, birthCap), 0, 10) });
      shifts.push(`A new thread: ${tu.title}.`);
    }
    if (existing && tu.status === "resolved") shifts.push(`Thread resolved: ${tu.title}.`);
  }

  for (const r of diff.rumors_new ?? []) {
    if (!r?.content) continue;
    const origin = resolveId(state, r.origin_char) ?? "char_player";
    state.world.rumors.push({
      id: uid("rum"), content: r.content, truth: r.truth ?? "true",
      salience: clamp(r.salience ?? 5, 1, 10), origin_char: origin,
      knowers: [origin, ...state.world.present.filter(() => Math.random() < 0.6)],
      born_turn: turn, about_char: r.about_char ? resolveId(state, r.about_char) ?? undefined : undefined,
    });
    if (state.world.rumors.length > 40) state.world.rumors = state.world.rumors.slice(-40);
    shifts.push(r.truth === "true" ? `A new rumor is spreading.` : `A new rumor is spreading — and it isn't true.`);
  }

  for (const c of diff.consequences_new ?? []) {
    if (!c?.description) continue;
    // DEDUP — the model re-emits the same impending event across turns ("two speeders dropping fast
    // reach the plaza") and it stacks as separate consequences that then all fire. Skip a new one
    // that closely matches an existing PENDING consequence, or one that FIRED in the last few turns
    // (so a just-fired beat isn't immediately re-scheduled). Match on description overlap.
    const dupExisting = state.world.consequences.find((x) =>
      (x.status === "pending" || (x.status === "fired" && (x.fire_turn ?? 0) >= turn - 3))
      && overlapRatio(x.description, c.description) >= 0.55);
    if (dupExisting) continue;
    // prefer an in-world-time schedule: "in 2 days" must mean two days of story time, not two turns.
    const deltaMin = (c.fire_in_days ? c.fire_in_days * 1440 : 0) + (c.fire_in_hours ? c.fire_in_hours * 60 : 0);
    const fire_time = deltaMin > 0 ? advance(state.world.current_time, deltaMin) : undefined;
    state.world.consequences.push({
      id: uid("cq"), description: c.description,
      fire_turn: turn + Math.max(1, c.fire_in_turns ?? 1),   // a floor only
      fire_time,
      severity: c.severity ?? "notable", source_char: c.source_char ? resolveId(state, c.source_char) ?? undefined : undefined,
      location_trigger: c.location_trigger, status: "pending",
    });
    shifts.push(fire_time ? `A consequence is scheduled for ${fire_time.replace(/\s*\(.*\)$/, "")}.` : `A consequence was scheduled. It will land in a coming turn.`);
  }

  for (const ca of diff.clocks_advance ?? []) {
    if ((state.model_settings.tension ?? 5) <= 0) break;   // tension 0: faction clocks freeze, no background escalation
    const clock = state.world.clocks.find((c) => c.id === ca.id || c.faction.toLowerCase() === String(ca.id).toLowerCase());
    if (clock && clock.status === "running") {
      clock.filled = clamp(clock.filled + Math.min(1, ca.segments ?? 1), 0, clock.segments); // a clock ADVANCES — one segment per turn; a clock that leaps is a jump scare, not a clock
      shifts.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
    }
  }

  return shifts;
}
