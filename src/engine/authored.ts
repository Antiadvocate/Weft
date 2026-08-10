/** AUTHORED WANTS — changing a person by giving them something to want.
 *
 *  See AuthoredDrive in types.ts for why this exists and why it does not live in `drive`.
 *
 *  This module owns three things: the ladder a standing want climbs, the sentence the rest of the
 *  engine reads it as, and the moment it stops being a want and becomes part of the person.
 *
 *  Nothing here spends a token. Escalation is arithmetic on a turn counter; the world-sim and the
 *  narrator get the want in the same shape they already get every other want, and do what they were
 *  always going to do with it. That is the point — the injector is a manual entry point to
 *  machinery that already works, not a second pathway that has to be kept in step with the first. */
import type { AuthoredDrive, Identity, SaveState } from "./types";

/** IN-WORLD HOURS PER RUNG — not turns.
 *
 *  This was turn-counted, and calibrated against a story that runs for weeks. Real games do not:
 *  the save this was built against covered Day 1 to Day 3 in a hundred and eight turns, about a
 *  quarter of an hour of story per turn, and almost nothing on file has ever run past a week. A
 *  want that needed "a few weeks" to mature would simply never mature — it would sit at the bottom
 *  rung until the story ended.
 *
 *  Turns are also the wrong unit in principle. Ten turns is two hours of a slow conversation or
 *  three days across a montage, and a neighbour's late-night parties escalate on nights, not on how
 *  much the player happened to type. The clock already exists; this reads it.
 *
 *  Tuned so all three fit inside a story of a few days: fast lands within one, steady over a couple,
 *  slow needs most of a week and is the one to pick when the story is going to be long. */
// Per RUNG, and there are now five to climb rather than three (see NERVE), so these are scaled to
// keep the TOTAL unchanged: fast still lands inside a day, steady over a couple, slow across most of
// a week. Changing the ladder's length without rescaling these would have quietly made every want
// take almost twice as long to arrive.
const STEP_HOURS: Record<AuthoredDrive["rate"], number> = { slow: 24, steady: 10, fast: 4 };

/** Six rungs: exposure, proximity, examination, the sideways first time, repetition, habit. Past this
 *  it is not escalation any more, it is a different story, and the player can write that one. */
export const MAX_STAGE = 5;

/* HOW A HABIT ACTUALLY FORMS.
 *
 *  The worked example this is built from, and it is worth keeping whole because every rung below is
 *  one of its days:
 *
 *    Day 1  goes to the gas station for coffee, sees the candy, the sheer number of options is
 *           enough to put them off — nothing happens
 *    Day 2  there is a QUEUE, so they are standing near it anyway; they read the calories. Their
 *           turn comes. They ignore it and leave
 *    Day 3  they check the specific brand this time. Hm. That is not too bad. Is it any good —
 *           and then they have to shop
 *    Day 4  they ask the man at the counter: you like these, right? Light for a morning? They take one
 *    Day 5  they skip a day, and next time notice they could use something sweet
 *    Day 6  again, because why not, it is light
 *    Day 10 they always get it
 *
 *  Three things in that which the previous ladder got wrong.
 *
 *  IT IS EXTERNAL BEFORE IT IS INTERNAL. Nothing in the first three days is a decision. A queue puts
 *  them there; the shelf is at eye level; a stranger's opinion is available. The environment supplies
 *  the occasion and they are simply in the right place often enough. So the early rungs are written
 *  as things the SCENE does, not things the character resolves to do.
 *
 *  IT IS NON-SELFED. "There's not a lot of talking about it, you just do the movement." Until it is
 *  already a habit they do not discuss it, name it, or explain it — it shows in the body: where they
 *  stand, what their hands find, what their eyes go back to, what they linger over. The previous
 *  bottom rungs were both about CONVERSATION — a joke that is nearly the subject, a question that
 *  would make sense if the answer were yes — which is the last thing to arrive, not the first.
 *
 *  THE INTERRUPTION IS THE MECHANISM. Twice they get close and something takes them away. That is
 *  what keeps it from being a decision and what makes the eventual doing feel inevitable instead of
 *  chosen. It has to be written in, not skipped past.
 *
 *  And the meaning comes LAST. They do not know why they like it until long after they always get it. */
const NERVE = [
  "EXPOSURE. It does not happen and is not mentioned — but ONE CONCRETE THING IS ON THE PAGE about it: the scene puts the occasion in front of them and they visibly decline it. They reach for something else instead. They put a hand near and take it back. They step around it. Somebody else could describe what she did, even if nobody could say why. NOT ACTING IS NOT THE SAME AS NOTHING HAPPENING: if a reader could not point at a sentence, this rung has not been written.",
  "NEAR IT, BY CIRCUMSTANCE, and again ONE VISIBLE BEAT. Something unrelated keeps her beside it longer than she needed — a wait, a queue, somebody else's errand. She looks properly, and the looking is on the page: her attention goes there twice, she stays a moment past when she could have gone, she stands closer than the task requires. Then the moment ends and she does nothing. Body only. Not one word about it.",
  "EXAMINING IT — narrowed from the general thing to the specific one, and STILL A VISIBLE ACT: she handles it, weighs it, tests it, positions herself for it, gets close enough that anyone watching would notice and could not prove anything. Then something takes her away before it happens and she lets it go. THE INTERRUPTION IS THE POINT — it is what stops this being a decision — but the approach before the interruption must actually occur on the page.",
  "THE SIDEWAYS FIRST TIME. It happens, and it arrives through someone else or through a pretext — a third party's opinion, going along with what is already happening, since-we-are-here. Low stakes, deniable, never framed as wanting it. This is the first rung on which the thing itself occurs.",
  "AGAIN, BECAUSE IT IS EASY NOW. No pretext and no reason given. She may skip once and notice the absence — the first moment the wanting becomes conscious to her, and the first moment she might say anything about it at all.",
  "SIMPLY WHAT SHE DOES. No occasion, no excuse; part of the shape of the day with this person. Only now is there anything to SAY about it — the meaning arrives after the habit, never before.",
];

/** HOW MUCH OF THIS IS SHOWING, 0.1 to 1.
 *
 *  With `inhabit_turns` set, escalation is a deterministic function of turns since the want was
 *  written: 10% immediately, linear to full at the deadline, so it visibly moves EVERY turn. The
 *  rungs do not move linearly with it — see rampStage. Without a budget, the in-world-hour rungs are
 *  used and this reports where they sit.
 *
 *  The point of the turn budget is not that turns are the truer unit — they are not — but that a
 *  want you cannot see moving is indistinguishable from a want that is broken, and this engine has
 *  produced enough of the second that the first is not worth defending. */
export function intensity(a: AuthoredDrive, _turn?: number): number {
  if (a.inhabit_turns && a.inhabit_turns > 0) return 0.1 + 0.9 * earnedFraction(a);
  return Math.max(0.1, Math.min(1, ((a.stage ?? 0) + 1) / (MAX_STAGE + 1)));
}

/** How far through the budget — measured in turns that ACTUALLY SHOWED IT, never in elapsed time.
 *  "If it doesn't show any kind of indirect or direct acknowledgement of the doing, it shouldn't
 *  increase in percent." */
function earnedFraction(a: AuthoredDrive): number {
  if (!a.inhabit_turns || a.inhabit_turns <= 0) return 0;
  return Math.max(0, Math.min(1, (a.seen ?? 0) / a.inhabit_turns));
}

/** WHERE ON THE RAMP, and the shape of the ramp is the whole feature.
 *
 *  The first version put the percentage on a logarithmic curve, because "escalating logarithmically"
 *  was what was asked for. That was a misreading, and it produced precisely the failure it was meant
 *  to fix: a log curve is steepest at the start, so two turns into a ten-turn budget the want was
 *  already at 55% and the ladder said GO AT IT. Dana brought it up out of nowhere, which is what
 *  prompted all of this.
 *
 *  Habituation is the other shape. Nearly HALF the window is spent not doing it at all — noticing
 *  the openings, changing the subject away from it. Then circling. The attempt belongs in the last
 *  quarter, by which point several scenes have quietly been about it and nobody is surprised. The
 *  displayed percentage stays linear so it visibly moves every single turn, which is what makes the
 *  thing checkable; it is the STAGE that waits. */
function rampStage(a: AuthoredDrive): number {
  const p = earnedFraction(a);
  // 10–50% of the window is the build-up "through external means that are noticeable" — three rungs
  // in which the thing never once happens. The first time it happens is past halfway, sideways.
  if (p >= 1) return 5;      // simply what they do
  if (p >= 0.70) return 4;   // again, because it is easy
  if (p >= 0.50) return 3;   // the sideways first time
  if (p >= 0.35) return 2;   // examining it
  if (p >= 0.20) return 1;   // near it, by circumstance
  return 0;                  // exposure
}

/** True when this person has a live authored want that should be acting on the world. */
export function liveAuthored(c: Identity | undefined): AuthoredDrive[] {
  return (c?.authored ?? []).filter((a) => a?.goal && !a.crystallized_turn && !a.paused);
}
export function hasAuthored(c: Identity | undefined): boolean {
  return liveAuthored(c).length > 0;
}

/** The want as one line, in the same grammar as every other want on the card.
 *
 *  Provenance is deliberately absent. The narrator must not be told a human typed this — told that,
 *  a model plays it as an instruction to satisfy rather than as something a person wants, and the
 *  result is a character who announces it and gets it over with. The Inspector shows the player
 *  their own hand; the prompt shows a want. */
export function authoredLine(a: AuthoredDrive): string {
  // Computed whenever there is a budget — it used to be gated on a `turn` argument that no longer
  // exists now that progress is earned rather than elapsed, so the percentage silently vanished.
  const i = a.inhabit_turns ? intensity(a) : undefined;
  const stage = !a.inhabit_turns
    ? Math.max(0, Math.min(MAX_STAGE, a.stage | 0))
    : rampStage(a);
  const bits = [a.goal];
  if (a.approach) bits.push("goes at it by: " + a.approach);
  if (a.because) bits.push("started because: " + a.because);
  bits.push("where they are with it: " + NERVE[Math.max(0, stage)]);
  // A deadline is stated plainly so the escalation is legible rather than a vibe — and so that a
  // want written by the player is visibly ON A CLOCK rather than optional.
  if (i !== undefined && a.inhabit_turns) {
    bits.push(`${Math.round(i * 100)}% of the way to being simply how they are, and still climbing. THIS IS NOT OPTIONAL AND IT IS NOT BACKGROUND: write the beat for this rung into this scene, at exactly this strength and no more. Under half it has not happened yet and must not — but "has not happened" still requires a visible moment on the page, in the body, that a reader could point at. A turn in which nothing about it can be seen is a turn in which this failed, and it is the ONLY way to get this wrong besides rushing to the act`);
  }
  return bits.join(" — ");
}

/** Every live authored want in the cast, as the world-sim's `wantsOf` wants them: id → lines. */
export function authoredWants(state: SaveState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player") continue;
    if (c.status === "dead" || c.status === "departed") continue;
    const live = liveAuthored(c);
    if (live.length) out.set(id, live.map((a) => authoredLine(a)).join(" ALSO: "));
  }
  return out;
}

/** THE RATCHET, AND IT ONLY TURNS ON EVIDENCE.
 *
 *  Called once per turn with the prose that was just written. A want advances only on turns where it
 *  actually appeared — directly or indirectly. If the narrator ignores it, the percentage does not
 *  move, which is both correct and diagnostic: a stalled number is a visible failure rather than a
 *  silent one, and the want cannot complete itself out of a story it was never in.
 *
 *  The in-world-hours ladder (no budget set) still runs on the clock; that path is for a standing
 *  condition of somebody's life which is true whether or not the page mentions it. */
export function tickAuthored(state: SaveState, minutesElapsed = 0, prose = ""): string[] {
  const log: string[] = [];
  const turn = state.world.current_turn;
  const elapsed = Math.max(0, minutesElapsed);
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player") continue;
    if (c.status === "dead" || c.status === "departed") continue;
    for (const a of c.authored ?? []) {
      if (!a?.goal || a.crystallized_turn || a.paused) continue;

      if (a.inhabit_turns && a.inhabit_turns > 0) {
        // EARNED, NOT ELAPSED.
        if (prose && mentions(a.goal, prose)) {
          a.seen = (a.seen ?? 0) + 1;
          a.last_seen_turn = turn;
          a.stalled = 0;
          const reached = rampStage(a);
          if (reached > (a.stage ?? 0)) {
            a.stage = reached;
            log.push(`${c.name} is further into it than she was: ${a.goal}.`);
          }
        } else {
          a.stalled = (a.stalled ?? 0) + 1;
        }
      } else {
        a.acted = (a.acted ?? 0) + elapsed;
        const step = 60 * (STEP_HOURS[a.rate] ?? STEP_HOURS.steady);
        const reached = Math.min(MAX_STAGE, Math.floor(a.acted / step));
        if (reached > (a.stage ?? 0)) {
          a.stage = reached;
          log.push(`${c.name} is further into it than she was: ${a.goal}.`);
        }
      }

      if ((a.stage ?? 0) >= MAX_STAGE && a.crystallize && !a.crystallized_turn && surfaced(state, a)) {
        const t = crystallize(state, id, a, turn);
        if (t) log.push(`${c.name} does not think of it as a thing she started any more: ${t}.`);
      }
    }
  }
  return log;
}

/** Did this turn's prose acknowledge the want, directly or indirectly? */
function mentions(goal: string, prose: string): boolean {
  const stop = new Set(["their", "them", "with", "that", "this", "into", "about", "anytime", "they", "when", "have", "from", "every", "time", "always", "gets", "getting"]);
  const words = [...new Set((goal.toLowerCase().match(/[a-z]{4,}/g) ?? []))].filter((w) => !stop.has(w));
  if (!words.length) return false;
  const hay = prose.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits >= Math.min(words.length, Math.max(1, Math.ceil(words.length * 0.34)));
}

/** Did this want ever actually reach the page? Matched on the distinctive words of the goal against
 *  the prose since it was written — crude, and the alternative is hardening a trait out of nothing. */
function surfaced(state: SaveState, a: AuthoredDrive): boolean {
  const stop = new Set(["their", "them", "with", "that", "this", "into", "about", "anytime", "they", "when", "have", "from", "every", "time", "always"]);
  const words = [...new Set((a.goal.toLowerCase().match(/[a-z]{4,}/g) ?? []))].filter((w) => !stop.has(w));
  if (!words.length) return true;
  const prose = state.history.filter((h) => h.turn >= a.added_turn).map((h) => h.narrator_prose ?? "").join(" ").toLowerCase();
  const hits = words.filter((w) => prose.includes(w)).length;
  // A short goal ("ask him to do the thing") may yield only one distinctive word, so the bar cannot
  // be a flat two — that would make brief wants incapable of ever crystallising.
  const need = Math.min(words.length, Math.max(1, Math.ceil(words.length * 0.4)));
  return hits >= need;
}

/** THE WANT BECOMES THE PERSON.
 *
 *  The endpoint the player was typing by hand at the start. A want carried at full stretch for long
 *  enough stops being something someone is doing and becomes something they are — which is the one
 *  honest way to write a core trait, because by the time it lands the story contains the evenings
 *  that earned it.
 *
 *  The want is retired in the same motion. Leaving both would double-count the person: a standing
 *  want driving the world-sim AND a trait describing the same behaviour, so every pass sees it twice
 *  and weights it twice. */
export function crystallize(state: SaveState, id: string, a: AuthoredDrive, turn: number): string | null {
  const c = state.characters[id];
  if (!c || !a?.goal || a.crystallized_turn) return null;

  const label = a.goal.trim().replace(/^(start|starts|begin|begins|try to|tries to)\s+/i, "").replace(/\.$/, "");
  const traits = (c.core_traits ??= []);
  if (!traits.some((t) => t.toLowerCase() === label.toLowerCase())) traits.push(label);

  (state.traits[id] ??= []).push({
    id: `authored_${turn}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    origin: a.because
      ? `${a.because} — and what started there became the way they live`
      : `did it once, then kept doing it, and stopped noticing they had decided anything`,
    behavioral_impact: `Acts on this without deliberating. It is not a plan they are executing; it is how their week is shaped.`,
    intensity: 7,
    self_weight: 0.6,
    last_reinforced_turn: turn,
    reinforcement_count: Math.max(1, Math.floor((a.acted ?? 0) / 3)),
  });
  a.crystallized_turn = turn;
  return label;
}

/** Knock a rung off — what the player reaches for when the character has been faced down and it
 *  should cost them something. At the bottom rung it stops rather than going negative: a want that
 *  has been opposed all the way back to nothing is a want to delete, and deleting it is a different
 *  button with different consequences. */
export function setback(a: AuthoredDrive, rate: AuthoredDrive["rate"] = a.rate): void {
  const step = 60 * (STEP_HOURS[rate] ?? STEP_HOURS.steady);
  a.stage = Math.max(0, (a.stage ?? 0) - 1);
  a.acted = a.stage * step;
}

/** A fresh authored want, with the fields the UI does not ask for filled in.
 *
 *  `acted` defaults to the floor of whatever stage was asked for rather than to zero. Starting a
 *  want at stage 2 and leaving the counter at 0 looks harmless and quietly means it must now serve
 *  the full climb again before it reaches 3 — the player would have set it high precisely because
 *  they did not want to wait. */
export function newAuthored(goal: string, turn: number, opts: Partial<AuthoredDrive> = {}): AuthoredDrive {
  const seen = Math.max(0, opts.seen ?? 0);
  const rate = opts.rate ?? "steady";
  const stage = Math.max(0, Math.min(MAX_STAGE, opts.stage ?? 0));
  return {
    goal: goal.trim().slice(0, 200),
    approach: opts.approach?.trim().slice(0, 200) || undefined,
    because: opts.because?.trim().slice(0, 240) || undefined,
    rate,
    stage,
    acted: Math.max(stage * 60 * (STEP_HOURS[rate] ?? STEP_HOURS.steady), opts.acted ?? 0),
    seen: Math.max(seen, opts.inhabit_turns ? Math.round((stage / (MAX_STAGE + 1)) * opts.inhabit_turns) : 0),
    stalled: opts.stalled ?? 0,
    paused: opts.paused,
    inhabit_turns: opts.inhabit_turns && opts.inhabit_turns > 0 ? Math.round(opts.inhabit_turns) : undefined,
    crystallize: opts.crystallize ?? true,
    added_turn: opts.added_turn ?? turn,
  };
}
