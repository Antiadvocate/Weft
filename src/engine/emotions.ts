/**
 * Emotions — the lifecycle of feeling, and how bodies regulate each other. Deterministic, zero tokens.
 *
 * Two mechanics, both keyed to the relaxation kernel:
 *
 * 1. THE LIFECYCLE (tickEmotions). An emotion is an event, not a possession. What happens to it
 *    depends on the body holding it:
 *    - SETTLED body (relaxation high): the state dissolves on its own after a couple of turns —
 *      felt fully, not fed. And it doesn't just vanish: it leaves its information behind. Anger
 *      settles into a clear view of what was actually wrong; fear into alertness to what matters;
 *      grief into plain love for what was lost. The feeling was carrying something; released, the
 *      something stays.
 *    - CLENCHED body (relaxation low): the state is re-told instead of felt. Past a few turns it
 *      starts feeding on itself — a small relaxation drain each turn, because the reaction to the
 *      pain has become its own pain (the first hit is the event; the second hit is the story about
 *      the event, and the second one is optional and self-inflicted). It also colonizes the mood.
 *    - Moods themselves are weather: a mood the simulator set turns ago fades once the body settles.
 *
 * 2. CO-REGULATION (tickCoRegulation). Nervous systems are not closed, and they couple at TWO
 *    scales:
 *    - PAIRWISE: a settled person you trust, present in the room, pulls you toward settled — that
 *      is what a safe person is FOR. But HOW a body uses people under threat differs (clinical
 *      attachment, stable per person): secure takes the comfort straight; anxious runs hot
 *      (soothed strongly by presence, but scared and alone the alarm feeds itself); avoidant runs
 *      cold (under real threat closeness is pressure, not comfort); disorganized reaches for the
 *      comfort and flinches from it in the same motion.
 *    - MEAN-FIELD: the weaker pull of the room's aggregate state. Rooms have weather, and bodies
 *      lean toward it — the calm that holds a frightened stranger, the panic that takes a whole
 *      crowd. The nudge strengthens when the room is lopsided (nearly everyone on the same side
 *      of neutral); that asymmetry is where collective phase transitions live. Deliberately weak
 *      (±0.3 max) and additive: it biases the kernel, never overwrites it — the deleted Kuramoto
 *      layer died for overwriting, and this one is built to not repeat it.
 *
 * 3. DISCHARGE (tickDischarge). Contraction held past capacity does not taper off — it lets go.
 *    A body that was deep-clenched at the turn's start and comes all the way back above the
 *    fracturing line within the turn (the narrator's sob, laugh, shaking exhale, carried by the
 *    simulator's deltas) completes the stress cycle: the oldest gripped emotion transmutes on the
 *    spot with its residue, the colonized mood clears, and the body earns a temporary capacity
 *    lift — for a while it can rest more open than its nature. This is the dramatic arc the
 *    homeostat alone only performs silently.
 *
 *    The player's interior is never authored anywhere in this file: the player can BE someone's
 *    safe person, but the engine never moves the player's own relaxation, and their release is
 *    theirs to report through the tightness anchor.
 *
 *    RELEASING IS NOT AUTHORING. That rule used to be enforced by skipping the player in the
 *    lifecycle entirely, which quietly made the player the one person in the game who could never
 *    put a feeling down. Everyone else sheds; you only accumulate. One save at turn 122 had a man
 *    reading as flat, clean and moving on in the prose while his card still carried "obsessive",
 *    "devastated" and "hyper-aware of her sounds" — stamped around turn 70 and never released — plus
 *    a mood that had degenerated into a stuck loop: a card describing someone he had stopped being
 *    fifty turns earlier. Writing a new feeling
 *    onto the player is authorship and stays forbidden; letting one that has run its course go is
 *    the opposite of authorship, and the player gets it like anyone else.
 */
// SIMULATION LOD IS NOT RENDER LOD, and `central` was gating both.
//
// A background character was excluded from the emotion lifecycle, discharge, desire, rivalry and
// repair — every one of which is pure arithmetic over numbers already in the save. Measured: zero
// LLM references in emotions.ts, desire.ts, fault.ts, social.ts, remodel.ts. Excluding them saved
// nothing at all, because what actually costs tokens is the CARD, and a background character's card
// is one line either way (prompts.ts renders them as name + bearing and stops).
//
// So the two questions get separated. Who gets simulated: everybody, always, for free. Who gets
// rendered in detail: the central cast, unchanged. A vendor with a nervous system costs the same as
// a vendor without one, and when the scene finally turns to them they are somebody rather than
// furniture that has been standing there at capacity since the turn they were named.
import type { SaveState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Structural states other systems own — the lifecycle leaves them alone. */
const STRUCTURAL = [/^fixated on /i];

/** What a released emotion leaves behind — the feeling's information, kept after the charge goes. */
const TRANSMUTE: { match: RegExp; residue: string }[] = [
  { match: /anger|angry|rage|furious|fury|resent/i, residue: "settles into a clear view of what was actually wrong" },
  { match: /fear|afraid|dread|terrif|anxious|anxiety|worry/i, residue: "settles into plain alertness to what matters" },
  { match: /grief|griev|mourn|loss|bereft|devastat/i, residue: "softens into plain love for what was lost" },
  // Envy released is not an insight, it is a discharge of stalled motion: what the wanting was
  // doing all along was pointing at something, and pointing is all it was ever able to do. Let go
  // of, the same charge is simply available to move with — the residue of envy is ENERGY, not
  // understanding, which is why the person who stops envying tends to go and do the thing.
  { match: /jealous|envy|envious/i, residue: "turns into the plain energy to go and do it themselves" },
  // Pride and contempt were missing entirely, and they are the commonest states a settled body
  // holds without noticing it holds anything — nothing about them hurts, so nothing asks to be put
  // down. What they cost is the ability to see anyone as standing on the same ground; released,
  // that is exactly what comes back.
  { match: /\bpride\b|prideful|contempt|disdain|scorn|smug|condescen|superior/i,
    residue: "levels out into seeing them standing on the same ground" },
  { match: /shame|humiliat|embarrass|guilt/i, residue: "loosens into honesty about what happened" },
  { match: /hurt|betray|wounded/i, residue: "settles into knowing exactly where the line is now" },
];

function residueFor(stateName: string): string {
  for (const t of TRANSMUTE) if (t.match.test(stateName)) return t.residue;
  return "passes on its own — felt fully, not fed";
}

/** A mood is weather: a few words for how someone is carrying themselves right now.
 *
 *  Models sometimes fall into a repetition loop on this field, and what lands in state is a stuck
 *  record: "…not the quiet after the door closes. The quiet after the door closes, the quiet after
 *  the door closes. The quiet after the door closes." That degenerate string then renders on the
 *  card AND goes back into the next prompt as the character's current weather, which is how it
 *  keeps happening. Keep the first few distinct clauses and drop the loop. */
export function cleanMood(raw: unknown): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.split(/[;,.]+/).map((x) => x.trim()).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    // "not the quiet after the door closes" is the same loop as "the quiet after the door closes";
    // normalise the leading filler away so a negated echo counts as the repeat it is
    let k = part.toLowerCase();
    for (let prev = ""; k !== prev; ) { prev = k; k = k.replace(/^(not|still|and|but|then|the|a|an)\s+/, ""); }
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(part);
  }
  let out = kept.slice(0, 3).join(", ");
  if (out.length > 140) out = out.slice(0, 140).replace(/[\s,;]+\S*$/, "");
  return out;
}

/** Stamp ages for states that arrived without one (simulator adds, older saves). */
export function stampStateAges(state: SaveState): void {
  const turn = state.world.current_turn;
  for (const id of Object.keys(state.condition)) {
    const p = state.condition[id].psyche;
    p.state_ages ??= {};
    for (const st of p.active_states) if (p.state_ages[st] === undefined) p.state_ages[st] = turn;
    for (const k of Object.keys(p.state_ages)) if (!p.active_states.includes(k)) delete p.state_ages[k];
  }
}

/** How long an emotional state may sit before it is released whether or not the body ever settles.
 *
 *  Self-liberation needs relaxation >= 3, and someone in real trouble never gets there — a clenched
 *  body holds every state it is ever given, forever. That is not endurance, it is a stuck bit: the
 *  scene has moved on, the prose has moved on, and the card is still reporting a feeling from
 *  seventy turns ago. `state_ages` is refreshed every time the bookkeeper names a state again, so
 *  this only ever retires something nothing in the story has touched since — a feeling that has
 *  outlived its own cause. It still leaves its residue on the way out. */
const STATE_MAX_TURNS = 20;

export function tickEmotions(state: SaveState): string[] {
  const shifts: string[] = [];
  const turn = state.world.current_turn;
  stampStateAges(state);
  // the player is not in world.present (that list is who is in the room WITH them), so they have to
  // be named explicitly or the lifecycle never reaches them at all
  for (const id of [...new Set([...state.world.present, "char_player"])]) {
    const c = state.characters[id];
    const cond = state.condition[id];
    if (!c || !cond) continue;
    // The player gets the RELEASE half only. Nothing below may write them a feeling, move their
    // relaxation, or decide their weather — those stay theirs. Letting go of what has run its
    // course is not authorship.
    const isPlayer = id === "char_player";
    const p = cond.psyche;
    const r = p.relaxation;
    const emotional = p.active_states.filter((st) => !STRUCTURAL.some((rx) => rx.test(st)));

    for (const st of emotional) {
      const age = turn - (p.state_ages?.[st] ?? turn);
      // RUNNING IS ALSO GRIPPING, and it is the one the relaxation number cannot see. Self-liberation
      // asks "is anything holding this?" and reads the answer off the body being settled. A person
      // pouring themselves into fixing things with somebody looks settled — busy, warm, agreeable,
      // relaxation fine — and is holding on hard: the feeling is not being felt, it is being outrun,
      // and a feeling nobody sits still with never completes. So while the repair loop runs, nothing
      // of theirs releases, however open the body reads. What they outran is stored in `unfelt` and
      // arrives when they finally stop (see engine/fault.ts).
      const settledOut = r >= 3 && age >= 2 && !p.repairing;
      const outlived = age >= STATE_MAX_TURNS; // nothing has touched it in a very long time
      if (settledOut || outlived) {
        // SELF-LIBERATION: released, and it leaves its information behind.
        p.active_states = p.active_states.filter((x) => x !== st);
        if (p.state_ages) delete p.state_ages[st];
        shifts.push(`${c.name}'s ${st} ${residueFor(st)}.`);
      } else if (!isPlayer && r <= -3 && age === 3) {
        // SECOND HIT: announced once, when the re-telling starts.
        shifts.push(`${c.name} keeps re-telling the ${st} — the reaction has become its own pain now.`);
      }
    }
    // while clenched with an aged emotional state, the story feeds itself: small ongoing drain
    if (!isPlayer && r <= -3 && emotional.some((st) => turn - (p.state_ages?.[st] ?? turn) >= 3)) {
      p.relaxation = clamp(+(p.relaxation - 0.2).toFixed(2), -10, 10);
      // the oldest emotion colonizes the weather
      const oldest = emotional.slice().sort((a, b) => (p.state_ages?.[a] ?? turn) - (p.state_ages?.[b] ?? turn))[0];
      if (oldest && (p.mood === "even" || !p.mood)) p.mood = oldest;
    }
    // moods are weather: a stale mood fades once the body settles — or, for a body that never
    // settles, once it has plainly outlasted the day it was set on
    if (p.mood && p.mood !== "even" && p.mood_set_turn !== undefined) {
      const age = turn - p.mood_set_turn;
      if ((r >= 2 && age >= 4) || age >= STATE_MAX_TURNS) {
        shifts.push(`${c.name}'s ${p.mood} passed — weather, not climate.`);
        p.mood = "even";
        p.mood_set_turn = turn;
      }
    }
  }
  return shifts;
}

/** Style multiplier for how much a present safe person's calm actually lands. */
function coRegFactor(style: string | undefined, threatened: boolean, turn: number, id: string): number {
  switch (style) {
    case "anxious": return 1.2;              // presence soothes strongly (the whole system aims at it)
    case "avoidant": return threatened ? 0 : 0.3;  // under real threat, closeness is pressure, not comfort
    case "disorganized": {
      let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      return ((turn + Math.abs(h)) % 3 === 0) ? -0.4 : 0.8;  // helps most turns, stings some — comfort and threat in the same motion
    }
    default: return 1.0;                     // secure: takes the comfort straight
  }
}

export function tickCoRegulation(state: SaveState): string[] {
  const shifts: string[] = [];
  const turn = state.world.current_turn;
  for (const id of state.world.present) {
    const c = state.characters[id];
    const cond = state.condition[id];
    if (!c || !cond || id === "char_player") continue;
    const p = cond.psyche;
    const threatened = p.relaxation <= -3;

    // find the best safe person in the room: warm, trusted, and more settled than me
    let best: { relax: number; name: string } | null = null;
    for (const other of ["char_player", ...state.world.present]) {
      if (other === id) continue;
      const e = state.world.edges.find((x) => x.from === id && x.to === other);
      if (!e || e.warmth < 35 || e.trust < 15) continue;
      const or = other === "char_player" ? 3 : (state.condition[other]?.psyche.relaxation ?? 0); // a present player counts as steady company
      if (or >= 2 && or > p.relaxation && (!best || or > best.relax)) best = { relax: or, name: state.characters[other]?.name ?? "someone" };
    }

    if (best) {
      const f = coRegFactor(c.attachment?.style, threatened, turn, id);
      if (f !== 0) {
        const pull = clamp((best.relax - p.relaxation) * 0.08 * f, -0.5, 0.5);
        const before = p.relaxation;
        p.relaxation = clamp(+(p.relaxation + pull).toFixed(2), -10, 10);
        if (f < 0 && before > p.relaxation && threatened)
          shifts.push(`${c.name} wants the comfort and flinches from it in the same motion.`);
      }
    } else if (threatened && c.attachment?.style === "anxious") {
      // scared, and nobody safe in the room: the alarm feeds itself
      p.relaxation = clamp(+(p.relaxation - 0.15).toFixed(2), -10, 10);
    }
  }

  // ── MEAN-FIELD PASS — after every pairwise read, the room's aggregate leans on everyone. ──
  // The field is the mean relaxation of the present cast (the player counts as steady company,
  // same convention as pairwise). Applied to NPCs only; the player's body is theirs.
  const roomIds = state.world.present.filter((pid) => state.characters[pid] && pid !== "char_player");
  if (roomIds.length >= 2) {
    const vals = roomIds.map((pid) => state.condition[pid]?.psyche.relaxation ?? 0);
    // this tick only runs on player-present turns, and the player counts as steady company —
    // the exact convention the pairwise pass above uses when it prepends char_player to the room
    vals.push(3);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // lopsidedness: when nearly the whole room sits on the same side of neutral, the weather is
    // real and the pull strengthens — a unanimous calm holds people; a unanimous bracing sweeps them.
    const sameSide = vals.filter((v) => (mean >= 0 ? v >= 0 : v < 0)).length / vals.length;
    const boost = sameSide >= 0.75 ? 1.6 : 1.0;
    let loudest: { name: string; pull: number } | null = null;
    for (const id of roomIds) {
      const c = state.characters[id];
      const cond = state.condition[id];
      if (!c || !cond) continue;
      const p = cond.psyche;
      if (Math.abs(mean - p.relaxation) <= 1) continue; // dead zone: no jitter when already near the weather
      const pull = clamp((mean - p.relaxation) * 0.03 * boost, -0.3, 0.3);
      if (pull === 0) continue;
      p.relaxation = clamp(+(p.relaxation + pull).toFixed(2), -10, 10);
      if (Math.abs(pull) >= 0.2 && (!loudest || Math.abs(pull) > Math.abs(loudest.pull))) loudest = { name: c.name, pull };
    }
    // at most one line, and only when the field meaningfully moved somebody — weather should be felt, not spammed
    if (loudest) {
      shifts.push(loudest.pull > 0
        ? `the room's ease reaches ${loudest.name}.`
        : `the room's bracing gets into ${loudest.name}.`);
    }
  }
  return shifts;
}

/** DISCHARGE — release from depth. Contraction held past capacity doesn't taper off; it lets go.
 *
 *  Detected against the start-of-turn baseline (psyche.prev_relaxation, captured in turn.ts before
 *  any drift or deltas): the body was deep-clenched (≤ -7, with the clench counter or a fracture
 *  state to prove it was HELD, not just visited) and within one turn it came all the way back
 *  above the fracturing line with a rise of ≥ 2.5. Drift alone can't fire this — a body drifting
 *  home overnight resets its clench counter at the start-of-turn tick, so only a genuine mid-turn
 *  release (carried by the simulator's deltas) qualifies.
 *
 *  Completion has consequences:
 *   - the OLDEST gripped emotional state transmutes immediately with its residue — felt fully at
 *     last, the charge AND the story about the charge both go
 *   - the colonized mood clears (the weather the grip made dissipates with it)
 *   - a temporary capacity lift (+1.5, decaying ×0.7/turn in tickPsyche): for a while the body can
 *     rest more open than its nature. An opening, not a personality change.
 *
 *  Player excluded: their release is theirs to report through the tightness anchor, never authored. */
export function tickDischarge(state: SaveState): string[] {
  const shifts: string[] = [];
  const turn = state.world.current_turn;
  for (const id of state.world.present) {
    const c = state.characters[id];
    const cond = state.condition[id];
    if (!c || !cond || id === "char_player") continue;
    const p = cond.psyche;
    const prev = p.prev_relaxation;
    if (prev === undefined) continue;
    const wasHeld = prev <= -7 && (p.consecutive_clenched >= 3 || p.state !== "intact");
    const rose = p.relaxation - prev;
    if (!wasHeld || p.relaxation <= -4 || rose < 2.5) continue;

    const emotional = p.active_states.filter((st) => !STRUCTURAL.some((rx) => rx.test(st)));
    const oldest = emotional.slice().sort((a, b) => (p.state_ages?.[a] ?? turn) - (p.state_ages?.[b] ?? turn))[0];
    if (oldest) {
      p.active_states = p.active_states.filter((x) => x !== oldest);
      if (p.state_ages) delete p.state_ages[oldest];
      shifts.push(`${c.name}'s held ${oldest} finally discharges — ${residueFor(oldest)}, and the story about it goes too.`);
    } else {
      shifts.push(`something held in ${c.name} finally lets go — the body shakes it off and settles.`);
    }
    if (p.mood && p.mood !== "even") { p.mood = "even"; p.mood_set_turn = turn; }
    p.discharge_lift = 1.5;
    // AND IT IS COUNTED. The lift decays within a week of turns because one release is an opening
    // and not a personality change — that stays true. But a body that has come all the way back from
    // depth three separate times over a save has learned something the lift cannot carry, and the
    // count is what remodel.ts reads to pay that into the resting point itself.
    p.discharges = (p.discharges ?? 0) + 1;
  }
  return shifts;
}
