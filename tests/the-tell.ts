/* Smoke test: TWO HUNDRED AND SIX INTENTS, NOT ONE TELL.
 *
 * From a save, turn 109. A gun is up. The intent pass authored this:
 *
 *   surface: She freezes mid-step, her whole body going still and small, her hands coming up in
 *            front of her chest, palms out. She is looking at the gun, not at him.
 *   truth:   She is one heartbeat from dying and she knows it, and the terror is so total it has
 *            gone quiet and clear. She wants to live, and she is furious that this is what it took
 *            for him to finally see her, and she is already cataloguing the exits and the weight of
 *            the gun in his hand.
 *
 * That is a superb piece of characterisation and the surface/truth split is doing exactly what it
 * was rebuilt to do. Here is the whole of what reached the page:
 *
 *   Her hands came up in front of her chest, slow, palms turned out. Her eyes went to the gun and
 *   stayed there.
 *
 * The surface, near-verbatim, and nothing else. Which is correct, because the narrator is never
 * shown `truth` — that is deliberate and it should stay. The tell is the ONLY channel by which
 * anything inside a character reaches the reader at all.
 *
 * Across three saves: 206 recorded intents, ZERO tells. The field was optional, its description
 * ended "Omit if they mask cleanly", and the model omitted it every single time — so the cast
 * rendered as pure surface for an entire playthrough. That is the thing the player described as
 * characters having "the emotional range of a horse fly", and as one of them having "zero interior",
 * while the interior sat in the save being magnificent and unreachable.
 *
 * It was also dropped on the way into the history record, so the GM panel could not show it and
 * nothing could measure that it was never there.
 */
import { INTENT_JSON_SCHEMA, INTENT_SYSTEM, intentForNarrator } from "../src/engine/intent";
import type { NpcIntent } from "../src/engine/intent";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const schema = INTENT_JSON_SCHEMA as { required?: string[]; properties?: Record<string, { description?: string }> };

/* ── 1. the field is not optional any more ───────────────────────────────────── */
{
  check("a tell is required of the model", (schema.required ?? []).includes("tell"), schema.required);
  check("...as are the other three", ["surface", "truth", "lying"].every((k) => (schema.required ?? []).includes(k)));
}

/* ── 2. and it reaches the narrator as something to do, not something to consider ── */
{
  const intent: NpcIntent = {
    char_id: "char_m", name: "Miranda",
    surface: "She freezes mid-step, hands coming up in front of her chest, palms out.",
    truth: "She is one heartbeat from dying and she is furious that this is what it took for him to see her.",
    tell: "her jaw sets for half a second before her hands come up",
    lying: false,
  };
  const note = intentForNarrator([intent]);
  check("the surface goes over", note.includes("freezes mid-step"), note);
  check("the tell goes over", note.includes("her jaw sets"), note);
  check("...as a thing that happens, not a thing that might", /AND THIS GETS THROUGH/.test(note), note);
  check("...rendered as the body, never as a feeling named", /as the body doing it and never as a feeling named/.test(note), note);
  check("...and not explained", /do not explain it/.test(note), note);

  // THE LINE THAT MUST NOT MOVE: truth is the bookkeeper's and the narrator never sees it.
  check("the TRUTH still never reaches the narrator", !note.includes("one heartbeat from dying"), note);
  check("...nor any part of it", !note.includes("furious"), note);
}

/* ── 3. and the model is told why it matters ─────────────────────────────────── */
{
  check("the model is told a tell is required", /"tell":"REQUIRED/.test(INTENT_SYSTEM));
  check("...and that it is the only route truth has to the page",
    /ONLY way anything you write in truth ever reaches the page/.test(INTENT_SYSTEM));
  check("...and what happens without one",
    /a person with a whole inner life reads as somebody with none/.test(INTENT_SYSTEM));
  check("...and that it must not decode the truth", /It must not decode the truth/.test(INTENT_SYSTEM));
  check("...and must be a thing the body does", /a THING THE BODY DOES, never a feeling named/.test(INTENT_SYSTEM));
  check("...and scales with how much is being held", /the more clenched the body, the more there is to leak/.test(INTENT_SYSTEM));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
