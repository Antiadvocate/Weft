/**
 * THE GUIDES — what the controls on a screen do, in as few words as will carry it.
 *
 * Weft has more surface than it can be handed to a stranger with, so each screen gets a short
 * spotlight pass the first time you land on it. The hard limit is that this is not reading
 * material: a step is one line, two at the outside, and a screen is over in a handful of taps.
 * Anything that wants a paragraph either belongs on the card under the field itself (most of the
 * Forge already has one) or in the cheat sheet, and most of it belongs nowhere.
 *
 * `target` is a `data-tour` value in the DOM — the Coach cuts a hole around it and points. No
 * target means a centred card, which is how the one genuinely unguessable thing (how to write a
 * message) gets said in the same flow.
 */

export type TourId =
  | "library" | "forge" | "play" | "cast" | "world" | "journal" | "chronicle" | "settings";

export interface TourStep {
  /** `data-tour` attribute of the element to spotlight. Omit for a centred card. */
  target?: string;
  title: string;
  /** Lines, not paragraphs. `**bold**` and `` `mono` `` are honoured; nothing else is. */
  body: string[];
  /** Drop the step when its target isn't on screen — a control that only exists in context
   *  (nobody present, no spend yet) must not be explained to someone who can't see it. */
  skipIfMissing?: boolean;
}

/* ── persistence ─────────────────────────────────────────────────────────────────────────────── */

const SEEN_KEY = "weft-guides-seen";
const OFF_KEY = "weft-guides-off";
const VISITED_KEY = "weft-been-here";

function readSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); } catch { return []; }
}

/** Has this screen already run its guide on its own? */
export function tourSeen(id: TourId): boolean {
  return readSeen().includes(id);
}

export function markTourSeen(id: TourId): void {
  const seen = readSeen();
  if (seen.includes(id)) return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id])); } catch { /* private mode */ }
}

/** The "I know Weft" switch. Suppresses every automatic guide; the "?" still works. */
export function guidesOff(): boolean {
  return localStorage.getItem(OFF_KEY) === "1";
}

export function setGuidesOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch { /* private mode */ }
}

/** Forget every screen, so the guides run again from the top. */
export function resetGuides(): void {
  try { localStorage.removeItem(SEEN_KEY); localStorage.removeItem(OFF_KEY); } catch { /* private mode */ }
}

/** First run ever. Decides whether the app opens on the Forge or the Library. */
export function firstRun(): boolean {
  return localStorage.getItem(VISITED_KEY) !== "1";
}

export function markVisited(): void {
  try { localStorage.setItem(VISITED_KEY, "1"); } catch { /* private mode */ }
}

/* ── the guides ──────────────────────────────────────────────────────────────────────────────── */

export const TOURS: Record<TourId, TourStep[]> = {

  library: [
    {
      target: "lib-forge",
      title: "Build your own",
      body: ["One idea — the engine builds the place, the people and the trouble."],
    },
    {
      target: "lib-presets",
      title: "Or take one ready-made",
      body: ["Faster if you just want to see how a turn feels."],
      skipIfMissing: true,
    },
    {
      target: "lib-sprout",
      title: "New chapter",
      body: ["Skips time and starts a season two — same cast, everything they became."],
      skipIfMissing: true,
    },
  ],

  forge: [
    {
      target: "forge-seed",
      title: "The seed",
      body: [
        "A place, a moment, something already wrong. That's enough.",
        "Everything below it is optional.",
      ],
    },
    {
      target: "forge-tone",
      title: "Worth setting",
      body: ["Without a genre it drifts literary. *\"action-horror, lethal and fast\"*."],
    },
    {
      target: "forge-model",
      title: "The smith",
      body: ["Tap for the model list. This one call builds the whole world."],
    },
    {
      target: "forge-veteran",
      title: "Played this before?",
      body: ["Tick it and no guide opens on its own again. The **?** still works."],
    },
  ],

  play: [
    {
      target: "play-composer",
      title: "Four ways to write, one box",
      body: [
        "`\"quotes\"` — said out loud",
        "`*asterisks*` — a thought no one can hear",
        "`(parentheses)` — how you feel about it, invisible to everyone",
        "anything else — what you physically do",
      ],
    },
    {
      title: "Mix them freely",
      body: [
        "`I stay standing. \"I'm not signing.\" (hands shaking, don't let her see)`",
        "They hear one line and see a man who didn't sit. That's all they get.",
      ],
    },
    {
      target: "play-extras",
      title: "Options",
      body: ["**Do** you act · **Story** you narrate · **web** live search · **tight** your body 0–5."],
    },
    {
      target: "play-more",
      title: "Everything else",
      body: ["Skip time, roll back, set the genre, illustrate a turn, direct a montage."],
    },
    {
      target: "play-prose",
      title: "The story",
      body: ["Tap a name for who they are and how they feel about you."],
    },
    {
      target: "help",
      title: "This button",
      body: ["Brings a screen's guide back. The cheat sheet is under Tuning."],
    },
  ],

  cast: [
    {
      title: "The cast",
      body: ["Tap anyone for their memories, wants, bonds, and their read of you — which can be wrong."],
    },
    {
      target: "cast-add",
      title: "Add someone",
      body: ["A sentence is enough; the engine builds the rest and walks them in."],
      skipIfMissing: true,
    },
  ],

  world: [
    {
      target: "world-web",
      title: "The web",
      body: ["Everyone's ties to you. Green warm, red hostile."],
      skipIfMissing: true,
    },
    {
      target: "world-clocks",
      title: "Clocks",
      body: ["What factions are working on while you're elsewhere. A full clock fires."],
      skipIfMissing: true,
    },
  ],

  journal: [
    {
      title: "The journal",
      body: ["Every turn as you typed it — handy for finding what to roll back to."],
    },
  ],

  chronicle: [
    {
      title: "The chronicle",
      body: ["Arcs, records, and what you've spent so far."],
    },
  ],

  settings: [
    {
      target: "set-tension",
      title: "World tension",
      body: ["How much gets thrown at you. At **0** the world adds nothing on its own."],
      skipIfMissing: true,
    },
    {
      target: "set-bible",
      title: "The world bible",
      body: ["Every rule of the world, editable. Fix anything the forge got wrong."],
      skipIfMissing: true,
    },
    {
      target: "set-guides",
      title: "Help lives here",
      body: ["The cheat sheet, and the switch for these guides."],
      skipIfMissing: true,
    },
  ],
};
