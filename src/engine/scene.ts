/**
 * SCENE STRUCTURE — when a scene is finished, and what to do about it.
 *
 * A screenplay reading feels natural moment to moment and still arrives somewhere, because a scene
 * is a UNIT: it has a beat to play, it plays it, and then the film CUTS. What happens between the
 * cuts — the drive over, the afternoon, the ordinary business of getting from one room to the next —
 * the director supplies in a line of slug text and nobody misses it.
 *
 * Weft had no unit. Every turn was one beat at the same granularity, forever, in the same room,
 * until the player typed a movement. So the player was doing the director's job by hand: "I do the
 * laundry, then I go see Marcus." That is a real thing a player may want to do, and it should keep
 * working — but it should not be the only way a story ever changes location or time. Left alone, a
 * scene should end by itself, the way scenes do.
 *
 * The scene clock already existed (`world.scene_started_time`, reset on a location change or a
 * two-hour jump) and was printed to the narrator as "scene running ~N min". Nothing read it. This
 * reads it, together with what the pressure system has been finding, and answers one question: has
 * this scene spent itself?
 *
 * SPENT is deliberately conservative. A scene is not over because it is quiet — quiet is where most
 * of a domestic story lives, and cutting away from it would be exactly the "boredom as horror"
 * failure in reverse. It is over when it has been running a long while AND nothing has entered it
 * for several turns AND nobody present is mid-pursuit. That is a scene with nothing left to give,
 * which is a different thing from a calm one.
 */
import type { SaveState } from "./types";
import { minutesBetween } from "./time";

/** In-scene minutes before a scene can be considered spent at all. */
const SCENE_LONG_MIN = 75;
/** Consecutive low-pressure turns that mean nothing new is entering. */
const FLAT_TURNS = 4;
/** Pressure at or below this is "nothing arrived". */
const FLAT_BAND = 2;

export interface SceneRead {
  minutes: number;
  flatFor: number;
  spent: boolean;
  /** Why not, when it isn't — for the log, and so this is debuggable from a save. */
  reason: string;
}

export function readScene(state: SaveState): SceneRead {
  const minutes = Math.max(0, minutesBetween(state.world.scene_started_time ?? state.world.current_time, state.world.current_time));
  const trace = state.pressure_trace ?? [];
  let flatFor = 0;
  for (let i = trace.length - 1; i >= 0 && trace[i] <= FLAT_BAND; i--) flatFor++;

  const mk = (spent: boolean, reason: string): SceneRead => ({ minutes, flatFor, spent, reason });

  if (minutes < SCENE_LONG_MIN) return mk(false, "still young");
  if (flatFor < FLAT_TURNS) return mk(false, "something is still arriving");
  // A DUE CONSEQUENCE IS THE SCENE'S REASON TO EXIST. Never cut away from one about to land.
  if ((state.world.consequences ?? []).some((c) => c.status === "pending")) return mk(false, "a consequence is pending");
  // Nobody present may be mid-pursuit. A want that has moved recently is a scene still doing work,
  // however quietly — this is the difference between a lull and an ending.
  const midPursuit = state.world.present.some((id) => {
    const d = state.characters[id]?.drive;
    if (!d) return false;
    const moved = d.progress_turn !== undefined && state.world.current_turn - d.progress_turn <= 3;
    return moved && d.progress > 0 && d.progress < 100;
  });
  if (midPursuit) return mk(false, "somebody present is mid-pursuit");
  return mk(true, "spent");
}

/** The player is going under, or already is. The engine has had this regex since sleep credit
 *  existed — it just ran in the apply phase, long after the narrator had already written the turn. */
// The SUBJECT has to be the player. A bare verb match read "I ask her whether the baby slept through
// the night" as the player losing consciousness, which would blank the camera on an ordinary line of
// dialogue. Player actions are written in the first person, so require that and keep the gap short.
const UNDER = /\bI(?:'m|\s+am)?\s+(?:\w+\s+){0,2}(?:sleep|sleeping|asleep|nap|napping|doze|dozing|pass out|passing out|black out|blacking out|lie down|bed down|turn in|go to bed|going to bed|call it a night)\b/i;
const UNCONSCIOUS_COND = /\b(asleep|sleeping|unconscious|blacked out|knocked out|passed out|comatose|sedated|drugged)\b/i;

/**
 * THE CAMERA DOES NOT FLOAT FREE WHEN NOBODY IS BEHIND IT.
 *
 * The POV rule pins the camera to the player and says every sentence must report something they
 * could see, hear, smell or touch. It has no notion of the player being unable to perceive at all.
 * So on a turn where the player falls asleep, the camera stays in the room, the player does nothing,
 * and the only material left is the other person — which is how a save ended up with:
 *
 *     "When she was sure he was deep under, she let herself look at him — really look, the way she
 *      hadn't allowed herself while he was awake… she felt a sudden sharp ache in her chest that she
 *      didn't have a clinical word for."
 *
 * Every clause of that is unobservable by anyone in the fiction. And it is not only a style failure:
 * by the POV rule's own argument, whatever is written becomes the record, so a scene nobody witnessed
 * is filed as something the player knows.
 */
export function perceptionGapDirective(state: SaveState, action: string): string {
  const cond = state.condition["char_player"];
  const out = (cond?.conditions ?? []).some((c) => UNCONSCIOUS_COND.test(c)) || UNDER.test(action);
  if (!out) return "";
  return `
THE PLAYER IS GOING UNDER (asleep, or otherwise not perceiving). There is no observer in this scene now, and the camera does not float free when nobody is behind it. Write only what a body that is going under still registers — a touch, a weight, a sound, warmth, the light going out — and stop when that stops. Nobody else's face, expression, private gesture, or inner life may be rendered while the player cannot see it: not what they do once he is under, not what they let themselves feel, not what they look at. This is the record rule, not a style note — what you write is filed as something the player witnessed, and a person alone with a sleeping man is credited with having been watched.
End the turn on the last thing he could actually register, or cross straight to waking. What happened while he was under reaches him the way anything does: he is told, he finds a trace of it, or he never learns it at all.`;
}

/**
 * What the narrator is told when a scene is finished.
 *
 * Two permissions, and they are permissions rather than orders on purpose. The player may be
 * enjoying exactly this room, and a story that ejects them from it the moment the pressure reading
 * dips is a story that will not let them sit anywhere. So: END it, on the page, the way scenes end —
 * and then the ordinary connective business may be CROSSED rather than played, which is the thing
 * the player has been supplying by hand.
 */
export function sceneCutDirective(read: SceneRead): string {
  if (!read.spent) return "";
  return `
THIS SCENE HAS SPENT ITSELF (${Math.round(read.minutes)} minutes in, nothing new for ${read.flatFor} turns). Bring it to a close ON THE PAGE, the way scenes actually close — someone stands up, the food is finished, a phone goes, the light changes, somebody says the thing that is obviously last and means it. Do not hold the player in this room waiting for them to type an exit.
Then you MAY CUT. The ordinary connective time — the walk, the drive, the rest of the afternoon, the queue, the shower — can be crossed in a line rather than played out, and the next thing begun where it actually starts. This is the one place you may move the player's body without being told to: they leave a finished scene the way anyone leaves one, toward something already true in the state — a place they were going, a person expecting them, a thing they said they would do. Never invent an errand to justify the cut, and never cut into a confrontation the player has not chosen.
If the player's action this turn is itself a move or a departure, they have already ended it — just carry it, and cut.`;
}
