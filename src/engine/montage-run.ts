
/**
 * MONTAGE RUNTIME â€” the planner call, the beat loop, and the write-path.
 *
 * Every beat goes: simulateForward (world moves first, deterministic, free)
 * â†’ one cheap beat-writer call â†’ applyBeat through the SAME ledgers a normal
 * turn uses â†’ one interlude history entry. Nothing is written by a path that
 * doesn't already exist, so decay, retrieval, provenance and the Chronicle all
 * keep working. See montage.ts for the trajectory math this is held to.
 */
import type { SaveState, TurnTelemetry } from "./types";
import { advance } from "./time";
import { simulateForward } from "./continuity";
import { applyEdgeDelta } from "./social";
import { addFact, groundMemoryContent } from "./facts";
import { regrooveHabits } from "./habits";
import { recordExpressions } from "./novelty";
import { syncPresence } from "./turn";
import { buildMessages, complete, safeJson } from "../llm";
import { stablePrefix, CHAPTER_SYSTEM } from "./prompts";
import { pushSnapshot, uid } from "./state";
import {
  type MontagePlan, type MontageEdgeTarget, type EdgeOrigins,
  planBeats, captureOrigins, beatAllowance, scoreChecklist, pairKey,
} from "./montage";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** applyEdgeDelta hard-clamps warmth to Â±15 and trust to Â±20 per call. An envelope
 *  wider than that would be silently truncated, so the walk must respect the real
 *  ceiling or a montage quietly under-delivers its own arc. */
const EDGE_STEP_CAP = { warmth: 15, trust: 20, power: 10 } as const;

const PLANNER_SYSTEM = `You turn a player's free-text direction into an executable montage plan for a story engine.

The player is skipping time ON PURPOSE and says what should be true by the end. Your job is to make that executable as a sequence of beats â€” never as one jump. The engine owns the emotional trajectory; you own the shape of events.

RULES
- The checklist is the player's literal asks, one short phrase each. Do not invent asks they didn't make.
- Beats must tell a middle: the decision, the friction, the settling. A beat may make things WORSE â€” that is good, it is what makes the ending earned.
- Targets are FINAL values at the end of the whole montage (0-100 scale, warmth/trust), not per-beat.
- Never target attraction; the engine models desire on its own rules.
- Only name characters that exist in the world state you were given.
- Cats, dogs, objects and household details are FACTS, not characters.
- TIME SETTLES SMALL THINGS AND OPENS OTHERS. Some open threads simply end during a skip â€” a debt paid, a wait concluded, a question answered by circumstance. Name those in threads_resolve. Arriving somewhere new also raises questions that were not live before; name those in threads_new. A montage that leaves the board exactly as it found it has moved the clock, not the story.
- BUT TIME DOES NOT RESOLVE EPICS. Only LOW-WEIGHT threads settle offscreen: errands, small debts, minor waits, questions time answers on its own. A central conflict, a mystery the story is built on, a war, a hunt, a betrayal â€” these are the story's spine and they resolve in scenes the player is PRESENT for, never in a skip. You are told the maximum weight this span may settle; propose nothing above it. When unsure, leave it open â€” an unresolved thread costs nothing, a spine dissolved offscreen cannot be undone.

Output ONLY strict JSON:
{"checklist":["short phrase per player ask"],
"targets":[{"from":"char_id","to":"char_id","warmth":78,"trust":65,"roles":["partner"]}],
"place_plan":{"create":{"name":"","description_facts":""},"player_moves_to":""},
"threads_resolve":["EXACT title of an open thread this span of time settles, verbatim from OPEN THREADS. A month of living resolves things â€” a debt gets paid, a question gets answered, a waiting ends. Only what the direction actually implies."],
"threads_new":[{"title":"a NEW open question the DESTINATION creates, born from where they arrive, not where they started","description":"","tension":3}],
"household_facts":["durable facts true by the end, full sentences, no pronouns as subject"],
"beats":[{"span_days":3,"goal":"what this stretch of days is ABOUT"}]}`;

const BEAT_SYSTEM = `You are the Narrator writing ONE BEAT of a directed montage â€” a stretch of days inside a longer skip the player asked for.

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
"events":["2-4 one-line happenings from these days"],
"threads_resolve":["EXACT title of an open thread these days settled â€” only if the vignette actually shows it settling"],
"threads_new":[{"title":"a new open question these days raised","description":"","tension":3}],
"traits_expressed":[{"char_id":"","traits":["EXACT core trait string, verbatim from that character's Core: list"]}]}

TRAITS_EXPRESSED: which of a character's core traits these days actually put on screen â€” judged by MEANING, not wording. Someone whose trait is "loves ice cream" expresses it by eating gelato or sorbet; "loves basketball" by a pickup game. Copy the trait string verbatim so it can be matched, but decide by what the scene means. Omit anyone whose traits didn't surface.`;

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

/** One cheap call: free text â†’ executable plan. */
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
    state.world.threads.some((t) => t.status === "active")
      ? `OPEN THREADS (resolve by EXACT title). A ${opts.days}-day skip may settle threads of tension ${resolvableTension(opts.days)} or LOWER â€” anything heavier stays open no matter what you propose:\n${state.world.threads.filter((t) => t.status === "active").map((t) => `- ${t.title} (tension ${t.tension})${(t.tension ?? 0) > resolvableTension(opts.days) ? " â€” TOO HEAVY, leave open" : ""}`).join("\n")}`
      : "",
    `Return exactly ${spans.length} beats with span_days ${spans.join(", ")} in that order.`,
  ].join("\n\n");

  let plan: MontagePlan = { checklist: [], targets: [], beats: [] };
  try {
    const msgs = buildMessages(PLANNER_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 1600);
    plan = safeJson(res.text, plan) as MontagePlan;
  } catch { /* fall through to the deterministic shape below */ }

  // the beat spans are the ENGINE's, never the model's â€” a model that returns four
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

/** Content-word overlap â€” near-duplicate thread titles reworded ("the water debt" vs
 *  "Kildare's water debt") must not become two threads. Mirrors turn.ts's guard. */
function overlapRatio(a: string, b: string): number {
  const stop = new Set(["the","a","an","and","or","of","in","on","to","is","are","was","were","for","with","at","by","from","that","this","it","his","her","their"]);
  const words = (x: string) => new Set(
    x.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)),
  );
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * How heavy a thread a skip of `days` is ALLOWED to settle.
 *
 * Time passing resolves errands, not epics. Two days can settle "return the
 * borrowed cart"; it cannot settle "who burned the ledger" or a war. Without a
 * ceiling the planner treats any skip as licence to clear the board, and the
 * story's spine gets dissolved offscreen by a button press â€” the single worst
 * thing a time-skip can do, because the player never sees it happen.
 *
 * The curve is deliberately steep at the short end:
 *   1-2 days  -> tension <= 2   (errands only)
 *   3-6 days  -> tension <= 3
 *   7-13 days -> tension <= 4
 *   14-29days -> tension <= 5
 *   30-59days -> tension <= 6
 *   60+ days  -> tension <= 7
 *
 * Nothing at tension 8+ ever resolves in a montage, at any length. Those are the
 * story's load-bearing arcs; they resolve in played scenes where the player is
 * present, or not at all.
 */
export function resolvableTension(days: number): number {
  if (days <= 2) return 2;
  if (days <= 6) return 3;
  if (days <= 13) return 4;
  if (days <= 29) return 5;
  if (days <= 59) return 6;
  return 7;
}

/** A thread must also have EXISTED for a while before time alone can settle it â€”
 *  something raised three turns ago hasn't been sitting long enough to lapse. */
const MIN_AGE_TURNS = 4;

/**
 * Thread motion during a skip. A month of living settles some open questions and
 * raises others; a montage that leaves the board untouched has moved the clock but
 * not the story.
 *
 * Resolution is matched against EXISTING threads only â€” the model can close what is
 * open, never invent a thread just to close it â€” and is additionally gated by
 * weight (resolvableTension) and age. New threads are born capped the same way
 * turn.ts caps them: potential, not a mature crisis.
 */
function applyThreads(
  state: SaveState, resolve: unknown, born: unknown, turn: number, shifts: string[],
  days: number,
): void {
  const ceiling = resolvableTension(days);
  for (const title of (Array.isArray(resolve) ? resolve : [])) {
    const want = String(title ?? "").trim();
    if (!want) continue;
    const t = state.world.threads.find(
      (x) => x.status === "active"
        && (x.title.toLowerCase() === want.toLowerCase() || overlapRatio(x.title, want) >= 0.6),
    );
    if (!t) continue;   // never invent a thread in order to resolve it
    // WEIGHT GATE â€” a short skip cannot dissolve a heavy arc. The model asked; the
    // engine decides. Refusals are logged, not silent, so an over-eager planner is
    // visible rather than mysterious.
    if ((t.tension ?? 0) > ceiling) {
      console.warn(`[montage] refused to resolve "${t.title}" (tension ${t.tension}) â€” a ${days}-day skip may settle at most tension ${ceiling}`);
      continue;
    }
    // AGE GATE â€” time settles what has been sitting, not what was just raised.
    if (turn - (t.turn_started ?? 0) < MIN_AGE_TURNS) {
      console.warn(`[montage] refused to resolve "${t.title}" â€” raised too recently for time alone to settle it`);
      continue;
    }
    t.status = "resolved";
    t.turn_resolved = turn;
    shifts.push(`Thread resolved: ${t.title}.`);
  }

  for (const n of (Array.isArray(born) ? born : [])) {
    const title = String((n as any)?.title ?? "").trim();
    if (!title) continue;
    const dupe = state.world.threads.some(
      (x) => x.status === "active"
        && (x.title.toLowerCase() === title.toLowerCase() || overlapRatio(x.title, title) >= 0.6),
    );
    if (dupe) continue;
    if (state.world.threads.filter((x) => x.status === "active").length >= 12) break;
    state.world.threads.push({
      id: uid("thr"), title, status: "active",
      description: String((n as any)?.description ?? "").slice(0, 240),
      turn_started: turn,
      // same birth calibration as turn.ts: a thread arrives as potential, never a crisis
      tension: clamp(Number((n as any)?.tension) || 3, 0, 6),
    });
    shifts.push(`A new thread: ${title}.`);
  }
}

function applyBeat(
  state: SaveState, beat: any, plan: MontagePlan, i: number, n: number,
  origins: EdgeOrigins, landed: string[], beatStartTime: string,
): void {
  const turn = state.world.current_turn;
  const vignette = String(beat?.vignette ?? "");

  // â”€â”€ memories â”€â”€ staggered across the beat's days so decay and "that was weeks ago" work
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

  // â”€â”€ facts â”€â”€ through the gate, deduped
  for (const f of beat?.facts ?? []) {
    const id = state.characters[f.char_id] ? f.char_id
      : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(f.char_id).toLowerCase())?.[0];
    if (!id || !f.content || !state.memory[id]) continue;
    addFact(state.memory[id], String(f.content), turn, undefined, "inferred");
  }

  // â”€â”€ edges â”€â”€ clamped to this beat's envelope AND to what applyEdgeDelta will honour
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
      // unreachable â€” without compensating, a 20â†’65 trust arc silently lands near 48.
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
 * Run a directed montage. One snapshot at the start â€” the whole run is a single
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
    ev.onPhase(`beat ${i + 1}/${n} â€” ${b.goal}`);
    const beatStartTime = state.world.current_time;

    // the world moves FIRST, deterministically â€” clocks may fire mid-montage and the
    // beat-writer is told they happened rather than being allowed to ignore them.
    const report = simulateForward(state, b.span_days);
    regrooveHabits(state); // a month un-watched re-grooves; that's correct

    const remaining = plan.checklist.filter(
      (c) => !landed.some((l) => l.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(l.toLowerCase())),
    );
    const envelopeText = plan.targets.map((t) => {
      const a = beatAllowance(origins, t, i + 1, n);
      const e = state.world.edges.find((x) => x.from === t.from && x.to === t.to);
      const nm = `${state.characters[t.from]?.name} â†’ ${state.characters[t.to]?.name}`;
      return `${nm}: warmth now ${e?.warmth ?? 0} (target ${t.warmth ?? "â€”"}), this beat may move at most ${a.warmth >= 0 ? "+" : ""}${a.warmth}; trust now ${e?.trust ?? 0} (target ${t.trust ?? "â€”"}), at most ${a.trust >= 0 ? "+" : ""}${a.trust}`;
    }).join("\n");

    const ask = [
      `MONTAGE DIRECTION: ${opts.direction}`,
      `THIS BEAT (${i + 1} of ${n}): ${b.goal} â€” ${b.span_days} day(s), now ${state.world.current_time}`,
      remaining.length ? `STILL UNLANDED: ${remaining.join("; ")}` : "",
      i === n - 1 && remaining.length ? `THIS IS THE FINAL BEAT â€” land what remains.` : "",
      envelopeText ? `EDGE ENVELOPE (do not exceed):\n${envelopeText}` : "",
      report.clocks_fired.length ? `CLOCKS FIRED (these HAPPENED):\n${report.clocks_fired.join("\n")}` : "",
      report.drive_log.length ? `WORLD MOTION:\n${report.drive_log.slice(0, 8).join("\n")}` : "",
      report.consequences_due.length ? `NOW AT THE DOOR:\n${report.consequences_due.join("\n")}` : "",
      state.world.threads.some((t) => t.status === "active")
        ? `OPEN THREADS (resolve by EXACT title, only what these ${b.span_days} day(s) actually settle â€” max tension ${resolvableTension(b.span_days)}; heavier arcs resolve in played scenes, never here):\n${state.world.threads.filter((t) => t.status === "active").map((t) => `- ${t.title} (tension ${t.tension})${(t.tension ?? 0) > resolvableTension(b.span_days) ? " â€” TOO HEAVY" : ""}`).join("\n")}`
        : "",
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

    const threadShifts: string[] = [];
    applyThreads(state, beat?.threads_resolve, beat?.threads_new, state.world.current_turn, threadShifts, b.span_days);

    // a month of living a trait grounds it â€” the montage ages novelty the same way play does,
    // so a character doesn't come out of a 30-day skip rediscovering their oldest habit.
    if (state.model_settings.habit_engine)
    {
      // the beat writer read its own days and reports by MEANING â€” string matching
      // would miss gelato-for-ice-cream exactly the way it does in a normal turn.
      const rep = new Map<string, string[]>();
      for (const r of (beat?.traits_expressed ?? [])) {
        const cid = state.characters[r?.char_id] ? r.char_id
          : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(r?.char_id).toLowerCase())?.[0];
        if (cid && Array.isArray(r.traits)) rep.set(cid, r.traits.map(String));
      }
      for (const pid of state.world.present)
        recordExpressions(state, pid, vignette, state.world.current_turn, rep.get(pid));
    }

    state.history.push({
      turn: state.world.current_turn,
      kind: "interlude",
      span_label: `${b.span_days === 1 ? "a day" : `${b.span_days} days`} â€” ${b.goal}`,
      player_action: `â€” ${b.goal} â€”`,
      action_mode: "story",
      narrator_prose: vignette,
      summary: `Montage beat ${i + 1}/${n}: ${b.goal}`,
      shifts: [
        ...report.clocks_fired.map((c) => `While the days passed: ${c}`),
        ...(beat?.landed ?? []).map((l: string) => `Landed: ${l}`),
        ...threadShifts,
      ].slice(0, 8),
      offscreen: (beat?.events ?? report.drive_log).slice(0, 6),
      weather: state.world.weather,
      time_label: state.world.current_time,
      montage_id, montage_beat: `${i + 1}/${n}`,
    });

    const tel: TurnTelemetry = {
      turn: state.world.current_turn, pressure: 1,
      pressure_source: `montage ${i + 1}/${n} â€” ${b.goal}`,
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

  // â”€â”€ arrival: zero calls â”€â”€
  // â”€â”€ CHAPTER â”€â”€ a montage IS a chapter-sized arc: a span of time with a shape, an
  // ending, and a changed world. Chaptering normally fires on a turn cadence
  // (turn % chapter_cadence), which a multi-beat skip can jump clean over â€” leaving
  // the Chronicle with N orphaned beat entries and no chapter covering them. Write one
  // for the montage itself, so the Chronicle reads "A month at Fen Street" rather than
  // eight interludes nobody grouped.
  ev.onPhase("closing the chapter");
  try {
    const fromTurn = state.world.current_turn - n;
    const beats = state.history
      .filter((h) => (h as any).montage_id === montage_id)
      .map((h) => `${h.span_label ?? ""}: ${h.narrator_prose}`)
      .join("\n\n")
      .slice(0, 6000);
    const priorPersona = [...(state.chapters ?? [])].reverse().find((c) => c.persona)?.persona;
    const ask = [
      `These beats are one directed montage the player asked for: "${opts.direction}"`,
      `SPAN: ${opts.days} days, ${n} beats.`,
      priorPersona ? `PRIOR READING OF THE PLAYER: ${priorPersona.mbti} â€” ${priorPersona.read}` : "",
      state.world_bible.destination ? `DESTINATION: ${state.world_bible.destination}` : "",
      `BEATS:\n${beats}`,
    ].filter(Boolean).join("\n\n");
    const msgs = buildMessages(CHAPTER_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 1200);
    tokensIn += res.usage.prompt_tokens; tokensOut += res.usage.completion_tokens;
    const ch = safeJson<any>(res.text, {});
    if (ch?.summary) {
      const persona = ch.persona?.mbti && ch.persona?.read
        ? {
            mbti: String(ch.persona.mbti).slice(0, 6).toUpperCase(),
            read: String(ch.persona.read).slice(0, 300),
            traits: (ch.persona.traits ?? []).slice(0, 5).map((t: any) => String(t).slice(0, 60)),
            shift: ch.persona.shift && String(ch.persona.shift).trim() ? String(ch.persona.shift).slice(0, 160) : undefined,
          }
        : undefined;
      state.chapters ??= [];
      state.chapters.push({
        idx: state.chapters.length + 1,
        from_turn: fromTurn, to_turn: state.world.current_turn,
        title: (ch.title ?? `${opts.days} days`).slice(0, 60),
        summary: String(ch.summary).slice(0, 400),
        on_contract: ch.on_contract !== false,
        drift: ch.drift?.slice(0, 200),
        persona,
      });
    }
  } catch { /* a montage without a chapter entry is still a valid montage */ }

  ev.onPhase("arriving");
  const arrivalShifts: string[] = [];
  // the destination's own thread motion: what arriving here settles, and what it opens.
  // Applied once at the end so it describes the ARRIVAL, not any single beat.
  applyThreads(state, (plan as any).threads_resolve, (plan as any).threads_new, state.world.current_turn, arrivalShifts, opts.days);
  finalizeMontage(state, plan);
  if (arrivalShifts.length) {
    const last = state.history[state.history.length - 1];
    if (last) last.shifts = [...(last.shifts ?? []), ...arrivalShifts].slice(0, 10);
  }

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
      // anyone the montage made a partner/housemate lives here now â€” cohabitation
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

  // simulateForward clears presence every beat â€” the scene must be re-derived or the
  // player arrives into an empty room they were supposed to be sharing.
  syncPresence(state);
}

