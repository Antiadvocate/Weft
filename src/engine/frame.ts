// ─────────────────────────────────────────────────────────────────────────────
// THE FRAME
//
// povFilter governs what may be SAID about other people. The read channel gives
// interpretation an owner. Neither one touches the thing that actually carries a
// point-of-view character's interior in good first-person prose: what enters the
// frame at all, in what order, at what resolution, and what gets left out.
//
// The reference passage, in the player's own hand:
//
//   I see her cross her arms, her brow furrows, here we go. She shifts her
//   stance, she looks away from me, her tone terse [...] Eli swings on the
//   swing "Look at how high I am" His voice is light, distracting, he
//   destroys a flower of mine.
//
// No feeling is stated anywhere in it, and the state is fully legible. Anna gets
// six separate bodily registrations in two lines — arms, brow, stance, gaze,
// tone, voice — which is the resolution of someone being monitored for signal.
// Eli gets one coarse action and a line of dialogue, and then the camera returns
// to him twice more, and the second return ends the scene. There is no car, no
// neighbour, no weather, no time of day: the aperture has closed to two people
// and a swing set, and that closure is a clench reading nobody wrote down.
//
// Two independent numbers fall out of that, and conflating them is the mistake:
//
//   SCAN  — resolution per look. Driven by UNCERTAINTY about a person: trust
//           deficit, prediction error, low confidence in your model of them,
//           and desire, which forces scanning as hard as threat does. You read
//           someone finely when you need a signal off them and can't predict it.
//
//   PULL  — how often the camera comes back. Driven by CARE and wanting:
//           warmth and attraction magnitude, an unresolved want involving them.
//
// Anna is high scan, low pull. Eli is low scan, high pull. Both are the emotional
// centre of that passage and they are rendered nothing alike.
//
// Valence does not enter either number, only magnitude. Being into someone
// clenches you the same way being braced against someone does — the body is
// hunting for delta either way, and the prose granularity is identical. The
// difference shows up in what the reads conclude, not in how closely the camera
// looks.
//
// APERTURE is global: how much of the world outside the social business gets in.
// Clench closes it. What comes through when it's open is not generic scenery —
// it is drawn from texture and core traits, the uncaused affinities a person did
// not choose, so a mind that is always cold registers the draft and a mind that
// takes things apart registers the hinge. Some minds admit irrelevance at any
// clench level; that distribution is the person, not a noise floor.
//
// All of this is deterministic and free. Every input already exists in state.
// No model call — this composes a directive and hands it to the narrator.
// ─────────────────────────────────────────────────────────────────────────────

import type { SaveState } from "./types";
import { getEdge } from "./social";
import { clamp01 } from "./num";


export interface Attention {
  id: string;
  name: string;
  scan: number;   // 0..1 — bodily resolution per look
  pull: number;   // 0..1 — how often the camera returns
}

/** Per-present-character attention, from the player's side of the graph only. */
export function attentionOf(state: SaveState, ids: string[], engaged: string[] = []): Attention[] {
  const mind = state.minds?.["char_player"];
  const turn = state.world.current_turn;

  return ids.map((id) => {
    const e = getEdge(state.world.edges, "char_player", id);
    const about = mind?.about?.find((b) => b.target === id);

    const warmth = Math.abs(e.warmth ?? 0) / 100;
    const attraction = Math.abs(e.attraction ?? 0) / 100;
    // Trust only raises scanning when it is NEGATIVE. Being trusted-and-liked is
    // exactly the state where you stop checking someone's face.
    const wariness = Math.max(0, -(e.trust ?? 0)) / 100;
    const surprise = about?.surprise ?? 0;
    // COLD START. No model of someone means maximum unpredictability, not minimum —
    // you watch a stranger's face closely precisely because you cannot call what
    // they will do. Defaulting this low left a fresh game with a flat frame for
    // twenty turns, which is backwards: early scenes are the most scanned ones.
    const unsure = about ? 1 - about.confidence : 0.75;
    const ruptured = e.last_rupture_turn != null && turn - e.last_rupture_turn <= 5 ? 0.3 : 0;
    // Desire that can't be admitted scans hardest — it has nowhere to go but into
    // watching. High admissibility spends the same wanting out loud instead.
    const admiss = e.desire_admissibility ?? 0.5;
    const covert = attraction * (1 - admiss);

    const wants = (state.characters["char_player"]?.drive?.goal ?? "").toLowerCase();
    const named = wants.includes((state.characters[id]?.name ?? "\u0000").toLowerCase().split(/\s+/)[0]);

    return {
      id,
      name: state.characters[id]?.name ?? id,
      scan: clamp01(0.55 * wariness + 0.45 * surprise + 0.45 * unsure + 0.50 * attraction + 0.35 * covert + ruptured),
      // Whoever the player is actually engaged with this turn is, definitionally,
      // where the attention is — the graph supplies the standing pull, this supplies
      // the situational one, and without it a cold save has no ordering at all.
      pull: clamp01(0.75 * warmth + 0.45 * attraction + (named ? 0.35 : 0) + (engaged.includes(id) ? 0.45 : 0)),
    };
  });
}

const band = (v: number) => (v >= 0.66 ? "high" : v >= 0.33 ? "mid" : "low");

const SCAN_TEXT: Record<string, string> = {
  high: "read finely — several separate physical registrations across the turn (hands, brow, stance, where the eyes go, what the voice does). This is the resolution of someone being watched for a signal.",
  mid: "one or two physical details, no more.",
  low: "barely registered physically — an action and what they said. No inventory of their body.",
};

const PULL_TEXT: Record<string, string> = {
  high: "the frame RETURNS to them, more than once, including at least one return that interrupts something else. They are what the attention keeps going back to.",
  mid: "the frame comes back to them once.",
  low: "seen when they act, not otherwise.",
};

/** The per-turn framing directive. Deterministic; no model call. */
export function frameDirective(state: SaveState, presentIds: string[], engaged: string[] = []): string {
  // world.present only contains ROSTERED characters standing in the player's exact location. A
  // scene can be full of people who are none of those — a captain, twenty riders, a watchman,
  // all real to the reader and all absent from state.characters. Returning "" there switched the
  // whole frame off silently in exactly the scenes with the least other constraint, which is
  // where the prose went worst. The per-person lines need a roster; aperture, ordering, and the
  // bare-acts rule do not, and those still apply to a courtyard of strangers.
  const ids = presentIds.filter((id) => id !== "char_player" && state.characters[id]);

  const pc = state.characters["char_player"];
  const relax = state.condition["char_player"]?.psyche?.relaxation ?? 0;
  // CAPACITY AS A FLOOR ON THE APERTURE.
  // Aperture keyed to relaxation alone makes everyone the same person under stress, and the
  // clearest counterexample is a constitutionally curious character in appalling conditions:
  // clenched, and still registering the light. Capacity is the resting point relaxation drifts
  // toward — a trait, not a circumstance — so it belongs here as the thing clench cannot push
  // past. High capacity keeps one channel open at any clench level; low capacity closes early
  // and stays closed even when things are calm.
  const capacity = state.condition["char_player"]?.psyche?.capacity ?? 0;
  const effective = relax + Math.max(0, capacity) * 0.45;
  const atts = attentionOf(state, ids, engaged).sort((a, b) => (b.scan + b.pull) - (a.scan + a.pull));

  const lines = atts.length
    ? atts.map((a) => `- ${a.name}: ${SCAN_TEXT[band(a.scan)]} ${PULL_TEXT[band(a.pull)]}`).join("\n")
    : `- Nobody in this scene is someone the player has a settled model of. ${SCAN_TEXT.high} Strangers are the most scanned people there are; resolution is high and stays on whoever is doing something.`;

  // APERTURE. Clench narrows the world to the social business; ease lets the
  // irrelevant in. What gets in is the player's own conditioning, not scenery.
  const affinities = [...(pc?.texture ?? []), ...(pc?.core_traits ?? [])].slice(0, 5);
  const aperture = effective <= -3
    ? `NARROW: nothing enters the frame that is not the people and the immediate business between them. No weather, no room, no passers-by, no ambient sound, no time of day. If something irrelevant would normally be noticed, it is not noticed this turn — the absence is the state, and you must not remark on the absence either.`
    : effective < 3
    ? `MIDDLING: one thing from outside the social business may enter, briefly, and is not returned to.`
    : `OPEN: two or three things outside the business may enter — including things that have nothing to do with anything, that go nowhere, and that are never picked back up. Irrelevance is the signal here; do not make the stray detail turn out to matter.`;

  const drawn = affinities.length && effective > -3
    ? `\nWhat gets through is not generic scenery — it is what THIS person's attention snags on unbidden, given: ${affinities.join("; ")}. Not the character demonstrating a trait; the world arriving pre-sorted by one.`
    : "";

  // ORDER. The most under-attended constraint and the cheapest: the first thing
  // in a paragraph is the thing that caught the eye, and nothing else says so.
  const first = atts[0];
  const order = `\nORDER IS ATTENTION: whatever appears first in a paragraph is what caught the player first. Sequence the turn so the ordering is true — this turn the pull is toward ${first?.name ?? "whoever is acting"}. Never explain or justify the ordering, and never write a sentence about the player noticing, attending, or being drawn to anything; the selection does that work silently and naming it destroys it.`;

  const bare = `\nTHE PLAYER'S OWN ACTS STAY BARE: render what they did and nothing about how it reads, lands, or is received — not to the other characters and not to the player. An act of theirs that carries a private meaning carries it silently; supplying that meaning is the one thing the player brought and the one thing you must not touch.`;

  return `\n\n=== FRAME (whose attention this is, and what it can hold) ===\nThe prose is not a camera in the room; it is what the player's attention did with the room. Resolution is not uniform and is not a style choice — it is the state.\n${lines}\nAPERTURE — ${aperture}${drawn}${order}${bare}`;
}
