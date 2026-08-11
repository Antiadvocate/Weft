/* Smoke test: A BAKER WHOSE RECORDED LIFE IS OTHER PEOPLE'S ERRANDS.
 *
 * `life_history` is the accreted answer to who somebody IS, and it is printed on their card and read
 * to the narrator every turn. From a save at turn 31, this was the whole of Sabina's:
 *
 *   "The stranger asked Marcus about buying slaves, and Sabina felt a cold weight settle — she does
 *    not trust that kind of interest near her shop. Tigellinus sends a boy down toward the Subura
 *    with a folded note for the freedman who bought the Sosii dealing-house's back-room papers: an
 *    offer to clear the man's debt to a cobbler off the Argiletum Before the market crowd thickens,
 *    Marcus catches the landlord's man crossing the corner and puts a free cup in front of him..."
 *
 * Two thirds of it is other people's afternoons. The identical text was also sitting in Tigellinus's
 * record — his own life history was one of his errands and one of Marcus's. And the two run together
 * mid-sentence, "…off the Argiletum Before the market crowd thickens…", because they were joined on
 * a bare space.
 *
 * consolidateBackground filtered on importance alone. The offstage pass files witness memories at
 * importance 7, as the raw event text, verbatim, in the third person about whoever acted — so every
 * errand a character merely heard about was folded in as a defining moment of their own life. A
 * character built from that cannot be played as anyone, which is what the player reported.
 *
 * The memory itself stays where it belongs: she heard it, she can act on it. It is simply not part
 * of who she is.
 */
import { consolidateBackground } from "../src/engine/social";
import { inferPronouns } from "../src/engine/coerce";
import type { CharMemory, Identity, EpisodicMemory } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function mem(entries: Partial<EpisodicMemory>[]): CharMemory {
  return {
    character_id: "char_sabina", core: [], beliefs: [], facts: [], knows: [],
    episodic: entries.map((e, i) => ({
      turn: i + 1, content: "", importance: 7, emotional_charge: "", last_accessed_turn: i + 1, ...e,
    })) as EpisodicMemory[],
  };
}

/* the three memories Sabina actually carried */
const HERS = "The stranger asked Marcus about buying slaves, and Sabina felt a cold weight settle — she does not trust that kind of interest near her shop.";
const HIS = "Tigellinus sends a boy down toward the Subura with a folded note for the freedman who bought the Sosii dealing-house's back-room papers";
const HIS2 = "Before the market crowd thickens, Marcus catches the landlord's man crossing the corner and puts a free cup in front of him";

/* ── 1. the save, reproduced ──────────────────────────────────────────────────── */
{
  const ident = { name: "Sabina", background: "Born a slave in a bakery in Pompeii." } as Identity;
  const m = mem([
    { content: HERS, source: "witnessed", importance: 6, emotional_charge: "cold weight" },
    { content: HIS, source: "offstage", importance: 7 },
    { content: HIS2, source: "offstage", importance: 7 },
  ]);
  consolidateBackground(ident, m);
  const lh = ident.life_history ?? "";
  check("what she lived is kept", lh.includes("felt a cold weight settle"), lh);
  check("what Tigellinus did is not her life", !lh.includes("Tigellinus sends a boy"), lh);
  check("nor is Marcus's errand", !lh.includes("catches the landlord's man"), lh);
  check("and the two never run together mid-sentence", !/Argiletum Before|him Before/.test(lh), lh);
}

/* ── 2. the offstage memory is not deleted — she still heard it ───────────────── */
{
  const ident = { name: "Sabina" } as Identity;
  const m = mem([{ content: HIS, source: "offstage", importance: 7 }]);
  consolidateBackground(ident, m);
  check("nothing is folded from an offstage-only bank", !ident.life_history, ident.life_history);
  check("but the memory is still there to act on", m.episodic.length === 1);
  check("and it is not marked folded, so it stays a live memory", !m.episodic[0].folded);
}

/* ── 3. moments are separated by a stop ───────────────────────────────────────── */
{
  const ident = { name: "Marcella" } as Identity;
  const m = mem([
    { content: "Rabi healed the scars on her back", source: "witnessed", importance: 8 },
    { content: "He told her the house was hers", source: "witnessed", importance: 8 },
  ]);
  consolidateBackground(ident, m);
  const lh = ident.life_history ?? "";
  check("both moments are kept", /healed the scars/.test(lh) && /house was hers/.test(lh), lh);
  check("with a stop between them", /scars on her back\.\s+He told her/.test(lh), lh);
  check("and one that already ended in a stop is not double-stopped", !/\.\./.test(lh), lh);
}

/* ── 4. ordinary accretion is unchanged ───────────────────────────────────────── */
{
  const ident = { name: "Lucilla" } as Identity;
  const m = mem([
    { content: "She corrected a consul's Greek at dinner and was not asked back.", source: "witnessed", importance: 8 },
    { content: "She counted the sparrows.", source: "witnessed", importance: 2 },
  ]);
  consolidateBackground(ident, m);
  check("a defining moment still accretes", (ident.life_history ?? "").includes("corrected a consul"), ident.life_history);
  check("trivia still does not", !(ident.life_history ?? "").includes("sparrows"), ident.life_history);
  check("what was folded is marked, so it folds once", m.episodic[0].folded === true && !m.episodic[1].folded);
}

/* ── 5. AND NOBODY GOES WITHOUT A PRONOUN SET ─────────────────────────────────────
 *
 * The same save reached turn 31 with every NPC carrying `pronouns: undefined`, while their own
 * backgrounds read "the daughter of a freedman farmer", "leaving her a widow", "a Campanian
 * farmer's son". The forge is asked for a set and the schema says gender must never be ambiguous;
 * models leave it off anyway, and nothing backfilled it — so the roster every record-writing pass
 * reads printed no gender for anybody, and it guessed. */
{
  const cases: [string, string | undefined][] = [
    // verbatim from the save, where this character carried no pronoun set at turn 31
    ["From a provincial town in Latium, the daughter of a freedman farmer who lost his land to debt. Sold into slavery six months ago, brought to Rome and resold at the Forum market. Learned that safety comes from watching and saying little. She has fully mastered the logistics of the villa and now operates with a cold, possessive confidence, viewing her body and its products as the primary currency of her security.", "she/her"],
    ["A Campanian farmer's son who enlisted at seventeen. He came up the hard way, twenty years in the legions, and he keeps a Dacian dagger he took at Tapae. His wine shop is near the Porta Capena.", "he/him"],
    ["Born a slave in a senator's household, educated as a secretary because he had the memory for it, freed at thirty. He keeps white mice in his rooms and talks to them in Greek. His clients are in the Senate.", "he/him"],
  ];
  for (const [blob, want] of cases) check(`inferred ${want} from the record`, inferPronouns(blob) === want, inferPronouns(blob));

  // ...and it declines rather than guessing
  check("no evidence, no verdict", inferPronouns("A person who works here.") === undefined);
  // THE FLOOR IS WHAT MAKES THIS SAFE. A woman described through the men around her —
  // "her father lost his land, and his brother took it" — leans masculine on a raw count, and two
  // mentions is not enough to overrule a name and a role. Three is.
  check("two mentions is not enough to decide anybody's gender",
    inferPronouns("The daughter of a farmer who lost his land, and his brother took what was left.") === undefined,
    inferPronouns("The daughter of a farmer who lost his land, and his brother took what was left."));
  check("empty is undefined", inferPronouns("") === undefined);
  check("a record that leans both ways is left unset",
    inferPronouns("He said she said, and he told her, and she told him, and then he left and she stayed.") === undefined,
    inferPronouns("He said she said, and he told her, and she told him, and then he left and she stayed."));
  check("a they/them record is read as they/them",
    inferPronouns("They keep the ledger themselves. Their hands are ink-stained and they will not let anybody else near their books, because they were cheated once.") === "they/them");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
