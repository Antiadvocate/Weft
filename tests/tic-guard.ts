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
 * The tic guard did it. It hunts the narrator reflecting the player's words back — a real tic — by
 * deleting any short sentence carrying four consecutive words from the player's input, and its
 * sentence splitter had no idea quotation marks exist, so it cut inside her line and left the
 * punctuation behind. It happened again on turn 8 and left the same wreckage. Nothing logged,
 * nothing looked wrong in state, and the scene simply read as though the engine had a stroke
 * mid-sentence.
 *
 * THE FIRST FIX OVER-CORRECTED AND THE VERBATIM REPLIES CAME BACK.
 *
 * It exempted every sentence containing a quote mark, on the reasoning that a PERSON repeating what
 * you said is conversation rather than a tic. That is true of conversation and false of a parrot,
 * and it switched the guard off in the one place the failure is most visible: a character saying
 * the player's own line back to them, in dialogue, on the page.
 *
 * "Contains a quote" was never the distinction. The distinction is how much of the reply is MADE OF
 * the player's words, and how long it is — reaching for four of them is how people talk, repeating
 * a short phrase is how anybody checks they heard right, and handing back a whole sentence of the
 * player's own reasoning is the tic. A spoken line is measured now, not exempted. The splitter
 * returns a quoted line together with its attribution, so excising one can no longer strand the
 * punctuation, which was the actual damage.
 */
import { splitSentencesOutsideQuotes, isParrot, liftedFraction } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* The guard, extracted exactly as turn.ts runs it, so this tests the real rule. */
function ticGuard(prose: string, action: string): { prose: string; cuts: number } {
  const CANNED = /\b(that'?s not nothing|it'?s a lot|you'?re not wrong|that'?s something)\b/i;
  const actWords = action.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const actLine = actWords.join(" ");
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
      const spoken = (t.match(/["“][^"”]*["”]/g) ?? []).join(" ");
      if (spoken) {
        if (!isParrot(spoken, actLine)) return true;
        cuts++; return false;
      }
      if (CANNED.test(t) || echoes(t)) { cuts++; return false; }
      return true;
    });
    const out = kept.join("").trim();
    if (!out || (out.match(/["“”]/g) ?? []).length % 2 === 1) return para;
    return out;
  }).join("\n\n");
  return { prose: cuts ? cleaned : prose, cuts };
}

const balanced = (s: string) => (s.match(/["“”]/g) ?? []).length % 2 === 0;

/* ── 1. turn 1 of the save: whatever the guard decides, it never leaves wreckage ── */
{
  const action = `"Hi. I'm Rabi. I'm probably not dressed right for here. That's ok. I'm trying to find out where I can go to find some lodgings."`;
  const prose = `Lucia Aelia Severa had her back to a marble plinth, a wax tablet in one hand and a stylus in the other. The stylus stayed where it was.\n\n`
    + `"You are not dressed right for here." The words came out flat, factual, an observation rather than a joke. She tucked the tablet under her arm and reached for a small bronze canteen.`;
  const out = ticGuard(prose, action);
  check("the quotes are balanced whatever it decided", balanced(out.prose), out.prose);
  // the exact wreckage from the save: a paragraph that opens on a quote mark with nothing in it
  check("no paragraph opens on an empty quote", !out.prose.split(/\n\n+/).some((p) => /^["“]\s/.test(p.trim())), out.prose);
  check("the attribution never outlives the line it belonged to",
    out.prose.includes("You are not dressed right for here") || !out.prose.includes("The words came out flat"), out.prose);
  check("and the rest of the paragraph is intact", out.prose.includes("reached for a small bronze canteen"), out.prose);
}

/* ── 1b. A REPLY MADE OF THE PLAYER'S WORDS IS STILL CUT ──────────────────────────
 *
 * The first fix for the orphan exempted every sentence containing a quote mark, on the reasoning
 * that a PERSON repeating what you said is conversation rather than a tic. True of conversation,
 * false of a parrot — and it switched the guard off in the one place the failure is most visible.
 * The verbatim replies came straight back. "Contains a quote" was never the distinction. */
{
  const action = `"It's salmon sous vide. I'm not a big fan of it. But I think you would enjoy this since you've never had it" I take a few bites and push the plate away.`;
  const prose = `She looked at the plate for a while without touching it.\n\n`
    + `"It's salmon sous vide. I'm not a big fan of it." She set her fork down. The lamp guttered.`;
  const out = ticGuard(prose, action);
  check("his own line handed back to him is cut", out.cuts === 1, out);
  check("and it takes its attribution with it", !out.prose.includes("She set her fork down"), out.prose);
  check("leaving no stranded punctuation", balanced(out.prose), out.prose);
  check("and the paragraph keeps what was actually hers", out.prose.includes("The lamp guttered"), out.prose);
}

/* ── 1c. and an ordinary answer that happens to use his words is not ──────────── */
{
  const action = `"I'm not a big fan of it. But I think you would enjoy this since you've never had it" I push the plate away.`;
  const prose = `She looked at the plate.\n\n"I don't care whether you're a fan of it. I asked what it was." She picked up the fork.`;
  const out = ticGuard(prose, action);
  check("a real reply survives", out.cuts === 0, out);
  check("intact", out.prose.includes("I asked what it was"), out.prose);
}

/* ── 1d. a short echo is a clarification, not a parrot ────────────────────────── */
{
  const action = `"I need to find the Temple of Venus and Rome before dark" I look up the hill.`;
  const prose = `He pointed with his chin.\n\n"The Temple of Venus and Rome?" She wiped her hands on her apron.`;
  const out = ticGuard(prose, action);
  check("checking she heard right is not parroting", out.cuts === 0, out);
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

  // A canned affirmation in somebody's MOUTH is left alone: it is not lifted from the player, and
  // a person is allowed to say an ordinary thing. Only narration gets the canned-phrase treatment.
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

/* ── 6. the measure itself ────────────────────────────────────────────────────── */
{
  const act = "i am not a big fan of it but i think you would enjoy this since you have never had it";
  check("a whole line lifted scores 1", liftedFraction("I am not a big fan of it", act) === 1, liftedFraction("I am not a big fan of it", act));
  check("an unrelated line scores low", liftedFraction("then eat it yourself i have work in the morning", act) < 0.35);
  check("a fragment under four words is not measured", liftedFraction("sous vide", act) === 0);
  check("an empty action never accuses anybody", liftedFraction("I am not a big fan of it", "") === 0);
  check("length gates the verdict, not the ratio",
    liftedFraction("I am not a big fan", act) === 1 && !isParrot("I am not a big fan", act));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
