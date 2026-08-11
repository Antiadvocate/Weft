/* Smoke test: THE OUTPUT BUDGET THAT WAS EATING THE CLOCK.
 *
 * "Recording changes takes literally 4-7 minutes right now. A single turn takes roughly 7-10."
 *
 * Measured over a 107-turn save, from the duration the engine already records per turn:
 *
 *     median 55s · mean 100s · p90 189s · max 914s
 *
 * That is not a slow model, it is a bimodal one. Splitting by whether the bookkeeper filled its
 * output budget explains the whole split:
 *
 *     hit the 3000-token cap:  15 turns, avg 201s
 *     under it:                92 turns, avg  84s
 *
 * Fifteen turns — an eighth of the game — burned fifty of its 179 minutes. Two causes, both here.
 *
 * The budget was too small for a rich turn's diff. And when a diff arrives truncated, the recovery
 * path asked a model to "re-emit this as valid JSON" — which is right for output that is complete
 * but malformed, and useless for output that ran out of room. Truncated content is MISSING: the
 * round trip returns the same missing content, correctly formatted, and the turn still records
 * nothing, having paid for another full call against a 13k-token context. Every one of the slowest
 * turns on that save was this exact path. */
import { repairJson, safeJson } from "../src/llm";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* a diff cut off three-quarters of the way through, the way a filled budget cuts one */
const CUT = `{"scene_summary":"She set the plate down and asked about the doorbell.","elapsed_minutes":5,
"memories":[{"char_id":"char_jess","content":"Rabi told her the doorbell had been going since dawn."},
{"char_id":"char_jess","content":"He asked whether she had slept, and she lied about it."}],
"edges":[{"from":"char_jess","to":"char_player","warmth_delta":3,"trust_delta":1}],
"facts":[{"char_id":"char_jess","field":"mood","value":"steadier than she`;

{
  // safeJson ALREADY repairs a truncated object — which is the load-bearing fact here, and the one
  // that overturns the obvious fix. The expensive "re-emit this as valid JSON" recovery path never
  // fires on a capped diff, so the slow turns are not a recovery path: they are simply three
  // thousand output tokens being decoded. Raising the budget would have made them slower.
  const raw = safeJson<any>(CUT, null);
  check("a truncated diff is salvaged in place, with no second call", !!raw, raw);
  check("so the expensive repair round trip never fires for this case", !!raw?.scene_summary);
}
{
  const salvaged = safeJson<any>(repairJson(CUT), null);
  check("but it can be salvaged without another call", !!salvaged, salvaged);
  check("the scene summary survives", /doorbell/.test(salvaged?.scene_summary ?? ""), salvaged?.scene_summary);
  check("the elapsed time survives, so the clock still moves", salvaged?.elapsed_minutes === 5, salvaged?.elapsed_minutes);
  check("both completed memories survive", (salvaged?.memories ?? []).length === 2, salvaged?.memories?.length);
  check("so does the edge shift", (salvaged?.edges ?? [])[0]?.warmth_delta === 3, salvaged?.edges);
  // THE RECORD STRADDLING THE CUT IS DROPPED, NOT KEPT HALF-WRITTEN.
  //
  // The salvage used to close the open string and hand the half-sentence on as a finished value,
  // and nothing downstream could tell, because syntactically it was perfect. A save carried four of
  // these as characters' actual wants — "…the hollowed stone footings behind the Subura lud",
  // "…the day's events with Rabi and the stranger have kept her aw", "Seize and drain three barrels
  // of illicit lamp-oil stashed in the cellar beneath the Subura cook", "Force the grain dealer's
  // carter to take back the spoiled, insect-e" — on cards, in the narrator's digest every turn, and
  // in the world-motion feed the player reads. A missing field means "no change", which is true. A
  // truncated field is a lie with no tell.
  const straddling = (salvaged?.facts ?? []).find((f: any) => typeof f?.value === "string" && /steadier than she$/.test(f.value));
  check("the half-written record is not kept", !straddling, salvaged?.facts);
  check("and nothing else invented a value for it", (salvaged?.facts ?? []).every((f: any) => f?.value === undefined || /\S/.test(f.value)), salvaged?.facts);
}
{
  // the whole point: what was recorded is most of what the turn contained
  const salvaged = safeJson<any>(repairJson(CUT), null);
  const keys = Object.keys(salvaged ?? {});
  check("enough keys survive to be worth applying", keys.length >= 4, keys);
  check("it is not just the two mandatory fields", keys.some((k) => k === "memories" || k === "edges"), keys);
}
{
  // genuinely malformed (not truncated) output still needs the model round trip — this salvage
  // must not quietly swallow that case by returning something empty and plausible
  const garbage = "I'm sorry, I can't produce that.";
  check("prose that is not a diff at all salvages to nothing", !safeJson<any>(repairJson(garbage), null));
}
{
  const fenced = "```json\n{\"scene_summary\":\"ok\",\"elapsed_minutes\":2}\n```";
  const v = safeJson<any>(repairJson(fenced), null);
  check("a fenced but complete diff still parses", v?.scene_summary === "ok", v);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
