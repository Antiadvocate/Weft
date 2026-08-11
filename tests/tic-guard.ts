/* Smoke test: THE FIRST THING ANYBODY SAYS TO YOU IN ROME, DELETED.
 *
 * Turn 1 of a save. The player introduces himself:
 *
 *   "Hi. I'm Rabi. I'm probably not dressed right for here. That's ok. I'm trying to find out
 *    where I can go to find some lodgings."
 *
 * The woman he is talking to has an authored voice that begins "starts with a flat observation of
 * fact", so she opened the story by saying his own line back to him. What the player actually read
 * was this:
 *
 *   Lucia Aelia Severa had her back to a marble plinth, a wax tablet in one hand and a stylus in
 *   the other. The stylus stayed where it was.
 *
 *   " The words came out flat, factual, an observation rather than a joke. She tucked the tablet
 *   under her arm and reached for a small bronze canteen...
 *
 * A bare quote mark, and an attribution for a line that is not there.
 *
 * The tic guard did it, and two separate things had to be wrong for it to happen. It hunts the
 * narrator reflecting the player's words back with an intensifier — a real tic — by deleting any
 * sentence carrying four consecutive words from the player's input, and it has no idea that a
 * PERSON repeating what you just said is not a tic but a conversation. Then its sentence splitter
 * has no idea quotation marks exist, so it cut inside her line and left the punctuation behind.
 * It happened again on turn 8 and left the same wreckage. Nothing logged, nothing looked wrong in
 * state, and the scene simply read as though the engine had a stroke mid-sentence.
 */
import { splitSentencesOutsideQuotes } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* The guard, extracted exactly as turn.ts runs it, so this tests the real rule. */
function ticGuard(prose: string, action: string): { prose: string; cuts: number } {
  const CANNED = /\b(that'?s not nothing|it'?s a lot|you'?re not wrong|that'?s something)\b/i;
  const QUOTE = /["“”]/;
  const actWords = action.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const runs: string[] = [];
  for (let i = 0; i + 4 <= actWords.length; i++) runs.push(actWords.slice(i, i + 4).join(" "));
  const echoes = (sent: string) => {
    const norm = sent.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
    return runs.some((r) => norm.includes(r));
  };
  let cuts = 0;
  const cleaned = prose.split(/\n\n+/).map((para) => {
    const sents = splitSentencesOutsideQuotes(para);
    if (sents.length < 2) return para;
    const kept = sents.filter((sent) => {
      const t = sent.trim();
      if (cuts >= 2 || t.length > 160) return true;
      if (QUOTE.test(t)) return true;
      if (CANNED.test(t) || echoes(t)) { cuts++; return false; }
      return true;
    });
    return kept.join("").trim() || para;
  }).join("\n\n");
  return { prose: cuts ? cleaned : prose, cuts };
}

const balanced = (s: string) => (s.match(/["“”]/g) ?? []).length % 2 === 0;

/* ── 1. turn 1 of the save ────────────────────────────────────────────────────── */
{
  const action = `"Hi. I'm Rabi. I'm probably not dressed right for here. That's ok. I'm trying to find out where I can go to find some lodgings."`;
  const prose = `Lucia Aelia Severa had her back to a marble plinth, a wax tablet in one hand and a stylus in the other. The stylus stayed where it was.\n\n`
    + `"You are not dressed right for here." The words came out flat, factual, an observation rather than a joke. She tucked the tablet under her arm and reached for a small bronze canteen.`;
  const out = ticGuard(prose, action);
  check("her line survives", out.prose.includes("You are not dressed right for here"), out.prose);
  check("nothing was cut at all", out.cuts === 0, out.cuts);
  check("and the quotes are still balanced", balanced(out.prose), out.prose);
  // the exact wreckage from the save: a paragraph that opens on a quote mark with nothing in it
  check("no paragraph opens on an empty quote", !out.prose.split(/\n\n+/).some((p) => /^["“]\s/.test(p.trim())), out.prose);
}

/* ── 2. the tic it actually exists for is still cut ───────────────────────────── */
{
  const action = "I tell her I have been waiting outside the gate all night for her";
  const prose = `She looked at him for a long moment without speaking.\n\n`
    + `You really just waited outside the gate all night for her. The rain had not let up once.`;
  const out = ticGuard(prose, action);
  check("the narrator parroting the player is still excised", out.cuts === 1, out);
  check("and the rest of the paragraph survives", out.prose.includes("The rain had not let up"), out.prose);
}

/* ── 3. a canned affirmation in narration goes; the same words spoken stay ─────── */
{
  const narrated = ticGuard(`She put the cup down. That's not nothing. The fire had burned low.`, "I say nothing");
  check("canned narration is cut", narrated.cuts === 1, narrated);

  const spoken = ticGuard(`She put the cup down. "That's not nothing," she said. The fire had burned low.`, "I say nothing");
  check("the same words in somebody's mouth are left alone", spoken.cuts === 0, spoken);
  check("and the line is intact", spoken.prose.includes(`"That's not nothing," she said.`), spoken.prose);
}

/* ── 4. a cut can never leave the paragraph's quotes unbalanced ───────────────── */
{
  const action = `"This is enough for how long? Also is that lady ok..." I ask about Tigris while taking a bite of the food`;
  const prose = `They were hot—earth and thyme and something sharp—and the clay bowl warmed his hands.\n\n`
    + `"That is enough for how long as you like." He tilted his head toward the doorway.`;
  const out = ticGuard(prose, action);
  check("turn 8's line survives too", out.prose.includes("He tilted his head toward the doorway"), out.prose);
  check("with its dialogue attached", /"[^"]+\." He tilted/.test(out.prose), out.prose);
  check("quotes balanced", balanced(out.prose), out.prose);
}

/* ── 5. the splitter itself ───────────────────────────────────────────────────── */
{
  const s = splitSentencesOutsideQuotes(`"Hi. I am Rabi. That is ok," she said. Then nothing moved.`);
  check("a quoted line and its attribution are one unit", s.length === 2, s);
  check("full stops inside the quote do not split it", s[0].includes("Hi. I am Rabi. That is ok,"), s);
  check("plain narration still splits", splitSentencesOutsideQuotes("One. Two. Three.").length === 3);
  check("a single sentence is one piece", splitSentencesOutsideQuotes("Just the one").length === 1);
  check("rejoining is lossless", splitSentencesOutsideQuotes(`"A. B," he said. C.`).join("") === `"A. B," he said. C.`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
