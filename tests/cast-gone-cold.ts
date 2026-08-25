/* "The genre of the story is romance. But every single person in it is a cunt."
 *
 * 63 turns. Genre "Love, erotica, romantic". A world bible whose own canon says the marriage is
 * strong, loving and stable. And a ledger holding:
 *
 *     Miranda (his wife)  warmth  -16   trust  -31
 *     Chloe   (best friend) warmth -86   trust -100
 *
 * The prose was correct at every step. At -86 dispositionCue tells the narrator "resents or hates
 * you — openly cold or antagonistic", so it wrote people who despise him. The player read a romance
 * in which everyone is cruel and could not see why, because the number that explains it never
 * appears on the page.
 *
 * TWO THINGS MADE IT, and the engine had measured both.
 *
 * ONE. The ledger is a ratchet. gainScale cuts a gain against a guarded person to a third — it
 * exists to stop "she softened over one conversation" — and there was no counterpart, so every loss
 * landed at full magnitude whatever the bond was worth. Sixty turns of small deductions with
 * nothing on the other side of the scale. Reproduced exactly: warmth 95 under a steady -3 a turn
 * reaches -85 in sixty turns, which is Chloe.
 *
 * A bond absorbs ordinary friction now, the way one does; a rupture is never softened, because
 * that is the size of thing that actually ends a relationship and the engine has a path for it.
 *
 * TWO. The chapter auditor caught the drift and wrote it down — "the story became an explicit
 * divorce/breakup procedural ... violating the explicit prohibition against breakup engines and
 * ignoring the romantic destination" — and the correction was one polite sentence, buried mid-
 * directive, asking for no lurch. It was right, it was recorded, and nothing changed.
 */
import { lossScale, castGoneCold, LOSS_FLOOR } from "../src/engine/social";
import { newSave, registerCharacter } from "../src/engine/state";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── 1. a bond absorbs ordinary friction ──────────────────────────────────────── */
{
  check("a strong bond takes an ordinary slight lightly", Math.abs(-6 * lossScale(95, -6)) < 2.5, -6 * lossScale(95, -6));
  check("a middling one takes more of it", Math.abs(-6 * lossScale(60, -6)) > Math.abs(-6 * lossScale(95, -6)));
  check("a stranger takes all of it", lossScale(0, -6) === 1);
  check("so does somebody already hostile", lossScale(-40, -6) === 1);
  check("the floor is honoured at the top of the range", Math.abs(lossScale(100, -6) - LOSS_FLOOR) < 1e-9, lossScale(100, -6));
  check("it never inverts a loss", [-1, -6, -14].every((d) => lossScale(90, d) > 0));

  // A RUPTURE IS NEVER SOFTENED. Betrayal still costs everything; a bad afternoon no longer costs
  // a marriage, and that is the whole distinction.
  check("a rupture lands in full against the strongest bond", lossScale(100, -15) === 1);
  check("...and beyond", lossScale(95, -40) === 1);
  check("just under the rupture line is still absorbed", lossScale(95, -14) < 1);
}

/* ── 2. the trajectory that produced the save ─────────────────────────────────── */
{
  let unscaled = 95, scaled = 95;
  for (let i = 0; i < 60; i++) { unscaled -= 3; scaled -= 3 * lossScale(scaled, -3); }
  check("sixty turns of -3 used to reach the number in the save", Math.round(unscaled) <= -80, unscaled);
  check("...and now leaves a bond that is strained, not poisoned", scaled > -25 && scaled < 40, scaled);
  check("sustained friction still costs real ground", scaled < 60, scaled);
}

/* ── 3. saying it out loud ────────────────────────────────────────────────────── */
{
  function cast(tone: string, warmths: number[]) {
    const s: any = newSave("t", { name: "Vin" } as any);
    s.world_bible.tone = tone;
    registerCharacter(s, { name: "Vin", character_id: "char_player" } as any);
    s.world.edges = [];
    warmths.forEach((w, i) => {
      const id = registerCharacter(s, { name: `NPC${i}`, age: 30, background: "b", core_traits: ["t"] } as any);
      s.world.edges.push({ from: id, to: "char_player", warmth: w, trust: w, power: 0 });
    });
    return s;
  }
  const bad = cast("Love, erotica, romantic", [-86, -16, 4]);
  const said = castGoneCold(bad);
  check("a romance whose cast has turned says so", !!said, said);
  check("...naming who and by how much", /NPC0 -86/.test(said ?? ""), said);
  check("...and the genre it is supposed to be", /"Love, erotica, romantic"/.test(said ?? ""));
  check("...and why it shows up as cruelty", /Warmth is what the narrator reads to decide how people treat you/.test(said ?? ""));
  check("...and where to fix it", /Cast panel/.test(said ?? ""));

  check("one cold friend is not a cast", castGoneCold(cast("Love, erotica, romantic", [-86, 40, 30])) === null);
  check("a warm cast is quiet", castGoneCold(cast("Love, erotica, romantic", [60, 40, 30])) === null);
  check("a horror story is allowed to be cold", castGoneCold(cast("Cosmic horror", [-86, -40, -30])) === null);
  check("...and so is a thriller", castGoneCold(cast("Political thriller", [-86, -40])) === null);
  check("an empty cast says nothing", castGoneCold(cast("Romance", [])) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
