/* Smoke test: HE SAID IT WASN'T REAL AND THE ENGINE FILED THAT AS A SYMPTOM.
 *
 * "Random invention of Mrs. Gable? Marcus? Is the narrator just making up memories?"
 *
 * From a save at turn 81. The narrator introduced a manager called Marcus on turn 71 and a
 * receptionist called Mrs. Gable on turn 78. Neither is a registered character, neither is in any
 * place, neither appears anywhere in the world bible. The bookkeeper ledgered them both, because
 * the gate on a fact asks whether its specifics trace to THIS TURN'S PROSE — and the prose is
 * precisely where they were invented. Under KNOWS (verified facts), the highest-trust line on the
 * card:
 *
 *   "Mrs. Gable at the front desk told Amber that receptionists should wear closed shoes and that
 *    front desk staff share impressions with Marcus."
 *
 * On turn 80 he typed that Mrs. Gable does not exist and they had never been to any lobby. What the
 * engine wrote down:
 *
 *   Joe:   "I told Amber that Mrs. Gable does not exist, but Amber stared at me like I had lost
 *           my mind."
 *   Amber (fact): "Joe claims Mrs. Gable does not exist and that they have not visited any lobby."
 *
 * His correction became evidence that he is unreliable, and the invention kept its place. The
 * narrator document already promises the opposite — "they are almost certainly right: do not defend
 * it, do not build lore to justify it. Drop it, and continue as though it was never said" — and
 * `retcons` implements it for text struck by hand in the UI. Said in play it reached nothing. */
import { deniedEntities, strikeEntity } from "../src/engine/integrity";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const KNOWN = ["Joe", "Amber", "The Living Room", "The Elevator Lobby", "Sara"];

/* ── 1. the shapes a player actually types ───────────────────────────────────── */
{
  const yes: [string, string][] = [
    ["I told Amber that Mrs. Gable does not exist and we never went to any lobby", "Mrs. Gable"],
    ["Marcus doesn't exist", "Marcus"],
    ["There is no Mrs. Gable", "Mrs. Gable"],
    ["Denise isn't real", "Denise"],
    ["We never met Marcus", "Marcus"],
    ["You made up Mrs. Gable", "Mrs. Gable"],
    ["you invented Denise", "Denise"],
  ];
  for (const [line, want] of yes) {
    const got = deniedEntities(line, KNOWN);
    check(`caught: ${line.slice(0, 46)}…`, got.includes(want), got);
  }
}

/* ── 2. and the far more important half: what it must NOT strike ─────────────── */
{
  const no = [
    "Amber does not exist to them, that's the whole problem",   // a real character, said in a scene
    "There is no Sara here right now",                          // a real person, merely absent
    "The Elevator Lobby doesn't exist on the floor plan",       // a real place from the bible
    "I don't exist to my family any more",                      // the player about himself
    "There is no way I'm doing that",                           // not a name at all
    "That doesn't exist",                                       // no name
    "We never went to bed angry",                               // not a name
    "You made up your mind already",                            // not a name
  ];
  for (const line of no) {
    const got = deniedEntities(line, KNOWN);
    check(`left alone: ${line.slice(0, 44)}…`, got.length === 0, got);
  }
}

/* ── 3. striking it takes it out of the ledger, not just out of the prose ─────── */
{
  const s = {
    world: { current_turn: 81, rumors: [{ id: "r1", content: "Mrs. Gable told Amber about the shoes" }],
      threads: [{ id: "t1", title: "The front desk", description: "Mrs. Gable advised Amber on shoes" },
                { id: "t2", title: "The blanket", description: "Amber left it on the couch" }] },
    memory: {
      char_player: {
        facts: [{ content: "Mrs. Gable at the front desk told Amber that receptionists wear closed shoes.", turn: 78 },
                { content: "Amber graduated in the spring.", turn: 12 }],
        episodic: [{ turn: 80, content: "I told Amber that Mrs. Gable does not exist, but Amber stared at me like I had lost my mind." },
                   { turn: 12, content: "Amber moved in with two bags." }],
        beliefs: [{ content: "Mrs. Gable disapproves of open shoes." }],
      },
      char_amber: { facts: [{ content: "Joe claims Mrs. Gable does not exist.", turn: 80 }], episodic: [], beliefs: [] },
    },
    retcons: [],
  } as unknown as SaveState;
  const gone = strikeEntity(s, "Mrs. Gable");
  check("the invented FACT is gone from the bank", gone.facts === 2, gone);
  check("...and the memory that treated the denial as a symptom", gone.memories === 1, gone);
  check("...and the belief built on top of it",
    (s.memory.char_player.beliefs ?? []).length === 0);
  check("...and the rumour spreading it", s.world.rumors.length === 0);
  check("...and the thread hanging off it", s.world.threads.length === 1 && s.world.threads[0].id === "t2", s.world.threads);
  const kept = s.memory.char_player.facts ?? [];
  check("REAL RECORDS ARE UNTOUCHED", kept.length === 1
    && /graduated in the spring/.test(kept[0].content), kept);
  check("...including memories of things that did happen",
    s.memory.char_player.episodic.length === 1 && /two bags/.test(s.memory.char_player.episodic[0].content));
  check("and the narrator is told, in the channel it already obeys",
    (s.retcons ?? []).some((r) => r.kind === "veto" && /Mrs\. Gable does not exist and never did/.test(r.text)), s.retcons);
  check("...never to write them again", (s.retcons ?? []).some((r) => /Never write Mrs\. Gable again/.test(r.text)));
}
{
  // striking twice is not two vetoes
  const s = { world: { current_turn: 5, rumors: [], threads: [] }, memory: {}, retcons: [] } as unknown as SaveState;
  strikeEntity(s, "Marcus"); strikeEntity(s, "Marcus");
  check("striking the same invention twice leaves one veto", (s.retcons ?? []).length === 1, s.retcons);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
