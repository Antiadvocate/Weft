/* Smoke test: THE PAYOFF LANDED ON ONE PAGE AND WAS NEVER MENTIONED AGAIN.
 *
 * "Talks to me ONCE after I ask for it. Never talks again."
 *
 * From the save at turn 89. A clock called The Voice — "the voice Joe hears from Amber's feet grows
 * stronger and more seductive" — climbed from 1 to 6 across eighty-odd turns without producing a
 * single beat, and then delivered its consequence at turn 86:
 *
 *   "The Voice's clock has run out: Joe begins to lose his grip on reality, unable to distinguish
 *    the voice from his own thoughts."
 *
 * One obligation beat. Then the clock went to status "fired", which makes it ineligible as a source
 * forever, and the consequence went to status "fired", which makes it invisible: only PENDING
 * consequences are rendered, and only into the bookkeeper's view. Neither list ever reached the
 * narrator at all.
 *
 * So the entire payoff of the story existed on exactly one page. The player's sentence is a precise
 * description of the mechanism.
 *
 * A consequence that has fired is not an event that is over. It is the condition the world is in
 * now, and it belongs on the card for as long as it is true — the way canon does. */
import { volatileDigest } from "../src/engine/prompts";
import { newSave, registerCharacter } from "../src/engine/state";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const FIRED = "The Voice's clock has run out: Joe begins to lose his grip on reality, unable to distinguish the voice from his own thoughts.";
const PENDING = "The landlord's inspection arrives on Thursday.";
function world(cons: any[]): SaveState {
  const s = newSave("still", { name: "The Apartment", era: "contemporary" } as any);
  s.world.places["loc_lr"] = { id: "loc_lr", name: "The Living Room", description_facts: "Rain on the glass.", contains: [] } as any;
  s.world.player_location = "loc_lr";
  registerCharacter(s, { name: "Joe", character_id: "char_player", pronouns: "he/him", age: 39,
    appearance_facts: "Runner's build.", core_traits: ["orderly"], values: ["order"] } as any);
  const id = registerCharacter(s, { name: "Amber", pronouns: "she/her", age: 19,
    appearance_facts: "Bare feet.", core_traits: ["waits"], values: ["being looked at"] } as any);
  s.characters[id].location = "loc_lr";
  s.characters["char_player"].location = "loc_lr";
  s.world.present = [id];
  s.world.current_turn = 89;
  s.world.consequences = cons as any;
  return s;
}

/* ── 1. what has landed stays on the page ────────────────────────────────────── */
{
  const d = volatileDigest(world([{ id: "c1", description: FIRED, fire_turn: 86, severity: "major", status: "fired" }]), "in the living room");
  check("THE PAYOFF IS STILL THERE THREE TURNS LATER", d.includes("lose his grip on reality"), "fired consequence invisible");
  check("...named as the state the world is in, not as news", /ALREADY HAPPENED, AND STILL TRUE/.test(d));
  check("...and explicitly not to be run again", /Nobody announces it, discovers it, or resolves it again/.test(d));
  check("...but goes on showing in what people do", /goes on showing in what people do/.test(d));
}

/* ── 2. a consequence that has NOT landed is not announced as true ───────────── */
{
  const d = volatileDigest(world([{ id: "c2", description: PENDING, fire_turn: 120, severity: "minor", status: "pending" }]), "in the living room");
  check("a pending consequence is not reported as already true",
    !d.includes("landlord's inspection"), "a scheduled event leaked as history");
  check("...and the block is absent entirely when nothing has landed",
    !/ALREADY HAPPENED, AND STILL TRUE/.test(d));
}

/* ── 3. a world where nothing has ever fired is unchanged ────────────────────── */
{
  const d = volatileDigest(world([]), "in the living room");
  check("no consequences, no block", !/ALREADY HAPPENED/.test(d));
}

/* ── 4. it does not grow without bound ───────────────────────────────────────── */
{
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, description: `Thing number ${i} happened and stayed true.`, fire_turn: 10 + i, severity: "minor", status: "fired" }));
  const d = volatileDigest(world(many), "in the living room");
  const shown = (d.match(/Thing number \d happened/g) ?? []).length;
  check("only the most recent handful are carried", shown > 0 && shown <= 4, shown);
  check("...and they are the most recent ones", d.includes("Thing number 8"), "kept the oldest instead");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
