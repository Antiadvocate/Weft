/* Smoke test: NINETEEN TURNS, FOUR PALETTE LINES, AND THE WORLD NEVER PRESSED ONCE.
 *
 * From a real save (Elm Street Tenement, turn 19). The player had written four pressure palette
 * lines by hand, the fourth of them naming the escalation the whole story was for. Every row of the
 * telemetry reads:
 *
 *     beat "none"   source "quiet — the world breathes"
 *
 * eighteen times, with pressure_state.last_beat_turn at 0 and its recent list empty. The player's
 * report: "I asked the game to do things to max. It didn't. Not only did it not refuse though it
 * just ignored the prompt that I put in story direction that should've occurred."
 *
 * IT WAS NOT A REFUSAL AND IT WAS NOT THE MODEL. model_settings.tension was 0, and selectBeat
 * returned { kind: "none" } before the `standing` list — the list the palette is built into — was
 * ever constructed. Run that same save's own palette through the same selector at tension 5 and it
 * comes back kind "palette" on twelve rolls in twenty. The lines were live, well-formed and
 * correctly wired the whole time; they were unreachable.
 *
 * AND THE ENGINE ARGUED WITH THEM. pressureDirective's rest paragraph went out every turn saying
 * "Do NOT introduce any new threat, problem, complication... they do NOT manufacture a
 * confrontation, escalate, corner the player with a demand" — at a story whose fourth palette line
 * read "Psychological boundary testing escalating to sadistic domestic control".
 *
 * THE FIX IS THE ARGUMENT turn.ts ALREADY MADE ABOUT THE OTHER HAND-TYPED FIELD: "an authored want
 * is not the engine originating anything; it is the player originating it, by hand, on purpose.
 * Somebody who turned tension to 0 to stop the world inventing plots and then wrote a want onto
 * their neighbour meant for that want to happen." tickAuthored runs above the tension gate for that
 * reason. The palette sat below it. */
import { selectBeat, pressureDirective, beatDirective } from "../src/engine/pressure";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* The save's own four lines. */
const PALETTE = [
  "Stifling summer heat forcing minimal clothing and bare skin indoors",
  "Humiliating exposure of sexual taboos and hidden kinks",
  "Financial precarity and shared lease leverage",
  "Psychological boundary testing escalating to sadistic domestic control",
];

const base = (over: Record<string, unknown> = {}) => ({
  turn: 19, now: "Day 5, 14:00", tension: 0,
  threads: [], clocks: [], consequences: [], agents: [],
  palette: PALETTE, gone: [], last_beat_turn: 0, last_exo_turn: 0,
  rng: () => 0.5, ...over,
}) as any;

/* ── 1. AT REST THE PREMISE STILL REACHES THE SCENE ──────────────────────────── */
{
  const b: any = selectBeat(base());
  check("tension 0 no longer means the palette is unreachable", b.kind === "palette", b);
  check("...and it arrives in its quiet form", b.quiet === true, b);
  check("...naming a line the player actually wrote", PALETTE.some((l) => b.ref.startsWith(l.slice(0, 40))), b);
}

/* ── 2. ...ON A SLOWER CLOCK THAN WHEN THE DIAL IS UP ────────────────────────── */
{
  // Fired on turn 15, four turns ago: at rest the premise comes around rather than presses, and
  // ONE line speaking rests the whole palette — see the walk in block 9 for why that matters.
  const recent = [{ ref: PALETTE[1], turn: 15, count: 1, kind: "palette" }];
  check("one line speaking four turns ago rests the whole palette",
    selectBeat(base({ recent })).kind === "none", selectBeat(base({ recent })));

  const old = PALETTE.map((ref) => ({ ref, turn: 5, count: 1, kind: "palette" }));
  check("...and a palette that has waited fourteen comes back", selectBeat(base({ recent: old })).kind === "palette");
}

/* ── 3. THE LINE THAT HAS WAITED LONGEST IS THE ONE THAT COMES ───────────────── */
{
  // All three past the palette-wide rest clock, so the premise is allowed to speak at all; the
  // fourth has never fired, which is the case from the save.
  const recent = [
    { ref: PALETTE[0], turn: 7, count: 1, kind: "palette" },
    { ref: PALETTE[1], turn: 6, count: 1, kind: "palette" },
    { ref: PALETTE[2], turn: 5, count: 1, kind: "palette" },
  ];
  const b: any = selectBeat(base({ recent }));
  check("the never-fired line is the one that surfaces", b.ref.startsWith("Psychological boundary testing"), b);
}

/* ── 4. THE DIAL KEEPS EVERY PROMISE IT MADE ABOUT THE ENGINE'S OWN INVENTIONS ─ */
{
  const engineSources = base({
    palette: [],
    threads: [{ id: "t1", title: "The upstairs leak", description: "Water through the ceiling.", status: "active", tension: 8, turn_started: 1 }],
    clocks: [{ id: "c1", faction: "The landlord", objective: "Evict them", segments: 6, filled: 4, status: "running", consequence: "out", visible_signs: [] }],
  });
  check("no palette means no beat at rest, exactly as before", selectBeat(engineSources).kind === "none", selectBeat(engineSources));

  const withBoth = base({
    threads: [{ id: "t1", title: "The upstairs leak", description: "Water through the ceiling.", status: "active", tension: 8, turn_started: 1 }],
    clocks: [{ id: "c1", faction: "The landlord", objective: "Evict them", segments: 6, filled: 4, status: "running", consequence: "out", visible_signs: [] }],
  });
  const b: any = selectBeat(withBoth);
  check("a hot thread and a nearly-full clock still get nothing at rest", b.kind === "palette", b);
}

/* ── 5. A DUE CONSEQUENCE STILL OUTRANKS EVERYTHING ──────────────────────────── */
{
  const due = base({ consequences: [{ id: "x", description: "The rent is due today.", fire_turn: 18, status: "pending", severity: 3 }] });
  check("the calendar still wins", selectBeat(due).kind === "consequence", selectBeat(due));
}

/* ── 6. AND THE DIAL DOES NOT STAY UNTOUCHED ABOVE ZERO ──────────────────────── */
{
  check("above rest the ordinary rotation runs", ["palette", "thread", "clock", "agent", "none", "exogenous"].includes(selectBeat(base({ tension: 5 })).kind));
}

/* ── 7. THE REST PARAGRAPH STOPS ARGUING WITH THE BEAT ───────────────────────── */
{
  const v = { pressure: 0, band: 0, source: "quiet — the world breathes" } as any;
  const beat = { kind: "palette", ref: PALETTE[3], quiet: true } as any;

  const withBeat = pressureDirective(v, PALETTE, 0, "mortal", beat, true);
  check("it no longer tells the narrator to introduce nothing while handing it something",
    !/Do NOT introduce any new threat/.test(withBeat), withBeat);
  check("...it says what the exception is and whose it is",
    /what the player wrote this story to run on/.test(withBeat), withBeat);
  check("...and it does not print the beat body twice when the caller places it",
    !withBeat.includes("THE STORY'S OWN SUBJECT TOUCHES THE SCENE"), withBeat);

  /* A quiet turn with no beat is unchanged — the rest state is still the rest state. */
  const noBeat = pressureDirective(v, PALETTE, 0, "mortal", { kind: "none" } as any, true);
  check("a turn with nothing in it reads exactly as it always did", /Do NOT introduce any new threat/.test(noBeat));
}

/* ── 8. AND IT LANDS AT THE END, WHERE AN INSTRUCTION GOES ───────────────────── */
{
  const beat = { kind: "palette", ref: PALETTE[3], quiet: true } as any;
  const d = beatDirective(beat, 0);
  check("the palette beat reaches the last block at rest", d.includes("WHAT THIS TURN IS FOR"), d);
  check("...carrying the quiet body rather than the pressing one",
    d.includes("lightly and unprompted") && !d.includes("THE ENGINE OF THIS STORY PRESSES"), d);

  check("nothing else the engine invented gets that slot at rest",
    beatDirective({ kind: "thread", ref: "The upstairs leak" } as any, 0) === "");
}

/* ── 9. THE DIAL RUNS IN ONE DIRECTION ────────────────────────────────────────────
 *
 * The first version of restingPalette measured hunger PER LINE, so with four palette lines the
 * stalest was past the threshold again within two or three turns of the last touch. Walked over
 * sixty turns of the save this was built from:
 *
 *     tension  0 → 24 beats      tension 1 → 5      tension 2 → 5      tension 5 → 13
 *
 * Turning the dial UP from rest made the world five times quieter. The player had just been told to
 * raise it off 0, did, and reported that nothing changed — correctly, because for him it got worse.
 *
 * pickStanding had already solved this and written it down: "hunger is measured across the palette
 * AS A WHOLE. The premise speaks, then rests, then may speak again." Any line speaking rests the
 * whole palette. */
{
  const walk = (tension: number): number => {
    let lastBeat = 0, minutesSince = 9999, beats = 0;
    const recent: { ref: string; turn: number; count: number; kind: string }[] = [];
    for (let t = 1; t <= 60; t++) {
      let k = 0;
      const rng = () => { k++; return ((t * 7919 + k * 104729) % 1000) / 1000; };
      const b: any = selectBeat(base({
        tension, turn: t, last_beat_turn: lastBeat, minutesSinceBeat: minutesSince, recent, rng,
        threads: [{ id: "t1", title: "Cardboard behind the dryer", description: "A flattened box.", status: "active", tension: 3, turn_started: 1 }],
      }));
      if (b.kind !== "none") {
        beats++; lastBeat = t; minutesSince = 0;
        const prev = recent.find((r) => r.ref === b.ref);
        if (prev) { prev.turn = t; prev.count++; } else recent.push({ ref: b.ref, turn: t, count: 1, kind: b.kind });
      } else minutesSince += 6;   // a conversation scene, which is what this save is
    }
    return beats;
  };

  const rest = walk(0), low = walk(2), mid = walk(5), high = walk(10);
  check("rest is the quietest position on the dial", rest <= low, { rest, low });
  check("...and the middle is busier than the low end", mid >= low, { low, mid });
  check("...and the top is busier than the middle", high >= mid, { mid, high });
  check("rest is not silent either", rest > 0, { rest });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
