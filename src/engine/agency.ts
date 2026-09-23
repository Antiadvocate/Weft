// AGENCY — one call per person instead of one call for the world.
//
// WHAT THIS REPLACES, AND WHY IT IS A DIFFERENT THING FROM THE PASS ABOVE IT.
//
// engine/offstage.ts moves the background with a single model call that has been handed everything:
// every place, every cast member's wants and blockers and week, who is standing where, every
// faction clock, every open thread. Then OFFSTAGE_SYSTEM spends 2,489 tokens asking that model to
// un-know most of it. Read its headings in order and they are a casualty list — the barista who
// read a private text aloud down a phone line, the smith who forged a design nobody ever drew,
// the friend who was told where the player was flying and why. Every one of those is the same
// failure: a model that was given a fact and then asked, in prose, to behave as though it had not
// been.
//
// The instruction is the weakest possible form of that constraint, and the file knows it — the
// notes under HAND_OF and playerAuthored exist because the prompt was obeyed in one direction and
// not the other, so a second guard had to be written that does NOT need the model to have complied.
//
// This module takes the other road. A person who was never told a fact cannot leak it. So the
// context is cut to what ONE character knows — their own card, their own want, their own room,
// their own memories, their own rumours, their own faction if they have one — and they are asked
// for one thing they did. Information asymmetry stops being a rule in a prompt and becomes a
// property of the call.
//
// THE COST ARGUMENT, since this looks like it should be more expensive and is not.
//
//   the world pass    2,489-token system + a digest that grows with the cast (~1.5–2.5k on ten
//                     people) = roughly 4–5k input, once per offstage interval.
//   two actors here   a ~900-token system shared by every actor and every turn, plus a brief that
//                     is capped at about 600 = roughly 1.5k each, 3k for two.
//
// It is cheaper because most of what the world pass pays for is the leak-prevention, and none of
// that has to be sent to somebody who was not given the fact. The system block is byte-identical
// across actors and across turns, so on a caching provider the second actor of a turn and the
// first actor of the next turn both read it from cache; the world digest changes every turn by
// construction and never can.
//
// It also adds no calls to a turn the player is waiting on. It runs on the offstage schedule,
// where the world pass already ran, in place of it.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//
// Nobody here reports the weather, a herd sickening, or a flood, because nobody here is the world —
// they are a person in one room with one want. Those belong to the world pass, which is why
// `agency_world_ratio` keeps it alive on a fraction of intervals rather than retiring it.
//
// And nobody moves. tickSchedule already puts people where their week says they are, deterministic
// and free; a second mover writing locations from a model's sentence would fight it and lose.
// An actor acts where the engine has already placed them.

import { buildMessages, complete, safeJson } from "../llm";
import { authoredLine, hasAuthored } from "./authored";
import { factionMembers } from "./knowledge";
import { retrieveScored } from "./memory";
import { scheduleDigestLine } from "./schedule";
import { clipText } from "./text";
import type { OffstageEvent } from "./offstage";
import type { SaveState } from "./types";

/** How many people may be given their own call in one interval. Above four the brief stops being
 *  the cheap half of the trade and the interval starts costing more than the pass it replaced. */
export const MAX_ACTORS = 4;

/** Memories put in front of an actor. Small on purpose: this is somebody deciding what to do in
 *  the next few hours, and their whole life is not in the room with them. */
const BRIEF_MEMORIES = 4;

/** Characters below this gregariousness keep their rumours to themselves in the brief — a recluse
 *  who holds a piece of news is still holding it, and printing it invites them to pass it on. */
const TELLS_THRESHOLD = 0.35;

/** How stale somebody counts as when the log has never once recorded them doing anything. High
 *  enough that a person the world has never moved outranks one it moved last interval, which is the
 *  whole point of the staleness term — otherwise the first two people picked keep being picked. */
const STALE_ON_ARRIVAL = 20;

/**
 * WHAT ONE PERSON KNOWS, WRITTEN AS THEIR OWN BRIEFING.
 *
 * Every line here answers "how would they have come by this?" — their card is themselves, their
 * room is where they are standing, the names are the people they can see, the memories are their
 * own, the rumour is something somebody told them and the path proves it, the faction is one the
 * cast list actually puts them in.
 *
 * What is absent is the whole argument for the module. No player location. No player action. No
 * other character's want. No thread they have not been part of. No clock belonging to a faction
 * they do not stand in. No gazetteer — a person knows the places they have been, and the brief
 * carries their own location and the places their own memories name, which is a different and
 * much smaller list than every place that exists.
 *
 * Pure and free. It can be read in a test without opening a socket, which is the only way the
 * "this cannot leak" claim is checkable at all.
 */
export function actorBrief(state: SaveState, id: string): string {
  const c = state.characters?.[id];
  if (!c) return "";
  const w = state.world;
  const turn = w.current_turn ?? 0;

  // A WANT THAT IS ABOUT SOMEBODY READS DIFFERENTLY FROM ONE THAT IS ABOUT SOMETHING, and the
  // difference is the reason. `because` is what this person believed when they formed the
  // intention, written in their own words out of a briefing that was one room's view — and it is
  // printed back to them unchanged, every interval, until the want ends. Nothing reconciles it
  // against what turned out to be true. So a person who decided something about a neighbour on a
  // misread keeps the misread in front of them, keeps acting on it, and keeps having it confirmed
  // by the next thing they half-see. That is a grudge, and it is the only way this engine has ever
  // been able to hold one.
  const wantLine = (d: { goal?: string; approach?: string; blocker?: string; about?: string; because?: string } | undefined): string | null => {
    if (!d?.goal) return null;
    const who = d.about ? state.characters?.[d.about]?.name : undefined;
    return [
      who ? `About ${who}: ${d.goal}` : d.goal,
      d.because ? ` — why you mean it: ${d.because}` : "",
      d.approach ? `, and the way you go about it: ${d.approach}` : "",
      d.blocker ? ` — stuck on: ${d.blocker}` : "",
    ].join("");
  };

  const wants = [
    hasAuthored(c) && !(c as any).authored?.paused ? authoredLine((c as any).authored) : null,
    wantLine(c.drive),
    ...(c.drive_queue ?? []).map(wantLine),
  ].filter(Boolean) as string[];

  const here = c.location ? w.places?.[c.location] : undefined;
  const alsoHere = Object.entries(state.characters ?? {})
    .filter(([oid, o]) => oid !== id && oid !== "char_player" && o.location === c.location
      && o.status !== "dead" && o.status !== "departed")
    .map(([, o]) => o.name);

  // Retrieved against their own want, because what a person has on their mind while they decide
  // what to do next is the thing they are trying to get.
  const mem = state.memory?.[id];
  const query = wants.join(" ") || c.current_goal || c.name;
  const relax = (state.condition?.[id] as any)?.psyche?.relaxation ?? 0;
  const recalled = mem
    ? retrieveScored(mem, query, turn, BRIEF_MEMORIES, relax, w.current_time).map((r) => r.m.content)
    : [];

  // Rumours this person actually holds. `knowers` is the ledger of who has been told; a name that
  // is not on it has not heard it, and printing it here would be the leak this module exists to
  // make impossible.
  const heard = (c.gregariousness ?? 0.5) >= TELLS_THRESHOLD
    ? (w.rumors ?? []).filter((r) => !r.dead && (r.knowers ?? []).includes(id)).slice(-3).map((r) => r.content)
    : [];

  // Their read of somebody, which may be wrong, and the wrongness is the point. The true edge stays
  // out: a person does not get to see the number.
  const beliefs = (state.minds?.[id]?.about ?? [])
    .filter((b) => b.held_false || b.confidence < 0.4)
    .map((b) => {
      const who = state.characters?.[b.target]?.name ?? "them";
      if (b.held_false) return `About ${who}, you are convinced: ${b.held_false}`;
      return `With ${who}, you honestly can't tell where you stand.`;
    });

  // A clock belongs to the people standing in it. Anyone else in the cast has no idea it is ticking.
  const mine = (w.clocks ?? [])
    .filter((k) => k.status === "running" && factionMembers(state, k.faction).includes(id))
    .map((k) => `You're one person in a world, deciding what you did with the next few hours, and you belong to ${k.faction}. What that has you working toward: ${k.objective}.`);

  // Their own recent business, so the same afternoon is not lived twice.
  const didLately = (w.offstage_log ?? [])
    .filter((e) => String(e.actor ?? "").toLowerCase() === c.name.toLowerCase())
    .slice(-3).map((e) => e.what);

  const due = scheduleDigestLine(state, id);

  return [
    `YOU ARE ${c.name}${c.pronouns ? `, ${c.pronouns}` : ""}, ${c.age}.`,
    c.background ? `Who you are: ${clipText(c.background, 260)}` : "",
    (c.core_traits ?? []).length ? `How you tend to be: ${(c.core_traits ?? []).join(", ")}.` : "",
    c.voice?.agenda ? `What you usually want from people: ${c.voice.agenda}` : "",
    "",
    `IT IS ${w.current_time}. The weather is ${w.weather}.`,
    here ? `You are at ${here.name}. ${clipText(here.description_facts ?? "", 200)}` : "You are somewhere you know well.",
    alsoHere.length ? `In sight of you right now: ${alsoHere.join(", ")}.` : "Nobody else is here.",
    due ? `Your week:${due}` : "",
    "",
    wants.length ? `WHAT YOU ARE TRYING TO GET:\n${wants.map((x) => `- ${x}`).join("\n")}` : "WHAT YOU ARE TRYING TO GET: nothing urgent, so these are an ordinary few hours of your life.",
    mine.length ? `\n${mine.join("\n")}` : "",
    recalled.length ? `\nWHAT IS ON YOUR MIND:\n${recalled.map((m) => `- ${clipText(m, 180)}`).join("\n")}` : "",
    heard.length ? `\nWHAT YOU HAVE HEARD (somebody told you, and you have no way of checking it):\n${heard.map((h) => `- ${clipText(h, 160)}`).join("\n")}` : "",
    beliefs.length ? `\nWHAT YOU BELIEVE ABOUT PEOPLE:\n${beliefs.map((b) => `- ${b}`).join("\n")}` : "",
    didLately.length ? `\nWHAT YOU HAVE ALREADY DONE (carry on from here instead of doing it again):\n${didLately.map((d) => `- ${clipText(d, 160)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export const AGENCY_SYSTEM = `You're one person in a world, deciding what you did with the next few hours. You're given everything you know and nothing else, so anything that isn't in the briefing isn't in your head either.

Write one thing you did: one action, finished, with a result. Write it in the past tense, in one or two plain sentences, in the third person using your own name, like "Ilse walked the boundary as far as the ford and found the stakes pulled." Always include the result, because a step with an outcome is an event, and a step you only thought about is nothing.

You only know what the briefing says, so if the answer to "how would I have found that out?" is anything other than a line in the briefing, you didn't know it. What you do instead usually makes a better story anyway: you call and nobody answers, you ask the wrong person, you find the door locked, or you act on news that's two days old. Write the version where you're working with what you've got.

Act on what you're trying to get, which the briefing tells you. Take a concrete step toward it and say how it turned out, including when it turned out badly. If you're stuck on something, the step is running into whatever is in the way, like a shut door, a no, or the person being out.

It happens where you are, unless your week takes you somewhere else during these hours, in which case it happens there. Name the place exactly the way the briefing names it.

The briefing lists anyone else who's in sight of you, and doing something with one of them is often the best thing you can write. Anyone it doesn't list is somewhere else and out of reach today.

You can tell one person something: if part of what you did was bringing news to somebody, by telling them what you saw, passing on what you heard, or asking them a question that shows what you know, put their exact name in "told" and what they now know in "telling". It can only be someone in sight of you, and only something you actually know.

Getting in touch with the main character is something you'd do on purpose, and it's rare. When what you did was contact them deliberately, by calling, texting, writing or turning up, fill in "reaches_player" with how you did it and the words that reach them. Leave it out the rest of the time, which is most of the time. You have no idea where they are or what they're doing.

You can only use what you have, so write what you did with it. The main character hasn't given you anything, promised you anything or made you anything unless the briefing records it, and anything you did that only works because they did something first didn't happen.

If the briefing says you belong to a faction, a step for it counts, like taking a statement, holding a meeting, sending a rider or finishing a page. Set "advances" to the faction's exact name when what you did was one of its ordinary steps.

Sometimes an afternoon leaves you meaning to do something about somebody. The briefing already has what you're trying to get, and some afternoons add to it: you decide something about a person, and it's still true tomorrow. Fill in "intent" when that happened. "about" is their exact name from the briefing, "goal" is what you now mean to do about them, concrete enough that somebody could watch you do it, and "because" is what made you decide it, in your own words, based on what you actually saw or heard.

Your reason is allowed to be wrong, and it usually is. You saw one end of something, or you heard it from someone who heard it from someone else. Write the reason you have, and keep it exactly as it is. It stays with you until something gets in its way, which is how people carry a misunderstanding around for a week.

Leave "intent" out when nothing changed for you this afternoon, which is most afternoons, and when what you already want is still what you want.

Sometimes a day leaves a question open, like a promise that's now due, a decision you're now forced to make, or a door you found open that used to be shut. Fill in "opens_question" when yours did, and leave it out when the day didn't leave anything open, which is most days.

Reply with only this JSON:
{"what":"one or two past-tense sentences that use your own name","place":"exactly as the briefing names it","told":"the exact name of one person in sight, or leave it out","telling":"what they now know, or leave it out","intent":{"about":"an exact name from the briefing","goal":"what you now mean to do about them","because":"what made you decide it, in your own words"},"advances":"the exact faction name, or leave it out","reaches_player":{"how":"","content":""},"opens_question":{"title":"","description":""}}`;

/** One person's answer. Mapped onto the OffstageEvent the existing applier already knows how to
 *  write, so nothing new touches memory, edges, rumours, clocks or threads. */
export interface AgentAct {
  what?: string;
  place?: string;
  told?: string;
  telling?: string;
  advances?: string;
  reaches_player?: { how?: string; content?: string };
  opens_question?: { title?: string; description?: string };
  /** WHAT THEY NOW MEAN TO DO ABOUT SOMEBODY, and why they mean it. See formIntent — this is the
   *  field that makes an interval a step in something rather than an afternoon on its own. */
  intent?: { about?: string; goal?: string; because?: string };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE CARDBOARD BOX.
 *
 * Three consecutive offstage passes of one save, every one of them the same eight-year-old and the
 * same flattened box:
 *
 *   t13  Alina hauled the flattened air conditioner box down the hall and left it standing against
 *        the wall beside the chute door instead of feeding it in…
 *   t19  Alina came back down to the basement laundry with the flattened box, decided the chute door
 *        was a trap, and stood the cardboard up behind the squealing dryer…
 *   t25  Alina wedged the flattened box upright behind the squealing dryer, then found it slid down
 *        and blocked the drain slope, so she stamped it into four smaller pieces…
 *
 * The player: "the narrator is describing her doing shit for days that I personally don't give a
 * fuck about."
 *
 * EVERY PART OF THIS ENGINE DID ITS JOB. Her recorded want was "Dispose of the cardboard box
 * without dealing with a jammed chute". The brief hands an actor their want and asks for a concrete
 * step with a result; she took one, three times, and the briefing's own "pick up from here rather
 * than repeating it" made each one continue the last. The bookkeeper then opened a thread per
 * afternoon — "Cardboard stacked beside the chute", "Cardboard behind the dryer", "A flattened box
 * hidden behind the dryer" — and those threads became the pressure source on turns 20, 21 and 23,
 * outvoting a pressure palette about heat, humiliation and domestic control four candidates to one.
 * A self-feeding loop, built out of correct parts, about a box.
 *
 * TWO THINGS WERE MISSING AND BOTH ARE HERE.
 *
 * pickActors scored a drive, a queue, an authored want, staleness and a schedule, and had no notion
 * whatever of whether this person is anybody in the story. An eight-year-old at warmth 1.7 and
 * trust 0.5 toward the protagonist, who had not been in a scene, outranked the woman the story is
 * about — whose own want names the protagonist and is blocked on him — because she happened to hold
 * an unblocked errand. Centrality is now a term, and it is the largest one.
 *
 * And driveforge screens a want that is a DECISION, a WAIT, an ABSTENTION or a DOCUMENT, with a
 * paragraph each on why. It has no screen for a CHORE, which is the same failure wearing work
 * clothes: concrete, permissionless, finishable, nobody in it. A chore is a real thing a person
 * does and a bad thing to build an afternoon's report around.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Objects and verbs that make a want an errand: a thing to be moved, fixed, cleaned or disposed of,
 *  with no other person in it. Narrow, and only ever a DEMOTION — a chore is still a want, and a
 *  cast with nothing else going on may still act on one. */
const CHORE_VERB = /\b(dispose|throw|bin|discard|take|bring|put|haul|carry|move|shift|stack|fold|wash|launder|clean|tidy|sort|fix|mend|repair|unclog|unjam|empty|refill|return|store|stow)\b/i;
const CHORE_OBJECT = /\b(box|boxes|cardboard|carton|rubbish|trash|garbage|bin|bins|recycling|chute|laundry|washing|dishes|groceries|shopping|parcel|package|post|mail|clutter|junk|bag|bags)\b/i;

/** True when the whole want is an errand with nobody in it. */
export function choreLike(goal: unknown, castNames: string[] = []): boolean {
  const g = String(goal ?? "").trim();
  if (!g) return false;
  if (!CHORE_VERB.test(g) || !CHORE_OBJECT.test(g)) return false;
  // A chore somebody is doing TO or FOR a named person is not a chore, it is a move in a
  // relationship: taking her sister's rubbish out to be seen doing it is a want about the sister.
  return !castNames.some((n) => n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(g));
}

/**
 * HOW MUCH OF THE STORY THIS PERSON IS.
 *
 * The protagonist's own edges are the record of who the story has been about: warmth and trust in
 * either direction, plus attraction, plus whether anybody has bothered to record a role. Somebody
 * the player has spent thirty turns with scores high in both directions even when the feeling is
 * bad; somebody who has never been in a room with them sits near zero.
 *
 * Deliberately symmetric. A character who dislikes the protagonist is central; a character the
 * protagonist has begun to hate is central. What is NOT central is a neighbour nobody has looked at.
 */
export function centrality(state: SaveState, id: string): number {
  const edges = state.world?.edges ?? [];
  const out = edges.find((e) => e.from === id && e.to === "char_player");
  const back = edges.find((e) => e.from === "char_player" && e.to === id);
  const mag = (e?: { warmth?: number; trust?: number; attraction?: number }) =>
    e ? (Math.abs(e.warmth ?? 0) + Math.abs(e.trust ?? 0) + Math.abs(e.attraction ?? 0)) / 3 : 0;
  const roles = (out?.roles?.length ?? 0) + (back?.roles?.length ?? 0);
  // Anyone the story has actually put on the page recently is in it, whatever the numbers say.
  const seen = (state.history ?? []).slice(-12).some((h) => (h.present ?? []).includes(id));
  return Math.max(mag(out), mag(back)) / 10 + roles + (seen ? 4 : 0);
}

/**
 * WHO GETS A TURN THIS INTERVAL.
 *
 * Deterministic and free, and it is the whole cost control: the budget is a count of people, so
 * the spend is `n × one small call` and cannot be surprised by a large cast. Ten people offstage
 * costs exactly what two do.
 *
 * The score is four things a person has that make them worth a call:
 *   · a live want, doubled when something is blocking it, because a blocked want is a story and a
 *     satisfied one is a routine;
 *   · staleness — turns since the world last recorded them doing anything. This is the term that
 *     stops the same two people having every afternoon in the save;
 *   · an authored want, which a human wrote by hand and meant to happen;
 *   · somewhere they are supposed to be in these hours.
 *
 * Anyone standing in the scene with the player is excluded. They are having their turn on the page.
 */
export function pickActors(state: SaveState, n: number): string[] {
  const w = state.world;
  const turn = w.current_turn ?? 0;
  const present = new Set(w.present ?? []);
  const lastActed = new Map<string, number>();
  for (const e of w.offstage_log ?? []) {
    const who = String(e.actor ?? "").toLowerCase();
    if (who) lastActed.set(who, Math.max(lastActed.get(who) ?? 0, e.turn ?? 0));
  }

  const castNames = Object.entries(state.characters ?? {})
    .filter(([id]) => id !== "char_player").map(([, c]) => c.name).filter(Boolean);

  const scored = Object.entries(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed" && !present.has(id))
    .map(([id, c]) => {
      let score = 0;
      if (c.drive?.goal) score += c.drive.blocker ? 4 : 2;
      if ((c.drive_queue ?? []).length) score += 1;
      if (hasAuthored(c) && !(c as any).authored?.paused) score += 4;
      const since = turn - (lastActed.get(c.name.toLowerCase()) ?? turn - STALE_ON_ARRIVAL);
      score += Math.min(6, since / 4);
      if (scheduleDigestLine(state, id)) score += 1;
      // WHO THE STORY IS ABOUT, which nothing here used to ask. The largest term, because an
      // afternoon belonging to somebody the player has never looked at is an afternoon the player
      // did not want. See the note above pickActors.
      score += Math.min(10, centrality(state, id));
      // ...and a want that is an errand is the weakest reason to spend a call on somebody.
      if (choreLike(c.drive?.goal, castNames)) score -= 6;
      // A tie between two equally stale people with equally live wants goes to whoever the state
      // happens to list first, forever. Their ids break it instead, stably per turn.
      const jitter = ((id.charCodeAt(id.length - 1) + turn) % 5) / 10;
      return { id, score: score + jitter };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(0, Math.min(MAX_ACTORS, n))).map((s) => s.id);
}

/**
 * One person's act, as an event the existing applier can write.
 *
 * WITNESSES ARE NOT THE ACTOR'S TO NAME, and this is the second structural gain after the leak.
 * The world pass asks a model to list who saw a thing, and the note in applyOffstage records that
 * in practice it returned an empty list every single time, which made the whole subsystem
 * write-only until a co-location fallback was added underneath it. An actor here is not asked at
 * all: the engine knows who is standing at that place, and fills it from the state. The one name
 * the actor may add is somebody they deliberately told, which is a thing only they know.
 */
export function actToEvent(state: SaveState, id: string, act: AgentAct): OffstageEvent | null {
  const c = state.characters?.[id];
  if (!c || !act?.what?.trim()) return null;

  const placeName = act.place?.trim() || (c.location ? state.world.places?.[c.location]?.name : "") || "";
  const witnesses = Object.entries(state.characters ?? {})
    .filter(([oid, o]) => oid !== id && oid !== "char_player" && o.location === c.location
      && o.status !== "dead" && o.status !== "departed")
    .map(([, o]) => o.name);

  // Somebody told on purpose is a witness whether or not they were standing there — that is what
  // being told is. Only a real name, and only one.
  const told = String(act.told ?? "").trim().toLowerCase();
  if (told) {
    const match = Object.entries(state.characters ?? {})
      .find(([oid, o]) => oid !== id && oid !== "char_player" && o.name.toLowerCase() === told);
    if (match && !witnesses.includes(match[1].name)) witnesses.push(match[1].name);
  }

  const ev: OffstageEvent = {
    actor: c.name,
    place: placeName,
    what: clipText(act.what, 400),
    witnesses,
  };
  if (act.advances?.trim()) ev.advances = act.advances.trim();
  const rp = act.reaches_player;
  if (rp?.how?.trim() && rp?.content?.trim()) ev.reaches_player = { how: rp.how.trim(), content: rp.content.trim() };
  const oq = act.opens_question;
  if (oq?.title?.trim() && oq?.description?.trim()) ev.opens_thread = { title: oq.title.trim(), description: oq.description.trim() };
  return ev;
}

/** An intention outranks a want the engine seeded off card similarity, and sits under one a human
 *  wrote by hand. regenerateDrives sorts the queue on this. */
const INTENT_PRIORITY = 2;

/**
 * WHAT ONE AFTERNOON LEAVES BEHIND.
 *
 * Without this the isolation buys a world of strangers having unrelated afternoons. Each call is
 * one person's few hours and then it is over: the act becomes a memory, the memory may become a
 * rumour, and the next interval that person starts again from a want the engine seeded off how
 * much their card resembles somebody else's. Nothing they DECIDED survives, so nothing accumulates,
 * and a cast that cannot accumulate cannot arrive anywhere.
 *
 * An intention is the thing that carries. It goes in as an ordinary NPCDrive with `about` set, so
 * every piece of machinery that already reads a want reads this one: the brief prints it next
 * interval, regenerateDrives protects it while it is live and shelves it when it stalls, the
 * offstage digest reports it, the narrator sees it when the person walks into a scene, and
 * modeledTargets keeps the believer's picture of the target alive because of it.
 *
 * THE REASON IS KEPT AS WRITTEN, and that is the part that matters here. `because` is what the
 * actor believed at the moment they formed it, out of a briefing that was one person's view of one
 * room. It is never reconciled against what actually happened. So a want formed on a misread stays
 * a want formed on a misread — it is still there six intervals later, still pointed at the same
 * person, still carrying the reason that was never true, until somebody gets in its way. That is
 * one person carrying a misunderstanding around for a week, which nothing in this engine could
 * previously represent: a drive's goal was a sentence with a name in it and no record of where the
 * sentence came from.
 *
 * Guarded three ways. The target must be somebody the cast contains, so nobody forms an intention
 * about a person who does not exist. It is never the player — the pass has one hard rule about
 * inventing a relationship to them, and a want the player never saw formed is exactly that. And an
 * intention about somebody they already hold one about REPLACES it rather than stacking, because a
 * person pursuing four separate plans about one neighbour is a queue, not a character.
 */
export function formIntent(state: SaveState, id: string, intent: AgentAct["intent"], brief: string): string | null {
  const goal = String(intent?.goal ?? "").trim();
  const aboutName = String(intent?.about ?? "").trim().toLowerCase();
  if (!goal || !aboutName) return null;

  const c = state.characters?.[id];
  if (!c) return null;

  // ...AND ONLY ABOUT SOMEBODY THE BRIEFING NAMED. The whole module rests on a character knowing
  // what their briefing gave them, and an intention is the one output that persists — a name
  // arriving from anywhere else would write a lasting want about somebody this person has never
  // seen, heard of, or been told about, and it would sit on their card for the rest of the save.
  // The briefing is the record of what they were given, so it is the record this checks against.
  if (!brief.toLowerCase().includes(aboutName)) return null;

  const match = Object.entries(state.characters ?? {}).find(
    ([oid, o]) => oid !== id && oid !== "char_player" && o.status !== "dead" && o.status !== "departed"
      && (o.name.toLowerCase() === aboutName || (o.aliases ?? []).some((a) => a.toLowerCase() === aboutName)),
  );
  if (!match) return null;
  const [aboutId, about] = match;

  const turn = state.world.current_turn ?? 0;
  const drive = {
    goal: clipText(goal, 200),
    about: aboutId,
    because: clipText(String(intent?.because ?? "").trim(), 200) || undefined,
    progress: 0,
    priority: INTENT_PRIORITY,
    acts: 0,
    updated_turn: turn,
  };

  const queue = (c.drive_queue ??= []);
  // One plan per person. An older intention about the same neighbour is what this one replaces.
  const stale = (d: { about?: string }) => d.about === aboutId;
  c.drive_queue = queue.filter((d) => !stale(d));

  if (!c.drive || c.drive.about === aboutId || c.drive.progress >= 100) {
    // Nothing else running, or the thing running was about this same person anyway.
    if (c.drive && c.drive.progress < 100 && c.drive.about !== aboutId) c.drive_queue.push({ ...c.drive, priority: 0 });
    c.drive = drive;
  } else if (c.drive_queue.length < 2) {
    c.drive_queue.push(drive);
  } else {
    // Their hands are full. The intention still displaces the least important thing waiting.
    c.drive_queue.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
    c.drive_queue[0] = drive;
  }

  return `${c.name} means to ${clipText(goal, 90)}${drive.because ? ` — ${clipText(drive.because, 80)}` : ""}`;
}

/**
 * TWO PEOPLE IN THE SAME ROOM HAD THE SAME AFTERNOON.
 *
 * The actors run in parallel and none of them can see the others, so two people standing in one
 * place each write an afternoon that does not contain the other one. Left alone that is two
 * accounts of one room with nobody in it — which is the cost of the isolation, and it is paid back
 * here rather than by giving anybody more context.
 *
 * Each becomes a witness to the other's act. So a collision produces four memories from two calls:
 * each of them holding their own, in their own mouth, and each holding a second-hand view of the
 * other's — and applyOffstage moves the edge between them off whichever act had any valence in it.
 * That is where a relationship between two people the player has never watched interact comes from.
 */
export function collide(events: OffstageEvent[]): OffstageEvent[] {
  const byPlace = new Map<string, OffstageEvent[]>();
  for (const ev of events) {
    const key = (ev.place ?? "").toLowerCase().trim();
    if (!key) continue;
    byPlace.set(key, [...(byPlace.get(key) ?? []), ev]);
  }
  for (const group of byPlace.values()) {
    if (group.length < 2) continue;
    for (const ev of group) {
      for (const other of group) {
        if (other === ev) continue;
        if (!ev.witnesses.includes(other.actor)) ev.witnesses.push(other.actor);
      }
    }
  }
  return events;
}

/** Acts an actor may spend on one want before the engine calls it, if nothing has moved. */
const SPENT_AFTER_ACTS = 3;
/** Progress that counts as the want actually going somewhere. */
const REAL_PROGRESS = 25;

/**
 * A WANT THAT HAS PRODUCED THREE AFTERNOONS AND GONE NOWHERE IS OVER.
 *
 * regenerateDrives already shelves a stalled drive — but only onto a BACKUP, and only when the
 * queue holds one: `const idx = active.progress >= 100 ? 0 : queue.findIndex((q) => !q.blocker);
 * if (idx < 0) { active.updated_turn = …; continue; }`. An eight-year-old with an empty queue and a
 * cardboard box therefore held that want forever, and seedDrive never ran because seeding is gated
 * on `!active || progress >= 100`. Three passes in, her progress had moved from 7.2 to 7.3.
 *
 * Nothing was broken. There was simply no path out of a want with nowhere to fall back to, and this
 * pass hands that want to a model every interval and asks for another step on it.
 *
 * So: after three acts on one want with the progress still under a quarter, the want is spent and
 * cleared. The next regenerateDrives seeds a fresh one from this person's own edges and traits,
 * which is where a want about another person comes from. The line goes to the offscreen feed so the
 * player can see the engine giving up on it rather than wondering why the box stopped.
 *
 * Counted off the offstage log, which is the record of what this actor has actually been doing, so
 * it needs no new field and no migration.
 */
export function spendStalledWants(state: SaveState): string[] {
  const out: string[] = [];
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    const drive = c.drive;
    if (id === "char_player" || !drive?.goal) continue;
    if (drive.progress >= REAL_PROGRESS) continue;
    if (hasAuthored(c) && !(c as any).authored?.paused) continue;   // a human wrote it; it stands
    const acts = drive.acts ?? 0;
    if (acts < SPENT_AFTER_ACTS) continue;
    out.push(`${c.name} gives up on "${clipText(drive.goal, 70)}" after ${acts} tries with nothing to show for them.`);
    c.drive = (c.drive_queue ?? []).shift() ?? undefined;
  }
  return out;
}

/**
 * Run the interval as n people rather than as one world.
 *
 * Parallel, and settled rather than raced: one actor whose provider hiccups costs that actor's
 * afternoon and nothing else. A failed interval returns nothing and the caller falls through to
 * the world pass, so the background never goes silent because a small model returned bad JSON.
 */
export async function runAgency(state: SaveState, model: string, n: number): Promise<{ events: OffstageEvent[]; lines: string[] }> {
  // Before anybody is chosen, end the wants that have been producing the same afternoon.
  const spent = spendStalledWants(state);
  const ids = pickActors(state, n);
  if (!ids.length) return { events: [], lines: spent };

  const results = await Promise.allSettled(ids.map(async (id) => {
    const brief = actorBrief(state, id);
    if (!brief) return null;
    const msgs = buildMessages(AGENCY_SYSTEM, "YOUR BRIEFING:", brief, model);
    const out = await complete(msgs, model, model, true, 500);
    const act = safeJson<AgentAct>(out.text, {});
    return { id, act, brief, event: actToEvent(state, id, act) };
  }));

  const done = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is { id: string; act: AgentAct; brief: string; event: OffstageEvent | null } => r !== null);

  // THE INTENTION IS WRITTEN WHETHER OR NOT THE AFTERNOON SURVIVED. An act can be dropped for
  // naming nobody or forging the player's hand and still be a real decision the person made.
  const lines: string[] = [...spent];
  for (const r of done) {
    const line = formIntent(state, r.id, r.act.intent, r.brief);
    if (line) lines.push(line);
  }

  // AND THE WANT WEARS. An afternoon spent on a want is counted against it here, because this is
  // the only place that knows an afternoon was spent — see NPCDrive.acts and spendStalledWants.
  for (const r of done) {
    if (!r.event) continue;
    const d = state.characters?.[r.id]?.drive;
    if (d?.goal) d.acts = (d.acts ?? 0) + 1;
  }

  const events = done.map((r) => r.event).filter((e): e is OffstageEvent => e !== null);
  return { events: collide(events), lines };
}
