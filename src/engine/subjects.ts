/**
 * THE SUBJECT FLOOR — people have lives, and lives come up in conversation.
 *
 * The complaint: "My NPCs only talk about things they are goal-driven by directly, rather than
 * indirectly or beating around the bush or even talking about... like sports. No one just asks you
 * if you've seen any shows, or what you're up to, or how's life."
 *
 * Every piece of material this needs is already on the cards and already in the prompt. Each
 * present character's block carries `texture:` (raises these unprompted), `can talk at length
 * about:`, `has heard:`, `saw while you were elsewhere:`, and `backup wants:`. The narrator law
 * says A CHARACTER IS NOT THEIR GOAL in those words, and HOW A WANT IS APPROACHED — NOBODY LEADS
 * WITH IT runs three paragraphs. commonground.ts computes, for free, the subject two people would
 * actually bond over and prints it every turn.
 *
 * None of it holds, and the reason is the oldest lesson in this engine: A RULE IN THE PROMPT DOES
 * NOT HOLD ON ITS OWN. The tic guard, maxims.ts, echo.ts and speech.ts were all rules first and all
 * failed as rules; every one of them started working when something MEASURED the output and said so
 * at the start of the next turn. Nothing has ever measured whether a character talked about
 * anything other than their errand. `texture` in particular is written by the forge, printed on
 * every card, and has no expression tracking of any kind — unlike core traits, which habits.ts
 * counts, ages and retires. A field nothing measures is a field the narrator learns it can skip.
 *
 * There is also a live pull in the other direction. The want is the loudest thing on a character's
 * block; a per-turn directive names it again; the intent pass authors a surface for it; the drive
 * system files progress against it. Five systems push a character at their goal and none of them
 * ever asked what else this person might say. The result is what the player got: everyone arrives
 * on business, every time, forever.
 *
 * WHAT THIS MEASURES, per present character, from the prose that just ran:
 *
 *  1. WAS ANY OF IT OFF-ERRAND? Did anything they said touch a standing interest, a subject they
 *     can go on about, news they are carrying, or something they saw — as opposed to the thing they
 *     want. A person who has been in eleven scenes and never once mentioned the bird they watch for
 *     does not have a standing interest, they have a line of unused JSON.
 *  2. DID THEY ASK ANYTHING? Not an interrogation in service of the want — an ordinary question
 *     about the other person. How are you, what have you been doing, did you see it. This is the
 *     single most common thing people say to each other and the engine has never once asked for it.
 *  3. IS ANYBODY ELSE IN THE WORLD REAL TO THEM? Whether they mentioned a person who is not in the
 *     room. A cast who only ever discuss the people present live in a world with nobody in it.
 *
 * Each is a consecutive-turn counter, and each fires as a specific correction naming the specific
 * unused material — the same shape speech.ts uses, for the same reason: a general instruction
 * ("give them a life") is what is already in the prompt and already not working.
 *
 * WHAT THIS IS NOT. It is not a quota for chitchat. A scene at knifepoint should be all errand, and
 * the thresholds are set so a burst of business never trips them — it takes several consecutive
 * turns of a character having nothing to say for themselves. Under real pressure the directive
 * stands down entirely (see `subjectDirective`), because a frightened person talking about their
 * nephew is a worse failure than the one this fixes.
 */
import type { SaveState } from "./types";
import { commonGround } from "./commonground";

/** Consecutive turns present-and-speaking with nothing but the errand before it is the thing to fix. */
export const ALL_BUSINESS_LIMIT = 3;
/** Consecutive turns present without asking the other person anything of their own. */
export const INCURIOUS_LIMIT = 4;
/** Consecutive turns present without any part of the world outside this room being mentioned. */
export const ROOMBOUND_LIMIT = 6;

/** Share of a character's lines that must be about their own errand before the turn counts as all
 *  business. One instruction inside four lines of conversation is not the failure. */
const ERRAND_SHARE = 0.5;

/** Openness at or below this and the scene is under real pressure: no directive, whatever it says. */
const PRESSURE_FLOOR = -6;

const STOP = new Set(
  ("a an and are as at be been but by can could did do does for from get got had has have he her him his how i if in is it its just like me my no not of on or our out she so than that the their them then there these they this to too us was we were what when where which who will with would you your about after all also any been before being both each few more most other over same some such only own very will".split(" ")),
);

/** The words of a phrase worth matching on. Short and common words carry no subject. */
export function keyWords(s: string): Set<string> {
  return new Set(
    String(s ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/** How many words of `phrase` show up in `text`. */
function hits(text: Set<string>, phrase: string): number {
  let n = 0;
  for (const w of keyWords(phrase)) if (text.has(w)) n++;
  return n;
}

/**
 * The lines this person said, by the same proximity test the misattribution guard and the speech
 * floor use — their name within a window of the quote — and wrong in the same rare ways.
 */
export function linesBy(prose: string, name: string): string[] {
  const first = (String(name ?? "").split(/\s+/)[0] ?? "").toLowerCase();
  if (first.length < 3) return [];
  const p = String(prose ?? "");
  const out: string[] = [];
  for (const m of p.matchAll(/["“]([^"”\n]{2,})["”]/g)) {
    const window = p.slice(Math.max(0, m.index! - 90), m.index! + m[0].length + 90).toLowerCase();
    if (window.includes(first)) out.push(m[1].trim());
  }
  return out;
}

/** Everything this character is on record as being able to talk about that is not their errand. */
export function ownSubjects(state: SaveState, id: string): string[] {
  const c = state.characters[id];
  if (!c) return [];
  const out: string[] = [
    ...(c.texture ?? []),
    ...Object.keys(c.skills ?? {}),
  ];
  // news they are carrying and things they saw are subjects too — the whole reason the rumour and
  // offstage channels exist is that somebody might bring one up
  for (const r of state.world.rumors ?? []) {
    if (!r.dead && r.knowers?.includes(id) && r.origin_char !== id) out.push(r.content);
  }
  return out.map((s) => String(s ?? "").trim()).filter((s) => s.length > 2);
}

/** Everything this character is currently after, in the words the engine holds it in. */
function ownErrand(state: SaveState, id: string): string {
  const c = state.characters[id];
  if (!c) return "";
  return [
    c.drive?.goal, c.current_goal,
    ...(c.drive_queue ?? []).map((q) => q.goal),
    ...(c.authored ?? []).map((a) => a?.goal),
  ].filter(Boolean).join(" ");
}

/** A question somebody asked. Bare "?" is enough — what matters is whether they asked at all. */
function isQuestion(line: string): boolean {
  return /\?/.test(line);
}

/** Names of people in the cast who are NOT in this room. */
function absentNames(state: SaveState): { id: string; name: string }[] {
  const present = new Set(state.world.present ?? []);
  return Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && !present.has(id) && c?.name && c.status !== "dead")
    .map(([id, c]) => ({ id, name: String(c!.name).split(/\s+/)[0] }))
    .filter((x) => x.name.length >= 3);
}

/**
 * Read the turn that just ran and update every present character's counters. Called once a turn,
 * beside trackSilence, from the same place and for the same reason.
 */
export function trackSubjects(state: SaveState, prose: string): void {
  const book = (state.subjects ??= {});
  const p = String(prose ?? "");
  const absent = absentNames(state);

  for (const id of state.world.present ?? []) {
    if (id === "char_player") continue;
    const c = state.characters[id];
    if (!c?.name) continue;
    const row = (book[id] ??= { off_errand: 0, incurious: 0, roombound: 0 });

    const lines = linesBy(p, c.name);
    // Silence is not the same failure. A character who said nothing this turn is the speech floor's
    // problem (speech.ts), and counting it here would fire both guards at once for one cause.
    if (!lines.length) continue;

    const said = keyWords(lines.join(" "));
    const errand = ownErrand(state, id);

    // 1. did any of it reach past the errand
    //
    // Two conditions, and both are needed. A line counts as errand-flavoured when it shares real
    // vocabulary with what this person is after; the SHARE of such lines is what says the scene was
    // all business, because one instruction inside four lines of talk is not the failure. And
    // touching anything on their own card clears it outright — that is the behaviour being asked
    // for, however briefly it showed up. A character with no recorded errand can never trip this.
    const subjects = ownSubjects(state, id);
    const touchedOwnLife = subjects.some((s) => hits(said, s) >= 1);
    const errandLines = errand ? lines.filter((l) => hits(keyWords(l), errand) >= 2).length : 0;
    const errandShare = errandLines / lines.length;
    row.off_errand = !touchedOwnLife && errandShare >= ERRAND_SHARE ? row.off_errand + 1 : 0;

    // 2. did they ask the other person anything that was not part of the errand
    const asked = lines.some((l) => isQuestion(l) && (!errand || hits(keyWords(l), errand) < 2));
    row.incurious = asked ? 0 : row.incurious + 1;

    // 3. is there a world outside this room
    const namedSomebodyElse = absent.some(({ name }) => new RegExp(`\\b${name}\\b`, "i").test(lines.join(" ")));
    row.roombound = namedSomebodyElse ? 0 : row.roombound + 1;
  }

  // people who left the scene stop being tracked; their counters mean nothing out of it
  for (const id of Object.keys(book)) {
    if (!(state.world.present ?? []).includes(id)) delete book[id];
  }
}

/** Is the room under enough real pressure that small talk would be the wrong note? */
function underPressure(state: SaveState): boolean {
  for (const id of state.world.present ?? []) {
    const r = state.condition[id]?.psyche?.relaxation;
    if (typeof r === "number" && r <= PRESSURE_FLOOR) return true;
  }
  return false;
}

/**
 * The correction, from what the last turn measured. Silent when nobody has been on errand too long.
 *
 * Written as material plus an instruction rather than as a complaint: the counters say WHICH person
 * has gone how many turns without a life, and the character's own card supplies what they could
 * have said instead, by name. A directive that said "give them more range" would be the rule that
 * is already in the prompt and already failing.
 */
export function subjectDirective(state: SaveState): string {
  if (underPressure(state)) return "";
  const book = state.subjects ?? {};
  const bits: string[] = [];

  const stale = (state.world.present ?? [])
    .filter((id) => id !== "char_player" && state.characters[id])
    .map((id) => ({ id, c: state.characters[id]!, row: book[id] }))
    .filter((x) => x.row);

  // ── 1. NOBODY HAS A LIFE ────────────────────────────────────────────────────
  const onlyBusiness = stale.filter((x) => (x.row!.off_errand ?? 0) >= ALL_BUSINESS_LIMIT);
  for (const { id, c, row } of onlyBusiness.slice(0, 2)) {
    const subjects = ownSubjects(state, id).slice(0, 3);
    if (!subjects.length) continue;
    bits.push(
      `${c.name} has spoken in ${row!.off_errand} turns running and every line has been about what ${c.name} is after. `
      + `On ${c.name}'s own card, unused: ${subjects.join("; ")}. `
      + `THIS TURN ${c.name} SAYS SOMETHING THAT IS NOT ABOUT THEIR ERRAND — one of those, or the weather where they came from, or what they did before this, or a complaint about somebody not in the room. `
      + `It does not advance anything and it is not supposed to. A person with one subject is a plot-label; the errand is still there and can be got back to in the same breath.`,
    );
  }

  // ── 2. NOBODY IS CURIOUS ────────────────────────────────────────────────────
  const incurious = stale.filter((x) => (x.row!.incurious ?? 0) >= INCURIOUS_LIMIT);
  if (incurious.length) {
    const who = incurious.slice(0, 3).map((x) => x.c.name).join(", ");
    bits.push(
      `${who} ${incurious.length === 1 ? "has" : "have"} not asked anybody a question of their own in ${Math.max(...incurious.map((x) => x.row!.incurious))} turns — nothing that was not part of getting what they wanted. `
      + `THIS TURN SOMEBODY ASKS THE PLAYER SOMETHING ORDINARY, and then listens to the answer: how they have been, what they have been doing since, whether they ate, whether they saw the thing everybody saw, how the work is going, whether the trouble from before ever settled. `
      + `The question is real — the asker wants to know, not to set something up — and the answer changes what they say next. This is most of what people say to each other and it has been missing entirely.`,
    );
  }

  // ── 3. THE WORLD IS ONLY THIS ROOM ──────────────────────────────────────────
  const roombound = stale.filter((x) => (x.row!.roombound ?? 0) >= ROOMBOUND_LIMIT);
  if (roombound.length) {
    const others = absentNames(state).slice(0, 3).map((a) => a.name);
    if (others.length) {
      bits.push(
        `Nobody in this room has mentioned anybody outside it in ${Math.max(...roombound.map((x) => x.row!.roombound))} turns. `
        + `People who exist and are not here: ${others.join(", ")}. THIS TURN SOMEBODY BRINGS ONE OF THEM UP — what they are like, what they are up to lately, what they want and whether it is reasonable, an old grievance, a piece of news about them, worry about them. `
        + `Talking about who is not in the room is how people establish that they live somewhere.`,
      );
    }
  }

  if (!bits.length) return "";
  return `\n\nWHAT THESE PEOPLE HAVE NOT SAID. ${bits.join("\n")}`;
}

/**
 * THE STANDING MATERIAL — what the people in this room could talk about besides business.
 *
 * commonground.ts already computes this for one pair, speaker→player, because that is the pair
 * whose approach most often collapses into announcing itself. This covers the rest of the room: two
 * NPCs who have never been given a reason to speak to each other, and the people who are not here.
 *
 * Deliberately short and deliberately not an instruction. It is a list of things that are true and
 * available; whether any of it comes up is the scene's business. The directive above is what fires
 * when the answer has been "none of it" for several turns running.
 */
export function otherLivesNote(state: SaveState): string {
  const present = (state.world.present ?? []).filter((id) => id !== "char_player" && state.characters[id]);
  if (!present.length) return "";
  const rows: string[] = [];

  // ── two NPCs in a room have each other, and cards nobody has cross-referenced ──
  for (let i = 0; i < present.length && rows.length < 2; i++) {
    for (let j = i + 1; j < present.length && rows.length < 2; j++) {
      const a = state.characters[present[i]]!, b = state.characters[present[j]]!;
      const shared = commonGround(a, b)[0];
      if (shared) rows.push(`${a.name} and ${b.name} both have something to say about ${shared.label} — ${a.name}: ${shared.mine} / ${b.name}: ${shared.theirs}.`);
    }
  }

  // ── the people who are not here, as subjects rather than as arrivals ──
  //
  // Gated on somebody in the room actually KNOWING them: an edge either way. Handing the narrator a
  // stranger's enthusiasms invites a character to discuss a person they have never met, which is
  // the knowledge-gate failure this engine has fixed in four other places.
  const known: string[] = [];
  for (const { id, name } of absentNames(state)) {
    const edge = (state.world.edges ?? []).some(
      (e) => (present.includes(e.from) && e.to === id) || (present.includes(e.to) && e.from === id),
    );
    if (!edge) continue;
    const c = state.characters[id]!;
    const about = [c.texture?.[0], c.drive?.goal ?? c.current_goal].filter(Boolean).join("; ");
    if (about) known.push(`${name} — ${about}`);
    if (known.length >= 3) break;
  }
  if (known.length) rows.push(`People here know, who are not here: ${known.join(" · ")}. Their business is available to be discussed, worried about, or complained about by anybody who knows them.`);

  if (!rows.length) return "";
  return `\n[LIVES BESIDES THE ONE IN FRONT OF YOU — true, unused, and nobody has to use it:\n· ${rows.join("\n· ")}]`;
}
