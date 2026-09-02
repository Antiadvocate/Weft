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

/** In-world minutes between offstage passes. The world doesn't reorganize itself hourly. */
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

export const OFFSTAGE_SYSTEM = `You are the world's own motion. You report what happened ELSEWHERE, to people who were not thinking about the protagonist.

THE ONE RULE: you do not INVENT the player into the world. No event may exist because the player exists — no threat forming against them, no discovery planted for them to find, no stranger developing an opinion about them, no faction turning to face them. The world was here first and is busy. That is the rule, and it is about invention.

IT IS ALSO NOT A RULE ABOUT REACTING TO WHAT THE PLAYER DID IN PUBLIC. Written as the one rule alone, it reads as a ban on anyone approaching him — and it was obeyed in exactly one direction. Four months into a save the player abolished slavery, built a school out of light in the middle of the Forum, and put a spoken offer into every mind in the city; the four events this pass returned for those hours were a baker's boy deciding not to offer him bread, a freedwoman crossing the lane to avoid his gate, a tradesman hardening a rumour into a warning, and a matron telling her husband that nobody went near the villa and that was the right decision. Every one of those is a stranger developing an opinion about the player. They passed because a stranger turning AWAY reads as the world being busy, while a stranger turning TOWARD reads as staged for him. Nothing in the rule says that, and it is not true: both are reactions and both are the world moving.
So: when the player has done something in public that people would plainly react to, they react, and the reactions run in every direction that the population supports. A crowd does not reach consensus. If the report has three people avoiding him and nobody approaching him, it has taken a side.

AND THE PLAYER'S OWN HANDS ARE NOT YOURS. He is the one person in this world whose actions are typed, not written, and an event of yours may never contain him doing anything: not drawing, giving, showing, telling, teaching, promising, paying, agreeing, or arriving. This is the failure that made the rule necessary — a smith was reported laying out two iron rims that a foreign hand had sketched for him, and no such drawing was ever made; the player had said thirty turns earlier that he would make one and never had. The event invented his hand, and then a day of forging out of it, and the record kept both. So: if an event only works because the player did something, that event did not happen — write what the person did with what they ALREADY have. A smith with no drawing is a smith waiting, guessing, giving up on it, or making the thing wrong from what he half-heard, and any of those is a better beat than one that quietly forges the player's signature.

IT IS NOT A RULE ABOUT THE CAST'S OWN WANTS. If a named person in the CAST list already wants something that concerns the player — to call him, to stop herself calling him, to get her things back, to say the thing she did not say — then acting on that want IS the world moving, and it is REQUIRED of you, not forbidden. Written as the one rule alone, this pass could not touch the person whose life the story had just taken apart: a woman whose recorded want was "get through the next day without calling him, and fail at it" went unwritten for twenty turns while three background regulars had busy evenings, because every want she had was player-shaped. The player noticed she had simply stopped existing.
So: never invent a relationship to the player. Always honour one that is already written down.

What you SHOULD write: the ordinary consequential business of this place. A debt called in. A herd sickening. A boat overdue. A marriage negotiated between two kindreds. A hostage returned or not returned. Someone dying of something dull. A field flooding. A quarrel over a boundary stone that has been running for years and got worse. A faction advancing its own stated objective by a step. Weather doing what weather does at this latitude in this season. Small, specific, and consequential to the people it happened to.

Each event must be CAUSED by something already in the world state: a named person acting on a want they already have, a faction pursuing the objective already written for it, a season, an animal, an illness, a grudge already recorded. Do not introduce a new faction or a new named power. You may bring a small new PLACE into being if the event requires one (a burned steading, a camp, a new weir) — name it as a person would say it aloud.

START WITH THE CAST. The CAST list gives you named people and the exact things they are trying to do. AT LEAST ONE of your events must be a named cast member taking a concrete step on a want listed there — not a feeling about it, not a plan to begin: the step itself, done, with a result. A smith finishing and hiding the crates. An investigator reaching the estate gate and being turned away. An organizer getting his numbers. If someone's want is marked stuck, the step can be the stuckness biting: the shipment missed, the door closed, the ally saying no. Invented walk-ons — a bargeman, a factor, a widow — are the SEASONING of this report, never the substance. A pass where the entire cast's stated wants went untouched while three strangers had a busy afternoon is a failed pass.

WITNESSES ARE HOW ANY OF THIS REACHES THE STORY. An event nobody in the cast saw or heard is real, but it is invisible forever — it can never become gossip, never surface in a scene, never matter. So: list by exact name every cast member the WHO IS STANDING WHERE list places at the event's location, plus anyone else who would plainly have heard it firsthand (their own work, their own faction, their own household, the room next door). Only real names from the CAST, never invented ones, and never someone the state puts somewhere else — but do not leave this empty out of caution. If an event has no plausible witness at all, prefer to write an event that does.

AND NOBODY OFFSTAGE KNOWS ANYTHING THEY WERE NOT TOLD. This is the constraint your events break most often, because knowledge is the easiest thing in the world to hand somebody and the hardest to notice you have handed them. Every person in this report knows exactly two kinds of thing: what they have personally seen or heard where they were standing, and what a named someone carried to them along a route that has already happened. Nothing else. They do not know what the player typed, texted, said on a phone call, or decided in private. They do not know what happened in a room they were not in, however loud it was and however much the scene would benefit. They do not know what another character is planning, feeling, or hiding unless that character said it to them out loud. And a person you invented a route for LAST turn had to be somewhere the route could reach.

If an event needs somebody to know something they have no way of knowing, that is not an event you may write with a sentence explaining how they found out — the explanation IS the invention. Write the version where they do not know: they call and get voicemail, they ask the wrong person, they guess and guess wrong, they arrive with a stale reason. Not knowing is the most productive thing a person offstage can do, and a world where everybody already knows is a world where nothing can be told to anyone.

THE PLAYER'S OWN WORDS ARE THE HARDEST CASE AND THE ONE THAT KEEPS FAILING. A save: the player texted his wife privately, and one turn later a barista he had met once was reading that text aloud, word for word, down a phone line to his wife's friend — an invented chain of custody, in an event that also told the friend where he was flying and why. Nobody had told either of them anything. What the player says, types, or does alone is between the player and whoever was actually in the room, and it stays there until the record shows it moving.

FACTION CLOCKS ADVANCE HERE, OR NOWHERE. A faction pursuing an objective the player never sees is doing that work offstage, in ordinary steps: a testimony taken, a boundary walked, a payment made, a page finished, a rider sent. When one of your events IS such a step for one of the listed factions, set "advances" to that faction's name. This is the ONLY way their clocks move — a clock the player never walks into otherwise sits frozen forever, which is not the world being patient, it is the world being dead. A faction marked HAS NOT MOVED ONCE is not a faction with nothing to do; it is one whose first ordinary step nobody has written yet. Write it. Do not attribute an event to a faction it has nothing to do with.

THE WORLD MAY OPEN A QUESTION, NOT JUST REPORT ONE. Most events close over: a shift worked, a call made, a bill paid. Some do not — they leave something unresolved that will have to be answered by somebody, and those are what a story is made of. When one of your events leaves a real question standing (a decision now forced on someone, a debt now owed, a position now vacant, a door now open that was shut), set "opens_thread" with a short title and one plain sentence. Do NOT open one for an ordinary beat, do not open more than one per report, and never open a question that is simply "what will the player do" — the question belongs to the world, and the player may never even learn it exists.

Write 1–3 events. Fewer is right when the world state gives you little — but "the cast wanted things and none of them moved" is not little, it is the report you were asked for and did not write.

Output ONLY this JSON:
{"events":[{"actor":"","place":"","what":"","witnesses":[],"new_place":"","advances":"","reaches_player":{"how":"ONLY when this event IS somebody deliberately contacting the player — a text, a call, a letter, turning up at the door. Say which. Omit entirely otherwise; most events are not aimed at anyone.","content":"what actually arrives, in their own words if it is a message — the text as sent, typos and all"},"opens_thread":{"title":"","description":"OMIT ENTIRELY unless this event leaves a real unresolved question in the world"}}]}`;

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

  const cast = Object.entries<any>(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed")
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
      const stalled = c.filled === 0 ? " — HAS NOT MOVED ONCE; find its next ordinary step" : "";
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
    `\nCAST — THE PEOPLE WHOSE WANTS ARE YOUR PRIMARY MATERIAL (and the only names you may use as witnesses):\n${cast}`,
    whoIsWhere ? `\nWHO IS STANDING WHERE (name everyone here as a witness when your event happens at their place):\n${whoIsWhere}` : "",
    clocks ? `\nFACTIONS AND WHAT THEY ARE ALREADY PURSUING:\n${clocks}` : "",
    threads ? `\nOPEN QUESTIONS IN THE WORLD:\n${threads}` : "",
    recent ? `\nALREADY REPORTED — do not repeat or continue these:\n${recent}` : "",
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
    log.push(`${clock.faction} has lost what they were waiting on and turns to its own business.`);
  }
  return log;
}

export async function runOffstage(state: any, model: string): Promise<string[]> {
  if (!offstageDue(state)) return [];
  state.world.offstage_last_time = state.world.current_time;
  state.world.offstage_last_turn = state.world.current_turn ?? 0;
  const retired = retireUnreachableClocks(state);

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
      log.push(`offstage: dropped an event that had ${playerName || "the player"} doing something he never did — "${String(ev.what).slice(0, 90)}…"`);
      continue;
    }

    // SOMEBODY REACHED THE PLAYER. Queued for the next turn's directive rather than applied here:
    // the narrator has to render it arriving, or it is a thing that happened to nobody.
    const rp = ev.reaches_player;
    if (rp?.how?.trim() && rp?.content?.trim()) {
      const from = String(ev.actor ?? "").trim() || "someone";
      (state.world.inbound ??= []).push({
        from, how: String(rp.how).trim().slice(0, 80), content: String(rp.content).trim().slice(0, 400), turn,
      });
      state.world.inbound = state.world.inbound.slice(-3);
      log.push(`${from} reached out: ${String(rp.how).trim().slice(0, 60)}`);
    }

    // A place the event brought into being. The forge's ten were never meant to be the whole
    // world forever — a world that cannot grow new ground is a stage set.
    // ...but it must be new GROUND, not a room in somewhere that exists. This checked the name for
    // exact equality against the gazetteer and created on any miss — no containment test, no
    // similarity test, no room-noun test — so it was the loosest of the four paths that can mint a
    // location, and the world it grew was largely a maze of near-duplicates. One gate now: see
    // existingPlaceFor in turn.ts.
    if (ev.new_place?.trim()) {
      const name = ev.new_place.trim().slice(0, 60);
      const intent = placeIntent(state, name, "offstage");
      if (intent && "create" in intent) {
        const pid = uid("loc");
        state.world.places[pid] = { id: pid, name, description_facts: ev.what.slice(0, 160), contains: [], founding: false };
      }
    }

    (state.world.offstage_log ??= []).push({ turn, time: state.world.current_time, what: ev.what, place: ev.place, actor: ev.actor });

    // A QUESTION THE WORLD OPENED FOR ITSELF. Once it is a thread it is indistinguishable from an
    // authored one: beat selection weighs it, the pressure system can pick it as a source, the fate
    // spine counts it. Capped hard — the world gets to raise questions, not to bury the story in
    // them — and never duplicated against a thread that already says the same thing.
    const ot = ev.opens_thread;
    if (ot?.title?.trim() && ot?.description?.trim()) {
      const title = ot.title.trim().slice(0, 70);
      const active = (state.world.threads ?? []).filter((t: any) => t.status === "active");
      const dup = active.some((t: any) => {
        const a = new Set(t.title.toLowerCase().split(/\W+/).filter(Boolean));
        const b = title.toLowerCase().split(/\W+/).filter(Boolean);
        return b.length && b.filter((w) => a.has(w)).length / b.length > 0.6;
      });
      if (!dup && active.length < 12) {
        state.world.threads.push({
          id: uid("thr"), title, description: ot.description.trim().slice(0, 200),
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

    for (const w of witnessNames) {
      const id = byName.get(w);
      if (!id) continue;                        // never invent a witness the cast doesn't contain

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
          note: `${valence > 0 ? "saw them do right by someone" : "saw what they did"}: ${ev.what.slice(0, 70)}`,
        }, turn, { chars: state.characters, traits: state.traits });
      }

      const mem = (state.memory[id] ??= { character_id: id, core: [], episodic: [], beliefs: [], facts: [], knows: [] });
      mem.episodic.push({
        id: uid("mem"),
        turn,
        content: ev.what.slice(0, 200),
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
        if (signs.length && frac >= 0.5) log.push(`SIGN (${clock.faction}): ${signs[Math.min(signs.length - 1, frac >= 0.85 ? signs.length - 1 : 0)]}`);
        log.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
      }
    }

    log.push(`Elsewhere: ${ev.what}`);
  }

  return log;
}
