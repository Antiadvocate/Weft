/* Smoke test: THE NARRATOR STATING SOMEBODY'S INTERIOR, AND THE ENGINE NOTICING.
 *
 * From a save, turn 43 — the player is asleep, and the camera stays on the woman beside him:
 *
 *     "When she was sure he was deep under, she let herself look at him — really look, the way she
 *      hadn't allowed herself while he was awake… she felt a sudden sharp ache in her chest that she
 *      didn't have a clinical word for."
 *
 * Every clause of that is unobservable by anyone in the fiction. Two separate failures produced it.
 *
 * 1. THE POV RULE HAS NO NOTION OF A PLAYER WHO CANNOT PERCEIVE. It pins the camera to the player
 *    and requires every sentence to report what they could see or hear "from where they actually
 *    are". Asleep, they are nowhere — so the camera stays in the room, the player does nothing, and
 *    the only material left is the other person's inside. The engine knew he was sleeping: the same
 *    SLEEP_INTENT regex that credits rest ran in the apply phase, long after the prose was written.
 *
 * 2. MOTIVE_LEAK COULD NOT SEE THE PLAINEST FORMS. Every family in it caught interiority smuggled
 *    through a hedge, a simile, or a role comparison. None caught it stated outright — a named
 *    feeling, self-permission, stated knowledge — which is exactly what a model writes when the
 *    scene has given it nothing else. The detector then fed a scrubber that silently cleaned the
 *    replayed history so the model would not learn from itself, and told nobody, so the narrator
 *    went on making the move. It is quoted back at it now. */
import { newSave, registerCharacter } from "../src/engine/state";
import { scrubForReplay } from "../src/engine/turn";
import { perceptionGapDirective } from "../src/engine/scene";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const caught = (s: string) => scrubForReplay(s).trim() === "";

/* ── 1. the three plainest forms, from the save that produced them ───────────── */
{
  check("a named feeling is interiority",
    caught("He looked younger like this, and she felt a sudden sharp ache in her chest that she didn't have a clinical word for."));
  check("self-permission is interiority",
    caught("When she was sure he was deep under, she let herself look at him — really look, the way she hadn't allowed herself while he was awake."));
  check("stated knowledge is interiority", caught("She knew he would not ask again."));
  check("so is a stated decision", caught("She decided she would tell him in the morning."));
  check("and stated certainty", caught("Once she was certain he was asleep, she got up."));
}

/* ── the false positives that would make this useless ────────────────────────── */
{
  check("a hand on cloth is not a feeling", !caught("She felt the blanket with the back of her hand."));
  check("plain action survives", !caught("She pulled the blanket higher over his shoulder and closed her eyes."));
  check("plain stillness survives", !caught("Jess didn't move for a long time."));
  check("spoken first person survives", !caught('"I knew you would say that," she said, and put the cup down.'));
  check("an observable expression survives", !caught("Her jaw tightened and she looked at the window."));
  check("letting go of an object is not self-permission", !caught("She let the door swing shut behind her."));
}

/* ── 2. the camera has nobody behind it ──────────────────────────────────────── */
function sleeper(): SaveState {
  const s = newSave("leak", {
    name: "CuldeSac of the Heart",
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
  } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Jess", character_id: "char_jess" } as any);
  s.world.current_turn = 43;
  s.world.present = ["char_jess"];
  return s;
}
{
  const s = sleeper();
  const d = perceptionGapDirective(s, "I fall asleep with my face against her foot.");
  check("going to sleep is recognised from the action", d !== "", d.slice(0, 80));
  check("and the rule is the record rule, not a style note", /filed as something the player witnessed/.test(d));
  check("it names what may still be written", /touch|weight|sound|warmth/.test(d));
  check("and how the scene ends", /cross straight to waking/.test(d));
}
{
  const s = sleeper();
  s.condition.char_player.conditions = ["unconscious"];
  check("an unconscious player counts too", perceptionGapDirective(s, "I try to stand.") !== "");
}
{
  const s = sleeper();
  s.condition.char_player.conditions = ["heading to work"];
  check("an ordinary turn gets no directive", perceptionGapDirective(s, "I ask her what she wants for dinner.") === "");
}
{
  // "sleep" inside an ordinary sentence about somebody else must not blank the camera
  const s = sleeper();
  check("asking about someone else's sleep is not going under",
    perceptionGapDirective(s, "I ask her whether the baby slept through the night.") !== "" ? false : true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
