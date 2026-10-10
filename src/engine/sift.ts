/**
 * STORY SIFTING — the drama that is already sitting in the state, read out of it.
 *
 * Every source the pressure system draws from is something the engine was TOLD to press on: the
 * genre palette the player wrote, clocks and threads the forge or the bookkeeper opened, people's
 * wants. Nothing looked at the relationship web itself and noticed what it had become. And it
 * becomes things. Attraction is seeded on first sight and moves; the forge now writes the cast's
 * ties to each other; hearsay moves opinions while the player is elsewhere. A save can quietly
 * arrive at "Mara wants Ossian, and Ossian wants Di" and never once put it on the page, because no
 * thread names it and the narrator is shown each edge one character at a time.
 *
 * Talk of the Town did this twenty years of design ago with a story recognizer: unrequited love,
 * love triangles, a friend who is privately an enemy, rivalries — patterns excavated from the raw
 * simulation, not authored. Kreminski's Winnow adds the part that matters for a live game: PARTIAL
 * sifting, noticing a story that is two-thirds formed, which is the moment it can still be pushed.
 *
 * Here each pattern is a deterministic test over edges, roles, wants and the mind layer, with a
 * RIPENESS (how fully formed it is) and a NEXT STEP (what would move it on, in plain words). What it
 * finds is opened as a thread of kind "relationship", which is the channel every other source
 * already uses — the beat selector, the digest, the World tab and the Chronicle all read threads —
 * and it is closed again when the state stops showing it. Zero tokens.
 *
 * WHAT IT WILL NOT DO. It never reads the player's own interior: the player can be the person two
 * others want, never the one doing the wanting, the trusting or the disliking. The engine does not
 * decide how the player feels.
 */
import type { SaveState, SocialEdge, Thread } from "./types";
import { uid } from "./state";
import { arePartners } from "./rejection";

/** Attraction that counts as wanting someone, and the most that counts as not wanting them back. */
const WANTS = 35;
const COLD_BACK = 10;
/** Sifted threads live at once. The live-thread cap is six; this leaves the rest to everything else. */
export const MAX_SIFTED_LIVE = 2;
/** A situation the bookkeeper closed, or that dissolved, is not reopened for this many turns. */
const REOPEN_AFTER = 12;

// An ex is not a partner: "ex-wife" contains "wife", and reading it as one keeps a divorce married.
const PARTNER = /(?<!ex-)(?<!ex )\b(partner|spouse|wife|husband|girlfriend|boyfriend|fianc\w*|lover)\b/i;
const BOND = /\b(partner|spouse|wife|husband|girlfriend|boyfriend|fianc\w*|lover|friend|best friend|sister|brother|mother|father|daughter|son|cousin|aunt|uncle|sibling|parent|child)\b/i;

export interface Situation {
  key: string;          // pattern + ids, stable across turns
  pattern: string;
  who: string[];        // char ids involved
  title: string;
  next: string;         // what would move it on
  ripeness: number;     // 0..1
}

function index(edges: SocialEdge[]) {
  const m = new Map<string, SocialEdge>();
  for (const e of edges) m.set(`${e.from}>${e.to}`, e);
  return (a: string, b: string) => m.get(`${a}>${b}`);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Every dramatic shape the state currently holds. Deterministic; the order is by ripeness. */
export function siftSituations(state: SaveState): Situation[] {
  const cast = Object.entries(state.characters ?? {})
    .filter(([, c]) => c && c.status !== "dead" && c.status !== "departed")
    .map(([id]) => id);
  const npcs = cast.filter((id) => id !== "char_player");
  const E = index(state.world.edges ?? []);
  const name = (id: string) => state.characters[id]?.name ?? id;
  // Someone the player turned away doesn't count as wanting the player. See rejection.ts.
  const att = (a: string, b: string) => {
    const e = E(a, b) as (SocialEdge & { rejected?: unknown }) | undefined;
    return b === "char_player" && e?.rejected ? 0 : e?.attraction ?? 0;
  };
  const warm = (a: string, b: string) => E(a, b)?.warmth ?? 0;
  const trust = (a: string, b: string) => E(a, b)?.trust ?? 0;
  const roles = (a: string, b: string) => (E(a, b)?.roles ?? []).join(" ");
  const partners = (a: string, b: string) => PARTNER.test(roles(a, b)) || PARTNER.test(roles(b, a)) || arePartners(state, a, b);
  const out: Situation[] = [];

  // ── A wants B, who wants C (and not A). C may be the player: being wanted is not an interior. ──
  const inTriangle = new Set<string>();
  for (const a of npcs) for (const b of npcs) {
    if (a === b || att(a, b) < WANTS || att(b, a) > COLD_BACK || partners(a, b)) continue;
    for (const c of cast) {
      if (c === a || c === b || att(b, c) < WANTS) continue;
      inTriangle.add(`${a}>${b}`);
      out.push({
        key: `triangle:${a}:${b}:${c}`, pattern: "triangle", who: [a, b, c],
        title: `${name(a)} wants ${name(b)}, who wants ${name(c)}`,
        next: `${name(a)} sees where ${name(b)}'s attention goes, or ${name(b)} and ${name(c)} are thrown together where ${name(a)} can watch`,
        ripeness: clamp01(0.45 + (Math.min(att(a, b), att(b, c)) - WANTS) / 100),
      });
    }
  }
  // ── A wants B, and B doesn't want A back ──
  for (const a of npcs) for (const b of npcs) {
    if (a === b || inTriangle.has(`${a}>${b}`) || att(a, b) < WANTS || att(b, a) > COLD_BACK || partners(a, b)) continue;
    out.push({
      key: `unrequited:${a}:${b}`, pattern: "unrequited", who: [a, b],
      title: `${name(a)} wants ${name(b)}, and ${name(b)} doesn't feel it`,
      next: `${name(a)} does something about it, and ${name(b)} has to answer`,
      ripeness: clamp01(0.3 + (att(a, b) - WANTS) / 100),
    });
  }
  // ── A and B both want X. X may be the player. ──
  // Not when X has a partner: a marriage and somebody wanting in is not two rivals, and in Rainier
  // Valley it was read as "May and Ellie Navarro both want Rabi" with the wife as one of the two.
  for (const x of cast) {
    if (cast.some((p) => p !== x && partners(p, x))) continue;
    const wanting = npcs.filter((a) => a !== x && att(a, x) >= WANTS && !partners(a, x));
    for (let i = 0; i < wanting.length; i++) for (let j = i + 1; j < wanting.length; j++) {
      const [a, b] = [wanting[i], wanting[j]].sort();
      out.push({
        key: `rivals:${a}:${b}:${x}`, pattern: "rivals", who: [a, b, x],
        title: `${name(a)} and ${name(b)} both want ${name(x)}`,
        next: `one of them finds out about the other`,
        ripeness: clamp01(0.4 + (Math.min(att(a, x), att(b, x)) - WANTS) / 100),
      });
    }
  }
  // ── A counts B a friend; B can't stand A ──
  for (const a of npcs) for (const b of npcs) {
    if (a === b || warm(a, b) < 35 || warm(b, a) > -15) continue;
    out.push({
      key: `onesided:${a}:${b}`, pattern: "one-sided", who: [a, b],
      title: `${name(a)} counts ${name(b)} a friend, and ${name(b)} can't stand ${name(a)}`,
      next: `${name(a)} leans on ${name(b)} for something, and ${name(b)}'s answer shows it`,
      ripeness: clamp01(0.3 + (warm(a, b) - warm(b, a) - 50) / 150),
    });
  }
  // ── A trusts B, who means A no good ──
  for (const a of npcs) for (const b of npcs) {
    if (a === b || trust(a, b) < 40 || warm(b, a) > -25) continue;
    out.push({
      key: `trust:${a}:${b}`, pattern: "misplaced trust", who: [a, b],
      title: `${name(a)} trusts ${name(b)}, who means ${name(a)} no good`,
      next: `${name(a)} hands ${name(b)} something that matters`,
      ripeness: clamp01(0.35 + (trust(a, b) - 40 - warm(b, a) - 25) / 150),
    });
  }
  // ── A is bound to B and to C, and B and C are at war ──
  const bound = (a: string, b: string) => BOND.test(roles(a, b)) || warm(a, b) >= 40;
  for (const a of npcs) {
    const ties = npcs.filter((b) => b !== a && bound(a, b));
    for (let i = 0; i < ties.length; i++) for (let j = i + 1; j < ties.length; j++) {
      const [b, c] = [ties[i], ties[j]].sort();
      const feud = Math.min(warm(b, c), warm(c, b));
      if (feud > -30) continue;
      out.push({
        key: `between:${a}:${b}:${c}`, pattern: "caught between", who: [a, b, c],
        title: `${name(a)} is caught between ${name(b)} and ${name(c)}`,
        next: `${name(b)} or ${name(c)} asks ${name(a)} to take a side`,
        ripeness: clamp01(0.35 + (-feud - 30) / 100),
      });
    }
  }
  // ── A and B are each after something from X ──
  const about = new Map<string, string[]>();
  for (const a of npcs) {
    const c = state.characters[a];
    for (const d of [c?.drive, ...(c?.drive_queue ?? [])]) {
      if (!d?.about || d.about === a || !cast.includes(d.about)) continue;
      (about.get(d.about) ?? about.set(d.about, []).get(d.about)!).push(a);
    }
  }
  for (const [x, list] of about) {
    const uniq = [...new Set(list)].sort();
    for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
      const [a, b] = [uniq[i], uniq[j]];
      if (out.some((s) => s.pattern === "rivals" && s.who.includes(a) && s.who.includes(b) && s.who.includes(x))) continue;
      out.push({
        key: `same:${a}:${b}:${x}`, pattern: "same quarry", who: [a, b, x],
        title: `${name(a)} and ${name(b)} are each after something from ${name(x)}`,
        next: `they turn up at ${name(x)}'s door on the same day`,
        ripeness: 0.4,
      });
    }
  }
  return out.sort((p, q) => q.ripeness - p.ripeness || p.key.localeCompare(q.key));
}

/** Patterns that are about wanting someone, and the one that is about being double-crossed. */
const ROMANTIC = new Set(["triangle", "unrequited", "rivals"]);
const BETRAYING = new Set(["misplaced trust"]);
/** A story the player said is gentle, or one whose forbidden list rules out what these lead to. */
const CALM_TONE = /\b(?:slice[- ]of[- ]life|cozy|cosy|wholesome|gentle|comfort(?:ing)?|domestic|healing|low[- ]stakes|feel[- ]good|everyday)\b/i;
const NO_AFFAIRS = /\b(?:betray\w*|affairs?|infidelity|cheat\w*|jealous\w*|love triangles?|romantic rival\w*|homewreck\w*|adulter\w*)\b/i;

/**
 * WHAT THIS STORY IS FOR DECIDES WHAT THE SIFTER MAY OPEN.
 *
 * Rainier Valley, chapter two. Tone: "Slice of life". Forbidden as a primary subject: "Sudden
 * relationship betrayal". On turns 1 and 2 the sifter opened "May and Ellie Navarro both want Rabi"
 * (what would move it on: one of them finds out about the other) and "Sonia Vale wants May, who
 * wants Rabi", and between them they were the pressure source on 8 of the next 27 turns, including
 * the one that walked Ellie into the house while the player was in the shower. The patterns were
 * read correctly off the numbers. The numbers weren't the story the player asked for.
 *
 * So in a story whose tone is gentle, or whose forbidden list names betrayal, affairs, cheating or
 * jealousy, the romantic shapes and the double-cross aren't opened, and any that are live are set
 * aside. Friendship gone sour, being caught between two people, two people wanting the same thing
 * from someone: those are slice of life too, and stay. If the player starts a romance or a rivalry
 * themselves, the story follows the player; it doesn't need a thread to.
 */
export function allowedHere(state: SaveState, s: Situation): boolean {
  if (!ROMANTIC.has(s.pattern) && !BETRAYING.has(s.pattern)) return true;
  const b = (state.world_bible ?? {}) as { tone?: string; forbidden?: string; forbidden_as_primary?: string[] };
  const forbidden = [b.forbidden ?? "", ...(b.forbidden_as_primary ?? [])].join(" | ");
  return !CALM_TONE.test(b.tone ?? "") && !NO_AFFAIRS.test(forbidden);
}

/** How much this situation concerns the player: they are in it, or someone in it matters to them. */
function nearPlayer(state: SaveState, s: Situation): number {
  if (s.who.includes("char_player")) return 1;
  let best = 0;
  for (const id of s.who) {
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    const r = state.world.edges.find((x) => x.from === "char_player" && x.to === id);
    const mag = Math.max(Math.abs(e?.warmth ?? 0) + Math.abs(e?.trust ?? 0), Math.abs(r?.warmth ?? 0) + Math.abs(r?.trust ?? 0));
    best = Math.max(best, Math.min(1, mag / 60), state.world.present?.includes(id) ? 0.6 : 0, e?.roles?.length ? 0.8 : 0);
  }
  return best;
}

/**
 * Keep the sifted threads in step with the state. Opens at most one new situation a turn (the
 * ripest one that touches the player at all), never more than MAX_SIFTED_LIVE live at once; closes a
 * sifted thread when its pattern is gone; leaves dormancy and anything the bookkeeper did alone.
 * Returns log lines for the offscreen report.
 */
export function siftStory(state: SaveState, turn: number): string[] {
  const log: string[] = [];
  const threads: Thread[] = (state.world.threads ??= []);
  const all = siftSituations(state);
  const found = all.filter((s) => allowedHere(state, s));
  const byKey = new Map(found.map((s) => [s.key, s]));
  const ruledOut = new Set(all.filter((s) => !byKey.has(s.key)).map((s) => s.key));

  for (const t of threads) {
    if (!t.sifted || (t.status !== "active" && t.status !== "dormant")) continue;
    if (ruledOut.has(t.sifted)) {
      t.status = "abandoned";
      t.turn_resolved = turn;
      log.push(`Set aside, because this story isn't about that: ${t.title}.`);
      continue;
    }
    const s = byKey.get(t.sifted);
    if (!s) {
      t.status = "resolved";
      t.turn_resolved = turn;
      log.push(`What was building between them has come apart on its own: ${t.title}.`);
      continue;
    }
    t.title = s.title;                                   // names can change; the shape is the same
    t.description = `${s.pattern}. What would move it on: ${s.next}.`;
  }

  const live = threads.filter((t) => t.sifted && t.status === "active").length;
  if (live >= MAX_SIFTED_LIVE) return log;
  const blocked = (key: string) => threads.some((t) => t.sifted === key
    && (t.status === "active" || t.status === "dormant" || t.status === "abandoned"
      || (t.turn_resolved !== undefined && turn - t.turn_resolved < REOPEN_AFTER)));
  const pick = found
    .filter((s) => !blocked(s.key))
    .map((s) => ({ s, score: s.ripeness * nearPlayer(state, s) }))
    .filter((x) => x.score >= 0.15)
    .sort((a, b) => b.score - a.score)[0];
  if (!pick) return log;
  const s = pick.s;
  threads.push({
    id: uid("thr"), title: s.title, status: "active", kind: "relationship",
    description: `${s.pattern}. What would move it on: ${s.next}.`,
    turn_started: turn, last_touched_turn: turn,
    tension: Math.max(2, Math.min(5, Math.round(2 + s.ripeness * 3))),
    sifted: s.key,
  });
  log.push(`Something is taking shape: ${s.title}.`);
  return log;
}
