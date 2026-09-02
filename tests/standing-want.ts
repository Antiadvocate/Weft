/* THE WANT THAT COULD NEVER BE SATISFIED, ORDERED IN THE OPENING LINES OF NINE TURNS RUNNING.
 *
 * "The game engine has gone full retard."
 *
 * Turn 15 of the Seattle save. The player had authored, by hand, one standing want:
 *
 *     "Only allows Rabi to eat combinations of her shit, cum, piss and vomit, she doesn't allow
 *      Rabi to eat anything else."
 *
 * It crystallized at turn 5. Its record at turn 14: `acted: 0, missed: 8`. Ordered on every turn
 * since turn 1, credited on none of them, ever — so missDirective escalated, every turn, to:
 *
 *     THIS WAS ORDERED LAST TURN AND THE TURN CAME BACK WITHOUT IT ... ordered for the last 8 turns
 *     and absent from all of them ... WRITE IT FIRST THIS TURN: the act itself, in plain words, in
 *     the opening lines of the prose, before the conversation ... There is no third: if it is not in
 *     the opening lines, nothing else in the turn counts.
 *
 * There is no act that IS that want — it is a rule about what may happen. And it was being broken:
 * Rabi was eating eggs he had cooked himself. So the only move the mandate left the narrator was to
 * interfere with his eating, first, every turn. It did, for nine turns straight. She stops the
 * blowjob to make him eat; he tries to eat; she stops him; she orders him to finish; he tries; she
 * stops him. Turn 13, the player: "What do you mean you want me to finish... my toast? That I keep
 * trying to eat? That you keep stopping me then telling me to finish the toast again?" Turn 14, the
 * player has 911 open on his phone asking whether his wife is having a stroke.
 *
 * The engine already knows this failure mode. It is written into the forge's own drive guidance, in
 * almost these words — "WANTS ARE THINGS THEY DO, NOT THINGS THEY ASK FOR ... the meter never
 * moves" — and it was written for `drive_goal` and never applied to `authored`, which is precisely
 * where a player types a standing rule, because a standing rule is the natural way to write down
 * how somebody is.
 */
import { isStanding, missDirective, habitDirective, noteWantMisses, staleWants, MISS_CEILING } from "../src/engine/authored";
import { findLineReprint, lineReprintFix } from "../src/engine/echo";
import { lastWord } from "../src/engine/turn";
import type { SaveState, AuthoredDrive, Identity } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIX = JSON.parse(readFileSync("tests/fixtures/standing-want.json", "utf8")) as {
  authored: AuthoredDrive[]; core_traits: string[]; prose: Record<string, string>;
};
const EM = "char_e";
const save = (authored: AuthoredDrive[]): SaveState => ({
  characters: {
    char_player: { name: "Rabi" },
    [EM]: { name: "Emily", pronouns: "she/her", core_traits: FIX.core_traits, values: [], authored } as unknown as Identity,
  },
  world: { current_turn: 14, present: ["char_player", EM] },
  habits: {}, condition: {}, history: [],
} as unknown as SaveState);
const PRESENT = ["char_player", EM];

/* ── 1. the save's own want, read for what it is ─────────────────────────────── */
{
  const a = FIX.authored[0];
  check("the want is recognised as a standing condition", isStanding(a), a.goal);
  check("...and the save really had it at acted 0", (a.acted ?? 0) === 0, a);
  check("...ordered and absent eight turns running", (a.missed ?? 0) === 8, a);

  const st = save(FIX.authored);
  check("it is no longer ordered as an act", missDirective(st, PRESENT) === "", missDirective(st, PRESENT));

  const h = habitDirective(st, PRESENT, false);
  check("it reaches the narrator as a binding condition instead",
    /WHAT IS ALREADY TRUE OF THESE PEOPLE/.test(h), h.slice(0, 200));
  check("...told outright not to open the turn with it", /Do NOT open the turn with it/.test(h));
  check("...nor to manufacture an occasion for it", /do not manufacture an occasion to demonstrate it/.test(h));
  check("...and that a turn which never touches it owes nothing", /nothing is missing/.test(h));
  check("...while still binding what may happen", /bind what can happen/.test(h));
  check("...and never overriding the player", /never overrides what the player declares/.test(h));

  // The two blocks must not be nested: the act header says "make the room", which is the exact
  // instruction the standing row exists to refuse.
  const actHeader = h.indexOf("NOT OPTIONAL, NOT BACKGROUND");
  const standHeader = h.indexOf("WHAT IS ALREADY TRUE");
  check("the standing block is not under the make-the-room header",
    standHeader >= 0 && (actHeader < 0 || h.slice(actHeader, standHeader).includes("]")), { actHeader, standHeader });
}

/* ── 2. a standing want can never be missed ──────────────────────────────────── */
{
  const st = save([{ ...FIX.authored[0], missed: 8 }]);
  const shifts = noteWantMisses(st, 15, PRESENT, true);
  check("the miss counter is cleared rather than climbing", (st.characters[EM].authored![0].missed ?? -1) === 0);
  check("...and nothing is reported to the player about a skip", shifts.length === 0, shifts);
}

/* ── 3. an ACT want still works exactly as before ────────────────────────────── */
{
  const act: AuthoredDrive = { goal: "Kisses Rabi's scar whenever she passes him.", rate: "steady", stage: 5, crystallize: true, crystallized_turn: 5, added_turn: 1, missed: 2 } as AuthoredDrive;
  check("an act-want is not read as standing", !isStanding(act), act.goal);
  const st = save([act]);
  const d = missDirective(st, PRESENT);
  check("it is still ordered when skipped", /THIS WAS ORDERED LAST TURN/.test(d), d);
  check("...still first in the prose", /WRITE IT FIRST THIS TURN/.test(d));
  check("...and still escalates at two", /There is no third/.test(d));
  check("it appears in the act block, not the standing one",
    /SIMPLY DOES THIS NOW/.test(habitDirective(st, PRESENT, false)));
}

/* ── 4. and the engine stops shouting at an act-want that will never land ─────── */
{
  const stuck: AuthoredDrive = { goal: "Kisses Rabi's scar whenever she passes him.", rate: "steady", stage: 5, crystallize: true, crystallized_turn: 5, added_turn: 1, missed: MISS_CEILING + 1 } as AuthoredDrive;
  const st = save([stuck]);
  check(`past ${MISS_CEILING} misses the order stands down`, missDirective(st, PRESENT) === "", missDirective(st, PRESENT));
  const said = staleWants(st, PRESENT);
  check("...and the player is told, since only they can fix it", said.length === 1, said);
  check("...naming the want and what unsticks it",
    /has never reached the page/.test(said[0] ?? "") && /rewriting it as something Emily DOES/.test(said[0] ?? ""), said);
  check("...exactly once, not on every turn after",
    staleWants(save([{ ...stuck, missed: MISS_CEILING + 4 }]), PRESENT).length === 0);
  check("a standing want never reaches that report at all",
    staleWants(save([{ ...FIX.authored[0], missed: MISS_CEILING + 1 }]), PRESENT).length === 0);
  check("...and one still under the ceiling is ordered normally",
    /THIS WAS ORDERED LAST TURN/.test(missDirective(save([{ ...stuck, missed: 2 }]), PRESENT)));
}

/* ── 5. "Blanche, you're being dramatic," — turn 0 and again at turn 9 ────────── */
{
  const upto = (n: number) => Object.keys(FIX.prose).map(Number).sort((a, b) => a - b).filter((t) => t < n).map((t) => FIX.prose[String(t)]);
  const hit = findLineReprint(upto(9), FIX.prose["9"]);
  check("the nine-turn-old line is caught", /Blanche, you're being dramatic/.test(hit ?? ""), hit);
  check("...and quoted back", /ALREADY PRINTED, WORD FOR WORD/.test(lineReprintFix(hit)), lineReprintFix(hit).slice(0, 90));
  check("...with somewhere else to go", /they say it worse|the part they left out/.test(lineReprintFix(hit)));

  let hits = 0;
  const turns = Object.keys(FIX.prose).map(Number).sort((a, b) => a - b);
  for (const t of turns.slice(1)) if (findLineReprint(upto(t), FIX.prose[String(t)])) hits++;
  check("and it fires once across the whole save, not on every turn", hits === 1, hits);
}

/* ── 6. lastWord was quoting NARRATION back as dialogue ──────────────────────── */
{
  // The old pattern needed 8-160 characters between the quote marks, so a short line failed to
  // match, its opening quote was skipped, and every pair after it in the paragraph was off by one.
  const prose = FIX.prose["14"];
  const st = { history: Object.keys(FIX.prose).map(Number).sort((a, b) => a - b).map((t) => ({ narrator_prose: FIX.prose[String(t)] })) } as unknown as SaveState;
  const out = lastWord(st);
  check("nothing in the already-said list is a paragraph of narration",
    !/Her fingers find the crescent moon tattoo/.test(out), out.slice(0, 300));
  check("...and the real closing line is in it", /Please don't call anyone/.test(out), out.slice(0, 300));
  check("every listed entry begins and ends as a quotation",
    (out.match(/"[^"]*"/g) ?? []).length > 0 && !/" \w+ says\. "/.test(out), out.slice(0, 400));
  void prose;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
