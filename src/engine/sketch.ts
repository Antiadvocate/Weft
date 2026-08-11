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
import { asList, asText } from "./coerce";

export const SKETCH_SYSTEM = `You complete a CHARACTER RECORD for someone who has already entered a story but was never written down properly.

You are given: their name, the player's action that brought them in (when there was one), the prose in which they appeared, and the world they are in. Everything in those sources is TRUE and BINDING — if the prose says her eyes are grey-green and her feet are bare, the record says grey-green eyes; if the player said she is more beautiful than a named character, she is strikingly beautiful. You are filling in what was left blank around facts already established, never overwriting them and never contradicting them.

Where the sources are silent, invent — concretely and consistently with the world, the way the Forge would. A record that stays vague is the failure this exists to fix. Do not write plot function ("mysterious newcomer", "the player's creation"); write a person.

DO NOT SANITIZE. Match the register and maturity of the story you are given. If the story is dark, explicit, or carnal, the record is too. If the player made this person to want them, that is who they are — write it plainly rather than laundering it into something tamer.

Output ONLY this JSON:
{
"age": 30,
"pronouns": "the pronouns the prose used for them, or this world's default",
"appearance_facts": "COMPLETE physical baseline of the body they actually have — hair colour AND texture, eye colour, skin, face or one distinctive feature, build, apparent age, one unique identifying mark. Every physical detail the prose gave, verbatim; invent the rest consistently. PHYSICAL CONSTANTS ONLY — never clothing.",
"height_cm": 170,
"weight_kg": 65,
"background": "WHO THEY ARE APART FROM THE SCENE THEY ENTERED IN. Three or four plain sentences, and the test is whether a stranger could hold four different conversations with them: where they are from and what that place was like; who raised them or who they have lost; the trade or body of knowledge they actually hold, named specifically; one formative thing with nothing to do with the player or the story; and one ordinary strong opinion about something small. If the player created them outright, say so plainly and say what they were made to be \u2014 then give them the rest of a self anyway, because a person made yesterday still has to be able to talk about something other than the person who made them.",
"core_traits": ["2-4 real personality traits, not plot function"],
"values": ["2-3 things they actually care about"],
"speech_pattern": "how they talk — register, rhythm, what they refuse to say",
"texture": ["2-4 standing interests and enthusiasms they raise unprompted when a scene gives them room \u2014 at least two with nothing to do with their trade, their rank, or the player. One physical tell is allowed among them, never more."],
"skills": {"3-5 entries, key = the competence, value = how good and how they came by it \u2014 a person's skills are the subjects they can actually hold forth on": ""},
"beauty": 50,
"conscience": 0.7,
"attracted_to": "women / men / anyone / no one — permanent, and read by the engine as a hard gate; never use no one for somebody who is only unavailable right now, and do not qualify it with a mood",
"taste": "ONE STRING: what their conditioning makes them find attractive",
"gregariousness": 0.5,
"attachment_style": "secure / anxious / avoidant / disorganized — most people are secure; pick an insecure style only when this person\u2019s history actually produced one",
"under_threat": "one plain sentence: what they DO when scared or hurt",
"soothed_by": "one plain sentence: what actually settles them",
"drive_goals": ["2-3 distinct wants they carry at once — an immediate aim, a deeper hope or fear, an attachment or grudge. Never only the player."]
}`;

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
    action ? `\nTHE PLAYER'S ACTION THAT BROUGHT THEM IN (binding — everything stated here is true of them):\n${action}` : "",
    prose ? `\nTHE PROSE THEY APPEARED IN (binding — every physical detail here is true):\n${prose}` : "",
  ].filter(Boolean).join("\n");

  let g: any = null;
  try {
    const out = await complete(buildMessages(SKETCH_SYSTEM, "COMPLETE THIS RECORD:", ctx, model), model, fallback, true, 1200);
    g = safeJson<any>(out.text, null);
  } catch { return false; }
  if (!g) return false;

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
      if (key) out[key] = String(v ?? "").trim().slice(0, 120);
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
    c.attachment = { style: asText(g.attachment_style) || "secure", under_threat: asText(g.under_threat), soothed_by: asText(g.soothed_by) } as any;
  }
  const goals = asList(g.drive_goals).filter(Boolean);
  if (goals.length && !c.drive?.goal) {
    c.drive = { goal: goals[0].slice(0, 140), progress: 0, priority: 1, updated_turn: state.world.current_turn };
    c.drive_queue = goals.slice(1, 3).map((goal: string) => ({ goal: goal.slice(0, 140), progress: 0, priority: 0, updated_turn: state.world.current_turn }));
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
