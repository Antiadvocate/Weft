/**
 * SATURATION — the register run at a hundred percent, and the cure that caused it.
 *
 * A player who had spent fourteen rounds reporting that the dialogue sounds like a machine changed
 * the narrator model to rule the model out, replayed the opening, and sent this. Six turns. One
 * speaker. Every line she says:
 *
 *   "It's eighty-nine degrees in here already."   "The rent's due by five, Max. And you're staring."
 *   "Eighty-nine inside."                          "…the six-pack of fifteen-ounce sparkling waters
 *   "The cotton rounds are thirty-count…"           in the crisper is already down to two."
 *   "Sixteen fluid ounces."                        "With an eight percent markup…"
 *   "You're covering sixty-five percent of ConEd." "…ninety-two dollars and seventy cents."
 *   "Pay the ninety-two by five o'clock."          "Slide the green bottle… Get the acetone…
 *                                                    Hold my ankle… Keep your knee locked."
 *
 * MEASURED: 21 spoken lines. 57% carry a quantity. 24% are commands. 76% share not one content word
 * with what the player had just said to her. And the player twice told her, in plain words inside
 * his own action, that she talked like an AI. She answered the first with a defence of her own
 * diction and the second with "Claude isn't on the lease, Max."
 *
 * EVERY DETECTOR IN THIS ENGINE RETURNED CLEAN. findMaxims: 0. findClaudisms: 0. flagTics: 0.
 * last_leak, last_echo, last_maxim, last_claudism: all null. And they were all RIGHT, by their own
 * rules — nothing she said was aphoristic, or interior, or a reprint, or a composed punchline. She
 * named a physical object in the room in almost every sentence. She was, by every standard this
 * engine had, writing perfectly.
 *
 * BECAUSE THE ENGINE ASKED FOR HER. This is the part worth writing down, because it is not the
 * model's failure and swapping models will not touch it. maxims.ts fixed the aphorism — a character
 * speaking in portable wisdom — with one instruction: EVERY LINE NAMES SOMETHING PHYSICALLY PRESENT,
 * "a person, an object, a price, a door, a name, A NUMBER, an errand". That instruction was correct
 * and it went into THREE places at once:
 *
 *   1. `maximFix`, the per-turn correction.
 *   2. `voiceAnchor`, the standing block, as "THE REGISTER IS NOT DECORATION".
 *   3. FORGE_SYSTEM's `example_lines` requirement, which is where it did the real damage: "EVERY ONE
 *      MUST NAME SOMETHING THE SPEAKER COULD POINT AT OR HAS HANDLED — a person, an object, a price,
 *      a place, a job, a debt, a number."
 *
 * So the forge, obeying it, authored a character whose voice card reads `diction: "Flat,
 * brand-specific, inventory-focused"`, `rhythm: "Deadpan metronome"`, and — in her own tics field —
 * `"States exact dollar figures and packaging sizes down to the fluid ounce"`. Her agenda: "cataloging
 * what Max owes her". That is not a person the narrator invented. It is a person the ENGINE
 * commissioned, written to spec, and then handed back to the narrator at the end of every single
 * turn by the very block whose job is to keep voices distinct.
 *
 * A NUMBER IS THE LAZIEST CONCRETE NOUN THERE IS. It satisfies "name something present" perfectly
 * while carrying nothing about who is speaking — which is exactly why a model reaches for it when
 * told to be specific. The cure for the aphorism selected for it. And all four characters in that
 * save came out of the forge specified as terse: "clipped short bursts", "short choppy sentences",
 * "moves conversation forward like she's ticking off work orders", "deadpan metronome". Not one of
 * them was written as somebody who talks too much. A schema that cannot produce a person who
 * rambles cannot produce four people who sound different, because terseness has one texture.
 *
 * WHAT THE RESEARCH SAYS THE MISSING THING IS, and it lines up exactly. Grice's maxim of Quantity
 * is violated in BOTH directions, and a model trained to be helpful only ever breaks it upward:
 * it over-informs. Every line above is maximally informative. What real speech is full of, and what
 * produces subtext on a page, is a speaker DECLINING to be informative — flouting the maxim:
 * answering something adjacent, not answering, complaining about a third party, going off on the
 * wrong subject. Screenwriting names the failure directly: dialogue in which a character states
 * exactly what they want with nothing under it is "on-the-nose", and subtext requires a hidden want
 * plus a pressure against saying it. Nothing in this engine measured whether anybody was ever
 * anything other than informative. That is what this file measures.
 *
 * THREE THINGS, THEN, ALL ON THE OUTPUT, ALL CORRECTED ON THE NEXT TURN:
 *   · SATURATION — one speaker's lines all running on the same narrow register.
 *   · UNRESPONSIVENESS — nobody engaging what was actually said to them.
 *   · THE APPARATUS IN SOMEBODY'S MOUTH — a character answering an out-of-character complaint from
 *     inside the fiction, which is the failure maxims.ts named as the worst one and could not catch,
 *     because its detector was gated behind the line also being a maxim.
 */
import type { SaveState } from "./types";
import { spokenLines } from "./speech";

/** A quantity, spelled or written. Deliberately wide — the point is to catch a register built out
 *  of measurement, and a register built out of measurement reaches for all of these.
 *
 *  ONE ALTERNATIVE PER ARRAY ENTRY, and the reason is a bug this file shipped with for an hour: the
 *  number list was split across two entries for line length, and `.join("|")` then welded them into
 *  `…|ninety||hundred|…`. An empty alternative matches the empty string, so QUANTITY matched every
 *  line of every save and the guard reported a hundred percent saturation on dialogue containing no
 *  numbers at all — a detector that fires on everything is indistinguishable from one that is right,
 *  until you read what it caught. */
const QUANTITY = new RegExp([
  "\\b\\d",
  "\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|quarter)\\b",
  "\\b(?:percent|per ?cent|ounces?|pounds?|grams?|litres?|liters?|gallons?|quarts?|pints?|inches|foot|feet|yards?|miles?|metres?|meters?|kilos?|count|six-?pack|dollars?|cents?|bucks|degrees?|o'?clock|markup|invoice)\\b",
].join("|"), "i");

/** A line that is an order. A register made of orders is the other half of what that save did. */
const COMMAND = /^(?:go|get|come|take|put|tell|give|look|listen|stop|wait|sit|stand|read|hold|slide|pay|keep|eat|drink|open|close|call|write|leave|move|turn|watch|show|find|bring|say|do|don['’]t|make|pick|drop|start|finish|check|ask|try|pull|push|hand|pass|send|sign|count|breathe|hurry|shut)\b/i;

/** Words too common to prove anybody was listening. */
const STOP = new Set([
  "that", "this", "there", "here", "what", "when", "where", "which", "with", "your", "yours", "mine",
  "they", "them", "then", "than", "have", "has", "had", "been", "will", "would", "could", "should",
  "just", "like", "about", "because", "really", "very", "much", "some", "want", "know", "think",
  "going", "gonna", "into", "from", "were", "was", "are", "you", "and", "the", "but", "for", "not",
]);

/** Words, for length. */
function words(s: string): string[] {
  return String(s ?? "").replace(/[^\w'’\s-]/g, " ").split(/\s+/).filter(Boolean);
}

/** Content words, for asking whether a reply engaged what was said. */
function content(text: string): Set<string> {
  return new Set(
    String(text ?? "").toLowerCase().replace(/[^a-zà-ÿ'’\s-]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/**
 * Who said what.
 *
 * Attribution is by the nearest name in the eighty characters AFTER the closing quote, then before
 * the opening one — which is where a dialogue tag lives in English — and a line with no name near it
 * is credited to whoever was last named. Crude, and it does not need to be better: this measures a
 * DISTRIBUTION over a whole turn, so a couple of misattributed lines in a five-line scene move a
 * ratio and never a verdict, and the guard only fires on ratios that are lopsided.
 */
export function bySpeaker(prose: string, names: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const first = new Map<string, string>();
  for (const n of names) {
    const f = String(n ?? "").trim().split(/\s+/)[0];
    if (f) first.set(f.toLowerCase(), String(n).trim());
  }
  if (!first.size) return out;
  // THE ENGINE'S OWN MARKER IS FULL OF QUOTATION MARKS. A committed turn ends with
  // `<<<SCENE place="…" here="Max Mercer, Abigail Mercer" …>>>`, and every one of those attribute
  // values is a quoted span with a cast name sitting next to it — so an unstripped read of the first
  // turn of that save credited six lines of "dialogue" to a man who had not spoken, three of them
  // containing a number, and reported him saturated. Strip it before anything counts.
  const p = String(prose ?? "").replace(/<<<[^>]*>>>/g, " ");
  const near = (window: string) => {
    for (const w of window.split(/[^A-Za-zà-ÿ'’-]+/)) {
      const hit = first.get(w.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };
  // WHEN THE TAG CARRIES NO NAME. Most dialogue tags are "she said", and a scene with one other
  // person in it may never name them next to a line — in that save's second turn all four of
  // Abigail's lines were tagged `she said`, so a strict reading attributed none of them and the
  // guard saw nothing. When exactly one cast member is named anywhere in the prose, every untagged
  // line is theirs; that is also true of how the prose reads.
  const present = [...new Set([...p.matchAll(/\b([A-Z][a-zà-ÿ'’-]+)\b/g)]
    .map((m) => first.get(m[1].toLowerCase())).filter((x): x is string => Boolean(x)))];
  let last: string | null = present.length === 1 ? present[0] : null;
  for (const m of p.matchAll(/["“]([^"”\n]{2,})["”]/g)) {
    const said = m[1].trim();
    if (!said) continue;
    const at = m.index ?? 0;
    const who: string | null = near(p.slice(at + m[0].length, at + m[0].length + 80))
      ?? near(p.slice(Math.max(0, at - 80), at))
      ?? last;
    if (!who) continue;
    last = who;
    const arr = out.get(who) ?? [];
    arr.push(said);
    out.set(who, arr);
  }
  return out;
}

export interface SaturationHit {
  who: string;
  /** What is lopsided, for the correction to name. */
  kind: "quantities" | "orders" | "not listening";
  /** The measured share, 0–1. */
  share: number;
  /** How many lines it was measured over. */
  lines: number;
  /** One of the offending lines, quoted back. */
  line: string;
}

/** A speaker needs this many lines in one turn before a ratio over them means anything. */
const FLOOR = 3;
/** Share of a speaker's lines on one narrow register before it is the register and not a flavour. */
const SATURATED = 0.6;
/** Share of a speaker's lines that may fail to engage anything said to them. */
const DEAF = 0.75;

/**
 * The lopsided speaker in this turn, if there is one.
 *
 * `heard` is everything this speaker was answering: the player's typed action plus every OTHER
 * person's lines in the same turn. A reply engages when it shares one content word with any of it,
 * which is a low bar on purpose — the guard is looking for a speaker who clears it almost never.
 */
export function findSaturation(prose: string, action: string, names: string[], player = ""): SaturationHit | null {
  // THE PLAYER IS NOT THE NARRATOR'S TO CORRECT, and dropping them from the CANDIDATES rather than
  // from the results is what makes attribution work at all. Their name is the commonest word next
  // to a line of dialogue in this engine, because it is who everybody is talking TO — "Slide the
  // green bottle off the TV stand, Max," she said. Left in the pool, the addressee is read as the
  // speaker; taken out, a two-hander resolves to the one person who could have said it, which is
  // also how a reader resolves it.
  const p = player.trim().toLowerCase();
  const cast = names.filter((n) => String(n ?? "").trim().toLowerCase() !== p);
  const byWho = bySpeaker(prose, cast);
  if (!byWho.size) return null;
  const hits: SaturationHit[] = [];
  for (const [who, lines] of byWho) {
    if (lines.length < FLOOR) continue;
    const heard = content([action, ...[...byWho].filter(([o]) => o !== who).flatMap(([, l]) => l)].join(" "));
    let q = 0, c = 0, deaf = 0, substantial = 0;
    let qLine = "", cLine = "", dLine = "";
    for (const l of lines) {
      if (QUANTITY.test(l)) { q++; qLine ||= l; }
      if (l.split(/(?<=[.!?])\s+/).some((x) => COMMAND.test(x.trim()))) { c++; cLine ||= l; }
      // A SHORT REACTION IS A REPLY, WHATEVER WORDS IT USES. "Okay." "Good." "You started without
      // me." carry no content word in common with what was just said and are pure response — they
      // exist only as a reply and read as nothing else. Counting them as failures to listen put this
      // guard at 18.5% of every turn across thirteen saves, which is not a defect rate, it is
      // conversation. Only a substantial line can be guilty of engaging nothing.
      if (words(l).length < 6) continue;
      substantial++;
      const mine = [...content(l)];
      if (!mine.some((w) => heard.has(w))) { deaf++; dLine ||= l; }
    }
    const n = lines.length;
    if (q / n >= SATURATED) hits.push({ who, kind: "quantities", share: q / n, lines: n, line: qLine });
    if (c / n >= SATURATED) hits.push({ who, kind: "orders", share: c / n, lines: n, line: cLine });
    // Only worth saying when there WAS something to engage with.
    // Measured over the substantial lines only, and only when there were enough of them to mean
    // something — the same reason FLOOR exists for the register ratios.
    if (heard.size >= 3 && substantial >= FLOOR && deaf / substantial >= DEAF) {
      hits.push({ who, kind: "not listening", share: deaf / substantial, lines: substantial, line: dLine });
    }
  }
  if (!hits.length) return null;
  // The most lopsided one, over the most lines — one correction a turn, aimed at the worst thing.
  return hits.sort((a, b) => (b.share * b.lines) - (a.share * a.lines))[0];
}

/**
 * THE APPARATUS IN SOMEBODY'S MOUTH.
 *
 * The player said, inside his own typed action, "maybe you'd make more friends if you talked less
 * like an ai and more like a person". Two turns later a character in a Philadelphia tenement said:
 * "Claude isn't on the lease, Max."
 *
 * maxims.ts already names this as the worst failure in the system — "THE NARRATOR DEFENDING THE
 * REGISTER THROUGH A CHARACTER'S MOUTH" — and has a whole separate correction written for it. That
 * correction never ran, because it lives inside `maximFix`, which returns early on a null argument:
 * the defence is only found if `findMaxims` ALSO flagged the line as an aphorism. "Claude isn't on
 * the lease" is not an aphorism. So the branch built for exactly this sat unreachable while the
 * exact thing it describes happened twice in six turns.
 *
 * This is the ungated version. It reads the prose directly and it is not conditional on anything.
 * Two separate faults, and the first is not only about register: a character naming Claude, an AI, a
 * model or the narration is the fiction acknowledging the machine, which breaks the world outright.
 */
export interface ApparatusHit { line: string; kind: "named the machine" | "defended how they talk" }

const MACHINE = /\b(?:claude|chatgpt|grok|gemini|an? ai\b|the ai\b|chatbot|language model|the narrator|the narration|the prose|the writer|the author|one-?liners?)\b/i;
/** MEASURED AND CUT: "this story" and "maxims". Both looked like the apparatus and both turned out to
 *  be somebody talking — "you cannot keep asking me to say it again like this story starts over every
 *  morning" is a woman using an ordinary word for her own life, and a world can contain a proverb.
 *  A false positive here is expensive out of proportion to the miss it prevents: the correction it
 *  emits is the loudest note in the whole directive and it orders the narrator to pretend the last
 *  turn never happened. It must only fire on words that cannot be innocent. */
const DEFENDING = /\b(?:are ?n['’]?t|is ?n['’]?t|not)\s+(?:a\s+)?(?:maxims?|metaphors?|riddles?|lessons?|proverbs?|robot|machine|computer|program)\b|\bhow (?:I|we|they) talk\b|\bthe way (?:I|we|they) talk\b|\bif I just say\b|\bI keep (?:saying|speaking) it plain\b|\byou keep hearing\b|\btalk (?:more )?normally\b|\btalk(?:ing)? like (?:an? )?(?:ai|robot|machine|computer|program)\b/i;

/** A world that genuinely contains these words is not breaking anything by saying them. Passed in
 *  from the bible so a science-fiction setting is never scolded for naming a machine. */
export function findApparatus(prose: string, setting = ""): ApparatusHit | null {
  const techy = /\b(?:ai|artificial intelligence|android|robot|synthetic|machine mind|computer|cyber|neural|simulation)\b/i.test(String(setting ?? ""));
  for (const said of spokenLines(prose)) {
    if (!techy && MACHINE.test(said)) return { line: said.slice(0, 180), kind: "named the machine" };
    if (DEFENDING.test(said)) return { line: said.slice(0, 180), kind: "defended how they talk" };
  }
  return null;
}

/** The correction for a lopsided speaker. Names the ratio, because a measured number is the one
 *  kind of evidence a model cannot argue with, and quotes one line so the note is about a real
 *  sentence rather than about a tendency. */
export function saturationFix(hit: SaturationHit | null | undefined): string {
  if (!hit?.who) return "";
  const pct = Math.round(hit.share * 100);
  if (hit.kind === "not listening") {
    return `\n${hit.who.toUpperCase()} DID NOT ANSWER ANYBODY LAST TURN. ${pct}% of the ${hit.lines} things they said shared not one word with what was actually said to them — for instance "${hit.line}", which follows on from nothing. A person tracks the conversation they are in even when they are winning it, even when they are being cruel, even when they are changing the subject on purpose — and changing the subject on purpose still starts from the thing being changed away from.
THIS TURN ${hit.who.toUpperCase()} REACTS TO THE ACTUAL WORDS THEY WERE JUST GIVEN before they say anything of their own: repeat part of it back wrong, take the one word they object to, answer the question underneath rather than the one asked, or refuse it out loud and say so. If they are ignoring the player, they must be seen to ignore something specific.`;
  }
  const what = hit.kind === "quantities"
    ? { noun: "a quantity", why: "a measurement — a count, a price, a percentage, a size", how: `A NUMBER IS THE LAZIEST CONCRETE DETAIL THERE IS. It satisfies every rule in this direction about naming real things while telling the reader nothing whatever about who is speaking, which is why it is what gets reached for when the instruction is "be specific". Specific means the PARTICULAR thing — its name, whose it is, what state it is in, how it got there, what is wrong with it — not its measurement.` }
    : { noun: "an order", why: "an instruction to somebody else", how: `COUNT WHAT THIS PERSON'S WORDS ARE FOR. Every line above was spent directing somebody. Somebody who is actually obeyed in a room gives one instruction and then spends their words on other things — what they are doing with their hands, who annoyed them yesterday, what they want later — and is obeyed anyway; repeating the instruction is what a person does when the first one did not work. So if the scene needs this person in charge, give them ONE instruction this turn and let the obedience show in what the other person does, not in how many times they are told.` };
  return `\n${hit.who.toUpperCase()} SPOKE IN ONE NARROW REGISTER FOR THE WHOLE TURN. ${pct}% of the ${hit.lines} things they said contained ${what.noun} — ${what.why} — including "${hit.line}".
${what.how}
NOW GO AND READ THIS SPEAKER'S OWN CARD, because this register is probably printed on it. Read the diction, rhythm and tics fields as a description of WHERE THIS PERSON'S WORDS COME FROM: the vocabulary their life gave them, what they reach for first when they open their mouth. Do not read them as a test every sentence has to pass. Applied as a test, a card like that yields a speaker with one available subject, and the player reads a speaker with one available subject as machine output rather than as a characterisation.
THIS TURN, ${hit.who.toUpperCase()} GETS AT MOST ONE LINE ON THAT REGISTER. Their other lines come from the same mouth and somewhere else entirely: the room, their body, the heat, what they were doing before this, the person in front of them, one of the standing interests printed on their card, or a complaint about somebody who is not here. AND AT LEAST ONE OF THEIR LINES THIS TURN CARRIES NO INFORMATION AT ALL — real speech is full of turns that deliver nothing: not answering, saying the obvious, repeating a question back, going off on the wrong thing. A character whose every sentence delivers a fact is the most machine-like thing on the page, however solid the facts are.`;
}

/** The correction for the machine turning up in the fiction. Separate from `maximFix`'s version and
 *  reachable without it. */
export function apparatusFix(hit: ApparatusHit | null | undefined): string {
  if (!hit?.line) return "";
  if (hit.kind === "named the machine") {
    return `\nSTOP. A CHARACTER NAMED THE MACHINE OUT LOUD LAST TURN: "${hit.line}" — inside the fiction, to another person in it. Nobody in this world has heard of Claude, of an AI, of a language model, of a narrator, or of this story. The word does not exist there. The player may say it — they are outside, talking to you — and when they do, the answer is never to put it in somebody's mouth: a complaint about the writing is answered BY THE WRITING CHANGING, silently, this turn, and by nothing else.
THIS TURN nobody refers to the machine, to the writing, to how anybody talks, or to being taken for something other than a person. The scene continues as though the last turn's line was never said, and the change the player asked for happens in the prose without being acknowledged.`;
  }
  return `\nSTOP. A CHARACTER DEFENDED HOW THEY TALK LAST TURN: "${hit.line}" — which means the player complained about the dialogue and the reply put a justification of it in somebody's mouth. That is worse than the original complaint, because it uses a person in the story to tell the player they are wrong about the writing, and the player is not wrong; they are the only one who can see it from outside.
Nobody in this world has an opinion about how the writing works, and no character is aware of being written. THIS TURN nobody defends their diction, explains why they phrase things as they do, comments on being misunderstood, or refers to how anybody talks. They talk differently instead — longer, less tidily, about whatever is actually in front of them — and nothing on the page notes that anything changed.`;
}

/** For the player-facing ledger. */
export function saturationNote(hit: SaturationHit): string {
  const pct = Math.round(hit.share * 100);
  return hit.kind === "not listening"
    ? `${hit.who} answered nothing anybody said (${pct}% of ${hit.lines} lines)`
    : `${hit.who} spoke in ${hit.kind} for ${pct}% of ${hit.lines} lines`;
}

/** Cleared once shown, same as every other one-shot correction here. */
export function clearSaturation(state: SaveState): void {
  state.last_saturation = null;
  state.last_apparatus = null;
}
