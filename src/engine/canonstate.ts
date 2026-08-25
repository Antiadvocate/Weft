/**
 * CANON THAT THE STORY HAS OUTLIVED.
 *
 * Canon is the strongest block in the whole context. "CANON OVERRIDES YOUR DEFAULTS — this is the
 * deepest rule of rendering ... canon wins every time." That is correct for what canon is FOR: the
 * standing laws of a world, the things whose ordinary meanings have been redefined, the beings that
 * do not exist here.
 *
 * But the forge also writes canon lines that are not laws at all. They are snapshots — a sentence
 * about two named people, true on the day the world was made. One save opened with:
 *
 *     "Vin and Miranda have a strong, loving, and stable marriage that is the bedrock of their lives."
 *
 * and that line was still in the canon block, still carrying "canon wins every time", on turn 126 —
 * a hundred and twenty-six turns during which the marriage ended, the papers were served, the house
 * was sold, and the two of them last spoke on a porch in the rain. The engine had every fact needed
 * to know better: the edge ledger between them read trust -45, the divorce was in the thread list,
 * the chapter summaries said so in plain English. Nothing ever put those two things beside each
 * other. So the narrator was writing every turn against an instruction, at maximum authority, that
 * these people were fine — while the rest of its context said they were not. Prose written to
 * satisfy both reads as a couple who love each other refusing to look at each other, which is very
 * close to what came out.
 *
 * THE FIX IS NOT DELETION. A line that was true stays in the record; that is what canon is. It is
 * annotated as history, the way canonLine already annotates a fact too fresh to have travelled —
 * and, because this is recomputed from the ledger every turn rather than stored, it heals itself:
 * if these two find their way back, the line is simply current again.
 *
 * DELIBERATELY NARROW. It fires only on a line that (1) names two people in the cast, (2) asserts a
 * BOND between them in so many words, and (3) is contradicted by the ledger the engine keeps about
 * exactly that bond. A world rule never matches clause 1 or 2. A line asserting that two people
 * hate each other never matches clause 2, so a ledger full of loathing cannot retire it.
 */
import type { SaveState } from "./types";

/** Words that make a canon line a claim about a bond rather than a law of the world. */
const BOND = /\b(marriage|married|marry|wife|husband|spouse|lovers?|loving|love|romance|devoted|inseparable|friends?|friendship|partnership|partners|bond(?:ed)?|trusts?|loyal(?:ty)?|unbreakable|bedrock|allies|alliance)\b/i;

/** …and what stops it being a claim that the bond is GOOD. A canon line saying two people cannot
 *  stand each other names the same people and uses the same nouns; retiring it because the ledger
 *  agrees with it would be exactly backwards. Any negation in the sentence is enough to leave it
 *  alone — a forge line asserting a warm bond does not contain one, and the cost of a miss here is
 *  only that a stale line keeps standing, while the cost of a false positive is deleting a true
 *  law of the world out from under the narrator. */
const NEGATED = /\b(not|never|cannot|can't|cant|won't|isn't|aren't|no longer|without|ended|estranged|apart|broken|failing|former|ex-|hate[sd]?|loathe|resent)\b/i;

/** How far a bond has to have fallen before a line calling it strong is no longer describing it.
 *  Read off the save this was written from: the ledger there had run to trust -45. */
const BROKEN = -25;

export interface RetiredCanon {
  line: string;
  /** Plain-English reason, rendered to the narrator. */
  why: string;
}

/**
 * Canon lines the world's own bookkeeping now contradicts.
 *
 * Returns a map keyed by the lowercased canon line, so the renderer can look one up cheaply.
 */
export function outlivedCanon(state: SaveState): Map<string, string> {
  const out = new Map<string, string>();
  const canon = state.world?.canon ?? [];
  if (!canon.length) return out;

  // Cast members by the name a canon line would actually use. First names are how these lines are
  // written ("Vin and Miranda..."), and a bare first name is specific enough inside one small cast.
  const cast: { id: string; name: string; first: string }[] = [];
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    const name = String(c?.name ?? "").trim();
    if (!name) continue;
    cast.push({ id, name, first: name.split(/\s+/)[0] });
  }

  const edges = state.world?.edges ?? [];
  const between = (a: string, b: string) =>
    edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

  for (const line of canon) {
    if (!BOND.test(line) || NEGATED.test(line)) continue;
    const lower = ` ${line.toLowerCase()} `;
    const named = cast.filter((c) => c.first.length >= 3
      && new RegExp(`\\b${c.first.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
    if (named.length < 2) continue;

    // Check every pair the line names. One broken pair is enough — the line claimed they were all
    // fine together.
    let why = "";
    for (let i = 0; i < named.length && !why; i++) {
      for (let j = i + 1; j < named.length && !why; j++) {
        const a = named[i], b = named[j];
        const gone = [a, b].find((p) => {
          const st = state.characters[p.id]?.status;
          return st === "dead" || st === "departed";
        });
        if (gone) {
          const st = state.characters[gone.id]?.status;
          why = `${gone.name} is ${st === "dead" ? "dead" : "gone from this story"}`;
          break;
        }
        const pair = between(a.id, b.id);
        if (!pair.length) continue;
        const worstW = Math.min(...pair.map((e) => Number(e.warmth ?? 0)));
        const worstT = Math.min(...pair.map((e) => Number(e.trust ?? 0)));
        if (worstW <= BROKEN || worstT <= BROKEN) {
          why = `the ledger between ${a.name} and ${b.name} now reads warmth ${Math.round(worstW)}, trust ${Math.round(worstT)}`;
        }
      }
    }
    if (why) out.set(line.toLowerCase(), why);
  }
  return out;
}
