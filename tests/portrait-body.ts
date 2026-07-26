/* Smoke test: portrait body plan — non-human characters must not be painted as people.
 * The image model never sees our state; the prompt is the whole game. The prompt must not
 * assert personhood for a character whose body isn't a whole person — whether that's a
 * flower, an insect, a tree, an orb, or literally just a hand. */
import { newSave, registerCharacter, blankCondition } from "../src/engine/state";
import { buildPortraitPrompt } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

function makeState(): SaveState {
  return newSave("portrait-test", {
    name: "Test World", era: "far future", technology_level: "mixed", magic_rules: "none",
    forbidden: "", what_people_fear: "nothing", cultures_and_languages: "english",
    climate_and_geography: "mild", calendar_and_currency: "standard", political_situation: "stable",
  } as any);
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const NOT_PERSON = "not an ordinary person";
const PERSON = "a person caught being themselves";

/* 1. ordinary human → humanoid framing, no anti-person directive */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Mara Voss", age: 54,
    appearance_facts: "a wiry woman in her fifties, grey eyes, close-cropped hair, sun-lined skin",
    background: "a retired cartographer",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("human: person framing kept", p.includes(PERSON));
  check("human: full-body head-to-toe composition", p.includes("head to toe"));
  check("human: no not-a-person directive", !p.includes(NOT_PERSON));
}

/* 2. canon species, invented word, flower body → non-person framing + canon gloss */
{
  const s = makeState();
  s.world.canon.push("Leptoids are giant flowers with silver petals and a slow, patient intelligence.");
  const id = registerCharacter(s, {
    name: "Vel", age: 30,
    appearance_facts: "A giant flower: silver petals in a tight spiral, a thick ribbed stem, roots coiled around a pot of dark soil.",
    background: "a leptoid botanist",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("flower: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 300));
  check("flower: canon gloss supplied", p.includes("Leptoids — giant flowers with silver petals"), p.slice(0, 400));
  check("flower: no human body requests", !p.includes("what their hands do") && !p.includes("head to toe") && !p.includes("viewer"));
  check("flower: appearance still leads", p.indexOf("Appearance:") < p.indexOf("Vertical portrait"), p.slice(0, 200));
}

/* 3. alien species that looks human → humanoid branch wins on anchors */
{
  const s = makeState();
  s.world.canon.push("Aelari are an ancient people known for their long memories.");
  const id = registerCharacter(s, {
    name: "Seth", age: 41,
    appearance_facts: "a tall man with silver-streaked hair and sharp cheekbones",
    background: "an aelari scholar",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("human-looking alien: humanoid framing", p.includes(PERSON), p.slice(0, 300));
  check("human-looking alien: no not-a-person directive", !p.includes(NOT_PERSON));
}

/* 4. negations are scrubbed: "no face, no hands, no eyes" must not read as human anatomy */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Bloom", age: 12,
    appearance_facts: "Silver petals in a tight spiral over a ribbed stem; no face, no hands, no eyes.",
    background: "a walking bloom",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("negated anatomy: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 300));
}

/* 5. no canon, no anchors → still non-person, just without a gloss */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "The Orb", age: 300,
    appearance_facts: "a sphere of black glass, warm to the touch, humming faintly",
    background: "an artifact that thinks",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("anchor-less: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 300));
}

/* 6. mood line adapts to the body plan */
{
  const s = makeState();
  const human = registerCharacter(s, {
    name: "Ivo", age: 28, appearance_facts: "a broad man with a broken nose and kind eyes", background: "a dockworker",
  } as any);
  const plant = registerCharacter(s, {
    name: "Fern", age: 9, appearance_facts: "a spray of green fronds in a clay pot", background: "a potted companion",
  } as any);
  s.condition[human] = blankCondition();
  s.condition[human].psyche.mood = "calm";
  s.condition[plant] = blankCondition();
  s.condition[plant].psyche.mood = "calm";
  const ph = buildPortraitPrompt(s, human);
  const pp = buildPortraitPrompt(s, plant);
  check("human mood: expression language", ph.includes("Expression carries: calm"));
  check("non-human mood: form language", pp.includes("Current state: calm"), pp.slice(0, 400));
}

/* 7. insect alien with canon gloss — "eyes" in the description must not force personhood */
{
  const s = makeState();
  s.world.canon.push("Vess are mantis-like insects the size of a child, with chitin plates and compound eyes.");
  const id = registerCharacter(s, {
    name: "Kik", age: 7,
    appearance_facts: "a mantis-like insect with compound eyes and iridescent chitin plates",
    background: "a vess scout",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("insect: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 400));
  check("insect: canon gloss supplied", p.includes("Vess — mantis-like insects"), p.slice(0, 400));
}

/* 8. literally just a hand — human-derived, but not a person */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Thing", age: 40,
    appearance_facts: "a disembodied human hand, pale and quick, with old scars across the knuckles",
    background: "a helpful companion",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("the hand: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 400));
  check("the hand: kind gloss from declaration", p.includes("disembodied human hand"), p.slice(0, 400));
  check("the hand: no full-person composition", !p.includes("head to toe"), p.slice(0, 200));
}

/* 9. a tree */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Old Root", age: 400,
    appearance_facts: "a great oak with gnarled bark and a hollow at its base",
    background: "the oldest living thing in the valley",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("tree: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 300));
}

/* 10. abstract / spectral — signal word forces non-person even with "figure" */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "The Guest", age: 999,
    appearance_facts: "a spectral figure in dark robes, translucent at the edges",
    background: "something that visits",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("spectral: not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 300));
}

/* 11. human regressions: roles and feature-lists and metonyms stay persons */
{
  const s = makeState();
  const soldier = registerCharacter(s, {
    name: "Dain", age: 33, appearance_facts: "a soldier with grey eyes and a scarred jaw", background: "a veteran",
  } as any);
  const features = registerCharacter(s, {
    name: "Petra", age: 27, appearance_facts: "tall, freckled, with a crooked grin", background: "a messenger",
  } as any);
  const metonym = registerCharacter(s, {
    name: "Hale", age: 60, appearance_facts: "a firm handshake and an easy smile", background: "a neighbor",
  } as any);
  check("role declaration: person", buildPortraitPrompt(s, soldier).includes(PERSON), buildPortraitPrompt(s, soldier).slice(0, 300));
  check("feature list: person", buildPortraitPrompt(s, features).includes(PERSON), buildPortraitPrompt(s, features).slice(0, 300));
  check("metonym: person", buildPortraitPrompt(s, metonym).includes(PERSON), buildPortraitPrompt(s, metonym).slice(0, 300));
}

/* 12. empty appearance → human default (most characters are people) */
{
  const s = makeState();
  const id = registerCharacter(s, { name: "Noel", age: 45, background: "a quiet clerk" } as any);
  const p = buildPortraitPrompt(s, id);
  check("empty appearance: human default", p.includes(PERSON));
}

/* 13. explicit "Not a human" LEADING the description — the reported failure */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Lefty", age: 40,
    appearance_facts: "Not a human. A severed foot, pale, with crooked toes.",
    background: "a helpful companion",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("leading 'not a human': not-a-person directive present", p.includes(NOT_PERSON), p.slice(0, 400));
  check("leading 'not a human': declaration gloss harvested", p.includes("severed foot"), p.slice(0, 400));
}

/* 14. explicit statement ANYWHERE, even with anatomy words that would otherwise force a person */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Stepper", age: 12,
    appearance_facts: "rough skin, crooked toes, a thick sole — not a human",
    background: "a companion",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("trailing 'not a human' beats 'skin': not-a-person directive", p.includes(NOT_PERSON), p.slice(0, 400));
}

/* 15. explicit statement in the BACKGROUND also counts */
{
  const s = makeState();
  const id = registerCharacter(s, {
    name: "Padfoot", age: 5,
    appearance_facts: "a leathery foot with flat toes",
    background: "not a human",
  } as any);
  const p = buildPortraitPrompt(s, id);
  check("'not a human' in background: not-a-person directive", p.includes(NOT_PERSON), p.slice(0, 400));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
