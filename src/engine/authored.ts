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
  "EXPOSURE. It does not happen and is not mentioned — but ONE CONCRETE THING IS ON THE PAGE about it: the scene puts the occasion in front of them and they visibly decline it. They reach for something else instead. They put a hand near and take it back. They step around it. Somebody else could describe what she did, even if nobody could say why. NOT ACTING IS NOT THE SAME AS NOTHING HAPPENING: if a reader could not point at a sentence, this rung has not been written.",
  "NEAR IT, BY CIRCUMSTANCE, and again ONE VISIBLE BEAT. Something unrelated keeps her beside it longer than she needed — a wait, a queue, somebody else's errand. She looks properly, and the looking is on the page: her attention goes there twice, she stays a moment past when she could have gone, she stands closer than the task requires. Then the moment ends and she does nothing. Body only. Not one word about it.",
  "EXAMINING IT — narrowed from the general thing to the specific one, and STILL A VISIBLE ACT: she handles it, weighs it, tests it, positions herself for it, gets close enough that anyone watching would notice and could not prove anything. Then something takes her away before it happens and she lets it go. THE INTERRUPTION IS THE POINT — it is what stops this being a decision — but the approach before the interruption must actually occur on the page.",
  "THE SIDEWAYS FIRST TIME. It happens, and it arrives through someone else or through a pretext — a third party's opinion, going along with what is already happening, since-we-are-here. Low stakes, deniable, never framed as wanting it. This is the first rung on which the thing itself occurs.",
  "AGAIN, BECAUSE IT IS EASY NOW. No pretext and no reason given. She may skip once and notice the absence — the first moment the wanting becomes conscious to her, and the first moment she might say anything about it at all.",
  "SIMPLY WHAT SHE DOES. No occasion, no excuse; part of the shape of the day with this person. Only now is there anything to SAY about it — the meaning arrives after the habit, never before.",
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
    return ` THE THING ITSELF DOES NOT HAPPEN AT THIS RUNG, and the thing itself is: ${g}. What goes on the page is the approach to that and the turning away from it, written so that a reader who had been told the ending would recognise this as its beginning.`;
  }
  return ` AND "IT" MEANS THIS, LITERALLY, IN THE BODY: ${g}. That act occurs in this turn's prose, plainly enough that it could not be mistaken for anything else. NOT AN APPROACH TO IT. Not a gesture that resembles it, not skin becoming briefly visible, not a hand or a look that someone who already knew would read that way. Those are the rungs BELOW this one, and writing one of them here is writing the wrong rung. The test is subtraction: if the act could be cut out of your paragraph and the paragraph would still make sense, you did not write it. It is also NOT THE SAME BEAT AS LAST TURN, because the same near-miss repeated is a stall wearing the costume of progress.${THRESHOLD}`;
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
 *  cuts to Liz. The narrator obeyed both rules in the only way both can be obeyed at once. It was
 *  not refusing and it was not softening; it had been handed an instruction it could not legally
 *  execute and it went as far as the law allowed.
 *
 *  So the demand is stated with its own limit attached, and no classifier decides which branch
 *  applies — the model can see whose body the goal names better than a regex can. What matters is
 *  that the threshold version is written as a FULL requirement rather than as an escape: her half
 *  entire, not retracted inside the same turn, and the scene not wandering off to somebody else's
 *  business before the player can answer. That last part is what actually went wrong here — the turn
 *  did not stop at the choice, it moved on to Liz's eyebrow and Marcus's buckle, so the moment was
 *  over before the player had it. */
const THRESHOLD = ` IF THE ACT REQUIRES THE PLAYER'S BODY OR THE PLAYER'S ASSENT, YOU CANNOT WRITE IT AND MUST NOT TRY: the narration stops where the player's choice begins, that rule outranks this one, and the player types that part. What you write instead is HER ENTIRE HALF and it is not a lesser version of this instruction — everything up to the choice, complete and unmistakable, named plainly in what she does or says rather than implied. She does not hedge it, she does not retract it inside the same turn, and she does not cover it with a joke. THE TURN ENDS ON IT, still standing, with the choice in front of him: do not move on to another character's business afterwards, because that closes the moment before he can answer it.`

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
    bits.push(`INVENT THE OCCASION — do not wait for one. A habit forms because the world keeps putting the thing in reach, and this world will not do that by itself. Find the reason inside the conditions that already exist here: the heat, the thirst, the work, what is short, what hurts, what has to be carried, who is standing where. "There is no water and she is running a fever." "Her bag strap keeps slipping and her hands are full." "Her joints ache and nobody has salt." The occasion must break no established rule and invent no new fact about the world — it is assembled out of what the scene already contains, which is why it reads as circumstance rather than as a plot handing somebody what they want.\n  ${Math.round(i * 100)}% of the way to being simply how they are, and still climbing. THIS IS NOT OPTIONAL AND IT IS NOT BACKGROUND: write the beat for this rung into this scene, at exactly this strength and no more. Under half it has not happened yet and must not — but "has not happened" still requires a visible moment on the page, in the body, that a reader could point at. A turn in which nothing about it can be seen is a turn in which this failed, and it is the ONLY way to get this wrong besides rushing to the act`);
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
export function habitDirective(state: SaveState, presentIds: string[]): string {
  const rows: string[] = [];
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
      rows.push(`${c.name} — SIMPLY DOES THIS NOW, without deciding to: ${a.goal.trim().replace(/\.$/, "")}. Not a version of it, not a suggestion of it — that, the act itself, in this turn's prose. It needs no occasion, no excuse and no build-up, and there is no "if the scene allows": the scene is whatever you write, and this is in it. She does not comment on it and nobody remarks on it being new, because to her it is not. THIS IS ESTABLISHED BETWEEN THEM, so she does not ask for it and does not work up to it — she assumes it, positions for it, waits for it, expects it, picks it up again mid-conversation as if it were never in question, and is unbothered by who is standing there.${THRESHOLD}`);
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
  for (const id of presentIds) {
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
    rows.push(`AND THESE ARE NOT DECORATION — each of these people acts out of the trait named here at least once this scene, in something they DO rather than something stated about them: ${traits.join(" | ")}`);
  }
  const recededNote = receded.length
    ? `\n[SETTLED, AND NO LONGER NEWS — ${receded.join(" | ")}. These are established and need no beat of their own. They may show or not show as the scene has use for them; do not stage one, do not have anybody remark on it, and do not spend a line establishing something that is already true.]`
    : "";
  if (!rows.length) return recededNote;
  return `\n[WHAT IS FORMING IN THESE PEOPLE — NOT OPTIONAL, NOT BACKGROUND, NOT DEFERRABLE.
Each line below gets a beat in THIS scene, at the strength named and no more. You do not get to decide that this scene is too busy for it, or that the plot matters more, or that it would land better later: the schedule is running whether it is written or not, and a turn that skips it does not pause it, it only makes the next one arrive unexplained. If the scene seems to leave no room, that is the instruction — make the room. One sentence is enough. There is no version of this turn in which none of it can be seen.\n· ${rows.join("\n· ")}]${recededNote}`;
}

/** The core_trait label a crystallised want became — the same normalisation `crystallize` applies,
 *  so an authored want can be matched to the habit the novelty ladder tracks it under. Saves written
 *  before the label was stored recompute it. */
export function crystallizedLabel(a: AuthoredDrive): string {
  return (a.label ?? a.goal ?? "").trim().replace(/^(start|starts|begin|begins|try to|tries to)\s+/i, "").replace(/\.$/, "");
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
          log.push(`${c.name} is further into it than she was: ${a.goal}.`);
        }
      } else {
        a.acted = (a.acted ?? 0) + elapsed;
        const step = 60 * (STEP_HOURS[a.rate] ?? STEP_HOURS.steady);
        const reached = Math.min(MAX_STAGE, Math.floor(a.acted / step));
        if (reached > (a.stage ?? 0)) {
          a.stage = reached;
          log.push(`${c.name} is further into it than she was: ${a.goal}.`);
        }
      }

      // Crystallisation used to be gated on the same detector, on the reasoning that the engine has
      // no business declaring a habit the story never showed. True in principle, and unenforceable in
      // fact: the check could not tell a landed subtle beat from an ignored one, so it was blocking
      // the wants that worked. What remains is the player's own switch — `crystallize` is opt-in per
      // want, and if the story genuinely never showed it, the honest control is `drop it`.
      if ((a.stage ?? 0) >= MAX_STAGE && a.crystallize && !a.crystallized_turn) {
        const t = crystallize(state, id, a, turn);
        if (t) log.push(`${c.name} does not think of it as a thing she started any more: ${t}.`);
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

  const label = a.goal.trim().replace(/^(start|starts|begin|begins|try to|tries to)\s+/i, "").replace(/\.$/, "");
  const traits = (c.core_traits ??= []);
  if (!traits.some((t) => t.toLowerCase() === label.toLowerCase())) traits.push(label);

  (state.traits[id] ??= []).push({
    id: `authored_${turn}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    origin: a.because
      ? `${a.because} — and what started there became the way they live`
      : `did it once, then kept doing it, and stopped noticing they had decided anything`,
    behavioral_impact: `Acts on this without deliberating. It is not a plan they are executing; it is how their week is shaped.`,
    intensity: 7,
    self_weight: 0.6,
    last_reinforced_turn: turn,
    reinforcement_count: Math.max(1, Math.floor((a.acted ?? 0) / 3)),
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
    goal: goal.trim().slice(0, 200),
    approach: opts.approach?.trim().slice(0, 200) || undefined,
    because: opts.because?.trim().slice(0, 240) || undefined,
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
