/**
 * MONTAGE RUNTIME — the planner call, the beat loop, and the write-path.
 *
 * Every beat goes: simulateForward (world moves first, deterministic, free)
 * → one cheap beat-writer call → applyBeat through the SAME ledgers a normal
 * turn uses → one interlude history entry. Nothing is written by a path that
 * doesn't already exist, so decay, retrieval, provenance and the Chronicle all
 * keep working. See montage.ts for the trajectory math this is held to.
 */
import type { SaveState, TurnTelemetry } from "./types";
import { advance } from "./time";
import { simulateForward } from "./continuity";
import { applyEdgeDelta } from "./social";
import { addFact, groundMemoryContent } from "./facts";
import { regrooveHabits } from "./habits";
import { syncPresence } from "./turn";
import { buildMessages, complete, safeJson } from "../llm";
import { stablePrefix } from "./prompts";
import { pushSnapshot, uid } from "./state";
import {
  type MontagePlan, type MontageEdgeTarget, type EdgeOrigins,
  planBeats, captureOrigins, beatAllowance, scoreChecklist, pairKey,
} from "./montage";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** applyEdgeDelta hard-clamps warmth to ±15 and trust to ±20 per call. An envelope
 *  wider than that would be silently truncated, so the walk must respect the real
 *  ceiling or a montage quietly under-delivers its own arc. */
const EDGE_STEP_CAP = { warmth: 15, trust: 20, power: 10 } as const;

const PLANNER_SYSTEM = `You turn a player's free-text direction into an executable montage plan for a story engine.

The player is skipping time ON PURPOSE and says what should be true by the end. Your job is to make that executable as a sequence of beats — never as one jump. The engine owns the emotional trajectory; you own the shape of events.

RULES
- The checklist is the player's literal asks, one short phrase each. Do not invent asks they didn't make.
- Beats must tell a middle: the decision, the friction, the settling. A beat may make things WORSE — that is good, it is what makes the ending earned.
- Targets are FINAL values at the end of the whole montage (0-100 scale, warmth/trust), not per-beat.
- Never target attraction; the engine models desire on its own rules.
- Only name characters that exist in the world state you were given.
- Cats, dogs, objects and household details are FACTS, not characters.

Output ONLY strict JSON:
{"checklist":["short phrase per player ask"],
"targets":[{"from":"char_id","to":"char_id","warmth":78,"trust":65,"roles":["partner"]}],
"place_plan":{"create":{"name":"","description_facts":""},"player_moves_to":""},
"household_facts":["durable facts true by the end, full sentences, no pronouns as subject"],
"beats":[{"span_days":3,"goal":"what this stretch of days is ABOUT"}]}`;

const BEAT_SYSTEM = `You are the Narrator writing ONE BEAT of a directed montage — a stretch of days inside a longer skip the player asked for.

You receive: the player's overall plan, what remains unlanded, a deterministic report of what the world did during these days, and an EDGE ENVELOPE giving the most each relationship may move this beat.

RULES
- Write the MIDDLE, not the destination. This beat is a stretch of days, not a summary of the whole span.
- The deterministic report HAPPENED. Weave it in; never contradict it.
- Stay inside the envelope. You may move less, or move the opposite way (a bad week is real), but never more.
- Memories are personal and local: what THIS character lived these days. Never hand someone a memory of a distant event they have no way of knowing.
- Facts must stand alone cold to a stranger: full sentence, named subject, no leading pronoun, no quotes.
- Land plan items when the beat naturally gets there. Say which in "landed".

Output ONLY strict JSON:
{"vignette":"2-3 paragraphs of prose covering these days. Concrete, specific, no player interiority.",
"landed":["checklist phrases this beat actually made true"],
"memories":[{"char_id":"","content":"what this character personally lived these days","importance":4,"day_offset":0}],
"facts":[{"char_id":"","content":"durable fact that became true in these days"}],
"edges":[{"from":"","to":"","warmth_delta":0,"trust_delta":0,"power_delta":0,"note":"","roles_set":[]}],
"events":["2-4 one-line happenings from these days"]}`;

export interface MontageOptions {
  days: number;
  direction: string;
  granularity: "quick" | "standard" | "full";
}

export interface MontageResult {
  plan: MontagePlan;
  scorecard: { item: string; landed: boolean }[];
  beatsRun: number;
  montage_id: string;
}

/** One cheap call: free text → executable plan. */
export async function planMontage(state: SaveState, opts: MontageOptions): Promise<MontagePlan> {
  const spans = planBeats(opts.days, opts.granularity);
  const roster = Object.entries(state.characters)
    .filter(([, c]) => c.status !== "dead" && c.status !== "departed")
    .map(([id, c]) => `${id} = ${c.name}`).join("\n");
  const ask = [
    `DIRECTION: ${opts.direction}`,
    `SPAN: ${opts.days} days, to be told in exactly ${spans.length} beats of ${spans.join(", ")} days.`,
    `ROSTER:\n${roster}`,
    `PLACES: ${Object.values(state.world.places).map((p) => p.name).join(", ")}`,
    `Return exactly ${spans.length} beats with span_days ${spans.join(", ")} in that order.`,
  ].join("\n\n");

  let plan: MontagePlan = { checklist: [], targets: [], beats: [] };
  try {
    const msgs = buildMessages(PLANNER_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 1600);
    plan = safeJson(res.text, plan) as MontagePlan;
  } catch { /* fall through to the deterministic shape below */ }

  // the beat spans are the ENGINE's, never the model's — a model that returns four
  // beats for a thirty-day skip would silently change how much time passes.
  plan.beats = spans.map((span_days, i) => ({
    span_days,
    goal: plan.beats?.[i]?.goal || `days ${i + 1} of the span`,
  }));
  plan.checklist = (plan.checklist ?? []).map((c) => String(c).slice(0, 80)).slice(0, 8);
  plan.targets = (plan.targets ?? []).filter(
    (t) => state.characters[t.from] && state.characters[t.to],
  ).slice(0, 6);
  return plan;
}

function applyBeat(
  state: SaveState, beat: any, plan: MontagePlan, i: number, n: number,
  origins: EdgeOrigins, landed: string[], beatStartTime: string,
): void {
  const turn = state.world.current_turn;
  const vignette = String(beat?.vignette ?? "");

  // ── memories ── staggered across the beat's days so decay and "that was weeks ago" work
  const factionNames = new Set(state.world.clocks.map((c) => c.faction.toLowerCase()));
  const threadTitles = state.world.threads.map((t) => t.title.toLowerCase());
  const whitelist = new Set(
    Object.values(state.characters).map((c) => c.name.toLowerCase())
      .concat(Object.values(state.world.places).map((p) => p.name.toLowerCase())),
  );
  for (const m of beat?.memories ?? []) {
    const id = state.characters[m.char_id] ? m.char_id
      : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(m.char_id).toLowerCase())?.[0];
    if (!id || !m.content || !state.memory[id]) continue;
    const c = state.characters[id];
    if (c.status === "dead" || c.status === "departed") continue;

    // same distant-event guard runInterlude uses: nobody remembers what they couldn't know
    const content = String(m.content).toLowerCase();
    const namesDistant = [...factionNames].some((f) => f && content.includes(f))
      || threadTitles.some((t) => t && t.length > 6 && content.includes(t));
    if (namesDistant) {
      const mem = state.memory[id];
      const hasSource = [...(mem.episodic ?? []), ...(mem.facts ?? [])].some((e) => {
        const txt = String((e as any).content ?? (e as any).fact ?? "").toLowerCase();
        return [...factionNames].some((f) => f && txt.includes(f) && content.includes(f))
          || threadTitles.some((t) => t && content.includes(t) && txt.includes(t));
      });
      if (!hasSource) continue;
    }
    // ground names against this beat's own prose so they can't mutate between beats
    const grounded = groundMemoryContent(String(m.content), undefined, vignette, whitelist);
    const dayOff = clamp(Number(m.day_offset) || 0, 0, plan.beats[i].span_days);
    state.memory[id].episodic.push({
      turn, content: grounded.content, importance: clamp(Number(m.importance) || 4, 1, 10),
      emotional_charge: "", last_accessed_turn: turn,
      source: "inferred",
      when_label: advance(beatStartTime, dayOff * 1440),
    } as any);
  }

  // ── facts ── through the gate, deduped
  for (const f of beat?.facts ?? []) {
    const id = state.characters[f.char_id] ? f.char_id
      : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(f.char_id).toLowerCase())?.[0];
    if (!id || !f.content || !state.memory[id]) continue;
    addFact(state.memory[id], String(f.content), turn, undefined, "inferred");
  }

  // ── edges ── clamped to this beat's envelope AND to what applyEdgeDelta will honour
  for (const d of beat?.edges ?? []) {
    if (!state.characters[d.from] || !state.characters[d.to]) continue;
    const target = plan.targets.find((t) => t.from === d.from && t.to === d.to);
    const allow = target ? beatAllowance(origins, target, i + 1, n) : null;
    const limit = (axis: "warmth" | "trust" | "power") => {
      const cap = EDGE_STEP_CAP[axis];
      if (!allow) return cap;
      // the envelope bounds motion TOWARD the target; motion away is allowed but small,
      // so a beat can dip without the run losing its trajectory.
      let a = allow[axis];
      // applyEdgeDelta damps POSITIVE trust to 60% ("trust breaks faster than it builds").
      // That rule is about a single turn's motion, not about making a multi-beat target
      // unreachable — without compensating, a 20→65 trust arc silently lands near 48.
      // Divide the allowance by the damping so the requested arc still arrives.
      if (axis === "trust" && a > 0) a = a / 0.6;
      return a === 0 ? Math.min(cap, 4) : Math.min(cap, Math.abs(a));
    };
    applyEdgeDelta(state.world.edges, {
      from: d.from, to: d.to,
      warmth_delta: clamp(Number(d.warmth_delta) || 0, -limit("warmth"), limit("warmth")),
      trust_delta: clamp(Number(d.trust_delta) || 0, -limit("trust"), limit("trust")),
      power_delta: clamp(Number(d.power_delta) || 0, -limit("power"), limit("power")),
      note: d.note ? String(d.note) : undefined,
      roles_set: Array.isArray(d.roles_set) && d.roles_set.length ? d.roles_set.map(String) : undefined,
    }, turn);
  }

  for (const l of beat?.landed ?? []) if (typeof l === "string") landed.push(l);
}

/**
 * Run a directed montage. One snapshot at the start — the whole run is a single
 * undoable unit, so a montage that goes wrong costs one rollback, not seven.
 */
export async function runMontage(
  state: SaveState, opts: MontageOptions, ev: { onPhase: (p: string) => void },
): Promise<MontageResult> {
  const t0 = Date.now();
  await pushSnapshot(state);

  ev.onPhase("planning the montage");
  const plan = await planMontage(state, opts);
  const n = plan.beats.length;
  const montage_id = uid("mtg");
  const origins = captureOrigins(state, plan.targets);
  const landed: string[] = [];
  let tokensIn = 0, tokensOut = 0;

  for (let i = 0; i < n; i++) {
    const b = plan.beats[i];
    ev.onPhase(`beat ${i + 1}/${n} — ${b.goal}`);
    const beatStartTime = state.world.current_time;

    // the world moves FIRST, deterministically — clocks may fire mid-montage and the
    // beat-writer is told they happened rather than being allowed to ignore them.
    const report = simulateForward(state, b.span_days);
    regrooveHabits(state); // a month un-watched re-grooves; that's correct

    const remaining = plan.checklist.filter(
      (c) => !landed.some((l) => l.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(l.toLowerCase())),
    );
    const envelopeText = plan.targets.map((t) => {
      const a = beatAllowance(origins, t, i + 1, n);
      const e = state.world.edges.find((x) => x.from === t.from && x.to === t.to);
      const nm = `${state.characters[t.from]?.name} → ${state.characters[t.to]?.name}`;
      return `${nm}: warmth now ${e?.warmth ?? 0} (target ${t.warmth ?? "—"}), this beat may move at most ${a.warmth >= 0 ? "+" : ""}${a.warmth}; trust now ${e?.trust ?? 0} (target ${t.trust ?? "—"}), at most ${a.trust >= 0 ? "+" : ""}${a.trust}`;
    }).join("\n");

    const ask = [
      `MONTAGE DIRECTION: ${opts.direction}`,
      `THIS BEAT (${i + 1} of ${n}): ${b.goal} — ${b.span_days} day(s), now ${state.world.current_time}`,
      remaining.length ? `STILL UNLANDED: ${remaining.join("; ")}` : "",
      i === n - 1 && remaining.length ? `THIS IS THE FINAL BEAT — land what remains.` : "",
      envelopeText ? `EDGE ENVELOPE (do not exceed):\n${envelopeText}` : "",
      report.clocks_fired.length ? `CLOCKS FIRED (these HAPPENED):\n${report.clocks_fired.join("\n")}` : "",
      report.drive_log.length ? `WORLD MOTION:\n${report.drive_log.slice(0, 8).join("\n")}` : "",
      report.consequences_due.length ? `NOW AT THE DOOR:\n${report.consequences_due.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    let beat: any = {};
    try {
      const msgs = buildMessages(BEAT_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
      const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 2000);
      tokensIn += res.usage.prompt_tokens; tokensOut += res.usage.completion_tokens;
      beat = safeJson(res.text, {});
    } catch { /* deterministic fallback below */ }

    const vignette = String(beat?.vignette ?? "").trim()
      || [`${b.goal}.`, ...report.drive_log.slice(0, 3)].join(" ");
    beat.vignette = vignette;

    applyBeat(state, beat, plan, i, n, origins, landed, beatStartTime);

    state.history.push({
      turn: state.world.current_turn,
      kind: "interlude",
      span_label: `${b.span_days === 1 ? "a day" : `${b.span_days} days`} — ${b.goal}`,
      player_action: `— ${b.goal} —`,
      action_mode: "story",
      narrator_prose: vignette,
      summary: `Montage beat ${i + 1}/${n}: ${b.goal}`,
      shifts: [
        ...report.clocks_fired.map((c) => `While the days passed: ${c}`),
        ...(beat?.landed ?? []).map((l: string) => `Landed: ${l}`),
      ].slice(0, 8),
      offscreen: (beat?.events ?? report.drive_log).slice(0, 6),
      weather: state.world.weather,
      time_label: state.world.current_time,
      montage_id, montage_beat: `${i + 1}/${n}`,
    });

    const tel: TurnTelemetry = {
      turn: state.world.current_turn, pressure: 1,
      pressure_source: `montage ${i + 1}/${n} — ${b.goal}`,
      narrator_tokens_in: 0, narrator_tokens_out: 0,
      simulator_tokens_in: tokensIn, simulator_tokens_out: tokensOut,
      reflection_tokens: 0, duration_ms: Date.now() - t0,
      word_count: vignette.split(/\s+/).filter(Boolean).length,
      player_mood_valence: state.condition["char_player"]?.psyche.mood_valence ?? 0,
      present: [...state.world.present], time_label: state.world.current_time,
      edge_snapshot: state.world.edges
        .filter((e) => e.to === "char_player" && state.characters[e.from])
        .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust })),
    };
    state.telemetry.push(tel);
    state.pressure_trace.push(1);
    state.world.current_turn++;
  }

  // ── arrival: zero calls ──
  ev.onPhase("arriving");
  finalizeMontage(state, plan);

  return { plan, scorecard: scoreChecklist(plan.checklist, landed), beatsRun: n, montage_id };
}

function finalizeMontage(state: SaveState, plan: MontagePlan): void {
  const turn = state.world.current_turn;

  // the place the montage moved the player into
  const create = plan.place_plan?.create;
  if (create?.name) {
    const existing = Object.entries(state.world.places).find(
      ([, p]) => p.name.toLowerCase() === create.name.toLowerCase(),
    )?.[0];
    if (!existing) {
      const pid = uid("place");
      state.world.places[pid] = {
        id: pid, name: create.name,
        description_facts: create.description_facts ?? "", contains: [],
      };
    }
  }
  const moveTo = plan.place_plan?.player_moves_to;
  if (moveTo) {
    const pid = Object.entries(state.world.places).find(
      ([, p]) => p.name.toLowerCase() === String(moveTo).toLowerCase(),
    )?.[0];
    if (pid) {
      state.world.player_location = pid;
      // anyone the montage made a partner/housemate lives here now — cohabitation
      // has to be real in state or the narrator won't see it.
      for (const t of plan.targets) {
        const roles = (t.roles ?? []).map((r) => r.toLowerCase());
        if (roles.some((r) => /partner|housemate|spouse|wife|husband/.test(r))) {
          const other = t.from === "char_player" ? t.to : t.from;
          if (state.characters[other] && state.characters[other].status !== "dead" && state.characters[other].status !== "departed")
            state.characters[other].location = pid;
        }
      }
    }
  }

  // household details are facts on the people who live with them, never characters
  for (const hf of plan.household_facts ?? []) {
    for (const t of plan.targets) {
      for (const id of [t.from, t.to]) {
        if (state.memory[id]) addFact(state.memory[id], String(hf), turn, undefined, "inferred");
      }
    }
  }

  // simulateForward clears presence every beat — the scene must be re-derived or the
  // player arrives into an empty room they were supposed to be sharing.
  syncPresence(state);
}
