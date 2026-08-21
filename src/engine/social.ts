/**
 * Social fabric — the world-reacting layer. All deterministic, zero tokens.
 *
 * Rumor diffusion: independent-cascade on the co-presence graph
 * (Kempe–Kleinberg–Tardos 2003). Each turn, every knower k may transmit to
 * each co-present non-knower j with
 *   p(k→j) = base · (salience/10) · ((greg_k + greg_j)/2)
 * Expected coverage and hop counts verified by Monte Carlo in verify.ts.
 * Inspired by Park et al. information-diffusion findings and Social
 * Simulacra (Park et al. 2022): community texture emerges from cheap local
 * rules, not from asking an LLM to imagine it.
 *
 * Psyche: relaxation r drifts toward capacity at rate ρ, perturbed by
 * Simulator deltas; psyche state derived from thresholds and dwell time.
 */
import type { SaveState, Rumor, SocialEdge, Psyche, AcquiredTrait, Identity, EpisodicMemory, CharMemory } from "./types";
import { asText } from "./coerce";
import { relevance } from "./memory";
import { absMinutes } from "./time";
import { uid } from "./state";
import { obduracyIn } from "./obduracy";
import { populationOf } from "./population";
import { recordHop, wordCouldReach } from "./knowledge";
import type { PowerTier } from "./pressure";

export const RUMOR_BASE_P = 0.45;
/** How much of a conversation a message is. Applied to news travelling between people who are not
 *  in the same room — the channel exists, it is just thinner than being there. */
export const REMOTE_REACH = 0.3;

/** Turns a want may sit without its PROGRESS moving before the person gives up on it. A want that
 *  can only be satisfied by the player answering — "get him to give me a place in his life" — never
 *  progresses on its own, so this is the only thing that ends the loop. Small on purpose: the
 *  player feels a repeated question on the second time it is asked, not the fortieth. */
export const STALLED_WANT_TURNS = 6;

export function getEdge(edges: SocialEdge[], from: string, to: string): SocialEdge {
  let e = edges.find((x) => x.from === from && x.to === to);
  if (!e) {
    e = { from, to, warmth: 0, trust: 0, power: 0, notes: "", updated_turn: 0 };
    edges.push(e);
  }
  return e;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Roles that ARE a bond, whatever the numbers have gotten around to recording. */
const BOND_ROLE = /date|lover|girlfriend|boyfriend|partner|spouse|wife|husband|fianc|betrothed|beloved|consort|friend|ally|sworn|protector|guardian|sister|brother|mother|father|daughter|son|family|kin/i;

/**
 * How strongly this edge holds its target — the single number the "is this person bonded to the
 * player" gates should read.
 *
 * It replaces a plain (warmth + trust) / 2, which weighted suspicion equally with love and so
 * scored a devoted-but-guarded companion (warmth 33, trust 14 → 23) below the bar while a cheerful
 * acquaintance cleared it. That is the precise case dispositionCue already warns about: warm and
 * cautious is not cold, and the gates that decide whether a bond is VISIBLE must not be the one
 * place the engine forgets it. Warmth carries the bond; trust modulates; a stated relationship
 * counts for itself, because a wife is a wife on the turn before she trusts you again.
 */
export function bondStrength(e?: Pick<SocialEdge, "warmth" | "trust" | "roles">): number {
  if (!e) return 0;
  const core = e.warmth * 0.75 + e.trust * 0.25;
  const named = (e.roles ?? []).some((r) => BOND_ROLE.test(r));
  return named && e.warmth > 0 ? core + 20 : core;
}

// ── RATCHET BRAKE ── Step sizes are symmetric but OPPORTUNITY is not: almost every turn contains
// something kind, brave, or grateful, and almost none contain betrayal. So up-moves fire constantly
// and down-moves rarely, and any symmetric rule drifts upward until it pins at the ceiling and never
// comes back. High feeling then reads charitably, suppressing the down-moves further — it feeds
// itself. Fix the SHAPE, not the step: gains shrink as the value climbs, losses always land full.
// Below 50 nothing changes (early closeness should still move fast); past 50 each further point
// costs more, so 90 is reachable only by sustained, repeated evidence and never by one warm scene.
// OBDURACY bends this curve per person. The old shape was flat 1 below 50, which meant the
// entire lower half of the range had no brake at all: a stranger at 0 reached 45 in three
// deltas without the ratchet engaging once, and 45 already reads as familiar and comfortable.
// That is the "she softened over one conversation" bug, and it lived here, not in the prompt.
//
// knee = where diminishing returns start. An open person keeps the old knee at 50 and the old
// numbers exactly. A guarded person's knee slides toward 0, so their gains shrink from the
// first point — and `below` damps even the easy early movement, because the whole point is
// that the first fifteen points of warmth are the ones they don't give away.
//
// TUNING. These two are the whole feel of the system, so they're named rather than buried.
//   OPEN_KNEE  — where an obduracy-0 person starts hitting diminishing returns. 50 = old behavior.
//   MAX_DAMP   — how much a fully obdurate person's gains are cut even in the easy early range.
//                0.6 → a +8 kindness lands as +3.2. Raise toward 0.8 if the cast still thaws too
//                fast; a fully closed character then needs ~22 turns of steady warmth to reach 50.
export const OPEN_KNEE = 50;
export const MAX_DAMP = 0.6;

const gainScale = (current: number, obduracy = 0) => {
  const o = Math.max(0, Math.min(1, obduracy));
  const knee = OPEN_KNEE * (1 - o);
  const below = 1 - o * MAX_DAMP;
  if (current <= knee) return below;
  return clamp((100 - current) / Math.max(1, 100 - knee), 0.12, 1) * below;
};

/** Past this, a relationship note stops being what just happened and starts being history. */
export const NOTE_FRESH_TURNS = 8;
/** Past this, a note about a grievance is no longer describing a bond the numbers call fond. */
export const NOTE_STALE_TURNS = 30;

/**
 * HOW A RELATIONSHIP NOTE SHOULD BE READ, given how old it is.
 *
 * `notes` is one 140-char slot holding the last thing the bookkeeper said about this bond, and the
 * bookkeeper writes at moments of friction because friction is what it notices. It was rendered to
 * the narrator every turn with no date, sitting immediately beside the current warmth and trust,
 * and it is by far the more vivid of the two — so it won.
 *
 * The case that exposed it: a character at warmth 59 (the cue for which says outright "the warmth
 * is real and shows... do not write a caring character as a distant stranger") carrying the note
 * "the offer was made while walking away, which deepens her sense of being offered a role rather
 * than chosen as a person", written on turn 127. On turn 164 she was still being played from it.
 * Thirty-seven turns of scenes derived from one bad evening, with the ledger saying she was fond
 * the whole time. From the chair that reads as a person who cannot be reached and will not say why.
 *
 * So: fresh notes stand as they are. Older ones are dated, because a narrator told when something
 * happened can put it in the past. And a grievance that has gone stale while the numbers climbed
 * into open fondness is dropped — the note is describing a bond that no longer exists. Notes on
 * edges that are still cold are never dropped, because there "old rivals" is simply true.
 */
export function edgeNote(e: SocialEdge, turn: number): string {
  const note = (e.notes ?? "").trim();
  if (!note) return "";
  const age = turn - (e.notes_turn ?? turn);
  if (age <= NOTE_FRESH_TURNS) return note;
  if (age > NOTE_STALE_TURNS && e.warmth >= 45) return "";
  return `${note} — but that was ${age} turns ago; the warmth and trust above are current and outrank it`;
}

// ── DRIFT ── Feeling toward someone is a claim that needs renewing, not a stored quantity. Without
// this, a character parked at 95 stays there forever on the strength of one good week forty turns
// ago, and estrangement is impossible except by explicit betrayal. Any edge untouched for a while
// eases back toward neutral, slowly, and only from the outer bands — close relationships don't
// evaporate, they just stop being free. Call once per turn, before the turn's deltas land.
export function decayEdges(edges: SocialEdge[], turn: number, idleTurns = 8, step = 0.5) {
  for (const e of edges) {
    if (turn - (e.updated_turn ?? turn) < idleTurns) continue;
    // A GRUDGE NOBODY FEEDS FADES. A BOND NOBODY FEEDS HOLDS.
    //
    // The band below 20 was exempt in both directions, so a small bond could not erode — which is
    // right — and a small grudge could not heal, which is not. An early misread is how most of them
    // start: on turn 5 of one save a wineshop keeper hit trust -8 and his partner -10 for the crime
    // of being asked where a man buys a slave in Rome, and two hundred idle turns later both were
    // still exactly -8 and -10, because nothing in the engine could move a number that small. Across
    // three saves most of the cast sat at zero warmth and negative trust toward a player who had
    // done nothing to them, which is what "nobody trusts me and I have no relationships" is made of.
    //
    // Souring needs no maintenance and warmth does: that is the asymmetry the exemption encodes, and
    // it is backwards. A first impression wears off unless something confirms it. So an unreinforced
    // negative drifts back toward zero at the same slow step, and an unreinforced positive still
    // holds — a quiet friendship is not a decaying one.
    const ease = (v: number) => (v < 0 ? Math.min(0, v + step) : Math.abs(v) <= 20 ? v : v - step);
    e.warmth = clamp(ease(e.warmth), -100, 100);
    e.trust = clamp(ease(e.trust), -100, 100);
  }
}

/** A note that says the bond is broken, in words that cannot mean anything else. Deliberately narrow:
 *  a bare "withdrew" (a hand, from a room) or "hurt" is ordinary friction and stays out of it. */
/** Feelings wearing a role's clothes. Kept narrow and absolute — a word here has to be a verdict in
 *  every context, never a position somebody actually holds. "rival" is left out on purpose: in a
 *  court, a trade, or a race it is a real standing, not a mood. */
const VERDICT_ROLE = /^(the\s+)?(enemy|enemies|foe|nemesis|adversary|antagonist|traitor|betrayer|victim|prey|target|threat|obstacle|nuisance|burden)$/i;

const RUPTURE_NOTE = /\b(contempt|disgust(ed|s)?|revulsion|revolted|loath(es|ing|ed)?|hatred|despises?|betray(ed|al)|estranged?)\b|\b(emotional withdrawal|withdrawn from|withdrawing from|cannot forgive|will not forgive|can never forgive|wants nothing (more )?to do with|done with (him|her|them)|hardened against)\b/i;

/** …and the same words in a sentence about GETTING OVER it. "Moving past her immediate hatred" is a
 *  note about reconciliation that happens to contain the word hatred, and reading the keyword alone
 *  inverted a bond that had been warming for seventeen straight turns. */
const RECONCILING_NOTE = /\b(mov(es|ed|ing)? (past|beyond)|past (her|his|their|the) (immediate |initial |first )?(hatred|contempt|disgust|anger|betrayal)|get(s|ting)? over|set(s|ting)? aside|put(s|ting)? aside|let(s|ting)? go of|forgiv(e|es|en|ing)|choos(es|ing) to align|reconcil|softening toward|warming (to|toward))\b/i;

/** The largest move a NOTE alone may cause, matching the per-turn ceiling every delta already obeys.
 *  The first version of this rule SET warmth to -8 outright, which could invert 78 points in a single
 *  turn — a move nothing else in the engine is allowed to make. It amplifies now; it never sets. */
const RUPTURE_STEP = 15;

export function applyEdgeDelta(
  edges: SocialEdge[],
  d: { from: string; to: string; warmth_delta: number; trust_delta: number; power_delta: number; note?: string; roles_set?: string[] },
  turn: number,
  ctx?: { chars?: Record<string, Identity>; traits?: Record<string, AcquiredTrait[]> },
) {
  const e = getEdge(edges, d.from, d.to);
  // The edge is d.from's feeling TOWARD d.to, so the relevant constitution is the feeler's.
  // Omit ctx and obduracy is 0, which reproduces the old arithmetic exactly — every existing
  // save and every call site that hasn't been updated behaves identically.
  const obd = ctx ? obduracyIn(ctx.chars, ctx.traits, d.from) : 0;
  const warmthDelta = d.warmth_delta > 0 ? d.warmth_delta * gainScale(e.warmth, obd) : d.warmth_delta;
  e.warmth = clamp(e.warmth + clamp(warmthDelta, -15, 15), -100, 100);
  // trust breaks faster than it builds: positive deltas apply at 60% strength, negatives at full.
  // Dampen the DELTA before applying it once (the old version added full then subtracted from the
  // absolute value, which gave wrong results at the clamp ceiling).
  //
  // TWO BRAKES DESIGNED SEPARATELY WERE BEING MULTIPLIED. The 0.6 is trust's own asymmetry and
  // obduracy is a second one for guarded people, and nobody checked their product: at obduracy 0.6 a
  // +4 landed as 1.54 against a −4 at full strength, a ratio of 2.6 to 1. Since the forge turns out
  // to make most of a cast guarded, that was most of a cast. Obduracy still shapes how fast trust
  // climbs once it is positive — the diminishing-returns half of gainScale — but it no longer
  // compounds with the flat 0.6 in the low range where a relationship is actually being made.
  const trustGain = 0.6 * Math.max(gainScale(e.trust, obd), gainScale(e.trust, 0) * (1 - 0.4 * obd));
  let trustDelta = d.trust_delta > 0 ? d.trust_delta * trustGain : d.trust_delta;
  // RUPTURE-REPAIR: trust that grows within five turns of a real disagreement on this edge is
  // REPAIR, and repair is how trust is actually built — it earns half again. Then the flag clears;
  // the next growth has to be earned on its own terms.
  if (d.trust_delta > 0 && e.last_rupture_turn !== undefined && turn - e.last_rupture_turn <= 5) {
    trustDelta *= 1.5;
    delete e.last_rupture_turn;
  }
  e.trust = clamp(e.trust + clamp(trustDelta, -20, 20), -100, 100);
  e.power = clamp(e.power + clamp(d.power_delta, -10, 10), -100, 100);
  if (d.note) {
    e.notes = d.note.slice(0, 140);
    e.notes_turn = turn;
    // THE WORDS AND THE NUMBERS HAVE TO AGREE. The note is written from the prose; the deltas are
    // written from habit, and the habit is ±2–8. One save carried "Rabi's silent disgust marks a
    // deepening emotional withdrawal" on warmth 9 / trust 5, and "Rabi views John with open
    // contempt" on warmth -2 — a card that reads lukewarm attached to the scene where a marriage
    // ended. A rupture the note names gets a rupture-sized move.
    //
    // THREE THINGS KEEP THAT FROM EATING A RELATIONSHIP, all learned the hard way. The first version
    // set warmth to -8 whenever a rupture word appeared, and on a note reading "Tessa acknowledges
    // Rabi's endurance and chooses to align with him, MOVING PAST her immediate HATRED" it took a
    // bond that had climbed 56 → 78 over seventeen turns and put it at -8 in one step.
    //   · DIRECTION. A note may only enlarge a move the numbers are already making. If this turn
    //     warmed the bond, nothing here fires — the words and the numbers already agree.
    //   · SCOPE. A rupture word inside a sentence about getting over it is not a rupture.
    //   · SIZE. It amplifies, never sets, and never past the ±15 ceiling every other delta obeys.
    //     One turn cannot invert a marriage; several consecutive ones can, which is correct.
    if (RUPTURE_NOTE.test(e.notes) && !RECONCILING_NOTE.test(e.notes)) {
      if (d.warmth_delta < 0 && Math.abs(warmthDelta) < RUPTURE_STEP) {
        e.warmth = clamp(e.warmth - (RUPTURE_STEP - Math.abs(warmthDelta)), -100, 100);
      }
      if (d.trust_delta < 0 && Math.abs(trustDelta) < RUPTURE_STEP) {
        e.trust = clamp(e.trust - (RUPTURE_STEP - Math.abs(trustDelta)), -100, 100);
      }
    }
  }
  if (d.roles_set) {
    // A VERDICT IS NOT A ROLE. This contract's own line is "roles are facts; warmth and trust are
    // feelings" — and then the bookkeeper writes ["neighbor", "enemy"] after one bad evening, and
    // "enemy" renders on her card as a standing fact every turn thereafter, next to a want that still
    // reads "get him alone in her house this week". A woman built to pull the player away from his
    // wife was permanently relabelled by a single rebuff, and the narrator, handed a seducer's drive
    // and an enemy's role, resolved the contradiction toward the role every time.
    //
    // Husband, boss, daughter, landlord, neighbour — those are positions in the world that outlive a
    // mood. Enemy, rival, victim, traitor are how somebody FEELS about the other right now, which is
    // exactly what the two numbers beside them already say. Trust was -6; nothing was lost by
    // dropping the label, and a relationship stopped being frozen by one turn of friction.
    let roles = d.roles_set.map((r) => (typeof r === "string" ? r : String(r ?? "")).trim()).filter(Boolean)
      .filter((r) => !VERDICT_ROLE.test(r))
      .slice(0, 4);
    // RECIPROCAL-ROLE SANITY. The bookkeeper sometimes dumps BOTH sides of a directional
    // relationship onto one edge ("Marie -> Joe: [father, daughter]"), which is incoherent — Marie's
    // role toward Joe is daughter; father is Joe's role toward Marie. When a known reciprocal PAIR
    // appears together on one edge, keep only the side that fits THIS direction and stamp the inverse
    // on the reverse edge, so the narrator gets a correct, directional anchor (this is what prevents
    // garbled "you daughter her"-type lines: the relationship is unambiguous in state).
    const RECIP: Record<string, string> = {
      father: "child", mother: "child", dad: "child", mom: "child", parent: "child",
      son: "parent", daughter: "parent", child: "parent",
      husband: "wife", wife: "husband", boss: "employee", employee: "boss",
      teacher: "student", student: "teacher", master: "apprentice", apprentice: "master",
      mentor: "mentee", mentee: "mentor", owner: "pet", captain: "crew",
    };
    const inverseHits = roles.filter((r) => RECIP[r.toLowerCase()]);
    if (inverseHits.length >= 2) {
      // Two reciprocal terms collided. Decide which belongs to from->to using the CHILD/PARENT axis:
      // a younger/subordinate term (daughter, son, child, student, apprentice, employee, mentee, crew)
      // is what `from` is TO `to`; the senior term goes on the reverse edge.
      const JUNIOR = new Set(["son","daughter","child","student","apprentice","employee","mentee","crew","pet"]);
      const junior = roles.find((r) => JUNIOR.has(r.toLowerCase()));
      const senior = roles.find((r) => !JUNIOR.has(r.toLowerCase()) && RECIP[r.toLowerCase()]);
      if (junior && senior) {
        roles = roles.filter((r) => r.toLowerCase() !== senior.toLowerCase()); // from keeps junior (+ any non-recip roles)
        const rev = getEdge(edges, d.to, d.from);
        const revRole = senior;
        rev.roles = rev.roles ?? [];
        if (!rev.roles.some((r) => r.toLowerCase() === revRole.toLowerCase())) {
          rev.roles = [...rev.roles.filter((r) => r.toLowerCase() !== (RECIP[revRole.toLowerCase()] ?? "")), revRole].slice(0, 4);
          rev.updated_turn = turn;
        }
      }
    }
    e.roles = roles;
  }
  e.updated_turn = turn;
}

/** One diffusion step over the co-presence groups. Deterministic given rng. */
/** RUMORS AS A CELLULAR FIELD on the social graph — the engine's one cellular-automaton rule.
 *
 *  Each co-located group is a NEIGHBORHOOD; each person's cell state is knower/naive plus their
 *  relaxation scalar; the local rule spreads the rumor across the neighborhood with a threshold
 *  set by the group's aggregate body state. Dread travels through clenched rooms (fear rides a
 *  braced crowd), warm news through settled ones; neutral gossip rides either weather mildly.
 *
 *  Crucially, the field REDUCES — the thing a bare cellular automaton never does. Salience decays
 *  every turn (a rumor nobody is charged enough to repeat dies of boredom, not old age), while a
 *  transmission in matching weather feeds it (the story grows in the telling). Growth and decay on
 *  the same rule, because the field rides the same dissipative kernel as everything else: tension
 *  accrues, relaxation releases, structure cycles instead of only complexifying. */
const DREAD_WORDS = /\b(kill|dead|death|die|dying|war|raid|attack|burn|fire|plague|sick|arrest|hang|execut|betray|monster|flood|storm|collapse|missing|blood|threat|danger|curse|riot|flee|invad|drown|starv)\b/i;
// WARM_WORDS was a purely pastoral list (weddings, harvests, rain) — the vocabulary of a village
// with nothing remarkable in it. Nothing a protagonist actually DOES was in here, so every deed
// that reached the rumor field arrived as dread. Added: the vocabulary of protection, deliverance,
// repair, and awe, so that "he held the gate" and "the raiders never reached us" can travel as
// good news the way they would in a real town.
const WARM_WORDS = /\b(wedding|married|birth|born|baby|festival|feast|harvest|peace|treaty|heal|cured|return|alive|saved|rescue|celebrat|gift|rain|spring|protect\w*|defend\w*|spared|mercy|freed|liberat\w+|restor\w+|rebuil\w+|mend\w+|shelter\w*|fed|generous|kind|miracle|wonder|blessing|blessed|hero|champion|guardian|held the (gate|line|bridge)|never reached us|drove (them|it) off|stood between)\b/i;

/** The rumor's emotional charge, read lexically from its content — zero tokens, no save migration.
 *  -1 dread / +1 warm / 0 neutral.
 *
 *  ABOUT THE PLAYER, STANDING BREAKS THE TIE. The lexicons above are asymmetric by construction:
 *  DREAD_WORDS is broad and owns every verb of force, while WARM_WORDS is a short pastoral list. So
 *  "he killed the raiders before they reached the mill" scored as pure dread and then spread FASTER
 *  through frightened rooms (dread rides a braced crowd) — a protective act propagating as terror,
 *  which is exactly how a well-liked protagonist ends up with a frightened countryside. When a
 *  rumor is ABOUT the player and the town's standing toward them is settled, that standing decides
 *  the charge: a beloved figure's violence travels as a deed, not a warning. Mixed and unknown
 *  cases still fall through to neutral, as before. */
function rumorCharge(content: string, standing = 0): number {
  const dread = DREAD_WORDS.test(content), warm = WARM_WORDS.test(content);
  if (dread && !warm) return standing >= 3 ? 0 : -1;   // violence read through a good name is news, not dread
  if (warm && !dread) return 1;
  if (dread && warm) return standing <= -3 ? -1 : standing >= 3 ? 1 : 0; // "saved them by burning it"
  return 0;
}

// ── PUBLIC STANDING ──────────────────────────────────────────────────────────────────────────
/**
 * HOW THE WIDER COMMUNITY HOLDS THE PLAYER: one scalar, -10 (feared) … +10 (beloved), decaying
 * toward 0 (no fixed reputation).
 *
 * The engine models named characters richly — edges, psyche, drives, memory — and modeled the
 * crowd not at all. So whenever a directive described how "the people" regard the player, the
 * narrator had no state to consult and fell back on whatever the directive's example reactions
 * were. At mythic/cosmic tier those examples were all fear-family, which meant a player could
 * spend fifty turns defending a town and still be written as its terror. This gives the crowd the
 * one thing it was missing: a memory of whether the player's public acts have helped or hurt.
 *
 * Deterministic and lexical, in the style of the rumor field — zero tokens, no save migration.
 */
// Deliberately NARROW. An earlier draft of these lists included ordinary words — "gave", "fed",
// "people", "kind" — and the standing drifted every turn on prose that meant nothing ("she gave him
// a look" in a room with people in it). A reputation that moves on everything measures nothing, so
// these only match acts that a town would actually retell.
// ...but narrow is not the same as one-sided, and this list was one-sided. Every verb in it was
// EMERGENCY RESCUE: pull them out, put the fire out, hold the gate, stand between. Nothing in it
// could see a person who PROVIDES — who feeds a quarter, raises a granary, opens a free school,
// forgives a debt, ends a practice. The harm list has always had both registers, acute (murder) and
// systemic (enslave, terrorize), so the scale was legible in one direction only.
//
// Measured on the save that surfaced this: a player who abolished slavery across an empire,
// teleported the army onto public works, raised a granary in the Forum and built a school that fed
// and taught children for nothing scored ZERO on this regex across all seventeen turns, and stood
// at a public standing of exactly 0.0 while the city he had remade decided he was a thing to avoid.
// One murder would have moved him further than everything he actually did.
//
// The construction and provision verbs need an object, the way the harm verbs do, or "built a wall
// to keep them out" and "made an example" read as benefaction.
//
// AND THEY ARE SCORED FROM THE ACTION ONLY — see PUBLIC_WORKS below. A rescue is an EVENT: it is
// narrated once and never mentioned again. A building is a FACT: the school stands in the prose for
// the rest of the story. Scored the same way, the second one pays out forever. Replaying the save
// this came from with both families on prose, the standing climbed on turns 6 and 8 off "built a
// school" and "built a granary" — the narrator recapping work already done, one item of which had
// been done four months before the game began.
const PUBLIC_BOON = new RegExp([
  // ACUTE RESCUE — an event, narrated once. Scored from the action and the player's prose alike.
  `sav(ed|es|ing)|rescu\\w+|heal(ed|s|ing)|cured|protect(ed|s|ing)|defend(ed|s|ing)|shielded|spared|show(ed|n) mercy|sheltered`,
  `rebuil\\w+|restored|freed|liberat\\w+|carried [\\w ]{1,24}? to safety|pulled [\\w ]{1,24}? (out|free|clear)`,
  `put out the (fire|blaze)|stopped the (raid|flood|plague|bleeding|fire)|held the (gate|line|bridge|door)|stood between`,
].join("|").replace(/^/, "\\b(").concat(")\\b"), "i");

/**
 * THE OTHER HALF OF A REPUTATION: what the player PROVIDES, not what they rescue.
 *
 * Ending a standing evil, forgiving a debt, feeding a quarter, raising a granary, opening a school
 * that costs nothing. The harm list has always had this register — `enslav`, `terroriz`, "made an
 * example of" are systemic, not acute — and the boon list had no counterpart at all, so the scale
 * could only be read in one direction. A player who abolished slavery across an empire, teleported
 * the army onto public works and built a free school in front of a crowd of five thousand scored
 * ZERO across seventeen turns and sat at a standing of exactly 0.0 while the city he had remade
 * decided he was a man to avoid. One murder would have moved him further than all of it.
 *
 * Matched against the player's DECLARED ACTION only, because the thing it names goes on existing.
 */
const PUBLIC_WORKS = new RegExp([
  // ending a standing evil — the systemic counterpart to enslav/terroriz on the harm side
  `abolish(?:e[sd]|ing)?|emancipat(?:e[sd]|ing)|manumit(?:s|ted|ting)?|struck off (the |their )?(collar|collars|chains|irons)|unchained|ended (the )?(slavery|famine|plague|hunger|war|siege|blockade|tribute|levy)`,
  `forgave (the |their |every |all )?(debt|debts)|cancel(?:s|led|ing|ling)? (the |their |every |all )?(debt|debts)|remitted (the )?(tax|taxes|tribute)`,
  // provision at scale — a thing a place would retell
  `fed (the |a )?(town|city|village|quarter|crowd|poor|hungry|children|people|everyone)`,
  `hous\\w+ (the |a )?(homeless|poor|refugees|displaced)|clothed the (poor|children)`,
  `(built|build|raised|raise|founded|found|opened|open|endowed|endow|make|made|create[d]?) (a |the |them |every |free )*(school|schools|granary|granaries|hospital|aqueduct|well|wells|bathhouse|almshouse|orphanage|clinic|homes|houses|shelter)`,
  `made (it |them |the )?(bread|grain|food|schooling|school|medicine|water) free|free (bread|grain|food|schooling|lunches|meals|medicine|land)\\b`,
  `taught (the |their )?(children|poor|freedmen|them) (to read|letters|their letters)`,
].join("|").replace(/^/, "\\b(").concat(")\\b"), "i");
const PUBLIC_HARM = /\b(slaughter\w+|massacre\w+|butcher(ed|ing)|murder(ed|s|ing)|burn\w+ (the|their|a) (village|town|city|home|house|farm|field|quarter)|razed?|destroy\w+ (the|their) (village|town|city|home|quarter)|tortur\w+|maim\w+|enslav\w+|terroriz\w+|made an example of|left \w+ to die|killed (a|the) (child|children|innocent)|cut \w+ down where (he|she|they|it) stood)\b/i;
/** Was this turn even public? A boon nobody saw moves no reputation. Crowd nouns only — "people"
 *  and "road" were in here once and matched nearly every paragraph ever written. */
/** Harm at the scale of a place, not a person. This is not a worse insult — it is a different
 *  kind of fact about someone, and it should not have to accumulate at 1.2 a turn to be believed. */
export const MASS_HARM = /\b(kill(ed)? (the )?(whole|entire|every)\b|slaughter\w* (the )?(whole|entire|town|city|village|everyone)|massacre\w* (the )?(town|city|village|everyone)|wiped? out (the )?(town|city|village|everyone|them all)|everyone in (the )?(town|city|village) (is |was )?(dead|died|killed)|kill\w* everyone|destroy\w* (the )?(town|city|village) and everyone|left no one alive|no survivors|erase\w* (the )?(town|city|village)|unmade (the )?(town|city|village))\b/i;

const PUBLIC_EYES = /\b(crowd|crowds|onlookers?|bystanders?|villagers?|townsfolk|townspeople|the street|the market|marketplace|the square|tavern|congregation|caravan|watchers|a dozen \w+|half the (town|village|city))\b/i;

/**
 * Move the player's public standing from what this turn's act did in front of whoever could see it.
 * Returns a log line when the needle actually moved, else null.
 */
export function updatePublicStanding(
  state: SaveState,
  action: string,
  prose: string,
  tier: PowerTier = "mortal",
  standingTier: PowerTier = tier,
): string | null {
  const before = state.world.public_standing ?? 0;
  // DISSIPATION, same as everything else here: a reputation nobody is refreshing fades toward the
  // neutral read. Fear and love both wear off; this is what lets a story recover from one bad turn.
  // But it wears off at the speed of ORDINARY news, and 0.2/turn means a reputation must be
  // re-earned roughly every ten turns or it is gone — which is why a player who had publicly
  // remade a town could sit at a standing of exactly zero a hundred turns later, the crowd holding
  // no opinion whatsoever about the god living up the hill. What a world knows about a power it
  // cannot resist fades much more slowly than gossip about a merchant.
  const fade = standingTier === "cosmic" ? 0.04 : standingTier === "mythic" ? 0.08 : 0.2;
  let v = before > 0 ? Math.max(0, before - fade) : Math.min(0, before + fade);

  // WHOSE DEED? Scoring the whole prose blob would credit the player with everything anyone did in
  // it — a raider burning a farm would move the PLAYER's reputation. Score the player's own
  // declared action, plus only those prose sentences that actually have the player in them.
  const who = state.characters.char_player?.name ?? "";
  const playerRe = new RegExp(`\\byou\\b|\\byour\\b${who ? `|\\b${who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b` : ""}`, "i");
  const playerProse = prose.split(/(?<=[.!?])\s+/).filter((s) => playerRe.test(s)).join(" ");
  const text = `${action} ${playerProse}`;
  // Public means SEEN. A private room with one confidant is not the community, no matter what
  // happened in it — that is what edges are for. Three or more people present is a small audience;
  // two is a conversation.
  // Public means SEEN — and the engine now knows how many people are ordinarily about, which is a
  // far better answer than "are three CARDED characters standing here". Counting only the cast meant
  // an atrocity committed in a city of four thousand moved the needle by nothing at all, because
  // none of the four thousand had a character record. A populated place is an audience.
  const pop = populationOf(state.world.places[state.world.player_location]);
  const seen = PUBLIC_EYES.test(prose) || (pop?.scale ?? 0) >= 10
    || state.world.present.filter((id) => id !== "char_player").length >= 3;
  if (seen) {
    // The works family reads the ACTION alone — a school stays built and stays in the prose, so
    // scoring it from the narration pays the player again every time the narrator mentions it.
    const boon = PUBLIC_BOON.test(text) || PUBLIC_WORKS.test(action), harm = PUBLIC_HARM.test(text);
    const mass = MASS_HARM.test(text);
    // Scale by what the crowd is reacting to: an impossible act is talked about for longer.
    const scale = tier === "cosmic" ? 2 : tier === "mythic" ? 1.5 : 1;
    // ...and by how many people it happened to. A tavern brawl and the killing of a whole town were
    // the same 1.2 on this scale, which is how a player could erase a settlement and remain, as far
    // as the world was concerned, an unremarkable stranger. An act that ends a populated place does
    // not nudge a reputation; it fixes one.
    const crowd = (pop?.scale ?? 0) >= 500 ? 2 : (pop?.scale ?? 0) >= 100 ? 1.5 : 1;
    if (mass) v = Math.min(v, -8);                      // saturate: this is what "feared" is for
    else if (harm) v -= 1.2 * scale * crowd;
    else if (boon) v += 0.9 * scale * crowd;
  }
  v = clamp(v, -10, 10);
  state.world.public_standing = v;

  if (Math.abs(v - before) < 0.5) return null;
  return `word about ${who || "the player"} spreads — the town's read on them turns ${standingBand(v).adjective}.`;
}

function standingBand(v: number, tier: PowerTier = "mortal"): { adjective: string; directive: string } {
  // A WITNESSED POWER IS A KNOWN QUANTITY. The neutral band below is written for an unremarkable
  // stranger, and the tier gate in publicStandingDirective hands it to a MYTHIC player too — so on
  // the turn after a man put words inside every mind in a city of a million and sat down to see who
  // came, the narrator was told, in these words: "Strangers treat them as a stranger: neither afraid
  // nor impressed, occupied with their own lives. Do not have crowds react to the player as a known
  // quantity; they are not one yet." Nobody came. The narrator was doing as it was told.
  //
  // Standing 0 does not mean unknown. It means the community has no settled MORAL read — which for
  // someone whose power everyone has seen is the most charged position there is, not the least.
  if (Math.abs(v) < 2 && (tier === "mythic" || tier === "cosmic")) return {
    adjective: "unsettled",
    directive: `WATCHED, AND NOT YET JUDGED — everyone has seen what the player can do and nobody has decided what it means for them. This is not indifference and must never be written as indifference: strangers do not carry on as though a person like this were ordinary traffic. What they lack is a VERDICT, so the reactions run in every direction at once and different people land differently — awe, calculation, terror, hope, petition, opportunism, the ones who want to be near it and the ones who cross the road. Someone approaches; someone else leaves. Crowds react to the POWER as an established fact and to the PERSON as an open question.`,
  };
  if (v >= 6) return {
    adjective: "reverent",
    directive: `BELOVED — the wider community's default posture toward the player is gratitude, welcome, and claim. Strangers who have only heard of them arrive already inclined toward them: they bring problems hoping for help, offer things, want to be seen with them, name children after them, or press in too close. The friction available here is the friction of being loved by many — demands, expectation, people who feel entitled to them, someone who resents the adoration — never a default suspicion the town has no reason to hold.`,
  };
  if (v >= 2) return {
    adjective: "warmer",
    directive: `WELL REGARDED — the wider community leans toward the player. Strangers give them the benefit of the doubt, doors open a little easier, and people who have heard of them are curious or glad rather than wary. This is a lean, not worship: individuals still have their own reasons.`,
  };
  if (v <= -6) return {
    adjective: "fearful",
    directive: `FEARED — the wider community's default posture toward the player is dread. Streets clear, conversation stops, people comply too fast and mean none of it, and someone somewhere is organizing. This is earned by what they have done in public, and it can be unearned the same way.`,
  };
  if (v <= -2) return {
    adjective: "colder",
    directive: `UNEASY — the wider community is wary of the player. Not terror: a stiffness, shorter answers, a look held a beat too long, business done quickly. Individuals may still be perfectly warm.`,
  };
  return {
    adjective: "quieter",
    directive: `NO FIXED REPUTATION — the wider community has no settled read on the player. Strangers treat them as a stranger: neither afraid nor impressed, occupied with their own lives. Do not have crowds react to the player as a known quantity; they are not one yet.`,
  };
}

/** The standing line handed to the narrator. Empty at a neutral standing in an unremarkable scene —
 *  the crowd only needs describing once it actually holds an opinion. */
export function publicStandingDirective(state: SaveState, tier: PowerTier = "mortal"): string {
  const v = state.world.public_standing ?? 0;
  // At mortal tier with no reputation there is nothing to say; silence is cheaper than a paragraph
  // telling the narrator that nothing in particular is true.
  if (Math.abs(v) < 2 && tier !== "mythic" && tier !== "cosmic") return "";
  return `\nPUBLIC STANDING (how the WIDER COMMUNITY holds the player — distinct from the present characters, who have their own histories and may feel the opposite): ${standingBand(v, tier).directive}`;
}

export function diffuseRumors(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  const groups: string[][] = [];
  // group 1: everyone in the player's scene. Then: offscreen NPCs bucketed by their actual LOCATION —
  // only characters in the SAME place exchange rumors. The old code dumped every offscreen character
  // into one "village-scale" group regardless of where they were, so a rumor hopped instantly from a
  // character fifty miles away to one in the next room, and an NPC who stepped offscreen for a day
  // returned "knowing" everything everywhere. Bucketing by location makes news travel at the speed of
  // people actually moving between places.
  groups.push([...state.world.present]);
  const byLocation = new Map<string, string[]>();
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || state.world.present.includes(id) || c.status === "dead" || c.status === "departed") continue;
    const loc = c.location || "loc_elsewhere";
    const list = byLocation.get(loc) ?? [];
    list.push(id);
    byLocation.set(loc, list);
  }
  for (const group of byLocation.values()) {
    if (group.length > 1) groups.push(group); // only same-place offscreen characters mingle
  }
  // ── PEOPLE WHO ARE APART STILL TALK ─────────────────────────────────────────────────────────
  // Co-presence alone models a village, and it silently switches the whole subsystem off for any
  // story that is not one. Measured on a five-person domestic save: every offscreen character was
  // alone at a different place, so `byLocation` produced no group of size 2, `world.present` held
  // one person, and the naive set excludes the player — the graph had ZERO edges. Twenty live
  // rumours, salience up to 8, and not one possible recipient for any of them. 86 of 103 never left
  // the person who saw them, and no second-hand knower ever brought one up on the page.
  //
  // So a bond is a channel too. Anyone carrying a real edge toward someone can reach them across
  // distance — a call, a text, word sent — at a fraction of the rate of standing in the same room,
  // because that is how much less of it there is. A weak acquaintance is not a channel; the edge has
  // to be something. In a low-technology world the same mechanism reads as word sent with a
  // traveller, which is slower rather than impossible, and the reduced rate already says so.
  const remotePairs: string[][] = [];
  const offstageIds = [...byLocation.values()].flat();
  for (let i = 0; i < offstageIds.length; i++) {
    for (let j = i + 1; j < offstageIds.length; j++) {
      const a = offstageIds[i], b = offstageIds[j];
      if (state.characters[a]?.location === state.characters[b]?.location) continue; // already mingling
      const bond = (x: string, y: string) => {
        const e = state.world.edges.find((z) => z.from === x && z.to === y);
        return e ? Math.abs(e.warmth) >= 25 || Math.abs(e.trust) >= 25 || !!e.roles?.length : false;
      };
      if (bond(a, b) || bond(b, a)) remotePairs.push([a, b]);
    }
  }
  const REMOTE = new Set(remotePairs);
  groups.push(...remotePairs);
  // each neighborhood's aggregate body state — the mean relaxation of its members. This is the
  // local field the rule reads: one number per room, recomputed each turn.
  const groupMood = new Map<string[], number>();
  for (const group of groups) {
    const vals = group.map((id) => state.condition[id]?.psyche.relaxation ?? 0);
    groupMood.set(group, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  for (const rumor of state.world.rumors) {
    if (rumor.dead) continue;
    const age = state.world.current_turn - rumor.born_turn;
    if (age > 30 || rumor.knowers.length >= Object.keys(state.characters).length) { rumor.dead = true; continue; }
    // DISSIPATION: salience leaks away every turn. What nobody is charged enough to repeat dies.
    rumor.salience = Math.max(0, rumor.salience - 0.3);
    if (rumor.salience < 1) { rumor.dead = true; continue; }
    // A rumor about the player is read through the standing they have actually built (see
    // rumorCharge); a rumor about anyone else is read on its words alone.
    const charge = rumorCharge(rumor.content, rumor.about_char === "char_player" ? (state.world.public_standing ?? 0) : 0);
    let fed = false; // a rumor grows at most once per turn, no matter how many rooms carry it
    for (const group of groups) {
      const mood = groupMood.get(group) ?? 0;
      // weather match: dread amplifies in clenched rooms, warmth in settled ones, neutral mildly in either
      const match = charge < 0 ? Math.max(0, -mood) : charge > 0 ? Math.max(0, mood) : Math.abs(mood) / 2;
      const spread = 1 + (Math.min(8, match) / 8) * 1.5; // up to ×2.5 when the room's weather fits the story
      const knowers = group.filter((id) => rumor.knowers.includes(id));
      const naive = group.filter((id) => !rumor.knowers.includes(id) && id !== "char_player");
      for (const k of knowers) {
        const gk = state.characters[k]?.gregariousness ?? 0.5;
        for (const j of naive) {
          if (rumor.knowers.includes(j)) continue;
          const gj = state.characters[j]?.gregariousness ?? 0.5;
          // a message is not a conversation: reaching someone who is not in the room carries much
          // less, and carries it less often
          let reach = REMOTE.has(group) ? REMOTE_REACH : 1;
          if (REMOTE.has(group)) {
            // AND IT CANNOT ARRIVE BEFORE IT COULD HAVE TRAVELLED. `wordCouldReach` has been sitting
            // in knowledge.ts fully written and called by nothing: given two place names and a start
            // time it answers whether word could physically have got there yet, and returns null
            // rather than false when the world records no distance — unknown is not the same as
            // impossible. Without it the remote channel would teleport a rumour across a world that
            // takes two days to cross, which is the failure the co-presence model existed to avoid.
            const from = state.world.places[state.characters[k]?.location ?? ""]?.name;
            const to = state.world.places[state.characters[j]?.location ?? ""]?.name;
            const born = state.world.time_at_turn?.[rumor.born_turn];
            if (from && to && born) {
              const reachable = wordCouldReach(state, from, to, born);
              if (reachable && !reachable.possible) reach = 0;   // not yet; it keeps trying next turn
            }
          }
          const p = RUMOR_BASE_P * (rumor.salience / 10) * ((gk + gj) / 2) * spread * reach;
          if (rng() < p) {
            rumor.knowers.push(j);
            // PROVENANCE: record who told whom, where, and when. Without this the knowers list is
            // a set of people who somehow know, with no route — and "how does he know?" has no
            // answer the engine can give.
            recordHop(rumor, k, j, state.world.current_turn, state.world.places[state.characters[j]?.location ?? ""]?.name);
            log.push(`${state.characters[j]?.name ?? j} hears: "${rumor.content}" (from ${state.characters[k]?.name ?? k})`);
            // GROWTH: carried by matching weather, the story sharpens in the telling — the CA's
            // accrual term, balanced against the decay above so the field can't only complexify.
            if (!fed && match >= 3) {
              rumor.salience = Math.min(10, rumor.salience + 0.6);
              fed = true;
              log.push(`the story grows in the telling — "${rumor.content}" sharpens as it spreads.`);
            }
          }
        }
      }
    }
  }
  return log;
}

/** Per-turn drift of relaxation toward capacity; derive psyche state. */
export function tickPsyche(p: Psyche): void {
  // Drift toward capacity. Overshoot ABOVE capacity decays FASTER than recovery from below —
  // a person's nature sets a ceiling on how open they get, and they don't float far above it just
  // because scenes are pleasant. This is the fix for a low-capacity (tense, guarded, predatory)
  // character being pushed up to serene openness by repeated positive relaxation_deltas and staying
  // there: above capacity the pull-back is strong, so their natural tension reasserts.
  // A discharge (release from depth — see tickDischarge in emotions.ts) temporarily raises the
  // resting point: for a while after letting something go, the body CAN sit more open than its
  // nature. The lift decays below; capacity itself is untouched.
  // A person does not sit at their easy resting point in the week their life came apart. GRIEF DRAG
  // is the missing half of discharge_lift: a lift existed for release and nothing existed for loss,
  // so relaxation drifted back up to a positive capacity while the story was still destroying them.
  const effCapacity = p.capacity + (p.discharge_lift ?? 0) - (p.grief_drag ?? 0);
  const gap = effCapacity - p.relaxation;
  const rate = p.relaxation > effCapacity ? Math.max(p.recovery, 0.5) : p.recovery; // above-capacity overshoot collapses fast
  p.relaxation = clamp(p.relaxation + gap * rate, -10, 10);
  if (p.relaxation <= -7) p.consecutive_clenched++;
  else p.consecutive_clenched = 0;
  // open_run tracks how long they've sat AT/ABOVE their own resting openness — a character whose
  // capacity is low (guarded by nature) shouldn't accrue a long "open run" just for being at rest.
  // Reset when relaxation falls meaningfully below their capacity OR below the neutral line.
  const openFloor = Math.min(3, Math.max(0, effCapacity - 1));
  p.open_run = p.relaxation >= openFloor ? (p.open_run ?? 0) + 1 : 0;
  // Grief lifts far more slowly than a discharge closes — ×0.94 a turn, so a real rupture is still
  // pulling on someone twenty turns later, which is the point. Cleared when it stops mattering.
  if (p.grief_drag !== undefined) {
    p.grief_drag = +(p.grief_drag * 0.94).toFixed(3);
    if (p.grief_drag < 0.2) delete p.grief_drag;
  }
  // the discharge opening closes gradually — ×0.7 per turn, gone within about a week of turns
  if (p.discharge_lift !== undefined) {
    p.discharge_lift = +(p.discharge_lift * 0.7).toFixed(3);
    if (p.discharge_lift < 0.2) p.discharge_lift = undefined;
  }
  if (p.state === "intact" && p.consecutive_clenched >= 4) p.state = "fracturing";
  if (p.state === "fracturing" && p.relaxation > -4) { p.state = "intact"; p.break_mode = null; }
  if (p.state === "fracturing" && p.relaxation <= -9) { p.state = "broken"; p.break_mode = p.break_mode ?? "fractured"; }
  if ((p.state === "broken" || p.state === "shattered") && p.relaxation > -2) { p.state = "intact"; p.break_mode = null; }
  p.mood_valence = clamp(Math.round(p.relaxation * 0.8), -10, 10);
}

/**
 * AND IT NEVER GOT TO FINISH.
 *
 * tickPsyche above is correct and has been for a long time: drift toward capacity, and above
 * capacity collapse fast, "so their natural tension reasserts". It runs at the TOP of the turn, in
 * the undertow phase. The simulator's relaxation_delta is applied at the BOTTOM, in applyDiff. So
 * the order every turn is: drift, then the scene, then the delta — and the value that gets STORED
 * is always the post-delta one, which nothing pulls on until the next turn's single drift step,
 * which is immediately overwritten by the next delta.
 *
 * From a save, turn 35. Claudia's capacity is 2. She entered the turn at 4.5, drift took her to
 * 3.25, and a +2 delta put her at 5.25 — where she was stored. Her open_run read THIRTY-FIVE: she
 * had been at or above her own resting openness for the entire game, and the narrator was told
 * every one of those turns that her perception was clear. The player's description of the result
 * was that everyone in Rome talks like a pompous god.
 *
 * The same ratchet runs downward. A companion AI in another save sat at −10 against a capacity of
 * 2, with the drift pulling up 2.16 a turn and the deltas pushing down harder, for eleven turns.
 *
 * So the deltas get a bound. A turn may move somebody a long way — that is what a turn is for —
 * but it may not leave them parked further from their own resting point than a body goes, and the
 * distance shrinks the longer they have already been out there. Drift does the rest of the work,
 * as it always did; it just gets to finish now.
 */
/**
 * HOSTILITY IS NOT CANDOUR.
 *
 * Same save, same turn. The player typed a page of abuse at a woman he had met minutes earlier —
 * "You Romans are such pieces of shit… shut the fuck up… I'd rather Rome burn" — and then, two
 * turns later, "Hey Claudia. Fuck you". What the bookkeeper wrote down:
 *
 *   relaxation_delta  +2          → the shifts feed read "Claudia Antonia relaxed a little."
 *   edge note         "The insult cut her trust but also confirmed his bluntness, making it
 *                      easier to ask for help plainly."
 *   her memory        "Marcus swore at me in the Forum and I let it slide. His cruelty is a kind
 *                      of honesty — I think I can work with it."
 *   warmth 1, trust 2, attraction 55.
 *
 * A model asked to find what changed will find something positive in almost anything, and being
 * sworn at reads to it as a person dropping their guard. So there was no state in which she was
 * angry, and the narrator — correctly rendering the state it was given — wrote her answering a
 * screamed insult with a poised lecture. Every character in that save is unlikeable for the same
 * reason: nothing anyone does costs anything, so nobody has a self to defend.
 *
 * This is deterministic and it does not ask the bookkeeper's opinion. Being sworn at does not open
 * a body and it does not warm a bond. The reading may still go DOWN as far as the turn wants; it
 * may not go up.
 */
const SLUR = /\b(fuck you|fuck off|fuck yourself|screw you|shut the fuck up|shut up|piece of shit|pieces of shit|shitface|shit ?face|asshole|assholes|dipshit|dipshits|cunt|bitch|bastard|prick|moron|idiot|idiots|imbecile|scum|worthless|pathetic|disgusting|useless)\b/i;
const AIMED = /\b(you|your|you're|youre|yours)\b/i;
/** Curses aimed at a person present, in the player's own typed words. Speech and plain action both
 *  count — shouting it and writing "I spit at her" are the same event to the person on the end of
 *  it. Swearing at the sky, at the city, or at nobody is not aimed at anyone and does not count. */
export function hostileToward(action: string, presentNames: string[]): Set<string> {
  const hit = new Set<string>();
  const text = String(action ?? "").replace(/\*[^*]*\*/g, " ");   // private thought reaches nobody
  for (const raw of text.split(/(?<=[.?!])\s+|\n+/)) {
    const s = raw.trim();
    if (!SLUR.test(s)) continue;
    const named = presentNames.filter((n) => {
      const first = n.split(/\s+/)[0];
      return first.length >= 3 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s);
    });
    if (named.length) named.forEach((n) => hit.add(n));
    else if (AIMED.test(s)) presentNames.forEach((n) => hit.add(n));   // "fuck you" to whoever is here
  }
  return hit;
}

const MAX_ABOVE = 3;    // elation, relief, an evening that went well
const MAX_BELOW = 4;    // fear and grief run deeper — and grief_drag lowers the point itself

export function settleAfterDeltas(p: Psyche): void {
  const eff = p.capacity + (p.discharge_lift ?? 0) - (p.grief_drag ?? 0);
  // A long run out at the edge tightens the leash: the first turn above capacity may sit high, the
  // tenth may not. This is what stops a cast from living permanently in the open band.
  const run = Math.min(6, p.open_run ?? 0);
  const above = Math.max(1, MAX_ABOVE - run * 0.35);
  if (p.relaxation > eff + above) p.relaxation = +(eff + above).toFixed(3);
  if (p.relaxation < eff - MAX_BELOW) p.relaxation = +(eff - MAX_BELOW).toFixed(3);
  p.relaxation = clamp(p.relaxation, -10, 10);
  p.mood_valence = clamp(Math.round(p.relaxation * 0.8), -10, 10);
}

/** Trait reinforcement-or-decay. Unreinforced acquired traits fade; identity-integrated ones persist. */
/** Consolidation — earned, slow identity change. An acquired trait reinforced into deep
 *  integration (high self_weight AND repeatedly reinforced) stops being a "learned" overlay
 *  and becomes WHO THEY ARE: folded into core_traits, and — if it bears on how they come
 *  across — into the stored speech_pattern, then retired from the acquired list. Never runs
 *  per-turn (only on reflection / time skips), so a single scene can't move the core. */
export function capMemory(episodic: EpisodicMemory[], cap = 60): EpisodicMemory[] {
  if (episodic.length <= cap) return episodic;
  const sacred = episodic.filter((m) => m.importance >= 8 || m.commitment_status === "pending");
  const rest = episodic.filter((m) => !(m.importance >= 8 || m.commitment_status === "pending"));
  const room = Math.max(0, cap - sacred.length);
  // Evict by a keep-score, not pure age: importance matters as much as recency, so a burst of
  // trivial recent memories can't nuke a still-significant older one. Highest scores survive.
  const maxTurn = Math.max(1, ...episodic.map((m) => m.turn));
  const keepScore = (m: EpisodicMemory) => (m.importance / 10) * 0.6 + (m.turn / maxTurn) * 0.4;
  const keptRest = rest.slice().sort((a, b) => keepScore(b) - keepScore(a)).slice(0, room);
  const keep = new Set<EpisodicMemory>([...sacred, ...keptRest]);
  return episodic.filter((m) => keep.has(m));
}

export function consolidateBackground(ident: Identity, mem: CharMemory): string[] {
  const log: string[] = [];
  // What counts as "defining" enough to accrete into the character's story-so-far. The old bar was
  // importance >= 8, which — with a bookkeeper that under-scores — silently dropped genuinely
  // life-shaping beats (being abandoned, a betrayal, a rescue) that it happened to score a 6 or 7, so
  // life_history froze early and stopped reflecting what the character actually lived. Broaden it: a
  // core memory always counts; so does an importance>=6 beat carrying real emotional charge, or any
  // importance>=7. This keeps trivia out while catching the beats that actually reshape a person.
  const charged = (m: EpisodicMemory) => !!(m.emotional_charge && m.emotional_charge.trim() && !/none|neutral|calm/i.test(m.emotional_charge));
  // WHAT SOMEBODY ELSE DID IS NOT A CHAPTER OF YOUR LIFE.
  //
  // This filtered on importance alone, and the offstage pass files its witness memories at
  // importance 7 — the raw event text, verbatim, written in the third person about whoever acted.
  // So every errand a character merely heard about was folded into their life_history, which is the
  // document that tells the narrator who they ARE and is read on every turn. From one save, this is
  // the whole of a baker's recorded life:
  //
  //   "The stranger asked Marcus about buying slaves, and Sabina felt a cold weight settle...
  //    Tigellinus sends a boy down toward the Subura with a folded note for the freedman who bought
  //    the Sosii dealing-house's back-room papers... Marcus catches the landlord's man crossing the
  //    corner and puts a free cup in front of him..."
  //
  // Two thirds of it is other people's afternoons, and the identical text sat in Tigellinus's record
  // too. A character built from that cannot be played as anyone. The memory stays where it belongs —
  // she heard it, she can act on it — it simply is not part of who she is.
  const defining = mem.episodic.filter((m) =>
    !m.folded && m.source !== "offstage" && (m.importance >= 7 || (m.importance >= 6 && charged(m))));
  if (!defining.length) return log;
  const facts = defining
    .slice()
    .sort((a, b) => a.turn - b.turn)
    .map((m) => m.content.trim())
    .filter((c) => c && !asText(ident.life_history, " ").includes(c) && !asText(ident.background, " ").includes(c));
  if (facts.length) {
    // fold into the ACCRETED layer, never the bedrock forge background
    // Each moment ends in a stop before the next begins. Joined on a bare space, two entries ran
    // together mid-sentence — "…off the Argiletum Before the market crowd thickens…" — which reads
    // as one garbled clause rather than two things that happened.
    const ended = facts.map((f) => (/[.!?]["'’”]?$/.test(f) ? f : `${f}.`));
    ident.life_history = `${ident.life_history ?? ""} ${ended.join(" ")}`.trim();
    // deterministic light trim: keep the most recent ~1100 chars on a sentence boundary
    const SOFT = 1100;
    if (ident.life_history.length > SOFT) {
      const tail = ident.life_history.slice(-SOFT);
      const firstStop = tail.search(/[.!?]\s/);
      ident.life_history = (firstStop >= 0 ? tail.slice(firstStop + 2) : tail).trim();
    }
    log.push(`${ident.name}'s history now carries ${facts.length} defining moment${facts.length > 1 ? "s" : ""}.`);
  }
  for (const m of defining) m.folded = true;
  return log;
}

/** When life_history has grown past where deterministic trimming reads cleanly, an LLM should
 *  re-summarize it into tighter prose (preserve the shape, lose verbatim detail). The actual
 *  rewrite is async, done by the turn loop — rare and cheap. Bedrock background is never touched. */
export function needsHistoryCompaction(ident: Identity): boolean {
  // Lowered from 1400: this field is rendered to the narrator every turn, so "long enough to need
  // compacting" and "long enough to drown the character card" are the same question, and the second
  // one answers much lower. See the note beside "since the story began" in prompts.ts.
  return (ident.life_history?.length ?? 0) > 900;
}

export function consolidateTraits(ident: Identity, traits: AcquiredTrait[], _turn: number): { kept: AcquiredTrait[]; log: string[] } {
  const log: string[] = [];
  const SPEECHY = /(mean|cruel|harsh|cold|gentle|warm|tender|curt|terse|sharp|bitter|guarded|open|cheerful|grim|sardonic|formal|crude|profane|soft-spoken|aggressive|meek|commanding|timid|sarcastic|kind)/i;
  const kept = traits.filter((t) => {
    const integrated = t.self_weight >= 6 && t.reinforcement_count >= 8 && t.intensity >= 5;
    if (!integrated) return true;
    const already = ident.core_traits.some((c) => c.toLowerCase().includes(t.label.toLowerCase()) || t.label.toLowerCase().includes(c.toLowerCase()));
    if (!already) {
      ident.core_traits = [...ident.core_traits, t.label].slice(-8);
      log.push(`${ident.name}'s trait "${t.label}" has become part of their core personality.`);
    }
    if (SPEECHY.test(t.label) || SPEECHY.test(t.behavioral_impact)) {
      const add = t.label.toLowerCase();
      if (!ident.speech_pattern.toLowerCase().includes(add)) {
        ident.speech_pattern = `${ident.speech_pattern}; has become ${add}`.replace(/^;\s*/, "");
      }
    }
    return false; // retire from acquired — it's core now
  });
  return { kept, log };
}

export function decayTraits(traits: AcquiredTrait[], currentTurn: number): { kept: AcquiredTrait[]; log: string[] } {
  const log: string[] = [];
  const kept = traits.filter((t) => {
    const idle = currentTurn - t.last_reinforced_turn;
    if (idle <= 6) return true;
    const decay = 0.15 * Math.sqrt(idle - 6) * (1 - Math.min(0.9, t.self_weight / 10));
    // A TRAIT AT ZERO INTENSITY IS A LABEL, NOT A TRAIT. Dissolution below is gated on self_weight
    // under 3, so a trait the person identifies with was kept — correctly — and kept decaying, all
    // the way to nothing. One save carried "manipulative" at intensity 0.00 and self_weight 3.5:
    // still on the card, still rendered to the narrator every turn, exerting no force whatsoever and
    // occupying one of the eight slots. If identity holds a trait in place, it holds it in place at
    // a strength it can still act at.
    const floor = t.self_weight >= 3 ? 1 : 0;
    t.intensity = Math.max(floor, t.intensity - decay);
    if (t.intensity < 0.8 && t.self_weight < 3) {
      log.push(`trait dissolved: "${t.label}" (disuse)`);
      return false;
    }
    return true;
  });
  return { kept, log };
}

/** Returns "reinforced" when the incoming trait folded into one already held, "planted" when it
 *  became a new one — the caller rate-limits planting, never reinforcement. */
export function reinforceOrMergeTrait(traits: AcquiredTrait[], incoming: { label: string; origin: string; behavioral_impact: string; intensity: number }, turn: number): "reinforced" | "planted" {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const existing = traits.find((t) => {
    const a = new Set(norm(t.label).split(" ")), b = norm(incoming.label).split(" ");
    return b.filter((w) => a.has(w)).length / Math.max(1, b.length) > 0.5;
  });
  if (existing) {
    existing.intensity = clamp(existing.intensity + 0.7, 1, 10);
    existing.self_weight = clamp(existing.self_weight + 0.5, 0, 10);
    existing.reinforcement_count++;
    existing.last_reinforced_turn = turn;
    return "reinforced";
  } else {
    traits.push({
      id: `trait_${Math.random().toString(36).slice(2, 8)}`,
      label: incoming.label,
      origin: incoming.origin,
      behavioral_impact: incoming.behavioral_impact,
      intensity: clamp(incoming.intensity, 1, 6), // new traits start modest
      self_weight: 1,
      last_reinforced_turn: turn,
      reinforcement_count: 1,
    });
    if (traits.length > 8) {
      traits.sort((a, b) => b.self_weight * b.intensity - a.self_weight * a.intensity);
      traits.length = 8;
    }
    return "planted";
  }
}

/** In-story turns a character must go without gaining a NEW trait before they may gain another. */
export const TRAIT_PLANT_COOLDOWN = 5;

/** Has this character been given a brand-new trait too recently for another to be credible? */
export function plantedRecently(traits: AcquiredTrait[], turn: number): boolean {
  return traits.some((t) => t.reinforcement_count <= 1 && turn - t.last_reinforced_turn < TRAIT_PLANT_COOLDOWN);
}

/**
 * In-world minutes of offscreen effort an ordinary want takes to finish.
 *
 * A day. Wants written by the drive forge are day-to-week jobs by construction — "retrieve the
 * stash she hid behind the ludus", "get the field cleared before the frost", "acquire the crest of
 * the Tiburtine hill from Senator Servilius" — so a day of unimpeded work is a generous rate, not a
 * slow one. Blocked wants run at a third of it.
 */
export const MINUTES_PER_WANT = 24 * 60;

/** One unmeasured beat of scene time, for callers that do not know how long their pass covered. */
const BEAT_MINUTES = 30;

/**
 * Offscreen NPC drives advance; produces world-motion lines without an LLM.
 *
 * THE WORLD'S CLOCK WAS THE NUMBER OF THINGS THE PLAYER HAD TYPED.
 *
 * The step used to be `6 + rng()*8` percent, applied once per TURN, with no reference to elapsed
 * time at all — so a want completed in roughly ten turns whatever those turns were. A turn is a
 * beat of conversation. In one save, twenty-four of them covered a hundred and seventy-five minutes
 * of a single Roman morning, and in that morning, entirely offscreen:
 *
 *   · Hadrian finished one life ambition (t3 34% → t12 "completes their aim") and then ACQUIRED THE
 *     CREST OF THE TIBURTINE HILL FROM A SENATOR'S ESTATE between 10:30 and 11:25.
 *   · Marcus seized and drained three barrels of illicit lamp-oil from a cellar across the city
 *     while the same world-motion feed had him sitting in a cookshop finishing his lunch and
 *     watching the door.
 *
 * The player's complaint was that nothing had any timescale, and this is most of why: the fastest
 * way to make the world lurch was to talk to somebody for a while. Progress is now a rate against
 * in-world minutes, which is what the drive forge already assumes when it writes a want, and what a
 * time skip already means. Short scenes barely move it. A day of skipped time finishes a want.
 */
export function tickDrives(state: SaveState, rng: () => number = Math.random, elapsedMinutes = BEAT_MINUTES): string[] {
  const log: string[] = [];

  // ── STALLED WANTS ───────────────────────────────────────────────────────────
  // A drive only progresses when the simulator says it did, and a drive phrased as a QUESTION FOR
  // THE PLAYER can never progress on its own — "get a clear answer from Anki about whether he wants
  // her to stay" is not something she can do, it is something she can only ask for. So she asks.
  // Then asks again. Then asks a third time, because the want is still at the same percentage and
  // the engine keeps handing it back as her active goal. That is not characterisation, it is a
  // loop with no exit.
  //
  // People do not ask the same question indefinitely. They conclude, they give up, they act on the
  // answer they already have. A want that has not moved in a long stretch of in-world time is
  // abandoned — and abandoning it is itself something that happened to them.
  //
  // THE ESCAPE HATCH WAS DISARMED BY THE LOOP IT EXISTS TO BREAK. This measured staleness against
  // `updated_turn`, and the bookkeeper rewrites the blocker every single turn the question is on
  // the table ("his answer was warm but vague", "the horn interrupted before he could answer") —
  // which stamps updated_turn. So the counter read 1 or 2 forever and the abandonment could never
  // fire, no matter how many times she asked. Staleness has to be measured against the last time
  // PROGRESS actually moved, which is the thing that is not moving.
  //
  // And forty turns was never the right number. A player feels the loop on the second repetition.
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || !c.drive) continue;
    const d = c.drive;
    // seed the progress clock for saves that predate it, and re-stamp whenever progress moves
    if (d.progress_turn === undefined || (d.last_progress ?? -1) !== d.progress) {
      d.progress_turn = state.world.current_turn;
      d.last_progress = d.progress;
    }
    const since = state.world.current_turn - d.progress_turn;
    if (since >= STALLED_WANT_TURNS && (c.drive.progress ?? 0) < 60) {
      log.push(`${c.name} stopped waiting on: ${c.drive.goal}`);
      state.memory[id]?.episodic.push({
        turn: state.world.current_turn,
        content: `I stopped asking about ${c.drive.goal.replace(/^(get|obtain|secure|find out|learn)\s+/i, "")} — no answer was coming, so it stopped being a question.`,
        importance: 6, emotional_charge: "resignation",
        last_accessed_turn: state.world.current_turn,
      } as never);
      if (c.current_goal === c.drive.goal) c.current_goal = undefined;
      c.drive = undefined;   // the simulator assigns the next want; she is not stuck on this one
    }
  }

  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || state.world.present.includes(id) || !c.drive) continue;
    if (c.drive.progress >= 100) {
      // completion is an EVENT, not a frozen meter: it becomes a memory and the slot clears
      log.push(`${c.name} got what they wanted: ${c.drive.goal}. It shows.`);
      state.memory[id]?.episodic.push({
        turn: state.world.current_turn,
        content: `I got what I wanted: ${c.drive.goal}.`,
        importance: 7, emotional_charge: "satisfaction",
        last_accessed_turn: state.world.current_turn,
      });
      if (c.current_goal === c.drive.goal) c.current_goal = undefined;
      c.drive = undefined; // the Simulator assigns the next want via drives_update
      continue;
    }
    // movement now comes from the Undertow's QRE stances; this tick is the safety
    // net for worlds whose undertow hasn't run this turn (e.g. plain time skips)
    if (c.drive.updated_turn < state.world.current_turn) {
      // Jitter so a roomful of people who took up their wants on the same turn do not all finish
      // on the same turn either — the meter should look like separate lives, not one clock.
      const rate = (c.drive.blocker ? 1 / 3 : 1) * (0.6 + rng() * 0.8);
      const step = (Math.max(0, elapsedMinutes) / MINUTES_PER_WANT) * 100 * rate;
      c.drive.progress = Math.min(100, c.drive.progress + step);
      c.drive.updated_turn = state.world.current_turn;
    }
    if (c.drive.progress >= 100) log.push(`${c.name} completes their aim offscreen: ${c.drive.goal}`);
    else if (rng() < 0.18) log.push(`${c.name} works toward "${c.drive.goal}" (${Math.round(c.drive.progress)}%)${c.drive.blocker ? ` — blocked by ${c.drive.blocker}` : ""}`);
  }
  return log;
}

/**
 * SELF-BETRAYAL CLENCH (deterministic). Yielding under pressure AGAINST an active want of one's
 * own is a clench, whatever its social shape — agreement-from-fixation is still fixation. Each
 * self-betrayal dips relaxation and increments a counter; at 3+ the strain shows as a
 * "swallowing resentment" state the narrator and lifecycle carry. Standing your ground (a
 * refusal or counteroffer) is free and repairs a point of the count; the count also drains
 * slowly on its own. A willing yes (no active want crossed) costs nothing — compliance is only
 * taxed when it contradicts something the character actually wants. Refusals and counters also
 * mark the pair's edge as ruptured, so trust grown within five turns earns the repair bonus.
 */
export function applyStances(
  state: SaveState,
  stances: { charId: string; towardId: string; stance: "yielded" | "refused" | "countered"; about: string }[],
  turn: number,
): string[] {
  const log: string[] = [];
  const handledIds = new Set<string>(); // anyone with a stance this turn skips the passive drain
  for (const st of stances) {
    const c = state.characters[st.charId];
    const cond = state.condition[st.charId];
    if (!c || !cond || st.charId === "char_player" || c.central === false) continue;
    handledIds.add(st.charId);
    if (st.stance === "yielded") {
      const opposing =
        (c.drive && relevance(st.about, c.drive.goal) >= 0.2) ||
        (c.current_goal && relevance(st.about, c.current_goal) >= 0.2);
      if (!opposing) continue; // nothing of their own was crossed: a willing yes is free
      const style = c.attachment?.style ?? "secure";
      const mult = style === "anxious" ? 1.25 : style === "disorganized" ? 1.1 : style === "avoidant" ? 0.9 : 0.75;
      cond.psyche.relaxation = clamp(cond.psyche.relaxation - 0.4 * mult, -10, 10);
      cond.psyche.betrayals = (cond.psyche.betrayals ?? 0) + 1;
      if (cond.psyche.betrayals >= 3 && !cond.psyche.active_states.includes("swallowing resentment")) {
        cond.psyche.active_states.push("swallowing resentment");
        log.push(`${c.name} keeps giving in against what they want — the strain of it is becoming visible.`);
      } else {
        log.push(`${c.name} gave in against their own want — a small clench.`);
      }
    } else {
      // refused or countered: standing your ground is free, and it hands a point of self back
      if ((cond.psyche.betrayals ?? 0) > 0) cond.psyche.betrayals = Math.max(0, (cond.psyche.betrayals ?? 0) - 1);
      getEdge(state.world.edges, st.charId, st.towardId).last_rupture_turn = turn;
    }
  }
  // the count drains for everyone with no stance this turn; resentment lifts when it empties
  for (const [cid, cond] of Object.entries(state.condition)) {
    if (handledIds.has(cid)) continue;
    const b = cond.psyche.betrayals ?? 0;
    if (b > 0) {
      cond.psyche.betrayals = Math.max(0, b - 0.34);
      if (cond.psyche.betrayals === 0) cond.psyche.active_states = cond.psyche.active_states.filter((s) => s !== "swallowing resentment");
    }
  }
  return log;
}

/**
 * ANSWERED-WANT CLOSURE (deterministic safety net). When a promise lands on the ledger whose
 * text matches a character's active drive — the player agreed to the date, swore to the favor —
 * that want is ANSWERED even though the event hasn't happened yet: the character got their yes,
 * and pressing the same ask next turn is a broken record, not a person. We complete the drive
 * exactly the way tickDrives completes offscreen ones (it becomes a memory, the slot clears) so
 * the Simulator's drives_update assigns the NEXT concrete goal ("plan the evening"). This closes
 * the loop even when the bookkeeper forgets to rotate: the promise reaching the ledger IS the
 * answer reaching state. Only the promise RECIPIENT's drive can match — they asked; the "yes"
 * was given to them.
 */
export function completeDrivesForPromises(state: SaveState, promises: { from: string; to: string; text: string }[]): string[] {
  const log: string[] = [];
  for (const p of promises) {
    const c = state.characters[p.to];
    if (!c || p.to === "char_player" || !c.drive) continue;
    if (relevance(p.text, c.drive.goal) < 0.2) continue;
    state.memory[p.to]?.episodic.push({
      turn: state.world.current_turn,
      content: `${state.characters[p.from]?.name ?? p.from} agreed: ${p.text}.`,
      importance: 7, emotional_charge: "satisfaction",
      last_accessed_turn: state.world.current_turn,
    });
    if (c.current_goal === c.drive.goal) c.current_goal = undefined;
    log.push(`${c.name} got their answer ("${c.drive.goal}") — moving to what comes next.`);
    c.drive = undefined;
  }
  return log;
}

/** Player-facing edges for telemetry snapshots. */
export function playerEdgeSnapshot(state: SaveState): { pair: string; warmth: number; trust: number }[] {
  return state.world.edges
    .filter((e) => e.to === "char_player" && state.characters[e.from])
    .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust }));
}

// ─────────────────────────── PROMISE LEDGER ───────────────────────────
// Who swore what to whom, and what it costs to keep or break it. The emotional swing scales with
// TWO things, like real life: how BIG the promise was (weight 1–3), and the PATTERN of this person's
// track record with the one they promised (a first slip from someone reliable is forgivable; the
// fifth broken vow is who they are now). Kept promises build trust faster than warmth (you can rely
// on them); broken ones cost trust hardest, and warmth too when the promise was large.

import type { Promise as PromiseRec } from "./types";

/** How many promises `from` has already KEPT vs BROKEN toward `to` — the track record that bends
 *  how the next outcome lands. */
function promiseHistory(state: SaveState, from: string, to: string): { kept: number; broken: number } {
  let kept = 0, broken = 0;
  for (const p of state.world.promises ?? []) {
    if (p.from !== from || p.to !== to) continue;
    if (p.status === "kept") kept++;
    else if (p.status === "broken") broken++;
  }
  return { kept, broken };
}

/** Record a new promise on the ledger. Weight defaults to a real commitment (2) unless the text
 *  reads small (a quick favor) or huge (a vow / life-stakes). */
export function addPromise(state: SaveState, from: string, to: string, text: string, weight?: 1 | 2 | 3, due_time?: string): PromiseRec | null {
  if (!state.characters[from] || !state.characters[to] || !text.trim()) return null;
  // A PROMISE TO YOURSELF IS NOT A PROMISE. The whole system is a debt between two people — it
  // moves an edge, it files a memory in the OTHER person's bank, and it renders as "X broke a
  // promise to Y". With from and to the same person that came out as "Miranda broke their promise
  // to Miranda: Miranda told herself she is not ready to talk about it yet", five times in one
  // save, sitting in her own memory as an accusation from herself about herself. A resolution is
  // not a promise; when the bookkeeper files one, drop it.
  if (from === to) return null;
  state.world.promises ??= [];
  // don't double-log a near-identical open promise between the same pair
  const dup = state.world.promises.find((p) => p.from === from && p.to === to && p.status === "open" && relevance(p.text, text) >= 0.6);
  if (dup) return dup;
  const w: 1 | 2 | 3 = weight ?? (/(\bvow\b|\bswear\b|\bwith my life\b|protect|never leave|marry|die for|always be)/i.test(text) ? 3
    : /(\bhelp\b|\bbring\b|\bget\b|\bfetch\b|\bwalk\b|\bmeet\b|\bstop by\b|\blook after\b for a)/i.test(text) ? 1 : 2);
  const rec: PromiseRec = { id: uid("promise"), from, to, text: text.trim().slice(0, 160), made_turn: state.world.current_turn, due_time, weight: w, status: "open" };
  state.world.promises.push(rec);
  if (state.world.promises.length > 40) state.world.promises = state.world.promises.filter((p) => p.status === "open").concat(state.world.promises.filter((p) => p.status !== "open").slice(-20));
  return rec;
}

/** Resolve a promise kept or broken, applying the weight- and pattern-scaled relationship change and
 *  a memory for the one it was made to. Returns a human line for the shift log. */
/**
 * PROMISES THIS TURN'S EVENTS LOOK LIKE THEY SETTLED.
 *
 * Showing the bookkeeper the open ledger is most of the fix, but a small model reading a long turn
 * will still miss one, and the cost of a miss is visible to the player: a job they have already
 * done sits in their journal as still owed. This is the cheap second pass — word overlap between
 * the promise and what actually happened. It never closes anything itself; a promise is kept or
 * broken by the record, not by a regex. It points, and the bookkeeper decides.
 *
 * The case that prompted it: "Help her drain the woad vat before the date." made on turn 2, and on
 * turn 3 the player typed "I snap my fingers and the vat is drained". Overlap is obvious to a
 * reader and was invisible to the engine.
 *
 * AND THEN, MEASURED ON A SAVE WHERE IT FAILED: word overlap peaks when a promise is MADE and goes
 * quiet when it is KEPT. It has the mechanism exactly backwards.
 *
 *   t5  "Lucia will walk Rabi into the cookshop and stay as his guide."   overlap 0.257  ← FIRES
 *   t6   the player arrives at the cookshop. The prose opens "The cookshop
 *        was a narrow room with a low ceiling blackened by years of smoke"  overlap 0.127
 *   t7 … t12                                                        overlap 0.04 – 0.17
 *
 * The threshold is 0.25. It pointed at the promise on the turn it was created — when there was
 * nothing to close and the words were freshest — and said nothing on the turn it was fulfilled or
 * on any turn after. The promise sat open for twenty turns. Of course it did: a turn that STATES a
 * promise shares its vocabulary, and a turn that FULFILS one describes an event instead. The
 * measure was reading the restatement, not the keeping.
 *
 * So the promise made this turn is excluded outright, and word overlap is demoted to one of two
 * signals. The other is state, which for this class of promise is decisive and was sitting unused:
 * the ledger said "walk Rabi into the cookshop", the world has a place called "A cookshop in the
 * Subura", and the travel log has the player arriving there on turn 6.
 */

/** A promise ABOUT getting somewhere or bringing someone somewhere — the class where arrival IS the
 *  keeping. Deliberately tight: "I'll pay you when I reach Rome" names a place and is not this. */
const ESCORT = /\b(walk|walks|walked|take|takes|took|bring|brings|brought|escort\w*|meet|meets|met|come|comes|came|go|goes|went|return\w*|accompany|accompanies|accompanied|lead|leads|led|guide|guides|guided|show|shows|showed|deliver\w*|carry|carries|carried|drop off|see \w+ home|get \w+ to)\b/i;
const PLACE_STOP = new Set(["the", "a", "an", "of", "in", "on", "at", "and", "house", "room", "place", "street", "road", "city", "town", "north", "south", "east", "west", "old", "new", "great", "little", "upper", "lower", "main"]);

/** Which place, if any, this promise is about reaching. Null when it names none, or when the
 *  promise is not the kind that arrival could settle. */
export function promisedPlace(state: SaveState, text: string): string | null {
  if (!ESCORT.test(text)) return null;
  const words = new Set((text.toLowerCase().match(/[a-z]{5,}/g) ?? []));
  // BEST match, not first. Place names carry people's names in them, and "Lucia will walk Rabi into
  // the cookshop" hit "The house of Lucia Aelia Severa" on the word `lucia` before it ever reached
  // "A cookshop in the Subura" — the wrong building, on the name of the woman doing the walking.
  // Score by how much distinctive name was actually matched, so `cookshop` outweighs `lucia`.
  let best: { id: string; score: number } | null = null;
  for (const place of Object.values(state.world.places ?? {})) {
    if (place.id === "loc_offscene") continue;
    const tokens = (place.name.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !PLACE_STOP.has(w));
    const score = tokens.filter((t) => words.has(t)).reduce((n, t) => n + t.length, 0);
    if (score > 0 && (!best || score > best.score)) best = { id: place.id, score };
  }
  return best?.id ?? null;
}

/** Evidence, this turn, that an open promise has been made good on. `arrival` is state and is worth
 *  far more than `words`, which is a hint about a long turn and nothing more. */
export function promiseEvidence(state: SaveState, p: PromiseRec, action: string, prose: string): "arrival" | "words" | null {
  const t = (p.text ?? "").trim();
  if (t.length < 8) return null;
  // The turn a promise is made is not evidence it was kept. This was most of what the old signal
  // ever fired on, and it taught the bookkeeper that the pointer means nothing.
  if (p.made_turn >= (state.world.current_turn ?? 0)) return null;
  const dest = promisedPlace(state, t);
  if (dest && state.world.player_location === dest) return "arrival";
  const turnText = `${action}\n${prose}`;
  if (!turnText.trim()) return null;
  // Both directions: a short promise inside a long turn scores badly one way and well the other.
  return relevance(t, turnText) >= 0.25 || relevance(turnText, t) >= 0.25 ? "words" : null;
}

export function promisesLikelyMet(state: SaveState, action: string, prose: string): PromiseRec[] {
  return (state.world.promises ?? [])
    .filter((p) => p.status === "open" && promiseEvidence(state, p, action, prose) !== null)
    .slice(0, 4);
}

/** How many separate turns of evidence before the engine stops asking and closes it itself. */
export const PROMISE_EVIDENCE_TO_CLOSE = 3;

/**
 * THE BOOKKEEPER GETS ASKED, AND THEN IT STOPS BEING ASKED.
 *
 * Pointing at a promise is only worth anything if something happens when the pointing is ignored.
 * "I've done it multiple times, it remains open" is the whole complaint, and the answer to evidence
 * on three separate turns with the promise still open is not a fourth prompt.
 *
 * Only for a favour or a commitment. A VOW is not closed by the engine on any amount of evidence:
 * "protect your son", "never leave" — the keeping of those is the arc, and a scene that looks like
 * the keeping of one is just a scene where it held. Those close when the story says so, or by hand.
 */
export function creditPromiseEvidence(state: SaveState, action: string, prose: string, turn: number): string[] {
  const closed: string[] = [];
  for (const p of state.world.promises ?? []) {
    if (p.status !== "open") continue;
    if (promiseEvidence(state, p, action, prose) === null) continue;
    const seen = (p.evidence_turns ??= []);
    if (!seen.includes(turn)) seen.push(turn);
    if (p.weight >= 3 || seen.length < PROMISE_EVIDENCE_TO_CLOSE) continue;
    resolvePromise(state, p, "kept", turn);
    p.settled_turn = turn;
    p.settled_by_evidence = true;
    // Say that the ENGINE did this. The player is the only one who can tell it apart from a promise
    // that was genuinely kept, and a line that reads like an ordinary resolution gives them nothing
    // to object to — the ledger has three buttons precisely because this can be wrong.
    const who = p.from === "char_player" ? "You" : state.characters[p.from]?.name ?? "someone";
    closed.push(`${who} kept ${p.from === "char_player" ? "your" : "their"} word: ${p.text.replace(/\s*[.]\s*$/, "")} — closed by the engine after ${seen.length} turns of it looking done.`);
    console.info(`[promises] closed "${p.text}" as kept — ${seen.length} turns of evidence and the bookkeeper never resolved it`);
  }
  return closed;
}

/** Turns an untended small favour stays on the ledger before it stops being carried. Roughly a
 *  session of play: long enough that a favour deferred over an arc is still owed, short enough that
 *  "I'll grab you a drink" from forty turns ago is not still being served to the bookkeeper as live
 *  business every single turn. */
export const PROMISE_STALE_TURNS = 30;
/** In-world minutes past a stated deadline before an unkept promise is simply broken. */
const PROMISE_DEADLINE_GRACE_MIN = 12 * 60;
/** How many promises may be open at once before the oldest small ones are let go regardless. */
const MAX_OPEN_PROMISES = 20;

/**
 * THE LEDGER HAS TO EMPTY AS WELL AS FILL.
 *
 * Recording commitments is mandatory and the bookkeeper is told so in capitals, which is right — a
 * commitment that never reaches state gets re-asked for every turn. But nothing ever took one OFF
 * except the bookkeeper choosing to resolve it, the evidence detector closing a favour it saw done
 * three times, or the player pressing a button. Everything else accumulated, forever, and open
 * promises are exempt from the ledger's own 40-entry cap — that cap only ever trims RESOLVED ones.
 *
 * What accumulates is not vows. It is "I'll walk you home", "I'll ask around", "I'll bring the
 * ledger by" — small business the story moved past three days ago and no scene will ever formally
 * close. Each one keeps costing: a slot in the ten shown to the bookkeeper under an instruction to
 * check EVERY one of them against this turn, a line on a character card, and a place in the
 * player's journal reading as a job still owed.
 *
 * Three rules, and the distinctions between them are the whole design:
 *
 *   · A DEADLINE THAT PASSED UNDONE IS BROKEN. Not stale — broken, with the full relationship
 *     consequence, because that is what the word means and the bookkeeper is already told so. Doing
 *     it on the clock rather than hoping the model notices is the same move as firing consequences
 *     on in-world time instead of on the turn counter.
 *   · AN UNTENDED SMALL FAVOUR IS RETIRED. `retired` exists precisely for a promise that was never
 *     going to close itself and it carries NO relationship consequence (see the Promise type). The
 *     story forgot about it; forgetting is not betrayal.
 *   · A COMMITMENT OR A VOW WITH NO DEADLINE STAYS OPEN. "Protect your son" does not lapse because
 *     thirty turns went by. Those are the arc, and the arc is allowed to take its time.
 */
export function sweepPromises(state: SaveState, turn: number): string[] {
  const log: string[] = [];
  const open = (state.world.promises ?? []).filter((p) => p.status === "open");
  const now = absMinutes(state.world.current_time);

  for (const p of open) {
    if (p.due_time) {
      const due = absMinutes(p.due_time);
      // absMinutes falls back to Day 1 09:00 on anything it cannot parse, and "unresolved" is a
      // legal due_time in this engine — never break a promise on a timestamp we did not understand.
      if (/day\s*\d+/i.test(p.due_time) && now > due + PROMISE_DEADLINE_GRACE_MIN) {
        const line = resolvePromise(state, p, "broken", turn);
        p.settled_turn = turn;
        if (line) log.push(line);
        console.info(`[promises] "${p.text}" came due at ${p.due_time} and was not kept`);
        continue;
      }
    }
    const idle = turn - Math.max(p.made_turn, ...(p.evidence_turns ?? [0]));
    if (p.weight === 1 && !p.due_time && idle >= PROMISE_STALE_TURNS) {
      p.status = "retired";
      p.settled_turn = turn;
      log.push(`the small matter of "${p.text.replace(/\s*[.]\s*$/, "")}" has quietly stopped being owed.`);
    }
  }

  // BACKSTOP. A story that generates favours faster than the staleness window retires them would
  // still creep upward. Oldest small ones go first; a vow is never dropped for being numerous.
  const stillOpen = (state.world.promises ?? []).filter((p) => p.status === "open");
  if (stillOpen.length > MAX_OPEN_PROMISES) {
    const droppable = stillOpen.filter((p) => p.weight === 1).sort((a, b) => a.made_turn - b.made_turn);
    for (const p of droppable.slice(0, stillOpen.length - MAX_OPEN_PROMISES)) {
      p.status = "retired";
      p.settled_turn = turn;
      console.info(`[promises] retired "${p.text}" — ${stillOpen.length} open at once`);
    }
  }
  return log;
}

/** The open promises WORTH SHOWING, most load-bearing first: a vow outranks a favour, and among
 *  equals the freshest wins. The callers all take the first few, and taking the first few of an
 *  array in insertion order meant a character card could spend all three of its slots on stale
 *  errands while the vow the whole arc turns on sat below the cut. */
export function livePromises(state: SaveState, filter?: (p: PromiseRec) => boolean): PromiseRec[] {
  return (state.world.promises ?? [])
    .filter((p) => p.status === "open" && (!filter || filter(p)))
    .sort((a, b) => b.weight - a.weight || b.made_turn - a.made_turn);
}

export function resolvePromise(state: SaveState, p: PromiseRec, outcome: "kept" | "broken", turn: number): string {
  if (p.status !== "open") return "";
  p.status = outcome;
  const from = p.from, to = p.to;
  const fromName = state.characters[from]?.name ?? "someone";
  const toName = to === "char_player" ? "you" : state.characters[to]?.name ?? "someone";
  const hist = promiseHistory(state, from, to);
  const edge = getEdge(state.world.edges, to, from); // how `to` feels about `from`

  if (outcome === "kept") {
    // reliability compounds: keeping builds trust more than warmth, and a good track record makes
    // each kept promise land a little softer (already expected) — but a big vow kept always matters.
    const base = p.weight === 3 ? 10 : p.weight === 2 ? 6 : 3;
    const familiarity = Math.max(0.6, 1 - hist.kept * 0.08); // slight diminishing returns
    const trustGain = Math.round(base * familiarity);
    const warmthGain = Math.round(trustGain * 0.6);
    applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: warmthGain, trust_delta: trustGain, power_delta: 0, note: `kept a promise: ${p.text}` }, turn, { chars: state.characters, traits: state.traits });
    if (state.memory[to]) state.memory[to].episodic.push({
      turn, content: `${fromName} kept their promise to ${toName === "you" ? "me" : toName}: ${p.text}`,
      importance: Math.min(8, 3 + p.weight * 2), emotional_charge: "trust, relief", last_accessed_turn: turn,
      source: state.world.present.includes(to) ? "witnessed" : "inferred",
    });
    return to === "char_player" ? `${fromName} kept their word: ${p.text}.` : `${fromName} kept a promise to ${toName}.`;
  } else {
    // breaking costs trust hardest, warmth too when the promise was large. A PATTERN of breaking
    // (this isn't the first) deepens the wound sharply — that's when "unreliable" becomes identity.
    const base = p.weight === 3 ? 14 : p.weight === 2 ? 9 : 5;
    const patternMult = 1 + Math.min(1.0, hist.broken * 0.4); // 1st break ×1, 2nd ×1.4, 3rd ×1.8, capped ×2
    // being genuinely trusted softens a FIRST, small break — benefit of the doubt, once
    const soften = (hist.broken === 0 && p.weight === 1 && (edge?.trust ?? 0) >= 40) ? 0.5 : 1;
    const trustLoss = -Math.round(base * patternMult * soften);
    const warmthLoss = -Math.round(base * patternMult * soften * (p.weight === 3 ? 0.8 : 0.45));
    applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: warmthLoss, trust_delta: trustLoss, power_delta: 0, note: `broke a promise: ${p.text}` }, turn, { chars: state.characters, traits: state.traits });
    if (state.memory[to]) state.memory[to].episodic.push({
      turn, content: `${fromName} broke their promise to ${toName === "you" ? "me" : toName}: ${p.text}${hist.broken > 0 ? " — again" : ""}`,
      importance: Math.min(9, 4 + p.weight * 2 + hist.broken), emotional_charge: hist.broken > 0 ? "hurt, hardening, done giving chances" : "hurt, let down", last_accessed_turn: turn,
      source: state.world.present.includes(to) ? "witnessed" : "inferred",
    });
    return to === "char_player" ? `${fromName} broke their word: ${p.text}.` : `${fromName} broke a promise to ${toName}${hist.broken > 0 ? " — not the first time" : ""}.`;
  }
}

// ─────────────────────────── OFF-SCREEN BOND DRIFT ───────────────────────────
// The world shouldn't freeze between scenes. Characters who share a place while the player is away
// slowly warm to or cool from each other based on compatibility — how alike their consciences are
// (do they both care, or both not?) and how much their values overlap. This is a gentle ±1/round
// nudge, so bonds evolve over days offscreen without lurching. Only same-locale, non-present,
// living pairs; the player is never included (their edges are earned in play, not drifted).
function compatibility(a: Identity, b: Identity): number {
  // conscience closeness: two warm people or two cold people are more compatible than a mismatch
  const ca = typeof a.conscience === "number" ? a.conscience : 0.7;
  const cb = typeof b.conscience === "number" ? b.conscience : 0.7;
  const conscienceScore = 1 - Math.abs(ca - cb); // 0..1, 1 = identical temperament
  // value overlap
  const av = (a.values ?? []).map((v) => v.toLowerCase());
  const bv = (b.values ?? []).map((v) => v.toLowerCase());
  const shared = av.filter((v) => bv.some((w) => w === v || w.includes(v) || v.includes(w))).length;
  const valueScore = av.length && bv.length ? shared / Math.max(av.length, bv.length) : 0.3;
  // combine → a target sign: compatible pairs drift warm, incompatible drift cool
  return (conscienceScore * 0.5 + valueScore * 0.5); // 0..1
}

/** Drift warmth ±1 between same-place offscreen pairs toward their compatibility. Returns occasional
 *  human lines for pairs that cross a threshold, so the player can hear a bond shifted while away. */
export function tickBonds(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  // bucket living, offscreen characters by location
  const byLoc = new Map<string, string[]>();
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || state.world.present.includes(id) || c.status === "dead" || c.status === "departed") continue;
    const loc = c.location || "loc_elsewhere";
    (byLoc.get(loc) ?? byLoc.set(loc, []).get(loc)!).push(id);
  }
  for (const group of byLoc.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (rng() > 0.5) continue; // not every pair every round — bonds move slowly
        // GRIEF DOES NOT MAKE FRIENDS. This warms any two offstage people who happen to share a
        // room, toward a ceiling derived from how compatible their CARDS are — which knows nothing
        // about what either of them is living through. So the woman whose marriage detonated last
        // night drifts steadily closer to the man she detonated it with, a point per pass, purely
        // for being in the same building: the story quietly resolves into company and comfort while
        // the person she actually needs to face is across the city and cooling by decay alone.
        // Somebody carrying grief still HAS scenes, and a real scene still moves the number — the
        // bookkeeper's deltas are untouched. What stops is the automatic drift toward fondness.
        if ((state.condition[a]?.psyche?.grief_drag ?? 0) >= 1 || (state.condition[b]?.psyche?.grief_drag ?? 0) >= 1) continue;
        const comp = compatibility(state.characters[a], state.characters[b]);
        const dir = comp >= 0.5 ? 1 : -1; // compatible warm up, incompatible cool
        const e1 = getEdge(state.world.edges, a, b), e2 = getEdge(state.world.edges, b, a);
        const before = e1.warmth;
        // drift toward the compatibility-implied ceiling/floor, never past it
        const ceil = dir > 0 ? 20 + Math.round(comp * 40) : -(10 + Math.round((1 - comp) * 30));
        if ((dir > 0 && e1.warmth < ceil) || (dir < 0 && e1.warmth > ceil)) {
          e1.warmth = clampWarmth(e1.warmth + dir);
          e2.warmth = clampWarmth(e2.warmth + dir);
        }
        // TRUST WAS NEVER IN HERE AT ALL. Warmth drifted between offscreen pairs and trust sat where
        // the forge left it for the whole game, so the cast's bonds only ever moved on one of the two
        // numbers the engine actually reads — and every consumer that gates on trust (co-regulation's
        // safe-person search wants trust ≥ 15, the narrator's lateral-edge block, confiding) went on
        // treating a decade of shared living as the day they met. Trust moves at HALF warmth's rate
        // toward HALF its ceiling: living alongside somebody agreeable earns a little of it slowly,
        // and never as much as fondness. Only on alternate rounds, which is what the half-rate means
        // for an integer step.
        if ((state.world.current_turn + (a < b ? 0 : 1)) % 2 === 0) {
          const tCeil = Math.round(ceil / 2);
          if ((dir > 0 && e1.trust < tCeil) || (dir < 0 && e1.trust > tCeil)) {
            e1.trust = clampWarmth(e1.trust + dir);
            e2.trust = clampWarmth(e2.trust + dir);
          }
        }
        // occasional shift line when a bond crosses a round number (a felt change)
        const crossed = (t: number) => (before < t && e1.warmth >= t) || (before > t && e1.warmth <= t);
        if (dir > 0 && crossed(20)) log.push(`${state.characters[a].name} and ${state.characters[b].name} have been growing closer.`);
        else if (dir < 0 && crossed(-10)) log.push(`Something has cooled between ${state.characters[a].name} and ${state.characters[b].name}.`);
      }
    }
  }
  return log;
}
function clampWarmth(w: number): number { return Math.max(-100, Math.min(100, w)); }
