/* "I RAN IT ON A HIGH END MODEL. IT STILL WRITES LIKE A FUCKING IDIOT. COMPLETELY UNNATURAL SPEECH
 *  ALMOST OFFENSIVELY SO."
 *
 * The player swapped the narrator model to rule the model out, replayed the opening, and sent six
 * turns of it. One speaker. Twenty-one lines. Every one a specification:
 *
 *   "It's eighty-nine degrees in here already."   "The cotton rounds are thirty-count…"
 *   "Eighty-nine inside."                          "Sixteen fluid ounces."
 *   "…the six-pack of fifteen-ounce sparkling      "With an eight percent markup…"
 *    waters in the crisper is already down to two." "…ninety-two dollars and seventy cents."
 *
 * MEASURED: 57% carry a quantity. 24% are commands. 76% share not one content word with what the
 * player had just said. And EVERY DETECTOR IN THE ENGINE RETURNED CLEAN — findMaxims 0, findClaudisms
 * 0, flagTics 0, last_leak/last_echo/last_maxim all null — because by every rule they hold, this is
 * correct writing. Nothing is aphoristic, interior, reprinted, or composed. She names a physical
 * object in the room in almost every sentence.
 *
 * WHICH THE ENGINE ASKED FOR. maxims.ts cured the aphorism with "EVERY LINE NAMES SOMETHING
 * PHYSICALLY PRESENT: a person, an object, a price, a door, a name, A NUMBER" — and that clause went
 * into FORGE_SYSTEM's example_lines requirement too. So the forge authored her to spec: her card's
 * own tics field reads "States exact dollar figures and packaging sizes down to the fluid ounce",
 * her rhythm "Deadpan metronome", her agenda "cataloging what Max owes her". voiceAnchor then handed
 * all of it back to the narrator at the end of every turn. The narrator obeyed perfectly.
 *
 * A NUMBER IS THE LAZIEST CONCRETE NOUN THERE IS: it satisfies "name something present" while
 * carrying nothing about who is speaking. The cure selected for it. Swapping models cannot touch
 * that, which is what the player's experiment proved.
 *
 * AND THE PLAYER TOLD HER SO, TWICE, in plain words inside his own action. She answered the first
 * with a defence of her own diction and the second with "Claude isn't on the lease, Max." maxims.ts
 * calls that its worst failure and has a whole correction for it — unreachable, because the branch
 * lives inside maximFix, which returns early unless findMaxims ALSO flagged the line as an aphorism.
 */
import { findSaturation, findApparatus, saturationFix, apparatusFix, saturationNote, bySpeaker } from "../src/engine/saturation";
import { findMaxims } from "../src/engine/maxims";
import { findClaudisms } from "../src/engine/claudisms";
import { flagTics } from "../src/engine/reviser";
import { FORGE_SYSTEM } from "../src/engine/prompts";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}
/* The save itself — all six turns and the actions that produced them. */
const F = JSON.parse(readFileSync("tests/fixtures/saturation.json", "utf8")) as {
  cast: string[]; player: string; era: string;
  abigail_voice: { diction: string; rhythm: string; tics: string[]; agenda: string };
  turns: { prose: string; action: string }[];
};
const CAST = F.cast, PLAYER = F.player;
const PROSE = F.turns.map((t) => t.prose).filter((x) => x.trim());
const sat = (i: number) => findSaturation(F.turns[i].prose, F.turns[i].action, CAST, PLAYER);

/* ── 1. the card the engine commissioned ─────────────────────────────────────── */
{
  // Not the narrator's invention. This is what the forge wrote down, and voiceAnchor handed it back
  // at the end of every turn — which is why changing the narrator model changed nothing.
  check("her card specifies a person who states quantities",
    /fluid ounce/i.test(F.abigail_voice.tics.join(" ")), F.abigail_voice.tics);
  check("...and a flat delivery", /deadpan|flat/i.test(F.abigail_voice.rhythm), F.abigail_voice.rhythm);
  check("...and an agenda made of cataloguing", /catalog/i.test(F.abigail_voice.agenda), F.abigail_voice.agenda);
}

/* ── 2. every existing detector passes all six turns ─────────────────────────── */
{
  check("findMaxims sees nothing in any of the six turns",
    PROSE.every((p) => findMaxims(p).length === 0), PROSE.map((p) => findMaxims(p).length));
  check("findClaudisms sees nothing either",
    F.turns.every((t) => findClaudisms(t.prose, t.action, CAST).length === 0),
    F.turns.map((t) => findClaudisms(t.prose, t.action, CAST).length));
  check("the reviser's tic corpus sees nothing",
    PROSE.every((p) => flagTics(p).length === 0), PROSE.map((p) => flagTics(p).length));

  // ...and this one fires.
  const fired = F.turns.map((_, i) => sat(i)).filter(Boolean);
  check("saturation fires on this save", fired.length >= 2, fired.map((h) => h && saturationNote(h)));
  check("every hit names the speaker whose card caused it",
    fired.every((h) => h!.who === "Abigail Mercer"), fired.map((h) => h!.who));
  check("the last turn is 75% quantities over four lines",
    sat(5)?.kind === "quantities" && sat(5)!.lines === 4 && Math.round(sat(5)!.share * 100) === 75,
    sat(5));
  // TWO OF SIX, AND THE TRADE IS WORTH RECORDING. Before the not-listening rule was tightened to
  // ignore lines under six words, four of these six turns fired — and the same rule was firing on
  // 18.5% of all 606 turns across thirteen saves, most of them people simply talking. Tightening it
  // to 7.3% cost two hits here, on turns where the offending lines were short. A guard that fires on
  // a fifth of all turns is not evidence of anything, so the two hits are the cheaper loss.
  check("...and the register hit, which needs no length gate, is the one that survives tightening",
    fired.every((h) => h!.kind === "quantities"), fired.map((h) => h!.kind));
}

/* ── 3. attribution ───────────────────────────────────────────────────────────── */
{
  const who = bySpeaker(F.turns[3].prose, CAST.filter((n) => n !== PLAYER));
  check("all of one turn's lines are credited to the one person who spoke",
    who.get("Abigail Mercer")?.length === 4 && who.size === 1, [...who]);
  check("the addressee is not mistaken for the speaker", !who.has("Max Mercer"), [...who.keys()]);

  // `she said` with nobody named is the commonest tag in this engine's prose.
  const untagged = `She looked at the table. "Eighty-nine inside," she said. "The compressor has been dead since Tuesday." Abigail did not blink. "The cotton rounds are thirty-count."`;
  check("an untagged line resolves to the only person in the scene",
    bySpeaker(untagged, ["Abigail Mercer"]).get("Abigail Mercer")?.length === 3,
    [...bySpeaker(untagged, ["Abigail Mercer"])]);

  // THE ENGINE'S OWN MARKER IS FULL OF QUOTED SPANS WITH CAST NAMES BESIDE THEM. Unstripped, the
  // save's first turn credited six lines of "dialogue" to a man who had not spoken — three of them
  // containing a number — and reported him saturated.
  const marked = F.turns[0].prose;
  check("the <<<SCENE>>> marker really is in the committed prose", marked.includes("<<<SCENE"));
  const m = bySpeaker(marked, CAST.filter((n) => n !== PLAYER));
  check("...and none of its attribute values is counted as a line",
    (m.get("Abigail Mercer")?.length ?? 0) === 2, [...m]);
  check("...so the man who said nothing is not reported as saturated",
    findSaturation(marked, F.turns[0].action, CAST, PLAYER) === null,
    findSaturation(marked, F.turns[0].action, CAST, PLAYER));
}

/* ── 4. the three faults, and the ratios that gate them ───────────────────────── */
{
  const spk = (lines: string[]) => `Abigail set the bottle down. ` + lines.map((l) => `"${l}" she said.`).join(" ");

  const quant = spk(["Sixteen fluid ounces of it.", "Eight percent markup on the bodega price.", "Ninety-two dollars and seventy cents, by five.", "The rent is due Friday."]);
  const h1 = findSaturation(quant, "I put the kettle on and wait for her to finish", ["Abigail Mercer"], PLAYER);
  check("a turn of nothing but quantities fires", h1?.kind === "quantities", h1);
  check("...and the note is legible to a person", /spoke in quantities for \d+% of 4 lines/.test(saturationNote(h1!)), saturationNote(h1!));

  const orders = spk(["Get the acetone off the stand.", "Hold my ankle.", "Keep your knee locked.", "Pay it by five."]);
  check("a turn of nothing but orders fires", findSaturation(orders, "I sit back down at the laptop and keep typing", ["Abigail Mercer"], PLAYER)?.kind === "orders",
    findSaturation(orders, "I sit back down at the laptop and keep typing", ["Abigail Mercer"], PLAYER));

  // Two lines is not a distribution.
  check("two lines is never enough to be a distribution",
    findSaturation(spk(["Sixteen fluid ounces.", "Eight percent markup."]), "I hand it over", ["Abigail Mercer"], PLAYER) === null);

  // A register that is a flavour rather than the whole voice.
  const mixed = spk(["Sixteen fluid ounces, and it cost too much.", "The fan's been rattling since you propped it there.", "Your sister called about the thing on Sunday and I said I'd ask you.", "I hate this weather."]);
  check("a register used once among four lines is left alone",
    findSaturation(mixed, "I hand her the bottle and sit back down", ["Abigail Mercer"], PLAYER)?.kind !== "quantities",
    findSaturation(mixed, "I hand her the bottle and sit back down", ["Abigail Mercer"], PLAYER));
}

/* ── 5. NOT LISTENING, and the false positive that had it at 18.5% of every turn ─ */
{
  const deaf = `Abigail did not look up. "The compressor in the window unit has been dead since Tuesday." She flexed her toes. "The cotton rounds are thirty-count, right next to the remotes." She shrugged. "Chloe clocks in at the copy shop at nine." She turned the bottle over. "The cap on that one is already loose."`;
  const h = findSaturation(deaf, "I ask her whether she has heard anything back about the tanning salon shifts", ["Abigail Mercer"], PLAYER);
  check("a speaker who engages nothing said to them fires", h?.kind === "not listening", h);

  // Reply tokens carry no shared content word and are pure response. Counting them as failures to
  // listen put this guard on 18.5% of all 606 turns across thirteen saves — that is conversation.
  const reacting = `She looked up. "Okay." She put the mug down. "Good. You should've eaten hours ago." She sat. "Yeah." He waited. "You started without me."`;
  check("short reactions are replies, not failures to listen",
    findSaturation(reacting, "I tell her I already had breakfast at six", ["Abigail Mercer"], PLAYER)?.kind !== "not listening",
    findSaturation(reacting, "I tell her I already had breakfast at six", ["Abigail Mercer"], PLAYER));

  // And it must not fire when there was nothing to engage.
  check("nothing to engage means nothing to report",
    findSaturation(deaf, "", ["Abigail Mercer"], PLAYER)?.kind !== "not listening",
    findSaturation(deaf, "", ["Abigail Mercer"], PLAYER));
}

/* ── 6. THE MACHINE IN SOMEBODY'S MOUTH ──────────────────────────────────────── */
{
  const claude = `She did not blink. "Claude isn't on the lease, Max," she said.`;
  check("a character naming Claude is caught", findApparatus(claude)?.kind === "named the machine", findApparatus(claude));
  check("...as is a character naming the narrator",
    findApparatus(`He shrugged. "The narrator hates me, I think," he said.`)?.kind === "named the machine");
  const defend = `She tossed the sleeve onto the table. "Because if I just say cotton, you stand by the TV for five minutes staring at the dust," she said.`;
  check("a character defending their own diction is caught",
    findApparatus(defend)?.kind === "defended how they talk", findApparatus(defend));
  check("...as is one told to talk normally who argues about it",
    findApparatus(`"I'm not a robot, Rabi," she said. "This is how I talk."`)?.kind === "defended how they talk");

  // A world that genuinely contains machines is not breaking anything.
  check("a science-fiction setting may name an AI",
    findApparatus(`"The ship's AI logged it," she said.`, "far future orbital station, artificial intelligence") === null,
    findApparatus(`"The ship's AI logged it," she said.`, "far future orbital station, artificial intelligence"));

  // MEASURED AND CUT, both from the corpus — the correction this emits is the loudest note in the
  // whole directive and orders the narrator to pretend the last turn did not happen.
  check("«this story» is an ordinary phrase and is left alone",
    findApparatus(`"You cannot keep asking me to say it again like this story starts over every morning," she said.`) === null,
    findApparatus(`"You cannot keep asking me to say it again like this story starts over every morning," she said.`));
  check("«like a person» is an ordinary phrase and is left alone",
    findApparatus(`"I don't want you to feel like a person I'm being polite to," she said.`) === null,
    findApparatus(`"I don't want you to feel like a person I'm being polite to," she said.`));
}

/* ── 7. the corrections ───────────────────────────────────────────────────────── */
{
  check("no note when nothing fired", saturationFix(null) === "" && apparatusFix(null) === "");
  const d = saturationFix({ who: "Abigail Mercer", kind: "quantities", share: 1, lines: 4, line: "Sixteen fluid ounces." });
  check("it gives the measured count as evidence", /100% of the 4 things they said/.test(d), d.slice(0, 160));
  check("it quotes a real line", d.includes("Sixteen fluid ounces."));
  check("it says why a number is the wrong kind of concrete", /LAZIEST CONCRETE DETAIL/.test(d));
  // It sends the narrator back to the card, and says how to read it — rather than telling it the
  // card is misleading, which promptlint rejects as an epigram and which teaches the epigram.
  check("it sends the narrator back to the speaker's own card", /GO AND READ THIS SPEAKER'S OWN CARD/.test(d));
  check("...and says to read it as where the words come from, not as a test each line must pass",
    /WHERE THIS PERSON'S WORDS COME FROM/.test(d) && /Do not read them as a test/.test(d));
  check("it caps the register at one line rather than banning it", /AT MOST ONE LINE ON THAT REGISTER/i.test(d));
  check("it asks for one line that delivers nothing", /CARRIES NO INFORMATION AT ALL/.test(d));

  const nl = saturationFix({ who: "Abigail Mercer", kind: "not listening", share: 1, lines: 4, line: "The cap's already loose." });
  check("the not-listening note asks for a reaction to the actual words", /REACTS TO THE ACTUAL WORDS/.test(nl));

  const a = apparatusFix({ line: "Claude isn't on the lease, Max.", kind: "named the machine" });
  check("the apparatus note quotes the line", a.includes("Claude isn't on the lease, Max."));
  check("...and says a complaint is answered by the writing changing, not by a character",
    /answered BY THE WRITING CHANGING/.test(a));
  const a2 = apparatusFix({ line: "This is how I talk.", kind: "defended how they talk" });
  check("the defence note says the player is not wrong", /the player is not wrong/.test(a2));
}

/* ── 8. the causes, fixed at the source ──────────────────────────────────────── */
{
  // THE FORGE. Its example_lines requirement is where "a number" did the real damage, because it
  // shaped the CARD, and the card is authored once and read every turn thereafter.
  check("the forge no longer demands a number in every sample line",
    !/COULD POINT AT OR HAS HANDLED — a person, an object, a price, a place, a job, a debt, a number/.test(FORGE_SYSTEM),
    FORGE_SYSTEM.match(/COULD POINT AT OR HAS HANDLED[^"]{0,80}/)?.[0]);
  check("...and caps quantities across the samples", /AT MOST ONE of the lines may contain a number/.test(FORGE_SYSTEM));
  check("...and requires one sample that does not answer the question",
    /must be a line that does not answer the question it was asked/.test(FORGE_SYSTEM));
  check("the forge must now write people who say too much",
    /AT LEAST HALF THIS CAST MUST BE PEOPLE WHO SAY TOO MUCH/.test(FORGE_SYSTEM));
  check("...and may not make everybody deadpan",
    /Do not give more than one person in this world a flat or deadpan delivery/.test(FORGE_SYSTEM));

  // MAXIMS.TS, the cure that overdosed, and voiceAnchor's cap, which was advice.
  const M = readFileSync("src/engine/maxims.ts", "utf8");
  check("maximFix no longer asks for a price and a number", /AND CONCRETE DOES NOT MEAN MEASURED/.test(M));
  check("voiceAnchor's cap is now a count, not a caution", /at most ONE line may run on their register/.test(M));
  check("...and it asks for one line that advances nothing", /At least one line this turn does not advance anything/.test(M));

  // WIRING.
  const T = readFileSync("src/engine/turn.ts", "utf8");
  check("saturation runs on the committed prose", /state\.last_saturation = findSaturation\(prose, action, cast/.test(T));
  check("...excluding the player, who is not the narrator's to correct", /char_player\?\.name \?\? ""\)/.test(T));
  check("the apparatus check is not gated behind anything", /state\.last_apparatus = findApparatus\(prose/.test(T));
  check("both corrections reach the per-turn directive",
    /apparatusFix\(state\.last_apparatus\)/.test(T) && /saturationFix\(state\.last_saturation\)/.test(T));
  check("the apparatus note comes FIRST, before every other dialogue note",
    T.indexOf("apparatusFix(state.last_apparatus)") < T.indexOf("maximFix(state.last_maxim)"));
  check("both count toward the integrity aggregate",
    /noteFire\(state, "register"/.test(T) && /noteFire\(state, "apparatus"/.test(T));
  const I = readFileSync("src/engine/integrity.ts", "utf8");
  check("the ledger can name both kinds", /register: "one speaker/.test(I) && /apparatus: "the machine named/.test(I));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
