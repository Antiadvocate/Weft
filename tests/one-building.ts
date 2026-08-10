/* Smoke test: A ROOM IS NOT A PLACE, AND A NEIGHBOUR IS NOT A RADIO.
 *
 * "Dana is somehow fucking calling from the USS Resolute when she's literally sitting in the bunker."
 *
 * She was. The record had her at "The Alki Bunker" and the player at "Alki Bunker - Rabi and Liz
 * Room" — the same building, split into three separate locations:
 *
 *     The Alki Bunker                    ← Marcus, Dana
 *     Alki Bunker - Rabi and Liz Room    ← the player, Liz
 *     Alki Bunker - Marcus and Dana Room ← empty
 *
 * Presence is computed per location, so two people twenty feet apart were NOT IN THIS SCENE. The
 * narrator, needing Dana and told she was elsewhere, gave her the only voice available to somebody
 * who is not in the room: "Resolute to Alki Bunker... The voice through the speaker was Dana's."
 *
 * The digest already tells the models rooms are prose, not locations. But the diff's new_places
 * loop never consulted the sub-place guard at all, and that guard exempts any name with two or more
 * capitalised words — which every real building has. Both halves had to be wrong for this to
 * happen, and both were. */
import { isPartOfAPlace } from "../src/engine/turn";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* the shape the models actually produce, from the save */
const PLACES = ["The Alki Bunker", "Alki Beach", "The USS Resolute", "Harrison Hospital"];
const inside = (name: string) => PLACES.some((p) => {
  const outer = p.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
  const inner = name.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
  return outer.length >= 4 && inner.length > outer.length && inner.startsWith(outer);
});

{
  check("the room that caused this is recognised as inside the bunker", inside("Alki Bunker - Rabi and Liz Room"));
  check("and so is the other one", inside("Alki Bunker - Marcus and Dana Room"));
  check("with the article on the front too", inside("The Alki Bunker Galley"));
  check("a deck of the ship is part of the ship", inside("USS Resolute - Sick Bay"));
}
{
  check("a genuinely new place is still allowed", !inside("Harborview Medical Center"));
  check("even one sharing a word with an existing place", !inside("Alki Point Lighthouse"), "Alki Point Lighthouse");
  check("the bunker itself is not inside itself", !inside("The Alki Bunker"));
  check("nor is a shorter name that merely starts similarly", !inside("Alki"));
}
{
  // the older guard, which this backs up rather than replaces
  check("a bare room name is still caught by the original guard", isPartOfAPlace("the kitchen"));
  check("as is a relative position", isPartOfAPlace("just outside the door"));
  check("a real location is not", !isPartOfAPlace("Harrison Hospital"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
