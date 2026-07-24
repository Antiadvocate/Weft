
// ── INTENT PASS ──────────────────────────────────────────────────────────────
// The layer that separates TRUTH from TELLING. Before the narrator renders a turn,
// each present NPC who has something at stake privately commits to what they are
// ACTUALLY doing this beat — the lie they'll tell, the want they're hiding, the
// feeling they're withholding — authored from THEIR OWN state (drive, agenda, edges,
// mood), never from the player's thoughts. This is what makes NPCs sovereign: their
// intent exists independently of what the player typed or thought.
//
// The output is split across the pipeline's three consumers, each getting only what
// it should:
//   • surface  → the NARRATOR renders it as deniable behavior (the player sees the
//                bitten teeth, not the lie).
//   • truth    → the BOOKKEEPER records it ("lied to Rabi about the shipment", builds
//                the deceit trait) — it reads from truth, not from the opaque prose.
//   • tell     → an optional deniable behavioral leak the narrator MAY show (a flicker,
//                a too-quick answer) that the player can read, or misread.
//
// Cost discipline: this fires ONLY for present NPCs with genuine stakes this turn, and
// runs on the cheap model. Most turns it fires for zero or one character. No stakes →
// no call → zero added cost.

import type { SaveState } from "./types";
import { complete, buildMessages, safeJson } from "../llm";
import { dispositionCue } from "./desire";

export interface NpcIntent {
  char_id: string;
  name: string;
  surface: string;   // what they let show — for the narrator
  truth: string;     // what's actually true (lie/hidden want/withheld feeling) — for the bookkeeper
  tell?: string;     // optional deniable behavioral leak — the narrator may show it, the player may read/misread it
  lying: boolean;    // convenience flag: is the surface a deliberate deception?
}

/** Does this NPC have something at stake THIS turn worth authoring a hidden intent for?
 *  Stakes = they carry an agenda/drive, OR they hold a charged edge toward the player
 *  (secret want, distrust, a false belief), OR they're withholding under stress. Cheap,
 *  synchronous gate — no model call. Returns the reason (for the prompt) or null. */
function stakesFor(state: SaveState, id: string): string | null {
  const c = state.characters[id];
  const cond = state.condition[id];
  if (!c || !cond) return null;
  const reasons: string[] = [];
  const agenda = c.voice?.agenda?.trim();
  if (agenda) reasons.push(`under-the-surface agenda: ${agenda}`);
  if (c.drive?.goal && !c.drive.goal.toLowerCase().includes("relax")) reasons.push(`active pursuit: ${c.drive.goal}`);
  // charged edge toward the player: strong desire they may be hiding, or distrust
  const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
  if (e) {
    if (e.attraction !== undefined && e.attraction >= 30) reasons.push(`carries desire toward the player (${e.attraction}) they may not show`);
    if (e.trust <= -20) reasons.push(`distrusts the player (${e.trust}) — may conceal or mislead`);
  }
  // a false belief the NPC holds about the player (from the theory-of-mind layer) is prime lie/drama fuel
  const belief = state.minds?.[id]?.about?.find((b) => b.target === "char_player")?.held_false;
  if (belief) reasons.push(`wrongly believes: ${belief}`);
  // clenched + low openness → likely withholding rather than open
  if (cond.psyche.relaxation <= -3) reasons.push(`clenched (openness ${cond.psyche.relaxation}) — more likely to mask than to show plainly`);
  return reasons.length ? reasons.join("; ") : null;
}

const INTENT_SYSTEM = `You author the PRIVATE, TRUE intent of a single character for one beat of a story — what they are ACTUALLY doing beneath what they let show. This is the character's own truth, drawn ONLY from who they are and their situation, NEVER from the player's private thoughts (you are not given those, and the character cannot know them).

Return ONE strict JSON object, nothing else:
{"surface":"what this character lets others SEE and HEAR this beat — their outward behavior, words, manner (this is what gets dramatized)","truth":"what is ACTUALLY true underneath — the real want, the lie and what it conceals, the feeling being withheld. If the surface is honest, truth restates the genuine state plainly. If they lie, truth names the lie AND the fact being hidden.","tell":"OPTIONAL — a small, deniable behavioral leak of the truth (a flicker, a too-quick reply, a hand that stills). Something an observer COULD read, or could miss/misread. Omit if they mask cleanly.","lying":true or false}

Rules:
- The character acts from THEIR nature, agenda, and feelings — sovereign, not in service of the player. They pursue their own want this beat.
- surface and truth may match (an honest, open character, or one who is simply, plainly feeling what they feel) or diverge (a liar, someone hiding desire, someone saving face). Divergence is ONE tool, not the default — use it only when the character's state actually supports a concealed truth. A resigned, hurt, or wary person is usually just that underneath; do not manufacture a hidden agenda, a secret scheme, or a dark reading of the player where the state shows only ordinary feeling. Most beats, surface and truth are close and lying is false.
- CALIBRATE TO THE STATE — the truth must be PROPORTIONAL to the character's actual disposition (given as warmth/trust with their plain-language meaning). Mild negatives are mild: warmth slightly below zero is "a little hurt, a little guarded", NOT terror; low trust is "cautious, watching", NOT conviction that the player is a monster. Do NOT escalate a wary or resigned character into someone secretly certain the player is a manipulator, a monster, a hollow shell, or a danger — that is invention, and it poisons how the character is played. Only write fear, hatred, or a dark verdict when the warmth/trust and history genuinely support that intensity. If the numbers say "mildly hurt but still cares," the truth is mildly hurt, full stop.
- The character reacts to what the player actually SAID and DID this beat and to their real history — never to a sinister interpretation the state doesn't justify. If nothing hostile has actually happened, the character is not secretly seething about it.
- Keep each field to one or two tight sentences. Concrete, not literary.
- NEVER reference the player's unspoken thoughts or feelings. The character reacts only to what the player audibly said and visibly did.`;

/** Run the intent pass for all present NPCs with stakes. Returns their private intents.
 *  Fires zero calls when nobody has stakes. One cheap call per staked NPC (usually 0–1). */
export async function runIntentPass(state: SaveState, playerAction: string): Promise<NpcIntent[]> {
  const present = state.world.present.filter((id) => {
    const c = state.characters[id];
    return c && c.status !== "dead" && c.status !== "departed" && c.central !== false;
  });
  const staked = present
    .map((id) => ({ id, reason: stakesFor(state, id) }))
    .filter((x): x is { id: string; reason: string } => !!x.reason);
  if (!staked.length) return [];

  // What the player AUDIBLY said / VISIBLY did — the only player input an NPC may react to.
  // Strip *private thoughts* and (parenthetical inner state); keep "speech" and plain action.
  const perceptibleAction = playerAction
    .replace(/\*[^*]*\*/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "(the player did nothing others could perceive this beat)";

  const results = await Promise.all(staked.map(async ({ id, reason }) => {
    const c = state.characters[id];
    const cond = state.condition[id];
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    const belief = state.minds?.[id]?.about?.find((b) => b.target === "char_player")?.held_false;
    const ctx = [
      `CHARACTER: ${c.name}${c.pronouns ? ` (${c.pronouns})` : ""}, age ${c.age ?? "?"}.`,
      c.core_traits?.length ? `Nature: ${(Array.isArray(c.core_traits) ? c.core_traits.join(", ") : c.core_traits)}.` : "",
      c.voice?.agenda ? `Agenda (their subtext): ${c.voice.agenda}` : "",
      c.drive?.goal ? `Wants: ${c.drive.goal}` : "",
      `Mood: ${cond.psyche.mood || "even"}; openness ${cond.psyche.relaxation}.`,
      e ? `Toward the player: warmth ${e.warmth}, trust ${e.trust}${e.attraction !== undefined ? `, desire ${e.attraction}` : ""}${e.roles?.length ? `, roles ${e.roles.join("/")}` : ""} — ${dispositionCue(e.warmth ?? 0, e.trust ?? 0)}${belief ? `. WRONGLY BELIEVES: ${belief}` : ""}.` : "They barely know the player.",
      `WHY THEY HAVE STAKES THIS BEAT: ${reason}`,
      `WHAT THE PLAYER AUDIBLY SAID / VISIBLY DID: ${perceptibleAction}`,
    ].filter(Boolean).join("\n");

    try {
      const out = await complete(
        buildMessages(INTENT_SYSTEM, ctx, "Author this character's private intent for this beat. JSON only.", state.model_settings.simulator_model),
        state.model_settings.simulator_model, state.model_settings.fallback_model,
        { schema: INTENT_JSON_SCHEMA, name: "npc_intent" }, 400,
      );
      const j = safeJson<Partial<NpcIntent> | null>(out.text, null);
      if (!j || !j.surface) return null;
      return {
        char_id: id, name: c.name,
        surface: String(j.surface).slice(0, 300),
        truth: String(j.truth ?? j.surface).slice(0, 300),
        tell: j.tell ? String(j.tell).slice(0, 200) : undefined,
        lying: !!j.lying,
      } as NpcIntent;
    } catch {
      return null; // a failed intent call just means this NPC gets rendered normally this turn
    }
  }));

  return results.filter((x): x is NpcIntent => !!x);
}

const INTENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["surface", "truth", "lying"],
  properties: {
    surface: { type: "string" },
    truth: { type: "string" },
    tell: { type: "string" },
    lying: { type: "boolean" },
  },
} as const;

/** Format the intents for the NARRATOR: surface + optional tell ONLY. The narrator must NOT
 *  receive `truth` — it renders deniable behavior so the player sees the surface and reads (or
 *  misreads) the tell, never the decoded answer. */
export function intentForNarrator(intents: NpcIntent[]): string {
  if (!intents.length) return "";
  const lines = intents.map((i) => {
    const bits = [`${i.name} — shows: ${i.surface}`];
    if (i.tell) bits.push(`may leak (deniable, the player could catch or miss it): ${i.tell}`);
    return `- ${bits.join("; ")}`;
  });
  return `\n\n=== WHAT PRESENT CHARACTERS LET SHOW (render as behavior; do NOT state their hidden reasons — the player reads them like anyone reads a face) ===\n${lines.join("\n")}`;
}

/** Format the intents for the BOOKKEEPER: the TRUTH. This is what it records — the lie and what
 *  it conceals, the hidden want — so memory and traits are built from what really happened, not
 *  from the deliberately-deniable prose. */
export function intentForBookkeeper(intents: NpcIntent[]): string {
  if (!intents.length) return "";
  const lines = intents.map((i) => {
    const bits = [`${i.name} [${i.char_id}]`];
    if (i.lying) bits.push(`LIED. Surface: "${i.surface}". TRUTH concealed: ${i.truth}`);
    else bits.push(`showed: "${i.surface}"; true state: ${i.truth}`);
    return `- ${bits.join(" — ")}`;
  });
  return `\n\n=== GROUND TRUTH OF PRESENT CHARACTERS THIS TURN (authoritative — record memories/facts/traits from THIS, not from the prose, which deliberately hides it; e.g. a lie becomes a memory "lied to the player about X" for the liar, and may build a deceit trait) ===\n${lines.join("\n")}`;
}

