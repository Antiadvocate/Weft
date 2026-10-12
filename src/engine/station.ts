/**
 * STATION — where a person sits in their world's order, and how much that order counts there.
 *
 * Kingdom of Veythar, the opening scene. A barefoot woman from the slums, who sells her sewing at
 * the edge of the market, walks up to the king in his private garden and talks to him the way she'd
 * talk to a man on a bench. She tells him "You looked. Twice." She sits while he kneels in the grass.
 * She calls him "an odd sort of king", tells him what he's doing wrong, and asks "Is that what you
 * wanted?" when he calls his guards. The player: "How does a random woman like Emily simply speak to
 * the king like he's another dude?"
 *
 * The engine had no idea that one of them was a king. "King" was a word in his name. Every edge was
 * born with power 0, which reads as two equals, and the only thing that could move it was the
 * bookkeeper noticing a title being used and nudging it ten points a turn. So the narrator was told
 * what it was told about two people meeting anywhere: she likes you (warmth 34), "they talk freely,
 * including when they disagree", and her card said she can't resist teasing him.
 *
 * Station is now a fact about a person, like their age: a few words for where they sit in this
 * world ("a seamstress from the slums", "head of the High Council") and a rank from 0 to 100. The
 * world has a fact of its own, how much rank governs the way people deal with each other there: a
 * court with a throne, a great deal; a Seattle office, a little. The gap between two people's ranks,
 * scaled by that, is where their standing toward each other starts, and the bookkeeper's power on
 * the edge is what has happened between the two of them on top of it. Family, lovers and close
 * friends feel half of it.
 *
 * Nothing here says what deference looks like. The narrator is told who each of them is, where they
 * stand relative to each other, and that the forms are the ones their world expects, and it knows
 * how a seamstress speaks to a king in a world like this one better than a rule could.
 *
 * Where it comes from: the forge writes it for the opening cast, the bookkeeper for anyone who
 * arrives later or whose place changes, and the player can set it on the Cast page. For a save made
 * before any of that, a guess is read off the name's title and the first sentences of the
 * background, marked as a guess, and the bookkeeper is asked to replace it.
 */
import type { SaveState } from "./types";

export interface Station { place: string; rank: number; source?: "forge" | "bookkeeper" | "guessed" | "player" }

/** Someone the engine knows nothing about sits here: an ordinary person. */
const ORDINARY = 40;

/** Titles a name opens with. */
const TITLES: [RegExp, number, string][] = [
  [/^(?:high )?(?:king|queen|emperor|empress|pharaoh|sultana?|tsar(?:ina)?|czar(?:ina)?|kaiser|shah|monarch)\b/i, 100, "the sovereign"],
  [/^(?:crown )?(?:prince|princess)\b/i, 90, "royal"],
  [/^(?:grand )?(?:duke|duchess|archduke|archduchess)\b/i, 85, "a great noble"],
  [/^(?:lord|lady|count|countess|earl|baron|baroness|marquis|marquess|marchioness|viscount|viscountess)\b/i, 75, "a noble"],
  [/^(?:archbishop|bishop|cardinal|high priest(?:ess)?)\b/i, 75, "a senior cleric"],
  [/^(?:general|admiral|chancellor|governor|senator|magistrate)\b/i, 65, "a high official"],
  [/^(?:sir|dame)\b/i, 60, "a knight"],
  [/^(?:captain|commander|colonel|major)\b/i, 50, "an officer"],
];

/** What a background says a person is, cheapest first-mention wins. */
const ROLES: [RegExp, number, string][] = [
  [/\b(?:slave|enslaved|bondsman|bondswoman|indentured)\b/i, 5, "unfree, bound to a master"],
  [/\b(?:born into the royal (?:line|family|house)|heir to the throne|ascended the throne)\b/i, 95, "royal"],
  [/\b(?:noble(?:wo)?man|aristocrat\w*|of (?:an? )?(?:old |ancient |great |minor )?noble (?:family|house|line|blood)|(?:oldest|great) (?:noble )?families)\b/i, 75, "a noble"],
  [/\b(?:councillor|councilor|courtier|minister|magistrate|ambassador)\b/i, 65, "an official of the court"],
  [/\b(?:knight)\b/i, 60, "a knight"],
  [/\b(?:merchant|guild ?master|banker|shopkeeper|innkeeper|tavern ?keeper)\b/i, 45, "a merchant"],
  [/\b(?:scholar|physician|lawyer|scribe|priest(?:ess)?|teacher|professor)\b/i, 45, "a professional"],
  [/\b(?:soldier|guard(?:sman)?|mercenary|sailor|artisan|craftsman|craftswoman|blacksmith|carpenter|tailor|seamstress|weaver)\b/i, 30, "a working person"],
  [/\b(?:courtesan|prostitute|sex worker|brothel)\b/i, 25, "a courtesan"],
  [/\b(?:servant|maid|footman|stable ?(?:boy|hand)|laborer|labourer|farmhand|peasant|serf)\b/i, 20, "a servant or labourer"],
  [/\b(?:slums?|poverty|odd jobs|beggar|homeless|street urchin|outcast|gang|thie(?:f|ves)|criminal|smuggler)\b/i, 12, "a commoner from the bottom of society"],
];

function guess(name: string, background: string): Station | null {
  const n = String(name ?? "").trim();
  for (const [re, rank, place] of TITLES) if (re.test(n)) return { place, rank, source: "guessed" };
  // the first two sentences are about the person; the rest is about the people around them
  const head = String(background ?? "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  let best: { at: number; rank: number; place: string } | null = null;
  for (const [re, rank, place] of ROLES) {
    const m = head.match(re);
    if (m && m.index !== undefined && (!best || m.index < best.at)) best = { at: m.index, rank, place };
  }
  return best ? { place: best.place, rank: best.rank, source: "guessed" } : null;
}

/** This person's station: as recorded, or a guess from their card, or null when nothing says. */
export function stationOf(state: SaveState, id: string): Station | null {
  const c = state.characters?.[id] as any;
  if (!c) return null;
  const s = c.station as Station | undefined;
  if (s && typeof s.rank === "number" && Number.isFinite(s.rank)) return { place: String(s.place ?? "").trim(), rank: Math.max(0, Math.min(100, s.rank)), source: s.source };
  return guess(c.name, c.background);
}

/** How much rank governs dealings between people in this world, 0 to 1. */
export function hierarchyOf(state: SaveState): number {
  const b = (state.world_bible ?? {}) as any;
  if (typeof b.hierarchy === "number" && Number.isFinite(b.hierarchy)) return Math.max(0, Math.min(1, b.hierarchy));
  const text = [b.name, b.era, b.technology_level, b.political_situation, b.cultures_and_languages].map((x) => String(x ?? "")).join(" ");
  if (/\b(?:kings?|queens?|kingdoms?|realm|empires?|emperors?|empress|imperial|feudal|medieval|middle ages|renaissance|nobles?|nobility|lords|royal court|throne|dynast\w*|caste|pharaoh|sultan\w*|tsar\w*|shogun\w*|samurai|serfs?|slaves?)\b/i.test(text)) return 0.85;
  if (/\b(?:victorian|regency|edwardian|gilded age|1[78]\d0s|1[89]th century|colonial|antebellum|military|megacorp\w*)\b/i.test(text)) return 0.6;
  if (/\b(?:modern|contemporary|present[- ]day|20[0-9]0s|21st century|today|suburb\w*|high school|college|office)\b/i.test(text)) return 0.3;
  return 0.5;
}

/** Rank is steeper at the top. Kingdom of Veythar, third run: the king's own advisor (55) came out
 *  only "below" the king, on a straight line, and told him there'd be a fee for doing what he'd
 *  been ordered. The ladder's lower rungs sit close together and its top rungs far apart, so
 *  rank is squared before the gap is taken: a slum seamstress and a carter are neighbours, an
 *  advisor and his king are not. */
const worth = (rank: number) => (rank * rank) / 100;

const INTIMATE = /\b(?:wife|husband|spouse|consort|mother|father|son|daughter|brother|sister|sibling|lover|partner|mistress|fianc\w*|best friend|childhood friend|old friend|friend)\b/i;

/**
 * Where `from` stands relative to `to` before anything between them is counted: their gap in rank,
 * scaled by how much rank matters here, halved between family, lovers and friends. Negative means
 * `from` is below. 0 when either station is unknown.
 */
export function stationGap(state: SaveState, from: string, to: string): number {
  const a = stationOf(state, from), b = stationOf(state, to);
  if (!a && !b) return 0;
  const gap = (worth(a?.rank ?? ORDINARY) - worth(b?.rank ?? ORDINARY)) * hierarchyOf(state);
  const edge = (state.world?.edges ?? []).find((e) => e.from === from && e.to === to);
  const close = (edge?.roles ?? []).some((r) => INTIMATE.test(String(r)));
  return Math.round(Math.max(-100, Math.min(100, close ? gap / 2 : gap)));
}

/** Standing toward someone: station first, then what has happened between them. */
export function standingToward(state: SaveState, from: string, to: string): number {
  const edge = (state.world?.edges ?? []).find((e) => e.from === from && e.to === to);
  return Math.max(-100, Math.min(100, stationGap(state, from, to) + (edge?.power ?? 0)));
}

/** The card line: who each of them is in this world, and how far apart that puts them. Empty when it's close. */
export function stationLine(state: SaveState, id: string): string {
  const me = stationOf(state, id), you = stationOf(state, "char_player");
  if (!me || !you) return "";
  const gap = stationGap(state, id, "char_player");
  if (Math.abs(gap) < 15) return "";
  const P = state.characters?.char_player?.name ?? "the player";
  const name = state.characters?.[id]?.name ?? "They";
  const far = Math.abs(gap) >= 60 ? "a very long way" : Math.abs(gap) >= 30 ? "well" : "somewhat";
  return `station: ${name} is ${me.place || "an ordinary person"}, and ${P} is ${you.place || "an ordinary person"}. In this world that puts ${name} ${far} ${gap < 0 ? "below" : "above"} ${P}, so everything said and done between them goes through the forms expected there between people of their two stations.`;
}

/** A few words for the lateral line, when two people present are far apart. */
export function stationTag(state: SaveState, from: string, to: string): string {
  const g = stationGap(state, from, to);
  if (g >= 40) return "far outranks them";
  if (g >= 20) return "outranks them";
  if (g <= -40) return "far beneath them in rank";
  if (g <= -20) return "beneath them in rank";
  return "";
}

/** For the bookkeeper's ledger: the station as recorded, flagged when it's a guess or missing. */
export function stationLedger(state: SaveState, id: string): string {
  const s = stationOf(state, id);
  if (!s) return "station: unknown, set it";
  return `station: ${s.place} (rank ${Math.round(s.rank)}${s.source === "guessed" ? ", a guess, so set it" : ""})`;
}

/** Store one, from the forge, the bookkeeper or the player. Ignores a rank that isn't a number. */
export function setStation(state: SaveState, id: string, place: unknown, rank: unknown, source: Station["source"]): boolean {
  const c = state.characters?.[id] as any;
  const r = Number(rank);
  if (!c || !Number.isFinite(r)) return false;
  const p = String(place ?? "").trim().slice(0, 120);
  // the player's own setting stays until the player changes it
  if (c.station?.source === "player" && source !== "player") return false;
  c.station = { place: p || c.station?.place || "", rank: Math.max(0, Math.min(100, Math.round(r))), source };
  return true;
}

/* HOW A FEELING COMES OUT TOWARD SOMEONE FAR ABOVE YOU.
 *
 * Kingdom of Veythar, second run, with stations in place. Emily's card said, correctly, that she was
 * a commoner a very long way below the king. The same card also said, in other lines, that when
 * clenched she answers the worst reading of what's said "out loud", that her anger "comes out AT
 * the other person: asking again, following it across the room", and that her desire for him shows
 * as flirting, teasing and taking openings. Each of those was written for two people on level ground.
 * So she told the king "I don't think you know, and I don't think you like not knowing", and, with a
 * guard's hand on her arm, "You cannot put someone in a cell for the afternoon because the
 * conversation tired you."
 *
 * People far beneath someone feel all the same things toward them, and it comes out differently:
 * inside the forms, held back, said to someone else, or later. These are the clauses each of those
 * lines gets when the person it describes stands far below the player. */
const FAR_BELOW = -40;

function beneath(state: SaveState, id: string): string {
  if (id === "char_player" || standingToward(state, id, "char_player") > FAR_BELOW) return "";
  return state.characters?.char_player?.name ?? "the player";
}

/** For the clenched register, which otherwise has them answer the misreading out loud. */
export function beneathClench(state: SaveState, id: string): string {
  const P = beneath(state, id);
  return P ? ` When the one they'd answer is ${P}, who stands far above them, the misreading shows in a stiff, overcareful answer, in what they leave unsaid and in their face, and they say it out loud only to people nearer their own station or once ${P} has gone.` : "";
}

/** For "voice now", which otherwise sends anger straight at the other person. */
export function beneathVoice(state: SaveState, id: string): string {
  const P = beneath(state, id);
  return P ? `; toward ${P}, far above them, it stays inside the forms, coming through the teeth, in a too-correct answer or in a silence, and at full strength only toward people nearer their own station or after ${P} has gone` : "";
}

/** For desire, which otherwise flirts, teases and takes openings as if between equals. */
export function beneathDesire(state: SaveState, id: string): string {
  const P = beneath(state, id);
  return P ? ` Between people this far apart it shows inside the forms: in looks, in lingering, in small liberties taken and taken back the moment they might cost something, and anything bolder toward ${P} is a gamble they know they're making.` : "";
}

/* WHAT THE ENGINE SENDS INTO A SCENE HAS TO FIT THE WORLD IT'S SENT INTO.
 *
 * Kingdom of Veythar, third run, turn 19. The king told his advisor to have the girl in the cells
 * freed and brought to him. The engine's pressure beat that turn was the story's palette, "Financial
 * desperation", told to happen "through the people who are actually there". The only person there
 * was the advisor, so the advisor told the king there'd be a silver mark's fee to open the cells and
 * that half the night watch hadn't been paid in four weeks: in a kingdom whose bible says it is
 * stable and prosperous, to its sovereign, about his own order. Turn 22's palette beat, "Power and
 * control", went the same way through a gang boss who had just watched the king summon a sword.
 *
 * So anything the engine adds says it agrees with what the world has established about itself, and
 * when the player sits at the top of a steep order, that it reaches him the way things reach someone
 * there. */
export function beatOrder(state: SaveState): string {
  const b = (state.world_bible ?? {}) as any;
  const facts = String(b.political_situation ?? "").split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  const me = stationOf(state, "char_player");
  const P = state.characters?.char_player?.name ?? "the player";
  const pp = String(state.characters?.char_player?.pronouns ?? "");
  const him = /\bshe\b|\bher\b/i.test(pp) ? "her" : /\bhe\b|\bhim\b/i.test(pp) ? "him" : "them";
  const parts: string[] = [];
  if (facts) parts.push(`Whatever it is agrees with what this world has established about itself (${facts.slice(0, 220)}).`);
  if (me && me.rank >= 75 && hierarchyOf(state) >= 0.6) {
    parts.push(`It reaches ${P}, who is ${me.place || "at the top of this world's order"}, the way things reach someone of that station here: as news, a report or a petition, brought by people far beneath ${him} who know it, and ${P}'s orders get carried out, fearfully or badly perhaps, with nobody in ${him === "them" ? "their" : him === "her" ? "her" : "his"} service putting a price or a condition on one.`);
  }
  return parts.length ? `\n${parts.join(" ")}` : "";
}

/** Someone far beneath the player who has come looking for them is stopped at the door, and word is
 *  brought. Kingdom of Veythar, third run: a gang boss and a travelling stranger each walked into the
 *  king's private corridor, the second straight onto a fresh killing, because the engine moved anyone
 *  who had been trying long enough to reach the player into the player's room. */
export function keptAtTheDoor(state: SaveState, id: string): boolean {
  return id !== "char_player" && standingToward(state, id, "char_player") <= FAR_BELOW;
}

export function atTheDoorNote(state: SaveState, names: string[]): string {
  if (!names.length) return "";
  const P = state.characters?.char_player?.name ?? "the player";
  const where = state.world?.places?.[state.world?.player_location ?? ""]?.name ?? "where the player is";
  return `\nASKING TO SEE ${P.toUpperCase()}: ${names.join(", ")}. ${names.length > 1 ? "They have" : "They've"} come to ${where} to reach ${P}, and people of their station don't get into ${P}'s presence by walking in. Whoever keeps the door stops them, and word is brought to ${P} of who it is and what they say they want. They aren't in the room, and they come in only if ${P} has them brought in.`;
}
