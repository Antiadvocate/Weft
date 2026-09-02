/**
 * SCENE REGISTER — what kind of moment this is, read off the recent prose.
 *
 * The engine has always had this read. It lived as three inline regexes inside turn.ts, computed
 * once, and spent on exactly one consumer: CROSS-TALK, the nudge that makes two NPCs talk to each
 * other instead of at the player. The comment there is right about why it exists — "if the scene is
 * intimate, dangerous, tense, or stunned, silence or a single held beat is correct — do not force
 * banter that breaks it" — and that reasoning is not specific to cross-talk. It applies to every
 * per-turn injection that hands the narrator something it MUST put on the page.
 *
 * There are several of those, and they are written to be unrefusable, because each was built to fix
 * a narrator that ignored the thing. Read together, in the wrong scene, they compose:
 *
 *   · the core-trait rotation (authored.ts): "NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE ... If
 *     the scene seems to leave no room, that is the instruction — make the room."
 *   · the schedule heads-up (schedule.ts): "they may say how much time they have"
 *   · the digest's standing line: "Give at least one present character something to say this turn
 *     that is not about the plot and not about the player."
 *
 * A save where all three landed on the same turns, in a shower, mid-sex. The rotation reached
 * "Talks to her plants by name and scolds them when they droop", so she said "Blanche needs water.
 * That droopy bastard is judging us from the living room." The schedule said she had a heads-up on
 * a work block, so three consecutive turns counted down: twenty minutes, nineteen minutes, fourteen
 * minutes. The player, reasonably: "Who talks like this during sex? What is up with the fucking
 * dialogue?"
 *
 * None of those injections is wrong. Each is wrong THIS TURN. So the read moves here, where every
 * consumer can have it, and the mandates stand down in the registers that cannot carry them —
 * they are deferred, not cancelled: the trait fires next turn, the clock is still running, and the
 * character still has somewhere to be.
 */

/** Bodies, closeness, sex. */
const INTIMATE = /\b(kiss|kissed|kissing|naked|undress|undressed|bare|caress|breath|whisper|moan|trembl|skin|intimate|tender|make love|between them|close enough to|foreheads?|cock|cunt|nipple|thrust|aroused|arousal|orgasm|climax|panting|straddl|grind|lick|suck|swallow|on (?:his|her|their) knees|in (?:his|her|their) mouth|inside (?:him|her|them))\b/i;

/** Violence, threat, stealth. */
const DANGEROUS = /\b(gun|knife|blade|blood|scream|silence|frozen|frozen still|don'?t move|hold your breath|creeping|sneak|stalk|hiding|hidden|hunt|predator|snarl|growl|aim|barrel|trigger|corpse|body|dying|dead)\b/i;

/** A held standoff, shock, grief. */
const HUSHED = /\b(standoff|stared|staring|neither (spoke|moved)|no one (spoke|moved)|held (his|her|their|xer) breath|dead quiet|deathly|shock|stunned|reeling|grief|sobb|weeping)\b/i;

export interface SceneRegister {
  intimate: boolean;
  dangerous: boolean;
  hushed: boolean;
  /** True when this is a moment an unrefusable side-errand would break. The union, named once so
   *  every caller asks the same question and a later register lands everywhere at once. */
  guarded: boolean;
}

/** Read the register from recent prose plus whatever the player just typed. */
export function sceneRegister(text: string): SceneRegister {
  const t = String(text ?? "").toLowerCase();
  const intimate = INTIMATE.test(t);
  const dangerous = DANGEROUS.test(t);
  const hushed = HUSHED.test(t);
  return { intimate, dangerous, hushed, guarded: intimate || dangerous || hushed };
}
