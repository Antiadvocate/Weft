/**
 * THE WIND, IN FORTY OF FORTY-SEVEN TURNS.
 *
 * Measured off one save:
 *
 *   wind    40 turns of 47        window  27        glass  20
 *   frame   17                    rattle  15
 *
 * The same sentence, reworded, most of the way through a playthrough:
 *
 *   T13  the wind rattling the old factory frame
 *   T15  the wind rattling the factory windows, the river dark beyond the glass
 *   T17  The wind rattled the factory windows, a low, persistent sound against the glass.
 *   T45  The wind came against the windows. One of the frames rattled and settled.
 *   T46  The wind came hard against the glass and the whole frame shuddered.
 *
 * The prose is not long — that save averages 234 words a turn and never once passes 400. What is
 * wrong with it is density: the same weather beat arriving every single turn, so the reader learns
 * to skip a paragraph and the scene stops having any texture that means anything.
 *
 * AND THE RULE FOR THIS ALREADY EXISTS AND IS BEING OBEYED. "Do not END a turn on weather, rooms, or
 * ambient sound. End on a person." The narrator complies with that to the letter — every one of
 * those stings is in the MIDDLE of its turn. The clause that would actually stop it, "setting
 * appears only when someone acts on it or it changes the situation", asks the model to judge its own
 * sentence against a standard, which is the kind of instruction this engine has learned three times
 * over that a model does not apply to itself (the tic guard, maxims.ts, echo.ts).
 *
 * So it is measured instead. TWO CONDITIONS, BOTH REQUIRED: the sentence contains no person — no
 * member of the cast, no personal pronoun, no quoted speech — AND its subject is one of the ambient
 * things. Nobody is in it, and it is about the weather or the building.
 *
 * The second condition is there because the first alone is too broad, and the dry run over that save
 * proved it: "The phone on the counter lit up, its screen flashing against the concrete island" has
 * no person in it and is not atmosphere at all — it is Chloe's text arriving, which is the plot. A
 * guard that trims the story to fix the wallpaper is worse than the wallpaper. So the vocabulary is
 * named, narrowly, and anything outside it is left alone even when nobody is in the sentence: a
 * missed sting is tiresome, and a cut plot beat is damage.
 *
 * The first ambient sentence of a turn always survives regardless. Rooms are allowed to exist,
 * weather is allowed to happen, and a story with no air in it is its own kind of failure. What is
 * being stopped is the fourth one, and the one that arrived last turn as well.
 */

import { clipText } from "./text";

/** Sentence-splitting that keeps a quoted line and its attribution together, so cutting one can
 *  never strand a quotation mark. Same rule as turn.ts's splitter, kept local to avoid an import
 *  cycle (turn.ts imports this module). */
function sentences(para: string): string[] {
  const out: string[] = [];
  let buf = "", inQuote = false;
  for (let i = 0; i < para.length; i++) {
    const ch = para[i];
    buf += ch;
    if (ch === '"' || ch === "“" || ch === "”") { inQuote = ch === "”" ? false : ch === "“" ? true : !inQuote; continue; }
    if (inQuote || !".!?".includes(ch)) continue;
    while (i + 1 < para.length && ".!?".includes(para[i + 1])) buf += para[++i];
    while (i + 1 < para.length && /\s/.test(para[i + 1])) buf += para[++i];
    out.push(buf); buf = "";
  }
  if (buf) out.push(buf);
  return out.length ? out : [para];
}

const PERSON_PRONOUN = /\b(?:i|me|my|mine|you|your|yours|he|him|his|she|her|hers|they|them|their|theirs|we|us|our|ours|himself|herself|themselves|myself|yourself|someone|somebody|nobody|everyone)\b/i;

/** Does anybody appear in this sentence? */
export function hasPerson(sentence: string, names: string[]): boolean {
  if (/["“”]/.test(sentence)) return true;         // somebody is speaking; that is the scene
  if (PERSON_PRONOUN.test(sentence)) return true;
  const lower = sentence.toLowerCase();
  return names.some((n) => n && lower.includes(n.toLowerCase()));
}

/** The things a scene can be about when nobody is in it and it is still only setting.
 *
 *  Weather, light, air, the building, and the noises they make. Deliberately does NOT include the
 *  objects a scene acts through — a phone, a kettle, a door, a car — because those person-less
 *  sentences are events. */
const AMBIENT_SUBJECT = new RegExp("^(?:" + [
  "wind","rain","snow","sleet","storm","air","breeze","draft|draught","weather","sky","cloud","sun",
  "sunlight","moon","moonlight","light","dark|darkness","shadow","shadows","cold","chill","heat","warmth",
  "glass","window","windows","pane","panes","frame","frames","wall","walls","ceiling","floor","floorboard",
  "radiator","pipe","pipes","building","mill","house","room","street","traffic","city","river","water",
  "silence","quiet","sound","noise","hum","creak","rattle","night","morning","evening","afternoon","dusk","dawn",
].join("|") + ")$", "i");

/** Is this person-less sentence ABOUT one of the ambient things? */
export function isAmbient(sentence: string): boolean {
  const m = motifOf(sentence);
  return !!m && AMBIENT_SUBJECT.test(m);
}

/** The subject a person-less sentence is about — its first substantial noun-ish word, lowercased.
 *  Crude on purpose: it only has to be stable enough that "the wind came against the windows" and
 *  "the wind came hard against the glass" land on the same token. */
const SKIP = new Set(["the", "a", "an", "and", "but", "then", "one", "of", "in", "on", "at", "it", "its",
  "was", "were", "is", "are", "there", "here", "that", "this", "some", "another", "outside", "beyond", "from"]);
export function motifOf(sentence: string): string | null {
  for (const raw of sentence.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (raw.length < 3 || SKIP.has(raw)) continue;
    return raw.replace(/(?<!s)s$/, "");
  }
  return null;
}

/** Motifs the previous turn already spent on setting. */
export function ambientMotifs(prose: string, names: string[]): Set<string> {
  const out = new Set<string>();
  for (const para of String(prose ?? "").split(/\n\n+/)) {
    for (const sent of sentences(para)) {
      if (hasPerson(sent, names) || !isAmbient(sent)) continue;
      const m = motifOf(sent);
      if (m) out.add(m);
    }
  }
  return out;
}

/** At most this many person-less sentences in a turn. One is atmosphere. */
const AMBIENT_BUDGET = 1;

/**
 * Cut the setting this turn did not need.
 *
 * Guards, in the same shape as the tic guard, because the failure mode of an over-eager cut is worse
 * than the thing being cut: never empty a paragraph, never leave an odd number of quotation marks,
 * never take a long sentence (past a certain length it is carrying something), and never take more
 * than three from one turn. A sentence whose motif was already spent on setting last turn loses its
 * place in the budget entirely — that is the recurrence the reader actually notices.
 */
export function trimAmbient(
  prose: string, names: string[], previousProse: string,
): { prose: string; cuts: number; motifs: string[] } {
  const spent = ambientMotifs(previousProse, names);
  const cutMotifs: string[] = [];
  let budget = AMBIENT_BUDGET;
  let cuts = 0;

  const cleaned = String(prose ?? "").split(/\n\n+/).map((para) => {
    const sents = sentences(para);
    if (sents.length < 2) return para;                       // a lone sentence is the paragraph
    const kept = sents.filter((sent) => {
      const t = sent.trim();
      if (cuts >= 3 || t.length > 180) return true;
      if (hasPerson(t, names)) return true;
      if (!isAmbient(t)) return true;          // person-less, but an event rather than atmosphere
      const m = motifOf(t);
      // said again after last turn said it: no allowance, whatever is left in the budget
      if (m && spent.has(m)) { cuts++; cutMotifs.push(m); return false; }
      if (budget > 0) { budget--; return true; }
      cuts++; if (m) cutMotifs.push(m);
      return false;
    });
    const out = kept.join("").trim();
    if (!out) return para;
    if ((out.match(/["“”]/g) ?? []).length % 2 === 1) return para;
    return out;
  }).join("\n\n");

  return cuts ? { prose: cleaned, cuts, motifs: [...new Set(cutMotifs)] } : { prose, cuts: 0, motifs: [] };
}

/* ── THE OTHER HALF, WHICH CANNOT BE CUT ────────────────────────────────────────
 *
 * Trimming above only reaches a free-standing sentence. Most of that save's forty wind mentions are
 * not sentences at all — they are subordinate clauses riding a sentence that does have a person in
 * it: "She was quiet for a moment, the wind rattling the factory windows, the river dark beyond the
 * glass." Excising a clause from inside a sentence is how the tic guard once left a bare quotation
 * mark and an attribution for a line that was not there, and that damage is worse than the tic.
 *
 * So the clause case is not cut, it is REPORTED — the mechanism maxims.ts and echo.ts already use,
 * and the only place a banned phrase can be quoted safely, because by then the model has written it.
 * The narrator is shown the thing it has now written four turns running and told to leave it alone.
 */

/**
 * NOT EVERY AMBIENT WORD CAN BE TAKEN AWAY.
 *
 * The trim can afford a broad vocabulary — it only ever removes a whole sentence that nobody is in,
 * and the first one always survives. A BAN cannot: telling the narrator it may not write "light" or
 * "sound" or "morning" for a turn removes words prose actually needs, and the dry run listed exactly
 * those alongside the wind. So only concrete recurring SCENERY is bannable — a thing the reader
 * pictures, that a scene can simply do without. Time of day, light, and the abstract nouns of sense
 * stay available however often they appear.
 */
const BANNABLE = new Set([
  "wind","rain","snow","sleet","storm","breeze","draft","draught","sky","cloud","sun","moon",
  "glass","window","pane","frame","radiator","pipe","building","mill","street","traffic","river",
  "shadow","ceiling","floorboard",
]);

/** How many of the recent turns a motif must appear in before it is furniture. */
const OVERUSED_IN = 3;
/** How far back to look. */
const OVERUSED_WINDOW = 4;

/** Ambient motifs the recent prose keeps reaching for, anywhere in a sentence — clauses included. */
export function overusedAmbient(recentProse: string[], names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const prose of recentProse.slice(-OVERUSED_WINDOW)) {
    const seen = new Set<string>();
    for (const para of String(prose ?? "").split(/\n\n+/)) {
      for (const sent of sentences(para)) {
        // clauses count here, so the person test is NOT applied — only the vocabulary
        for (const raw of sent.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
          const w = raw.replace(/(?<!s)s$/, "");
          if (w.length < 3 || !AMBIENT_SUBJECT.test(w)) continue;
          seen.add(w);
        }
      }
    }
    void names;
    for (const w of seen) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([w, n]) => n >= OVERUSED_IN && BANNABLE.has(w))
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, 2);   // two is a correction; four is another paragraph of instructions
}

/** One verbatim example of a motif, so the correction quotes what was actually written. */
export function ambientExample(prose: string, motif: string): string {
  for (const para of String(prose ?? "").split(/\n\n+/)) {
    for (const sent of sentences(para)) {
      if (new RegExp(`\\b${motif}s?\\b`, "i").test(sent)) return clipText(sent, 210);
    }
  }
  return "";
}

/** The correction, handed to the NEXT turn. Never before — a phrase pasted into the prompt in
 *  advance is a phrase the model has been supplied, which is the failure tests/prompt-echo.ts
 *  exists to catch. */
export function ambientFix(motifs: string[], example: string): string {
  if (!motifs.length) return "";
  return `\n\nRECENTLY OVERUSED SETTING: ${motifs.join(", ")}. `
    + (example ? `You have written it as recently as: "${example}" ` : "")
    + `It has been in most of the last few turns and the reader has stopped seeing it — repeated setting becomes furniture, `
    + `and a scene furnished the same way every time reads as one long scene. DO NOT use ${motifs.length > 1 ? "any of them" : "it"} this turn, `
    + `in a sentence or in a clause hung off one. If the beat needs air in it, that air comes from something in the room that is ACTUALLY `
    + `different this time — what someone is doing with their hands, what the place smells like at this hour, what is on the table that was not there before — `
    + `or the beat does not need air and goes straight on with the people in it.`;
}
