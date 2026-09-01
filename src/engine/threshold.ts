/**
 * THE THRESHOLD — nobody is inside your house because the prose says so.
 *
 * From a save, turn 106. The player is at his mother's house. A man he has never met:
 *
 *     Marcus was in the front room. He'd come in from the porch at some point, and he was standing
 *     now with one hand on the back of the sofa, not quite sitting.
 *
 * "At some point." No knock, no door, no admission, no turn in which it happened — a stranger placed
 * inside a private residence retroactively, in a subordinate clause. What followed was the player
 * getting a shotgun out from under a bed, and police in the front room, in a story whose genre is
 * "Love, erotica, romantic" and whose forbidden-as-primary list opens with "Physical violence or
 * threats of it".
 *
 * AND THE ENGINE HAS AN ARRIVAL GUARD ALREADY, which passed this without a murmur. Its evidence test
 * is whether the character's name appears in the PROSE — which defends against the bookkeeper
 * inventing an arrival the story never had, and cannot defend against anything the narrator invents,
 * because there the prose IS the evidence. A guard whose witness is the accused.
 *
 * The rule that was missing is smaller and older than any of this: A DOOR IS A DOOR. Getting inside
 * somebody's home is an EVENT — a knock, a bell, a call through the screen, somebody deciding to
 * open it — and it happens where the reader can see it, or it has not happened. That is not a
 * politeness; it is the difference between a story about people and one where anybody may be
 * anywhere the plot finds convenient, which is the engine that produced the shotgun.
 *
 * WHAT THIS DOES NOT DO is cut the prose. By the time it can be detected the scene is built on it,
 * and excising the sentence would leave a man half-present in a room. It is reported instead, at the
 * end of the next turn's direction, quoting what was written — the mechanism maxims.ts and echo.ts
 * use, and the only place a move can be named safely, because by then it has already been made.
 */
import type { SaveState } from "./types";
import { clipText } from "./text";

/** Places that need letting into. Deliberately not "anywhere indoors" — a shop, an inn and a
 *  temple are places a stranger may simply walk into, and most of the world is like that. */
const PRIVATE_PLACE = /\b(?:home|house|apartment|flat|loft|residence|bedroom|cottage|cabin|villa|manor|quarters|lodgings|chambers?|room)\b/i;
const PUBLIC_PLACE = /\b(?:inn|tavern|bar|pub|shop|store|market|square|street|road|park|temple|church|hall|court|station|office|cafe|café|coffee|restaurant|library|museum|gym|school|hospital|clinic|lobby|station)\b/i;

/** Somebody being let in — the event that makes an entry legitimate. */
const ADMITTED = /\b(?:knock(?:ed|s|ing)?|rang the (?:bell|door)|door ?bell|let (?:him|her|them|\w+) in|opened the door (?:for|to)|answered the door|invited (?:him|her|them|\w+) in|showed (?:him|her|them|\w+) (?:in|inside)|waved (?:him|her|them) (?:in|through)|buzzed (?:him|her|them) (?:in|up)|was expecting|had a key|unlocked)\b/i;

/** …and the tell that an entry is being asserted rather than shown. */
const RETROACTIVE = /\b(?:at some point|somehow|had come in|had arrived|had let (?:him|her|them)|must have|was already (?:inside|in the|there)|had been there)\b/i;

/** Is the player standing somewhere that needs letting into? */
export function isPrivateInterior(placeName: string): boolean {
  const n = String(placeName ?? "");
  if (!n.trim()) return false;
  if (PUBLIC_PLACE.test(n)) return false;
  return PRIVATE_PLACE.test(n);
}

/** The sentences a name appears in, PLUS the one straight after each.
 *
 *  The tell is usually not in the sentence with the name in it. The save's was two sentences: "Marcus
 *  was in the front room. He'd come in from the porch at some point" — the name in the first, the
 *  admission-that-isn't in the second, carried by a pronoun. Matching on the name alone read the
 *  first and never saw the second, which is where the whole failure is written down. A pronoun
 *  continuation is the same beat. */
function around(prose: string, name: string): string[] {
  const first = (name.split(/\s+/)[0] ?? name).toLowerCase();
  if (first.length < 3) return [];
  const sents = String(prose ?? "").split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  sents.forEach((sent, i) => {
    if (!sent.toLowerCase().includes(first)) return;
    out.push(sent);
    const next = sents[i + 1];
    if (next && /^\s*(?:he|she|they|his|her|their)\b/i.test(next)) out.push(next);
  });
  return out;
}

export interface Intrusion { name: string; line: string; place: string }

/**
 * Somebody who was not in the scene, standing inside the player's private space, with nothing on
 * the page that let them in.
 *
 * Conservative on purpose, because the cost of a false accusation is a directive telling the
 * narrator off for a door it did write. Three conditions, all required: the place is private, the
 * person was not in the scene when the turn began, and no sentence they appear in shows an
 * admission. A retroactive assertion ("at some point", "had already been inside") is treated as
 * evidence AGAINST rather than for, since that phrasing is the failure's own signature.
 */
export function findIntrusion(
  state: SaveState, prose: string, presentAtStart: Set<string>,
): Intrusion | null {
  const place = state.world.places?.[state.world.player_location]?.name ?? "";
  if (!isPrivateInterior(place)) return null;

  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || presentAtStart.has(id)) continue;
    const name = c?.name ?? "";
    if (!name) continue;
    const lines = around(prose, name);
    if (!lines.length) continue;
    // they have to actually be IN it, not spoken about
    const inside = lines.some((l) => /\b(?:was|stood|standing|sat|sitting|leaned|leaning|in the (?:front room|kitchen|hallway|doorway|living room)|came in|walked in|stepped inside|inside)\b/i.test(l));
    if (!inside) continue;
    if (lines.some((l) => ADMITTED.test(l))) continue;                 // somebody let them in
    const line = lines.find((l) => RETROACTIVE.test(l)) ?? lines[0];
    return { name, line: clipText(line, 220), place };
  }
  return null;
}

/** The correction, handed to the next turn. */
export function thresholdFix(hit: Intrusion | null | undefined): string {
  if (!hit?.name) return "";
  return `\n\nSOMEBODY GOT INSIDE WITHOUT A DOOR. Last turn ${hit.name} was written as being inside ${hit.place}, and nothing on the page put them there: "${hit.line}"\n`
    + `Getting into somewhere private is an EVENT and it happens where the reader can see it — a knock, a bell, a call through the screen, somebody deciding to open the door and open it. `
    + `A person who is simply discovered in the front room has not entered the story, they have been placed in it, and the scene after that is built on something that never happened. `
    + `This turn, treat ${hit.name}'s presence as the unexplained thing it is: whoever lives there gets to ask how they got in and to be answered, and if there is no answer, ${hit.name} is where they actually were — outside it. `
    + `Never write an entrance in the past tense or in a subordinate clause ("had come in at some point", "was already inside", "must have let themselves in"). Somebody either opened a door on the page or nobody is through it.`;
}

/** The standing law, so it does not only ever arrive as a correction after the fact. */
export function thresholdLaw(state: SaveState): string {
  const place = state.world.places?.[state.world.player_location]?.name ?? "";
  if (!isPrivateInterior(place)) return "";
  return `\nWHO IS INSIDE ${place.toUpperCase()}: exactly the people the scene list names, and nobody else. `
    + `This is somewhere private. Anyone else arriving is an event that happens ON THE PAGE — they knock, they call out, they are seen coming up the walk, and somebody who lives there decides whether to open the door. `
    + `Do not discover a person already in a room here, and do not explain one in afterwards.`;
}
