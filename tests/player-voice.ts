/* Smoke test: LINES THE PLAYER NEVER TYPED.
 *
 * Rainier Valley, turn 51: the player typed `"She can ask her" I get up and start heading home` and
 * the narration answered `"Just—going home," you say.` Turn 52 did it again. The bookkeeper then
 * filed both as things Rabi said. A quoted line attributed to "you" that the player didn't type is
 * now cut before the bookkeeper reads the prose, and quoted back next turn. */
import { scrubPlayerVoice, voicedFix } from "../src/engine/playervoice";
import { lint } from "../tools/promptlint";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const t51 = `You take your bag from the floor and push your chair back. The wheels roll over the carpet with a low hush.

The man two desks down looks up. "You're leaving? It's barely half two."

"Just—going home," you say. You don't bother with the rest of it.

Across the aisle, the woman in the navy blazer pulls her headset off.`;
const r = scrubPlayerVoice(t51, `"She can ask her" I get up and start heading home`, "do");
check("the invented line is cut", r.cut.length === 1 && !/Just—going home/.test(r.prose), r);
check("what's around it stays", /The man two desks down looks up\. "You're leaving\? It's barely half two\."/.test(r.prose) && /navy blazer/.test(r.prose) && /You don't bother with the rest of it\./.test(r.prose), r.prose);
check("the cut is reported with its sentence", r.cut[0]?.line === "Just—going home," && /you say\./.test(r.cut[0].sentence), r.cut);

const t52 = `The man stands up. "Hey, wait. Dana's going to—"\n\n"Dana can ask Ellie," you say, and sling your bag over your shoulder.\n\nNobody stops you this time.`;
const r52 = scrubPlayerVoice(t52, "I take the laptop and go home to work from home.", "do");
check("the attribution and the rest of its sentence go together", r52.cut.length === 1 && !/sling your bag/.test(r52.prose) && /Nobody stops you this time\./.test(r52.prose), r52.prose);

check("a line the player did type stays", scrubPlayerVoice(`"Let's go," you say, and pull out.`, `"Ok. Let's go." I drive her to work.`, "do").cut.length === 0);
check("another person's line stays", scrubPlayerVoice(`"Well?" she asks. "You going?"`, "I stand there", "do").cut.length === 0);
check("'You say nothing' after someone's question isn't a line", scrubPlayerVoice(`"Well?" You say nothing.`, "I wait", "do").cut.length === 0);
check("'you say nothing' lowercase isn't either", scrubPlayerVoice(`She waits. "Well?" you say nothing, and she sighs.`, "I wait", "do").cut.length === 0);
check("an attribution in front of the quote is caught too", scrubPlayerVoice(`You tell her, "I'm done with Beacon." She blinks.`, "I shrug", "do").cut.length === 1);
check("reported speech in the action lets the narrator write it out", scrubPlayerVoice(`"I'm going home," you tell her.`, "I tell her I'm leaving", "do").cut.length === 0);
check("the story channel is left alone", scrubPlayerVoice(`"Fine," you say.`, "Rabi gives in", "story").cut.length === 0);
check("a turn is never emptied", scrubPlayerVoice(`"Fine," you say.`, "I nod", "do").prose === `"Fine," you say.`);
check("no stranded quote marks", !/(^|\n)\s*"\s*$/m.test(r.prose));

const fix = voicedFix(r.cut[0]);
check("next turn is told, with the line", /NEVER TYPED: "Just—going home,"/.test(fix) && /leave the reply to the player/.test(fix), fix);
check("the correction passes the prompt linter", lint(fix).length === 0, lint(fix));
check("nothing to say, nothing said", voicedFix(null) === "");

const turn = readFileSync("src/engine/turn.ts", "utf8");
check("the turn scrubs before the bookkeeper and quotes it back", /scrubPlayerVoice\(prose, action, mode\)/.test(turn) && /voicedFix\(state\.last_voiced\)/.test(turn));
check("and counts it", /noteFire\(state, "player_voice"/.test(turn) && /player_voice:/.test(readFileSync("src/engine/integrity.ts", "utf8")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
