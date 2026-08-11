/* Smoke test: FOUR EMOTIONAL RESILIENCE MODIFIERS ON ONE WOMAN BY TURN 13.
 *
 * From a save at turn 13, Marcella's acquired traits:
 *
 *   manipulative                      intensity 0.00   self_weight 3.5   reinforced 6
 *   Resilient pragmatism              turn 1    "reorients toward the most actionable information
 *                                                available instead of pressing the point"
 *   will not beg                      turn 10   "accepts the loss rather than ask for another chance"
 *   finality in the face of erasure   turn 12   "does not linger, does not listen, states the truth
 *                                                of her reduced status"
 *
 * The last three are one behaviour under three names — rejection, then disengage without pleading —
 * acquired on three near-consecutive turns, each from a SINGLE beat, each at reinforcement_count 1.
 *
 * They never merged because reinforceOrMergeTrait compares LABELS, and those labels share no words
 * at all: every pair scores 0.00. Comparing the behavioural_impact instead does not rescue it —
 * those three descriptions score 0.07 on token overlap, because a model naming a trait invents fresh
 * vocabulary every time. There is no string measure that catches this.
 *
 * What is actually wrong is upstream of the matching: nothing rate-limited planting, so a reaction
 * to one event became a permanent disposition, three turns running. The habit engine already argues
 * the case for contradictions — arcs are earned, not flipped — and acquisition is the same claim.
 *
 * And "manipulative" sat at intensity 0.00 with self_weight 3.5: kept by the dissolution gate,
 * correctly, and kept decaying to nothing. Still on the card, still rendered every turn, exerting no
 * force at all and holding one of eight slots.
 */
import { reinforceOrMergeTrait, decayTraits, plantedRecently, TRAIT_PLANT_COOLDOWN } from "../src/engine/social";
import type { AcquiredTrait } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const incoming = (label: string, impact: string) => ({ label, origin: "a rejection", behavioral_impact: impact, intensity: 3 });

/* the three from the save, in the order and on the turns they arrived */
const CASCADE: [number, string, string][] = [
  [10, "will not beg", "When a relationship is clearly beyond recovery, she accepts the loss rather than ask for another chance"],
  [11, "Resilient pragmatism", "When blocked or ignored, she reorients toward the most actionable information available"],
  [12, "finality in the face of erasure", "when she decides the door is closed, she does not linger, does not listen"],
];

/** The gate as turn.ts applies it. */
function offer(traits: AcquiredTrait[], turn: number, label: string, impact: string): boolean {
  if (plantedRecently(traits, turn)) {
    const before = traits.length;
    if (reinforceOrMergeTrait(traits, incoming(label, impact), turn) === "planted") { traits.length = before; return false; }
    return true;
  }
  reinforceOrMergeTrait(traits, incoming(label, impact), turn);
  return true;
}

/* ── 1. the cascade, reproduced ───────────────────────────────────────────────── */
{
  const traits: AcquiredTrait[] = [];
  const took = CASCADE.map(([turn, label, impact]) => offer(traits, turn, label, impact));
  check("the first is taken", took[0] === true);
  check("the second, one turn later, is not", took[1] === false);
  check("nor the third", took[2] === false);
  check("she ends with one trait, not three", traits.length === 1, traits.map((t) => t.label));
  check("and it is the one she actually earned first", traits[0].label === "will not beg", traits[0].label);
}

/* ── 2. ...but the arc still forms, given room ────────────────────────────────── */
{
  const traits: AcquiredTrait[] = [];
  offer(traits, 10, "will not beg", "accepts the loss");
  offer(traits, 10 + TRAIT_PLANT_COOLDOWN, "keeps her own counsel", "says less than she knows");
  check("a trait a full cooldown later is taken", traits.length === 2, traits.map((t) => t.label));
}

/* ── 3. reinforcement is never rate-limited ───────────────────────────────────── */
{
  const traits: AcquiredTrait[] = [];
  offer(traits, 10, "will not beg", "accepts the loss");
  const before = traits[0].intensity;
  const took = offer(traits, 11, "will not beg again", "accepts the loss");   // shares a label word
  check("seeing the same thing again is allowed immediately", took === true);
  check("it deepens what she has", traits.length === 1 && traits[0].intensity > before, traits[0]);
  check("and counts as a reinforcement", traits[0].reinforcement_count === 2, traits[0].reinforcement_count);
}

/* ── 4. a first trait is never blocked ────────────────────────────────────────── */
{
  const traits: AcquiredTrait[] = [];
  check("an empty record has nothing to be too soon after", !plantedRecently(traits, 1));
  check("so the first one lands", offer(traits, 1, "watchful", "reads the room before speaking") === true);
}

/* ── 5. a well-worn trait does not block anything ─────────────────────────────── */
{
  // reinforcement_count above 1 means it stopped being a fresh plant, so it no longer holds the door
  const traits: AcquiredTrait[] = [{
    id: "t1", label: "watchful", origin: "", behavioral_impact: "", intensity: 6,
    self_weight: 5, last_reinforced_turn: 12, reinforcement_count: 7,
  }];
  check("an established trait is not a recent plant", !plantedRecently(traits, 13));
  check("so a genuinely new one is still allowed", offer(traits, 13, "will not beg", "accepts the loss") === true);
}

/* ── 6. an identity trait keeps force instead of decaying to nothing ──────────── */
{
  const t: AcquiredTrait[] = [{
    id: "t1", label: "manipulative", origin: "survival", behavioral_impact: "tests loyalty through deception",
    intensity: 0.3, self_weight: 3.5, last_reinforced_turn: 1, reinforcement_count: 6,
  }];
  const { kept } = decayTraits(t, 200);
  check("it is still held, because she identifies with it", kept.length === 1, kept);
  check("but never at zero force", kept[0].intensity >= 1, kept[0].intensity);
}

/* ── 7. a trait nobody identifies with still dissolves ────────────────────────── */
{
  const t: AcquiredTrait[] = [{
    id: "t1", label: "startled by dogs", origin: "one afternoon", behavioral_impact: "flinches",
    intensity: 1.2, self_weight: 1, last_reinforced_turn: 1, reinforcement_count: 1,
  }];
  const { kept, log } = decayTraits(t, 60);
  check("disuse still dissolves a shallow trait", kept.length === 0, kept);
  check("and says so", log.some((l) => /dissolved/.test(l)), log);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
