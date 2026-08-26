/* Smoke test: AN INSTRUCTION THAT POINTS AT A FIELD THAT ISN'T THERE.
 *
 * The companion failure to tests/state-reaches-narrator.ts. That one asks whether state reaches the
 * model. This one asks whether the INSTRUCTIONS I wrote refer to anything real — because a rule
 * saying "read the X line" is worse than no rule when nothing in the context is called X. The model
 * does not report the miss; it picks the nearest thing that looks like X and follows the rule
 * confidently against the wrong data.
 *
 * The one that mattered: the dialogue procedure's second question is
 *
 *     (2) WHAT THEY KNOW — only what this person has been told, has seen, or has worked out.
 *
 * There is no field called that. The fields that answer it are BELIEFS and RECALLS, and the
 * procedure named neither. What the context DID have, printed under every character, was a line
 * reading `knows (can hold forth on): brewing — very well` — which is the SKILLS field, meaning
 * subjects this person can talk about at length, nothing to do with what they are aware of. So the
 * single question in the five that decides whether a character speaks from their own picture of
 * events pointed straight at a list of their hobbies.
 *
 * Renamed the colliding label, pointed the question at the real fields, and put beliefs in the
 * speech block alongside the other four answers.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest, narratorSystem } from "../src/engine/prompts";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/** A character with every speech-relevant field populated. */
function fixture() {
  const s: any = newSave("t", { name: "Rabi" } as any);
  Object.assign(s.world_bible, { era: "Rome", technology_level: "Iron.", cultures_and_languages: "Latin." });
  s.world.places["l"] = { id: "l", name: "Yard", description_facts: "y", contains: [] };
  s.world.player_location = "l";
  registerCharacter(s, { name: "Rabi", character_id: "char_player", core_traits: ["Stubborn"] } as any);
  const m = registerCharacter(s, {
    name: "Lucia", age: 40, background: "Runs the inn.", core_traits: ["Counts twice"],
    skills: { brewing: "very well" }, texture: ["rocks"],
    voice: { idiolect: "a ledger-first refuser", idiolect_shows: "gives the number before the answer", diction: "priced", tics: ["counts it out where you can see"], never_says: ["feelings"] },
    current_goal: "collect the debt",
  } as any);
  s.characters[m].location = "l";
  s.world.present = ["char_player", m];
  s.characters[m].life_history = "The roof leaked.";
  s.memory[m].beliefs = [{ content: "The decurio will take the roof", confidence: 0.8, turn: 1 } as any];
  return { s, m };
}

/* ── 1. the five questions each have a field that answers them ───────────────── */
{
  const { s } = fixture();
  const dig = volatileDigest(s, "");
  const i = dig.indexOf("=== HOW THESE PEOPLE SPEAK");
  const speak = dig.slice(i);

  check("(1) what they want — printed", /wants:/.test(dig), "wants");
  check("(2) what they know — printed", /BELIEFS:/.test(dig), "beliefs");
  check("(2) ...and adjacent to where the line gets written", /holds to be true/.test(speak), speak.slice(0, 400));
  check("(3) what their body is doing — printed", /body:/.test(dig));
  check("(3) ...and adjacent", /right now:/.test(speak));
  check("(4) who else can hear — stated where the speakers are listed", /same room and can hear each other/i.test(speak));
  check("(5) what their life gave them words for — adjacent", /the life behind the words/.test(speak));
}

/* ── 2. THE COLLISION. "knows:" meant skills; the procedure means awareness ──── */
{
  const { s } = fixture();
  const dig = volatileDigest(s, "");
  check("no line is labelled 'knows', which the procedure would capture by accident",
    !/^\s*knows[ (:]/m.test(dig), (dig.match(/^\s*knows.*$/m) ?? [])[0]);
  check("the skills line says what it actually is", /can talk at length about: brewing/.test(dig));
  for (const [label, P] of [["full", narratorSystem(false)], ["lean", narratorSystem(true)]] as [string, string][]) {
    check(`${label}: question 2 names the fields that answer it`, /BELIEFS and RECALLS lines/.test(P));
    check(`${label}: ...and says a false belief is still acted on`, /belief can be false and they still act on it/i.test(P));
  }
}

/* ── 3. every label an instruction points at exists in a rendered context ────── */
{
  const { s } = fixture();
  const rendered = volatileDigest(s, "");
  const INSTR = narratorSystem(false) + "\n" + narratorSystem(true);
  // the quoted field labels the contracts tell the model to read
  const pointed = [...new Set([...INSTR.matchAll(/"([a-z_]{2,20}:)"/g)].map((m) => m[1]))];
  check("the contracts do point at named labels", pointed.length >= 2, pointed);
  for (const p of pointed) {
    check(`pointed-at label exists in the context: "${p}"`, rendered.includes(p), p);
  }
  // and the block names the procedure sends the model to
  for (const block of ["PRESENT — LIVE STATE", "HOW THESE PEOPLE SPEAK"]) {
    check(`the procedure sends the model to a block that exists: ${block}`,
      INSTR.includes(block) && rendered.includes(block), block);
  }
  check("no instruction still points at a 'card' nothing is called",
    !/on the speaker's card above|VOICE LINES ON EACH CARD/.test(INSTR));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
