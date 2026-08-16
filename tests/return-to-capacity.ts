/* Smoke test: IT NEVER GOT TO RETURN TO CAPACITY, AND BEING SWORN AT WAS SCORED AS CANDOUR.
 *
 * Rome, 41 AD, turn 35. Claudia's capacity is 2. Her stored relaxation is 5.25 and her `open_run`
 * reads THIRTY-FIVE — she had been at or above her own resting openness for the entire game, and
 * the narrator was told on every one of those turns that her sight was clear. tickPsyche is not
 * wrong: it drifts toward capacity and collapses overshoot fast. It runs at the TOP of the turn,
 * and the simulator's relaxation_delta lands at the BOTTOM, so the value that gets STORED is always
 * the post-delta one. 4.5 → drift 3.25 → delta +2 → 5.25, stored, every turn, forever.
 *
 * The delta itself came from this, two turns after the player called her a piece of shit and told
 * her Rome should burn, and one turn after "Hey Claudia. Fuck you":
 *
 *   relaxation_delta +2   → "Claudia Antonia relaxed a little."
 *   edge note: "The insult cut her trust but also confirmed his bluntness, making it easier to ask
 *               for help plainly."   warmth 1, trust 2, attraction 55.
 *
 * A model asked what changed will find something positive in nearly anything. So there was no state
 * in which she was angry, and the narrator rendered exactly the state it was given: a woman
 * answering a screamed insult with a poised lecture.
 */
import { tickPsyche, settleAfterDeltas, hostileToward } from "../src/engine/social";
import type { Psyche } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const psyche = (over: Partial<Psyche> = {}): Psyche => ({
  relaxation: 2, capacity: 2, recovery: 0.18, state: "intact", break_mode: null,
  consecutive_clenched: 0, mood: "even", mood_valence: 2, active_states: [], open_run: 0, ...over,
} as Psyche);

/* ── 1. the ratchet, run the way a turn actually runs ────────────────────────── */
{
  // drift at the top of the turn, scene, delta at the bottom — thirty-five times
  const p = psyche({ relaxation: 2 });
  const run = (delta: number, turns: number) => {
    for (let i = 0; i < turns; i++) {
      p.prev_relaxation = p.relaxation;
      tickPsyche(p);                                   // top of turn
      p.relaxation = Math.max(-10, Math.min(10, p.relaxation + delta));  // the bookkeeper's delta
      settleAfterDeltas(p);                            // bottom of turn
    }
  };
  run(2, 35);
  check("a body pushed up every turn for 35 turns does not float away",
    p.relaxation <= p.capacity + 3, `relaxation ${p.relaxation} against capacity ${p.capacity}`);
  check("...and the leash tightens the longer they sit out there",
    p.relaxation <= p.capacity + 1.2, `${p.relaxation}`);

  // and the same downward, which is how a companion AI reached −10 and stayed
  const q = psyche({ relaxation: 2 });
  for (let i = 0; i < 11; i++) { tickPsyche(q); q.relaxation = Math.max(-10, q.relaxation - 3); settleAfterDeltas(q); }
  check("nor does it sink out of reach", q.relaxation >= q.capacity - (q.grief_drag ?? 0) - 4.01, `${q.relaxation}`);

  // a real event still moves someone hard within the turn — the bound is not a flattening
  const r = psyche({ relaxation: 2 });
  r.relaxation += 4; settleAfterDeltas(r);
  check("one big turn still moves a body a long way", r.relaxation >= 4.9, r.relaxation);
  // grief lowers the resting point itself, so a wrecked person is allowed to sit low
  const g = psyche({ relaxation: 2, grief_drag: 5 });
  g.relaxation -= 8; settleAfterDeltas(g);
  check("grief lowers the floor rather than being clipped away", g.relaxation <= -6, g.relaxation);
}

/* ── 2. what the player actually typed ──────────────────────────────────────── */
{
  const here = ["Claudia Antonia", "Titus Aelius Rufus"];
  const at = (s: string) => [...hostileToward(s, here)];

  check("the turn that caused this", at(`"You Roman's are such pieces of shit. Do you idiots know the world is round? So shut the fuck up."`).length === 2);
  check("and the short one", at(`"Hey Claudia. Fuck you"`).includes("Claudia Antonia"));
  check("naming one person does not splash the other",
    at(`"Claudia you absolute bitch"`).length === 1 && at(`"Claudia you absolute bitch"`)[0] === "Claudia Antonia");

  check("cursing the world is not cursing a person", at(`"This whole fucking city is a shithole"`).length === 0, at(`"This whole fucking city is a shithole"`));
  check("swearing in company is not swearing at company", at(`"Oh fuck. I left the bag at the forum."`).length === 0);
  check("a private thought reaches nobody", at(`*god she's an idiot, fuck her*`).length === 0);
  check("an ordinary line is not an insult", at(`"Claudia, do you know where the tribunal sits?"`).length === 0);
  check("a plain aggressive act counts too", at(`I spit at Claudia and call her a worthless bitch`).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
