/**
 * WHAT THE WEB SEARCH LOOKS FOR, WHEN THE PLAYER DIDN'T SAY.
 *
 * With "ground with web search" on and no ((target)) in the turn, the query was built as
 *
 *     [state.world.player_location, ...canon.slice(-2)].join(" — ")
 *
 * and sent under the heading "search the web for exactly this, ignore other topics". Two things are
 * wrong with that, and a save from Rainier Valley shows both. `player_location` is an internal id —
 * "loc_muvkzoeki2za2", not "Seattle Municipal Tower". And the last two canon lines were about the
 * marriage at the centre of the story: "May is less comfortable than Rabi with abstract logic…",
 * "Affection does not give either spouse access to the other's thoughts…". So on the turn the player
 * wrote out what an Electric Service Engineer at Seattle City Light does and why the load review is
 * not his, the search went looking for Rabi and May. In the player's words: it searches for the
 * people themselves rather than the question I'm asking it to search for.
 *
 * The question is in the turn. So the query is built from what the player wrote: the sentences they
 * asked as questions, if there are any, and otherwise the opening of what they wrote, leaving out
 * their own stage directions ("I take the elevator"). Then the real name of where they are and the
 * setting, so a question about "the ESE role" is a question about Seattle City Light and not about
 * every utility on earth. Canon is not in it: canon is what
 * the story already knows, and searching for it finds nothing the story needs.
 */
import type { SaveState } from "./types";

const TOPIC_CHARS = 180;
const QUERY_CHARS = 260;

/** The question this turn is asking, as a web search. Empty when the turn has nothing to search for. */
export function turnSearchQuery(state: SaveState, action: string): string {
  const text = String(action ?? "")
    .replace(/\[\[[^\]]*\]\]/g, " ")          // director lines are for the engine
    .replace(/\(\([^)]*\)\)/g, " ")           // an explicit target is handled by the caller
    .replace(/[*_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const asked = sentences.filter((s) => /\?\s*["”']?$/.test(s) && s.split(/\s+/).length >= 3);
  // No question asked: what they wrote, minus their own stage directions ("I forward her questions
  // to HR.", "I take the elevator"), which say what the player does and nothing worth looking up.
  const told = sentences.filter((s) => !/^["“]?I\s/.test(s));
  let topic = (asked.length ? asked.join(" ") : told.length ? told.join(" ") : text).replace(/^["“]|["”]$/g, "");
  if (topic.length > TOPIC_CHARS) {
    const cut = topic.slice(0, TOPIC_CHARS);
    topic = cut.slice(0, Math.max(cut.lastIndexOf(" "), TOPIC_CHARS * 0.6)).trim();
  }
  const place = state.world?.places?.[state.world?.player_location ?? ""]?.name;
  const setting = state.world_bible?.era;
  return [topic, place && place !== "elsewhere" ? place : "", setting ?? ""]
    .map((s) => String(s).trim()).filter(Boolean).join(" — ").slice(0, QUERY_CHARS);
}
