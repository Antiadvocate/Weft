/* "ALL THE CHARACTERS ARE OBNOXIOUS AND DIRECT AND MAXIMALLY EFFICIENT."
 *
 * A player, on a cast of five: "It seems like being shy. Or being confident. Or being all these
 * personality types is not arising within the emergent behavior of the game."
 *
 * The narrator is not at fault. Nothing ever told it.
 *
 *   · `gregariousness` is written by the Forge, the sketch pass, the bookkeeper and the presets,
 *     and READ in exactly one place in the engine — social.ts, for offscreen bond drift. It reaches
 *     the narrator nowhere. The one number that could mean shy has never been at the point of
 *     writing.
 *   · `attachment.style` is rendered in four places and every one is a STRESS reading: under_threat
 *     at relaxation ≤ −3, the clenched branch at ≤ −7, soothed_by at ≥ +4. Between −3 and +4, where
 *     the ordinary turns of an ordinary scene sit, nothing is said about how a person is with
 *     people. Disposition existed only as a stress response.
 *
 * And the schema handed the model the answer: `"gregariousness":0.5`, `"conscience":0.7`,
 * `"capacity":2` were literal VALUES in the JSON shape while every field around them carried a
 * description. A character sketched in play came out at exactly 0.5 with conscience and attachment
 * unset — the median of everything, which is the default voice.
 */
import { readBearing, bearingNote, RECEDES_AT, FILLS_AT, DEFERS_AT, TAKES_AT } from "../src/engine/bearing";
import type { Identity, Psyche, SaveState } from "../src/engine/types";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const who = (o: Partial<Identity>, p: Partial<Psyche> = {}) =>
  readBearing({ name: "X", character_id: "x", ...o } as Identity, { capacity_born: 2, ...p } as Psyche);

/* ── 1. the axes ─────────────────────────────────────────────────────────────── */
{
  check("a low social appetite recedes", who({ gregariousness: 0.25 }).room === "recedes");
  check("a high one fills the room", who({ gregariousness: 0.85 }).room === "fills");
  check("the middle is the middle", who({ gregariousness: 0.5 }).room === "even");
  check("...and the middle is wide on purpose",
    who({ gregariousness: RECEDES_AT + 0.05 }).room === "even" && who({ gregariousness: FILLS_AT - 0.05 }).room === "even");

  check("avoidant goes around it", who({ attachment: { style: "avoidant" } } as Partial<Identity>).approach === "around");
  check("anxious goes at it", who({ attachment: { style: "anxious" } } as Partial<Identity>).approach === "at");
  check("secure says it once", who({ attachment: { style: "secure" } } as Partial<Identity>).approach === "straight");
  check("disorganized does both", who({ attachment: { style: "disorganized" } } as Partial<Identity>).approach === "both");
  check("an unset style is not an insecure one", who({}).approach === "straight");

  check("a high conscience defers", who({ conscience: DEFERS_AT + 0.05 }).claim === "defers");
  check("a low one takes", who({ conscience: TAKES_AT - 0.05 }).claim === "takes");

  check("a low resting point is braced as a climate", who({}, { capacity_born: -3 }).climate === "braced");
  check("a high one is easy", who({}, { capacity_born: 4 }).climate === "easy");
  // CLIMATE, NOT WEATHER: this turn's relaxation must not reach it at all.
  check("today's relaxation does not change who they are",
    who({ gregariousness: 0.2 }, { capacity_born: 2, relaxation: -9 } as Partial<Psyche>).climate === "middling",
    who({ gregariousness: 0.2 }, { capacity_born: 2, relaxation: -9 } as Partial<Psyche>));
  check("...and the born resting point outranks a remodelled one",
    who({}, { capacity_born: 2, capacity: -5 } as Partial<Psyche>).climate === "middling");
}

/* ── 2. shy is not quiet ─────────────────────────────────────────────────────── */
{
  check("small appetite + a big sense of what is owed = shy",
    who({ gregariousness: 0.25, conscience: 0.85 }).shy);
  check("small appetite + going at closeness sideways = shy",
    who({ gregariousness: 0.25, attachment: { style: "anxious" } } as Partial<Identity>).shy);
  check("small appetite + braced as a resting state = shy",
    who({ gregariousness: 0.25 }, { capacity_born: -3 }).shy);
  // ...and somebody who simply likes their own company is not shy, they are content
  check("a low appetite alone is not shyness",
    !who({ gregariousness: 0.25, conscience: 0.5, attachment: { style: "secure" } } as Partial<Identity>).shy);
  check("and a big appetite never is", !who({ gregariousness: 0.9, conscience: 0.9 }).shy);
}

/* ── 3. the note speaks only for people who are not the default ──────────────── */
{
  const s = {
    characters: {
      char_player: { character_id: "char_player", name: "Max" },
      a: { character_id: "a", name: "Ada", pronouns: "she/her", gregariousness: 0.2, conscience: 0.85, attachment: { style: "anxious" } },
      b: { character_id: "b", name: "Bo", pronouns: "he/him", gregariousness: 0.5, conscience: 0.6, attachment: { style: "secure" } },
    },
    condition: { a: { psyche: { capacity_born: 2 } }, b: { psyche: { capacity_born: 2 } } },
  } as unknown as SaveState;

  const note = bearingNote(s, ["char_player", "a", "b"]);
  check("the one who is off-centre gets a line", note.includes("Ada"), note);
  // the shy reading is emitted as an OPERATION, not as a definition of shyness — an instruction
  // shaped like an epigram teaches that shape (tools/promptlint.ts enforces it)
  check("...and the shy reading says what she does, not what shyness is",
    /waits to be asked rather than starting/.test(note) && !/what SHY looks like/.test(note), note);
  check("...in her own pronouns", /she waits to be asked/.test(note) && /She wants to be there/.test(note), note);
  check("the median person gets nothing", !note.includes("Bo"), note);
  check("the player is never given a bearing", !note.includes("Max"), note);
  check("it says out loud that this is not the weather", /climate, not this minute/.test(note), note);
  check("and the permission half is there", /Nobody in this scene has to be efficient/.test(note), note);
  check("...naming the failure it exists to stop", /written by the same person/.test(note), note);

  // a room of nothing but median people costs nothing
  const flat = { ...s, characters: { ...s.characters, a: { ...(s.characters as any).b, character_id: "a", name: "Ada" } } } as SaveState;
  check("a room of default people produces no block at all", bearingNote(flat, ["a", "b"]) === "");
}

/* ── 4. the real cast, which is why this exists ──────────────────────────────── */
{
  const FIX = JSON.parse(readFileSync("tests/fixtures/background-person.json", "utf8")) as SaveState;
  const abi = readBearing(FIX.characters["char_mtl12i1gbbk30"], FIX.condition["char_mtl12i1gbbk30"]?.psyche);
  check("Abigail reads as somebody who takes and goes around it",
    abi.claim === "takes" && abi.approach === "around", abi);
  // Emily was sketched in play: gregariousness 0.5, conscience and attachment unset — the median of
  // everything, which is exactly the default voice the player was complaining about.
  const em = readBearing(FIX.characters["char_mtp7snm7n5meg"], FIX.condition["char_mtp7snm7n5meg"]?.psyche);
  check("a character sketched in play has no disposition at all", em.unremarkable, em);
}

/* ── 5. and the schema no longer hands the model the answer ──────────────────── */
{
  for (const f of ["sketch.ts", "prompts.ts"]) {
    const src = readFileSync(join("src/engine", f), "utf8");
    check(`${f}: gregariousness is described, not defaulted`, !/"gregariousness"\s*:\s*0?\.\d/.test(src),
      (/"gregariousness"\s*:\s*[^,]{0,20}/.exec(src) ?? [])[0]);
    check(`${f}: conscience is described, not defaulted`, !/"conscience"\s*:\s*0?\.\d/.test(src),
      (/"conscience"\s*:\s*[^,]{0,20}/.exec(src) ?? [])[0]);
  }
  const shape = readFileSync("src/engine/sketch.ts", "utf8");
  check("...and the description says the spread is the point", /SPREAD IS THE POINT/.test(shape));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
