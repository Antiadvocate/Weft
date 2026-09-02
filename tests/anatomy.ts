/* THE BODY THE RECORD GAVE HER, AND THE ONE THE NARRATOR KEPT SUPPLYING INSTEAD.
 *
 * "The ai has done this multiple times where because it's a transwoman gives her a vagina by
 *  default. In fact a lot of times."
 *
 * Emily's record says it in the player's own words, in four separate places: "She never had bottom
 * surgery and is comfortable with her body", "She loves her feet and her penis", "she only has sex
 * with Rabi by penetrating him", and — as an authored drive typed by hand — "Tries to force her
 * penis into Rabi's urethra." Turn 7 of the shower save:
 *
 *     She shifts her weight, lifts one foot up onto the edge of the tub, opening herself to the
 *     steam and the spray, and her fingers part the wet hair between her legs.
 *
 * The player corrected it the following turn by typing "I take her cock in my mouth". And the error
 * does not stay on the page: the bookkeeper files what the narrator wrote, so her life_history now
 * permanently carries "I lifted my foot up and opened myself for him" — the mistake becomes the
 * record and teaches the next turn. That is the "a lot of times".
 *
 * Two rules already say the right thing and neither fires: FINAL CHECK 15 ("only the anatomy the
 * record gives it") and the CANON OVERRIDES YOUR DEFAULTS block, both written for non-human bodies
 * and both general. The engine's own negative-canon field explains why general is not enough, in
 * the sentence this module is built on: "Absence cannot be inferred from description ... So state
 * it outright." That was applied at world scale and to non-humanoids, never to a human body whose
 * configuration is not the one its category name implies.
 *
 * THE PART OF THIS TEST THAT MATTERS MOST is section 2. The module reads the RECORD and nothing
 * else. It never reasons from "trans woman", "woman", "man" or any other category to a body — a
 * record that names no anatomy produces no statement and enforces nothing. Substituting a category
 * default for what the player wrote is the entire bug; doing it in the other direction would be the
 * same bug wearing a different hat.
 */
import { readAnatomy, anatomyNote, findAnatomyBreach, anatomyFix } from "../src/engine/anatomy";
import type { SaveState, Identity } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/anatomy-save.json", "utf8")) as {
  characters: Record<string, Identity>; canon: string[]; prose: Record<string, string>;
};
const EMILY = "char_mtggvs9t2dhp3";
const save = (present = ["char_player", EMILY]): SaveState => ({
  characters: FIX.characters,
  world: { canon: FIX.canon, present },
} as unknown as SaveState);

/* ── 1. the real record, read correctly ──────────────────────────────────────── */
{
  const rec = readAnatomy(save(), EMILY, FIX.characters[EMILY]);
  check("Emily's record is read", !!rec, rec);
  check("...as having a penis", rec?.has.includes("penis") ?? false, rec);
  check("...and nothing else of the kind", rec?.lacks.includes("vulva") ?? false, rec);
  check("...quoting the sentence the player wrote to settle it",
    /never had bottom surgery/i.test(rec?.evidence ?? ""), rec?.evidence);

  const note = anatomyNote(rec, "Emily", FIX.characters[EMILY].pronouns);
  check("the card carries the negative in plain words", /no vagina, no vulva, no labia, no clitoris/.test(note));
  check("...in every register, not just the clinical one", /clitoris/.test(note) && /penetrate, part, spread or be wet/.test(note));
  check("...names the default it exists to catch", /that default is WRONG HERE/.test(note), note);
  check("...and obeys her printed pronouns", /on her body/.test(note) && !/on their body/.test(note), note);
  check("...including the subject form", !/how her is dressed/.test(note), note);
}

/* ── 2. IT NEVER REASONS FROM A CATEGORY TO A BODY ───────────────────────────── */
{
  const mk = (background: string, name = "Sam"): SaveState => ({
    characters: { char_x: { name, pronouns: "she/her", background, core_traits: [], values: [] } },
    world: { canon: [], present: ["char_player", "char_x"] },
  } as unknown as SaveState);

  for (const bg of [
    "She is a trans woman who moved here from Portland.",
    "She is a trans woman who had bottom surgery years ago.",
    "She is a cis woman with two children.",
    "He is a trans man and a carpenter.",
    "They are intersex and have never discussed it with anyone.",
    "A woman of forty who runs the bakery on the corner.",
  ]) {
    const st = mk(bg);
    check(`says nothing about a record that names no anatomy: "${bg.slice(0, 42)}…"`,
      readAnatomy(st, "char_x", st.characters.char_x) === null);
  }

  // ...and when the record DOES name it, that is what it reports — in either direction.
  const withVulva = mk("She is a trans woman. She had bottom surgery and loves her vulva.");
  const rv = readAnatomy(withVulva, "char_x", withVulva.characters.char_x);
  check("a record naming a vulva reports a vulva", rv?.has.includes("vulva") ?? false, rv);
  check("...and denies the other part, symmetrically", rv?.lacks.includes("penis") ?? false, rv);

  const both = mk("She has both a penis and a vulva; she is intersex and says so plainly.");
  const rb = readAnatomy(both, "char_x", both.characters.char_x);
  check("a record naming both denies nothing", rb !== null && rb.lacks.length === 0, rb);
  check("...and produces no card line at all", anatomyNote(rb, "Sam", "she/her") === "");
}

/* ── 3. whose part is it — the record is full of other people's bodies ───────── */
{
  // Rabi's own core trait is "Loves Emily's cock, fondly nuzzles it", and the canon line "Emily
  // loves her feet and her penis" names him in its second clause. Neither is about HIS body.
  const rec = readAnatomy(save(), "char_player", FIX.characters.char_player);
  check("Rabi's record is not read off Emily's anatomy", rec === null, rec);

  const partner = {
    characters: {
      char_player: { name: "Rabi" },
      char_a: { name: "Ada", pronouns: "she/her", core_traits: ["Adores Rabi's cock."], values: [], background: "" },
    },
    world: { canon: [], present: ["char_player", "char_a"] },
  } as unknown as SaveState;
  check("a character described only by what they love about a PARTNER gets no statement",
    readAnatomy(partner, "char_a", partner.characters.char_a) === null);
}

/* ── 4. the breach detector, on the eleven turns as written ──────────────────── */
{
  const st = save();
  const hit7 = findAnatomyBreach(st, FIX.prose["7"]);
  check("turn 7 is caught", !!hit7, hit7);
  check("...on the sentence that did it", /opening herself/.test(hit7?.sentence ?? ""), hit7);
  check("...as a vulva that is not there", hit7?.part === "vulva", hit7);

  // The euphemism is the whole point: the word "vagina" appears nowhere in that turn.
  check("the turn never used the explicit word", !/vagin|vulva|clit|labia/i.test(FIX.prose["7"]));

  for (const t of ["6", "8", "9"]) {
    check(`turn ${t} is clean — and it is full of correctly-written anatomy`,
      findAnatomyBreach(st, FIX.prose[t]) === null, findAnatomyBreach(st, FIX.prose[t]));
  }
  check("turn 9 really does name the right part", /my cock/i.test(FIX.prose["9"]));

  const fix = anatomyFix(hit7);
  check("the correction voids the sentence rather than retconning it in the fiction",
    /That sentence is void/.test(fix) && /do not write a scene explaining it/.test(fix));
  check("...uses her pronouns correctly", /DOES NOT GIVE HER/.test(fix) && !/how her is dressed/.test(fix), fix);
  check("...and covers every register", /the clinical word, the affectionate word and the crude word/.test(fix));
}

/* ── 5. not a rubber stamp ───────────────────────────────────────────────────── */
{
  const st = save();
  check("ordinary prose about her is not a breach",
    findAnatomyBreach(st, "Emily stood at the counter with her hands around the mug and did not look up.") === null);
  check("an emotional 'opened herself' outside a body scene is not a breach",
    findAnatomyBreach(st, "She opened herself to the idea, slowly, over the course of a year.") === null);
  check("...but the same phrase in a body scene is",
    findAnatomyBreach(st, "Her hands were wet and she was opening herself against his mouth.") !== null);
  check("a third party's anatomy in the same room is not charged to her",
    findAnatomyBreach({ ...save(["char_player", EMILY, "char_o"]),
      characters: { ...FIX.characters, char_o: { name: "Nadia", pronouns: "she/her" } as Identity },
    } as unknown as SaveState, "Nadia's vulva was none of Emily's business.") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
