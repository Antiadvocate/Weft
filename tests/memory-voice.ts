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
 * something Tessa remembers. And her own memories flip between "I" and "she", which is what makes
 * them read as though she did the things the player did. */
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

/* 2. first person is rewritten rather than thrown away */
{
  const out = cleanMemoryContent("Rabi joked about serenading me and I dared him to do it, while I'm terrified of telling him the truth.", her)!;
  check("it survives", !!out, out);
  check("no bare I remains", !/\bI\b/.test(out), out);
  check("no bare me remains", !/\bme\b/.test(out), out);
  check("she is named instead", /Tessa/.test(out), out);
  check("contractions are handled", !/I'm/.test(out) && /Tessa is terrified/.test(out), out);
  check("the other person is untouched", /Rabi joked/.test(out), out);

  const my = cleanMemoryContent("Rabi told me my love needs no thanks and I felt a wave of safety.", her)!;
  check("possessives too", !/\bmy\b/.test(my), my);
}

/* 3. third person is already right and is left alone */
{
  const third = "She told Rabi she wouldn't punch him — she'd just sit in the apartment and wait for him to come home.";
  check("a third-person account passes through unchanged", cleanMemoryContent(third, her) === third, cleanMemoryContent(third, her));
  const named = "Rabi spoke with pity about people who cheat, and Tessa felt the words land like a stone.";
  check("and so does one that names her", cleanMemoryContent(named, her) === named);
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
