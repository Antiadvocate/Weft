// ── THE ATTEMPT FRAME ────────────────────────────────────────────────────────
// Outcome resolution without dice. A CRPG compresses a thousand untracked causes into a skill
// check and a roll; this engine TRACKS the causes, so it can read them instead of rolling.
// When the player attempts something with stakes, the frame assembles three deterministic
// readings and resolves the outcome BEFORE the narrator writes:
//
//   CAPABILITY   — who the character is: background, life history, core traits, skills,
//                  acquired traits, grooved habits, what's in their hands. Token-relevance of
//                  the action against that corpus (the same cosine the memory system uses).
//   BODY         — the somatic kernel, pointed at performance: a clenched body shakes and
//                  narrows; a settled one acts cleanly. Plus fatigue, hunger, thirst, and any
//                  injury whose functional impact overlaps the action.
//   CIRCUMSTANCE — the world's current state: pressure band, weather for physical work, and
//                  for social attempts the target's actual disposition toward the player.
//
// Verdict: SUFFICIENT (it works) / CONTESTED (it works at a cost, the cost named from the
// weakest reading) / INSUFFICIENT (it fails, and the failure is traced to its cause). Fully
// deterministic: same state, same verdict, every time. Failure is never "you rolled low" —
// it is "your hands were shaking because you haven't slept, and the guard was already watching
// because of what you let spread Tuesday." Cause and effect, made legible.
//
// The frame never fires in god mode (the player is sovereign), in story mode (the player
// authors outcomes), at mythic/cosmic tier (the world's frame already bends around them),
// or for restful/inert actions. Zero tokens: the LLM renders the verdict; it never decides it.

import type { SaveState } from "./types";
import { bodySeverity, bodyMarks } from "./body";
import { relevance } from "./memory";

export type AttemptOutcome = "sufficient" | "contested" | "insufficient";

export interface AttemptFrame {
  outcome: AttemptOutcome;
  margin: number;             // total − difficulty; the band boundaries are ±0.12
  capability: { score: number; fact: string | null };
  body: { score: number; causes: string[] };
  circumstance: { score: number; causes: string[] };
  difficulty: number;
  weakest: string;            // plain-language name of the reading that decided it
  summary: string;            // one line for the shifts feed
}

// ── the gate: is this typed action an ATTEMPT with stakes? ──
// Dangerous verbs carry a higher base difficulty than risky ones; both outrank routine speech
// and movement, which never frame at all.
const DANGEROUS = /\b(fight|attack|kill|stab|shoot|lunge|tackle|wrestle|restrain|dodge|leap|climb|scale|dive|jump (?:off|from|across|onto|over)|swim (?:across|through|against)|charge|sprint (?:across|through|into)|break (?:the fall|fall))\b/i;
const RISKY = /\b(persuade|convince|intimidate|threaten|lie to|deceive|trick|bluff|charm|seduce|negotiate|haggle|interrogate|command|sneak|creep|hide|stalk|steal|pickpocket|pick the lock|lockpick|break (?:in|into|open|down|free)|force (?:open|the|it)|pry|lift|hoist|carry|drag|chase|pursue|track|hunt|catch|grab|seize|snatch|throw|hurl|aim|fire|draw (?:my|the|a)|repair|fix|rig|disarm|bandage|splint|suture|cauterize|navigate|sail|row|ride|gallop|swim|climb|escape|flee|sneak|eavesdrop|spy|follow)\b/i;
// an action that is mostly spoken words is dialogue, not an attempt
const SPOKEN = /["“”]/g;

export function isAttempt(action: string): boolean {
  const t = action.trim();
  if (t.length < 12) return false;
  const spoken = (t.match(SPOKEN) ?? []).length;
  if (spoken >= 2 && t.replace(/["“”][^"“”]*["“”]/g, "").trim().length < 15) return false; // a line of dialogue with stage directions
  return DANGEROUS.test(t) || RISKY.test(t);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Loose stem match for the injury check: tokenize, drop trailing s/es, count weighted overlap.
 *  Pure relevance() misses disjoint-but-obvious pairs ("climb" vs "grip fails on ledges"), so
 *  impairment CLASSES below do the heavy lifting; this catches the literal overlaps. */
function stemOverlap(a: string, b: string): number {
  const toks = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3).map((w) => w.replace(/(es|s)$/, "")));
  const ta = toks(a), tb = toks(b);
  let hits = 0;
  for (const w of tb) if (ta.has(w)) hits++;
  return ta.size ? hits / ta.size : 0;
}

/** An injury impairs ACTIVITY CLASSES, not word matches: a gashed palm fails every gripping
 *  action regardless of how the attempt is phrased. Deterministic and honest. */
const IMPAIRMENT: [RegExp, RegExp][] = [
  [/grip|grasp|hand|palm|finger|wrist|arm|shoulder/i, /climb|lift|carry|throw|catch|grab|swim|row|sail|fight|swing|repair|fix|pick|suture|bandage|draw|aim|fire|wield|hoist|pry|drag/i],
  [/leg|knee|ankle|foot|feet|thigh|calf|hip/i, /climb|run|sprint|chase|flee|escape|dodge|leap|jump|sneak|creep|dance|kick|swim|hike/i],
  [/eye|vision|sight|blurred/i, /aim|track|hunt|spot|search|read|navigate|shoot|fire/i],
  [/ribs|chest|breath|lung/i, /run|sprint|climb|swim|fight|shout/i],
  [/head|concussion|dizzy|ringing/i, /persuade|negotiate|track|navigate|repair|read|aim/i],
];

/** Read the player's BODY as a performance instrument. The relaxation band does most of the
 *  work — this is the kernel's promise that tension degrades action, made mechanical. */
function readBody(state: SaveState, action: string): { score: number; causes: string[] } {
  const cond = state.condition["char_player"];
  const causes: string[] = [];
  if (!cond) return { score: 0.5, causes };
  const r = cond.psyche.relaxation;
  let raw: number;
  if (r >= 4) { raw = 1; causes.push("settled, steady hands"); }
  else if (r >= 0) { raw = 0.4; causes.push("level enough"); }
  else if (r >= -3) { raw = 0; causes.push("tight — a step off their best"); }
  else if (r >= -6) { raw = -0.8; causes.push("clenched — grip and perception narrow"); }
  else { raw = -1.6; causes.push("deep-clenched — the body betrays fine work"); }
  if (cond.fatigue === "exhausted") { raw -= 1; causes.push("exhausted"); }
  else if (cond.fatigue === "tired") { raw -= 0.25; causes.push("tired"); }
  if (cond.hunger === "starving") { raw -= 0.5; causes.push("starving"); }
  else if (cond.hunger === "hungry") { raw -= 0.25; causes.push("hungry"); }
  if ((cond.thirst_meter ?? 0) >= 8) { raw -= 0.5; causes.push("parched"); }
  else if ((cond.thirst_meter ?? 0) >= 5) { raw -= 0.25; causes.push("thirsty"); }
  // A body taken apart does not need the action to overlap a named wound: nothing works.
  // Read from BOTH channels — catastrophic damage is as often recorded as a condition
  // ("eviscerated and exposed") as an injury, and only injuries were ever consulted here.
  const sev = bodySeverity(cond);
  if (sev >= 4) { raw -= 3; causes.push(`the body is wrecked (${bodyMarks(cond, 4).join(", ") || "catastrophic damage"}) — nothing works properly`); }
  else {
    if (sev === 3) { raw -= 0.75; causes.push(`severely hurt (${bodyMarks(cond, 3).join(", ")})`); }
    for (const inj of cond.injuries ?? []) {
      const text = `${inj.type} ${inj.cause} ${inj.functional_impact}`;
      const impaired = IMPAIRMENT.some(([body, act]) => body.test(text) && act.test(action))
        || stemOverlap(text, action) > 0.2;
      if (impaired) {
        raw -= 1; causes.push(`the ${inj.type} (${inj.functional_impact})`);
        break; // one named wound is enough to carry the fiction
      }
    }
  }
  return { score: (clamp(raw, -3, 1) + 3) / 4, causes };
}

/** Read CAPABILITY: token-relevance of the action against everything the character verifiably
 *  IS. The corpus is bedrock-first (background, core traits, skills), then what play has added
 *  (life history, acquired traits, grooved habits), then what's literally in their hands. */
function readCapability(state: SaveState, action: string): { score: number; fact: string | null } {
  const c = state.characters["char_player"];
  if (!c) return { score: 0.25, fact: null };
  const corpus: string[] = [
    c.background ?? "",
    c.life_history ?? "",
    ...(c.core_traits ?? []),
    ...Object.entries(c.skills ?? {}).map(([k, v]) => `${k} ${v}`),
    ...(state.traits?.["char_player"] ?? []).map((t) => `${t.label} ${t.behavioral_impact}`),
    ...(state.habits?.["char_player"] ?? []).filter((h) => h.strength >= 40 && !h.dormant).map((h) => h.trait),
    ...(state.condition["char_player"]?.inventory ?? []).map((i) => i.name),
  ].filter((s) => s && s.trim().length >= 3);
  let best = 0, fact: string | null = null;
  for (const f of corpus) {
    const rel = relevance(f, action);
    if (rel > best) { best = rel; fact = f; }
  }
  // cosine on short strings runs low; ×2.5 brings a genuine match into working range
  const score = clamp(best * 2.5, 0, 1);
  if (score < 0.15) return { score, fact: null };
  return { score, fact: (fact ?? "").length > 90 ? (fact ?? "").slice(0, 87) + "…" : fact };
}

/** Read CIRCUMSTANCE: pressure is the difficulty's spine (read separately), so this reading is
 *  weather for physical work and, for social attempts, the target's real disposition — a warm
 *  room helps, a hostile one resists. */
function readCircumstance(state: SaveState, action: string, physical: boolean): { score: number; causes: string[] } {
  const causes: string[] = [];
  let score = 0.6;
  if (physical && /storm|rain|snow|sleet|gale|fog|ice|icy|wind|downpour|blizzard/i.test(state.world.weather ?? "")) {
    score -= 0.2; causes.push(`the ${state.world.weather}`);
  }
  // social attempts: find the present NPC named in the action and read their edge toward the player
  if (!physical) {
    for (const id of state.world.present) {
      const c = state.characters[id];
      if (!c || id === "char_player") continue;
      const first = c.name.split(/\s+/)[0].toLowerCase();
      if (first.length < 3 || !action.toLowerCase().includes(first)) continue;
      const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
      if (e) {
        const disposition = ((e.warmth ?? 0) + (e.trust ?? 0)) / 2; // −100..100
        score += clamp(disposition / 250, -0.35, 0.35);
        causes.push(disposition <= -20 ? `${c.name} is set against them` : disposition >= 20 ? `${c.name} is with them` : `${c.name} is unread`);
      }
      break;
    }
  }
  return { score: clamp(score, 0, 1), causes };
}

/** Assemble and resolve the frame. Returns null when the action doesn't merit one. */
export function frameAttempt(state: SaveState, action: string, pressure: number): AttemptFrame | null {
  if (!isAttempt(action)) return null;
  const dangerous = DANGEROUS.test(action);
  const physical = dangerous || /\b(climb|leap|jump|swim|lift|carry|drag|chase|throw|sneak|dodge|dive|sprint|break|force|pry|catch|grab|ride|row|sail)\b/i.test(action);

  const capability = readCapability(state, action);
  // social attempts get a floor of ordinary human competence: climbing a wall in a gale takes
  // real capability, but talking someone into something is a universal act — nil capability
  // must not cap every conversation at contested.
  if (!physical && capability.score < 0.15) capability.score = 0.3;
  const body = readBody(state, action);
  const circumstance = readCircumstance(state, action, physical);

  const total = 0.45 * capability.score + 0.30 * body.score + 0.25 * circumstance.score;
  const difficulty = 0.25 + (clamp(pressure, 0, 10) / 10) * 0.35 + (dangerous ? 0.22 : 0.10);
  const margin = +(total - difficulty).toFixed(3);

  const outcome: AttemptOutcome = margin >= 0.12 ? "sufficient" : margin <= -0.12 ? "insufficient" : "contested";

  // name the weakest reading — it carries the cost or the failure
  const dims: [number, string][] = [
    [capability.score, capability.fact ? `capability (${capability.fact})` : "capability — nothing in who they are speaks to this"],
    [body.score, body.causes.length ? `the body — ${body.causes[body.causes.length - 1]}` : "the body"],
    [circumstance.score, circumstance.causes.length ? `the moment — ${circumstance.causes[0]}` : "the moment"],
  ];
  dims.sort((a, b) => a[0] - b[0]);
  const weakest = dims[0][1];

  const summary = outcome === "sufficient"
    ? `attempt: it works — ${capability.fact ?? "the conditions hold"}`
    : outcome === "contested"
      ? `attempt: it works, at a cost — ${weakest}`
      : `attempt: it fails — ${weakest}`;

  return { outcome, margin, capability, body, circumstance, difficulty, weakest, summary };
}

/** Render the frame as narrator law. The verdict is already decided; the narrator's job is to
 *  make it true on the page, with texture drawn from the very causes that decided it. */
export function attemptDirective(frame: AttemptFrame, action: string): string {
  const excerpt = action.length > 120 ? action.slice(0, 117) + "…" : action;
  const cap = frame.capability.fact ?? "nothing in who they are speaks to this";
  const body = frame.body.causes.join("; ") || "steady";
  const circ = frame.circumstance.causes.join("; ") || "neutral";
  const head = `\nATTEMPT FRAME — the player's action resolves by CAUSE, not chance. The verdict below is already decided from the state of the body and the world; it is authoritative. Render it truthfully — never overturn it with luck, heroics, coincidence, or manufactured peril.\n- attempt: "${excerpt}"\n- capability: ${cap}\n- body: ${body}\n- circumstance: ${circ}\n`;
  if (frame.outcome === "sufficient") {
    return head + `OUTCOME: IT WORKS. Render the success plainly and concretely, textured by the causes above (what they know, how the body held). Do not inject extra peril into a clean success — the world's pressure arrives through its own channels, not through sabotaging a legitimate attempt.`;
  }
  if (frame.outcome === "contested") {
    return head + `OUTCOME: IT WORKS, AT A COST — and the cost comes from ${frame.weakest}. Show that cost concretely and ONLY that cost: a thing gives way, a face is seen, something is paid or lost or noticed. The aim is achieved; the price is real and stays on the record. Do not escalate beyond the named cost, and do not waive it.`;
  }
  return head + `OUTCOME: IT FAILS — and it fails because of ${frame.weakest}. Show that cause operating in the moment (the shaking hand, the watching guard, the missing skill). The failure is honest, not catastrophic: the world reacts as it would, consequences stand, but the aim is NOT achieved. Never let it succeed by accident, and never punish beyond what the failing cause would naturally produce.`;
}
