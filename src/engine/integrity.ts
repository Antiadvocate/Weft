/**
 * INTEGRITY — the aggregate nobody was keeping.
 *
 * WHAT SIX SAVES OF ONE WORLD LOOK LIKE FROM ABOVE. 208 turns. A love story became a municipal
 * procedural, then a nine-turn argument about a plate of eggs, then a stalking thriller, then a
 * scene in which two women crossed two thousand miles in fifty-five minutes and the ledger swapped
 * which of them was in the room. Fifteen separate defects, every one of them real and most of them
 * now fixed one at a time.
 *
 * And in all 208 turns, across five chapter audits, the component whose entire job is to say "this
 * is no longer the story that was asked for" returned `on_contract: true` every single time.
 * `contract_drift` is null in all six saves. It has never once fired.
 *
 * THAT is why fixing the defects one at a time does not hold, and why a player who has done exactly
 * that on a previous game arrives back at the same nightmare on the next one. There is no closed
 * loop. Each detector in this engine — echo, maxims, leak, ooc, retold, anatomy, kinship, reprint —
 * catches its own failure, emits one correction into the next turn's prompt, and forgets. Nothing
 * counts them. Nothing asks whether six of them fired this week. So a story can come apart steadily,
 * with the engine noticing every individual crack and no part of it noticing the wall.
 *
 * The auditor cannot supply that, for a reason worth writing down: it reads the BOOKKEEPER'S SCENE
 * SUMMARIES. Those are the laundered record — the place where "Mara confronted Rabi ... telling him
 * that Emily had spent the night at her sister Priya's because the kid was sick" is stored as a
 * plain account of what happened. Fed that, an auditor sees a coherent domestic drama and certifies
 * it, correctly, on the evidence it was given. It is checking the story against the contract while
 * reading a transcript that the failures already rewrote.
 *
 * So the aggregate is kept here instead, deterministically, from the detectors that fire on the raw
 * output before anything launders it, plus the engine's own bookkeeping refusals — which are the
 * strongest signal in the system, because they are the moments the engine caught itself.
 *
 * This costs nothing and decides nothing. It counts, and when the rate crosses a line it tells the
 * PLAYER, because the player is the only party in this loop who can actually call it — reload, redirect,
 * rewrite a want, or stop. Every prior fix in this file's neighbourhood tries to make the engine
 * behave; this one exists to make sure the player finds out when it has not.
 */
import type { SaveState } from "./types";

/** One caught failure. `kind` groups them; `detail` is for the player, not for a model. */
export interface IntegrityFire {
  turn: number;
  kind: string;
  detail: string;
}

/** How the kinds read in a sentence to somebody who has not read this source file. */
const LABEL: Record<string, string> = {
  anatomy: "a body written against the record",
  kin: "a family invented for somebody",
  reprint: "a turn that reprinted the one before it",
  line: "a line of dialogue used twice",
  leak: "someone's private interior stated outright",
  echo: "the player's own words handed back to them",
  maxim: "dialogue that named nothing in the room",
  retold: "a scene restaged rather than continued",
  arrival: "somebody placed where they could not have got to",
  phantom: "somebody moved into the scene the prose never showed arriving",
  swap: "the cast list disagreeing with the prose",
  invention: "a person or place the prose invented and the player struck",
  pov: "the player written from outside instead of addressed as you",
};

/** Turns the rolling window looks back over. */
const WINDOW = 8;
/** Distinct failures inside the window before the player is told. */
const ALARM = 3;
/** Turns of quiet before it will speak again, so a rough patch is reported once. */
const COOLDOWN = 10;

/** Record a caught failure. Cheap, append-only, trimmed. */
export function noteFire(state: SaveState, kind: string, detail: string): void {
  const turn = state.world?.current_turn ?? 0;
  const log = (state.integrity ??= { fires: [] });
  log.fires.push({ turn, kind, detail: String(detail ?? "").slice(0, 160) });
  if (log.fires.length > 60) log.fires = log.fires.slice(-60);
}

/**
 * Is the story coming apart, and has the player been told recently?
 *
 * Distinct KINDS, not raw count: the same detector firing three turns running is one problem being
 * corrected, which is the system working. Three different ones inside eight turns is the record and
 * the prose drifting apart faster than the corrections can close them.
 */
export function integrityAlarm(state: SaveState): string | null {
  const log = state.integrity;
  if (!log?.fires.length) return null;
  const turn = state.world?.current_turn ?? 0;
  const recent = log.fires.filter((f) => turn - f.turn < WINDOW);
  const kinds = [...new Set(recent.map((f) => f.kind))];
  if (kinds.length < ALARM) return null;
  if (log.said_turn !== undefined && turn - log.said_turn < COOLDOWN) return null;
  log.said_turn = turn;
  const named = kinds.map((k) => LABEL[k] ?? k);
  return `CONTINUITY: ${kinds.length} different kinds of contradiction caught in the last ${WINDOW} turns — ${named.join("; ")}. `
    + `Each one has been corrected for the next turn, but this many at once usually means the record and the prose have come apart, `
    + `and corrections work turn to turn rather than backwards. If the story stopped making sense a few turns ago, that is where it happened, `
    + `and rolling back to before it is cheaper than playing forward through it.`;
}

/** Everything caught, newest first — for the Chronicle and the inspector. */
export function integrityLog(state: SaveState, limit = 20): IntegrityFire[] {
  return [...(state.integrity?.fires ?? [])].reverse().slice(0, limit);
}

/**
 * THE PLAYER STOPPED BEING "YOU".
 *
 * A save switched narrator model at turn 16 and nothing else. Counted over its prose, third-person
 * references to the player run 0 or 1 a turn for fifteen turns and then jump to fifteen in one:
 *
 *   T15  "...your palm moves. Her shoulders drop..."
 *   T16  "Her eyes stay on HIM... presses the length of her against HIS hand"
 *   T17  "MAX'S HAND kept its slow rhythm over her cock through the leggings"
 *
 * The player went from the person in the room to a man being described from across it, and the
 * prose went from present tense to past along with it. The cause was a rule in the narrator prompt
 * reading "the narration never addresses the reader as 'you'" — meant against breaking frame, read
 * as a ban on the second person, which is the mode this whole engine narrates in. The weaker model
 * had been ignoring it. The stronger one obeyed.
 *
 * That rule is fixed, and this catches the next one, from any model: the check is cheap, the
 * failure is silent, and a save can be twenty turns deep in it before anybody puts a name to what
 * changed.
 *
 * Dialogue is stripped first — people say each other's names out loud constantly, and "You're the
 * one who gets mean when he's hungry, Max" is a line, not a POV slip. Pronouns are only counted
 * when nobody else present shares the player's set, because "his" in a room with two men attributes
 * to nothing.
 */
export function povDrift(
  prose: string,
  playerFirstName: string,
  playerPronouns?: string,
  othersPronouns: (string | undefined)[] = [],
): { third: number; second: number } | null {
  const narration = String(prose ?? "")
    .replace(/[""][^""]*[""]/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\s+/g, " ");
  if (narration.split(" ").length < 25) return null;      // too short to read a mode off
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const second = (narration.match(/\b(you|your|yours|you're|youre)\b/gi) ?? []).length;

  let third = 0;
  const first = (playerFirstName ?? "").split(/\s+/)[0] ?? "";
  if (first.length >= 3) third += (narration.match(new RegExp(`\\b${esc(first)}('s)?\\b`, "g")) ?? []).length;

  // third-person pronouns count only when they can belong to nobody else in the room
  const fam = (p?: string) => /\bhe\b|\bhim\b|\bhis\b/i.test(p ?? "") ? "m" : /\bshe\b|\bher\b/i.test(p ?? "") ? "f" : "";
  const mine = fam(playerPronouns);
  if (mine && !othersPronouns.some((o) => fam(o) === mine)) {
    const re = mine === "m" ? /\b(he|him|his)\b/gi : /\b(she|her|hers)\b/gi;
    third += (narration.match(re) ?? []).length;
  }
  // One stray name is somebody being talked about. A turn that names the player repeatedly while
  // barely saying "you" has stopped narrating to them.
  if (third >= 3 && third > second) return { third, second };
  return null;
}

/** The correction for the next turn. Every other fault the engine catches feeds one of these into
 *  the prompt; a log that nobody reads corrects nothing. Written as the operation rather than as a
 *  rule about narration, since a rule about keeping the person is the sentence that already failed. */
export function povFix(hit: { third: number; second: number } | null | undefined): string {
  if (!hit) return "";
  return `\nLAST TURN WROTE THE PLAYER FROM OUTSIDE. Their name or a he/she stood where "you" belongs, ${hit.third} times, against ${hit.second} second-person words in the whole turn. The player is the person this story is told TO. In narration and in interior alike they are addressed in the second person; their own name and any third-person pronoun belong to other people and never to them. This holds hardest when they are ALONE, which is where it broke: a scene with nobody else in it is still their scene and is still addressed to them, and a solo turn written about a man at a desk has quietly changed who is being spoken to. Other characters stay in the third person as always. Write this turn to them.`;
}

/**
 * THE PLAYER SAID IT DOES NOT EXIST, AND THE ENGINE WROTE THAT DOWN AS A SYMPTOM.
 *
 * From a save at turn 81. The narrator introduced a manager called Marcus on turn 71 and a
 * receptionist called Mrs. Gable on turn 78 — neither registered as a character, neither in any
 * place, neither anywhere in the world bible. The bookkeeper then ledgered them, because the gate
 * on a fact asks whether its specifics are traceable to THIS TURN'S PROSE, and the prose is exactly
 * where they were invented. Joe's bank, under KNOWS (verified facts):
 *
 *   "Mrs. Gable at the front desk told Amber that receptionists should wear closed shoes and that
 *    front desk staff share impressions with Marcus."
 *
 * On turn 80 the player typed that Mrs. Gable does not exist and that they had never been to any
 * lobby. What the engine recorded:
 *
 *   Joe:   "I told Amber that Mrs. Gable does not exist, but Amber stared at me like I had lost
 *           my mind."
 *   Amber: "I worried that Joe might be losing his mind when Joe insisted Mrs. Gable does not
 *           exist and that we never saw her at the front desk."
 *   Amber (fact): "Joe claims Mrs. Gable does not exist and that they have not visited any lobby."
 *
 * The correction became evidence that the player is unreliable, and the invention kept its place in
 * the ledger. NARRATOR_SYSTEM already says what should happen — "If the player challenges something
 * you wrote as impossible or as wrongly defaulted, they are almost certainly right: do not defend
 * it, do not build lore to justify it. Drop it, and continue as though it was never said" — and the
 * engine has the machinery for it in `retcons`, reachable only by striking text by hand in the UI.
 * A player saying it in play reached none of it.
 *
 * Deliberately narrow. It reads the PLAYER'S OWN TYPED WORDS and nothing else, it fires only on a
 * flat denial of an entity that is NAMED, and it never touches a name the world actually holds — a
 * player shouting that Amber does not exist is playing, not filing a bug.
 */
const DENIAL: RegExp[] = [
  /\b([\w'’-]+\.?(?:\s+[\w'’-]+\.?){0,3})\s+(?:does\s?n[o']?t|do\s?n[o']?t|did\s?n[o']?t)\s+exist\b/gi,
  /\bthere\s+(?:is|was|are|were)\s+no\s+([\w'’-]+\.?(?:\s+[\w'’-]+\.?){0,3})/gi,
  /\b([\w'’-]+\.?(?:\s+[\w'’-]+\.?){0,3})\s+(?:is|was)\s?n[o']?t\s+real\b/gi,
  /\b(?:we|i|you)\s+never\s+(?:went\s+to|met|saw|spoke\s+to|visited)\s+(?:a\s+|an\s+|any\s+|the\s+)?([\w'’-]+\.?(?:\s+[\w'’-]+\.?){0,3})/gi,
  /\byou\s+(?:made\s+up|invented|hallucinated)\s+(?:a\s+|an\s+|the\s+)?([\w'’-]+\.?(?:\s+[\w'’-]+\.?){0,3})/gi,
];
/** Words that begin a sentence and are not what is being denied. */
const NOT_A_NAME = new Set(["I", "We", "You", "He", "She", "They", "It", "That", "This", "There", "The", "A", "An", "And", "But", "So", "No", "Nobody", "Nothing", "Never", "Why", "What", "Who", "Where", "When", "How", "Ok", "Okay", "Yes", "Yeah", "Well", "Look", "Listen", "Wait", "Stop",
  // contractions of a pronoun read as capitalised words and are never somebody's name
  "I'm", "I've", "I'll", "I'd", "I’m", "I’ve", "I’ll", "I’d", "We're", "We've", "You're", "You've", "They're", "It's", "That's", "There's"]);

/** Entities the player's own words have just declared nonexistent, minus anything the world holds. */
export function deniedEntities(action: string, known: Iterable<string>): string[] {
  const text = String(action ?? "");
  if (!text.trim()) return [];
  const real = new Set([...known].map((k) => String(k ?? "").toLowerCase().trim()).filter(Boolean));
  const out = new Set<string>();
  for (const re of DENIAL) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const raw = (m[1] ?? "").trim().replace(/[,;:!?'"]+$/, "");
      if (!raw) continue;
      // A NAME IS CAPITALISED and the words around it are not, so the capital is checked here
      // rather than in the pattern — requiring it inside the pattern made the pattern itself
      // case-sensitive, and "We never met Marcus" and "You made up Mrs. Gable" are how people
      // actually type, sentence-initial. Trim uncapitalised words off both ends: what is left is
      // the name, and "the store. Denise" yields Denise rather than nothing.
      // The LAST unbroken run of capitalised words is the name. Trimming from the outside in was
      // not enough: "I told Amber that Mrs. Gable does not exist" starts capitalised and yielded
      // "Amber that Mrs. Gable". A lowercase word between two capitals ends the name.
      const all = raw.split(/\s+/);
      const words: string[] = [];
      for (let i = all.length - 1; i >= 0 && /^[A-Z]/.test(all[i]); i--) words.unshift(all[i]);
      if (!words.length) continue;
      const trimmed = words.join(" ").replace(/\.$/, (d, i, str) => (/\b(Mr|Mrs|Ms|Dr|St|Prof)$/.test(str.slice(0, -1)) ? d : ""));
      if (NOT_A_NAME.has(words[0])) continue;
      if (real.has(trimmed.toLowerCase())) continue;
      if ([...real].some((r) => r.split(/\s+/).includes(trimmed.toLowerCase()))) continue;
      out.add(trimmed);
      continue;
      // A name the world actually holds is never struck on a line of dialogue. The player denying
      // their own sister is a scene; the engine does not delete her over it.
      if (real.has(raw.toLowerCase())) continue;
      if ([...real].some((r) => r.split(/\s+/).includes(raw.toLowerCase()))) continue;
      out.add(raw);
    }
  }
  return [...out];
}

/**
 * Strike a denied entity out of the world: veto it for the narrator, and take it out of the banks
 * it had already been written into. A retcon the narrator obeys while the ledger still says the
 * thing is true produces a character who "remembers" it and a player who is told he is confused.
 */
export function strikeEntity(state: SaveState, name: string): { facts: number; memories: number } {
  const turn = state.world?.current_turn ?? 0;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  let facts = 0, memories = 0;
  for (const mem of Object.values(state.memory ?? {})) {
    if (Array.isArray(mem.facts)) {
      const before = mem.facts.length;
      mem.facts = mem.facts.filter((f) => !re.test(String(f?.content ?? "")));
      facts += before - mem.facts.length;
    }
    if (Array.isArray(mem.episodic)) {
      const before = mem.episodic.length;
      mem.episodic = mem.episodic.filter((m) => !re.test(`${m?.content ?? ""} ${m?.full_content ?? ""}`));
      memories += before - mem.episodic.length;
    }
    if (Array.isArray(mem.beliefs)) mem.beliefs = mem.beliefs.filter((b) => !re.test(String(b?.content ?? "")));
  }
  state.world.rumors = (state.world.rumors ?? []).filter((r) => !re.test(String(r?.content ?? "")));
  state.world.threads = (state.world.threads ?? []).filter((t) => !re.test(`${t?.title ?? ""} ${t?.description ?? ""}`));
  const text = `${name} does not exist and never did. Nothing involving ${name} happened. Never write ${name} again, and never have anyone refer to, remember, or account for ${name}.`;
  state.retcons = [...(state.retcons ?? []).filter((r) => r.text !== text), { text, turn, kind: "veto" as const }].slice(-12);
  return { facts, memories };
}
