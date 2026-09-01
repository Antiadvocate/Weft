/** COMMON GROUND — what two people would actually talk about before they talk about the thing.
 *
 *  The complaint: "No indirectness. Nothing leading up to what she wants to talk about. There's a
 *  really interesting background for her interests and absolutely nothing comes up."
 *
 *  Both halves of that are one missing mechanism. The engine has always known what a character
 *  WANTS — the drive, its approach, its blocker, all handed to the narrator every turn. It has never
 *  once computed what two people HAVE IN COMMON. So when a character needs a door into a
 *  conversation, the only thing in front of the model with any weight is the want itself, and the
 *  want is what gets said. A seducer with a stated goal and no shared subject can only make passes.
 *
 *  Look at the save this was written against. Rabi cannot leave a malfunctioning appliance alone and
 *  will take it apart on a neighbour's kitchen table. Clara can spot a fake Eames chair from across a
 *  flea market. That is the same instinct — an eye for whether an object is honest about how it was
 *  made — and it is the obvious hour of conversation these two would have before anything else
 *  happened. In a hundred and eight turns it never came up once, because nothing ever put it in
 *  front of the narrator.
 *
 *  ── why word overlap does not work ────────────────────────────────────────────────────────────
 *  Their cards share almost no vocabulary. "Circuit diagram" and "Eames chair" have no token in
 *  common; neither do "malfunctioning appliance" and "vintage furniture appraisal". A lexical
 *  intersection of these two people returns nothing, which is exactly wrong. What they share is a
 *  DOMAIN, so the domain is what gets matched — a small lexicon mapping the concrete nouns people
 *  actually write on character cards to the handful of subjects human beings bond over.
 *
 *  Free, deterministic, no tokens. It reads texture, skills, values and background — fields the
 *  forge has always been made to fill and that nothing downstream has ever read for this. */
import type { Identity, SaveState } from "./types";
import { clipText } from "./text";

export interface Domain { key: string; label: string; re: RegExp }

/** The subjects two people discover they share. Deliberately broad and few: this is looking for the
 *  reason a conversation keeps going, not for a precise taxonomy. Each pattern is matched against
 *  the raw text of a card, so it wants the words people actually write there. */
export const DOMAINS: Domain[] = [
  { key: "make", label: "how things are made, and whether they are made honestly",
    re: /\b(engineer|circuit|appliance|repair|mend|fix(?:ing|es)?|build(?:ing|s)?|carpent|joinery|craft|workshop|machin|mechanic|restor|antique|vintage|furniture|eames|mid-century|grain|tool|wiring|grid|solder|forge|smith|weld|clock(?:work)?|watchmak)/i },
  { key: "grow", label: "growing things",
    re: /\b(garden|roses?|plant|botan|seed|soil|greenhouse|orchard|farm|horticult|landscape|prun|compost|bloom|latin name)/i },
  { key: "food", label: "cooking and eating",
    re: /\b(cook|bake|bread|kitchen|recipe|chef|spice|meal|dinner|pastry|ferment|butcher|wine|coffee|tea\b)/i },
  { key: "body", label: "the body and what it can be trained to do",
    re: /\b(yoga|dance|dancer|athlet|run(?:ning|ner)|swim|climb|martial|posture|breath|anatom|physiolog|medicine|medical|doctor|nurse|surgeon|resident|midwif|obstetric)/i },
  { key: "sound", label: "music",
    re: /\b(music|sing|song|choir|piano|guitar|violin|cello|jazz|opera|record(?:s|ing)?|band\b|compos|nocturne|chopin)/i },
  // `read` and `encyclopedic` were in here and had to come out: they matched a resident reading a
  // fetal monitor and an engineer's recall of film quotes, pairing two people over "books" when
  // neither phrase was about one. A domain is worth naming only when the words are the subject.
  { key: "page", label: "books and what is in them",
    re: /\b(books?|novel|librar|poet|essay|literat|first-edition|textbook|bookshop|reading (?:list|group)|medical journals?)/i },
  { key: "screen", label: "films and what gets quoted from them",
    re: /\b(film|movie|cinema|screen|one-liner|actor|director)/i },
  { key: "beast", label: "animals",
    re: /\b(dog|cat\b|greyhound|horse|bird|rescue|kennel|stable|veterinar|creature|pet\b)/i },
  { key: "sky", label: "weather and the outdoors",
    re: /\b(weather|storm|rain|snow|thunder|ozone|hike|hiking|mountain|sea\b|sail|tide|star(?:s|gaz)|forest|trail)/i },
  { key: "law", label: "how the world is arranged, and by whom",
    re: /\b(politic|law\b|lawyer|court|union|protest|council|hoa\b|committee|bureaucr|magistrat|guild|treaty)/i },
  { key: "coin", label: "money, trade, and what things are worth",
    re: /\b(money|trade|market|business|invest|settlement|appraisal|sell|selling|price|bargain|merchant|shop\b|client)/i },
  { key: "faith", label: "what happens after, and what it is all for",
    re: /\b(god|faith|pray|temple|church|meditat|dzogchen|buddh|philosoph|ethic|soul|ritual|spiritual)/i },
  { key: "number", label: "how the world works underneath",
    re: /\b(physic|math|quantum|astronom|chemistr|science|scientific|theor(?:y|em)|paradox|equation|experiment)/i },
  { key: "hand", label: "making pictures",
    re: /\b(paint|draw(?:s|ing)?|sketch|sculpt|photograph|design|architect|art\b|artist|gallery|aesthetic)/i },
  { key: "kin", label: "the families people come from",
    re: /\b(mother|father|parent|sibling|brother|sister|nephew|niece|grandmother|grandfather|childhood|raised|orphan|divorce|widow)/i },
];

/** WHAT A SENTENCE IS ABOUT, AS OPPOSED TO WHAT IT MENTIONS.
 *
 *  Two false positives on the first real save, and both are instructive. A greyhound named
 *  'Architecture' registered its owner as interested in ARCHITECTURE. "Can read a grid's stress
 *  points like a doctor reads a chart" registered an electrical engineer as interested in MEDICINE.
 *
 *  Neither is a subject the person could talk about for an hour, which is the only test that
 *  matters here. A name is a label, not a topic, and the vehicle of a simile is borrowed from a
 *  domain precisely because the speaker is NOT in it. Both get cut before matching. */
function topical(line: string): string {
  return line
    .replace(/["'“”‘’][^"'“”‘’]{2,40}["'“”‘’]/g, " ")   // named things: a dog called 'Architecture'
    .replace(/\b(?:like|as)\s+(?:a|an|the)\s+[^,.;]{2,40}/gi, " "); // the far side of a simile
}

/** The phrases on a card that speak for a person, and how much each is worth as an OPENING.
 *
 *  Weighted, because these fields are not equally honest. `texture` is defined on the forge schema
 *  as "standing interests and enthusiasms — the things this person brings up unprompted", and
 *  `skills` as "the subjects they can actually hold forth on": those two ARE this question, already
 *  answered, which is what makes their never having been read for it so galling.
 *
 *  `background` is deliberately excluded. It is three or four sentences of life story, long enough
 *  to brush against half the lexicon by accident, and on the first real save it was the source of
 *  every junk pairing — two people "sharing" an interest in families because one had a mother and
 *  the other had a divorce. A subject somebody would actually raise is on the other two fields. */
const SOURCES: { pick: (c: Identity) => string[]; weight: number }[] = [
  { pick: (c) => c.texture ?? [], weight: 3 },
  { pick: (c) => Object.entries(c.skills ?? {}).map(([k, v]) => (v ? `${k}: ${v}` : k)), weight: 3 },
  { pick: (c) => c.core_traits ?? [], weight: 1 },
  { pick: (c) => c.values ?? [], weight: 1 },
];

/** Every domain this person touches, with the concrete phrase that put them there and what that
 *  phrase is worth. Best-scoring phrase per domain wins. */
export function profile(c: Identity): Map<string, { phrase: string; weight: number }> {
  const out = new Map<string, { phrase: string; weight: number }>();
  for (const src of SOURCES) {
    for (const raw of src.pick(c)) {
      if (typeof raw !== "string" || raw.trim().length < 3) continue;
      const hay = topical(raw);
      for (const d of DOMAINS) {
        if (!d.re.test(hay)) continue;
        const prev = out.get(d.key);
        if (prev && prev.weight >= src.weight) continue;
        out.set(d.key, { phrase: clipText(raw, 170), weight: src.weight });
      }
    }
  }
  return out;
}

export interface Shared { key: string; label: string; mine: string; theirs: string; score: number }

/** What these two would find in each other, strongest first.
 *
 *  Strongest means: both of them put it somewhere they meant it. A domain where each side's evidence
 *  is a standing enthusiasm outranks one where both sides only glance at it through a value, because
 *  the first is an hour of conversation and the second is a thing they would nod about once. */
export function commonGround(a: Identity, b: Identity): Shared[] {
  const pa = profile(a), pb = profile(b);
  const out: Shared[] = [];
  for (const d of DOMAINS) {
    const mine = pa.get(d.key), theirs = pb.get(d.key);
    if (mine && theirs) out.push({ key: d.key, label: d.label, mine: mine.phrase, theirs: theirs.phrase, score: mine.weight + theirs.weight });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** THE DOOR, as the narrator receives it.
 *
 *  Written as material rather than as an instruction to change the subject. The want still governs
 *  the scene; this says what the approach to it can be made of, which is the thing that was missing.
 *  A character with no shared ground gets told that too — it is real information, and it is the
 *  reason some conversations have to be forced rather than fallen into. */
export function commonGroundNote(state: SaveState, speakerId: string, listenerId: string): string {
  const a = state.characters[speakerId], b = state.characters[listenerId];
  if (!a || !b) return "";
  const shared = commonGround(a, b);
  if (!shared.length) {
    return `\n[${a.name} AND ${b.name} HAVE NOTHING OBVIOUS IN COMMON. Their cards share no subject. That is usable: between these two, small talk is work, silences are real, and anything ${a.name} wants from ${b.name} has to be approached without a natural opening — which is itself characterising. Do not invent a shared enthusiasm to smooth it over.]`;
  }
  const lines = shared.slice(0, 3).map((s) =>
    `${s.label} — ${a.name}: ${s.mine} / ${b.name}: ${s.theirs}`);
  return `\n[WHAT ${a.name.toUpperCase()} AND ${b.name.toUpperCase()} HAVE IN COMMON — none of it mentioned yet, all of it on their cards:\n· ${lines.join("\n· ")}\nThis is what a conversation between these two is MADE of, and it is how a want gets approached rather than announced. Somebody who wants something from another person does not open with it: they find the subject both of them light up about, they stay there longer than they need to, and the want moves under it. A scene where the only thing on the table is what one of them is after is a scene where nobody has a life. Use a real detail above; do not invent a new shared interest.]`;
}

/** Which pair to compute it for: whoever is in the room with the player and has a live want aimed at
 *  them. That is the character whose approach is most likely to collapse into announcing itself, and
 *  the one whose card has been read least. */
export function doorFor(state: SaveState, focusIds: string[]): { speaker: string; listener: string } | null {
  const present = focusIds.filter((id) => id !== "char_player" && state.characters[id]);
  if (!present.length) return null;
  // prefer someone whose drive names the player, then anyone present
  const aimed = present.find((id) => {
    const g = `${state.characters[id]?.drive?.goal ?? ""} ${(state.characters[id]?.authored ?? []).map((a) => a?.goal ?? "").join(" ")}`.toLowerCase();
    const nm = state.characters.char_player?.name?.split(/\s+/)[0]?.toLowerCase() ?? "";
    return !!nm && g.includes(nm);
  });
  return { speaker: aimed ?? present[0], listener: "char_player" };
}
