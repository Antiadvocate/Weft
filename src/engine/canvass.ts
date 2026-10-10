/**
 * CANVASS — one question, put to several people, answered side by side.
 *
 * The interview (Cast → Interview) reaches one person at a time, and one person's answer is a
 * portrait. The thing the mind layer and the rumour field actually model is the DIFFERENCE between
 * people: who has heard what, from whom, in which version, and who has the player wrong. That only
 * becomes visible when the same question goes to several of them at once — "what do people make of
 * me?" answered by a sister who heard the sharpened version, a neighbour who saw it happen, and a
 * friend who has stopped looking.
 *
 * The idea is lifted from a swarm-simulation tool's "send a survey to the world"; the choice of whom
 * to ask is not. That tool asks a model to pick respondents. Here it is deterministic and free:
 *
 *   · RELEVANCE. Named in the question counts most; then overlap between the question and what the
 *     person carries — their card, their want, their memories, what they have heard.
 *   · SPREAD. Respondents are drawn round-robin across how they stand toward the player — warm, cold,
 *     neutral, and carrying a misread — so a canvass is never four people who all agree. A survey of
 *     the like-minded is a mirror.
 *
 * Nothing a canvass produces is recorded in the world, the same as the interview it is built from.
 */
import type { SaveState } from "./types";
import { askableFactions } from "./institution";
import { relevance } from "./memory";
import { clipText } from "./text";

export type Leaning = "misread" | "warm" | "cold" | "neutral";
export interface CanvassPick { id: string; name: string; leaning: Leaning; score: number; why: string }

const LEANING_WORD: Record<Leaning, string> = {
  misread: "has you wrong",
  warm: "warm toward you",
  cold: "cold toward you",
  neutral: "no strong feeling about you",
};

/** Rumours this person holds that someone else started — what they have heard, not what they saw. */
export function heardBy(state: SaveState, id: string) {
  return (state.world.rumors ?? []).filter((r) => !r.dead && r.knowers.includes(id) && r.origin_char !== id);
}

/** Where someone stands toward the player, read the way the rest of the engine reads it. */
export function leaningOf(state: SaveState, id: string): Leaning {
  const b = state.minds?.[id]?.about.find((x) => x.target === "char_player");
  if (b?.held_false) return "misread";
  const w = state.world.edges.find((e) => e.from === id && e.to === "char_player")?.warmth ?? 0;
  if (w >= 20) return "warm";
  if (w <= -20) return "cold";
  return "neutral";
}

// A short name ("Ed", "Bo") is matched as written, capital and all, so "ed" inside a sentence is not Ed.
const nameHit = (q: string, name: string, aliases: string[] = []) => {
  const handles = [name, name.split(/\s+/)[0], ...aliases].filter((h) => h && h.trim().length >= 2);
  return handles.some((h) => new RegExp(`\\b${h.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, h.trim().length < 4 ? "" : "i").test(q));
};

/** The people a canvass should reach for this question, at most `n`. See the file header. */
export function pickCanvass(state: SaveState, question: string, n = 4): CanvassPick[] {
  const q = String(question ?? "");
  const scored: CanvassPick[] = [];
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player" || !c || c.status === "dead" || c.status === "departed") continue;
    const reasons: string[] = [];
    let score = 0;
    if (nameHit(q, c.name, c.aliases)) { score += 3; reasons.push("named in the question"); }
    const card = [c.background, c.current_goal, c.drive?.goal, ...(c.core_traits ?? []), c.life_history].filter(Boolean).join(" ");
    score += relevance(card, q) * 1.5;
    const mems = (state.memory?.[id]?.episodic ?? []).slice(-40);
    const bestMem = mems.reduce((m, e) => Math.max(m, relevance(e.content, q)), 0);
    score += bestMem * 2;
    if (bestMem >= 0.2) reasons.push("remembers something to do with it");
    const heard = heardBy(state, id);
    const bestHeard = heard.map((r) => ({ r, v: relevance(r.content, q) })).sort((a, b) => b.v - a.v)[0];
    if (bestHeard && bestHeard.v >= 0.15) { score += 1 + bestHeard.v; reasons.push(`heard “${clipText(bestHeard.r.content, 70)}”`); }
    else if (heard.length) score += 0.2;
    if (state.world.present?.includes(id)) score += 0.3;
    if (c.tracked) score += 0.2;
    const leaning = leaningOf(state, id);
    reasons.unshift(LEANING_WORD[leaning]);
    scored.push({ id, name: c.name, leaning, score: +score.toFixed(3), why: reasons.join(" · ") });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // SPREAD: round-robin across leanings, each bucket in score order, buckets ordered by their best.
  const buckets = new Map<Leaning, CanvassPick[]>();
  for (const p of scored) (buckets.get(p.leaning) ?? buckets.set(p.leaning, []).get(p.leaning)!).push(p);
  const order = [...buckets.values()].sort((a, b) => b[0].score - a[0].score);
  const out: CanvassPick[] = [];
  while (out.length < n && order.some((b) => b.length)) {
    for (const b of order) {
      const next = b.shift();
      if (next) out.push(next);
      if (out.length >= n) break;
    }
  }
  return out;
}

/**
 * What a person being asked out of scene knows that the card does not say: their read of the player
 * (which may be wrong — they answer from it, not from the truth), and what they have heard, in the
 * version they heard it. Shared by the single interview and the canvass.
 */
export function knowsLines(state: SaveState, id: string): string[] {
  const out: string[] = [];
  for (const b of state.minds?.[id]?.about ?? []) {
    const who = b.target === "char_player" ? "the player" : state.characters?.[b.target]?.name;
    if (!who) continue;
    if (b.held_false) out.push(`About ${who}, you are convinced: ${b.held_false}`);
    else if (b.confidence < 0.4) out.push(`With ${who}, you honestly can't tell where you stand.`);
  }
  const heard = heardBy(state, id).slice(-4);
  if (heard.length) {
    out.push(`Things you've heard from other people, as you heard them (you weren't there; you can repeat them, doubt them or keep them to yourself): ${heard.map((r) => {
      const from = [...(r.path ?? [])].reverse().find((h) => h.to === id)?.from;
      const teller = from ? state.characters?.[from]?.name : null;
      return `“${clipText(r.content, 160)}”${teller ? ` (from ${teller})` : ""}`;
    }).join("; ")}`);
  }
  return out;
}

/** Factions a canvass should offer for this question: the ones it names, then the ones whose public
 *  line or visible signs it touches. Asked as the institution, they answer with its public voice. */
export function pickFactions(state: SaveState, question: string, n = 2): { id: string; faction: string; why: string }[] {
  const q = String(question ?? "");
  return askableFactions(state)
    .map((k) => {
      const named = new RegExp(`\\b${k.faction.replace(/^the\s+/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q);
      const v = relevance(`${k.faction} ${k.public_line ?? ""} ${(k.visible_signs ?? []).join(" ")}`, q);
      return { id: k.id, faction: k.faction, score: (named ? 3 : 0) + v, why: named ? "named in the question" : "its public business touches this" };
    })
    .filter((x) => x.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ id, faction, why }) => ({ id, faction, why }));
}
