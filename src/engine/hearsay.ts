/**
 * HEARSAY — what hearing about somebody does to what you think of them.
 *
 * The rumour field (social.ts, diffuseRumors) has been a careful ledger of WHO KNOWS: co-presence
 * groups, a remote channel along real bonds, travel-time gating, provenance for every hop. And it
 * stopped there. A woman who heard from her brother that the player burned the mill held exactly the
 * opinion of the player she had before she heard it. The only way the news could change anyone was
 * the narrator happening to pick it up from a three-line "has heard" hint, in a scene, and the
 * bookkeeper happening to file a delta for it. Offstage — which is where almost all hearing happens —
 * nothing moved at all. The whole subsystem decided who knew things and then let knowing do nothing.
 *
 * Social simulators that sell "opinion dynamics" usually do this with an LLM per agent per round and
 * a sheet of stance / influence / echo-chamber knobs; the one this was taken from generates those
 * knobs and then never reads them. This file does the part that actually matters, in the engine's
 * own idiom: deterministic, lexical, zero tokens, bounded.
 *
 *   1. WHO IT IS ABOUT. `about_char` when the writer set it; otherwise the cast member named nearest
 *      before the act in the sentence. Witness rumours are first-person memories ("I watched Rabi
 *      burn the mill"), so "I" is the witness and a name is the actor.
 *   2. WHAT IT SAYS ABOUT THEM AS SOMEONE WHO DID A THING. Not the rumour's weather — rumorCharge
 *      reads dread vs warmth for how fast it travels, and "Mara is sick" is dread news that says
 *      nothing bad about Mara. Here only acts count, and a passive ("was robbed", "got beaten") is
 *      something that happened TO the subject, so it is stripped before matching.
 *   3. WHO TOLD YOU. Credence comes from the hearer's trust in the teller: a stranger's story lands
 *      at half weight, a trusted friend's at nearly full, someone you distrust barely at all.
 *   4. WHAT YOU ALREADY THOUGHT. News that agrees with your opinion lands whole. News against a
 *      strong opinion is damped by how strong it is and by how settled your picture of them is (the
 *      mind layer's confidence) — confirmation bias, the actual mechanism behind an echo chamber.
 *
 * The move is small — a few points of warmth and trust per rumour per hearer, under the same clamps
 * and loss/gain damping every other edge delta obeys — so a reputation built in scenes is shaded by
 * talk, not overwritten by it. Several people telling the same story is how talk overwrites a
 * reputation, and that is correct.
 */
import type { SaveState, SocialEdge, Rumor } from "./types";

/** Points of warmth a fully credible, maximally salient rumour moves a neutral hearer. */
export const HEARSAY_STEP = 5;

// Acts a person can be the doer of. Kept to verbs with a clear agent: "he killed" is an act, "the
// fever killed" has no person in it, and that difference is carried by the subject resolution below,
// not by the list.
const HARM_ACT = /\b(betray\w*|stole|steals|stealing|robbed|robs|swindl\w+|cheat(?:ed|s|ing)|lied to|lies to|lying to|murder(?:ed|s|ing)|killed|kills|slaughter\w*|massacre\w*|tortur\w+|poison(?:ed|s|ing)|beat (?:him|her|them|his|her|their|a|an|the)\b|hit (?:him|her|them|a|the)\b|attack(?:ed|s|ing)|burn(?:ed|t|s) (?:down|the|a|an|their|his|her)\b|threaten\w*|abandon(?:ed|s|ing)|enslav\w+|informed on|sold (?:out|him|her|them)\b|broke (?:his|her|their) (?:word|promise)|hurt (?:him|her|them|a|the)\b|struck (?:him|her|them|a|the)\b|bullied|bullies|humiliat\w+)/i;
const BOON_ACT = /\b(saved|saves|rescu(?:ed|es|ing)|protect(?:ed|s|ing)|defend(?:ed|s|ing)|shield(?:ed|s)|helped|helps|heal(?:ed|s)|cured|fed (?:the|them|him|her|a|an|everyone)\b|shelter(?:ed|s)|spared|forgave|forgives|freed|frees|kept (?:his|her|their) (?:word|promise)|paid (?:back|off|for)\b|gave (?:away|them|him|her|the|a|an)\b|stood (?:up for|between)|carried (?:him|her|them|a|the)\b)/i;

// Something done TO someone: "was robbed", "got beaten", "has been betrayed". Stripped before the
// active lists run, so the victim of an act is never read as its doer. The doer, when the sentence
// names one ("was saved by Rabi"), is captured as group 2 — an act written backwards still counts.
const HARM_PASSIVE = "betrayed|robbed|swindled|cheated|lied to|murdered|killed|slaughtered|massacred|tortured|poisoned|beaten|hit|attacked|burned|burnt|threatened|abandoned|enslaved|informed on|sold out|hurt|struck|bullied|humiliated";
const BOON_PASSIVE = "saved|rescued|protected|defended|shielded|helped|healed|cured|fed|sheltered|spared|forgiven|freed|paid|carried";
const PASSIVE = new RegExp(`\\b(?:was|were|is|are|been|being|got|gets|getting)\\s+(?:\\w+ly\\s+)?(${HARM_PASSIVE}|${BOON_PASSIVE})\\b(?:\\s+by\\s+([\\w'’-]+(?:\\s+[\\w'’-]+)?))?`, "gi");
const HARM_PASSIVE_RE = new RegExp(`^(?:${HARM_PASSIVE})$`, "i");

// WHAT A WITNESS SAW. Witness rumours are first-person memories, and the commonest shape is a verb
// of seeing with the doer between it and a bare verb: "I watched Rabi burn down the mill", "I saw
// Mara steal the purse". The past-tense lists above never match a bare verb, and a bare verb anywhere
// else is a plan or a threat ("he'll kill him"), not an act — so bare verbs count only in this frame.
const HARM_BASE = "betray|steal|rob|swindle|cheat|lie to|murder|kill|slaughter|massacre|torture|poison|beat|hit|attack|burn|threaten|abandon|enslave|inform on|sell out|hurt|strike|bully|humiliate";
const BOON_BASE = "save|rescue|protect|defend|shield|help|heal|cure|feed|shelter|spare|forgive|free|pay back|carry|give away|stand up for|stand between";
const SEEN = new RegExp(`\\b(?:[Ss]aw|[Ww]atched|[Ss]een|[Cc]aught|[Hh]eard|[Nn]oticed)\\s+((?:[A-Z][\\w'’-]*\\s+){1,3})(${HARM_BASE}|${BOON_BASE})\\b`, "g");
const HARM_BASE_RE = new RegExp(`^(?:${HARM_BASE})$`, "i");

interface Act { index: number; harm: boolean; doer?: string; form: "seen" | "active" | "passive" }

/** Every act in the sentence, in the three shapes above. A doer is the name text when the shape
 *  carries one (seen, passive-with-by); active acts are resolved by position in rumorSubject. */
function readActs(content: string): Act[] {
  const text = String(content ?? "");
  const acts: Act[] = [];
  for (const m of text.matchAll(SEEN)) acts.push({ index: m.index ?? 0, harm: HARM_BASE_RE.test(m[2]), doer: m[1].trim(), form: "seen" });
  for (const m of text.matchAll(PASSIVE)) if (m[2]) acts.push({ index: m.index ?? 0, harm: HARM_PASSIVE_RE.test(m[1]), doer: m[2], form: "passive" });
  // Blank out the passive and seen spans (keeping offsets) so neither is read again as active.
  const active = text.replace(PASSIVE, (m) => " ".repeat(m.length)).replace(SEEN, (m) => " ".repeat(m.length));
  const h = HARM_ACT.exec(active), b = BOON_ACT.exec(active);
  if (h) acts.push({ index: h.index, harm: true, form: "active" });
  if (b) acts.push({ index: b.index, harm: false, form: "active" });
  return acts.sort((x, y) => x.index - y.index);
}

/** −1 the subject did harm, +1 the subject did good, 0 neither or both. `standing` breaks a tie for
 *  the player the way rumorCharge does: a well-loved figure's violence reads as a deed. */
export function hearsayValence(content: string, standing = 0): number {
  const acts = readActs(content);
  const harm = acts.some((a) => a.harm), boon = acts.some((a) => !a.harm);
  if (harm && !boon) return standing >= 3 ? 0 : -1;
  if (boon && !harm) return 1;
  if (harm && boon) return standing >= 3 ? 1 : standing <= -3 ? -1 : 0;
  return 0;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every handle the text could use for each living cast member: full name, aliases, and a first name
 *  nobody else shares. Handles under four letters ("Ed", "Bo") get their own case-sensitive pattern,
 *  so the "ed" in "burned" is never Ed. */
function handles(state: SaveState): { id: string; re: RegExp }[] {
  const cast = Object.entries(state.characters ?? {}).filter(([, c]) => c && c.status !== "dead" && c.status !== "departed");
  const firstCount = new Map<string, number>();
  for (const [, c] of cast) {
    const f = (c.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
    if (f) firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
  }
  const out: { id: string; re: RegExp }[] = [];
  for (const [id, c] of cast) {
    const names = new Set<string>();
    const full = (c.name ?? "").trim();
    if (full) names.add(full);
    const first = full.split(/\s+/)[0];
    if (first && first.length >= 2 && firstCount.get(first.toLowerCase()) === 1) names.add(first);
    for (const a of c.aliases ?? []) if (a && a.trim().length >= 2) names.add(a.trim());
    const long = [...names].filter((n) => n.length >= 4), short = [...names].filter((n) => n.length < 4);
    const alt = (xs: string[]) => xs.sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    if (long.length) out.push({ id, re: new RegExp(`\\b(?:${alt(long)})\\b`, "gi") });
    if (short.length) out.push({ id, re: new RegExp(`\\b(?:${alt(short)})\\b`, "g") });
  }
  return out;
}

/** The cast member a doer phrase names, read from its start ("Rabi", "Mara Quill"). */
function nameAt(hs: { id: string; re: RegExp }[], phrase: string): string | null {
  for (const h of hs) {
    h.re.lastIndex = 0;
    const m = h.re.exec(phrase);
    if (m && m.index === 0) return h.id;
  }
  return null;
}

/**
 * Who a rumour is ABOUT, as an actor. `about_char` when set. Otherwise the doer of the first act in
 * the sentence: the name a witness saw doing it, the name after "by" in a passive, or — for an act in
 * the active voice — the person named closest before it. "I" before an active act is the witness,
 * since witness rumours are first-person memories: "I stole the boat" is about the one who saw it.
 * Returns null when the sentence has no act or no person doing it.
 */
export function rumorSubject(state: SaveState, rumor: Pick<Rumor, "content" | "about_char" | "origin_char">): string | null {
  if (rumor.about_char && state.characters?.[rumor.about_char]) return rumor.about_char;
  const text = String(rumor.content ?? "");
  const hs = handles(state);
  for (const act of readActs(text)) {
    if (act.form !== "active") {
      const id = act.doer ? nameAt(hs, act.doer) : null;
      if (id) return id;
      continue;
    }
    const before = text.slice(0, act.index);
    let best: { id: string; end: number } | null = null;
    for (const h of hs) {
      h.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = h.re.exec(before))) {
        const end = m.index + m[0].length;
        if (!best || end > best.end) best = { id: h.id, end };
      }
    }
    const iMatch = [...before.matchAll(/\bI\b/g)].pop();
    if (iMatch && rumor.origin_char && (!best || (iMatch.index ?? 0) > best.end)) return rumor.origin_char;
    if (best) return best.id;
  }
  return null;
}

/** How much a hearer believes what this teller tells them: from their trust in the teller. A stranger
 *  is believed at half weight; trust 100 is full; trust −70 or below is the floor. */
export function credence(edges: SocialEdge[], hearer: string, teller: string): number {
  const t = edges.find((e) => e.from === hearer && e.to === teller)?.trust ?? 0;
  return Math.max(0.15, Math.min(1, 0.5 + t / 200));
}

/** How much of a story against what the hearer already thinks gets through. News that agrees with
 *  their opinion of the subject — or arrives with no opinion to meet — lands whole. News against a
 *  strong opinion is damped by its strength and by how settled their picture of the subject is. */
export function resistance(state: SaveState, hearer: string, subject: string, valence: number): number {
  const w = state.world.edges.find((e) => e.from === hearer && e.to === subject)?.warmth ?? 0;
  if (Math.abs(w) < 20 || Math.sign(w) === Math.sign(valence)) return 1;
  const conf = state.minds?.[hearer]?.about.find((b) => b.target === subject)?.confidence ?? 0;
  return Math.max(0.2, 1 - Math.abs(w) / 100 - 0.3 * conf);
}

/** The warmth and trust a hearer's opinion of the subject moves on hearing this rumour from this
 *  teller, or null when it moves nothing. `sharpened` is a version that grew in the telling. */
export function hearsayShift(
  state: SaveState, rumor: Rumor, hearer: string, teller: string, sharpened = false,
): { subject: string; warmth: number; trust: number } | null {
  const subject = rumorSubject(state, rumor);
  if (!subject || subject === hearer) return null;   // hearing about yourself is a different event
  const standing = subject === "char_player" ? (state.world.public_standing ?? 0) : 0;
  const v = hearsayValence(rumor.content, standing);
  if (!v) return null;
  const step = HEARSAY_STEP * (Math.max(0, Math.min(10, rumor.salience)) / 10)
    * credence(state.world.edges, hearer, teller)
    * resistance(state, hearer, subject, v)
    * (sharpened ? 1.25 : 1);
  const warmth = Math.round(v * step);
  if (!warmth) return null;
  return { subject, warmth, trust: warmth };
}

/** How readily a teller passes a story to a hearer, from the bond between them and whether they see
 *  the subject the same way. Strangers are 1 — the rate the field always had. Warmth from the teller
 *  makes telling likelier; trust from the hearer makes listening likelier; two people who already
 *  agree about the subject trade stories about them more, and two who disagree, less. */
export function tellBias(state: SaveState, teller: string, hearer: string, subject: string | null): number {
  const edges = state.world.edges;
  const w = edges.find((e) => e.from === teller && e.to === hearer)?.warmth ?? 0;
  const t = edges.find((e) => e.from === hearer && e.to === teller)?.trust ?? 0;
  let f = Math.max(0.4, Math.min(1.5, 1 + w / 200)) * Math.max(0.75, Math.min(1.25, 1 + t / 400));
  if (subject && subject !== teller && subject !== hearer) {
    const a = edges.find((e) => e.from === teller && e.to === subject)?.warmth ?? 0;
    const b = edges.find((e) => e.from === hearer && e.to === subject)?.warmth ?? 0;
    if (Math.abs(a) >= 20 && Math.abs(b) >= 20) f *= Math.sign(a) === Math.sign(b) ? 1.25 : 0.8;
  }
  return f;
}
