/**
 * POPULATION — the people who are not characters.
 *
 * The engine models a cast: carded, remembered, capped by max_central_characters because
 * full-fidelity people are expensive. That cap is correct. What was missing is the OTHER tier —
 * the ordinary human traffic that makes a place a place. A `Place` had `contains`, which holds
 * cast members only, so a market with no cast member standing in it was, to the narrator, an
 * empty room. PRESENT is law and PRESENT was empty, and the contract says the state is true and
 * your inventions are not. So the narrator did the correct thing and wrote a deserted world.
 *
 * A player who built a town with a market, a hospital, walls and a beach walked through all of it
 * alone, sat on a board in the river for four turns because there was nobody to talk to, and then
 * unmade the town.
 *
 * These people are never carded and never remembered. They are weather with faces: a scale figure
 * and one line on who they are, so a scene can have a crowd in it without the crowd becoming
 * sixteen new records with drives and voice cards.
 */
import type { Place, SaveState } from "./types";

export interface Population { scale: number; who: string }

/**
 * Ordinary daytime traffic implied by what a place IS, for places authored before the field
 * existed (every place in every save to date) or created without one.
 *
 * Matched against the NAME ONLY, most specific first. Matching the description as well was the
 * obvious thing and it is wrong: descriptions constantly mention OTHER places — "a soot-stained
 * building near the city wall", "a manor on the outskirts of the city", "the forest north of the
 * city" — and every one of those came back as four thousand hawkers. A place's name is what it is;
 * its description is largely where it is. Inference is a backfill, so it is better for it to say
 * nothing than to put a crowd in a forest; anything it misses can be authored explicitly.
 */
const KINDS: { re: RegExp; scale: number; who: string }[] = [
  { re: /\b(forest|woods?|moor|waste|wilderness|mountains?|wilds)\b/i, scale: 0, who: "" },
  { re: /\b(warrens?|slums?|rookery|alleys?)\b/i, scale: 150, who: "the poor, beggars, thieves watching from doorways, families crowded into rooms" },
  { re: /\b(docks?|harbou?r|quay|wharf|pier)\b/i, scale: 120, who: "dockhands, bargemen, fishwives, factors counting cargo, boys hauling rope" },
  { re: /\b(inn|tavern|alehouse|pub)\b/i, scale: 30, who: "drinkers, travellers, a serving girl, someone asleep in a corner" },
  { re: /\b(temple|cathedral|church|shrine|chapel)\b/i, scale: 60, who: "worshippers, penitents, a sexton, someone praying who does not want to be spoken to" },
  { re: /\b(hospital|infirmary|almshouse)\b/i, scale: 40, who: "the sick and those sitting with them, attendants moving between beds" },
  { re: /\b(gates?|walls?|garrison|barracks)\b/i, scale: 20, who: "guards on watch, travellers waiting to pass, a serjeant with a slate" },
  { re: /\b(markets?|bazaar|squares?|fair)\b/i, scale: 200, who: "stallholders, buyers haggling, porters, cutpurses working the press, children underfoot" },
  { re: /\b(castle|palace|keep|citadel)\b/i, scale: 80, who: "servants, guards on rotation, petitioners waiting, clerks with errands" },
  { re: /\b(forge|smithy|workshop|mill|bakery|brewery)\b/i, scale: 4, who: "whoever works here and whoever is waiting on the work" },
  { re: /\b(farms?|fields?|steading|orchard)\b/i, scale: 15, who: "labourers at work, a foreman, children carrying water" },
  { re: /\b(beach|shore|strand)\b/i, scale: 12, who: "a few people walking, someone gathering shellfish, children at the waterline" },
  { re: /\b(roads?|track|highway|bridge)\b/i, scale: 10, who: "travellers passing, a carter, someone walking the other way" },
  { re: /\b(estate|manor|hall|house|cottage|lodge)\b/i, scale: 8, who: "household staff going about the day's work" },
  { re: /\b(cities|city|capital)\b/i, scale: 4000, who: "citizens on their own business — hawkers, porters, clerks, beggars, children, off-duty guards" },
  { re: /\b(towns?|villages?|hamlets?|settlements?)\b/i, scale: 400, who: "townsfolk going about the day — tradesmen, wives at the well, carters, idlers on the step" },
];

/** Explicit "nobody lives here" markers — an automated place, a ruin, a place stated as empty. */
const DESERTED = /\b(deserted|abandoned|empty|ruin(s|ed)?|no one (lives|works|is)|nobody|automated|autonomous|unmanned|uninhabited|razed|burn(ed|t) out)\b/i;

/**
 * What is ordinarily here. An explicit `population` always wins — including an explicit zero,
 * which is how a place states that it really is deserted. Otherwise inferred from the name;
 * unrecognised places get nothing rather than a guess.
 */
export function populationOf(place: Place | undefined): Population | null {
  if (!place) return null;
  if (place.population) return place.population.scale > 0 ? place.population : null;
  const name = place.name ?? "";
  // The description gets exactly one vote, and it is a veto: a place that says it is empty is.
  if (DESERTED.test(name) || DESERTED.test(place.description_facts ?? "")) return null;
  for (const k of KINDS) {
    if (k.re.test(name)) return k.scale > 0 ? { scale: k.scale, who: k.who } : null;
  }
  return null;
}

/** "about 200 people" → a phrase a prompt can use without pretending to a census. */
function scaleWord(n: number): string {
  if (n >= 2000) return "thousands of people";
  if (n >= 500) return "many hundreds of people";
  if (n >= 150) return "a couple of hundred people";
  if (n >= 50) return "dozens of people";
  if (n >= 15) return "a dozen or two people";
  return "a handful of people";
}

/** One line per place for the LOCATIONS block, so the world reads as inhabited everywhere. */
export function populationLine(place: Place): string {
  const p = populationOf(place);
  return p ? ` — ordinarily ${scaleWord(p.scale)} about: ${p.who}` : "";
}

/**
 * The directive for the room the player is standing in. This is the one that matters: PRESENT
 * lists cast members and nothing else, so without this the narrator's only honest reading of a
 * populated market with no cast member in it is that the market is empty.
 *
 * It licenses anonymous people explicitly, and says the thing that keeps them anonymous — the
 * bookkeeper cards anyone who speaks under a capitalised name, so the crowd stays unnamed unless
 * the player reaches for someone in particular.
 */
export function crowdDirective(state: SaveState): string {
  const place = state.world.places[state.world.player_location];
  const pop = populationOf(place);
  if (!pop) return "";
  const castHere = state.world.present.filter((id) => id !== "char_player" && state.characters[id]).length;
  const alone = castHere === 0;
  return `\nTHE PLACE IS INHABITED — ${place.name} ordinarily has ${scaleWord(pop.scale)} about it: ${pop.who}. These are NOT characters and never will be; they are the texture of a populated place, and they exist whether or not anyone from the cast is standing here.${alone ? ` No one from the cast is in this scene, and that does NOT mean the player is alone — it means nobody the story tracks is here. Do not write this place as deserted, silent, or emptied unless the state says it has been emptied.` : ""} Let them be present the way people actually are: work going on, voices carrying, someone in the way, someone watching, someone who wants something small. They may act, react, be spoken to, and answer. Keep them ANONYMOUS — trades, roles and descriptions, never a capitalised name and never a personal history — so they stay crowd instead of becoming cast. If the player singles someone out and keeps them, the bookkeeper will make them real.`;
}
