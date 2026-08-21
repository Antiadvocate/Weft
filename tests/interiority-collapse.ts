/* Smoke test: THREE PEOPLE WITH NO INSIDES.
 *
 * A 47-turn save. The player: "she has zero interior and has just continuously repeated her story
 * with Chloe. Non stop. Like there is no indirectness which we tried to once add. It's just like
 * BAM." Turn 45, the scene the whole story had been building to, and the character says:
 *
 *   "The Ashford Design Fellowship. The email came this morning. I didn't — I was going to tell you
 *    at dinner, and then you came home and I couldn't —"
 *   "I keep thinking about what that judge said. About — bodies. And I keep thinking, what if they
 *    look me up."
 *   "I should have told you this morning. I should have answered your text. I know that."
 *
 * A complete emotional disclosure, with motive and self-reproach, delivered flat. Her card says
 * "clipped, guarded, deflects with the surface detail of a room. answers a different question than
 * the one asked; changes subject to an object. quick pivots, never lingers on the tender thing."
 * She is doing the exact opposite of herself, and had been for forty turns.
 *
 * THREE DEFECTS, EACH ONE A SINGLE POINT, ALL FEEDING THE SAME SYMPTOM.
 *
 *  1. THE CENTRAL GATE. turn.ts asked `if (!characters[id]?.central) continue` before the
 *     theory-of-mind update. Everywhere else in the engine — sixteen sites — non-central is written
 *     `central === false`, so an unset flag means central, and the forge never sets it. So that one
 *     line skipped every character in every save. `minds: {}` at turn 47: nobody had ever been wrong
 *     about anybody, there were no held_false beliefs, the narrator never got a MINDS block, and the
 *     intent pass lost its richest stake ("wrongly believes: …").
 *
 *  2. THE COLLAPSE. `truth: j.truth ?? j.surface` — when the model omitted truth, the engine filed
 *     the character's POSTURE as their inner state. 29 of 43 intents in that save came back with the
 *     two fields byte-identical, turn 45 among them. The bookkeeper was then told that "she sets the
 *     book aside and meets his gaze with a steady, open look" was her true inner state, and the
 *     prose had nothing to hold back.
 *
 *  3. NO DOOR. All three characters carried `approach: null`. The approach only survives a
 *     bookkeeper rewrite while the goal is unchanged, and goals change constantly. Without it the
 *     intent pass has nothing to build a surface from except the want — and a surface that IS the
 *     want is an announcement, which the rule at intent.ts already names in those words.
 */
import { collapsed } from "../src/engine/intent";
import { doorFromVoice } from "../src/engine/coerce";
import { stripMetaPlayer } from "../src/engine/echo";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the collapse detector, on the save's own intents ─────────────────────── */
{
  // turn 45, verbatim from the save — both fields identical
  const s45 = "She sets the book aside, hands folded in her lap, and meets his gaze with a steady, open look.";
  check("byte-identical is a collapse", collapsed(s45, s45));

  // turn 42, verbatim — the one that worked
  const s42 = "She sets her phone face-down on the armrest and shifts to face you, the blanket slipping from her shoulders. Her voice is quiet, almost careful, as she says she didn't mean to ignore you.";
  const t42 = "She's relieved you're home, but the sting of your words lingers. She wants to close the distance, to ask you to stay.";
  check("a real inside/outside pair is NOT a collapse", !collapsed(s42, t42), { s42, t42 });

  // a near-copy with the words shuffled is still a copy
  check("a reworded copy is still a collapse",
    collapsed("She folds her hands in her lap and meets his gaze steadily.",
              "She meets his gaze steadily, hands folded in her lap."));
  check("an empty truth is a collapse", collapsed(s45, ""));
  check("...so the intent gets dropped rather than filed as an interior", collapsed(s45, "   "));
}

/* ── 2. the door, derived from the person when the want has none ─────────────── */
{
  // Miranda's actual voice block from the save
  const miranda = { voice: {
    agenda: "to steer any conversation off the closed door and back to something she can point at",
    tics: ["swerves to the physical environment when pressed", "asks about logistics to stop a personal question"],
  } };
  const door = doorFromVoice(miranda);
  check("a person with a voice always has a door", !!door, door);
  check("...built from what they angle for", /steer any conversation off the closed door/.test(door ?? ""));
  check("...and the moves they use to do it", /swerves to the physical environment/.test(door ?? ""));
  check("somebody with no voice block gets none rather than an invented one",
    doorFromVoice({}) === undefined && doorFromVoice(undefined) === undefined);
  check("tics alone are enough", !!doorFromVoice({ voice: { tics: ["changes the subject to an object"] } }));
}

/* ── 3. the machinery naming itself on the page ──────────────────────────────── */
{
  // turn 46, verbatim
  const leak = "The trembling Vin's player couldn't see was not trembling — her fingers were still.";
  const r = stripMetaPlayer(leak, "Vin");
  check("the meta-possessive is repaired", !/player/i.test(r.prose), r.prose);
  check("...and the sentence survives", /her fingers were still/.test(r.prose), r.prose);
  check("...and it is counted", r.fixed === 1, r.fixed);

  const bare = stripMetaPlayer("The player crossed the room.", "Vin");
  check("a bare 'the player' is repaired to the name", /^Vin crossed/.test(bare.prose), bare.prose);

  // and the things a world is allowed to contain
  for (const ok of [
    "The piano player did not look up.",
    "The card players went quiet.",
    "A company of players had set up in the square.",
  ]) {
    const res = stripMetaPlayer(ok, "Vin");
    check(`left alone: ${ok.slice(0, 28)}…`, res.fixed === 0 && res.prose === ok, res.prose);
  }
  check("prose with no leak is returned untouched",
    stripMetaPlayer("She set the book down.", "Vin").fixed === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
