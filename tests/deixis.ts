/* Smoke test: "YOU KEEP SAYING YOU'VE NEVER HAD IT."
 *
 * The player typed, in one message across channels:
 *
 *   I eat the salmon "I don't know what you need to see. It's salmon sous vide. I'm not a big fan
 *   of it. I'm a fan of what you made. But I think you would enjoy this since you've never had it"
 *   I take a few bites of the salmon and push the plate away.
 *
 * He said HE does not much like the dish, and that SHE would enjoy it because SHE has never had it.
 * She answered: "You keep saying you've never had it, and then you push it away."
 *
 * Every referent is swapped. She has taken a thing he said about her, attributed it to him, and
 * caught him in a contradiction he did not make — so the player spends his next turn arguing about
 * a line nobody spoke.
 *
 * The channel note is long and careful and is entirely about WHICH CHANNEL a span belongs to: what
 * is audible, what is a private thought, what is a parenthetical inner state, and that a quoted line
 * is the player's own voice and must not be reassigned. It never says whose mouth the pronouns
 * inside that line are anchored in. Nothing anywhere did. Four passes read the player's raw input
 * and all four had to infer it: the narrator, the say-mode frame, the bookkeeper, and — the one that
 * actually authored her reply — the intent pass, which runs on the cheap model and whose output is
 * the stance the narrator then plays.
 */
import { readFileSync } from "node:fs";
import { deixisNote } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the rule says both halves ─────────────────────────────────────────────── */
{
  const n = deixisNote();
  check("first person is bound to the player", /\bI, me, my, mine and myself are the PLAYER\b/.test(n), n);
  check("second person is bound to the listener", /you and your are the person the player is SPEAKING TO/.test(n), n);
  check("and it says outright that the listener is not the player", /never the player themselves/.test(n), n);
  check("it names the failure it exists for", /puts a line in their mouth they did not speak/.test(n), n);
}

/* ── 2. and it can name the person being addressed ────────────────────────────── */
{
  const n = deixisNote("Lucia");
  check("the addressee is named when known", /which in this beat is Lucia/.test(n), n);
  check("without it the rule still stands on its own", !/which in this beat/.test(deixisNote()), deixisNote());
  check("an empty name is treated as unknown", !/which in this beat/.test(deixisNote("")), deixisNote(""));
}

/* ── 3. every pass that reads the raw action carries it ───────────────────────── */
{
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  const intent = readFileSync("src/engine/intent.ts", "utf8");

  // the narrator, on an ordinary `do` turn
  const channelNote = /const INLINE_CHANNEL_NOTE = `[^`]*`/.exec(turn)?.[0] ?? "";
  check("the narrator's channel note carries it", /\$\{deixisNote\(\)\}/.test(channelNote), channelNote.slice(-120));

  // say-mode, which had no framing on the player's words at all
  const sayFrame = /say: \(a\) => `[^`]*`/.exec(turn)?.[0] ?? "";
  check("say-mode carries it", /\$\{deixisNote\(\)\}/.test(sayFrame), sayFrame);

  // the bookkeeper, which decides what everyone LEARNED from the line
  const bk = /const bookkeeperAction = `[^`]*`/.exec(turn)?.[0] ?? "";
  check("the bookkeeper carries it", /\$\{deixisNote\(\)\}/.test(bk), bk.slice(0, 200));

  // the intent pass — the one that wrote her reply, and the only one that knows who is addressed
  check("the intent pass carries it", /deixisNote\(c\.name\)/.test(intent));
  check("...and passes the character's own name, since it knows it", /deixisNote\(c\.name\)/.test(intent));
}

/* ── 4. it is written flat, not as an epigram ─────────────────────────────────── */
{
  // an instruction phrased as an aphorism teaches an aphorism; the prose comes back sounding like
  // the rules document. This one also must not hand the model a quotable line to reproduce.
  const n = deixisNote("Lucia");
  check("no quoted specimen the narrator could copy", !/["“][^"”]{15,}["”]/.test(n), n);
  check("and no balanced maxim", !/\bis not a\b|\bis the\b.*\bnot the\b/.test(n), n);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
