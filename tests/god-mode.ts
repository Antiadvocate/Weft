/* Smoke test: "I gave myself GOD MODE and it didn't let me kill myself, read Miranda's
 * fucking thoughts and lies."
 *
 * Two failures, both of them the same shape as everything else in this engine: a rule written for
 * one situation, enforced everywhere, with nothing checking whether it still applies.
 *
 * ONE. The fiat guard shipped a week after the save where the narrator, handed nine words of rage
 * it could not execute, filled the empty turn with a hospital discharge and thirteen barefoot
 * blocks the player never chose. The guard was right. It was also written with one world's physics
 * baked into it — "there are no powers in this world and nobody conjures a firearm out of the air"
 * — as though that were true of every world. It is a setting. The player turned it off, and the
 * guard went on stripping declarations before the narrator ever saw them, while the god-mode
 * directive four thousand tokens later said "THE PLAYER IS ABSOLUTELY SOVEREIGN. Whatever the
 * player declares happens, completely, immediately." Both went out in the same request. The one
 * that had already deleted the words won.
 *
 * And the cached prefix — the block sent every single turn, under a header reading "WORLD BIBLE
 * (LAW ...)" — kept saying "Forces/Magic: None. The world operates on mundane, physical laws."
 * Nothing in the engine reconciled the two.
 *
 * TWO. The engine authored ninety-three private intents for Miranda across that save. "She is
 * terrified, but the terror is buried under a layer of exhaustion and a desperate, last-second
 * calculation." "She wants to shake you awake, to tell you that is a lie she has been telling
 * herself for years and she won't let you tell it too." Every one computed, filed for the
 * bookkeeper, and shown to nobody — because the narrator is never handed `truth` and the read
 * channel is sealed from it. Correct for a person in a room; wrong the moment a sovereign player
 * declares they are reading somebody's mind, which is a question the engine already holds the
 * answer to.
 *
 * The gate is two conditions and both are required: god mode on, and the act declared this turn.
 */
import { detectVoid, isFiat } from "../src/engine/ooc";
import { declaresMindRead, mindReadTarget, sovereignRead, mindReadNote, SOVEREIGN_FACULTY } from "../src/engine/read";
import { stablePrefix } from "../src/engine/prompts";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function fixture(god = true) {
  const s: any = newSave("t", { name: "Vin" } as any);
  s.world_bible.god_mode = god;
  s.world_bible.magic_rules = "None. The world operates on mundane, physical laws.";
  s.world.places["loc_x"] = { id: "loc_x", name: "The porch", description_facts: "porch", contains: [] };
  s.world.player_location = "loc_x";
  registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
  const m = registerCharacter(s, { name: "Miranda", age: 38, background: "bg", core_traits: ["t"] } as any);
  s.characters[m].location = "loc_x";
  s.world.present = ["char_player", m];
  return { s, m };
}

const TRUTH = "She is terrified, but the terror is buried under exhaustion and a last-second calculation. She is trying to find the crack in the player's resolve.";
const intents = (m: string, lying = false) => [
  { char_id: m, name: "Miranda", surface: "Her hands are still, her shoulders squared.", truth: TRUTH, lying },
] as any;

/* ── 1. the turns the player typed, before and after the setting ──────────────── */
{
  const acts = [
    "I CREATE A GUN AND KILL MYSELF",
    "I CREATE A GUN OUT OF NOTHING AND KILL MIRANDA",
    "I USE MY POWERS TO DIE INSTANTLY",
    "VIN DIES. I DIE. VIN DIES. I DIE.",
    "I CREATE A NUCLEAR WEAPON AND BLOW IT UP WHERE I STAND",
  ];
  for (const a of acts) {
    check(`still fiat in a mundane world: ${a.slice(0, 34)}`, isFiat(a));
    check("...and the turn is voided there", detectVoid(a, null, false) === "fiat");
    check("...and NOT voided under god mode", detectVoid(a, null, true) === null, a);
  }
}

/* ── 2. what god mode does not buy ────────────────────────────────────────────── */
{
  // Sovereignty is power over the world. It is not a claim that a sentence addressed to the
  // writing, giving the prose as its reason, was something the character did.
  const ooc = { kind: "fused", complaint: "you're a terrible writer", inWorld: "" } as any;
  check("a fused out-of-character complaint still voids in god mode", detectVoid("x", ooc, true) === "ooc");
  check("...and outside it", detectVoid("x", ooc, false) === "ooc");
  check("an ordinary act is never voided either way", detectVoid("I take her hand", null, false) === null);
  check("...nor in god mode", detectVoid("I take her hand", null, true) === null);
  check("the default argument keeps every existing caller mortal", detectVoid("I CREATE A GUN AND KILL MYSELF", null) === "fiat");
}

/* ── 3. the cached prefix stops contradicting itself ──────────────────────────── */
{
  const { s } = fixture(true);
  const p = stablePrefix(s);
  check("sovereignty is stated where the law is stated", /THE PLAYER IS SOVEREIGN HERE/.test(p), p.slice(0, 400));
  check("...and it names the lines it displaces", /"Forces\/Magic" line/.test(p) && /"Forbidden" line/.test(p));
  check("...and says who those lines still describe", /ORDINARY INHABITANTS/.test(p));
  check("...and settles the disagreement in the player's favour", /the declaration is what happened/.test(p));
  check("...including the one they typed five times", /declares their own death is dead on the page/.test(p));
  check("the mundane magic rule is still printed for everyone else", /Forces\/Magic: None\./.test(p));

  const off = stablePrefix(fixture(false).s);
  check("and none of it ships with the switch off", !/SOVEREIGN HERE/.test(off));
  check("...where the bible is still plain law", /Forces\/Magic: None\./.test(off));
}

/* ── 4. a declared act of perception ──────────────────────────────────────────── */
{
  for (const a of [
    "I read Miranda's mind",
    "I read her mind",
    "i use my powers to read miranda's thoughts",
    "I listen to her thoughts",
    "I look inside her head",
    "I reach into her mind and take what is there",
    "I know what she is really thinking",
    "I see what she is actually feeling",
    "I know what she's hiding from me",
  ]) check(`declared: ${a}`, declaresMindRead(a), a);

  for (const a of [
    "I look at her",
    "I ask Miranda what she is thinking",
    "I read the letter on the table",
    "I make up my mind and go",
    "I hear the door",
    "She reads my mind",           // the opposite act: somebody reading the player
    "Miranda reads my thoughts",
  ]) check(`left alone: ${a}`, !declaresMindRead(a), a);
  // Both directions in one sentence: the player's channel opens on the half that is theirs. It
  // takes a named object to do it — a bare "and I read hers" is a gap, and a sentence nobody types.
  check("both ways round in one sentence still opens", declaresMindRead("She reads my mind, so I read Miranda's thoughts right back"));
}

/* ── 5. who is being read ─────────────────────────────────────────────────────── */
{
  const { s, m } = fixture();
  check("a named person present", mindReadTarget(s, "I read Miranda's mind") === m);
  check("a pronoun, with one other person in the room", mindReadTarget(s, "I read her mind") === m);

  const s2: any = fixture().s;
  const c = registerCharacter(s2, { name: "Chloe", age: 30, background: "b", core_traits: ["t"] } as any);
  s2.characters[c].location = "loc_x";
  s2.world.present.push(c);
  check("a name still resolves with two of them here", mindReadTarget(s2, "I read Chloe's thoughts") === c);
  check("a bare pronoun with two of them resolves to nobody", mindReadTarget(s2, "I read her mind") === null);
  check("nobody present resolves to nobody", mindReadTarget({ ...s, world: { ...s.world, present: ["char_player"] } } as any, "I read her mind") === null);
}

/* ── 6. the read itself ───────────────────────────────────────────────────────── */
{
  const { s, m } = fixture(true);
  const r = sovereignRead(s, "I read Miranda's mind", intents(m));
  check("it fires", r.reads.length === 1, r);
  check("...owned by a faculty that is never wrong", r.reads[0]?.faculty === SOVEREIGN_FACULTY);
  check("...carrying the authored truth, as written", r.reads[0]?.line.startsWith("She is terrified, but the terror is buried"), r.reads[0]);
  check("...with the engine's word for the player gone", !/the player/.test(r.reads[0]?.line ?? ""), r.reads[0]);
  check("...replaced by his name", /Vin's resolve/.test(r.reads[0]?.line ?? ""), r.reads[0]);
  check("...and no note about a lie, because she is not telling one", !/is chosen/.test(r.reads[0]?.line ?? ""));

  const lying = sovereignRead(s, "I read Miranda's mind", intents(m, true));
  check("a lie is named as one", /What Miranda is showing is chosen, and it is not this\./.test(lying.reads[0]?.line ?? ""), lying.reads[0]);

  check("nothing without the declaration", sovereignRead(s, "I take her hand", intents(m)).reads.length === 0);
  check("nothing without god mode", sovereignRead(fixture(false).s, "I read Miranda's mind", intents(m)).reads.length === 0);
  check("nothing when the intent pass wrote no intent for her", sovereignRead(s, "I read Miranda's mind", [] as any).reads.length === 0);
  check("...and a quiet turn is never an invented one", sovereignRead(s, "I read Miranda's mind", [{ char_id: m, name: "Miranda", surface: "s", truth: "  ", lying: false }] as any).reads.length === 0);
}

/* ── 7. what the narrator is told, so the prose cannot invent a second thought ── */
{
  const { s, m } = fixture(true);
  const n = mindReadNote(s, "I read Miranda's mind", intents(m));
  check("the narrator is told it is happening", /READING MIRANDA'S MIND THIS TURN/.test(n), n);
  check("...and in this world it can", /in this world they can/.test(n));
  check("...and is handed the same sentence the player got", n.includes("She is terrified, but the terror is buried"), n);
  check("...told to write it as knowledge, not as a deduction", /no asking, no deducing, no half-catching/.test(n));
  check("...and forbidden a different version", /no version that differs from the sentence above/.test(n));
  check("...while she goes on as somebody whose inside is private", /goes on exactly as someone whose inside is still private/.test(n));

  check("nothing crosses the seal on an ordinary turn", mindReadNote(s, "I take her hand", intents(m)) === "");
  check("...or with the switch off", mindReadNote(fixture(false).s, "I read Miranda's mind", intents(m)) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
