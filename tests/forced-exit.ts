/** THE GUARD THAT HELD A WOMAN IN A ROOM SHE HAD BEEN DEADBOLTED OUT OF.
 *
 *  All prose below is verbatim from a433538a-The_City_of_Ashford.weaver_19.json, a 114-turn
 *  playthrough. The engine's departure-evidence guard fired five times across three turns:
 *
 *    turn 104  player: "Eventually the cops show up and arrest Chloe for harassment as other
 *                       neighbors call. Chloe goes to prison for 5 years."
 *              shifts: ['bookkeeping correction: Chloe stays — the prose never showed them leave',
 *                       ...,
 *                       'Chloe wants something new: Survive the five years in prison and hold onto
 *                        the hope that Vin meant what he said..']
 *
 *    turn 111  player: "I DONT GIVE A FUCK ABOUT LEO GET THE FUCK OUT OF MY HOUSE" I push her out
 *                       of the house and I call the cops. I lock the door.
 *              shifts: two more of the same correction
 *
 *    turn 113  shifts: two more
 *
 *  The state that came out the other end has Chloe serving a five-year sentence and standing in
 *  Vin's living room, in `world.present`, in the house's `contains`, while an empty Prison place
 *  sits in the world. The player's report: "Chloe has escaped prison and no one sees this as a
 *  problem? What's happening?"
 *
 *  Turn 113's two firings were CORRECT and must stay correct: the player said "please fuck off",
 *  the bookkeeper moved Amber out, and the prose answered "Amber didn't move... I'm not going
 *  anywhere." A narrator is allowed to have someone refuse an order.
 */
import { departureEvidence, releaseEvidence, maskQuotes, nameProbes } from "../src/engine/exit";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SAVE
// ─────────────────────────────────────────────────────────────────────────────

const T104 = `The knock came again, and then the sound of the front door opening—not because Vin opened it, but because the officer on the porch had turned the handle and found it unlocked. The voice carried through the house: "Sir? Ma'am? Anyone home?"

Chloe's answer was shrill. "He's in there. He's in the bedroom. He's got a girl with him. I've been out here for an hour and he won't—"

They read her rights in the front room. The words came through the bedroom door in pieces, official and unhurried. Chloe's voice rose over them once, then stopped.

Amber walked to the bedroom door and opened it a few inches. Through the gap, the front room came into view: Chloe standing near the couch with her hands behind her back, the older officer fitting cuffs over her wrists, the younger one writing something on a small pad. Chloe's hands were shaking. Her jaw was tight, her chin lifted, and when the officer turned her toward the door she looked at the hallway—at the bedroom door, at the slice of it where Amber stood—and said, flat and cold, "Fine. I hope you're happy now."

Amber shut the door.

A single car door opened and shut, out on the curb, and then nothing.`;

const T104_ACTION = `Eventually the cops show up and arrest Chloe for harassment as other neighbors call. Chloe goes to prison for 5 years.`;

const T111 = `Vin's hand was already on Chloe's shoulder, turning her, walking her backward through the open door. The shove was one clean motion. Chloe's heel caught the threshold and she stumbled out onto the porch, catching herself against the rail. The door slammed. The deadbolt turned.

Through the wood, the click of the lock sounded loud. Then the porch boards creaked once, twice, as she shifted her weight.

Amber stood a step inside the front room. Her hand came up flat against the door as if she'd meant to catch it before it closed. She stood there, her palm against the grain, her thumbnail working at the side of her mouth.

From outside, Chloe's voice came through the door, thin and clear. "They're not going to come, Vin. It's a civil thing. They don't send cars for that."

The mist was still settling on the porch. Chloe stood with her arms crossed, chin up, watching the closed door as if waiting for it to open again. Her fingers found the ring on her hand and twisted it once, hard. She walked to her car, shoes wet on the walk, and unlocked it. The key slipped in her hand. She tried again.

Amber hadn't moved. Her bare feet were planted on the floor. "You didn't have to do that," she said. Her voice was low, aimed at the door more than at him. "She was already leaving."`;

const T111_ACTION = `"I DONT GIVE A FUCK ABOUT LEO GET THE FUCK OUT OF MY HOUSE" I push her out of the house and I call the cops. I lock the door.`;

const T113 = `Amber didn't move. The dish stayed where she'd pushed it, foil peeled back, steam thinning into the kitchen air. Her hands hung at her sides, and she looked at Vin the way she'd been looking at him since the door slammed — steady, waiting.

"Okay." She said it quiet, like she was agreeing to something smaller than what he'd just said. Then she crossed the kitchen, bare feet silent, and stopped in front of him. She reached up and set both hands flat on his chest, not pushing, just leaving them there. Her palms were warm through his shirt.

"I'm not going anywhere." Her voice dropped. "I told you that already. You don't have to keep testing it."

Behind her, through the front window, the porch was empty. The mist had thickened against the glass. The deadbolt was still thrown.`;

const T113_ACTION = `"yes dear god please fuck off."`;

const T112 = `Amber's jaw set. She did not move from the door.

"You didn't call the cops," she said. Her voice came out flat, the words spaced.

She crossed the room to the counter, bare feet soft on the floor, and pulled the foil back from the dish she'd set down. Steam lifted.

"She got arrested because a neighbor called. Not you." Amber turned, the foil still in her hand, and looked at him. "And she didn't escape. They released her. You don't get sentenced to five years and walk out the same day unless the charge didn't stick."`;

const T112_ACTION = `"Amber. Are you fucking serious? She sat outside my house harassing me for half the day literally to tell me one thing about Leo. Went to prison for harassment then escaped prison literally she was sentenced to FIVE YEARS IN PRISON. And then came to my house walked INTO the house and then you are going to tell ME I shouldn't have called the cops?? Holy fucking shit Amber. Get the fuck out"`;

console.log("\n── the five wrong firings ──");

const t104 = departureEvidence({ prose: T104, action: T104_ACTION, name: "Chloe", others: ["Amber Reyes"], destination: "Prison" });
check("t104: Chloe cuffed and driven off is allowed to leave the room", t104.ok, JSON.stringify(t104));

const t111 = departureEvidence({ prose: T111, action: T111_ACTION, name: "Chloe", others: ["Amber Reyes"], destination: "elsewhere" });
check("t111: Chloe shoved out and deadbolted out is allowed to leave the room", t111.ok, JSON.stringify(t111));

console.log("\n── the two RIGHT firings, which must not regress ──");

const t113 = departureEvidence({ prose: T113, action: T113_ACTION, name: "Amber Reyes", others: ["Chloe"], destination: "elsewhere" });
check("t113: Amber refusing to go is still held in the room", !t113.ok, JSON.stringify(t113));

const t112 = departureEvidence({ prose: T112, action: T112_ACTION, name: "Amber Reyes", others: ["Chloe"], destination: "elsewhere" });
check("t112: an eviction shouted in dialogue does not move anyone", !t112.ok, JSON.stringify(t112));

console.log("\n── the bug the guard was built for ──");

const roomEmptied = `Mara leaned on the bar and turned her glass in a slow circle. "You came back," she said. "I didn't think you would." Toby laughed at that, and the sound carried. The fire popped.`;
check("the ledger cannot empty a room it never emptied (Mara)",
  !departureEvidence({ prose: roomEmptied, action: "I sit down at the bar", name: "Mara", others: ["Toby"], destination: "elsewhere" }).ok);
check("the ledger cannot empty a room it never emptied (Toby)",
  !departureEvidence({ prose: roomEmptied, action: "I sit down at the bar", name: "Toby", others: ["Mara"], destination: "elsewhere" }).ok);
check("no name, no evidence",
  !departureEvidence({ prose: roomEmptied, action: "I sit down", name: "", others: ["Mara", "Toby"], destination: "elsewhere" }).ok);

console.log("\n── the original voluntary list still works ──");
for (const line of [
  "Hale left without another word.",
  "Sana slipped out through the side door.",
  "Corin was called away by a runner.",
  "Bel withdrew to the far end of the hall.",
  "Ivy stepped out onto the fire escape and did not come back.",
]) {
  const who = line.split(" ")[0];
  check(`voluntary: ${line.slice(0, 34)}…`, departureEvidence({ prose: line, name: who }).ok);
}
for (const line of [
  "Nadia drove off before he reached the kerb.",
  "Owen turned and went.",
  "Priya walked away down the length of the platform.",
  "Rafe fled the moment the door opened.",
]) {
  const who = line.split(" ")[0];
  check(`voluntary (new): ${line.slice(0, 34)}…`, departureEvidence({ prose: line, name: who }).ok);
}

console.log("\n── force ──");
for (const line of [
  "Two of them hauled Ferris out through the front door.",
  "Security marched Dax outside without a word.",
  "Ines was escorted out by the older of the two.",
  "He shoved Kell out onto the pavement.",
  "They dragged Nym into the street and left him there.",
  "Vasa stumbled out onto the landing, catching herself on the rail.",
]) {
  const who = line.match(/\b(Ferris|Dax|Ines|Kell|Nym|Vasa)\b/)![1];
  check(`force: ${line.slice(0, 40)}…`, departureEvidence({ prose: line, name: who }).ok, line);
}

console.log("\n── custody ──");
for (const line of [
  "Two officers arrested Juno on the steps of the courthouse.",
  "They took Sable into custody at eleven.",
  "Rhen was handcuffed and put in the back of the cruiser.",
  "The medics loaded Tam into the ambulance.",
  "Wex was sentenced that afternoon and taken away.",
  "They led Orla away down the corridor.",
  "The orderlies wheeled Pell out and the doors swung shut.",
]) {
  const who = line.match(/\b(Juno|Sable|Rhen|Tam|Wex|Orla|Pell)\b/)![1];
  check(`custody: ${line.slice(0, 40)}…`, departureEvidence({ prose: line, name: who }).ok, line);
}

console.log("\n── the traps ──");

check("a dish being pushed is not an eviction",
  !departureEvidence({ prose: "Amber didn't move. The dish stayed where she'd pushed it, foil peeled back.", name: "Amber" }).ok);
check("an arrest recalled in dialogue is not an arrest happening",
  !departureEvidence({ prose: `Amber crossed to the counter. "You got arrested," she said. "You sat in a cell, and you came straight back."`, name: "Amber" }).ok);
check("someone ELSE being arrested does not remove the witness",
  !departureEvidence({ prose: "Chloe was handcuffed on the steps. Amber watched the whole thing from the bedroom window.", name: "Amber", others: ["Chloe"] }).ok);
check("...and the person actually arrested still goes",
  departureEvidence({ prose: "Chloe was handcuffed on the steps. Amber watched the whole thing from the bedroom window.", name: "Chloe", others: ["Amber"] }).ok);
check("a name inside the matched span owns it, whoever is doing the shoving",
  departureEvidence({ prose: "Chloe shoved Kell out onto the pavement and shut the door.", name: "Kell", others: ["Chloe"] }).ok);
check("...and the one doing the shoving stays",
  !departureEvidence({ prose: "Chloe shoved Kell out onto the pavement and shut the door.", name: "Chloe", others: ["Kell"] }).ok);
check("a shouted order alone moves nobody",
  !departureEvidence({ prose: "Bern set down the cup and looked at him.", action: `"get out of my house"`, name: "Bern" }).ok);
check("the same order, acted on, does move them",
  departureEvidence({ prose: "Bern set down the cup and looked at him.", action: `"get out" I throw Bern out of the house.`, name: "Bern" }).ok);
check("an unnamed player eviction needs the prose to show a removal",
  !departureEvidence({ prose: "Bern set down the cup and looked at him.", action: "I push her out and lock the door.", name: "Bern" }).ok);
check("an unnamed player eviction with a removal in the prose goes through",
  departureEvidence({ prose: "He shoved her out onto the porch and shut the door. Bern was still holding the cup.", action: "I push her out and lock the door.", name: "Bern" }).ok);
check("the prose saying they stayed beats the player's act",
  !departureEvidence({ prose: "He shoved her out onto the porch. Bern didn't move.", action: "I throw Bern out of the house.", name: "Bern" }).ok);

console.log("\n── the destination named in the turn ──");
check("prison in the player's own words grounds a move to Prison",
  departureEvidence({ prose: "The officers were quiet about it.", action: "Chloe goes to prison for 5 years.", name: "Chloe", others: ["Amber Reyes"], destination: "Prison" }).ok);
check("moving people to `elsewhere` is never grounded by naming it",
  !departureEvidence({ prose: "Elsewhere, the city went on.", action: "I wait", name: "Mara", others: ["Toby"], destination: "elsewhere" }).ok);
check("a destination shorter than four characters is not evidence",
  !departureEvidence({ prose: "Mara set down the cup. The bar was quiet.", action: "I wait", name: "Mara", destination: "bar" }).ok);
check("the prose naming where they went grounds it",
  departureEvidence({ prose: "Mara said she was needed at the Chandlery before dark.", action: "I nod", name: "Mara", destination: "The Chandlery" }).ok);

console.log("\n── the bookkeeper's quoted departure still counts, dialogue or not ──");
check("a quoted line the prose really contains is evidence",
  departureEvidence({ prose: `"I'm going," she said, and the door closed behind her.`, said: "I'm going", name: "Mara" }).ok);
check("a quoted line the prose does NOT contain is not evidence",
  !departureEvidence({ prose: "Mara turned her glass in a slow circle.", said: "I have to go now", name: "Mara" }).ok);
check("a quote too short to mean anything is not evidence",
  !departureEvidence({ prose: "Mara turned her glass in a slow circle.", said: "go", name: "Mara" }).ok);

console.log("\n── helpers ──");
check("maskQuotes preserves length", maskQuotes(`he said "hello there" and went`).length === `he said "hello there" and went`.length);
check("maskQuotes blanks the dialogue", !/hello/.test(maskQuotes(`he said "hello there" and went`)));
check("maskQuotes keeps the narration", /and went/.test(maskQuotes(`he said "hello there" and went`)));
check("maskQuotes handles curly quotes", !/hello/.test(maskQuotes(`he said “hello there” and went`)));
check("nameProbes drops honorifics", !nameProbes("Dr. Miranda Hale").includes("doctor"));
check("nameProbes keeps the surname", nameProbes("Dr. Miranda Hale").includes("hale"));
check("nameProbes keeps the full name", nameProbes("Amber Reyes").includes("amber reyes"));
check("nameProbes drops short fragments", !nameProbes("Jo Vance").includes("jo"));

console.log("\n── custody is a state, not a moment ──");

check("t104 is reported as custody, so the world can keep holding it",
  departureEvidence({ prose: T104, action: T104_ACTION, name: "Chloe", others: ["Amber Reyes"], destination: "Prison" }).why === "custody");
check("t111 is an ejection, not custody — being thrown off a porch holds nobody",
  departureEvidence({ prose: T111, action: T111_ACTION, name: "Chloe", others: ["Amber Reyes"], destination: "elsewhere" }).why !== "custody");
check("walking out is neither",
  departureEvidence({ prose: "Hale left without another word.", name: "Hale" }).why === "left");

console.log("\n── and something has to be able to give them back ──");
for (const line of [
  "Chloe was released on Tuesday with nothing but the folder.",
  "They let Chloe go at four in the morning.",
  "Chloe walked free when the charges were dropped.",
  "Chloe was out on bail by the weekend.",
  "Chloe escaped some time in the night.",
  "Chloe was discharged and sent home.",
  "Chloe was paroled after eighteen months.",
]) check(`release: ${line.slice(0, 42)}…`, releaseEvidence({ prose: line, name: "Chloe" }), line);

check("the player posting bail frees them",
  releaseEvidence({ prose: "The clerk stamped the form.", action: "I post bail for Chloe and drive her home.", name: "Chloe" }));
check("SAYING she got out does not get her out",
  !releaseEvidence({ prose: `Amber set down the dish. "She didn't escape. They released her."`, name: "Chloe", others: ["Amber"] }));
check("somebody ELSE being released does not free her",
  !releaseEvidence({ prose: "Leo was released at four. Chloe stayed where she was.", name: "Chloe", others: ["Leo"] }));
check("an ordinary scene frees nobody",
  !releaseEvidence({ prose: "Amber poured the tea and set both cups on the counter.", action: "I drink my tea", name: "Chloe", others: ["Amber"] }));

console.log("\n── idioms that are not evictions ──");
for (const [line, who] of [
  ["As it turned out, Mara had known the whole time.", "Mara"],
  ["Mara carried out the plan without saying a word about it.", "Mara"],
  ["Mara booked a table for eight and put her phone away.", "Mara"],
  ["Mara locked up the shop and put the key in her coat.", "Mara"],
] as [string, string][]) {
  const e = departureEvidence({ prose: line, name: who });
  check(`idiom: ${line.slice(0, 40)}…`, !e.ok || e.why !== "custody", `${line} → ${JSON.stringify(e)}`);
}
check("`turned out` does not eject anyone", !departureEvidence({ prose: "As it turned out, Mara had known the whole time.", name: "Mara" }).ok);
check("`carried out the plan` does not eject anyone", !departureEvidence({ prose: "Mara carried out the plan without saying a word about it.", name: "Mara" }).ok);
check("`booked a table` is not custody", !departureEvidence({ prose: "Mara booked a table for eight.", name: "Mara" }).ok);
check("`locked up the shop` is not custody", departureEvidence({ prose: "Mara locked up the shop and put the key in her coat.", name: "Mara" }).why !== "custody");
check("carrying a PERSON out still counts",
  departureEvidence({ prose: "Two of them carried Mara out through the side door.", name: "Mara" }).ok);
check("`taken away` moves them but does not hold them",
  departureEvidence({ prose: "The dish was set down and Mara was taken away by the older one.", name: "Mara" }).why !== "custody");

check("parole is a release, never a holding",
  departureEvidence({ prose: "Wex was paroled after eighteen months and went home.", name: "Wex" }).why !== "custody");
check("escaping prison is a release the world can see",
  releaseEvidence({ prose: "Chloe escaped some time before dawn.", name: "Chloe" }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
