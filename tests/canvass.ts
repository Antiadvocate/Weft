/* Smoke test: ONE QUESTION, SEVERAL PEOPLE, AND NOT FOUR WHO AGREE.
 *
 * The interview reaches one person at a time. What the engine actually models is the difference
 * between people — who heard what from whom, who has the player wrong — and that is only visible
 * when the same question goes to several of them. Who gets asked is chosen for free: relevance first,
 * then a spread across how they stand toward the player. */
import { pickCanvass, knowsLines, leaningOf } from "../src/engine/canvass";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const ch = (id: string, name: string, background = "", extra: any = {}) =>
  ({ character_id: id, name, background, core_traits: [], ...extra });
const edge = (from: string, warmth: number) => ({ from, to: "char_player", warmth, trust: 0, power: 0, notes: "", updated_turn: 1 });
const s: any = {
  world: {
    current_turn: 30, present: ["char_player", "char_ann"],
    edges: [edge("char_ann", 60), edge("char_bo", 55), edge("char_cy", 50), edge("char_di", -45), edge("char_ed", 5), edge("char_fay", 40)],
    rumors: [{ id: "r1", content: "I watched Joe burn down the mill at the weir", truth: "true", salience: 8, origin_char: "char_di",
      knowers: ["char_di", "char_bo"], born_turn: 28, path: [{ to: "char_di", from: null, turn: 28, how: "witnessed" }, { to: "char_bo", from: "char_di", turn: 29, how: "told" }] }],
  },
  characters: {
    char_player: ch("char_player", "Joe Arden"),
    char_ann: ch("char_ann", "Ann Weir", "Keeps the inn by the river.", { tracked: true }),
    char_bo: ch("char_bo", "Bo Tamm", "Fishes the weir and mends nets."),
    char_cy: ch("char_cy", "Cy Lark", "Sings at the inn on market days."),
    char_di: ch("char_di", "Di Stroud", "The miller's widow; the mill at the weir was her husband's."),
    char_ed: ch("char_ed", "Ed Pole", "Carts grain to the mill."),
    char_fay: ch("char_fay", "Fay Holm", "Herbalist. Lives up the valley.", { status: "dead" }),
  },
  memory: {
    char_ed: { episodic: [{ turn: 27, content: "I carted the last of the grain to the mill before the fire", importance: 6 }] },
  },
  minds: { char_cy: { character_id: "char_cy", about: [{ target: "char_player", predicted_warmth: -40, predicted_stance: "rival", held_false: "set the fire to ruin the widow", surprise: 0, confidence: 0.8, updated_turn: 29 }] } },
};

const picks = pickCanvass(s, "Who burned the mill?", 4);
const ids = picks.map((p) => p.id);
check("four people asked", picks.length === 4, ids);
check("the dead are not asked", !ids.includes("char_fay"));
check("the player is not asked", !ids.includes("char_player"));
check("the witness is asked", ids.includes("char_di"), picks);
check("so is the man who heard it from her", ids.includes("char_bo"), picks);
check("and the one carrying a misread", ids.includes("char_cy"), picks);
check("they don't all feel the same about you", new Set(picks.map((p) => p.leaning)).size >= 3, picks.map((p) => p.leaning));
check("the reason says what they heard", /heard “I watched Joe burn down the mill/.test(picks.find((p) => p.id === "char_bo")?.why ?? ""), picks.find((p) => p.id === "char_bo")?.why);
check("a person named in the question ranks first", pickCanvass(s, "What does Ed make of the fire?", 4)[0]?.id === "char_ed");

check("a held misread reads as one", leaningOf(s, "char_cy") === "misread");
check("cold is cold", leaningOf(s, "char_di") === "cold");

const bo = knowsLines(s, "char_bo").join("\n");
check("they answer from what they heard, and who told them", /“I watched Joe burn down the mill at the weir” \(from Di Stroud\)/.test(bo), bo);
check("the witness has not 'heard' her own story", !knowsLines(s, "char_di").some((l) => /heard/.test(l)));
check("a misread is held as conviction", knowsLines(s, "char_cy").some((l) => /About the player, you are convinced: set the fire/.test(l)), knowsLines(s, "char_cy"));
check("a small cast gives what it has", pickCanvass(s, "anything", 10).length === 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
