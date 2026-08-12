/* Smoke test: WANTING WITHOUT LIKING, and a promise ledger that empties.
 *
 * 1. DESIRE AND WARMTH ARE SEPARATE CHANNELS — a premise this engine states in its own module
 *    header and only ever enforced in one direction. "Kindness never creates desire" was written
 *    down and defended; the reverse was not written down at all, so in practice the engine could
 *    not produce the most ordinary thing there is — wanting someone you cannot stand, or wanting
 *    someone you have no feelings about whatsoever.
 *
 *    Every line the narrator could receive about a real attraction was phrased for desire inside a
 *    bond, in verbs that say so: "flirts, teases, seeks closeness, lets you be". At warmth 0 that
 *    IS fondness. At warmth −55 it was handed over beside "resents or hates you — openly cold and
 *    antagonistic" from the disposition cue, with nothing anywhere saying how the two combine — so
 *    the narrator resolved the contradiction by dropping whichever was less emphatic, which is
 *    always the desire.
 *
 * 2. THE PROMISE LEDGER HAS TO EMPTY AS WELL AS FILL. Recording commitments is mandatory and in
 *    capitals; nothing ever took one off except the bookkeeper choosing to. Open promises are also
 *    exempt from the ledger's own cap, which only trims RESOLVED ones — so small favours the story
 *    moved past three days ago accumulate forever, each holding a slot in the ten shown to the
 *    bookkeeper every turn under an instruction to check every one of them.
 */
import { desireLine } from "../src/engine/desire";
import { addPromise, getEdge, livePromises, resolvePromise, sweepPromises, PROMISE_STALE_TURNS } from "../src/engine/social";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("wanting", {
    name: "x",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Vela", character_id: "char_v", pronouns: "she/her" } as any);
  s.world.present = ["char_v"];
  return s;
}
/** Set the one edge the desire line reads. */
function feel(s: SaveState, warmth: number, attraction: number, relaxation = 2, roles?: string[]) {
  const e = getEdge(s.world.edges, "char_v", "char_player");
  e.warmth = warmth; e.trust = warmth; e.attraction = attraction; e.attraction_base = attraction;
  e.desire_admissibility = +(0.5 + relaxation * 0.05).toFixed(2);
  if (roles) e.roles = roles;
  s.condition.char_v.psyche.relaxation = relaxation;
  return desireLine(s, "char_v");
}

/* ── 1. she wants him and cannot stand him ───────────────────────────────────── */
{
  const s = world();
  const line = feel(s, -45, 60, -4);   // hostile, clenched: the pull is not owned
  check("hostility and desire are both stated", /cannot stand you/i.test(line) && /60/.test(line), line);
  check("neither is allowed to cancel the other", /Do not let either one cancel the other/i.test(line), line);
  check("it is not written as flirtation", !/flirts|teases/.test(line), line);
  check("and not as secret tenderness on the way to a bond", /this does not develop into a bond/i.test(line), line);
  check("the behaviour named is contact-as-friction", /stand nearer than the argument needs|needling as a way of making contact/.test(line), line);
}
{
  const s = world();
  const line = feel(s, -45, 60, 4);    // hostile, open: she knows exactly what she is doing
  check("an open body owns it instead of leaking it", /KNOW it about themselves/i.test(line), line);
  check("still no softening", /NEVER write this as warmth breaking through/i.test(line), line);
  check("and wanting him does not make her nicer", /do not make them nicer because they want you/i.test(line), line);
}

/* ── 2. appetite with nothing behind it ──────────────────────────────────────── */
{
  const s = world();
  const line = feel(s, 0, 65, 3);
  check("desire at zero warmth is not rendered as fondness", !/flirts, teases, seeks closeness/.test(line), line);
  check("it is named as a complete state, not an unfinished bond", /Treat that as finished rather than as a bond that has not formed yet/i.test(line), line);
  check("interest in the body, not in the day", /none in your day/i.test(line), line);
  check("and it is not the beginning of caring", /NEVER render this as fondness, tenderness, or the beginning of caring/i.test(line), line);
}

/* ── 3. the ordinary case is untouched ───────────────────────────────────────── */
{
  const s = world();
  const warm = feel(s, 60, 60, 3);
  check("desire inside a bond still reads as a bond", /flirts, teases, seeks closeness/.test(warm), warm);
  const s2 = world();
  const partner = feel(s2, 10, 55, 3, ["girlfriend"]);
  check("a stated partner at low warmth is not treated as a stranger's appetite", !/no attachment behind it/.test(partner), partner);
  const s3 = world();
  check("a flat read is still a flat read", /desire toward you: none/.test(feel(s3, 5, 4, 2)));
  const s4 = world();
  check("aversion is still aversion", /actively repelled/.test(feel(s4, -40, -30, 0)));
}

/* ── 4. the ledger empties ───────────────────────────────────────────────────── */
{
  const s = world();
  s.world.current_turn = 1;
  const favour = addPromise(s, "char_player", "char_v", "grab her a drink from the bar", 1)!;
  const vow = addPromise(s, "char_player", "char_v", "protect your son whatever it costs", 3)!;
  s.world.current_turn = 1 + PROMISE_STALE_TURNS;
  const log = sweepPromises(s, s.world.current_turn);
  check("an untended small favour stops being owed", favour.status === "retired", favour.status);
  check("and it says so once", log.some((l) => /stopped being owed/.test(l)), log);
  check("retiring costs the relationship nothing",
    getEdge(s.world.edges, "char_v", "char_player").warmth === 0 && getEdge(s.world.edges, "char_v", "char_player").trust === 0);
  check("a vow does not lapse because time passed", vow.status === "open", vow.status);
}
{
  // a deadline that passed undone is BROKEN — that is what the word means
  const s = world();
  s.world.current_time = "Day 5, 20:00";
  const p = addPromise(s, "char_player", "char_v", "have the money by Thursday", 2, "Day 3, 12:00")!;
  const log = sweepPromises(s, s.world.current_turn);
  check("a passed deadline breaks the promise", p.status === "broken", p.status);
  check("and it lands on the relationship", getEdge(s.world.edges, "char_v", "char_player").trust < 0);
  check("with a line the player sees", log.some((l) => l.length > 0), log);
}
{
  // an unparseable due_time must never break anything — "unresolved" is a legal value here
  const s = world();
  s.world.current_time = "Day 40, 20:00";
  const p = addPromise(s, "char_player", "char_v", "tell her when you know", 2, "unresolved")!;
  sweepPromises(s, 40);
  check("a due time we cannot read never breaks a promise", p.status === "open", p.status);
}
{
  // the backstop: favours generated faster than the staleness window still cannot pile up
  const s = world();
  for (let i = 0; i < 30; i++) addPromise(s, "char_player", "char_v", `small errand number ${i}`, 1);
  sweepPromises(s, 2);
  const open = (s.world.promises ?? []).filter((p) => p.status === "open");
  check("open promises are bounded", open.length <= 20, open.length);
}
{
  // what reaches the prompt is the load-bearing end of the ledger, not insertion order
  const s = world();
  s.world.current_turn = 1;
  for (let i = 0; i < 6; i++) addPromise(s, "char_player", "char_v", `errand ${i}`, 1);
  s.world.current_turn = 7;
  addPromise(s, "char_player", "char_v", "protect your son", 3);
  const top = livePromises(s).slice(0, 3);
  check("the vow is shown first, not buried under errands", top[0].text === "protect your son", top.map((p) => p.text));
  check("a resolved promise never occupies a slot",
    (() => { const p = livePromises(s)[1]; resolvePromise(s, p, "kept", 8); return !livePromises(s).some((x) => x.id === p.id); })());
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
