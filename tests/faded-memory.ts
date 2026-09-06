/* Smoke test: A MEMORY THAT FADED, NOT ONE THAT WAS CUT IN HALF.
 *
 * Fading shortened a memory on a character count, and a character count takes the END of the
 * sentence — which in English is where the point is. prompts.ts had already worked this out for
 * turn records ("a hard slice takes the END of the sentence, which is exactly where a summary says
 * whose it was") and the fix never reached the memory path. From one save, a woman's remembered
 * life, every line:
 *
 *   "...so I leaned in the doorway and challenged him to…"
 *      lost: "hide how much the threat of losing my roof terrifies me"
 *   "...and I stayed right on the couch making sure he…"        lost: "saw me"
 *   "...the contract he promised before I agree to…"            lost: "anything"
 *
 * Each one keeps the aggressive gesture and drops the reason, so a frightened person reads as a
 * series of unfinished lunges — which is exactly what the player reported. Two of those three were
 * over budget by THREE and SIX characters.
 *
 * The originals were never lost: `full_content` holds them, so a save repairs itself on load. */
import { fadeToStage, cleanFacts } from "../src/engine/memory";
import { sanitize } from "../src/engine/state";
import type { CharMemory, SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const T9 = "Max threatened to kick me out and report me to Mom and Dad, so I leaned in the doorway and challenged him to hide how much the threat of losing my roof terrifies me.";
const T20 = "Max Mercer came back to the apartment to pack his little bag, and I stayed right on the couch making sure he saw me.";
const T25 = "Max called me a shitty person to my face in the hallway, so I pressed Max to show me the actual physical contract he promised before I agree to anything.";
/** Ends on a word that promises something after it and has nothing after it. */
const dangles = (x: string) => /\b(?:to|and|but|so|of|the|a|an|that|he|she|him|her|before|with|for|from|into)…?$/i.test(x.replace(/…$/, "").trim());

/* ── 1. what comes back is a whole thought ───────────────────────────────────── */
{
  const out = fadeToStage(T9, 2);
  check("a faded memory does not stop mid-clause", !dangles(out), out);
  check("...it keeps a clause that finishes", /Mom and Dad/.test(out), out);
  check("...and it did get shorter", out.length < T9.length, out.length);
}

/* ── 2. a few characters over is not worth cutting for ───────────────────────── */
{
  // 153 against a stage-1 budget of 150. Three characters destroyed this sentence.
  const out = fadeToStage(T25, 1);
  check("three characters over budget is left alone", out === T25, out);
  check("...so the condition on the end survives", /before I agree to anything/.test(out), out);
  // 116 against a stage-2 budget of 110
  const out20 = fadeToStage(T20, 2);
  check("and six characters over is left alone too", out20 === T20, out20);
  check("...so her reason for staying on the couch survives", /saw me/.test(out20), out20);
}

/* ── 3. genuinely long still fades, and still lands somewhere real ───────────── */
{
  const long = "I walked the whole length of the market before dawn looking for the man who sold my brother the bad rope, and when I found him he was asleep behind his own stall with his hat over his face, and I stood there a long time without waking him.";
  for (const stage of [1, 2, 3] as const) {
    const out = fadeToStage(long, stage);
    check(`stage ${stage} shortens it`, out.length < long.length, out.length);
    check(`stage ${stage} does not leave a dangling word`, !dangles(out), out);
  }
  check("a deeper stage is not longer than a shallower one",
    fadeToStage(long, 3).length <= fadeToStage(long, 1).length);
}

/* ── 4. fading is idempotent from the original ───────────────────────────────── */
{
  const once = fadeToStage(T9, 2);
  check("re-fading the same original gives the same answer", fadeToStage(T9, 2) === once, once);
}

/* ── 5. a save repairs itself on load ────────────────────────────────────────── */
{
  const s = {
    id: "x", name: "x", world_bible: { name: "w", era: "modern" }, world: { current_turn: 30 },
    characters: { char_player: { character_id: "char_player", name: "Max" }, char_a: { character_id: "char_a", name: "Abigail", pronouns: "she/her" } },
    memory: { char_a: { character_id: "char_a", first_person: true, core: [], beliefs: [], knows: [],
      facts: [{ content: "Max gave Abigail three days to move out.", turn: 10 }],
      episodic: [{ turn: 9, importance: 6, content: "…", decay_stage: 2, full_content: T9, last_accessed_turn: 9 }] } },
  } as unknown as SaveState;
  const out = sanitize(JSON.parse(JSON.stringify(s)));
  const m = out.memory.char_a.episodic[0];
  check("the damaged copy is re-cut from the original it kept", m.content !== "…" && m.content.length > 10, m.content);
  check("...into a whole thought", !dangles(m.content), m.content);
  check("...and the original is left intact", m.full_content === T9);
  check("a fact naming its own owner is put back in the first person",
    /gave me three days/.test(out.memory.char_a.facts![0].content), out.memory.char_a.facts![0].content);
}

/* ── 6. facts are cleaned on a save that was already migrated ────────────────── */
{
  // `first_person` is set once and facts keep being written after it, so gating on the flag means
  // a migrated save never looks at a fact again.
  const mem = { character_id: "c", first_person: true, core: [], beliefs: [], knows: [], episodic: [],
    facts: [{ content: "Abigail sold forty-one bottles last month.", turn: 3 }] } as unknown as CharMemory;
  check("cleanFacts runs regardless of the flag", cleanFacts(mem, "Abigail") === 1, mem.facts);
  check("...and puts the owner in the first person", /^I sold forty-one/.test(mem.facts![0].content), mem.facts![0].content);
  check("...and running it twice changes nothing more", cleanFacts(mem, "Abigail") === 0, mem.facts);
  // pronoun scrambles are a WRONG OWNER, not a wrong style, and are deliberately left alone
  const scrambled = { character_id: "c", first_person: true, core: [], beliefs: [], knows: [], episodic: [],
    facts: [{ content: "At 10:12 my phone rang with a number she didn't have saved.", turn: 13 }] } as unknown as CharMemory;
  cleanFacts(scrambled, "Abigail");
  check("a pronoun scramble is not confidently rewritten",
    /my phone rang with a number she didn't have saved/.test(scrambled.facts![0].content), scrambled.facts![0].content);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
