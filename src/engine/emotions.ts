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
 * 2. CO-REGULATION (tickCoRegulation). Nervous systems are not closed. A settled person you trust,
 *    present in the room, pulls you toward settled — that is what a safe person is FOR. But HOW a
 *    body uses other people under threat differs (clinical attachment, stable per person):
 *    - secure: takes the comfort straight; settles near safe people, explores from there.
 *    - anxious: runs HOT toward people — soothed strongly by presence, but when scared with no safe
 *      person in the room, the alarm feeds itself (protest: escalate, cling, re-check).
 *    - avoidant: runs COLD — comfort barely lands, and when actually threatened, closeness itself
 *      is pressure: a warm person leaning in does nothing (they settle alone, later).
 *    - disorganized: wants the comfort and fears it in the same motion — presence helps some turns
 *      and stings on others.
 *    The player's interior is never authored: the player can BE someone's safe person, but the
 *    engine never moves the player's own relaxation here.
 */
import type { SaveState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Structural states other systems own — the lifecycle leaves them alone. */
const STRUCTURAL = [/^fixated on /i];

/** What a released emotion leaves behind — the feeling's information, kept after the charge goes. */
const TRANSMUTE: { match: RegExp; residue: string }[] = [
  { match: /anger|angry|rage|furious|fury|resent/i, residue: "settles into a clear view of what was actually wrong" },
  { match: /fear|afraid|dread|terrif|anxious|anxiety|worry/i, residue: "settles into plain alertness to what matters" },
  { match: /grief|griev|mourn|loss|bereft/i, residue: "softens into plain love for what was lost" },
  { match: /jealous|envy|envious/i, residue: "settles into knowing what they actually want" },
  { match: /shame|humiliat|embarrass|guilt/i, residue: "loosens into honesty about what happened" },
  { match: /hurt|betray|wounded/i, residue: "settles into knowing exactly where the line is now" },
];

function residueFor(stateName: string): string {
  for (const t of TRANSMUTE) if (t.match.test(stateName)) return t.residue;
  return "passes on its own — felt fully, not fed";
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

export function tickEmotions(state: SaveState): string[] {
  const shifts: string[] = [];
  const turn = state.world.current_turn;
  stampStateAges(state);
  for (const id of state.world.present) {
    const c = state.characters[id];
    const cond = state.condition[id];
    if (!c || !cond || id === "char_player" || c.central === false) continue; // player's interior is theirs
    const p = cond.psyche;
    const r = p.relaxation;
    const emotional = p.active_states.filter((st) => !STRUCTURAL.some((rx) => rx.test(st)));

    for (const st of emotional) {
      const age = turn - (p.state_ages?.[st] ?? turn);
      if (r >= 3 && age >= 2) {
        // SELF-LIBERATION: nothing is gripping it, so it goes — and leaves its information.
        p.active_states = p.active_states.filter((x) => x !== st);
        if (p.state_ages) delete p.state_ages[st];
        shifts.push(`${c.name}'s ${st} ${residueFor(st)}.`);
      } else if (r <= -3 && age === 3) {
        // SECOND HIT: announced once, when the re-telling starts.
        shifts.push(`${c.name} keeps re-telling the ${st} — the reaction has become its own pain now.`);
      }
    }
    // while clenched with an aged emotional state, the story feeds itself: small ongoing drain
    if (r <= -3 && emotional.some((st) => turn - (p.state_ages?.[st] ?? turn) >= 3)) {
      p.relaxation = clamp(+(p.relaxation - 0.2).toFixed(2), -10, 10);
      // the oldest emotion colonizes the weather
      const oldest = emotional.slice().sort((a, b) => (p.state_ages?.[a] ?? turn) - (p.state_ages?.[b] ?? turn))[0];
      if (oldest && (p.mood === "even" || !p.mood)) p.mood = oldest;
    }
    // moods are weather: a stale mood fades once the body settles
    if (p.mood && p.mood !== "even" && r >= 2 && p.mood_set_turn !== undefined && turn - p.mood_set_turn >= 4) {
      shifts.push(`${c.name}'s ${p.mood} passed — weather, not climate.`);
      p.mood = "even";
      p.mood_set_turn = turn;
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
    if (!c || !cond || id === "char_player" || c.central === false) continue;
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
  return shifts;
}
