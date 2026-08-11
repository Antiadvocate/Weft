/* Smoke test: A MEMORY IS SOMEBODY'S ACCOUNT, NOT A CLIPPING FROM THE PAGE.
 *
 * Straight out of one save's memory bank for Tessa:
 *
 *   "Hey in getting a divorce.                     ← the player's own text message, filed as HERS
 *   "I don't want to be that woman on the train.   ← a dangling quote fragment
 *   How about you?                                 ← a line of dialogue, no context
 *   Rabi demanded the universe obey HER wishes, and SHE deflected…
 *   Rabi joked about serenading ME and I dared him…    ← the same person, two turns apart
 *
 * The player typed "Hey in getting a divorce" as a text message from the back of a car. It became
 * something Tessa remembers. And her own memories flipped between "I" and "she", which is what
 * makes them read as though she did the things the player did.
 *
 * THE FLIP WAS FIXED IN THE WRONG DIRECTION, AND THE FIX COST MORE THAN THE BUG.
 *
 * Rewriting first person INTO third made every memory consistent and every memory ambiguous, because
 * third person about yourself is a name and then a pronoun, and the pronoun has no anchor. A later
 * save, at turn 24:
 *
 *   in Lucia's bank:  "Rabi put the soft-soled shoes on HER bare feet ... and SHE flushed"
 *   in Tigris's bank: "Rabi gave HER a pair of shoes ... which SHE took with a thank-you"
 *
 * Same shape, two different women, and the digest prints both as a bare line with no owner on it.
 * The reflection pass then read one of Marcus's memories — "a sign SHE is building her own network",
 * about Lucia — and formed him a standing conviction reading "RABI conducts HERSELF like a soldier
 * ... SHE is the kind of initiative he would recruit for". Rabi is a man. Two people fused into one
 * belief off a single unanchored pronoun, permanently, and the narrator was handed it every turn.
 *
 * First person is the form that cannot do this: "I" can only be the owner of the bank it is stored
 * in. Only the NAME is ever rewritten — a pronoun cannot be reassigned after the fact without
 * guessing, and guessing is the bug. */
import { cleanMemoryContent } from "../src/engine/memory";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const her = { name: "Tessa", isPlayer: false };

/* 1. the exact junk from the save */
{
  const TEXT = `"Something quiet would be good." I tell him I text my family. "Hey in getting a divorce. Mom can you find a lawyer"`;
  check("the player's own message is not her memory",
    cleanMemoryContent("Hey in getting a divorce. Mom can you find a lawyer", { ...her, playerAction: TEXT }) === null);
  check("a dangling quote fragment is dropped",
    cleanMemoryContent(`"I don't want to be that woman on the train.`, her) === null);
  check("a bare line of dialogue is dropped", cleanMemoryContent("How about you?", her) === null);
  check("another one", cleanMemoryContent(`"Doesn't mean I should have all of them.`, her) === null);
}

/* 2. first person is the canonical form and passes straight through */
{
  const out = cleanMemoryContent("Rabi joked about serenading me and I dared him to do it, while I'm terrified of telling him the truth.", her)!;
  check("a first-person memory is left exactly as written", out === "Rabi joked about serenading me and I dared him to do it, while I'm terrified of telling him the truth.", out);
  check("the other person stays named", /Rabi joked/.test(out), out);
}

/* 3. a third-person account of its own owner is converted to first person */
{
  const named = "Rabi spoke with pity about people who cheat, and Tessa felt the words land like a stone.";
  const out = cleanMemoryContent(named, her)!;
  check("her own name becomes I", /\bI felt the words land\b/.test(out), out);
  check("and she is no longer a third party in her own memory", !/\bTessa\b/.test(out), out);
  check("the other person is untouched", /Rabi spoke with pity/.test(out), out);

  const poss = cleanMemoryContent("Rabi took Tessa's hand and Tessa's certainty went out of her all at once.", her)!;
  check("her possessive becomes mine", /my hand/.test(poss) && !/Tessa's/.test(poss), poss);

  const agree = cleanMemoryContent("Tessa is terrified of telling him the truth and has not said a word about it.", her)!;
  check("the verb agrees after the swap", /\bI am terrified\b/.test(agree), agree);
  check("and so does a coordinated clause that elided its subject", /\band have not said\b/.test(agree), agree);

  // ...but only when the subject really was elided. These supply their own and must not be touched.
  const own = cleanMemoryContent("Tessa told Rabi about the ledger and he has not said a word since then.", her)!;
  check("a coordinated clause with its own subject is left alone", /\bhe has not said\b/.test(own), own);
  const bread = cleanMemoryContent("Tessa went out to the market and the bread is stale again today.", her)!;
  check("and so is one with a noun subject", /\bthe bread is stale\b/.test(bread), bread);

  // SUBJECT OR OBJECT. "Rabi took Tessa aside" is not "Rabi took I aside".
  const obj = cleanMemoryContent("Rabi took Tessa aside and Tessa did not know what he wanted.", her)!;
  check("a name in object position becomes me", /\btook me aside\b/.test(obj), obj);
  check("and the same name in subject position becomes I", /\band I did not know\b/.test(obj), obj);
  const opener = cleanMemoryContent("He watched Tessa cross the room. Tessa did not look back at him once.", her)!;
  check("a name opening a new sentence is a subject", /\bwatched me cross\b/.test(opener) && /\. I did not look back\b/.test(opener), opener);
}

/* 3b. A PRONOUN IS NEVER REASSIGNED. This is the whole discipline: the rule can only move a NAME,
 *     because "she" in a third-person memory may be its owner or may be somebody else, and a rewrite
 *     that gets it wrong is how one person's history ends up in another person's head. Left alone,
 *     a legacy memory is merely vague; rewritten on a guess, it is false. */
{
  const third = "She told Rabi she wouldn't punch him — she'd just sit in the apartment and wait for him to come home.";
  check("a bare-pronoun account is left exactly as it was", cleanMemoryContent(third, her) === third, cleanMemoryContent(third, her));
}

/* 4. the player's own memories keep the player's voice */
{
  const mine = { name: "Rabi", isPlayer: true };
  const t = "I told my family we are getting a divorce and I could not soften it.";
  check("the player's memory is not rewritten into third person", cleanMemoryContent(t, mine) === t, cleanMemoryContent(t, mine));
  check("and their own words are allowed to be their own memory",
    cleanMemoryContent("I texted Sarah that I was scared and staying at a hotel", { ...mine, playerAction: "I text sarah im scared" }) !== null);
}

/* 5. a memory that merely QUOTES inside a real account is fine */
{
  const q = `Rabi said she would hear from his lawyers "in time", and then he walked out to the car.`;
  check("an account containing a quotation survives", cleanMemoryContent(q, her) !== null, cleanMemoryContent(q, her));
}

/* 6. nothing recoverable is nothing */
{
  check("empty is null", cleanMemoryContent("", her) === null);
  check("whitespace is null", cleanMemoryContent("   ", her) === null);
  check("undefined is null", cleanMemoryContent(undefined, her) === null);
  check("over-long content is clipped", (cleanMemoryContent("x".repeat(900), her) ?? "").length <= 400);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
