/* Smoke test: NINE PEOPLE, FIVE OF THEM DOING PAPERWORK.
 *
 * Read straight off one save at turn 260 — every living character's active want:
 *
 *   Hewitt   "Draft and set down a formal written schedule of duties, hours, and a named
 *             assistant clerk for the records office, and present it to Mable as the terms…"
 *   Aldric   "Reconcile the vault and grain ledgers against the actual counted stores…
 *             producing a clean written reserve tally for the coming winter."
 *   Gerard   "…lock in a season's supply contract from both sides through his stall…"
 *   envoy    "Secure a written agreement fixing the price of Mereth's grain and woven cloth…
 *             sealed before she leaves Thornwood."
 *   commander"Press on with the negotiation for the north court charter…"
 *
 * The last of those is the commander of an invading army. The player: "I had to invent an army to
 * make it interesting and the army… is signing charters."
 *
 * The drive prompt asks for a want that is concrete, needs nobody's permission, can be pursued by
 * the person's own hands starting today, and is verifiable as done. A document satisfies all four
 * perfectly — it is the locally optimal answer — and every want was forged in isolation, so nine
 * independent calls under identical constraints converged on it at once. */
import { newSave, registerCharacter } from "../src/engine/state";
import { isPaperworkGoal, paperworkHolders } from "../src/engine/driveforge";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const REAL: [string, string][] = [
  ["Hewitt", "Draft and set down a formal written schedule of duties, hours, and a named assistant clerk for the records office, and present it to Mable as the terms under which the vault can keep running."],
  ["Aldric", "Reconcile the vault and grain ledgers against the actual counted stores before the God-Duke's next audit, producing a clean written reserve tally for the coming winter."],
  ["Gerard", "Before winter closes the roads, corner the flow of goods between Thornwood and Baron Coteret's camp by locking in a season's supply contract from both sides through his stall in the north court"],
  ["Mereth's envoy", "Secure a written agreement fixing the price of Mereth's grain and woven cloth against Veridun coin and safe passage home, sealed before she leaves Thornwood."],
  ["The barefoot commander", "Press on with the negotiation for the north court charter and see if the duke can be useful."],
];

/* 1. every one of the five is recognised */
{
  for (const [who, goal] of REAL) check(`${who}'s want is paperwork`, isPaperworkGoal(goal), goal.slice(0, 70));
}

/* 2. and real wants are not */
{
  const fine = [
    "Get strong again after the winter sickness — walk the wall twice a day until he can do it without stopping.",
    "Make the man who shorted her on the wool pay for it in front of the whole market.",
    "Fix the byre roof before the next storm takes the ceiling with it.",
    "Find out what is actually at the end of the north road, and go alone.",
    "Get her brother's boy taken on at the forge before the levy reaches him.",
    "Bed the singer who comes through with the autumn carts.",
    "Get the mare's leg right before she has to be put down.",
    "Be asked to the table where the decisions get made, once, on her own name.",
  ];
  for (const g of fine) check(`not paperwork: ${g.slice(0, 44)}…`, !isPaperworkGoal(g), g);
}

/* 3. a document MENTIONED is not a document PURSUED */
{
  check("grain before the audit is about grain",
    !isPaperworkGoal("Get the grain into the cellar before the God-Duke's audit."), "audit is the deadline, not the goal");
  check("outrunning a writ is not filing one",
    !isPaperworkGoal("Be over the border before the writ reaches the sheriff."));
  check("but drawing one up is", isPaperworkGoal("Draw up the writ and have it sealed by Friday."));
}

/* 4. the gate is cast-aware — the FIRST clerk is allowed to be a clerk */
{
  const s: SaveState = newSave("drives", { name: "V" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const ids = REAL.map(([name]) => registerCharacter(s, { name } as any));

  check("in an empty cast, nobody else is doing paperwork", paperworkHolders(s, ids[0]).length === 0);

  // the steward takes the ledgers — legitimate, and it stands
  s.characters[ids[1]].drive = { goal: REAL[1][1], progress: 0, priority: 1, updated_turn: 1 } as any;
  check("now one person holds it", paperworkHolders(s, ids[0]).join() === "Aldric", paperworkHolders(s, ids[0]));
  check("and it is not counted against himself", paperworkHolders(s, ids[1]).length === 0);

  // so the next four are what the gate is for
  for (const i of [0, 2, 3, 4]) {
    const holders = paperworkHolders(s, ids[i]);
    check(`${REAL[i][0]} would be sent back`, holders.length > 0 && isPaperworkGoal(REAL[i][1]), REAL[i][0]);
  }

  // the dead and the departed do not hold a slot open
  s.characters[ids[1]].status = "departed";
  check("a departed clerk frees the slot", paperworkHolders(s, ids[0]).length === 0);
  s.characters[ids[1]].status = "active";

  // and a cast doing real things blocks nothing
  s.characters[ids[1]].drive = { goal: "Fix the byre roof before the storm.", progress: 0, priority: 1, updated_turn: 1 } as any;
  check("an ordinary want holds no slot", paperworkHolders(s, ids[0]).length === 0, paperworkHolders(s, ids[0]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
