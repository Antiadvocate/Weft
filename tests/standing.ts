/* THE STATE SAID TERRIFIED AND THE PROSE SAID "LOW AND UNHURRIED".
 *
 * "One line mic drops on everyone. Everyone is the moral righteousness of the final word. Everyone
 * even a fucking 18 year old somehow has my moral judgement at hand."
 *
 * From that save at turn 49, an eighteen-year-old clerk's own record:
 *
 *   relaxation −6.5, mood "chilled"
 *   incredulous (37) · replaying it (39) · apprehensive (39) · insulted (45)
 *   shaken by the player's impossible power (48 turns)
 *   power_witnessed: { tier: "mythic", turn: 33 }
 *
 * What the narrator was told about her: `mood chilled` and "is cool toward you — distant,
 * unengaged, polite brush-offs". active_states was rendered for the PLAYER and for nobody else;
 * `power` was written by social.ts and read by no prompt anywhere; and dispositionCue takes warmth
 * and trust, both intimacy axes, neither of which can say "is frightened of you". So the only
 * register available at negative warmth was cold composure — and cold composure reads as poise. */
import { dispositionCue, effectiveStanding } from "../src/engine/desire";
import { findFigure, findMetaTalk } from "../src/engine/maxims";
import { narratorSystem } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}

/* ── 1. standing reaches the cue at all ─────────────────────────────────────── */
{
  const plain = dispositionCue(-17, -14.8, 0);
  check("with no standing, the cue is what it always was", !/BELOW YOU|HOLD THE POWER/.test(plain));
  const below = dispositionCue(-17, -14.8, -25);
  check("someone far below lets the player close the exchange", /let you be the one to end the conversation/.test(below), below.slice(-140));
  check("…and still refuses — deference is not obedience", /If they refuse|can still refuse/.test(below + dispositionCue(-17, -14.8, -8)));
  check("a middling gap is its own, milder line",
    /below you in standing/i.test(dispositionCue(0, 0, -8)) && !/FAR BELOW/i.test(dispositionCue(0, 0, -8)));
  check("someone above the player reads the other way", /have the power here/.test(dispositionCue(0, 0, 30)));
  check("the warmth and trust halves are untouched",
    /cool toward you/.test(below) && /wary of trusting you/.test(below));
}

/* ── 2. what the world watched you do sets a floor under standing ───────────── */
{
  check("a ledger that never learned still defers after mythic power", effectiveStanding(-2, "mythic") === -25);
  check("…and the tier only ever pushes toward deference", effectiveStanding(-60, "mythic") === -60);
  check("an ordinary world leaves the ledger alone", effectiveStanding(-2, "mortal") === -2);
  check("no tier recorded is the same as mortal", effectiveStanding(-2, undefined) === -2);
  check("the tiers are ordered", effectiveStanding(0, "cosmic") < effectiveStanding(0, "mythic")
    && effectiveStanding(0, "mythic") < effectiveStanding(0, "empowered")
    && effectiveStanding(0, "empowered") < 0);
  check("an unknown tier is treated as no claim", effectiveStanding(-3, "nonsense") === -3);
}

/* ── 3. the composure tic, with the simile taken off ────────────────────────── */
{
  // the eight consecutive turns, verbatim
  const turns = [
    `"No." Her voice is low and even. She does not move from the door.`,
    `"I said no." Her voice is still calm, and she sets the cup down.`,
    `"Then I will go." Her voice is low and even, and she reaches for her coat.`,
    `"You have my answer." Her voice is steady as she turns the latch.`,
  ];
  check("three turns of it is caught as a hand", !!findFigure(turns.slice(0, 3), turns[3]), turns[3]);
  check("…and it is reported as the composed-voice frame", findFigure(turns.slice(0, 3), turns[3])?.frame === "composed-voice");
  check("one use is a sentence, not a tic", !findFigure([], turns[0]));
  check("two is still not a tic", !findFigure([turns[0]], turns[1]));
  // the simile form it was originally built for still fires
  const sim = [`"Which friends." She said it flat, like the word had a price on it.`,
               `"Sarah." She said it flat, like she was putting it somewhere.`,
               `"Both." She said it quietly, like she was checking the weight of it.`];
  check("the original simile frame is untouched", findFigure(sim.slice(0, 2), sim[2])?.frame === "said-it-like");
}

/* ── 4. reciting the transcript, in the tense people actually use ───────────── */
{
  const state = { characters: { c1: { name: "Olga Reiter" } } } as any;
  const t = (s: string) => `Olga Reiter stands in the doorway. "${s}"`;
  // the drip: one verdict a turn, never three in a turn, never two turns running
  const prev = [
    t("I came up five flights because you asked me to."),
    t("I want to know if there is anything in what you told me."),
    t("The rain has not let up at all."),
  ];
  const now = t("You have told me now that I am difficult, and a coward, and a liar. And you have told me to go.");
  const hit = findMetaTalk(state, ["c1"], prev, now);
  check("a verdict a turn over a window is caught, not just a burst", !!hit, hit);
  check("…and it names who has been doing it", hit?.name === "Olga Reiter");
  // and a clean stretch stays clean
  const calm = [t("The rain has not let up."), t("Eight shillings, and the man wanted ten."), t("I will take the later train.")];
  check("ordinary talk about the world is not a recitation",
    !findMetaTalk(state, ["c1"], calm, t("There is a clerk at the depot until eight.")));
}

/* ── 5. the turn no longer has to end on somebody's reply ───────────────────── */
{
  const sys = narratorSystem(false);
  check("the contract distinguishes where a turn stops from who speaks last",
    /Make two separate decisions every turn/.test(sys));
  check("…and says a dismissal lands", /When the player ends an exchange, it's over/.test(sys));
  check("…and names the parting-shot reflex specifically",
    /don't get a parting shot/.test(sys));
  check("the existing quiet-ending permission survives", /A quiet ending is fine/.test(sys));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
