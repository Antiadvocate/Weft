/* Smoke test: THE SENTENCES A THOUSAND OTHER NARRATORS ALREADY WROTE.
 *
 * "Took a deep breath." "Her voice barely above a whisper." None of them is wrong and none is
 * anybody's. The list comes from a corpus of phrases language models over-produce (stockphrases.ts),
 * it is never put in a prompt, and it reads only what the narrator wrote — never what anyone said. */
import { findStock, stockIn, narrationOnly, stockToQuote, stockFix, introducesStock } from "../src/engine/stock";
import { flagTics, acceptable } from "../src/engine/reviser";
import { STOCK_PHRASES, STOCK_BANS } from "../src/engine/stockphrases";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. matching ─────────────────────────────────────────────────────────────── */
check("the commonest one is caught", stockIn("You took a deep breath and opened the door.")[0]?.phrase === "took a deep breath");
check("pronouns fold, so her chest and your chest are the same phrase",
  stockIn("Your heart pounding in your chest, you ran.").length > 0 && stockIn("Her heart pounding in her chest, she ran.").length > 0);
check("the words come back as written", stockIn("A shiver ran down HIS spine.")[0]?.phrase === "shiver ran down HIS spine", stockIn("A shiver ran down HIS spine."));
check("ordinary concrete action is not stock", stockIn("He took a step back from the stove.").length === 0);
check("names the corpus over-used are not in the list", !STOCK_PHRASES.some((p) => /elara/.test(p)));
check("partial words don't match", stockIn("She overtook a deep breathing exercise.").length === 0);

/* ── 2. only the narrator's words ────────────────────────────────────────────── */
check("what is inside quotes is not read", narrationOnly(`"I took a deep breath," she said.`).includes("…") && stockIn(narrationOnly(`"I took a deep breath," she said.`)).length === 0);
const tag = findStock(`"Get out," she said, her voice barely above a whisper.`);
check("but the narrator's dialogue tag is", tag.length === 1 && /voice barely above a whisper/.test(tag[0].phrase), tag);

/* ── 3. when it is quoted back ───────────────────────────────────────────────── */
check("one in a turn is the cost of writing prose", stockToQuote("You took a deep breath. The kettle boiled.", []) === null);
const two = stockToQuote("You took a deep breath. A shiver ran down your spine.", []);
check("two in a turn is the habit", !!two, two);
check("the same one coming back is the habit too", !!stockToQuote("You took a deep breath before you knocked.", ["She took a deep breath at the gate."]));
const fix = stockFix(two);
check("the note quotes the narrator's own sentence", /«took a deep breath»/.test(fix) && /You took a deep breath\./.test(fix), fix);
check("and says what to write instead", /hands, their eyes and their feet/.test(fix));
check("nothing to quote, nothing said", stockFix(null) === "");

/* ── 4. the reviser ──────────────────────────────────────────────────────────── */
const flagged = flagTics("The rain hammered the tin roof of the shed. You took a deep breath and pushed the shed door wide.\n\n\"Took a deep breath, did you?\" Mara said.");
check("a narration sentence with a stock phrase is flagged for repair", flagged.some((f) => f.family === "stock" && f.phrase === "took a deep breath"), flagged);
check("a sentence with a quotation mark is never flagged", !flagged.some((f) => f.text.includes("Mara said")), flagged);
check("a repair that trades one stock phrase for another is refused",
  !acceptable("You took a deep breath and pushed the shed door wide.", "took a deep breath", "A shiver ran down your spine and you pushed the shed door wide."));
check("a repair that just cuts it is accepted",
  acceptable("You took a deep breath and pushed the shed door wide.", "took a deep breath", "You pushed the shed door wide."));
check("introducesStock sees only new phrases", !introducesStock("You took a deep breath.", "You took a deep breath, slowly.") && introducesStock("You waited.", "You took a deep breath."));

/* ── 5. the list never reaches a prompt ──────────────────────────────────────── */
const prompts = readFileSync("src/engine/prompts.ts", "utf8") + readFileSync("src/engine/reviser.ts", "utf8");
check("no stock phrase is written into the prompt files", !["took a deep breath", "voice barely above a whisper", "shiver run down"].some((p) => prompts.toLowerCase().includes(p)));
check("the sampler list fits KoboldCpp's limit", STOCK_BANS.length > 100 && STOCK_BANS.length <= 768, STOCK_BANS.length);
check("the sampler list is literal text", STOCK_BANS.every((b) => !/POSS|SUBJ|OBJ/.test(b)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
