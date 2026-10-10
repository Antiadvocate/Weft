/* Smoke test: WHAT A PERSON CARRIES IN FROM BEFORE THE STORY.
 *
 * The forge filed a background paragraph and started episodic memory empty, so a woman whose card
 * says her brother drowned at the ford had no afternoon at the ford to be reminded of. Formative
 * memories are dated, first-person episodes from before turn 1 — and an episode that names a person
 * or place the card does not already hold is dropped, because an invented sister is how kinship gets
 * contradicted forty turns later. */
import { fileFormative, formativeBrief, hasFormative, FORMATIVE_SYSTEM } from "../src/engine/formative";
import { newSave, registerCharacter } from "../src/engine/state";
import { retrieveScored } from "../src/engine/memory";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s = newSave("Hollow Weir", { name: "Hollow Weir", era: "early iron age" } as any);
s.world.places["loc_ford"] = { id: "loc_ford", name: "Black Ford", description_facts: "", contains: [] } as any;
const mara = registerCharacter(s, { name: "Mara Quill", age: 34, background: "Keeps the mill at Black Ford. Her brother Tam drowned at the ford the spring she was twelve; she has never learned to swim. An only child since." });
const player = "char_player";
registerCharacter(s, { name: "Joe Arden", character_id: player } as any);

const r = fileFormative(s, mara, [
  { age: 12, memory: "When I was twelve, I stood on the bank at Black Ford and watched the men pull Tam out with a hay hook.", weight: 9, feeling: "cold" },
  { age: 7, memory: "When I was seven, my father let me pour the first sack into the hopper and I spilled half of it on my feet.", weight: 5, feeling: "pride" },
  { age: 15, memory: "When I was fifteen, my sister Ila and I climbed the mill roof to watch the eclipse.", weight: 6 },          // invents a sister
  { age: 20, memory: "The year I turned twenty I sold flour at Caer Dun market for the first time.", weight: 4 },                 // invents a place
  { age: 40, memory: "When I was forty, I finally learned to swim.", weight: 8 },                                                  // older than she is
  { age: 9, memory: "Mara watched the river rise.", weight: 3 },                                                                    // too short, third person
  { age: 30, memory: "The winter I turned thirty, the wheel froze solid and I chipped it free with my mother's old cleaver.", weight: 6, feeling: "stubborn" },
]);

const fm = s.memory[mara].episodic.filter((m) => m.formative);
check("the ones that pass are kept", r.kept === 3 && fm.length === 3, { kept: r.kept, dropped: r.dropped });
check("a memory that invents a sister is dropped", r.dropped.some((d) => /Ila/.test(d)), r.dropped);
check("so is one that invents a place", r.dropped.some((d) => /Caer|Dun/.test(d)), r.dropped);
check("and one from an age she hasn't reached", r.dropped.some((d) => /age 40/.test(d)), r.dropped);
check("and one that isn't hers to tell in the first person", r.dropped.some((d) => /wrong length|not first person/.test(d)), r.dropped);
check("a name the card holds is allowed", fm.some((m) => /Tam/.test(m.content)));
check("each is dated before the story, in the order lived", fm.every((m) => (m.event_turn ?? 0) < 0)
  && fm.map((m) => m.when_label).join() === [...fm].sort((a, b) => (a.event_turn ?? 0) - (b.event_turn ?? 0)).map((m) => m.when_label).join(), fm.map((m) => m.when_label));
check("anchored before the story began", fm.every((m) => m.anchor_rel === "before the story began" && m.turn === 0));
check("weight becomes importance, within bounds", fm.find((m) => /Tam/.test(m.content))!.importance === 9);
check("hasFormative sees them", hasFormative(s, mara));
check("the player is never given a past", fileFormative(s, player, [{ age: 5, memory: "When I was five, I fell off a wall at Black Ford.", weight: 5 }]).kept === 0);

/* they are memories now: retrieval can find the ford when the scene is about the river */
const got = retrieveScored(s.memory[mara], "the river at the ford, a drowning", 30, 3, 0, "Day 3, 10:00").map((x) => x.m.content);
check("a scene about the ford can reach the drowning", got.some((c) => /Tam/.test(c)), got);

/* the brief carries the card and the ties, and the prompt asks for what the screen checks */
const brief = formativeBrief(s, [mara]);
check("the brief carries the card", /brother Tam drowned/.test(brief) && /PERSON: Mara Quill, 34/.test(brief));
check("the prompt asks for first person, a stated age, and no new names", /first person/.test(FORMATIVE_SYSTEM) && /stated age/.test(FORMATIVE_SYSTEM) && /names a person only if the card already names them/.test(FORMATIVE_SYSTEM));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
