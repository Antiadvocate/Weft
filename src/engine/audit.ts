/**
 * MEASURING THE MACHINE — two instruments, no model calls, runs on any save.
 *
 * ── 1. COVERAGE (does this field reach a prompt at all?) ─────────────────────────────────────
 * State that never enters a prompt cannot cause anything. It is not simulation, it is bookkeeping
 * about bookkeeping — and it is invisible, because a field that is written every turn and read by
 * nobody looks exactly like a field that is working.
 *
 * This does not grep the prompts for values, which produces false positives on every `0`, `true`,
 * and common word. It MUTATES: set one leaf to a sentinel, rebuild every prompt the engine sends,
 * and ask whether any of them changed. That is the actual question — "if this field were different,
 * would the model be told anything different?" — and it has no false positives at all.
 *
 * The transcript is deliberately NOT part of the corpus. Chatlog mode feeds raw prior prose to the
 * narrator, and that channel will happily carry a fact the state also holds; counting it would let
 * the transcript take credit for the state's work. What is measured here is the state channel only.
 *
 * SCOPE — the corpus is the two calls that render the story: the narrator (stable prefix + volatile
 * digest) and the bookkeeper (simulator context). The auxiliary passes — reads, intent, reflection,
 * offstage, drive forge — assemble their context inline rather than through an exported builder, so
 * they cannot be measured here. A subsystem reading 0% is therefore "never reaches the narrator or
 * the bookkeeper", which is the question that matters for what ends up on the page, but is not the
 * same as "nothing reads it". `faculties` is the clean example: 0% here, and read every turn by the
 * reads pass.
 *
 * ── 2. EMERGENCE COUNTERS (did anything actually cross between subsystems?) ──────────────────
 * Emergence worth the name is not "surprising output" — a good narrator is surprising by itself, and
 * chaos metrics measure unpredictability, which an RNG maximises while causing nothing. What counts
 * is CROSS-COMPONENT CAUSATION: an outcome produced by machinery the language model could not have
 * re-derived from the words in its window.
 *
 * Three things in this engine qualify structurally, because the model never sees their working:
 *   · an offstage event the world sim invented while the player was elsewhere, later on the page;
 *   · a rumour that reached someone by cascade rather than by witnessing, who then acts on it;
 *   · a want pursued across enough turns that no single turn's prose contains it.
 * Each is counted here, with the null models that stop the numbers flattering themselves.
 */
import type { SaveState } from "./types";
import { stablePrefix, volatileDigest, simulatorContext } from "./prompts";
import { MAX_STAGE } from "./authored";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * 1. COVERAGE
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

export interface FieldCoverage {
  path: string;          // e.g. "characters.char_player.core_traits.0"
  kind: "string" | "number" | "boolean";
  reached: string[];     // which prompts changed when this field changed
}

export interface CoverageReport {
  fields: FieldCoverage[];
  reachedCount: number;
  totalCount: number;
  pct: number;
  /** Dead weight, grouped by the shape of the path, biggest group first. */
  darkGroups: { group: string; count: number; example: string }[];
  byPrompt: Record<string, number>;
  /** Paths the prompt builders WRITE while building. Building a prompt is supposed to be a read. */
  impurePaths: string[];
  /** Coverage per subsystem — the actionable view. A subsystem at 0% is not simulating anything. */
  bySubsystem: { name: string; reached: number; total: number; pct: number }[];
}

const SENTINEL_STR = "ZZQXJVWK";
const SENTINEL_NUM = 918273645;

/** Fields skipped as a matter of definition, not convenience. */
function skipPath(path: string): boolean {
  return (
    // megabytes of base64 that would dominate the walk and prove nothing
    /(^|\.)(portrait_url|illustration_url|blob)$/.test(path) ||
    // device-local rollback copies: a snapshot of state is not state
    /^snapshots(\.|$)/.test(path) ||
    // the ledger of what the engine did, never an input to it
    /^(telemetry|pressure_trace|aux_spend|sim_dry_runs)(\.|$)/.test(path) ||
    // the transcript is the other channel; see the header
    /^history(\.|$)/.test(path)
  );
}

/** Every prompt the engine actually sends that is built FROM STATE.
 *
 *  The digest is relevance-ranked against a query, so a single query would score a field as dark
 *  merely because this turn's words did not cue it. Several queries are unioned: a field counts as
 *  reachable if ANY plausible turn would show it. */
function corpus(s: SaveState, queries: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const safe = (name: string, fn: () => string) => {
    try { out[name] = fn(); } catch { out[name] = "<threw>"; }
  };
  safe("narrator.prefix", () => stablePrefix(s));
  queries.forEach((q, i) => safe(`narrator.digest${i ? `#${i}` : ""}`, () => volatileDigest(s, q)));
  safe("bookkeeper.context", () => simulatorContext(s));
  return out;
}

/** Copy every scalar from `pristine` back into `live`, preserving object identity.
 *
 *  Needed because the builders are not pure — `volatileDigest` stamps `last_accessed_turn` on every
 *  memory it surfaces (retrieval strengthening: a recalled memory decays slower). That is a real
 *  mechanism, not a bug, but it means each build changes the input to the next one. Measured naively,
 *  that drift alone made 99% of fields look "reached" — the baseline was moving under the test.
 *
 *  Restoring in place rather than swapping the subtree keeps the walker's parent references valid. */
function restoreInPlace(live: any, pristine: any, depth = 0): void {
  if (depth > 9 || live === null || pristine === null || typeof live !== "object" || typeof pristine !== "object") return;
  // Keys the build ADDED have to go, not just keys it changed: `last_accessed_turn` is written onto
  // memories that never carried one, and a restore that only rewrites existing keys leaves those
  // behind — which is a save quietly edited by the act of measuring it.
  if (Array.isArray(live) && Array.isArray(pristine) && live.length > pristine.length) live.length = pristine.length;
  else if (!Array.isArray(live)) for (const k of Object.keys(live)) if (!(k in pristine)) delete (live as any)[k];
  for (const k of Object.keys(pristine)) {
    const pv = (pristine as any)[k];
    if (pv !== null && typeof pv === "object") restoreInPlace((live as any)[k], pv, depth + 1);
    else if ((live as any)[k] !== pv) (live as any)[k] = pv;
  }
}

/** Which paths do the builders write while building? Reported, and pinned during the audit. */
function findImpurity(state: SaveState, queries: string[]): string[] {
  const before = JSON.parse(JSON.stringify(state));
  corpus(state, queries);
  const paths: string[] = [];
  const walk = (a: any, b: any, p: string, d = 0): void => {
    if (d > 9 || paths.length > 40 || a === b) return;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") { if (a !== b) paths.push(p); return; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p ? `${p}.${k}` : k, d + 1);
  };
  walk(before, state, "");
  restoreInPlace(state, before);
  return [...new Set(paths.map(groupOf))];
}

type Leaf = { path: string; parent: any; key: string | number; kind: "string" | "number" | "boolean" };

function leaves(node: any, path: string, out: Leaf[], depth = 0): void {
  if (depth > 8 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const p = `${path}.${i}`;
      if (skipPath(p)) continue;
      const v = node[i];
      if (v !== null && typeof v === "object") leaves(v, p, out, depth + 1);
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push({ path: p, parent: node, key: i, kind: typeof v as any });
    }
    return;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      const p = path ? `${path}.${k}` : k;
      if (skipPath(p)) continue;
      const v = node[k];
      if (v !== null && typeof v === "object") leaves(v, p, out, depth + 1);
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push({ path: p, parent: node, key: k, kind: typeof v as any });
    }
  }
}

/** Collapse "characters.char_msk82wsspvxy5.voice.tics.0" to "characters.*.voice.tics.*" so the
 *  report says what KIND of thing is dark rather than listing it once per character. */
function groupOf(path: string): string {
  return path
    .split(".")
    .map((seg) => (/^\d+$/.test(seg) || /^(char_|loc_|thr_|itm_|inj_|rum_|trait_|clk_|cns_|prm_)/.test(seg) ? "*" : seg))
    .join(".");
}

/** The subsystem a path belongs to. Deliberately coarse: this answers "is the rumour engine wired
 *  in", not "which byte of it". */
function subsystemOf(path: string): string {
  const p = path.split(".");
  if (p[0] === "memory") return `memory.${p[2] ?? "?"}`;          // episodic / beliefs / facts / core / knows
  if (p[0] === "world") return `world.${p[1] ?? "?"}`;            // rumors / edges / threads / places / clocks…
  if (p[0] === "characters") return `characters.${p[2] ?? "?"}`;  // per-field on the identity card
  if (p[0] === "condition") return `condition.${p[2] ?? "?"}`;
  if (p[0] === "traits") return "traits";
  if (p[0] === "minds") return "minds";
  return p[0] || "(root)";
}

export function coverageAudit(state: SaveState): CoverageReport {
  // A few plausible turn cues, so relevance ranking cannot hide a reachable field behind one query.
  const lastAction = String((state.history ?? []).at(-1)?.player_action ?? "").slice(0, 120);
  const queries = ["", lastAction, Object.values(state.characters).map((c) => c.name).join(" ")];

  const impurePaths = findImpurity(state, queries);
  // the pristine copy every build is rolled back to, so the baseline never drifts
  const pristine = JSON.parse(JSON.stringify(state));
  const build = (): Record<string, string> => {
    const out = corpus(state, queries);
    restoreInPlace(state, pristine);
    return out;
  };

  const base = build();
  const names = Object.keys(base);
  const found: Leaf[] = [];
  leaves(state, "", found);

  const fields: FieldCoverage[] = [];
  for (const leaf of found) {
    const original = leaf.parent[leaf.key];
    // Keep the type — a number field handed a string can throw three systems away, and a crash
    // would be scored as "reached" for every field that caused one.
    leaf.parent[leaf.key] =
      leaf.kind === "string" ? SENTINEL_STR
      : leaf.kind === "number" ? SENTINEL_NUM
      : !original;
    const after = build();
    leaf.parent[leaf.key] = original;
    const reached = names.filter((n) => after[n] !== base[n]);
    fields.push({ path: leaf.path, kind: leaf.kind, reached });
  }

  const reachedCount = fields.filter((f) => f.reached.length).length;
  const byPrompt: Record<string, number> = {};
  for (const n of names) byPrompt[n] = fields.filter((f) => f.reached.includes(n)).length;

  const sub = new Map<string, { reached: number; total: number }>();
  for (const f of fields) {
    const k = subsystemOf(f.path);
    const row = sub.get(k) ?? { reached: 0, total: 0 };
    row.total++;
    if (f.reached.length) row.reached++;
    sub.set(k, row);
  }

  const dark = new Map<string, { count: number; example: string }>();
  for (const f of fields) {
    if (f.reached.length) continue;
    const g = groupOf(f.path);
    const hit = dark.get(g);
    if (hit) hit.count++;
    else dark.set(g, { count: 1, example: f.path });
  }

  return {
    fields,
    reachedCount,
    totalCount: fields.length,
    pct: fields.length ? Math.round((100 * reachedCount) / fields.length) : 0,
    darkGroups: [...dark.entries()].map(([group, v]) => ({ group, ...v })).sort((a, b) => b.count - a.count),
    byPrompt,
    impurePaths,
    bySubsystem: [...sub.entries()]
      .map(([name, v]) => ({ name, ...v, pct: Math.round((100 * v.reached) / Math.max(1, v.total)) }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * 2. EMERGENCE COUNTERS
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

const STOP = new Set(("the a an and or but of to in on at for with from by is was were are be been am it its his her their your our " +
  "he she they them you i me my we this that these those as if then than so not no nor had has have will would could should did do does " +
  "made make said say says one two into out up down over under about after before while when where what who which there here now just " +
  "like back through very much more most some any each other another still even only own same too can just").split(" "));

function tokens(t: string): Set<string> {
  return new Set((String(t ?? "").toLowerCase().match(/[a-z][a-z']{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/** Tokens rare enough across the whole transcript to be evidence of a specific thing rather than of
 *  English. Without this, "she looked at him" matches every scene in the save. */
function rareTokens(text: string, df: Map<string, number>, turns: number, maxDocFreq = 0.05): Set<string> {
  const out = new Set<string>();
  for (const w of tokens(text)) if ((df.get(w) ?? 0) <= Math.max(1, maxDocFreq * turns)) out.add(w);
  return out;
}

export interface EmergenceReport {
  turns: number;
  offstage: { events: number; surfaced: number; pct: number; nullRate: number; examples: { from: number; to: number; actor: string; via: string[] }[] };
  rumor: { total: number; witnessedOnly: number; withToldHop: number; hops: Record<number, number>; secondHandActed: number };
  drives: { newWants: number; perTurn: number; survived3: number; longestRun: number; byChar: Record<string, number> };
  /** Wants the PLAYER wrote by hand, disclosed so the rest of these numbers stay readable. The
   *  offstage and rumour counts above make no attempt to subtract them, and shouldn't: what the
   *  world does with an authored want — which evening, who was there, what it cost — is emergent
   *  even though the want is not. But a save with six authored wants and a save with none are not
   *  measuring the same thing, and the report should say which one you are looking at. */
  authored: { live: number; crystallized: number; atTop: number };
  edges: { total: number; moved: number; neverMoved: number; signFlips: number };
  traits: { written: number; everRendered: number; renderedCap: number };
}

const MATCH_TOKENS = 3;

export function emergenceReport(state: SaveState): EmergenceReport {
  const turns = state.world.current_turn;
  const hist = state.history ?? [];
  const prose = new Map<number, string>();
  for (const h of hist) prose.set(h.turn, String((h as any).narrator_prose ?? ""));

  // document frequency over the transcript — what counts as a distinctive word in THIS story
  const df = new Map<string, number>();
  for (const p of prose.values()) for (const w of tokens(p)) df.set(w, (df.get(w) ?? 0) + 1);
  const nTurns = Math.max(1, prose.size);

  /* ── offstage → onstage ──────────────────────────────────────────────────────────────────── */
  const log = ((state.world as any).offstage_log ?? []) as { turn: number; what: string; actor?: string }[];
  const sortedTurns = [...prose.keys()].sort((a, b) => a - b);
  const surfaceHits: { from: number; to: number; actor: string; via: string[] }[] = [];
  let matchable = 0;
  for (const ev of log) {
    const key = rareTokens(ev.what, df, nTurns);
    if (key.size < MATCH_TOKENS) continue;
    matchable++;
    for (const t of sortedTurns) {
      if (t <= ev.turn) continue;
      const hit = [...key].filter((w) => tokens(prose.get(t) ?? "").has(w));
      if (hit.length >= MATCH_TOKENS) { surfaceHits.push({ from: ev.turn, to: t, actor: ev.actor ?? "?", via: hit.slice(0, 5) }); break; }
      }
  }
  // NULL MODEL. The same test run BACKWARDS: does an offstage event match prose that came BEFORE it?
  // It cannot have caused those turns, so whatever rate this produces is the rate coincidence alone
  // gives you. A forward rate that does not clear it is not evidence of anything.
  let nullHits = 0;
  for (const ev of log) {
    const key = rareTokens(ev.what, df, nTurns);
    if (key.size < MATCH_TOKENS) continue;
    for (const t of sortedTurns) {
      if (t >= ev.turn) break;
      const hit = [...key].filter((w) => tokens(prose.get(t) ?? "").has(w));
      if (hit.length >= MATCH_TOKENS) { nullHits++; break; }
    }
  }

  /* ── rumour diffusion ────────────────────────────────────────────────────────────────────── */
  const rumors = (state.world.rumors ?? []) as any[];
  const hops: Record<number, number> = {};
  let withTold = 0, witnessedOnly = 0, secondHandActed = 0;
  for (const r of rumors) {
    const path = (r.path ?? []) as { to: string; from: string | null; turn: number; how: string }[];
    const told = path.filter((p) => p.how === "told");
    hops[told.length] = (hops[told.length] ?? 0) + 1;
    if (told.length) withTold++; else witnessedOnly++;
    // did anyone who learned it SECOND HAND then appear on the page alongside its content?
    const key = rareTokens(String(r.content ?? ""), df, nTurns);
    if (key.size < MATCH_TOKENS) continue;
    for (const p of told) {
      const name = state.characters[p.to]?.name;
      if (!name) continue;
      const acted = sortedTurns.some((t) => {
        if (t <= p.turn) return false;
        const body = prose.get(t) ?? "";
        return body.includes(name) && [...key].filter((w) => tokens(body).has(w)).length >= MATCH_TOKENS;
      });
      if (acted) { secondHandActed++; break; }
    }
  }

  /* ── drives ──────────────────────────────────────────────────────────────────────────────── */
  const byChar: Record<string, number> = {};
  const wantTurns: Record<string, number[]> = {};
  for (const h of hist) {
    for (const sh of ((h as any).shifts ?? []) as string[]) {
      const m = /^(.+?) wants something new/.exec(sh);
      if (!m) continue;
      const who = m[1];
      byChar[who] = (byChar[who] ?? 0) + 1;
      (wantTurns[who] ??= []).push(h.turn);
    }
  }
  let survived3 = 0, longestRun = 0;
  for (const list of Object.values(wantTurns)) {
    const sorted = [...list].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const span = (sorted[i + 1] ?? turns) - sorted[i];
      if (span >= 3) survived3++;
      if (span > longestRun) longestRun = span;
    }
  }
  const newWants = Object.values(byChar).reduce((a, b) => a + b, 0);

  /* ── edges ───────────────────────────────────────────────────────────────────────────────── */
  const snaps = (state.telemetry ?? []).map((t) => (t as any).edge_snapshot as { pair: string; warmth: number; trust: number }[] | undefined).filter(Boolean) as { pair: string; warmth: number; trust: number }[][];
  const series = new Map<string, number[]>();
  for (const snap of snaps) for (const row of snap) (series.get(row.pair) ?? series.set(row.pair, []).get(row.pair)!).push(row.warmth);
  let moved = 0, neverMoved = 0, signFlips = 0;
  for (const vals of series.values()) {
    const span = Math.max(...vals) - Math.min(...vals);
    if (span >= 15) moved++;
    if (span < 1) neverMoved++;
    for (let i = 1; i < vals.length; i++) if (Math.sign(vals[i]) !== Math.sign(vals[i - 1]) && Math.abs(vals[i] - vals[i - 1]) > 2) signFlips++;
  }

  /* ── traits written vs traits the narrator can ever see (prompts render the first four) ──── */
  const RENDER_CAP = 4;
  let written = 0, everRendered = 0;
  for (const list of Object.values(state.traits ?? {})) {
    written += list.length;
    everRendered += Math.min(RENDER_CAP, list.length);
  }

  return {
    turns,
    offstage: {
      events: log.length,
      surfaced: surfaceHits.length,
      pct: matchable ? Math.round((100 * surfaceHits.length) / matchable) : 0,
      nullRate: matchable ? Math.round((100 * nullHits) / matchable) : 0,
      examples: surfaceHits.slice(0, 6),
    },
    rumor: { total: rumors.length, witnessedOnly, withToldHop: withTold, hops, secondHandActed },
    drives: {
      newWants,
      perTurn: newWants ? +(turns / newWants).toFixed(2) : 0,
      survived3,
      longestRun,
      byChar,
    },
    edges: { total: series.size, moved, neverMoved, signFlips },
    traits: { written, everRendered, renderedCap: RENDER_CAP },
    authored: (() => {
      const all = Object.entries(state.characters ?? {})
        .filter(([id, c]) => id !== "char_player" && (c as any).authored?.goal)
        .map(([, c]) => (c as any).authored as { stage?: number; crystallized_turn?: number });
      return {
        live: all.filter((a) => !a.crystallized_turn).length,
        crystallized: all.filter((a) => a.crystallized_turn).length,
        atTop: all.filter((a) => !a.crystallized_turn && (a.stage ?? 0) >= MAX_STAGE).length,
      };
    })(),
  };
}
