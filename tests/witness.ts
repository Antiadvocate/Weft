/* Smoke test: FOUR PEOPLE WATCHED IT NOT HAPPEN.
 *
 * "Nothing pulls you out of existence vs a coherency sequential logical time sequence that can be
 *  agreed upon by multiple characters. They should've corrected her on top of it saying 'we didn't
 *  see you field wrap him for shit outside?'"
 *
 * Every character holds a PRIVATE memory store, written per-character by a pass that reads prose and
 * infers. Nothing was ever held in common. So when one of them asserted a wrap that happened in the
 * field, the people standing there had no basis to contradict her — the engine had never given them
 * a shared record to check it against.
 *
 * What followed on that save is the whole argument for this file. Turns 39 through 43, consecutively:
 * the player interrogating the crew about contradictions, while the engine invented a new character —
 * a sister on reactor watch who "also handles comms" — to explain away a radio voice that was itself
 * a bug from a building split into three locations. Confabulation defending confabulation, because
 * nothing could break against a fact.
 *
 * The material existed the whole time: every history entry carries the turn, the in-world time, a
 * factual summary and the list of who was present. */
import { witnessRecord, WITNESS_TURNS } from "../src/engine/witness";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const save = (history: unknown[]): SaveState => ({
  world: { current_turn: 44, present: ["char_liz", "char_marcus"] },
  characters: {
    char_player: { name: "Rabi Okafor" },
    char_liz: { name: "Liz Okafor" },
    char_marcus: { name: "Marcus Hale" },
    char_cap: { name: "Yewande Iwu" },
  },
  history,
} as unknown as SaveState);

const H = (turn: number, summary: string, present: string[], time = "Day 1, 11:25 (Morning)") =>
  ({ turn, summary, present, time_label: time, player_action: "", narrator_prose: "" });

/* ── the record itself ───────────────────────────────────────────────────────── */
{
  const s = save([
    H(41, "Liz wrapped Rabi's ankle in the bunkroom; nobody went outside.", ["char_liz", "char_marcus"]),
    H(42, "Rabi called off the raid.", ["char_liz", "char_marcus"]),
  ]);
  const t = witnessRecord(s, ["char_liz", "char_marcus"]);
  check("the shared events are listed", /wrapped Rabi's ankle/.test(t), t.slice(0, 200));
  check("with when they happened", /Day 1, 11:25/.test(t));
  check("and who was standing there", /present: you, Liz, Marcus/.test(t), t);
  check("it is stated as not negotiable", /not negotiable/.test(t));
}
{
  const s = save([H(41, "Liz wrapped his ankle indoors.", ["char_liz", "char_marcus"])]);
  const t = witnessRecord(s, ["char_liz", "char_marcus"]);
  check("a witness is told what being a witness is for", /THE OTHERS SAY SO/.test(t));
  check("and that they interrupt rather than sit through it", /interrupt|correct/.test(t));
  check("lying on purpose is still allowed — this is not a truth serum", /lie about it on purpose/.test(t));
  check("disagreeing about MEANING is still allowed", /argue about what it meant/.test(t));
  check("only confusion about whether/when/where is closed", /WHETHER it happened, WHEN, or WHERE/.test(t));
}
{
  // the exact failure that followed the last one: inventing a person to reconcile a contradiction
  const s = save([H(41, "A voice came over the radio.", ["char_liz"])]);
  const t = witnessRecord(s, ["char_liz"]);
  check("inventing a relative to explain a contradiction is forbidden", /do not invent a new person, a relative/.test(t));
  check("and the contradiction is named as the scene itself", /That is the scene/.test(t));
}

/* ── who it covers ───────────────────────────────────────────────────────────── */
{
  const s = save([
    H(30, "Something only the captain saw, aboard the ship.", ["char_cap"]),
    H(41, "Something the whole bunker saw.", ["char_liz", "char_marcus"]),
  ]);
  const t = witnessRecord(s, ["char_liz", "char_marcus"]);
  check("an event none of the present cast witnessed is not in their shared record",
    !/only the captain saw/.test(t), t);
  check("but one they all saw is", /whole bunker saw/.test(t));
}
{
  const s = save([H(41, "Marcus alone was there.", ["char_marcus"])]);
  const t = witnessRecord(s, ["char_liz", "char_marcus"]);
  check("a turn only one of them attended still counts, for that one", /present: you, Marcus/.test(t), t);
}
{
  check("an empty room produces no record", witnessRecord(save([H(41, "x", ["char_liz"])]), []) === "");
  check("nor does a player standing alone", witnessRecord(save([H(41, "x", ["char_liz"])]), ["char_player"]) === "");
  check("nor a history with no summaries yet", witnessRecord(save([H(41, "", ["char_liz"])]), ["char_liz"]) === "");
}
{
  // it must not grow without bound — this rides in every turn's directive
  const many = Array.from({ length: 40 }, (_, i) => H(i, `Event ${i}.`, ["char_liz"]));
  const t = witnessRecord(save(many), ["char_liz"]);
  const lines = (t.match(/^- /gm) ?? []).length;
  check("the record is bounded to recent turns", lines <= WITNESS_TURNS, lines);
  check("and it is the RECENT ones it keeps", /Event 39/.test(t) && !/Event 5\./.test(t), lines);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
