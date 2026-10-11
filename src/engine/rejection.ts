/**
 * NO MEANS NO, IN THE NUMBERS.
 *
 * Rainier Valley, chapter two. The player told a coworker to get out of his house, asked whether he
 * needed to call the cops, called her a stalker to the director of engineering, called 911, and had
 * her arrested. At the end of it her edge to him read warmth -32, trust -75, attraction 68. Nothing in
 * the engine lowers attraction when somebody is turned down, so the want seeder read "dislikes him,
 * still wants him" and handed her, in order of preference, "get back in front of Rabi and make them
 * deal with it", "get Rabi to admit there is something between them" and "find out what Rabi is
 * really doing". She got the last one. A want that names the player was also, until this round, a
 * ticket back to wherever the player was standing. The player's summary, after five stories that went
 * the same way: it always ends up with a person who won't fuck off.
 *
 * So rejection is now a fact the engine records and reads:
 *
 *  - The player's own words, said or done, that turn someone away ("stay away from me", "get out of
 *    my house", "I'm calling the cops", "you're harassing me", "I can't leave my wife") mark that
 *    person's edge to the player as rejected, and take a real step off their attraction. A partner
 *    in a fight isn't rejected by an angry line; a partner is rejected by "I want a divorce".
 *  - A rejected person's wants stop being about the player. Any want that names the player is
 *    dropped, the seeder doesn't offer one, and a forged or bookkept one that names the player isn't
 *    kept. They get a want about their own life, which is what being turned down looks like.
 *  - It lasts until the player warms to them again.
 *
 * Zero tokens: regexes over the player's input and the edges already in the save.
 */
import type { SaveState } from "./types";

/** Words that turn someone away, unmistakably enough that the person in the room it's aimed at
 *  doesn't need naming: "leave me alone", "stay away from me", "get out of my house". */
const STRONG = new RegExp([
  String.raw`\b(?:stay|keep) (?:the fuck )?away(?: from (?:me|us|my \w+))?`,
  String.raw`\bleave (?:me|us) (?:the fuck )?alone\b`,
  String.raw`\bget (?:the fuck |the hell )?out of (?:my|our) (?:house|home|room|office|car|life|face)\b`,
  String.raw`\bget the (?:fuck|hell) out\b`,
  String.raw`\bget (?:the fuck |the hell )?away from (?:me|us)\b`,
  String.raw`\b(?:fuck|piss|back|bugger) off\b`,
  String.raw`\bgo away\b`,
  String.raw`\bstop (?:texting|calling|messaging|contacting|following|emailing|coming (?:here|over|to my))\b`,
  String.raw`\bdon'?t (?:text|call|message|contact|email|come near|come back|come here|touch) (?:me|us|again)\b`,
  String.raw`\b(?:i'?m|i am) not interested\b`,
  String.raw`\bi (?:don'?t|do not|never) want (?:you|to see you|anything (?:to do )?with you)\b`,
  String.raw`\bi (?:can'?t|cannot|won'?t|will not|am not going to|'m not going to) leave my (?:wife|husband|partner|girlfriend|boyfriend)\b`,
  String.raw`\b(?:restraining|protection|protective|no[- ]contact) order\b`,
].join("|"), "i");
/** ...and words that turn someone away only when that someone is named in the same input, because
 *  "call the police" and "stalker" are as often the plot of a thriller as a door closing on a person. */
const NAMED_ONLY = /\b(?:call(?:ing)? (?:the )?(?:cops|police)|call(?:ing)? 911|harass(?:ing|ment|ed)?|stalk(?:er|ing|ed)?|trespass(?:ing|ed)?|(?:get(?:ting)? you|you'?re|have you) fired|get (?:the fuck )?out)\b/i;

/** For a partner, an angry line isn't the end of anything. These are. */
const BREAKUP = /\b(?:i want a divorce|divorce papers|(?:end|ending|over) (?:this|our|the) marriage|we'?re (?:done|over|through)|it'?s over between us|i'?m leaving you|break(?:ing)? up with you|we should break up)\b/i;

const PARTNER = /(?<!ex-)(?<!ex )\b(?:wife|husband|spouse|partner|girlfriend|boyfriend|fianc[ée]e?|lover|married)\b/i;

/** How far one rejection moves attraction, and the floor it can't push below. */
const STEP = 15;

const lower = (s: unknown) => String(s ?? "").toLowerCase();

function playerName(state: SaveState): string {
  return String(state.characters?.char_player?.name ?? "").trim();
}

/** Whether two people are partners: a romantic role on either edge, or a line of canon naming both
 *  as spouses. In Rainier Valley the marriage was only ever in canon ("Rabi and May are consenting
 *  adult spouses"), and the edges carried no role at all, so a test on roles alone read the wife as
 *  one more woman who wanted him. */
export function arePartners(state: SaveState, a: string, b: string): boolean {
  const roles = (state.world?.edges ?? [])
    .filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
    .flatMap((e) => e.roles ?? []);
  if (roles.some((r) => PARTNER.test(r))) return true;
  const first = (id: string) => lower(state.characters?.[id]?.name).split(/\s+/)[0];
  const x = first(a), y = first(b);
  if (!x || !y || x.length < 2 || y.length < 2) return false;
  const has = (l: string, n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l);
  return (state.world?.canon ?? []).some((line) => {
    const l = lower(line);
    return has(l, x) && has(l, y) && /\b(?:spouses?|married|wife|husband|partners)\b/.test(l);
  });
}

/** Whether `id` is the player's partner. */
export function isPartner(state: SaveState, id: string): boolean {
  return arePartners(state, id, "char_player");
}

/** Does this goal aim at the player? By their name, first name, or "the player". */
export function namesPlayer(state: SaveState, goal: string): boolean {
  const g = lower(goal);
  const full = lower(playerName(state));
  const first = full.split(/\s+/)[0];
  return (!!full && full.length >= 3 && g.includes(full)) || (!!first && first.length >= 3 && new RegExp(`\\b${first}\\b`).test(g)) || /\bthe player\b/.test(g);
}

/** The people the player is turning away with this input. Named ones first; if nobody is named,
 *  whoever in the room wants the player (attraction 30+) and isn't their partner. */
export function rejectedBy(state: SaveState, action: string, present: string[]): string[] {
  const text = String(action ?? "");
  const strong = STRONG.test(text) || BREAKUP.test(text);
  if (!strong && !NAMED_ONLY.test(text)) return [];
  const t = lower(text);
  const cast = Object.entries(state.characters ?? {}).filter(([id, c]) => id !== "char_player" && c?.name);
  const named = cast.filter(([, c]) => {
    const full = lower(c.name);
    const first = full.split(/\s+/)[0];
    return t.includes(full) || (first.length >= 3 && new RegExp(`\\b${first}\\b`).test(t));
  }).map(([id]) => id);
  if (!named.length && !strong) return [];
  const pool = named.length ? named : present.filter((id) => {
    if (id === "char_player") return false;
    const e = (state.world.edges ?? []).find((x) => x.from === id && x.to === "char_player");
    return (e?.attraction ?? 0) >= 30;
  });
  return pool.filter((id) => !isPartner(state, id) || BREAKUP.test(text));
}

/** Record it: the edge is marked, attraction steps down, and a want aimed at the player goes. */
export function applyRejection(state: SaveState, ids: string[], turn: number): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const c = state.characters?.[id];
    if (!c) continue;
    let e = (state.world.edges ?? []).find((x) => x.from === id && x.to === "char_player");
    if (!e) { e = { from: id, to: "char_player", warmth: 0, trust: 0, power: 0 } as any; state.world.edges.push(e!); }
    const edge = e as any;
    const first = !edge.rejected;
    edge.rejected = { turn, count: (edge.rejected?.count ?? 0) + 1 };
    if (typeof edge.attraction === "number") {
      edge.attraction = Math.max(0, Math.round(edge.attraction - STEP));
      if (typeof edge.attraction_base === "number") edge.attraction_base = Math.min(edge.attraction_base, edge.attraction);
    }
    dropPursuit(state, id);
    if (first) out.push(`${c.name} heard you: they'll keep their distance from you now.`);
  }
  return out;
}

/** Remove wants aimed at the player from someone who has been turned away. Returns whether any went. */
export function dropPursuit(state: SaveState, id: string): boolean {
  const c = state.characters?.[id] as any;
  if (!c) return false;
  let dropped = false;
  if (c.drive?.goal && namesPlayer(state, c.drive.goal)) {
    const queue = (c.drive_queue ?? []).filter((d: any) => !namesPlayer(state, d?.goal ?? ""));
    c.drive = queue.shift();
    c.drive_queue = queue;
    if (!c.drive) delete c.drive;
    delete c.drive_refreshed_time;
    dropped = true;
  } else if (Array.isArray(c.drive_queue)) {
    const before = c.drive_queue.length;
    c.drive_queue = c.drive_queue.filter((d: any) => !namesPlayer(state, d?.goal ?? ""));
    dropped = c.drive_queue.length < before;
  }
  return dropped;
}

/**
 * Whether this person keeps away from the player: they're held somewhere, or the player turned them
 * away and hasn't warmed to them since. A rejection lifts when the player's own warmth toward them
 * comes back to 15 or more.
 */
export function keepsAway(state: SaveState, id: string): boolean {
  const c = state.characters?.[id] as any;
  if (!c) return false;
  if (c.held) return true;
  const e = (state.world?.edges ?? []).find((x) => x.from === id && x.to === "char_player") as any;
  if (!e?.rejected) return false;
  const mine = (state.world.edges ?? []).find((x) => x.from === "char_player" && x.to === id);
  if ((mine?.warmth ?? 0) >= 15) { delete e.rejected; return false; }
  return true;
}

/**
 * Once per save, read the story so far for rejections the engine didn't record because it didn't
 * know how yet, so a save from before this change gets the same treatment. Returns the people marked.
 */
export function backfillRejections(state: SaveState): string[] {
  const w = state.world as any;
  if (w.rejections_read) return [];
  w.rejections_read = true;
  const marked = new Set<string>();
  for (const h of state.history ?? []) {
    if ((h as any).kind && (h as any).kind !== "turn") continue;
    const ids = rejectedBy(state, h.player_action ?? "", (h as any).present ?? []);
    for (const id of ids) {
      applyRejection(state, [id], h.turn);
      marked.add(id);
    }
  }
  return [...marked];
}

/** The sweep the turn runs: anyone keeping away loses a want aimed at the player, and is named. */
export function sweepPursuit(state: SaveState): string[] {
  const out: string[] = [];
  for (const id of Object.keys(state.characters ?? {})) {
    if (id === "char_player" || !keepsAway(state, id)) continue;
    if (dropPursuit(state, id)) out.push(state.characters[id].name);
  }
  return out;
}
