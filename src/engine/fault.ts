/**
 * FAULT — the channel that was missing, and the pattern that needed it.
 *
 * Every emotional mechanic in this engine reads what was done TO somebody. `wasAbused` stops the
 * person who was sworn at from settling. `betrayals` counts the times you gave in against your own
 * want. `grief_drag` is what loss does to your resting point. `tickRivalry` is watching someone
 * else's pursuit land. Relaxation deltas come from events arriving. Warmth and trust are how you
 * feel about them.
 *
 * Nothing, anywhere, read what a person DID. There is no cost to being the one who caused it, which
 * means cruelty is free and — worse for the fiction — nobody in this world has ever been in the
 * wrong and known it. `applyStances` even pays you for it: refusing is "free, and it hands a point
 * of self back", so a character who is harsh to somebody who loves them gains. The cast could be
 * wronged, and could resent, and could withdraw. They could not be at fault.
 *
 * WHAT THIS IS ACTUALLY FOR, though, is narrower and more particular than guilt in general:
 *
 *     "People who are so attached that in their guilt they want to apologize, in their hurt they
 *      want to do anything to fix things, without fixing their own emotions or recognizing how
 *      they're hurt."
 *
 * That is not healthy repair and it must not be modelled as healthy repair. The person is not
 * processing anything — the fixing is what they are doing INSTEAD of feeling it. It is the second
 * hit wearing a different coat: where a clenched body normally re-tells the pain until the story
 * becomes its own pain, this body runs the pain outward into activity, and because it never sits
 * still the feeling never gets felt, and because it is never felt it never liberates. The engine
 * had one shape for held pain (rumination) and this is the other one (appeasement), and it is the
 * commoner of the two in people who are frightened of losing somebody.
 *
 * So `repairing` does something specific and slightly cruel: while it runs, that character's states
 * DO NOT self-liberate, even in a settled body. emotions.ts releases a state at relaxation ≥ 3
 * because nothing is gripping it. Something is gripping this one — it is just gripping it by
 * sprinting. What they outran accrues in `unfelt`, and when the repairing finally stops, it arrives.
 *
 * TWO GATES, BOTH ALREADY IN THE ENGINE, AND THIS IS WHY IT NEEDS NO NEW PERSONALITY MODEL:
 *
 *  · CONSCIENCE (0..1 — how much other people's pain registers as mattering) decides whether fault
 *    lands at all. At ≤0.35 nothing registers: that is the Rudra branch, already this engine's law,
 *    and it stays law here. A cold character does the same harm and carries none of it.
 *  · ATTACHMENT decides what a landed fault DOES. Secure says it and repairs and is finished.
 *    Anxious cannot tolerate the rupture and goes into the repair loop above. Avoidant registers it
 *    and goes flat — no move, more distance. Disorganized reaches and flinches, turn by turn.
 *
 * And the size of it scales with the bond. Hurting a stranger is a bad afternoon; hurting the person
 * you sleep next to is the thing you cannot put down.
 */
import type { SaveState, SimulatorDiff } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Below this conscience, nothing another person feels registers as mattering. The Rudra line. */
const COLD = 0.35;
/** An edge drop this size in one turn is somebody having done something, not a mood. */
const HARM_DROP = -12;
/** Turns a repair loop can run before the person finally stops and it all arrives. */
const REPAIR_MAX = 8;

export interface FaultReport { character: string; toward: string; about: string }

/**
 * Faults the turn actually produced.
 *
 * The bookkeeper's report is preferred — reading whether somebody was in the wrong needs a reader.
 * The deterministic half is a backstop for the turns it stays silent on, and it uses the one signal
 * that cannot be argued with: if B's warmth toward A fell off a cliff this turn and both were in the
 * room, A did something. The bookkeeper omitting it does not make it not have happened.
 */
export function faultsThisTurn(state: SaveState, diff: SimulatorDiff, reported?: FaultReport[]): FaultReport[] {
  const out: FaultReport[] = [];
  const seen = new Set<string>();
  const push = (character: string, toward: string, about: string) => {
    if (!character || !toward || character === toward) return;
    const k = `${character}|${toward}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ character, toward, about: about || "what they did" });
  };
  for (const r of reported ?? []) push(r.character, r.toward, r.about);
  for (const e of diff.edges ?? []) {
    const drop = Math.min(e.warmth_delta ?? 0, e.trust_delta ?? 0);
    if (drop > HARM_DROP) continue;
    // the edge is directional: e.from's feeling ABOUT e.to fell, so e.to is the one who did it
    push(e.to, e.from, e.note ?? "");
  }
  return out;
}

/** How much this person's bond makes the harm cost them. 0..1. */
function bondWeight(state: SaveState, id: string, toward: string): number {
  if (toward === "char_player" || state.characters[toward]) {
    const e = state.world.edges.find((x) => x.from === id && x.to === toward);
    if (!e) return 0.35;
    return clamp((Math.abs(e.warmth) + Math.abs(e.trust)) / 160, 0.2, 1);
  }
  return 0.35;
}

/**
 * Register what people did, and let it land or not according to who they are.
 *
 * Returns shift lines. The player is never given a fault by the engine — being told you feel guilty
 * is the same authorship the tightness anchor exists to prevent. Their own account of it arrives
 * through their interior, like everything else that is theirs.
 */
export function applyFaults(state: SaveState, faults: FaultReport[], turn: number): string[] {
  const log: string[] = [];
  for (const f of faults) {
    const c = state.characters[f.character];
    const cond = state.condition[f.character];
    if (!c || !cond || f.character === "char_player" || c.central === false) continue;
    const conscience = typeof c.conscience === "number" ? c.conscience : 0.7;
    const p = cond.psyche;
    if (conscience <= COLD) {
      // it registers as information, not as weight — and that is the whole difference
      log.push(`${c.name} knows exactly what they did to ${state.characters[f.toward]?.name ?? "them"}, and it costs them nothing.`);
      continue;
    }
    const weight = bondWeight(state, f.character, f.toward);
    p.fault = { toward: f.toward, about: f.about.slice(0, 90), turn };
    const dip = 0.5 + conscience * weight * 2.5;
    p.relaxation = clamp(+(p.relaxation - dip).toFixed(2), -10, 10);
    const name = state.characters[f.toward]?.name ?? "them";
    const st = `guilt toward ${name}`;
    if (!p.active_states.includes(st)) {
      p.active_states.push(st);
      (p.state_ages ??= {})[st] = turn;
    }
    log.push(`${c.name} knows they did it, and it is sitting on them.`);
  }
  return log;
}

/**
 * THE REPAIR LOOP.
 *
 * Fires from EITHER side — guilt or hurt — because that is the point. The person who was hurt and is
 * nonetheless the one scrambling to fix it is the same machine as the person who caused it and
 * cannot bear having caused it: an attachment that cannot tolerate the rupture, spending itself
 * outward so it does not have to be spent inward.
 *
 * Who does this: anxious and disorganized attachment, or anyone whose conscience runs high, and only
 * toward someone they are actually bonded to. A secure body repairs too — it says the thing, it
 * means it, and it is finished, which is why secure gets a short loop and not this one.
 */
export function tickRepair(state: SaveState): string[] {
  const log: string[] = [];
  const turn = state.world.current_turn;
  for (const id of state.world.present) {
    const c = state.characters[id];
    const cond = state.condition[id];
    if (!c || !cond || id === "char_player" || c.central === false) continue;
    const p = cond.psyche;
    const style = c.attachment?.style ?? "secure";
    const conscience = typeof c.conscience === "number" ? c.conscience : 0.7;
    const prone = style === "anxious" || style === "disorganized" || conscience >= 0.8;

    // ── does it start? ──────────────────────────────────────────────────────────
    if (!p.repairing) {
      const target = p.fault?.toward ?? hurtBy(state, id);
      if (!target || conscience <= COLD || !prone) continue;
      const e = state.world.edges.find((x) => x.from === id && x.to === target);
      if (!e || e.warmth < 30) continue;                 // you do not scramble for somebody you do not want
      p.repairing = 1;
      p.repair_toward = target;
      p.unfelt = 0;
      // WHERE THE OTHER PERSON STOOD WHEN THIS STARTED. Landing has to mean they came BACK, which
      // is a movement and not a level: checking an absolute warmth meant that in exactly the
      // relationships this exists for — the close ones, where warmth is high to begin with — the
      // loop "succeeded" on its second turn without anything having happened. What is being waited
      // for is the other person softening from wherever the rupture left them.
      p.repair_baseline = state.world.edges.find((x) => x.from === target && x.to === id)?.warmth ?? 0;
      const name = state.characters[target]?.name ?? "them";
      // the want becomes their live pursuit, so the existing drive machinery carries it into scenes
      c.drive = {
        goal: `get things right with ${name} — now, before anything else`,
        approach: `does not ask for anything back and does not mention being hurt; finds the small thing that can be done for ${name} and does it, and keeps finding another`,
        progress: 0, priority: 1, updated_turn: turn, progress_turn: turn, last_progress: 0,
      };
      log.push(`${c.name} cannot leave it where it is.`);
      continue;
    }

    // ── while it runs ───────────────────────────────────────────────────────────
    p.repairing++;
    // the cost of outrunning it: a small ongoing drain, and a store of what is not being felt
    p.relaxation = clamp(+(p.relaxation - 0.15).toFixed(2), -10, 10);
    p.unfelt = +((p.unfelt ?? 0) + 0.4).toFixed(2);

    const target = p.repair_toward;
    const back = target ? state.world.edges.find((x) => x.from === target && x.to === id) : undefined;
    if (back && p.repair_baseline === undefined) p.repair_baseline = back.warmth;
    // they let you back in = they moved toward you from where the rupture left them
    const landed = !!back && (p.repairing ?? 0) >= 2 && back.warmth - (p.repair_baseline ?? back.warmth) >= 8;

    if (landed) {
      // received. It completes properly: the guilt goes, and what they were outrunning is felt at
      // last rather than dumped on them — being forgiven is the door opening, not another hit.
      const name = state.characters[target!]?.name ?? "them";
      p.active_states = p.active_states.filter((s) => !/^guilt toward /.test(s));
      delete p.fault; delete p.repair_toward; delete p.unfelt; delete p.repair_baseline;
      p.repairing = 0;
      p.relaxation = clamp(+(p.relaxation + 1.2).toFixed(2), -10, 10);
      log.push(`${name} let ${c.name} back in, and ${c.name} finally stops moving.`);
      continue;
    }

    if ((p.repairing ?? 0) > REPAIR_MAX) {
      // AND THEN THEY STOP, AND IT ARRIVES. Everything the running was for lands at once, and the
      // thing they never registered — that they were hurt too — is the state they are left holding.
      const owed = Math.min(4, p.unfelt ?? 0);
      p.relaxation = clamp(+(p.relaxation - owed).toFixed(2), -10, 10);
      const st = "hurt, and only now feeling it";
      if (!p.active_states.includes(st)) { p.active_states.push(st); (p.state_ages ??= {})[st] = turn; }
      p.repairing = 0;
      delete p.repair_toward; delete p.unfelt; delete p.repair_baseline;
      log.push(`${c.name} runs out of things to fix, and what they have been outrunning arrives.`);
    }
  }
  return log;
}

/** Somebody present who hurt this character recently, by the record on the edge. */
function hurtBy(state: SaveState, id: string): string | null {
  let worst: { to: string; mag: number } | null = null;
  for (const other of ["char_player", ...state.world.present]) {
    if (other === id) continue;
    const e = state.world.edges.find((x) => x.from === id && x.to === other);
    if (!e || e.last_rupture_turn === undefined) continue;
    if (state.world.current_turn - e.last_rupture_turn > 4) continue;
    const mag = e.warmth;
    if (!worst || mag > worst.mag) worst = { to: other, mag };
  }
  return worst?.to ?? null;
}

/**
 * What the narrator is told. Behavioral direction only — never "X feels guilty", which is an
 * interior stated on the page and forbidden everywhere else in this document.
 */
export function faultDirective(state: SaveState): string {
  const lines: string[] = [];
  for (const id of state.world.present) {
    const c = state.characters[id];
    const cond = state.condition[id];
    if (!c || !cond || id === "char_player") continue;
    const p = cond.psyche;
    if (!p.fault && !p.repairing) continue;
    const style = c.attachment?.style ?? "secure";
    const conscience = typeof c.conscience === "number" ? c.conscience : 0.7;
    const who = state.characters[p.repair_toward ?? p.fault?.toward ?? ""]?.name
      ?? (p.repair_toward === "char_player" || p.fault?.toward === "char_player" ? "the player" : "them");

    if (p.repairing) {
      lines.push(
        `${c.name} is trying to fix things with ${who} and will not stop. They do not ask for anything back, `
        + `they do not raise what was done to THEM, and if anyone asks how they are they answer about ${who} instead — `
        + `not as evasion they are aware of; it genuinely does not occur to them that they are the subject. `
        + `Let them offer, do, fetch, smooth over, take the blame for parts that were not theirs. `
        + `This is not calm and it is not generosity: it is somebody who cannot sit still with it, and the strain shows in the body `
        + `(too quick to move, too eager to agree, a hand doing something unnecessary) while the words stay warm.`,
      );
      continue;
    }
    if (conscience <= COLD) continue;
    if (style === "avoidant") {
      lines.push(`${c.name} knows what they did to ${who} and will not go near it. They go flat and put distance in — shorter answers, somewhere else to be — and it reads as coldness rather than as the shame it is.`);
    } else if (style === "disorganized") {
      lines.push(`${c.name} knows what they did to ${who} and cannot hold one position about it: reaches to make it right and pulls back inside the same exchange, warm one line and defensive the next.`);
    } else {
      lines.push(
        `${c.name} knows what they did to ${who}, and knows it plainly. They SAY it — name the thing they actually did, without being cornered into it first, `
        + `without a justification riding along behind it, and without asking to be forgiven for it in the same breath. `
        + `Nobody has to drag this out of them, and they do not perform it either.`,
      );
    }
  }
  return lines.length ? `\n\n=== WHAT THEY KNOW THEY DID ===\n${lines.join("\n")}` : "";
}
