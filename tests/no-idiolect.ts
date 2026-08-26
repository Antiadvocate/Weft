/* Smoke test: NOBODY IN THIS ENGINE HAS A VOICE OF THEIR OWN.
 *
 * An idiolect is one person's own way of using language — their diction, their sentence shapes,
 * their tics, the phrases they would never produce. This engine used to manufacture one for every
 * character and hand it to the narrator on every turn: a `voice` card of diction/syntax/rhythm/
 * tics/never_says/agenda/example_lines, a `speech_pattern` string beside it, a tail-sampled forge
 * pass whose whole job was to make each card unlike the others, a periodic refresh that rewrote
 * them, and half a dozen blocks of prompt telling the model to write everyone toward theirs.
 *
 * It is all gone. A voice signature written at creation is a caricature that a story then has to
 * carry for a hundred turns, and every mechanism above made it louder by repetition. What decides
 * a line now is the situation: what the speaker wants in the next minute, what they know, what
 * their body is doing, who can hear, and what their life has given them words for.
 *
 * This file is the ratchet. It fails if any of it comes back — in the state, in the prompts, or in
 * a save written before the change.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { newSave, registerCharacter, healCharacterTypes } from "../src/engine/state";
import { charCard, deriveDelivery, volatileDigest, NARRATOR_SYSTEM, FORGE_SYSTEM } from "../src/engine/prompts";
import { speakerAnchor } from "../src/engine/maxims";
import type { Condition, Identity } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** A stale save: a character carrying the whole old voice apparatus, exactly as it was stored. */
const STALE = {
  speech_pattern: "sensual-precise, the vocabulary of surfaces and touch used to talk around desire",
  voice: {
    diction: "sensual-precise, the vocabulary of surfaces and touch",
    syntax: "long tactile sentence, a comma splice of small sensations",
    rhythm: "drawn out, patient, wants you to lean in",
    tics: ["names the material"],
    never_says: ["anything about how she feels"],
    agenda: "to be leaned toward",
    example_lines: ["That grain is walnut, and it was never meant to hold a lamp that heavy."],
  },
  voice_refreshed_turn: 4,
};
const LEAKS = /sensual-precise|comma splice|lean in|names the material|how she feels|to be leaned toward|walnut/i;

const ident = (over: Partial<Identity> = {}): Identity => ({
  name: "Clara", age: 34, pronouns: "she/her",
  appearance_facts: "Copper-red hair in a sharp bob.",
  background: "Sells vintage furniture.",
  core_traits: ["Knows where the best light is."], values: ["Beauty as a moral good."],
  intelligence: "sharp", gregariousness: 0.6,
  ...(STALE as any),
  ...over,
} as unknown as Identity);
const cond = (relaxation = 0): Condition =>
  ({ psyche: { relaxation, mood: "level", active_states: [] }, injuries: [], conditions: [], fatigue: "rested", hunger: "fed" } as unknown as Condition);

/* ── 1. the forge that made them is gone, and nothing imports it ─────────────── */
{
  check("voiceforge.ts no longer exists", !existsSync("src/engine/voiceforge.ts"));
  const src = [...readdirSync("src/engine").map((f) => join("src/engine", f)), "src/lib/api.ts"]
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(f, "utf8")).join("\n");
  check("nothing imports it", !/from "[^"]*voiceforge"/.test(src));
  check("and no pass forges or refreshes a voice", !/\b(forgeVoice|forgeCastVoices|refreshVoice|refreshStaleVoices)\s*\(/.test(src));
}

/* ── 2. the character record carries none of it, even from an old save ───────── */
{
  const s = newSave("t", { name: "V" } as any);
  const id = registerCharacter(s, { name: "Clara", age: 34, ...(STALE as any) } as any);
  const c: any = s.characters[id];
  check("registration drops speech_pattern", c.speech_pattern === undefined, c.speech_pattern);
  check("...and the voice card with it", c.voice === undefined, c.voice);

  // a save written before the change, loaded now
  Object.assign(c, STALE);
  healCharacterTypes(s);
  check("a stale save is scrubbed on load: speech_pattern", !("speech_pattern" in c));
  check("...voice", !("voice" in c));
  check("...and the refresh bookkeeping", !("voice_refreshed_turn" in c));
}

/* ── 3. none of it reaches the narrator, even when handed in ─────────────────── */
{
  const card = charCard("char_clara", ident(), cond(), []);
  check("the character card carries no voice at all", !LEAKS.test(card), card);
  check("...and does not print a Voice: field", !/\bVoice:/.test(card), card);
}
{
  const line = deriveDelivery(ident(), cond(0), []);
  check("a person under no pressure gets no delivery line at all", line === "", line);
  check("nothing from the stale card leaks into it", !LEAKS.test(line), line);
}
{
  // what IS left is situational, and all of it moves turn to turn
  const calm = deriveDelivery(ident(), cond(8), []);
  const clenched = deriveDelivery(ident(), cond(-9), []);
  check("a settled body and a braced one still differ", calm !== clenched && !!clenched);
  check("and the braced one says so", /clenched/.test(clenched), clenched);
  const warm = deriveDelivery(ident(), cond(), [], { warmth: 60, trust: 20 });
  const cold = deriveDelivery(ident(), cond(), [], { warmth: -50, trust: -50 });
  check("who they are talking to still changes it", warm !== cold && !!warm);
  check("a learned trait still colours what they say",
    /Boundary-eroding/.test(deriveDelivery(ident(), cond(), [{ label: "Boundary-eroding possessiveness", intensity: 7, behavioral_impact: "presses" }])));
}
{
  const s: any = newSave("t", { name: "V" } as any);
  s.world.places["loc_inn"] = { id: "loc_inn", name: "The inn", description_facts: "Smoke.", contains: [] };
  s.world.player_location = "loc_inn";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const m = registerCharacter(s, { name: "Clara", age: 34, background: "Sells vintage furniture.", core_traits: ["Counts twice"] } as any);
  Object.assign(s.characters[m], STALE);          // as a pre-change save would arrive
  s.characters[m].location = "loc_inn";
  s.world.present = ["char_player", m];
  const digest = volatileDigest(s, "");
  check("nothing from a stale card reaches the per-turn digest", !LEAKS.test(digest), digest.slice(0, 400));
  check("the speech block says outright that nobody has a voice",
    /NOBODY HERE HAS A VOICE OF THEIR OWN/.test(digest));
  const anchor = speakerAnchor(s, [m]);
  check("nor the block that sits next to the request to write", !LEAKS.test(anchor), anchor);
}

/* ── 4. no prompt asks for one, or tells the model to write toward one ───────── */
{
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  for (const field of ["speech_pattern", "example_lines", "never_says", '"tics"']) {
    check(`no prompt still specifies ${field}`, !prompts.includes(field));
  }
  const model = NARRATOR_SYSTEM + "\n" + FORGE_SYSTEM;
  check("the narrator is told nobody has a voice of their own",
    /NOBODY HAS A VOICE OF THEIR OWN TO WRITE TOWARD/.test(model));
  check("...and the forge is told not to author one", /voices: nobody gets one/.test(model));
  check("no instruction asks for a tic", !/\ba listed tic\b|\btic \(/.test(model));
  check("no instruction points at a sample of anybody's speech",
    !/THE QUOTED LINES UNDER EACH NAME/.test(model));
  check("and the swap test is gone with the doctrine it enforced",
    !/could be swapped between the people who said them/.test(model));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
