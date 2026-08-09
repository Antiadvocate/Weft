/**
 * FACTS — the fidelity layer. Two jobs, both deterministic and zero-token:
 *
 * 1. DURABLE FACT LEDGER. Human memory splits episodic ("she told me over dinner")
 *    from semantic ("she is from Seattle"). The engine previously stored only
 *    episodics + reflected beliefs — both of which pass through a small model's
 *    paraphrase, where proper nouns silently mutate (Seattle → Portland), and both
 *    of which decay/evict. Durable personal facts now live in their own ledger:
 *    verbatim-anchored, never decayed, never rewritten, surfaced by relevance.
 *
 * 2. QUOTE-GROUNDED VERIFICATION. Anything the Simulator writes into memory is
 *    checked against the turn's actual source text (player action + narrator prose).
 *    A proper noun that appears in the stored memory but in neither the source nor
 *    the world's known-name whitelist was CONFABULATED by the bookkeeper. We repair
 *    it by swapping in the best-matching verbatim source sentence, or flag it.
 *    (This is the attribution-verification idea from grounded-generation research —
 *    RARR-style "does the source actually say this" — done as a substring check
 *    instead of a model call, because here we HOLD the source.)
 */
import type { SaveState, CharMemory, DurableFact, Belief } from "./types";
import { relevance, compactGist } from "./memory";

/** Words that start sentences / are commonly capitalized without being names. */
const CAP_STOP = new Set([
  "The","A","An","I","He","She","They","We","You","It","His","Her","Their","My","Your","Our",
  "And","But","Or","So","Then","When","While","After","Before","If","As","At","In","On","Of","To",
  "There","This","That","These","Those","What","Who","Where","Why","How","Not","No","Yes","Now",
  "Day","Night","Morning","Evening","Afternoon","Dawn","Dusk","God","Sir","Ma'am","Madam","Lord","Lady",
  "Mr","Mrs","Ms","Dr","Everyone","Someone","Nothing","Something","Everything","Once","Later","Earlier",
  "Left","Went","Achieved","Perspective",
]);

/** Extract candidate proper nouns: capitalized tokens (and joined runs like "New Harbor"). */
export function properNouns(s: string): string[] {
  const out = new Set<string>();
  // runs of Capitalized words are one name ("Puget Sound"); singles too
  const re = /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const run = m[1];
    // sentence-initial SINGLE capitalized words are usually just sentence case, not names —
    // skip them when they read like ordinary words (verb/adverb shapes). Mid-sentence
    // occurrences still catch real names; a missed sentence-initial name only weakens
    // detection, while a false positive would trigger a benign verbatim-swap.
    const atSentenceStart = m.index === 0 || /[.!?"\n]\s*$/.test(s.slice(Math.max(0, m.index - 3), m.index));
    const words = run.split(/\s+/).filter((w) => !CAP_STOP.has(w.replace(/[’']s$/, "")));
    if (!words.length) continue;
    if (atSentenceStart && words.length === 1 && /(ed|ing|ly)$/.test(words[0])) continue;
    out.add(words.join(" "));
    for (const w of words) if (w.length > 2) out.add(w);
  }
  return [...out];
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

/** Every name the world legitimately knows: characters, places, bible, canon, factions. */
export function knownNameWhitelist(state: SaveState): Set<string> {
  const wl = new Set<string>();
  const add = (s?: string) => { if (s) for (const n of properNouns(s)) wl.add(norm(n)); };
  for (const c of Object.values(state.characters)) { add(c.name); add(c.background); add(c.appearance_facts); }
  for (const p of Object.values(state.world.places)) add(p.name);
  const b = state.world_bible;
  add(b.name); add(b.era); add(b.cultures_and_languages); add(b.political_situation);
  add(b.climate_and_geography); add(b.calendar_and_currency); add(b.magic_rules);
  for (const cn of state.world.canon) add(cn);
  for (const k of state.world.clocks) { add(k.faction); add(k.objective); }
  for (const t of state.world.threads) { add(t.title); add(t.description); }
  return wl;
}

/** Which proper nouns in `content` appear in neither the source text nor the whitelist? */
export function suspectNouns(content: string, sourceText: string, whitelist: Set<string>): string[] {
  const src = norm(sourceText);
  return properNouns(content).filter((n) => {
    const nn = norm(n);
    return !src.includes(nn) && !whitelist.has(nn);
  });
}

/** Best verbatim source sentence for a claim (highest token-overlap), or null. */
export function bestSourceSentence(claim: string, sourceText: string, minRel = 0.22): string | null {
  const sents = sourceText.match(/[^.!?\n]+[.!?]?/g) ?? [];
  let best: string | null = null, bestS = minRel;
  for (const s of sents) {
    const t = s.trim();
    if (t.length < 12) continue;
    const r = relevance(t, claim);
    if (r > bestS) { bestS = r; best = t; }
  }
  return best;
}

/**
 * Ground a Simulator-written memory against the turn's source text.
 * If it contains confabulated proper nouns, replace it with the best verbatim
 * source sentence (truth by construction). If no source sentence matches, keep
 * the text but report the suspects so the caller can log it.
 */
export function groundMemoryContent(
  content: string, anchor: string | undefined, sourceText: string, whitelist: Set<string>,
): { content: string; repaired: boolean; suspects: string[] } {
  // an anchor that genuinely appears in the source is the strongest evidence — prefer content as-is
  const anchored = !!anchor && norm(sourceText).includes(norm(anchor.trim()));
  const suspects = suspectNouns(content, sourceText + (anchored ? " " + anchor : ""), whitelist);
  if (!suspects.length) return { content, repaired: false, suspects: [] };
  const verbatim = bestSourceSentence(content, sourceText) ?? (anchored ? anchor! : null);
  if (verbatim) return { content: compactGist(verbatim.trim(), 170), repaired: true, suspects };
  return { content, repaired: false, suspects };
}

/** Fold a verified durable fact into a character's ledger (dedupe by overlap; capped; never decays). */
/** LEDGER QUALITY GATE — a fact must stand alone, cold, to a stranger reading the ledger.
 *  "She's good at that" is not a fact; it is a pronoun pointing at a vanished moment. Rejects:
 *  bare-pronoun subjects, quoted dialogue lines, sub-6-word fragments, and transient states.
 *  Deterministic on purpose — the gate itself must never hallucinate. */
export function factGate(content: string): { ok: boolean; why?: string } {
  const f = content.trim();
  const first = (f.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z']/g, "");
  if (["she", "he", "they", "it", "her", "his", "their", "she's", "he's", "they're", "it's"].includes(first))
    return { ok: false, why: "bare-pronoun subject — no one can tell who this is about" };
  if (f.split(/\s+/).length < 6) return { ok: false, why: "fragment — too short to mean anything cold" };
  if (/"/.test(f) || /^['"“]/.test(f)) return { ok: false, why: "quoted dialogue — paraphrase the claim; quotes belong in the anchor" };
  if (/\b(currently|right now|at this moment|for now|is making (her|his|their) way)\b/i.test(f))
    return { ok: false, why: "transient state — true today, gone tomorrow; that's a memory" };
  return { ok: true };
}

/** Fuzzy near-duplicate merge: high content-word overlap keeps ONE entry — the more detailed. */
function contentWords(x: string): Set<string> {
  const stop = new Set(["the","a","an","and","or","of","in","on","to","is","are","was","were","has","have","had","that","this","with","for","at","by","from","her","his","their","she","he","they","it","i","my","me","who","about","as","be"]);
  return new Set(x.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
}
export function factOverlap(a: string, b: string): number {
  const A = contentWords(a), B = contentWords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * Mark whatever the character previously believed about `subject` as overturned by `replacement`.
 *
 * Word-overlap merging can't do this job: it collapses near-identical restatements, but a
 * CORRECTION is topically similar and semantically opposite — "my father intends to send a
 * champion" and "Domnall is dead; my father did not send him" overlap 0.43, well under the merge
 * bar, so both sat in the ledger as current knowledge and the narrator could reach for either.
 * Only the simulator knows which one replaces which, because only it saw the scene where the
 * correction landed. So it names the superseded belief and this resolves it against the store.
 *
 * The old fact is kept. Under a reconstructive memory model, being wrong is part of the record.
 */
export function supersedeFact(mem: CharMemory, subject: string, replacement: string, turn: number): string | null {
  const s = subject.trim();
  if (!s) return null;
  const live = (mem.facts ?? []).filter((f) => !f.superseded_by);
  let best: { f: typeof live[number]; score: number } | null = null;
  for (const f of live) {
    if (f.content === replacement) continue;                   // never supersede the new fact itself
    const score = Math.max(relevance(f.content, s), factOverlap(f.content, s));
    if (score >= 0.34 && (!best || score > best.score)) best = { f, score };
  }
  if (!best) return null;
  best.f.superseded_by = replacement;
  best.f.superseded_turn = turn;
  return best.f.content;
}

export function addFact(mem: CharMemory, fact: string, turn: number, quote?: string, source?: import("./types").MemorySource): boolean {
  mem.facts ??= [];
  const f = fact.trim();
  if (!f) return false;
  const gate = factGate(f);
  if (!gate.ok) { console.warn(`[facts] rejected: "${f.slice(0, 60)}" — ${gate.why}`); return false; }
  // fuzzy near-duplicate: keep ONE entry, the more detailed version (Nadi's network once, not four times)
  const near = mem.facts.find((x) => !x.superseded_by && (relevance(x.content, f) >= 0.6 || factOverlap(x.content, f) >= 0.6));
  if (near) {
    if (f.length > near.content.length + 12) near.content = compactGist(f, 140); // upgrade in place
    near.turn = turn; if (quote && !near.quote) near.quote = quote;
    return false;
  }
  mem.facts.push({ content: compactGist(f, 140), turn, quote: quote?.slice(0, 160), source });
  if (mem.facts.length > 30) {
    // evict the oldest low-signal fact (never the newest); facts are cheap, so this is rare
    mem.facts.sort((a, b) => a.turn - b.turn);
    mem.facts.shift();
  }
  return true;
}

/** Reflection guard: drop beliefs whose proper nouns appear in neither the episodic
 *  source text nor the whitelist — the cheap model invented a specific. */
export function filterSuspectBeliefs<T extends Pick<Belief, "content">>(
  beliefs: T[], sourceText: string, whitelist: Set<string>,
): { kept: T[]; dropped: string[] } {
  const kept: T[] = [], dropped: string[] = [];
  for (const b of beliefs) {
    if (suspectNouns(b.content, sourceText, whitelist).length) dropped.push(b.content);
    else kept.push(b);
  }
  return { kept, dropped };
}

// ─────────────────────────── LAW ENGAGEMENT ───────────────────────────
// The bible's forbidden list, magic rules, and canon are WORLD LAW. The narrator sees them every
// turn and still drifts when a scene's emotional momentum pulls the other way — the Velora failure:
// an hour-long foot massage written tender while the biology law said pain at ten minutes, and when
// the player invoked the law the model invented an exception ("maybe because you're not Wym"). This
// pass detects the contact deterministically so the narrator gets the matched law quoted as binding
// truth at the moment it matters, instead of relying on the model to recall a list mid-tenderness.

const LAW_STOP = new Set(["should", "would", "could", "about", "there", "their", "which", "being", "without", "because", "really", "think", "know", "just", "that", "this", "with", "from", "have", "what", "when", "your", "youre"]);

function lawWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']{6,}/g) ?? []).filter((w) => !LAW_STOP.has(w));
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** All the world's stated law: forbidden entries (semicolon-split), magic rules, canon lines. */
export function lawEntries(state: SaveState): string[] {
  const out: string[] = [];
  const forbidden = state.world_bible?.forbidden?.trim() ?? "";
  for (const piece of forbidden.split(/[;.]+/).map((s) => s.trim()).filter((s) => s.length >= 12)) out.push(piece);
  const magic = state.world_bible?.magic_rules?.trim() ?? "";
  if (magic.length >= 12 && !/^none\b/i.test(magic)) out.push(magic);
  for (const c of state.world?.canon ?? []) if (c.trim().length >= 12) out.push(c.trim());
  return out;
}

/**
 * The law the player's action touches this turn, if any. Three deterministic signals, any one fires:
 *   - token relevance >= 0.3 (exact shared content words)
 *   - one strong word (6+ letters) sharing a 7+ letter prefix with a law word ("massaging"/"massages")
 *   - two strong words sharing a 6+ letter prefix with law words
 * Returns the single best-matching law entry, or undefined. Cheap: a few dozen words per side.
 */
export function engagedLaw(state: SaveState, action: string): string | undefined {
  const entries = lawEntries(state);
  if (!entries.length || !action.trim()) return undefined;
  const aStrong = lawWords(action);
  let best: { entry: string; score: number } | undefined;
  for (const entry of entries) {
    const rel = relevance(action, entry);
    const eStrong = lawWords(entry);
    let seven = 0, six = 0;
    for (const w of aStrong) {
      let p = 0;
      for (const e of eStrong) p = Math.max(p, commonPrefix(w, e));
      if (p >= 7) seven++;
      else if (p >= 6) six++;
    }
    const engaged = rel >= 0.3 || seven >= 1 || six >= 2;
    if (!engaged) continue;
    const score = rel + seven * 0.4 + six * 0.15;
    if (!best || score > best.score) best = { entry, score };
  }
  return best?.entry;
}
