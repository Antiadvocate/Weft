/* Smoke test: CORE TRAITS ARE BINDING BEHAVIOUR, AND THE PLAYER HAS THEM TOO.
 *
 * A player wrote this as their character's first core trait:
 *
 *   "Cannot refuse any direct request from a woman whose bare feet he sees — his body moves
 *    before his mind can object."
 *
 * It reached the narrator exactly once, buried in a 34,000-character cached prefix that is
 * re-anchored every six turns, and never again on any turn where it might have mattered. Every
 * NPC in the same scene got their traits restated in the volatile per-turn block, on the line
 * immediately above their mood and their wants. The player got one truncated sentence of
 * background and nothing else. It read as being ignored because it effectively was. */
import { newSave, registerCharacter } from "../src/engine/state";
import { volatileDigest, narratorSystem, simulatorSystem, tailGist, FORGE_SYSTEM } from "../src/engine/prompts";
import { SKETCH_SYSTEM } from "../src/engine/sketch";
import { needsHistoryCompaction } from "../src/engine/social";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PLAYER_TRAIT = "Cannot refuse any direct request from a woman whose bare feet he sees—his body moves before his mind can object.";

function world(): SaveState {
  const s = newSave("traits", { name: "Veridun", era: "medieval" } as any);
  s.world.places["loc_cave"] = { id: "loc_cave", name: "The cave", description_facts: "Cold stone.", contains: [] };
  s.world.player_location = "loc_cave";
  registerCharacter(s, {
    name: "Rabi", character_id: "char_player", pronouns: "he/him", age: 30,
    appearance_facts: "Lean build. Dark brown hair.",
    background: "Rabi is from another land, he used to be an electrical engineer. He's adhd and socially awkward.",
    core_traits: [PLAYER_TRAIT, "obsessed with beautiful womens feet.", "exceptionally socially awkward at times"],
    values: ["Freedom—he never wants to be caged again.", "Knowledge", "Kindness"],
  } as any);
  const m = registerCharacter(s, {
    name: "Mable", pronouns: "she/her", age: 28, appearance_facts: "Red braid. Barefoot.",
    core_traits: ["Devoted", "Perceptive", "enjoys being worshipped by rabi"],
    values: ["being treated as a person, not a problem", "her feet being worshipped"],
  } as any);
  s.characters[m].location = "loc_cave";
  s.characters["char_player"].location = "loc_cave";
  s.world.present = [m];
  s.world.current_turn = 25;
  return s;
}

/* 1. the per-turn block carries both cards' traits */
{
  const d = volatileDigest(world());
  check("the NPC's traits are in the volatile block", /Devoted; Perceptive/.test(d), d.match(/as: .*/)?.[0]);
  check("the player's traits are too", d.includes(PLAYER_TRAIT), d.match(/built like this.*/)?.[0]?.slice(0, 120));
  check("the player's values come with them", /Freedom/.test(d));
  check("and it is framed as the body, not their choices",
    /built like this — render it in the body and the involuntary, never in their choices/.test(d), d.match(/built like this[^\n]*/)?.[0]?.slice(0, 90));
  check("the NPC framing is unchanged", /\n {2}as: Devoted/.test(d), d.match(/ {2}as: [^\n]*/)?.[0]);
}

/* 2. a character with no traits does not produce an empty line */
{
  const s = world();
  s.characters["char_player"].core_traits = [];
  const d = volatileDigest(s);
  check("no traits, no line", !/built like this/.test(d));
  check("the rest of the player's block survives", /\(PLAYER\)/.test(d));
}

/* 3. and the narrator is told what a trait is FOR */
{
  // BOTH contracts. The lean one is what most turns actually run on — the full contract is only
  // re-sent on an I-frame, so a rule that lives only there is a rule that applies every sixth turn.
  for (const [label, P] of [["full", narratorSystem(false)], ["lean", narratorSystem(true)]] as [string, string][]) {
    check(`${label}: traits are declared binding`, /CORE TRAITS ARE BINDING BEHAVIOUR/.test(P));
    check(`${label}: a trait bearing on the scene has to show`, /if a trait bears on (?:what is happening in )?this scene,? it SHOWS/i.test(P));
    check(`${label}: the trait outranks convenience`, /where a trait and the scene's convenience disagree,? the trait wins/i.test(P));
    check(`${label}: the player's agency is protected`, /never their decisions/i.test(P));
    check(`${label}: it points at the lines the digest actually emits`, /"as:"/.test(P) && /"built like this"/.test(P));
  }
}

/* 4. AND THE RUNNING LOG DOES NOT GET TO DROWN THEM.
 *
 * This is the half that made NPC traits look ignored. `life_history` accretes a line per beat and
 * was rendered in full every turn. One character's had reached 1,100 characters — EIGHT TIMES the
 * length of her trait line — and was a first-person transcript of the exact conversation the scene
 * was stuck in. Her card said "Devoted; Perceptive; enjoys being worshipped by rabi". Three bare
 * adjectives against eight times their length of vivid, specific, aggrieved prose describing a
 * different woman entirely, and the log wins that on volume every turn. It also feeds the stall
 * back in: the record of the loop becomes the strongest argument for continuing it. */
{
  const REAL_LOG = "Rabi broke down crying in the cave and almost said my full name but couldn't finish it; I sat beside him and touched his knee, telling him he said it. Rabi said he wants to die; I held his chin and told him dying is not on the table, that I did not cross a sea to watch him find a third way to leave. Rabi called me 'Duchess Mable' in the cave, naming me as his duchess, and I felt the claim land. Rabi called me everything to him, said he cannot define me as cook or lover because I am all those things in one, and promised the title would be decreed in record. I told Rabi I would stop guessing and asking, and that he must tell me the real reason he left his city if he wants me to know. Rabi told her he left because he couldn't bear being in that place alone without her. Rabi admitted we've had less intimacy than a normal relationship in two days, and I told him he's been finding reasons not to kiss me since I woke.";
  check("the real log is long enough to bury a trait line", REAL_LOG.length > 800, REAL_LOG.length);

  const s2 = world();
  const m = Object.keys(s2.characters).find((id) => s2.characters[id].name === "Mable")!;
  s2.characters[m].life_history = REAL_LOG;
  const d = volatileDigest(s2, "Mable devotion the cave");
  const logLine = d.match(/ {2}since the story began: [^\n]*/)?.[0] ?? "";
  check("the log is cut down in the block", logLine.length < 500, logLine.length);
  check("it is marked as a tail rather than the whole thing", logLine.includes("…"), logLine.slice(0, 80));
  check("the newest beat survives", /finding reasons not to kiss me/.test(logLine), logLine.slice(-80));
  check("the oldest is what was dropped", !/broke down crying/.test(logLine));
  check("and the traits are still right there above it", /as: Devoted; Perceptive/.test(d));

  // a short log is left exactly as it is
  s2.characters[m].life_history = "She took the third floor and nobody contested it.";
  const d2 = volatileDigest(s2, "x");
  check("a short log is untouched", /since the story began: She took the third floor and nobody contested it\./.test(d2), d2.match(/since the story began: [^\n]*/)?.[0]);

  // tailGist itself
  check("a short string is returned whole", tailGist("Short enough.", 100) === "Short enough.");
  check("a long one is cut on a sentence boundary, never mid-sentence",
    tailGist("Alpha beta gamma. Delta epsilon zeta. Eta theta iota.", 26) === "…Eta theta iota.",
    tailGist("Alpha beta gamma. Delta epsilon zeta. Eta theta iota.", 26));
  check("a log with no sentence breaks at all still gets cut rather than passed through",
    tailGist("a".repeat(300), 50).length <= 51, tailGist("a".repeat(300), 50).length);
  check("the tail is what is kept, not the head",
    tailGist("Alpha beta gamma. Delta epsilon zeta. Eta theta iota.", 26).includes("Eta theta iota"));
  check("an empty log is nothing", tailGist("", 100) === "");

  // and compaction now fires before a log can reach that size
  check("a 1,100-character log is now due for compaction",
    needsHistoryCompaction({ life_history: REAL_LOG } as any));
  check("a short one is not", !needsHistoryCompaction({ life_history: "Took the third floor." } as any));
}

/* 5. the contract says what a trait outranks, in both versions */
{
  for (const [label, P] of [["full", narratorSystem(false)], ["lean", narratorSystem(true)]] as [string, string][]) {
    check(`${label}: the trait outranks the character's own log`, /since the story began/.test(P) && /the TRAIT wins|the trait wins/.test(P));
    check(`${label}: and the reason it loses otherwise is named`, /volume|drown/.test(P));
  }
}

/* 6. A PERSON HAS MORE THAN ONE SUBJECT.
 *
 * Every NPC in a 25-turn save had `skills: {}` — the field is required on Identity and no creation
 * path ever asked for it. `texture` was specced as "1-2 concrete habits or physical tells" against
 * a type whose own comment says it holds "a few standing interests… knows too much about rocks",
 * so it filled with body language instead of interests. And both were rendered only at detail>=2,
 * which fires at the top context level alone.
 *
 * The result, read off the save: a trader whose background, traits, values, speech, example lines
 * and agenda are ALL about trade; an innkeeper whose six fields are all about surviving power; a
 * made woman whose every field is about being made. Each is one subject with legs. */
{
  const s2 = world();
  const m = Object.keys(s2.characters).find((id) => s2.characters[id].name === "Mable")!;
  s2.characters[m].texture = ["watches for the first swifts every spring", "will not hear the harvest song sung slow", "keeps a tally stick out of habit"];
  s2.characters[m].skills = { "reading a scale": "better than the merchants she learned it from", "mending nets": "passable, learned as a child" };

  const d = volatileDigest(s2, "the cave");
  check("texture reaches the narrator", /watches for the first swifts/.test(d), d.match(/ {2}texture[^\n]*/)?.[0]);
  check("and is labelled as something she raises herself", /raises these unprompted/.test(d));
  check("skills reach the narrator", /reading a scale/.test(d), d.match(/ {2}knows[^\n]*/)?.[0]);
  check("with how she came by them", /learned as a child/.test(d));
  check("labelled as what she can talk about", /can hold forth on/.test(d));

  // and they are not gated behind the most generous context budget
  const squeezed = volatileDigest(s2, "the cave", { budgetOverride: 900 });
  check("they survive a tight token budget", /swifts/.test(squeezed) && /reading a scale/.test(squeezed),
    squeezed.match(/ {2}(texture|knows)[^\n]*/g));

  // empty fields produce no empty lines
  s2.characters[m].texture = [];
  s2.characters[m].skills = {};
  const bare = volatileDigest(s2, "x");
  check("no texture, no line", !/texture \(raises/.test(bare));
  check("no skills, no line", !/knows \(can hold/.test(bare));
}

/* 7. and every creation path now asks for a life outside the plot */
{
  const paths: [string, string][] = [
    ["forge", FORGE_SYSTEM],
    ["simulator", simulatorSystem(false)],
    ["simulator (lean)", simulatorSystem(true)],
    ["sketch", SKETCH_SYSTEM],
  ];
  for (const [label, P] of paths) {
    check(`${label}: asks where they are from`, /where they are from/i.test(P), label);
    check(`${label}: asks for a named trade or body of knowledge`, /trade or body of knowledge/i.test(P), label);
    check(`${label}: asks for something unconnected to the player`, /(unconnected to the player|NOTHING to do with the story|nothing to do with the player)/i.test(P), label);
    check(`${label}: asks for texture unrelated to their role`, /(unrelated to their trade|nothing to do with their trade)/i.test(P), label);
    check(`${label}: asks for skills`, /skills/i.test(P), label);
  }
  check("the forge names the failure it is preventing",
    /can talk about one subject, and every scene with them is the same scene/.test(FORGE_SYSTEM));
  for (const [label, P] of [["full", narratorSystem(false)], ["lean", narratorSystem(true)]] as [string, string][]) {
    check(`${label}: texture is no longer confined to quiet scenes`, !/texture:" quiet scenes only|quiet scenes only\./.test(P), label);
    // "conversational range" named a quality; both contracts now say what to DO with the field —
    // it is the list of subjects this person has, and one of them gets used this turn.
    check(`${label}: texture is the list of subjects this person has`,
      /the subjects available to this person|raises? (?:these )?unprompted|brings up unprompted/i.test(P), label);
    check(`${label}: ...and it has to reach the page`,
      /something to say this turn that is not about the plot and not about the player/i.test(P), label);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
