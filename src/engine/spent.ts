/**
 * SPENT SUBJECTS — a prop a scene has already used does not get used again.
 *
 * From a save, turns 14, 15 and 16, one character answering three different questions:
 *
 *   "Elena keeps redesigning the same logo because the client can't decide if burgundy is 'too
 *    aggressive,' and Marcus is having some kind of feud with the new intern about who gets to
 *    order the flatstock."
 *   "Flatstock… It's—paper stock. For posters. Marcus wants to order the—"
 *   "Work is fine. Elena's still fighting over the burgundy. Marcus is still fighting over the
 *    flatstock."
 *
 * Half of this is the character working correctly. She was steering the conversation off the closed
 * door and back to something she could point at, and the player asked what was wrong three turns
 * running. She is supposed to deflect. What she is not supposed to
 * do is deflect with the identical anecdote every time, and nothing in the engine knew she had
 * already spent it — the narrator simply reached for the nearest prop, which was the one it had
 * invented two turns ago and could still see in the recent prose.
 *
 * So: the subjects a scene has actually put in someone's mouth are recorded, and a subject that has
 * been on the page in consecutive turns is handed back to the narrator as spent. This does not tell
 * anybody to stop deflecting. It tells them to reach further into a life they were given four
 * paragraphs of background for.
 *
 * WHAT COUNTS AS A SUBJECT, and this is the whole difficulty. Suppressing ordinary words would kill
 * continuity — a conversation about work should be able to say "work" twice. What repeats
 * unbearably is the DISTINCTIVE prop: the invented proper noun, the odd piece of trade vocabulary,
 * the specific colour. So only distinctive tokens are tracked (a name, or a long uncommon word), and the cast's own names and the world's place names are excluded — a scene must always
 * be able to say who is in it and where.
 *
 * Dialogue only. Narration repeating a detail is description; a character repeating it is a broken
 * record, and it is the second one the player hears.
 */
import type { SaveState } from "./types";

/** How many of the last turns a subject must appear in before it counts as spent. */
const SPENT_AT = 2;
/** How far back the window reaches. */
const WINDOW = 3;
/** Turns a spent subject stays out of play before it may be picked up again. */
const REST = 4;

/** Words long enough to be distinctive that are still too ordinary to be a prop. */
const ORDINARY = new Set([
  "nothing", "something", "anything", "everything", "someone", "anyone", "everyone", "nobody",
  "because", "through", "another", "without", "already", "probably", "actually", "honestly",
  "tonight", "tomorrow", "yesterday", "morning", "evening", "weekend", "minutes", "moment",
  "thinking", "talking", "telling", "looking", "getting", "waiting", "walking", "wanting",
  "supposed", "remember", "understand", "important", "different", "whatever", "sometimes",
  "together", "yourself", "myself", "himself", "herself", "themselves", "everybody", "somebody",
]);

/** Quoted speech only — what a character actually said. */
function spokenText(prose: string): string {
  return [...String(prose ?? "").matchAll(/["“]([^"”\n]{1,400})["”]/g)].map((m) => m[1]).join(" ");
}

/** Words that routinely OPEN a spoken sentence, so being capitalised there means grammar rather
 *  than a name. Without this the first word of every line of dialogue reads as a proper noun. */
const OPENERS = new Set([
  "well", "yeah", "okay", "look", "listen", "maybe", "sure", "just", "only", "some", "same",
  "that", "this", "they", "them", "then", "there", "these", "those", "what", "when", "where",
  "which", "while", "with", "your", "you", "yours", "have", "here", "how", "come", "could",
  "does", "done", "even", "every", "give", "going", "make", "more", "much", "must", "never",
  "next", "nice", "right", "should", "still", "than", "thing", "think", "time", "very", "want",
  "were", "will", "would", "also", "about", "after", "again", "because", "been", "before",
  "work", "people", "things", "life", "love", "please", "thanks", "sorry", "fine", "good",
]);

/** Ordinary words that turn up capitalised at the head of a spoken line. A name is never one of
 *  these; "Three", "Tell", "Sleep" and "Work" all are, and all four were being filed as props. */
const COMMON_OPENER = /^(?:three|four|five|six|seven|eight|nine|ten|tell|told|sleep|slept|work|know|knew|said|says|stop|wait|help|hold|keep|leave|left|call|called|talk|talked|show|showed|turn|turned|open|close|move|moved|find|found|feel|felt|hear|heard|read|write|wrote|walk|walked|sit|stand|took|take|give|gave|made|make|okay|fine|sure|yeah|dont|cant|wont|didnt|isnt|thats|theres|maybe|please|sorry|thanks|listen|honestly|anyway|besides|whatever|exactly|really|actually|obviously|clearly|literally|apparently)$/;

/**
 * The distinctive props in a run of dialogue.
 *
 * Two ways in: a CAPITALISED word (a name, a brand — the things a narrator invents to furnish a
 * scene), and a LONG word (the trade vocabulary: "flatstock", "burgundy"). Everything else is how
 * people talk.
 *
 * Sentence position was originally used to tell a name from a grammatical capital, and it threw
 * away the two props the whole mechanism exists for: the save's dialogue opens one line on "Elena"
 * and another on "Flatstock", both at index 0, both skipped, so the loop went right on undetected.
 * Position is the wrong signal — a name is just as much a name at the start of a sentence. What
 * actually distinguishes them is the WORD, so a capital at index 0 is read as a name unless it is
 * one of the ordinary openers, and length is checked independently of case.
 */
export function distinctiveProps(text: string, exclude: Set<string>): string[] {
  const out = new Set<string>();
  const sentences = String(text ?? "").split(/(?<=[.!?—])\s+|\n+/);
  for (const sent of sentences) {
    const words = sent.trim().split(/\s+/);
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "").replace(/'s$/, "");
      if (w.length < 4) return;
      const lower = w.toLowerCase();
      if (exclude.has(lower) || ORDINARY.has(lower)) return;
      // WHAT THE SAVE SHOWED THIS CATCHING INSTEAD OF PROPS: "three", "tell", "exactly", "sleep",
      // "leaving", "married", "happened". Two leaks. A capital at the head of a line of dialogue is
      // grammar unless the word is a name, and OPENERS could never list every ordinary word somebody
      // starts a sentence with — so a sentence-initial capital now needs the word to be genuinely
      // uncommon as well, since a real name ("Elena", "Marcus") passes that and "Three" does not.
      // And seven letters is not rare: "leaving" and "married" are seven. Eight, and never a plain
      // -ing or -ed form, which is a verb rather than a thing anybody could reach for twice.
      const capitalised = /^[A-Z][a-z]{2,}$/.test(w);
      const wordish = /^[A-Za-z]+$/.test(w) && !OPENERS.has(lower);
      const inflected = /(?:ing|ed|ly)$/.test(lower);
      const proper = capitalised && wordish && (i > 0 || (w.length >= 4 && !COMMON_OPENER.test(lower)));
      const uncommon = !capitalised && w.length >= 8 && wordish && !inflected;
      if (proper || uncommon) out.add(lower);
    });
  }
  return [...out];
}

/** Names the story must always be free to say: the cast, and the places they stand in. */
function neverSpent(state: SaveState): Set<string> {
  const s = new Set<string>();
  const add = (v: unknown) => String(v ?? "").toLowerCase().split(/[^a-z']+/).forEach((w) => w.length > 2 && s.add(w));
  for (const c of Object.values(state.characters ?? {})) { add(c?.name); (c?.aliases ?? []).forEach(add); }
  for (const p of Object.values(state.world?.places ?? {})) add((p as { name?: string })?.name);
  add(state.world_bible?.name);
  return s;
}

/**
 * Record what the dialogue in this turn's prose put on the page. Called after the prose exists, next
 * to recordExpressions, and for the same reason: it measures what the scene actually did.
 */
export function recordSpokenSubjects(state: SaveState, prose: string, turn: number): void {
  const said = spokenText(prose);
  if (!said.trim()) return;
  const props = distinctiveProps(said, neverSpent(state));
  const list = (state.spent_subjects ??= []);
  for (const w of props) {
    const row = list.find((r) => r.word === w);
    if (row) { if (!row.turns.includes(turn)) row.turns.push(turn); }
    else list.push({ word: w, turns: [turn] });
  }
  // forget anything nobody has said in a long while, so this never grows without bound
  const floor = turn - (WINDOW + REST) * 2;
  state.spent_subjects = list
    .map((r) => ({ ...r, turns: r.turns.filter((t) => t > floor) }))
    .filter((r) => r.turns.length);
}

/** The subjects this turn should not reach for again. */
export function spentSubjects(state: SaveState): string[] {
  const turn = state.world?.current_turn ?? 0;
  return (state.spent_subjects ?? [])
    .filter((r) => {
      const recent = r.turns.filter((t) => t > turn - WINDOW - 1);
      if (recent.length < SPENT_AT) return false;
      // it comes back once it has actually been left alone for a while
      return turn - Math.max(...r.turns) < REST;
    })
    .map((r) => r.word);
}

/** The narrator-facing line. Behavioral direction, no counts and no mechanic — same discipline as
 *  habits and novelty: a verdict the narrator can act on, never a rule it could start performing. */
export function spentSubjectsNote(state: SaveState): string {
  const spent = spentSubjects(state).slice(0, 8);
  if (spent.length < 2) return "";
  return `\n\n=== ALREADY SPENT ===\nThese have been in someone's mouth in consecutive scenes and are used up: ${spent.join(", ")}. `
    + `Nobody raises them again this turn. This is NOT an instruction to change what anybody wants or how they behave — `
    + `a character who deflects still deflects, a character who talks shop still talks shop. It is the PROP that is spent, not the move. `
    + `Reach into the rest of the life on their card — their background, their standing interests, the trade they actually have, `
    + `the thing they were doing before this scene started — and deflect with something new. A person with one anecdote is a person `
    + `the player has finished meeting.`;
}

/* ── THE MONOPOLISED SUBJECT ────────────────────────────────────────────────────
 *
 * Everything above tracks PROPS and deliberately exempts the cast, on the reasoning that a scene
 * must always be free to say who is standing in it. That reasoning is right and it aimed the whole
 * mechanism away from the thing the player was actually complaining about:
 *
 *     "She never talks about anything other than Chloe. Repeating the things she's already told me."
 *
 * Chloe is a cast member, so the prop tracker was constitutionally incapable of noticing — while it
 * filled up with "three", "tell", "exactly" and "sleep". Naming somebody is not the failure. Having
 * ONE SUBJECT is: a person whose every scene is about the same third party has stopped being a
 * person and become a topic with legs, which is the same defect the card spec warns about for
 * walk-ons ("a farmer who only ever says raiders took my son").
 *
 * So this is measured separately and says something different. The prop rule says "that thing is
 * used up, find another". This one says "you have made this person into a single subject, and they
 * have a whole life on their card" — and it never suppresses the NAME, because the answer to a
 * monopolised subject is not silence about Chloe, it is the character having something else.
 */

/** Turns in the window a name must dominate before it has become the character's only subject. */
const MONOPOLY_IN = 3;
const MONOPOLY_WINDOW = 4;
/** Times it must be said in a turn to count as that turn's subject rather than a passing mention. */
const MENTIONS_PER_TURN = 2;

/** A third party the recent dialogue keeps circling, excluding whoever is actually in the room. */
export function monopolisedSubject(
  recentProse: string[], castNames: string[], presentNames: string[],
): string | null {
  const here = new Set(presentNames.map((n) => n.toLowerCase()));
  const counts = new Map<string, number>();
  for (const prose of recentProse.slice(-MONOPOLY_WINDOW)) {
    const said = spokenText(prose).toLowerCase();
    if (!said.trim()) continue;
    for (const raw of castNames) {
      const n = raw.trim(); if (!n) continue;
      const first = (n.split(/\s+/)[0] || n).toLowerCase();
      if (here.has(n.toLowerCase()) || here.has(first)) continue;      // present: they are the scene
      const hits = (said.match(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
      if (hits >= MENTIONS_PER_TURN) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  for (const [name, turns] of counts) if (turns >= MONOPOLY_IN) return name;
  return null;
}

/** The narrator-facing line. Never suppresses the name — the fix for one subject is another
 *  subject, not a gag order. */
export function monopolyNote(subject: string | null, speaker: string | null): string {
  if (!subject) return "";
  const who = speaker ? speaker : "the people in this scene";
  return `\n\n=== ONE SUBJECT ===\n${who} has talked about ${subject} in most of the last several scenes, and about very little else. `
    + `That is not a person any more, it is a topic with legs — the same failure a walk-on has when they only ever say the one thing. `
    + `${subject} is NOT forbidden and must not be conspicuously avoided: if ${subject} comes up, they come up. `
    + `What has to change is that this character wants, notices, and raises something ELSE this turn — from their own background, their trade, `
    + `the standing interests on their card, their own body, the room, the day they actually had. Give them one subject that is theirs and not about ${subject}, `
    + `and let them bring it up unprompted the way people do.`;
}

/* ── TELLING SOMEBODY WHAT THEY ALREADY KNOW ────────────────────────────────────
 *
 * "Repeating the things she's already told me." That is the half of the complaint that turned out
 * to be measurable, and the half that was NOT is worth recording so nobody chases it again: over an
 * 83-turn save the name "Chloe" is actually spoken in 21 turns, twice or more in only two of them,
 * with a longest run of four. The monopoly detector above finds nothing there, correctly. Frequency
 * was never the thing. RE-DELIVERY was:
 *
 *   T12  said : "I don't know who else made the cut. I only got the email this morning."
 *        known: Miranda only received the fellowship shortlist email this morning and does not yet
 *               know who else made the cut.
 *
 * A perfect overlap with a fact already sitting in the player's own store. The scene reads as new
 * and contains nothing, and eleven lines in that save do it.
 *
 * The rules against this exist — "nothing restated: no already-answered question was re-asked, no
 * answered want voiced again unchanged" — and they live inside the narrator's FINAL CHECK, which is
 * a self-audit. This engine has learned repeatedly what a self-audit is worth.
 */

/** Overlap at or above this is the same information, not two people using some of the same words. */
const RETOLD_AT = 0.7;

const RETOLD_STOP = new Set(("the a an and or but of to in on at is was were be been being it its that this "
  + "his her hers she he they them their i me my mine you your yours we us our for with as so if not no yes "
  + "what when where which who how just very really about from into out up down over then than").split(" "));

function contentTokens(s: string): Set<string> {
  return new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !RETOLD_STOP.has(w)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * A spoken line from this turn that re-delivers something the player already holds.
 *
 * Reads the PLAYER's own store — the facts and memories the engine says they have — because that is
 * the only record of what they have actually been told. Returns the offending line so the correction
 * can quote it, which is the only safe way to name a banned move (see maxims.ts, echo.ts).
 */
export function retoldToPlayer(state: SaveState, prose: string): { line: string; known: string } | null {
  const mem = state.memory?.["char_player"];
  if (!mem) return null;
  const known: string[] = [
    ...(mem.facts ?? []).map((f) => (typeof f === "string" ? f : (f as { content?: string }).content ?? "")),
    ...(mem.episodic ?? []).map((m) => m.content ?? ""),
  ].filter((k) => k.length > 20);
  if (!known.length) return null;

  for (const line of [...String(prose ?? "").matchAll(/["“]([^"”\n]{20,400})["”]/g)].map((m) => m[1])) {
    const lt = contentTokens(line);
    if (lt.size < 5) continue;                       // too short to be a re-delivery of anything
    for (const k of known) {
      if (overlap(lt, contentTokens(k)) >= RETOLD_AT) return { line: line.slice(0, 160), known: k.slice(0, 160) };
    }
  }
  return null;
}

/** The correction, handed to the next turn, quoting what was actually said. */
export function retoldNote(hit: { line: string; known: string } | null | undefined): string {
  if (!hit) return "";
  return `\n\n=== ALREADY TOLD ===\nLast turn somebody said this to the player: "${hit.line}"\n`
    + `The player already had it — their own record holds: "${hit.known}"\n`
    + `A line that delivers what the listener already knows is a line in which nothing happened, and it is why a scene can read as busy and land as nothing. `
    + `People do not brief each other on shared history; they ASSUME it and go on from there. `
    + `Whatever this character wants out of this beat, they get at it from the far side of what has already been said — `
    + `the next thing, the part they left out, the thing they want NOW — or they say nothing and do something instead.`;
}
