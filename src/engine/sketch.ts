/**
 * SKETCH COMPLETION — finishing the people the story starts.
 *
 * A character can enter three ways that are not the Forge: the narrator declares them in the scene
 * footer, the player names someone who does not exist yet, or someone speaks in the prose with no
 * record. All three create a stub and mark it `provisional: true`, and the comments at those sites
 * say the simulator "already treats [it] as a sketch to complete" and that a "hollow-character
 * floor already backfills" it.
 *
 * Neither existed. `registerCharacter` silently dropped the `provisional` field, nothing in any
 * prompt ever mentioned it, and no pass ever filled a stub in. So a player who wrote
 *
 *     "I make myself another woman. Mable. She's more beautiful than Andrea. She's loving.
 *      She cares for me. She's interesting. Charming."
 *
 * and then read four paragraphs describing her — taller by an inch, dark hair in loose waves,
 * grey-green eyes, bare feet on the grass — ended up with a record holding a name, an age of 30,
 * an empty appearance, empty core_traits, empty values, and an "INCOMPLETE RECORD" background.
 * A voice card got forged for her, because voice forging is wired up. Nothing else was. She was,
 * as the player put it, a person who does not exist.
 *
 * This is the missing pass. It has excellent material to work from and neither of the two other
 * systems was using it: the player's own words creating them, and the prose that rendered them.
 */
import type { Identity, SaveState } from "./types";
import { isPersonName } from "./turn";
import { buildMessages, complete, safeJson } from "../llm";
import { asList, asText, unfilmableTraits } from "./coerce";
import { screenCard, rewriteNote } from "./aphorism";
import { TRAIT_CONTRACT } from "./prompts";
import { registerCharacter } from "./state";
import { clipText } from "./text";


/** THE CHARACTER RECORD, DEFINED ONCE. Two passes produce a full person — completing somebody the
 *  story introduced without writing them down, and building somebody the player asked for by
 *  name. They must agree on every field or the two halves of the cast are shaped differently,
 *  so the schema lives here and both compose it. */
export const RECORD_FIELDS = `{
"age": 30,
"pronouns": "the pronouns the prose used for them, or this world's default",
"appearance_facts": "A complete description of the body they actually have: hair colour and texture, eye colour, skin, their face or one distinctive feature, build, how old they look, and one unique identifying mark. Copy every physical detail the prose gave exactly, and invent the rest to match. Only permanent physical features go here, never clothing.",
"height_cm": 170,
"weight_kg": 65,
"background": "Who they are apart from the scene they came into, in three or four plain sentences. A good test is whether a stranger could have four different conversations with them. Say where they're from and what that place was like, who raised them or who they've lost, the work or knowledge they actually have (named specifically), one experience that shaped them and has nothing to do with the player or the story, and one ordinary strong opinion about something small. If the player created them outright, say so plainly and say what they were made to be, and then give them a full personality anyway, so they can talk about something besides the person who made them.",
"core_traits": ["2-4 traits, each written the way the TRAIT CONTRACT below the schema describes: something this person does that a camera could catch. Adjectives get sent back to be rewritten"],
"values": ["2-3 things they actually care about"],
"speech_pattern": "how they talk: how formal or casual they are, the rhythm of their speech, and what they refuse to say",
"texture": ["2-4 lasting interests and enthusiasms they bring up without being asked when a scene gives them room. At least two should have nothing to do with their work, their status or the player. One physical habit is allowed among them, but no more than one."],
"skills": {"3-5 entries, where the key is the skill and the value is how good they are at it and how they learned it. A person's skills are the subjects they can actually talk about at length": ""},
"beauty": 50,
"conscience": "0 to 1: how much other people's needs matter to them compared with their own. Vary it. Low is someone who takes what they want without thinking about the other person, and high is someone who checks whether it's all right and apologises when there's no need",
"attracted_to": "women / men / anyone / no one. This is permanent, and the engine treats it as absolute, so never use no one for somebody who is only unavailable right now, and don't qualify it with a mood",
"taste": "ONE STRING: what their upbringing and experience make them find attractive",
"gregariousness": "0 to 1, and vary it a lot across the cast. It's how much space this person takes up in company. Below 0.35 is someone who waits for a gap in the conversation rather than making one, and above 0.7 is someone who fills a silence without noticing. If everyone is near 0.5 they'll all behave alike, and this number is the only place the game records who is shy and who is outgoing",
"attachment_style": "secure / anxious / avoidant / disorganized. Most people are secure, so only choose an insecure style when this person’s history actually produced one",
"under_threat": "one plain sentence about what they do when they're scared or hurt, and it has to be something the people in the room can see. Going still, going quiet, going flat, sticking to procedure and lowering their voice are one way people react, and this step uses them far too often. In one save, five people created here all reacted to fear by getting quieter, which made the story read like a horror film. Most people under threat get louder and more insistent: they push, follow the other person into the next room, repeat themselves, raise their voice, demand an answer right now, or say something they'll regret. Match the attachment style above, so anxious people chase, escalate and protest, avoidant people go flat and pull away, and secure people stay engaged and keep talking the way they were a minute ago. Vary it across the cast, so after someone who withdraws, write someone who pushes.",
"when_that_fails": "one plain sentence about what they do when that first reaction clearly isn't working, because the other person isn't backing down or is walking out the door. Some people do the same thing harder and louder, which is a fine answer, because some people are stubborn. Others drop it straight away and try something completely different: the one who went cold turns warm, the one who was shouting goes quiet and reasonable, the one who was making demands starts apologising. Say which kind they are, and if they switch, say what they switch to. A manipulative person switches approach as soon as the first one fails.",
"soothed_by": "one plain sentence about what actually calms them down",
"drive_goals": ["2-3 different things they want at the same time: something they're after right now, a deeper hope or fear, and an attachment or a grudge. Never only the player."]
}`;

export const SKETCH_SYSTEM = `You fill in a character record for someone who has already appeared in a story but was never properly written down.

You're given their name, the player's action that brought them in (if there was one), the prose they appeared in, and the world they belong to. Everything in those sources is true and has to be kept. If the prose says her eyes are grey-green and her feet are bare, the record says grey-green eyes. If the player said she is more beautiful than some named character, she is strikingly beautiful. You're filling in what was left blank around facts that are already established, and you never overwrite or contradict them.

Where the sources say nothing, invent details, concretely and in keeping with the world, the way the character creator would. Don't leave the record vague, and don't describe their role in the plot ("mysterious newcomer", "the player's creation"). Write a person.

Don't clean anything up. Record this person as explicitly as the story itself is written. If the story is dark, explicit or sexual, the record is too. If the player made this person to want them, that's who they are, so write it plainly without toning it down.

Reply with only this JSON:
${RECORD_FIELDS}

${TRAIT_CONTRACT}`;


/** A record that is a name and little else. Checked on the fields the story actually reads. */
export function isSketch(c: Identity | undefined): boolean {
  if (!c || c.character_id === "char_player") return false;
  if (c.status === "dead" || c.status === "departed") return false;
  // A PHANTOM IS NOT A SKETCH. This pass exists to finish the record of a real person who entered
  // from prose, and it was finishing the record of parse debris instead — with the worst possible
  // consequence, because writing them a background DESTROYS the "INCOMPLETE RECORD" marker that
  // pruneParseArtifacts uses to recognise an auto-registered stub. One save's cast held She, Wife,
  // Dinner, Cost and Everlasting; four of them had been given careful backstories ("Born to the
  // pidgin-speaking coastal traders…", "A laundress of Thornwood, born poor…") and were therefore
  // permanently unprunable. Only Cost, which the pass had not reached yet, could still be repaired.
  // If the name is not a person's name, there is nothing here to complete.
  if (!isPersonName(c.name ?? "")) return false;
  const blankAppearance = !asText(c.appearance_facts, " ").trim();
  const blankTraits = asList(c.core_traits).length === 0;
  const stubBackground = /^INCOMPLETE RECORD\b/.test(asText(c.background, " "));
  return c.provisional === true || stubBackground || (blankAppearance && blankTraits);
}

/** Everyone currently carrying a hollow record. */
export function pendingSketches(state: SaveState): string[] {
  return Object.entries(state.characters).filter(([, c]) => isSketch(c)).map(([id]) => id);
}

/** The turn that brought them in, so the completion can read the player's words and the prose. */
function sourceFor(state: SaveState, id: string): { action: string; prose: string } {
  const c = state.characters[id];
  const name = c?.name ?? "";
  const first = name.split(/\s+/)[0];
  const re = first && first.length >= 3 ? new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
  // newest first — the turn they entered on is usually recent, and a later scene describes them better
  for (const h of [...state.history].reverse()) {
    const blob = `${h.player_action ?? ""}\n${h.narrator_prose ?? ""}`;
    if (re && re.test(blob)) return { action: h.player_action ?? "", prose: (h.narrator_prose ?? "").slice(0, 2500) };
  }
  const last = state.history[state.history.length - 1];
  return { action: last?.player_action ?? "", prose: (last?.narrator_prose ?? "").slice(0, 2000) };
}

/**
 * Fill in one hollow record. Only ever writes fields that are EMPTY — anything the story or the
 * player already established stays exactly as it is. Returns true when something was written.
 */
export async function completeSketch(state: SaveState, id: string, model: string, fallback: string): Promise<boolean> {
  const c = state.characters[id];
  if (!c || !isSketch(c)) return false;
  const { action, prose } = sourceFor(state, id);
  const b = state.world_bible;
  const ctx = [
    `NAME: ${c.name}`,
    c.pronouns ? `PRONOUNS ALREADY RECORDED: ${c.pronouns}` : "",
    c.speech_pattern && c.speech_pattern !== "plain" ? `VOICE ALREADY RECORDED (keep consistent): ${c.speech_pattern}` : "",
    `WORLD: ${b?.name ?? ""} — ${b?.era ?? ""}. ${b?.technology_level ?? ""}`,
    b?.cultures_and_languages ? `CULTURE: ${b.cultures_and_languages}` : "",
    (state.world.canon ?? []).length ? `CANON (binding law):\n${state.world.canon.map((x) => `- ${x}`).join("\n")}` : "",
    b?.tone ? `REGISTER OF THIS STORY: ${b.tone}` : "",
    action ? `\nTHE PLAYER'S ACTION THAT BROUGHT THEM IN (everything it says about them is true and has to be kept):\n${action}` : "",
    prose ? `\nTHE PROSE THEY APPEARED IN (every physical detail here is true and has to be kept):\n${prose}` : "",
  ].filter(Boolean).join("\n");

  let g: any = null;
  try {
    const out = await complete(buildMessages(SKETCH_SYSTEM, "COMPLETE THIS RECORD:", ctx, model), model, fallback, true, 1200);
    g = safeJson<any>(out.text, null);
  } catch { return false; }
  if (!g) return false;

  // ONE RETRY, AND ONLY FOR THE TRAITS. The contract is in the prompt now, which is where it was
  // for the world forge all along, and a contract in a prompt is a request. The pass that produced
  // sixteen adjectives in one save had the request; what it did not have was anything reading the
  // answer. So the answer is read, and if the traits came back as temperatures rather than acts
  // they go back with the specific ones named. Traits only — everything else in the record was
  // fine, and re-rolling a whole person to fix one field is how a good background gets lost.
  const bad = unfilmableTraits(asList(g.core_traits));
  if (bad.length) {
    try {
      const again = await complete(buildMessages(
        SKETCH_SYSTEM, "REWRITE THE TRAITS ONLY:",
        `${ctx}\n\nThese came back as descriptions of what ${c.name} is like, when what's needed is things ${c.name} does, so they give a scene nothing to show: ${bad.map((t) => `“${t}”`).join(", ")}.\n`
        + `Send back the same JSON object with core_traits rewritten to follow the contract and every other field exactly the same. Each trait should start with something ${c.name} does, like a habit, something they refuse to do, or something their hands are always doing, and should name a concrete object, place, body part or action that a camera could catch.`,
        model), model, fallback, true, 1200);
      const g2 = safeJson<any>(again.text, null);
      if (g2 && unfilmableTraits(asList(g2.core_traits)).length < bad.length) g.core_traits = g2.core_traits;
      else console.warn(`[sketch] ${c.name}: traits still unfilmable after a retry — keeping ${JSON.stringify(bad)}`);
    } catch { /* the first answer stands */ }
  }

  /* AND ONE RETRY FOR THE FIGURES, on the same terms and for a stronger reason.
   *
   * This pass fills the blanks on somebody the story produced mid-play, and every field it writes
   * is then printed on the character card for the rest of the save. An unfilmable trait gives a
   * scene nothing to show. A background reading "built out of salt water and other people's debts"
   * gives a scene something worse: a sample of the register, sitting in the cached prefix where
   * engine/maxims.ts has already established a rule becomes reference rather than instruction. The
   * narrator reads it as how this person is written and writes them that way.
   *
   * The retry names the caught sentences and asks for the same object back with those fields
   * rewritten. It fails open exactly like the trait retry: a second answer is used only when it
   * carries fewer figures than the first. */
  const figured = screenCard(g);
  if (figured.length) {
    try {
      const again = await complete(buildMessages(
        SKETCH_SYSTEM, "REWRITE THE FLAGGED FIELDS ONLY:",
        `${ctx}

${rewriteNote(figured, c.name)}`,
        model), model, fallback, true, 1200);
      const g3 = safeJson<any>(again.text, null);
      if (g3 && screenCard(g3).length < figured.length) g = { ...g, ...g3 };
      else console.warn(`[sketch] ${c.name}: ${figured.length} field(s) still written as a figure after a retry — keeping them`);
    } catch { /* the first answer stands */ }
  }

  applySketch(state, c, g);
  return true;
}

/**
 * FILL, NEVER OVERWRITE. Anything already on the record was established by the story or the player;
 * this pass exists only to fill the blanks around it. Split out from the model call so the merge
 * rules are testable on their own.
 */
export function applySketch(state: SaveState, c: Identity, g: any): void {
  const putText = (k: "appearance_facts" | "background" | "speech_pattern" | "taste" | "attracted_to", v: unknown) => {
    const cur = asText((c as any)[k], " ").trim();
    const next = asText(v, " ").trim();
    if (next && (!cur || /^INCOMPLETE RECORD\b/.test(cur) || cur === "plain")) (c as any)[k] = next;
  };
  const putList = (k: "core_traits" | "values" | "texture", v: unknown) => {
    if (asList((c as any)[k]).length === 0 && asList(v).length) (c as any)[k] = asList(v).slice(0, 4);
  };
  const putNum = (k: "age" | "height_cm" | "weight_kg" | "beauty" | "conscience" | "gregariousness", v: unknown, lo: number, hi: number, treatAsBlank?: number) => {
    const cur = (c as any)[k];
    const blank = cur === undefined || (treatAsBlank !== undefined && cur === treatAsBlank);
    const n = typeof v === "number" ? v : Number(v);
    if (blank && Number.isFinite(n)) (c as any)[k] = Math.max(lo, Math.min(hi, n));
  };

  putText("appearance_facts", g.appearance_facts);
  putText("background", g.background);
  putText("speech_pattern", g.speech_pattern);
  putText("taste", g.taste);
  putText("attracted_to", g.attracted_to);
  putList("core_traits", g.core_traits);
  putList("values", g.values);
  putList("texture", g.texture);
  // SKILLS. The field is required on Identity and no creation path ever filled it — every NPC in a
  // 25-turn save had none. A person's competences are the subjects they can actually hold forth on,
  // so an empty map is a person with nothing to say outside their one plot function.
  if (g.skills && typeof g.skills === "object" && !Array.isArray(g.skills) && !Object.keys(c.skills ?? {}).length) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(g.skills).slice(0, 6)) {
      const key = String(k).trim().slice(0, 40);
      if (key) out[key] = clipText(v, 170);
    }
    if (Object.keys(out).length) c.skills = out;
  }
  putNum("age", g.age, 0, 200, 30);          // 30 is the registration default, i.e. "nobody said"
  putNum("height_cm", g.height_cm, 30, 300);
  putNum("weight_kg", g.weight_kg, 2, 500);
  putNum("beauty", g.beauty, 0, 100);
  putNum("conscience", g.conscience, 0, 1);
  putNum("gregariousness", g.gregariousness, 0, 1, 0.5);
  if (!c.pronouns && g.pronouns) c.pronouns = asText(g.pronouns);
  if (!c.attachment && (g.attachment_style || g.under_threat)) {
    c.attachment = { style: asText(g.attachment_style) || "secure", under_threat: asText(g.under_threat), when_that_fails: asText(g.when_that_fails), soothed_by: asText(g.soothed_by) } as any;
  }
  const goals = asList(g.drive_goals).filter(Boolean);
  if (goals.length && !c.drive?.goal) {
    c.drive = { goal: clipText(goals[0], 200), progress: 0, priority: 1, updated_turn: state.world.current_turn };
    c.drive_queue = goals.slice(1, 3).map((goal: string) => ({ goal: clipText(goal, 200), progress: 0, priority: 0, updated_turn: state.world.current_turn }));
  }

  // A SKETCH IS NOT FINISHED BECAUSE THE PASS RAN.
  //
  // This cleared the marker unconditionally, so a completion that came back short — the 1200-token
  // budget hit mid-object, safeJson salvaging the keys that had arrived — left a record holding an
  // appearance and nothing else, still opening "INCOMPLETE RECORD" where its life should be, and
  // now flagged as a finished person. One save carried exactly that for twenty-five turns: her
  // appearance_facts stop mid-phrase, at "dark obsidian-brown eyes with sharp calculating".
  //
  // Clearing it there is the wrong way round. Ask the record itself: clear the flag, then let
  // isSketch — which reads the fields the story actually renders — put it back if the record is
  // still hollow. The pass runs again after the next turn, which is what it is for.
  c.provisional = undefined;
  if (isSketch(c)) c.provisional = true;
}

/**
 * A PERSON THE PLAYER ASKED FOR, BY DESCRIPTION.
 *
 * The story is supposed to introduce people and often does not — a name appears in the prose and no
 * record follows it, or the player wants somebody specific in the world and has no way to say so.
 * completeSketch already knows how to build a whole person out of world context; the only thing it
 * could not do was start from nothing but a sentence the player typed.
 *
 * The brief is BINDING in the same way the prose is: whatever it states is true, and everything
 * around it is invented to fit. What makes this different from the Forge is the context — this
 * person is joining a story already in progress, so they are given the cast, the open threads and
 * the places, and asked to arrive already attached to them rather than standing in a vacuum waiting
 * to be introduced.
 */
const BRIEF_SYSTEM = `You write a complete character record for a person the player has just asked to add to a story that's already under way.

You're given the player's description of them, the world, its established facts, the people already in the story, the situations currently open, and the places that exist. The description is true and has to be kept. Every fact in it holds, and where it says nothing you invent details, concretely and in keeping with this world.

They're joining something that's already happening. Don't write a stranger standing around in empty space waiting to be introduced. Give them a reason to be here that goes back before this moment: someone in the cast they already know, resent, work with, are related to or have been avoiding, and, where the description allows, a stake in one of the open situations. A person with no connection to anybody gives the story nothing to work with.

There are things you can't do. Don't resolve an open situation, don't give them knowledge of a secret the cast doesn't have, and don't give them a power, rank or resource the world's established facts rule out. They arrive in the middle of their own day.

Don't clean anything up. Record them as explicitly as the story itself is written. If the player made this person to want them, that's who they are, so write it plainly without toning it down.

Reply with only this JSON, which is the record fields plus four more:
{
"name": "their name. Take it from the description if there is one, and otherwise pick one that fits how people in this world are named",
"where": "the exact name of one place from the PLACES list where they are right now, or \\"elsewhere\\" if they aren't somewhere the player can walk to yet",
"tie": "one plain sentence about how they're already connected to somebody or something in this story",
"relation_to_player": "one plain sentence about what, if anything, stands between this person and the player right now. They may never have met, and that's a real answer",
${RECORD_FIELDS.slice(1)}

${TRAIT_CONTRACT}`;

export interface BriefResult { id: string; name: string; where: string; tie: string }

/** Build a whole person from one sentence of player description, attached to the story as it stands. */
export async function characterFromBrief(
  state: SaveState, brief: string, model: string, fallback: string,
): Promise<BriefResult | null> {
  const text = String(brief ?? "").trim();
  if (!text) return null;
  const b = state.world_bible;
  const cast = Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && c?.name && c.status !== "dead")
    .slice(0, 12)
    .map(([, c]) => `- ${c.name}${c.age ? `, ${c.age}` : ""}${c.core_traits?.length ? ` (${c.core_traits.slice(0, 2).join("; ")})` : ""}`);
  const open = (state.world.threads ?? []).filter((t) => t.status === "active").map((t) => `- ${t.title}`);
  const places = Object.values(state.world.places ?? {})
    .filter((p) => p.id !== "loc_offscene")
    .map((p) => `- ${p.name}${p.identity?.trim() ? ` — ${p.identity.trim()}` : ""}`);

  const ctx = [
    `THE PLAYER'S DESCRIPTION OF THEM (everything it says is true and has to be kept):\n${text.slice(0, 1200)}`,
    `\nWORLD: ${b?.name ?? ""} — ${b?.era ?? ""}. ${b?.technology_level ?? ""}`,
    b?.cultures_and_languages ? `CULTURE AND NAMING: ${b.cultures_and_languages}` : "",
    (state.world.canon ?? []).length ? `CANON (binding law):\n${state.world.canon.map((x) => `- ${x}`).join("\n")}` : "",
    `\nTHE PLAYER: ${state.characters["char_player"]?.name ?? "the player"}`,
    cast.length ? `\nPEOPLE ALREADY IN THIS STORY:\n${cast.join("\n")}` : "\nNobody else is in this story yet.",
    open.length ? `\nSITUATIONS CURRENTLY OPEN (don't resolve any of them, but a stake in one is welcome):\n${open.join("\n")}` : "",
    places.length ? `\nPLACES ("where" has to be exactly one of these names, or elsewhere):\n${places.join("\n")}` : "",
  ].filter(Boolean).join("\n");

  let g: any = null;
  try {
    const out = await complete(buildMessages(BRIEF_SYSTEM, "WRITE THE RECORD:", ctx, model), model, fallback, true, 1400);
    g = safeJson<any>(out.text, null);
  } catch { return null; }
  if (!g) return null;

  const name = asText(g.name).trim().slice(0, 60);
  if (!name) return null;

  // Register, then fill through the SAME merge rules the sketch pass uses — applySketch only ever
  // writes empty fields, so a name or pronoun the player pinned in the brief survives the model.
  const id = registerCharacter(state, { name, central: true });
  const c = state.characters[id];
  if (!c) return null;
  applySketch(state, c, g);
  c.provisional = false;
  if (typeof g.relation_to_player === "string" && g.relation_to_player.trim()) {
    state.world.edges.push({
      from: id, to: "char_player", warmth: 0, trust: 0, power: 0,
      updated_turn: state.world.current_turn,
      notes: clipText(asText(g.relation_to_player), 280),
    });
  }

  // WHERE THEY ARE. A name from the list or nowhere in particular — never an invented place, which
  // would put somebody in a room the rest of the engine does not believe exists.
  const wantWhere = asText(g.where).trim().toLowerCase();
  const match = Object.values(state.world.places ?? {}).find((p) => p.name.toLowerCase().trim() === wantWhere);
  c.location = match ? match.id : "loc_offscene";

  return { id, name: c.name, where: match ? match.name : "elsewhere", tie: asText(g.tie).trim() };
}
