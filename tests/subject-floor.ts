/* Smoke test: PEOPLE HAVE LIVES, AND LIVES COME UP IN CONVERSATION.
 *
 * "My NPCs only talk about things they are goal-driven by directly, rather than indirectly or
 *  beating around the bush or even talking about... like sports. No one just asks you if you've
 *  seen any shows, or what you're up to, or how's life."
 *
 * Every field this needs was already on the cards and already printed: `texture:` (raises these
 * unprompted), `can talk at length about:`, `has heard:`, `backup wants:`. The narrator law already
 * says A CHARACTER IS NOT THEIR GOAL in those words. None of it held, for the reason every other
 * rule in this engine failed before it was measured: nothing ever read the prose back and asked
 * whether anybody said anything that was not their errand. `texture` had no expression tracking of
 * any kind — unlike core traits, which habits.ts counts, ages and retires.
 *
 * So this is the detector. Three consecutive-turn counters per present character, and a correction
 * that names the specific person and the specific unused material off their own card.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import {
  trackSubjects, subjectDirective, otherLivesNote, linesBy, ownSubjects,
  ALL_BUSINESS_LIMIT, INCURIOUS_LIMIT, ROOMBOUND_LIMIT,
} from "../src/engine/subjects";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** An inn, a woman with a life, and a man who is somewhere else. */
function fixture(): { s: SaveState; m: string; away: string } {
  const s = newSave("t", { name: "V" } as any);
  s.world.places["loc_inn"] = { id: "loc_inn", name: "The inn", description_facts: "Smoke.", contains: [] } as any;
  s.world.player_location = "loc_inn";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  const m = registerCharacter(s, {
    name: "Lucia", age: 52,
    background: "Runs the inn since her husband died.",
    core_traits: ["Counts everything twice"],
    texture: ["watches for a particular heron on the weir", "argues about the road to Bovillae"],
    skills: { brewing: "expert" },
  } as any);
  const away = registerCharacter(s, {
    name: "Gnaeus", age: 40, background: "Keeps the mill.",
    texture: ["will not stop talking about his nephew"],
  } as any);
  s.characters[m].location = "loc_inn";
  s.characters[m].drive = { goal: "collect the debt the decurio owes for the winter grain", priority: 3, progress: 0, updated_turn: 1 } as any;
  s.world.present = ["char_player", m];
  s.world.edges.push({ from: m, to: away, warmth: 10, trust: 5, notes: "" } as any);
  return { s, m, away };
}

/* ── 0. attribution, which everything else rests on ─────────────────────────── */
{
  const prose = `Lucia set the cup down. "The grain money was due at the solstice," she said.\nRabi shrugged. "It always is."`;
  const lines = linesBy(prose, "Lucia");
  check("a line beside her name is hers", lines.some((l) => /grain money/.test(l)), lines);
  check("...and a line beside somebody else's is not", !lines.some((l) => /It always is/.test(l)), lines);
  check("a name that is not in the prose gets nothing", linesBy(prose, "Gnaeus").length === 0);
}

/* ── 1. what she has to talk about besides the debt ──────────────────────────── */
{
  const { s, m } = fixture();
  const subs = ownSubjects(s, m);
  check("her standing interests are subjects", subs.some((x) => /heron/.test(x)));
  check("so is what she can go on about", subs.includes("brewing"));
}

/* ── 2. ALL BUSINESS, TURN AFTER TURN — the failure itself ───────────────────── */
{
  const { s, m } = fixture();
  // every line she says is the debt, which is what the player reported
  const onErrand = `Lucia wiped the counter. "The grain money was due at the solstice," she said. "The decurio owes for the winter grain and I want it collected."`;
  for (let i = 0; i < ALL_BUSINESS_LIMIT; i++) { s.world.current_turn = i + 1; trackSubjects(s, onErrand); }
  check("saying nothing but the errand is counted", (s.subjects?.[m]?.off_errand ?? 0) >= ALL_BUSINESS_LIMIT, s.subjects);

  const d = subjectDirective(s);
  check("the correction fires", d.length > 0, d);
  check("...naming who", /Lucia/.test(d));
  check("...and how long", new RegExp(`${ALL_BUSINESS_LIMIT} turns running`).test(d), d);
  check("...and handing back the material off her own card", /heron/.test(d), d);
  check("...as something to do this turn rather than a complaint", /THIS TURN Lucia SAYS SOMETHING THAT IS NOT ABOUT THEIR ERRAND/.test(d), d);
  check("...and says it is allowed to go nowhere", /does not advance anything and it is not supposed to/.test(d));
}

/* ── 3. ONE LINE ABOUT THE HERON CLEARS IT ───────────────────────────────────── */
{
  const { s, m } = fixture();
  const onErrand = `Lucia wiped the counter. "The decurio owes for the winter grain and I want it collected."`;
  for (let i = 0; i < ALL_BUSINESS_LIMIT; i++) { s.world.current_turn = i + 1; trackSubjects(s, onErrand); }
  check("primed", subjectDirective(s).includes("every line has been about what"));

  s.world.current_turn = 9;
  trackSubjects(s, `Lucia leaned on the sill. "The heron's back on the weir," she said. "Same one. He was here the winter Marcus died."`);
  check("touching her own life resets it outright", (s.subjects?.[m]?.off_errand ?? 0) === 0, s.subjects);
  check("...and the correction goes quiet", !/every line has been about/.test(subjectDirective(s)));
}

/* ── 4. NOBODY ASKS ANYBODY ANYTHING ─────────────────────────────────────────── */
{
  const { s, m } = fixture();
  const statements = `Lucia set down the cup. "The heron's back on the weir." She wiped the counter.`;
  for (let i = 0; i < INCURIOUS_LIMIT; i++) { s.world.current_turn = i + 1; trackSubjects(s, statements); }
  const d = subjectDirective(s);
  check("never asking anything is counted separately from having nothing to say",
    (s.subjects?.[m]?.incurious ?? 0) >= INCURIOUS_LIMIT && (s.subjects?.[m]?.off_errand ?? 0) === 0, s.subjects);
  check("the curiosity correction fires", /has not asked anybody a question of their own/.test(d), d);
  check("...and asks for the ordinary ones by name", /how they have been, what they have been doing/.test(d));
  check("...for real, not as a set-up", /The question is real/.test(d));

  s.world.current_turn = 20;
  trackSubjects(s, `Lucia set down the cup. "Have you eaten? You look like you walked from the coast."`);
  check("one real question clears it", (s.subjects?.[m]?.incurious ?? 0) === 0);
}
{
  // a question in service of the errand is not curiosity about anybody
  const { s, m } = fixture();
  const interrogation = `Lucia folded her arms. "When is the decurio paying the grain money he owes for the winter?"`;
  for (let i = 0; i < INCURIOUS_LIMIT; i++) { s.world.current_turn = i + 1; trackSubjects(s, interrogation); }
  check("an errand question does not count as asking after anybody",
    (s.subjects?.[m]?.incurious ?? 0) >= INCURIOUS_LIMIT, s.subjects);
}

/* ── 5. THE WORLD IS ONLY THIS ROOM ──────────────────────────────────────────── */
{
  const { s, m } = fixture();
  const roombound = `Lucia set down the cup. "Have you eaten? The heron's back on the weir."`;
  for (let i = 0; i < ROOMBOUND_LIMIT; i++) { s.world.current_turn = i + 1; trackSubjects(s, roombound); }
  const d = subjectDirective(s);
  check("never naming anybody outside the room is counted", (s.subjects?.[m]?.roombound ?? 0) >= ROOMBOUND_LIMIT);
  check("the correction names the people who exist elsewhere", /Gnaeus/.test(d), d);
  check("...and what to do with them", /BRINGS ONE OF THEM UP/.test(d));

  s.world.current_turn = 30;
  trackSubjects(s, `Lucia snorted. "Gnaeus is still telling everyone about that nephew of his."`);
  check("mentioning somebody who is not here clears it", (s.subjects?.[m]?.roombound ?? 0) === 0);
}

/* ── 6. IT STANDS DOWN WHEN SMALL TALK WOULD BE THE WRONG NOTE ───────────────── */
{
  const { s, m } = fixture();
  const onErrand = `Lucia wiped the counter. "The decurio owes for the winter grain and I want it collected."`;
  for (let i = 0; i < ALL_BUSINESS_LIMIT + 2; i++) { s.world.current_turn = i + 1; trackSubjects(s, onErrand); }
  check("primed", subjectDirective(s).length > 0);
  s.condition[m].psyche.relaxation = -8;
  check("a room under real pressure gets no instruction to chat", subjectDirective(s) === "", subjectDirective(s));
}
{
  // and silence is the speech floor's failure, not this one — counting it here would fire both
  const { s, m } = fixture();
  for (let i = 0; i < ALL_BUSINESS_LIMIT + 2; i++) { s.world.current_turn = i + 1; trackSubjects(s, "The room stayed quiet. Nobody said anything at all."); }
  check("a character who said nothing is left to the speech floor", (s.subjects?.[m]?.off_errand ?? 0) === 0, s.subjects);
  check("...so no subject correction fires for silence", subjectDirective(s) === "");
}
{
  // somebody with no recorded errand can never be accused of only talking about it
  const { s, m } = fixture();
  delete (s.characters[m] as any).drive;
  for (let i = 0; i < ALL_BUSINESS_LIMIT + 2; i++) { s.world.current_turn = i + 1; trackSubjects(s, `Lucia shrugged. "It was a cold enough winter and the roof is still the roof."`); }
  check("no errand, no errand failure", (s.subjects?.[m]?.off_errand ?? 0) === 0, s.subjects);
}

/* ── 7. counters belong to the scene ─────────────────────────────────────────── */
{
  const { s, m } = fixture();
  s.world.current_turn = 1;
  trackSubjects(s, `Lucia wiped the counter. "The decurio owes for the winter grain."`);
  check("she is tracked while she is in the room", !!s.subjects?.[m]);
  s.world.present = ["char_player"];
  trackSubjects(s, "The room was empty.");
  check("and stops being tracked when she leaves", !s.subjects?.[m], s.subjects);
}

/* ── 8. the standing material: lives besides the one in front of you ─────────── */
{
  const { s, away } = fixture();
  const note = otherLivesNote(s);
  check("somebody the room knows, who is not in it, is offered as a subject", /Gnaeus/.test(note), note);
  check("...with what is actually going on with them", /nephew/.test(note));
  check("...and it is offered, never ordered", /nobody has to use it/.test(note));

  // KNOWLEDGE GATE: a stranger's business is not available to be discussed
  s.world.edges = s.world.edges.filter((e) => e.to !== away && e.from !== away);
  check("a person nobody in the room knows is not offered", !/Gnaeus/.test(otherLivesNote(s)), otherLivesNote(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
