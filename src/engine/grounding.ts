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
 * The question is in the turn. It was dug out of what the player typed by pattern (the sentences
 * ending in a question mark, else whatever wasn't their own "I ..." stage direction), and that kept
 * missing: a question put as a statement, a stage direction that didn't start with "I". Now the
 * turn's read (engine/actionread.ts, `search_topic`) says what about the real world this turn would
 * need looked up, and when it says nothing there is nothing to search for. Then the real name of
 * where they are and the setting, so a question about "the ESE role" is a question about Seattle
 * City Light and not about every utility on earth. Canon is not in it: canon is what the story
 * already knows, and searching for it finds nothing the story needs.
 */
import type { SaveState } from "./types";
import { turnRead } from "./actionread";
import { collapseSpaces } from "./text";

const TOPIC_CHARS = 180;
const QUERY_CHARS = 260;

/** The question this turn is asking, as a web search. Empty when the turn has nothing to search for.
 *  The typed line isn't read here; the turn's read is, and `action` stays only for the call site. */
export function turnSearchQuery(state: SaveState, _action?: string): string {
  let topic = collapseSpaces(turnRead(state).search_topic);
  if (!topic) return "";
  if (topic.length > TOPIC_CHARS) {
    const cut = topic.slice(0, TOPIC_CHARS);
    topic = cut.slice(0, Math.max(cut.lastIndexOf(" "), TOPIC_CHARS * 0.6)).trim();
  }
  const place = state.world?.places?.[state.world?.player_location ?? ""]?.name;
  const setting = state.world_bible?.era;
  return [topic, place && place !== "elsewhere" ? place : "", setting ?? ""]
    .map((s) => String(s).trim()).filter(Boolean).join(" — ").slice(0, QUERY_CHARS);
}
