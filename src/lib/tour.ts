/**
 * THE GUIDES — what every control on a screen is for, said once, on the screen itself.
 *
 * Weft has a lot of surface: four input channels in one text box, a forge with eight optional
 * fields, a "⋯" sheet with eleven entries, six tabs, and a raw JSON editor at the bottom of two of
 * them. None of that is discoverable, and the README is not in the app. So each screen carries a
 * short spotlight tour: the first time you land there it runs itself, and the "?" in the title bar
 * brings it back forever after. A player who already knows the game turns the whole thing off with
 * one checkbox in the Forge.
 *
 * Steps are data, not JSX, so this file stays readable as prose. `target` is a `data-tour` value
 * somewhere in the DOM — the Coach finds it, cuts a hole in the scrim around it, and points at it.
 * A step with no target is a full-width card in the middle of the screen, which is how the things
 * that are not a button (how to write a message, what a turn costs) get explained in the same flow.
 */

export type TourId =
  | "library" | "forge" | "play" | "cast" | "world" | "journal" | "chronicle" | "settings";

export interface TourStep {
  /** `data-tour` attribute of the element to spotlight. Omit for a centred card. */
  target?: string;
  title: string;
  /** Paragraphs. `**bold**` and `` `mono` `` are honoured; nothing else is. */
  body: string[];
  /** Drop the step entirely when its target isn't on screen (a control that only appears in
   *  context — the rollback list on turn 1, the faces when you're alone). Without this the
   *  guide would explain a button the player cannot see. */
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

/** First run ever — nothing has been opened, no world has been forged. Decides whether the app
 *  opens on the Forge (build a world) or the Library (pick up where you were). */
export function firstRun(): boolean {
  return localStorage.getItem(VISITED_KEY) !== "1";
}

export function markVisited(): void {
  try { localStorage.setItem(VISITED_KEY, "1"); } catch { /* private mode */ }
}

/* ── the guides ──────────────────────────────────────────────────────────────────────────────── */

export const TOURS: Record<TourId, TourStep[]> = {

  /* ═══ LIBRARY ═══ */
  library: [
    {
      title: "The library",
      body: [
        "Every world you've made lives here. Nothing is on a server — saves sit in **this browser**, so export anything you'd hate to lose (Tuning → Export).",
      ],
    },
    {
      target: "lib-forge",
      title: "The Forge — start here",
      body: [
        "Type one idea and the engine builds the place, the people, their grudges and their clocks. This is the main way to start: **the world is yours, not a menu pick**.",
      ],
    },
    {
      target: "lib-presets",
      title: "Or take a ready-made world",
      body: [
        "Prebuilt worlds, forged already. Good for a first look at how a turn feels before you spend a minute forging your own.",
      ],
      skipIfMissing: true,
    },
    {
      target: "lib-continue",
      title: "Your chronicles",
      body: [
        "Tap to keep playing. The line underneath is the world, the turn number, and when you last touched it.",
      ],
      skipIfMissing: true,
    },
    {
      target: "lib-sprout",
      title: "New chapter",
      body: [
        "A season two. It distils the whole world — cast, grudges, canon, who you became — skips time, and opens a fresh save with all of it baked in.",
        "You say what the next chapter is about; that brief is **binding** on the threads and the opening.",
      ],
      skipIfMissing: true,
    },
    {
      target: "lib-import",
      title: "Import",
      body: [
        "Load a `.weaver.json` you exported, or paste the save text (easier on a phone).",
      ],
      skipIfMissing: true,
    },
  ],

  /* ═══ FORGE ═══ */
  forge: [
    {
      title: "Seeding a world",
      body: [
        "One LLM call builds everything: the place, the cast, their histories, what each of them wants, and the clocks already ticking. After that the world runs on its own.",
        "Only the first box is required. **Everything below it is optional** — but the more you say here, the more the story is yours.",
      ],
    },
    {
      target: "forge-seed",
      title: "The seed",
      body: [
        "A situation, not a plot. A place, a moment, and something already wrong: *\"A fishing village the winter the ice came early.\"*",
        "Naming real media, a real city, or a real period works — turn on web grounding below and it comes back accurate instead of approximate.",
      ],
    },
    {
      target: "forge-sparks",
      title: "Stuck?",
      body: [
        "Tap one to fill the box, then edit it into something you actually want.",
      ],
      skipIfMissing: true,
    },
    {
      target: "forge-destination",
      title: "Destination — where it ends",
      body: [
        "Name the ending and every scene bends toward it. Leave it blank for an open world that goes wherever you take it.",
        "Fill it in and a **turn budget** appears: set a number and the story ends there, shedding unrelated threads as the count runs down. You choose how you arrive, not whether you do.",
      ],
    },
    {
      target: "forge-tone",
      title: "Genre & tone — set this",
      body: [
        "The key the whole story is written in: *\"action-horror survival, lethal and fast\"*, *\"warm domestic romance\"*, *\"bleak procedural\"*.",
        "Without it a model drifts toward the same quiet literary character study no matter what you seeded. **This is the single most useful optional field.**",
      ],
    },
    {
      target: "forge-threads",
      title: "Story beats to seed",
      body: [
        "One plot point per line. Each becomes a live thread the world draws from, and the forge builds the cast and places so it's primed to actually happen.",
        "Add detail after an em dash: *\"An old debt comes due — the creditor is her brother\"*.",
      ],
    },
    {
      target: "forge-model",
      title: "The smith",
      body: [
        "Which model builds the world — an OpenRouter id. The default is cheap and good at this. The models that narrate your turns are set separately in **Tuning → Models**.",
      ],
    },
    {
      target: "forge-web",
      title: "Ground it in the real world",
      body: [
        "The forge searches the web while it builds, so a world seeded from real history, a real place, or existing media comes back canon-accurate.",
        "Aim the search precisely by putting the topic in double parentheses anywhere in your seed: `((Meiji-era Hokkaido))`. Costs a little more.",
      ],
    },
    {
      target: "forge-go",
      title: "Forge it",
      body: [
        "About a minute. Then you're in the world, on turn 1, and the guide for the play screen runs itself.",
      ],
    },
    {
      target: "forge-veteran",
      title: "Played this before?",
      body: [
        "Tick this and no guide ever opens on its own again. The **?** in the title bar still brings the current screen's guide back whenever you want it, and you can switch the guides back on in **Tuning**.",
      ],
    },
  ],

  /* ═══ PLAY ═══ */
  play: [
    {
      title: "How a turn works",
      body: [
        "You type what you do. The narrator writes the world's answer, then a bookkeeper reads that prose and records what actually changed — who moved, who learned what, who now resents you, which clock advanced.",
        "**Nothing is on rails.** There are no scripted branches; the state is the story.",
      ],
    },
    {
      target: "play-composer",
      title: "Four channels, one box",
      body: [
        "What you type is read on four channels, and you can mix all four in one message:",
        "`\"in double quotes\"` — **said aloud**. Everyone present hears it. It has already been said, so the narrator answers it rather than repeating it.",
        "`*between asterisks*` — a **private thought**. No character can hear it, intuit it, or react to it. Ever.",
        "`(in parentheses)` — your **private inner state**: the feeling or motive behind the act. It shapes how you do the thing; nobody else can see it.",
        "Anything else — **physical action**, which happens exactly as written.",
      ],
    },
    {
      title: "A message that uses all four",
      body: [
        "`I set the cup down and stay standing. \"I'm not signing that.\" (my hands are shaking, don't let her see) *she's bluffing, she has to be*`",
        "The room hears one sentence. It sees a man who put down a cup and did not sit. It never learns about the hands or the guess — but the guess is what your body was doing while you said it, and the bookkeeper reads it for **your** mood, not theirs.",
        "Two rules worth knowing: what you **do** is law and always happens; what you **claim** is not — say there's a hospital in a world that has none and people will just be baffled. And out-of-character complaints (*\"this pacing is dragging\"*) are read as direction to the narrator, never played out as story.",
      ],
    },
    {
      target: "play-send",
      title: "Send",
      body: [
        "Or press Enter. Shift-Enter for a new line.",
      ],
    },
    {
      target: "play-extras",
      title: "Compose options",
      body: [
        "**Do / Story** — *Do* is you acting in the world. *Story* hands you the pen: you narrate what happens next and the engine weaves it in, keeping the world's logic.",
        "**web** — grounds this one reply in a live web search. Real streets, real facts, real details, on the turns you ask for it.",
        "**tight 0–5** — how tight your body is right now, against your own baseline. Leave it off and the engine reads it from your words. `base` turns the number into a standing ceiling (a bad night's sleep the clock can't see) instead of a one-turn spike.",
      ],
    },
    {
      target: "play-more",
      title: "The ⋯ menu — everything else",
      body: [
        "**Watch a turn** — the world and your own character act without you.",
        "**Genre & register** and **Narrator direction** — standing orders. Your direction sits at the very top of the prompt and overrules the world bible, the cast, and the model's own taste in drama.",
        "**Drive toward an event** — the story converges on it, then shifts into it when it fires.",
        "**Let the world turn** — skip hours or days, or direct a montage: say what should be true by the end and the engine writes the middle.",
        "**Roll back** — return to any earlier turn. **Refresh memory**, **Clear the log**, and **Illustrate the turn** live here too.",
      ],
    },
    {
      target: "play-prose",
      title: "The story",
      body: [
        "Tap any character's **name** in the prose for a card: their mood, how they feel about you, what they last carried away from you, and whether their read of you is wrong.",
        "Each turn also carries small controls — **re-run the bookkeeper** (keeps the prose, rebuilds the record), **veto** an invention you refuse (rolled back and voided forever), and **correct the record** (affirm a world rule the narrator ignored, changing nothing else).",
      ],
    },
    {
      target: "play-present",
      title: "Who's here",
      body: [
        "Exactly who is in the scene with you. The ring colour is how warm they are toward you, the arc is how open or clenched. Tap a face to open them.",
        "Nobody is ever silently present, and nobody teleports — presence is derived from where people actually are.",
      ],
      skipIfMissing: true,
    },
    {
      target: "play-orb",
      title: "Your own state",
      body: [
        "How open or clenched you are, breathing at the pace of the scene. Green is open, red is clenched tight.",
      ],
      skipIfMissing: true,
    },
    {
      target: "play-clock",
      title: "In-world time",
      body: [
        "The calendar the world actually runs on — events fire when the clock reaches them, not after N turns. Tap to correct it when the bookkeeper drifts from the prose.",
      ],
    },
    {
      target: "tabs",
      title: "The other five screens",
      body: [
        "**Cast** — everyone, their traits, memories, bonds, and a raw editor. **World** — places, factions, clocks, canon, the relationship web. **Journal** — the record of your own turns. **Chronicle** — arcs, records, and what you're spending. **Tuning** — models, images, tension, and the world bible.",
        "Each of them explains itself the first time you open it.",
      ],
    },
    {
      target: "help",
      title: "This button, always",
      body: [
        "Brings this guide back on whatever screen you're on. Nothing here has to be remembered.",
      ],
    },
  ],

  /* ═══ CAST ═══ */
  cast: [
    {
      title: "The cast",
      body: [
        "Everyone the story is tracking. Tap a card to open a person.",
        "They are not descriptions — each carries memories with a time and a place, a stack of things they want, traits they're acquiring from what you do to them, and a private read of you that can be wrong.",
      ],
    },
    {
      target: "cast-add",
      title: "Add someone",
      body: [
        "Describe a person in a sentence and the engine builds them properly — history, traits, wants, voice — and walks them into the world.",
      ],
      skipIfMissing: true,
    },
    {
      target: "cast-list",
      title: "Following",
      body: [
        "The eye toggle on an open character puts them in the **long game**: offscreen they keep wanting things, finish goals and start new ones. Unfollowed bit-players recede into the background.",
        "Inside a character you'll also find **Their week** — a standing schedule (a shift, a watch, a market day). Give someone one and they leave when they have to, tell you they're free until five, and pay for the night that kept them.",
      ],
      skipIfMissing: true,
    },
    {
      target: "cast-gone",
      title: "The dead stay dead",
      body: [
        "People who died or left the story move here — out of every room, off the web, no new drives. You can bring anyone back by hand in their raw editor.",
      ],
      skipIfMissing: true,
    },
  ],

  /* ═══ WORLD ═══ */
  world: [
    {
      title: "The world",
      body: [
        "Places, factions and their clocks, live story threads, and canon — the public events every mind in the world remembers forever.",
      ],
    },
    {
      target: "world-web",
      title: "The relationship web",
      body: [
        "The whole cast as a graph with you at the centre. Green is warm, amber cool, red hostile; thickness is how strong the tie is. Tap a face to isolate their ties.",
        "An all-allies or an all-hostile cast shows up here instantly.",
      ],
      skipIfMissing: true,
    },
    {
      target: "world-clocks",
      title: "Clocks",
      body: [
        "Factions are working on things whether or not you're watching. A clock that fills, fires — and then it's in the world.",
      ],
      skipIfMissing: true,
    },
    {
      target: "world-places",
      title: "Places",
      body: [
        "Everywhere anyone can be, created the first time it's mentioned. Everyone has a real location, so walking somewhere moves you and naming a distant person doesn't summon them.",
      ],
      skipIfMissing: true,
    },
  ],

  /* ═══ JOURNAL ═══ */
  journal: [
    {
      title: "The journal",
      body: [
        "Every turn you've taken, as you typed it, with what the narrator wrote back. Useful for finding the moment you want to roll back to — and for seeing your own habits.",
      ],
    },
  ],

  /* ═══ CHRONICLE ═══ */
  chronicle: [
    {
      title: "The chronicle",
      body: [
        "The story read back to you: arcs, records, how the world's regime has been running, and who you've been in it.",
      ],
    },
    {
      target: "chron-spend",
      title: "What it costs",
      body: [
        "A running token breakdown — in, out, per-turn average, and which model is doing the narrating. It flags a premium narrator so a large bill can't sneak up on you.",
        "Weft counts tokens, not money; live billing is at openrouter.ai/activity.",
      ],
      skipIfMissing: true,
    },
  ],

  /* ═══ SETTINGS / TUNING ═══ */
  settings: [
    {
      title: "Tuning",
      body: [
        "Per-save settings. Nothing here is destructive and everything takes effect on the next turn.",
      ],
    },
    {
      target: "set-models",
      title: "Models",
      body: [
        "Four slots — the narrator writes the prose, the others do the bookkeeping and the small passes. Point them at OpenRouter or at a local server (KoboldCpp, llama.cpp, LM Studio, Ollama) and Weft never touches the cloud.",
        "**Tune this save for a local model** shrinks a turn to roughly 18k tokens so it fits a small context window.",
      ],
      skipIfMissing: true,
    },
    {
      target: "set-tension",
      title: "World tension (0–10)",
      body: [
        "How much the world throws at you. At **0 nothing new is ever introduced** — no fresh threats, threads, or clock moves; the world only answers what you do. 5 is the normal rhythm. High escalates fast and often.",
      ],
      skipIfMissing: true,
    },
    {
      target: "set-bible",
      title: "The world bible",
      body: [
        "Every rule of the world, editable. **God Mode** opens the raw JSON — bible, threads, clocks, places, edges, canon — so anything the forge over-baked can be fixed at turn 1.",
        "**Player overrides** below it lists what you've vetoed and what you've affirmed as law.",
      ],
      skipIfMissing: true,
    },
    {
      target: "set-images",
      title: "Pictures",
      body: [
        "Pick any image model for portraits and scene art — or a `local/…` id to paint on your own GPU for nothing. **Paint the scene every turn** turns the illustration from a button into something the story just does.",
        "A cloud image model is a few cents a message and will say so; a local one is free.",
      ],
      skipIfMissing: true,
    },
    {
      target: "set-art",
      title: "Art direction",
      body: [
        "Set the visual style once — *\"muted painterly chiaroscuro\"*, *\"90s cel anime\"*, *\"gritty photoreal\"* — and every picture obeys it.",
        "Portraits are read off the whole character, then fed back as reference when a scene is painted, so the cast keeps the same faces from turn to turn.",
      ],
      skipIfMissing: true,
    },
    {
      target: "set-guides",
      title: "The guides",
      body: [
        "Turn the automatic guides back on here, or replay them from the top. The **?** in the title bar works either way.",
      ],
      skipIfMissing: true,
    },
  ],
};
