/* Smoke test: TEN INTENTS AND SHE RECLINES IN ALL OF THEM.
 *
 * From a save. A woman present in twenty-four consecutive scenes, recorded as wanting to "Get Max
 * Mercer to hand over the rent money to her bank account and look at her body", blocked on "Max
 * Mercer is ignoring her and staring at his phone". Ten intents were authored for her across those
 * turns. The SURFACE of every one:
 *
 *     Sprawls back with one heel propped up on the nearest low surface…
 *     Sprawling back with an indolent stretch that puts her frame on display…
 *     Leaning back casually with her bare soles pressed against the unpacking crate…
 *     Stepping into his personal space to gesture vaguely toward a high cabinet…
 *     Sprawled deep into the cushions with her bare heels resting against the coffee table…
 *     Sprawling back with her bare soles pressed against the coffee table edge…
 *
 * and the TRUTH of every one is a sentence about what HE does — he stammers, he looks, he loses his
 * train of thought, he catches his breath, he drops the phone. Not one of the ten has her doing
 * anything. The player's report was that she makes no moves at all, and he is reading the record
 * correctly.
 *
 * THE CHARACTER IS NOT PASSIVE. THE GOAL IS. A want whose completion condition is another person's
 * action leaves its owner one move — present yourself and wait — and the intent pass is asked every
 * turn what this person is doing about their want.
 *
 * driveforge says this twice in prose: "No one else's word can be your goal" and "These hand the
 * person's life to someone else to run." It exports isDependentGoal to enforce it. That function
 * had ZERO CALLERS anywhere in src, and its regexes caught only the narrow answer-and-approval
 * cases — never "get X to do Y", which is the commonest shape there is.
 */
import { isDependentGoal } from "../src/engine/driveforge";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PLAYER = "Max Mercer";

/* ── 1. THE WANT FROM THE SAVE ───────────────────────────────────────────────── */
check("the goal that produced ten turns of reclining is rejected",
  isDependentGoal("Get Max Mercer to hand over the rent money to her bank account and look at her body", PLAYER));

/* ── 2. EVERY WAY OF SAYING "GET SOMEBODY TO DO SOMETHING" ───────────────────── */
for (const g of [
  "Make him admit what he wants",
  "Have her tell him the truth about the lease",
  "get him looking at her instead of the phone",
  "Force Max to choose between them",
  "persuade the landlord to drop the deposit",
  "talk Alina into keeping quiet about it",
  "convince him to stay another month",
  "pressure the super into fixing the unit",
]) check(`rejected: ${g}`, isDependentGoal(g, PLAYER), g);

/* ── 3. AND THE ONES THIS FUNCTION ALREADY CAUGHT, WHICH MUST STILL TRIP ─────── */
for (const g of [
  "Decide whether to accept the offer",
  "Get a clear answer from him about the lease",
  "Earn his trust before the month is out",
  "win her approval before the wedding",
  "gain their permission to use the yard",
  "Find peace and quiet in the new place",
]) check(`still rejected: ${g.slice(0, 44)}`, isDependentGoal(g, PLAYER), g);

/* The determiner group in APPROVE only ever held one determiner: `(his|her|their|the )?` puts the
 * space inside the group after `the`, so the alternatives are "his", "her", "their" and "the " and
 * only the last carries it. "earn his trust" needed "earn"+"his"+"trust" with no space and never
 * matched. Pre-existing, found while wiring the function up for the first time. */
check("a determiner other than 'the' works now", isDependentGoal("earn his trust", PLAYER));
check("...and so does the one that always did", isDependentGoal("earn the trust of the tenants", PLAYER));

/* ── 4. A WANT SHE CAN START ON A TUESDAY IS LEFT ALONE ───────────────────────
 *
 * This is the repair the prompt itself names: the goal is what SHE does. None of these needs
 * anybody's cooperation and every one of them can be stepped toward by the person who holds it. */
for (const g of [
  "Get the lease put in her own name before the renewal",
  "Move her things into the room he uses",
  "Say it to his face before Alina gets back",
  "Take the closing shift so she is home when he is",
  "Make the rent by Friday",
  "Make a scene at the tenants meeting",
  "Find out who has been in her nightstand",
  "Clear the basement of her sister's junk",
]) check(`kept: ${g.slice(0, 44)}`, !isDependentGoal(g, PLAYER), g);

/* ── 5. THE INFINITIVE HAS TO BE AN INFINITIVE ────────────────────────────────
 *
 * "make her own way TO the coast" is a preposition and her own errand. A determiner after `to`
 * means a destination; the screen requires a bare verb. */
for (const g of [
  "Make her own way to the coast before the frost",
  "Bring the box down to the basement",
  "Move into the room he uses",
  "Get the mare's leg right before the market",
  "Have the sluice rebuilt before the thaw",
]) check(`not a demand: ${g.slice(0, 40)}`, !isDependentGoal(g, PLAYER), g);

/* ── 6. NAMING THE PLAYER IS NOT ITSELF THE FAULT ─────────────────────────────
 *
 * The existing note says so: "walk to the monastery with him and see if it still stands" is her
 * errand and he is just along. It is only invalid when he is what is being waited on. */
for (const g of [
  "Walk to the monastery with Max and see if it still stands",
  "Split the rent with Max before the first",
]) check(`he can be in it: ${g.slice(0, 40)}`, !isDependentGoal(g, PLAYER), g);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
