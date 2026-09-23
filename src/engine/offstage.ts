// OFFSTAGE — the world moving while nobody is watching it.
//
// Weft already simulates a lot in the background, but all of it is INTERNAL to characters: drives
// tick, wants regenerate, psyches settle, traits consolidate, rumors spread. What never happened
// was the world CHANGING — a steading burning, a herd lost, a kindred paying tribute late, a
// boat not coming back. So when the game went quiet the only source of new material was the
// pressure system, which manufactured something aimed at the player because that was its job.
// That's what made the story feel railroaded: the only thing that ever happened was you.
//
// This replaces that. Every OFFSTAGE_INTERVAL_MIN of IN-WORLD time it takes the world state and
// asks what happened elsewhere, under one hard constraint: none of it may be about the player.
// Not aimed at them, not caused by them, not a reaction to them, not staged for them to find.
//
// The events don't reach the player directly. They reach WITNESSES, who form memories, which seed
// rumors, which diffuse across the co-presence graph at the speed of people walking between
// places. So you learn the world changed the way you'd learn it — because someone told someone
// who told you, weeks late and half wrong. The emergence isn't in the event generator. It's in
// what the existing systems do with the event once it exists.

import { buildMessages, complete, safeJson } from "../llm";
import { applyEdgeDelta } from "./social";
import { authoredLine, hasAuthored } from "./authored";
import { uid } from "./state";
import { minutesBetween } from "./time";
import { mundaneObjective } from "./knowledge";
import { placeIntent } from "./places";
import { scheduleDigestLine } from "./schedule";
import { clipText } from "./text";
import { runAgency, MAX_ACTORS } from "./agency";
import { cleanMemoryContent } from "./memory";
import { updateMind } from "./mind";
import type { SaveState, Stance } from "./types";

/** In-world minutes between offstage passes. The world doesn't reorganize itself hourly. */

/**
 * THE PERSON WHO DID IT REMEMBERS DOING IT.
 *
 * runOffstage moves the ACTOR'S nervous system — "The body that lived it. The actor took the whole
 * of it; a witness took half" — and then writes a memory for the witnesses and for nobody else. So
 * a character alone in her own apartment took the relaxation cost of her own afternoon and kept no
 * recollection of it.
 *
 * What that afternoon was, from one save's offstage log, all of it hers and none of it in her head:
 * a pedicure campaign staged in the sightline of the player's open bedroom door; the whole
 * operation relocated to the entryway alcove, the four-foot choke point that is the only way out of
 * the apartment; a text sent rather than a walk to his door, because moving means smudging two
 * hours of work; the chicken finally dealt with at ten to eight; waking at five in the morning on
 * the couch with both plates gone gray in their own fat. Twelve memories in her bank at that point,
 * eleven of them about the player and the twelfth about his shoulder. The player, having read it:
 * "Is Abigail a human being?"
 *
 * Filed one importance step above a witness, because doing a thing is not seeing one, and written
 * through cleanMemoryContent so it lands in her own mouth rather than as a report about her. That
 * conversion is why the fronted-adverbial repair in memory.ts had to come first: every line this
 * pass writes opens with an unpunctuated time phrase — "Around 12:50 …", "At about 19:50 …",
 * "Sometime after five in the morning …" — and each of them was stored as "me decides", "me finally
 * comes", "me wakes up".
 */
export function rememberOwnAct(
  state: SaveState,
  actorId: string | null,
  what: string,
  place: string | undefined,
  turn: number,
): boolean {
  if (!actorId || actorId === "char_player" || !state.characters?.[actorId]) return false;
  const own = cleanMemoryContent(clipText(String(what ?? ""), 280), {
    name: state.characters[actorId].name ?? "", isPlayer: false,
  });
  if (!own) return false;
  const mem = (state.memory[actorId] ??= { character_id: actorId, core: [], episodic: [], beliefs: [], facts: [], knows: [] });
  mem.episodic.push({
    id: uid("mem"),
    turn,
    content: own,
    importance: 8,
    source: "offstage",
    where: place,
    when_label: state.world.current_time,
    emotional_charge: 0,
    decay: 0,
  } as any);
  return true;
}

export const OFFSTAGE_INTERVAL_MIN = 360;

export interface OffstageEvent {
  actor: string;        // WHO did it — a named person, kindred, faction, or a force (weather, sickness)
  place: string;        // where it happened
  what: string;         // one plain sentence, past tense
  witnesses: string[];  // names of tracked characters who saw or heard it firsthand; may be empty
  new_place?: string;   // a place this event brought into being, if any
  advances?: string;    // exact faction name whose clock this event moved a step, if any
  /** REACHING THE PLAYER DIRECTLY. Offstage events have only ever reached the player through
   *  witnesses and rumor — someone saw it, the news travelled. That models a village and nothing
   *  else. People text, call, write, and turn up at the door, and a story where the woman the player
   *  just left CANNOT contact him is not a story about consequences, it is a story about a man on
   *  holiday. When an event is somebody deliberately reaching the player, this is what arrives. */
  reaches_player?: { how: string; content: string };
  /** A QUESTION THE WORLD JUST OPENED. Threads and clocks were the only machinery with any pull on
   *  the story, and both are authored — by the forge at the start, by the bookkeeper from a scene the
   *  player was in. So the world could move all it liked offstage and never change what the story was
   *  ABOUT. A hundred and eight turns of one save produced forty-five offstage events and not one new
   *  question. When an event genuinely opens something unresolved — a decision now forced, a debt now
   *  owed, a door now standing open — it becomes a thread like any other, and the pressure system
   *  picks it up without knowing where it came from. */
  opens_thread?: { title: string; description: string };
}

export const OFFSTAGE_SYSTEM = `You report what happened in other parts of the world, among people who weren't thinking about the main character.

The main rule is that you don't invent the player into the world. Nothing should happen just because the player exists: no threat building up against them, no discovery left for them to find, no stranger forming an opinion about them, no faction turning its attention to them. The people of this world have their own business to get on with. This rule is about inventing things.

That rule doesn't stop people reacting to what the player did in public. Read on its own, it sounds like a ban on anyone approaching him, and in practice it was only ever followed in one direction. Four months into one save, the player abolished slavery, built a school out of light in the middle of the Forum, and put a spoken offer into the mind of everyone in the city. The four events this report produced for those hours were a baker's boy deciding not to offer him bread, a freedwoman crossing the lane to avoid his gate, a tradesman turning a rumour into a warning, and a married woman telling her husband that nobody went near the villa and that this was the right decision. Every one of those is a stranger forming an opinion about the player. They slipped through because a stranger turning away from the player looks like ordinary life, while a stranger turning toward him looks staged, but both are reactions to the player and both are allowed.
So when the player has done something in public that people would obviously react to, they do react, and the reactions go in every direction the people of this place would realistically take. People disagree with each other, so if your report has three people avoiding him and nobody approaching him, it's one-sided.

Never write the player doing anything. He is the one person in this world whose actions come only from what the player types, and none of your events can include him doing anything at all, whether that's drawing, giving, showing, telling, teaching, promising, agreeing or arriving. This rule exists because of a real mistake. A smith was reported laying out two iron rims from a sketch a foreigner had drawn for him, but no such drawing was ever made: thirty turns earlier the player had said he would make one, and he never did. The event invented the player's action and a day of forging based on it, and the record kept both. So if an event only works because the player did something, that event didn't happen. Write what the person did with what they already had. A smith with no drawing waits, guesses, gives up, or makes the thing wrong from what he half-heard, and any of those is better than inventing something the player did.

That rule doesn't stop the cast from acting on their own wants either. If a named person in the CAST list already wants something that involves the player, such as calling him, stopping herself from calling him, getting her things back, or saying the thing she never said, then acting on that want is ordinary offstage life, and you have to write it. Before this was spelled out, this report wouldn't touch the one person whose life the story had just torn apart. A woman whose recorded want was "get through the next day without calling him, and fail at it" went unwritten for twenty turns while three background regulars had busy evenings, because every want she had involved the player, and the player noticed she had disappeared from the story.
So never invent a relationship with the player, and always act on one that's already written down.

What you should write about is the everyday business of this place that matters to the people involved: a herd getting sick, a boat that's overdue, a marriage arranged between two families, a hostage returned or kept, someone dying of something ordinary, a field flooding, a long quarrel over a boundary stone getting worse, a faction taking one step toward the goal it already has, or the usual weather for this place and season. Keep each event small and specific.

Each event has to be caused by something that already exists in the world: a named person acting on a want they already have, a faction working toward the goal already written for it, the season, an animal, an illness, or a grudge already on record. Don't bring in a new faction or a new named power. You can create a small new place if the event needs one, like a burned farmstead, a camp or a new weir, and you should name it the way a person would say it out loud.

Start with the cast. The CAST list gives you named people and exactly what each of them is trying to do. At least one of your events has to be a named cast member taking a concrete step toward one of the wants listed there, with the step actually taken and something coming of it. For example, a smith finishes the crates and hides them, an investigator reaches the gate of the estate and is turned away, or an organiser gets the numbers he needs. If someone's want is marked as stuck, the step can be the problem getting worse: the shipment is missed, the door stays shut, the ally says no. Anyone you invent for the occasion, like a bargeman, a shopkeeper or a widow, is a minor extra in this report. A report where none of the cast's wants moved forward while three strangers had a busy afternoon is wrong.

Witnesses are the only way any of this reaches the story. An event that nobody in the cast saw or heard still happened, but it can never turn into gossip or come up in a scene. So list, by exact name, every cast member the WHO IS STANDING WHERE list puts at the place where the event happens, plus anyone else who would obviously have heard about it firsthand, through their own work, their own faction, their own household or from the room next door. Use only real names from the CAST, never made-up ones, and never someone the record puts somewhere else. Don't leave this empty just to be safe, though. If an event couldn't plausibly have any witness at all, write a different event that could.

Nobody offstage knows anything they weren't told. Your events break this rule more often than any other, because it's easy to give somebody knowledge without noticing you've done it. Everyone in this report knows exactly two kinds of thing: what they saw or heard themselves where they were standing, and what a named person told them by some route that has already happened. They know nothing else. They don't know what the player typed, texted, said on a phone call or decided in private. They don't know what happened in a room they weren't in, however loud it was. They don't know what another character is planning, feeling or hiding unless that character told them out loud. And if you invented a route for someone to hear something last turn, they had to be somewhere that route could actually reach.

If an event needs someone to know something they have no way of knowing, don't add a sentence explaining how they found out, because that explanation is an invention too. Write the version where they don't know: they call and get voicemail, they ask the wrong person, they guess and guess wrong, or they turn up with an out-of-date reason. People not knowing things is useful for the story, because when someone doesn't know something, somebody else can still tell them.

The player's own words are where this goes wrong most often. In one save, the player sent his wife a private text, and one turn later a barista he had met once was reading that text out word for word over the phone to his wife's friend. That was an invented chain of people passing it along, in an event that also told the friend where he was flying and why, and nobody had told either of them anything. What the player says, types, or does on their own stays between the player and whoever was actually in the room, and it goes no further until the record shows it spreading.

Faction clocks only move here. A faction working toward a goal the player never sees does that work offstage in ordinary steps: a statement taken, a boundary walked, a meeting held, a page finished, a rider sent. When one of your events is a step like that for one of the factions listed, set "advances" to that faction's name. This is the only way their clocks move, so a clock the player never runs into would otherwise never move at all. A faction marked HAS NOT MOVED ONCE still has things to do, so write its first ordinary step. Don't credit an event to a faction that has nothing to do with it.

Some events leave a question open. Most events are over once they happen, like a shift worked, a call made or a meal cooked. Some leave something unresolved that somebody will have to deal with, and those drive the story forward. When one of your events leaves a real question hanging, such as a decision that someone is now forced to make, a promise that's now due, a position that's now empty, or a door that was shut and is now open, set "opens_thread" with a short title and one plain sentence. Don't open one for an ordinary event, don't open more than one per report, and never open a question that amounts to "what will the player do". The question belongs to the world, and the player may never even find out it exists.

Write one to three events. Fewer is right when there isn't much in the world to work with. "The cast wanted things and none of them moved" is an acceptable report, and you still have to write it out.

Reply with only this JSON:
{"events":[{"actor":"","place":"","what":"","witnesses":[],"new_place":"","advances":"","reaches_player":{"how":"Only when this event is someone deliberately getting in touch with the player, by text, call, letter or turning up at the door. Say which. Leave this out completely otherwise, because most events aren't aimed at anyone.","content":"what actually arrives, in their own words if it's a message, meaning the text exactly as sent, typos included"},"opens_thread":{"title":"","description":"Leave this out completely unless this event leaves a real unresolved question in the world"}}]}`;

/** Loose tie between a character and a faction clock: their own wants, background, or the faction's
 *  name and objective share ground. Cheap and forgiving — this only decides whether to SUGGEST
 *  someone as able to take the next step, never whether the step counts. */
function relatedToFaction(c: any, clock: any): boolean {
  const words = `${clock.faction} ${clock.objective}`.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const blob = `${c.name} ${c.background ?? ""} ${(c.core_traits ?? []).join(" ")} ${c.drive?.goal ?? ""} ${(c.drive_queue ?? []).map((d: any) => d?.goal).join(" ")}`.toLowerCase();
  const STOP = new Set(["their", "them", "from", "with", "that", "this", "into", "over", "before", "after", "against", "there", "these", "would", "could", "about"]);
  return words.some((w) => !STOP.has(w) && blob.includes(w));
}

export function worldDigest(state: any): string {
  const places = Object.values<any>(state.world?.places ?? {})
    .filter((p) => p.id !== "loc_offscene")
    .map((p) => `- ${p.name}: ${p.description_facts ?? ""}`).join("\n");

  // WANTS. This read `c.drive_goals ?? [c.drive_goal]` — two field names that exist only on the
  // FORGE's input payload, never on a live character. On any real save both were undefined, so
  // every single cast member was reported to the world-sim as "Wants: nothing pressing," and the
  // one model whose job is to move the background was told the background wants nothing. It then
  // did the only thing left: invent unnamed walk-ons (a bargeman, a warehouse factor) and write
  // their small business instead, while the actual cast's stated goals — a secret weapons order, a
  // missing-girls investigation, a protest being organized — sat untouched for a hundred turns.
  // The live fields are `drive` and `drive_queue`.
  // An AUTHORED want goes in first and reads as an ordinary one. It is the want most likely to be
  // worth a scene — it is standing, it escalates, and it is the only one on the card that a human
  // chose — so it leads. See engine/authored.ts.
  const wantsOf = (c: any): string =>
    [hasAuthored(c) && !c.authored.paused ? authoredLine(c.authored) : null,
     c.drive?.goal, ...(c.drive_queue ?? []).map((d: any) => d?.goal)].filter(Boolean).join("; ");

  // SOMEBODY IN THE ROOM IS NOT ELSEWHERE. This filter excluded the player, the dead and the
  // departed, and nothing else — so a character standing in the scene was handed to a pass whose
  // own opening line is "you report what happened ELSEWHERE, to people who were not thinking about
  // the protagonist". From a save at turn 61: Amber is in `world.present`, in a coffee shop, with
  // her hand on Joe's sleeve — and the world report for that same turn opens "Elsewhere: Amber
  // takes the receipt slip, folds it once, and gets up... gets her right sneaker off standing up,
  // heel against the baseboard". Two hundred words of her being somewhere else while the player
  // was looking at her. Both versions are then filed: the bookkeeper wrote "Amber's history now
  // carries 1 defining moment" off the one that never happened. The player's report was that he had
  // no clue what was happening, and that is the honest response to reading both.
  const inScene = new Set(state.world?.present ?? []);
  const cast = Object.entries<any>(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed"
      && !inScene.has(id))
    .map(([cid, c]) => {
      const where = state.world.places[c.location]?.name ?? "unknown";
      const wants = wantsOf(c);
      const blocked = c.drive?.blocker ? ` Stuck on: ${c.drive.blocker}.` : "";
      // Without pronouns this pass wrote "Tigris wakes in the Subura and tries to remember what HE
      // can sell for breakfast" and "Clodia asks HIM where Rabi and Lucia have gone" about a woman
      // whose record says she/her. The lines it writes become witness memories, so the error is
      // filed rather than merely read.
      // AND WHAT THEIR WEEK HAS THEM DOING. Without it this pass wrote a woman taking a slow
      // morning at home during hours the engine had already put her at the bakery — the report and
      // the ledger describing the same hour differently, and the report is what becomes memory.
      const due = scheduleDigestLine(state, cid);
      return `- ${c.name}${c.pronouns ? ` (${c.pronouns})` : ""}, at ${where}. Wants: ${wants || "nothing pressing"}.${blocked}${due}`;
    }).join("\n");

  // Which cast members are standing where, so witnesses can be named rather than guessed at.
  const byPlace = new Map<string, string[]>();
  for (const [id, c] of Object.entries<any>(state.characters ?? {})) {
    if (id === "char_player" || c.status === "dead" || c.status === "departed") continue;
    if (inScene.has(id)) continue;   // in the room with the player; they witness the SCENE, not this
    const where = state.world.places[c.location]?.name;
    if (!where) continue;
    byPlace.set(where, [...(byPlace.get(where) ?? []), c.name]);
  }
  const whoIsWhere = [...byPlace.entries()].map(([p, names]) => `- ${p}: ${names.join(", ")}`).join("\n");

  const clocks = (state.world?.clocks ?? [])
    .filter((c: any) => c.status === "running")
    .map((c: any) => {
      // Name the people who could actually take the next step, so "no way to progress" stops being
      // the default answer for a faction whose own members are standing right there wanting it.
      const movers = Object.values<any>(state.characters ?? {})
        .filter((ch) => ch.status !== "dead" && ch.status !== "departed" && wantsOf(ch) && relatedToFaction(ch, c))
        .map((ch) => ch.name);
      const stalled = c.filled === 0 ? " — HAS NOT MOVED ONCE, so work out its next ordinary step" : "";
      return `- ${c.faction}: ${c.objective} (${c.filled}/${c.segments})${stalled}${movers.length ? `. In a position to move it: ${movers.join(", ")}` : ""}`;
    }).join("\n");

  const threads = (state.world?.threads ?? [])
    .filter((t: any) => t.status === "active")
    .map((t: any) => `- ${t.title}: ${t.description ?? ""}`).join("\n");

  const recent = (state.world?.offstage_log ?? []).slice(-8)
    .map((e: any) => `- ${e.what}`).join("\n");

  const b = state.world_bible ?? {};
  return [
    `SETTING: ${b.name ?? ""} — ${b.era ?? ""}`,
    `MATERIAL WORLD: ${b.technology_level ?? ""}`,
    `CLIMATE AND SEASON: ${b.climate_and_geography ?? ""}. It is now ${state.world?.current_time ?? ""}, weather ${state.world?.weather ?? ""}.`,
    `WHAT PEOPLE HERE FEAR: ${b.what_people_fear ?? ""}`,
    `POLITICS: ${b.political_situation ?? ""}`,
    `\nPLACES:\n${places}`,
    `\nCAST: THE PEOPLE WHOSE WANTS ARE YOUR MAIN MATERIAL (and the only names you can use as witnesses):\n${cast}`,
    whoIsWhere ? `\nWHO IS STANDING WHERE (when your event happens at someone's location, list them as a witness):\n${whoIsWhere}` : "",
    clocks ? `\nFACTIONS AND THE GOALS THEY ARE ALREADY WORKING TOWARD:\n${clocks}` : "",
    threads ? `\nOPEN QUESTIONS IN THE WORLD:\n${threads}` : "",
    recent ? `\nALREADY REPORTED (don't repeat these or carry them on):\n${recent}` : "",
  ].filter(Boolean).join("\n");
}

/** Turns after which the world moves regardless of the in-world clock. */
export const OFFSTAGE_INTERVAL_TURNS = 25;

/**
 * True when enough in-world time has passed since the last offstage pass — OR enough turns have.
 *
 * The clock alone is not enough. A story told mostly in conversation burns very little in-world
 * time per turn, so a six-hour interval can mean the world moves five times in a hundred and
 * twenty turns: forty-three real turns of play between one report and the next, during which the
 * background is genuinely frozen. Time is the right unit for how much CAN have happened; turns are
 * the right unit for how long the player has been waiting to see it.
 */
/**
 * How long the player waits between world reports, in turns, scaled to how much world there is.
 *
 * A flat 25 is right for a kingdom and far too long for a kitchen. In a four-person domestic story
 * the offstage cast IS the story's other half: with the player in a hotel room, the only thing that
 * can happen anywhere else is the two or three people he left behind, and making him wait
 * twenty-five turns to hear from any of them means the world is simply switched off. A big cast
 * generates plenty of visible motion on its own and does not need the reports as often.
 */
export function offstageIntervalTurns(state: any): number {
  const offstage = Object.entries<any>(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed"
      && !(state.world?.present ?? []).includes(id)).length;
  if (offstage <= 2) return 6;
  if (offstage <= 4) return 10;
  if (offstage <= 7) return 16;
  return OFFSTAGE_INTERVAL_TURNS;
}

export function offstageDue(state: any): boolean {
  const last = state.world?.offstage_last_time;
  if (!last) return true;
  if (minutesBetween(last, state.world.current_time) >= OFFSTAGE_INTERVAL_MIN) return true;
  const lastTurn = state.world?.offstage_last_turn ?? 0;
  return (state.world?.current_turn ?? 0) - lastTurn >= offstageIntervalTurns(state);
}

/**
 * Run the world forward offstage. Returns log lines for the offscreen feed.
 *
 * Everything this produces enters the world through the SAME doors as anything else: witnesses get
 * memories, memories seed rumors, rumors diffuse. Nothing here is handed to the narrator as a plot
 * point, and nothing here is guaranteed to reach the player at all. Some of it never will, which
 * is the point — a world with events the player never learns about is a world, and one where
 * every event finds its way to the protagonist is a story pretending to be one.
 */
/** How strong a tie has to be before it decides where somebody goes. Directional: SEEK draws a
 *  person toward the player, AVOID sends them anywhere else. */
const SEEK = 25;
const AVOID = -25;

/**
 * Bring people back from "elsewhere".
 *
 * OFFSCENE is a holding pen the engine puts characters in when their location can't be resolved —
 * and nothing has ever taken them out of it. A character who drifted in stays in permanently: no
 * scene can include them (presence derives from co-location), no beat can reference them, and the
 * narrator has no reason to think of them. Muirenn — the story's central relationship for two
 * hundred turns — sat in it while the cast reduced to whoever happened to be standing nearby.
 *
 * People do not vanish from a settlement. Someone offscene with a live want, or a strong tie to
 * where the player is, walks back into the world on their own. Deterministic, cheap, no model call.
 */
export function returnFromOffscene(state: any): string[] {
  const OFF = "loc_offscene";
  const log: string[] = [];
  const real = Object.values<any>(state.world.places).filter((p) => p.id !== OFF);
  if (!real.length) return log;

  for (const [id, c] of Object.entries<any>(state.characters ?? {})) {
    if (id === "char_player") continue;
    // A STAMP THAT ONLY EVER GETS CLEARED ON THE WAY BACK IS A FOSSIL. It was deleted when this
    // pass returned someone, and never when the story returned them itself — so a character the
    // narrator walked back into the room kept a mark saying she had been nowhere since turn 73,
    // forty-one turns earlier. The next time she genuinely stepped out, her grace period was
    // already spent and she was eligible to be teleported back on the very next pass.
    if (c.location !== OFF) { if (c.offscene_since !== undefined) delete c.offscene_since; continue; }
    if (c.status === "dead" || c.status === "departed") continue;

    // Somebody else has them. The world does not hand them back because eight turns went by.
    if (c.held) continue;

    // How long have they been nowhere? Give it a little time before hauling them back — someone
    // can plausibly be out of sight for a few hours.
    c.offscene_since ??= state.world.current_turn;
    if (state.world.current_turn - c.offscene_since < 8) continue;

    // ── WHERE WOULD THEY ACTUALLY GO? ──
    //
    // This used to read `Math.abs(e.warmth) >= 25` and send anyone over that line straight to the
    // player's location. Absolute value. A bond and a grudge came out of it identical, so the
    // people who most wanted nothing to do with the player were the ones the engine most reliably
    // delivered to his door — and it landed them ON him, not near him, because presence is derived
    // from co-location, so the next turn they were simply in the room with no arrival written.
    //
    // In one save that meant a woman at warmth -100 kept reappearing in a house she had been
    // thrown out of and arrested at, an ex-wife at -28 turned up in a home she had never been to,
    // and the one man in the cast who mildly LIKED the player, at +4, was scattered to a random
    // location every time — which is why the player could not work out what he had to do with
    // anything. The whole social graph was being read through its absolute value.
    //
    // A tie is directional. Warmth draws you toward someone; a grudge sends you the other way.
    // The one thing that overrides the grudge is a want that names them — and that is a stated
    // drive the player can read and the engine can retire, not arithmetic nobody can see.
    const edge = (state.world.edges ?? []).find((e: any) => e.from === id && e.to === "char_player");
    const bond = (edge?.warmth ?? 0) >= SEEK || (edge?.trust ?? 0) >= SEEK;
    const grudge = (edge?.warmth ?? 0) <= AVOID || (edge?.trust ?? 0) <= AVOID;

    const goal = String(c.drive?.goal ?? "").toLowerCase();
    const playerNames = [String(state.characters?.char_player?.name ?? "").toLowerCase(), "the player"]
      .filter((n) => n.length >= 3);
    const wantsThePlayer = playerNames.some((n) => goal.includes(n));

    // a want that names a place is the plainest answer of all, and the comment here promised it
    // long before the code did it
    const namedPlace = goal
      ? real.find((p: any) => p.name.length >= 4 && goal.includes(p.name.toLowerCase()))?.id
      : undefined;

    // failing all that: home. A place carrying their own name is where a person goes when they
    // have nowhere to be, and it beats the dice for everyone the story has given a home to.
    const first = String(c.name ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
    const homeHit = first.length >= 3
      ? real.find((p: any) => p.name.toLowerCase().includes(first))?.id
      : undefined;
    // ...unless their home is where the player happens to be standing, in which case it is not
    // somewhere else and sending a grudge there defeats the whole point
    const home = grudge && homeHit === state.world.player_location ? undefined : homeHit;

    const elsewhere = real.filter((p: any) => p.id !== state.world.player_location);
    const away = (elsewhere.length ? elsewhere : real)[Math.floor(Math.random() * (elsewhere.length || real.length))].id;

    const target =
      namedPlace ??
      (wantsThePlayer || (bond && !grudge) ? state.world.player_location : undefined) ??
      home ??
      away;

    c.location = target;
    delete c.offscene_since;
    log.push(`${c.name} is back in the world, at ${state.world.places[target]?.name ?? "somewhere"}.`);
  }
  return log;
}

/**
 * A clock whose objective is no longer reachable is not suspense, it is a dead field in the save.
 *
 * The knowledge gate can convert an unreachable objective into ordinary business, but it only runs
 * when the SIMULATOR names the clock in a scene — and a faction the player never meets is never
 * named, so the conversion never fires. Result: a rebel clock whose whole objective was "receive a
 * shipment of weapons from Elara" sat at 0/6 for a hundred and twenty turns after Elara left the
 * story, invisibly, with no sign to the player that the thread was over.
 *
 * The offstage pass is where a faction the player never meets lives, so it is where this belongs.
 * Only ever converts a clock that has NEVER moved and whose objective names someone gone.
 */
export function retireUnreachableClocks(state: any): string[] {
  const log: string[] = [];
  const gone = Object.values<any>(state.characters ?? {})
    .filter((c) => c.status === "dead" || c.status === "departed")
    .map((c) => String(c.name ?? "").toLowerCase())
    .filter((n) => n.length >= 3);
  if (!gone.length) return log;
  for (const clock of state.world?.clocks ?? []) {
    if (clock.status !== "running" || clock.filled > 0) continue;
    const obj = String(clock.objective ?? "").toLowerCase();
    const missing = gone.find((n) => obj.includes(n));
    if (!missing) continue;
    clock.objective = mundaneObjective(clock.faction);
    clock.status = "stalled";
    delete clock.stalled_since;
    log.push(`${clock.faction} has lost what they were waiting for and goes back to its own business.`);
  }
  return log;
}

/**
 * WHICH OF THE TWO WAYS THE WORLD MOVES THIS INTERVAL.
 *
 * With agency off this is always the world pass and the function below is the only path, exactly
 * as it has been. With agency on, most intervals are the cast acting for themselves out of what
 * each of them knows — and every `agency_world_ratio`-th interval is still the world pass, because
 * nobody in the cast is the weather. A ratio of 0 retires the world pass and makes the background
 * purely the cast's own doing, which is cheaper and is a different story.
 *
 * Counted in intervals rather than turns so the cadence holds whether a save burns six hours a turn
 * or six minutes.
 */
export function agencyTurn(state: any): { actors: number; worldPass: boolean } {
  const n = Math.max(0, Math.min(MAX_ACTORS, Number(state.model_settings?.agency_actors ?? 0) || 0));
  if (!n) return { actors: 0, worldPass: true };
  const ratio = Math.max(0, Number(state.model_settings?.agency_world_ratio ?? 3) || 0);
  const count = Number(state.world?.agency_passes ?? 0);
  return { actors: n, worldPass: ratio > 0 && count % ratio === 0 };
}

export async function runOffstage(state: any, model: string): Promise<string[]> {
  if (!offstageDue(state)) return [];
  state.world.offstage_last_time = state.world.current_time;
  state.world.offstage_last_turn = state.world.current_turn ?? 0;
  const retired = retireUnreachableClocks(state);

  const plan = agencyTurn(state);
  if (plan.actors) state.world.agency_passes = (state.world.agency_passes ?? 0) + 1;

  // THE CAST MOVES ITSELF. n small calls, each one holding a single person's knowledge, run in
  // place of the one call that holds everybody's. A failure here is not a failure of the interval:
  // an empty result falls through to the world pass below, so a small model that returned bad JSON
  // costs the actors' afternoon and never costs the background its motion.
  if (plan.actors) {
    try {
      const { events, lines } = await runAgency(state, model, plan.actors);
      if (events.length) return [...applyOffstage(state, events, retired), ...lines];
    } catch { /* fall through to the world pass */ }
    if (!plan.worldPass) return applyOffstage(state, [], retired);
  }

  let events: OffstageEvent[] = [];
  try {
    const msgs = buildMessages(OFFSTAGE_SYSTEM, "WORLD STATE:", worldDigest(state), model);
    const out = await complete(msgs, model, model, true, 1200);
    events = safeJson<{ events?: OffstageEvent[] }>(out.text, {}).events ?? [];
  } catch {
    return [];
  }

  return applyOffstage(state, events, retired);
}

/** Everything the world's report DOES to the world. Split out from the call so it can be exercised
 *  without a model: this is where an event becomes a memory, a rumour seed, a clock step, a place,
 *  a message on the player's phone, and — the part that was missing — a question the story now has
 *  to answer. */
/** Ways this pass refers to the protagonist when it is about to have him do something: by name, or
 *  by the epithet the cast would use for a man from nowhere. */
const PLAYER_HAND = /\b(?:the|a)\s+(?:foreign|foreigner'?s?|strange|stranger'?s?|outsider'?s?|newcomer'?s?)\s*(?:hand|man|one)?\b|\bthe (?:foreigner|stranger|outsider|newcomer)\b/i;
/** Acts that put something into the world — the ones that leave an object, a promise, or a fact
 *  behind. A sentence where the player merely appears ("Rufus thinks about Marcus") is untouched. */
const HAND_OF = /\b(sketch(?:ed|es)?|draw|drew|drawn|design(?:ed)?|gave|given|hand(?:ed)?|show(?:ed|n)?|deliver(?:ed)?|brought|paid|sold|promis(?:ed)|agree(?:d)?|told|taught|wrote|written|made|built|left him|sent)\b/i;

export function playerAuthored(what: string, playerName: string): boolean {
  const text = String(what ?? "");
  for (const raw of text.split(/(?<=[.;!?])\s+|—/)) {
    const s = raw.trim();
    if (!s) continue;
    const namesPlayer = (playerName.length >= 3 && new RegExp(`\\b${playerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s)) || PLAYER_HAND.test(s);
    if (!namesPlayer) continue;
    // The player must be the one DOING it: an act verb after the reference, in the same clause.
    const at = s.search(PLAYER_HAND) >= 0 ? s.search(PLAYER_HAND) : s.toLowerCase().indexOf(playerName.toLowerCase());
    if (at < 0) continue;
    if (HAND_OF.test(s.slice(at))) return true;
  }
  return false;
}

/**
 * WHAT WATCHING SOMEBODY DO SOMETHING DOES TO WHAT YOU THINK OF THEM.
 *
 * Offstage events reached witnesses as a memory and stopped there. A character could stand in a
 * yard and watch a neighbour turn a starving family away, file the memory, and feel exactly the
 * same about that neighbour afterwards as before — because the only thing in the engine that ever
 * moved an NPC-to-NPC bond was `tickBonds`, which drifts on how alike two CARDS are and knows
 * nothing whatever about what either person has done. So the cast warmed and cooled toward each
 * other on temperament alone, for the whole length of a game, while the world's own events washed
 * over them without leaving a mark. That is the mechanism behind "their relationships never move":
 * the events were real, the witnesses were real, and nothing connected the two.
 *
 * Read lexically, in the house style — zero tokens, no save migration. NARROW on purpose, and
 * narrow in a specific direction: this is not the rumor field's dread/warm question ("would a town
 * retell this?"). A plague is dread and tells you nothing about the person who caught it. The
 * question here is only ever AGENTIVE — did this person do something to somebody, or for them.
 * Everything else scores zero and moves nothing.
 */
const ACTOR_CRUEL = /\b(struck|beat|stabbed|shot|killed|murdered|attacked|robbed|stole|cheated|swindled|betrayed|denounced|informed on|turned (?:\w+ ){0,3}(?:away|out)|evicted|refused (?:to )?(?:help|pay|feed|shelter|open)|broke (?:his|her|their|the) (?:word|promise|oath)|lied to|humiliated|threatened|blackmail\w*|seized|burned (?:down )?(?:the|his|her|their)|drove (?:\w+ ){0,3}off (?:the|his|her|their) land|left (?:\w+ ){0,3}to (?:die|starve)|abandoned)\b/i;
const ACTOR_KIND = /\b(helped|paid|repaid|fed|sheltered|took (?:\w+ ){0,2}in|nursed|tended|carried|defended|protected|warned|hid|freed|rescued|saved|mended|repaired|gave|forgave|stood up for|spoke for|vouched for|kept (?:his|her|their) (?:word|promise|oath)|sat with|buried|delivered|brought (?:\w+ ){0,3}(?:food|water|medicine|word))\b/i;

/**
 * AND WHAT LIVING THROUGH IT DOES TO THE BODY THAT LIVED IT.
 *
 * The pass above answers "what does this make me think of you", and it moves edges. Nothing has ever
 * moved a NERVOUS SYSTEM. Measured: zero references to relaxation or psyche anywhere in this file.
 * So the world's own report could hand a man the first phone call to his dead husband's brother
 * since the funeral, ringing four times into a voicemail still recorded in David's voice — an actual
 * event from a save's offstage log — file it as his memory, seed a rumour off it, and leave him at
 * precisely the relaxation he had before it happened. The story moved and the body did not.
 *
 * This is a DIFFERENT question from the one above and needs its own read, which is why it is not a
 * reuse. Agentive valence deliberately scores a plague at zero, because catching one tells you
 * nothing about the person who caught it — correct for opinion, exactly wrong for a body. What
 * matters here is only whether the thing that happened was hard or good to be inside of.
 *
 * Same discipline as everything else in this file: lexical, zero tokens, no migration, and narrow —
 * an event that matches neither list moves nobody. Small on purpose. This is something that happened
 * between scenes, not a scene.
 */
const HARD = /\b(died|dead|death|funeral|buried|killed|lost|losing|failed|failing|refused|denied|rejected|evicted|fired|foreclos\w*|repossess\w*|broke down|broken|burned|flood\w*|stolen|robbed|attacked|beaten|threatened|arrested|collapsed|sick|illness|injur\w*|hospital|overdue|owed|debt|late again|no answer|never called back|didn'?t come|wouldn'?t come|turned (?:\w+ ){0,2}away|walked out|left (?:him|her|them))\b/i;
const GOOD = /\b(paid off|settled|cleared|approved|accepted|hired|healed|recovered|mended|fixed|found|finished|delivered|arrived safe|came home|got word|said yes|agreed|forgave|reunited|born|married|celebrat\w*|thanked|helped (?:him|her|them)|came through)\b/i;

/** −1 hard / +1 good / 0 nothing a body should move on. */
export function eventImpact(what: string): number {
  const t = String(what ?? "");
  const hard = HARD.test(t), good = GOOD.test(t);
  if (hard === good) return 0;
  return hard ? -1 : 1;
}

/** What an offstage event does to the relaxation of the person who lived it. Halved for somebody who
 *  only watched: being in the yard when it happened is not the same as it happening to you. */
export const OFFSTAGE_SHOVE = 1.4;

/** −1 cruel / +1 kind / 0 nothing anyone's opinion should move on. */
export function actorValence(what: string): number {
  const t = String(what ?? "");
  const cruel = ACTOR_CRUEL.test(t);
  const kind = ACTOR_KIND.test(t);
  if (cruel === kind) return 0; // neither, or an ambiguous both — move nothing
  return cruel ? -1 : 1;
}

export function applyOffstage(state: any, events: OffstageEvent[], retired: string[] = []): string[] {
  const byName = new Map<string, string>();
  for (const [id, c] of Object.entries<any>(state.characters ?? {})) {
    if (id !== "char_player") byName.set(c.name.toLowerCase(), id);
  }

  const log: string[] = [...retired];
  const turn = state.world.current_turn ?? 0;

  const playerName = String(state.characters?.["char_player"]?.name ?? "").split(/\s+/)[0];

  for (const ev of events.slice(0, 3)) {
    if (!ev?.what) continue;
    // THE PLAYER DOES NOT ACT IN THESE EVENTS, and until now nothing said so.
    //
    // Turn 43 of a save: "Titus, unable to leave the bicycle riddle alone, lays out the two iron
    // rims A FOREIGN HAND SKETCHED FOR HIM and finds neither will true against the other — the
    // axle-mounts he shaped this afternoon…". The player's last word on the subject was thirty-three
    // turns earlier, "I'll create the design for the bike", and he never did. This pass invented the
    // drawing, then a smith forging two rims and a set of axle-mounts from it, and the applier filed
    // the whole thing as a fact in Titus's memory. The player's question was how a man he never gave
    // a design to came to have one built.
    //
    // The prompt's one rule is about events existing BECAUSE of the player. This is the other thing:
    // an event that quietly writes the player's own hand into the past. Both ends are covered now —
    // the rule above, and this, which does not need the model to have obeyed it.
    if (playerAuthored(ev.what, playerName)) {
      log.push(`offstage: dropped an event that had ${playerName || "the player"} doing something he never did: "${String(ev.what).slice(0, 90)}…"`);
      continue;
    }

    // SOMEBODY REACHED THE PLAYER. Queued for the next turn's directive rather than applied here:
    // the narrator has to render it arriving, or it is a thing that happened to nobody.
    const rp = ev.reaches_player;
    if (rp?.how?.trim() && rp?.content?.trim()) {
      const from = String(ev.actor ?? "").trim() || "someone";
      (state.world.inbound ??= []).push({
        from, how: clipText(rp.how, 110), content: clipText(rp.content, 600), turn,
      });
      state.world.inbound = state.world.inbound.slice(-3);
      log.push(`${from} reached out: ${clipText(rp.how, 90)}`);
    }

    // A place the event brought into being. The forge's ten were never meant to be the whole
    // world forever — a world that cannot grow new ground is a stage set.
    // ...but it must be new GROUND, not a room in somewhere that exists. This checked the name for
    // exact equality against the gazetteer and created on any miss — no containment test, no
    // similarity test, no room-noun test — so it was the loosest of the four paths that can mint a
    // location, and the world it grew was largely a maze of near-duplicates. One gate now: see
    // existingPlaceFor in turn.ts.
    if (ev.new_place?.trim()) {
      const name = clipText(ev.new_place, 80);
      const intent = placeIntent(state, name, "offstage");
      if (intent && "create" in intent) {
        const pid = uid("loc");
        state.world.places[pid] = { id: pid, name, description_facts: clipText(ev.what, 240), contains: [], founding: false };
      }
    }

    (state.world.offstage_log ??= []).push({ turn, time: state.world.current_time, what: ev.what, place: ev.place, actor: ev.actor });

    // A QUESTION THE WORLD OPENED FOR ITSELF. Once it is a thread it is indistinguishable from an
    // authored one: beat selection weighs it, the pressure system can pick it as a source, the fate
    // spine counts it. Capped hard — the world gets to raise questions, not to bury the story in
    // them — and never duplicated against a thread that already says the same thing.
    const ot = ev.opens_thread;
    if (ot?.title?.trim() && ot?.description?.trim()) {
      const title = clipText(ot.title, 90);
      const active = (state.world.threads ?? []).filter((t: any) => t.status === "active");
      const dup = active.some((t: any) => {
        const a = new Set(t.title.toLowerCase().split(/\W+/).filter(Boolean));
        const b = title.toLowerCase().split(/\W+/).filter(Boolean);
        return b.length && b.filter((w) => a.has(w)).length / b.length > 0.6;
      });
      if (!dup && active.length < 12) {
        state.world.threads.push({
          id: uid("thr"), title, description: clipText(ot.description, 300),
          status: "active", tension: 3, turn_started: turn,
        } as any);
        log.push(`the world opened a question: ${title}`);
      }
    }

    // Witnesses get a real memory. This is the ONLY channel by which an offstage event can ever
    // reach the player — through a person who was there, then through whoever they talk to.
    //
    // CO-LOCATION FALLBACK. In practice the model returned an empty witness list every single time,
    // which made the whole subsystem write-only: a hundred turns of coherent, causally linked world
    // motion that no one in the story could ever learn about. Who was standing at a place is not a
    // judgement call the model needs to make — the state knows. So when it names nobody, we look up
    // who is actually there and let them see it. Anyone the model DID name still wins; this only
    // fills a vacuum.
    let witnessNames = (ev.witnesses ?? []).map((w) => String(w).toLowerCase().trim()).filter((w) => byName.has(w));
    if (!witnessNames.length && ev.place?.trim()) {
      const here = Object.values<any>(state.world.places ?? {}).find(
        (p: any) => p.name?.toLowerCase().trim() === ev.place.toLowerCase().trim(),
      );
      if (here) {
        witnessNames = Object.entries<any>(state.characters ?? {})
          .filter(([id, c]) => id !== "char_player" && c.location === here.id && c.status !== "dead" && c.status !== "departed")
          .map(([, c]) => c.name.toLowerCase());
      }
    }
    // Who did it, if the cast contains them — needed for the edge pass below.
    const actorId = byName.get(String(ev.actor ?? "").toLowerCase().trim()) ?? null;
    const valence = actorValence(ev.what);
    // THE BODY THAT LIVED IT. The actor took the whole of it; a witness took half. Never the player —
    // nothing offstage is about them, and their scalar is not the engine's to author from a report
    // they were not in. Grief accrues the same way a scene's does, so a hard stretch offstage still
    // lowers the resting point rather than being erased by the next turn's drift.
    const impact = eventImpact(ev.what);
    if (impact !== 0) {
      const felt: [string | null, number][] = [[actorId, OFFSTAGE_SHOVE], ...witnessNames.map((w) => [byName.get(w) ?? null, OFFSTAGE_SHOVE / 2] as [string | null, number])];
      const done = new Set<string>();
      for (const [who, size] of felt) {
        if (!who || who === "char_player" || done.has(who)) continue;
        done.add(who);
        const psy = state.condition?.[who]?.psyche; if (!psy) continue;
        const d = impact * size;
        psy.relaxation = Math.max(-10, Math.min(10, psy.relaxation + d));
        if (d <= -1) psy.grief_drag = Math.min(6, (psy.grief_drag ?? 0) + Math.abs(d) * 0.15);
      }
    }

    // THE PERSON WHO DID IT REMEMBERS DOING IT.
    //
    // The block above moves the ACTOR'S nervous system — "The body that lived it. The actor took the
    // whole of it; a witness took half" — and then the loop below writes a memory for the witnesses
    // and for nobody else. So a character alone in her own apartment got the relaxation cost of her
    // own afternoon and no recollection of it.
    //
    // What that afternoon was, from one save's offstage log, all of it hers, none of it in her head:
    // a pedicure campaign staged in the sightline of the player's open bedroom door; the whole
    // operation relocated to the entryway alcove, the four-foot choke point that is the only way
    // out; a text sent rather than a walk to his door, because moving means smudging two hours of
    // work; the chicken finally dealt with at ten to eight; waking at five in the morning on the
    // couch with both plates gone gray. Twelve memories in her bank at the time, eleven of them
    // about the player, and the twelfth about his shoulder. The player's question, after reading it:
    // "Is Abigail a human being?"
    //
    // Filed at importance 8 — one above a witness — because doing a thing is not seeing one, and
    // written through cleanMemoryContent so it lands in her own mouth rather than as a report about
    // her. That conversion is why the fronted-adverbial fix in memory.ts had to come first: every
    // line the offstage pass writes opens "Around 12:50 …", "At about 19:50 …", "Sometime after
    // five in the morning …", and each of them stored as "me decides", "me finally comes",
    // "me wakes up".
    rememberOwnAct(state, actorId, ev.what, ev.place, turn);

    for (const w of witnessNames) {
      const id = byName.get(w);
      if (!id) continue;                        // never invent a witness the cast doesn't contain
      if (id === actorId) continue;             // they already have their own copy, in their own mouth

      // SEEING IT CHANGES WHAT YOU THINK OF THEM. Small — this is one thing glimpsed offstage, not a
      // scene the player watched — and asymmetric in the ordinary way: cruelty costs more than
      // kindness earns, and trust moves at a fraction of warmth in both directions. applyEdgeDelta
      // carries the rest (obduracy, trust's own asymmetry, rupture-repair).
      if (actorId && actorId !== id && valence !== 0) {
        applyEdgeDelta(state.world.edges, {
          from: id, to: actorId,
          warmth_delta: valence > 0 ? 3 : -5,
          trust_delta: valence > 0 ? 2 : -4,
          power_delta: 0,
          note: `${valence > 0 ? "saw them treat someone well" : "saw what they did"}: ${clipText(ev.what, 100)}`,
        }, turn, { chars: state.characters, traits: state.traits });
      }

      const mem = (state.memory[id] ??= { character_id: id, core: [], episodic: [], beliefs: [], facts: [], knows: [] });
      mem.episodic.push({
        id: uid("mem"),
        turn,
        content: clipText(ev.what, 280),
        importance: 7,                          // at the gossip threshold: worth repeating, not world-ending
        // marked distinctly from an ordinary witnessed memory so the digest can give it a guaranteed
        // slot: this is the world's own motion, and it has no other way back to the page
        source: "offstage",
        where: ev.place,
        when_label: state.world.current_time,
        emotional_charge: 0,
        decay: 0,
      });
    }

    // A step taken offstage by a faction the player never sees. This is the missing half of the
    // knowledge gate: gating advancement on demonstrated action was right, but the only place the
    // simulator could demonstrate it was a scene the player was IN — and forge clocks are now
    // deliberately NOT pointed at the player, so their factions never appeared and both clocks in a
    // 108-turn game sat at 0/6, never advancing once. The world's own motion is where they move.
    if (ev.advances) {
      // Match on the faction NAME, forgivingly. An exact-string compare meant "Caelus's Followers"
      // missed "Father Caelus's Followers" and the step was silently dropped — the clock stayed
      // frozen and the event that should have moved it read as scenery.
      const want = String(ev.advances).toLowerCase().trim().replace(/^the\s+/, "");
      const clock = state.world.clocks.find((c: any) => {
        if (c.status !== "running") return false;
        const have = c.faction.toLowerCase().trim().replace(/^the\s+/, "");
        return have === want || have.includes(want) || want.includes(have);
      });
      if (clock && clock.filled < clock.segments) {
        clock.filled += 1;
        clock.last_advanced_time = state.world.current_time;
        const signs = clock.visible_signs ?? [];
        const frac = clock.filled / Math.max(1, clock.segments);
        // The 0.5 gate meant the first half of every clock's life left no trace anywhere — and the
        // beat channel opened at 0.75, so a young clock was observable through nothing at all.
        if (signs.length) log.push(`SIGN (${clock.faction}): ${signs[Math.min(signs.length - 1, frac >= 0.85 ? signs.length - 1 : 0)]}`);
        log.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
      }
    }

    // AND A PERSON WHO DOES NOT EXIST DOES NOT GET A LIFE. `actorId` is null when the named actor
    // is not in the cast, and everything below it — the memory, the edges, the witnesses — is
    // already skipped for that case. The narrative was not: it went into the log in full.
    //
    // From the same save: two hundred words of "Denise comes out of the back at last... goes down on
    // one knee at the register, and spends eleven minutes trying to shim the spindle", plus three
    // threads opened about her, across twelve turns. Denise is not a character. She has no card, no
    // location, no memory and no voice, so nothing she does can be consistent with anything she did
    // before, and the player is reading a subplot about a person the engine cannot hold.
    //
    // Ambient events have no actor and are the point of this pass ("rain gathers against the curb"),
    // so they pass through. A NAMED actor who is nobody does not.
    if (ev.actor && String(ev.actor).trim() && !actorId) {
      console.warn(`[offstage] dropped an event for "${ev.actor}", who is not in the cast: ${clipText(String(ev.what ?? ""), 80)}`);
      continue;
    }
    log.push(`Elsewhere: ${ev.what}`);
  }

  // AND THEN EVERYBODY WHO SAW ANY OF IT UPDATES THEIR PICTURE OF WHO DID IT.
  readOffstage(state, events);

  return log;
}

/**
 * WHAT WATCHING SOMEBODY DO SOMETHING DOES TO WHAT YOU EXPECT OF THEM NEXT.
 *
 * The block above moves the true edge: a witness who saw a neighbour turn a starving family away
 * likes them less afterwards, which is right, and which is also the only thing that happened. The
 * mind layer — the one that holds what a person EXPECTS of somebody, lets it be wrong, and makes
 * the wrongness drive a scene — ran in exactly one place: `presentReal` in turn.ts, the people
 * standing in the room with the player.
 *
 * So for everyone else the two halves came apart and stayed apart. The edge moved every interval
 * and the belief never did, silently, for as long as a character stayed offstage. A pair who spent
 * forty turns across town from the protagonist could wreck each other's regard completely and walk
 * back into the story holding the same picture of each other they had on the day they left.
 *
 * This runs the same pass over the people an interval actually touched. Three things follow from
 * reusing updateMind rather than writing a second, simpler version here:
 *
 *   · The percept filter applies. perceivedValence bends what the witness saw through the witness's
 *     OWN edge toward the actor and their attachment style, so a warm act from somebody you already
 *     distrust reads as a move, offstage, the same way it does on the page.
 *   · Reification applies. A long-settled picture attenuates what contradicts it — at full
 *     reification four fifths of whatever changed does not register — so a witness with a fixed
 *     idea of somebody can watch them act against it and barely see it.
 *   · held_false can form out here. A sustained gap between what somebody expects and what they
 *     keep seeing crystallises into one concrete wrong thing, formed with the player nowhere near.
 *
 * The stance each actor is read as taking comes from the act itself — actorValence already scores
 * whether somebody did something TO or FOR another person, which is the same agentive question a
 * stance answers. A neutral act is somebody going about their business, which is `hold`.
 *
 * Zero tokens, and it runs for the world pass as well as for agency, because a witness to the
 * world's own motion has the same problem.
 */
export function readOffstage(state: any, events: OffstageEvent[]): void {
  if (!events.length) return;
  const byName = new Map<string, string>();
  for (const [id, c] of Object.entries<any>(state.characters ?? {})) {
    if (id !== "char_player") byName.set(String(c.name ?? "").toLowerCase(), id);
  }
  const turn = state.world?.current_turn ?? 0;

  // Who acted, how they came across, and who was there to take a view of it.
  const stances: Record<string, Stance> = {};
  const readers = new Set<string>();
  for (const ev of events) {
    const actorId = byName.get(String(ev.actor ?? "").toLowerCase().trim());
    if (!actorId) continue;
    const v = actorValence(ev.what);
    stances[actorId] = v > 0 ? "yield" : v < 0 ? "press" : "hold";
    for (const w of ev.witnesses ?? []) {
      const wid = byName.get(String(w).toLowerCase().trim());
      // A person does not revise their opinion of themselves by watching themselves, and the
      // player's theory of mind is not the engine's to author from a report they were not in.
      if (wid && wid !== actorId && wid !== "char_player") readers.add(wid);
    }
  }
  if (!readers.size || !Object.keys(stances).length) return;

  for (const id of readers) {
    if (state.characters[id]?.central === false) continue;   // same gate the in-scene pass uses
    try { updateMind(state, id, stances, turn); } catch { /* a belief that would not update is not a turn */ }
  }
}
