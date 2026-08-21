import { absMinutes } from "./time";
/**
 * Pressure controller — replaces the Threat Director LLM call. Zero tokens.
 *
 * Model: scene pressure P_t ∈ [0,10] drawn from a difficulty-defined target
 * mixture, corrected by a proportional controller on the rolling empirical
 * mean (so long-run distribution converges to target — verified by Monte
 * Carlo in verify/verify.ts), with hard constraints:
 *   C1 opening grace:        t ≤ 2 ⇒ P ≤ 2
 *   C2 breath rule:          mean(P_{t-2}, P_{t-1}) ≥ 7 ⇒ P ≤ 4
 *   C3 lethality ceiling:    lethality=low ⇒ P ≤ 9; medium ⇒ ≤ 10 with cause
 *   C4 earned danger:        P ≥ 8 requires max(thread tension, clock heat) ≥ 6
 *   C5 mundane default:      restful intents bias the draw down 2 bands
 *
 * The fiction-awareness the old LLM director provided is recovered from
 * state: thread tension (set by the Simulator), due consequences, and
 * faction clock heat feed an additive "fiction heat" term — so pressure is
 * still earned by the story, just computed instead of asked for.
 */
import type { DifficultyProfile, Thread, ConsequenceEvent, FactionClock, SaveState } from "./types";

export interface PressureInput {
  turn: number;
  now?: string;                    // current in-world time ("Day N, HH:MM") — gates time-scheduled consequences
  trace: number[];                 // prior pressures
  difficulty: DifficultyProfile;
  threads: Thread[];
  consequences: ConsequenceEvent[];
  clocks: FactionClock[];
  action: string;                  // player's typed intent
  instability?: number;            // 0..1 from the Undertow — chaotic regimes run hotter
  focusMode?: "build" | "active" | null;  // phase: build suppresses new chaos, active runs hot
  focusLabel?: string | null;      // what we're converging on / in (for the directive text)
  tension?: number;                // 0-10 master dial; 0 = engine originates nothing new
  rng?: () => number;              // injectable for verification
}

/** A consequence is due only when BOTH its turn floor has passed AND, if it has an in-world
 *  fire_time, the clock has actually reached it. This is what stops "in 2 days" from firing
 *  in minutes: turns may fly by in a fast conversation, but the calendar hasn't moved. */
export function isDue(c: ConsequenceEvent, turn: number, now?: string): boolean {
  if (c.status !== "pending") return false;
  if (c.fire_turn > turn) return false;
  if (c.fire_time && now && absMinutes(now) < absMinutes(c.fire_time)) return false;
  return true;
}

export interface PressureVerdict {
  pressure: number;
  band: "calm" | "friction" | "obstacle" | "danger" | "lethal";
  source: string;                  // one-line rationale traceable to state
  due_consequence?: ConsequenceEvent;
  focus_event?: string | null;     // echoed so the directive can surface it
  focus_mode?: "build" | "active" | null;
}

/** Target band probabilities by friction density: [calm, friction, obstacle, danger, lethal] */
export const TARGETS: Record<DifficultyProfile["friction_density"], number[]> = {
  sparse:   [0.50, 0.35, 0.12, 0.025, 0.005],
  balanced: [0.30, 0.40, 0.20, 0.08, 0.02],
  dense:    [0.15, 0.40, 0.30, 0.12, 0.03],
};
export const BAND_RANGES: [number, number][] = [[0, 2], [3, 5], [6, 7], [8, 9], [10, 10]];
export const BAND_NAMES = ["calm", "friction", "obstacle", "danger", "lethal"] as const;

const RESTFUL = /\b(rest|sleep|eat|drink|sit|relax|talk|chat|walk|stroll|read|wash|bathe|cook|tend|mend|browse|listen|watch|wait)\b/i;

export function bandMean(target: number[]): number {
  return target.reduce((s, p, i) => s + p * ((BAND_RANGES[i][0] + BAND_RANGES[i][1]) / 2), 0);
}

export function fictionHeat(threads: Thread[], clocks: FactionClock[], consequences: ConsequenceEvent[], turn: number, now?: string): { heat: number; source: string } {
  let heat = 0;
  let source = "ambient world texture";
  const hot = threads.filter((t) => t.status === "active").sort((a, b) => b.tension - a.tension)[0];
  if (hot && hot.tension > heat) { heat = hot.tension; source = `thread: ${hot.title}`; }
  for (const c of clocks) {
    if (c.status !== "running" || c.segments === 0) continue;
    const h = (c.filled / c.segments) * 8;
    if (h > heat) { heat = h; source = `clock: ${c.faction} — ${c.objective}`; }
  }
  const due = consequences.find((c) => isDue(c, turn, now));
  if (due) {
    const h = due.severity === "major" ? 8 : due.severity === "notable" ? 6 : 4;
    if (h >= heat) { heat = h; source = `consequence due: ${due.description}`; }
  }
  return { heat, source };
}

export function decidePressure(input: PressureInput): PressureVerdict {
  const rng = input.rng ?? Math.random;
  const target = TARGETS[input.difficulty.friction_density];

  // proportional correction: shift band probabilities toward target mean
  const window = input.trace.slice(-12);
  const mean = window.length ? window.reduce((a, b) => a + b, 0) / window.length : bandMean(target);
  let err = bandMean(target) - mean;                   // >0 ⇒ we've been too quiet
  // PHASE: in a "build" phase the player is converging on an event — do not manufacture friction
  // to hit a quota (a quiet stretch is fine). In an "active" phase the event has arrived and the
  // world runs hot — allow the upward correction (don't damp it).
  if (input.focusMode === "build" && err > 0) err = 0;
  const kP = 0.10;                                     // gentle gain (stability proven in verify)
  const tilt = Math.max(-0.3, Math.min(0.3, kP * err));

  // tilted band distribution: move mass between calm and {obstacle,danger}
  const p = [...target];
  const shift = Math.abs(tilt);
  if (tilt > 0) { const take = Math.min(p[0], shift); p[0] -= take; p[2] += take * 0.7; p[3] += take * 0.3; }
  else if (tilt < 0) { const take = Math.min(p[2] + p[3], shift); const t2 = Math.min(p[2], take * 0.7), t3 = Math.min(p[3], take * 0.3); p[2] -= t2; p[3] -= t3; p[0] += t2 + t3; }

  // sample band
  let r = rng(), band = 0;
  for (let i = 0; i < p.length; i++) { r -= p[i]; if (r <= 0) { band = i; break; } if (i === p.length - 1) band = i; }

  // fiction heat: pressure ≥ 8 must be earned (C4); heat also pulls band up
  let { heat, source } = fictionHeat(input.threads, input.clocks, input.consequences, input.turn, input.now);
  if (input.instability) {
    heat = Math.min(10, heat + input.instability * 2);
    if (input.instability >= 1) source = source === "quiet — the world breathes" ? "the undertow — the world is primed" : source + " (amplified by the undertow)";
  }
  const due = input.consequences.find((c) => isDue(c, input.turn, input.now));
  if (due && due.severity !== "minor") band = Math.max(band, due.severity === "major" ? 3 : 2);
  if (band >= 3 && heat < 6) band = 2;                 // C4: unearned danger demoted to obstacle
  if (band === 4 && (input.difficulty.lethality === "low" || heat < 8)) band = 3; // C3 + earned-lethal

  // restful intent bias (C5): drop up to 2 bands when nothing is due
  if (RESTFUL.test(input.action) && !due && heat < 5) band = Math.max(0, band - 2);

  // PHASE shaping of the band:
  if (input.focusMode === "build" && !due) band = Math.min(band, 1);   // converge: keep it from spiking sideways
  if (input.focusMode === "active") band = Math.max(band, 2);          // the event is here: the world runs hot (still gated by heat/lethality below)

  // breath rule (C2)
  const last2 = input.trace.slice(-2);
  if (last2.length === 2 && (last2[0] + last2[1]) / 2 >= 7) band = Math.min(band, 1);

  // opening grace (C1)
  if (input.turn <= 2) band = 0;

  // MASTER TENSION DIAL (0–10, default 5). Scales the whole band down as it drops; at 0 the world
  // never escalates on its own — only a consequence the player themselves set in motion can raise it,
  // and even then it stays an obstacle, not danger. This is the global "let me breathe" control.
  const tension = input.tension ?? 5;
  if (tension <= 0) {
    band = due ? Math.min(band, 2) : 0;          // nothing the engine originated; calm unless the player's own due event lands
  } else if (tension < 5) {
    // below midpoint: pull the band toward calm. A due consequence may still LAND, but the dial
    // throttles how hard — it no longer gets a free pass to danger. This is what lets a player turn
    // tension down to escape a runaway plot whose consequence queue would otherwise keep firing
    // high pressure regardless of the dial. tension 1–2 → cap friction, 3 → friction (due: obstacle),
    // 4 → obstacle. The due event still happens; it just arrives proportionate to the calm setting.
    const baseCap = tension <= 3 ? 1 : 2;
    const dueCap = tension <= 2 ? 1 : 2;          // even a due event stays an obstacle at most when calm
    band = Math.min(band, due ? dueCap : baseCap);
  } else if (tension > 5) {
    // above midpoint: allow a modest upward nudge in how hot it can run
    if (heat >= 5 && band < 4) band = Math.min(4, band + (tension >= 8 ? 1 : 0));
  }

  // pressure within band, leaning low
  const [lo, hi] = BAND_RANGES[band];
  const pressure = Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1) * 0.9));
  // lethality cap (C3)
  const capped = input.difficulty.lethality === "low" ? Math.min(9, pressure) : pressure;

  return {
    pressure: capped,
    band: BAND_NAMES[band],
    source: band === 0 ? "quiet — the world breathes" : source,
    due_consequence: due,
    focus_event: input.focusLabel ?? null,
    focus_mode: input.focusMode ?? null,
  };
}


/** ── SOURCE-DRIVEN BEATS ──────────────────────────────────────────────────────────────────
 * The Uncut Gems principle: tension is the WEIGHT of what's standing, not the FREQUENCY of
 * what arrives. Howard sleeps; nobody bothers him at night — because pressure lives in the
 * debts that exist, the bet that's riding. So a pressure beat must NAME its source from
 * standing state (a due consequence, a maturing clock, a hot thread, an offscreen agent's
 * drive) or not fire at all. Silence is a legitimate output. The genuinely out-of-nowhere is
 * budgeted to rarity — and arrives witnessed, not targeted. Between discharges, REMINDER
 * beats keep the weight felt at zero mechanical cost: a message, a look, a rumor.
 */
export interface AgentCandidate { name: string; goal: string; priority: number }
/** IS THE THREAT THE PREMISE, OR AN INTRUSION INTO IT?
 *
 *  Read off the tone the player chose at forge time and the pressure palette the forge wrote for it.
 *  A drama, a romance, a mystery: the danger arrives from outside an ordinary life, and the opening
 *  act is that life. Zombies, a war, a hunt, a siege, a plague: the danger IS the ordinary life, and
 *  an opening act without it is not an establishing scene, it is the wrong story.
 *
 *  Deliberately matched on the palette too, not just the tone word — the palette is the concrete
 *  list of what may press ("walkers converging on noise", "dwindling ammunition"), and it is the
 *  more honest signal of what kind of world this is. */
const SIEGE = /(zombie|walker|undead|infected|outbreak|plague|apocalyp|survival|siege|besieg|\bwar\b|warfare|militar|combat|shelling|artiller|horror|monster|predator|hunted|manhunt|raid|invasion|famine|starv|blizzard|wasteland|dystop|escape|survive|eaten|bite|infection|contagion|ammunition|\\bammo\\b)/i;
export function isBesieged(tone?: string, palette?: string[]): boolean {
  return SIEGE.test(`${tone ?? ""} ${(palette ?? []).join(" ")}`);
}

/** Turns before the world may discharge on a player who just arrived in it. */
const GRACE_TURNS = 8;
/** …and when the threat is the premise rather than an intrusion into it. Two turns is enough to
 *  establish where everyone is standing; a third quiet one is the story failing to start. */
const BESIEGED_GRACE = 2;

export interface BeatInput {
  turn: number;
  now?: string;
  tension: number;
  threads: Thread[];
  clocks: FactionClock[];
  consequences: ConsequenceEvent[];
  agents: AgentCandidate[];        // offscreen central chars whose drive intersects the player's orbit
  last_beat_turn: number;
  last_exo_turn: number;
  /** In-world minutes elapsed since the last discharge / the last exogenous event (never negative).
   *  Supplied from pressure_state.last_beat_time / last_exo_time; undefined before the first beat
   *  and on saves written before the clock was tracked, in which case the turn ladders are used. */
  minutesSinceBeat?: number;
  minutesSinceExo?: number;
  restoration?: boolean;           // rest turns never receive incident beats (protection handled upstream too)
  /** True when the premise IS the threat — zombies, a war, a hunt, a siege. See GRACE_TURNS. */
  besieged?: boolean;
  /** What has already fired, and how often. Without this, `standing` is a flat bag sampled
   *  uniformly every turn, so the loudest source keeps being re-picked — which is how the same
   *  raiders came back and died to the player three times. A source that has just discharged is
   *  not a source; it is a thing that already happened. */
  recent?: { ref: string; turn: number; count: number; kind?: string }[];
  rng?: () => number;
}
export type Beat =
  | { kind: "none" }
  | { kind: "reminder"; ref: string }
  | { kind: "consequence"; ref: string; consequence: ConsequenceEvent }
  | { kind: "clock"; ref: string; signs?: string[]; filled?: number; segments?: number }
  | { kind: "thread"; ref: string }
  | { kind: "agent"; ref: string; goal: string }
  | { kind: "exogenous" };

/** Refractory period between incident beats — the world does not stack. Tightens as clocks
 *  mature, which is where act structure comes from: quiet middles, converging ends. */
export function beatCooldown(tension: number, clocks: FactionClock[]): number {
  const base = tension <= 2 ? 10 : tension <= 4 ? 7 : tension <= 6 ? 5 : tension <= 8 ? 3 : 2;
  return clocksMaturing(clocks) ? Math.max(1, Math.ceil(base * 0.6)) : base;
}
const clocksMaturing = (clocks: FactionClock[]): boolean =>
  clocks.some((c) => c.status === "running" && c.segments > 0 && c.filled / c.segments >= 0.85);

/** The same refractory period, spent on the IN-WORLD CLOCK rather than the turn counter — this is
 *  the real gate whenever the caller knows the time (see minutesSinceBeat).
 *
 *  A turn is not a unit of time. The Simulator reports elapsed_minutes per turn, and a brief
 *  exchange is 2–10 minutes where a night is 480. Spacing incidents by turn count therefore paced
 *  the world by conversation volume: six quick exchanges in a doorway "earned" a fresh crisis
 *  inside half an hour of the character's life, while a scene that skipped an afternoon was held to
 *  the same wait as one that skipped five minutes. Hours are what a person feels between blows. */
export function beatCooldownMinutes(tension: number, clocks: FactionClock[]): number {
  const base = tension <= 2 ? 600 : tension <= 4 ? 300 : tension <= 6 ? 150 : tension <= 8 ? 75 : 40;
  return clocksMaturing(clocks) ? Math.max(15, Math.round(base * 0.6)) : base;
}
/** However much fiction-time one turn swallowed, the world does not discharge twice on consecutive
 *  pages — a night's sleep clears the clock gate, not the reader's need for a beat of ordinary
 *  scene between two incidents. */
const MIN_GAP_TURNS = 2;
const EXO_INTERVAL = (tension: number): number => (tension <= 3 ? 40 : tension <= 6 ? 25 : 15);
/** Exogenous rarity on the clock: roughly one every couple of days when the world is quiet, one a
 *  day at middling tension, one every twelve hours when it runs hot. */
const EXO_MINUTES = (tension: number): number => (tension <= 3 ? 2880 : tension <= 6 ? 1440 : 720);

export function selectBeat(inp: BeatInput): Beat {
  const rng = inp.rng ?? Math.random;
  if (inp.tension <= 0) {
    const due0 = inp.consequences.find((c) => isDue(c, inp.turn, inp.now));
    return due0 ? { kind: "consequence", ref: due0.description.slice(0, 80), consequence: due0 } : { kind: "none" };
  }
  // a DUE consequence always lands — the player (or the world) loaded it; the calendar fired it
  const due = inp.consequences.find((c) => isDue(c, inp.turn, inp.now));
  if (due) return { kind: "consequence", ref: due.description.slice(0, 80), consequence: due };

  // GRACE WINDOW: the opening turns establish a world; they do not besiege the player who just
  // arrived in it. Standing weight may be FELT (reminders) but nothing discharges yet.
  //
  // EXCEPT WHEN BESIEGEMENT IS THE PREMISE. Eight turns was genre-blind, and for a zombie survival
  // story that is the entire opening act guaranteed quiet: one save reached turn 8 of "Horror,
  // action, drama" — pressure palette led by "walkers converging on noise" — having produced a beat
  // on none of its seven turns, every one of them emitting the line below that says nothing arrives
  // and that it outranks the genre. Zero walkers, by construction, in a game about walkers.
  //
  // A drama earns its grace: the threat there is an intrusion into an ordinary life, and arriving
  // in one is the point of the first act. In a siege the threat IS the ordinary life. Establishing
  // that world means showing it.
  const grace = inp.besieged ? BESIEGED_GRACE : GRACE_TURNS;
  if (inp.turn <= grace) {
    const early = inp.threads.find((t) => t.status === "active" && (t.tension ?? 0) >= 5);
    const minRemind = inp.besieged ? 1 : 4;
    return early && inp.turn >= minRemind && (inp.rng ?? Math.random)() < (inp.besieged ? 0.7 : 0.35)
      ? { kind: "reminder", ref: String(early.title ?? "").slice(0, 90) }
      : { kind: "none" };
  }

  const sinceBeat = inp.turn - inp.last_beat_turn;
  // COOLDOWN. When the caller knows how long it has actually been, the in-world clock is the gate
  // and the turn count is only the floor that keeps two discharges off consecutive pages. Without
  // it (old save, or nothing has fired yet) fall back to the turn ladder as before.
  const cooling = inp.minutesSinceBeat === undefined
    ? sinceBeat < beatCooldown(inp.tension, inp.clocks)
    : inp.minutesSinceBeat < beatCooldownMinutes(inp.tension, inp.clocks) || sinceBeat < MIN_GAP_TURNS;
  const standing: { ref: string; kind: string; mk: () => Beat }[] = [];
  for (const c of inp.clocks) if (c.status === "running" && c.segments > 0 && c.filled / c.segments >= 0.75)
    standing.push({ ref: `${c.faction}: ${c.objective}`.slice(0, 90), kind: "threat", mk: () => ({
      kind: "clock", ref: `${c.faction}: ${c.objective}`.slice(0, 90),
      // THE SIGNS TRAVEL WITH THE BEAT. The narrator is deliberately not shown the clock table —
      // a faction's objective is private bookkeeping and handing it over is the omniscience leak.
      // But visible_signs is the opposite of private: the forge writes it as what an ordinary
      // person in this world can SEE of that faction's progress, which is exactly what "advance
      // this clock into the player's awareness" needs and was never given. Told to advance a clock
      // with nothing observable attached, the narrator wrote a line of foreboding and moved on,
      // which is a clock flaring with nothing in the prose to show for it.
      signs: (c.visible_signs ?? []).filter((x) => String(x ?? "").trim()).slice(0, 3),
      filled: c.filled, segments: c.segments,
    }) });
  // A thread had to reach tension 6 to be pickable, which is a CRISIS threshold. Everything that is
  // merely the world's ordinary business — an upkeep dispute, an office that must be told, a
  // neighbour who now wants the same engineers — opens low and matures slowly, so under the old
  // rule it could sit in state forever and never once reach the page. Non-threat threads qualify
  // at 2. That is the whole point of authoring them.
  for (const t of inp.threads) {
    if (t.status !== "active") continue;
    const kind = t.kind ?? "threat";
    const bar = kind === "threat" ? 6 : 2;
    if ((t.tension ?? 0) >= bar)
      standing.push({ ref: String(t.title ?? "").slice(0, 90), kind, mk: () => ({ kind: "thread", ref: String(t.title ?? "").slice(0, 90) }) });
  }
  // Agents gated at priority 6 meant a person only pressed the world when they were in crisis.
  // People acting on ordinary wants IS how a world turns; 3 lets them.
  for (const a of inp.agents) if ((a.priority ?? 1) >= 3)
    standing.push({ ref: `${a.name} — ${a.goal}`.slice(0, 90), kind: "relationship", mk: () => ({ kind: "agent", ref: a.name, goal: a.goal }) });

  // ── PER-SOURCE FATIGUE ──────────────────────────────────────────────────────
  // Every source in `standing` used to be equally eligible on every turn, chosen by a flat random
  // index. A thread at tension 8 therefore stayed pickable forever, and the narrator instantiated
  // it the same way each time: raiders arrive, raiders lose, thread still at 8, raiders arrive.
  // The world state said "this is a live threat" and never learned the player had answered it.
  //
  // A source that just discharged now goes quiet, and the more often it has discharged the longer
  // it stays quiet — a threat that keeps losing is a threat that stops coming. Four discharges and
  // it is retired outright until something changes its underlying tension, which is the world
  // admitting the approach failed rather than running it a fifth time.
  const hist = new Map((inp.recent ?? []).map((r) => [r.ref, r]));
  const RETIRE_AT = 4;
  const quietFor = (count: number) => 6 + count * 10;   // 1st repeat waits 16 turns, 2nd 26, 3rd 36
  const eligible = standing.filter((sd) => {
    const h = hist.get(sd.ref);
    if (!h) return true;
    if (h.count >= RETIRE_AT) return false;
    return inp.turn - h.turn >= quietFor(h.count);
  });
  // Prefer the source that has been silent longest, rather than sampling uniformly. Uniform choice
  // over a small set re-picks the same thing constantly; least-recently-used rotates the world.
  // SPREAD. Least-recently-used rotates individual sources but says nothing about VARIETY: a world
  // holding four threats and one obligation will run threat, threat, threat, threat, obligation, and
  // read as unrelenting even though every source is fresh. A kind absent from the last several beats
  // gets a bonus that puts it ahead of a slightly staler source of a kind we just used.
  const recentKinds = new Set((inp.recent ?? []).filter((r) => inp.turn - r.turn <= 6).map((r) => r.kind ?? "threat"));
  const pickStanding = () => {
    if (!eligible.length) return null;
    let best = eligible[0], bestAge = -1;
    for (const sd of eligible) {
      const h = hist.get(sd.ref);
      const raw = h ? inp.turn - h.turn : Number.MAX_SAFE_INTEGER;
      const age = raw === Number.MAX_SAFE_INTEGER ? raw : raw + (recentKinds.has(sd.kind) ? 0 : 12);
      if (age > bestAge) { best = sd; bestAge = age; }
    }
    return best;
  };

  if (cooling || inp.restoration) {
    // between discharges: reminder beats keep the weight felt — never during rest at low tension
    // Reminders may reference a fatigued source — being reminded of a standing threat is not the
    // same as it acting again — but never a retired one.
    const remind = pickStanding() ?? standing.find((sd) => (hist.get(sd.ref)?.count ?? 0) < RETIRE_AT);
    // Deliberately still counted in TURNS: an incident is an event in the world and is spaced by the
    // world's clock, but a reminder is texture on the page — the rule it obeys is "don't echo the
    // thing we just did", which is measured in scenes read, not hours lived.
    if (remind && sinceBeat >= 3 && inp.tension >= 3 && !inp.restoration && rng() < 0.5) {
      return { kind: "reminder", ref: remind.ref };
    }
    return { kind: "none" };
  }

  // discharge from standing state — probability scales with tension; silence is legitimate
  const fireP = inp.tension <= 2 ? 0.25 : inp.tension <= 4 ? 0.45 : inp.tension <= 6 ? 0.6 : 0.8;
  const chosen = pickStanding();
  if (chosen && rng() < fireP) return chosen.mk();

  // exogenous: rationed rarity — witnessed, not targeted. Rationed on the same clock as the beats:
  // "rare" means rare in the character's life, not rare per page.
  const sinceExo = inp.turn - inp.last_exo_turn;
  const exoReady = inp.minutesSinceExo === undefined
    ? sinceExo >= EXO_INTERVAL(inp.tension)
    : inp.minutesSinceExo >= EXO_MINUTES(inp.tension) && sinceExo >= MIN_GAP_TURNS;
  if (exoReady && rng() < 0.5) return { kind: "exogenous" };

  const tail = pickStanding();
  if (tail && rng() < 0.3) return { kind: "reminder", ref: tail.ref };
  return { kind: "none" };
}

/** Compact directive injected into the narrator's volatile digest. */
export function pressureDirective(v: PressureVerdict, palette?: string[], tension?: number, tier: PowerTier = "mortal", beat?: Beat): string {
  const lines = [`PRESSURE ${v.pressure}/10 (${v.band}) — source: ${v.source}.`];
  if ((tension ?? 5) <= 0) {
    lines.push("TENSION 0 — THE WORLD IS AT REST. Do NOT introduce any new threat, problem, complication, arrival, or background development. Nothing new presses on the player this turn. Render the scene and the people in it responding naturally to what the player does — let it breathe. A quiet, uneventful beat is not only allowed, it is correct. Only continue something the player themselves set in motion. Present characters may still exist and respond, but at rest-tension they do NOT manufacture a confrontation, escalate, corner the player with a demand, or turn the scene into a moral challenge or debate — if the player wants solitude or quiet, the world grants it and the people present settle, disengage, or leave them be rather than pressing an agenda.");
  } else if (!beat) {
    // A missing beat used to emit NO LINE AT ALL, which the narrator reads as permission rather
    // than as silence — and with the genre paragraph telling it that a quiet stretch is a failure
    // to fix, it fills the vacuum with raiders. Absence of a source is a constraint, not a gap.
    lines.push("NO SOURCE FOR THIS TURN. Nothing new arrives or develops from outside; the scene runs on the people already in it.");
  } else {
    // SOURCE-DRIVEN: the world may only press through what already exists. No beat, no incident.
    switch (beat.kind) {
      case "none":
        lines.push("NO NEW INCIDENT THIS TURN — no rider, no messenger, no alarm, no smoke, no sail, no armed men, no summons, no discovery, no one appearing at a door. The scene runs on the present characters' own wants and reactions; people acting on what they want IS the scene, and quiet is correct rather than a failure. THIS IS NOT A CHANGE OF SETTING. Whatever is permanently true of this world is still true and still on the page — its weather, its ruin, its dead, its dark, whatever the people here have to keep doing to stay alive. A world where the danger is the ordinary condition does not become a safe one because nothing new happened; it is simply not interrupted this turn. Withhold the EVENT, never the place.");
        break;
      case "reminder":
        lines.push(`REMINDER BEAT — NOT an incident. Let the standing weight of "${beat.ref}" brush the scene once, lightly: a message arriving, a name overheard, a look that closes, distant sound. It demands NOTHING and interrupts nothing; it is felt and the scene continues.`);
        break;
      case "consequence":
        lines.push(`A scheduled consequence reaches the scene NOW: ${beat.ref}. It arrives through the people and stakes already established — never from thin air.`);
        break;
      case "clock":
        lines.push(`PRESSURE BEAT from a maturing faction clock — "${beat.ref}"${
          typeof beat.filled === "number" && beat.segments ? `, ${beat.filled} of ${beat.segments} of the way to happening` : ""
        }.${
          beat.signs?.length
            ? `\nWHAT A PERSON HERE WOULD ACTUALLY SEE OF IT — put at least one of these ON THE PAGE this turn, as a thing that happens where the player is, not as a mood: ${beat.signs.join("; ")}. Nobody in the scene knows what it is FOR; they see the sign and read it however their own life tells them to.`
            : ""
        } Advance it concretely into the player's awareness through established characters or their works. Named, traceable, earned — and POSSIBLE under the world bible: an institution moves at the speed of its actual machinery (meetings, couriers, votes, shifts). A loose federation without internet cannot coordinate overnight; when an objective outruns what the world could physically do in the elapsed time, the clock stalls on its own logistics instead.`);
        break;
      case "thread":
        lines.push(`PRESSURE BEAT from the open thread "${beat.ref}". The thread moves — a development in it reaches the player through established people or places. No new subplot; this one advances.`);
        break;
      case "agent":
        lines.push(`PRESSURE BEAT from a person: ${beat.ref} acts on their goal ("${(beat as any).goal}") in a way that touches the player's orbit — a visit, a message, a move made through others. Their action follows THEIR logic and state, not plot convenience.`);
        break;
      case "exogenous":
        lines.push(`EXOGENOUS EVENT (rare by design): something from outside the story's standing threads happens NEAR the player — witnessed, not targeted at them. It may seed a new thread they can pull or ignore; it demands no response. Real life's accidents happen beside you, not to you.`);
        break;
    }
  }
  if (v.due_consequence && beat?.kind !== "consequence") lines.push(`A scheduled consequence reaches the scene NOW: ${v.due_consequence.description}`);
  if (v.focus_event && v.focus_mode === "build") lines.push(`FOCUS (building toward "${v.focus_event}"): bend this scene toward it; keep motion moving steadily in its direction. Do NOT introduce new unrelated threats, subplots, or chaos that would sideline it; let smaller frictions resolve quickly so the throughline stays clear. The player is driving toward this — honor it.`);
  if (v.focus_event && v.focus_mode === "active") lines.push(`FOCUS (now inside "${v.focus_event}"): the event has arrived — this is the situation now. Stakes are high and immediate; let consequences hit hard and fast within this event. Keep the scene centered on it; do not wander off into unrelated calm.`);
  // Tier nudge (NOT a behavior script): at high power, a martial/institutional threat against the
  // protagonist is a category error. We don't prescribe how mortals act — that emerges from their
  // own state (terror pins relaxation low; a clenched person flatters, lies, schemes, capitulates
  // through the perception gate). We only steer the narrator off the wrong reflex.
  if ((tension ?? 5) > 0) {
    if (tier === "cosmic") {
      lines.push(`The protagonist is beyond any threat this world can field, and everyone present knows it. Do not invent martial or institutional threats against them (no troops sent, no hunters dispatched, no "the Empire is coming") — that is a category error. Pressure here is the mortals' own reaction to power they cannot resist. That reaction is NOT automatically fear or opposition: people who cannot resist a power also court it, claim it, follow it, sell access to it, ask it for things, or build a life in its shadow, and what any given person does comes from their own state, their standing with the player, and what they want — never from a script that assumes the powerful are resented.`);
    } else if (tier === "mythic") {
      lines.push(`The protagonist outclasses ordinary threats and the people near them sense it. A direct martial challenge should be rare and only if genuinely novel — and a KIND of attacker the player has already beaten does not get to try again the same way. Men who watched their fellows lose to this person do not charge him; they hang back, negotiate, bring someone with authority, poison the well, take a hostage, or leave. Repeating a losing attack is not tension, it is the world failing to learn. That list is how HOSTILE parties adapt — it is not the whole world's posture: people with no quarrel with the player, or who have been helped by them, respond by seeking them out, asking, petitioning, following, or trading on the connection. Otherwise pressure is consequence and reaction, drawn from each character's own state.`);
    } else if (palette?.length) {
      lines.push(`Draw pressure only from: ${palette.join("; ")}.`);
    }
  } else if (palette?.length) {
    lines.push(`Draw pressure only from: ${palette.join("; ")}.`);
  }
  return lines.join(" ");
}

export type PowerTier = "mortal" | "empowered" | "mythic" | "cosmic";

/** How far past mortal the protagonist has scaled. A light gate on the tier nudge above — NOT a
 *  behavior driver (behavior emerges from the relaxation kernel). Visible reality-breaking acts
 *  read as cosmic. The god_mode SETTING no longer contributes: see detectPowerTier. */
/**
 * Tier from what the WORLD HAS SEEN THE PLAYER DO, not from prose adjectives and not from a setting.
 *
 * detectPowerTier reads the last few turns of text for phrases like "godlike" or "levitated the".
 * That misses the case that actually matters: a player who has already beaten this exact threat,
 * repeatedly, in plain unremarkable prose. Nothing in the recent text says "impervious", so the
 * tier stays mortal, so the directive keeps allowing martial challenges, so raiders keep charging
 * a man they have already lost to three times. The ledger knows better than the adjectives —
 * count what he has actually survived and won.
 */
export function tierFromRecord(
  base: PowerTier,
  recent: { ref: string; turn: number; count: number; kind?: string }[] = [],
): PowerTier {
  const order: PowerTier[] = ["mortal", "empowered", "mythic", "cosmic"];
  // A source the player has faced down 2+ times is no longer a credible threat FROM THIS WORLD.
  const beaten = recent.filter((r) => r.count >= 2).length;
  if (!beaten) return base;
  const bumped = Math.min(order.indexOf("mythic"), order.indexOf(base) + (beaten >= 2 ? 2 : 1));
  return order[Math.max(order.indexOf(base), bumped)];
}

/**
 * GOD MODE DOES NOT SET THE TIER. It used to: the setting alone floored this at "mythic" and
 * promoted any visible feat to "cosmic". That turned a sovereignty toggle into a permanent
 * world-state — every turn of a god-mode game, including the ones spent drinking tea in a kitchen,
 * carried the mythic tier, which fires BOTH the tier nudge above AND the EARNED_RESPONSE block in
 * turn.ts. Between them the narrator was told every single turn that the onlookers were dealing
 * with overwhelming power, and the only witness reactions on offer were fear-family ones. That is
 * why enabling god mode made the wider community permanently afraid of a player who had not yet
 * done anything: it was the setting talking, not the fiction.
 *
 * The sovereignty god mode promises is delivered in full by the GOD MODE directive in turn.ts,
 * which overrides everything on its own and needs no help from the tier. The tier's job is to
 * describe what bystanders have actually WITNESSED — so it is now earned identically in god mode
 * and out of it: by visible acts (here) and by a record of threats actually beaten (tierFromRecord).
 * A god-mode player who unmakes a city in the street still reads cosmic on the next turn, because
 * the prose says so.
 */
export function detectPowerTier(recentText: string): PowerTier {
  const t = recentText.toLowerCase();
  const cosmic = [
    /transcend\w* (its|their|the)? ?(own )?universe/, /\bxeelee\b/, /unm?ade? (a|the) (sun|star|world|planet|galaxy)/,
    /destroy(ed|s)? (a|the) (sun|star|planet|galaxy)/, /stopped time/, /across the galaxy/, /every imperial/,
    /folded space/, /reality (itself )?(bent|obeyed|reshaped)/, /\bgodlike\b|\bomnipotent\b|like a god\b/,
    /rewrote? (reality|the world|physics)/, /beyond (mortal|human) (comprehension|category)/,
  ].some((re) => re.test(t));
  const mythic = [
    /killed everyone/, /raised the dead/, /mass(acre|-kill)/, /levitat\w+ the/,
    /leveled (a|the) (building|city|block)/,
    /no one could (stop|touch|harm) (him|her|them)/, /impervious|invulnerable|untouchable/,
    // casual reality-bending: teleporting, banishing, recalling, vanishing people/things at will.
    // NOTE: patterns here must be UNAMBIGUOUS power — "with a wave of her hand" and "with his hand" and
    // a bare "teleport" occur in ordinary prose and used to false-stamp every NPC as awestruck and inject
    // the EARNED_RESPONSE block. Removed: /with a (thought|gesture|wave|word)/, /with (a|his|her|their)
    // (mind|hand|will)/, bare /teleport\w*/. Kept only phrasings that can't be innocent.
    // NOT A BARE "ACROSS THE COUNTRY". People fly. A save whose entire plot was a man taking a
    // commercial flight to his mother's house tripped this on the line "You flew across the country
    // in a towel, Vin" — and every character present was stamped "shaken by the player's impossible
    // power", which then persisted on their cards for the rest of the story. The distance is not the
    // impossible part; the MANNER is, so the manner has to be in the pattern.
    /(?:teleport\w*|blink\w*|step(?:ped|s)?|vanish\w*|reappear\w*|will\w*|fold\w*)[^.]{0,30}\b(?:other side of|across) the (planet|world|continent|country)\b/,
    /\b(?:instantly|in an instant|between one (?:breath|heartbeat|blink) and the next)[^.]{0,40}\b(?:other side of|across) the (planet|world|continent|country)\b/,
    /teleported (him|her|them|it|across|away|to)/,
    /(banish\w*|sent?) (him|her|them|\w+) (away|elsewhere|to the) (void|nether|other side|realm)/, /(summon\w*|recall\w*) (him|her|them) (back )?across/,
    /(vanish\w*|disappear\w*) (him|her|them|\w+) (from (existence|the world|sight))/, /snap\w* (his|her|their) fingers and (\w+ )?(vanish|disappear|die|fall|burn)/,
    /out of (existence|the world|reality)/, /with (a|his|her|their) (mind|will) alone/,
  ].some((re) => re.test(t));
  if (cosmic) return "cosmic";
  if (mythic) return "mythic";
  return "mortal";
}

const TIER_ORDER: PowerTier[] = ["mortal", "empowered", "mythic", "cosmic"];
/** Turns a witnessed tier stays at full strength before it steps down one rung. */
const TIER_HALFLIFE = 40;

/**
 * THE WORLD REMEMBERS WHAT IT SAW. detectPowerTier reads the last three turns of prose, which is
 * the right window for "something impossible just happened in front of these people" and the wrong
 * one for "what is this person to this world." Those are different questions and were sharing an
 * answer, with a consequence the ledger makes obvious: the harm a player does is written into
 * edges and lasts forever, while their STANDING as a power evaporates three turns after the last
 * time the prose happened to say something godlike.
 *
 * So the world's opinion of a man who unmade a city block reverts to "unremarkable stranger" while
 * every person he frightened stays frightened — and the directive that tells the narrator people
 * court power, sell access to it, and build lives in its shadow (the cosmic nudge, the one thing
 * in the engine that produces a court instead of a crowd of accusers) essentially never fires.
 *
 * This is the memory. The high-water mark holds for TIER_HALFLIFE turns, then decays one rung at a
 * time — a reputation, not a permanent setting, and still earned only by what was witnessed.
 */
export function rememberPowerTier(
  seen: PowerTier,
  memory: { tier: PowerTier; turn: number } | undefined,
  turn: number,
): { tier: PowerTier; memory: { tier: PowerTier; turn: number } | undefined } {
  const next = memory && TIER_ORDER.indexOf(memory.tier) >= TIER_ORDER.indexOf(seen) ? memory : { tier: seen, turn };
  const steps = Math.floor(Math.max(0, turn - next.turn) / TIER_HALFLIFE);
  const decayed = TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(next.tier) - steps)];
  return {
    tier: TIER_ORDER[Math.max(TIER_ORDER.indexOf(decayed), TIER_ORDER.indexOf(seen))],
    memory: next.tier === "mortal" ? undefined : next,
  };
}

/**
 * FIRED-CLOCK DISCHARGE. A full clock is a PROMISE: its consequence must land, not evaporate.
 * Clocks used to just flip status to "fired" and their promised crisis never reached the scene —
 * the beat picker only considers RUNNING clocks, so a clock that filled mid-scene died silently.
 * Convert each fresh firing into a due consequence; next turn's beat selection checks due
 * consequences first (before cooldowns and grace), so the crisis lands at full scale, on schedule.
 */
export function dischargeFiredClocks(state: SaveState, turn: number): string[] {
  const shifts: string[] = [];
  for (const c of state.world.clocks) {
    if (c.status === "running" && c.filled >= c.segments) {
      c.status = "fired";
      if (c.consequence?.trim()) {
        // idempotent: never queue the same clock's consequence twice (e.g. repaired saves)
        const desc = `${c.faction}'s clock has run out: ${c.consequence.trim()}`;
        if (!state.world.consequences.some((x) => x.status === "pending" && (x.id === `clockfire_${c.id}` || x.description === desc))) {
          state.world.consequences.push({
            id: `clockfire_${c.id}`,
            description: desc,
            fire_turn: turn + 1,
            severity: "major",
            status: "pending",
          });
        }
        shifts.push(`${c.faction}'s clock has run out — what it promised is coming.`);
      }
    }
  }
  return shifts;
}
