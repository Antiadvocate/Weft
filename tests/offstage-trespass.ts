/* NOBODY LETS THEMSELVES INTO SOMEBODY ELSE'S HOUSE, AND NOBODY OFFSTAGE ASKS WHERE THE PLAYER WAS.
 *
 * "Worse it randomly made this up: 'Where was Rabi before four in the morning? ... May says Rabi
 *  left the house before four and didn't say where he was going ...'"
 *
 * Rainier Valley, per-person offstage pass. Rabi walked out at about 19:30 and slept at a motel.
 *   T120, 19:27  May "read the whole Sonia email aloud to Ellie Navarro" at the dining table, told:
 *                Ellie, while May was mid-fight in the hallway and Ellie had never been to the house.
 *   T124, 05:12  "Ellie let herself in with the checklist folder as her excuse for the early hour
 *                and found only May downstairs making coffee ... May said he'd left before four",
 *                which opened the thread. Ellie's location was "elsewhere".
 */
import { applyOffstage, trespasses } from "../src/engine/offstage";
import { actToEvent } from "../src/engine/agency";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const HOUSE = "loc_house";
const world = (): SaveState => ({
  characters: {
    char_player: { name: "Rabi", location: "loc_offscene" },
    char_may: { name: "May", pronouns: "she/her", location: HOUSE },
    char_ellie: { name: "Ellie Navarro", pronouns: "she/her", location: "loc_offscene" },
    char_sonia: { name: "Sonia Vale", pronouns: "she/her", location: "loc_office" },
  },
  world: {
    current_turn: 124, current_time: "Day 4, 05:12 (Dawn)", present: [], threads: [], offstage_log: [],
    places: {
      [HOUSE]: { id: HOUSE, name: "Rabi and May's House", identity: "Rabi and May's shared home in Rainier Valley's 98118 ZIP code." },
      loc_office: { id: "loc_office", name: "Alder Span Engineering", identity: "An engineering firm." },
      loc_offscene: { id: "loc_offscene", name: "elsewhere" },
    },
  },
  memory: {}, condition: {}, history: [],
} as unknown as SaveState);

const ELLIE_AT_DAWN = {
  actor: "Ellie Navarro", place: "Rabi and May's House",
  what: "Ellie let herself in with the checklist folder as her excuse for the early hour and found only May downstairs making coffee; she asked, lightly, whether Rabi had slept badly after that call the other night, and May said he'd left before four and hadn't said where, then stood holding the kettle without pouring it.",
  witnesses: [],
  opens_thread: { title: "Where was Rabi before four in the morning?", description: "May says Rabi left the house before four and didn't say where he was going, which means Ellie's checklist still has nobody to go to and Rabi's nights are unaccounted for." },
};

/* ── 1. the save's own event ─────────────────────────────────────────────────── */
{
  const st = world();
  check("Ellie inside Rabi and May's house is a trespass", trespasses(st, ELLIE_AT_DAWN) === "Ellie Navarro");
  const log = applyOffstage(st, [ELLIE_AT_DAWN]);
  check("...so the event is dropped", (st.world.offstage_log ?? []).length === 0, st.world.offstage_log);
  check("...and the player is told why", log.some((l) => /dropped an event that had Ellie Navarro inside Rabi and May's House/.test(l)), log);
  check("...no thread about where Rabi was", st.world.threads.length === 0, st.world.threads);
  check("...and May doesn't 'remember' it", !JSON.stringify(st.memory ?? {}).includes("let herself in"));
}

/* ── 2. the people who live there, and people already there, are fine ─────── */
{
  const st = world();
  check("May at her own house is not a trespass", trespasses(st, { actor: "May", place: "Rabi and May's House", what: "May called Rabi's phone four times." } as any) === null);
  st.characters.char_sonia.location = HOUSE;
  check("a guest already standing in the house is not one either", trespasses(st, { actor: "Sonia Vale", place: "Rabi and May's House", what: "Sonia sat at the table." } as any) === null);
  check("an office is nobody's home", trespasses(world(), { actor: "Ellie Navarro", place: "Alder Span Engineering", what: "Ellie dropped off a folder." } as any) === null);
}

/* ── 3. a question about the player never opens, even from a legitimate event ── */
{
  const st = world();
  const log = applyOffstage(st, [{ actor: "May", place: "Rabi and May's House", what: "May called Rabi's phone four times and got voicemail.", witnesses: [],
    opens_thread: { title: "Where did Rabi sleep?", description: "Rabi has not come home and May does not know where he is." } } as any]);
  check("the event itself still happens", (st.world.offstage_log ?? []).length === 1);
  check("...but the question about Rabi is declined", st.world.threads.length === 0 && log.some((l) => /declined a question about Rabi/.test(l)), { threads: st.world.threads, log });
  const st2 = world();
  applyOffstage(st2, [{ actor: "Sonia Vale", place: "Alder Span Engineering", what: "Sonia left the plan administrator's email unanswered.", witnesses: [],
    opens_thread: { title: "Whether Sonia answers the email", description: "The letter can't go out until she does." } } as any]);
  check("a question about the world still opens", st2.world.threads.length === 1, st2.world.threads);
}

/* ── 4. telling somebody who isn't there ─────────────────────────────────────── */
{
  const st = world();
  const ev = actToEvent(st, "char_may", { what: "May sat down at the dining table with her laptop and read the whole Sonia email aloud to Ellie Navarro.", place: "Rabi and May's House", told: "Ellie Navarro", telling: "the email" });
  check("May can't tell Ellie anything at the dining table when Ellie isn't there", ev === null, ev);
  st.characters.char_ellie.location = HOUSE;
  const ok = actToEvent(st, "char_may", { what: "May read the email aloud to Ellie Navarro.", place: "Rabi and May's House", told: "Ellie Navarro", telling: "the email" });
  check("...and can when she is", !!ok && ok.witnesses.includes("Ellie Navarro"), ok);
  const texted = actToEvent(world(), "char_may", { what: "May texted Ellie Navarro the Sonia email and asked which paragraph sounded wrong.", place: "Rabi and May's House", told: "Ellie Navarro", telling: "the email" });
  check("...but she can text it to her", !!texted && texted.witnesses.includes("Ellie Navarro"), texted);
  const alone = actToEvent(world(), "char_may", { what: "May called Rabi's phone four times.", place: "Rabi and May's House" });
  check("an act with nobody told is untouched", !!alone, alone);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
