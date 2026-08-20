/* Smoke test: the four fixes to how this engine models cause and effect in a mind.
 *
 * 1. SEEING HAS TWO ROADS IN. seenProbability alone said a settled body watches its own loop and a
 *    clenched one cannot — 0.7% at r = −7. That made the single most powerful scene available to
 *    fiction, the one where somebody catches themselves mid-pattern at the worst moment of their
 *    life, mechanically impossible for exactly the people it happens to. It was also a claim the
 *    engine had no business making: regulation is not recognition. A calm person can be thoroughly
 *    asleep, and the instruction has always been "look at the anger", never "wait for it to pass".
 *
 * 2. A MODEL THAT KEEPS BEING RIGHT USED TO COST NOTHING. The mind layer treated being WRONG about
 *    someone as the only failure, so a converged, confident, zero-surprise model meant the character
 *    was simply correct and the machinery went quiet. But a settled picture is not the same as
 *    seeing, and the longer it stands the less looking happens. This is the ordinary form of not
 *    knowing someone, and accuracy is no protection from it.
 *
 * 3. TWO RESIDUES. Envy released is a discharge of stalled motion, not an insight. Pride and
 *    contempt had no entry at all, and they are the states a comfortable body holds longest,
 *    because nothing about them hurts enough to ask to be put down.
 *
 * 4. THE CAST HAD NO SOCIAL LIFE WITH EACH OTHER. Offstage events reached witnesses as a memory and
 *    changed no bond; the only thing that ever moved an NPC-to-NPC edge was a drift on how alike two
 *    CARDS are, which knows nothing about what anybody did. Trust was not in that drift at all.
 */
import { seenProbability, intensityProbability, recognitionProbability } from "../src/engine/habits";
import { tickEmotions } from "../src/engine/emotions";
import { updateMind } from "../src/engine/mind";
import { actorValence, applyOffstage } from "../src/engine/offstage";
import { getEdge, tickBonds } from "../src/engine/social";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("recognition", {
    name: "x",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Vela", character_id: "char_v", pronouns: "she/her" } as any);
  registerCharacter(s, { name: "Marcus", character_id: "char_m", pronouns: "he/him" } as any);
  s.world.present = ["char_v"];
  return s;
}

// ── 1. THE SECOND ROAD ───────────────────────────────────────────────────────
{
  check("the calm road is untouched — a settled body still sees clearly",
    seenProbability(5) > 0.95 && recognitionProbability(5, 3) > 0.95, recognitionProbability(5, 3));

  const wasBlind = seenProbability(-7);
  const nowQuiet = recognitionProbability(-7, 3);
  const nowLoud = recognitionProbability(-7, 9);
  check("a clenched body used to be blind by construction", wasBlind < 0.01, wasBlind);
  check("an ordinary moment in that body still mostly passes unseen", nowQuiet > wasBlind && nowQuiet < 0.1, nowQuiet);
  check("but at full volume the door opens — roughly one turn in five", nowLoud > 0.15 && nowLoud < 0.35, nowLoud);
  check("loudness does nothing to a body that is not gripped",
    Math.abs(intensityProbability(4, 10) - intensityProbability(4, 2)) < 1e-9, intensityProbability(4, 10));
  check("a quiet beat is not loud, however deep the clench",
    Math.abs(intensityProbability(-9, 2) - intensityProbability(-9, 0)) < 1e-9);
  check("recognition is never impossible at any state", recognitionProbability(-10, 0) > 0.03);
  check("the two roads never make seeing less likely than calm alone did",
    [-9, -5, 0, 5, 9].every((r) => recognitionProbability(r, 5) >= seenProbability(r)));
}

// ── 2. REIFICATION ───────────────────────────────────────────────────────────
{
  // A settled COOL read: she knows exactly who he is and he is nothing to her. Reification is not
  // about warmth or hostility, it is about how long the looking has been suspended — so the case
  // that isolates it best is a picture nobody would call a misunderstanding.
  const s = world();
  s.characters.char_v.central = true;
  const e = getEdge(s.world.edges, "char_v", "char_player");
  e.warmth = -20; e.trust = -20;

  // thirty turns of a stable, accurate, entirely undramatic read
  for (let t = 1; t <= 30; t++) { s.world.current_turn = t; updateMind(s, "char_v", {}, t); }
  const b = s.minds!.char_v.about.find((x) => x.target === "char_player")!;
  check("a bond that keeps being read right converges", b.confidence >= 0.85, b.confidence);
  check("and the certainty accrues a clock", (b.settled_turns ?? 0) > 6, b.settled_turns);
  check("the model is ACCURATE — this fires on people who are right about each other",
    Math.abs(b.predicted_warmth - -20) < 25, b.predicted_warmth);

  // something real changes, well under the breakthrough wall: it should barely register
  const predBefore = b.predicted_warmth;
  e.warmth = 25;
  s.world.current_turn = 31; updateMind(s, "char_v", {}, 31);
  check("a real change under the wall arrives attenuated — the picture stands in front of the person",
    Math.abs(b.predicted_warmth - predBefore) < Math.abs(25 - predBefore) * 0.6,
    { predBefore, after: b.predicted_warmth });

  // now something that cannot be looked past
  e.warmth = 100;
  s.world.current_turn = 32;
  const r = updateMind(s, "char_v", {}, 32);
  check("when it finally breaks through, the picture does not survive it", (b.settled_turns ?? 0) === 0, b.settled_turns);
  check("and the believer is looking at a person again", b.confidence < 0.85, b.confidence);
  check("the collapse is a beat the narrator can spend", r.lines.some((l) => /first time in a long while/.test(l)), r.lines);
}
{
  // the guard: a fresh, unsettled model is not reified and loses nothing
  const s = world();
  s.characters.char_v.central = true;
  getEdge(s.world.edges, "char_v", "char_player").warmth = 40;
  s.world.current_turn = 1; updateMind(s, "char_v", {}, 1);
  s.world.current_turn = 2; updateMind(s, "char_v", {}, 2);
  const b = s.minds!.char_v.about.find((x) => x.target === "char_player")!;
  check("a young model carries no picture yet", (b.settled_turns ?? 0) <= 1, b.settled_turns);
}
{
  // THE NON-SEALING GUARANTEE. A mind nothing can reach cannot have the collapse, and the collapse
  // is the whole point — so certainty may raise the wall but must never be what closes it.
  const s = world();
  s.characters.char_v.central = true;
  const e = getEdge(s.world.edges, "char_v", "char_player");
  e.warmth = -20;
  for (let t = 1; t <= 40; t++) { s.world.current_turn = t; updateMind(s, "char_v", {}, t); }
  const b = s.minds!.char_v.about.find((x) => x.target === "char_player")!;
  check("the picture reaches full strength", (b.settled_turns ?? 0) >= 20, b.settled_turns);
  e.warmth = 100;
  s.world.current_turn = 41;
  updateMind(s, "char_v", {}, 41);
  check("and a fully reified mind is still reachable by a big enough event", (b.settled_turns ?? 0) === 0, b.settled_turns);
}

// ── 3. RESIDUES ──────────────────────────────────────────────────────────────
{
  const s = world();
  s.world.current_turn = 10;
  const p = s.condition.char_v.psyche;
  p.relaxation = 5;
  p.active_states = ["envy of her sister", "contempt for the new priest", "grief for her father"];
  p.state_ages = { "envy of her sister": 5, "contempt for the new priest": 5, "grief for her father": 5 };
  const shifts = tickEmotions(s);
  const all = shifts.join(" | ");
  check("envy releases as energy to act, not as an insight about oneself",
    /envy of her sister turns into the plain energy to go and do it themselves/.test(all), all);
  check("contempt has a residue at all now, and it is the level ground",
    /contempt for the new priest levels out into seeing them standing on the same ground/.test(all), all);
  check("the residues that were already right are untouched",
    /grief for her father softens into plain love for what was lost/.test(all), all);
}

// ── 4. THE CAST'S OWN BONDS ──────────────────────────────────────────────────
{
  check("valence reads the ACT, not the mood of the sentence", actorValence("Marcus turned the widow away from his door") < 0);
  check("a few words between verb and particle do not lose the act", actorValence("Marcus turned his own brother out into the rain") < 0);
  check("kindness scores kind", actorValence("Marcus sheltered the widow through the storm") > 0);
  check("a plague is dread and says nothing about the person who caught it",
    actorValence("plague took four houses on the north road") === 0);
  check("an ambiguous both moves nothing", actorValence("he killed the wolf and fed the village") === 0);
}
{
  const s = world();
  s.world.current_turn = 12;
  s.characters.char_v.location = "loc_x"; s.characters.char_m.location = "loc_x";
  s.world.places.loc_x = { id: "loc_x", name: "the mill" } as any;
  s.world.present = [];
  const before = getEdge(s.world.edges, "char_v", "char_m").warmth;
  applyOffstage(s, [{ actor: "Marcus", place: "the mill", what: "Marcus refused to help the miller's boy out of the race", witnesses: ["Vela"] } as any]);
  const after = getEdge(s.world.edges, "char_v", "char_m").warmth;
  check("watching somebody do something changes what you think of them", after < before, { before, after });
  check("and it costs trust as well as warmth", getEdge(s.world.edges, "char_v", "char_m").trust < 0);
  check("the witness's own edge is what moved, not the actor's",
    getEdge(s.world.edges, "char_m", "char_v").warmth === 0);
}
{
  // trust used to be absent from offscreen drift entirely
  const s = world();
  s.characters.char_v.location = "loc_x"; s.characters.char_m.location = "loc_x";
  s.characters.char_v.values = ["family", "honest work"]; s.characters.char_m.values = ["family", "honest work"];
  s.characters.char_v.conscience = 0.7; s.characters.char_m.conscience = 0.7;
  s.world.present = [];
  for (let t = 0; t < 40; t++) { s.world.current_turn = t; tickBonds(s, () => 0.1); }
  const e = getEdge(s.world.edges, "char_v", "char_m");
  check("two compatible people sharing a place grow fond offscreen", e.warmth > 10, e.warmth);
  check("and trust now moves too, at half the rate and half the ceiling",
    e.trust > 0 && e.trust < e.warmth, { warmth: e.warmth, trust: e.trust });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
