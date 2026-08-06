/* Smoke test: A WRECKED BODY IS THE FOREGROUND.
 *
 * The engine had two channels for bodily state and no notion of degree in either. `injuries` carry
 * a free-text impact and gate attempts; `conditions` are bare strings that gate nothing, reach the
 * narrator as a comma-joined list, and expire on a fixed ten-turn timer. A sprained wrist and an
 * evisceration were the same shape in both.
 *
 * So a man recorded as "eviscerated and exposed" went on producing composed multi-clause argument
 * with rhetorical figures, planted and arms-crossed — and was ten turns from being quietly well
 * again with nothing in the prose healing him. */
import { severityOfText, bodySeverity, bodyMarks, bodyDirective, fadesOnItsOwn } from "../src/engine/body";
import type { Condition } from "../src/engine/types";

const cond = (conditions: string[], injuries: { type: string; functional_impact?: string }[] = []): Condition => ({
  injuries: injuries.map((i, n) => ({ id: `inj${n}`, type: i.type, cause: "", permanent: false, functional_impact: i.functional_impact ?? "" })),
  conditions, fatigue: "fresh", hunger: "fed", inventory: [], wearing: [],
  psyche: { relaxation: -10, capacity: 2, recovery: 0.18, state: "intact", break_mode: null, consecutive_clenched: 0, mood: "", mood_valence: -10, active_states: [] },
} as unknown as Condition);

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* 1. the grading itself — the exact string the simulator recorded, and its neighbours */
{
  check("the recorded string grades catastrophic", severityOfText("eviscerated and exposed") === 4);
  check("turned inside out grades catastrophic", severityOfText("turned inside out, kept alive") === 4);
  check("flayed grades catastrophic", severityOfText("skin removed, muscle exposed") === 4);
  check("a broken leg is severe, not catastrophic", severityOfText("broken leg") === 3);
  check("a deep gash is moderate", severityOfText("deep gash across the forearm") === 2);
  check("a bruise is mild", severityOfText("bruised ribs") === 1);
  check("nothing recorded is nothing", severityOfText("") === 0);
}

/* 2. severity reads BOTH channels — the simulator filed this one as a condition, not an injury */
{
  const osric = cond(["eviscerated and exposed"], []);   // injuries[] was empty in the real save
  check("a catastrophic CONDITION registers even with no injuries", bodySeverity(osric) === 4, bodySeverity(osric));
  check("the mark is nameable", bodyMarks(osric, 4).includes("eviscerated and exposed"));

  const viaInjury = cond([], [{ type: "disembowelled", functional_impact: "cannot stand" }]);
  check("a catastrophic INJURY registers too", bodySeverity(viaInjury) === 4);
  check("an intact body is 0", bodySeverity(cond([], [])) === 0);
}

/* 3. what the narrator is handed — the failure was that it was handed nothing */
{
  const d = bodyDirective(cond(["eviscerated and exposed"]), "Osric");
  check("a catastrophic body produces a directive", d.length > 0);
  check("it forbids composed speech", /no measured cadence|multi-clause|rhetorical/.test(d), d.slice(0, 120));
  check("it forbids the crossed-arms performance of steadiness", /cross their arms|performing steadiness|perform steadiness/.test(d));
  check("it names what is wrong", d.includes("eviscerated and exposed"));
  check("kept alive is distinguished from unharmed", /cannot die[\s\S]*not being unharmed/.test(d), d.slice(-260));
  check("it refuses quiet normalisation", /recover, stabilise, or normalise|state is true/.test(d));

  check("a bruise gets no paragraph", bodyDirective(cond(["bruised ribs"]), "Osric") === "");
  const severe = bodyDirective(cond(["broken leg"]), "Osric");
  check("severe gets a directive, at lower pitch", severe.length > 0 && !/CATASTROPHICALLY/.test(severe), severe.slice(0, 80));
}

/* 4. catastrophic damage does not expire on the ten-turn condition timer */
{
  check("a bruise still fades on its own", fadesOnItsOwn("bruised ribs"));
  check("a deep gash still fades on its own", fadesOnItsOwn("deep gash across the forearm"));
  check("evisceration does NOT fade on a timer", !fadesOnItsOwn("eviscerated and exposed"));
  check("a broken back does NOT fade on a timer", !fadesOnItsOwn("shattered spine"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
