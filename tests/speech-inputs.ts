/* Smoke test: THE FIVE QUESTIONS HAVE TO HAVE ANSWERS IN FRONT OF THEM.
 *
 * The dialogue procedure tells the narrator to build a line out of what the speaker wants in the
 * next minute, what they know, what their body is doing, who can hear, and what their life has
 * given them words for. Four of those five need FIELDS, and the block the model reads immediately
 * before writing — "HOW THESE PEOPLE SPEAK", deliberately placed last so it is nearer than the
 * model's own drifting prose — used to carry a name, a diction note and three sample lines.
 * Nobody has a stored voice at all any more; a save written before that change may still have one
 * on disk, so the fixture below hands one in and the block has to ignore every part of it.
 *
 * So: no age. No background (rendered for the player only, never for an NPC). No era, no culture,
 * no technology level. Mood and body existed, hundreds of lines further up, past everything else in
 * the digest. The model was answering "what would this person say" from three sample lines and its
 * own defaults, which is precisely what a player sees as a cast who all sound the same age, from
 * nowhere in particular, unaffected by anything that has happened to them.
 *
 * The block also ended by asserting a vocabulary — cattle, weather, iron, kin, debt, God, work —
 * over every world this engine can build. A story set on a station or in a suburb got told its
 * people speak in cattle and God. What a world contains is recorded in its bible; it is read from
 * there now, and the assertions below fail if it goes back to being hardcoded.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** A room, a world, and one woman with a life. */
function fixture(over: Record<string, unknown> = {}, bible: Record<string, unknown> = {}) {
  const s: any = newSave("t", { name: "Rabi" } as any);
  Object.assign(s.world_bible, {
    era: "Roman Italy, 50 BC — the Alban Hills above Bovillae",
    technology_level: "Iron, oxen, oil lamps, no glass windows. Water is carried.",
    cultures_and_languages: "Latin in the town, Oscan among the older hill families.",
    ...bible,
  });
  s.world.places["loc_inn"] = { id: "loc_inn", name: "The inn", description_facts: "Smoke.", contains: [] };
  s.world.player_location = "loc_inn";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const m = registerCharacter(s, {
    name: "Lucia", age: 52,
    background: "Born in the hills to a family that lost its land two generations back. Runs the inn since her husband died.",
    core_traits: ["Counts everything twice"],
    voice: {
      diction: "short, priced, transactional",
      example_lines: ["Two sestertii is high for bread that needs trimming.", "The fifteenth. Not the sixteenth."],
      never_says: ["anything about how she feels"],
    },
    ...over,
  } as any);
  s.characters[m].location = "loc_inn";
  s.world.present = ["char_player", m];
  return { s, m };
}
const anchor = (s: any) => {
  const ctx = volatileDigest(s, "");
  const i = ctx.indexOf("=== HOW THESE PEOPLE SPEAK");
  return i < 0 ? "" : ctx.slice(i);
};

/* ── 1. the four fields the procedure asks for are actually printed ──────────── */
{
  const { s, m } = fixture();
  s.characters[m].life_history = "She turned away a traveller who could not pay. The roof leaked in the night.";
  s.condition[m].psyche.mood = "tired and short with people";
  s.condition[m].fatigue = "exhausted";
  const a = anchor(s);

  check("the block exists at all", a.length > 0);
  check("AGE — a fifty-two-year-old is not an ageless one", /Lucia, 52/.test(a), a.slice(0, 400));
  check("THE LIFE — an NPC's background reaches the narrator now", /lost its land two generations back/.test(a));
  check("CURRENT STATE — the mood is adjacent to the line, not 300 lines up", /tired and short with people/.test(a));
  check("...and the body with it", /exhausted/.test(a), a);
  check("HISTORY — what has happened to her lately", /roof leaked in the night/.test(a));
  check("their traits are here too", /Counts everything twice/.test(a));
  check("with the instruction to build from all of it", /BUILD EACH LINE OUT OF WHAT IS PRINTED UNDER THAT SPEAKER/.test(a));
  check("and age called out as load-bearing", /AGE IS NOT DECORATION/.test(a));
  // NO SAMPLE LINES AT ALL. Three short exemplars per person taught the entire cast to answer in
  // fragments: a sample of a voice is always compressed, so "match this" reads as "never write
  // anyone a long sentence" — and a clipped weighty fragment is the shape of an aphorism.
  check("and NO sample line is handed over", !/bread that needs trimming|The fifteenth/.test(a), a);
  check("...nor a manner of speaking, from a stale card or anywhere else",
    !/short, priced, transactional|Would never say|how she feels/.test(a), a);
  check("...and the block says outright that nobody has one",
    /NOBODY HERE HAS A VOICE OF THEIR OWN/.test(a), a);
  check("length is named as a property of the moment, not the person",
    /HOW MUCH SOMEBODY SAYS IS NOT A PROPERTY OF THE PERSON/.test(a));
  check("a uniformly terse cast is called out as one person",
    /A CAST WHERE EVERYONE IS BRIEF IS A CAST WITH ONE PERSON IN IT/.test(a));
}

/* ── 2. the world's own words, from the bible, not from one setting ──────────── */
{
  const { s } = fixture();
  const a = anchor(s);
  check("the era is in front of the model when it writes speech", /Roman Italy, 50 BC/.test(a));
  check("so is what exists to be named", /oil lamps/.test(a));
  check("so is how people here address each other", /Oscan among the older hill families/.test(a));
  check("and the rule about it names no specific world", /Nobody names a thing this world does not contain/.test(a));

  // THE POINT OF THE ABOVE: a different world produces different words, with nothing hardcoded.
  const { s: s2 } = fixture({}, {
    era: "A mining station in the belt, 2189",
    technology_level: "Vacuum, printed food, no gravity outside the ring. Everything is metered.",
    cultures_and_languages: "Company Standard on shift, family tongues off it.",
  });
  const a2 = anchor(s2);
  check("a station gets its own era", /mining station in the belt/.test(a2));
  check("and its own things to name", /printed food/.test(a2));
  check("and is told nothing about cattle, iron, kin, debt or God",
    !/cattle|kin, debt|iron, kin/i.test(a2), a2.slice(0, 600));
  check("nor handed four modern lines it must not write",
    !/that's not fair to you|not a strategy/i.test(a2));
}

/* ── 3. the state overrides the recording, rather than losing to it ──────────── */
{
  const { s, m } = fixture();
  s.condition[m].psyche.mood = "frightened";
  const a = anchor(s);
  check("the precedence is stated", /AND THE STATE OVERRIDES THE PERSON/.test(a));
  check("with what it does to the sentences", /repeats themselves, stops halfway/.test(a));
}

/* ── 4. a character with no recorded lines is not dropped from the block ─────── */
{
  const { s, m } = fixture({ voice: {} });
  s.condition[m].psyche.mood = "wary";
  const a = anchor(s);
  check("someone with nothing recorded about their speech still appears", /Lucia, 52/.test(a), a.slice(0, 500));
  check("...with the life the narrator would otherwise invent", /lost its land two generations back/.test(a));
  check("...and their state", /wary/.test(a));
  check("...and their traits", /Counts everything twice/.test(a));
}

/* ── 5. it survives the token-budget step-down; this is the last thing read ──── */
{
  const { s, m } = fixture();
  s.characters[m].life_history = "She turned away a traveller who could not pay.";
  const trimmed = volatileDigest(s, "", { budgetOverride: 900 });
  const i = trimmed.indexOf("=== HOW THESE PEOPLE SPEAK");
  check("the speech block is not the thing that gets cut", i >= 0);
  check("age survives the trim", /Lucia, 52/.test(trimmed.slice(i)));
  check("and it is still the last block before generation",
    trimmed.slice(i).length < 3200, trimmed.slice(i).length);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
