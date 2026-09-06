/**
 * BEARING — how a person stands in a room when nothing is wrong.
 *
 * A player, on a cast of five: "It seems like being shy. Or being confident. Or being all these
 * personality types is not arising within the emergent behavior of the game. All the characters are
 * obnoxious and direct and maximally efficient."
 *
 * He is right, and the reason is not the narrator. It is that nothing ever tells the narrator.
 *
 * WHAT THE ENGINE ALREADY HOLDS, AND WHERE IT GOES.
 *
 *   · `gregariousness` (0–1) is written by the Forge, the sketch pass, the bookkeeper's
 *     new_characters, and the preset files. It is READ in exactly one place in the whole engine —
 *     social.ts, for how fast two people's bond drifts while offscreen. Nothing renders it. A 0.35
 *     and an 0.85 are handed to the narrator identically, so the one number that could mean shy has
 *     never once reached the point of writing.
 *   · `attachment.style` is read in six places and rendered in four, and every one of them is a
 *     STRESS reading: `under_threat` at relaxation ≤ −3, the clenched branch at ≤ −7, `soothed_by`
 *     at ≥ +4. Between −3 and +4 — where the ordinary turns of an ordinary scene sit — the narrator
 *     is told nothing about how this person is with people. Disposition exists in this engine only
 *     as a stress response.
 *   · `conscience` reaches the card as a line about whether they will do harm, which is a moral
 *     reading and not a social one. It says nothing about whether they defer.
 *
 * So for most turns of most scenes the narrator has a voice card (what words this person has) and
 * no bearing (what they do with a room), and it fills the gap with its default, which is a fluent
 * adult who says the right thing at the right length and never fumbles it. Five of those in a cast
 * read exactly as reported: obnoxious, direct, maximally efficient.
 *
 * THIS IS CLIMATE, NOT WEATHER, and the engine already uses that distinction for mood (KERNEL §2:
 * "weather, not climate"). Relaxation is the weather and aperture.ts renders it. Capacity is the
 * resting point — the climate — and nothing rendered its social half. A settled shy person is still
 * shy; a furious deferential person is still deferential, and defers while furious. So bearing is
 * read off the standing card and the RESTING point, never off this turn's relaxation, and it says
 * so out loud, because the stress notes are already there and must not be contradicted.
 *
 * AND IT IS MOSTLY PERMISSION. Everything the default suppresses is ordinary: not finishing the
 * sentence, answering the easier question, saying the small thing instead of the true one, taking
 * three goes at it, apologising for a thing that needs no apology, going quiet and letting somebody
 * else fill it. None of that is a flaw to be written around. It is most of what being a person in a
 * room looks like, and the reason nobody in this cast does any of it is that nobody asked them to.
 */
import type { Identity, Psyche, SaveState } from "./types";

/* ── THE THREE AXES ─────────────────────────────────────────────────────────── */

/** How much room they take, before anybody does anything. From `gregariousness`. */
export type Room = "recedes" | "even" | "fills";
/** How they get at something difficult. From `attachment.style`. */
export type Approach = "around" | "at" | "straight" | "both";
/** Whose claim comes first when the two conflict. From `conscience` against `gregariousness`. */
export type Claim = "defers" | "balanced" | "takes";

export interface Bearing {
  room: Room;
  approach: Approach;
  claim: Claim;
  /** Habitually braced or habitually easy — the resting point, not this turn. */
  climate: "braced" | "middling" | "easy";
  /** Low gregariousness against a high sense of the other person's claim: the thing the player
   *  named first, and the one combination the engine could already have expressed and never did. */
  shy: boolean;
  /** Nothing on this card is away from the middle, so there is nothing to say about them. */
  unremarkable: boolean;
}

/** Deliberately wide middles. A note that fires for everybody is a note nobody reads, and the
 *  claim being made is only ever "this person is NOT the default", which needs real distance. */
export const RECEDES_AT = 0.4;
export const FILLS_AT = 0.68;
export const DEFERS_AT = 0.72;
export const TAKES_AT = 0.4;

export function readBearing(ident: Identity | undefined, psyche?: Psyche): Bearing {
  const greg = typeof ident?.gregariousness === "number" ? ident.gregariousness : 0.5;
  const consc = typeof ident?.conscience === "number" ? ident.conscience : 0.6;
  const style = String(ident?.attachment?.style ?? "").toLowerCase();
  // The resting point the forge stamped, not the one the last hour moved — see the header.
  const cap = typeof psyche?.capacity_born === "number" ? psyche.capacity_born
    : typeof psyche?.capacity === "number" ? psyche.capacity : 2;

  const room: Room = greg <= RECEDES_AT ? "recedes" : greg >= FILLS_AT ? "fills" : "even";
  const approach: Approach = style === "avoidant" ? "around"
    : style === "anxious" ? "at"
    : style === "disorganized" ? "both"
    : "straight";
  const claim: Claim = consc >= DEFERS_AT ? "defers" : consc <= TAKES_AT ? "takes" : "balanced";
  const climate = cap <= -2 ? "braced" : cap >= 3 ? "easy" : "middling";

  // SHY IS NOT LOW GREGARIOUSNESS. Somebody who simply prefers their own company is content in a
  // corner; shyness is wanting the contact and flinching at the cost of it, which in the fields
  // this engine already keeps is a small social appetite carried alongside a large sense of what
  // the other person is owed — or an attachment that goes at closeness sideways.
  const shy = room === "recedes" && (claim === "defers" || approach === "at" || climate === "braced");

  const unremarkable = room === "even" && claim === "balanced" && approach === "straight" && climate === "middling";
  return { room, approach, claim, climate, shy, unremarkable };
}

/* ── WHAT IT SOUNDS LIKE ────────────────────────────────────────────────────── */

/** This person's pronouns, from the field the whole engine treats as binding — the same reason
 *  aperture.ts carries its own copy: a note about a woman that says "they" has drifted in the one
 *  place the narrator is told never to drift. Falls back to they/them, which is also what an
 *  unfilled field should read as. */
function pronounsOf(raw: string | undefined): { subject: string; possessive: string } {
  const parts = String(raw ?? "").toLowerCase().split(/[/,\s]+/).map((x) => x.trim()).filter(Boolean);
  const subject = parts[0] || "they";
  const object = parts[1] || (subject === "they" ? "them" : subject);
  const possessive = parts[2] || (subject === "she" ? "her" : subject === "he" ? "his" : subject === "they" ? "their" : `${object}s`);
  return { subject, possessive };
}

type Pn = { subject: string; possessive: string };

const ROOM_LINE: Record<Room, (p: Pn) => string> = {
  recedes: () => "takes up less room than the situation allows: waits for a gap rather than making one, lets a sentence get finished by somebody else, ends up at the edge of the group without having decided to",
  even: () => "takes an ordinary amount of room",
  fills: () => "takes up room without noticing it: starts talking before the other person has stopped, fills a silence rather than letting it sit, follows a thought out loud all the way to the end of it",
};

const APPROACH_LINE: Record<Approach, (p: Pn) => string> = {
  around: (p) => `goes AROUND a hard thing rather than at it — raises the adjacent subject, makes it a joke, ends the topic with a flat sentence and starts doing something with ${p.possessive} hands`,
  at: () => "goes AT a hard thing and keeps going — asks again in different words, follows it across the room, needs the answer now, says the part that will be regretted later",
  straight: () => "says the hard thing once, plainly, and then lets it sit there without chasing it",
  both: () => "does both inside one exchange — goes at it, then drops it mid-sentence and changes the subject, and neither half cancels the other",
};

const CLAIM_LINE: Record<Claim, (p: Pn) => string> = {
  defers: (p) => `gives the other person's claim more weight than ${p.possessive} own: checks whether it is alright, apologises for things that need no apology, offers the version that will be easier to hear, and only says the thing actually wanted on the second or third pass`,
  balanced: () => "weighs their own claim about as heavily as anyone else's",
  takes: () => "does not weigh the other person's claim much at all: asks for the thing, keeps what is handed over, and does not soften the ask on the way out",
};

/**
 * The note itself.
 *
 * Silent for anybody whose card sits in the middle on every axis — a person who takes ordinary room
 * and says things plainly is the default, and the default needs no instruction. Capped at three,
 * because this is per-turn context and it is paid for every turn.
 */
export function bearingNote(state: SaveState, presentIds: readonly string[]): string {
  const rows: string[] = [];
  for (const id of presentIds) {
    if (id === "char_player" || rows.length >= 3) continue;
    const c = state.characters?.[id];
    if (!c) continue;
    const b = readBearing(c, state.condition?.[id]?.psyche);
    if (b.unremarkable) continue;
    const pn = pronounsOf(c.pronouns);
    const bits = [
      b.room !== "even" ? ROOM_LINE[b.room](pn) : "",
      b.claim !== "balanced" ? CLAIM_LINE[b.claim](pn) : "",
      b.approach !== "straight" ? APPROACH_LINE[b.approach](pn) : "",
      b.climate === "braced" ? "is braced as a resting state — not upset, just never quite loose in company"
        : b.climate === "easy" ? "is easy in company as a resting state, and stays easy under things that would tighten most people" : "",
    ].filter(Boolean);
    if (!bits.length) continue;
    // Written as an operation rather than as a definition of shyness: an instruction shaped like an
    // epigram teaches the narrator that shape, which is the whole argument of maxims.ts and is
    // enforced by tools/promptlint.ts.
    const shy = b.shy ? ` In a scene: ${pn.subject} waits to be asked rather than starting, gives the shorter answer first, and reaches the thing ${pn.subject} actually came to say on the second or third attempt, or leaves without saying it. ${pn.subject.charAt(0).toUpperCase()}${pn.subject.slice(1)} wants to be there the whole time that is happening.` : "";
    rows.push(`${c.name} ${bits.join("; ")}.${shy}`);
  }
  if (!rows.length) return "";
  return `\n\n=== HOW THESE PEOPLE STAND IN A ROOM (this is climate, not this minute) ===\n· ${rows.join("\n· ")}\n`
    + `This is who they are across every mood, including the ones the state notes above describe. A settled shy person is still shy; a furious deferential person defers while furious.\n`
    + `AND MOST OF IT IS PERMISSION. Nobody in this scene has to be efficient. A person may not finish the sentence, may answer the easier question instead of the one asked, may say the small true thing rather than the large one, may need three goes at it, may apologise for something that needs no apology, may go quiet and let somebody else fill it, may agree out loud while not agreeing. `
    + `If everybody in this scene says exactly what they mean at exactly the right length and lands it, they have all been written by the same person, and the differences printed above are the ones that were supposed to stop that.`;
}
