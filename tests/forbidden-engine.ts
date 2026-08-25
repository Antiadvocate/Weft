/* Smoke test: THE STORY THAT WAS TOLD TO BE A ROMANCE WHILE BEING HANDED A BREAKUP.
 *
 * The Ashford save, 126 turns. Same world as tests/contract-drift.ts, thirty-four turns later, and
 * the previous fix worked: the auditor now knows what a contract is and it caught the drift five
 * chapters out of six, in its own words —
 *
 *   ch1  "devolved into domestic breakup hostility ... instead of romantic erotica"
 *   ch2  "an explicit divorce/breakup procedural ... violating the explicit prohibition"
 *   ch3  "a bureaucratic divorce and real estate procedural"
 *   ch5  "drifted into a tense interpersonal conflict with an antagonist-like figure"
 *   ch6  "sidelining the promised intimacy and vulnerability"
 *
 * The bible's never-the-engine list, verbatim: "Physical violence or threats of it", "A villain with
 * malicious intent", "A medical crisis or health scare", "A breakup or infidelity plot". Three of the
 * four ran the story. The auditor was right every time and nothing changed, for two reasons.
 *
 * 1. NOTHING DOWNSTREAM READ THE FORBIDDEN LIST. It reached the narrator as one parenthetical asking
 *    it not to reach for such a theme unprompted. Meanwhile fictionHeat — which writes the FIRST
 *    LINE of the pressure directive, "source: ..." — was a bare argmax over open-thread tension with
 *    no memory and no filter. The save's telemetry: the same thread, "Friction between Vin and
 *    Miranda over privacy and friends", is the named source at turns 25, 40, 60, 75, 90, 110 and
 *    125. The auditor said "stop running a breakup plot" and the machinery underneath said, on every
 *    turn in between, "this scene is about the Vin/Miranda friction."
 *
 * 2. THE CORRECTION DEMANDED THE GENRE BACK, every turn, unconditionally: "there is no version of
 *    this turn that contains none of it." In a romance whose romance has divorced and moved across
 *    the city, there is exactly one way for a narrator to comply, and it took it: the wife's best
 *    friend could not be kept off the porch through a refusal, a call to the police and an arrest,
 *    and the neighbour went from a hello to "I'm your girlfriend now, so I stay" in one afternoon.
 *
 * And the arming itself never asked whose drift it was. The player had spent those chapters
 * deliberately, repeatedly ending a marriage — in their own typed actions — and the engine's answer
 * was to record that they were "emotionally guarded" with a "deep discomfort with vulnerability",
 * and to instruct the narrator to steer them back.
 */
import { fictionHeat, selectBeat, pressureDirective } from "../src/engine/pressure";
import { outlivedCanon } from "../src/engine/canonstate";
import { CHAPTER_SYSTEM, PERSONA_SYSTEM } from "../src/engine/prompts";
import { ageClashes, summarizeAgeClashes } from "../src/engine/age";
import { readFileSync } from "node:fs";

/** The canon block is assembled inside a large context builder; read the shipped source for it. */
const buildContext = () => readFileSync("src/engine/prompts.ts", "utf8");
import type { SaveState, Thread } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FRICTION = "Friction between Vin and Miranda over privacy and friends";
const thread = (title: string, tension: number, extra: Partial<Thread> = {}): Thread => ({
  id: title, title, status: "active", description: "", turn_started: 1, tension, ...extra,
} as Thread);

/* ── 1. the headline no longer belongs to one thread forever ──────────────────── */
{
  const threads = [thread(FRICTION, 8), thread("The David Fund", 5), thread("Final decree issuance date", 4)];
  const fresh = fictionHeat(threads, [], [], 126);
  check("the hottest thread still leads when nothing has been said", fresh.source === `thread: ${FRICTION}`, fresh);

  // what the save actually looked like: the same source named on turn after turn
  const said = new Array(6).fill(`thread: ${FRICTION}`);
  const worn = fictionHeat(threads, [], [], 126, undefined, said);
  check("...but a source that has led the last six turns yields", worn.source !== `thread: ${FRICTION}`, worn);
  check("...to another open thread, not to nothing", worn.source.startsWith("thread: "), worn);
  check("...and the world is not made artificially calm by the swap", worn.heat > 0, worn);

  // and it comes back once it has been quiet — this is fatigue, not a ban
  const rested = fictionHeat(threads, [], [], 126, undefined, ["thread: The David Fund", "thread: The David Fund"]);
  check("a rested source can lead again", rested.source === `thread: ${FRICTION}`, rested);
}

/* ── 2. a forbidden engine is not a source at all ─────────────────────────────── */
{
  const marked = [thread(FRICTION, 8, { forbidden_engine: true }), thread("The David Fund", 7)];
  const h = fictionHeat(marked, [], [], 126);
  check("a thread the auditor named as the forbidden engine never leads",
    h.source === "thread: The David Fund", h);

  const beats = [1, 2, 3, 4, 5, 6].map(() => selectBeat({
    turn: 126, tension: 8, threads: marked, clocks: [], consequences: [], agents: [],
    last_beat_turn: 0, last_exo_turn: 0, rng: () => 0.01,
  } as any));
  check("...and the world never presses through it either",
    beats.every((b: any) => b.ref !== FRICTION), beats);
  check("...while the rest of the world still works",
    beats.some((b: any) => b.ref === "The David Fund"), beats);

  // marking is not closing: the thread is still there for the player
  check("the thread itself stays open", marked[0].status === "active");
}

/* ── 3. the genre's own pressures survive a protagonist who scales ────────────── */
{
  const palette = ["Internalized shame and body dysphoria", "The vulnerability of asking for a specific kind of desire"];
  const v = { pressure: 5, band: "friction", source: "x" } as any;
  for (const tier of ["mortal", "empowered", "mythic", "cosmic"] as const) {
    const d = pressureDirective(v, palette, 5, tier, { kind: "none" });
    check(`the palette reaches the narrator at tier ${tier}`, d.includes("Internalized shame"), d);
  }
}

/* ── 4. canon the story has outlived ──────────────────────────────────────────── */
{
  // the save's real canon line, real cast, real ledger numbers
  const save = {
    characters: {
      char_player: { name: "Vin" },
      char_m: { name: "Miranda" },
      char_c: { name: "Chloe" },
    },
    world: {
      canon: [
        "Vin and Miranda have a strong, loving, and stable marriage that is the bedrock of their lives.",
        "Miranda is a trans woman who has not had, and does not want, gender confirmation surgery.",
        "The city of Ashford has a visible and active queer community.",
      ],
      edges: [
        { from: "char_m", to: "char_player", warmth: -22.8, trust: -45.4 },
        { from: "char_player", to: "char_m", warmth: -5, trust: -3 },
      ],
    },
  } as unknown as SaveState;

  const out = outlivedCanon(save);
  check("the marriage line is recognised as history",
    out.has("vin and miranda have a strong, loving, and stable marriage that is the bedrock of their lives."), [...out.keys()]);
  check("...and says why, from the ledger",
    /trust -45/.test(out.get("vin and miranda have a strong, loving, and stable marriage that is the bedrock of their lives.") ?? ""),
    out);
  check("a fact about a person is left alone", out.size === 1, [...out.keys()]);

  // it heals: put the bond back and the line is current again
  (save.world.edges as any)[0].warmth = 40; (save.world.edges as any)[0].trust = 30;
  check("a repaired bond makes the line true again", outlivedCanon(save).size === 0);

  // a line asserting the OPPOSITE is never retired by a hostile ledger
  (save.world.edges as any)[0].warmth = -80; (save.world.edges as any)[0].trust = -80;
  save.world.canon = ["Vin and Miranda cannot be in a room together without it going badly."];
  check("a line about a bond that is bad is not retired for the bond being bad", outlivedCanon(save).size === 0);

  // death retires it too
  save.world.canon = ["Vin and Chloe are the closest of friends."];
  (save.characters as any).char_c.status = "dead";
  const dead = outlivedCanon(save);
  check("a dead person's bond line is history", dead.size === 1 && /dead/.test([...dead.values()][0]), dead);
}

/* ── 5. the auditor says whose drift it is, and stops diagnosing the player ───── */
{
  check("the auditor is asked to attribute the drift", /drift_cause/.test(CHAPTER_SYSTEM));
  check("...and told a player playing their story is not a drift",
    /A player playing their story is NOT a drift to be corrected/.test(CHAPTER_SYSTEM));
  check("...and told to lean toward the player when it is close",
    /"player" whenever it is genuinely close/.test(CHAPTER_SYSTEM));
  check("the auditor names the threads the world presses through", /engine_threads/.test(CHAPTER_SYSTEM));
  check("...verbatim, so a title is a handle", /copy the EXACT titles/.test(CHAPTER_SYSTEM));

  // Stated as a positive requirement, deliberately: naming the diagnostic phrasings in order to ban
  // them is the shape this repo's own prompt ratchets exist to keep out, and it teaches the shape.
  // "Which turn did this happen on" excludes a diagnosis without ever mentioning one.
  for (const [what, prompt] of [["chapter read", CHAPTER_SYSTEM], ["playthrough read", PERSONA_SYSTEM]] as const) {
    check(`the ${what} must name what a reader watched them do`,
      /NAMES SOMETHING A READER WATCHED THEM DO/.test(prompt), prompt.slice(0, 80));
    check(`...testable against a turn, not a personality (${what})`,
      /asking which turn it happened on/.test(prompt));
    check(`...and the player is not graded (${what})`, /nobody's/.test(prompt));
  }
}

/* ── 6. canon is directional ─────────────────────────────────────────────────────
 *
 * The Ashford save's canon, written by the player:
 *
 *     "Vin cannot talk directly to women while looking at them he must only look at their feet."
 *
 * A rule about where ONE man puts his eyes. What came back, in the four most charged turns of the
 * whole story, was the mirror of it — his wife, in the middle of the argument that ends their
 * marriage, would not look at his face:
 *
 *     T18  "Miranda is looking at Vin. Not at his face. At the floor, at his shoes."
 *     T19  "she looks at his feet, not his face"
 *     T22  "She looks at the doorway, not at Vin's face."
 *     T23  "She looks at the floor, at his shoes, at the strip of light from the hall."
 *
 * Nobody wrote that rule. It was supplied, because the canon block declares canon supreme over every
 * default and never said which way a line points — and a woman who will not meet her husband's eyes
 * reads as contempt in every beat she appears in. Half of "the prose always drove us apart" is this
 * one missing sentence.
 */
{
  const rendered = buildContext();
  check("the canon block says a line binds its named subject",
    /CANON IS DIRECTIONAL/.test(rendered), "");
  check("...and that the other party's behaviour is not specified by it",
    /has said nothing about how anyone looks at, speaks to, stands near or touches THEM/.test(rendered), "");
  check("...and that supplying the matching half is inventing canon",
    /supplying the matching half is inventing canon that is not there/.test(rendered), "");
  check("...and that one-sided is still what it says",
    /one party obeying it is still what it says/.test(rendered), "");
}

/* ── 7. an age the written history cannot support ────────────────────────────────
 *
 * Miranda's record from the save, verbatim: age 22, and a background that has her moving to the
 * city for art school a decade ago — at twelve — with a husband whose own background has them
 * meeting six years before that, which puts her at sixteen and married shortly after.
 */
{
  const miranda = {
    age: 22,
    background: "Miranda is a successful graphic designer who moved to Ashford a decade ago for art school and never left. She transitioned in her early twenties and has built a life she's proud of, brick by brick. She was raised by a single, fiercely supportive mother in a small, conservative town.",
  };
  const clashes = ageClashes(miranda);
  check("the decade that puts her at twelve is caught", clashes.length >= 1, clashes);
  check("...and it names the age it lands on", clashes.some((c) => c.at === 12), clashes);
  check("...and the line names both halves so a human can pick one",
    /set the age to match the history, or rewrite the history to match the age/
      .test(summarizeAgeClashes(clashes, "Miranda", 22)));

  // the sentence about her mother is somebody else's life and is not counted
  check("a sentence about a parent is left alone",
    !clashes.some((c) => /mother/.test(c.sentence)), clashes);

  // and a record that hangs together says nothing at all
  check("a coherent record is silent", ageClashes({
    age: 35, background: "Leo has been teaching history for ten years. He met David fifteen years ago.",
  }).length === 0);
  check("childhood is history, not a clash", ageClashes({
    age: 30, background: "As a child, twenty years ago, she was taken out of the city.",
  }).length === 0);
  check("no age on record means nothing to check", ageClashes({ background: "A decade ago she left." }).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
