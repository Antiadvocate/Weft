/* Smoke test: "I TEXT SARAH" NAMES SARAH.
 *
 * The player texted a friend twice. The narrator described her at length — "a friend from the old
 * job, the one who'd never met Tessa, the one who wouldn't have to pick sides" — and thirty-nine
 * turns later she was still not a person: no card, no edge, no memory, no way for her to answer.
 *
 * The detector required a capital letter. The player typed "i text sarah". A lower-case candidate is
 * now considered when it follows a word that can only precede a person — text, call, find, ask,
 * meet — which is a stronger signal than capitalisation ever was, and is how people actually type. */
import { newSave, registerCharacter } from "../src/engine/state";
import { namedInAction } from "../src/engine/turn";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("named", { name: "The Arrangement", era: "contemporary" } as any);
  s.world.places["loc_apt"] = { id: "loc_apt", name: "The Apartment", description_facts: "Rooms.", contains: [] };
  s.world.player_location = "loc_apt";
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa" } as any);
  return s;
}

/* 1. the line from the save */
{
  const s = world();
  const got = namedInAction(s, `"Something quiet would be good." I tell him I text my family. then i text my only non couple friend sarah "she cheated on me. im scared sarah"`);
  check("sarah is named", got.includes("Sarah"), got);
  check("recorded capitalised", got.some((n) => n === "Sarah"), got);
  check("and nothing else is dragged in", got.length === 1, got);
}

/* 2. the verbs that can only precede a person */
{
  const s = world();
  for (const line of ["i text sarah", "i call marek", "i go find marek", "i ask sarah about it", "i meet marek at the bar", "i message sarah"]) {
    check(`"${line}"`, namedInAction(s, line).length === 1, namedInAction(s, line));
  }
}

/* 3. and the lower case that is NOT a name */
{
  const s = world();
  for (const line of [
    "i sit down and think about it",
    "i go to the window and look out at the rain",
    "i text her that im sorry",
    "i call the lawyer in the morning",
    "i find the ring in the drawer",
    "i ask about the divorce",
  ]) check(`"${line}" names nobody`, namedInAction(s, line).length === 0, namedInAction(s, line));
}

/* 4. capitalised names still work exactly as before */
{
  const s = world();
  check("a capitalised name mid-sentence", namedInAction(s, "I go and find Marek before dark").includes("Marek"));
  check("known cast is never re-offered", namedInAction(s, "I talk to Tessa").length === 0, namedInAction(s, "I talk to Tessa"));
  check("places are not people", namedInAction(s, "I walk to The Apartment").length === 0);
  check("contractions are not people", namedInAction(s, "I don't know what I'd do").length === 0);
  check("sentence-opening grammar is not a person", namedInAction(s, "Something quiet would be good.").length === 0);
  check("a common noun after a person-verb is still refused", namedInAction(s, "i call the doctor").length === 0, namedInAction(s, "i call the doctor"));
  check("and a role word too", namedInAction(s, "i text mother").length === 0, namedInAction(s, "i text mother"));
}

/* 5. the cap holds */
{
  const s = world();
  check("a typo storm is capped at three", namedInAction(s, "i text sarah and marek and corwin and allison and mable").length <= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
