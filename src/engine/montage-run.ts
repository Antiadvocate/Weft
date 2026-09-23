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
import { recordExpressions } from "./novelty";
import { syncPresence } from "./turn";
import { placeIntent } from "./places";
import { buildMessages, complete, safeJson, type Usage } from "../llm";
import { stablePrefix, CHAPTER_SYSTEM } from "./prompts";
import { pushSnapshot, uid } from "./state";
import { overlapRatio, clipText } from "./text";

/** AUX SPEND — montage calls that aren't tied to a single beat (planner, chapter) accumulate
 *  on the save so the spend meter matches the OpenRouter dashboard. Beats themselves carry
 *  per-beat telemetry with real cost. */
function trackAux(s: SaveState, u: Usage): void {
  const a = (s.aux_spend ??= { images: 0, montage_calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 });
  a.montage_calls++; a.tokens_in += u.prompt_tokens ?? 0; a.tokens_out += u.completion_tokens ?? 0; a.cost += u.cost ?? 0;
}
import {
  type MontagePlan, type MontageEdgeTarget, type EdgeOrigins,
  planBeats, captureOrigins, beatAllowance, scoreChecklist, pairKey,
} from "./montage";
import { clamp } from "./num";


/** applyEdgeDelta hard-clamps warmth to ±15 and trust to ±20 per call. An envelope
 *  wider than that would be silently truncated, so the walk must respect the real
 *  ceiling or a montage quietly under-delivers its own arc. */
const EDGE_STEP_CAP = { warmth: 15, trust: 20, power: 10 } as const;

const PLANNER_SYSTEM = `You turn a player's free-text direction into a montage plan that a story engine can carry out.

The player is skipping time on purpose and has said what should be true by the end. Your job is to turn that into a series of stretches of time that the engine can play one after another, never into one jump. The engine handles how feelings change; you plan the events.

RULES
- The checklist is exactly what the player asked for, one short phrase per request. Don't invent requests they didn't make.
- The stretches have to cover the steps in between, like the decision, the conflict and the settling down. A stretch can make things worse, which makes the ending feel earned.
- Targets are the final values at the end of the whole montage (on a 0 to 100 scale for warmth and trust), not values for each stretch.
- Never set a target for attraction, because the engine handles desire by its own rules.
- Only name characters who exist in the world state you were given.
- Cats, dogs, objects and household details go in as facts.
- Time settles some small things and opens up others. Some open threads simply end during a skip, like a promise kept, a wait that's over, or a question that circumstances answered. Name those in threads_resolve. Arriving somewhere new also raises questions that weren't open before, so name those in threads_new. A montage that leaves every thread exactly as it was has moved time forward without moving the story forward.
- But major threads don't get resolved during a skip. Only light threads settle offscreen, such as errands, small favours, minor waits, and questions that time answers by itself. A central conflict, a mystery the story is built around, a war, a hunt or a betrayal is the heart of the story, and it gets resolved in scenes the player is present for, never in a skip. You're told the heaviest weight this stretch of time can settle, so don't propose anything heavier. When you're unsure, leave it open. Leaving a thread open does no harm, but resolving a major one offscreen can't be undone.

Reply with only strict JSON:
{"checklist":["one short phrase for each thing the player asked for"],
"targets":[{"from":"char_id","to":"char_id","warmth":78,"trust":65,"roles":["partner"]}],
"place_plan":{"create":{"name":"","description_facts":""},"player_moves_to":""},
"threads_resolve":["the exact title of an open thread that this stretch of time settles, copied from OPEN THREADS. A month can settle things: a promise gets kept, a question gets answered, a wait ends. Only include what the direction actually implies."],
"threads_new":[{"title":"a new open question that the place they end up raises","description":"","tension":3}],
"household_facts":["lasting facts that are true by the end, in full sentences, without a pronoun as the subject"],
"beats":[{"span_days":3,"goal":"what this stretch of days is about"}]}`;

const BEAT_SYSTEM = `You're the narrator, writing one stretch of a montage the player asked for, which covers a run of days inside a longer time skip.

You're given the player's overall plan, what hasn't happened yet, a fixed report of what the world did during these days, and a set of limits on how far each relationship can move in this stretch.

RULES
- Write the middle part, and leave the ending alone. This stretch covers a run of days, told at the size it actually happened.
- The fixed report happened. Work it in, and never contradict it.
- Stay inside the limits. A relationship can move less than the limit, or in the opposite direction (bad weeks happen), but never further.
- Memories are personal and local: what this particular character lived through in these days. Never give someone a memory of a faraway event they'd have no way of knowing about.
- A fact has to make sense on its own to a stranger: a full sentence with a named subject, starting with something other than a pronoun, and without quotes.
- Tick off items from the plan when this stretch naturally gets to them, and list which ones in "landed".

Reply with only strict JSON:
{"vignette":"two or three paragraphs of prose covering these days, concrete and specific, without the player's inner thoughts",
"landed":["checklist phrases this stretch actually made true"],
"memories":[{"char_id":"","content":"what this character personally lived through in these days","importance":4,"day_offset":0}],
"facts":[{"char_id":"","content":"a lasting fact that became true in these days"}],
"edges":[{"from":"","to":"","warmth_delta":0,"trust_delta":0,"power_delta":0,"note":"","roles_set":[]}],
"events":["two to four one-line things that happened in these days"],
"threads_resolve":["the exact title of an open thread these days settled, and only if the vignette actually shows it being settled"],
"threads_new":[{"title":"a new open question these days raised","description":"","tension":3}],
"traits_expressed":[{"char_id":"","traits":["the EXACT core trait string, copied from that character's Core: list"]}]}

TRAITS_EXPRESSED: which of a character's core traits actually showed in these days. Judge by meaning, so the same moment described in different words counts as the same moment. Someone whose trait is "loves ice cream" shows it by eating gelato or sorbet, and "loves basketball" by playing a pickup game. Copy the trait string exactly so it can be matched, but decide by what the scene means. Leave out anyone whose traits didn't come up.`;

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
    `SPAN: ${opts.days} days, told in exactly ${spans.length} stretches of ${spans.join(", ")} days.`,
    `ROSTER:\n${roster}`,
    `PLACES: ${Object.values(state.world.places).map((p) => p.name).join(", ")}`,
    state.world.threads.some((t) => t.status === "active")
      ? `OPEN THREADS (resolve them by their exact title). A ${opts.days}-day skip can settle threads with tension ${resolvableTension(opts.days)} or lower, and anything heavier stays open whatever you propose:\n${state.world.threads.filter((t) => t.status === "active").map((t) => `- ${t.title} (tension ${t.tension})${(t.tension ?? 0) > resolvableTension(opts.days) ? " — TOO HEAVY, leave it open" : ""}`).join("\n")}`
      : "",
    `Send back exactly ${spans.length} stretches, with span_days of ${spans.join(", ")}, in that order.`,
  ].join("\n\n");

  let plan: MontagePlan = { checklist: [], targets: [], beats: [] };
  try {
    const msgs = buildMessages(PLANNER_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 1600);
    trackAux(state, res.usage);
    plan = safeJson(res.text, plan) as MontagePlan;
  } catch { /* fall through to the deterministic shape below */ }

  // the beat spans are the ENGINE's, never the model's — a model that returns four
  // beats for a thirty-day skip would silently change how much time passes.
  plan.beats = spans.map((span_days, i) => ({
    span_days,
    goal: plan.beats?.[i]?.goal || `days ${i + 1} of the span`,
  }));
  plan.checklist = (plan.checklist ?? []).map((c) => clipText(c, 110)).slice(0, 8);
  plan.targets = (plan.targets ?? []).filter(
    (t) => state.characters[t.from] && state.characters[t.to],
  ).slice(0, 6);
  return plan;
}



/**
 * How heavy a thread a skip of `days` is ALLOWED to settle.
 *
 * Time passing resolves errands, not epics. Two days can settle "return the
 * borrowed cart"; it cannot settle "who burned the ledger" or a war. Without a
 * ceiling the planner treats any skip as licence to clear the board, and the
 * story's spine gets dissolved offscreen by a button press — the single worst
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

/** A thread must also have EXISTED for a while before time alone can settle it —
 *  something raised three turns ago hasn't been sitting long enough to lapse. */
const MIN_AGE_TURNS = 4;

/**
 * Thread motion during a skip. A month of living settles some open questions and
 * raises others; a montage that leaves the board untouched has moved the clock but
 * not the story.
 *
 * Resolution is matched against EXISTING threads only — the model can close what is
 * open, never invent a thread just to close it — and is additionally gated by
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
        && (String(x.title ?? "").toLowerCase() === want.toLowerCase() || overlapRatio(String(x.title ?? ""), want) >= 0.6),
    );
    if (!t) continue;   // never invent a thread in order to resolve it
    // WEIGHT GATE — a short skip cannot dissolve a heavy arc. The model asked; the
    // engine decides. Refusals are logged, not silent, so an over-eager planner is
    // visible rather than mysterious.
    if ((t.tension ?? 0) > ceiling) {
      console.warn(`[montage] refused to resolve "${t.title}" (tension ${t.tension}) — a ${days}-day skip may settle at most tension ${ceiling}`);
      continue;
    }
    // AGE GATE — time settles what has been sitting, not what was just raised.
    if (turn - (t.turn_started ?? 0) < MIN_AGE_TURNS) {
      console.warn(`[montage] refused to resolve "${t.title}" — raised too recently for time alone to settle it`);
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
        && (String(x.title ?? "").toLowerCase() === title.toLowerCase() || overlapRatio(String(x.title ?? ""), title) >= 0.6),
    );
    if (dupe) continue;
    if (state.world.threads.filter((x) => x.status === "active").length >= 12) break;
    state.world.threads.push({
      id: uid("thr"), title, status: "active",
      description: clipText((n as any)?.description, 320),
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

  // ── memories ── staggered across the beat's days so decay and "that was weeks ago" work
  const factionNames = new Set(state.world.clocks.map((c) => c.faction.toLowerCase()));
  const threadTitles = state.world.threads.map((t) => String(t.title ?? "").toLowerCase());
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
    }, turn, { chars: state.characters, traits: state.traits });
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
      return `${nm}: warmth is now ${e?.warmth ?? 0} (target ${t.warmth ?? "—"}), and this stretch can move it by at most ${a.warmth >= 0 ? "+" : ""}${Math.round(a.warmth)}; trust is now ${e?.trust ?? 0} (target ${t.trust ?? "—"}), and it can move by at most ${a.trust >= 0 ? "+" : ""}${Math.round(a.trust)}`;
    }).join("\n");

    const ask = [
      `MONTAGE DIRECTION: ${opts.direction}`,
      `THIS BEAT (${i + 1} of ${n}): ${b.goal} — ${b.span_days} day(s), now ${state.world.current_time}`,
      remaining.length ? `STILL UNLANDED: ${remaining.join("; ")}` : "",
      i === n - 1 && remaining.length ? `THIS IS THE LAST STRETCH, so make whatever is left happen.` : "",
      envelopeText ? `EDGE ENVELOPE (do not exceed):\n${envelopeText}` : "",
      report.clocks_fired.length ? `CLOCKS FIRED (these HAPPENED):\n${report.clocks_fired.join("\n")}` : "",
      report.drive_log.length ? `WORLD MOTION:\n${report.drive_log.slice(0, 8).join("\n")}` : "",
      report.consequences_due.length ? `NOW AT THE DOOR:\n${report.consequences_due.join("\n")}` : "",
      state.world.threads.some((t) => t.status === "active")
        ? `OPEN THREADS (resolve them by their exact title, and only the ones these ${b.span_days} day(s) actually settle, up to tension ${resolvableTension(b.span_days)}; heavier storylines get resolved in played scenes, never here):\n${state.world.threads.filter((t) => t.status === "active").map((t) => `- ${t.title} (tension ${t.tension})${(t.tension ?? 0) > resolvableTension(b.span_days) ? " — TOO HEAVY" : ""}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");

    let beat: any = {};
    // PER-BEAT usage (never cumulative — the spend meter sums telemetry, and cumulative values
    // would count every earlier beat again on each new one)
    let beatIn = 0, beatOut = 0, beatCost = 0;
    try {
      const msgs = buildMessages(BEAT_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
      const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 2000);
      beatIn = res.usage.prompt_tokens; beatOut = res.usage.completion_tokens; beatCost = res.usage.cost ?? 0;
      tokensIn += beatIn; tokensOut += beatOut;
      beat = safeJson(res.text, {});
    } catch { /* deterministic fallback below */ }

    const vignette = String(beat?.vignette ?? "").trim()
      || [`${b.goal}.`, ...report.drive_log.slice(0, 3)].join(" ");
    beat.vignette = vignette;

    applyBeat(state, beat, plan, i, n, origins, landed, beatStartTime);

    const threadShifts: string[] = [];
    applyThreads(state, beat?.threads_resolve, beat?.threads_new, state.world.current_turn, threadShifts, b.span_days);

    // a month of living a trait grounds it — the montage ages novelty the same way play does,
    // so a character doesn't come out of a 30-day skip rediscovering their oldest habit.
    if (state.model_settings.habit_engine)
    {
      // the beat writer read its own days and reports by MEANING — string matching
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
      span_label: `${b.span_days === 1 ? "a day" : `${b.span_days} days`} — ${b.goal}`,
      player_action: `— ${b.goal} —`,
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
      pressure_source: `montage ${i + 1}/${n} — ${b.goal}`,
      narrator_tokens_in: 0, narrator_tokens_out: 0,
      simulator_tokens_in: beatIn, simulator_tokens_out: beatOut,
      turn_cost: beatCost,
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
  // ── CHAPTER ── a montage IS a chapter-sized arc: a span of time with a shape, an
  // ending, and a changed world. Chaptering normally fires on a turn cadence
  // (turn % chapter_cadence), which a multi-beat skip can jump clean over — leaving
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
      `These stretches all belong to one montage the player asked for: "${opts.direction}"`,
      `SPAN: ${opts.days} days, ${n} beats.`,
      priorPersona ? `PRIOR READING OF THE PLAYER: ${priorPersona.mbti} — ${priorPersona.read}` : "",
      state.world_bible.destination ? `DESTINATION: ${state.world_bible.destination}` : "",
      `BEATS:\n${beats}`,
    ].filter(Boolean).join("\n\n");
    const msgs = buildMessages(CHAPTER_SYSTEM, stablePrefix(state), ask, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 1200);
    trackAux(state, res.usage);
    tokensIn += res.usage.prompt_tokens; tokensOut += res.usage.completion_tokens;
    const ch = safeJson<any>(res.text, {});
    if (ch?.summary) {
      const persona = ch.persona?.mbti && ch.persona?.read
        ? {
            mbti: String(ch.persona.mbti).slice(0, 6).toUpperCase(),
            read: clipText(ch.persona.read, 420),
            traits: (ch.persona.traits ?? []).slice(0, 5).map((t: any) => clipText(t, 90)),
            shift: ch.persona.shift && String(ch.persona.shift).trim() ? clipText(ch.persona.shift, 240) : undefined,
          }
        : undefined;
      state.chapters ??= [];
      state.chapters.push({
        idx: state.chapters.length + 1,
        from_turn: fromTurn, to_turn: state.world.current_turn,
        title: clipText(ch.title ?? `${opts.days} days`, 80),
        // "2-3 sentences" of summary is 300-500 characters on an ordinary answer, so a 400 cap cut
        // the last sentence off most chapters in the Chronicle. This is the runaway guard now.
        summary: clipText(ch.summary, 800),
        on_contract: ch.on_contract !== false,
        drift: clipText(ch.drift, 300) || undefined,
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
  // Through the same gate as every other creation path — exact-name equality on its own let a
  // montage stand up a second copy of somewhere the story already had, or a room inside one.
  const create = plan.place_plan?.create;
  if (create?.name) {
    const intent = placeIntent(state, create.name, "montage");
    if (intent && "create" in intent) {
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
