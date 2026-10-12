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
import { physicalAct } from "./reaction";
import { PLAYER_VIOLENCE } from "./social";
import { clipText } from "./text";

/** At this level someone is afraid for their life around the player; under it, wary. */
export const AFRAID = 40;
export const WARY = 15;

/** Words that threaten someone, said or done. */
const THREAT = /\b(?:i(?:'ll| will| can| could| am going to|'m going to)? (?:kill|burn|end|destroy|gut|flay|behead|execute|hang) (?:you|her|him|them|all of you|every one of you)|or (?:you|they)(?: all)? (?:die|burn|hang)|you(?:'d| would)? like to die|(?:you will|you'll|you all) (?:die|burn|hang)|(?:be|is) the first to die|before i (?:kill|come for) you|i can make that happen)\b/i;

/** Everyday speech that borrows the words: killing time, shooting a text, executing a plan. */
const IDIOM = /\b(?:kill(?:s|ed|ing)? (?:time|it|the (?:lights?|engine|music|mood|vibe|power|motor))|killing it|killer|dressed to kill|shoot(?:s|ing)? (?:a |her |him |them |me )?(?:a )?(?:text|message|look|glance|photo|picture|hoops|pool|the breeze|the shit|a smile|an email|a dm)|shot (?:glass|of)|execut\w* (?:the|a|my|our|this|that) (?:plan|order|code|script|trade|contract|move|strategy|will))\b/gi;

/** Hurting someone short of the words PLAYER_VIOLENCE knows: a blow, a grip on the throat, a blade run
 * through. Read with the cast's names already turned into "them", so it only has to know pronouns. */
const ASSAULT = /\b(?:(?:punch|hit|slap|backhand|kick|headbutt|strangle|throttle|choke|shove|stab|slash|impale|skewer|gut|maim|burn|blast|beat|bludgeon|pummel)(?:s|es|ed|d|ing)? (?:them|him|her)\b|(?:grab|seize|take|hold|haul|drag)\w* (?:them|him|her) by the (?:throat|hair|neck)|slam\w* (?:them|him|her) (?:into|against|onto|to)|(?:run|ran|runs) (?:them|him|her) through|cut (?:them|him|her) down|(?:break|broke|snap|snapped)\w* (?:his|her|their) (?:arm|leg|neck|jaw|nose|fingers?|wrist|ribs?)|fireball at (?:them|him|her))\b/i;

/** An act that kills, or would. */
const LETHAL = /\b(?:kill(?:s|ed|ing)? (?!time\b|it\b|for\b|to\b|with\b|me\b|myself\b)\w+|murder\w*|burn(?:s|ed|t)? (?:\w+ )?alive|behead\w*|decapitat\w*|head off|cut (?:his|her|their|off \w+) (?:head|throat)|slit (?:his|her|their) throat|sever\w*|separate (?:the |his |her |their )?(?:flesh|head)|smash\w* (?:his|her|their) (?:head|skull|face)|execut\w*|through (?:the |his |her |their )?(?:face|heart|throat|chest|head|skull|neck)|watch (?:her|him|them) die|(?:run|ran|runs) (?:them|him|her) through|snap\w* (?:his|her|their) neck|impal\w* (?:them|him|her)|gut (?:them|him|her))\b/i;

/** Titles that come before a name and say nothing about which person it is. */
const TITLE = /^(?:lady|lord|sir|dame|king|queen|prince|princess|duke|duchess|count|countess|baron|baroness|captain|master|mistress|mr|mrs|ms|miss|dr|doctor|father|mother|brother|sister|elder|high|the)$/i;

/** How many in-world turns after a killing someone walking in still finds it. */
const AFTERMATH_TURNS = 6;

type FearEdge = SocialEdge & { fear?: number; fear_peak?: number; fear_why?: string[]; fear_turn?: number; fear_rumors?: string[] };
interface Violence { turn: number; act: string; victims: string[]; lethal: boolean; where: string; seen: string[] }

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

/** Off by at most one letter in four: "isolade" is Isolde. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 2) return false;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 4));
}

/** The act with each cast member's name turned into "them" ("I run Rook through") or "their" ("Rook's arm"). */
function asThem(state: SaveState, act: string): string {
  let out = act;
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player" || !c?.name) continue;
    const tokens = c.name.split(/[\s\u2019'-]+/).filter((t) => t.length >= 3 && !TITLE.test(t)).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!tokens.length) continue;
    const name = `\\b(?:${tokens.join("|")})`;
    out = out.replace(new RegExp(`${name}['\u2019]s\\b`, "gi"), "their").replace(new RegExp(`${name}\\b`, "gi"), "them");
  }
  return out;
}

/** Who the act was done to: named (allowing for a typo, past any title), or the only one present a pronoun fits. */
function victimsOf(state: SaveState, act: string, present: string[]): string[] {
  const words = (act.toLowerCase().match(/[a-z\u00c0-\u024f'\u2019]+/g) ?? []).map((w) => w.replace(/['\u2019]s$/, "").replace(/['\u2019]/g, ""));
  const out: string[] = [];
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player" || !c?.name) continue;
    const tokens = c.name.toLowerCase().split(/[\s\u2019'-]+/).filter((t) => t.length >= 3 && !TITLE.test(t));
    if (tokens.some((t) => words.some((w) => near(w, t)))) out.push(id);
  }
  if (out.length) return out;
  const fits = (re: RegExp) => present.filter((id) => re.test(String(state.characters?.[id]?.pronouns ?? "")));
  if (/\b(?:her|she)\b/i.test(act)) { const f = fits(/\bshe\b|\bher\b/i); if (f.length === 1) return f; }
  if (/\b(?:him|his|he)\b/i.test(act)) { const f = fits(/\bhe\b|\bhim\b/i); if (f.length === 1) return f; }
  return [];
}

/** How much watching this frightens this witness, from who they are to the people in it. */
function sightWeight(state: SaveState, witness: string, victims: string[], lethal: boolean): number {
  const warmTo = (a: string, b: string) => (state.world.edges ?? []).find((x) => x.from === a && x.to === b)?.warmth ?? 0;
  const likesPlayer = warmTo(witness, "char_player");
  const killing = lethal ? 10 : 0;
  if (!victims.length) return likesPlayer >= 40 ? 10 : 25 + killing;   // unnamed people: soldiers, councillors, strangers
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
 * Read this turn for danger and move fear. Called after the bookkeeper's changes land, with who was
 * in the room when the turn began and who has died since. Returns notices for the player.
 */
export function appraiseDanger(state: SaveState, ctx: { action: string; mode: string; presentAtStart: string[]; diedThisTurn: string[]; turn: number; elapsedMinutes?: number }): string[] {
  const P = state.characters?.char_player?.name ?? "the player";
  const alive = (id: string) => { const c = state.characters?.[id]; return !!c && id !== "char_player" && c.status !== "dead" && c.status !== "departed"; };
  const edges = (state.world.edges ?? []) as FearEdge[];
  const before = new Map(edges.filter((e) => e.to === "char_player").map((e) => [e.from, e.fear ?? 0]));
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
    const act = physicalAct(ctx.action).replace(IDIOM, " ");
    const witnesses = [...new Set([...ctx.presentAtStart, ...(state.world.present ?? [])])].filter(alive);
    // VIOLENCE DONE IN FRONT OF THEM
    const plain = asThem(state, act);
    if (PLAYER_VIOLENCE.test(act) || ASSAULT.test(plain)) {
      const victims = victimsOf(state, act, [...new Set([...ctx.presentAtStart, ...ctx.diedThisTurn])]);
      for (const id of ctx.diedThisTurn) if (!victims.includes(id)) victims.push(id);
      const lethal = ctx.diedThisTurn.length > 0 || LETHAL.test(act) || LETHAL.test(plain);
      const sight = `watched ${P} do this, close enough to see it: "${clipText(act, 100)}"`;
      for (const w of witnesses) {
        if (victims.includes(w)) raise(state, w, 50, `was the one ${P} did it to: "${clipText(act, 100)}"`, ctx.turn);
        else raise(state, w, sightWeight(state, w, victims, lethal), sight, ctx.turn);
        touched.add(w);
      }
      log.push({ turn: ctx.turn, act: clipText(act, 100), victims, lethal, where, seen: [...witnesses, ...victims] });
      if (log.length > 12) log.splice(0, log.length - 12);
    }
    // THREATS THEY HEARD
    if (THREAT.test(ctx.action)) {
      for (const w of witnesses) {
        raise(state, w, 12, `heard ${P} threaten to kill`, ctx.turn);
        touched.add(w);
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

  // WORD OF IT, for people who weren't there: a rumour about the player and violence, once each
  const pName = String(P).toLowerCase();
  const pFirst = pName.split(/\s+/).find((t) => t.length >= 3 && !TITLE.test(t)) ?? "";
  for (const r of state.world.rumors ?? []) {
    const content = String((r as any).content ?? "");
    const low = content.toLowerCase();
    if (!PLAYER_VIOLENCE.test(content.replace(IDIOM, " ")) || !(low.includes(pName) || (pFirst && low.includes(pFirst)))) continue;
    for (const h of ((r as any).holders ?? []) as string[]) {
      if (!alive(h) || touched.has(h)) continue;
      const e = edgeOf(state, h);
      const seen = (e.fear_rumors ??= []);
      if (seen.includes((r as any).id)) continue;
      seen.push((r as any).id);
      raise(state, h, 25, `heard it said: "${clipText(content, 100)}"`, ctx.turn);
      touched.add(h);
    }
  }

  // tell the player once, when someone crosses into fear for their life
  const out: string[] = [];
  for (const id of touched) {
    if (fearOf(state, id) >= AFRAID && (before.get(id) ?? 0) < AFRAID) out.push(`${state.characters[id].name} is afraid of you now.`);
  }
  return out;
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
  const him = /\bshe\b|\bher\b/i.test(pp) ? "her" : /\bhe\b|\bhim\b/i.test(pp) ? "him" : "them";
  if (f < AFRAID) {
    return `WARY OF ${P.toUpperCase()} (fear ${f})${why ? `: ${why}` : ""}. ${name} keeps some distance from ${P}, chooses words carefully around ${him}, and doesn't push.`;
  }
  return `AFRAID OF ${P.toUpperCase()} FOR THEIR LIFE (fear ${f})${why ? `: ${why}` : ""}. Being near ${P} comes before everything else on this card for ${name} now. A person afraid for their life doesn't go after anything of their own in front of the one they're afraid of, so their wants, appetites, teasing and pride wait until they're safe. What they do instead comes from who they are: most go quiet, agree, keep their eyes down, do what they're told and watch for the first chance to get away; some plead or bargain; some freeze; a few with a fighter's nature or nothing left to lose go for ${him} or for the door, all at once, knowing what it may cost. Nobody afraid for their life trades remarks with the one they're afraid of, makes a point at ${him}, or needles ${him}: they speak when they have to, or to beg, and briefly, and a hard man's fear shows as stillness and care with every word. Their usual way of handling stress belongs to an ordinary bad day, so here it shows only in how they get through this one.`;
}

/** For the passes that want a single line: the intent pass, the compact rosters. */
export function fearLine(state: SaveState, id: string): string {
  const f = fearOf(state, id);
  if (f < WARY) return "";
  const e = (state.world.edges ?? []).find((x) => x.from === id && x.to === "char_player") as FearEdge | undefined;
  const why = (e?.fear_why ?? [])[0];
  return f >= AFRAID
    ? `Afraid of the player for their life (fear ${f})${why ? `, because they ${why}` : ""}. Their own wants wait until they're safe; what they do now is get through being near the player, in their own way.`
    : `Wary of the player (fear ${f})${why ? `, because they ${why}` : ""}.`;
}
