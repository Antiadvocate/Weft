/* THE TURN, READ BY THE SMALL MODEL BEFORE IT'S WRITTEN.
 *
 * What the player meant reaches the engine as fields (engine/actionread.ts) in place of word lists.
 * This holds the engine's half: the answer is held to the shape and to people who exist, the read
 * is made once a turn and reused, and an empty read means nothing of that kind happened. */
import { shapeRead, storyText, readAction, setRead, turnRead, EMPTY_READ, ACTION_READ_SCHEMA } from "../src/engine/actionread";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s = JSON.parse(readFileSync("tests/fixtures/veythar.json", "utf8")) as SaveState;
const M = "char_mv4s64a8rmmxo", E = "char_mv4s64a46df5n";
s.world.current_turn = 26;

const g = {
  said: ["I AM THE KING"], did: "skins her down to the bone with magic", thought: "",
  harms: [{ who: [M, "char_nobody", "someone", "char_player"], what: "skins her to the bone", kills: true, mass: false }, { who: [], what: "" }],
  turns_away: [E, "char_ghost", E], threatens: "not a list", leaving: { going: "yes", to: "the gardens" },
  story_change: { asked: 1, remove: "beacon works", true_now: "Ellie is the contact." },
};
const r = shapeRead(s, g);
check("people are held to ids the story knows, with \"someone\" allowed only for harm", JSON.stringify(r.harms[0].who) === JSON.stringify([M, "someone"]) && JSON.stringify(r.turns_away) === JSON.stringify([E]), r);
check("the player is never on the receiving end of their own act", !r.harms[0].who.includes("char_player"));
check("an empty harm is dropped", r.harms.length === 1);
check("a malformed field reads as nothing", r.threatens.length === 0);
check("flags come out as booleans", r.leaving.going === true && r.story_change.asked === true && r.harms[0].kills === true);
check("a missing answer is an empty read", JSON.stringify(shapeRead(s, null)) === JSON.stringify(EMPTY_READ));

check("((search)) and [[beat]] are the engine's, so the read never sees them", storyText("I draw ((Astra Militarum tactics)) my sword [[beat: voice]]  now") === "I draw my sword now", storyText("I draw ((x)) my sword [[beat]] now"));

{
  setRead(s, "I skin her.", { harms: [{ who: [M], what: "skins her", kills: true, mass: false }] });
  check("the read is the turn's", turnRead(s).harms[0]?.who[0] === M);
  let called = false;
  const real = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => { called = true; throw new Error("no network in tests"); };
  readAction(s, "I skin her.", "do").then((again) => {
    check("asked again for the same words this turn, it's reused without a call", !called && again.harms[0]?.who[0] === M);
    s.world.current_turn = 27;
    check("next turn, the old read isn't this turn's", turnRead(s) === EMPTY_READ);
    (globalThis as any).fetch = real;
    finish();
  });
}

function finish() {
  const schema = JSON.stringify(ACTION_READ_SCHEMA);
  check("the schema carries every field the engine reads", ["said", "did", "thought", "to_the_game", "story_change", "leaving", "drop_subject", "gives_to", "orders", "turns_away", "ends_with", "harms", "threatens", "shows_power", "removes", "declares", "says_described_back"].every((k) => schema.includes(`"${k}"`)));
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("every turn is read before anything is built from it", turn.indexOf("await readAction(state, action, mode, signal)") > 0 && turn.indexOf("await readAction(state, action, mode, signal)") < turn.indexOf("await pushSnapshot(state)"));
  check("and the read is kept on the turn's history entry", /\.\.\.\(thisRead !== EMPTY_READ \? \{ read: thisRead \} : \{\}\)/.test(turn));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
