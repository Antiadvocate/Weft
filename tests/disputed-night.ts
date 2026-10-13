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
 *
 * Whether a line reaches into the past is the turn's read (engine/actionread.ts, `disputes_past`).
 * Each turn below is handed the read a careful reader gives it, and the record does the rest.
 */
import { readFileSync } from "node:fs";
import { disputesPast, recordRecall } from "../src/engine/record";
import { EMPTY_READ, setRead } from "../src/engine/actionread";
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
/** What a careful reader says: every line of the fight from T110 reaches into the past, and so does
 *  T108's "they can't keep you overnight", where her version started to drift. Ordering dinner and
 *  sitting down next to her don't. */
const DISPUTES: Record<number, boolean> = { 105: false, 107: false, 108: true, 110: true, 111: true, 112: true, 113: true, 114: true };
/** The state at `turn`, with that turn's line read as a careful reader reads it. */
const playing = (turn: number): SaveState => {
  const st = at(turn);
  setRead(st, said(turn), { disputes_past: DISPUTES[turn] ?? false });
  return st;
};

/* ── 1. the read is what decides it ──────────────────────────────────────────── */
check("a read that disputes the past does", disputesPast({ ...EMPTY_READ, disputes_past: true }));
check("an empty read does not", !disputesPast(EMPTY_READ));

/* ── 2. at T110 the narrator gets the night as it happened ───────────────────── */
{
  const st = playing(110);
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
  const st = playing(107);
  check("no record for an ordinary line", recordRecall(st, said(107), st.world.present, 5) === "");
  const m86 = st.memory[MAY].episodic.find((m) => m.turn === 86)!;
  check("...and no memory is touched", m86.decay_stage === 3, m86.decay_stage);
}

/* ── 4. nothing when nobody is here to remember it ───────────────────────────── */
{
  const st = playing(110);
  check("alone, there is no one to hold to it", recordRecall(st, said(110), ["char_player"], 5) === "");
}

/* ── 5. every line of the fight brings the record, and the evening before it doesn't ── */
for (const t of [110, 111, 112, 113, 114]) {
  const st = playing(t);
  check(`T${t} brings the record`, /THE RECORD: WHAT ACTUALLY HAPPENED/.test(recordRecall(st, said(t), st.world.present, 5)), said(t).slice(0, 80));
}
for (const t of [105, 107]) {
  const st = playing(t);
  check(`T${t} doesn't`, recordRecall(st, said(t), st.world.present, 5) === "", said(t).slice(0, 80));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
