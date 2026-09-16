/**
 * WHAT THEIR HANDS ARE DOING WHILE THE CONVERSATION HAPPENS.
 *
 * A player's report: "For the most part all my NPCs just stand around uselessly. But in reality
 * people are texting, on their phones, watching shows, doing stuff. Multitasking."
 *
 * He is right, and the engine asked for it in four separate places, none of them wrong alone.
 *
 *   · THE ONE RULE THAT COVERS THIS IS IN THE CACHED PREFIX. NARRATOR_SYSTEM carries "EVERY PRESENT
 *     CHARACTER ACTS OR EXITS — a character whose entire presence across a scene is posture, arms
 *     crossed, jaw working, had not moved, is furniture". That rule is excellent and it sits tens of
 *     thousands of characters back, which this engine has written down three times (authored.ts
 *     habitDirective, maxims.ts, promptlint.ts) means REFERENCE rather than instruction.
 *   · AND IT SUPPLIES NO MATERIAL. "Does something with consequence" asks the narrator to invent an
 *     action out of nothing, every turn, for everybody in the room. What a model reaches for when it
 *     has to invent an action and has nothing to invent from is a posture — which is the exact thing
 *     the rule bans, arrived at by obeying it.
 *   · `current_activity` HAS BEEN ON THE IDENTITY TYPE THE WHOLE TIME. registerCharacter copies it,
 *     Cast.tsx prints it, sanitize coerces it, and no prompt in this engine has ever contained it.
 *     Nothing writes it either. It is a field that was declared and then forgotten.
 *   · THE ONE PLACE THE WORLD'S TECHNOLOGY REACHES THE NARRATOR, IT IS A PROHIBITION. prompts.ts
 *     sends technology_level as "WHAT WORKS HERE (tech law — do NOT let anyone use what this rules
 *     out)". So the model is told what the world's objects may never be and never told that they are
 *     lying around being used. Both halves are needed and only the ceiling was sent.
 *
 * The two player-side halves of this were already built and are worth reading first: consult.ts
 * (when the player reads something, the reading goes on the page) and scene.ts screenPrivacyNote
 * (what the room can perceive of a screen four inches from one face). Both are about the player's
 * device. Nothing has ever been about anybody else's.
 *
 * ── AND THE SECOND HALF, WHICH IS THE PART THE ENGINE HAD BACKWARDS ─────────────────────────────
 *
 * The same report: "The more tense, the more stuff they tend to be doing all at once, they aren't
 * pissed they're just splitting their attention a lot."
 *
 * Every band this engine has says the opposite. aperture.ts maps relaxation to attention width and a
 * clenched body "narrows onto the one thing". deriveVoice at r ≤ −7 writes "clenched — under
 * pressure and it is going somewhere". clench.ts renders a low reading as misreading and fragments.
 * All three are describing ACUTE threat, where narrowing is what a body does and the engine is
 * right. None of them describes the ordinary case, which is somebody carrying four open loops
 * through a conversation they did not want to have.
 *
 * So this is a SECOND AXIS rather than a correction to the first. Aperture asks how wide the
 * attention is — what can catch it. This asks how many things it is divided between. A woman at a
 * family dinner with a deadline on Monday has a narrow aperture (everything she says comes back to
 * her own thing) and high occupation (the phone, the dishes, the television, the door). Those are
 * both true at once and the engine could only say the first.
 *
 * WHERE IT STANDS DOWN. register.ts reads the scene for intimacy, danger and hush, and every
 * unrefusable per-turn injection in this engine stands down in those — for the reason its header
 * records, which is three mandates landing in a shower during sex. A held breath in the dark is the
 * one state where attention really does collapse to one thing, so the block goes silent there and
 * aperture has the floor. It is also exactly the distinction the report draws: an ordinary tense
 * evening is not a knife in a corridor, and only the second one narrows.
 */
import type { SaveState, Identity, Condition } from "./types";
import { clipText } from "./text";

/** How many things the hands and the eyes are divided between. */
export type Occupation = "single" | "occupied" | "split" | "scattered";

/** Below this the loops start outrunning the person carrying them. */
export const SPLIT_AT = -2;
/** And below this they are visibly failing to hold all of it. */
export const SCATTERED_AT = -6;

/**
 * The band, from the body and the scene.
 *
 * `guarded` collapses it whatever the reading — see the header. Everything else runs off relaxation,
 * on the same scale aperture.ts uses, in the same direction the report describes: the lower it is,
 * the more is going at once.
 *
 * NOTE THE FLOOR. A settled person is `occupied` rather than `single`, and that is the whole fix for
 * "standing around uselessly": the baseline for a human being in a room is doing something, and one
 * thing is the fewest a person has going outside of a held moment. `single` is reserved for the
 * scene that has genuinely taken everything else away.
 */
export function occupationOf(cond: Condition | undefined, guarded: boolean): Occupation {
  if (guarded) return "single";
  const rel = cond?.psyche?.relaxation ?? 0;
  if (rel <= SCATTERED_AT) return "scattered";
  if (rel <= SPLIT_AT) return "split";
  return "occupied";
}

/** What each band asks for on the page, in things a reader could point at. */
const BAND_NOTE: Record<Occupation, string> = {
  single: "",
  occupied: "one thing going alongside the talking, picked up and put down",
  split: "two or three things going at once, each of them getting part of the attention",
  scattered: "four or five things going at once, none of them finished, several started again",
};

/**
 * THE THINGS THIS PERSON COULD ACTUALLY HAVE TO HAND, out of the record.
 *
 * Nothing here is invented and nothing is a category. The room is already described to the narrator
 * (places reach it at 57% coverage) and the world's material list is already there as the tech law,
 * so repeating either would be paying twice for text the model can already see. What is sent is the
 * part that is dark: what this person was doing last turn, what they are carrying, and the standing
 * interests that say which way they reach when nothing is asked of them.
 */
export function toHand(state: SaveState, id: string): { was: string; carrying: string[]; owed: string[] } {
  const c = state.characters?.[id];
  const cond = state.condition?.[id];
  return {
    was: clipText(String(c?.current_activity ?? "").trim(), 120),
    carrying: (cond?.inventory ?? []).map((i) => String(i?.name ?? "").trim()).filter(Boolean).slice(0, 4),
    /* NOT `texture`. The digest already prints it — "texture: (raises these unprompted) …", up to
     * four items, on every turn this character is in scene. Repeating it here would pay for the same
     * four strings twice a turn to say the same thing, which is the economy voiceAnchor's own header
     * warns about in the other direction. What is sent below is only the part no prompt carries. */
    owed: openLoops(state, id),
  };
}

/**
 * WHO IS ON THE OTHER END OF IT.
 *
 * A phone checked for no reason is set dressing, and a cast of people fiddling with props is a
 * different kind of empty from a cast standing still. What makes the gesture mean something is that
 * somebody who is not in this room is waiting, or is being waited on — which is the whole of what a
 * person is doing when they turn a phone over for the fourth time.
 *
 * The ledger for that already exists and is dark. `world.promises` records who swore what to whom;
 * measured by tools/audit.ts on a 45-turn save, sixteen stored promise fields reached zero prompts.
 * An open promise with this person at either end is exactly the reason they keep looking.
 *
 * Capped at two and stated as the bare obligation, because this is a reason for a gesture rather
 * than a subject for a speech — the promise system has its own directives for pressing one.
 */
function openLoops(state: SaveState, id: string): string[] {
  const nameOf = (cid: string) => String(state.characters?.[cid]?.name ?? "").trim();
  const out: string[] = [];
  for (const p of state.world?.promises ?? []) {
    if (p?.status !== "open") continue;
    if (p.from === id) { const who = nameOf(p.to); if (who) out.push(`owes ${who} — ${clipText(p.text, 60)}`); }
    else if (p.to === id) { const who = nameOf(p.from); if (who) out.push(`waiting on ${who} — ${clipText(p.text, 60)}`); }
    if (out.length >= 2) break;
  }
  return out;
}

/** One row per present character, or "" when there is nothing on file worth sending. */
function rowFor(state: SaveState, id: string, guarded: boolean): string {
  const c = state.characters?.[id] as Identity | undefined;
  if (!c || id === "char_player") return "";
  if (c.status === "dead" || c.status === "departed") return "";
  const band = occupationOf(state.condition?.[id], guarded);
  if (band === "single") return "";
  const { was, carrying, owed } = toHand(state, id);
  const rel = state.condition?.[id]?.psyche?.relaxation ?? 0;
  const bits = [
    was ? `still: ${was}` : "",
    carrying.length ? `on them: ${carrying.join(", ")}` : "",
    owed.length ? `unfinished with somebody not here: ${owed.join("; ")}` : "",
  ].filter(Boolean);
  return `${c.name} (${rel.toFixed(1)}) — ${BAND_NOTE[band]}.${bits.length ? ` ${bits.join(". ")}.` : ""}`;
}

/**
 * The block, for the end of the directive where instructions live.
 *
 * MOSTLY EVIDENCE, AND SHORT. The rows are the part that does the work — they are what this turn
 * knows about these particular hands — and the standing text under them is the smallest thing that
 * makes the rows actionable. A first cut ran to nine hundred tokens every turn, which is more than
 * the reviser's whole prompt for a note that fires on most turns of most saves; the paragraph
 * explaining that a world without phones has whetstones in it was being paid for on every turn of
 * every contemporary save. What is left is around three hundred, and the two conditional lines are
 * sent only to the rooms they are about.
 *
 * Silent when the register is guarded, and silent when nobody present has anything on file.
 */
export function occupiedDirective(state: SaveState, presentIds: readonly string[], guarded = false): string {
  if (guarded) return "";
  const rows = presentIds.map((id) => rowFor(state, id, guarded)).filter(Boolean);
  if (!rows.length) return "";
  const scattered = presentIds.some((id) => occupationOf(state.condition?.[id], guarded) === "scattered");
  const loops = rows.some((r) => r.includes("unfinished with somebody not here"));
  return `\n[WHAT THEIR HANDS ARE ON WHILE THIS CONVERSATION HAPPENS.\n· ${rows.join("\n· ")}
Each of them was in the middle of something before this turn and goes back to it, out of what this world contains and what is in this room. Name it: what they pick up, put down, half-watch, check and check again, finish badly because they were listening. A line is spoken while the hands keep going; an answer comes a beat late; somebody looks up, answers, looks back down.
What is on a screen or a page stays with whoever is holding it — nobody reads it across the room or guesses it right. The room gets the body: the angle, a thumb stopping, how long, whether they answer when spoken to.${loops ? `
Where a row names something unfinished with somebody who is not here, that is why they keep checking, and it stays a gesture: they do not say who it is or explain the delay.` : ""}${scattered ? `
Somebody at the bottom of that scale is losing hold of it one piece at a time — an answer started and abandoned for whatever was in the other hand, a sentence come back to and lost, a cup put down somewhere they will not find it, a yes to something they did not hear. Write it as attention going and returning. They are short with people because they are handling four things, which is what busy sounds like; anger goes on the page only where this turn's state says they are angry.` : ""}]`;
}

/**
 * THE LINE THAT CARRIES ACROSS THE TURN, for the character card.
 *
 * Without this the block above resets every turn and a woman puts her phone down and picks it up
 * again forever, because nothing tells the next turn what the last one established. The bookkeeper
 * records it as a fact (`doing`) and it comes back here.
 */
export function activityLine(c: Identity | undefined): string {
  const a = String(c?.current_activity ?? "").trim();
  return a ? ` Doing: ${clipText(a, 110)}.` : "";
}
