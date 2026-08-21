/* Smoke test: HER OWN MEMORY, IN SOMEBODY ELSE'S VOICE.
 *
 * The player: "Miranda's memory confuses herself with herself and my statements verbatim show up in
 * her own self which makes no sense." From her bank at turn 47, verbatim:
 *
 *   Miranda broke their promise to Miranda: Miranda told herself she is not ready to talk about it.
 *   Miranda agreed: Tell Vin she understands he felt uncared for and that she wants to fix it.
 *   Stopped asking about Lean into this morning of tenderness with Vin, let herself be fully…
 *   She reached past him and folded the corner of his book page down.
 *   "Ok so didn't want to respond to me I guess.
 *   I don't really know who you are except Chloe and your work.
 *   I say while half asleep
 *
 * The last three are the player's own typed words sitting in her head. The first four are her own
 * bank describing her from outside, twice as a promise she made to herself and broke.
 *
 * THE GUARD ALREADY EXISTED AND GUARDED ONE DOOR. cleanMemoryContent handles bare quotes, verbatim
 * lifts of the player's action, and third-person self-reference, and it is good. It runs on the
 * `memories` the bookkeeper files. There are TWELVE writers into the episodic store across eight
 * modules — promises kept and broken, drives stalled and completed, schedule misses, offstage
 * events, montage vignettes, habit observations, time skips, witnessed reactions — and eleven of
 * them wrote straight past it. What they write is built by interpolation out of fields authored in
 * other voices: a drive goal is a directive ("Tell Vin she understands…"), a promise line is a
 * report about a third party. Dropped into a first-person bank, that is what comes out.
 *
 * So the bank is swept rather than the twelve call sites threaded, because the thirteenth writer
 * would miss the thread. And a self-promise is refused at the source: the promise system is a debt
 * between two people, and from === to produced an accusation from a woman to herself.
 */
import { cleanMemoryContent, sweepMemories } from "../src/engine/memory";
import { addPromise } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const clean = (t: string, playerAction?: string) =>
  cleanMemoryContent(t, { name: "Miranda", isPlayer: false, playerAction });

/* ── 1. the player's words are never hers ─────────────────────────────────────── */
{
  const t46 = `"You told me you made the final three yesterday before dinner. So ok? Literally all you've talked about. I don't really know who you are except Chloe and your work."`;
  check("a verbatim lift of the player's line is not a memory",
    clean("I don't really know who you are except Chloe and your work.", t46) === null);
  const t19 = `I move over to her and nuzzle her neck. "Sometimes I just wonder if you'd sleep better buried deep in my throat" I say while half asleep`;
  check("...including a stage direction lifted off the end of it",
    clean("I say while half asleep", t19) === null);
  check("an orphaned quote is not a memory",
    clean(`"Ok so didn't want to respond to me I guess.`) === null);
  check("...nor a bare line of dialogue with the speaker lost",
    clean(`"Chloe, I'm not going to make a thing of it."`) === null);
  check("but a real account of the same beat survives",
    !!clean("Vin told me he does not know who I am apart from Chloe and my work.", t46));
}

/* ── 2. her own bank, describing her from outside ─────────────────────────────── */
{
  const r = clean("She reached past him and folded the corner of his book page down, then took it from his hands.");
  check("an opening pronoun in her own bank is her", /^I reached past him/.test(r ?? ""), r);
  check("...and the rest of the sentence is untouched", /folded the corner of his book page down/.test(r ?? ""), r);
  // AND THE LINE THAT MUST NOT BE CROSSED. Moving the opener re-points every later pronoun that was
  // coreferring with it, which turns one ambiguity into two — the failure tests/memory-voice.ts
  // pins. So the opener only moves when it is the only pronoun of its family in the entry.
  const stranded = "She told Rabi she wouldn't punch him — she'd just sit in the apartment and wait.";
  check("an opener with later pronouns depending on it is left alone", clean(stranded) === stranded, clean(stranded));

  const named = clean("Miranda told herself she is not ready to talk about it yet, and Vin never asked.");
  check("her name in her own bank becomes I", /^I told myself/.test(named ?? ""), named);
  check("...and the other person stays named", /Vin/.test(named ?? ""), named);

  // the rule that must NOT be broken: a pronoun mid-sentence keeps its antecedent
  const mid = clean("I handed Chloe the phone and she read it twice without saying anything.");
  check("a pronoun with an antecedent is left alone", /and she read it twice/.test(mid ?? ""), mid);
}

/* ── 3. a promise to yourself is not a promise ───────────────────────────────── */
{
  const st = {
    characters: { char_player: { name: "Vin" }, char_m: { name: "Miranda" } },
    world: { current_turn: 10, promises: [] },
  } as unknown as SaveState;
  check("a self-promise is refused", addPromise(st, "char_m", "char_m", "tell him when she is ready") === null);
  check("...and nothing is filed", (st.world.promises ?? []).length === 0, st.world.promises);
  check("a promise between two people still works",
    !!addPromise(st, "char_m", "char_player", "tell him about the fellowship"));
}

/* ── 4. THE SWEEP: every door, and an existing save repaired on load ──────────── */
{
  const bad = [
    "Miranda broke their promise to Miranda: Miranda told herself she is not ready to talk about it yet.",
    "She reached past him and folded the corner of his book page down, then took it from his hands.",
    `"Ok so didn't want to respond to me I guess.`,
    "I say while half asleep",
    "Vin came home and I saw his text, but I couldn't bring myself to talk about the fellowship.",
  ];
  const st = {
    characters: { char_player: { name: "Vin" }, char_m: { name: "Miranda" } },
    memory: { char_m: { character_id: "char_m", core: [], beliefs: [], facts: [], knows: [], first_person: true,
      episodic: bad.map((content, i) => ({ turn: 40 + i, content, importance: 5, last_accessed_turn: 40 })) } },
    world: { current_turn: 47 },
  } as unknown as SaveState;

  const dropped = sweepMemories(st, `I move over to her. "Something" I say while half asleep`);
  const left = st.memory.char_m.episodic.map((m) => m.content);
  check("the sweep drops what cannot be a memory", dropped >= 2, { dropped, left });
  check("...the orphan quote is gone", !left.some((c) => /^"Ok so/.test(c)), left);
  check("...the lifted stage direction is gone", !left.some((c) => /^I say while half asleep$/.test(c)), left);
  check("...the self-promise line is repaired or dropped",
    !left.some((c) => /Miranda broke their promise to Miranda/.test(c)), left);
  check("...the third-person account is now hers", left.some((c) => /^I reached past him/.test(c)), left);
  check("...and a good memory is untouched",
    left.some((c) => /Vin came home and I saw his text/.test(c)), left);

  // idempotent: a second pass must not re-process or re-damage anything
  const before = [...left];
  const again = sweepMemories(st, "");
  check("the sweep never runs twice on the same entry", again === 0);
  check("...and leaves the bank exactly as it was",
    JSON.stringify(st.memory.char_m.episodic.map((m) => m.content)) === JSON.stringify(before));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
