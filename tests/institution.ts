/* Smoke test: A FACTION THAT SAYS SOMETHING, AS WELL AS ONE THAT DOES SOMETHING.
 *
 * A faction was a clock: it acted and never spoke. The Church buying up the valley's debts had no
 * public position for its priest to repeat, and no gap between what the institution says and what
 * the man in its robes thinks. Now a clock carries a public line beside its objective, people carry
 * an affiliation, and the faction can be asked a question in its own public voice — built from what
 * is public only, so it cannot let slip the objective it was never handed. */
import { factionOf, speaksForLine, institutionContext, askableFactions } from "../src/engine/institution";
import { pickFactions } from "../src/engine/canvass";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s = newSave("Valley", { name: "Valley", era: "early medieval" } as any);
s.world.canon = ["The Hall settles every dispute in the valley."];
const aedan = registerCharacter(s, { name: "Áedán Mac Ruith", affiliation: "The Hall", background: "Steward." });
const brother = registerCharacter(s, { name: "Brother Colm", background: "A monk of the Abbey of St Fintan, keeper of its ledgers." });
const di = registerCharacter(s, { name: "Di Stroud", background: "The miller's widow." });
s.world.clocks.push(
  { id: "k1", faction: "The Hall", objective: "settle the succession on the steward's nephew before the thaw", segments: 6, filled: 3,
    consequence: "the nephew is acclaimed and the old lord's daughter is sent away", visible_signs: ["riders carrying sealed letters", "the nephew sits at the high table", "the daughter is no longer seen at mass"], status: "running",
    public_line: "the Hall is keeping the peace of the valley until the thaw", speaks_through: "the steward's notices on the mill door" },
  { id: "k2", faction: "Abbey of St Fintan", objective: "buy up the valley's debts", segments: 6, filled: 0, consequence: "", visible_signs: ["a monk at every debtor's door"], status: "running" },
  { id: "k3", faction: "The Raiders", objective: "burn the lower town", segments: 4, filled: 4, consequence: "", visible_signs: [], status: "fired", public_line: "nothing" },
);

check("affiliation survives registration", s.characters[aedan].affiliation === "The Hall");
check("an affiliation names its faction", factionOf(s, aedan)?.id === "k1");
check("once affiliations are recorded, a blank one means no faction", factionOf(s, brother) === null);
check("in a save with no affiliations, membership falls back to the background", (() => {
  const old = s.characters[aedan].affiliation; s.characters[aedan].affiliation = undefined;
  const got = factionOf(s, brother)?.id; s.characters[aedan].affiliation = old; return got === "k2";
})());
check("someone who belongs to nothing belongs to nothing", factionOf(s, di) === null);

const line = speaksForLine(s, aedan);
check("the narrator is told who someone speaks for, and the line", /speaks for The Hall in public, and its line is: "the Hall is keeping the peace/.test(line), line);
check("and that what they think in private may differ", /alone with someone they trust, they may say what they actually think/.test(line));
check("a faction with no public line gives its members no line", (s.characters[brother].affiliation = "Abbey of St Fintan", speaksForLine(s, brother) === ""));

const ctx = institutionContext(s, s.world.clocks[0]);
check("the public voice gets the public line", /What it says in public: the Hall is keeping the peace/.test(ctx));
check("and how it reaches people", /notices on the mill door/.test(ctx));
check("and what anyone can see, as far along as it is", /riders carrying sealed letters/.test(ctx) && !/no longer seen at mass/.test(ctx), ctx);
check("never the private objective", !/succession|steward.s nephew/.test(ctx), ctx);
check("never the consequence", !/sent away/.test(ctx));
check("a faction with no statement answers from what can be seen", /made no public statement/.test(institutionContext(s, s.world.clocks[1])));

check("a fired faction can't be asked", !askableFactions(s).some((k) => k.id === "k3"));
s.world.clocks.push({ id: "k4", faction: "The lake ice", objective: "the thaw", segments: 8, filled: 2, consequence: "", visible_signs: ["the ice groans at night"], status: "running" });
check("a force of nature has no spokesperson", !askableFactions(s).some((k) => k.id === "k4"));
s.characters[brother].affiliation = "Abbey of St Fintan";
check("an institution with a recorded member but no statement can still be asked", askableFactions(s).some((k) => k.id === "k2"));
check("a faction named in the question is offered", pickFactions(s, "What is the Hall doing about the succession?")[0]?.id === "k1");
check("a question about nothing they do offers none", pickFactions(s, "Is it going to rain?").length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
