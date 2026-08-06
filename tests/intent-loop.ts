/* Smoke test: NOBODY TESTS THE SAME QUESTION SIX TIMES.
 *
 * The intent pass authors what a character is ACTUALLY doing beneath what they show, and it is
 * built fresh each beat from the character, their want, their mood, their edge, and the player's
 * action. Nothing about what was written for them last turn. So when the standing state does not
 * move — a want only the player can satisfy, a warm-but-guarded edge — six independent calls derive
 * the same intent six times. Straight out of one save's gm_intents:
 *
 *   t19  She is testing whether he will meet her as a person or keep her at arm's length.
 *   t20  She is testing whether he can drop the ceremony and say something real to her.
 *   t21  She is testing whether his hurt is real or another deflection.
 *   t22  She is testing whether he will trust her enough to be honest.
 *   t23  She needs the reason he left, the one he has not said.
 *   t24  She is testing whether he will offer it freely.
 *
 * The player answered every one and was told each time it was not the thing, without ever being
 * told what the thing was. Even on the beat where the confession lands and she says outright
 * "that's what I was waiting for", the next beat opens another test. Her own drive blocker read
 * "tells him plainly what she has kept for him and what she now requires in return" — the engine
 * had the answer and the intent pass talked over it. */
import { newSave, registerCharacter } from "../src/engine/state";
import { priorIntents, repeatedIntent } from "../src/engine/intent";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const REAL = [
  "She wants him to drop the ceremony and speak from the hollow place he hides. She is testing whether he will meet her as a person or keep her at arm's length with titles.",
  "She is testing whether he can drop the ceremony and say something real to her, not just mirror her words.",
  "She is testing whether his hurt is real or another deflection, because she needs him to name the true reason he left his city before she can decide what she is forgiving.",
  "She is hurt by his deflection and wants him to stop hiding behind cleverness. She is testing whether he will trust her enough to be honest.",
  "She is moved by his admission, but she wants him to name what she is worth to him. She is testing whether he will offer it freely.",
];

/* 1. the loop is detected on the real data */
{
  for (let i = 1; i < REAL.length; i++) {
    check(`consecutive beats ${i} and ${i + 1} read as the same intent`, repeatedIntent(REAL.slice(0, i + 1)), REAL[i]);
  }
  check("one beat alone is never a repeat", !repeatedIntent([REAL[0]]));
  check("an empty history is never a repeat", !repeatedIntent([]));
}

/* 2. a scene that is actually moving is left alone */
{
  const moving = [
    "She is frightened of the men outside and wants to be gone before they come in.",
    "She has decided to tell him about the charter tonight, whatever it costs her.",
  ];
  check("two different intents are not a loop", !repeatedIntent(moving), moving);

  const afterYes = [
    "She is testing whether he will name the reason he left.",
    "He named it. She is relieved and does not know where to put her hands, and wants to be touched without having to ask.",
  ];
  check("taking the yes is not a repeat", !repeatedIntent(afterYes), afterYes);
}

/* 3. the frame is what matters, not the words — the tails diverge every time */
{
  check("'waiting to see if' is the same move as 'testing whether'",
    repeatedIntent(["She is testing whether he will speak plainly.", "She is waiting to see if he will offer the truth unprompted."]));
  check("and 'seeing whether' too",
    repeatedIntent(["She is waiting for him to name it.", "She is seeing whether he names it without being asked."]));
  check("plain token overlap still catches a restatement",
    repeatedIntent(["She wants the charter signed before the frost.", "She wants the charter signed before the frost comes."]));
}

/* 4. what the pass is actually given */
{
  const s: SaveState = newSave("intent", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const m = registerCharacter(s, { name: "Mable" } as any);
  const other = registerCharacter(s, { name: "Gerard" } as any);
  s.history = REAL.map((truth, i) => ({
    turn: 19 + i, player_action: "", narrator_prose: "", summary: "", offscreen: [], time_label: "", weather: "",
    gm_intents: [
      { char_id: m, name: "Mable", surface: "still, watchful", truth, lying: false },
      { char_id: other, name: "Gerard", surface: "tired", truth: "He wants to go home.", lying: false },
    ],
  })) as any;

  const prior = priorIntents(s, m);
  check("the last four beats are recovered", prior.length === 4, prior.length);
  check("newest last", prior[prior.length - 1] === REAL[REAL.length - 1]);
  check("another character's intents are not mixed in", !prior.some((p) => /go home/.test(p)), prior);
  check("and theirs come back on their own", priorIntents(s, other).every((p) => /go home/.test(p)));
  check("a character never written for has no history", priorIntents(s, "char_nobody").length === 0);
  check("the window is respected", priorIntents(s, m, 2).length === 2);
  check("the recovered run is recognised as stuck", repeatedIntent(prior), prior);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
