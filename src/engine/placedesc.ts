/**
 * PLACE DESCRIPTIONS — writing down the ground the story has already walked on.
 *
 * `description_facts` is what the narrator, the offstage world-sim and the map all read as
 * currently true of a place. Three ways it goes wrong, all of them seen in one save:
 *
 *   • A place is created mid-play with no description at all — the simulator's `new_places` only
 *     requires a name — and nothing ever fills it in. The narrator has been writing scenes there
 *     for eighty turns and the record still says nothing.
 *   • A place is transformed and the description goes on asserting what used to be there.
 *   • A `places_update` replaces a whole city's description with a note about one house in it.
 *
 * The bookkeeper is asked for a places_update every turn a marked place appears in the prose (see
 * the LOCATIONS block in turn.ts) — that is the right primary channel, because the bookkeeper is
 * the thing that just read the scene. This is the backstop for what it misses: one small call per
 * place, after the turn commits, reading the prose that actually established the ground.
 *
 * Same shape as sketch completion, deliberately: pending work found from state, flushed in the
 * background, silent on failure, retried next turn.
 */
import type { Place, SaveState } from "./types";
import { contextHistory } from "./context";
import { buildMessages, complete, safeJson } from "../llm";

const PLACE_SYSTEM = `You write the PHYSICAL RECORD of one location in a story — what is actually there, as a person walking in would find it.

You are given the place's name, the world it is in, and the prose that has been set there. Everything the prose established is TRUE and BINDING: if it says the stair is open concrete with a steel rail and no door at any landing, the record says that. Where the prose is silent, invent — concretely and consistently with the world, the way a gazetteer would. Vagueness is the failure this exists to fix.

WRITE FACTS, NOT STORY. What is built here, what it is made of, its scale and layout, what is in it, what it smells and sounds like, who is ordinarily about. Present tense, plain, dense. 2–5 sentences.

NEVER write: what happened here, who did what to whom, anyone's feelings, the player, an event, a quotation, or a note about the record itself. A description that reads as narrative is wrong even when every word of it is true — the narrator reads this every turn as standing fact, and a sentence about one evening becomes a permanent feature of the ground.

If the place has been changed by something in the story, describe the CURRENT state, not the former one, and do not mention the change: a razed town is described as bare ground and ash, not as "a town that was destroyed".

Output ONLY this JSON:
{"description_facts":"", "population":{"scale":0,"who":"who is ordinarily about at a normal hour — trades and roles, never names. 0 for genuinely uninhabited ground."}}`;

/** Places whose record is blank, or flagged as predating something that happened to them. */
export function pendingPlaces(state: SaveState): string[] {
  return Object.values(state.world.places)
    .filter((p) => p.id !== "loc_offscene" && (!(p.description_facts ?? "").trim() || !!p.stale_note))
    .map((p) => p.id);
}

/** The prose this place actually appeared in, newest first — the material for describing it. */
function proseFor(state: SaveState, place: Place): string {
  const name = place.name.trim();
  if (name.length < 3) return "";
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const hits: string[] = [];
  for (const h of [...state.history].reverse()) {
    const prose = h.narrator_prose ?? "";
    if (re.test(prose) || re.test(h.player_action ?? "")) hits.push(prose);
    if (hits.length >= 3) break;
  }
  // A place the player is standing in right now is being described even without its name on the page.
  if (!hits.length && state.world.player_location === place.id) {
    hits.push(...contextHistory(state).slice(-2).map((h) => h.narrator_prose ?? ""));
  }
  return hits.join("\n\n").slice(0, 4000);
}

/**
 * Write one place's physical record. Returns true when something was written. Never touches a place
 * that already has a description and no staleness flag.
 */
export async function completePlaceDescription(state: SaveState, id: string, model: string, fallback: string): Promise<boolean> {
  const place = state.world.places[id];
  if (!place || place.id === "loc_offscene") return false;
  const blank = !(place.description_facts ?? "").trim();
  if (!blank && !place.stale_note) return false;
  const prose = proseFor(state, place);
  if (!prose.trim()) return false;              // nothing to write from; wait for the place to be played in
  const b = state.world_bible;
  const ctx = [
    `PLACE: ${place.name}`,
    `WORLD: ${b?.name ?? ""} — ${b?.era ?? ""}. ${b?.technology_level ?? ""}`,
    b?.climate_and_geography ? `CLIMATE AND GEOGRAPHY: ${b.climate_and_geography}` : "",
    (state.world.canon ?? []).length ? `CANON (binding law):\n${state.world.canon.map((x) => `- ${x}`).join("\n")}` : "",
    place.stale_note ? `\nTHE EXISTING RECORD IS OUT OF DATE: ${place.stale_note}` : "",
    !blank ? `\nTHE EXISTING RECORD (revise it; keep whatever is still standing):\n${place.description_facts}` : "",
    `\nPROSE SET HERE (binding — every physical detail in it is true of this place):\n${prose}`,
  ].filter(Boolean).join("\n");

  let g: any = null;
  try {
    const out = await complete(buildMessages(PLACE_SYSTEM, "WRITE THE RECORD:", ctx, model), model, fallback, true, 700);
    g = safeJson<any>(out.text, null);
  } catch { return false; }
  const desc = String(g?.description_facts ?? "").trim();
  if (!desc) return false;

  place.description_facts = desc.slice(0, 1200);
  delete place.stale_note;                       // the record has caught up
  place.changed_turn = state.world.current_turn;
  if (g.population && typeof g.population.scale === "number") {
    place.population = { scale: Math.max(0, Math.round(g.population.scale)), who: String(g.population.who ?? "").slice(0, 200) };
  }
  return true;
}
