/* Smoke test: "SIGN." … "OKAY."
 *
 * Turn 101 of a save. The player, to his wife: "I'm going to fill these docs out. Please sign."
 *
 *     "Sign." She said it to the form. "You want me to sign."
 *     Her thumb creased the corner of the page. She pressed it flat.
 *     "Okay."
 *     She picked up the pen and wrote her name on the line.
 *
 * A marriage ended on the first ask, in one word. The player's calibration is the only one this
 * needs: "You know how much I argued with my ex wife when she filed for divorce? Do you think it was
 * a single line?"
 *
 * THE ENGINE HAD THE ANSWER ON HER CARD, at that exact moment:
 *
 *     attachment    anxious
 *     under_threat  "Becomes hyper-vigilant and controlling... She'll pick at a flaw in a plan or a
 *                    person relentlessly."
 *     states        ["fixated on Vin" — 34 turns old, "replaying it"]
 *     repairing     8, toward the player
 *
 * Every field contradicted the scene and not one was load-bearing, because nothing in the engine
 * treats "I am ending this" as something that has to get PAST somebody. The prose rules were there —
 * "no instant agreement", "an instant uncomplicated yes from a character with an agenda is a
 * rendering failure" — and at the highest-stakes moment in the story both were ignored, because they
 * read as prose guidance and this reads as a plot event.
 *
 * So it is resolved before the prose, like attempt.ts. Stake buys rounds. It is never a veto: the
 * player leaves regardless. It costs the scenes it would really cost.
 */
import { stakeOf, roundsFor, severanceDirective, tickSeverance } from "../src/engine/severance";
import { setRead, type ActionRead } from "../src/engine/actionread";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. what counts as saying it ──────────────────────────────────────────────
 *
 * Whether a line ends it, and with whom, is the turn read's call (actionread.ts: ends_with), and
 * once it's open, whether a turn holds to it or takes it back (ending_stance). The lines below are
 * the ones the old word lists were tested on; each is handed in with the read a careful reader gives
 * it, and the engine does what the read says. */
function tick(st: SaveState, action: string, read: Partial<ActionRead> = {}, present = ["char_m"]): void {
  setRead(st, action, read);
  tickSeverance(st, action, present);
}
const ENDS: Partial<ActionRead> = { ends_with: ["char_m"] };
const HOLDS: Partial<ActionRead> = { ending_stance: "holds" };
{
  for (const said of [
    `"I'm done with this marriage. We don't have anymore trust."`,
    `"I'm going to fill these docs out. Please sign."`,   // the line from the save; no "divorce" in it
    `"Exactly. And this is why it's over."`,
    `"Miranda. I'm leaving you."`,
    `"Sarah. I'm ending our friendship."`,
    `I look up how to file for a divorce and tell her I want a divorce.`,
  ]) {
    const st = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
    tick(st, said, ENDS);
    check(`said: ${said.slice(0, 44)}…`, st.severance?.toward === "char_m", said);
  }

  // ...and the ways people say the words without meaning them as a verdict: a reader ends nothing
  for (const notSaid of [
    `"Are we over? Because it feels like it."`,
    `"If you keep doing this, I'm leaving you."`,
    `"My parents are getting a divorce."`,
    `"Do you want a divorce? Is that what this is?"`,
    `"I've been wondering if it's over."`,
    `"I almost said it was over last night."`,
  ]) {
    const st = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
    tick(st, notSaid);
    check(`not a verdict: ${notSaid.slice(0, 40)}…`, !st.severance, notSaid);
  }

  const off = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
  tick(off, `"I'm done with this marriage."`, ENDS, []);
  check("ending it with someone who isn't in the room opens nothing here", !off.severance, off.severance);
}

/* ── 2. stake is investment, not current warmth ──────────────────────────────────
 *
 * By the time anybody says these words the numbers are always ugly — hers were warmth -7.8, trust
 * -15.4. A bond is not worth less because the last week was bad. */
function world(opts: { roles: string[]; shared: number; fixated?: boolean; repairing?: boolean }): SaveState {
  return {
    world: { current_turn: 101, present: ["char_m"], edges: [
      { from: "char_m", to: "char_player", warmth: -7.8, trust: -15.4, power: 0, attraction: 0, roles: opts.roles },
    ] },
    characters: {
      char_player: { name: "Vin" },
      char_m: { name: "Miranda", conscience: 0.8,
        attachment: { style: "anxious", under_threat: "Becomes hyper-vigilant and controlling. She'll pick at a flaw in a plan or a person relentlessly.", soothed_by: "A firm, unambiguous statement of love that leaves no room for doubt." } },
    },
    condition: { char_m: { psyche: { relaxation: -8.4, active_states: opts.fixated ? ["fixated on Vin"] : [],
      repairing: opts.repairing ? 8 : 0, repair_toward: opts.repairing ? "char_player" : undefined } } },
    memory: { char_m: { episodic: Array.from({ length: opts.shared }, () => ({ content: "Vin and I did something." })) } },
  } as unknown as SaveState;
}
{
  const wife = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
  const s = stakeOf(wife, "char_m", "char_player");
  check("a wife of 38 remembered scenes has everything in it", s >= 0.7, s);
  check("...and that buys the most rounds", roundsFor(s) === 4, roundsFor(s));
  check("...even though her warmth is deeply negative", wife.world.edges[0].warmth < 0);

  const acquaintance = stakeOf(world({ roles: [], shared: 1 }), "char_m", "char_player");
  check("somebody barely known has little in it", acquaintance < 0.25, acquaintance);
  check("...and that ends when it is said", roundsFor(acquaintance) === 1);

  const friend = stakeOf(world({ roles: ["friend"], shared: 12 }), "char_m", "char_player");
  check("a real friendship sits in between", friend > acquaintance && friend < s, friend);
}

/* ── 3. the rounds, and what each one forbids ────────────────────────────────── */
{
  const st = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
  tick(st, `"I'm done with this marriage."`, ENDS);
  check("saying it opens a severance", !!st.severance, st.severance);
  check("...with rounds bought by what she has in it", (st.severance?.needed ?? 0) === 4, st.severance);

  const d1 = severanceDirective(st);
  check("round one: she does not hear it as final", /DON'T HEAR IT AS FINAL/.test(d1), d1);
  check("...and the shrug is forbidden by name", /There's no "okay", no signing it/.test(d1), d1);
  check("...using HER card, not a generic reaction", /pick at a flaw/.test(d1), d1);
  check("...including what would actually reach her", /firm, unambiguous statement of love/.test(d1), d1);
  check("...and the player is never blocked from leaving", /THE PLAYER STILL GETS TO LEAVE/.test(d1), d1);

  // and it does not repeat itself — round three is not round one again
  tick(st, `"It's over, Miranda."`, ENDS);
  tick(st, `"I'm done. Sign the papers."`, ENDS);
  const d3 = severanceDirective(st);
  check("round three is a different scene from round one", d3 !== d1);
  check("...where the composure goes", /STOP FIGHTING CLEAN|unforgivable/.test(d3), d3);

  // ...and holding the line in three words still counts, or the rounds never finish
  tick(st, `"Sign them."`, HOLDS);
  tick(st, `"Sign them."`, HOLDS);
  check("once four rounds of her are spent, it lands", !st.severance, st.severance);
}

/* ── 3b. holding the line, and taking it back ────────────────────────────────── */
{
  const st = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
  tick(st, `"I'm done with this marriage."`, ENDS);
  const before = st.severance!.rounds;
  tick(st, `"I meant it."`, HOLDS);
  check("a three-word restatement advances it", st.severance!.rounds === before + 1, st.severance);

  tick(st, `I sit down and drink my coffee.`);
  check("...and an unrelated turn does not", st.severance!.rounds === before + 1, st.severance);
  tick(st, `I go to the kitchen and pour a coffee.`, { leaving: { going: true, to: "the kitchen", place: "", home: false } });
  check("...nor does going to the kitchen", st.severance!.rounds === before + 1, st.severance);

  const back = world({ roles: ["wife"], shared: 38, fixated: true, repairing: true });
  tick(back, `"I'm done with this marriage."`, ENDS);
  check("taking it back closes it", (tick(back, `"Wait. I didn't mean that. Can we talk?"`, { ending_stance: "retracts" }), !back.severance), back.severance);
}

/* ── 4. it never fires where there is nothing to end ─────────────────────────── */
{
  const st = world({ roles: [], shared: 0 });
  tick(st, `"We're over."`, ENDS);
  check("a bond nobody was in ends when somebody says so", !st.severance, st.severance);

  const away = world({ roles: ["wife"], shared: 38 });
  tick(away, `"I'm done with this marriage."`, ENDS);
  check("an open severance closes when she is not in the room", (tick(away, "I keep driving", {}, []), !away.severance));

  const quiet = world({ roles: ["wife"], shared: 38 });
  tick(quiet, `I make coffee and read the paper.`);
  check("an ordinary turn opens nothing", !quiet.severance);
  check("...and says nothing to the narrator", severanceDirective(quiet) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
