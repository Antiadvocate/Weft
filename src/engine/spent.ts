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
 * Half of this is the character working correctly. Her voice agenda is "to steer any conversation
 * off the closed door and back to something she can point at", her tics are "swerves to the physical
 * environment when pressed" and "asks about logistics to stop a personal question", and the player
 * asked what was wrong three turns running. She is supposed to deflect. What she is not supposed to
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
      const capitalised = /^[A-Z][a-z]{2,}$/.test(w);
      const proper = capitalised && (i > 0 || !OPENERS.has(lower));
      const uncommon = w.length >= 7 && /^[A-Za-z]+$/.test(w) && !OPENERS.has(lower);
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
