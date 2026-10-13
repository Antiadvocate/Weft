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
import { turnRead } from "./actionread";
import { collapseSpaces, isSpace, isWordChar } from "./text";

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
    const atSentenceStart = m.index === 0 || afterSentenceEnd(s.slice(Math.max(0, m.index - 3), m.index));
    const words = collapseSpaces(run).split(" ").filter((w) => !CAP_STOP.has(withoutPossessive(w)));
    if (!words.length) continue;
    if (atSentenceStart && words.length === 1 && ["ed", "ing", "ly"].some((end) => words[0].endsWith(end))) continue;
    out.add(words.join(" "));
    for (const w of words) if (w.length > 2) out.add(w);
  }
  return [...out];
}

/** Whether a sentence could have just ended: a stop, a closing quote or a line break, then only space. */
function afterSentenceEnd(head: string): boolean {
  let i = head.length;
  while (i > 0 && isSpace(head[i - 1])) {
    if (head[i - 1] === "\n") return true;
    i--;
  }
  return i > 0 && '.!?"'.includes(head[i - 1]);
}

/** "Seattle's" is "Seattle". */
function withoutPossessive(w: string): string {
  return w.endsWith("'s") || w.endsWith("’s") ? w.slice(0, -2) : w;
}

const norm = (s: string) => s.toLowerCase().replaceAll("’", "'");

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

/** Runs of text between stops and line breaks, each with the one stop that ends it. */
function sourceSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n" || ".!?".includes(ch)) {
      if (buf) { out.push(ch === "\n" ? buf : buf + ch); buf = ""; }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** Best verbatim source sentence for a claim (highest token-overlap), or null. */
export function bestSourceSentence(claim: string, sourceText: string, minRel = 0.22): string | null {
  const sents = sourceSentences(sourceText);
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
  const tokens = f ? collapseSpaces(f).split(" ") : [""];
  const first = [...(tokens[0] ?? "").toLowerCase()].filter((ch) => (ch >= "a" && ch <= "z") || ch === "'").join("");
  if (["she", "he", "they", "it", "her", "his", "their", "she's", "he's", "they're", "it's"].includes(first))
    return { ok: false, why: "the subject is a bare pronoun, so nobody can tell who this is about" };
  if (tokens.length < 6) return { ok: false, why: "a fragment that's too short to mean anything on its own" };
  if (f.includes('"') || f.startsWith("'") || f.startsWith("“")) return { ok: false, why: "quoted dialogue, so state the claim in your own words instead, and keep quotes for the anchor" };
  if (/\b(currently|right now|at this moment|for now|is making (her|his|their) way)\b/i.test(f))
    return { ok: false, why: "a passing state that's true today and gone tomorrow, which makes it a memory, not a fact" };
  return { ok: true };
}

/** Fuzzy near-duplicate merge: high content-word overlap keeps ONE entry — the more detailed. */
function contentWords(x: string): Set<string> {
  const stop = new Set(["the","a","an","and","or","of","in","on","to","is","are","was","were","has","have","had","that","this","with","for","at","by","from","her","his","their","she","he","they","it","i","my","me","who","about","as","be"]);
  const kept = [...x.toLowerCase()].map((ch) => ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "'" ? ch : " ")).join("");
  return new Set(kept.split(" ").filter((w) => w.length > 2 && !stop.has(w)));
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
// pass names the contact so the narrator gets the matched law quoted as binding truth at the moment
// it matters, instead of relying on the model to recall a list mid-tenderness.
//
// Which law the player's act runs into used to be found by shared words and shared word stems
// between the action and each law, and that kept missing phrasings: a law about "touch" and an act
// of "rubbing her feet" share nothing a stem can find. The turn's read (engine/actionread.ts) is
// shown the world's laws and says which one the act engages, copied from that list.

/** All the world's stated law: forbidden entries (split at each stop or semicolon), magic rules, canon lines. */
export function lawEntries(state: SaveState): string[] {
  const out: string[] = [];
  const forbidden = state.world_bible?.forbidden?.trim() ?? "";
  for (const piece of forbidden.replaceAll(";", ".").split(".").map((s) => s.trim()).filter((s) => s.length >= 12)) out.push(piece);
  const magic = state.world_bible?.magic_rules?.trim() ?? "";
  if (magic.length >= 12 && !saysNone(magic)) out.push(magic);
  for (const c of state.world?.canon ?? []) if (c.trim().length >= 12) out.push(c.trim());
  return out;
}

/** "None", "none.", "None — the world is mundane": a rule that there are no rules. */
function saysNone(text: string): boolean {
  return text.toLowerCase().startsWith("none") && !isWordChar(text[4] ?? "");
}

/** A law as compared: spacing collapsed, case and the clipping mark and closing stop dropped. */
function lawKey(text: string): string {
  let t = collapseSpaces(text).toLowerCase();
  while (t.endsWith("…") || t.endsWith(".")) t = t.slice(0, -1).trimEnd();
  return t;
}

/**
 * The law the player's action touches this turn, if any, as the world states it. The read copies it
 * from the list it was shown; this finds that entry here (the read's copy may be clipped), and when
 * the read named a law this list doesn't hold (a custom it was shown, say) that law as the read gave
 * it. The typed line isn't read here; the turn's read is, and `action` stays only for the call site.
 */
export function engagedLaw(state: SaveState, _action?: string): string | undefined {
  const named = collapseSpaces(turnRead(state).engages_law);
  if (!named) return undefined;
  const key = lawKey(named);
  if (!key) return undefined;
  const entries = lawEntries(state);
  return entries.find((e) => lawKey(e) === key)
    ?? (key.length >= 12 ? entries.find((e) => lawKey(e).includes(key)) : undefined)
    ?? named;
}
