/** AUTHORED WANTS — changing a person by giving them something to want.
 *
 *  See AuthoredDrive in types.ts for why this exists and why it does not live in `drive`.
 *
 *  This module owns three things: the ladder a standing want climbs, the sentence the rest of the
 *  engine reads it as, and the moment it stops being a want and becomes part of the person.
 *
 *  Nothing here spends a token. Escalation is arithmetic on a turn counter; the world-sim and the
 *  narrator get the want in the same shape they already get every other want, and do what they were
 *  always going to do with it. That is the point — the injector is a manual entry point to
 *  machinery that already works, not a second pathway that has to be kept in step with the first. */
import type { AuthoredDrive, Identity, SaveState } from "./types";
import { noveltyStage } from "./novelty";
import { clipWords, LABEL_MAX } from "./coerce";
import { clipText } from "./text";

/** IN-WORLD HOURS PER RUNG — not turns.
 *
 *  This was turn-counted, and calibrated against a story that runs for weeks. Real games do not:
 *  the save this was built against covered Day 1 to Day 3 in a hundred and eight turns, about a
 *  quarter of an hour of story per turn, and almost nothing on file has ever run past a week. A
 *  want that needed "a few weeks" to mature would simply never mature — it would sit at the bottom
 *  rung until the story ended.
 *
 *  Turns are also the wrong unit in principle. Ten turns is two hours of a slow conversation or
 *  three days across a montage, and a neighbour's late-night parties escalate on nights, not on how
 *  much the player happened to type. The clock already exists; this reads it.
 *
 *  Tuned so all three fit inside a story of a few days: fast lands within one, steady over a couple,
 *  slow needs most of a week and is the one to pick when the story is going to be long. */
// Per RUNG, and there are now five to climb rather than three (see NERVE), so these are scaled to
// keep the TOTAL unchanged: fast still lands inside a day, steady over a couple, slow across most of
// a week. Changing the ladder's length without rescaling these would have quietly made every want
// take almost twice as long to arrive.
const STEP_HOURS: Record<AuthoredDrive["rate"], number> = { slow: 24, steady: 10, fast: 4 };

/** Six rungs: exposure, proximity, examination, the sideways first time, repetition, habit. Past this
 *  it is not escalation any more, it is a different story, and the player can write that one. */
export const MAX_STAGE = 5;

/* HOW A HABIT ACTUALLY FORMS.
 *
 *  The worked example this is built from, and it is worth keeping whole because every rung below is
 *  one of its days:
 *
 *    Day 1  goes to the gas station for coffee, sees the candy, the sheer number of options is
 *           enough to put them off — nothing happens
 *    Day 2  there is a QUEUE, so they are standing near it anyway; they read the calories. Their
 *           turn comes. They ignore it and leave
 *    Day 3  they check the specific brand this time. Hm. That is not too bad. Is it any good —
 *           and then they have to shop
 *    Day 4  they ask the man at the counter: you like these, right? Light for a morning? They take one
 *    Day 5  they skip a day, and next time notice they could use something sweet
 *    Day 6  again, because why not, it is light
 *    Day 10 they always get it
 *
 *  Three things in that which the previous ladder got wrong.
 *
 *  IT IS EXTERNAL BEFORE IT IS INTERNAL. Nothing in the first three days is a decision. A queue puts
 *  them there; the shelf is at eye level; a stranger's opinion is available. The environment supplies
 *  the occasion and they are simply in the right place often enough. So the early rungs are written
 *  as things the SCENE does, not things the character resolves to do.
 *
 *  IT IS NON-SELFED. "There's not a lot of talking about it, you just do the movement." Until it is
 *  already a habit they do not discuss it, name it, or explain it — it shows in the body: where they
 *  stand, what their hands find, what their eyes go back to, what they linger over. The previous
 *  bottom rungs were both about CONVERSATION — a joke that is nearly the subject, a question that
 *  would make sense if the answer were yes — which is the last thing to arrive, not the first.
 *
 *  THE INTERRUPTION IS THE MECHANISM. Twice they get close and something takes them away. That is
 *  what keeps it from being a decision and what makes the eventual doing feel inevitable instead of
 *  chosen. It has to be written in, not skipped past.
 *
 *  And the meaning comes LAST. They do not know why they like it until long after they always get it. */
const NERVE = [
  "STAGE ONE: SHE COMES ACROSS IT. It doesn't happen and nobody mentions it, but there is one concrete thing on the page about it: the scene puts the chance in front of her and she visibly passes it up. She reaches for something else instead, or puts a hand near it and pulls it back, or steps around it. Someone else could describe what she did, even if nobody could say why. There has to be a visible moment even though she doesn't act. If a reader couldn't point at the sentence where it happens, this stage hasn't been written.",
  "STAGE TWO: CIRCUMSTANCE KEEPS HER NEAR IT, and again there is one visible moment. Something unrelated keeps her beside it for longer than she needed to be there, like a wait, a queue or somebody else's errand. She gets a proper look, and the looking is on the page: her attention goes back to it a second time, she stays a moment after she could have left, or she stands closer than the job needs. Then the moment passes and she does nothing. Show it through her body only, and don't write a single word about it.",
  "STAGE THREE: SHE LOOKS IT OVER. Her interest has narrowed from the general thing to one particular one, and it is still something you can see her do: she handles it, weighs it, tries it, gets into position for it, or gets close enough that anyone watching would notice but couldn't prove anything. Then something pulls her away before it happens, and she lets it go. The interruption is required, because it stops this from being a decision, but the approach before the interruption has to actually happen on the page.",
  "STAGE FOUR: THE FIRST TIME, SIDEWAYS. It happens, but it comes about through someone else or with an excuse, like another person's suggestion, going along with what's already happening, or \"since we're here anyway\". The stakes are low, she could deny it meant anything, and it is never presented as her wanting it. This is the first stage where the thing itself actually happens.",
  "STAGE FIVE: AGAIN, BECAUSE IT'S EASY NOW. There's no excuse and no reason given. She might skip it once and notice it's missing, which is the first moment she becomes aware that she wants it, and the first time she might say anything about it at all.",
  "STAGE SIX: IT'S JUST WHAT SHE DOES. There's no occasion and no excuse, because it's part of how her days with this person go. Only now is there anything to say about it, because she only understands what it means once it has become a habit.",
];

/** HOW MUCH OF THIS IS SHOWING, 0.1 to 1.
 *
 *  With `inhabit_turns` set, escalation is a deterministic function of turns since the want was
 *  written: 10% immediately, linear to full at the deadline, so it visibly moves EVERY turn. The
 *  rungs do not move linearly with it — see rampStage. Without a budget, the in-world-hour rungs are
 *  used and this reports where they sit.
 *
 *  The point of the turn budget is not that turns are the truer unit — they are not — but that a
 *  want you cannot see moving is indistinguishable from a want that is broken, and this engine has
 *  produced enough of the second that the first is not worth defending. */
export function intensity(a: AuthoredDrive, _turn?: number): number {
  if (a.inhabit_turns && a.inhabit_turns > 0) return 0.1 + 0.9 * earnedFraction(a);
  return Math.max(0.1, Math.min(1, ((a.stage ?? 0) + 1) / (MAX_STAGE + 1)));
}

/** THE TURNS ARE A CONTRACT. "It must increase the percent if I'm using number of turns. Those turns
 *  aren't suggestions."
 *
 *  I had this gated on turns that actually showed it, which was the right answer to a different
 *  question. The evidence gate was added because a want was reaching 100% and hardening into a core
 *  trait having never once appeared — the problem there was COMPLETION without evidence, not
 *  progress on a schedule. Gating the schedule itself handed the narrator a veto over the player's
 *  own instruction: ignore it and it never advances, which is the AI overriding the injection.
 *
 *  So the clock is the clock, and `turns_live` is the only input. Nothing reads the prose back to
 *  decide whether a turn counted; see `tickAuthored` for why that check had to go rather than be
 *  fixed a fourth time. `seen` / `stalled` / `last_seen_turn` survive on the type only so that saves
 *  written while the detector existed still load. */
function earnedFraction(a: AuthoredDrive): number {
  if (!a.inhabit_turns || a.inhabit_turns <= 0) return 0;
  return Math.max(0, Math.min(1, (a.turns_live ?? 0) / a.inhabit_turns));
}

/** WHERE ON THE RAMP, and the shape of the ramp is the whole feature.
 *
 *  The first version put the percentage on a logarithmic curve, because "escalating logarithmically"
 *  was what was asked for. That was a misreading, and it produced precisely the failure it was meant
 *  to fix: a log curve is steepest at the start, so two turns into a ten-turn budget the want was
 *  already at 55% and the ladder said GO AT IT. Dana brought it up out of nowhere, which is what
 *  prompted all of this.
 *
 *  Habituation is the other shape. Nearly HALF the window is spent not doing it at all — noticing
 *  the openings, changing the subject away from it. Then circling. The attempt belongs in the last
 *  quarter, by which point several scenes have quietly been about it and nobody is surprised. The
 *  displayed percentage stays linear so it visibly moves every single turn, which is what makes the
 *  thing checkable; it is the STAGE that waits. */
function rampStage(a: AuthoredDrive): number {
  const p = earnedFraction(a);
  // 10–50% of the window is the build-up "through external means that are noticeable" — three rungs
  // in which the thing never once happens. The first time it happens is past halfway, sideways.
  if (p >= 1) return 5;      // simply what they do
  if (p >= 0.70) return 4;   // again, because it is easy
  if (p >= 0.50) return 3;   // the sideways first time
  if (p >= 0.35) return 2;   // examining it
  if (p >= 0.20) return 1;   // near it, by circumstance
  return 0;                  // exposure
}

/** True when this person has a live authored want that should be acting on the world. */
export function liveAuthored(c: Identity | undefined): AuthoredDrive[] {
  return (c?.authored ?? []).filter((a) => a?.goal && !a.crystallized_turn && !a.paused);
}

/** WHAT THEY SIMPLY DO NOW — habits that finished forming and are still part of the person.
 *
 *  Crystallising used to REMOVE the want: hasAuthored went false, the wants slot lost it, and it
 *  survived only as one line among five in core_traits, which nothing obliges anybody to act on. So
 *  the reward for a habit completing was that it stopped appearing — "once it's solidified it
 *  doesn't show up at all", which is worse than never having formed. A finished habit is the most
 *  reliable thing about a person and belongs on the card permanently. */
export function settledAuthored(c: Identity | undefined): AuthoredDrive[] {
  return (c?.authored ?? []).filter((a) => a?.goal && a.crystallized_turn && !a.paused);
}
export function hasAuthored(c: Identity | undefined): boolean {
  return liveAuthored(c).length > 0;
}

/** BIND "IT" TO THE ACTUAL THING.
 *
 *  The top three rungs read "It happens", "AGAIN, BECAUSE IT IS EASY NOW", "SIMPLY WHAT SHE DOES" —
 *  and nowhere in any of those sentences is "it" attached to the goal. The goal is printed at the
 *  FRONT of the line and then several clauses of ladder theory go by, so by the operative verb the
 *  nearest available referent is whatever the narrator has already put in the scene.
 *
 *  On the save that prompted this, that referent was a worn pack strap. The want ran 60% → 80% →
 *  100%, three turns at the rungs where the act is supposed to occur, and what got written was her
 *  strap slipping and her collar pulling aside to show a scar — the same beat twice, nearly word for
 *  word. Every one of those paragraphs satisfies "it happens" if "it" is allowed to mean the mildest
 *  thing already on the page, and a model will always let it mean that: the sideways rung explicitly
 *  asks for deniable and low-stakes, which reads as licence to pick the smallest possible referent.
 *
 *  So from the rung where the act first occurs, the goal is restated as the literal content of the
 *  beat, and the near-miss is named as the failure it is. The lower rungs get the opposite guard,
 *  because there the near-miss is the whole assignment. */
function bind(a: AuthoredDrive, stage: number): string {
  const g = a.goal.trim().replace(/\.$/, "");
  if (stage < 3) {
    return ` At this stage the thing itself doesn't happen yet, and the thing itself is: ${g}. What goes on the page is her getting close to it and turning away from it, written so that a reader who had been told how this ends would recognise it as the beginning.`;
  }
  return ` And "it" means this, literally and physically: ${g}. That act happens in this turn's prose, clearly enough that nobody could mistake it for anything else. A move toward it doesn't count, and neither does a gesture that looks like it, a moment of skin showing, or a hand or a look that someone who already knew would read that way. Those belong to the earlier stages, and writing one of them here means writing the wrong stage. To check, imagine cutting the act out of your paragraph: if the paragraph still makes sense without it, you didn't write it. It also can't be the same moment as last turn, because repeating the same near miss stalls the story while making it look as though it's moving.${THRESHOLD}`;
}

/** WHEN THE ACT IS THE PLAYER'S TO PERFORM.
 *
 *  A want can name the player as the one who has to move — "makes him do X" — and then the rung above
 *  is an order the narrator is forbidden to carry out. The narration stops at the point where a
 *  choice begins; that rule is not negotiable and is not one I will trade away for this feature,
 *  because it is the difference between a story the player is in and a story played at them.
 *
 *  On the save this comes from, that collision is visible to the sentence. Dana rolls her shoulder,
 *  her arm lifts, the sleeve rides up, "she held it there", "the hollow of her armpit bare and
 *  close", "you carry your share" — her entire half, complete, unhedged — and then the paragraph
 *  cuts to Liz. The narrator obeyed both rules in the only way both can be obeyed at once.
 *
 *  BUT THE CLAUSE THAT SAID SO WAS WRONG ABOUT WHAT A CHOICE IS, and a later save shows the cost.
 *  It opened "IF THE ACT REQUIRES THE PLAYER'S BODY OR THE PLAYER'S ASSENT, YOU CANNOT WRITE IT AND
 *  MUST NOT TRY", which folds two different things into one prohibition. A want whose act happens ON
 *  the player requires the player's BODY in the sense that they have to be standing there — and by
 *  that reading almost nothing can be written, because every touch, every handed object, every
 *  shove in this engine requires the player's body. A player authored a want, at maximum stage,
 *  fully intact in the prompt, and got five turns of dishes, mail and a straightened collar. What
 *  the narrator wrote instead of her half WAS her half, as the clause defined it: everything up to
 *  the point of contact, which here is everything except the want.
 *
 *  So the line is drawn where it actually belongs. Somebody acting ON the player is a thing that
 *  happens in the world and it is written like anything else that happens. What the narrator may
 *  never write is the player DECIDING — agreeing, refusing, going along, reciprocating, or being
 *  given a feeling about it. That is the sovereignty rule stated exactly, and stating it exactly is
 *  what stops it from swallowing the instruction it is attached to.
 *
 *  No classifier decides which branch applies — the model can see whose body the goal names better
 *  than a regex can. What matters is that both halves are written as full requirements. */
const THRESHOLD = ` WHOSE MOVE THIS IS. Write everything that is hers, all the way through. She is a person doing something, and the fact that the player is there for it, is touched by it, or is the one it's done to doesn't make it the player's move. People in this world reach for the player, hand them things and take hold of them, and that goes on the page like anything else that happens. Her part is the act itself, stated plainly in what she does, and it isn't hedged, taken back in the same turn, covered up with a joke, or put off until a later scene.

IT STOPS WHERE THE PLAYER HAS TO DECIDE. Never write the player agreeing, refusing, allowing it, going along with it, doing it back, moving on purpose, enjoying it or minding it, and never give them a feeling about it, because that is theirs to type. When the act can't go any further without the player doing something, the turn ends there, with her move complete and the choice in front of them. Don't move on to another character's business afterwards, because that closes the moment before the player can respond to it.`


/** The want as one line, in the same grammar as every other want on the card.
 *
 *  Provenance is deliberately absent. The narrator must not be told a human typed this — told that,
 *  a model plays it as an instruction to satisfy rather than as something a person wants, and the
 *  result is a character who announces it and gets it over with. The Inspector shows the player
 *  their own hand; the prompt shows a want. */
export function authoredLine(a: AuthoredDrive): string {
  // Computed whenever there is a budget — it used to be gated on a `turn` argument that no longer
  // exists now that progress is earned rather than elapsed, so the percentage silently vanished.
  const i = a.inhabit_turns ? intensity(a) : undefined;
  const stage = !a.inhabit_turns
    ? Math.max(0, Math.min(MAX_STAGE, a.stage | 0))
    : rampStage(a);
  const bits = [a.goal];
  if (a.approach) bits.push("goes at it by: " + a.approach);
  if (a.because) bits.push("started because: " + a.because);
  bits.push("where they are with it: " + NERVE[Math.max(0, stage)] + bind(a, stage));
  // A deadline is stated plainly so the escalation is legible rather than a vibe — and so that a
  // want written by the player is visibly ON A CLOCK rather than optional.
  if (i !== undefined && a.inhabit_turns) {
    bits.push(`CREATE THE OCCASION instead of waiting for one. A habit forms because the world keeps putting the thing within reach, and this world won't do that on its own. Find the reason in the conditions that already exist here: the heat, thirst, the work, what's running short, what hurts, what has to be carried, who is standing where. For example, "There is no water and she is running a fever", "Her bag strap keeps slipping and her hands are full", or "Her joints ache and nobody has salt". The occasion mustn't break any established rule or invent any new fact about the world. It's built from what the scene already contains, so it looks like ordinary circumstance.\n  ${Math.round(i * 100)}% of the way to simply being how they are, and still growing. This is required: write the moment for this stage into this scene, at exactly this strength and no stronger. Below halfway, the act hasn't happened yet and mustn't happen. Even so, "hasn't happened" still needs a visible moment on the page, something physical that a reader could point at. If nothing about it can be seen, the turn got it wrong, and the only other way to get it wrong is to rush ahead to the act`);
  }
  return bits.join(" — ");
}

/** THE LAST THING THE NARRATOR READS ABOUT THIS PERSON.
 *
 *  This is the fix, and it is the same one that fixed the repeated-dialogue bug earlier: a rule
 *  living in the middle of a long document is reference, and a rule at the end is an instruction.
 *
 *  The want has been on the character card the whole time — correct, complete, increasingly emphatic
 *  — sixty percent of the way through a thirty-thousand-character digest, behind a
 *  twenty-seven-thousand-character contract. Every fix I made was making a middle-of-the-document
 *  entry longer, which is not the same as making it louder — six turns of a want at 0%, with the
 *  instruction present and impeccable on every one of them.
 *
 *  The per-turn directive is what a narrator acts on. So the want goes there, after everything else,
 *  next to the player's action — and the card keeps only a one-line reference so the tokens are not
 *  paid twice. */
/**
 * `guarded` — this turn is intimate, dangerous, or hushed (see register.ts). The trait rotation at
 * the bottom of this function is a blind wheel over core_traits, and the block it emits is written
 * to be unrefusable: "If the scene seems to leave no room, that is the instruction — make the
 * room." That is correct for the failure it was built for, a narrator too busy for the character
 * the player wrote, and it is a wrecking ball in a scene where the room is the point. One save's
 * wheel reached "Talks to her plants by name and scolds them when they droop" during sex in a
 * shower, and the narrator, obeying, had her stop and say "Blanche needs water. That droopy bastard
 * is judging us from the living room."
 *
 * So the ROTATION defers on those turns. It is a wheel: the trait it would have ordered comes round
 * again, and a beat it does not get during a two-minute scene is not a beat it loses. What does NOT
 * defer is anything the player authored — `liveAuthored` and `settledAuthored` are the things they
 * asked for by hand, several of them are the reason an intimate scene is happening at all, and
 * silencing those here would be the engine deciding it knows better than the player about their
 * own scene.
 */
export function habitDirective(state: SaveState, presentIds: string[], guarded = false): string {
  const rows: string[] = [];
  // Kept apart from `rows` deliberately. The header over `rows` reads "NOT OPTIONAL ... If the scene
  // seems to leave no room, that is the instruction — make the room", and a standing condition
  // printed under that header is read as an order to stage it, which is the whole failure. The two
  // need different headers because they are asking for opposite things.
  const standing: string[] = [];
  const receded: string[] = [];
  for (const id of presentIds) {
    const c = state.characters[id];
    if (!c || id === "char_player") continue;
    for (const a of settledAuthored(c)) {
      // A FINISHED HABIT STOPS BEING THE SUBJECT OF THE SCENE.
      //
      // This line is written to be unrefusable, and it should be: the failure it was built for is a
      // player authoring a trait and watching the narrator find every turn too busy for it. But it
      // was emitted at full force EVERY turn, for good, and the frame below tells the narrator there
      // is no version of this turn in which it cannot be seen. So a settled want is mandatory, at
      // maximum strength, in every scene the character is in, forever — and the result is the thing
      // the player actually reported: the same act rephrased turn after turn, eating the reading,
      // driving nothing, because there is nothing left to do with it.
      //
      // The engine already has the answer and the two systems were fighting. novelty.ts counts how
      // many times a trait has ACTUALLY been expressed in prose and, past the fifth, tells the
      // narrator it is the floor rather than the subject — do not write a scene about it, write a
      // scene that happens during it. That guidance cannot survive an absolute order in the same
      // prompt, so the order stands down as the ladder takes over: full force until it has landed
      // twice, a reminder while it beds in, and once it is worn the novelty note governs alone.
      const stage = settledStage(state, id, a);
      if (stage === "ground") continue;
      if (stage === "familiar") {
        receded.push(`${c.name}: ${crystallizedLabel(a)}`);
        continue;
      }
      // A STANDING CONDITION BINDS THE SCENE; IT DOES NOT GET STAGED. Ordering "only allows Rabi to
      // eat X" as an act in this turn's opening lines has exactly one reading — interfere with what
      // he is eating, now — and a narrator obeying it every turn produces a character who stops the
      // scene to manage a plate, over and over. What the want actually says is what is TRUE, and a
      // true thing needs no beat: it decides what may happen, and the turns where nothing tests it
      // are turns in which it quietly held. See isStanding.
      if (isStanding(a)) {
        standing.push(`${c.name}: THIS IS SIMPLY TRUE, ALL THE TIME, AND IT ISN'T SOMETHING TO STAGE: ${a.goal.trim().replace(/\.$/, "")}. It was true before this scene started, and it stays true whether or not anything this turn touches on it. Don't open the turn with it, don't have ${c.name} announce it, re-establish it, explain it or enforce it without a reason, and don't invent an occasion to show it off, because showing a rule every turn makes the person look compulsive. What it does is limit what can happen. If the scene runs into it, it holds, and the scene adjusts to it in a single line, without a speech. If the scene never runs into it, it goes unmentioned and nothing is missing. It never overrides what the player says they do: they do what they type, and ${c.name} responds the way this person would.`);
        continue;
      }
      rows.push(`${c.name}: SHE JUST DOES THIS NOW, without deciding to: ${a.goal.trim().replace(/\.$/, "")}. Put the act itself in this turn's prose, fully. It doesn't need an occasion, an excuse or a build-up, and you shouldn't wait for the scene to make room for it, because you're writing the scene, so put it in. She doesn't comment on it and nobody remarks that it's new, because to her it isn't. It's settled between them, so she doesn't ask for it and doesn't work up to it. She assumes it, gets into position for it, waits for it, expects it, picks it up again in the middle of a conversation as though it had never been in question, and doesn't care who is standing there.${THRESHOLD}`);
    }
    for (const a of liveAuthored(c)) {
      rows.push(`${c.name} — ${authoredLine(a)}`);
    }
  }
  // AND THE HABITS THEY ALREADY HAVE. "There are random habits that are never used at all, but they
  // should integrate to make a person, which is why everyone feels like the same person."
  //
  // Correct, and it is the same failure one level up: core_traits are on the card, in the middle of
  // the digest, obliging nobody. Dana sleeps with a wrench in reach and comments on every wasted
  // resource out loud, every time — and neither has ever governed a line. They are listed where
  // things are listed rather than where things are asked for. One of them, chosen by rotation so it
  // is a different one each turn, comes down here with everything else that must actually happen.
  //
  // ...AND THE ROTATION DOES NOT KEEP ORDERING A WORN ONE. `crystallize` writes a finished authored
  // want into core_traits, which is right — it IS one now — and that put it straight back into this
  // rotation as a mandatory beat, so standing the authored mandate down above achieved nothing on
  // the turns the wheel came round to it. The same holds for any trait the character has already
  // been shown living several times over: ordering it again is what makes a person read as a single
  // repeating gesture. The rotation picks from what still has something to establish.
  const traits: string[] = [];
  for (const id of guarded ? [] : presentIds) {
    const c = state.characters[id];
    if (!c || id === "char_player" || !c.core_traits?.length) continue;
    const eligible = c.core_traits.filter((t) => {
      const h = (state.habits?.[id] ?? []).find((x) => x.trait.trim().toLowerCase() === String(t).trim().toLowerCase());
      return !h || noveltyStage(h) !== "ground";
    });
    if (!eligible.length) continue;
    const pick = eligible[(state.world.current_turn + id.length) % eligible.length];
    if (pick) traits.push(`${c.name}: ${pick}`);
  }
  if (traits.length) {
    rows.push(`AND THESE HAVE TO SHOW. Each of these people acts out of the trait named here at least once in this scene, in something they do rather than something said about them: ${traits.join(" | ")}`);
  }
  const recededNote = receded.length
    ? `\n[THESE ARE SETTLED AND NO LONGER NEWS: ${receded.join(" | ")}. They're established and don't need a moment of their own. They can show or not, depending on what the scene needs. Don't stage one, don't have anybody comment on one, and don't spend a line establishing something that's already true.]`
    : "";
  const standingNote = standing.length
    ? `\n[WHAT IS ALREADY TRUE OF THESE PEOPLE. These hold, but they aren't something to write a moment about.
These are settled facts of this world. They limit what can happen, but they don't call for a scene, an announcement or a demonstration, and staging one every turn turns it into a tic. Where the turn runs into one, it holds, plainly and briefly. Where it doesn't, leave it off the page.\n· ${standing.join("\n· ")}]`
    : "";
  if (!rows.length) return standingNote + recededNote;
  return `\n[WHAT IS STARTING TO FORM IN THESE PEOPLE. Every line here goes on the page this turn.
Each line below gets a moment in this scene, at the strength given and no stronger. It isn't up to you to decide that this scene is too busy for it, that the plot matters more, or that it would work better later. The schedule keeps running whether or not it gets written, so skipping it just means the next step shows up without any explanation. If the scene seems to have no room, make room. One sentence is enough, but some of it has to be visible this turn.\n· ${rows.join("\n· ")}]${standingNote}${recededNote}`;
}

/** The core_trait label a crystallised want became — the same normalisation `crystallize` applies,
 *  so an authored want can be matched to the habit the novelty ladder tracks it under. Saves written
 *  before the label was stored recompute it. */
export function crystallizedLabel(a: AuthoredDrive): string {
  return a.label?.trim() ? a.label.trim().replace(/[.\u2026]+$/, "") : labelFor(a.goal ?? "");
}

/** How worn a settled want is, read off the habit the novelty ladder has been counting. A want with
 *  no habit on record yet has not been expressed at all, which is "fresh". */
export function settledStage(state: SaveState, id: string, a: AuthoredDrive): "fresh" | "familiar" | "ground" {
  const label = crystallizedLabel(a).toLowerCase();
  const habit = (state.habits?.[id] ?? []).find((h) => h.trait.trim().toLowerCase() === label);
  return habit ? noveltyStage(habit) : "fresh";
}

/** Every live authored want in the cast, as the world-sim's `wantsOf` wants them: id → lines. */
export function authoredWants(state: SaveState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player") continue;
    if (c.status === "dead" || c.status === "departed") continue;
    const live = liveAuthored(c);
    if (live.length) out.set(id, live.map((a) => authoredLine(a)).join(" ALSO: "));
  }
  return out;
}

/** THE RATCHET.
 *
 *  Called once per turn. A want with a turn budget advances one turn's worth, unconditionally.
 *
 *  There used to be a detector here: match the distinctive words of the goal against the prose, and
 *  only credit turns where the want could be found. It went through three revisions and every one of
 *  them was wrong, because the premise is wrong. THE LADDER'S ENTIRE POINT IS THAT THE EARLY RUNGS
 *  DO NOT NAME THE THING. Stage 0 for "makes him lick her armpits" is a woman standing a half-step
 *  too close with her sleeve rolled up, holding the position a beat past comfortable — the beat that
 *  finally landed on a real save, and the detector scored that turn `stalled: 1`. It could only ever
 *  have fired on prose that said the quiet part, i.e. on precisely the rushed, announced version this
 *  whole feature exists to prevent. It was rewarding the failure and punishing the success.
 *
 *  It was also worse than useless downstream: `stalled: 1` put "IT HAS BEEN SKIPPED 1 TURN RUNNING"
 *  into the next turn's direction on a turn that had nailed it, which is an instruction to push
 *  harder than the rung allows. A wrong signal in the prompt is more expensive than no signal.
 *
 *  So there is no detector. The turn budget is the whole mechanism, and the only reader who can
 *  actually judge whether the beat landed is the one holding the phone — who has `knock it back` and
 *  `hold it here` on the card for exactly that.
 *
 *  The in-world-hours ladder (no budget set) still runs on the clock; that path is for a standing
 *  condition of somebody's life which is true whether or not the page mentions it. */
export function tickAuthored(state: SaveState, minutesElapsed = 0): string[] {
  const log: string[] = [];
  const turn = state.world.current_turn;
  const elapsed = Math.max(0, minutesElapsed);
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id === "char_player") continue;
    if (c.status === "dead" || c.status === "departed") continue;
    for (const a of c.authored ?? []) {
      if (!a?.goal || a.crystallized_turn || a.paused) continue;

      if (a.inhabit_turns && a.inhabit_turns > 0) {
        if (a.turns_live === undefined) {
          // A want written while the evidence gate was live has no `turns_live`, and the `seen` it
          // does have is the bad number that gate produced. Turns elapsed since it was written is
          // what the field would have held all along, so that is the reconstruction — capped one
          // short of the budget, so a want abandoned fifty turns ago cannot complete itself in the
          // instant the save loads. The top rung is always reached by a real turn with the direction
          // in front of the narrator, never by the migration.
          a.turns_live = Math.max(0, Math.min(a.inhabit_turns - 1, turn - a.added_turn));
        } else {
          // The schedule advances every turn the want is live, full stop.
          a.turns_live += 1;
        }
        const reachedByClock = rampStage(a);
        if (reachedByClock > (a.stage ?? 0)) {
          a.stage = reachedByClock;
          log.push(`${c.name} is further along with it: ${a.goal}.`);
        }
      } else {
        a.acted = (a.acted ?? 0) + elapsed;
        const step = 60 * (STEP_HOURS[a.rate] ?? STEP_HOURS.steady);
        const reached = Math.min(MAX_STAGE, Math.floor(a.acted / step));
        if (reached > (a.stage ?? 0)) {
          a.stage = reached;
          log.push(`${c.name} is further along with it: ${a.goal}.`);
        }
      }

      // Crystallisation used to be gated on the same detector, on the reasoning that the engine has
      // no business declaring a habit the story never showed. True in principle, and unenforceable in
      // fact: the check could not tell a landed subtle beat from an ignored one, so it was blocking
      // the wants that worked. What remains is the player's own switch — `crystallize` is opt-in per
      // want, and if the story genuinely never showed it, the honest control is `drop it`.
      if ((a.stage ?? 0) >= MAX_STAGE && a.crystallize && !a.crystallized_turn) {
        const t = crystallize(state, id, a, turn);
        if (t) log.push(`${c.name} no longer thinks of it as something new: ${t}.`);
      }
    }
  }
  return log;
}

/** THE WANT BECOMES THE PERSON.
 *
 *  The endpoint the player was typing by hand at the start. A want carried at full stretch for long
 *  enough stops being something someone is doing and becomes something they are — which is the one
 *  honest way to write a core trait, because by the time it lands the story contains the evenings
 *  that earned it.
 *
 *  The want is retired in the same motion. Leaving both would double-count the person: a standing
 *  want driving the world-sim AND a trait describing the same behaviour, so every pass sees it twice
 *  and weights it twice. */
export function crystallize(state: SaveState, id: string, a: AuthoredDrive, turn: number): string | null {
  const c = state.characters[id];
  if (!c || !a?.goal || a.crystallized_turn) return null;

  const label = labelFor(a.goal);
  const traits = (c.core_traits ??= []);
  if (!traits.some((t) => t.toLowerCase() === label.toLowerCase())) traits.push(label);

  (state.traits[id] ??= []).push({
    id: `authored_${turn}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    origin: a.because
      ? `${a.because} — and it became a habit`
      : `did it once, then kept doing it, and stopped noticing they had ever decided anything`,
    behavioral_impact: `Acts on this without thinking about it, because it's part of their routine.`,
    intensity: 7,
    self_weight: 0.6,
    last_reinforced_turn: turn,
    // `acted` is MINUTES OF STANDING, not a count of expressions. Dividing it by three filed a want
    // the player had just written as having been acted on six hundred times, which is what every
    // downstream reader of this number takes it to mean. What a settled want has actually earned is
    // its rungs, so that is what is recorded.
    reinforcement_count: Math.max(1, Math.min(MAX_STAGE + 1, (a.stage ?? 0) + 1)),
  });
  a.crystallized_turn = turn;
  a.label = label;          // so the novelty ladder can find the habit this became
  return label;
}

/** Knock a rung off — what the player reaches for when the character has been faced down and it
 *  should cost them something. At the bottom rung it stops rather than going negative: a want that
 *  has been opposed all the way back to nothing is a want to delete, and deleting it is a different
 *  button with different consequences. */
export function setback(a: AuthoredDrive, rate: AuthoredDrive["rate"] = a.rate): void {
  const step = 60 * (STEP_HOURS[rate] ?? STEP_HOURS.steady);
  a.stage = Math.max(0, (a.stage ?? 0) - 1);
  a.acted = a.stage * step;
}

/** How much of a written want is kept. The old ceiling was 200 characters and it cut mid-word: one
 *  save holds a want ending "regardless of context or situation and doesn't ev", which is the
 *  sentence carrying the actual instruction, stopped in the middle of a word, and that fragment is
 *  what the narrator was handed on every turn. A want is a spec the player wrote by hand; it gets
 *  room. */
const GOAL_MAX = 600;

/** The short name a want is filed under: its first sentence or clause, whole words only.
 *
 *  Splitting on the first sentence is deliberate. A written want usually opens with the act and
 *  then qualifies it, so the opening IS the name — and the qualifications, which are the part that
 *  varies between two attempts at the same want, are exactly what should not be in the key. */
export function labelFor(goal: string): string {
  const t = String(goal ?? "").trim().replace(/^(start|starts|begin|begins|try to|tries to)\s+/i, "");
  const firstSentence = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  const base = firstSentence.length >= 24 ? firstSentence : t;
  return clipWords(base, LABEL_MAX).replace(/[.\u2026]+$/, "");
}

/** The distinctive words of a want, for telling two of them apart. */
function keyWords(goal: string): Set<string> {
  return new Set(String(goal ?? "").toLowerCase().match(/[a-z']{4,}/g) ?? []);
}

/**
 * IS THIS THE SAME WANT, WRITTEN AGAIN?
 *
 * A player whose want has not been showing up rewrites it — a little longer, a word stronger, an
 * "always" on the front. One save holds two: the same act, the same person, one opening "Without
 * having sex" and the other "Always and without sex". The engine stacked them, so the character
 * card carried the instruction twice, both copies cut off mid-word at different points, and the
 * habit ladder counted expressions under two different keys and so found none under either.
 *
 * Rewriting is the ordinary way somebody uses this feature, and it should edit the want rather than
 * grow a second one. The bar is deliberately high — most of the distinctive words in common, both
 * ways — so two genuinely different wants that happen to share a subject stay separate.
 */
export function sameWant(a: string, b: string): boolean {
  const x = keyWords(a), y = keyWords(b);
  if (x.size < 3 || y.size < 3) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.7 && shared / Math.max(x.size, y.size) >= 0.5;
}

/** Where the same want already sits in this person's list, if it does. */
export function findSameWant(list: readonly AuthoredDrive[] | undefined, goal: string): number {
  return (list ?? []).findIndex((a) => a?.goal && sameWant(a.goal, goal));
}

/** Take a crystallised want's trait back off the record, so replacing it does not leave the old
 *  wording behind on the card forever. */
export function retireLabel(state: SaveState, id: string, label: string): void {
  const key = String(label ?? "").trim().toLowerCase();
  if (!key) return;
  const c = state.characters[id];
  if (c?.core_traits) c.core_traits = c.core_traits.filter((t) => t.trim().toLowerCase() !== key);
  if (state.traits?.[id]) state.traits[id] = state.traits[id].filter((t) => t.label.trim().toLowerCase() !== key);
}

/** A fresh authored want, with the fields the UI does not ask for filled in.
 *
 *  `acted` defaults to the floor of whatever stage was asked for rather than to zero. Starting a
 *  want at stage 2 and leaving the counter at 0 looks harmless and quietly means it must now serve
 *  the full climb again before it reaches 3 — the player would have set it high precisely because
 *  they did not want to wait. */
export function newAuthored(goal: string, turn: number, opts: Partial<AuthoredDrive> = {}): AuthoredDrive {
  const rate = opts.rate ?? "steady";
  const stage = Math.max(0, Math.min(MAX_STAGE, opts.stage ?? 0));
  return {
    goal: clipWords(goal, GOAL_MAX),
    approach: opts.approach?.trim() ? clipWords(opts.approach, GOAL_MAX) : undefined,
    because: clipText(opts.because, 320) || undefined,
    rate,
    stage,
    acted: Math.max(stage * 60 * (STEP_HOURS[rate] ?? STEP_HOURS.steady), opts.acted ?? 0),
    // Same reasoning as `acted`: a want started part-way up must not have to re-earn the ground the
    // player just handed it, so the turn counter starts at the fraction its stage represents.
    turns_live: Math.max(opts.turns_live ?? 0, opts.inhabit_turns ? Math.round((stage / (MAX_STAGE + 1)) * opts.inhabit_turns) : 0),
    paused: opts.paused,
    inhabit_turns: opts.inhabit_turns && opts.inhabit_turns > 0 ? Math.round(opts.inhabit_turns) : undefined,
    crystallize: opts.crystallize ?? true,
    added_turn: opts.added_turn ?? turn,
  };
}



/* ── DID IT ACTUALLY HAPPEN? ────────────────────────────────────────────────────
 *
 * Two prompt fixes in a row failed to put an authored want on the page. The first time, the clause
 * bolted to the instruction was cancelling it; that got rewritten, and the want still did not
 * appear. The lesson this engine keeps relearning applies here as everywhere else: A RULE IN THE
 * PROMPT DOES NOT HOLD. A DETECTOR ON THE OUTPUT DOES.
 *
 * I BUILT THE WRONG DETECTOR FIRST and measured it before shipping it, which is the only reason it
 * is not in here. It matched the want's distinctive words against the prose. Over every save that
 * carries an authored want, the turns where the act demonstrably never happened scored 0.36 to 0.50
 * overlap — "face", "dry", "talking" turn up in ordinary kitchen prose — while a paragraph written
 * to contain the act outright scored 0.09, because real prose says "came across his cheek" where
 * the want says "cums on his face". The instrument ranked the misses ABOVE the hit. Word overlap
 * cannot answer a question about meaning.
 *
 * THE RIGHT SIGNAL WAS ALREADY BEING COMPUTED. The simulator reports `traits_expressed` every turn
 * — which of each character's core traits the scene actually put on screen, "judged by MEANING, not
 * wording", which is exactly the euphemism problem my regex died on. A crystallised want IS a core
 * trait, so it is already in that list, and recordExpressions already files the answer in
 * state.habits as expressions and last_expressed_turn. In the save that prompted this, Miranda's
 * two ordinary traits had fired and the authored want had not. The
 * engine had measured the failure precisely and nothing read the measurement.
 *
 * A DETECTOR WAS ALSO TRIED HERE ONCE AND REMOVED, correctly — see THE RATCHET above. It gated
 * PROGRESS on finding the want, and that is wrong, because the early rungs are deliberately not the
 * act. So this reads only the rung where the act ITSELF is ordered, and it never touches the
 * ratchet: it counts, and it tells the next turn what the last one did.
 */

/** Is this want at the rung where the act itself was ordered? Below that, absence is the design. */
/**
 * ── A STANDING CONDITION IS NOT AN ACT, AND ORDERING IT AS ONE IS A DEATH LOOP ──────────────────
 *
 * From a save at turn 15. The player had authored, by hand:
 *
 *     "Only allows Rabi to eat combinations of her shit, cum, piss and vomit, she doesn't allow
 *      Rabi to eat anything else."
 *
 * It crystallized at turn 5. At turn 14 its record read `acted: 0, missed: 8` — ordered on every
 * turn since turn 1, credited on none of them, ever. So the narrator opened every turn holding:
 *
 *     THIS WAS ORDERED LAST TURN AND THE TURN CAME BACK WITHOUT IT ... ordered for the last 8 turns
 *     and absent from all of them ... WRITE IT FIRST THIS TURN: the act itself, in plain words, in
 *     the opening lines of the prose, before the conversation ... There is no third: if it is not
 *     in the opening lines, nothing else in the turn counts.
 *
 * There is no act that IS that want. It is a rule about what may happen, and it was being satisfied
 * — Rabi was eating eggs he had cooked himself, which is the rule being BROKEN, and the narrator's
 * only legal move under the mandate was to interfere with his eating. So it did, in the opening
 * lines, every turn, for nine turns: she stops the blowjob to make him eat, then stops him eating,
 * then orders him to finish, then stops him again. The player, on turn 13: "What do you mean you
 * want me to finish... my toast? That I keep trying to eat? That you keep stopping me then telling
 * me to finish the toast again?" On turn 14 they asked whether she was having a stroke.
 *
 * The engine already knows this failure. It is written into the forge's own drive guidance, for
 * `drive_goal`, in almost these words: "WANTS ARE THINGS THEY DO, NOT THINGS THEY ASK FOR. A drive
 * whose completion depends on somebody else answering ... cannot progress on its own. The character
 * asks, nothing recordable resolves, and they ask again next scene and the scene after, because the
 * meter never moves." It was never applied to `authored` — which is exactly where a player types a
 * standing rule, because a standing rule is the natural way to write "this is how they are".
 *
 * So the shape is detected instead of forbidden. A want written as a permission, a prohibition or an
 * invariant is TRUE CONTINUOUSLY: it binds what may happen in the scene, it needs no beat, and it
 * can never be missed. That is not a demotion — it is a stronger claim on the world than a beat is.
 */
const STANDING = /\b(only allows?|only ever allows?|does ?n[o']t allow|never allows?|only lets?|does ?n[o']t let|never lets?|refuses to let|will not let|won'?t let|only permits?|never permits?|forbids?|always makes? (?:him|her|them)|never (?:eats|wears|touches|speaks|goes|sleeps)|is only ever|only eats?|will only|can only)\b/i;

/** Is this want a rule about what may happen rather than something a person does on a given turn?
 *
 *  READ THE OPENING CLAUSE ONLY, because a want routinely CONTAINS a rule without being one. From
 *  the suite: "Jerks her penis off on his face, Always Makes sure Vin's face is always covered with
 *  her cum, does not let him wipe it off, quickly cums on his face if it's dry". That opens with an
 *  act and then qualifies it, and reading the whole string flagged it as standing on the strength of
 *  "does not let" — which would have quietly stopped the engine ordering the one want that suite
 *  exists to prove gets ordered. What a want IS, is what its main clause says it is: a rule opens
 *  with the rule ("Only allows Rabi to eat…"), an act opens with the act. */
export function isStanding(a: AuthoredDrive): boolean {
  const opening = String(a?.goal ?? "").trim().split(/[,;.]/)[0] ?? "";
  return STANDING.test(opening);
}

export function actOrdered(a: AuthoredDrive): boolean {
  if (a.paused) return false;
  if (a.crystallized_turn) return true;
  return rampStage(a) >= MAX_STAGE;
}

/** The habit row the novelty ladder counts this want under, if it has one yet. */
function habitFor(state: SaveState, id: string, a: AuthoredDrive) {
  const label = crystallizedLabel(a).trim().toLowerCase();
  return (state.habits?.[id] ?? []).find((h) => h.trait.trim().toLowerCase() === label);
}

/**
 * Count what the turn just did with every want that was ordered outright.
 *
 * Called once, after the prose and after recordExpressions has filed the simulator's read. Only
 * ever writes `missed` — the stage, the ratchet and the label are untouched, so a wrong reading
 * here costs a repeated instruction and nothing else.
 *
 * A want with no habit row yet has never been expressed at all, which is a miss. A row whose
 * last_expressed_turn is this turn is a hit.
 */
export function noteWantMisses(
  state: SaveState, turn: number, presentIds: readonly string[], simAnswered = true,
): string[] {
  // UNKNOWN IS NOT A MISS. When the bookkeeping pass returned no trait report at all, nothing can
  // credit the want and nothing can convict it either — counting that as a skip would nag the
  // narrator to repeat a beat it may well have just written. The count holds where it is.
  if (!simAnswered) return [];
  const shifts: string[] = [];
  for (const id of presentIds) {
    const c = state.characters[id];
    if (!c || id === "char_player") continue;
    for (const a of c.authored ?? []) {
      if (!a?.goal || !actOrdered(a)) continue;
      // A standing condition cannot be missed, because there is no beat it was supposed to be. See
      // isStanding: it is true continuously, and the turn that did not stage it is a turn in which
      // it simply held. Counting it drove one save to missed:8 with acted:0.
      if (isStanding(a)) { a.missed = 0; continue; }
      // last_expressed_turn, not last_fired_turn: those are two different counters on the same row.
      // seen_fires/last_fired_turn belong to habits.ts and its mannerism axis, which never advances
      // for a want like this — reading it would have called every turn a miss, including the hits.
      if (habitFor(state, id, a)?.last_expressed_turn === turn) { a.missed = 0; continue; }
      a.missed = (a.missed ?? 0) + 1;
      shifts.push(a.missed === 1
        ? `${c.name}'s standing want didn't make it into the prose, so the narrator is being told again`
        : `${c.name}'s standing want has now been left out ${a.missed} turns in a row`);
    }
  }
  return shifts;
}

/**
 * What the next turn is told about it.
 *
 * The escalation is deliberately not louder adjectives — the instruction was already at maximum
 * volume on every turn it was skipped. What is added is the part the narrator cannot argue with:
 * that this is the second or third turn, and that the scene it wrote instead is on the record.
 */
/** How many turns an act-want may be ordered-and-absent before the engine stops ordering it. Six is
 *  past any plausible "the narrator was busy" and well short of the nine that produced the loop. */
export const MISS_CEILING = 6;

/** Wants the engine has given up ordering, for the player — the Inspector and the turn's shifts.
 *  Nothing else can fix an unwritable want: the engine cannot rewrite what the player typed, and
 *  silently dropping it would leave them wondering why their want stopped happening. */
export function staleWants(state: SaveState, presentIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of presentIds) {
    const c = state.characters[id];
    if (!c || id === "char_player") continue;
    for (const a of c.authored ?? []) {
      if (!a?.goal || !actOrdered(a) || isStanding(a)) continue;
      if ((a.missed ?? 0) !== MISS_CEILING + 1) continue;   // say it once, on the turn it crosses
      out.push(`"${clipWords(a.goal, 12)}" has been asked for ${a.missed} turns in a row and has never made it into the prose, so the engine has stopped pushing it. It may not be something a scene can show. Try rewriting it as something ${c.name} does.`);
    }
  }
  return out;
}

export function missDirective(state: SaveState, presentIds: readonly string[]): string {
  const rows: string[] = [];
  let worst = 0;
  for (const id of presentIds) {
    const c = state.characters[id];
    if (!c || id === "char_player") continue;
    for (const a of c.authored ?? []) {
      if (!a?.goal || !actOrdered(a) || isStanding(a) || !(a.missed ?? 0)) continue;
      // PAST THIS, ORDERING IT AGAIN IS NOT THE FIX. An act-want that has been demanded in the
      // opening lines of six consecutive turns and has still never landed is not being ignored out
      // of laziness — it is unwritable in the scene the story is actually in, and a seventh "there
      // is no third" only guarantees a seventh turn bent around it. Stand the order down, and let
      // the player be told (see staleWant) so they can rewrite it, which is the only thing that
      // ever actually resolves this.
      if ((a.missed ?? 0) > MISS_CEILING) continue;
      worst = Math.max(worst, a.missed ?? 0);
      rows.push(`${c.name}: ${a.goal.trim().replace(/\.$/, "")}. This was asked for in the last ${a.missed} turn${a.missed === 1 ? "" : "s"} and left out of ${a.missed === 1 ? "it" : "all of them"}.`);
    }
  }
  if (!rows.length) return "";
  return `\n\nTHIS WAS ASKED FOR LAST TURN, AND THE TURN CAME BACK WITHOUT IT.\n· ${rows.join("\n· ")}\n`
    + `The scene that got written used up the space this was meant to have. `
    + `So write it first this turn: the act itself, in plain words, in the opening lines of the prose, before the conversation, before whatever the room was in the middle of, and before anything else you'd rather start with. Then write the rest of the turn around it. `
    + (worst >= 2
      ? `It has now been left out for two turns, so this time it goes in the opening lines.`
      : `It doesn't need a lead-in or an occasion, because the build-up already happened in the turns where it was left out.`);
}

/**
 * TAKE THE PHANTOM CREDITS BACK OFF.
 *
 * Run once when a save loads. Every save written before the credit path was fixed carries habit
 * rows for its authored wants with expression counts that were never earned — a want containing
 * the word "face" was credited on 22 turns out of 22, and five is all it takes to reach "ground",
 * after which habitDirective drops the want and the block that demands it comes back empty. A save
 * in that state cannot recover on its own: the count only ever goes up, and the want can never be
 * expressed again to correct it, because it is no longer being asked for.
 *
 * Only the rows belonging to a crystallised authored want are reset. Those are the ones measured
 * as corrupt — across eleven saves and twenty wants, one had genuinely happened while the counts
 * read 10 to 18 — and they are the ones where being wrong is fatal rather than cosmetic. A forged
 * trait credited a few times too often just gets a quieter beat; a want credited too often stops
 * existing. Where the two costs are that lopsided, reset.
 */
export function repairAuthoredHabitCounts(state: SaveState): number {
  let reset = 0;
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    const wants = (c?.authored ?? []).filter((a) => a?.goal && a.crystallized_turn);
    if (!wants.length) continue;
    const labels = new Set(wants.map((a) => crystallizedLabel(a).trim().toLowerCase()));
    for (const h of state.habits?.[id] ?? []) {
      if (!labels.has(h.trait.trim().toLowerCase())) continue;
      if (!(h.expressions ?? 0)) continue;
      h.expressions = 0;
      h.last_expressed_turn = undefined;
      reset++;
    }
  }
  return reset;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * A LAW THE PLAYER WROTE ABOUT ONE PERSON, WITH NOTHING BEHIND IT.
 *
 * From a save at turn 20, in `world.canon`, sitting between "The year is 1932" and "Class
 * determines almost everything":
 *
 *     Emily Clarke falls desperately in love with Rabi and must marry him.
 *
 * That is the strongest statement in the entire save and it is a STRING IN A LIST. Everything in
 * this file — the stages, the ratchet, the miss counter, the escalation, MISS_CEILING, the
 * crystallisation into a trait — operates on `character.authored[]`, and Emily's was empty. So the
 * law was rendered into the prompt as world background, next to the weather and the Empire, and
 * competed on equal footing with her recorded warmth of −1.6. It lost, every turn, and the player's
 * report was "Emily is... not interested in me."
 *
 * Canon is the right place to WRITE it — it is a fact about the world. It is the wrong place for it
 * to LIVE, because a fact about the world that is really an instruction about one person needs the
 * machinery that makes instructions about people happen.
 *
 * DELIBERATELY NARROW. This only fires on a canon line whose subject is a cast member by name and
 * whose verb is a standing obligation or disposition — must, falls in love with, will always, is
 * to, cannot stop. "Class determines almost everything" names nobody and is left alone; so is "The
 * law forbids sexual acts between men", which is a law about the world rather than about a person.
 * A line that does not clear both tests stays exactly where it is and does nothing, which is the
 * behaviour every canon line has today.
 *
 * IDEMPOTENT, AND ONE-WAY. It runs every turn (the player can edit the bible at any time) and adds
 * a want only when nothing resembling it is already on the person. It never removes, never edits,
 * and never touches a want the player wrote by hand — if they delete it, it does not come back,
 * because `canon_adopted` remembers the line rather than the want.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** A standing obligation or disposition aimed at somebody — the shape of a law about a person, as
 *  opposed to a fact about the world. The captured group is the predicate, which becomes the want. */
const CANON_LAW = /\b(must\s+\w+|falls?\s+(?:desperately\s+|deeply\s+|hopelessly\s+)?in\s+love\s+with\b|will\s+always\s+\w+|will\s+never\s+\w+|is\s+to\s+\w+|cannot\s+(?:stop|help|resist)\b|is\s+obsessed\s+with\b|is\s+devoted\s+to\b|is\s+sworn\s+to\b|has\s+to\s+\w+)/i;

/** Turn "Emily Clarke falls desperately in love with Rabi and must marry him." into a want in her
 *  own mouth, with her own name out of it — a goal naming its owner is the exact shape this engine
 *  keeps having to correct elsewhere (see the drives_update contract). */
function lawToGoal(line: string, ownerName: string): string | null {
  let t = String(line ?? "").trim().replace(/\s+/g, " ");
  const first = ownerName.split(/\s+/)[0];
  // cut everything up to and including the owner's name — the predicate is what they do
  const at = t.search(new RegExp(`\\b${ownerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  if (at < 0) return null;
  t = t.slice(at).replace(new RegExp(`^\\S+(\\s+\\S+)?\\s*`), (m) => (new RegExp(`^\\s*${first}`, "i").test(m) ? "" : m));
  t = t.replace(new RegExp(`\\b${ownerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "").trim();
  t = t.replace(/^(?:,|\.|and|who|that)\s+/i, "").replace(/[.\s]+$/, "").trim();
  // third person to the bare verb: "falls in love with Rabi" reads as a want, "she falls" does not
  t = t.replace(/^(?:she|he|they|it)\s+/i, "").trim();
  return t.split(/\s+/).length >= 3 ? t : null;
}

/**
 * Adopt canon laws about named people as standing wants on those people.
 *
 * Returns the shifts to report. Safe to call every turn.
 */
export function adoptCanonLaws(state: SaveState): string[] {
  const out: string[] = [];
  const turn = state.world.current_turn;
  const adopted = (state.world.canon_adopted ??= []);
  for (const raw of state.world.canon ?? []) {
    const line = String(raw ?? "").trim();
    if (!line || adopted.includes(line)) continue;
    if (!CANON_LAW.test(line)) continue;
    // whose law is it? the cast member the line opens on, so "Emily Clarke falls in love with Rabi"
    // belongs to Emily and not to Rabi, who is only named in the predicate.
    let owner: { id: string; name: string } | null = null, at = Infinity;
    for (const [id, c] of Object.entries(state.characters)) {
      if (id === "char_player" || !c?.name) continue;
      const i = line.toLowerCase().indexOf(String(c.name).toLowerCase().split(/\s+/)[0]);
      if (i >= 0 && i < at) { owner = { id, name: c.name }; at = i; }
    }
    if (!owner) continue;
    const goal = lawToGoal(line, owner.name);
    if (!goal) continue;
    const c = state.characters[owner.id];
    const list = (c.authored ??= []);
    adopted.push(line);
    if (state.world.canon_adopted!.length > 60) state.world.canon_adopted = state.world.canon_adopted!.slice(-60);
    if (findSameWant(list, goal) >= 0) continue;   // the player already wrote it by hand
    list.push(newAuthored(goal, turn, {
      because: `the world is written this way: ${line}`,
      rate: "steady",
    }));
    out.push(`${owner.name} has a standing want that the world's own established facts state: ${goal}`);
    console.warn(`[canon] adopted a law about ${owner.name} as a standing want: "${goal}"`);
  }
  return out;
}
