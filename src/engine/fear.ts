/**
 * FEAR — the feeling the engine had no number for.
 *
 * Kingdom of Veythar. In one afternoon the king set a noblewoman on fire, burned her to ash, took an
 * old councillor's head off, flayed a woman, and crushed a man's skull under his boot. After each of
 * those, the people in the room talked back. The woman he'd set alight came out from behind a pillar
 * to confront him about his cruelty. The woman about to be flayed mocked the council for having
 * nowhere to sit but the blood. A courtesan who walked into the room after three killings waited
 * calmly to present a petition. The player: "Does their response make sense in context of the shit
 * I'm doing? No one acted realistically." He asked for nothing special-cased, only for people to
 * respond the way people would.
 *
 * They couldn't, because a person in this engine is warmth, trust, attraction and one tension dial.
 * There was no number for "this man can kill me and just did". So fear of him came out as tension,
 * which renders as somebody touchy and argumentative; attraction kept rendering as pursuit ("they
 * turn up where you are, put themselves in your way"); and every want, trait and stress habit on the
 * card ran as if the room were a difficult meeting.
 *
 * Fear is now a feeling a person has toward someone, on the edge beside warmth and trust, 0 to 100.
 * It comes from what they saw and heard: watching violence done in front of them, being its target,
 * being threatened, and hearing it talked about. How much a sight frightens someone depends on who
 * they are to the people in it. An ally who watches the player cut down a man attacking them both
 * isn't afraid of the player, and anyone who watches him burn an unarmed woman is. It fades with
 * in-world time. The bookkeeper can move it too, for the dangers no pattern sees.
 *
 * What it does is change how a person is described to the narrator, the way warmth and tension
 * already do. A person afraid for their life is shown as one: their wants and appetites wait, their
 * ordinary stress habits give way, and what they do comes from who they are. Nothing here decides
 * what anyone does.
 */
import type { SaveState, SocialEdge } from "./types";
import { turnRead, type ActionRead } from "./actionread";
import { clipText, objectPronoun } from "./text";

/** At this level someone is afraid for their life around the player; under it, wary. */
export const AFRAID = 40;
export const WARY = 15;

/** How many in-world turns after a killing someone walking in still finds it. */
const AFTERMATH_TURNS = 6;

type FearEdge = SocialEdge & { fear?: number; fear_peak?: number; fear_why?: string[]; fear_turn?: number; fear_rumors?: string[] };
interface Violence { turn: number; act: string; victims: string[]; lethal: boolean; where: string; seen: string[]; rumor?: string }

function edgeOf(state: SaveState, from: string): FearEdge {
  let e = (state.world.edges ?? []).find((x) => x.from === from && x.to === "char_player") as FearEdge | undefined;
  if (!e) { e = { from, to: "char_player", warmth: 0, trust: 0, power: 0 } as FearEdge; state.world.edges.push(e); }
  return e;
}

export function fearOf(state: SaveState, id: string): number {
  const e = (state.world?.edges ?? []).find((x) => x.from === id && x.to === "char_player") as FearEdge | undefined;
  return Math.round(e?.fear ?? 0);
}

function raise(state: SaveState, id: string, by: number, why: string, turn: number): void {
  if (by <= 0) return;
  const e = edgeOf(state, id);
  e.fear = Math.min(100, Math.round((e.fear ?? 0) + by));
  e.fear_peak = Math.max(e.fear_peak ?? 0, e.fear);
  e.fear_turn = turn;
  const list = (e.fear_why ??= []);
  if (!list.includes(why)) list.unshift(why);
  e.fear_why = list.slice(0, 3);
}

/** For the bookkeeper's fear_delta: same bookkeeping as everything else that moves it. */
export function shiftFear(state: SaveState, id: string, by: number, why: string, turn: number): void {
  if (by > 0) { raise(state, id, by, why, turn); return; }
  const e = edgeOf(state, id);
  e.fear = Math.max(0, Math.round((e.fear ?? 0) + by));
  e.fear_turn = turn;
}

/** How much watching this frightens this witness, from who they are to the people in it. */
function sightWeight(state: SaveState, witness: string, victims: string[], lethal: boolean): number {
  const warmTo = (a: string, b: string) => (state.world.edges ?? []).find((x) => x.from === a && x.to === b)?.warmth ?? 0;
  const likesPlayer = warmTo(witness, "char_player");
  const killing = lethal ? 10 : 0;
  // nobody named: soldiers, councillors, strangers; a killing is a killing whoever it was
  if (!victims.length) return likesPlayer >= 40 ? 10 : lethal ? 30 + killing : 25;
  let w = 0;
  for (const v of victims) {
    if (v === witness) continue;
    const theirEnemy = warmTo(witness, v) <= -20;                    // someone the witness wanted gone
    const cameForPlayer = warmTo(v, "char_player") <= -40;           // someone who was out to hurt the player
    w = Math.max(w, theirEnemy ? 5 : cameForPlayer && likesPlayer >= 30 ? 8 : 30 + killing);
  }
  return w;
}

/**
 * What the player just did to the people in the room, as the small model read it (actionread.ts):
 * who was harmed and whether it kills, who was threatened, and a weapon or power shown. The read
 * names people by id, through typos, titles and pronouns, so nothing here guesses at words.
 */
function readAct(state: SaveState, read: ActionRead, present: string[], died: string[], turn: number, touched: Set<string>): void {
  const P = state.characters?.char_player?.name ?? "the player";
  const alive = (id: string) => { const c = state.characters?.[id]; return !!c && id !== "char_player" && c.status !== "dead" && c.status !== "departed"; };
  const log = ((state.world as any).violence ??= []) as Violence[];
  const witnesses = [...new Set(present)].filter(alive);
  // VIOLENCE DONE IN FRONT OF THEM
  for (const h of read.harms) {
    const victims = h.who.filter((id) => id !== "someone");
    for (const id of died) if (!victims.includes(id)) victims.push(id);
    const lethal = h.kills || died.length > 0;
    const what = clipText(h.what, 100);
    const sight = `watched ${P} do this, close enough to see it: "${what}"`;
    for (const w of witnesses) {
      if (victims.includes(w)) raise(state, w, 50, `was the one ${P} did it to: "${what}"`, turn);
      else raise(state, w, sightWeight(state, w, victims, lethal), sight, turn);
      touched.add(w);
    }
    // AND IT GETS TALKED ABOUT: the people who saw it carry it out of the room as a rumour, which
    // the rumour engine spreads like any other, and whoever it reaches is frightened by it (below)
    const names = victims.map((id) => state.characters?.[id]?.name).filter(Boolean);
    const rumor = {
      id: `rum_${turn}_${Math.random().toString(36).slice(2, 8)}`,
      content: `${P}${names.length ? `, to ${names.join(" and ")}` : ""}: ${what}`,
      truth: "true" as const, salience: lethal ? 9 : 7, origin_char: witnesses[0] ?? "char_player",
      knowers: witnesses.filter((w) => !victims.includes(w) || !lethal), born_turn: turn, about_char: "char_player", violent: true,
    };
    if (rumor.knowers.length) { (state.world.rumors ??= []).push(rumor as any); if (state.world.rumors.length > 40) state.world.rumors = state.world.rumors.slice(-40); }
    log.push({ turn, act: what, victims, lethal, where: String((state.world as any).player_location ?? ""), seen: [...witnesses, ...victims], rumor: rumor.knowers.length ? rumor.id : undefined });
    if (log.length > 12) log.splice(0, log.length - 12);
  }
  // THREATS THEY HEARD: the one threatened most, everyone in earshot some
  if (read.threatens.length) {
    for (const w of witnesses) {
      raise(state, w, read.threatens.includes(w) ? 20 : 12, read.threatens.includes(w) ? `${P} threatened them` : `heard ${P} threaten to kill`, turn);
      touched.add(w);
    }
  }
  // A WEAPON OR A POWER SHOWN, unused
  if (read.shows_power && !read.harms.length) {
    for (const w of witnesses) {
      raise(state, w, 15, `watched ${P} show this: "${clipText(read.shows_power, 100)}"`, turn);
      touched.add(w);
    }
  }
}

function crossed(state: SaveState, touched: Set<string>, before: Map<string, number>): string[] {
  const out: string[] = [];
  for (const id of touched) {
    if (fearOf(state, id) >= AFRAID && (before.get(id) ?? 0) < AFRAID) out.push(`${state.characters[id].name} is afraid of you now.`);
  }
  return out;
}

const fearNow = (state: SaveState) => new Map(((state.world.edges ?? []) as FearEdge[]).filter((e) => e.to === "char_player").map((e) => [e.from, e.fear ?? 0]));

/**
 * THE MOMENT IT HAPPENS, BEFORE A WORD OF IT IS WRITTEN.
 *
 * Kingdom of Veythar, fourth run, turn 26. The king flayed a woman down to the bone with magic. She
 * turned her skull toward him and said, in her own hoarse voice, "You are the king. I heard you the
 * first time. I am Mara. I came from the river district." The player: "Still talks to me all chill."
 *
 * Fear was read after the turn was written, from what the turn had made of it, so the turn in which
 * something happens to somebody was always written before anything on their card said what it had
 * done to them. The act is the player's and is known before the narrator starts, so it's read here,
 * before the cards are built: the person it's done to and the people who watch it are already afraid
 * on the page that shows it. appraiseDanger, after the turn, adds what the turn made of it: who died,
 * who came in on it.
 */
export function appraiseAct(state: SaveState, ctx: { action?: string; mode: string; present: string[]; turn: number }): string[] {
  if (ctx.mode === "think" || (state.world as any).appraised_turn === ctx.turn) return [];
  (state.world as any).appraised_turn = ctx.turn;
  const before = fearNow(state);
  const touched = new Set<string>();
  readAct(state, turnRead(state), ctx.present, [], ctx.turn, touched);
  return crossed(state, touched, before);
}

/**
 * Read this turn for danger and move fear. Called after the bookkeeper's changes land, with who was
 * in the room when the turn began and who has died since. Returns notices for the player.
 */
export function appraiseDanger(state: SaveState, ctx: { action?: string; mode: string; presentAtStart: string[]; diedThisTurn: string[]; turn: number; elapsedMinutes?: number }): string[] {
  const P = state.characters?.char_player?.name ?? "the player";
  const alive = (id: string) => { const c = state.characters?.[id]; return !!c && id !== "char_player" && c.status !== "dead" && c.status !== "departed"; };
  const edges = (state.world.edges ?? []) as FearEdge[];
  const before = fearNow(state);
  const touched = new Set<string>();
  const where = String((state.world as any).player_location ?? "");
  const log = ((state.world as any).violence ??= []) as Violence[];

  // fading: half a point an in-world hour, down to a floor set by the worst of it. Someone who saw a
  // killing stays wary of the killer until something between them changes it.
  const fade = Math.max(0, (ctx.elapsedMinutes ?? 0) / 60) * 0.5;
  for (const e of edges) {
    if (e.to !== "char_player" || !e.fear || e.fear_turn === ctx.turn) continue;
    const floor = Math.min(30, (e.fear_peak ?? 0) * 0.4);
    if (e.fear > floor) e.fear = Math.max(floor, Math.round((e.fear - fade) * 10) / 10);
  }

  if (ctx.mode !== "think") {
    if ((state.world as any).appraised_turn !== ctx.turn) {
      // nobody read the act before the turn was written (a replay, a test): read it now, whole
      readAct(state, turnRead(state), [...new Set([...ctx.presentAtStart, ...(state.world.present ?? [])])], ctx.diedThisTurn, ctx.turn, touched);
      (state.world as any).appraised_turn = ctx.turn;
    } else {
      // it was read before the turn was written; add what the turn made of it
      const v = log.find((x) => x.turn === ctx.turn);
      if (v) {
        const newlyDead = ctx.diedThisTurn.filter((id) => !v.victims.includes(id));
        v.victims.push(...newlyDead);
        if (!v.lethal && ctx.diedThisTurn.length) {
          v.lethal = true;
          for (const w of v.seen.filter((id) => alive(id) && !v.victims.includes(id))) { raise(state, w, 10, `watched ${P} do this, close enough to see it: "${v.act}"`, ctx.turn); touched.add(w); }
        }
        // anyone who came in while it was happening saw it too
        for (const id of (state.world.present ?? []).filter(alive)) {
          if (v.seen.includes(id)) continue;
          v.seen.push(id);
          raise(state, id, v.lethal ? 40 : 25, `came in as ${P} did this: "${v.act}"`, ctx.turn);
          touched.add(id);
        }
      }
    }
  }

  // WHAT THEY WALKED INTO: someone here now who wasn't for a killing a few turns ago, in this same
  // place, finds what's left of it and the man who did it. Once each.
  for (const v of log) {
    if (!v.lethal || ctx.turn - v.turn > AFTERMATH_TURNS || ctx.turn === v.turn || (v.where && where && v.where !== where)) continue;
    for (const id of (state.world.present ?? []).filter(alive)) {
      if (v.seen.includes(id)) continue;
      v.seen.push(id);
      raise(state, id, ctx.turn - v.turn <= 2 ? 40 : 25, `came in soon after ${P} did this: "${v.act}"`, ctx.turn);
      touched.add(id);
    }
  }

  // WORD OF IT, for people who weren't there: a rumour of the player's violence reaching them, once each
  for (const r of state.world.rumors ?? []) {
    if (!(r as any).violent || r.about_char !== "char_player" || r.dead) continue;
    for (const h of r.knowers ?? []) {
      if (!alive(h) || touched.has(h)) continue;
      const e = edgeOf(state, h);
      const seen = (e.fear_rumors ??= []);
      if (seen.includes(r.id)) continue;
      seen.push(r.id);
      // a witness already carries the sight itself
      if ((log.find((v) => v.rumor === r.id)?.seen ?? []).includes(h)) continue;
      raise(state, h, 25, `heard it said: "${clipText(r.content, 100)}"`, ctx.turn);
      touched.add(h);
    }
  }

  // tell the player once, when someone crosses into fear for their life
  return crossed(state, touched, before);
}

/** The narrator's description of someone afraid of the player, or wary of them. Empty below WARY. */
export function fearBlock(state: SaveState, id: string): string {
  const f = fearOf(state, id);
  if (f < WARY) return "";
  const e = (state.world.edges ?? []).find((x) => x.from === id && x.to === "char_player") as FearEdge | undefined;
  const P = state.characters?.char_player?.name ?? "the player";
  const name = state.characters?.[id]?.name ?? "they";
  const why = (e?.fear_why ?? []).slice(0, 2).join("; ");
  const pp = String(state.characters?.char_player?.pronouns ?? "");
  const him = objectPronoun(pp);
  if (f < AFRAID) {
    return `WARY OF ${P.toUpperCase()} (fear ${f})${why ? `: ${why}` : ""}. ${name} keeps some distance from ${P}, chooses words carefully around ${him}, and doesn't push.`;
  }
  // the one it was done to, on the turn it's done: what it does to them comes before how they feel about it
  const doneToThem = e?.fear_turn === state.world?.current_turn && (e?.fear_why?.[0] ?? "").startsWith("was the one ")
    ? ` What was just done to ${name} does to their body what it would do to anyone's: if it would kill a person, it kills them, and if they live through it, they are in agony and terror, and nothing calm or composed comes out of them.`
    : "";
  // FEAR CHANGES THE METHOD, NEVER THE WANT. This used to say a frightened person's wants "wait until
  // they're safe", and a person living under a king who has killed in front of them is never safe,
  // so they waited forever. Kingdom of Veythar, turn 35: a woman whose whole reason for being near
  // the king was to get his power through the one weakness she knew he had, fear 88, printed as
  // "waiting until they're safe", spending scene after scene saying nothing and asking for nothing.
  // People under a dangerous man still want things, and most of what gets done in a court is done
  // by people who are afraid of the one on the throne: they just go at it carefully.
  return `AFRAID OF ${P.toUpperCase()} FOR THEIR LIFE (fear ${f})${why ? `: ${why}` : ""}.${doneToThem} Being near ${P} is dangerous for ${name} now, and that shapes everything they do, though it doesn't stop them wanting. What they want still drives them, and fear changes how they go after it: carefully, at the safest moment, in the way least likely to set ${him} off, by making themselves useful or pleasing to ${him}, asking for small things before large ones, offering something in return, putting it as ${him} doing ${him}self a favour, working through someone else, or using whatever hold they have over ${him} while taking care that ${him} never feels it as a threat. Who they are decides which: some go quiet and obedient and watch for their chance, some plead or bargain, some freeze, and a few with a fighter's nature or nothing left to lose go for ${him} or for the door, all at once, knowing what it may cost. Nobody afraid for their life trades barbs with ${P}, lectures ${him}, or argues for the sake of it, and a hard person's fear shows as stillness and care with every word. Their usual way of handling stress belongs to an ordinary bad day, so here it shows only in how they get through this one.`;
}

/** For the passes that want a single line: the intent pass, the compact rosters. */
export function fearLine(state: SaveState, id: string): string {
  const f = fearOf(state, id);
  if (f < WARY) return "";
  const e = (state.world.edges ?? []).find((x) => x.from === id && x.to === "char_player") as FearEdge | undefined;
  const why = (e?.fear_why ?? [])[0];
  return f >= AFRAID
    ? `Afraid of the player for their life (fear ${f})${why ? `, because they ${why}` : ""}. They still go after what they want, carefully, in whatever way is least likely to set the player off: being useful or pleasing, asking small before large, bargaining, going through someone else, or using a hold they have without letting it feel like a threat.`
    : `Wary of the player (fear ${f})${why ? `, because they ${why}` : ""}.`;
}
