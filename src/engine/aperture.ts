/**
 * THE APERTURE — how open the body is decides how wide the attention is.
 *
 * A player's report, on a save 28 turns in:
 *
 *   "Amber talks like a robot. She cannot accept casual light conversation. The goal and her drive
 *    become the entire conversation instead of just moving gently towards it — she has to explain a
 *    mortgage, she has to make things happen. There is zero flexibility. The environment doesn't
 *    affect her pattern. Her attention during the drive to the bank might draw towards a gym, she
 *    might talk about it while driving there. Telling me lot lines. Forcing me to look at things.
 *    It seems very clenched. If she were not relaxed at all, that she's narrowed in is understood —
 *    but she IS relaxed."
 *
 * Measured off that save, turns 12–28, one character:
 *
 *   relaxation +2.51, capacity 2, 28 consecutive settled turns, mood "relieved and tender"
 *   she has the last spoken word of the turn in            15 turns of 17   (88%)
 *   turns ending on her telling the player the next step    4 straight      (T25–T28)
 *   spoken lines about the deed / the money / the house    40 of 62         (65%, T21–T28)
 *   spoken lines touching any of her four standing interests  2 of 62       (3%)
 *
 * Her card carries trad climbing and old bolted routes, the correct ranking of cheap-diner
 * breakfasts, pour-over coffee and a contempt for pod machines, rotator cuffs and tendon load. The
 * world she is standing in contains a rock climbing gym — the one where she met him at nineteen.
 * She drives past it to the bank and recites an amortisation schedule.
 *
 * THE ENGINE ASKED FOR THIS, in three places, and none of them were wrong on their own:
 *
 *  1. deriveVoice has a band at r ≤ −7 and a band at r ≥ +6 and NOTHING BETWEEN THEM. The entire
 *     middle — where nearly every turn of nearly every save actually sits — gets no line about
 *     register at all. A body at +2.5 after 28 settled turns is told exactly what a body at −2 is
 *     told, which is nothing, so it speaks out of its card and only its card.
 *  2. voiceAnchor tells the narrator, every turn, that "their lines this turn come out of that
 *     vocabulary and that rhythm". That rule earned its place — it is what stopped five characters
 *     with superb distinct registers producing 318 interchangeable lines. But a register applied at
 *     a hundred percent is not a voice, it is a filter, and "money and materials only" run through
 *     a filter produces a woman who can only say what things cost.
 *  3. The want is on the card every turn, with an approach, a progress meter and a blocker, and
 *     nothing anywhere measures how long its owner has been talking about it. spent.ts catches a
 *     PROP said twice and monopolisedSubject catches a third party the room keeps circling; a
 *     character orbiting their OWN goal for eight turns is invisible to both.
 *
 * So: relaxation, which already decides how accurately a person SEES (perception gate), how an
 * emotion resolves (lifecycle), and whether a habit can be caught (the two roads), now also decides
 * how wide the attention is. That is the same claim those three make, in the channel they left out.
 * A clenched body narrows onto one thing and speaks in its most concentrated form — that is correct
 * and this module protects it. An open body is not doing that. Its attention is catchable by
 * whatever is in front of it, it says things that go nowhere, and its want moves by an inch and a
 * gesture rather than by an agenda read out loud.
 *
 * Nothing here forbids the want, bans the register, or requires a digression. Every line it emits
 * is permission plus a measured fact about what the last few turns actually did.
 */
import type { SaveState } from "./types";
import { isMannerism } from "./novelty";

/* ── BANDS ──────────────────────────────────────────────────────────────────── */

/** How wide this body's attention is. Named for what it does, not for how it feels. */
export type Aperture = "narrowed" | "working" | "wide";

/** Clenched at or below this, the attention is on the one thing. */
export const NARROW_AT = -4;
/** Settled at or above this, the attention is catchable by the room. Deliberately low: a resting
 *  point of +2 is ordinary, and the whole finding is that ordinary settled people have slack. */
export const WIDE_AT = 2;

export function apertureOf(relaxation: number): Aperture {
  if (relaxation <= NARROW_AT) return "narrowed";
  if (relaxation >= WIDE_AT) return "wide";
  return "working";
}

/* ── WHO SAID IT ────────────────────────────────────────────────────────────────
 *
 * speech.ts attributes a line by proximity — any cast first name inside a 90-character window. That
 * is right for the question it asks (did this person get a line at all) and wrong for this one, and
 * the save above shows exactly how: she says his name in half of what she says. "Sign the paper,
 * Vin." "Start the car, Vin." "Get in, Vin." Every one of those puts HIS name closer to the quote
 * than hers, so a window test hands her lines to him and reports her silent on the turn she does
 * most of the talking.
 *
 * Prose attributes by paragraph. The subject of the paragraph is the speaker, names inside the
 * quotation marks are people being spoken TO, and a paragraph with no name in it continues whoever
 * was talking. That is how the narrator writes and it is how this reads it.
 */
const QUOTE = /["“]([^"”\n]{2,})["”]/g;

function firstNameOf(name: string): string {
  return (String(name ?? "").trim().split(/\s+/)[0] ?? "").toLowerCase();
}

/** Every quoted line in the prose, keyed by the cast first name that said it. */
export function attributeLines(prose: string, names: string[]): Record<string, string[]> {
  const firsts = names.map(firstNameOf).filter((n) => n.length >= 3);
  if (!firsts.length) return {};
  const escaped = firsts.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const finder = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
  const out: Record<string, string[]> = {};
  let carry: string | null = null;
  for (const para of String(prose ?? "").split(/\n+/)) {
    const said = [...para.matchAll(QUOTE)].map((m) => m[1].trim()).filter(Boolean);
    const bare = para.replace(QUOTE, " ");          // vocatives live inside the quotes; drop them
    const named = finder.exec(bare)?.[1]?.toLowerCase() ?? null;
    if (!said.length) { if (named) carry = named; continue; }
    const who = named ?? carry;
    if (!who) continue;
    (out[who] ??= []).push(...said);
    carry = who;
  }
  return out;
}

/** The prose of the last `n` turns, oldest first. */
function recentProse(state: SaveState, n: number): string[] {
  return state.history.slice(-n).map((h) => String(h?.narrator_prose ?? "")).filter(Boolean);
}

/** What this character said, turn by turn, over the last `n` turns. */
function saidPerTurn(state: SaveState, id: string, n: number): string[][] {
  const first = firstNameOf(state.characters[id]?.name ?? "");
  if (!first) return [];
  const names = Object.values(state.characters).map((c) => c.name).filter(Boolean);
  return recentProse(state, n).map((p) => attributeLines(p, names)[first] ?? []);
}

/* ── STILL TALKING ABOUT IT ─────────────────────────────────────────────────── */

/** Turns in the window their speech has to be on their own want before it has become the only
 *  thing they can say. Three is a person pursuing something; four is a loop. */
export const SATURATED_AT = 3;
export const SATURATION_WINDOW = 4;
/** A turn counts as on-the-want if the speech carries at least one of its words — but the RUN only
 *  counts if at least this many DISTINCT want words showed up across it.
 *
 *  Both halves were needed and the first draft had only the second. A goal is one short sentence, so
 *  its distinctive vocabulary is thin — "keep the house and make him feel at home in it" gives you
 *  house, home, pay, back and nothing else — while the speech that orbits it is full of words the
 *  goal never contained: deed, escrow, PMI, the realtor's six, the recording fee. Requiring two
 *  distinct goal words in a single turn scored four consecutive turns about the house as one. And
 *  requiring only one, with no floor over the window, would fire on any character whose want happens
 *  to contain a word the room says anyway. So: sustained, and more than a single fluke word. */
const WANT_WORDS_PER_TURN = 1;
const DISTINCT_OVER_RUN = 2;

const STOP = new Set(("the a an and or of to in on at is was were be been being it its that this his her hers "
  + "she he they them their i me my mine you your yours we us our for with as so if not no yes what when "
  + "where which who how just very really about from into out up down over then than here there all any some "
  + "each every never ever still only even also again more most less without keep keeps make makes made let "
  + "lets get gets go goes come comes take takes give gives put puts feel feels felt want wants own owns "
  + "something anything nothing someone anyone thing things person people way ways one two next").split(" "));

/** The words in a phrase that actually name a subject. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of String(text ?? "").toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

/** What this character is after, as words: the goal, how they go at it, what is in the way. */
function wantWords(state: SaveState, id: string): Set<string> {
  const c = state.characters[id];
  if (!c) return new Set();
  const drv = c.drive;
  const text = [c.current_goal, drv?.goal, drv?.approach, drv?.blocker].filter(Boolean).join(" ");
  const words = contentWords(text);
  // Their own name and the names of everyone in the room are not the subject of the want. A goal
  // that says "make Vin feel at home" would otherwise score every line she addresses to him.
  for (const other of Object.values(state.characters)) {
    const f = firstNameOf(other.name ?? "");
    if (f) words.delete(f);
  }
  return words;
}

/** How many of the last turns running this character's speech has been about their own want.
 *  Zero when they have no want, said nothing, or talked about anything else. */
export function wantSaturation(state: SaveState, id: string): number {
  const want = wantWords(state, id);
  if (want.size < 2) return 0;
  const turns = saidPerTurn(state, id, SATURATION_WINDOW);
  let run = 0;
  let seen = new Set<string>();
  for (const lines of turns) {
    if (!lines.length) { run = 0; seen = new Set(); continue; }   // silence breaks the run, it does not score it
    const spoken = contentWords(lines.join(" "));
    const hits = [...want].filter((w) => spoken.has(w));
    if (hits.length >= WANT_WORDS_PER_TURN) { run++; hits.forEach((w) => seen.add(w)); }
    else { run = 0; seen = new Set(); }
  }
  return seen.size >= DISTINCT_OVER_RUN ? run : 0;
}

/* ── AND STILL RUNNING THE SCENE ────────────────────────────────────────────── */

/** Turns running one person may close the scene before it stops being a scene they are in and
 *  becomes a scene they are conducting. */
export const STEERING_AT = 3;
const STEERING_WINDOW = 5;

/** An instruction aimed at whoever is listening. Second person, present tense, no subject —
 *  or the first-person-plural version of the same thing, which is an instruction with a smile. */
const INSTRUCTION = new RegExp("^\\s*(?:okay|alright|right|now|so|and|then|well)?[,.\\s]*"
  + "(?:let'?s\\b|(?:sign|get|start|take|come|go|give|put|hold|look|tell|stay|wait|open|drive|move|read|"
  + "walk|sit|stand|eat|drink|call|bring|pick|leave|listen|watch|try|check|pay|hand|follow|meet|finish|"
  + "do|don'?t)\\b)", "i");

/** Tested per SENTENCE, not per line. "Half the payment, half the roof. Get in, Vin." and "You're on
 *  the deed. Now let's go get gas." are both somebody being told what to do next, and an anchored
 *  test on the whole line sees neither of them. */
export function isInstruction(line: string): boolean {
  return String(line ?? "").split(/(?<=[.!?…])\s+|\s+—\s+/).some((part) => INSTRUCTION.test(part));
}

/** Turns running this character has had the last spoken word AND used it to tell somebody what
 *  happens next. Either alone is ordinary; together, every turn, is a person running the scene. */
export function steeringStreak(state: SaveState, id: string): number {
  const first = firstNameOf(state.characters[id]?.name ?? "");
  if (!first) return 0;
  const names = Object.values(state.characters).map((c) => c.name).filter(Boolean);
  let run = 0;
  for (const prose of recentProse(state, STEERING_WINDOW)) {
    const all = [...prose.matchAll(QUOTE)].map((m) => m[1].trim()).filter(Boolean);
    const mine = attributeLines(prose, names)[first] ?? [];
    const closed = all.length > 0 && mine.length > 0 && all[all.length - 1] === mine[mine.length - 1];
    run = closed && mine.some(isInstruction) ? run + 1 : 0;
  }
  return run;
}

/* ── AND NEVER WANTS ANYTHING ───────────────────────────────────────────────────
 *
 * The two detectors above catch a person doing too much: still on their own want, still closing the
 * scene. Nothing catches the opposite, and the opposite is what a reader actually reports.
 *
 *   "No characterization, no personality, no uniqueness, no self desires, no questions about
 *    wanting something new on her own. No... nothing."
 *
 * Measured on that save — thirty-five turns, roughly a hundred and eighty spoken lines from one
 * character — five lines contain a first-person appetite of any kind. Turns 29 through 33 are five
 * consecutive turns and twenty-one spoken lines in which she never once says what she wants. Every
 * line is aimed at something the player said in the line immediately before: his invitation, his
 * money, his friends, his cardigan. She is not silent and she is not passive — she asks four
 * questions a turn — and that is exactly what makes it invisible to everything else here. An
 * interrogation is a very busy way of having no wants.
 *
 * AND THE APERTURE ITSELF WAS SILENT FOR HER. Run against that save at turn 34: aperture narrowed
 * (−5.6), want saturation 2, steering streak 0 — so the gate below skipped her, apertureNote
 * returned the empty string, and the one paragraph in this module written for a clenched body has
 * never once been reachable for a clenched body that is merely clenched. The band most of a tense
 * story sits in was the band with no line.
 *
 * This is not a demand that she soften. A narrowed body SHOULD narrow — that half of registerLine
 * is right and stays. What it was missing is whose one thing it narrows onto.
 *
 * TWO WAYS A TURN COUNTS AS HAVING AN INSIDE, because wanting is not the only one. Either the
 * person asks for something, or they put a subject on the table that is neither them nor the person
 * they are talking to — "the pour-over at that place on Quarry is the only one in this town anybody
 * warmed the filter for" is not an appetite and it is unmistakably a person with an interior. Both
 * are absent across the run measured above: every sentence she speaks contains either "you" or "I",
 * and nothing else exists for her. */

/** A line in which the speaker wants something, for themselves, out loud: an appetite, a demand, a
 *  refusal, a plan of their own. Not a question about the other person, which is what fills the gap
 *  when this is missing. */
const WANTS_SOMETHING = new RegExp("\\b(?:i\\s+want|i\\s+need|i\\s+wanna|i'?d\\s+(?:rather|like|prefer)|"
  + "i'?m\\s+(?:going\\s+to|gonna|not\\s+(?:going|doing|gonna))|i'?ll\\s+(?:have|take|be)|i\\s+get\\s+to|"
  + "give\\s+me|get\\s+me|bring\\s+me|buy\\s+me|hand\\s+me|pour\\s+me|let'?s\\b|"
  + "come\\s+here|sit\\s+down|take\\s+(?:it|that|them|those)\\s+off|"
  + "i\\s+(?:decided|already\\s+decided)|what\\s+i\\s+want)\\b", "i");

/** Turns of speech running in which this person has wanted nothing out loud. Silence does not
 *  count — a turn they said nothing in is not a turn they failed to want anything in. */
export const APPETITE_GAP = 4;
const APPETITE_WINDOW = 7;

/** A sentence about something that is neither the speaker nor the person they are speaking to: no
 *  "you", no "I". Short fragments and questions do not count — a question is what fills this space
 *  when there is nothing behind it. */
const SECOND = /\b(?:you|your|yours|you'?re|you'?ll|you'?d|you'?ve)\b/i;
const FIRST = /\b(?:i|i'?m|i'?ll|i'?d|i'?ve|me|my|mine|we|us|our)\b/i;

function raisesSomething(line: string): boolean {
  for (const raw of String(line ?? "").split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.split(/\s+/).filter(Boolean).length < 5 || s.endsWith("?")) continue;
    if (!SECOND.test(s) && !FIRST.test(s)) return true;
  }
  return false;
}

export function appetiteGap(state: SaveState, id: string): number {
  let run = 0;
  for (const lines of saidPerTurn(state, id, APPETITE_WINDOW)) {
    if (!lines.length) continue;                          // silence is not evidence either way
    const inside = lines.some((l) => WANTS_SOMETHING.test(l) || raisesSomething(l));
    run = inside ? 0 : run + 1;
  }
  return run;
}

/* ── WHAT ELSE IS IN THERE ──────────────────────────────────────────────────── */

/** A standing interest of this person's that the last few turns have not already used, plus a place
 *  in this world it could actually attach to. Subjects only — a tic is not something to think about. */
export function driftSubject(state: SaveState, id: string): { subject: string; place: string | null } | null {
  const c = state.characters[id];
  if (!c) return null;
  const subjects = [
    ...(c.texture ?? []).filter((t) => t && !isMannerism(t)),
    ...Object.keys(c.skills ?? {}),
  ].map((s) => String(s).trim()).filter(Boolean);
  if (!subjects.length) return null;

  // Prefer one the page has not just had. Same containment test novelty.ts uses, kept crude on
  // purpose: this only decides which of a person's own interests to offer, and a wrong pick costs
  // nothing but a slightly staler suggestion.
  // BY WORD, NOT BY SUBSTRING. The first draft asked whether the recent prose CONTAINED each word,
  // and "unfolded the envelope" contains "old", which retired "old bolted routes" — so the one
  // interest with a real place attached to it in this world dropped out of the rotation.
  const recent = contentWords(recentProse(state, 4).join(" "));
  const fresh = subjects.filter((s) => {
    const words = [...contentWords(s)];
    return !words.length || !words.some((w) => recent.has(w));
  });
  const pool = fresh.length ? fresh : subjects;
  // Deterministic rotation rather than a random pick — the same turn replayed gives the same world.
  const subject = pool[state.world.current_turn % pool.length];

  // Somewhere in this world the subject actually touches. Naming a place that exists is safe;
  // inventing one is the failure mode this engine spends most of its rules on.
  const words = [...contentWords(subject)];
  const here = state.world.player_location;
  let place: string | null = null;
  for (const p of Object.values(state.world.places ?? {})) {
    if (!p?.name || p.id === "loc_offscene") continue;
    const hay = `${p.name} ${p.description_facts ?? ""}`.toLowerCase();
    if (words.some((w) => w.length > 3 && hay.includes(w))) { place = p.id === here ? `${p.name} (where they are)` : p.name; break; }
  }
  return { subject, place };
}

/* ── THE NOTE ───────────────────────────────────────────────────────────────── */

/** This person's pronouns, from the field the whole engine treats as binding. A note that says
 *  "everything out of their mouth" about a woman whose card says she/her has drifted in the one
 *  place the narrator is told never to drift. Falls back to they/them, which is also what an
 *  unfilled field should read as. */
function pronounsOf(raw: string | undefined): { subject: string; object: string; possessive: string } {
  const parts = String(raw ?? "").toLowerCase().split(/[/,\s]+/).map((x) => x.trim()).filter(Boolean);
  const subject = parts[0] || "they";
  const object = parts[1] || (subject === "they" ? "them" : subject);
  const possessive = parts[2] || (subject === "she" ? "her" : subject === "he" ? "his" : subject === "they" ? "their" : `${object}s`);
  return { subject, object, possessive };
}

/** The register line for a body at this openness. The card is the same in all three; what changes
 *  is how much of it is load-bearing. */
function registerLine(name: string, ap: Aperture, rel: number, openRun: number, pn: { subject: string; possessive: string }): string {
  if (ap === "narrowed") {
    return `${name} is tense and guarded (${rel.toFixed(1)}). Right now their character card describes them exactly: the way they talk narrows down to its tightest form, `
      + `their attention fixes on one thing and stays there, and very little else gets through. `
      + `That's normal for someone who is tense. `
      + `What does need checking is whose concern it is. Someone who is braced narrows in on what they themselves are after: what they're protecting, what they can't stop wanting, or what they're afraid of losing. `
      + `If they focus on the other person's subject instead, by answering it, pushing on it or picking it apart, it looks as though they have no concerns of their own.`;
  }
  if (ap === "wide") {
    const settled = openRun >= 6 ? ` and has been settled for ${openRun} turns` : "";
    return `${name}'s body is relaxed and open (${rel.toFixed(1)})${settled}. When someone is this relaxed, their voice card gives them their words, but it doesn't decide what they talk about. `
      + `The way of talking on that card is how this person sounds under stress, when they're braced or defending something, and right now ${pn.subject} isn't doing that. `
      + `So the words still come from ${pn.possessive} own life and ${pn.possessive} own vocabulary, but the manner loosens up: something said for no reason, a side comment that goes nowhere, `
      + `a question answered straight with no agenda, a joke told just because it's funny, or a sentence that doesn't lead anywhere. `
      + `Relaxed people wander off the subject a lot, and most of what people say when they're comfortable together is beside the point.`;
  }
  return `${name} is neither tense nor loose (${rel.toFixed(1)}), so mostly focused on the task, but with some give in it. `
    + `${pn.possessive.charAt(0).toUpperCase()}${pn.possessive.slice(1)} usual way of talking holds, but one thing ${pn.subject} says this turn breaks from it.`;
}

/**
 * Everything the aperture has to say about the people in this room, this turn. Silent for anybody
 * whose state and last few turns are unremarkable — a settled person who has been talking about
 * four different things is working correctly and needs no line.
 */
export function apertureNote(state: SaveState, presentIds: string[]): string {
  const turn = state.world.current_turn;
  const ids = presentIds
    // Tracked counts too: the engine pays upkeep on a tracked character every turn, and the same
    // confusion between "background" and "not tracked" is what left a woman on a dinner date with
    // no card, no register and no line here. See the promotion loop in turn.ts.
    .filter((id) => id !== "char_player" && state.characters[id]
      && (state.characters[id].central !== false || state.characters[id].tracked))
    .slice(0, 3);
  if (!ids.length) return "";

  const blocks: string[] = [];
  for (const id of ids) {
    const c = state.characters[id];
    const psy = state.condition[id]?.psyche;
    if (!c || !psy) continue;
    const rel = psy.relaxation ?? 0;
    const pn = pronounsOf(c.pronouns);
    const ap = apertureOf(rel);
    const sat = wantSaturation(state, id);
    const steer = steeringStreak(state, id);
    const gap = appetiteGap(state, id);
    // Only an open body earns a line for its state alone — the whole finding is that the open state
    // was reaching nothing. A braced or middling body doing exactly what it should is not a finding,
    // and gets a line only when one of the three detectors has actually caught something. The third
    // is why a clenched body can reach its own paragraph now: it was written and never rendered.
    if (ap !== "wide" && sat < SATURATED_AT && steer < STEERING_AT && gap < APPETITE_GAP) continue;

    const lines: string[] = [registerLine(c.name, ap, rel, psy.open_run ?? 0, pn)];

    if (sat >= SATURATED_AT) {
      const want = c.current_goal || c.drive?.goal || "the one thing";
      const own = (c.texture ?? []).filter((t) => !isMannerism(t)).slice(0, 3);
      lines.push(`For ${sat} turns in a row, everything ${c.name} has said has been about the same thing: "${want.trim().replace(/\s+/g, " ")}". `
        + `The want has already been said and heard, and saying it again doesn't move it forward. `
        + `This turn it moves forward through one thing ${pn.subject} does with ${pn.possessive} hands, like making an arrangement, putting a hand on something, taking a step, or buying, carrying or putting away some small thing, `
        + `while what ${pn.subject} talks about is something else entirely.${own.length ? ` ${pn.subject[0].toUpperCase()}${pn.subject.slice(1)} has this on ${pn.possessive} card and hasn't used it yet: ${own.join("; ")}.` : ""} `
        + `Nobody gets walked through something they didn't ask about, shown a document, or made to look at anything. `
        + `People usually move toward what they want while talking about something else, so don't have them narrate the want.`);
    }

    if (steer >= STEERING_AT) {
      lines.push(`The last ${steer} turns all ended with ${c.name} having the last word and using it to tell the player what happens next. `
        + `Don't have them read out a schedule, and don't let one person keep ending the scene. `
        + `This turn ${c.name} doesn't hand out the next step. Either somebody else has the last word, or the turn ends on ${c.name} without anything being asked of anyone, `
        + `such as something done, something noticed, or something said that doesn't need an answer.`);
    }

    if (gap >= APPETITE_GAP) {
      // Their own standing business, in their own words, so the note is not asking the narrator to
      // invent an appetite — it is pointing at the ones already on the card and never used.
      const own = [
        c.current_goal?.trim(),
        c.drive?.goal?.trim(),
        ...(c.authored ?? []).map((a) => String(a?.goal ?? "").trim()),
        ...(c.texture ?? []).filter((t) => !isMannerism(t)).map((t) => String(t).trim()),
        ...Object.keys(c.skills ?? {}),
      ].filter(Boolean).slice(0, 5);
      lines.push(`${c.name} has spoken for ${gap} turns in a row without once saying what ${pn.subject} wants, or bringing up anything that isn't about ${pn.object} or the person ${pn.subject} is talking to. `
        + `Every line has been a response to something the player said first, whether answering it, questioning it or picking it apart. `
        + `Someone who only ever responds seems to have no inner life, however many questions ${pn.subject} asks. `
        + `This turn ${c.name} wants something out loud, and it doesn't come from the player's last line. It's something ${pn.subject} asks for, takes, refuses, decides, or brings up that nobody else mentioned, like an appetite, an errand, a complaint, or a plan for the evening that is ${pn.possessive} own and not an answer to somebody else's. `
        + `It doesn't have to be big, and ${pn.subject} doesn't have to get it.${own.length ? ` This is what ${pn.subject} already has on ${pn.possessive} card and hasn't used yet: ${own.join("; ")}.` : ""}`);
    }

    if (ap === "wide") {
      const drift = driftSubject(state, id);
      if (drift) {
        lines.push(`${c.name}'s attention can be caught this turn by: ${drift.subject}.`
          + `${drift.place ? ` This world has ${drift.place} in it. It's real, it's there, and ${pn.subject} knows it is.` : ""} `
          + `If anything in this place, on the way, or in what somebody just said touches on that, ${pn.subject} notices it out loud, and it doesn't have to lead anywhere. `
          + `The remark can just end, with the scene carrying on around it. Treat this as room to say something: `
          + `if the moment has no room for it, ${pn.subject} doesn't notice anything and doesn't say anything, and that's fine too. `
          + `What isn't fine is a person whose surroundings could be swapped for any others without changing a word they say.`);
      }
    }
    blocks.push(`· ${lines.join(" ")}`);
  }
  if (!blocks.length) return "";
  return `\n\n=== HOW NARROW OR WIDE EACH PERSON'S ATTENTION IS (turn ${turn}) ===\n${blocks.join("\n")}`;
}

/* ── I ALREADY KNOW ─────────────────────────────────────────────────────────── */

/**
 * The player saying they already have it, and being given it anyway.
 *
 *   T26  Amber: "Now let's go get gas. I'll explain the mortgage to you at the pump."
 *   T27  player: "I'm a grownup Amber... I understand how a mortgage works hah"
 *   T27  Amber: "Principal, interest, escrow." Her finger moved down the page, tapping each line.
 *                "Eleven eighty-two. That's what the house costs every month. I put twenty percent
 *                down, so there's no PMI, and the rate's fixed, so it doesn't jump."
 *
 * This one does not need measuring after the fact, because the evidence arrives in the player's own
 * typed line before the turn is written. It fires on that.
 */
const KNOWS_ALREADY = new RegExp("\\b(i know how|i know what|i know that|i already know|i understand how|i understand what|"
  + "i get it|i get how|i know\\b[^.?!]{0,12}\\balready|you (?:already )?told me|you said that already|"
  + "i'?m a grown(?:up| man| woman| adult)|no need to explain|don'?t need (?:it )?explain|"
  + "you don'?t (?:have to|need to) explain|i can read|i've seen it|i have seen it)\\b", "i");

export function heardYouNote(action: string): string {
  if (!KNOWS_ALREADY.test(String(action ?? ""))) return "";
  return `\n\n=== THE PLAYER SAID THEY ALREADY KNOW ===\nWhat the player said this turn makes it clear they already have this: they know how it works, they've been told, or they can read it for themselves. `
    + `Nobody explains it to them, whether at length, in a shorter version, as a quick recap "just so it's clear", or by walking them through the document while saying they don't have to look. `
    + `When someone they trust says "I know how that works", a person says some short version of okay and moves on, and whatever they say next is about something else. `
    + `A character can still want the thing, still be nervous about it, and still touch it, hand it over or get it signed. What they can't do is give the player the explanation the player just turned down. `
    + `If the character really can't let it go, that's a feeling about being believed, and it comes out as one line about themselves, never as the explanation again.`;
}
