// DRIVEFORGE — wants that exist whether or not the player walked in.
//
// The simulator prompt already forbids player-orbiting goals in strong, specific language: "most
// NPC goals should point at something in the WORLD or at OTHER characters", "watch/assess/
// understand the player goals are passive and forbidden". It produced, in a live save at turn 421:
//   Poppy       — "Test whether Anki's offer of being used is sincere before deciding to trust..."
//   Fionnghuala — "Decide whether to accept Anki's offer of total command and bind herself to him"
// and NO DRIVE AT ALL for the other fourteen characters.
//
// The instruction can't win, because the simulator writes drives while looking at a transcript in
// which the player is the loudest thing on the page. Whatever it is told, the salient object in its
// context is him. So this pass doesn't get the transcript, and doesn't get the player: it sees one
// character's constitution, the world, and the other people in it. A goal about the player is not
// forbidden here — it is unwriteable, because the player is not in the room.
//
// This is the same shape as the voice refresh, for the same reason: drift toward the centre of the
// context is fixed by changing the context, not by arguing with it.

import { buildMessages, complete, safeJson } from "../llm";

/** In-world minutes a character may hold one want before it is re-derived. */
export const DRIVE_REFRESH_MIN = 2880;   // two days

const DRIVE_SYSTEM = `You give ONE person their next want. You are writing the life of someone who has one, not a role in someone else's story.

WHAT A WANT IS: something this person is trying to GET, MAKE, KEEP, MEND, WIN, or ESCAPE, that they can move toward by their own hands, on their own authority, starting today. It comes out of who they are — the work they do, what they own and owe, who they are bound to, what they were before this, what they are afraid of losing. It should be specific enough that you could tell whether they had achieved it.

INVALID, and these are the common failures:
- A DECISION. "Decide whether to accept the offer", "work out whether to trust him", "choose between staying and going" — deciding is not doing. A person with a real want has already decided and is now trying to bring it about. If they are genuinely torn, the want is the thing they will do to find out: go and look at the other option, ask the person who would know, put a foot in one camp and see how it feels.
- WAITING FOR AN ANSWER. "Get a clear answer from him", "find out what he intends", "have her say plainly what she means." No one else's word can be your goal. It can be a step, but the goal is what you will do with the answer either way.
- APPROVAL, PERMISSION, OR PROOF FROM ANOTHER. "Test whether his offer is sincere", "earn his trust", "be taken seriously by them." These hand the person's life to someone else to run.
- VAGUE PEACE. "Find peace and quiet", "tend to something neglected", "keep her head down." These are what you write when you have nothing; they describe a person who has stopped existing. Write what she actually does with her hands this week.
- ANYTHING PHRASED AROUND ONE PARTICULAR PERSON'S FEELINGS toward them. Bonds are real and belong in the want as a REASON or a METHOD — she wants the field cleared before the frost BECAUSE her brother's family eats from it — never as the object.

SCALE IT TO WHO THEY ARE. Someone powerful, independent, or used to command does not spend their want on whether a person likes them: they take ground, install someone, settle a debt, break a rival, build the thing they have been describing for years. A servant's want is smaller and just as much theirs. Read the traits and background you are given and write the want that person would actually carry — a dominating, confident, independent character whose goal is to await instructions is a contradiction, and the contradiction is your error.

Also give a first concrete STEP they could take within a day, by their own means, without anyone's permission.

Output ONLY:
{"goal":"one sentence, concrete, theirs","step":"the first thing they do","why":"the trait, debt, bond or fear this grows from"}`;

/** A goal is invalid if it cannot be pursued without someone else supplying an answer. */
export function isDependentGoal(goal: string, playerName: string): boolean {
  const g = (goal || "").toLowerCase();
  const p = (playerName || "").toLowerCase();
  const DECIDE = /\b(decide|decision|choose|work out|figure out|determine|weigh|consider) (whether|if|between)\b/;
  const AWAIT = /\b(get|obtain|receive|await|wait for|hear|learn|find out|discover|confirm) (a |an |the |his |her |their )?(clear |direct |straight |honest |plain )?(answer|response|reply|word|decision|instruction|order|intent|intention)\b/;
  const APPROVE = /\b(earn|win|prove|test|secure|gain|keep) (his|her|their|the )?(trust|approval|favour|favor|sincerity|regard|permission|blessing|respect)\b/;
  const ABOUT_PLAYER = p.length > 2 && new RegExp(`\\b${p}('s)?\\b`).test(g);
  const VAGUE = /\b(find peace|peace and quiet|keep (her|his|their) head down|tend to something|something of (her|his|their) own that|stay out of the way|lie low)\b/;
  if (VAGUE.test(g)) return true;
  if (DECIDE.test(g) || AWAIT.test(g) || APPROVE.test(g)) return true;
  // Naming the player isn't automatically wrong — "get the field cleared before he leaves" is fine.
  // Naming them as the thing being decided about or waited on is.
  // Naming the player is fine when they are a companion or a circumstance — "walk to the monastery
  // with him and see if it still stands" is her errand, he is just along. It is only invalid when
  // the player is what is being decided about, offered, or asked. Require the player and the
  // dependency word to be in the SAME clause, not merely the same sentence.
  if (ABOUT_PLAYER) {
    const clause = g.split(/,| and | but | before | after | then /).find((cl) => new RegExp(`\\b${p}('s)?\\b`).test(cl)) ?? g;
    if (/\b(whether|offer|permission|approval|command|instruction|wants|asks|tells)\b/.test(clause)) return true;
  }
  return false;
}

/** Everything the pass is allowed to see. Deliberately excludes the player and the transcript. */
function brief(state: any, id: string): string {
  const c = state.characters[id];
  const acquired = (state.traits?.[id] ?? []).filter((t: any) => (t.intensity ?? 0) >= 5).map((t: any) => t.label);
  const others = Object.entries<any>(state.characters)
    .filter(([oid, o]) => oid !== id && oid !== "char_player" && o.status !== "dead" && !o.provisional)
    .slice(0, 8)
    .map(([oid, o]) => {
      const e = (state.world.edges ?? []).find((x: any) => x.from === id && x.to === oid);
      const tie = e ? ` (warmth ${e.warmth}, trust ${e.trust})` : "";
      return `- ${o.name}, ${state.world.places[o.location]?.name ?? "elsewhere"}${tie}`;
    }).join("\n");
  const b = state.world_bible ?? {};
  return [
    `NAME: ${c.name}, age ${c.age}`,
    `WHERE THEY ARE: ${state.world.places[c.location]?.name ?? "unknown"}`,
    `BACKGROUND: ${c.background ?? ""}`,
    `CORE TRAITS: ${(c.core_traits ?? []).join(" | ")}`,
    acquired.length ? `WHAT LIFE HAS ADDED: ${acquired.join(" | ")}` : "",
    `VALUES: ${(c.values ?? []).join(", ")}`,
    `WHAT THEY DO UNDER THREAT: ${c.attachment?.under_threat ?? "unstated"}`,
    `SETTING: ${b.name ?? ""} — ${b.era ?? ""}. ${b.technology_level ?? ""}`,
    `WHAT PEOPLE HERE FEAR: ${b.what_people_fear ?? ""}`,
    `SEASON AND TIME: ${state.world.current_time}`,
    others ? `\nOTHER PEOPLE IN THEIR LIFE:\n${others}` : "",
    `\nOPEN BUSINESS IN THE WORLD: ${(state.world.threads ?? []).filter((t: any) => t.status === "active").map((t: any) => t.title).join("; ") || "nothing pressing"}`,
  ].filter(Boolean).join("\n");
}

/** Re-derive one character's want. Returns the goal, or null on failure (they keep what they had). */
export async function forgeDrive(state: any, id: string, model: string): Promise<string | null> {
  const c = state.characters?.[id];
  if (!c || c.status === "dead" || c.status === "departed") return null;
  const playerName = state.characters?.char_player?.name ?? "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const extra = attempt === 0 ? "" : "\n\nYour previous attempt was rejected for being a decision, a wait for someone's answer, or a bid for approval. Write what this person DOES.";
      const msgs = buildMessages(DRIVE_SYSTEM, "PERSON:", brief(state, id) + extra, model);
      const out = await complete(msgs, model, model, true, 700);
      const j = safeJson<{ goal?: string; step?: string; why?: string }>(out.text, {});
      const goal = String(j.goal ?? "").trim();
      if (!goal || goal.length < 8) continue;
      if (isDependentGoal(goal, playerName)) {
        console.info(`[drives] rejected player-contingent goal for ${c.name}: "${goal}"`);
        continue;
      }
      c.drive = {
        goal,
        progress: 0,
        priority: 1,
        blocker: j.step ? `next: ${j.step}` : undefined,
        updated_turn: state.world.current_turn,
      };
      c.drive_refreshed_time = state.world.current_time;
      return goal;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Give a want to anyone who lacks one, and replace any that has gone stale or player-contingent.
 * Runs on the whole living cast, not only the people in the room — a character offstage with no
 * want is exactly the character who quietly stops existing.
 */
export async function refreshDrives(state: any, model: string, limit = 3): Promise<string[]> {
  const out: string[] = [];
  const playerName = state.characters?.char_player?.name ?? "";
  const candidates = Object.entries<any>(state.characters ?? {})
    .filter(([id, c]) => {
      if (id === "char_player" || c.provisional) return false;
      if (c.status === "dead" || c.status === "departed") return false;
      if (!c.drive?.goal) return true;                                   // furniture — give them a life
      if (isDependentGoal(c.drive.goal, playerName)) return true;        // orbiting — replace it
      return false;
    })
    .slice(0, limit);

  for (const [id] of candidates) {
    const g = await forgeDrive(state, id, model);
    if (g) out.push(`${state.characters[id].name} wants: ${g}`);
  }
  return out;
}
