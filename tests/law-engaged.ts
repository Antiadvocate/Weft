/* Smoke test: A LAW OF THIS WORLD APPLIES — named by the turn's read, quoted as the world states it.
 *
 * Velora: an hour-long foot massage written tender while the biology law said pain at ten minutes,
 * and when the player invoked the law the model invented an exception ("maybe because you're not
 * Wym"). The engine quotes the law the player's act runs into back to the narrator as binding. Which
 * law that is used to be found by shared words and word stems between the action and each law; the
 * turn's read (engine/actionread.ts, `engages_law`) now names it, copied from the list it was shown,
 * and engine/facts.ts finds that entry in the world's own statement of it.
 */
import { engagedLaw, lawEntries } from "../src/engine/facts";
import { setRead } from "../src/engine/actionread";
import { newSave } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const LAW = "A Wym's touch on another's skin turns to pain after ten minutes";
const s = newSave("Velora", { name: "Velora", era: "now" } as any);
s.world_bible.forbidden = `${LAW}; nobody outside the Wym may enter the Hollow. Short.`;
s.world_bible.magic_rules = "None.";
s.world.canon = ["The river carries every name spoken over it to the sea."];

/* ── 1. the world's law, as the bible and canon state it ─────────────────────── */
{
  const laws = lawEntries(s);
  check("each forbidden entry is its own law", laws.includes(LAW) && laws.includes("nobody outside the Wym may enter the Hollow"), laws);
  check("a fragment too short to be a law is not one", !laws.includes("Short"), laws);
  check("\"None.\" is not a magic rule", !laws.some((l) => l.startsWith("None")), laws);
  check("canon lines are law too", laws.includes("The river carries every name spoken over it to the sea."), laws);
}

/* ── 2. the read names it ────────────────────────────────────────────────────── */
{
  const act = "I keep rubbing her feet, slowly, for the whole hour";
  setRead(s, act, { engages_law: LAW });
  check("the law the read names is the one quoted", engagedLaw(s, act) === LAW, engagedLaw(s, act));

  // the reader is shown laws clipped to fit, so its copy can end early, with the clipping mark
  setRead(s, act, { engages_law: "A Wym's touch on another's skin turns to pain…" });
  check("a clipped copy finds the whole law", engagedLaw(s, act) === LAW, engagedLaw(s, act));

  setRead(s, act, { engages_law: "  a wym's touch on another's skin turns to pain after ten minutes. " });
  check("spacing, case and the closing stop don't matter", engagedLaw(s, act) === LAW, engagedLaw(s, act));

  // a custom the reader was shown that this list doesn't hold still reaches the narrator as given
  setRead(s, act, { engages_law: "Guests remove their shoes at the threshold" });
  check("a law outside the list is quoted as the read gave it", engagedLaw(s, act) === "Guests remove their shoes at the threshold", engagedLaw(s, act));

  setRead(s, act, {});
  check("an empty read engages nothing, whatever the words share with a law", engagedLaw(s, "I touch her skin for ten minutes") === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
