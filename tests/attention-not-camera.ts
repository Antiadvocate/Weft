/* THE FRAME WAS A CAMERA WITH A NOVELIST OPERATING IT.
 *
 * The author of this system, on what he built it for: "the narrator functions as my attention. When
 * I'm relaxed it gives me less details about pointless bullshit, when I'm not relaxed I get more
 * noise. But the noise is not 100% Dickens. It is: 'she's talking about that kitchen mess last
 * night. Fuck. Eli's toy, a yellow shell, turned sideways.' My eyes would wander here: 'corner of
 * the room, a spider. Is it dead? Asleep. Maybe.' It's a stream of thought."
 *
 * What the engine produced instead, from the save that prompted this — 230 object-handling phrases
 * across 77 turns, three a turn, and nine consecutive turns of a woman doing things to a coffee cup
 * ("over the rim" four times, "turned the cup" six):
 *
 *   "The servant with the tray had set it down on a table near the wall and was counting glasses,
 *    touching each one with a forefinger, and through the long front windows the street was black
 *    and wet."
 *
 * One sentence, three clauses, two conjunctions, past perfect, a settled omniscient calm. Nobody's
 * attention has ever done that.
 *
 * TWO FAULTS, AND THE FIRST IS A POLARITY. Clench NARROWED the frame and ease OPENED it, so the
 * state that was meant to produce noise produced the least of any band. Acute threat really does
 * tunnel the vision and that is kept at the bottom of the scale, but the ordinary not-relaxed state
 * of somebody in a room is not terror, it is distractibility, and that is most turns.
 *
 * THE SECOND IS THAT NOTHING GOVERNED THE GRAMMAR. Every dial in the file — scan, pull, aperture,
 * ordering — is about how much gets in and in what order. The difference between an attention and a
 * camera is not quantity, it is that one of them writes in fragments and jumps and the other writes
 * in complete subordinated clauses. */
import { newSave, registerCharacter } from "../src/engine/state";
import { frameDirective } from "../src/engine/frame";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`); }
}
function at(relax: number, capacity = 0): string {
  const s: any = newSave("frame", { name: "England", era: "1932", technology_level: "interwar",
    magic_rules: "none", forbidden: "", what_people_fear: "the means test", cultures_and_languages: "english",
    climate_and_geography: "wet", calendar_and_currency: "sterling", political_situation: "the slump" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player", texture: ["watches hands"] } as any);
  const id = registerCharacter(s, { name: "Emily Clarke", age: 19 } as any);
  s.world.present = [id];
  s.condition.char_player.psyche.relaxation = relax;
  s.condition.char_player.psyche.capacity = capacity;
  return frameDirective(s, [id], []);
}
const bandOf = (d: string) => d.match(/HOW MUCH GETS IN: ([A-Z ]+):/)?.[1] ?? "?";

/* ── THE POLARITY ───────────────────────────────────────────────────────────────────────────── */
{
  const walk = [-8, -4, -2, 0, 5, 9].map((r) => [r, bandOf(at(r))] as const);
  console.log(`     (${walk.map(([r, b]) => `${r}:${b}`).join("  ")})`);
  check("terror still tunnels", bandOf(at(-8)) === "NARROWED RIGHT DOWN");
  check("ordinary strain is where the noise is", bandOf(at(-4)) === "WANDERING");
  check("…and ease is the quiet one now", bandOf(at(6)) === "CLEAR");
  check("the bands are distinct all the way up", new Set(walk.map(([, b]) => b)).size === 4, walk);
}
{
  const strained = at(-4), easy = at(6);
  check("under strain the attention will not stay put", /won't stay where they put it/.test(strained));
  check("…and several things arrive uninvited", /Three or four things push in uninvited/.test(strained));
  check("…none of them connected or picked up", /none of them matter, connect to anything, or come up again/.test(strained));
  check("…and it is not tidied into a mood", /Don't tidy this up into a mood/.test(strained));
  check("at ease little gets in and it was worth it", /very little gets in, just one or two things this person would actually choose to notice/.test(easy));
  check("…and no ambient furnishing", /no background description/.test(easy));
}

/* ── AND THE GRAMMAR, WHICH IS THE HALF THAT WAS MISSING ────────────────────────────────────── */
{
  const d = at(-4);
  check("a fragment is named as correct", /A fragment is right, and a whole sentence is usually wrong/.test(d));
  check("nothing joins one noticing to the next", /Don't join one thing noticed to the next/.test(d));
  check("…and nothing explains the jump", /with nothing to explain the jump/.test(d));
  check("two facts about a thing, not three", /Give two facts about a thing and no third/.test(d));
  check("naming beats describing", /name it instead of describing it/.test(d));
  check("it may ask and not answer", /ask itself something and not answer it/.test(d));
  check("it may come back late having missed a line", /come back late, in the middle of an exchange, having missed a line/.test(d));
  /* NAMING THE DISTRACTION TURNS IT BACK INTO DESCRIPTION, which is the failure the whole rule is
   * for: "his attention wandered to the corner" is a camera reporting an attention. */
  check("and the distraction is never named as one", /Never write that the player noticed something, got distracted/.test(d));
}
check("at ease the grammar relaxes with it", /it can be a whole sentence and rest there for a moment/.test(at(6)));
check("no strays, no rule about how to write them", !/HOW A STRAY IS WRITTEN/.test(at(-8)), bandOf(at(-8)));
check("the middling band stays as it was", !/HOW A STRAY IS WRITTEN/.test(at(0)));

/* ── WHAT IS DELIBERATELY NOT COPIED FROM HIS EXAMPLE ───────────────────────────────────────
 * His has "I gotta take care of her better" in it — the player's own verdict on himself, which
 * this engine does not write. The frame puts the toy on the floor and stops; he supplies the rest.
 * That rule predates all of this and has to survive it. */
{
  const d = at(-4);
  check("the player's own acts still stay bare", /WHAT THE PLAYER DOES STAYS PLAIN/.test(d));
  check("…and the meaning of them is still his to supply", /belongs to the player, so never spell it out/.test(d));
}
/* CAPACITY STILL HOLDS A CHANNEL OPEN — a curious person in a bad state still registers the light,
 * and that was in the file before any of this. */
check("high capacity keeps somebody out of the tunnel", bandOf(at(-8, 6)) !== "TUNNELLED", bandOf(at(-8, 6)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
