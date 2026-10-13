/**
 * THE BOOKKEEPER JUDGES THE PROSE.
 *
 * Every check this engine ran on the narrator's output used to be a word list: a pattern for a
 * motive stated outright, another for a maxim, for a stock reassurance, for a line put in the
 * player's mouth, for a dead man getting up. Each one missed the phrasing nobody had thought of yet
 * and caught some innocent sentence that happened to share its words, and the owner said it in one
 * line: the models writing this prose are beyond being caught by word choice filters.
 *
 * So the bookkeeper, which already reads every word of the turn to record it, says what's wrong with
 * it as structured findings, quoting the offending words. This module holds the shape of those
 * findings, the context the bookkeeper needs to judge them (who is dead, whose body lacks what, which
 * storylines the player wiped), and the plain string code that finds a quoted span in the prose and
 * cuts it.
 *
 * Owner's call on the ordering: the bookkeeper reads the prose as the narrator wrote it, flags the
 * spans that can't stand, and is told to record nothing from them. The cuts are applied before the
 * turn is committed, so the page and the record both carry the cleaned turn. A turn with something
 * impossible in it, or a refusal, is sent back once and the bookkeeper reads the rewrite.
 */
import type { DialogueLine, ProseCheck, SaveState } from "./types";
import { clipText, isSpace, paragraphs, sentences, splitSentencesOutsideQuotes, unquoted, words } from "./text";
import { bodySeverity, bodyMarks, lostFaculties, FACULTY_LOSS } from "./body";
import { readAnatomy } from "./anatomy";
import { missedFor } from "./commitments";
import { complete, buildMessages, safeJson, Cancelled } from "../llm";

export const EMPTY_CHECK: ProseCheck = Object.freeze({
  story_starts: "", story_ends: "", not_story: [], refused: false, player_lines: [], impossible: [], wiped: [], overrun: "none",
  canned: [], interior: [], sayings: [], stock: [], figures: [], meta_talk: [], narrated_back: [],
  repeat_demand: "", missed_claim: null, body: [], family: [], player_third_person: [], walked_in: [],
  declared_miss: null, setting: [],
}) as ProseCheck;

/* ── WHO THE MODEL MEANT ─────────────────────────────────────────────────────────────────────── */

/** A character id from what the model wrote: the id itself, or the name it used for them.
 *  "char_player" stands. "" when it's nobody the story knows. */
export function whoIs(state: SaveState, v: unknown): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  if (raw === "char_player" || state.characters?.[raw]) return raw;
  const low = raw.toLowerCase();
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    const name = String(c?.name ?? "").toLowerCase();
    if (name && name === low) return id;
  }
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    const first = String(c?.name ?? "").toLowerCase().split(" ")[0];
    if (first && first.length >= 3 && first === low) return id;
  }
  return "";
}

/* ── FINDING A QUOTED SPAN ───────────────────────────────────────────────────────────────────────
 *
 * The model copies text back with small differences: straight quotes for curly ones, one space where
 * the prose had a line break, an ellipsis spelled out. A span that can't be found can't be cut, so
 * both sides are folded to one spelling before searching, and every folded character remembers where
 * it came from so the cut lands on the original text. */

const FOLD: Record<string, string> = {
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
  "—": "-", "–": "-", "…": "...", " ": " ",
};

function fold(s: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  let gap = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isSpace(ch) || ch === " ") {
      if (text && !gap) { text += " "; at.push(i); }
      gap = true;
      continue;
    }
    gap = false;
    const f = FOLD[ch] ?? ch.toLowerCase();
    for (const c of f) { text += c; at.push(i); }
  }
  return { text, at };
}

/** Where `span` sits in `prose`, as [start, end) in the original text; null when it isn't there. */
export function locate(prose: string, span: string, from = 0): [number, number] | null {
  const needle = fold(String(span ?? "")).text.trim();
  if (needle.length < 3) return null;
  const hay = fold(prose);
  const startFolded = hay.at.findIndex((i) => i >= from);
  if (startFolded === -1) return null;
  const k = hay.text.indexOf(needle, startFolded);
  if (k === -1) return null;
  const start = hay.at[k];
  const end = hay.at[k + needle.length - 1] + 1;
  return [start, end];
}

/** Whether the prose contains the span, forgiving the copying differences above. */
export function contains(prose: string, span: string): boolean {
  return locate(prose, span) !== null;
}

/* ── CUTTING ───────────────────────────────────────────────────────────────────────────────── */

function quoteMarks(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '"' || ch === "“" || ch === "”") n++;
  return n;
}

/**
 * Cut every sentence that holds one of `spans`, sentence by sentence and never across a quotation,
 * so a spoken line goes with its attribution and no quote mark is left stranded. A paragraph a cut
 * would leave with an odd number of quote marks is left as it was; a paragraph emptied entirely goes.
 * Returns the cleaned prose and the sentences that went.
 */
export function cutSentences(prose: string, spans: readonly string[], max = 12): { prose: string; cut: string[] } {
  const wanted = spans.map((s) => String(s ?? "").trim()).filter((s) => s.length >= 3);
  if (!wanted.length) return { prose, cut: [] };
  const cut: string[] = [];
  const out: string[] = [];
  for (const para of paragraphs(prose)) {
    const sents = splitSentencesOutsideQuotes(para);
    let pos = 0;
    const ranges = sents.map((s) => { const r: [number, number] = [pos, pos + s.length]; pos += s.length; return r; });
    const drop = new Set<number>();
    for (const w of wanted) {
      const hit = locate(para, w);
      if (!hit) continue;
      ranges.forEach(([a, b], i) => { if (hit[0] < b && hit[1] > a) drop.add(i); });
    }
    const room = max - cut.length;
    if (!drop.size || room <= 0) { out.push(para); continue; }
    for (const i of [...drop].sort((a, b) => a - b).slice(room)) drop.delete(i);
    const kept = sents.filter((_, i) => !drop.has(i)).join("").trim();
    if (kept && quoteMarks(kept) % 2 === 1) { out.push(para); continue; }
    for (const i of [...drop].sort((a, b) => a - b)) cut.push(sents[i].trim());
    if (kept) out.push(kept);
  }
  return { prose: out.join("\n\n"), cut };
}

/** Cut exactly the given spans, for text that was never a sentence of the story (a note, a heading,
 *  a word to the reader). Blank paragraphs left behind are dropped. */
export function cutSpans(prose: string, spans: readonly string[]): { prose: string; cut: string[] } {
  let text = prose;
  const cut: string[] = [];
  for (const s of spans) {
    const hit = locate(text, s);
    if (!hit) continue;
    cut.push(text.slice(hit[0], hit[1]));
    text = text.slice(0, hit[0]) + text.slice(hit[1]);
  }
  if (!cut.length) return { prose, cut };
  return { prose: paragraphs(text).map((p) => p.trim()).filter(Boolean).join("\n\n"), cut };
}

/** The prose with its last paragraph dropped, when at least two remain to keep. */
export function dropLastParagraph(prose: string): string {
  const paras = paragraphs(prose).map((p) => p.trim()).filter(Boolean);
  return paras.length >= 2 ? paras.slice(0, -1).join("\n\n") : prose;
}

/* ── THE MODEL'S ANSWER, HELD TO THE SHAPE ───────────────────────────────────────────────────── */

const text = (v: unknown, max = 400) => clipText(String(v ?? "").trim(), max);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown, max = 400, n = 8) => list(v).map((x) => text(x, max)).filter(Boolean).slice(0, n);

/** A span the model quoted only counts when it's really in the prose. A finding that quotes words the
 *  narrator never wrote would cut nothing and accuse the narrator of something it didn't do. */
function inProse(prose: string) {
  return (s: string) => !prose || contains(prose, s);
}

/** The bookkeeper's dialogue, attributed to people who exist. */
export function shapeDialogue(state: SaveState, raw: unknown, prose = ""): DialogueLine[] {
  const ok = inProse(prose);
  return list(raw)
    .map((d: any) => ({ who: whoIs(state, d?.who), line: text(d?.line, 600) }))
    .filter((d) => d.line && ok(d.line))
    .slice(0, 60);
}

/** The bookkeeper's findings on the prose, held to the shape and to the words actually written. */
export function shapeCheck(state: SaveState, raw: unknown, prose = ""): ProseCheck {
  const g: any = raw && typeof raw === "object" ? raw : {};
  const ok = inProse(prose);
  const how = (v: unknown) => (v === "hedged" || v === "interrupted" || v === "absent" ? v : "absent");
  const mc = g.missed_claim && typeof g.missed_claim === "object" ? g.missed_claim : null;
  const dm = g.declared_miss && typeof g.declared_miss === "object" ? g.declared_miss : null;
  const bound = (v: unknown) => { const t = text(v, 200); return t && ok(t) ? t : ""; };
  return {
    story_starts: bound(g.story_starts),
    story_ends: bound(g.story_ends),
    not_story: strings(g.not_story, 2000, 6).filter(ok),
    refused: !!g.refused,
    player_lines: strings(g.player_lines, 400).filter(ok),
    impossible: list(g.impossible).map((x: any) => ({ who: whoIs(state, x?.who), sentence: text(x?.sentence, 300), why: text(x?.why, 200) }))
      .filter((x) => x.sentence && ok(x.sentence)).slice(0, 6),
    wiped: strings(g.wiped, 400).filter(ok),
    overrun: g.overrun === "preempt" || g.overrun === "cascade" ? g.overrun : "none",
    canned: strings(g.canned, 300, 4).filter(ok),
    interior: strings(g.interior, 300).filter(ok),
    sayings: strings(g.sayings, 300).filter(ok),
    stock: list(g.stock).map((x: any) => ({ phrase: text(x?.phrase, 80), sentence: text(x?.sentence, 300) }))
      .filter((x) => x.phrase && ok(x.phrase)).slice(0, 6),
    figures: strings(g.figures, 300).filter(ok),
    meta_talk: list(g.meta_talk).map((x: any) => ({ who: whoIs(state, x?.who), line: text(x?.line, 300) }))
      .filter((x) => x.who && x.line && ok(x.line)).slice(0, 6),
    narrated_back: strings(g.narrated_back, 300).filter(ok),
    repeat_demand: ((d: string) => (d && ok(d) ? d : ""))(text(g.repeat_demand, 300)),
    missed_claim: mc && whoIs(state, mc.who) && text(mc.line) && ok(text(mc.line))
      ? { who: whoIs(state, mc.who), line: text(mc.line, 300) } : null,
    body: list(g.body).map((x: any) => ({ who: whoIs(state, x?.who), part: x?.part === "vulva" ? "vulva" as const : "penis" as const, sentence: text(x?.sentence, 300), named: x?.part }))
      .filter((x) => x.who && (x.named === "penis" || x.named === "vulva") && x.sentence && ok(x.sentence))
      .map(({ named: _named, ...x }) => x).slice(0, 3),
    family: list(g.family).map((x: any) => ({ who: whoIs(state, x?.who), relation: text(x?.relation, 40), other: text(x?.other, 80), because: text(x?.because, 200), sentence: text(x?.sentence, 300) }))
      .filter((x) => x.who && x.relation && x.sentence && ok(x.sentence)).slice(0, 3),
    player_third_person: strings(g.player_third_person, 300).filter(ok),
    walked_in: list(g.walked_in).map((x: any) => ({ who: whoIs(state, x?.who), line: text(x?.line, 300) }))
      .filter((x) => x.who && x.who !== "char_player" && x.line && ok(x.line)).slice(0, 3),
    declared_miss: dm && text(dm.declaration) ? { declaration: text(dm.declaration, 300), how: how(dm.how) } : null,
    setting: list(g.setting).map((x: any) => ({ sentence: text(x?.sentence, 300), motif: text(x?.motif, 40).toLowerCase(), alone: !!x?.alone }))
      .filter((x) => x.sentence && ok(x.sentence)).slice(0, 8),
  };
}

/** Whether the check found anything that has to come out of the prose before it's kept. */
export function needsRewrite(c: ProseCheck): boolean {
  return c.refused || c.impossible.length > 0;
}

/* ── WHAT THE BOOKKEEPER NEEDS TO JUDGE IT ───────────────────────────────────────────────────────
 *
 * Only the sections that apply this turn, so a quiet scene costs nothing extra. Each one is a fact
 * the state already holds and the prose can contradict. */
export function proseCheckContext(state: SaveState, opts: { presentAtStart?: readonly string[]; mode?: string; privatePlace?: boolean } = {}): string {
  const parts: string[] = [];
  const cast = state.characters ?? {};
  const gone = Object.entries(cast)
    .filter(([, c]) => c && (c.status === "dead" || c.status === "departed"))
    .map(([id, c]) => `${c.name}=${id} (${c.status})`);
  if (gone.length) parts.push(`GONE FROM THE STORY (they can be remembered or talked about, and their bodies can be there, but they can't act, speak or arrive): ${gone.join("; ")}`);

  const present = (state.world?.present ?? []).filter((id) => id !== "char_player" && cast[id]);
  const bodies: string[] = [];
  for (const id of ["char_player", ...present]) {
    const c = cast[id];
    const cond = state.condition?.[id];
    if (!c) continue;
    if (cond && bodySeverity(cond) >= 3) {
      const lost = lostFaculties(cond).filter((f) => f !== "hearing");
      if (lost.length) bodies.push(`${c.name} ${lost.map((f) => FACULTY_LOSS[f]).join(", and ")} (the record reads: ${bodyMarks(cond).join(", ").slice(0, 120)})`);
    }
    if (id !== "char_player") {
      const rec = readAnatomy(state, id, c);
      for (const part of rec?.lacks ?? []) bodies.push(`${c.name} has no ${part === "vulva" ? "vulva or vagina" : "penis or testicles"}`);
    }
  }
  if (bodies.length) parts.push(`BODIES ON RECORD: ${bodies.join("; ")}`);

  const ids = new Set(["char_player", ...present]);
  const kin = (state.world?.edges ?? [])
    .filter((e) => ids.has(e.from) && ids.has(e.to) && (e.roles ?? []).length)
    .map((e) => `${cast[e.from]?.name ?? e.from} → ${cast[e.to]?.name ?? e.to}: ${(e.roles ?? []).join(", ")}`);
  if (kin.length) parts.push(`WHO THEY ARE TO EACH OTHER, ON RECORD: ${kin.join("; ")}`);

  const nuked = state.world?.nuked ?? [];
  if (nuked.length) parts.push(`STORYLINES THE PLAYER WIPED (gone from the story unless the player brings one up this turn): ${nuked.map((n) => [...n.terms, ...(n.names ?? [])].join(", ")).join(" | ")}`);

  const missed: string[] = [];
  for (const id of present) for (const m of missedFor(state, id).slice(0, 2)) missed.push(`${cast[id]?.name}: ${clipText(m.content, 120)} (due ${m.due || "earlier"}, and they were here instead)`);
  if (missed.length) parts.push(`APPOINTMENTS PEOPLE HERE MISSED: ${missed.join("; ")}`);

  if (opts.privatePlace) {
    const atStart = (opts.presentAtStart ?? []).filter((id) => id !== "char_player").map((id) => cast[id]?.name).filter(Boolean);
    parts.push(`THE PLAYER IS IN A PRIVATE PLACE. Here when the turn began: ${atStart.length ? atStart.join(", ") : "nobody else"}.`);
  }
  if (opts.mode === "story") parts.push(`THE PLAYER WROTE THIS TURN AS ITS AUTHOR: what they wrote is meant to happen in the prose.`);
  return parts.length ? `=== FOR CHECKING THE PROSE ===\n${parts.join("\n")}` : "";
}

/* ── WHAT THE NEXT TURN IS TOLD ──────────────────────────────────────────────────────────────────
 *
 * The findings that stay in the prose are style, and style is corrected on the following turn by
 * quoting the narrator's own sentence back to it (see maxims.ts, echo.ts, stock.ts for the notes
 * themselves). Some of them fire on the instance and some only on recurrence, because one comparison
 * is a choice and the same one three turns running is a habit; the recurrence rules are the ones the
 * old detectors used, now counted over the findings each history entry keeps. */

/** The turns before this one, oldest first, as the findings and dialogue each one kept. */
export type PastTurns = readonly { faults?: ProseCheck; dialogue?: DialogueLine[] }[];

const phraseKey = (p: string) => words(String(p ?? "").toLowerCase()).join(" ");

/** A stock phrase to quote back: the same one coming back within five turns, or two in this one. */
export function stockFrom(check: ProseCheck, past: PastTurns): { phrase: string; sentence: string } | null {
  if (!check.stock.length) return null;
  const before = new Set(past.slice(-5).flatMap((h) => (h.faults?.stock ?? []).map((s) => phraseKey(s.phrase))));
  const recurring = check.stock.find((s) => before.has(phraseKey(s.phrase)));
  if (recurring) return recurring;
  return new Set(check.stock.map((s) => phraseKey(s.phrase))).size >= 2 ? check.stock[0] : null;
}

/** Turns running with a comparison explaining a spoken line before it's a habit, and how far back
 *  a run may be interrupted and still count (the save it came from skipped a turn). */
export const FIGURE_RUN = 3;
const FIGURE_WINDOW = 5;

export function figureFrom(check: ProseCheck, past: PastTurns): { line: string; frame: string; runs: number } | null {
  if (!check.figures.length) return null;
  const runs = 1 + past.slice(-FIGURE_WINDOW).filter((h) => (h.faults?.figures ?? []).length).length;
  return runs >= FIGURE_RUN ? { line: check.figures[0], frame: "a comparison explaining a spoken line", runs } : null;
}

/** How much of one person's talk in a turn has to be about the talking before the turn counts
 *  (measured: the failing turns ran 36–50%, ordinary ones 0–14%), at least how many such lines,
 *  and how many turns running make it a habit. The drip is the same fault at a lower rate over a
 *  longer window: one verdict on the conversation a turn, for turn after turn. */
const META_RATE = 0.25, META_MIN = 3, META_RUN = 2;
const DRIP_WINDOW = 5, DRIP_TURNS = 3, DRIP_TOTAL = 4;

function spokenSentences(dialogue: readonly DialogueLine[] | undefined, who: string): number {
  return (dialogue ?? []).filter((d) => d.who === who).reduce((n, d) => n + Math.max(1, sentences(d.line).length), 0);
}
function metaLines(faults: ProseCheck | undefined, who: string): string[] {
  return (faults?.meta_talk ?? []).filter((m) => m.who === who).map((m) => m.line);
}
function metaTurn(t: { faults?: ProseCheck; dialogue?: DialogueLine[] }, who: string): boolean {
  const hits = metaLines(t.faults, who).length;
  const total = spokenSentences(t.dialogue, who);
  return hits >= META_MIN && total > 0 && hits / total >= META_RATE;
}

export function metaTalkFrom(state: SaveState, presentIds: readonly string[], check: ProseCheck, dialogue: readonly DialogueLine[], past: PastTurns): { name: string; lines: string[]; runs: number } | null {
  const now = { faults: check, dialogue: [...dialogue] };
  for (const id of presentIds) {
    const c = state.characters?.[id];
    if (!c || id === "char_player") continue;
    if (metaTurn(now, id)) {
      let runs = 1;
      for (let i = past.length - 1; i >= 0 && runs < META_RUN + 3; i--) {
        if (!metaTurn(past[i], id)) break;
        runs++;
      }
      if (runs >= META_RUN) return { name: c.name, lines: metaLines(check, id).slice(0, 3), runs };
    }
    const window = [...past.slice(-(DRIP_WINDOW - 1)), now];
    let carrying = 0, total = 0;
    const sample: string[] = [];
    for (const t of window) {
      const hits = metaLines(t.faults, id);
      if (hits.length) { carrying++; total += hits.length; sample.push(...hits); }
    }
    if (carrying >= DRIP_TURNS && total >= DRIP_TOTAL) return { name: c.name, lines: sample.slice(-3), runs: carrying };
  }
  return null;
}

/** Two lines telling the player what they're doing this turn, one now and one in either of the two
 *  turns before, or the player saying so in the scene. */
export function narratedBackFrom(check: ProseCheck, past: PastTurns, complained: boolean): { lines: string[]; complained: boolean } | null {
  const now = check.narrated_back;
  const before = past.slice(-2).flatMap((h) => h.faults?.narrated_back ?? []);
  if (now.length >= 2 || (now.length >= 1 && before.length >= 1) || (complained && (now.length || before.length))) {
    return { lines: [...now, ...before].slice(0, 3), complained };
  }
  return complained ? { lines: [], complained } : null;
}

/** Folded for comparing an authored phrase against a spoken line: lower case, one kind of quote,
 *  letters, digits and apostrophes only, single spaces. */
function plainWords(s: string): string {
  return words(String(s ?? "").toLowerCase().split("’").join("'")).join(" ");
}

/** A line somebody spoke this turn that their own card lists under never_says. Phrases under three
 *  words are skipped, because "no" and "sorry" turn up inside ordinary sentences. */
export function neverSaidFrom(state: SaveState, presentIds: readonly string[], dialogue: readonly DialogueLine[]): { name: string; said: string; forbidden: string } | null {
  for (const id of presentIds) {
    const c: any = state.characters?.[id];
    const forbidden = ((c?.voice?.never_says ?? []) as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!c || !forbidden.length) continue;
    for (const d of dialogue) {
      if (d.who !== id) continue;
      const hay = ` ${plainWords(d.line)} `;
      for (const f of forbidden) {
        const needle = plainWords(f);
        if (needle.split(" ").length < 3) continue;
        if (hay.includes(` ${needle} `)) return { name: c.name, said: d.line.slice(0, 180), forbidden: f };
      }
    }
  }
  return null;
}

/** Second-person words in the narration, outside what anybody says. */
function secondPerson(prose: string): number {
  let n = 0;
  for (const w of words(unquoted(prose).toLowerCase())) if (w === "you" || w === "your" || w === "yours" || w === "you're" || w === "youre") n++;
  return n;
}

export interface FeedForward { shifts: string[]; fires: [string, string][] }

/**
 * Every next-turn correction this engine holds, set from one turn's findings. Fields left null mean
 * the turn was clean on that count. `past` is the turns before this one with their kept findings.
 */
export function feedForward(state: SaveState, check: ProseCheck, dialogue: readonly DialogueLine[], ctx: {
  prose: string; mode: string; voided: boolean; complained: boolean; presentIds: readonly string[]; past: PastTurns;
}): FeedForward {
  const out: FeedForward = { shifts: [], fires: [] };
  const cast = state.characters ?? {};
  const name = (id: string) => cast[id]?.name ?? id;

  state.last_leak = check.interior.length ? [...check.interior].sort((a, b) => b.length - a.length)[0].slice(0, 180) : null;
  if (check.interior.length) out.shifts.push(`the narrator stated what someone was feeling or thinking ${check.interior.length > 1 ? `${check.interior.length} times` : "once"} this turn, and this will be corrected next turn`);

  const risen = check.impossible.find((v) => cast[v.who] && (cast[v.who].status === "dead" || cast[v.who].status === "departed"));
  state.last_risen = risen ? { name: name(risen.who), status: String(cast[risen.who].status), line: risen.sentence } : null;

  state.last_maxim = check.sayings.length ? [...check.sayings].sort((a, b) => a.length - b.length)[0].slice(0, 180) : null;
  if (check.sayings.length >= 2) out.shifts.push(`${check.sayings.length} lines of dialogue this turn didn't mention anything in the room, and the narrator will be shown one of them next turn`);

  const stock = stockFrom(check, ctx.past);
  state.last_stock = stock ? { phrase: stock.phrase, sentence: stock.sentence.slice(0, 240) } : null;

  state.last_declared = ctx.mode === "story" && !ctx.voided && check.declared_miss
    ? { declaration: check.declared_miss.declaration, coverage: 0, how: check.declared_miss.how } : null;

  state.last_figure = figureFrom(check, ctx.past);
  if (state.last_figure) out.fires.push(["figure", `the same narration frame for ${state.last_figure.runs} turns: "${state.last_figure.line.slice(0, 60)}"`]);

  state.last_meta_talk = metaTalkFrom(state, ctx.presentIds, check, dialogue, ctx.past);
  if (state.last_meta_talk) {
    out.fires.push(["meta_talk", `${state.last_meta_talk.name} narrated the conversation for ${state.last_meta_talk.runs} turns`]);
    out.shifts.push(`${state.last_meta_talk.name} has been describing the conversation instead of having it, and this will be corrected next turn`);
  }

  state.last_narrated_back = narratedBackFrom(check, ctx.past, ctx.complained);
  if (state.last_narrated_back) out.fires.push(["narrated_back", state.last_narrated_back.complained ? "the player said the scene keeps describing them back to themselves" : `dialogue described the player back to them: "${state.last_narrated_back.lines[0]?.slice(0, 60) ?? ""}"`]);

  state.last_never_said = neverSaidFrom(state, ctx.presentIds, dialogue);
  if (state.last_never_said) {
    out.fires.push(["never_says", `${state.last_never_said.name} said "${state.last_never_said.forbidden}"`]);
    out.shifts.push(`${state.last_never_said.name} said a line their character card lists as something they'd never say, and this will be corrected next turn`);
  }

  const mc = check.missed_claim;
  const missed = mc ? missedFor(state, mc.who)[0] : undefined;
  state.last_missed_claim = mc && missed ? { name: name(mc.who), said: mc.line, content: missed.content, due: missed.due } : null;
  if (state.last_missed_claim) {
    out.fires.push(["confabulation", `${state.last_missed_claim.name} claimed an appointment the record says was missed`]);
    out.shifts.push(`${state.last_missed_claim.name} talked about keeping an appointment, but the record has them in this room at the time, and this will be corrected next turn`);
  }

  const body = check.body[0];
  state.last_anatomy = body ? { name: name(body.who), part: body.part, sentence: body.sentence, pronouns: cast[body.who]?.pronouns } as any : null;
  if (state.last_anatomy) {
    out.fires.push(["anatomy", `${state.last_anatomy.name}: ${state.last_anatomy.part} the record does not give them`]);
    out.shifts.push(`the prose gave ${state.last_anatomy.name} a body part the record contradicts, and this will be corrected and removed next turn`);
  }

  const kin = check.family[0];
  state.last_kin = kin ? { owner: name(kin.who), relation: kin.relation, ...(kin.other ? { other: kin.other } : {}), because: kin.because, sentence: kin.sentence } : null;
  if (state.last_kin) {
    out.fires.push(["kin", `${state.last_kin.owner} given a ${state.last_kin.relation} — ${state.last_kin.because}`]);
    out.shifts.push(`the prose gave ${state.last_kin.owner} a ${state.last_kin.relation} that the record contradicts, and this will be corrected and removed next turn`);
  }

  const third = check.player_third_person.length;
  state.last_pov = third >= 2 ? { third, second: secondPerson(ctx.prose) } : null;
  if (state.last_pov) {
    out.fires.push(["pov", `the player was written in the third person in ${third} sentences`]);
    out.shifts.push(`this turn described you from the outside instead of speaking to you as "you", and the narrator will be told next turn`);
  }

  const w = check.walked_in[0];
  state.last_intrusion = w ? { name: name(w.who), line: w.line, place: state.world?.places?.[state.world.player_location]?.name ?? "" } : null;
  return out;
}

/** The setting sentences to cut: free-standing ones (nobody in them) past the first, and any on a
 *  motif last turn already spent, which loses its allowance. A long sentence is carrying something
 *  and stays, and no more than three go in one turn. */
export function settingCuts(setting: ProseCheck["setting"], spent: ReadonlySet<string>): string[] {
  let budget = 1;
  const out: string[] = [];
  for (const s of setting) {
    if (!s.alone || s.sentence.length > 180) continue;
    if (s.motif && spent.has(s.motif)) { out.push(s.sentence); continue; }
    if (budget > 0) { budget--; continue; }
    out.push(s.sentence);
  }
  return out.slice(0, 3);
}

/** How many turns back a history entry keeps its findings and dialogue: the longest look-back any
 *  rule above takes, with a little room. */
export const KEEP_FINDINGS = 8;

/** Whether a turn's check found anything at all, so a clean turn stores nothing. */
export function hasFindings(c: ProseCheck): boolean {
  for (const v of Object.values(c)) {
    if (Array.isArray(v) ? v.length : typeof v === "string" ? v && v !== "none" : !!v) return true;
  }
  return false;
}

/** The story with whatever came before `starts` and after `ends` taken off: the planning a reasoning
 *  model wrote first, the draft it abandoned, the notes it added after. A bound that can't be found
 *  cuts nothing, and a cut that would leave almost nothing is refused. */
export function trimToStory(prose: string, starts: string, ends: string): { prose: string; cut: boolean } {
  let from = 0, to = prose.length;
  const s = starts ? locate(prose, starts) : null;
  if (s) from = s[0];
  const e = ends ? locate(prose, ends, from) : null;
  if (e) to = e[1];
  if (from === 0 && to === prose.length) return { prose, cut: false };
  // a closing quotation mark or bracket right after the last words belongs to the story
  while (to < prose.length && "\"'”’)".includes(prose[to])) to++;
  const kept = prose.slice(from, to).trim();
  if (words(kept).length < 12) return { prose, cut: false };
  return { prose: kept, cut: true };
}

/* ── THE OPENING, WHICH HAS NO BOOKKEEPER ────────────────────────────────────────────────────────
 *
 * The opening scene is written before turn 1 and never goes through the bookkeeper, and it is the
 * page every story starts on: one save's opening was 865 words of a model talking to itself about
 * word counts. So it gets the bounds question on its own, from the small model. */

const BOUNDS_SYSTEM = `You're given the reply a writer sent back when asked for the opening scene of a story. Sometimes the reply holds more than the scene: the writer planning or reasoning out loud before it, a draft it abandoned, notes or a word count after it, or a second attempt. You find where the scene itself is. Return JSON with story_starts, the first six or so words of the scene copied exactly, and story_ends, the last six or so words of the scene copied exactly, leaving either empty when the reply starts or ends with the scene. When there are two versions, the scene is the one the writer settled on. not_story lists any shorter stretch inside the scene that isn't part of it, such as a note, a heading or a remark to the reader, copied exactly.`;
const BOUNDS_SCHEMA = { type: "object", properties: { story_starts: { type: "string" }, story_ends: { type: "string" }, not_story: { type: "array", items: { type: "string" } } }, required: [], additionalProperties: true };

/** The scene alone, out of a reply that may hold more than the scene. Never throws; a failed call
 *  leaves the text as it was, apart from a cancel, which is rethrown. */
export async function storyOnly(text: string, model: string, fallback: string, signal?: AbortSignal): Promise<string> {
  try {
    const out = await complete(buildMessages(BOUNDS_SYSTEM, "", `THE REPLY:\n${text.slice(0, 12000)}\n\nReply with the JSON only.`, model), model, fallback, { schema: BOUNDS_SCHEMA, name: "story_bounds" }, 400, { signal });
    const g = safeJson<any>(out.text, null) ?? {};
    const bound = (v: unknown) => { const t = clipText(String(v ?? "").trim(), 200); return t && contains(text, t) ? t : ""; };
    let story = trimToStory(text, bound(g.story_starts), bound(g.story_ends)).prose;
    story = cutSpans(story, strings(g.not_story, 2000, 6).filter((s) => contains(story, s))).prose;
    return story;
  } catch (e: any) {
    if (e instanceof Cancelled) throw e;
    console.warn("[opening] couldn't find the scene's bounds; keeping the reply as written", e?.message ?? e);
    return text;
  }
}
