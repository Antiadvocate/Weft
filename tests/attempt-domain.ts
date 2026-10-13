/* Smoke test: A COMPETENCE IS A DOMAIN, NOT A WORD.
 *
 * The City of Glass and Ash, turn 3. Rabi's card, written by the Forge:
 *
 *     Firearms — Competent; he has trained obsessively for months, but has never killed anyone.
 *     Can field-strip and reassemble a pistol in the dark, by feel alone.
 *
 * He types: "everyone dies tonight except for one. You first" I shoot her. 'Alright Zoe. Let's
 * murder'. The attempt frame read his capability as cosine over that card, and cosine is lexical:
 *
 *     0.0000  Firearms Competent — he has trained obsessively for months…
 *     0.0000  Can field-strip and reassemble a pistol in the dark, by feel alone.
 *     0.0645  Answers Zoe's cheerful questions with one-word answers, but always answers.
 *
 * "Shoot" and "gun" share no token with "firearms" and "pistol". The only thing on the whole card
 * that scored was a personality quirk, and it scored because he had said the name Zoe. It cleared
 * the naming floor by eleven thousandths, became "the capability", and carried the verdict:
 * INSUFFICIENT, margin −0.272. The narrator was handed law saying the attempt fails and wrote
 * "The first shot goes wide." A declared massacre produced four turns of a woman counting the room,
 * and the player walked out of the club and went to have his AI surgically removed.
 *
 * The file already had the right idea one function above: IMPAIRMENT matches an injury to an
 * activity CLASS, "regardless of how the attempt is phrased". Capability needed the same bridge.
 *
 * What the action IS (its stakes, whether it's physical, its domain, what it calls on, whom it's
 * aimed at) now comes from the turn's read (engine/actionread.ts), so each turn below is handed the
 * read a careful reader gives it, and the test checks what the frame does with that.
 */
import { frameAttempt, isAttempt } from "../src/engine/attempt";
import { EMPTY_READ, setRead, type ActionRead } from "../src/engine/actionread";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const SHOT = `"I don't care" I take out my gun "everyone dies tonight except for one. You first" I shoot her. 'Alright Zoe. Let's murder'`;
/** A shot at Linh: dangerous, physical, a firearm, hands and eyes. */
const SHOT_READ: ActionRead["attempt"] = { stakes: "dangerous", physical: true, domains: ["firearms"], uses: ["hands", "eyes"], target: "char_l" };

/** Play `action` as this turn with the read a careful reader gives it, and frame it. */
function frame(s: SaveState, action: string, attempt: ActionRead["attempt"], pressure: number, more: Partial<ActionRead> = {}) {
  setRead(s, action, { attempt, ...more });
  return frameAttempt(s, action, pressure);
}

function city(): SaveState {
  const s = newSave("attempt", { name: "The City of Glass and Ash", era: "2026, late autumn" } as any);
  registerCharacter(s, {
    name: "Rabi", character_id: "char_player",
    background: "Rabi was a structural engineer before his son was killed. He worked on bridges and high-rises.",
    core_traits: [
      "Checks every exit in a room before he sits down, every time, without thinking.",
      "Can field-strip and reassemble a pistol in the dark, by feel alone.",
      "Answers Zoe's cheerful questions with one-word answers, but always answers.",
    ],
    skills: {
      "Structural engineering": "Expert — he can read a building's bones.",
      "Firearms": "Competent — he has trained obsessively for months, but has never killed anyone.",
    },
  } as any);
  registerCharacter(s, { name: "Linh Tran", character_id: "char_l", pronouns: "she/her" } as any);
  s.world.places.loc_club = { id: "loc_club", name: "The Velvet Room", identity: "A converted warehouse nightclub.", description_facts: "", contains: [] } as any;
  s.world.places.loc_street = { id: "loc_street", name: "The Overpass", identity: "Six lanes of wet concrete above the river.", description_facts: "", contains: [] } as any;
  s.world.player_location = "loc_club";
  s.world.present = ["char_l"];
  s.world.weather = "Cold rain, the kind that soaks through clothes.";
  s.condition["char_player"].psyche.relaxation = 0;
  return s;
}

/* ── 1. the turn that caused this ────────────────────────────────────────────── */
{
  const s = city();
  check("it is an attempt", isAttempt({ ...EMPTY_READ, attempt: SHOT_READ }));
  const f = frame(s, SHOT, SHOT_READ, 4)!;
  check("the frame is built", !!f);
  check("the capability is his FIREARMS, not a quirk about answering questions",
    /Firearms/.test(f.capability.fact ?? ""), f.capability.fact);
  check("the quirk is nowhere near the verdict", !/cheerful questions/.test(f.weakest), f.weakest);
  check("a trained shooter is not read as incapable", f.capability.score >= 0.9, f.capability.score);
  check("the shot no longer fails", f.outcome !== "insufficient", `${f.outcome} @ ${f.margin}`);
}

/* ── 2. the bridge, both directions, on the vocabularies a card actually uses ── */
{
  const s = city();
  const cap = (action: string, attempt: ActionRead["attempt"]) => frame(s, action, attempt, 3)?.capability;
  check("a pistol on the card answers a gun in the action", /pistol|Firearms/.test(cap("I pull the gun and fire twice at the man by the door",
    { stakes: "dangerous", physical: true, domains: ["firearms"], uses: ["hands", "eyes"], target: "the man by the door" })?.fact ?? ""));
  // a domain the card says nothing about stays empty rather than matching something at random
  const climb = cap("I climb the drainpipe to the second floor window",
    { stakes: "risky", physical: true, domains: ["climbing"], uses: ["hands", "legs"], target: "the second floor window" });
  check("a domain he has no card for names nothing", climb?.fact === null, climb?.fact);
  check("...and scores low", (climb?.score ?? 1) < 0.4, climb?.score);
}

/* ── 3. the card's own grading is read ───────────────────────────────────────── */
{
  const s = city();
  s.characters["char_player"].skills = { "Firearms": "Beginner — he has held a gun twice and never fired one." } as any;
  s.characters["char_player"].core_traits = ["Checks every exit in a room before he sits down."];
  const weak = frame(s, SHOT, SHOT_READ, 4)!;
  check("a beginner reads as a beginner", weak.capability.score < 0.5, weak.capability.score);
  // A beginner at arm's length still hits somebody sometimes — "contested" is an honest verdict
  // there. What must not happen is a beginner and an expert resolving the same.
  check("...and it never simply works for him", weak.outcome !== "sufficient", weak.outcome);

  s.characters["char_player"].skills = { "Firearms": "Expert — twenty years on the range and two tours." } as any;
  const strong = frame(s, SHOT, SHOT_READ, 4)!;
  check("an expert reads as an expert", strong.capability.score > 0.9, strong.capability.score);
  check("...and the same shot lands", strong.outcome === "sufficient", `${strong.outcome} @ ${strong.margin}`);
  check("the grade is what separates them", strong.margin > weak.margin + 0.2, `${weak.margin} vs ${strong.margin}`);
}

/* ── 4. WEATHER REACHES WHOEVER IS STANDING IN IT ────────────────────────────── */
{
  const inside = frame(city(), SHOT, SHOT_READ, 4)!;
  check("cold rain outside does not grade a shot fired in a nightclub",
    !inside.circumstance.causes.some((c) => /rain/i.test(c)), inside.circumstance.causes);

  const out = city();
  out.world.player_location = "loc_street";
  const outside = frame(out, SHOT, SHOT_READ, 4)!;
  check("...and still counts on an overpass in the rain",
    outside.circumstance.causes.some((c) => /rain/i.test(c)), outside.circumstance.causes);
  check("the two differ by the weather alone", outside.circumstance.score < inside.circumstance.score);
}

/* ── 5. THE READ DECIDES WHAT THE ACTION IS ────────────────────────────────────── */
{
  // Nothing tried, nothing framed: a turn the reader finds no stakes in never frames, whatever verbs
  // it happens to contain.
  const s = city();
  setRead(s, "I tell Linh about the time I tried to climb the water tower", {});
  check("an empty read frames nothing", frameAttempt(s, "I tell Linh about the time I tried to climb the water tower", 3) === null);

  // An injury reaches the attempts that use what it hurts, and only those.
  const hurt = city();
  hurt.condition["char_player"].injuries = [{ type: "gashed palm", cause: "broken glass", functional_impact: "can't close the right hand", severity: 2 } as any];
  const shot = frame(hurt, SHOT, SHOT_READ, 4)!;
  check("a gashed palm shows in a shot that uses the hands", shot.body.causes.some((c) => /gashed palm/.test(c)), shot.body.causes);
  const talk = frame(hurt, "I talk Linh into putting the knife down", { stakes: "risky", physical: false, domains: ["persuasion"], uses: ["head"], target: "char_l" }, 4)!;
  check("...and not in talking someone down", !talk.body.causes.some((c) => /gashed palm/.test(c)), talk.body.causes);

  // A social attempt reads the warmth of the person it's aimed at, by the id the read gives.
  const cold = city();
  cold.world.edges.push({ from: "char_l", to: "char_player", warmth: -80, trust: -60 } as any);
  const plea = frame(cold, "I talk her into putting the knife down", { stakes: "risky", physical: false, domains: ["persuasion"], uses: [], target: "char_l" }, 4)!;
  check("a social attempt reads its target's edge", plea.circumstance.causes.some((c) => /Linh Tran is set against them/.test(c)), plea.circumstance.causes);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
