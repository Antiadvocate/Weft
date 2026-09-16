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

  /* ── APERTURE, AND THE POLARITY IT HAD BACKWARDS ─────────────────────────────────────────────
   *
   * This read: clench narrows to the social business, ease lets the irrelevant in. The author of
   * the system, describing what he built it for: "When I'm relaxed it gives me less details about
   * pointless bullshit. When I'm not relaxed I get more noise."
   *
   * Both are real states and the old one is the wrong one to have as the common case. Acute threat
   * does tunnel the vision, and that is kept at the bottom of the scale. But the ordinary
   * not-relaxed state of a person in a room is not terror, it is distractibility: the mind will not
   * stay on the conversation, it lands on a spider in the corner, it goes to last night's argument,
   * it comes back late. That is the state most turns are in, and it was producing the least noise
   * of any band.
   *
   * The distinction that actually matters is not how MUCH gets in but whether it was CHOSEN. At
   * ease, few things get in and they are the ones this person cares about. Under strain, more gets
   * in and none of it was invited. */
  const affinities = [...(pc?.texture ?? []), ...(pc?.core_traits ?? [])].slice(0, 5);
  const aperture = effective <= -6
    ? `TUNNELLED: nothing enters the frame that is not the people and the immediate business between them. No weather, no room, no passers-by, no ambient sound, no time of day. This is fear doing it, and the absence is the state — do not remark on the absence either.`
    : effective <= -2
    ? `INTRUSIVE: the attention will not stay where it is put. Three or four things arrive uninvited across the turn — an object on the floor, something in the corner, a sound from another room, a piece of unfinished business from earlier today — and NONE of them are relevant, connected, or picked up again. The person is trying to attend to the conversation and keeps failing. Do not tidy this into a mood or explain why any of it surfaced.`
    : effective < 3
    ? `MIDDLING: one thing from outside the social business may enter, briefly, and is not returned to.`
    : `CLEAR: little gets in and what does was worth it — one or two things this person would actually choose to notice, and no ambient furnishing. A settled attention is not a wandering one.`;

  const drawn = affinities.length && effective > -3
    ? `\nWhat gets through is not generic scenery — it is what THIS person's attention snags on unbidden, given: ${affinities.join("; ")}. Not the character demonstrating a trait; the world arriving pre-sorted by one.`
    : "";

  // ORDER. The most under-attended constraint and the cheapest: the first thing
  // in a paragraph is the thing that caught the eye, and nothing else says so.
  const first = atts[0];
  const order = `\nORDER IS ATTENTION: whatever appears first in a paragraph is what caught the player first. Sequence the turn so the ordering is true — this turn the pull is toward ${first?.name ?? "whoever is acting"}. Never explain or justify the ordering, and never write a sentence about the player noticing, attending, or being drawn to anything; the selection does that work silently and naming it destroys it.`;

  /* ── HOW A NOTICING IS WRITTEN, WHICH NOTHING HERE HAD EVER SAID ────────────────────────────
   *
   * Every dial above governs how MUCH gets in and in what ORDER. Nothing governed the grammar, and
   * the grammar is the whole difference between an attention and a camera. So the strays came out
   * as composed description: "The servant with the tray had set it down on a table near the wall
   * and was counting glasses, touching each one with a forefinger, and through the long front
   * windows the street was black and wet." One sentence, three clauses, two conjunctions, past
   * perfect, a settled omniscient calm. Nobody's attention has ever done that.
   *
   * What it does instead, in the author's own words: "she's talking about that kitchen mess last
   * night. Fuck. Eli's toy, a yellow shell, turned sideways." / "corner of the room, a spider. Is
   * it dead? Asleep. Maybe." Fragments. No connective between one landing and the next. A question
   * it does not answer. Two facts about the toy and no third.
   *
   * ONE THING IS DELIBERATELY NOT COPIED FROM THOSE EXAMPLES. His has "I gotta take care of her
   * better" in it, and that is the player's own verdict on himself, which this engine does not get
   * to write — see the bare-acts rule below. The resolution is better than the compromise sounds:
   * the frame puts the toy on the floor and stops. The player supplies the rest, which is what he
   * came for. */
  // Only where there are strays to write. Under TUNNELLED nothing gets in at all, so a rule about
  // how the strays should read would be describing something the band has just forbidden.
  const grammar = effective <= -6 ? ""
    : effective <= -2
    ? `\nHOW A STRAY IS WRITTEN, AT THIS STATE: it lands and it stops. A fragment is correct and a whole sentence is usually wrong. No conjunction joins one noticing to the next — full stop, then the jump, with nothing explaining the jump. Two facts about a thing and no third; name it rather than describing it. The attention may ask itself something and not answer it. It may go somewhere and come back late, mid-exchange, having missed a line. Never write that the player noticed, was distracted, or found their mind wandering — the jump on the page IS the distraction, and naming it turns it back into description.`
    : effective >= 3
    ? `\nHOW A STRAY IS WRITTEN, AT THIS STATE: it can be a whole sentence and settle for a moment, because this attention is not being dragged anywhere. Still no cataloguing, and still no more than the one or two things.`
    : "";

  const bare = `\nTHE PLAYER'S OWN ACTS STAY BARE: render what they did and nothing about how it reads, lands, or is received by the other characters or by the player. An act of theirs that carries a private meaning carries it silently; supplying that meaning is the one thing the player brought and the one thing you must not touch.`;

  return `\n\n=== FRAME (whose attention this is, and what it can hold) ===\nThe prose is what the player's attention did with the room. How much detail each thing gets is set by the state below, and it differs from one thing to the next.\n${lines}\nAPERTURE — ${aperture}${grammar}${drawn}${order}${bare}`;
}
