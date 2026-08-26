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
    return `${name} is clenched (${rel.toFixed(1)}). The card is exact right now: the register tightens onto its narrowest form, `
      + `the attention goes to the one thing that matters and stays there, and very little else gets in. That is not a fault to correct — `
      + `it is what a braced body does, and it is what makes the other state mean anything.`;
  }
  if (ap === "wide") {
    const settled = openRun >= 6 ? ` and has been settled for ${openRun} turns` : "";
    return `${name}'s body is open (${rel.toFixed(1)})${settled}. AT THIS OPENNESS THE VOICE CARD IS WHERE THE WORDS COME FROM, NOT A RULE EVERY LINE OBEYS. `
      + `The register on that card is the shape this person takes UNDER LOAD — braced, defending something, doing business. ${pn.subject.charAt(0).toUpperCase()}${pn.subject.slice(1)} is not doing that. `
      + `So the words still come out of ${pn.possessive} own life and ${pn.possessive} own vocabulary, but the signature loosens: something said for no reason, an aside that goes nowhere, `
      + `a question answered straight with no angle on it, a joke that is not also a move, a sentence that does not end in what happens next. `
      + `An open person can afford to be off-topic, and being off-topic is most of what people who are comfortable with each other actually say.`;
  }
  return `${name} is neither braced nor loose (${rel.toFixed(1)}) — mostly on task, with slack in it. `
    + `${pn.possessive.charAt(0).toUpperCase()}${pn.possessive.slice(1)} register holds, and one thing ${pn.subject} says this turn lands outside it.`;
}

/**
 * Everything the aperture has to say about the people in this room, this turn. Silent for anybody
 * whose state and last few turns are unremarkable — a settled person who has been talking about
 * four different things is working correctly and needs no line.
 */
export function apertureNote(state: SaveState, presentIds: string[]): string {
  const turn = state.world.current_turn;
  const ids = presentIds
    .filter((id) => id !== "char_player" && state.characters[id] && state.characters[id].central !== false)
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
    // Only an open body earns a line for its state alone — the whole finding is that the open state
    // was reaching nothing. A braced or middling body doing exactly what it should is not a finding,
    // and gets a line only when one of the two detectors has actually caught something.
    if (ap !== "wide" && sat < SATURATED_AT && steer < STEERING_AT) continue;

    const lines: string[] = [registerLine(c.name, ap, rel, psy.open_run ?? 0, pn)];

    if (sat >= SATURATED_AT) {
      const want = c.current_goal || c.drive?.goal || "the one thing";
      const own = (c.texture ?? []).filter((t) => !isMannerism(t)).slice(0, 3);
      lines.push(`${c.name} has had ${sat} turns running in which everything out of ${pn.possessive} mouth was about the same thing: "${want.trim().replace(/\s+/g, " ")}". `
        + `The want is not in question and does not need saying again — it has been said, the other person heard it, and the meter does not move because it was restated. `
        + `THIS TURN IT MOVES BY ONE THING ${pn.subject.toUpperCase()} DOES, NOT BY ANYTHING ${pn.subject.toUpperCase()} EXPLAINS: an arrangement made, a hand on something, a step taken, a small thing paid for or carried or put where it goes — `
        + `and ${pn.possessive} talking is somewhere else entirely.${own.length ? ` ${pn.subject[0].toUpperCase()}${pn.subject.slice(1)} has this on ${pn.possessive} card and has not used it: ${own.join("; ")}.` : ""} `
        + `Nobody is walked through a thing they did not ask about, shown a document, or made to look at anything. `
        + `A person moving toward what they want while talking about something else is the ordinary case; a person narrating their want is the failure.`);
    }

    if (steer >= STEERING_AT) {
      lines.push(`The last ${steer} turns all ended with ${c.name} having the final word and using it to tell the player what happens next. `
        + `A want is not a schedule read out loud, and a scene one person keeps closing is a scene nobody else is in. `
        + `THIS TURN ${c.name.toUpperCase()} DOES NOT HAND OVER THE NEXT STEP. Either somebody else has the last word, or the turn ends on ${c.name} with nothing asked of anybody — `
        + `a thing done, a thing noticed, a thing said that requires no answer.`);
    }

    if (ap === "wide") {
      const drift = driftSubject(state, id);
      if (drift) {
        lines.push(`${c.name}'s attention is CATCHABLE this turn by: ${drift.subject}.`
          + `${drift.place ? ` This world has ${drift.place} in it — it is real, it is there, and ${pn.subject} knows it is.` : ""} `
          + `If anything in this place, on the way, or in what somebody just said touches that, ${pn.subject} notices it out loud, and IT DOES NOT HAVE TO LEAD ANYWHERE — `
          + `not back to what ${pn.subject} wants, not into the scene, not into a point. This is permission, not a line to deliver: `
          + `if the moment has no room for it, ${pn.subject} notices nothing and says nothing, and that is also correct. `
          + `What is not correct is a person whose surroundings could be swapped for any other surroundings without changing a word they say.`);
      }
    }
    blocks.push(`· ${lines.join(" ")}`);
  }
  if (!blocks.length) return "";
  return `\n\n=== HOW WIDE THE ATTENTION IS (turn ${turn}) ===\n${blocks.join("\n")}`;
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
  return `\n\n=== THE PLAYER SAID THEY ALREADY KNOW ===\nThe player's line this turn states that they already have this — they know how it works, they have been told, they can read it themselves. `
    + `NOBODY EXPLAINS IT TO THEM. Not at length, not in a shortened version, not as a quick recap "just so it's clear", and not by walking them through the document while saying they don't have to look. `
    + `Somebody who is told "I know how that works" by a person they trust says a short version of okay and moves — and what they say next is about something else. `
    + `A character may absolutely still WANT the thing, still be nervous about it, still touch it or hand it over or get it signed. What they may not do is deliver the content the player just declined. `
    + `If the character truly cannot let it go, that is a feeling about being believed, and it comes out as that — one line about themselves — never as the explanation again.`;
}
