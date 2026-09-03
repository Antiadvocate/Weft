/* "THERE WAS ONE GAME WHERE ABIGAIL LITERALLY QUOTED ME THE NEC."
 *
 * Abigail is eighteen. She left community college after a term and works four-hour shifts at a
 * tanning salon. Her recorded skills, in full: psychological boundary testing, pedicure and foot
 * grooming, budget management. Her brother Max proofreads HVAC instruction manuals, and the
 * apartment's window unit has a dead compressor — so the domain was live in the room and it came
 * out of the wrong mouth.
 *
 * THE CAST CARD SAID ONLY THIS: "Established skills: Psychological boundary testing, Pedicure and
 * foot grooming, Budget management." A list of what somebody knows, and nothing anywhere saying
 * what they do not. That is the hole world_bible.absent exists to close — absence cannot be
 * inferred from description — and skills had it in the same shape.
 *
 * AND THE PLAYER NAMED THE MECHANISM: "instead of generating messy, highly specific real-world
 * nuance, the statistical distribution naturally clusters around well-worn tropes." Asked for
 * authority, a model reaches for the most citable object in the domain, because a code section is
 * what authority looks like written down. It is also the cheapest way to sound like somebody who
 * knows, and it requires knowing nothing.
 *
 * THE HARD PART IS NOT THE REGEX, IT IS THE RECORD. Over 606 turns of fourteen saves these terms
 * appear six times in dialogue and five are CORRECT — Kristi Bergstrom's card reads "Load
 * calculation and transformer sizing: Expert", so her kVA line is a woman doing her job and the
 * guard must never touch her. Both directions are asserted below.
 */
import { findExpertise, expertiseFix, expertiseNote, unskilledNote } from "../src/engine/expertise";
import { charCard } from "../src/engine/prompts";
import type { SaveState, Identity } from "../src/engine/types";
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const st = (chars: Record<string, Partial<Identity>>) => ({ characters: chars } as unknown as SaveState);
const ABIGAIL = {
  char_player: { name: "Max Mercer", skills: { "Proofreading and technical layout": "Proficient; earns his living spotting syntax errors in HVAC instruction manuals." }, background: "Raised in Scranton; max works as an electrical engineer doing project planning." },
  char_a: {
    name: "Abigail Mercer", age: 18,
    skills: { "Psychological boundary testing": "Masterful.", "Pedicure and foot grooming": "Meticulous.", "Budget management": "Sharp." },
    background: "Grew up in Scranton eight years behind Max; she was the quiet child who calmly dismantled their father's electric clippers with a butter knife. She dropped out of community college after one term and now works erratic four-hour shifts at a tanning salon.",
  },
};
const said = (who: string, line: string) => `${who} did not blink. "${line}" she said.`;

/* ── 1. the line the player reported ─────────────────────────────────────────── */
{
  const h = findExpertise(st(ABIGAIL), said("Abigail", "NEC 210.52 says you need a receptacle every twelve feet, Max,"), "Max Mercer");
  check("the eighteen-year-old citing the NEC is caught", h?.who === "Abigail Mercer", h);
  check("...and the whole citation is quoted back, not its first digit", h?.term === "NEC 210.52", h?.term);
  check("...and it names who the line belonged to", h?.instead === "Max Mercer", h?.instead);
  check("the ledger line reads as a sentence", /Abigail Mercer spoke codes and standards \("NEC 210\.52"\) — not on their record/.test(expertiseNote(h!)), expertiseNote(h!));
}

/* ── 2. A CHILDHOOD ANECDOTE IS NOT A TRADE ──────────────────────────────────── */
{
  // The first build of this read the WHOLE background as credentials, and "dismantled their father's
  // electric clippers" granted Abigail the entire electrical domain — so the one line this file was
  // written for went undetected on its first run. Only clauses that say somebody did the work for a
  // living count.
  check("«dismantled her father's electric clippers» does not make her an electrician",
    findExpertise(st(ABIGAIL), said("Abigail", "You need twelve AWG on that run and a GFCI at the counter,"), "Max Mercer")?.who === "Abigail Mercer",
    findExpertise(st(ABIGAIL), said("Abigail", "You need twelve AWG on that run and a GFCI at the counter,"), "Max Mercer"));

  // ...but a working clause in the same field does.
  const liam = st({ char_l: { name: "Liam", skills: { "High-volume drink preparation": "Rapid." }, background: "He came up for trade school; he dropped out of the HVAC certification program after his car transmission blew." } });
  check("...while «dropped out of the HVAC certification program» does grant the domain",
    findExpertise(liam, said("Liam", "Whoever wired that ran the neutral bus wrong, man,"), "") === null,
    findExpertise(liam, said("Liam", "Whoever wired that ran the neutral bus wrong, man,"), ""));
}

/* ── 3. THE EXPERT MUST NEVER BE TOUCHED ─────────────────────────────────────── */
{
  const kristi = st({ char_k: { name: "Kristi", skills: { "Load calculation and transformer sizing": "Expert; learned it properly in school, then relearned it the hard way in her father's garage." } } });
  check("a woman whose card says load calculation may talk about load calculation",
    findExpertise(kristi, said("Kristi", "I'm on the load calc, and I'm right about a six-hundred-kVA load on a four-fifty bank,"), "") === null,
    findExpertise(kristi, said("Kristi", "I'm on the load calc, and I'm right about a six-hundred-kVA load on a four-fifty bank,"), ""));

  const nurse = st({ char_n: { name: "Devi", skills: { "Emergency nursing": "Expert; eleven years on nights." } } });
  check("a nurse may say what a nurse says",
    findExpertise(nurse, said("Devi", "Her sats are dropping and that dose is contraindicated with what she's already on,"), "") === null);

  // ...and the guard must be quiet across a whole corpus of ordinary play.
  const DIR = "/root/.claude/uploads/3a2c5f27-7f6b-550d-94f8-bde7978b9cf0";
  let turns = 0, hits = 0;
  try {
    for (const f of readdirSync(DIR)) {
      const s = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
      for (const h of s.history ?? []) {
        const p = String(h.narrator_prose ?? ""); if (!p.trim()) continue;
        turns++;
        if (findExpertise(s, p, s.characters?.char_player?.name ?? "")) hits++;
      }
    }
    check(`no false positive in ${turns} turns of real play`, turns > 100 && hits === 0, { turns, hits });
  } catch { console.log("skip  (saves not present in this checkout)"); }
}

/* ── 4. THE CARD'S MISSING HALF ──────────────────────────────────────────────── */
{
  const note = unskilledNote(ABIGAIL.char_a as Identity);
  check("a card with skills now states that the list is the limit", /THAT LIST IS EXHAUSTIVE/.test(note), note);
  check("...in terms a narrator can apply to one line", /cannot name its parts, cite a rule about it, or say how it works/.test(note));
  check("...and says what to do when the scene needs the fact anyway",
    /either somebody who has it says it, or nobody does and the fact stays unknown/.test(note));
  const none = unskilledNote({ name: "Wren", skills: {} } as Identity);
  check("a card with no skills says so outright rather than staying silent",
    /No trade or body of specialist knowledge is recorded for Wren/.test(none), none);

  // It has to actually reach the card the narrator reads — built from a real save, because a card
  // assembles a dozen fields and a hand-made stub proves nothing about the real one.
  try {
    const S = JSON.parse(readFileSync("/root/.claude/uploads/3a2c5f27-7f6b-550d-94f8-bde7978b9cf0/5412b29c-Elm_Street_Tenement.weaver_2.json", "utf8"));
    const id = Object.keys(S.characters).find((k) => S.characters[k].name === "Abigail Mercer")!;
    const card = charCard(id, S.characters[id], S.condition[id], []);
    check("the limit is on the cast card the narrator actually reads",
      /THAT LIST IS EXHAUSTIVE/.test(card), card.slice(0, 300));
    check("...next to the list it is the limit on", card.indexOf("Established skills") < card.indexOf("THAT LIST IS EXHAUSTIVE"));
  } catch (e) { console.log("skip  (save not present in this checkout)", String(e).slice(0, 80)); }
}

/* ── 5. the correction ───────────────────────────────────────────────────────── */
{
  check("no note when nothing fired", expertiseFix(null) === "");
  const d = expertiseFix({ who: "Abigail Mercer", domain: "codes and standards", term: "NEC 210.52", line: "NEC 210.52 says you need a receptacle every twelve feet, Max.", instead: "Max Mercer" });
  check("it quotes the term and the line", d.includes("NEC 210.52") && d.includes("receptacle every twelve feet"));
  check("it redirects rather than only forbidding", /THAT LINE BELONGED TO MAX MERCER/.test(d), d.slice(0, 200));
  check("it says what real expertise sounds like out loud",
    /grievances and shortcuts/.test(d) && /what fails first/.test(d));
  const alone = expertiseFix({ who: "Abigail Mercer", domain: "medicine", term: "contraindicated", line: "That's contraindicated." });
  check("with nobody qualified present, the fact simply stays unknown",
    /NOBODY PRESENT HAS THAT KNOWLEDGE/.test(alone) && /a question nobody in it can answer/.test(alone));
}

/* ── 6. wiring ───────────────────────────────────────────────────────────────── */
{
  const T = readFileSync("src/engine/turn.ts", "utf8");
  check("it runs on the committed prose", /state\.last_expertise = findExpertise\(state, prose/.test(T));
  check("...with the player exempt, because their character may know anything",
    /findExpertise\(state, prose, state\.characters\?\.char_player\?\.name/.test(T));
  check("the correction reaches the per-turn directive", /expertiseFix\(state\.last_expertise\)/.test(T));
  check("it counts toward the integrity aggregate", /noteFire\(state, "expertise"/.test(T));
  check("the ledger can name the kind", /expertise: "somebody knowing a trade/.test(readFileSync("src/engine/integrity.ts", "utf8")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
