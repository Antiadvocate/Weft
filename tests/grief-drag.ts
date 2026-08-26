/* "Miranda apparently does not give a shit about the fact that she just got divorced. Nothing in
 *  her characterization showed up in the prose."
 *
 * GRIEF NEEDED ONE BIG BLOW. relaxation drifts back toward capacity every turn, so a hit that is
 * not caught by grief_drag is erased within a few turns. The trigger was a single delta of -3 or
 * worse: it catches a betrayal in one scene and misses a marriage ending across forty turns of -2s.
 *
 * The save: a woman whose husband took his ring off, left it on the table, walked out with his
 * suitcases and demanded she sign — memories charged "furious grief" and "devastated and bitter",
 * mood string "furious and aching", active states "fixated on Vin" and "replaying it" — sitting at
 * relaxation -0.5 against a capacity of +2, with no grief_drag whatsoever. Everything the bookkeeper
 * recorded was right. The one number the narrator renders from said nothing had happened.
 *
 * (This file used to carry a second half, pinning that each character's stored register reached the
 *  narrator. Stored registers are gone — nobody has a voice of their own any more — and what
 *  replaced that half is tests/no-idiolect.ts, which pins that none of it comes back.)
 */
import { tickPsyche } from "../src/engine/social";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── a life that comes apart slowly ───────────────────────────────────────────── */
{
  // drag accumulation mirrors turn.ts: a hard blow at 0.6, sustained pressure at 0.15
  const hit = (p: any, d: number) => {
    if (d <= -3) p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + Math.abs(d) * 0.6);
    else if (d <= -1) p.grief_drag = Math.min(6, (p.grief_drag ?? 0) + Math.abs(d) * 0.15);
    p.relaxation = Math.max(-10, p.relaxation + d);
  };
  const fresh = () => ({ relaxation: 2, capacity: 2, recovery: 0.18, state: "intact", break_mode: null, consecutive_clenched: 0, mood: "", mood_valence: 0, active_states: [], open_run: 0 }) as any;

  // ONE BAD AFTERNOON LEAVES NOTHING. This is the case the low threshold must not over-serve.
  const mild = fresh();
  hit(mild, -1);
  tickPsyche(mild);
  check("a single small knock leaves no lasting drag", mild.grief_drag === undefined, mild.grief_drag);

  // A MARRIAGE ENDING ACROSS FORTY TURNS OF -2s. Before, every one of these was erased by drift.
  const slow = fresh();
  for (let i = 0; i < 12; i++) { hit(slow, -2); tickPsyche(slow); }
  check("sustained loss builds real drag", (slow.grief_drag ?? 0) > 1.5, slow.grief_drag);
  check("...so she does not sit at her easy resting point", slow.relaxation < 0, slow.relaxation);
  check("...which is what the narrator renders from", slow.mood_valence < 0, slow.mood_valence);

  // AND IT LIFTS. Grief is a drag on the resting point, not a new personality.
  for (let i = 0; i < 50; i++) tickPsyche(slow);
  check("it lifts once the pressure stops", slow.grief_drag === undefined, slow.grief_drag);
  check("...and she comes back to her own capacity", slow.relaxation > 1, slow.relaxation);

  // a single hard blow still works exactly as it did
  const blow = fresh();
  hit(blow, -5);
  tickPsyche(blow);
  check("one hard blow still lowers the resting point", (blow.grief_drag ?? 0) >= 2.5, blow.grief_drag);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
