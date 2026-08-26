/* Smoke test: A PERSON THE STORY CREATES IS ACTUALLY WRITTEN DOWN.
 *
 * A player wrote "I make myself another woman. Mable. She's more beautiful than Andrea. She's
 * loving. She cares for me. She's interesting. Charming." and read four paragraphs describing her.
 * The record that came out held a name, an age of 30, an empty appearance, empty core_traits,
 * empty values and an INCOMPLETE RECORD background. A voice card was forged for her — voice
 * forging is wired up — and nothing else was.
 *
 * Two causes. The scene footer split `new="Mable (a woman Rabi has just created, beautiful,
 * loving, and perceptive)"` on commas before reading the parenthetical, making three extra people
 * out of her description. And every creation site marks its stub `provisional: true` while
 * registerCharacter silently dropped the field, so no pass could ever tell a sketch from a person
 * and none ever finished one. */
import { newSave, registerCharacter } from "../src/engine/state";
import { parseSceneFooter, isPersonName } from "../src/engine/turn";
import { isSketch, pendingSketches, applySketch } from "../src/engine/sketch";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. the footer that produced 'beautiful', 'loving' and 'and perceptive)' */
{
  const created = parseSceneFooter(
    `prose <<<SCENE place="The Estate" new="Mable (a woman Rabi has just created, beautiful, loving, and perceptive)">`,
  ).footer?.created ?? [];
  check("one person, not four", created.length === 1, created);
  check("named Mable", created[0]?.name === "Mable", created[0]);
  check("her description survives as the gist, not as three people",
    created[0]?.gist === "a woman Rabi has just created, beautiful, loving, and perceptive", created[0]);
  for (const frag of ["beautiful", "loving", "and perceptive)"]) {
    check(`"${frag}" is not a person`, !isPersonName(frag));
  }
}

/* 2. provisional survives registration — it was dropped, so nothing could find a stub */
{
  const s = newSave("sketch", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, { name: "Mable", provisional: true, background: "INCOMPLETE RECORD — the narrator brought them into the story." } as any);
  check("the flag is stored", s.characters[id].provisional === true, s.characters[id].provisional);
  check("a stub is recognised as a stub", isSketch(s.characters[id]));
  check("it shows up as pending work", pendingSketches(s).includes(id));

  const real = registerCharacter(s, { name: "Andrea", appearance_facts: "Tall, blonde.", core_traits: ["focused"], background: "Made as his wife." } as any);
  check("a finished character is not a stub", !isSketch(s.characters[real]));
  check("the player is never a stub", !isSketch(s.characters["char_player"]));
  check("the dead are left alone", (() => {
    const d = registerCharacter(s, { name: "Ghost", provisional: true } as any);
    s.characters[d].status = "dead";
    return !isSketch(s.characters[d]);
  })());
}

/* 3. completion FILLS, and never overwrites what the story already established */
function stubState(): { s: SaveState; id: string } {
  const s = newSave("sketch", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, {
    name: "Mable", provisional: true, age: 30,
    background: "INCOMPLETE RECORD — the narrator brought them into the story at Day 1, 18:15.",
    speech_pattern: "Market-haggle vocabulary, coin and trade — clipped, transactional.",
  } as any);
  return { s, id };
}
{
  const { s, id } = stubState();
  const c = s.characters[id];
  applySketch(s, c, {
    age: 24, pronouns: "she/her",
    appearance_facts: "Dark hair in loose waves to the small of her back, grey-green eyes, an inch taller than Andrea.",
    height_cm: 178, weight_kg: 68,
    background: "Made by Rabi on the terrace, whole, out of nothing.",
    core_traits: ["watchful", "unimpressed by power", "privately amused"],
    values: ["being talked to as a person", "the quiet after a room empties"],
    speech_pattern: "SHOULD NOT OVERWRITE — a voice was already forged",
    texture: ["stands with her weight on one hip"],
    beauty: 92, conscience: 0.6, attracted_to: "men", taste: "restless, inventive men",
    attachment_style: "secure", under_threat: "goes very still and watches",
    drive_goals: ["Learn what Rabi actually wants", "Find something of her own that is not him"],
  });

  check("appearance is written from the prose", /grey-green eyes/.test(c.appearance_facts), c.appearance_facts);
  check("traits are written", c.core_traits.length === 3, c.core_traits);
  check("values are written", c.values.length === 2, c.values);
  check("the INCOMPLETE RECORD background is replaced", !/INCOMPLETE RECORD/.test(c.background), c.background);
  check("the already-forged voice is NOT overwritten", /Market-haggle/.test(c.speech_pattern), c.speech_pattern);
  check("beauty lands so the desire model can read her", c.beauty === 92);
  check("the registration-default age is treated as blank and filled", c.age === 24);
  check("she gets wants of her own, not only the player", (c.drive_queue ?? []).length === 1 && !!c.drive?.goal, c.drive);
  check("she is no longer a sketch", !isSketch(c) && c.provisional === undefined);
}

/* 4. an established fact is never contradicted, even by a confident completion */
{
  const s = newSave("sketch", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const id = registerCharacter(s, {
    name: "Doren", provisional: true, age: 51,
    appearance_facts: "Broad, grey-bearded, a scar through the left eyebrow.",
    core_traits: ["blunt"], values: ["his own authority"],
  } as any);
  const c = s.characters[id];
  applySketch(s, c, { age: 30, appearance_facts: "A slight young woman.", core_traits: ["timid"], values: ["safety"], beauty: 40 });
  check("an established appearance stands", /grey-bearded/.test(c.appearance_facts), c.appearance_facts);
  check("established traits stand", c.core_traits.join() === "blunt", c.core_traits);
  check("established values stand", c.values.join() === "his own authority", c.values);
  check("an explicitly set age stands", c.age === 51, c.age);
  check("a genuinely blank field is still filled", c.beauty === 40);
}

/* ── A PARTIAL COMPLETION IS STILL A SKETCH ───────────────────────────────────────
 *
 * The pass cleared `provisional` the moment it ran, whatever came back. A save carried a record
 * whose appearance_facts stop mid-phrase — "dark obsidian-brown eyes with sharp calculating" —
 * because the completion hit its token budget and safeJson salvaged only the keys that had
 * arrived. Everything after appearance_facts in the schema, background included, never landed.
 * The record was marked finished anyway, so nothing ever tried again, and a name scraped out of
 * one line of prose was carried for twenty-five turns as a person. */
{
  const s = newSave("sketch", { name: "V" } as any);
  const c = s.characters[registerCharacter(s, {
    name: "Nubian", provisional: true,
    background: "INCOMPLETE RECORD — entered the story at Day 1, 09:05 (Morning) without being declared.",
  } as any)!];

  // what actually came back: appearance only, cut off mid-word
  applySketch(s, c, { appearance_facts: "Deep dark brown skin, coiled black hair tightly braided against her scalp, dark obsidian-brown eyes with sharp calculating" });
  check("a truncated completion leaves the record provisional", c.provisional === true, c);
  check("and it still reads as a sketch, so the pass runs again", isSketch(c), c);

  // and the next attempt, which lands
  applySketch(s, c, {
    background: "Born on the river above Meroe, sold north at eleven, works the Tiber barges and knows their depths.",
    core_traits: ["counts the money twice", "will not stand with her back to a door"],
  });
  check("a completion that lands finishes the record", c.provisional === undefined, c);
  check("and it stops being a sketch", !isSketch(c), c);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
