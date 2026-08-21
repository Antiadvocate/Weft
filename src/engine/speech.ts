/**
 * THE SPEECH FLOOR — people who are in the room are in the conversation.
 *
 * Measured over one save, 178 turns, 154 of them with somebody else present:
 *
 *   · the median turn is 12% spoken words. 71% of turns are under 20%. 32% are under 5%.
 *   · 29 turns have people present and NOT ONE line of dialogue anywhere in them — 447 words,
 *     two people in the room, nobody speaks.
 *   · Miranda is present for 136 turns and gets no line in 87 of them. Sixty-four percent.
 *   · of the 691 lines anybody does say, half are six words or fewer and a third are four or fewer.
 *     Median line: seven words.
 *   · somebody goes "very still" 100 times across 80 turns — 45% of every turn in the game.
 *
 * That is not a story with quiet moments in it. It is a story in which the standard response to
 * being spoken to is to stand there, and the standard line is a fragment.
 *
 * WHY IT HAPPENS, and it is not the model being lazy. Two engine causes, both of them the engine
 * telling the narrator to do exactly this:
 *
 *  1. The relaxation bands describe a clenched person with six words and every one of them means
 *     SAYS LESS: clipped, guarded, barbed, withdrawn, cold, braced. So an angry character has one
 *     behavior available and it is silence — while the engine's OWN attachment model, two fields
 *     over, says half of all people escalate under threat: they pursue, they re-check, they
 *     protest. The band overrode the model. (Fixed in prompts.ts alongside this.)
 *  2. Every character built after the opening got their traits from a pass whose whole instruction
 *     was to write personality traits, so they came out as adjectives, and an adjective gives a
 *     person nothing to do in a scene. (Fixed in sketch.ts and coerce.ts alongside this.)
 *
 * Both of those are prompt fixes, and prompt fixes do not hold on their own — that is the oldest
 * lesson in this engine. So this is the detector: it measures what the last turn actually did and
 * says so at the start of the next one, which is the mechanism the tic guard, maxims.ts and echo.ts
 * use and the only one that has ever worked here.
 */
import type { SaveState } from "./types";

/** Under this share of spoken words, with people in the room, the turn described a conversation
 *  instead of having one. The player named this number. */
export const DIALOGUE_FLOOR = 0.20;
/** A line at or under this length is a fragment. Real speech is mostly longer. */
export const SHORT_LINE = 6;
/** Consecutive turns a present character may say nothing before it is the thing to fix. */
export const MUTE_LIMIT = 2;

/** Words allowed between two halves of one interrupted line before they count as two lines. */
const TAG_WORDS = 8;

/** Everything inside quotation marks, straight or curly — with an interrupted line counted ONCE.
 *
 *  A dialogue tag splits a single utterance into two quoted spans, and the first half is nearly
 *  always short: `"You knew," Miranda said, "and you let me finish the whole story."` is one thing
 *  a person said, and counting it as a two-word line plus a ten-word line makes half of ordinary,
 *  well-written dialogue look like fragments. That false positive would have had this guard
 *  scolding the narrator for the one thing it was doing right, so the halves are rejoined: a span
 *  that ends without terminal punctuation, followed within a tag's length by another span, is the
 *  same line continuing. */
export function spokenLines(prose: string): string[] {
  const p = String(prose ?? "");
  const spans = [...p.matchAll(/["“]([^"”\n]{2,})["”]/g)];
  const out: string[] = [];
  let held = "";
  let heldEnd = -1;
  const flush = () => { if (held.trim()) out.push(held.trim()); held = ""; heldEnd = -1; };
  for (const m of spans) {
    const body = m[1].trim();
    const gap = heldEnd >= 0 ? p.slice(heldEnd, m.index!).split(/\s+/).filter(Boolean).length : Infinity;
    const continues = held && gap <= TAG_WORDS && !/[.!?…]["”]?$/.test(held);
    if (continues) held = `${held} ${body}`;
    else { flush(); held = body; }
    heldEnd = m.index! + m[0].length;
  }
  flush();
  return out.filter(Boolean);
}

/** How much of the turn was somebody talking. */
export function dialogueShare(prose: string): number {
  const total = String(prose ?? "").split(/\s+/).filter(Boolean).length;
  if (!total) return 1;
  const spoken = spokenLines(prose).reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0);
  return spoken / total;
}

/** What fraction of the lines are fragments. Returns 0 when nobody spoke — a turn with no speech
 *  is caught by the share, and reporting it as 100% fragments would double-count it. */
export function shortLineShare(prose: string): number {
  const lines = spokenLines(prose);
  if (!lines.length) return 0;
  return lines.filter((l) => l.split(/\s+/).filter(Boolean).length <= SHORT_LINE).length / lines.length;
}

/** Did this person get a line? A quote counts as theirs when their name sits beside it — the same
 *  proximity test the misattribution guard uses, and wrong in the same rare ways. */
export function spoke(prose: string, name: string): boolean {
  const first = (String(name ?? "").split(/\s+/)[0] ?? "").toLowerCase();
  if (first.length < 3) return false;
  const p = String(prose ?? "");
  for (const m of p.matchAll(/["“][^"”\n]{2,}["”]/g)) {
    const window = p.slice(Math.max(0, m.index! - 90), m.index! + m[0].length + 90).toLowerCase();
    if (window.includes(first)) return true;
  }
  return false;
}

/** Per-character consecutive-silence counters, updated once a turn from the prose that just ran. */
export function trackSilence(state: SaveState, prose: string): void {
  const counts = (state.speech_silence ??= {});
  for (const id of state.world.present ?? []) {
    if (id === "char_player") continue;
    const name = state.characters[id]?.name ?? "";
    if (!name) continue;
    counts[id] = spoke(prose, name) ? 0 : (counts[id] ?? 0) + 1;
  }
  for (const id of Object.keys(counts)) {
    if (!(state.world.present ?? []).includes(id)) delete counts[id];
  }
  state.last_speech = {
    share: +dialogueShare(prose).toFixed(3),
    short: +shortLineShare(prose).toFixed(3),
    turn: state.world.current_turn,
  };
}

/** How a given person raises their voice, taken from the regulation style the engine already holds.
 *  This is the field that was being contradicted, so it is the field the correction is built on. */
function pushesBy(style: string | undefined): string {
  switch (String(style ?? "").toLowerCase()) {
    case "anxious": return "goes after it — asks again, follows them across the room, repeats the part that was not answered, raises the volume, will not let the subject close";
    case "avoidant": return "goes short and hard rather than silent — one flat sentence that ends the topic, then leaves the room or changes what they are doing, out loud";
    case "disorganized": return "starts saying it and stops, then says a sharper version of it a moment later, and asks for something they then refuse";
    default: return "stays in it and keeps talking in the same voice — names the thing plainly, asks the direct question, says what they will and will not do";
  }
}

/**
 * The correction, from what the last turn measured. Silent when the last turn was fine.
 *
 * Written as what to DO with the coming turn rather than as a complaint about the last one — the
 * quoted failure exists to make the instruction specific, the way maxims.ts quotes a line back.
 */
export function speechDirective(state: SaveState): string {
  const last = state.last_speech;
  if (!last || last.turn !== state.world.current_turn - 1) return "";
  const present = (state.world.present ?? []).filter((id) => id !== "char_player" && state.characters[id]);
  if (!present.length) return "";

  const thin = last.share < DIALOGUE_FLOOR;
  const fragments = last.short >= 0.5;
  const mute = present.filter((id) => (state.speech_silence?.[id] ?? 0) >= MUTE_LIMIT);
  if (!thin && !fragments && !mute.length) return "";

  const bits: string[] = [];
  if (thin) {
    bits.push(`Last turn ${Math.round(last.share * 100)}% of the words were spoken aloud, with ${present.length === 1 ? "somebody" : "people"} in the room for all of it. `
      + `THIS TURN THE TALKING CARRIES THE SCENE: most of what happens is what people say to each other, and the description is what fits around it. `
      + `Every person present speaks at least once, and what they say moves something — a question that has to be answered, a demand, an answer, a refusal, a piece of news, a fact about their own day.`);
  }
  if (mute.length) {
    const lines = mute.map((id) => {
      const c = state.characters[id]!;
      const rel = state.condition[id]?.psyche?.relaxation ?? 0;
      const state_ = rel <= -3 ? "is angry or hurt and " : "";
      return `${c.name} has been in the room for ${state.speech_silence?.[id]} turns without a line. ${c.name} ${state_}${pushesBy(c.attachment?.style)}. Give ${c.name} real speech this turn.`;
    });
    bits.push(lines.join(" "));
  }
  if (fragments) {
    bits.push(`Half of last turn's lines were ${SHORT_LINE} words or shorter. People in the middle of something talk in runs: a sentence, then the next one, then the part they had not meant to say. `
      + `At least one person this turn speaks three sentences together, uninterrupted, and gets to the end of the thought. `
      + `Where a line is a fragment, it is a fragment because they were cut off or because they are finishing somebody else's sentence, and the page shows which.`);
  }
  return `\n\nWHAT PEOPLE SAID LAST TURN, AND WHAT THEY SAY THIS ONE. ${bits.join("\n")}`;
}

/**
 * THE STANDING RULE ABOUT ANGER, which is the specific silence the player kept hitting.
 *
 * Emitted whenever somebody present is clenched, because that is the state whose only rendering was
 * withdrawal. It does not ask for shouting: it asks for the person's OWN escalation, which the
 * engine already has on file as their regulation style and which is different for each of them.
 */
export function angerRegister(state: SaveState): string {
  const hot = (state.world.present ?? [])
    .filter((id) => id !== "char_player")
    .map((id) => ({ id, c: state.characters[id], r: state.condition[id]?.psyche?.relaxation ?? 0 }))
    .filter((x) => x.c && x.r <= -3);
  if (!hot.length) return "";
  const rows = hot.map(({ c, r }) =>
    `${c!.name} (${r <= -7 ? "badly clenched" : "clenched"}): ${pushesBy(c!.attachment?.style)}`).join("\n");
  return `\nBEING ANGRY IS SOMETHING A PERSON DOES OUT LOUD. Somebody who has just been hurt or crossed has MORE to say than they did an hour ago, and the pressure goes into what they say and how long they keep saying it. `
    + `The withdrawal reading — going still, going quiet, one clipped sentence, letting the silence do the work — is one person's way and it is being written as everybody's. Use each person's own way, which is on their record:\n${rows}\n`
    + `A character who has just been told something unbearable answers it. They repeat the part that landed, they ask the question they already know the answer to, they say the unfair thing, they bring up the older grievance that is not about tonight. If somebody in the scene truly has nothing to say, they leave the room, and the leaving is the answer.`;
}
