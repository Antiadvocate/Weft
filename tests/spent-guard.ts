/* Smoke test: WHAT REACHES A BROKEN PERSON, AND WHAT THEY DO WITH IT.
 *
 * From a save at turn 30. Abigail is written as charming and manipulative — every dark triad trait,
 * conscience 0.18 — and the player's report was that she came out "the dumbest mean person in
 * history", who did not change when she was terrified. What the narrator was actually told about
 * her, on every turn from about turn 8 to the end of the story, was one line:
 *
 *     BROKEN (fractured) — the Mirror rule applies: no judgments, only clear reflection of others
 *
 * Three failures in it. The Mirror rule is written down in no prompt anywhere, so the model has to
 * invent what the name means. PHILOSOPHY.md gives four break modes "with its own rendering rules",
 * social.ts can only ever assign "fractured", and this rendered the mirror's rule for all of them —
 * the line contradicts itself in its own parentheses. And "clear reflection of others" describes
 * what she does TO somebody, so the narrator wrote her repeating the last thing said to her, flat,
 * five turns running: "Shitty person." / "Good luck with Dad," / "Dad's picking me up."
 *
 * It also returned EARLY, before the conscience branch, so her 0.18 reached the narrator on none of
 * those twenty turns. The engine holds a line written for exactly her — "clenched and vindictive —
 * slights become personal projects" — and never once reached it.
 *
 * The owner's account of what this state is: braced long enough, a person runs out of the runway to
 * keep arguing, and shuts down — and in shutting down actually hears what is being said to them.
 * What happens next is not part of it. Dismal, defensive, aggressive, or genuinely taking it in,
 * from who they are and what was said. So the reading splits: what gets IN is one axis, what they
 * DO with it is another, and both render.
 *
 * The other half is that the door was in a place her body could not reach. See section 3. */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest } from "../src/engine/prompts";
import { tickPsyche, settleAfterDeltas } from "../src/engine/social";
import type { SaveState, Psyche } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(conscience: number): { s: SaveState; id: string } {
  const s = newSave("spent", { name: "Elm Street", era: "contemporary" } as any);
  s.world.places["loc_hall"] = { id: "loc_hall", name: "The hallway", description_facts: "Bad fluorescent tube.", contains: [] } as any;
  s.world.player_location = "loc_hall";
  registerCharacter(s, { name: "Max", character_id: "char_player", pronouns: "he/him", age: 39,
    appearance_facts: "Curly hair, glasses.", core_traits: ["quiet"], values: ["privacy"] } as any);
  const id = registerCharacter(s, { name: "Abigail", pronouns: "she/her", age: 18,
    appearance_facts: "Dark hair, barefoot.", core_traits: ["Weaponizes charm and befuddlement"],
    values: ["leverage"], conscience } as any);
  s.characters[id].location = "loc_hall";
  s.characters["char_player"].location = "loc_hall";
  s.world.present = [id];
  s.world.current_turn = 29;
  return { s, id };
}

/** Put somebody where the save had her: broken, at the floor, braced for nineteen turns.
 *  A psyche built by hand needs `recovery` — drift multiplies by it, and leaving it off makes
 *  every step NaN and every one of these tests pass for the wrong reason. */
function breakThem(p: Psyche, opts: { capacity?: number; grief?: number } = {}): void {
  p.capacity = opts.capacity ?? -0.5;
  p.recovery = 0.18;
  if (opts.grief === 0) delete p.grief_drag; else p.grief_drag = opts.grief ?? 5.302;
  p.relaxation = -9.935;
  p.consecutive_clenched = 19;
  p.state = "broken";
  p.break_mode = "fractured";
  p.open_run = 0;
  p.mood_valence = -8;
}

/** A blank psyche to break, with every field drift reads actually present. */
const psyche = (): Psyche => ({ relaxation: 0, capacity: 2, recovery: 0.18, state: "intact",
  break_mode: null, consecutive_clenched: 0, mood: "even", mood_valence: 0, active_states: [] });

/* ── 1. a broken person still has a disposition ──────────────────────────────── */
{
  const { s, id } = world(0.18);
  breakThem(s.condition[id].psyche);
  const line = volatileDigest(s, "she refuses to get in the car").split("\n").find((l) => l.includes("seeing:")) ?? "";
  check("the exhaustion is reported as what reaches them", /arrives instead of being deflected/.test(line), line);
  check("...counting the turns they have actually been braced", /braced 19 turns straight/.test(line), line);
  check("...and says out loud that it is not a behaviour", /not what they do about it/.test(line), line);
  check("A LOW CONSCIENCE STILL REACHES THE NARRATOR WHILE BROKEN",
    /slights become personal projects/.test(line), line);
  check("no rule is invoked by a name the prompt never defines", !/Mirror rule/.test(line), line);
  check("and the break_mode label, which named the wrong one, is gone", !/BROKEN \(/.test(line), line);
}

/* ── 2. the two axes are independent ─────────────────────────────────────────── */
{
  // Same collapse, ordinary conscience: the exhaustion reads the same, the disposition does not.
  const { s, id } = world(0.8);
  breakThem(s.condition[id].psyche);
  const line = volatileDigest(s, "she refuses to get in the car").split("\n").find((l) => l.includes("seeing:")) ?? "";
  check("a kind person breaks the same way", /arrives instead of being deflected/.test(line), line);
  check("...but is not handed the predator's reading", !/slights become personal projects/.test(line), line);
  check("...they get their own", /misreads as threat/.test(line), line);
}

/* ── 3. THE DOOR HAS TO BE SOMEWHERE THE BODY CAN REACH ──────────────────────── */
/* settleAfterDeltas bounds relaxation to eff + above, where eff is capacity plus discharge_lift
 * minus grief_drag. Her capacity had been remodelled to -0.5 and her grief_drag stood at 5.302, so
 * eff was -5.802 and her best reachable turn was -2.802 — while the exit from "broken" was a fixed
 * relaxation > -2. She could not open that door on her best possible turn. It only became reachable
 * after grief_drag had almost entirely decayed, which takes about twenty-eight turns with no blow
 * landing at all; she was in a hallway with the person doing the hitting, and the story was thirty
 * turns long. So the exits read against where this body rests, and the fixed number stays as the
 * other option — whichever is easier to reach. */
{
  const p = psyche();
  breakThem(p);
  const MAX_ABOVE = 3;
  const eff = p.capacity - (p.grief_drag ?? 0);
  check("her ceiling really is below the old fixed exit", eff + MAX_ABOVE <= -2, { ceiling: eff + MAX_ABOVE });

  let released = 0;
  for (let t = 1; t <= 40 && !released; t++) { tickPsyche(p); if (p.state === "intact") released = t; }
  check("once the pressure stops she comes back", released > 0, p);
  check("...and it takes turns, not a scene", released >= 4, released);
  check("...but not longer than the story she is in", released <= 15, released);
}

/* ── 4. and it is not a free pass out ────────────────────────────────────────── */
{
  // Still in the room with him, taking a knock every turn. Nobody recovers through that.
  const p = psyche();
  breakThem(p);
  let released = 0;
  for (let t = 1; t <= 80 && !released; t++) {
    tickPsyche(p);
    p.relaxation = Math.max(-10, p.relaxation - 1);
    p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + 0.15);
    settleAfterDeltas(p);
    if (p.state === "intact") released = t;
  }
  check("a person still being hit does not heal on a timer", released === 0, { released, relaxation: p.relaxation });
}

/* ── 5. the ordinary case is untouched ───────────────────────────────────────── */
{
  // Somebody resting where they were made, with nothing dragging: the fixed number still governs,
  // because eff - 2 sits above it and the easier of the two is the fixed one.
  const p = psyche();
  breakThem(p, { capacity: 2, grief: 0 });
  let released = 0, at = 0;
  for (let t = 1; t <= 40 && !released; t++) { tickPsyche(p); if (p.state === "intact") { released = t; at = p.relaxation; } }
  check("an ordinary resting point still leaves at the old threshold", released > 0 && at > -2, { released, at });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
