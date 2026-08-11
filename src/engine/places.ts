/**
 * PLACES — what counts as somewhere, and whether it already exists.
 *
 * Extracted from turn.ts because four separate code paths can mint a location — the bookkeeper's
 * `new_places`, the offstage pass's `new_place`, a montage's `place_plan.create`, and resolvePlace
 * when the player moves — and each of them carried a different, smaller subset of the checks. Only
 * resolvePlace had all of them. The other three compared the name against existing places for EXACT
 * EQUALITY and created on any miss.
 *
 * What that produced, from real saves:
 *
 *   "Subura Rabi's Room"   the upstairs of the cookshop the player was already standing in, made a
 *                          sibling of the Subura itself. The travel log shows him leaving the
 *                          cookshop at turn 12 and not returning until 15; Marcus, Tigris and Clodia
 *                          stayed behind in a room he could see from the stairs, and for three turns
 *                          they were not in his scene, because presence is computed per location.
 *   "The villa"            alongside "Villa outside Rome" and "Rabi's villa, Tiber waterfront" in
 *                          one save. Its entire description_facts reads "The kitchen is now fully
 *                          enclosed by a stone wall […] the hearth has been replaced by a modern
 *                          four-burner gas stove": a change to a ROOM, filed as a new building.
 *   "My room"              reproducible in current code before this. "I go to my room" minted a
 *                          top-level location, after which every later mention of a room anywhere in
 *                          the world resolved to it.
 *
 * And once duplicates exist the damage compounds, because the matcher cannot tell them apart:
 * "the villa" and "my villa" both score 1.000 against all three villas and resolve to DIFFERENT
 * ones. Two people walking to the same building end up in different places over a word the player
 * varied by accident. That is the party-split in its general form.
 *
 * The engine owns one gate now, and every path goes through it.
 */
import type { SaveState } from "./types";

export const OFFSCENE = "loc_offscene";

/** Rooms that are never a destination in their own right, whoever named them. A capital letter and
 *  a possessive do not turn a bedroom into a town: "Marcus's kitchen", "Rabi's Room", "The Blue
 *  House Kitchen" and "Subura Rabi's Room" are all somewhere INSIDE somewhere. */
const STRONG_PART = /\b(rooms?|kitchen|bedroom|bathroom|washroom|restroom|toilet|hallway|corridor|landing|stairs|stairwell|staircase|doorway|threshold|attic|basement|cellar|loft|closet|pantry|cupboard|larder|scullery|foyer|entryway|vestibule|back room|front room|living room|dining room|sitting room|spare room|back office|storeroom)\b/i;
/** Ordinary when lowercase, but genuinely somewhere when somebody named it — "Kubota Garden",
 *  "Interbay Yard", "The Great Hall" are destinations; "the garden", "the yard", "the hall" are not. */
const WEAK_PART = /\b(hall|door|porch|stoop|yard|garden|lawn|driveway|garage|balcony|terrace|patio|deck|roof|rooftop|corner|booth|table|bar top|counter|window|windowsill|fireplace|hearth|couch|sofa|bed|desk|floor|ceiling|wall|upstairs|downstairs|inside|indoors|storage|entrance|lobby|alley|alleyway|sidewalk|pavement|curb|parking lot|car ?park)\b/i;

/** Is this the name of a ROOM, CORNER, or THRESHOLD rather than a place you travel to?
 *  "the kitchen", "upstairs", "the back of the bar", "outside the door" are all parts of somewhere. */
export function isPartOfAPlace(ref: string): boolean {
  const bare = ref.trim().replace(/^(the|a|an)\s+/i, "").trim();
  // THE ESCAPE HATCH USED TO RUN FIRST, AND IT SWALLOWED THE CASE IT WAS GUARDING.
  //
  // Two capitalised words or a possessive meant "somebody named this, so it is a place" — right for
  // "Kubota Garden" and "Tessa's House", and catastrophic for "Marcus's kitchen", "Rabi's Room" and
  // "Subura Rabi's Room", which have exactly the same shape and are bedrooms. Every one of them came
  // back false and became a location of its own.
  //
  // A strong room noun is now checked BEFORE the escape and cannot be escaped. The escape survives
  // for the ambiguous nouns, which is what it was written for.
  if (STRONG_PART.test(bare)) return true;
  const capped = bare.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length;
  if (capped >= 2 || /'s\b/.test(bare)) return false;
  const r = bare.toLowerCase();
  if (WEAK_PART.test(r)) return true;
  // "edge of X", "back of X", "near the X", "just outside X" — a position relative to a place
  return /^(edge|side|back|front|middle|centre|center|top|bottom|foot|head|end|corner|far end|other side)\s+of\b/.test(r)
    || /^(just )?(outside|inside|behind|beside|beneath|under|above|across from|next to|near|by|toward|towards)\b/.test(r);
}

/**
 * THE ONE GATE. Does this name already have a place, or is it a room inside one?
 *
 * Four separate code paths could mint a location — the bookkeeper's `new_places`, the offstage
 * pass's `new_place`, a montage's `place_plan.create`, and resolvePlace when the player moves — and
 * each carried a different, smaller subset of the checks. Only resolvePlace had all of them. The
 * other three compared the name against existing places for EXACT EQUALITY and created on any miss.
 *
 * What that produced, from real saves:
 *
 *   "Subura Rabi's Room"   — the upstairs of the cookshop the player was already in, made a sibling
 *                            of the Subura itself. The travel log shows him leaving the cookshop at
 *                            turn 12 and not coming back until 15; Marcus, Tigris and Clodia stayed
 *                            behind in a room he could see from the stairs, and for three turns they
 *                            were not in his scene, because presence is computed per location.
 *   "The villa"            — alongside "Villa outside Rome" and "Rabi's villa, Tiber waterfront" in
 *                            one save. Its entire description_facts is "The kitchen is now fully
 *                            enclosed by a stone wall […] the hearth has been replaced by a modern
 *                            four-burner gas stove": a change to a ROOM, filed as a new building.
 *   "My room"              — still reproducible today. The player types "I go to my room" and gets a
 *                            top-level location, after which every later mention of a room anywhere
 *                            in the world resolves to it.
 *
 * And once duplicates exist the damage compounds, because the matcher cannot tell them apart:
 * "the villa" and "my villa" score 1.000 against all three villas and resolve to DIFFERENT ones. Two
 * people walking to the same building end up in different places over a word the player varied by
 * accident. That is the party-split, in its general form.
 *
 * Returns the id this name should fold into, or null when it is genuinely somewhere new.
 */
export function existingPlaceFor(state: SaveState, name: string): string | null {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  const real = Object.values(state.world.places).filter((p) => p.id !== OFFSCENE);
  const key = raw.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();

  for (const p of real) {
    const pn = p.name.toLowerCase();
    if (pn === raw.toLowerCase() || pn.replace(/^(the|a|an)\s+/, "").trim() === key) return p.id;
  }
  // A name that opens with an existing place's name is a room in that place.
  const inside = real.find((p) => {
    const outer = p.name.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
    return outer.length >= 4 && key.length > outer.length && key.startsWith(outer);
  });
  if (inside) return inside.id;
  // Same clear-winner rule resolvePlace uses: a strong match stands alone, a weak one must also beat
  // the runner-up. Anything less and a genuinely new place would be swallowed by a loose neighbour.
  const scored = real.map((p) => ({ id: p.id, score: placeSimilarity(key, p.name.toLowerCase()) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0], next = scored[1];
  if (top && (top.score >= 0.6 || (top.score >= 0.34 && (!next || top.score >= next.score * 1.5)))) return top.id;
  return null;
}

/**
 * The gate as the three declaring paths need it: fold into an existing place, refuse a room, or say
 * go ahead. `context` names the caller for the log, since a place appearing from nowhere is exactly
 * the thing that was impossible to trace.
 */
export function placeIntent(state: SaveState, name: string, context: string): { id: string } | { create: true } | null {
  const existing = existingPlaceFor(state, name);
  if (existing) {
    if (state.world.places[existing].name.toLowerCase() !== String(name).trim().toLowerCase()) {
      console.info(`[places] ${context}: "${name}" folded into "${state.world.places[existing].name}"`);
    }
    return { id: existing };
  }
  if (isPartOfAPlace(name)) {
    console.info(`[places] ${context}: "${name}" is a room, not a location — kept as prose`);
    return null;
  }
  return { create: true };
}

/** How much two place names look like the same place. Token overlap weighted toward the rarer,
 *  longer words, so "kitchen doorway" scores 0 against "The Rusty Anchor" but "the rusty anchor bar"
 *  scores high. Substring matching alone was useless here — "kitchen" shares no substring with
 *  "Tessa's house" even though a model meant the latter. */
export function placeSimilarity(a: string, b: string): number {
  // Generic nouns are everywhere in place names ("service", "center", "house", "street"), so two
  // unrelated places share them and score a false match. They count for a fraction of their length.
  // Coverage is measured in BOTH directions and the better taken: a reference may carry extra words
  // ("sole service front counter") or fewer ("the anchor") than the place name it names.
  const GENERIC = new Set(["service", "center", "centre", "house", "street", "road", "avenue", "place",
    "building", "office", "shop", "store", "station", "hall", "room", "club", "bar", "cafe", "market", "north",
    "south", "east", "west", "old", "new", "great", "little", "upper", "lower", "main", "city", "town"]);
  const STOP = new Set(["the", "a", "an", "of", "at", "in", "on", "near", "by", "and", "to"]);
  const toks = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  const weight = (w: string) => (GENERIC.has(w) ? w.length * 0.15 : w.length);

  const side = (X: Set<string>, Y: Set<string>) => {
    let shared = 0, distinctive = false;
    for (const w of X) {
      if (Y.has(w)) { shared += weight(w); if (!GENERIC.has(w)) distinctive = true; continue; }
      for (const v of Y) if (v.length > 3 && w.length > 3 && (v.startsWith(w) || w.startsWith(v))) {
        shared += Math.min(weight(v), weight(w)) * 0.7;
        if (!GENERIC.has(w) && !GENERIC.has(v)) distinctive = true;
        break;
      }
    }
    const total = [...X].reduce((n, w) => n + weight(w), 0);
    if (!total) return 0;
    const cov = Math.min(1, shared / total);
    // A place whose whole name is ordinary words ("Sole Service") must still match itself, so high
    // coverage alone can carry it. A reference that merely brushes a generic word is held down.
    return distinctive ? cov : cov >= 0.85 ? cov : cov * 0.35;
  };
  return Math.max(side(A, B), side(B, A));
}


/**
 * ONE-SHOT REPAIR for saves that already carry the duplicates.
 *
 * Stopping the four creation paths does nothing for a world that already has three villas in it, and
 * the duplicates are not inert: `existingPlaceFor("the villa")` finds the phantom by exact name and
 * sends the player there instead of to the villa he lives in.
 *
 * A PHANTOM is a place nobody has ever been. No occupants, no population, never in the travel log,
 * not where the player is standing, not somewhere the story ever put anyone. In the save that
 * surfaced this it was "The villa", whose entire description_facts read "The kitchen is now fully
 * enclosed by a stone wall […] the hearth has been replaced by a modern four-burner gas stove" — a
 * `places_update` about a ROOM that got filed as a new building, sitting beside "Villa outside Rome"
 * and "Rabi's villa, Tiber waterfront".
 *
 * Deliberately timid, because merging save data is not reversible. A phantom is only folded when the
 * match is unambiguous: it never touches a place anyone occupies, has been to, or has a population
 * for, and when two candidates are equally good it leaves the phantom alone rather than guess. Its
 * description is carried across rather than dropped — that kitchen is a real thing the player did.
 */
export function mergePhantomPlaces(state: SaveState): string[] {
  const merged: string[] = [];
  const places = Object.values(state.world?.places ?? {});
  if (places.length < 2) return merged;
  const visited = new Set((state.travel_log ?? []).map((t: { place: string }) => t.place));
  const occupied = new Set<string>();
  for (const c of Object.values(state.characters ?? {})) if (c.location) occupied.add(c.location);

  // A place nobody has ever been AND that nobody troubled to describe. The occupancy tests alone are
  // not enough: a real, richly-written location can be empty at this exact moment and carry no
  // population field, and without this guard the repair would happily delete the described building
  // and keep the stub that happened to have someone standing in it. A stub is a stub by its text.
  const AUTHORED_LEN = 250;
  const isPhantom = (p: (typeof places)[number]) =>
    p.id !== OFFSCENE
    && p.id !== state.world.player_location
    && !visited.has(p.id)
    && !occupied.has(p.id)
    && !(p.contains?.length)
    && !p.population
    && (p.description_facts ?? "").trim().length < AUTHORED_LEN;

  for (const p of places.filter(isPhantom)) {
    const key = p.name.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
    const scored = places
      .filter((q) => q.id !== p.id && q.id !== OFFSCENE && !isPhantom(q))
      .map((q) => ({ q, score: placeSimilarity(key, q.name.toLowerCase()) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0], next = scored[1];
    if (!top || top.score < 0.9) continue;              // not obviously the same place

    // A TIE MEANS IT IS A DUPLICATE OF SOMETHING, JUST NOT KNOWABLY WHICH. Both halves of the repair
    // are worth having and only one of them is safe on a tie. Removing the phantom is right either
    // way — "The villa" in the save ties against "Villa outside Rome" and "Rabi's villa, Tiber
    // waterfront", and while it exists `existingPlaceFor("the villa")` finds it by exact name and
    // sends the player to an empty room instead of the house he lives in. Carrying its description
    // across is the part that needs to be sure, because welding a rebuilt kitchen onto the wrong
    // building is a fact the story will then assert. So on a tie the place goes and the text does not.
    const tied = !!next && next.score >= top.score;
    const facts = (p.description_facts ?? "").trim();
    if (!tied && facts && !(top.q.description_facts ?? "").includes(facts)) {
      top.q.description_facts = `${top.q.description_facts ?? ""}${top.q.description_facts ? " " : ""}${facts}`.slice(0, 1200);
    }
    delete state.world.places[p.id];
    merged.push(tied ? `"${p.name}" removed as a duplicate` : `"${p.name}" folded into "${top.q.name}"`);
    console.info(tied
      ? `[places] removed the duplicate "${p.name}" — it matched both "${top.q.name}" and "${next!.q.name}", so its description was not carried anywhere`
      : `[places] repaired a duplicate: "${p.name}" folded into "${top.q.name}"`);
  }
  return merged;
}
