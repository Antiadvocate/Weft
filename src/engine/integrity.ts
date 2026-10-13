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
import type { ActionRead } from "./actionread";
import { collapseSpaces, hasWords, trimEndOf } from "./text";

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
  player_voice: "a line put in your mouth that you never typed",
  held: "you said you were leaving and the scene kept you there",
  nuked: "a storyline you wiped, brought back by the narration",
  narrated_back: "people describing what you're doing back to you",
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
  return `CONTINUITY: ${kinds.length} different kinds of contradiction were caught in the last ${WINDOW} turns: ${named.join("; ")}. `
    + `Each one has been corrected for the next turn, but this many at once usually means the record and the prose have drifted apart, `
    + `and corrections only work going forward, from one turn to the next. If the story stopped making sense a few turns ago, that's where it went wrong, `
    + `and going back to before that point is easier than playing on through it.`;
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
/** People in the narration who have no name and share the player's pronouns. Not "king" or
 *  "queen": a ruler player is "the king" to everyone, and narration calling them that is the slip. */
const UNNAMED_MEN = /\b(?:man|men|guard|guards|lord|lords|boy|boys|father|son|brother|husband|priest|priests|soldier|soldiers|page|elder|councill?or|councill?ors|clerk|clerks|serjeant|sergeant|monk|knight|knights|gentleman|gentlemen|merchant|captain|officer|doctor|driver|waiter|barman|innkeeper|bartender|stranger|old man|young man)\b/i;
const UNNAMED_WOMEN = /\b(?:woman|women|girl|girls|lady|ladies|mother|daughter|sister|wife|maid|maids|nun|widow|waitress|barmaid|nurse|stranger|old woman|young woman)\b/i;

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
  // ...and nobody UNNAMED either. Kingdom of Veythar, turns 16 to 25: a throne room full of guards
  // and council lords, none of them on the cast list, every "his" and "he" in the narration theirs,
  // and the check reported the king written in the third person 29 times in a turn that called him
  // "you" throughout, then fed that to the narrator as a correction, every turn, for ten turns.
  const unnamedSameSet = mine === "m" ? UNNAMED_MEN.test(narration) : mine === "f" ? UNNAMED_WOMEN.test(narration) : false;
  if (mine && !unnamedSameSet && !othersPronouns.some((o) => fam(o) === mine)) {
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
  return `\nLAST TURN DESCRIBED THE PLAYER FROM THE OUTSIDE. Their name or "he" or "she" appeared where "you" belongs ${hit.third} times, against ${hit.second} second-person words in the whole turn. The player is the person this story is told to. In the narration and in their inner thoughts alike, they're addressed as "you". Their own name and any third-person pronoun belong to other people, never to them. This matters most when they're alone, which is where it went wrong: a scene with nobody else in it is still their scene and is still addressed to them, and a turn written about "a man at a desk" has quietly changed who is being spoken to. Other characters stay in the third person as usual. Write this turn to the player.`;
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
 * Deliberately narrow. It reads the PLAYER'S OWN TYPED WORDS and nothing else, as the turn read has
 * them (`denies_exist`, actionread.ts): five patterns for the shapes a denial takes used to sit
 * here, with a list of sentence-openers that weren't names, and a capital-letter rule bolted on after
 * "I told Amber that Mrs. Gable does not exist" came back as "Amber that Mrs. Gable". It strikes
 * only something NAMED, which still means capitalised, because a strike deletes every record the
 * name appears in and "the lobby" would take every memory of a lobby with it. And it never touches
 * a name the world actually holds — a player shouting that Amber does not exist is playing, not
 * filing a bug.
 */

const TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "prof"]);

/** Entities the player's own words have just declared nonexistent, minus anything the world holds. */
export function deniedEntities(read: ActionRead, known: Iterable<string>): string[] {
  const denied = Array.isArray(read?.denies_exist) ? read.denies_exist : [];
  if (!denied.length) return [];
  const real = new Set([...known].map((k) => String(k ?? "").toLowerCase().trim()).filter(Boolean));
  const out = new Set<string>();
  for (const said of denied) {
    let name = trimEndOf(collapseSpaces(said), ",;:!?'\"");
    // a closing full stop is the sentence's, unless it ends a title ("Mrs.")
    if (name.endsWith(".") && !TITLES.has(name.slice(0, -1).split(" ").pop()!.toLowerCase())) name = name.slice(0, -1);
    // a lowercase first letter is a common noun ("the lobby"); a capital, or a script without case, is a name
    const first = name[0] ?? "";
    if (!name || first !== first.toUpperCase()) continue;
    // A name the world actually holds is never struck on a line of dialogue. The player denying
    // their own sister is a scene; the engine does not delete her over it.
    const low = name.toLowerCase();
    if (real.has(low)) continue;
    if ([...real].some((r) => collapseSpaces(r).split(" ").includes(low))) continue;
    out.add(name);
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
  const mentions = (text: string) => hasWords(text, name);
  let facts = 0, memories = 0;
  for (const mem of Object.values(state.memory ?? {})) {
    if (Array.isArray(mem.facts)) {
      const before = mem.facts.length;
      mem.facts = mem.facts.filter((f) => !mentions(String(f?.content ?? "")));
      facts += before - mem.facts.length;
    }
    if (Array.isArray(mem.episodic)) {
      const before = mem.episodic.length;
      mem.episodic = mem.episodic.filter((m) => !mentions(`${m?.content ?? ""} ${m?.full_content ?? ""}`));
      memories += before - mem.episodic.length;
    }
    if (Array.isArray(mem.beliefs)) mem.beliefs = mem.beliefs.filter((b) => !mentions(String(b?.content ?? "")));
  }
  state.world.rumors = (state.world.rumors ?? []).filter((r) => !mentions(String(r?.content ?? "")));
  state.world.threads = (state.world.threads ?? []).filter((t) => !mentions(`${t?.title ?? ""} ${t?.description ?? ""}`));
  const text = `${name} doesn't exist and never did, and nothing involving ${name} happened. Never write about ${name} again, and never have anyone mention, remember or explain ${name}.`;
  state.retcons = [...(state.retcons ?? []).filter((r) => r.text !== text), { text, turn, kind: "veto" as const }].slice(-12);
  return { facts, memories };
}
