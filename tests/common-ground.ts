/* Smoke test: WHAT TWO PEOPLE WOULD TALK ABOUT BEFORE THEY TALK ABOUT THE THING.
 *
 * "No indirectness. Nothing leading up to what she wants to talk about. There's a really interesting
 * background for her interests and absolutely nothing comes up."
 *
 * Both halves are one missing mechanism. The engine has always known what everybody WANTS — drive,
 * approach, blocker, handed to the narrator every turn — and had never once computed what two people
 * have in COMMON. So the only thing in front of the model with any weight was the want, and the want
 * is what got said. A seducer with a stated goal and no shared subject can only make passes.
 *
 * On the save this was written against: Rabi cannot leave a malfunctioning appliance alone and will
 * take it apart on a neighbour's kitchen table. Clara can spot a fake Eames chair across a flea
 * market. Same instinct — an eye for whether an object is honest about how it was made — and in 108
 * turns it never came up, because nothing put it in front of the narrator.
 *
 * Word overlap cannot find that: "circuit diagram" and "Eames chair" share no token. Domains can. */
import { commonGround, commonGroundNote, doorFor, profile } from "../src/engine/commonground";
import type { Identity, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* the two cards from the save, as written */
const RABI = {
  name: "Rabi",
  core_traits: ["Cannot leave a malfunctioning appliance alone; will take it apart on the kitchen table even if it belongs to a neighbor."],
  values: ["Intellectual honesty, even when it's uncomfortable."],
  texture: ["Always has a small, battered notebook for sketching circuit diagrams on the fly.", "Loves the smell of ozone after a thunderstorm."],
  skills: {
    "Electrical Engineering": "Expert. Can read a grid's stress points like a doctor reads a chart.",
    "Cooking": "Competent. Learned from his mother; finds the precise chemistry of it calming.",
  },
  background: "Rabi grew up the only child of two university professors in a house full of books and heated, loving debates.",
} as unknown as Identity;

const CLARA = {
  name: "Clara",
  core_traits: ["Always knows exactly where the best light is in any room."],
  values: ["Aesthetic beauty as a moral good."],
  texture: ["Obsessively collects mid-century modern ashtrays, though she doesn't smoke.", "Has a rescue greyhound named 'Architecture' who is as nervous and elegant as she is."],
  skills: {
    "Vintage Furniture Appraisal": "Expert. Can spot a fake Eames chair from across a flea market.",
    "Yoga": "Advanced. Uses it to keep her body a weapon.",
  },
  background: "Clara moved in next door two years ago after a bitter divorce from a tech executive.",
} as unknown as Identity;

/* ── 1. it finds the door that was actually there ────────────────────────────── */
{
  const shared = commonGround(CLARA, RABI);
  check("these two do have something in common", shared.length > 0, shared.length);
  check("and the strongest thing is how objects are made",
    shared[0]?.key === "make", shared.map((s) => s.key));
  check("her side of it is the furniture, off her own card",
    /ashtray|Eames|vintage/i.test(shared[0]?.mine ?? ""), shared[0]?.mine);
  check("his side is the circuits, off his",
    /circuit|engineer|appliance/i.test(shared[0]?.theirs ?? ""), shared[0]?.theirs);
}
{
  // a word-overlap approach returns nothing here — the reason domains exist
  const words = (c: Identity) => new Set(
    [...(c.texture ?? []), ...Object.keys(c.skills ?? {})].join(" ").toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const a = words(CLARA), b = words(RABI);
  check("plain word overlap would have found nothing", ![...a].some((w) => b.has(w)), [...a].filter((w) => b.has(w)));
}

/* ── 2. the false positives that showed up on the first real run ─────────────── */
{
  const p = profile(CLARA);
  check("a greyhound NAMED 'Architecture' is not an interest in architecture",
    !p.has("hand") || !/greyhound/i.test(p.get("hand")!.phrase), p.get("hand"));
  check("but the dog still registers as an animal", p.has("beast"), [...p.keys()]);
}
{
  const p = profile(RABI);
  check("reading a grid 'like a doctor reads a chart' is not an interest in medicine",
    !p.has("body"), p.get("body"));
  check("it is still an interest in how things are made", p.has("make"), [...p.keys()]);
}
{
  // background is three sentences of life story and brushes half the lexicon by accident
  const bare = { ...RABI, texture: [], skills: {}, core_traits: [], values: [] } as unknown as Identity;
  check("background alone contributes nothing", profile(bare).size === 0, [...profile(bare).keys()]);
}

/* ── 3. what the narrator is handed ──────────────────────────────────────────── */
const st = (chars: Record<string, Identity>) => ({ characters: chars } as unknown as SaveState);
{
  const s = st({ char_player: RABI, char_clara: CLARA });
  const note = commonGroundNote(s, "char_clara", "char_player");
  check("the note names both people", /CLARA/.test(note) && /Rabi/.test(note));
  check("it carries a real phrase from her card, not a summary",
    /ashtray|Eames/i.test(note), note.slice(0, 200));
  check("it says the want moves UNDER the subject rather than replacing it",
    /moves under it|approached rather than announced/.test(note));
  check("and forbids inventing a shared interest that is not on the cards",
    /do not invent/i.test(note));
  check("it does not order a topic change, which would just be a different rail",
    !/change the subject/i.test(note));
}
{
  // two people with nothing in common is real information, not a gap to paper over
  const stranger = { name: "Dov", texture: ["Keeps pigeons on the roof."], skills: { "Debt collection": "Expert." }, core_traits: [], values: [] } as unknown as Identity;
  const s = st({ char_player: RABI, char_dov: stranger });
  const note = commonGroundNote(s, "char_dov", "char_player");
  check("no shared ground is said plainly", /NOTHING OBVIOUS IN COMMON/.test(note), note.slice(0, 120));
  check("and the silence is offered as usable rather than as a problem", /small talk is work/.test(note));
  check("with the same ban on inventing one", /do not invent/i.test(note.toLowerCase()) || /Do not invent/.test(note));
}

/* ── 4. whose door ───────────────────────────────────────────────────────────── */
{
  const withDrive = { ...CLARA, drive: { goal: "get Rabi alone in her house this week", progress: 0, updated_turn: 1 } } as unknown as Identity;
  const s = st({ char_player: RABI, char_marcus: { ...RABI, name: "Marcus" } as Identity, char_clara: withDrive });
  const d = doorFor(s, ["char_marcus", "char_clara"]);
  check("the person whose want is aimed at the player gets the door", d?.speaker === "char_clara", d);
  check("and the listener is the player", d?.listener === "char_player", d);
}
{
  const s = st({ char_player: RABI, char_marcus: CLARA });
  check("with nobody aimed at them, whoever is present gets it", doorFor(s, ["char_marcus"])?.speaker === "char_marcus");
  check("an empty room gets no door", doorFor(s, []) === null);
  check("and the player alone is not a conversation", doorFor(s, ["char_player"]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
