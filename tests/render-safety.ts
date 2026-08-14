/* Smoke test: A SAVE THAT WILL NOT OPEN.
 *
 * From a real crash report, iPhone Safari, turn 17 of a save called "Regensburg":
 *
 *   Minified React error #31 — object with keys {char_id, where}
 *
 * SimulatorDiff.offscreen is declared string[] and is written by a model, which is not the same
 * thing as being strings. This one returned its world-motion lines as objects — the character and
 * the place, unflattened. They went into the offscreen log unread, were ranked, sliced, and stored
 * on the history entry, and Play renders each one directly as a React child. React refuses to
 * render an object and throws.
 *
 * The part that makes it more than a bad turn: the entry is PERSISTED. Every subsequent load of
 * that save re-renders the same object and throws again, which is why the report arrived three
 * times — one abrupt kill, then the same render crash twice on reopening. From the player's side
 * the story is simply gone.
 *
 * So it is fixed in three places, because any one of them alone leaves a hole. Coerce at ingestion
 * so it stops being recorded; repair on load so saves already holding one can open; and never trust
 * the type at the render site, because a save that shows one odd-looking line is strictly better
 * than a save that will not load.
 */
import { sanitize } from "../src/engine/state";
import { asList } from "../src/engine/coerce";
import { newSave } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. the exact payload from the crash report ──────────────────────────────── */
{
  const bad = [{ char_id: "char_greta", where: "the tannery yard" }];
  const out = asList(bad, 64);
  check("the object becomes a line", out.length === 1 && typeof out[0] === "string", out);
  check("and it keeps what it said", /char_greta/.test(out[0]) && /tannery yard/.test(out[0]), out[0]);
  check("every element is a string afterwards", out.every((x) => typeof x === "string"));
}

/* ── 2. a save already holding one must OPEN ─────────────────────────────────── */
{
  const s: any = newSave("regensburg", { name: "Rabi" } as any);
  s.history = [{
    turn: 17, kind: "turn", player_action: "I wait", narrator_prose: "The yard was empty.",
    summary: "waiting", time_label: "Day 3, 09:00", weather: "cold",
    offscreen: [{ char_id: "char_greta", where: "the tannery yard" }, "Elsewhere: the bell rang."],
    shifts: [{ char_id: "char_greta", where: "the tannery yard" }, "Greta is late."],
  }];
  const healed: any = sanitize(s);
  const h = healed.history[0];
  check("offscreen is all strings after a load", h.offscreen.every((x: unknown) => typeof x === "string"), h.offscreen);
  check("shifts too", h.shifts.every((x: unknown) => typeof x === "string"), h.shifts);
  check("the line that was already fine is untouched", h.offscreen.includes("Elsewhere: the bell rang."), h.offscreen);
  check("and the salvageable content survives rather than being dropped",
    h.offscreen.some((x: string) => /tannery yard/.test(x)), h.offscreen);
  check("the prose is left alone", h.narrator_prose === "The yard was empty.");
}

/* ── 3. and a clean save is not disturbed ────────────────────────────────────── */
{
  const s: any = newSave("clean", { name: "Rabi" } as any);
  s.history = [{
    turn: 1, kind: "turn", player_action: "I wait", narrator_prose: "Quiet.",
    summary: "s", time_label: "Day 1, 09:00", weather: "", offscreen: ["a"], shifts: ["b"],
  }];
  const out: any = sanitize(s);
  check("offscreen unchanged", JSON.stringify(out.history[0].offscreen) === '["a"]');
  check("shifts unchanged", JSON.stringify(out.history[0].shifts) === '["b"]');
  check("a history with no arrays at all does not throw", (() => {
    const s2: any = newSave("bare", { name: "R" } as any);
    s2.history = [{ turn: 1, kind: "turn", player_action: "", narrator_prose: "x", summary: "", time_label: "", weather: "" }];
    try { sanitize(s2); return true; } catch { return false; }
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
