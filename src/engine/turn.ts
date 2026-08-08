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
import { decidePressure, isDue, pressureDirective, detectPowerTier, tierFromRecord, rememberPowerTier, selectBeat, dischargeFiredClocks, type Beat } from "./pressure";
import { readFate, enforceFate, fateDirective, fatePressureFloor, outcomeOf } from "./fate";
import { detectWorldPronoun, repairNativePronouns } from "./coerce";
import { narratorSystem, simulatorSystem, REFLECTION_SYSTEM, CHAPTER_SYSTEM, simulatorSchemaHint, stablePrefix, volatileDigest, simulatorContext, deltaNote, ledgerSnapshot } from "./prompts";
import { updateMind } from "./mind";
import { buildMessages, buildChatlogMessages, complete, completeStream, safeJson, setLLMPrefs } from "../llm";
import { runReads, needsFaculties, deriveFaculties, type Read } from "./read";
import { frameDirective } from "./frame";
import { threadsFromSuccess } from "./consequence";
import { runIntentPass, intentForNarrator, intentForBookkeeper, type NpcIntent } from "./intent";
import { tickHabits, habitVerdicts, regrooveHabits, absorbContradiction, dissolveWornHabits } from "./habits";
import { noveltyDigest, recordExpressions } from "./novelty";
import { advance, heuristicMinutes, advanceWeather, minutesBetween, parseTime } from "./time";
import { applyEdgeDelta, decayEdges, capMemory, consolidateBackground, consolidateTraits, decayTraits, diffuseRumors, needsHistoryCompaction, reinforceOrMergeTrait, tickDrives, playerEdgeSnapshot, tickPsyche, getEdge, addPromise, promisesLikelyMet, resolvePromise, completeDrivesForPromises, applyStances, updatePublicStanding, publicStandingDirective, bondStrength, MASS_HARM } from "./social";
import { obduracyIn, isObdurate } from "./obduracy";
import { factionKnows, mundaneObjective, seedWitnessRumors } from "./knowledge";
import { runOffstage, returnFromOffscene } from "./offstage";
import { seedAttraction, orientationCap, tickDesire, tickRivalry, repairAuthoredBonds } from "./desire";
import { fadesOnItsOwn, bodyDirective, bodySeverity } from "./body";
import { crowdDirective } from "./population";
import { addCanon, expandAliases, pushSnapshot, registerCharacter, uid } from "./state";
import { tickEmotions, tickCoRegulation, tickDischarge } from "./emotions";
import { frameAttempt, attemptDirective } from "./attempt";
import { regenerateDrives, magnetPull } from "./drives";
import { reflectionDue, cleanMemoryContent, applyReflection, tickMemoryDecay, reconsolidate, integrationGate, compactGist, relevance } from "./memory";
import { knownNameWhitelist, groundMemoryContent, addFact, supersedeFact, filterSuspectBeliefs, factOverlap, engagedLaw } from "./facts";
import { extractHeuristics, backfillDiff, DEPART_IN_PROSE } from "./extract";
import { accruePhysiology, applyMeal, applyDrink, applySleep, applyRelaxationCeiling, physioLabel, reconcilePlayerTightness } from "./physiology";
import { SIMULATOR_JSON_SCHEMA } from "./schema";
import { neutralUndertow } from "./undertow";

export interface TurnEvents {
  onPhase: (phase: string) => void;
  onDelta: (text: string) => void;
  onMeta: (meta: object) => void;
  /** The player's own faculties, landing while the narrator is still writing. This is what the
   *  wait is FOR: the sealed read channel returns in a second or two on a throughput-routed small
   *  model, so the gap between action and prose is spent inside the player's head instead of on a
   *  spinner. Optional — a caller that ignores it loses nothing but the texture. */
  onRead?: (reads: Read[]) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Appended after the player's action every turn — the last thing the model reads before writing.
 *  Exists because mid-tier narrator models resolve scene momentum by moving the player's body
 *  (an NPC says "shower first," the player replies with words, the model writes them showering).
 *  The rulebook says never; recency makes it stick. */
/** The last thing the model reads, after the action, after everything. povFilter states the rule
 *  in full up in DIRECTION; this is the two-line version at the only position that reliably wins
 *  against the model's own replayed prose. pronounLock earned the tail slot the same way. */
/** PRESENCE RECONSTRUCTED FROM THE PROSE.
 *
 *  Presence has been maintained as STATE that drifts: entered/left are deltas, one missed delta is
 *  permanent, and nothing ever reconciles. Three separate saves have now run whole scenes with an
 *  empty roster — a captain and twenty riders in one, a conversation partner speaking from
 *  loc_offscene in another, and a library scene where the player walked in, found the person he
 *  came to find, talked to her for two turns, and the engine believed the room was empty. The
 *  player had to open the character screen and place her by hand.
 *
 *  The `here=` footer attribute is the right declaration, but it is still a declaration: it works
 *  when the narrator remembers to emit it, and a presence system that depends on a model
 *  remembering something is a presence system that will be empty again.
 *
 *  So this runs every turn as a FLOOR, underneath the footer. If a rostered character is the
 *  subject of a speech or physical verb in this turn's prose, they were in the scene — that is not
 *  an inference about the fiction, it is what the sentence says. Subject position is required, so
 *  that "Dumbledore would want to know about this" does not teleport Dumbledore into the room.
 *  It only ever ADDS presence; removal stays with the footer, because absence of evidence in one
 *  paragraph is not evidence someone left. */
function presenceFromProse(state: SaveState, prose: string): string[] {
  if (!prose) return [];
  // Three signals, any one of which means the sentence is ABOUT this person doing something here:
  // subject position at the start of a sentence, a possessive ("Hermione's head jerked up"), or the
  // name followed closely by an act. Deliberately broad on the verb, because a false positive only
  // places someone in a room they were already being written about, while a miss empties the roster
  // and silently disables focus, frame and reads.
  const ACT = "said|says|asked|asks|replied|answered|murmured|muttered|whispered|called|shouted|snapped|added|nodded|shrugged|laughed|smiled|frowned|grinned|winced|sighed|hesitated|paused|stopped|turned|looked|glanced|watched|leaned|stood|rose|sat|stepped|walked|moved|reached|held|took|put|set|pulled|pushed|opened|closed|shut|pointed|shook|jerked|lifted|dropped|tightened|flinched|blinked|breathed|straightened|crossed|folded|tapped|wrote|read|pressed|slid|handed|offered|waited|came|went|left|entered|arrived|followed|stared|studied";
  // A modal after the name means the sentence is hypothetical — "Dumbledore would want to know
  // about this" is a thought about an absent man, not a man in the room.
  const MODAL = /^\s*(?:would|could|should|might|will|won't|wouldn't|shouldn't|must|may|never|always|had been|used to)\b/i;
  const out: string[] = [];
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player") continue;
    const handles = [c.name, c.name.split(/\s+/)[0], ...(c.aliases ?? [])]
      .filter((h) => h && h.length >= 3)
      .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!handles.length) continue;
    const alt = handles.join("|");
    const re = new RegExp(`(^|[.!?\u201d"]\\s+|\\n)\\s*(?:${alt})\\b('s)?([^.!?\\n]{0,60})`, "gi");
    const near = new RegExp(`\\b(?:${alt})\\b(?:'s)?\\s+(?:[a-z]+\\s+){0,2}(?:${ACT})\\b`, "i");
    let hit = false;
    let m: RegExpExecArray | null;
    while (!hit && (m = re.exec(prose))) {
      if (MODAL.test(m[3] ?? "")) continue;      // hypothetical mention
      hit = true;                                 // sentence-initial or possessive subject
    }
    if (hit || near.test(prose)) out.push(id);
  }
  return out;
}

/** ECHO BAN.
 *
 *  Characters kept answering the player by describing the player back to him, seconds after the
 *  fact: "you didn't even look at it, you just knew", "you don't just imagine knowing a castle",
 *  "most people, they'd run — they'd scream". Nobody talks like that. A person who has just seen
 *  something startling asks about themselves, changes the subject, gets on with what they were
 *  doing, or says the wrong thing entirely — what they almost never do is narrate your last action
 *  to you in the form of a marvel.
 *
 *  Two causes feed it. The narrator is handed the player's action as the salient event of the turn
 *  and nothing else with comparable weight, so an NPC with no live want of their own has only that
 *  to speak from. And the witness-reaction guidance for high-power play asks explicitly for awe,
 *  which resolves into commentary. Lowering the agent-priority bar in pressure.ts gives characters
 *  their own material; this stops the reflex directly.
 *
 *  Also carries the do-not-repeat list. In chatlog mode, a minimal player turn ("Yeah..." quietly)
 *  leaves the narrator with no new material and it restages the previous beat — turn 17 in one save
 *  reopens with turn 16's closing line word for word. Naming the lines is cheap and specific in a
 *  way "don't repeat yourself" is not. */
function echoBan(state: SaveState): string {
  const prev = state.history[state.history.length - 1]?.narrator_prose ?? "";
  const spoken = (prev.match(/"[^"]{8,160}"/g) ?? []).slice(-4).map((q) => q.trim());
  const norepeat = spoken.length
    ? `\nALREADY SPOKEN LAST TURN — these lines have been said and cannot be said again, in whole or in near-paraphrase, by anyone: ${spoken.join(" / ")}. If a character's question went unanswered, they do not re-ask it in the same words; they press differently, drop it, or let the silence sit.`
    : "";
  return `\nDIALOGUE COMES FROM THE SPEAKER, NOT FROM THE PLAYER'S LAST MOVE: no character restates, describes, recaps, or marvels at what the player just did. Forbidden shapes — "you didn't even —", "you just —", "most people would —", "nobody does that", "that's not how anyone —", and any line whose content is the player's own action handed back to them. Astonishment is real and shows in what a person DOES: they stop walking, they lose their place, they follow, they leave, they ask something adjacent, they carry on with what they were doing and get it slightly wrong. Every spoken line originates in the speaker's own want, their own errand, their own body, or something they were already thinking about before this happened — a character with nothing of their own to say says nothing and does something instead.${norepeat}`;
}

const SURFACE_TAIL = `\n[Every character except the player is written from the OUTSIDE this turn: face, voice, posture, act, spoken words. No motive, no concealment named, no gesture captioned, no "as if / as though / with the air of / the way she —", no comparison to a role, profession, ritual, or intention. If a sentence explains why someone did something, cut the explanation and keep the doing.]`;

function sovereignty(state: SaveState): string {
  const n = state.characters["char_player"]?.name ?? "the player";
  return `\n[${n} does ONLY what the input above states — no added actions, words, feelings, or decisions. Dialogue-only input means ${n} spoke and did nothing else. If the scene is waiting on ${n} (an instruction, a question, an invitation), the world WAITS: end at the waiting point. Never resolve it for them.]`;
}

/** CHATLOG PROSE SCRUB — the loop that made the POV rule unenforceable.
 *
 *  In chatlog mode the narrator's own prior prose is replayed as ASSISTANT messages. That is
 *  the strongest style signal in the whole request: it is not a rule about how to write, it is
 *  an example of how this narrator already writes, authored by the role the model is playing.
 *  So a single escape on turn 1 ("the polite mask still in place, his eyes calculating") becomes
 *  the house style by turn 4 — the violation rate RISES with turn count, which is the tell.
 *  The same failure the fresh-reader voice pass exists to break: the narrator imitates its own
 *  last paragraph. Voice got a fix; prose never did.
 *
 *  This scrubs the REPLAY COPY only — state.history keeps every word, the Chronicle is untouched,
 *  nothing is rewritten after the fact. It is input hygiene, not post-hoc correction: the model
 *  never sees the bad sentence, so it has nothing to copy.
 *
 *  Sentences are the unit deliberately. Excising a clause leaves mangled grammar in context,
 *  which is its own kind of style signal; dropping a whole sentence costs a little continuity
 *  and can't corrupt anything. If a paragraph would lose most of itself the scrub backs off —
 *  a pattern that greedy is misfiring, and a thin replay is worse than a flawed one. */
const MOTIVE_LEAK = new RegExp([
  "\\bas (?:if|though) (?:he|she|they|it|xe|ze|the \\w+) (?:were|was|had|hadn|wanted|meant|knew|expected|did|didn|might|could)\\b",
  "\\bas if to \\b", "\\bwith the air of\\b",
  // DELIVERY SIMILE: "she said it like an accusation and a question folded together" — the narrator
  // decoding a tone and telling you what it meant. And the INTENT GAP: "the word came out smaller
  // than she'd meant it to" states what she intended, which is the interior in one clause.
  "\\bsaid it (?:like|as though|as if)\\b", "\\bcame out \\w+er than\\b",
  "\\bthan (?:he|she|they|xe)'?d? (?:meant|intended|wanted|planned)\\b",
  // ── families found in a 58-turn save, all of which walked through the first pass ──
  // ROLE COMPARISON via a person-noun: "the stillness of a man who has just heard...",
  // "the way a man watches a cliff edge". The earlier rule only caught "the way SHE watched";
  // swapping the pronoun for an indefinite person was enough to slip it, and it is the same move.
  "\\bthe (?:way|look|stillness|silence|patience|calm|care|expression|voice|smile) of (?:a|an|someone|somebody)\\b",
  "\\bthe way (?:a|an) (?:man|woman|boy|girl|person|child|someone)\\b",
  "\\blike (?:a|an) (?:man|woman|boy|girl|person|someone) who\\b",
  // THE UNIVERSALIZING SENTENCE: "men who have watched the impossible learn quickly that...".
  // A claim true of everyone everywhere, in the eternal present, dropped into a scene. It is the
  // single loudest marker of the narrator adjudicating, and it generalizes past the moment, which
  // narration is never allowed to do.
  "\\b(?:men|women|people|those|anyone|everyone|no ?one|a man|a woman) who \\w+(?:\\s+\\w+){0,4}\\s+(?:learn|learns|know|knows|understand|understands|never|always|tend|tends)\\b",
  // NEGATIVE DEFINITION: "not the stillness of X, but the stillness of Y" — the narrator ruling out
  // one interior reading in order to install another.
  "\\bnot the \\w+ of (?:a|an|someone)\\b", "\\bnot because (?:he|she|they|it) \\w+, but\\b",
  // UNSPOKEN SPEECH: "He did not say we didn't know you'd be here." Reporting the sentence someone
  // withheld is interior access with a negation in front of it.
  "\\b(?:he|she|they|xe) did not say\\b", "\\bwhatever (?:he|she|they) had been about to say\\b",
  // A CONTRACTION WAS ENOUGH TO SLIP IT. This required a bare pronoun followed by a word, so
  // "the way SHE watched" was caught and "the way she'D LOOKED at him when they were younger" —
  // the same move, reaching further, into a shared past and a feeling — sailed through. Allow the
  // contraction and the auxiliary.
  "\\bthe way (?:he|she|they|xe|ze|it)(?:'d|'s|'ll|'ve| had| has| would| always)?\\s+(?:\\w+ )?(?:watch|watche|read|handle|look|touch|move|speak|spoke|said|smile|hold|held)",
  // THE RELATIONSHIP AS A STANDING FACT: "the way it always was with him", "the way she always
  // did with him". A claim about how these two always are, asserted by the camera, in a scene.
  "\\bthe way it (?:always |usually )?(?:was|is|had been) with (?:him|her|them)\\b",
  // NEGATIVE DEFINITION, SECOND FORM. The list already catches "not the stillness of a man…";
  // this is the same construction with the ruling-out done first and the verdict landed last:
  // "not frightened, not grateful, just a woman doing arithmetic on a sum she hadn't expected".
  "\\bnot \\w+, (?:not \\w+, )?just (?:a|an|the) (?:man|woman|boy|girl|person|someone)\\b",
  "\\bjust (?:a|an) (?:man|woman|boy|girl|person|someone) (?:doing|working|reading|deciding|weighing|counting|thinking)\\b",
  // THE ACCOUNTING METAPHOR. Reported by a player as the one that gets used constantly, and it is
  // interior access wearing a bookkeeping costume: a sum, a ledger, arithmetic, numbers that do or
  // do not add up, all standing in for what somebody is privately concluding. This world contains
  // real ledgers and real tallies, so only the FIGURATIVE frames are listed.
  "\\b(?:doing|did|finished|running) (?:the )?arithmetic\\b", "\\ba sum (?:he|she|they|xe)\\b",
  "\\bthe (?:ledger|arithmetic|calculus|accounting|mathematics) of\\b",
  "\\bnumbers (?:that )?(?:did ?n[o']t|don'?t|would ?n[o']t) add up\\b", "\\badding (?:it|them|her|him) up\\b",
    "\\bthe way (?:he|she|they|xe|ze|it) (?:\\w+ )?(?:watch|watche|read|handle|look|touch|move|speak|spoke|said)",
  "\\bpretend(?:s|ing|ed)?\\b", "\\bto (?:hide|conceal|mask|cover)\\b", "\\bmask(?:ing)? (?:still |firmly )?in place\\b",
  "\\b(?:polite|careful|practised|practiced) mask\\b", "\\bcarefully (?:blank|neutral|still|empty)\\b",
  "\\bwhich meant\\b", "\\bwhat (?:he|she|they|xe) really\\b", "\\bdoes ?n[o']t say what\\b", "\\bdid ?n[o']t say what\\b",
  "\\btrying to (?:parse|read|work out|decide|figure|understand|place|reconcile)\\b",
  "\\b(?:weighing|calculating|measuring|gauging|deciding) (?:what|which|whether|how|him|her|them)\\b",
  "\\bshowing (?:his|her|their|xyr) (?:\\w+ )?(?:curiosity|doubt|fear|anger|interest|surprise)\\b",
  "\\breveal(?:s|ing|ed) (?:his|her|their|nothing|something)\\b",
  "—\\s*(?:weighing|calculating|measuring|deciding|wondering|trying|reading)\\b",
  "\\bsomething (?:quieter|softer|harder|colder|warmer|sharper|unspoken)\\b",
  "\\bsomething \\w+er than\\b", "\\b(?:held|carried|contained) something \\w+\\b",
  "\\bgone from \\w+ to something\\b", "\\ba look that had gone\\b",
].join("|"), "i");

export function scrubForReplay(prose: string): string {
  if (!prose) return prose;
  return prose.split(/\n\n+/).map((para) => {
    const sents = para.match(/[^.!?]*[.!?]+["']?\s*|[^.!?]+$/g) ?? [para];
    const kept = sents.filter((x) => !MOTIVE_LEAK.test(x));
    if (!kept.length) return "";
    if (kept.length < sents.length * 0.5 && sents.length > 2) return para; // too greedy — leave it
    return kept.join("").trim();
  }).filter(Boolean).join("\n\n");
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
export interface SceneFooter {
  place?: string; entered: string[]; left: string[];
  /** EVERYONE in the scene as it ends — not a delta. entered/left are deltas and deltas drift:
   *  a character already in the room is correctly absent from `entered`, so nothing ever placed
   *  her, and she spoke for a dozen turns from loc_offscene while world.present sat empty and
   *  every presence-keyed system (focus, frame, reads) silently did nothing. A full roster is
   *  idempotent and self-healing — one good footer repairs however many bad ones preceded it. */
  here: string[];
  /** People who did NOT exist before this turn, declared by the narrator with a clause on who
   *  they are. Replaces regex guessing: the writer knows whether a name is a person, and the
   *  regexes never did — they made a cast member out of "I'd" and out of a contraction before it. */
  created: { name: string; gist: string }[];
  /** "Headmaster = Professor Albus Dumbledore". A title or nickname is not a new person, and the
   *  only reliable way to know that is to ask the thing that chose the word. */
  aliases: { alias: string; of: string }[];
}

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

/** Split a comma/semicolon list, ignoring separators inside parentheses. `a (x, y), b` → ["a (x, y)", "b"]. */
export function splitOutsideParens(v: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** Strip the debris a truncated or malformed footer leaves on a name. */
function cleanName(raw: string): string {
  return String(raw).replace(/[()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Is this a person's NAME, or a fragment of somebody's description?
 *
 * The creation path had no such check, so any string that survived the split became a character.
 * A name has a capital letter and does not read as a clause: "wary and calculating" and "broad and
 * grey-bearded" are traits and appearance, and both ended up in a cast as people with voices.
 */
export function isPersonName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2 || n.length > 60) return false;
  if (!/[A-Z]/.test(n)) return false;                    // a real name is capitalised somewhere
  if (/^(the|a|an)\s+\w+$/i.test(n)) return false;       // "the captain" is a role, not a name
  if (/\b(and|but|with|who|which|that|wearing|holding)\b/i.test(n)) return false; // a clause
  if (n.split(/\s+/).length > 5) return false;           // a sentence
  if (COMMON_NOUN.test(n)) return false;                 // "Wife", "Dinner", "Cost", "She"
  return true;
}

/**
 * Capitalised, and still not somebody's name. English capitalises the first word of a sentence and
 * of a quotation, so any of these can open one — and a person repeating a word back
 * (`"Wife," she said quietly. "Co-ruler."`) produces the exact shape of a self-introduction.
 * One save's cast acquired Cost, She, Dinner and Wife that way.
 *
 * Pronouns and closed-class words first, then the common nouns that turn up in dialogue: roles and
 * relationships, meals, times, places-in-general, and the abstractions people say aloud.
 */
const COMMON_NOUN = /^(i|me|my|we|us|our|you|your|he|him|his|she|her|hers|it|its|they|them|their|who|whom|whose|what|which|that|this|these|those|there|here|then|now|when|where|why|how|all|some|none|any|both|each|every|no|not|yes|so|and|or|but|if|as|at|by|for|from|in|of|on|to|up|with)$|^(wife|husband|spouse|partner|lover|mistress|widow|widower|mother|father|mum|mom|dad|papa|mama|son|daughter|child|children|baby|brother|sister|uncle|aunt|cousin|family|kin|friend|enemy|stranger|neighbou?r|master|mistress|servant|maid|cook|guard|soldier|captain|sergeant|knight|squire|lord|lady|king|queen|prince|princess|duke|duchess|baron|count|emperor|priest|father|sister|brother|bishop|abbot|monk|nun|doctor|nurse|smith|miller|baker|butcher|farmer|merchant|trader|sailor|innkeeper|landlord|steward|clerk|scribe|thief|beggar|whore|slave|god|goddess|demon|devil|angel|saint|monster|beast)$|^(breakfast|lunch|dinner|supper|tea|bread|wine|water|food|meal|money|gold|silver|coin|cost|price|payment|debt|work|business|trade|war|peace|law|justice|truth|lie|love|hate|fear|hope|death|life|time|day|night|morning|evening|winter|summer|spring|autumn|fall|home|house|town|city|village|road|gate|door|room|bed|fire|blood|name|word|answer|question|reason|place|nothing|everything|something|anything|someone|anyone|everyone|nobody|somebody|anybody|everybody)$/i;

/**
 * Remove cast members that are parse debris rather than people.
 *
 * The footer's comma-split created characters out of fragments of somebody's description — a cast
 * acquiring members called "wary and calculating)" and "broad and grey-bearded". The parser no
 * longer does that, but saves already carry the ones it made, and they show up in the cast list,
 * the paging pass, and the offstage digest forever.
 *
 * Deliberately narrow: only records that fail the name test AND were auto-created (an INCOMPLETE
 * RECORD or provisional stub) AND have nothing attached — no relationships, no real memory, no
 * portrait. Anything a player has interacted with stays, whatever it is called; a name the player
 * can rename by hand is not worth deleting data over.
 */
/**
 * Split a textarea of one-per-line entries into a list. Tolerates a legacy comma-separated line so
 * an old value pasted back in still works, but only when the user gave no line breaks at all.
 */
export function splitLines(text: string): string[] {
  const raw = String(text ?? "");
  const parts = raw.includes("\n") ? raw.split("\n") : raw.split(",");
  return parts.map((x) => x.trim()).filter(Boolean).slice(0, 24);
}

/**
 * REJOIN LISTS THAT A COMMA-SPLIT SHREDDED.
 *
 * `pressure_palette` and `forbidden_as_primary` were edited as one comma-separated line and saved
 * with `split(",")`, so every entry containing a comma broke in two — and did it again on the next
 * save. One save's palette had decayed into seven fragments, three of them beginning with "and":
 *   ["The king's spies are everywhere", "and Rabi's power could be seen as a threat or a tool.", …]
 * and its forbidden list read ["Political intrigue without immediate", "Moralizing about power…"],
 * where the first entry has lost the words that gave it meaning. The narrator was being handed
 * sentence fragments as genre law every turn.
 *
 * The editor now uses newlines, which stops it happening again. This puts back together what is
 * already in saves: an entry that opens in lower case is not a new item, it is the tail of the one
 * above it. Entries that were always fine are untouched.
 */
export function repairBibleLists(state: SaveState): string[] {
  const shifts: string[] = [];
  for (const field of ["pressure_palette", "forbidden_as_primary"] as const) {
    const list = (state.world_bible as any)[field] as string[] | undefined;
    if (!Array.isArray(list) || list.length < 2) continue;
    const out: string[] = [];
    let joined = 0;
    for (const item of list.map((x) => String(x ?? "").trim()).filter(Boolean)) {
      // A continuation: begins lower-case, the entry above it did not end in a full stop, AND it
      // either opens with a connective or is short enough to be a severed tail. Lower-case alone is
      // far too weak — a hand-written list is legitimately all lower case ("the war on the roads",
      // "the king's spies and the barons' spies") and this pass cheerfully glued a perfectly good
      // five-item palette into one sentence. Real debris looks like debris: "and Rabi's power could
      // be seen as a threat", "leading to betrayal or manipulation", "personal stakes".
      const CONNECTIVE = /^(and|or|but|so|then|leading|which|that|with|without|plus|nor|yet|including|especially|as well as)\b/i;
      const prev = out[out.length - 1] ?? "";
      const isTail = /^[a-z]/.test(item) && !!prev && !/[.!?]$/.test(prev)
        && (CONNECTIVE.test(item) || item.length <= 30);
      if (isTail) { out[out.length - 1] = `${out[out.length - 1]}, ${item}`; joined++; }
      else out.push(item);
    }
    if (joined) {
      (state.world_bible as any)[field] = out;
      shifts.push(`${field.replace(/_/g, " ")}: rejoined ${joined} fragment${joined === 1 ? "" : "s"} a comma-split had broken off.`);
    }
  }
  return shifts;
}

export function pruneParseArtifacts(state: SaveState): string[] {
  const removed: string[] = [];
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player") continue;
    if (isPersonName(c.name)) continue;
    // The `auto` test used to gate on the INCOMPLETE RECORD marker, which the sketch-completion
    // pass overwrites the moment it fleshes a record out — so a phantom that had been given a
    // backstory stopped looking auto-registered and became permanently unremovable. The name is
    // the durable signal and isPersonName above has already rejected it: nobody real is called She
    // or Dinner. Authored cast still needs protecting, so an explicit portrait or a hand-written
    // record below is what saves a character, not a paragraph a model wrote about them.
    const auto = c.provisional === true || /^INCOMPLETE RECORD\b/.test(c.background ?? "") || c.central === false;
    if (!auto) continue;
    // AN EDGE IS NOT ATTACHMENT WHEN THE ENGINE CREATED IT. Every character present in a scene gets
    // seedAttraction run against everyone else on the turn they appear, so a phantom owns a fistful
    // of edges before it has done anything — six of them, all at warmth 0 / trust 0, in the save
    // that prompted this. The guard meant to protect real relationships was therefore satisfied by
    // every phantom automatically, which is why the repair button never removed any of them. Only
    // an edge that has actually MOVED counts.
    const movedEdge = state.world.edges.some((e) =>
      (e.from === id || e.to === id) &&
      (Math.abs(e.warmth) >= 5 || Math.abs(e.trust) >= 5 || (e.roles?.length ?? 0) > 0 || (e.notes ?? "").trim().length > 0));
    const mem = state.memory[id];
    const attached = movedEdge || c.portrait_url || (mem?.core?.length ?? 0) > 0 || (mem?.episodic?.length ?? 0) > 1;
    if (attached) continue;
    delete state.characters[id];
    delete state.memory[id];
    delete state.condition[id];
    delete state.traits[id];
    // and take the dead edges with it — otherwise the save keeps a fistful of relationships
    // pointing at an id nothing resolves, which is how a deleted phantom went on showing up in the
    // relationship telemetry as a person the player had feelings about.
    state.world.edges = state.world.edges.filter((e) => e.from !== id && e.to !== id);
    state.world.present = state.world.present.filter((x) => x !== id);
    for (const p of Object.values(state.world.places)) p.contains = p.contains.filter((x) => x !== id);
    removed.push(c.name);
  }
  return removed;
}

/**
 * REPAIR — send home the people the ledger put somewhere they never went.
 *
 * The bookkeeper needs an id for every behavior it records, and when the narrator writes an unnamed
 * walk-on it has none, so it reaches for the nearest real cast member: a guard captain a country
 * away ends up behind the bar of an inn, with a drive about the inn and a trait grown from it,
 * while the prose never once says her name. The arrival guard stops that happening now, but saves
 * already carry the results, and a phantom in the room keeps drawing the narrator's attention
 * forever.
 *
 * The test is the arrival guard applied backwards over the record. Being quiet is not evidence of
 * anything — a character can stand in a room for six turns without a line — so silence alone is
 * never enough. What marks a phantom is the TRANSITION: they were not in the scene, then suddenly
 * they were, and the prose of the turn they appeared in never named them. Send them back — to the last place their own memory says they went, otherwise
 * offscene, where the return-from-offscene pass will walk them somewhere real.
 *
 * Deliberately conservative: only the player's current scene, only characters who appeared during
 * the recorded window, and anyone the prose names even once is left alone.
 */
export function repairStrandedCast(state: SaveState, window = 8): string[] {
  const fixed: string[] = [];
  const ploc = state.world.player_location;
  if (!ploc) return fixed;
  const recent = state.history.slice(-window);
  if (recent.length < 2) return fixed;                       // too little record to judge on
  const blob = recent.map((h) => `${h.player_action ?? ""} ${h.narrator_prose ?? ""}`).join(" ").toLowerCase();

  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || c.location !== ploc) continue;
    if (c.status === "dead" || c.status === "departed") continue;
    const nameLow = (c.name ?? "").toLowerCase();
    const tokens = nameLow.split(/\s+/).map((t) => t.replace(/[^a-z]/g, "")).filter((t) => t.length >= 3);
    const probes = [...new Set([nameLow, ...tokens])].filter((p) => p.length >= 3);
    if (!probes.length || probes.some((p) => blob.includes(p))) continue;   // named at all → real

    // THE TRANSITION IS THE EVIDENCE, NOT THE SILENCE. Find where they entered the scene inside the
    // window; if they were in it the whole time, this is not the bug and they are left alone.
    const firstIn = recent.findIndex((h) => (h.present ?? []).includes(id));
    if (firstIn <= 0) continue;                              // never recorded here, or here all along
    const arrival = recent[firstIn];
    const arrivalText = `${arrival.player_action ?? ""} ${arrival.narrator_prose ?? ""}`.toLowerCase();
    if (probes.some((p) => arrivalText.includes(p))) continue;   // the prose DID write them in

    // Where do they belong? Their own movement memories know; failing that, elsewhere.
    let home: string | undefined;
    for (const m of [...(state.memory[id]?.episodic ?? [])].reverse()) {
      const mm = /\bwent to ([^.]+)\.?/i.exec(m.content ?? "");
      const pid = mm ? Object.values(state.world.places).find((p) => p.name.toLowerCase() === mm[1].toLowerCase().trim())?.id : undefined;
      if (pid && pid !== ploc) { home = pid; break; }
    }
    ensureOffscene(state);
    c.location = home ?? OFFSCENE;
    // a goal formed from a scene they were never in is not their goal
    if (c.drive?.goal && !probes.some((p) => (c.drive!.goal + " " + (c.drive!.blocker ?? "")).toLowerCase().includes(p))) {
      c.drive = c.drive_queue?.shift() ?? undefined;
    }
    fixed.push(`${c.name} was standing in a scene they were never written into — sent back to ${state.world.places[c.location]?.name ?? "elsewhere"}.`);
  }
  if (fixed.length) syncPresence(state);
  return fixed;
}

/**
 * REPAIR — get engine notes back out of place descriptions.
 *
 * The staleness backstop used to append `[turn-N change] The player: "..."` INTO description_facts.
 * Where a place already had a description that merely made it untidy; where it did not, the note
 * became the entire description, and a location ended up described by a quote of the player's own
 * dialogue. The note lives in its own field now; this lifts the old ones out of saves that have
 * them, keeping whatever real description was underneath.
 */
export function repairPlaceDescriptions(state: SaveState): string[] {
  const fixed: string[] = [];
  const NOTE = /\[turn-\d+ change\][^\n]*/g;
  for (const p of Object.values(state.world.places)) {
    const d = p.description_facts ?? "";
    if (!NOTE.test(d)) { NOTE.lastIndex = 0; continue; }
    NOTE.lastIndex = 0;
    const notes = d.match(NOTE) ?? [];
    const cleaned = d.replace(NOTE, "").replace(/\n{2,}/g, "\n").trim();
    p.description_facts = cleaned;
    if (!p.stale_note && notes.length) p.stale_note = `The description predates a change made on ${notes.length > 1 ? "several turns" : "an earlier turn"}; render what the recent prose established.`;
    fixed.push(cleaned
      ? `${p.name}: an engine note was removed from its description.`
      : `${p.name}: its description was nothing but an engine note — cleared, and it needs writing.`);
  }
  return fixed;
}

/** Split prose from a footer starting at `at`, parsing whatever attributes survived truncation. */
function splitAt(text: string, at: number): { prose: string; footer: SceneFooter } {
  const attrs = text.slice(at).replace(/^<<<\s*SCENE\b/i, "").replace(/>+\s*$/, "").trim();
  // tolerant grab: closing quote optional (truncation may have eaten it), value runs to the next
  // attribute keyword, a closing `>`, or end-of-string.
  const grab = (k: string): string => {
    const r = new RegExp(`${k}\\s*=\\s*"([^"]*)(?:"|(?=\\s+(?:place|entered|left|here|new|alias)\\s*=)|>|$)`, "i").exec(attrs);
    return r ? r[1].trim() : "";
  };
  const names = (v: string) => splitOutsideParens(v).filter((x) => x && !/^(none|nobody|no ?one|-)$/i.test(x));
  // new="Pell (a weaver, mends nets on the quay)" — name outside the parens, gist inside.
  // The list was split on every comma BEFORE the parenthetical was read, so a gist containing a
  // comma — as the documented example itself does — was torn in half and each half registered as a
  // person: "Pell (a weaver" and "mends nets on the quay)". That is where a cast acquires members
  // named after fragments of somebody's description. splitOutsideParens respects the brackets.
  const created = names(grab("new")).map((entry) => {
    const m = /^([^(]*?)\s*(?:\(([^)]*)\))?$/.exec(entry);
    return { name: cleanName(m?.[1] ?? entry), gist: (m?.[2] ?? "").trim().slice(0, 200) };
  }).filter((c) => isPersonName(c.name));
  // alias="Headmaster = Professor Albus Dumbledore"
  const aliases = names(grab("alias")).map((entry) => {
    const m = /^(.+?)\s*=\s*(.+)$/.exec(entry);
    return m ? { alias: m[1].trim().slice(0, 60), of: m[2].trim().slice(0, 60) } : null;
  }).filter(Boolean) as { alias: string; of: string }[];
  return {
    prose: text.slice(0, at).trimEnd(),
    footer: { place: grab("place") || undefined, entered: names(grab("entered")), left: names(grab("left")), here: names(grab("here")), created, aliases },
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
  const AWAY_TURNS = 12, BOND_FLOOR = 25;   // floor is on bondStrength's scale (~0.75·warmth + 0.25·trust), not the old |w|+|t| sum
  const turn = state.world.current_turn;
  const recentText = (state.history.slice(-3).map((h) => h.narrator_prose).join(" ") + " " + action).toLowerCase();
  const lastSeen = new Map<string, number>();
  for (const t of state.telemetry) for (const pid of t.present) lastSeen.set(pid, t.turn);
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || c.central === false || c.status === "dead" || c.status === "departed") continue;
    const first = c.name.split(/\s+/)[0]?.toLowerCase() ?? "";
    const named = first.length >= 3 && recentText.includes(first);
    const present = state.world.present.includes(id);
    // STANDING IN THE ROOM IS NOT SOMETHING YOU CAN BE PAGED OUT OF. A paged character is invisible
    // to the narrator, so pruning someone the state puts at the player's own location is how a room
    // full of people renders as empty — and why the one character who happened to be present when
    // the pruning landed became the only person who could ever be in a scene again.
    const together = !!c.location && c.location === state.world.player_location;
    if (present || named || together) { if (c.paged) c.paged = false; continue; }
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    // bondStrength, not |warmth| + |trust|: the old sum weighted suspicion the same as love AND
    // ignored stated relationships entirely, so the player's wife (warmth 22, trust 14, roles
    // ["wife"]) scored 36 against a floor of 40 and was paged out of her own marriage for 39 turns.
    const bond = Math.abs(bondStrength(e));
    const away = turn - (lastSeen.get(id) ?? 0);
    // RE-EVALUATED, NOT LATCHED. This used to `continue` on anyone already paged, so paging was a
    // one-way door: a character whose bond had since grown past the floor stayed dormant forever,
    // and the only key was the player happening to type their name. Recompute both sides every
    // turn — page when cold and long gone, wake the moment that stops being true.
    c.paged = away >= AWAY_TURNS && bond < BOND_FLOOR;
  }
}

/** The world may grow, but not without limit. Above this, the oldest unused, non-founding place is
 *  forgotten — the Forge's own locations are the spine and are never taken. */
/** In-world minutes a faction clock must wait between segments. A warband sends a rider, hears
 *  back, and decides — that is hours, not "however many times the player pressed enter". */
export const MINUTES_PER_SEGMENT = 180;

/** In-world minutes a thread must wait between rises in tension. Turns are cheap — fifty of them
 *  fit in a morning — so escalation has to cost time or the story sprints while the world stands
 *  still. Lowering tension is never gated. */
export const MINUTES_PER_ESCALATION = 90;

/** How long this character has actually known the player, in plain words. Reflection was writing
 *  settled convictions about someone's whole nature after a day and a half — "he can be turned
 *  toward something better if she stands with him" is a conclusion a person reaches over months.
 *  The model can't calibrate what it isn't told, so tell it. */
function acquaintanceLabel(state: SaveState, id: string): string {
  const first = state.memory[id]?.episodic?.[0];
  if (!first) return "they have only just met";
  const now = parseTime(state.world.current_time);
  const then = parseTime(first.when_label || state.world.current_time);
  const days = Math.max(0, now.day - then.day);
  const hours = days * 24 + (now.hour - then.hour);
  if (hours < 12) return "a matter of hours — they are strangers to each other";
  if (days <= 1) return "about a day — still strangers, however intense it has been";
  if (days <= 3) return `${days} days — new acquaintances; nothing about this person is settled yet`;
  if (days <= 14) return `${days} days — they are becoming familiar, but convictions about who someone IS are still premature`;
  if (days <= 60) return `${days} days — long enough for real judgments about character`;
  return "months or longer — long enough to know someone";
}

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
/** Turns a character must spend blocked on "find the player" before the walk actually happens. */
export const ARRIVAL_PATIENCE = 8;

export function replanDrives(state: SaveState): void {
  const turn = state.world.current_turn;
  const pursuers: { id: string; since: number }[] = [];
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
      // pursuit_since, NOT updated_turn. tickDrives stamps updated_turn every single turn as
      // offscreen progress accrues, so "how long have they been looking" always evaluated to 1 and
      // the walk below could never fire — the prose said Andrea rushed to the estate while the
      // ledger left her standing at the gate for good.
      d.pursuit_since ??= turn;
      pursuers.push({ id, since: d.pursuit_since });
    } else if (d.pursuit_since !== undefined) {
      delete d.pursuit_since;   // they found them, or the goal stopped being about finding them
    }
  }

  // AND THEN THEY ACTUALLY GO. The blocker above says "must find Rabi first" and nothing has ever
  // acted on it: an offscreen character only moves when the SIMULATOR moves them, and the simulator
  // cannot move someone it never sees. So the whole tracked cast accumulated a stated intention to
  // reach the player and stood perfectly still holding it, for a hundred turns, while whoever
  // happened to already be in the room stayed the only person in the story.
  //
  // One arrival at a time, and only for someone who has been trying long enough that the walk is
  // plausible — a trickle, not a swarm. Longest-waiting goes first.
  //
  // AND THE WALK HAS TO BE WALKABLE. This originally set the location and nothing else, so a wife
  // left behind in another country appeared in an inn in Italy eight turns later, silently, having
  // crossed a sea nobody wrote. Turns are not distance. Two gates now: the recorded travel time
  // between the two places must actually have passed in-world, and when there is no recorded
  // distance a default day's travel stands in — enough that a walk across a town happens freely and
  // a walk across a map does not happen by accident. The arrival is also announced, because a
  // character appearing out of nowhere is exactly what the player experienced.
  if (pursuers.length) {
    pursuers.sort((a, b) => a.since - b.since);
    const dest = state.world.player_location;
    const destName = state.world.places[dest]?.name ?? "";
    for (const p of pursuers) {
      if (turn - p.since < ARRIVAL_PATIENCE) continue;
      const c = state.characters[p.id];
      if (!c || !dest) continue;
      const fromName = state.world.places[c.location ?? ""]?.name ?? "";
      const needed = travelMinutesBetween(state, fromName, destName);
      const elapsed = minutesBetween(state.world.time_at_turn?.[p.since] ?? "", state.world.current_time);
      if (needed > 0 && elapsed < needed) continue;   // they are still on the road
      c.location = dest;
      c.paged = false;                         // they are in the room; the narrator has to be able to see them
      if (c.drive) { c.drive.updated_turn = turn; delete c.drive.pursuit_since; }
      state.world.arrivals_pending = [...(state.world.arrivals_pending ?? []), c.name].slice(-3);
      console.info(`[drives] ${c.name} reaches ${state.characters["char_player"]?.name} at ${destName} after ${turn - p.since} turns and ${Math.round(elapsed)}min of travel`);
      break;   // one at a time
    }
  }
}

/**
 * A GIFT IS NOT AN INVOICE.
 *
 * The player builds a well for a village, heals someone, hands over food, makes a thing and gives
 * it away — and the scene answers by demanding payment for it. Every time. It is the same reflex
 * the TRANSACTIONS-ARE-NOT-FAVORS clause fixes at the other end of the exchange: the narrator reads
 * a low-warmth edge as "be an obstacle" and reaches for the only friction it knows, which is money,
 * without checking which direction the goods just moved. The result is a world where generosity is
 * indistinguishable from asking for a loan, and a player who stops giving anyone anything.
 *
 * Suspicion, fear, refusal and a debt of OBLIGATION are all legitimate answers to a gift, and are
 * left explicitly available. Billing the giver is not an answer, it is a category error.
 */
const GIVING = /\b(?:i|we)\s+(?:just\s+|then\s+|now\s+)?(?:give|gave|gift(?:ed)?|hand(?:ed)?|offer(?:ed)?|grant(?:ed)?|bestow(?:ed)?|donate[d]?|leave|left|provide[d]?|bring|brought|deliver(?:ed)?|share[d]?|feed|fed|heal(?:ed)?|cure[d]?|fix(?:ed)?|mend(?:ed)?|repair(?:ed)?|restore[d]?|rebuild|rebuilt|build|built|make|made|create[d]?|conjure[d]?|raise[d]?|summon(?:ed)?)\b/i;
/** Somebody the giving is FOR. Without this, "I give her a long look" is a benefaction. */
const BENEFICIARY = /\b(?:for|to)\s+(?:the\s+|his\s+|her\s+|their\s+)?(?:them|him|us|everyone|everybody|people|villagers?|townsfolk|town|village|city|poor|children|kids|family|crowd|workers?|farmers?|refugees?|sick|wounded|hungry|[A-Z]\w+)\b/;
/** The player acquiring, not providing — the exact case where a price IS the right answer. */
const ASKING = /\b(?:i|we)\s+(?:ask|asked|want|need|demand|buy|buys|bought|purchase[d]?|take|took|steal|stole|borrow(?:ed)?|request(?:ed)?|hire[d]?|pay|paid|trade[d]?|sell|sold|barter(?:ed)?)\b/i;

export function giftDirective(action: string): string {
  const a = String(action ?? "");
  if (!GIVING.test(a) || !BENEFICIARY.test(a) || ASKING.test(a)) return "";
  return `\nTHE PLAYER IS GIVING, NOT BUYING. Whatever the player just provided, made, mended or handed over moves TOWARD the people in this scene. NOBODY CHARGES THEM FOR IT. No price, no fee, no invoice, no "and what do you want in return", no haggling over the thing they were just handed — that is not friction, it is the exchange read backwards, and it has happened often enough that the player has noticed it as a tic. If someone here is cold, afraid, proud or suspicious, render THAT instead: they refuse it, they will not touch it, they ask what it will cost them LATER in obligation rather than in coin, they resent needing it, they wonder aloud what taking it makes them. Those are answers. A bill is not. And at least one person's reaction must be proportionate to the size of what was given — a village handed something it badly needed does not answer with a shrug and a complaint.`;
}

/**
 * ASKED ALREADY — and the half of it that matters more: THE GOALPOST DOES NOT MOVE ON DELIVERY.
 *
 * A want that only the player can satisfy never advances on its own, so the engine hands it back as
 * the character's active goal every turn and they put the same question again. That is the first
 * failure and the paragraph below has always addressed it. The second one is worse and took a
 * player saying "I feel slightly insane about it" to surface:
 *
 *   t126  She asks what she is to him. He answers about somebody else.
 *         "I didn't ask about Andrea. I asked about me. That's an answer too." She leaves.
 *   t127  He gives her the answer, exactly the one she asked for: wife, co-ruler.
 *         "Co-ruler. You say it walking away, like it's a thing you're leaving on the table."
 *
 * The condition for success was revealed only after it had been failed. There was no action
 * available on turn 127 that would have counted, because the requirement was never the words — it
 * was a manner of delivery that went unstated until it could be used to refuse. Do that twice and
 * the player cannot tell what is real any more, which is what they said.
 */
export function nagDirective(names: string[]): string {
  if (!names.length) return "";
  return `\nASKED ALREADY — ${names.join(", ")} put their question to the player and did not get what they wanted. DO NOT ASK IT AGAIN. Not rephrased, not sharpened, not "I asked you what X and you gave me Y". A person who has asked twice and been answered vaguely does one of these instead, and which one comes from who they are: they take the answer they were given and act on it; they say plainly what they concluded from not getting one; they change what they want; they stop talking and do something with their hands; they leave. The scene must MOVE — whatever else happens this turn, their want does not get put to the player as a question a third time.`
      + `\nAND IF THE PLAYER GIVES IT, THEY HAVE GIVEN IT. The goalpost does not move on delivery. A character who asked for something specific and then receives it may absolutely be hurt by HOW it came — offhand, late, walking away, in front of others — and may say so, once. What they may not do is treat the manner as a reason the thing was never given, keep the want open, and go on being owed it. That exchange has happened in this story and it is the single most maddening thing a written person can do: it makes the player unable to succeed by any action available to them, because the condition for success is revealed only after they have failed it. If the want is genuinely still open after this turn, something CONCRETE must still be missing and you must be able to name it in one clause. "It wasn't said the right way" is not a concrete thing missing. Take the yes.`
}

/** Default in-world minutes to cross from one named place to another when the world records no
 *  distance for the pair, nothing connects their names, and the player has never walked it. A day:
 *  far too long for a walk across a town, far too short to matter for a genuine journey, which is
 *  the point — it stops an accidental teleport without pretending to a map. */
export const DEFAULT_TRAVEL_MIN = 24 * 60;

/** Two places the player is known to have walked between directly, when the clock stamps for the
 *  trip have already scrolled out of the window. Adjacency is the fact worth keeping; the exact
 *  duration is not. */
export const NEIGHBOUR_TRAVEL_MIN = 30;

/** Words that make a place-name a piece of a building rather than a building. */
const INTERIOR = /\b(floor|room|workroom|workshop|study|hall|landing|stair(?:s|case|well)?|attic|cellar|basement|kitchen|bedroom|chamber|corridor|passage|gallery|loft|parlou?r|office|quarters|wing|annexe?|vault|closet|nursery|library|solar|scullery|pantry|forge|lab(?:oratory)?)\b/i;

/** Name tokens that carry no identity — everything is "the" something, and matching on them would
 *  put every hall in the world in the same building. */
const NAME_STOP = new Set(["the","a","an","of","at","on","in","and","old","new","great","little","upper","lower","north","south","east","west","inner","outer","first","second","third","main","house","place","room","hall","floor"]);

/**
 * How long it takes to get from `from` to `to`, in in-world minutes.
 *
 * This started as a name-prefix heuristic and a day's default, and the default is where it went
 * wrong: it is the answer for every pair whose names do not happen to rhyme. Mable stood on
 * "Mable's floor" for the rest of a save because the player was in "Andrea's workroom" — one
 * staircase away, inside the same house, and the two names share nothing, so the engine quoted her
 * twenty-four hours of travel and her arrival could never fire. "She has decided never to show up
 * again" is what that looks like from the chair.
 *
 * The fix is to stop guessing from names alone and read what the world already knows. The player's
 * own path through the map is a measured record of how far apart places are: if they walked it,
 * the clock says how long it took, and no heuristic beats that.
 */
export function travelMinutesBetween(state: SaveState, from: string, to: string): number {
  const a = from.trim().toLowerCase(), b = to.trim().toLowerCase();
  if (!a || !b || a === b) return 0;
  // 1. an authored distance is the truth
  for (const d of state.world.distances ?? []) {
    const f = String(d.from).trim().toLowerCase(), t = String(d.to).trim().toLowerCase();
    if ((f === a && t === b) || (f === b && t === a)) return Math.max(0, d.minutes);
  }
  // 2. OBSERVED TRAVEL. The player has been walking this map for the whole game and every step is
  //    logged with the turn it happened on; the clock is stamped per turn. A direct A→B step in
  //    that log is a measurement of the distance, so take the shortest one ever recorded — the
  //    player may have dawdled once and gone straight there another time.
  const log = state.travel_log ?? [];
  const idFor = (n: string) => Object.values(state.world.places).find((p) => p.name.trim().toLowerCase() === n)?.id;
  const ida = idFor(a), idb = idFor(b);
  if (ida && idb) {
    let best = Infinity;
    for (let i = 1; i < log.length; i++) {
      const pair = [log[i - 1].place, log[i].place];
      if (!(pair.includes(ida) && pair.includes(idb)) || pair[0] === pair[1]) continue;
      const t0 = state.world.time_at_turn?.[log[i - 1].turn], t1 = state.world.time_at_turn?.[log[i].turn];
      // Stamps are kept to a short window, so an old trip has no clock — but the adjacency it
      // proves does not expire. Fall back to a neighbour's walk rather than throwing it away.
      const mins = t0 && t1 ? Math.max(0, minutesBetween(t0, t1)) : NEIGHBOUR_TRAVEL_MIN;
      best = Math.min(best, mins);
    }
    if (best < Infinity) return best;
  }
  // 3. a shared identifying word means one settlement or one building: "Thornwood Gate" and
  //    "Thornwood Market"; "Marchess Estate — East Wing" and "Marchess Estate, the kitchens".
  const tokens = (x: string) => new Set(x.split(/[^a-z0-9']+/).map((w) => w.replace(/'s$/, "")).filter((w) => w.length >= 4 && !NAME_STOP.has(w)));
  const ta = tokens(a);
  for (const w of tokens(b)) if (ta.has(w)) return 0;
  // 4. TWO ROOMS ARE NOT A JOURNEY. A place called someone's workroom or the third floor is a part
  //    of a building, and a story is almost never running two separate buildings' interiors as
  //    live locations at once. Quoting a day between them is the failure above; quoting a walk is
  //    wrong only in the rare case, and wrong by minutes rather than by a whole character.
  if (INTERIOR.test(a) && INTERIOR.test(b)) return NEIGHBOUR_TRAVEL_MIN;
  return DEFAULT_TRAVEL_MIN;
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

/** The veto's old grain test was conscience <= 0.35 OR a core trait matching a seven-word
 *  cruelty list — which the Forge produces for exactly one character per cast. Everyone
 *  forged guarded, wary, bitter, proud, or closed-off failed it and had every softening
 *  write pass straight into the ledger. Graded obduracy replaces both tests: the cruel
 *  still clear it, and so does the merely closed. */
function resistsSoftening(state: SaveState, id: string): boolean {
  return isObdurate(obduracyIn(state.characters, state.traits, id));
}

/** Returns a rejection reason if this content would illegitimately drift the character, else null. */
function driftVeto(state: SaveState, id: string, content: string, opts?: { isReflection?: boolean }): string | null {
  if (opts?.isReflection) return null; // the earned door: reflection may move identity against the grain
  if (id === "char_player") return null; // the player is who the player plays
  const text = content.toLowerCase();
  // Anyone whose constitution resists closeness — cruel by nature OR simply closed — having a
  // softening written into the ledger as fact. Reflection remains the earned door above.
  if (SOFTENING_PATTERN.test(text) && resistsSoftening(state, id)) {
    const o = obduracyIn(state.characters, state.traits, id).toFixed(2);
    return `${nameOf2(state, id)} does not open on this timescale (obduracy ${o}); an unearned softening write was refused`;
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
  setLLMPrefs({
    routeByPrice: !!state.model_settings.route_by_price,
    narratorReasoning: !!state.model_settings.narrator_reasoning,              // undefined = off (the cheap default)
    preferDeepSeek: state.model_settings.prefer_deepseek_provider !== false,   // undefined = on (the cheap default)
  });
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
  // capture the start-of-turn baseline BEFORE drift: the discharge detector (tail of the turn)
  // reads the turn's net movement against it — held deep at the start, back above the fracturing
  // line by the end = something let go.
  for (const id of Object.keys(state.condition)) {
    const psy = state.condition[id].psyche;
    psy.prev_relaxation = psy.relaxation;
    tickPsyche(psy);
  }
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
  state.pressure_state.recent ??= [];
  // Pacing runs on the in-world clock, not the turn counter — a turn is ~10 minutes, so turn-based
  // cooldowns produced a fresh crisis every half hour of the character's life.
  const nowT = state.world.current_time;
  // clamped at 0: a repaired save or a rewound clock must read as "no time has passed", never as a
  // negative gap that would sail through every cooldown.
  const sinceStamp = (stamp?: string) => (stamp ? Math.max(0, minutesBetween(stamp, nowT)) : undefined);
  const minutesSinceBeat = sinceStamp(state.pressure_state.last_beat_time);
  const minutesSinceExo = sinceStamp(state.pressure_state.last_exo_time);
  const beat: Beat = selectBeat({
    turn, now: state.world.current_time, tension: state.model_settings.tension ?? 5,
    threads: state.world.threads, clocks: state.world.clocks, consequences: state.world.consequences,
    agents, last_beat_turn: state.pressure_state.last_beat_turn, last_exo_turn: state.pressure_state.last_exo_turn,
    recent: state.pressure_state.recent, minutesSinceBeat, minutesSinceExo,
    restoration: RESTORE_INTENT.test(action),
  });
  if (["consequence", "clock", "thread", "agent", "exogenous"].includes(beat.kind)) {
    state.pressure_state.last_beat_turn = turn;
    state.pressure_state.last_beat_time = nowT;
  }
  if (beat.kind === "exogenous") { state.pressure_state.last_exo_turn = turn; state.pressure_state.last_exo_time = nowT; }
  // RECORD THE DISCHARGE. A source that fires goes on the fatigue list; firing again costs it a
  // longer silence each time. Reminders don't count — being reminded is not the threat acting.
  {
    const ref = (beat as { ref?: string }).ref;
    if (ref && ["clock", "thread", "agent", "consequence"].includes(beat.kind)) {
      const rec = state.pressure_state.recent!;
      // Record WHAT KIND fired, so the selector can spread across kinds rather than only across
      // individual sources — four fresh threats in a row is four fresh sources and one flavour.
      const srcKind = beat.kind === "clock" ? "threat"
        : beat.kind === "agent" ? "relationship"
        : beat.kind === "thread" ? (state.world.threads.find((t) => String(t.title ?? "").slice(0, 90) === ref)?.kind ?? "threat")
        : "obligation";
      const prior = rec.find((r) => r.ref === ref);
      if (prior) { prior.turn = turn; prior.time = nowT; prior.count += 1; prior.kind = srcKind; }
      else rec.push({ ref, turn, time: nowT, count: 1, kind: srcKind });
      if (rec.length > 24) state.pressure_state.recent = rec.slice(-24);
    }
  }
  ev.onMeta({ pressure: verdict.pressure, band: verdict.band, source: verdict.source, beat: beat.kind });

  // 2 ── narrator (streamed)
  ev.onPhase("narrator");
  const arrivalShifts: string[] = [];
  // spawnNamed is now a FALLBACK only — see the footer block below. It runs when the narrator
  // emitted no footer (output truncation), because no registration at all is worse than a guess.
  const arrivals = "";
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
  // Prose adjectives miss the player who quietly beat the same threat three times in plain
  // language; the discharge record doesn't.
  // NOTE: god mode deliberately does NOT feed the tier — the tier describes what the world has
  // WITNESSED, and the setting is not a witness. See detectPowerTier.
  // LIVE tier: what the people in this room have just seen. Drives the witness stamp and
  // EARNED_RESPONSE, which are about the moment of witnessing and must not fire every turn.
  const tier = tierFromRecord(detectPowerTier(recentText), state.pressure_state?.recent);
  // STANDING tier: what this world knows the player to be. Same evidence, longer memory — see
  // rememberPowerTier. Drives how the world ORIENTS to them (the pressure nudge, public standing),
  // which should not reset to "unremarkable stranger" three turns after they unmade a city.
  const remembered = rememberPowerTier(tier, state.power_witnessed, state.world.current_turn);
  state.power_witnessed = remembered.memory;
  const standingTier = remembered.tier;
  // WITNESS STAMP — when the player wields genuinely impossible power in front of others, that
  // witnessing durably rewrites how each present character relates to them. Stamp an active_state so
  // the reorientation PERSISTS across later turns (not just the turn of the act): a character who saw
  // a planet-scale teleport keeps reacting as someone who saw it, even turns afterward, until it
  // decays. This is what stops the incoherent "wounded peer scolds the god" beat — their standing
  // state now says otherwise.
  //
  // Runs in god mode too, now. It used to be skipped there ("the whole world already knows the
  // frame") because god mode pinned the tier high on every turn, which would have stamped every
  // present character as shaken on every turn forever. The tier is earned again, so the stamp only
  // fires on turns where something impossible was actually seen — which is exactly when a god-mode
  // player wants their witnesses to remember it.
  //
  // The stamp is also no longer fear-only. What witnessing overwhelming power rewrites is the
  // SCALE of the relationship, not its sign: someone who loves the player and watches them unmake
  // a wall is exalted, not shaken, and writing them as shaken is how a devoted companion drifts
  // into terror over a few turns. The stamp reads their standing edge and records what they
  // actually felt. All variants keep the "impossible power" substring so the filter below still
  // replaces a stale stamp rather than stacking a second one.
  if (tier === "mythic" || tier === "cosmic") {
    for (const wid of state.world.present) {
      if (wid === "char_player") continue;
      const wc = state.condition[wid];
      if (!wc) continue;
      const we = state.world.edges.find((x) => x.from === wid && x.to === "char_player");
      const bond = bondStrength(we);
      const witnessState =
        bond >= 25
          ? (tier === "cosmic" ? "exalted by the player's impossible power, and theirs" : "moved and unsettled by the player's impossible power")
          : bond <= -15
          ? (tier === "cosmic" ? "terrified by the player's impossible power" : "shaken by the player's impossible power")
          : (tier === "cosmic" ? "awestruck by the player's impossible power" : "shaken by the player's impossible power");
      // replace any prior witness-stamp so the freshest reading holds, and re-age it
      wc.psyche.active_states = wc.psyche.active_states.filter((s) => !/impossible power/.test(s));
      wc.psyche.active_states.push(witnessState);
      (wc.psyche.state_ages ??= {})[witnessState] = state.world.current_turn;
      if (wc.psyche.active_states.length > 5) wc.psyche.active_states = wc.psyche.active_states.slice(-5);
    }
  }
  let directive = pressureDirective(verdict, state.world_bible.pressure_palette, state.model_settings.tension ?? 5, standingTier, beat);
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

  // ── ATTEMPT FRAME ── stakes-bearing player actions resolve by CAUSE, not chance: capability,
  // body, and circumstance are read deterministically from state, the outcome is decided HERE,
  // and the narrator renders the verdict rather than deciding it. Same state, same verdict,
  // every time. Never fires in god mode (the player is sovereign), in story mode (the player
  // authors outcomes), at mythic/cosmic tier (the world's frame already bends around them), or
  // for restful/inert turns. See attempt.ts.
  let attemptShift: string | null = null;
  if (!god && mode === "do" && tier !== "mythic" && tier !== "cosmic" && !playerInert && !RESTORE_INTENT.test(action)) {
    const frame = frameAttempt(state, action, verdict.pressure ?? 3);
    if (frame) { directive += attemptDirective(frame, action); attemptShift = frame.summary; }
  }

  // ── DRIVE IS THE DEFAULT ── Centrality is not assigned to the player; it EMERGES from desire.
  // Every present character who wants something pursues it THIS turn, by their own means — this is the
  // engine's baseline, not an occasional nudge. The character with the strongest active drive is the
  // one the scene naturally turns around, especially when the player supplies no momentum of their
  // own. A character's relationships are INSTRUMENTS of their drive, not substitutes for it: someone
  // who loves the player pursues their goal in a way that routes through the player (asking, waiting a
  // beat, carrying them along), but the goal still drives — affection is a method, not the objective.
  // WHO STEERS. Sorting on priority alone left ties to insertion order, and it counted a goal whose
  // entire content is the protagonist ("Protect Rabi and enforce his will") as an equally good
  // engine for a scene as one with a life behind it. It is not: a want that is only the player
  // cannot MOVE anywhere, so the scene it drives is the player being attended to, again. The Forge
  // already forbids this shape when it writes a companion; characters created mid-play never got
  // the rule. Rank self-propelled wants first, and let the previous turn's lead yield when someone
  // else in the room wants something — so one person cannot hold the wheel indefinitely.
  const playerFirst = state.characters["char_player"]?.name?.split(/\s+/)[0]?.toLowerCase() ?? "";
  const aboutPlayerOnly = (goal: string): boolean => {
    if (!playerFirst) return false;
    const g = goal.toLowerCase();
    if (!g.includes(playerFirst) && !/\bthe player\b/.test(g)) return false;
    // strip the player and the verb scaffolding; what's left is the character's own stake in it
    const rest = g.replace(new RegExp(`\\b${playerFirst}\\b|\\bthe player\\b`, "g"), " ")
      .replace(/\b(protect|guard|serve|obey|please|follow|find|reach|help|keep|enforce|his|her|their|its|will|and|the|a|an|to|for|of|from|with|by|safe|first)\b/g, " ")
      .replace(/[^a-z]+/g, " ").trim();
    return rest.split(/\s+/).filter(Boolean).length <= 1;
  };
  const lastLead = state.last_scene_lead;
  const drivers = presentNpcs
    .map((id) => ({ id, c: state.characters[id] }))
    .filter(({ c }) => c.drive?.goal)
    .sort((a, b) =>
      (b.c.drive!.priority ?? 1) - (a.c.drive!.priority ?? 1) ||
      (aboutPlayerOnly(a.c.drive!.goal) ? 1 : 0) - (aboutPlayerOnly(b.c.drive!.goal) ? 1 : 0) ||
      (a.id === lastLead ? 1 : 0) - (b.id === lastLead ? 1 : 0));

  // ASKED AND NOT ANSWERED. A want that can only be satisfied by the PLAYER answering never
  // progresses on its own, so the engine hands it back as the character's active goal every turn
  // and they put the same question again — three turns running, in the same words. The drive
  // system abandons such a want eventually; this is what happens in the meantime, because a player
  // feels the repetition on the second time, not the sixth.
  const nagging = presentNpcs
    .map((id) => ({ id, c: state.characters[id] }))
    .filter(({ c }) => c.drive?.goal && (state.world.current_turn - (c.drive.progress_turn ?? state.world.current_turn)) >= 2 && (c.drive.progress ?? 0) < 100);
  const nagNote = nagDirective(nagging.map((n) => n.c.name));

  if (drivers.length) {
    const lead = drivers[0];
    state.last_scene_lead = lead.id;   // so the next turn can let someone else steer
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

  // GENRE-THREAT ESCALATION — a world whose core danger is a THING THAT HUNTS must not let it sit
  // offstage for many turns. Candidate, not immediate.
  //
  // This used to fire on a world whose danger is nothing of the kind. `lethalWorld` was true if any
  // pressure-palette entry matched /predator|threat|attack|hunt|violence|kill/ — unanchored, so the
  // bare word "threat" was enough, and a pressure palette is BY DEFINITION a list of threats. Every
  // world qualified. A political-intrigue game about spies, a civil war and a compulsion that could
  // be exploited was classified as a monster world on the strength of one clause reading "Rabi's
  // power could be seen as a threat or a tool."
  //
  // Then the directive demanded a PREDATOR arrive bodily and menace someone, and handed the
  // narrator a `what_people_fear` that named no creature at all — "the heretic god of Thornwood,
  // the Church's fires, the cold arithmetic that neither king nor faith can protect anyone from."
  // Told to make that walk in and take someone, the only thing a narrator can do is invent a beast.
  // Hence black mass creatures, at intervals, in a story with no monsters in it.
  {
    const fear = (state.world_bible.what_people_fear ?? "").toLowerCase();
    // A creature is a creature. Nouns that name a thing which hunts, not the abstract vocabulary of
    // menace — and read ONLY from what_people_fear, which is the field that says what stalks this
    // world. The palette is a list of pressures; it can never be evidence of a predator.
    const BEAST = /\b(predator|beast|creature|monster|dinosaur|raptor|wolf|wolves|bear|shark|swarm|horde|infected|undead|zombie|revenant|wraith|demon|devil|maw|claw|tooth|teeth|fang)s?\b|\b(thing|things) in the\b|\b(eaten alive|devour\w*|maul\w*|being (eaten|devoured|hunted))\b/;
    const lethalWorld = BEAST.test(fear);
    // AND THE PLAYER IS NEVER SENT AT THEMSELVES. When the thing this world fears IS the
    // protagonist — which is what a god-mode rampage makes true, and what the bible then records —
    // "bring the core danger onstage" is an instruction to attack the player with the player.
    const playerName = (state.characters["char_player"]?.name ?? "").toLowerCase();
    const fearIsThePlayer = playerName.length >= 3 && fear.includes(playerName);
    if (lethalWorld && !fearIsThePlayer && (state.model_settings.tension ?? 5) >= 3) {
      const recentProse = state.history.slice(-4).map((h) => h.narrator_prose ?? "").join(" ").toLowerCase();
      const threatWords = /\b(attack|charged|lunged|screamed|blood|ran|running|chased|seized|dragged|killed|teeth|claw|roar|bit|torn|maw|predator|creature|beast|dinosaur|raptor|slaughter|panic|fled)\b/;
      if (!threatWords.test(recentProse)) {
        pressureCandidates.push({ prio: 7, text: `\nGENRE-THREAT ESCALATION: this world's core danger (${state.world_bible.what_people_fear?.trim() || "the predator threat"}) has been offstage too long — recent turns stayed domestic while the lethal threat is reduced to distant sound. THIS TURN the threat becomes PRESENT and REAL at its full scale: the predator is seen, heard closing, or acts — it moves in, takes or menaces someone, forces flight or defense. Do not soften it to "wrong birdsong." End the turn the instant the threat lands and the next beat needs a response — do not narrate the player's response for them. Use ONLY the danger named above — never invent a new kind of creature to stand in for it.` });
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
  // ── POV (single branch, always on) ──────────────────────────────────────────
  // This used to be three branches keyed to relaxation, and the top branch was the leak:
  // at relaxation >= 3 it LICENSED the narrator to hand over a read, asking only that it be
  // routed through a filter verb ("something in how xe says it makes him think X"). That is
  // still the narrator adjudicating — the verdict just moved into a subordinate clause, and
  // filter verbs are the first thing a model prunes as clunky. The graded license is gone.
  // The narrator now writes the surface at every relaxation level, and every read of another
  // person is generated in the sealed channel (engine/read.ts) where it belongs to the player
  // and can be wrong. Relaxation still governs interpretation — it governs it THERE, where it
  // is visible to the player as their own faculties failing, instead of here as tonal mush.
  const povFilter = `\nPOV — THE CAMERA IS WITH THE PLAYER AND DOES NOT LEAVE. Every sentence reports something the player could see, hear, smell, or touch from where they actually are. No cutting away. No scene break to somewhere else. No "meanwhile", no "upstairs", no "back at the —", no paragraph about what an absent character is doing, feeling, or looking at. This is not a style rule: whatever you write becomes the record, so a scene rendered in a room the player has left is filed as something they witnessed, and the person in it is credited with knowing it. One save had the player leave in a car and text his family from the back seat; the prose cut to the woman he had left, alone in the apartment, and the ledger came out saying she witnessed the messages he sent. If something is happening elsewhere it reaches the player the way things reach people — someone arrives, someone calls, word gets back, they find out later, or they never do.
POV — SURFACE ONLY: Render every character other than the player from the OUTSIDE. Face, voice, posture, motion, the words actually spoken, the body. You are given each character's inner state ONLY to decide what they observably DO with it; it is never narrated, in any grammatical position. Forbidden regardless of how it is framed: stating a motive ("puts the shuttle down to listen"), naming a concealment ("pretending he hasn't", "doesn't say what xe means"), captioning a gesture with its significance, following an act with a clause explaining the feeling under it, or routing any of these through a filter verb to make them deniable — "seems", "as if", "something in the way", "makes him think", "you can tell" are not licenses, they are the same violation with a hedge on it. If the player has a thought about someone, that thought does not appear here; another channel carries it.
COMPARISONS: a simile or metaphor may touch ONLY physical form, motion, texture, sound, or scale. Never compare a person, act, or gesture to a ROLE, PROFESSION, RITUAL, RELATIONSHIP, or INTENTION — "the way a physician takes a pulse", "like someone apologizing", "as though closing a bargain" smuggle the emotional verdict inside the vehicle, which is the same failure as stating it outright. When in doubt write no comparison: the gesture, plainly, is stronger. If a gesture needs a caption to land, the gesture is wrong — fix the gesture.
JUXTAPOSITION, NOT ATTRIBUTION: observable detail and any conclusion sit side by side without a connective. Never join them with a verb of perception or cause. Not "her brow furrows, showing irritation" and not "her brow furrows, which makes you think she is angry" — "her brow furrows." Then the next thing that happens.`;

  // ── FOCUS GATE (interiority has a source) ── povFilter above bounds HOW MUCH interior the narrator
  // may report; this bounds WHOSE. A first-person scene reads the person the player is actually
  // engaged with — everyone else is furniture until looked at. Without this, a turn spent holding one
  // character still returns a full interior read of every other body in the room, which is both the
  // omniscience leak and the bulk of the word count. Focus = any present NPC the player named,
  // addressed, or acted on this turn (plus, when the player named no one, the character driving the
  // scene). Unfocused present characters get exterior only: one line, seen and heard, no motive.
  const focusNames = state.world.present
    .filter((id) => id !== "char_player" && state.characters[id])
    .map((id) => ({ id, name: state.characters[id].name }));
  const actionLc = action.toLowerCase();
  const nameHit = (name: string) =>
    name.toLowerCase().split(/[\s'"]+/).filter((w) => w.length >= 3).some((w) => actionLc.includes(w));
  let focused = focusNames.filter((f) => nameHit(f.name));
  // ADDRESSEE FALLBACK — the common case is speaking to someone WITHOUT naming them ("should we
  // raise shields?"). Naming is rare in real dialogue, so a gate that needs a name is off almost
  // always. When the player named no one, the person they are talking to is whoever last held the
  // floor: scan the previous turn's prose and take the present character mentioned LAST.
  if (!focused.length) {
    const prev = state.history[state.history.length - 1]?.narrator_prose ?? "";
    if (prev) {
      // ADDRESSEE = whoever last SPOKE, not whoever was last mentioned. The old rule took the
      // final name in the paragraph, and narrator paragraphs habitually close on a bystander
      // reaction — so a turn spent in conversation with one person resolved focus (and the read
      // channel) onto someone across the room who happened to be described last. Scan paragraphs
      // from the end for one that contains BOTH a quotation and a present character's name; that
      // is the person holding the floor. Fall back to last-mentioned only if nobody spoke.
      const paras = prev.split(/\n\n+/);
      const surname = (n: string) => n.toLowerCase().split(/\s+/).slice(-1)[0];
      let speaker: typeof focusNames[number] | undefined;
      for (let i = paras.length - 1; i >= 0 && !speaker; i--) {
        if (!/["“”]/.test(paras[i])) continue;
        const lc = paras[i].toLowerCase();
        speaker = focusNames
          .map((f) => ({ f, at: lc.lastIndexOf(surname(f.name)) }))
          .filter((x) => x.at >= 0)
          .sort((a, b) => a.at - b.at)[0]?.f;   // earliest name in a spoken paragraph = the attributor
      }
      if (speaker) focused = [speaker];
      else {
        const lastAt = focusNames
          .map((f) => ({ f, at: prev.toLowerCase().lastIndexOf(surname(f.name)) }))
          .filter((x) => x.at >= 0)
          .sort((a, b) => b.at - a.at)[0];
        if (lastAt) focused = [lastAt.f];
      }
    }
  }
  const unfocused = focusNames.filter((f) => !focused.some((g) => g.id === f.id));
  const focusFilter = (focused.length && unfocused.length)
    ? `\nFOCUS — WHOSE INTERIOR (this turn the player is engaged with ${focused.map((f) => f.name).join(", ")}): Interiority belongs to whoever the player is actually attending to. ${focused.map((f) => f.name).join(", ")} may be read closely — what shows in them, what the player senses under it, within the POV limits above. EVERY OTHER present character (${unfocused.map((f) => f.name).join(", ")}) is rendered from the OUTSIDE ONLY and BRIEFLY: at most one line each of what they say or visibly do, and often nothing at all. For them write NO motive, NO unspoken thought, NO account of what they are managing, masking, remembering, bracing for, or signalling — and NO interpretation of a look, glance, or expression ("that look said", "as if to tell him"). They get a gesture, a line, or silence, never a paragraph of their own. Do not compensate by giving them extra dialogue.`
    : (focusNames.length >= 2)
    // LAST-RESORT CAP — no name, no prior floor-holder (scene opening). Still never let every body
    // in the room get read: one interior per turn, the rest exterior.
    ? `\nFOCUS — ONE INTERIOR ONLY: At most ONE present character may be read from the inside this turn — pick the one the player is actually engaged with. Every other present character is exterior only: at most one line each of what they say or visibly do, no motive, no unspoken thought, no interpreted glance, no paragraph of their own.`
    : "";

  // forbidden_as_primary stops the NARRATOR from reaching for a theme unprompted as a lazy
  // plot-solver. In god mode it is suppressed entirely (the player is sovereign). Outside god
  // mode it restrains the narrator's own plotting only — never an action the player declares.
  const forbid = (!god && state.world_bible.forbidden_as_primary?.length)
    ? `\nNever the primary engine of this scene: ${state.world_bible.forbidden_as_primary.join("; ")}. (This restrains your own unprompted plotting; it does not override an action the player explicitly declares.)`
    : "";
  // HARD FORBIDDEN GATE: the bible's `forbidden` list is WORLD LAW, not a content filter. Two jobs:
  // (1) the narrator never plots toward these; (2) the fiction itself obeys them — entries that state
  // how bodies, biology, culture, or society work here bind EVENTS the way physics does, even when the
  // player's own action crosses them. The earlier wording ("does not punish something the player chose")
  // licensed the narrator to suspend a biological law whenever the player's action tripped it — the
  // exact Velora failure. Player sovereignty over law runs through explicit direction, never through
  // simply acting as if the law weren't there.
  const forbiddenGate = (!god && state.world_bible.forbidden?.trim())
    ? `\nFORBIDDEN IN THIS WORLD — these are laws of this world, not themes to avoid: ${state.world_bible.forbidden.trim()}. Two things follow. (1) Your plotting: never introduce, escalate toward, or build a thread around any of these; if the scene drifts that way, steer away. (2) The fiction obeys them: an entry that states how bodies, biology, culture, or society work here binds what happens, including when the player's own action sets it off. The player's declared action happens as declared, but the world answers it according to the law — a body that the law says cannot do a thing does not do it; a culture with no concept of a thing does not produce it; a stated consequence (pain, need, risk) arrives on schedule. The mood of a scene does not suspend a law, no matter how tender or important the moment. Do not invent exceptions or special-case explanations, and do not have a character argue a law away. The player overrides a law only through explicit direction, not by acting as if it were not there.`
    : "";
  // LAW ENGAGEMENT (deterministic): when the player's action or words touch a law entry — crossing it
  // with an act, or INVOKING it by reminding the world it exists — the narrator gets the matched law
  // quoted as binding truth at the high-compliance spot, with the anti-litigation clause. This is the
  // direct counter to the double-down failure: the model's instinct to preserve a tender scene by
  // explaining the rule away ("maybe because you're not Wym") is forbidden in advance, by name.
  const lawHit = !god ? engagedLaw(state, action) : undefined;
  const lawDirective = lawHit
    ? `\nWORLD LAW ENGAGED — the player's action or words this turn touch a law of this world: "${lawHit}". This law is real and has always been real, and the player is right about it. If their action crossed the law, it applies now — the body or culture behaves exactly as the law describes, the stated pain, need, or impossibility happens as written, and characters who should have known react honestly. If the player invoked the law — reminded anyone it exists, asked whether it still holds — the fiction confirms it: characters realize what they should have known, and consequences the law states begin to apply. If the law states a time threshold, treat it as a timer measured against the scene minutes shown in the NOW block: once the timed activity began it does not pause for conversation, and the consequence arrives on schedule. Do not invent an exception, argue the law away, or treat respecting it as anyone's mistake.`
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
  //
  // EARNED_RESPONSE names the witnesses by their standing. The block used to offer exactly one
  // family of reactions — "fear, awe, flight, careful submission, stunned silence, frantic
  // appeasement, worship" — and then instruct the narrator to pick whichever the character's NATURE
  // produced. Every option was a variant of submission, so nature had nowhere to go: a wife, a
  // sworn brother, and a bounty hunter all came out afraid. Awe is real and it is not one-signed —
  // people who love someone with terrible power feel pride, relief, possessive delight, protective
  // worry FOR them, and the ordinary desire to still be treated as themselves. Splitting the
  // present cast by their actual edge lets the model use the ledger it already has.
  const bondedWitnesses: string[] = [];
  const waryWitnesses: string[] = [];
  for (const id of presentNpcs) {
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    const bond = bondStrength(e);
    if (bond >= 25) bondedWitnesses.push(state.characters[id].name);
    else if (bond <= -15) waryWitnesses.push(state.characters[id].name);
  }
  const witnessRoster = [
    bondedWitnesses.length ? `BONDED WITNESSES (their bond with the player is established in the ledger — their awe runs THROUGH that bond, it does not delete it): ${bondedWitnesses.join(", ")}.` : "",
    waryWitnesses.length ? `WARY OR HOSTILE WITNESSES: ${waryWitnesses.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  const earnedResponse = (tier === "mythic" || tier === "cosmic")
    ? `\nAPPLY POLICY EARNED_RESPONSE — the player operates at extraordinary scale; the world responds at that scale.\nCONTINUITY UNDER THE IMPOSSIBLE: the player has just been seen doing something reality-bending (moved someone, undid a thing, bent space). Render that act cleanly and literally — but the REST of the world stays COHERENT. Every character keeps their established identity, name, role, and relationships exactly as the ledger has them; do not let anyone's status silently flip (an apprentice does not become a master, a stranger does not become a friend) unless the player's act explicitly caused it. Track WHO IS PRESENT precisely: if the player removed someone from the scene, they are GONE until brought back; if the player returned them, they are present again, unchanged. One impossible thing happened; everything else obeys normal continuity. Do not spawn random events, reassign lines between characters, or let the scene dissolve — anchor hard to the established cast and their standing state.\nWITNESS REACTION MUST FLOW FROM WHAT THEY SAW — AND FROM WHO THEY ARE TO THE PLAYER. Any character who just witnessed the player do the impossible has their relationship to the player rewritten in SCALE by it: they are no longer dealing with a peer they can scold, lecture, or bargain with as an equal. What is NOT rewritten is the SIGN of that relationship. Witnessing overwhelming power makes a person feel it enormously — in the direction they already faced.\n${witnessRoster}\nSo: someone bonded to the player feels awe as EXALTATION — pride, fierce joy, relief that this power is on their side, worship that is also love, possessive delight, protectiveness toward the player themselves, or the very human wish to still be treated as a person by them. They may be frightened FOR the player, or of what this will cost them, or of the distance it opens between them — that is grief and love, not terror, and it is often the truest note available. A wary or hostile witness feels it as fear, flight, careful submission, stunned silence, frantic appeasement, or a calculating decision to get close to power and use it. Someone with no history with the player at all reacts from their own nature: fear, awe, opportunism, curiosity, or the impulse to kneel — a stranger is genuinely open.\nTwo things stay forbidden. (1) Do NOT manufacture a confrontation or a moral challenge against a being the character has just seen wield godlike power: wounded pride and indignation are available only to someone who has not grasped what they saw, or whose nature is recklessly defiant to the point of self-destruction, and even then it reads as terror or denial underneath, never casual equality. (2) Do NOT flatten everyone into terror. A room where the player's lover, their sworn friend, and a man who hates them all react the same way is a failure of this policy, not a fulfilment of it. Their behavior bends around the fact of that power, always — each in the direction they were already facing.`
    : "";
  // CONTRACT GOVERNOR: when the last chapter audit found the story drifting from its standing
  // direction, every turn carries a course-correction until the next audit passes. This is the
  // machinery that was missing when a "romantic/erotic literary fiction" ran 163 turns of
  // tribunal procedure with nobody noticing.
  const contractFix = state.contract_drift
    ? `\nCOURSE-CORRECTION (the story has drifted from its contract): ${state.contract_drift} Steer back through present characters' wants and the standing direction — not with a lurch, but starting THIS turn.`
    : "";
  // PUBLIC STANDING — the crowd's counterpart to the edge ledger. Without this the narrator had no
  // state at all for "the wider community" and improvised it from whatever the nearest directive
  // implied, which at high tier meant fear every time. Reads the standing built by prior turns'
  // public acts; this turn's act updates it after the prose exists (see updatePublicStanding below).
  const publicNote = publicStandingDirective(state, standingTier);
  // ── BODY STATE ── A wrecked body reached the narrator as a noun in a comma-joined list
  // ("conditions: eviscerated and exposed") with no weight and no instruction, while the contract
  // told it that conditions not caused this turn are background. So a man could be opened up and
  // go on producing composed argument, in cadence, arms crossed. Severity is graded now, and
  // anything from moderate up arrives as a directive naming what the body has taken away. Covers
  // the player too — the state is the state.
  // ── THE ROOM IS NOT EMPTY ── PRESENT lists cast members only, so a populated place with nobody
  // carded standing in it read to the narrator as deserted. See engine/population.ts.
  // Someone finished a journey to the player this turn. If the narrator is not told, they simply
  // materialise in the room — which is precisely what "Andrea just magically appeared" was.
  const arrivalNote = (state.world.arrivals_pending ?? []).length
    ? `\nARRIVING NOW: ${state.world.arrivals_pending!.join(", ")} — they have been travelling to reach the player and get here THIS turn. WRITE THEM ARRIVING, on the page, in the door, off the road: where they came from, what the journey cost, why they came. They do not simply be here; nobody may already be mid-conversation with them. This is their entrance.`
    : "";
  const crowdNote = crowdDirective(state);
  const giftNote = giftDirective(action);
  const bodyNote = [...state.world.present, "char_player"]
    .filter((id, i, a) => a.indexOf(id) === i && state.characters[id])
    .map((id) => bodyDirective(state.condition[id], id === "char_player" ? "The player" : state.characters[id].name))
    .filter(Boolean)
    .join("");
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
    ? `\n\nPRONOUN LAW — this world's people use ${worldPro} and NOTHING ELSE. This is not a preference; their language contains no other pronoun. Two separate rules:\n1) NARRATION: refer to every ${worldPro.split("/")[0]}-using character with ${worldPro}. Never "he/him/his" or "she/her/hers" for them, not once.\n2) DIALOGUE: a ${worldPro.split("/")[0]}-speaker CANNOT say "he", "him", "his", "she", "her", or "hers" — those words do not exist for them. When one of them refers to anyone, they say ${worldPro}. This includes referring to the player, with no exception: a native addressing or describing the player uses ${worldPro} like for anyone else.${playerPro && playerPro !== worldPro ? ` The player uses ${playerPro} and may use those words — but a native hearing them finds them alien and does not adopt them, not even once, not even in their head or as a joke.` : ""}\nIf you catch yourself about to write a native saying "him" or "her", stop: they would say ${worldPro.split("/")[1] ?? worldPro}.`
    : "";
  const fullDirective = directive + forbid + forbiddenGate + lawDirective + earnedResponse + arrivalNote + nagNote + crowdNote + giftNote + bodyNote + publicNote + stallDirective + ditherDirective + focusFilter + interiorGuard + (fate.forceArrival || fate.act === "convergence" ? "" : restProtection) + contractFix + "\n" + (restoration && tensionNow <= 3 && !fate.active ? "" : undertow.directive) + fateNote + pronounLock + arrivals + echoBan(state) + frameDirective(state, state.world.present, focused.map((f) => f.id)) + povFilter;
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
    // THE ANCHOR PINS THE SCENE, SO THE SCENE HAS TO INVALIDATE IT. The anchored digest contains
    // the PRESENT block — which the prompt calls law — and the signature was built from character
    // IDENTITY alone: who exists, is central, and is unpaged. Nobody leaving the room changed it,
    // so a scene that opened with five people in a hall kept re-serving "these five are here" for
    // the whole cadence, and the narrator went on writing lines for people who had walked out
    // three turns earlier. Who is in the room, and where the room is, belong in the signature.
    const castSig = [
      Object.entries(state.characters)
        .filter(([, c]) => c.status !== "dead" && c.status !== "departed" && c.central !== false && !c.paged)
        .map(([id]) => id).sort().join(","),
      `@${state.world.player_location}`,
      `present:${[...state.world.present].sort().join(",")}`,
    ].join("|");
    const anchor = state.context_anchor;
    const stale = !anchor || (turn - anchor.turn) >= cad || anchor.cast_sig !== castSig;
    if (stale) state.context_anchor = { turn, digest: `${prefix}\n\n${digest}`, cast_sig: castSig, ledger: ledgerSnapshot(state) };
    const a = state.context_anchor!;
    const pairs = state.history
      .filter((h) => h.kind !== "opening" && h.kind !== "interlude" && h.turn >= a.turn)
      .slice(-cad)
      .map((h) => ({ user: h.player_action, assistant: scrubForReplay(h.narrator_prose) }));
    narratorMsgs = buildChatlogMessages(
      narratorSystem(lean), a.digest, pairs,
      `${deltaNote(state, memQuery)}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}${intentForNarrator(intents)}${habitVerdict}${noveltyNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}${sovereignty(state)}${SURFACE_TAIL}`,
      state.model_settings.narrator_model,
    );
  } else {
    narratorMsgs = buildMessages(
      narratorSystem(lean), prefix,
      `${digest}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}${intentForNarrator(intents)}${habitVerdict}${noveltyNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}${sovereignty(state)}${SURFACE_TAIL}`,
      state.model_settings.narrator_model,
    );
  }
  // ── READ CHANNEL (concurrent with the narrator) ────────────────────────────
  // The narrator writes the surface; the player's faculties read it. Fired here, not awaited,
  // so it overlaps the whole stream. Target is whoever the focus gate already resolved — the
  // person the player is actually engaged with — because that is who a person in a room is
  // reading. The surface handed over is the PREVIOUS turn's prose plus this turn's action:
  // exactly what the player has in front of them at the moment they form an impression, and
  // nothing from the state that they could not have perceived.
  const readTarget = focused[0]?.id ?? focusNames[0]?.id ?? null;
  const readsPromise: Promise<Read[]> = (async () => {
    if (opts?.proseOverride) return [];
    if (needsFaculties(state)) {
      const list = await deriveFaculties(state);
      if (list.length) state.faculties = { turn, trait_count: (state.traits["char_player"] ?? []).length, list };
      else return [];
    }
    const prev = state.history[state.history.length - 1]?.narrator_prose ?? "";
    const surface = `${prev ? prev + "\n\n" : ""}[the player now:] ${action}`;
    const rs = await runReads(state, readTarget, surface, turn);
    if (rs.length) ev.onRead?.(rs);
    return rs;
  })();

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
  // PRONOUN REPAIR (deterministic). The lock instructs; this enforces. Natives' gendered pronouns
  // inside dialogue are rewritten to the world set — most often for mentioned people with no card
  // and no printed pronouns (a child, a coworker), where the model defaults to "she". Conservative:
  // dialogue spans only, never narration, and never within a breath of the player's name.
  {
    const pr = repairNativePronouns(prose, worldPro, state.characters.char_player?.name ?? "");
    if (pr.fixed > 0) {
      prose = pr.prose;
      ev.onMeta?.({ shifts: [`pronoun repair: ${pr.fixed} gendered pronoun${pr.fixed > 1 ? "s" : ""} in dialogue rewritten to the world's set`] });
    }
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

  // ── TIC GUARD ── Deterministic backstop for two failures the DIALOGUE rules ban in the prompt and
  // the model produces anyway, because both are what a model reaches for when it has nothing to add:
  // (1) reflecting the player's own words back with an intensifier ("you really just <verbatim>",
  // "no one has ever <verbatim>"), and (2) the canned affirmations ("that's not nothing", "it's a
  // lot", "you're not wrong"). Prompt bans don't hold; a regex does. We excise the offending SENTENCE
  // rather than regenerate — free, and the surrounding paragraph survives. Guards: never empty a
  // paragraph, never cut a long sentence (it's carrying real content), never cut more than two.
  {
    const CANNED = /\b(that'?s not nothing|it'?s a lot|you'?re not wrong|that'?s something)\b/i;
    // 4+ consecutive words lifted from the player's action, ignoring very common words.
    const actWords = action.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const runs: string[] = [];
    for (let i = 0; i + 4 <= actWords.length; i++) runs.push(actWords.slice(i, i + 4).join(" "));
    const echoes = (sent: string) => {
      const norm = sent.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
      return runs.some((r) => norm.includes(r));
    };
    let cuts = 0;
    const cleaned = prose.split(/\n\n+/).map((para) => {
      const sents = para.match(/[^.!?]+[.!?]*/g) ?? [para];
      if (sents.length < 2) return para;
      const kept = sents.filter((sent) => {
        const t = sent.trim();
        if (cuts >= 2 || t.length > 160) return true;
        if (CANNED.test(t) || echoes(t)) { cuts++; return false; }
        return true;
      });
      return kept.join("").trim() || para;
    }).join("\n\n");
    if (cuts) {
      prose = cleaned;
      console.warn(`[turn] tic guard: cut ${cuts} echo/canned sentence(s)`);
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
    footer = { place: hereName, entered: [], left: [], here: [], created: [], aliases: [] };
    truncationNote = "(the narrator's reply ran long and was cut off — the scene was held in place; if someone should have entered or left, say so next turn)";
  } else if (narratorTruncated) {
    truncationNote = "(the narrator's reply ran long and may have been cut short)";
  }

  // 3 ── simulator (one JSON call: bookkeeper + world tick + memory writes)
  // Collect the reads before bookkeeping. They almost always landed long ago (small model,
  // throughput-routed, ~600 tokens); this await is a formality that also guarantees the promise
  // is settled before the entry is written. Never blocks meaningfully, never throws.
  const turnReads: Read[] = await readsPromise;

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
    `${(state.retcons ?? []).filter((r) => r.kind !== "correction").length ? `=== STRUCK FROM THE STORY (never happened; if the prose references any of these, IGNORE that part entirely — record nothing from it) ===\n${(state.retcons ?? []).filter((r) => r.kind !== "correction").map((r) => `- ${r.text}`).join("\n")}\n\n` : ""}${(state.retcons ?? []).filter((r) => r.kind === "correction").length ? `=== THE PLAYER'S CORRECTIONS (supreme truth — each of these IS true and has always been true; record the world consistently with them, and when prose contradicts one, the CORRECTION is authoritative for what to record) ===\n${(state.retcons ?? []).filter((r) => r.kind === "correction").map((r) => `- ${r.text}`).join("\n")}\n\n` : ""}=== LOCATIONS (the places this world knows; use one exactly where it fits, or "elsewhere") ===\n${Object.values(state.world.places).filter((p) => p.id !== OFFSCENE).map((p) => `- ${p.name}${!(p.description_facts ?? "").trim() ? "  ← NO DESCRIPTION ON RECORD" : p.stale_note ? "  ← DESCRIPTION IS OUT OF DATE" : ""}`).join("\n")}\n- elsewhere (not in a tracked place)\n${Object.values(state.world.places).some((p) => p.id !== OFFSCENE && (!(p.description_facts ?? "").trim() || p.stale_note)) ? `\nPLACES MARKED ABOVE NEED A places_update FROM YOU when this turn\u2019s prose gives you the material for one \u2014 a place with no description on record is invisible to the narrator, and an out-of-date one makes it describe something that is no longer there. Write description_facts as the PHYSICAL FACTS a person walking in would see: what is built there, what it is made of, what is in it, who is usually about. Never narrative, never an event, never a note about the player. Only for places this turn actually showed you; leave the rest alone.` : ""}\n\n=== PLAYER ACTION ===\n${bookkeeperAction}${intentForBookkeeper(intents)}${(() => {
      // A SECOND LOOK AT THE PROMISE LEDGER, aimed at this turn. The open list is already in the
      // context; this points at the ones whose words overlap what actually just happened, because a
      // long turn is exactly where a small model loses one, and the cost is a job the player has
      // already done sitting in their journal as still owed.
      const likely = promisesLikelyMet(state, action, prose);
      return likely.length
        ? `\n\n=== PROMISES THIS TURN MAY HAVE SETTLED (check each against the prose; resolve kept, or broken, or leave open and it stays in the player's journal) ===\n${likely.map((p) => `- ${p.id} | "${p.text}"`).join("\n")}`
        : "";
    })()}\n\n=== NARRATOR PROSE (what was RENDERED — deliberately hides the ground truth above; when the GROUND TRUTH and the prose differ, the TRUTH is authoritative for what to record) ===\n${prose}`,
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
      const want = nm.toLowerCase().replace(/^the\s+/, "");
      const first = want.split(/\s+/)[0];
      return Object.entries(state.characters).find(([id, c]) => {
        if (id === "char_player") return false;
        const n = c.name.toLowerCase();
        if (n === want || n.split(/\s+/)[0] === first) return true;
        return (c.aliases ?? []).some((a) => a.toLowerCase() === want);   // "Headmaster", "the old man"
      })?.[0];
    };
    if (footer.place) {
      const pid = resolvePlace(state, footer.place, { keepIfUnknown: true });
      diff.player_location = state.world.places[pid]?.name ?? undefined;
      if (state.world.places[pid] && pid !== state.world.player_location) {
        console.info(`[places] narrator set the scene at "${state.world.places[pid].name}"`);
      }
    }
    // ── CAST CREATION IS DECLARED, NOT INFERRED ────────────────────────────
    // Every regex path into the cast has now produced a false person: a frequency rule enrolled
    // Somewhere and Pictish, an apostrophe rule enrolled "I'd", a speech-adjacency rule enrolled
    // "Hat" for the Sorting Hat, and a title in dialogue turns the same character into a second
    // one. No refinement fixes the category: a regex is guessing at something the writer already
    // knows. So the narrator declares it. `new=` creates, `alias=` says a title or nickname
    // belongs to someone who already exists — which is the specific case regex can never get
    // right, because "Headmaster" and "Professor Dumbledore" look nothing alike.
    for (const a of footer.aliases) {
      const id = findChar(a.of) ?? findChar(a.alias);
      if (!id) continue;
      const c = state.characters[id];
      const have = new Set((c.aliases ?? []).map((x) => x.toLowerCase()));
      if (!have.has(a.alias.toLowerCase()) && a.alias.toLowerCase() !== c.name.toLowerCase()) {
        c.aliases = [...(c.aliases ?? []), a.alias].slice(0, 8);
      }
    }
    for (const c of footer.created) {
      if (findChar(c.name)) continue;
      if (/^(i'?d|he'?ll|she'?ll|that'?s|don'?t|it'?s)$/i.test(c.name)) continue;
      const id = registerCharacter(state, {
        name: c.name, central: false, provisional: true,
        location: state.world.player_location,
        background: c.gist
          ? `INCOMPLETE RECORD — the narrator brought them into the story at ${state.world.current_time}. What was established: ${c.gist}`
          : `INCOMPLETE RECORD — the narrator brought them into the story at ${state.world.current_time}.`,
      } as any);
      if (id) {
        state.world.present.push(id);
        arrivalShifts.push(`${c.name} entered the story.`);
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
    // `here` outranks everything: it is the scene as the writer left it. Anyone named is placed at
    // the scene's location whatever the ledger thought, and any roster character NOT named who the
    // ledger believes is here is moved out — otherwise a stale presence lingers forever.
    if (footer.here.length) {
      const hereIds = new Set<string>();
      for (const nm of footer.here) { const id = findChar(nm); if (id) hereIds.add(id); }
      for (const id of hereIds) rebuilt.push({ char_id: id, place: footer.place || hereName, said: "narrator: in scene" });
      for (const [id, c] of Object.entries(state.characters)) {
        if (id === "char_player" || hereIds.has(id)) continue;
        if (c.location && c.location === state.world.player_location) {
          rebuilt.push({ char_id: id, place: "elsewhere", said: "narrator: not in scene" });
        }
      }
    }
    // FLOOR: anyone the prose shows acting or speaking is in the scene, footer or no footer. Adds
    // only — the footer alone decides who leaves. Skips anyone the footer explicitly moved out this
    // turn, so a departure written as "she stood and left" is not undone by the verb that carried it.
    {
      const movedOut = new Set(rebuilt.filter((r) => r.place === "elsewhere").map((r) => r.char_id));
      const already = new Set(rebuilt.map((r) => r.char_id));
      for (const id of presenceFromProse(state, prose)) {
        if (movedOut.has(id) || already.has(id)) continue;
        rebuilt.push({ char_id: id, place: footer.place || hereName, said: "prose: acted in scene" });
      }
    }
    // keep any simulator move for a character the footer said nothing about (offscreen world motion)
    const spoken = new Set(rebuilt.map((r) => r.char_id));
    for (const l of diff.locations ?? []) if (!spoken.has(l.char_id) && l.char_id !== "char_player") rebuilt.push(l);
    diff.locations = rebuilt;
  } else {
    // NO FOOTER AT ALL (truncation, or a model that ignored the spec). The floor still applies —
    // this is the case where presence would otherwise be whatever the simulator happened to say,
    // which historically was nothing.
    const hereName2 = state.world.places[state.world.player_location]?.name ?? "";
    const have = new Set((diff.locations ?? []).map((l) => l.char_id));
    const add = presenceFromProse(state, prose)
      .filter((id) => !have.has(id))
      .map((id) => ({ char_id: id, place: hereName2, said: "prose: acted in scene" }));
    if (add.length) diff.locations = [...(diff.locations ?? []), ...add];
  }

  // ── TRAVELLING COMPANIONS ── the player's move is applied unconditionally from the footer, but
  // everyone else's needs either a footer `entered` line or a quoted simulator move. Nobody
  // "enters" when they were already walking beside you, so a companion who guides the player
  // somewhere gets left standing in the last location while the camera goes on without them.
  // Presence is derived from co-location, so they then vanish from a scene they are visibly IN —
  // speaking, named, addressed by other characters — which is how Muirenn walked Anki to the
  // village and ceased to exist on arrival.
  //
  // Deliberately narrow. Only someone who (a) was present last turn, (b) has no other movement
  // recorded this turn, and (c) is still named in this turn's prose comes along. A companion who
  // was written as staying behind won't be in the prose and won't be dragged.
  {
    const destName = diff.player_location;
    const destPid = destName ? resolvePlace(state, destName, { keepIfUnknown: true, noCreate: true }) : state.world.player_location;
    if (destName && destPid !== state.world.player_location) {
      const moved = new Set((diff.locations ?? []).map((l) => l.char_id));
      const hay = prose.toLowerCase();
      for (const cid of state.world.present) {
        if (cid === "char_player" || moved.has(cid)) continue;
        const c = state.characters[cid];
        if (!c || c.status === "dead" || c.status === "departed") continue;
        const first = c.name.split(/\s+/)[0]?.toLowerCase() ?? "";
        if (first.length < 3 || !hay.includes(first)) continue;
        (diff.locations ??= []).push({ char_id: cid, place: destName, said: "narrator: travelled with the player" });
        console.info(`[places] ${c.name} was still in the scene on arrival — brought along to "${destName}"`);
      }
    }
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
  const prevLocation = state.world.player_location; // for the scene clock below
  // capture the cast BEFORE the diff runs — applyDiff may move people, and the history entry
  // must record who was actually in this scene (scene illustrations of old paragraphs use it)
  const presentDuringTurn = [...state.world.present];
  const shifts = applyDiff(state, diff, action, prose, !!footer);
  for (const s of arrivalShifts) shifts.push(s);

  // SUCCESSES MAKE WORK. Runs after the diff lands, so it sees what this turn actually established
  // rather than what the prose gestured at. Rationed inside the module; a no-op on most turns.
  const grown = await threadsFromSuccess(state, diff, action, prose);
  if (grown.length) {
    state.world.threads.push(...grown);
    state.last_establish_turn = turn;
    for (const t of grown) shifts.push(`Something now rests on what you built: ${t.title}`);
  }
  for (const s of habitShifts) shifts.push(s);
  if (attemptShift) shifts.push(attemptShift); // the frame's verdict, legible in "what shifted"
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
  // rivalry next: two present characters wanting the same person, one watching the other's pursuit
  // land — a deterministic jealousy dip and state, which co-regulation and the lifecycle then carry.
  safeTick("rivalry", () => tickRivalry(state));
  // co-regulation first (who is in the room moves the body), then the emotion lifecycle
  // (what the body does with what it is carrying) reads the post-company relaxation.
  safeTick("co-regulation", () => tickCoRegulation(state));
  safeTick("emotions", () => tickEmotions(state));
  // discharge LAST of the psyche ticks: it reads the fully settled relaxation after company and
  // the lifecycle have had their say, against the start-of-turn baseline captured above.
  safeTick("discharge", () => tickDischarge(state));

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

  if ((state.model_settings.tension ?? 5) > 0) {
    // Dispersion is measured from the ledger now, not handed over by the retired undertow (which
    // supplied a hardcoded 0 and left the anti-chorus machinery unreachable). See magnetPull.
    const magnet = magnetPull(state);
    if (magnet.sharedTarget && magnet.dispersion >= 0.4) {
      console.info(`[drives] chorus magnet: ${state.characters[magnet.sharedTarget]?.name ?? magnet.sharedTarget} at dispersion ${magnet.dispersion.toFixed(2)} — seeding self-interested wants`);
    }
    offscreenLog.push(...regenerateDrives(state, Math.random, undertow.epistemic_pulls ?? [], { dispersion: magnet.dispersion, sharedTarget: magnet.sharedTarget }));
  } // tracked + idle → a fresh want; epistemic pulls steer toward "find out" goals; dispersion spreads the cast off any shared magnet; suppressed entirely at tension 0
  // SEED BEFORE SPREAD. The diffusion engine was correct and permanently empty because nothing
  // created rumors — the simulator's optional rumors_new was the only writer and it rarely fires.
  // A witnessed memory big enough to be worth repeating IS the seed, and it costs no tokens.
  // THE WORLD MOVES ON ITS OWN. Runs before seeding so this interval's offstage events become
  // witness memories in time to be picked up as rumors on the same turn.
  // Nobody stays in the holding pen. A character with no resolvable location is not a character who
  // has left the story — the engine just lost track of them for a turn.
  offscreenLog.push(...returnFromOffscene(state));
  try { offscreenLog.push(...(await runOffstage(state, state.model_settings.forge_model))); }
  catch { /* the world simply didn't move this interval */ }
  offscreenLog.push(...seedWitnessRumors(state, state.world.current_turn));
  // STANDING BEFORE SPREAD. What the player just did in public moves their reputation, and the
  // updated reputation is what decides how this turn's rumors about them travel — a deed done by
  // someone the town already loves does not spread as dread. Runs after seeding (so the deed is
  // already a rumor) and before diffusion (so the charge is read against the fresh standing).
  {
    const standingLine = updatePublicStanding(state, action, prose, tier, standingTier);
    if (standingLine) { offscreenLog.push(standingLine); shifts.push(standingLine); }
  }
  offscreenLog.push(...diffuseRumors(state));
  for (const id of Object.keys(state.characters)) {
    // conditions decay for EVERYONE incl. the player — a nosebleed is not a life sentence
    const cc = state.condition[id];
    if (!cc) continue; // defensive: imported saves can lack a condition record
    cc.condition_age ??= {};
    // ...but only the kind of thing that decays. The timer applied to every string equally, so
    // "eviscerated and exposed" was scheduled to quietly vanish ten turns after a man's insides
    // came out, and he would have been well again with nothing in the prose healing him. Anything
    // severe or worse waits for the story to remove it (condition_remove), not the clock.
    const expired = cc.conditions.filter((x) => fadesOnItsOwn(x) && turn - (cc.condition_age![x] ?? turn) >= CONDITION_LIFESPAN);
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
  // fired clocks: a full clock is a PROMISE — its consequence must land, not evaporate. Convert the
  // firing into a due consequence so next turn's beat selection (which checks due consequences first,
  // before cooldowns and grace) discharges it into the scene at full scale. Without this, a clock
  // that filled mid-scene just flipped status and its promised crisis never arrived.
  for (const line of dischargeFiredClocks(state, turn)) shifts.push(line);

  // history + time
  const minutes = diff.elapsed_minutes > 0 ? clamp(diff.elapsed_minutes, 1, 12 * 60) : heuristicMinutes(action, prose);
  state.world.current_time = advance(state.world.current_time, minutes);
  // SCENE CLOCK: the narrator sees the world clock every turn but cannot tell how long the current
  // scene has been running — which is exactly what timed world laws ("pain after ten minutes") are
  // measured against. Track when the current scene began: a location change or a big time jump
  // starts a new scene; the digest prints the elapsed minutes beside the location.
  if (!state.world.scene_started_time || prevLocation !== state.world.player_location || minutes >= 120) {
    state.world.scene_started_time = state.world.current_time;
  }

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
    reads: turnReads.length ? turnReads : undefined,
    summary: diff.scene_summary || prose.slice(0, 120),
    present: presentDuringTurn,
    shifts: shifts.slice(0, 8), weather: state.world.weather, directive: fullDirective.slice(0, 240),
    offscreen: rankOffscreen(offscreenLog).slice(0, 6), time_label: state.world.current_time,
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
      // ── HOW THEY ACTUALLY STAND WITH THE PEOPLE IN THESE MEMORIES ────────────────────────────
      // Reflection was given a name, an acquaintance label, a goal, its existing beliefs, a note on
      // its nervous system, and twenty episodic memories. Nothing about who anyone IS to it now,
      // and nothing about who is still alive. So it read the memories at face value and wrote what
      // they appeared to say. One player's own belief list came out of this:
      //
      //   t145  "Andrea sees what I cannot — she may be the only one who will tell me the truth."
      //   t155  "Andrea is right that I have moved too fast for them to trust me."
      //   t175  "Andrea is the only one who speaks plainly to me, and her advice was right."
      //
      // Their edge toward Andrea, read off the telemetry for those exact turns: -97, -98.5, -100.
      // She had also been dead since before the last one. Andrea did say useful things in those
      // memories, so with no counterweight the model concluded she was the truth-teller — while the
      // ledger recorded total hatred and the world recorded a corpse. The player read their own
      // beliefs back and did not recognise the person holding them, which is exactly right: nobody
      // held them. Give the pass the standing and the status, and none of those lines can be written.
      const standing = Object.entries(state.characters)
        .filter(([oid]) => oid !== id)
        .map(([oid, oc]) => {
          const e = state.world.edges.find((x) => x.from === id && x.to === oid);
          const named = new RegExp(`\\b${(oc.name.split(/\s+/)[0] ?? "").toLowerCase()}\\b`).test(recent.toLowerCase());
          if (!named && !e) return "";
          const gone = oc.status === "dead" || oc.status === "departed" ? `, ${oc.status.toUpperCase()}` : "";
          return e
            ? `${oc.name}: warmth ${Math.round(e.warmth)}, trust ${Math.round(e.trust)}${e.roles?.length ? `, ${e.roles.join("/")}` : ""}${gone}`
            : `${oc.name}: no relationship on record${gone}`;
        })
        .filter(Boolean)
        .slice(0, 10)
        .join(" | ");
      const msgs = [
        { role: "system", content: REFLECTION_SYSTEM },
        { role: "user", content: `Character: ${state.characters[id]?.name}\nHOW LONG THEY HAVE KNOWN THE PLAYER: ${acquaintanceLabel(state, id)}\nACTIVE GOAL: ${state.characters[id]?.drive?.goal ?? "none"}${state.characters[id]?.drive?.blocker ? ` (blocked: ${state.characters[id]!.drive!.blocker})` : ""}\nQueued goals: ${(state.characters[id]?.drive_queue ?? []).map((q) => q.goal).join(" | ") || "none"}\nExisting beliefs: ${mem.beliefs.map((b) => b.content).join(" | ") || "none"}\nHOW THEY STAND WITH THESE PEOPLE RIGHT NOW (binding — a belief may not contradict it): ${standing || "nobody on record"}\nNervous system this period: ${(() => { const ps = state.condition[id]?.psyche; if (!ps) return "unknown"; if ((ps.consecutive_clenched ?? 0) >= 3) return `clenched for ${ps.consecutive_clenched} straight turns — a body bracing this long hardens protective, suspicious convictions`; if ((ps.open_run ?? 0) >= 3) return `settled for ${ps.open_run} straight turns — a body at ease this long can afford generous, revisable convictions`; return "mixed — neither braced nor at ease for long"; })()}\nRecent memories:\n${recent}` },
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
  ev.onMeta({ telemetry: tel, offscreen: rankOffscreen(offscreenLog).slice(0, 6), shifts: shifts.slice(0, 8), weather: state.world.weather, time: state.world.current_time });
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
/** Token overlap between two strings. Coerces on the way in ON PURPOSE: every caller passes a
 *  hand-editable field — a thread title, a consequence description — and one of them being blank is
 *  a real state, not a programming error. It should score zero, not take the turn down with it. */
function overlapRatio(rawA: unknown, rawB: unknown): number {
  const a = String(rawA ?? ""), b = String(rawB ?? "");
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

/**
 * Can this character legitimately receive state from THIS scene?
 *
 * Yes when they were in it, when the prose names them, or when the player's action names them.
 * The case this exists to reject is the one the arrival guard also catches from the other side: a
 * cast member who is nowhere near the scene being handed the behavior of an unnamed walk-on the
 * narrator wrote, because the bookkeeper needed an id and that was the nearest one on its list.
 */
function misattributionAllowed(state: SaveState, id: string, prose: string, action: string): boolean {
  if (id === "char_player") return true;
  if (state.world.present.includes(id)) return true;
  const c = state.characters[id];
  if (!c) return false;
  if (c.location && c.location === state.world.player_location) return true;
  const nameLow = (c.name ?? "").toLowerCase();
  const tokens = nameLow.split(/\s+/).map((t) => t.replace(/[^a-z]/g, "")).filter((t) => t.length >= 3);
  const probes = [...new Set([nameLow, ...tokens])].filter((p) => p.length >= 3);
  if (!probes.length) return true;                    // unprobeable name: don't block on nothing
  const blob = `${prose} ${action}`.toLowerCase();
  return probes.some((p) => blob.includes(p));
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
  // Remember who was here before this rebuild. The narrator's delta needs to SAY that someone left
  // — omission from a list is not a statement of absence, and the anchored snapshot it reads
  // against still asserts the old room. See deltaNote.
  const before = [...(state.world.present ?? [])];
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
  state.world.present_prev = before;
  state.world.arrivals_pending = [];   // consumed by the directive that renders the entrance
  // Stamp the clock for this turn so elapsed in-world time between two turns is knowable. Kept to a
  // short window — this is for travel arithmetic, not a history.
  const t = state.world.current_turn;
  const stamps = (state.world.time_at_turn ??= {});
  stamps[t] = state.world.current_time;
  for (const k of Object.keys(stamps)) if (t - Number(k) > 60) delete stamps[Number(k)];
}


/** NAMES THE PLAYER USED FOR SOMEONE WHO DOES NOT EXIST YET.
 *
 *  The cast could only ever grow from PROSE — the bookkeeper declaring new_characters, or the
 *  speaker auto-register below. Nothing looked at the player's own action, so typing "I go find
 *  Marek" produced a narrator improvising a Marek who never entered state, never got an edge,
 *  never accumulated memory, and arrived a stranger again every scene.
 *
 *  Person-context is required, not just capitalisation: a capitalised word at the head of a
 *  sentence is usually grammar, and the old frequency heuristic in unregisteredSpeakers is a
 *  standing lesson in what happens when you guess. A name must either sit mid-sentence or follow
 *  a word that can only precede a person. */
const NOT_A_PERSON = new Set(["i","the","a","an","and","but","then","so","if","when","my","his","her","their","its","this","that","these","those","it","he","she","they","we","you","there","here","what","who","why","how","ok","okay","yes","no","god","lord","sir","lady","hey","alright","well","now","after","before","while",
  // Closed-class words that follow the person-verbs above — "ask ABOUT the divorce", "call BACK",
  // "tell THEM". None of them is ever somebody's name, and on the lower-case path capitalisation is
  // not there to rule them out.
  "about","again","around","back","out","up","down","off","over","through","whether","because",
  "me","him","them","us","someone","anyone","everyone","nobody","something","anything","nothing","everything"]);
const PERSON_LEAD = /\b(?:to|with|for|at|about|and|find|see|call|summon|conjure|ask|tell|meet|greet|visit|bring|invite|toward|towards|beside|near|from)\s+$/i;
/** A much stricter lead, for the LOWER-CASE path only. Capitalisation is doing no work there, so
 *  the word in front has to be one that can take almost nothing BUT a person: a verb aimed at
 *  somebody, or the relationship noun a name is usually apposed to ("my friend sarah"). The general
 *  list above is far too weak for this — "and", "to" and "about" precede anything, and letting them
 *  through turned "i sit down and think about it" into a character named Think. */
const LOWER_LEAD = /\b(?:find|call|calls|called|text|texts|texted|message|messages|messaged|email|emails|emailed|phone|phones|phoned|ring|dm|ask|asks|asked|tell|tells|told|meet|meets|met|greet|visit|visits|invite|invites|summon|summons|conjure|conjures|kiss|kisses|hug|hugs|friend|sister|brother|wife|husband|mother|father|cousin|neighbou?r|colleague|partner|boss|named|calledd?)\s+$/i;

export function namedInAction(state: SaveState, action: string): string[] {
  const known = new Set<string>();
  for (const c of Object.values(state.characters)) {
    for (const w of c.name.split(/\s+/)) known.add(w.toLowerCase());
    for (const al of c.aliases ?? []) for (const w of al.split(/\s+/)) known.add(w.toLowerCase());
  }
  for (const pl of Object.values(state.world.places)) for (const w of pl.name.split(/\s+/)) known.add(w.toLowerCase());
  for (const w of `${state.world_bible?.name ?? ""} ${state.world_bible?.era ?? ""}`.split(/\s+/)) known.add(w.toLowerCase());

  const out = new Set<string>();
  // PLAYERS TYPE IN LOWER CASE. This required a capital letter, so "I text sarah" named nobody: a
  // friend the player wrote to twice, whom the narrator described at length ("a friend from the old
  // job, the one who'd never met Tessa, the one who wouldn't have to pick sides"), never became a
  // person, never got a card, and could never answer. A lower-case candidate is only considered when
  // it follows a word that can ONLY precede a person — text, call, find, ask, meet — which is a far
  // stronger signal than capitalisation ever was, and is exactly how it was typed.
  const re = /[A-Za-zÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜáéíóúàèìòùâêîôûäëïöü](?:'?[A-Za-záéíóúàèìòùâêîôûäëïöü-]){2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(action))) {
    const name = m[0];
    if (known.has(name.toLowerCase()) || NOT_A_PERSON.has(name.toLowerCase())) continue;
    // CONTRACTIONS. "I'd", "He'll", "That's", "Don't" all satisfy capital-plus-two-characters and
    // one of them became a permanent member of the cast. Reject an apostrophe followed by a
    // contraction suffix, rather than rejecting apostrophes outright — that would also lose
    // O'Brien and D'Arcy, which are names people actually use.
    if (/'(?:s|t|d|ll|re|ve|m)$/i.test(name)) continue;
    const before = action.slice(0, m.index);
    const after = action.slice(m.index + name.length);
    // "the Northgate" is a place; nobody is "the Marek". The definite article is the cheapest
    // and most reliable person/place discriminator available in an unparsed sentence.
    if (/\bthe\s+$/i.test(before)) continue;
    // A lower-case word is a name ONLY on the strength of the verb in front of it.
    if (!/^[A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ]/.test(name) && !LOWER_LEAD.test(before)) continue;
    if (!isPersonName(name[0].toUpperCase() + name.slice(1))) continue;
    const sentenceStart = /(?:^|[.!?]\s+|["'“]\s*)$/.test(before);
    // A name can legitimately open a sentence — "Marek is waiting for me" is the most natural way
    // to write it. Allow that when what follows behaves like a person: a verb, or an appositive comma.
    const actsLikePerson = /^\s*(?:,|is|was|are|were|says|said|asks|asked|stands|sits|looks|nods|turns|waits|walks|comes|arrives|answers|tells|smiles|laughs|and)\b/i.test(after);
    if (sentenceStart && !PERSON_LEAD.test(before) && !actsLikePerson) continue;
    // Record them capitalised however they were typed — "sarah" is Sarah on her card.
    out.add(name[0].toUpperCase() + name.slice(1));
  }
  return [...out].slice(0, 3);   // a turn that names four new people is a typo, not a scene
}

/** Register anyone the player just named, synchronously and with no model call, then tell the
 *  narrator to author them properly on the page this turn. The record enters provisional, which
 *  the simulator already treats as a sketch to complete and the hollow-character floor already
 *  backfills — so the person gets built by the machinery that builds everyone else, and the turn
 *  takes no extra latency. */
function spawnNamed(state: SaveState, action: string, shifts: string[]): string {
  const names = namedInAction(state, action).filter((n) => !findCharByName(state, n));
  if (!names.length) return "";
  for (const nm of names) {
    const id = registerCharacter(state, {
      name: nm, central: false, provisional: true,
      location: state.world.player_location,
      background: `INCOMPLETE RECORD — named by the player at ${state.world.current_time} and entering the story now. Nothing else is established; author them fully.`,
    } as any);
    if (id) {
      state.world.present.push(id);
      shifts.push(`${nm} entered the story because the player named them.`);
    }
  }
  return `\nNEWLY NAMED — the player just referred to ${names.join(" and ")}, who has no history in this world yet. Bring them into the scene as a WHOLE PERSON on the page: a specific body, a way of speaking that is theirs, wants that predate this moment and have nothing to do with the player. Not a function, not a role in a costume, not someone who exists to answer. They were living a life before this turn and will be after it. Do not explain who they are to the player, and do not have them announce themselves — write them as though they have always been in this story.`;
}

/**
 * The offscreen feed shows six lines, and it was showing the wrong six.
 *
 * Everything the engine does between turns pushes into one flat list, then the first six survive.
 * Drive bookkeeping fires for every tracked character every turn and lands at the front, so a
 * hundred-and-twenty-turn game showed seventy lines of "Lady Marchess sets aside A and turns to B"
 * and exactly ONE line reporting something that happened in the world. Rank by what a player is
 * actually being told: the world moved, a faction closed on something, a person got what they
 * wanted — and only then the engine's own goal-shuffling.
 */
export function rankOffscreen(lines: string[]): string[] {
  const weight = (l: string) =>
    /^Elsewhere:/.test(l) ? 0 :
    /^SIGN \(|clock has run out|moved closer to their objective|has nothing to act on/.test(l) ? 1 :
    /got what they wanted|stopped waiting on|is back in the world|word about|written bond/.test(l) ? 2 :
    /sets aside|turns to something new|works toward|can't get a read/.test(l) ? 4 :
    3;
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => weight(a.l) - weight(b.l) || a.i - b.i)
    .map((x) => x.l);
}

export function applyDiff(state: SaveState, diff: SimulatorDiff, action: string, prose: string, footerSeen = false): string[] {
  const turn = state.world.current_turn;
  const shifts: string[] = [];
  const nameOf = (id: string) => state.characters[id]?.name ?? id;
  // Who was in the scene when this turn began — captured before anything mutates locations, and
  // used by the departure evidence guard in the LOCATION block below.
  const presentAtStart = new Set(state.world.present);

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
        const exists = state.world.threads.some((x) => x.id === t.id || String(x.title ?? "").toLowerCase() === String(t.title ?? "").toLowerCase());
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
/**
 * Named people who SPOKE this turn but exist nowhere in state.
 *
 * This is the hole every "why does she sound like she's from 2026" complaint comes through. A
 * tracked character is constrained by a voice card, core traits, memories, and the knowledge gate.
 * A person the narrator simply started writing has NONE of that — no card, no register, no history
 * — so they speak in the model's default voice, which is contemporary literary fiction. It is also
 * how an offstage mother acquired opinions, and how a harper arrived carrying plot: an unregistered
 * speaker is an unconstrained oracle.
 *
 * Detection is deliberately conservative — a capitalised name adjacent to a speech verb. False
 * positives cost one background character record; false negatives cost another 2026 voice.
 */
function unregisteredSpeakers(state: SaveState, prose: string, action = ""): string[] {
  const known = new Set<string>();
  for (const c of Object.values(state.characters)) for (const w of c.name.split(/\s+/)) known.add(w.toLowerCase());
  for (const p of Object.values(state.world.places)) for (const w of p.name.split(/\s+/)) known.add(w.toLowerCase());
  for (const w of (state.world_bible?.name ?? "").split(/\s+/)) known.add(w.toLowerCase());

  // ── DIRECT SPEECH ATTRIBUTION ONLY ──────────────────────────────────────────
  // The frequency heuristic is GONE. "Capitalised word appearing 3+ times, at least once
  // mid-sentence" registered Somewhere, Pictish, Past, Rule, Even, Rome and He'll as members of the
  // cast — because adjectives of nationality, book titles, cities and contractions all satisfy it,
  // and each junk record then drew a voice card. No refinement of a frequency rule fixes that: it
  // is counting the wrong thing. Only one signal actually means "this is a person": the text says
  // they SPOKE. That misses people introduced by name and thereafter referred to as "she" — an
  // acceptable loss, since a miss costs one uncredited walk-on and a false positive costs a
  // permanent fictional person with opinions.
  const NAME = "[A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ][a-záéíóúàèìòùâêîôûäëïöü-]{2,}";
  // `called` and `calls` are gone. They are speech verbs about one time in ten — "the Church CALLED
  // him a demon", "a place called Vismara", "he called for help", "she called him a liar" — and the
  // one that bit registered the Church as a member of the cast, complete with a rumor feed. The
  // rest of this list is unambiguous; a real "Come here," he called is an acceptable loss.
  const VERBS = "said|says|asked|asks|replied|replies|answered|answers|murmured|muttered|whispered|shouted|snapped|added|continued";
  // Capitalised, adjacent to a speech verb, and still not a person: institutions, powers and
  // titles-as-bodies. A story says "the Crown replied" and "the Guild answered" in perfectly
  // ordinary prose, and none of them have a face.
  const INSTITUTION = /^(the )?(church|crown|guild|council|order|empire|kingdom|realm|senate|court|temple|abbey|city|state|company|house|watch|guard|army|navy|clergy|priesthood|inquisition|parliament|throne|god|lord|heavens?)$/i;
  // SELF-INTRODUCTION. The two rules above look for a name ADJACENT to a speech verb, and the most
  // common way a person enters a story defeats both: the player asks a name, and the answer comes
  // back as `"Tomas," he said.` — the verb attaches to the pronoun, the name sits inside the quote.
  // A whole conversation partner then lived eight turns of prose with no record, no voice card, no
  // memory bank and no edge, reconstructed from the chatlog each turn and forgetting everything
  // that scrolled out of it; meanwhile the bookkeeper, having no id to write to, filed his
  // relationship onto an unrelated knight. A quotation whose entire contents are one capitalised
  // word, followed by an attribution, is essentially never anything but a name — provided the
  // bare interjections are excluded, since "Yes," he said has the identical shape.
  const NOT_A_NAME = new Set(["yes","no","okay","ok","please","thanks","thank","sorry","what","why","who","how","where","when","stop","wait","enough","maybe","perhaps","nothing","everything","never","always","indeed","certainly","right","fine","good","well","hello","goodbye","sir","madam","lord","lady","majesty","father","mother","captain","aye","nay","now","here","there","again","both","none","done","gods","god"]);
  // A ONE-WORD ANSWER IS ONLY A NAME IF SOMEBODY ASKED FOR A NAME. The shape the rule below matches
  // — one capitalised word in quotes, then an attribution — is the shape of EVERY terse answer, not
  // just an introduction. The player asked `"What are you doing in her"` and got back
  // `"Hiding," it said.`, and the cast gained a person called Hiding. There is no blocklist that
  // ends: Waiting, Everlasting, Leaving, Listening all arrive the same way. So gate the rule on its
  // own premise. It exists for the exchange where a name was requested; require the request.
  const nameWasAsked = /\b(your name|his name|her name|their name|a name|the name|name\?|who are you|who is (?:he|she|it|that|this)|what (?:are|is) you called|what do (?:they|i|we) call you|call yourself|calls? (?:him|her|them)self|introduce (?:yourself|himself|herself|themselves)|do you have a name|got a name)\b/i
    .test(`${prose}\n${action}`);
  const found = new Map<string, string>();
  if (nameWasAsked) {
    // ...and the answer has to come out of a person. `"Hiding," it said` is a thing answering, not
    // somebody giving their name; nothing that reads as "it" ever introduces itself.
    const SPEAKER = "(?:he|she|they|the (?:man|woman|boy|girl|child|figure|other|stranger|older|younger)\\w*|[A-Z][a-z]+)";
    const intro = new RegExp(`["“]\\s*(${NAME})[,.!?]?\\s*["”]\\s*${SPEAKER}\\s*(?:[a-z']+\\s+){0,3}(?:${VERBS})\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = intro.exec(prose))) {
      const raw = m[1], key = raw.toLowerCase();
      if (known.has(key) || NOT_A_NAME.has(key) || INSTITUTION.test(key) || raw.includes("'")) continue;
      if (!isPersonName(raw)) continue;
      // LOWERCASE ELSEWHERE MEANS COMMON NOUN. `"Wife," she said quietly` is the exact shape of a
      // self-introduction, and the giveaway is that the same word appears in lower case a sentence
      // earlier — in the prose, or in what the player just typed ("You would be my wife"). A real
      // name never does. This is the general form of a blocklist that would otherwise never end.
      if (new RegExp(`\\b${raw.toLowerCase()}\\b`).test(`${prose} ${action}`.replace(new RegExp(`\\b${raw}\\b`, "g"), ""))) continue;
      found.set(key, raw);
    }
  }
  for (const re of [
    new RegExp(`\\b(${NAME})\\s+(?:${VERBS})\\b`, "g"),
    new RegExp(`\\b(?:${VERBS})\\s+(${NAME})\\b`, "g"),
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(prose))) {
      const raw = m[1], key = raw.toLowerCase();
      if (known.has(key) || NOT_A_NAME.has(key) || INSTITUTION.test(key)) continue;
      if (raw.includes("'")) continue;                       // "He'll", "That's" — never a name
      // THE SAME GATE THE INTRO PATH USES. isPersonName holds the COMMON_NOUN list — every pronoun,
      // every role, every abstraction people say out loud — and it was applied to the quoted
      // self-introduction and to nothing else, so the two paths that actually do most of the
      // detecting were running with no vocabulary check at all. `"Go away," She said` cleared every
      // remaining test and put a cast member called She in the story, repeatedly, in one save
      // alongside Wife, Dinner and Cost. One gate, on all three paths.
      if (!isPersonName(raw)) continue;
      // LOWERCASE ELSEWHERE MEANS COMMON NOUN — the same test the intro path uses, and for the same
      // reason. COMMON_NOUN is a list and lists end; this is the general form. `Everlasting said
      // nothing` and `Hiding said nothing` both survive every other check, and the giveaway is that
      // the identical word appears in lower case somewhere else in the turn, which a real name never
      // does. It costs the occasional character named Rose or Will, and a miss costs one uncredited
      // walk-on while a false positive costs a permanent fictional person with a voice card.
      if (new RegExp(`\\b${raw.toLowerCase()}\\b`).test(`${prose} ${action}`.replace(new RegExp(`\\b${raw}\\b`, "g"), ""))) continue;
      // Must also appear mid-sentence somewhere: a real person gets referred to, not just used to
      // open a sentence before a verb that happens to be in the list. A name directly after a
      // closing quote counts — `"You should go," Allison said` is the single most common way a
      // speaker is attributed in English, and requiring a lowercase letter before the name threw
      // every one of them away.
      const mid = new RegExp(`[a-z,;:]\\s+${raw}\\b`).test(prose)
        || new RegExp(`["”'\u2019][,.!?]?\\s+${raw}\\b`).test(prose);
      if (!mid) continue;
      found.set(key, raw);
    }
  }
  return [...found.values()].slice(0, 3);
}

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
  // AUTO-REGISTER SPEAKERS. The simulator is supposed to declare anyone new via new_characters and
  // often doesn't — a mother, a harper, a rider walks into the prose, speaks at length, and never
  // enters state. Registering them here doesn't make them important; it makes them CONSTRAINED, so
  // the voice pass can give them a period register and the knowledge gate can apply to what they
  // claim to know. They join non-central with no memories: a walk-on, but a real one.
  // FALLBACK ONLY. With a footer present the narrator has already declared the cast; running the
  // regex too means a title, a nickname, or a contraction can still slip in behind it. This now
  // fires only when the footer is missing entirely — truncation, or a model that ignored the spec.
  for (const nm of (footerSeen ? [] : unregisteredSpeakers(state, prose, action))) {
    if (findCharByName(state, nm)) continue;
    // KEEP WHAT THE PROSE SAID ABOUT THEM. The stub background ("nothing else is established")
    // was actively harmful: it produced a record that LOOKS complete, so nothing ever filled it in,
    // and a character the player had established as a machine ended up with empty traits, no
    // conscience, and a voice card that made her sound like any other person in the room. Carry
    // the sentences she actually appeared in, and mark the record provisional so the simulator
    // knows it is a sketch to be completed rather than a finished person.
    const around = prose
      .split(/(?<=[.!?])\s+/)
      .filter((sent) => new RegExp(`\\b${nm}\\b`).test(sent))
      .slice(0, 4)
      .join(" ")
      .slice(0, 400);
    const id = registerCharacter(state, {
      name: nm,
      central: false,
      location: state.world.player_location,
      provisional: true,
      background: around
        ? `INCOMPLETE RECORD — entered the story at ${state.world.current_time} without being declared. What the text established: ${around}`
        : `INCOMPLETE RECORD — entered the story at ${state.world.current_time}.`,
    } as any);
    if (id) {
      state.world.present.push(id);
      shifts.push(`${nm} entered the story unannounced and has been registered as a background figure.`);
      console.warn(`[cast] auto-registered unannounced speaker "${nm}" — the simulator did not declare them`);
    }
  }

  for (const np of diff.new_places ?? []) {
    if (!np?.name) continue;
    const exists = Object.values(state.world.places).some((p) => p.name.toLowerCase() === np.name.toLowerCase());
    if (!exists) {
      const id = uid("loc");
      state.world.places[id] = { id, name: np.name, description_facts: np.description_facts ?? "", contains: [] };
    }
  }

  // ── PLACES CHANGE ── A place's description_facts is what the narrator (and the offstage world-sim,
  // and the map) reads as CURRENTLY TRUE of that ground. Until now the only writer after creation was
  // the player editing it by hand in the World view: the simulator could bring a place into being and
  // never revise one. So a town the player levelled went on being described as lit, quiet, and walled
  // in every prompt for the rest of the game, and the engine kept asserting it. A place is state, and
  // state that only ever grows is a stage set.
  for (const pu of diff.places_update ?? []) {
    if (!pu?.place || !pu.description_facts?.trim()) continue;
    const key = String(pu.place).toLowerCase().trim();
    const place = state.world.places[pu.place]
      ?? Object.values(state.world.places).find((p) => p.name.toLowerCase().trim() === key);
    if (!place || place.id === "loc_offscene") continue;
    const before = place.description_facts ?? "";
    const next = pu.description_facts.trim().slice(0, 1200);
    if (next === before) continue;
    place.description_facts = next;
    if (pu.population && typeof pu.population.scale === "number") {
      place.population = { scale: Math.max(0, Math.round(pu.population.scale)), who: String(pu.population.who ?? "").slice(0, 200) };
    }
    place.changed_turn = turn;
    shifts.push(`${place.name} is not what it was${pu.note?.trim() ? ` — ${pu.note.trim()}` : ""}.`);
    console.info(`[places] ${place.name} rewritten at turn ${turn}${pu.note ? `: ${pu.note}` : ""}`);
  }

  // ── A KILLED PLACE IS EMPTY ── Population is what tells the narrator a place has people in it,
  // and it survived the people. So a town the player had just wiped out went on being described as
  // having two hundred stallholders and children underfoot, and the crowd directive cheerfully
  // repopulated a graveyard every turn. Mass harm empties the ground it happened on.
  {
    const here = state.world.places[state.world.player_location];
    const playerRe = new RegExp(`\\byou\\b|\\byour\\b`, "i");
    const playerProse = prose.split(/(?<=[.!?])\s+/).filter((x) => playerRe.test(x)).join(" ");
    if (here && MASS_HARM.test(`${action} ${playerProse}`) && (here.population?.scale ?? 1) !== 0) {
      here.population = { scale: 0, who: "" };
      here.changed_turn = turn;
      shifts.push(`${here.name} is empty of people now.`);
      console.info(`[places] ${here.name} depopulated at turn ${turn}`);
    }
  }

  // BACKSTOP. When the player has plainly remade or unmade the ground under them and the bookkeeper
  // did not revise it, the description must at least stop asserting the old truth. One dated line
  // appended is not a rewrite — it is the ledger declining to lie until the next pass rewrites it.
  {
    // WHAT THE PLAYER DID, NOT WHAT THEY SAID. Quoted speech is dialogue, not action — the engine
    // says so everywhere else and this did not honor it. A player sitting on the ground telling
    // someone "you walk around barefoot DESTROYING my ability to even think" tripped a destruction
    // check on a figure of speech inside dialogue.
    const deeds = action.replace(/["“][^"”]*["”]/g, " ");
    const TRANSFORM = /\b(destroy\w*|raze\w*|level(ed|led)?|flatten\w*|burn(ed|t)? (it|this|the|down)|unmake|unmade|erase\w*|obliterat\w*|annihilat\w*|demolish\w*|rebuil\w*|remake|remade|reshape\w*|rebuild\w*|drown\w*|flood\w*|freeze|froze|wipe(d)? out|revert\w*)\b/i;
    // ...and the verb needs something in the WORLD to have been done to, or "destroying my ability
    // to think" and "I could level this place" keep counting as demolition.
    const WORLD_OBJECT = /\b(town|city|village|place|house|home|building|hall|street|streets|walls?|gate|ground|land|everything|it all|quarter|district|market|estate|castle|keep|temple|church|bridge|fields?|forest)\b/i;
    const namesAPlace = Object.values(state.world.places).some(
      (p) => p.id !== "loc_offscene" && p.name.length >= 4 && deeds.toLowerCase().includes(p.name.toLowerCase()),
    );
    if (TRANSFORM.test(deeds) && (WORLD_OBJECT.test(deeds) || namesAPlace)) {
      const act = deeds.toLowerCase();
      const here = state.world.places[state.world.player_location];
      // WHICH GROUND. Scoping this to the player's own location missed the ordinary case: a player
      // standing on the riverbank who unmakes the town he built is not standing in the town. So
      // take every place the action NAMES, and fall back to where they are when it names none —
      // "I destroy the town" while inside it still has to land somewhere.
      const named = Object.values(state.world.places).filter(
        (p) => p.id !== "loc_offscene" && p.name.length >= 3 && act.includes(p.name.toLowerCase()),
      );
      const targets = named.length ? named : here ? [here] : [];
      const covered = new Set((diff.places_update ?? []).map((p) => String(p?.place ?? "").toLowerCase().trim()));
      for (const place of targets) {
        if (covered.has(place.id.toLowerCase()) || covered.has(place.name.toLowerCase().trim())) continue;
        // NOT `changed_turn === turn`: emptying a place of people also stamps that field, and a
        // massacre is exactly the case where the description most needs flagging as out of date.
        // Places the bookkeeper actually rewrote are already excluded by `covered` above; the stamp
        // below is what stops a second append on the same turn.
        // The note lives BESIDE the description, never inside it. Appending into description_facts
        // meant a place with no description yet ended up described entirely by the note — one
        // location's whole description was a quote of the player's own dialogue.
        const note = `Changed on turn ${turn} by: ${deeds.trim().slice(0, 120)} — the description predates that; render what the recent prose established.`;
        if (place.stale_note === note) continue;
        place.stale_note = note;
        place.changed_turn = turn;
        shifts.push(`${place.name} has been changed by what you did; its record is flagged as out of date.`);
      }
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
  //    "walking outside the dome"). present is DERIVED from co-location, never authored.
  //    DEPARTURE EVIDENCE GUARD (below): a character present when this turn began cannot be
  //    moved unless the turn's prose shows them leave — the bookkeeper is told to quote the
  //    departure in `said`; the engine verifies it. Offscreen moves are untouched. ──
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
      // DEPARTURE EVIDENCE GUARD. A character who was in the scene when this turn began cannot be
      // moved unless the turn's prose actually shows them leave. The bookkeeper is told to quote the
      // departure in `said`; the engine verifies it instead of trusting it. This is the bug that
      // emptied a scene in play: the ledger moved the entire speaking cast offscene while the prose
      // had them talking to the player, and the next turn the narrator faithfully rendered an empty
      // room. Offscreen moves (characters not present this turn) are untouched — the world moves
      // freely offstage.
      if (presentAtStart.has(cid)) {
        const c = state.characters[cid];
        const proseLow = prose.toLowerCase().replace(/\s+/g, " ");
        const saidRaw = String((mv as { said?: string }).said ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const quoted = saidRaw.length >= 8 && proseLow.includes(saidRaw);
        const nameLow = (c.name ?? "").toLowerCase();
        // probe tokens: the full name plus each usable word of it. Titles and ranks are skipped —
        // prose almost never repeats them ("Hale left", not "Mr. Hale left"), and a bare rank
        // ("the captain") is too common a noun to be evidence about anyone in particular.
        const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "doctor", "captain", "lt", "lieutenant", "commander", "sir", "madam", "professor", "officer", "ensign", "sergeant", "major", "colonel", "general", "lord", "lady", "father", "sister", "brother", "elder", "master"]);
        const tokens = nameLow.split(/\s+/).map((t) => t.replace(/[^a-z]/g, "")).filter((t) => t.length >= 3 && !HONORIFICS.has(t));
        const probes = [...new Set([nameLow, ...tokens])].filter((s) => s.length >= 3);
        let nearDeparture = false;
        for (const probe of probes) {
          let idx = proseLow.indexOf(probe);
          while (idx !== -1) {
            const w = proseLow.slice(Math.max(0, idx - 160), idx + probe.length + 160);
            if (/\b(left|leaves|leaving|exits?|exiting|departs?|departing|walks? out|walking out|strode out|hurried off|heads? off|headed off|dismissed|called away|slipped out|steps? out|stepping out|took the lift|made (his|her|xer|their) way out|was summoned|retreated|withdrew|withdrawn)\b/i.test(w)) { nearDeparture = true; break; }
            idx = proseLow.indexOf(probe, idx + 1);
          }
          if (nearDeparture) break;
        }
        if (!quoted && !nearDeparture) {
          shifts.push(`bookkeeping correction: ${c.name} stays — the prose never showed them leave`);
          continue;
        }
      }
      // ARRIVAL EVIDENCE GUARD — the mirror of the above, and the half that was missing.
      //
      // Nothing stopped the bookkeeper moving a character INTO the player's scene. That matters
      // because the narrator legitimately writes unnamed people — an innkeeper, a boatman, a
      // stallholder — and the bookkeeper, needing an id to hang their behavior on and having none,
      // reaches for the nearest real cast member. In one save that put a guard captain from a city
      // the player had flown away from behind the bar of an inn in another country, complete with
      // a new drive ("get the stranger to leave the inn without incident") and a fresh trait,
      // while the prose never mentioned her once. The player never brought her; the ledger did.
      //
      // Same evidence test as departures, in the other direction: a character not in the scene at
      // the start of the turn only enters it if the prose actually shows them here.
      if (!presentAtStart.has(cid) && pid === state.world.player_location) {
        const c = state.characters[cid];
        // THE GONE DO NOT WALK BACK IN. The guard below accepts a character's name appearing in the
        // prose as evidence they arrived, and a name in the prose is far more often somebody being
        // TALKED ABOUT — which is exactly what happens to a character right after they leave. So a
        // woman who had departed the story was carried back into the room by the ledger, on the
        // strength of the scene discussing her, and stood there teleported into a conversation she
        // was no longer part of. Coming back is a real event; it is `status`, not a stray mention.
        if (c.status === "dead" || c.status === "departed") {
          shifts.push(`bookkeeping correction: ${c.name} is ${c.status} and does not re-enter the scene`);
          console.warn(`[cast] blocked ${c.status} ${c.name} being moved back into the player's scene`);
          continue;
        }
        const proseLow = prose.toLowerCase().replace(/\s+/g, " ");
        const nameLow = (c.name ?? "").toLowerCase();
        const tokens = nameLow.split(/\s+/).map((t) => t.replace(/[^a-z]/g, "")).filter((t) => t.length >= 3);
        const named = [...new Set([nameLow, ...tokens])].some((p) => p.length >= 3 && proseLow.includes(p));
        // the player calling for them is evidence too — "I send for Angeline" should work
        const calledFor = [...new Set([nameLow, ...tokens])].some((p) => p.length >= 3 && action.toLowerCase().includes(p));
        if (!named && !calledFor) {
          shifts.push(`bookkeeping correction: ${c.name} was not in this scene — the prose never showed them arrive`);
          console.warn(`[cast] blocked phantom arrival of ${c.name} into ${state.world.places[pid]?.name ?? pid} — unnamed in prose and action`);
          continue;
        }
      }
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
  // AUTHORSHIP OUTRANKS THE FIRST READ. A card that already states the relationship — a spouse, a
  // lover, someone written as obsessed with this person — was authored with the bond in place, and
  // a stranger's beauty-and-taste read has no business overwriting it. Catches edges seeded before
  // this existed and edges whose person was authored into a partner long after they met.
  shifts.push(...repairAuthoredBonds(state));

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

  // ── DEPARTURE LOCK ── the same floor for people who left rather than died. Every rebuild of the
  // scene already filters them, which is precisely why the failure is invisible: any writer that
  // touches `present` or `contains` after the last rebuild leaves a departed character standing in
  // the room, and the narrator reads PRESENT as law. Cheaper to enforce the invariant once, last,
  // than to audit every future writer. Unlike death this is reversible — a character who comes back
  // has their status set back to active, and then this does nothing to them.
  for (const [cid, c] of Object.entries(state.characters)) {
    if (c.status !== "departed") continue;
    state.world.present = state.world.present.filter((p) => p !== cid);
    for (const p of Object.values(state.world.places)) p.contains = p.contains.filter((x) => x !== cid);
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
    if (!misattributionAllowed(state, id, prose, action)) continue;   // not in this scene, not named in it
    const c = state.condition[id]; if (!c) continue;
    c.psyche.relaxation = clamp(c.psyche.relaxation + clamp(p.relaxation_delta ?? 0, -6, 6), -10, 10);
    if (p.mood) c.psyche.mood = p.mood;
    for (const s of p.states_add ?? []) if (s && !c.psyche.active_states.includes(s)) { c.psyche.active_states.push(s); (c.psyche.state_ages ??= {})[s] = turn; }
    if (p.mood) c.psyche.mood_set_turn = turn;
    for (const s of p.states_remove ?? []) c.psyche.active_states = c.psyche.active_states.filter((x) => x !== s);
    if (c.psyche.active_states.length > 5) c.psyche.active_states = c.psyche.active_states.slice(-5);
    const d = clamp(p.relaxation_delta ?? 0, -6, 6);
    // A HARD HIT LOWERS THE RESTING POINT, NOT JUST TODAY'S NUMBER. Relaxation drifts back toward
    // capacity every turn, so without this a big negative delta is erased within a few turns by the
    // drift and the character is at ease again. One save had a woman ten turns past her husband
    // leaving and calling her a slut to his family, sitting at relaxation +0.87 and climbing toward
    // a capacity of +3, mood "grieving, hollow", valence +1 — stoic, because the ledger said fine.
    // The engine had discharge_lift for release and nothing at all for loss. See tickPsyche.
    if (d <= -3) {
      const drag = Math.min(6, (c.psyche.grief_drag ?? 0) + Math.abs(d) * 0.6);
      c.psyche.grief_drag = +drag.toFixed(3);
    }
    if (id !== "char_player" && Math.abs(d) >= 3) shifts.push(d > 0 ? `${nameOf(id)} relaxed a little.` : `${nameOf(id)} tensed up.`);
  }

  // Idle edges ease toward neutral before this turn's deltas land, so a relationship nobody has
  // tended for a while is no longer held up by a number set long ago.
  decayEdges(state.world.edges, turn);
  const explicitEdges = new Set((diff.edges ?? []).map((e) => `${resolveId(state, e.from)}|${resolveId(state, e.to)}`));
  for (const e of diff.edges ?? []) {
    const from = resolveId(state, e.from), to = resolveId(state, e.to);
    if (!from || !to || from === to) continue;
    applyEdgeDelta(state.world.edges, { from, to, warmth_delta: e.warmth_delta ?? 0, trust_delta: e.trust_delta ?? 0, power_delta: e.power_delta ?? 0, note: e.note, roles_set: e.roles_set }, turn, { chars: state.characters, traits: state.traits });
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
      applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: Math.round(w * 0.3), trust_delta: Math.round(tr * 0.25), power_delta: Math.round(-pw * 0.5) }, turn, { chars: state.characters, traits: state.traits });
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
    const stored = addFact(mem, g.content, turn, quoteOk ? fl.quote : undefined, state.world.present.includes(id) ? "witnessed" : "inferred");
    // CORRECTION: the simulator names what this overturns; the old belief is marked, not deleted.
    if (fl.corrects) {
      const gone = supersedeFact(mem, fl.corrects, g.content, turn);
      if (gone && id !== "char_player") shifts.push(`${nameOf(id)} was wrong about: ${gone}`);
    }
    if (stored && id !== "char_player") shifts.push(`${nameOf(id)} now knows: ${g.content}`);
  }
  for (const m of diff.memories ?? []) {
    const id = resolveId(state, m.char_id); if (!id || !m.content) continue;
    // A memory of a scene someone was never in is the most damaging misattribution of all: it
    // becomes what they "know", and every later turn reasons from it. This is how a wife left in
    // another country came to "now know" that a stranger in an inn was her husband.
    if (!misattributionAllowed(state, id, prose, action)) {
      console.warn(`[cast] blocked memory misattributed to absent ${nameOf(id)}: "${String(m.content).slice(0, 60)}"`);
      continue;
    }
    const mem = state.memory[id]; if (!mem) continue;
    // A memory is somebody's ACCOUNT of what happened, in one voice, not a clipping from the page.
    // See cleanMemoryContent: this is what stops the player's own typed words being filed as
    // another character's memory, and what keeps a person's memories from flipping between "I" and
    // "she" two turns apart.
    const cleaned = cleanMemoryContent(m.content, { name: nameOf(id), isPlayer: id === "char_player", playerAction: action });
    if (!cleaned) {
      console.warn(`[memory] dropped an unusable memory for ${nameOf(id)}: "${String(m.content).slice(0, 60)}"`);
      continue;
    }
    (m as any).content = cleaned;
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
    // MISATTRIBUTION GUARD. The narrator writes unnamed people constantly — an innkeeper, a
    // boatman, a stallholder — and the bookkeeper, needing an id to hang their wants on and having
    // none, reaches for a real cast member. That is how a guard captain who had never left another
    // country acquired the goal "get the stranger to leave the inn without incident". A want can
    // only be recorded for someone the scene actually contained or the prose actually named.
    if (!misattributionAllowed(state, id, prose, action)) {
      shifts.push(`bookkeeping correction: ${nameOf(id)} was not in this scene — a want from it was not recorded for them`);
      console.warn(`[cast] blocked drive misattributed to absent ${nameOf(id)}: "${String(du.goal).slice(0, 60)}"`);
      continue;
    }
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
    if (!misattributionAllowed(state, id, prose, action)) continue;   // a trait grown from a scene they were not in
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
  const filedPromises: { from: string; to: string; text: string }[] = [];
  for (const pn of diff.promises_new ?? []) {
    const from = resolveId(state, pn.from), to = resolveId(state, pn.to);
    if (from && to) { addPromise(state, from, to, pn.text, pn.weight, pn.due_time); filedPromises.push({ from, to, text: pn.text }); }
  }
  // ANSWERED-WANT CLOSURE: a filed promise that matches the recipient's active drive IS the answer
  // to that want — complete the drive deterministically so the want is never re-voiced, and let the
  // Simulator's drives_update assign the next concrete goal ("plan the evening").
  for (const line of completeDrivesForPromises(state, filedPromises)) shifts.push(line);
  // ── STANCES ── how characters answered real pressure this turn. Yielding against an active want
  // is a self-betrayal clench (taxed, counted, visible at 3+); refusals and counters are free,
  // restore the count, and mark the pair ruptured so repaired trust earns its bonus.
  const resolvedStances = (diff.stances ?? []).map((st) => {
    const charId = resolveId(state, st.character);
    const towardId = (st.toward ? resolveId(state, st.toward) : null) ?? "char_player";
    return charId ? { charId, towardId, stance: st.stance, about: st.about ?? "" } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x && !!x.about);
  for (const line of applyStances(state, resolvedStances, turn)) shifts.push(line);
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
    const existing = state.world.threads.find((t) => t.id === tu.id || String(t.title ?? "").toLowerCase() === tu.title.toLowerCase()
      // near-duplicate: same beat with a reworded title (subject + action overlap heavily)
      || (t.status === "active" && overlapRatio(String(t.title ?? ""), tu.title) >= 0.6));
    if (existing) {
      existing.status = tu.status;
      if (tu.description) existing.description = tu.description;
      // ESCALATION COSTS TIME, NOT TURNS. The +2/turn cap was the only brake, and turns are cheap —
      // fifty-five of them fit in one day, so a thread climbed to 8 over a single morning while the
      // faction clocks (which ARE time-gated) hadn't moved at all. A thread is a situation tightening
      // in the world; situations tighten over hours. Same gate as the clocks: at most +1 per
      // MINUTES_PER_ESCALATION of in-world time. Falling tension is never gated — things can calm
      // down as fast as the fiction says they do.
      if (typeof tu.tension === "number") {
        const cur = existing.tension ?? 3;
        if (tu.tension <= cur) {
          existing.tension = clamp(tu.tension, 0, 10);
        } else {
          const lastEsc = (existing as { last_escalated_time?: string }).last_escalated_time;
          const waited = lastEsc ? minutesBetween(lastEsc, state.world.current_time) : MINUTES_PER_ESCALATION;
          if (waited >= MINUTES_PER_ESCALATION) {
            existing.tension = clamp(Math.min(tu.tension, cur + 1), 0, 10);
            (existing as { last_escalated_time?: string }).last_escalated_time = state.world.current_time;
          } else {
            console.info(`[threads] "${existing.title}" held at ${cur} — ${Math.round(waited)}min since last escalation, needs ${MINUTES_PER_ESCALATION}`);
          }
        }
      }
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
      // ── KNOWLEDGE GATE ── a clock is a faction closing on an objective, and a faction cannot
      // close on an objective it knows nothing about. Pressure is how TENSE the scene is; it is
      // not information, and it used to be the only thing driving this. So: before a segment
      // fills, some living member of this faction must have witnessed the relevant thing or been
      // told it by someone who did, with the whole route recorded. Kill the witnesses and the
      // route genuinely does not exist — which is the correct outcome, not a bug to route around.
      const verdict = factionKnows(state, clock.faction, clock.objective);
      if (!verdict.knows) {
        console.warn(`[clocks] ${clock.faction} held at ${clock.filled}/${clock.segments} — ${verdict.gap}`);
        // A faction with no knowledge is not frozen, it's just doing something else. Rewriting the
        // objective is honest; firing the old one on a fiction is what produced armed men who
        // somehow knew about a stranger nobody had reported.
        if (clock.filled === 0 && state.world.current_turn - (clock.stalled_since ?? state.world.current_turn) > 12) {
          clock.objective = mundaneObjective(clock.faction);
          clock.status = "stalled";
          shifts.push(`${clock.faction} has nothing to act on and turns to its own business.`);
        }
        clock.stalled_since ??= state.world.current_turn;
        continue;
      }
      delete clock.stalled_since;
      clock.knowledge_chain = verdict.chain;   // inspectable: how this faction came to know

      // ── TIME GATE ── segments used to cost one TURN, not one hour, so eight quick exchanges in a
      // kitchen matured a warband's investigation to completion inside a single morning. Scheduled
      // events were already fixed to fire on the in-world calendar; clocks never were. A faction
      // needs real hours to send a rider, hear the answer and decide, so a segment now costs
      // MINUTES_PER_SEGMENT of in-world time since that clock last moved.
      const now = state.world.current_time;
      const last = (clock as { last_advanced_time?: string }).last_advanced_time;
      const waited = last ? minutesBetween(last, now) : MINUTES_PER_SEGMENT;
      if (waited < MINUTES_PER_SEGMENT) {
        console.info(`[clocks] ${clock.faction} held — ${Math.round(waited)}min since last segment, needs ${MINUTES_PER_SEGMENT}`);
        continue;
      }
      clock.filled = clamp(clock.filled + Math.min(1, ca.segments ?? 1), 0, clock.segments); // a clock ADVANCES — one segment per turn; a clock that leaps is a jump scare, not a clock
      (clock as { last_advanced_time?: string }).last_advanced_time = now;
      console.info(`[clocks] ${clock.faction} → ${clock.filled}/${clock.segments} via: ${verdict.chain.join(" → ")}`);
      // ── VISIBLE SIGNS ── the Forge writes these, the save stores them, and until now NOTHING read
      // them: a clock filled in total silence and then detonated its consequence with no foreshadow,
      // which is exactly why an arriving warband reads as invented rather than built. Surface one as
      // the clock crosses the halfway mark and again near the end.
      const frac = clock.filled / Math.max(1, clock.segments);
      const signs = clock.visible_signs ?? [];
      if (signs.length && (frac >= 0.5)) {
        const idx = Math.min(signs.length - 1, frac >= 0.85 ? signs.length - 1 : 0);
        shifts.push(`SIGN (${clock.faction}): ${signs[idx]}`);
      }
      shifts.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
    }
  }

  return shifts;
}
