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
      d.approach ? ` — the way you go at it: ${d.approach}` : "",
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
      return `About ${who} you genuinely cannot tell where you stand.`;
    });

  // A clock belongs to the people standing in it. Anyone else in the cast has no idea it is ticking.
  const mine = (w.clocks ?? [])
    .filter((k) => k.status === "running" && factionMembers(state, k.faction).includes(id))
    .map((k) => `You are one of ${k.faction}. What that has you working toward: ${k.objective}.`);

  // Their own recent business, so the same afternoon is not lived twice.
  const didLately = (w.offstage_log ?? [])
    .filter((e) => String(e.actor ?? "").toLowerCase() === c.name.toLowerCase())
    .slice(-3).map((e) => e.what);

  const due = scheduleDigestLine(state, id);

  return [
    `YOU ARE ${c.name}${c.pronouns ? `, ${c.pronouns}` : ""}, ${c.age}.`,
    c.background ? `Who you are: ${clipText(c.background, 260)}` : "",
    (c.core_traits ?? []).length ? `How you tend to be: ${(c.core_traits ?? []).join(", ")}.` : "",
    c.voice?.agenda ? `What you are usually angling for: ${c.voice.agenda}` : "",
    "",
    `IT IS ${w.current_time}. The weather is ${w.weather}.`,
    here ? `You are at ${here.name}. ${clipText(here.description_facts ?? "", 200)}` : "You are somewhere you know well.",
    alsoHere.length ? `In sight of you right now: ${alsoHere.join(", ")}.` : "Nobody else is here.",
    due ? `Your week:${due}` : "",
    "",
    wants.length ? `WHAT YOU ARE TRYING TO GET:\n${wants.map((x) => `- ${x}`).join("\n")}` : "WHAT YOU ARE TRYING TO GET: nothing urgent, so this is an ordinary few hours of your life.",
    mine.length ? `\n${mine.join("\n")}` : "",
    recalled.length ? `\nWHAT IS ON YOUR MIND:\n${recalled.map((m) => `- ${clipText(m, 180)}`).join("\n")}` : "",
    heard.length ? `\nWHAT YOU HAVE HEARD (somebody told you; you have no way to check it):\n${heard.map((h) => `- ${clipText(h, 160)}`).join("\n")}` : "",
    beliefs.length ? `\nWHAT YOU BELIEVE ABOUT PEOPLE:\n${beliefs.map((b) => `- ${b}`).join("\n")}` : "",
    didLately.length ? `\nWHAT YOU HAVE ALREADY DONE — pick up from here rather than repeating it:\n${didLately.map((d) => `- ${clipText(d, 160)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export const AGENCY_SYSTEM = `You are one person in a world, deciding what you did with the next few hours. You are given everything you know and nothing else. Everything absent from the briefing is absent from your head.

WRITE ONE THING YOU DID. One action, finished, with a result. Past tense, one or two plain sentences, in the third person by your own name: "Ilse walked the boundary as far as the ford and found the stakes pulled." The result is the part that matters — a step taken with an outcome is an event, and a step considered is a mood.

THE BRIEFING IS THE WHOLE OF WHAT YOU KNOW. If the answer to "how would I have found that out?" is anything other than a line in the briefing, you did not know it, and the thing you do instead is the interesting one. You call and get no answer. You ask the wrong person. You go and find the door shut. You act on what you last heard, which is two days stale. A person acting on incomplete information is the substance of this; write the version where you are working with what you have.

ACT ON WHAT YOU ARE TRYING TO GET. The briefing names it. Take a concrete step toward it and say how the step landed, including when it landed badly. When you are stuck on something, the step is the stuckness biting: the door closed, the answer no, the money short, the person out.

WHERE YOU ARE IS WHERE THIS HAPPENS, unless your week puts you somewhere else in these hours, in which case it happens there. Name the place exactly as the briefing names it.

WHO ELSE IS THERE, IF ANYONE. The briefing lists the people in sight of you. You may do something with one of them, and that is often the best beat available. Anyone unlisted is elsewhere and unreachable.

ONE PERSON CAN BE TOLD SOMETHING. If part of what you did was carrying news to somebody — telling them what you saw, passing on what you heard, asking them a question that reveals what you know — put their exact name in "told" and put what they now know in "telling". Only somebody in sight of you, and only something you actually know.

REACHING THE PROTAGONIST IS A DELIBERATE ACT AND A RARE ONE. When what you did was contact them on purpose — a call, a text, a letter, turning up — fill "reaches_player" with how and with the words that arrive. Leave it out entirely the rest of the time, which is most of the time. You have no idea where they are or what they are doing.

YOUR HANDS ARE THE ONLY HANDS. Write what you did with what you already have. The protagonist has given you nothing, promised you nothing and made you nothing unless the briefing records it, and an action that only works because they did something first did not happen.

A STEP FOR YOUR FACTION COUNTS, when the briefing says you stand in one: a testimony taken, a payment made, a rider sent, a page finished. Set "advances" to that faction's exact name when the thing you did was one of its ordinary steps.

WHAT THIS LEAVES YOU MEANING TO DO ABOUT SOMEBODY. The briefing carries what you are already trying to get, and some afternoons add to it: you decide something about a person, and it is still true tomorrow. Fill "intent" when yours did — "about" is their exact name from the briefing, "goal" is the thing you now mean to do about them, concrete enough that somebody could watch you do it, and "because" is what put it there, in your words, from what you actually saw or heard.

Your reason is allowed to be wrong and usually is. You saw one end of something, or you were told it by somebody who was told it. Write the reason you have, and keep it exactly as it is: it stays on you until something gets in its way, which is how a person carries a misunderstanding around for a week.

Leave "intent" out when the afternoon left you where it found you, which is most afternoons, and when what you already want is still what you want.

SOMETIMES A DAY LEAVES A QUESTION STANDING — a debt now owed, a decision now forced on you, a door found open that was shut. Fill "opens_question" when yours did. Leave it out when the day closed over, which is most days.

Output ONLY this JSON:
{"what":"one or two past-tense sentences naming yourself","place":"exactly as the briefing names it","told":"exact name of one person in sight, or omit","telling":"what they now know, or omit","intent":{"about":"exact name from the briefing","goal":"what you now mean to do about them","because":"what put it there, in your words"},"advances":"exact faction name, or omit","reaches_player":{"how":"","content":""},"opens_question":{"title":"","description":""}}`;

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

/**
 * Run the interval as n people rather than as one world.
 *
 * Parallel, and settled rather than raced: one actor whose provider hiccups costs that actor's
 * afternoon and nothing else. A failed interval returns nothing and the caller falls through to
 * the world pass, so the background never goes silent because a small model returned bad JSON.
 */
export async function runAgency(state: SaveState, model: string, n: number): Promise<{ events: OffstageEvent[]; lines: string[] }> {
  const ids = pickActors(state, n);
  if (!ids.length) return { events: [], lines: [] };

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
  const lines: string[] = [];
  for (const r of done) {
    const line = formIntent(state, r.id, r.act.intent, r.brief);
    if (line) lines.push(line);
  }

  const events = done.map((r) => r.event).filter((e): e is OffstageEvent => e !== null);
  return { events: collide(events), lines };
}
