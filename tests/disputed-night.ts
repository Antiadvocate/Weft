/* THE NIGHT SHE DIDN'T COME HOME, AND THE NIGHT SHE SAID SHE DID.
 *
 * "May losing her entire memory is pretty insane because it was a pretty massive fight ... major
 *  things like 'I didn't come home all night' are not things you can glance over. That's a major
 *  failure. Especially a day later."
 *
 * Rainier Valley, turns 63-114, fixture cut from the save. At T86 May says she slept in the wellness
 * room at the office. At T110 she says she was home by seven; at T112 the texts are "from Friday";
 * at T113 she asks whether he put the blanket over her, which is T88 with the two of them swapped.
 * Her T86 memory was at decay stage 3 and had not been retrieved since T90. See engine/record.ts.
 */
import { readFileSync } from "node:fs";
import { disputesPast, recordRecall } from "../src/engine/record";
import type { SaveState, EpisodicMemory } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/disputed-night.json", "utf8")) as {
  may_id: string; history: { turn: number; time_label: string; summary: string; player_action: string }[]; may_memory: EpisodicMemory[];
};
const MAY = FIX.may_id;
const at = (turn: number): SaveState => ({
  characters: { char_player: { name: "Rabi" }, [MAY]: { name: "May", pronouns: "she/her" } },
  world: { current_turn: turn, present: ["char_player", MAY] },
  history: FIX.history.filter((h) => h.turn < turn),
  memory: { [MAY]: { episodic: JSON.parse(JSON.stringify(FIX.may_memory)) } },
  model_settings: { history_window: 5 },
} as unknown as SaveState);
const said = (turn: number) => FIX.history.find((h) => h.turn === turn)!.player_action;

/* ── 1. every line of the fight reads as reaching into the past ──────────────── */
for (const t of [110, 111, 112, 113, 114]) check(`T${t} disputes the past`, disputesPast(said(t)), said(t));
check("ordering dinner does not", !disputesPast(said(107)), said(107));
check("sitting down next to her does not", !disputesPast(said(105)), said(105));
check("\"they can't keep you overnight\" does: it's where her version started to drift", disputesPast(said(108)));

/* ── 2. at T110 the narrator gets the night as it happened ───────────────────── */
{
  const st = at(110);
  const r = recordRecall(st, said(110), st.world.present, 5);
  check("there is a record", /THE RECORD: WHAT ACTUALLY HAPPENED/.test(r), r.slice(0, 200));
  check("...with her 'coming home' texts", /Rabi turned off the television[^\n]*on her way home/.test(r));
  check("...the empty bed at midnight", /May's side of the bed still empty/.test(r));
  check("...and her own account: the wellness room", /wellness room/.test(r));
  check("...and who covered whom", /May quietly turned off the stove, covered Rabi with a blanket/.test(r));
  check("it forbids contradicting where anyone slept", /where anyone was or slept/.test(r));
  check("...but leaves how she feels about it open", /How they feel about it now is open/.test(r));
  check("turns already in the prose are left out",
    [105, 106, 107, 108, 109].every((t) => !r.includes(FIX.history.find((h) => h.turn === t)!.summary)));

  const m86 = st.memory[MAY].episodic.find((m) => m.turn === 86)!;
  check("her memory of telling him is rehearsed back to full", m86.decay_stage === 0 && /kept me late, offered him my phone/.test(m86.content), m86);
  check("...and its decay clock restarts now", m86.last_accessed_turn === 110, m86.last_accessed_turn);
}

/* ── 3. nothing when the player isn't disputing anything ─────────────────────── */
{
  const st = at(107);
  check("no record for an ordinary line", recordRecall(st, said(107), st.world.present, 5) === "");
  const m86 = st.memory[MAY].episodic.find((m) => m.turn === 86)!;
  check("...and no memory is touched", m86.decay_stage === 3, m86.decay_stage);
}

/* ── 4. nothing when nobody is here to remember it ───────────────────────────── */
{
  const st = at(110);
  check("alone, there is no one to hold to it", recordRecall(st, said(110), ["char_player"], 5) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
