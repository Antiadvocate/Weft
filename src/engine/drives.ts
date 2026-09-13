/** Drive regeneration — NPC autonomy without an author.
 *
 *  A tracked character who has finished their drive (or never had one) is never
 *  left idle: seedDrive() reads their whole self — identity, traits, values, their
 *  edges (warmth/trust toward the player and toward others), the live threads, and
 *  the world's pressure palette — and hands them a concrete new want. It's
 *  deterministic and free, so nobody is ever stranded; the Simulator's
 *  `drives_update` then enriches it into something in-voice on the next tick.
 *
 *  Tracking is opt-in: the player follows a character in the Cast view, or the
 *  Simulator promotes one (diff.track) when a thread makes them matter. Untracked
 *  bit-players recede — no drive, no upkeep — until something elevates them. */
import type { Identity, SaveState } from "./types";
import { epistemicGoal } from "./mind";

const pick = <T,>(xs: T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)];

/** Build a fresh drive for a character from their relational + narrative context.
 *  `dispersion` (0..1) and `avoid` (a char_id the cast is over-focused on) bias the pick
 *  toward self-interested, magnet-avoiding goals so the cast spreads instead of swarming. */
export function seedDrive(state: SaveState, id: string, rng: () => number = Math.random, dispersion = 0, avoid: string | null = null): { goal: string; progress: number; priority: number; updated_turn: number } | null {
  const c = state.characters[id];
  if (!c) return null;
  const turn = state.world.current_turn;
  const nm = (x: string) => state.characters[x]?.name ?? x;

  // strongest feelings this character holds toward others (their outgoing edges)
  const out = state.world.edges.filter((e) => e.from === id && e.to !== id);
  const hottest = [...out].sort((a, b) => Math.abs(b.warmth) - Math.abs(a.warmth))[0];
  const coldest = [...out].sort((a, b) => a.warmth - b.warmth)[0];
  const distrusted = [...out].sort((a, b) => a.trust - b.trust)[0];

  const traits = (c.core_traits ?? []).map((t) => t.toLowerCase()).join(" ");
  const values = (c.values ?? []).map((t) => t.toLowerCase()).join(" ");
  const blob = `${traits} ${values} ${c.background ?? ""}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => blob.includes(w));

  const candidates: string[] = [];

  // 1) relational pulls — the engine of most autonomous behavior
  if (coldest && coldest.warmth <= -20) {
    if (has("protect", "guard", "loyal", "justice", "shield"))
      candidates.push(`keep ${nm(coldest.to)} from doing more harm`);
    if (has("venge", "ruthless", "cruel", "dark", "exploit", "calculating", "possessive"))
      candidates.push(`undermine ${nm(coldest.to)} before they become a problem`);
    candidates.push(`find out what ${nm(coldest.to)} is really doing`);
  }
  if (distrusted && distrusted.trust <= -20)
    candidates.push(`watch ${nm(distrusted.to)} from a careful distance`);
  if (hottest && hottest.warmth >= 25) {
    if (has("possessive", "control", "anchor", "obsess"))
      candidates.push(`make sure ${nm(hottest.to)} needs no one but them`);
    else candidates.push(`look out for ${nm(hottest.to)} without being asked`);
  }

  /* ── WANTING SOMEBODY, WHICH THIS FUNCTION COULD NOT SEE ─────────────────────────────────────
   *
   * The three sorts above read warmth, warmth and trust. The word `attraction` did not appear in
   * this file. So the relational section had a branch for hostility, a branch for distrust and a
   * branch for fondness, and none for wanting someone — and a character at attraction 100 with
   * warmth 5 cleared no threshold at all and fell through to trait filler. From a real save: a
   * woman at maximum desire toward the player whose actual goal for the evening was set by
   * `has("survi","street") -> "line up the next score and stay unseen"`.
   *
   * The one goal the warm branch can produce is "look out for X without being asked", which is
   * care. Nothing anywhere in this engine meant GO AND GET THEM. The player's report: "Most people
   * super attracted to someone will go after them. They'll flirt, they will do things. They will
   * not immediately just vanish."
   *
   * A pursuit want is an ACTION with a target, which is what keeps it clear of the rule against
   * player-orbiting goals: "watch the player" is passive and is still forbidden everywhere; getting
   * someone alone, or getting an answer out of them, is a thing a person does. And it needs no
   * special decay — a want that never progresses is abandoned by the stalled-want sweep in
   * social.ts, which is exactly what being turned down should look like.
   *
   * The register follows the same split desire.ts already draws: how much liking is under the pull,
   * and whether the body it arises in can own it. */
  const wanted = [...out].filter((e) => (e.attraction ?? 0) >= 30)
    .sort((a, b) => (b.attraction ?? 0) - (a.attraction ?? 0))[0];
  if (wanted) {
    const who = nm(wanted.to);
    const adm = wanted.desire_admissibility ?? 0.5;
    if (wanted.warmth < 0) {
      // wanting somebody you are currently angry with: contact as friction
      candidates.push(`get back in front of ${who} and make them deal with it`);
      candidates.push(`get ${who} to admit there is something between them`);
    } else if (wanted.warmth < 15) {
      // appetite with no attachment: direct, uncourtly, and still pursuit
      candidates.push(`get ${who} alone somewhere`);
      candidates.push(`find out how far ${who} will actually go`);
    } else if (adm <= 0.35) {
      // it cannot be said out loud, so it comes out as claim
      candidates.push(`keep ${who} within reach and keep others away from them`);
      candidates.push(`find a reason to be wherever ${who} is`);
    } else {
      candidates.push(`get ${who} to themselves for an evening`);
      candidates.push(`find out whether ${who} wants this back`);
    }
  }

  // 2) live threads they could insert themselves into
  for (const th of state.world.threads.filter((t) => t.status === "active")) {
    if (th.tension >= 4) candidates.push(`get to the bottom of ${String(th.title ?? "").toLowerCase()}`);
  }

  // 3) clocks still running — ambient stakes to push or resist
  for (const k of state.world.clocks.filter((k) => k.status === "running")) {
    if (has("protect", "justice", "guard", "detective", "law"))
      candidates.push(`disrupt ${k.faction}'s plans before they finish`);
  }

  // 4) trait/value-driven standing wants (always available, lowest priority)
  if (has("ambition", "power", "climb", "control")) candidates.push("expand their hold over the territory");
  if (has("justice", "detective", "law", "protect")) candidates.push("chase the case the others are ignoring");
  if (has("survi", "street", "thief", "cat")) candidates.push("line up the next score and stay unseen");
  if (has("heal", "doctor", "care", "mend")) candidates.push("tend to someone the city has written off");
  if (has("chaos", "wild", "unpredict")) candidates.push("stir something up just to see what breaks");
  // NOT `pursue what matters most to ${c.name}` — a goal that names its own owner in the third
  // person is the exact shape the bookkeeper then copies onto real wants, and this fallback was
  // putting it on the card for it to read. A want is what they do.
  candidates.push("pursue what matters most to them right now");

  // SELF-INTEREST set — the antidote to the chorus. These pull a character toward their OWN
  // life instead of the group's shared object. Tagged so dispersion can prefer them.
  const selfStart = candidates.length;
  candidates.push(
    `tend to something of their own that's been neglected`,
    `get what they personally came here for and not much else`,
    `protect their own comfort and patience tonight`,
    `quietly pursue a private want they haven't told anyone`,
  );
  if (has("ambition", "climb", "career", "work")) candidates.push("steal time for their own ambition while everyone's distracted");
  if (has("tired", "weary", "cynic", "jaded")) candidates.push("conserve energy and stop carrying everyone else");

  if (!candidates.length) return null;

  // SELECTION. Normally weight toward the front (relational/thread goals), stochastic.
  // Under high dispersion, bias HARD toward the self-interest tail and re-roll a few times
  // to avoid handing them a goal aimed at the over-focused magnet (the chorus magnet).
  const goalAt = (i: number) => candidates[Math.min(candidates.length - 1, i)];
  const avoidName = avoid ? (state.characters[avoid]?.name ?? "") : "";
  const aimsAtMagnet = (g: string) => !!avoidName && g.toLowerCase().includes(avoidName.toLowerCase());
  let goal: string;
  if (dispersion >= 0.55 && candidates.length > selfStart) {
    // pick from the self-interest tail most of the time
    goal = rng() < 0.78
      ? candidates[selfStart + Math.floor(rng() * (candidates.length - selfStart))]
      : goalAt(Math.floor((rng() ** 1.7) * candidates.length));
  } else {
    goal = goalAt(Math.floor((rng() ** 1.7) * candidates.length));
    // even at moderate dispersion, don't pile onto the magnet — re-roll up to twice
    for (let tries = 0; tries < 2 && aimsAtMagnet(goal) && dispersion >= 0.4; tries++) {
      goal = candidates[selfStart + Math.floor(rng() * (candidates.length - selfStart))];
    }
  }
  return { goal, progress: 0, priority: 1, updated_turn: turn };
}

/**
 * THE CHORUS MAGNET, MEASURED FROM STATE.
 *
 * seedDrive already carries a full antidote to the cast piling every want onto one person: a
 * self-interest tail, a magnet to avoid, re-rolls. All of it is gated on `dispersion`, and the
 * only thing that ever supplied dispersion was the undertow — which was retired and replaced by
 * `neutralUndertow()`, hardcoding `dispersion: 0, shared_target: null`. So the antidote has been
 * unreachable ever since, and nothing has been counting how far the cast has collapsed onto the
 * protagonist. In one 154-turn save every single tracked character's active goal named the player.
 *
 * This computes it directly: what fraction of tracked characters' live goals name the same person.
 * Deterministic, no tokens, and it re-arms machinery that was already written and already right.
 */
export function magnetPull(state: SaveState): { dispersion: number; sharedTarget: string | null } {
  const names = new Map<string, string>();   // first name → char_id
  for (const [id, c] of Object.entries(state.characters)) {
    const first = c.name?.split(/\s+/)[0]?.toLowerCase();
    if (first && first.length >= 3) names.set(first, id);
  }
  const tracked = Object.entries(state.characters).filter(
    ([id, c]) => id !== "char_player" && c.tracked && c.status !== "dead" && c.status !== "departed" && c.drive?.goal,
  );
  if (tracked.length < 2) return { dispersion: 0, sharedTarget: null };

  const tally = new Map<string, number>();
  for (const [id, c] of tracked) {
    const goal = `${c.drive!.goal} ${(c.drive_queue ?? []).map((d) => d?.goal).join(" ")}`.toLowerCase();
    const hit = new Set<string>();
    for (const [first, tid] of names) if (tid !== id && goal.includes(first)) hit.add(tid);
    if (/\bthe player\b/.test(goal)) hit.add("char_player");
    for (const tid of hit) tally.set(tid, (tally.get(tid) ?? 0) + 1);
  }
  let sharedTarget: string | null = null, best = 0;
  for (const [tid, n] of tally) if (n > best) { best = n; sharedTarget = tid; }
  // A quarter of the cast sharing an interest in one person is an ensemble with something in
  // common. Half is a chorus forming — and half was exactly the state of the save this was written
  // against: three of six tracked characters, which happened to be every character who actually
  // dealt with the player, all of them blocked on finding him. So the pivot sits at a quarter and
  // half reads as 0.40, the point where seedDrive starts steering new wants off the magnet.
  const frac = best / tracked.length;
  return { dispersion: Math.max(0, Math.min(1, (frac - 0.25) * 1.6)), sharedTarget: best >= 2 ? sharedTarget : null };
}

/** Ensure every TRACKED, offscreen, idle character has a want. Returns world-motion lines.
 *  `epistemicPulls` (from the theory-of-mind layer) lets a character whose model of someone
 *  is uncertain-but-high-stakes seed a "find out" want instead of a generic one — active
 *  inference's epistemic drive, executed by the same machinery. */
export function regenerateDrives(state: SaveState, rng: () => number = Math.random, epistemicPulls: { id: string; target: string }[] = [], opts: { dispersion?: number; sharedTarget?: string | null } = {}): string[] {
  const log: string[] = [];
  const pullFor = new Map(epistemicPulls.map((p) => [p.id, p.target]));
  const dispersion = opts.dispersion ?? 0;
  const magnet = opts.sharedTarget ?? null;
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || !c.tracked) continue;
    if (c.status === "dead" || c.status === "departed") continue;   // the gone don't get new wants
    const present = state.world.present.includes(id);

    const active = c.drive;
    const queue = (c.drive_queue ??= []);

    // PROMOTION — a person doesn't stay glued to one stalled aim. If the active drive
    // is complete, hard-blocked, or has sat without progress, and a higher- or equal-priority
    // backup exists, switch to it and shelve the current one. This runs for PRESENT characters too:
    // a character whose in-scene goal has stalled surfaces a backup want, which the narrator then
    // sees and can act on (raise it, redirect to it, leave to pursue it) — so people in the room
    // don't stay stuck on a dead aim, they move on to the next thing they want.
    if (active && queue.length) {
      // A BLOCKER IS A REASON, NOT A VERDICT. This counted any blocker as an instant stall, so a
      // blocked drive was shelved every single turn — and because the backup was usually blocked
      // too ("must find Rabi first", on both), the pair ping-ponged forever: swap, swap back, swap
      // again, a hundred turns of a character trading one goal she can't act on for another. It
      // progressed nothing and it filled the offscreen feed with seventy lines of "X sets aside A
      // and turns to B", which is what the player got instead of a world moving.
      const idle = state.world.current_turn - active.updated_turn;
      const stalled = active.progress >= 100 || idle >= (active.blocker ? 3 : 4);
      if (stalled) {
        // pick the best backup by priority then freshness
        queue.sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || (b.updated_turn - a.updated_turn));
        // Never trade a blocked goal for another blocked goal — that swap is the ping-pong itself.
        // Someone with nothing unblocked to turn to stays on what they wanted; being stuck is a
        // real state, and the offstage pass is where it gets to bite.
        const idx = active.progress >= 100 ? 0 : queue.findIndex((q) => !q.blocker);
        if (idx < 0) { active.updated_turn = state.world.current_turn; continue; }
        const next = queue.splice(idx, 1)[0];
        if (active.progress < 100) { // keep the unfinished one as a backup, lowered
          active.priority = Math.max(0, (active.priority ?? 1) - 1);
          queue.push(active);
        }
        c.drive = { ...next, updated_turn: state.world.current_turn };
        log.push(`${c.name} sets aside "${active.goal}" and turns to: ${next.goal}.`);
        continue;
      }
    }

    // SEEDING a brand-new want is offscreen-only — for a present character with no goal, the
    // narrator and simulator give them one from what's happening in the scene, not this background tick.
    if (present) continue;

    if (active && active.progress < 100) continue;          // still actively wanting something
    // nothing active (or it just completed and queue empty) — seed a fresh want.
    // a live epistemic pull (uncertain about someone who matters) takes the wheel.
    const pull = pullFor.get(id);
    const seeded = pull
      ? { goal: epistemicGoal(state, pull), progress: 0, priority: 2, updated_turn: state.world.current_turn }
      : seedDrive(state, id, rng, dispersion, magnet);
    if (!seeded) continue;
    c.drive = seeded;
    log.push(pull ? `${c.name} can't get a read on ${pull === "char_player" ? "the player" : state.characters[pull]?.name ?? "someone"} — and goes looking.` : `${c.name} turns to something new: ${seeded.goal}.`);
    // occasionally give them a second, lower-priority aim so they have somewhere to go next
    if (queue.length < 2 && rng() < 0.5) {
      const backup = seedDrive(state, id, rng);
      if (backup && backup.goal !== seeded.goal) queue.push({ ...backup, priority: 0 });
    }
  }
  return log;
}
