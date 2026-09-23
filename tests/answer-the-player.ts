/* THE VELORA SAVE: TWO PEOPLE WHO NEVER ANSWERED.
 *
 * The player told Veth and Sera he was a human from Earth, undressed to show them, and said he
 * didn't know how he got here. They talked about a gull on tower four, the harbor chill, the
 * brewery books and a grandmother's spring batches. Each of those came from an instruction:
 *
 *   · the beat called his claim "A SMALL REMINDER" to touch the scene "once, lightly";
 *   · "earth", "planet" and "human" were filed as used-up subjects nobody may raise again;
 *   · the echo rule said to imagine his action had never happened and rewrite any line that
 *     needed it;
 *   · the unfamiliar-word rule said a listener "hears the nearest thing in their own life and
 *     answers about that instead", so "outer space" became kegs.
 *
 * And the cards said "xem own" and "xem hands", because "xe/xer/xem" was read slot by slot. */
import { answerThePlayer, perceptibleInput } from "../src/engine/reaction";
import { spentSubjects } from "../src/engine/spent";
import { pronounsOf } from "../src/engine/aperture";
import { populationOf } from "../src/engine/population";
import { readFileSync } from "node:fs";
import type { SaveState, Place } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. a quiet beat gives way to what the player said ── */
{
  const line = `"Planet. As in. Outer space. I don't know how I got here."`;
  const a = answerThePlayer(line, "do");
  check("speech alone is something the room answers", /ANSWER THE PLAYER/.test(a) && a.includes("Outer space"), a);
  check("nobody changes the subject away from it", /Nobody changes the subject/.test(a));
  check("a private thought is not answered", answerThePlayer("*I wonder if they believe me*", "do") === "");
  check("think mode is never answered", answerThePlayer(line, "think") === "");
  check("a two-word nod leaves the scene to the world", answerThePlayer("I nod.", "do") === "");
  check("thoughts are taken out of what the room perceives", perceptibleInput(`"Hi." *they hate me*`) === `"Hi."`);

  const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
  check("only the quiet beats give way", /quietBeat = !beat \|\| beat\.kind === "none" \|\| beat\.kind === "reminder"/.test(src));
  check("the echo rule no longer asks for the action to be imagined away", !/never happened and read the line again/.test(src));
  check("the lead's errand waits on the answer", /Answering what the player just said or did comes first/.test(src));
}

/* ── 2. the player's own subject is never used up ── */
{
  const s = {
    world: { current_turn: 4, threads: [{ id: "t", title: "Rabi's claim of being from planet Earth", status: "active", description: "" }] },
    history: [{ player_action: `"I'm a human. From Earth."` }],
    spent_subjects: [
      { word: "earth", turns: [2, 3] },
      { word: "planet", turns: [2, 3] },
      { word: "human", turns: [2, 3] },
      { word: "flatstock", turns: [2, 3] },
    ],
  } as unknown as SaveState;
  const spent = spentSubjects(s);
  check("words the player said stay available", !spent.includes("earth") && !spent.includes("human"), spent);
  check("words naming a live thread stay available", !spent.includes("planet"), spent);
  check("a prop the cast invented can still be used up", spent.includes("flatstock"), spent);
}

/* ── 3. pronoun sets in any slot order ── */
{
  check("xe/xer/xem gives xer as possessive", pronounsOf("xe/xer/xem").possessive === "xer" && pronounsOf("xe/xer/xem").object === "xem");
  check("xe/xem/xyr still works", pronounsOf("xe/xem/xyr").possessive === "xyr");
  check("she/her/hers gives her own, never hers own", pronounsOf("she/her/hers").possessive === "her");
  check("he/him gives his", pronounsOf("he/him").possessive === "his");
}

/* ── 4. one person alone at home is nobody ── */
{
  const home = { id: "p", name: "Rabi's apartment", description_facts: "", population: { scale: 1, who: "Rabi, alone" } } as unknown as Place;
  check("an apartment for one has no crowd", populationOf(home) === null);
  const bar = { id: "b", name: "The Anchor and Bell", description_facts: "", population: { scale: 30, who: "longshoremen" } } as unknown as Place;
  check("a bar still has one", populationOf(bar)?.scale === 30);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
