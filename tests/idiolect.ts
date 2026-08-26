/* Smoke test: THE VOICE IS A MOVE THEY MAKE, NOT A LINE THEY HAVE.
 *
 * "The way it was doing it by hitting the example lines continuously was a pain in the ass. But
 *  unique characterization should be noticeable. I don't want my characters to sound the same."
 *
 * Both halves are real and they pull against each other, which is why this file exists.
 *
 * The voice forge stays. It is the only thing in the engine that actually makes two characters
 * sound unalike — instruction-following cannot move a distribution, and one tail-sampled call per
 * character can, which is the whole argument in voiceforge.ts.
 *
 * What it stops producing is example_lines. A sample of a voice is not a description of one: it is
 * a finished sentence sitting in the narrator's context, and a model reuses a finished sentence
 * rather than matching it. maxims.ts printed one immediately before "now write the scene", every
 * single turn, which is the most reliable way this engine has ever found to make something repeat.
 * The same handful of lines came back for a hundred turns and the cast read as broken records.
 *
 * The replacement is the IDIOLECT — the person's own way of using language, NAMED. A non-linear
 * visualiser. A reassuring interrupter. A name cannot be pasted into a scene; it has to be
 * performed onto whatever is actually happening, which is a different sentence every time. The
 * culture and persona the sample lines used to showcase moved to `diction`, which is the field
 * that was always doing that work.
 *
 * So: the voice must REACH the narrator (or nothing sounds like anyone), and nothing quotable may.
 */
import { readFileSync } from "fs";
import { newSave, registerCharacter, healCharacterTypes } from "../src/engine/state";
import { charCard, volatileDigest, NARRATOR_SYSTEM, FORGE_SYSTEM } from "../src/engine/prompts";
import { voiceAnchor } from "../src/engine/maxims";
import { voiceSummary } from "../src/engine/voiceforge";
import type { Condition, Identity } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const VOICE = {
  idiolect: "a non-linear visualiser",
  idiolect_shows: "starts from the picture the question put in her head and works back to the question, sometimes",
  diction: "the loom and the dye-house; warp, selvedge, mordant, the weight of wet wool",
  syntax: "long, comma-spliced, the verb arriving late",
  rhythm: "runs several sentences together, then stops without warning",
  tics: ["checks whether you followed before going on"],
  never_says: ["anything that states her own feeling outright"],
  agenda: "to keep the conversation on something she can put her hands on",
};
/** The sample line a pre-change save still has on disk. Nothing may ever print it. */
const STALE_SAMPLE = "Two sestertii is high for bread that needs trimming.";

const ident = (over: Partial<Identity> = {}): Identity => ({
  name: "Lucia", age: 52, pronouns: "she/her",
  appearance_facts: "Grey hair pinned with a bone needle.",
  background: "Runs the dye-house her mother ran.",
  core_traits: ["Counts everything twice"], values: ["Debts paid on the day"],
  intelligence: "sharp", gregariousness: 0.6,
  speech_pattern: voiceSummary(VOICE),
  voice: { ...VOICE, example_lines: [STALE_SAMPLE] } as any,
  ...over,
} as unknown as Identity);
const cond = (relaxation = 0): Condition =>
  ({ psyche: { relaxation, mood: "level", active_states: [] }, injuries: [], conditions: [], fatigue: "rested", hunger: "fed" } as unknown as Condition);

/* ── 1. the forge still exists and still names a voice ───────────────────────── */
{
  const vf = readFileSync("src/engine/voiceforge.ts", "utf8");
  check("the voice forge is still here", vf.length > 2000);
  check("it still samples the tails, which is the only thing that moves a distribution",
    /Sample from the TAILS/.test(vf) && /TAIL = 0\.10/.test(vf));
  check("it still runs one call per character", /ONE CALL PER CHARACTER/.test(vf));
  check("the idiolect is what it is asked for", /THE IDIOLECT IS THE CARD/.test(vf));
  check("and it is forbidden to write a line of dialogue", /WRITE NO DIALOGUE/.test(vf));
  check("no field of the card is called example_lines any more",
    !/"example_lines"|example_lines:\s*string/.test(vf), vf.match(/.{0,60}example_lines.{0,60}/g));
}

/* ── 2. the summary a card is stored as leads with the idiolect ──────────────── */
{
  const sum = voiceSummary(VOICE);
  check("the stored voice leads with the name of the move", sum.startsWith("a non-linear visualiser — "), sum);
  check("...and carries the words their life gave them", /warp, selvedge, mordant/.test(sum));
  check("an empty card summarises to nothing rather than a stray full stop", voiceSummary({}) === "" && voiceSummary(undefined) === "");
}

/* ── 3. THE VOICE REACHES THE NARRATOR. This is the half that must not regress. */
{
  const anchor = voiceAnchor({ characters: { a: ident() as any } }, ["a"]);
  check("the block nearest generation carries the idiolect", /HOW THEY TALK: a non-linear visualiser/.test(anchor), anchor);
  check("...with what it does to her sentences", /works back to the question/.test(anchor));
  check("...and the vocabulary her life gave her", /warp, selvedge, mordant/.test(anchor));
  check("...and what she would never produce", /Would never say: anything that states her own feeling/.test(anchor));
  // ONCE, not twice: voiceSummary writes the idiolect into speech_pattern, so the card must not
  // then restate it in a clause of its own — that is the duplication this card was already cured of
  const card = charCard("char_l", ident(), cond(), []);
  check("the card in the cached prefix carries it exactly once",
    (card.match(/a non-linear visualiser/g) ?? []).length === 1, card.slice(0, 320));
  check("...and frames it as a move to perform rather than a phrase", /never a fixed phrase/.test(card));
  check("...without a doubled full stop where the summary ends", !/\.\.\s/.test(card), card);
}
{
  // two people, two moves — the thing the forge exists to produce
  const other = ident({
    name: "Marcus", age: 19,
    voice: { idiolect: "a reassuring interrupter", diction: "the water queue and the temple steps" } as any,
  });
  const anchor = voiceAnchor({ characters: { a: ident() as any, b: other as any } }, ["a", "b"]);
  check("two present speakers arrive with different moves",
    /a non-linear visualiser/.test(anchor) && /a reassuring interrupter/.test(anchor), anchor);
  check("and the block still says why that matters", /WHY NONE OF THEM SHOULD SOUND ALIKE/.test(anchor));
}

/* ── 4. AND NOTHING QUOTABLE DOES. This is the half that caused the complaint. ─ */
{
  const anchor = voiceAnchor({ characters: { a: ident() as any } }, ["a"]);
  check("no sample line is sent, even though the card still has one",
    !anchor.includes(STALE_SAMPLE), anchor);
  check("nothing in the block is quoted speech at all", !/["“”]/.test(anchor), anchor);
  check("the block says the move is performed, not quoted",
    /HOW THEY TALK IS A MOVE THEY MAKE, NOT A LINE THEY HAVE/.test(anchor));
  check("...and names the failure it exists to prevent", /catchphrase/.test(anchor));

  check("the character card sends no sample either",
    !charCard("char_l", ident(), cond(), []).includes(STALE_SAMPLE));
}
{
  // the whole per-turn digest, with a pre-change save loaded
  const s: any = newSave("t", { name: "V" } as any);
  s.world.places["loc_inn"] = { id: "loc_inn", name: "The inn", description_facts: "Smoke.", contains: [] };
  s.world.player_location = "loc_inn";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const m = registerCharacter(s, {
    name: "Lucia", age: 52, background: "Runs the dye-house her mother ran.",
    core_traits: ["Counts everything twice"],
    voice: { ...VOICE, example_lines: [STALE_SAMPLE] },
  } as any);
  s.characters[m].location = "loc_inn";
  s.world.present = ["char_player", m];

  healCharacterTypes(s);
  check("a stale sample is deleted from the record on load",
    !("example_lines" in (s.characters[m].voice ?? {})), s.characters[m].voice);
  check("...and the rest of the voice is left exactly alone",
    s.characters[m].voice.idiolect === VOICE.idiolect && s.characters[m].voice.diction === VOICE.diction);

  const digest = volatileDigest(s, "");
  check("no sample reaches the per-turn digest", !digest.includes(STALE_SAMPLE));
  // ONE COPY OF THE VOICE. voiceAnchor rides the DIRECTION block, which lands after this digest and
  // is therefore nearer to generation; printing the idiolect in both is the duplication charCard
  // was already stripped of.
  check("and the digest does not duplicate the idiolect voiceAnchor already sends",
    !digest.includes(VOICE.idiolect), digest.slice(digest.indexOf("HOW THESE PEOPLE SPEAK"), digest.indexOf("HOW THESE PEOPLE SPEAK") + 600));
}

/* ── 5. no prompt asks for a sample line, or points the narrator at one ──────── */
{
  const prompts = readFileSync("src/engine/prompts.ts", "utf8");
  check("no prompt still specifies example_lines", !prompts.includes("example_lines"));
  const model = NARRATOR_SYSTEM + "\n" + FORGE_SYSTEM;
  check("the forge is told to write an idiolect", /idiolect/i.test(model));
  check("...and told to write no sample lines", /WRITE NO SAMPLE LINES ANYWHERE ON A CARD/.test(model));
  check("...and to keep the cast's idiolects apart", /CHECK THE IDIOLECTS ACROSS THE WHOLE CAST/.test(model));
  check("the narrator is pointed at the idiolect, not at recordings",
    /THE IDIOLECT UNDER EACH NAME/.test(model) && !/THE QUOTED LINES UNDER EACH NAME/.test(model));
  check("...and told it may not harden into a catchphrase", /catchphrase/.test(model));
  check("the requirement that they not sound alike is still stated",
    /if two of the present characters would produce this line in this moment, at least one of them is wrong/i.test(model));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
