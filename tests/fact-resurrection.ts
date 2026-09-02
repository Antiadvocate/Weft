/* SHE WAS NOT BEING INVENTED. SHE WAS BEING READ OUT OF THE RECORD.
 *
 * "Mara exists. Again. And again. Even without a location. You should figure out why the narrator is
 *  inventing her."
 *
 * It wasn't. Turn 87, Mara thirty turns dead and correct in every ledger — status dead, offscene,
 * not present, name retired, dropped from the cast card, struck from the place populations. And the
 * witness standing in every scene carried this, filed by the bookkeeper from the narrator's own
 * prose and sourced "witnessed":
 *
 *     "Mara is whole again and standing at the ridge line, cradling her arm the way she did before."
 *
 * That is a fact-ledger entry. It is printed to the narrator as KNOWS (verified facts). It never
 * decays. So every turn the narrator was told, as verified truth, that a dead woman was standing at
 * the ridge line — and wrote her there, and the bookkeeper filed that, and the next turn said it
 * again. Turn 82 she approaches, 83 she arrives and speaks, 84 the player destroys her, 86 "Mara,
 * whole again, cradling her arm the way she had before, watching the house."
 *
 * `gone` — the map of who is dead or departed — was already threaded the whole way down into
 * compactMemoryDigest, and was spent on BELIEFS alone. Beliefs are the softer half: a thing somebody
 * holds. The fact ledger is the hard half, and it had no idea anybody had died.
 *
 * AND A SECOND GENERATOR, INDEPENDENT OF THE FIRST. Still pending at turn 87:
 *
 *     "Rabi must give a yes or no to Mara by Friday for Sunday's chicken dinner."
 *
 * The pressure controller reads pending consequences FIRST, before cooldowns and before grace.
 * Thirty turns of the engine holding an appointment open with a corpse, every one of them a reason
 * to bring her into a scene.
 */
import { compactMemoryDigest, beliefLine } from "../src/engine/memory";
import { goneMap } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
const F = JSON.parse(readFileSync("tests/fixtures/fact-resurrection.json", "utf8"));
const SRC = readFileSync("src/engine/turn.ts", "utf8");
const gone = goneMap({ characters: F.characters } as unknown as SaveState);

/* ── 1. the record was telling it she was there ──────────────────────────────── */
{
  const ridge = (F.felicity_memory.facts ?? []).find((f: any) => /whole again and standing at the ridge/.test(f.content));
  check("the witness carried it as a fact", !!ridge, (F.felicity_memory.facts ?? []).map((f: any) => f.content?.slice(0, 50)));
  check("...sourced as something she watched happen", ridge?.source === "witnessed", ridge);
  check("...and never superseded", !ridge?.superseded_by);
  check("Mara is dead in the ledger the whole time",
    (Object.values(F.characters).find((c: any) => c.name === "Mara") as any).status === "dead");
  check("AND SHE IS IN THE NEXT TURN'S PROSE", /\bMara, whole again\b/.test(F.mara_prose), F.mara_prose.slice(0, 90));
}

/* ── 2. the fact ledger now knows who is dead ────────────────────────────────── */
{
  const mem = JSON.parse(JSON.stringify(F.felicity_memory));
  const withGone = compactMemoryDigest(mem, "Mara ridge line standing", 87, 2, "Day 3", 0, gone);
  const without = compactMemoryDigest(mem, "Mara ridge line standing", 87, 2, "Day 3", 0, new Map());
  const knows = (d: string) => d.split("\n").find((l) => l.startsWith("KNOWS")) ?? "";

  check("without the gone map, a fact about her reads as current",
    /\bMara\b/.test(knows(without)) && !/is dead/.test(knows(without)), knows(without).slice(0, 200));
  check("with it, every fact naming her is marked", (() => {
    const line = knows(withGone);
    const clauses = line.replace(/^KNOWS \(verified facts\): /, "").split(" | ").filter((c) => /\bMara\b/.test(c));
    return clauses.length > 0 && clauses.every((c) => /Mara is dead/.test(c));
  })(), knows(withGone).slice(0, 300));
  check("...with the same wording beliefs already get",
    /held ABOUT the past, not a live read of the present/.test(knows(withGone)));
  check("a fact naming nobody gone carries no annotation", (() => {
    const clauses = knows(withGone).replace(/^KNOWS \(verified facts\): /, "").split(" | ");
    const clean = clauses.filter((c) => !/\bMara\b|\bDrea\b|\bKing\b|\bPriya\b|\bDev\b|\bHamed\b/.test(c));
    return clean.length > 0 && clean.every((c) => !/held ABOUT the past/.test(c));
  })(), knows(withGone).slice(0, 400));

  // The renderer this reuses, checked directly in both directions.
  check("beliefLine marks a gone name", /Mara is dead/.test(beliefLine("Mara is at the door", gone)));
  check("...and leaves the living alone", beliefLine("Emily is at the door", gone) === "Emily is at the door");
}

/* ── 3. death now closes what the world was holding open ─────────────────────── */
{
  const pending = (F.consequences ?? []).filter((c: any) => c.status === "pending");
  const dinner = pending.find((c: any) => /yes or no to Mara/.test(c.description ?? ""));
  check("the save really was still holding a dinner RSVP for her", !!dinner, pending.map((c: any) => c.description?.slice(0, 60)));

  check("an exit now cancels consequences that name them", /q\.status = "cancelled"/.test(SRC));
  check("...and retires promises either side of them", /pr\.status = "retired"/.test(SRC));
  check("...and says so to the player", /the world was still holding open for them/.test(SRC));
  check("...and supersedes facts that place them somewhere", /this is no longer where \$\{pronounsOf\(c\.pronouns\)\.subj\} is/.test(SRC));
  check("...only presence claims, never their history", /ONLY presence claims/.test(SRC));
  check("the presence vocabulary covers the actual sentence",
    /whole again/.test(SRC) && /standing/.test(SRC) && /ridge/.test(F.felicity_memory.facts.find((f: any) => /ridge/.test(f.content)).content));
}

/* ── 4. and none of it silences grief ────────────────────────────────────────── */
{
  check("remembering somebody dead still renders",
    beliefLine("I watched Rabi open Mara's arm like a purse", gone).startsWith("I watched Rabi open Mara's arm"));
  check("...it is annotated, not deleted", /Mara is dead/.test(beliefLine("I watched Rabi open Mara's arm like a purse", gone)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
