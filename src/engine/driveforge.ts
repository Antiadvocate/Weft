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
import { tidyPhrase } from "./coerce";
import { overlapRatio } from "./turn";

/** In-world minutes a character may hold one want before it is re-derived. */

const DRIVE_SYSTEM = `You give ONE person their next want. You are writing the life of someone who has one, not a role in someone else's story.

WHAT A WANT IS: something this person is trying to GET, MAKE, KEEP, MEND, WIN, or ESCAPE, that they can move toward by their own hands, on their own authority, starting today. It comes out of who they are — the work they do, what they own and owe, who they are bound to, what they were before this, what they are afraid of losing. It should be specific enough that you could tell whether they had achieved it.

INVALID, and these are the common failures:
- A DECISION. "Decide whether to accept the offer", "work out whether to trust him", "choose between staying and going" — deciding is not doing. A person with a real want has already decided and is now trying to bring it about. If they are genuinely torn, the want is the thing they will do to find out: go and look at the other option, ask the person who would know, put a foot in one camp and see how it feels.
- WAITING FOR AN ANSWER. "Get a clear answer from him", "find out what he intends", "have her say plainly what she means." No one else's word can be your goal. It can be a step, but the goal is what you will do with the answer either way.
- APPROVAL, PERMISSION, OR PROOF FROM ANOTHER. "Test whether his offer is sincere", "earn his trust", "be taken seriously by them." These hand the person's life to someone else to run.
- VAGUE PEACE. "Find peace and quiet", "tend to something neglected", "keep her head down." These are what you write when you have nothing; they describe a person who has stopped existing. Write what she actually does with her hands this week.
- ANYTHING PHRASED AROUND ONE PARTICULAR PERSON'S FEELINGS toward them. Bonds are real and belong in the want as a REASON or a METHOD — she wants the field cleared before the frost BECAUSE her brother's family eats from it — never as the object.

- ABSTENTION. "Get through the day without calling him." "Avoid Mara until she's calmed down." "Stop herself from saying the thing." "Keep it together in front of the children." A want you satisfy by NOT doing something cannot be stepped toward, and every system downstream needs a step: the world-sim is asked each pass for a named person taking a concrete action on a want, and there is no action that is the absence of one. A save's whole offstage report came back as three other people texting HER while she did nothing, on every pass, because her recorded want was to refrain. Restraint is real and belongs in the BLOCKER or in how they carry it — never as the goal. The goal is what they do with the hands: go to the one person who will still pick up, clear his things out of the flat, walk into her sister's kitchen at midnight, take the shift nobody wants.

- A DOCUMENT. "Draft a written schedule of duties", "reconcile the ledgers into a clean tally", "secure a written agreement sealed before she leaves", "lock in a season's supply contract", "press on with the negotiation for the charter". This is the failure that comes from taking every rule above seriously and nothing else: paperwork is concrete, it needs nobody's permission, you can do it with your own hands starting today, and you can tell exactly when it is finished. It is the locally perfect answer and it is almost never a person's actual want. One save reached nine living characters and FIVE of them were producing documents — a clerk, a steward, a merchant, an envoy, and the commander of an invading army, who was negotiating a charter. The player said: I had to invent an army to make it interesting and the army is signing charters.
  A record is a MEANS. If the want really does run through a document, the want is the thing the document gets them — the grain in the cellar before the frost, the rival cut out of the trade, the sister's boy taken on at the vault — and the paper is at most the first step. Never the goal.

WANTS ARE NOT ALL ADMINISTRATIVE. Before you write, consider what else a person spends a week on: a body (get strong again after the winter sickness, sleep somewhere warm, eat properly for once); an appetite (bed someone, get drunk with people who knew them before, hear the good singer at the market); a grudge (make the man who shorted them pay for it publicly); repair (fix the roof before it takes the ceiling, get the mare's leg right); curiosity (find out what is actually down the north road, learn to read); standing (be asked to the table where the decisions get made); somebody else (get their brother out of the levy, find the girl a place). Pick the one that fits THIS person's traits, background, skills and interests. If two people in the same story have wants of the same KIND, one of them is wrong.

SCALE IT TO WHO THEY ARE. Someone powerful, independent, or used to command does not spend their want on whether a person likes them: they take ground, install someone, settle a debt, break a rival, build the thing they have been describing for years. A servant's want is smaller and just as much theirs. Read the traits and background you are given and write the want that person would actually carry — a dominating, confident, independent character whose goal is to await instructions is a contradiction, and the contradiction is your error.

Also give a first concrete STEP they could take within a day, by their own means, without anyone's permission.

AND GIVE THEM A DOOR. Not the want — the way this particular person goes AT it when other people are in the room. Almost nobody walks up and states what they are after; they find a way in, and which way says more about them than the want does. The adjacent subject raised so they can watch the reaction. The question asked so the other person volunteers it. Telling it as something that happened to a colleague. Floating a small deniable version first. Using an interest they already have as the door into the subject. Working through a third person who will carry it for them. Doing a favour first so the asking costs less. Pick the one that fits THEIR traits, voice and standing — a blunt person's door is still a door, just a short one — and write it as something they DO, in a few words. It must not restate the goal.

Output ONLY:
{"goal":"one sentence, concrete, theirs","approach":"how they go at it around other people — the door, not the want","step":"the first thing they do","why":"the trait, debt, bond or fear this grows from"}`;

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

/**
 * IS THIS WANT AN ABSENCE?
 *
 * A goal satisfied by refraining produces no events, ever. The world-sim asks each pass for a named
 * person taking a concrete step on a recorded want; there is no step that is the absence of a step.
 * One save's offstage report came back three passes running as other people texting HER — Mara
 * texted her, John texted her — while she, the woman the story was about, did nothing, because the
 * want on her card was "Get through the next day without calling him, and fail at it" and its
 * blocker was "she gets as far as the contact screen and puts the phone down, four times before
 * noon". A beautiful line and an unplayable input: the engine had written down that her job was to
 * be still, and then faithfully kept her still.
 */
const ABSTAIN = /\b(?:without|avoid|avoiding|refrain|refrains?|resist(?:ing)?|stop (?:her|him|them)self|keep (?:her|him|them)self from|not (?:to )?(?:call|text|contact|reach|speak|go|see|tell|say)|never (?:call|text|contact|speak)|hold (?:back|off)|stay away|keep (?:it|herself|himself) together|get through .* without|make it through .* without)\b/i;

export function isAbstentionGoal(goal: string): boolean {
  const g = String(goal ?? "").toLowerCase();
  if (!ABSTAIN.test(g)) return false;
  // "…without calling him, and fail at it" is still abstention: the failure is not a plan either.
  // But "go to the bar without telling Mara" is a real errand with a condition on it — the verb
  // that carries the goal comes FIRST, so only treat it as abstention when nothing active leads.
  const beforeAbstain = g.slice(0, g.search(ABSTAIN));
  return !/\b(go|goes|going|walk|drive|take|takes|bring|get \w+ (?:out|back|to)|pack|clear|sell|burn|call|text|tell|ask|meet|find|make|build|fix|leave for|quit|hand|give)\b/.test(beforeAbstain);
}

/**
 * IS THIS WANT A PIECE OF PAPER?
 *
 * The drive prompt asks for something concrete, achievable by the person's own hands, needing
 * nobody's permission, and verifiable as done. A document satisfies every one of those perfectly,
 * so it is what a model reaches for when it has nothing better — and because each want is forged
 * independently, the whole cast reaches for it at once. One save, nine living characters, five of
 * them producing documents: a schedule of duties, a reconciled ledger, a written price agreement, a
 * season's supply contract, and a charter being negotiated by the commander of an invading army.
 *
 * This is not a ban. A steward really may want the ledgers straight, and a merchant really may want
 * a contract — ONCE, in a cast. What is wrong is the fifth one. So the gate is cast-aware: the
 * first paperwork want in a story stands, and the next is sent back to be something else.
 */
const PAPER = /\b(charter|ledger|ledgers|contract|tally|tallies|schedule|inventory|audit|deed|writ|invoice|register|registry|manifest|accounts?|paperwork|documents?|agreements?|terms|bond|licen[cs]e|warrant|decree|treaty|receipts?)\b/i;
const PAPER_VERB = /\b(draft\w*|draw\w*\s+up|drew\s+up|set\w*\s+down|writ\w*\s+out|wrote\s+out|reconcil\w*|tall(?:y|ies|ying)|seal\w*|sign\w*|ratif\w*|notari\w*|fil(?:e|es|ing)|formali\w*|codif\w*|negotiat\w*|lock\w*\s+in|put\w*\s+in\s+writing|in\s+writing)/i;

export function isPaperworkGoal(goal: string): boolean {
  const g = String(goal ?? "");
  if (!PAPER.test(g)) return false;
  // A document merely MENTIONED is fine — "get the grain into the cellar before the audit" is about
  // grain. It is paperwork when producing or agreeing the record is the thing being pursued.
  return PAPER_VERB.test(g) || /\b(written|formal|clean|final)\b[^.]{0,40}\b(schedule|tally|agreement|record|terms|contract|charter)\b/i.test(g);
}

/** Who in the living cast is already pursuing a piece of paper. */
export function paperworkHolders(state: any, exceptId: string): string[] {
  return Object.entries<any>(state.characters ?? {})
    .filter(([oid, o]) => oid !== exceptId && oid !== "char_player" && o.status !== "dead" && o.status !== "departed")
    .filter(([, o]) => o.drive?.goal && isPaperworkGoal(o.drive.goal))
    .map(([, o]) => o.name);
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
    // WHAT EVERYONE ELSE IS ALREADY DOING. Each want used to be forged in isolation, so nine
    // independent calls under the same constraints converged on the same locally-optimal shape and
    // the whole cast ended up doing paperwork at each other. The forge cannot avoid a collision it
    // cannot see.
    (() => {
      const held = Object.entries<any>(state.characters ?? {})
        .filter(([oid, o]) => oid !== id && oid !== "char_player" && o.drive?.goal && o.status !== "dead" && o.status !== "departed")
        .slice(0, 8)
        .map(([, o]) => `- ${o.name}: ${String(o.drive.goal).slice(0, 120)}`);
      return held.length
        ? `\nWANTS ALREADY TAKEN IN THIS STORY — yours must not be the same KIND as any of these. If they are all errands of record and account, that is the failure described above and yours is something else entirely:\n${held.join("\n")}`
        : "";
    })(),
    `\nOPEN BUSINESS IN THE WORLD: ${(state.world.threads ?? []).filter((t: any) => t.status === "active").map((t: any) => t.title).join("; ") || "nothing pressing"}`,
    // ── WHERE THE STORY IS GOING ───────────────────────────────────────────────────────────────
    // The destination is the one thing the player states outright about where this is all headed,
    // and it never reached this pass. So the person the ending is ABOUT got a want derived from her
    // card and her mood alone, and it came out pointing the opposite way: a save whose stated
    // ending was "Tessa claims Anthony as her lover and relegates Rabi" gave Tessa the want "get
    // herself hard and stay hard with Rabi again — reclaim the part of her body he loves". Every
    // other character's want pointed away from the ending too. The player's read was exactly right:
    // she has no general direction, and the destination was missed completely.
    //
    // This is not a instruction to serve the plot. A want is still theirs and can still cut against
    // the ending — a person walking away from where the story is going is drama, a person who has
    // never heard of it is an oversight.
    (() => {
      const dest = String(state.world_bible?.destination ?? "").trim();
      if (!dest) return "";
      const missing = String(state.destination_progress?.missing ?? "").trim();
      const named = new RegExp(`\\b${(c.name ?? "").split(/\\s+/)[0]}\\b`, "i").test(`${dest} ${missing}`);
      return `\nWHERE THIS STORY IS HEADED: ${dest}${missing ? `\nWHAT STILL STANDS BETWEEN HERE AND THERE: ${missing}` : ""}`
        + (named
          ? `\nTHIS PERSON IS NAMED IN THAT ENDING. Their want must be ABOUT it — moving toward it, resisting it, bargaining with it, or trying to get it on their own terms. A want that is simply unaware of the thing the whole story is pointed at is the failure here; it leaves the person the ending needs wandering off after something else while the story waits.`
          : `\nThey are not named in that ending, so they do not have to serve it — but they live in the world it is happening to. Their own want may cut across it, complicate it, or ignore it for their own reasons; it should not be written as though the ending does not exist.`);
    })(),
  ].filter(Boolean).join("\n");
}

/** Re-derive one character's want. Returns the goal, or null on failure (they keep what they had). */
export async function forgeDrive(state: any, id: string, model: string): Promise<string | null> {
  const c = state.characters?.[id];
  if (!c || c.status === "dead" || c.status === "departed") return null;
  const playerName = state.characters?.char_player?.name ?? "";

  let rejection = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msgs = buildMessages(DRIVE_SYSTEM, "PERSON:", brief(state, id) + rejection, model);
      const out = await complete(msgs, model, model, true, 700);
      const j = safeJson<{ goal?: string; step?: string; why?: string }>(out.text, {});
      const goal = String(j.goal ?? "").trim();
      if (!goal || goal.length < 8) continue;
      if (isDependentGoal(goal, playerName)) {
        console.info(`[drives] rejected player-contingent goal for ${c.name}: "${goal}"`);
        rejection = "\n\nYour previous attempt was rejected for being a decision, a wait for someone's answer, or a bid for approval. Write what this person DOES.";
        continue;
      }
      if (isAbstentionGoal(goal)) {
        console.info(`[drives] rejected abstention goal for ${c.name}: "${goal}"`);
        rejection = "\n\nYour previous attempt was a want satisfied by NOT doing something, which can never be stepped toward and leaves this person motionless while everyone around them acts. Restraint belongs in the blocker, not the goal. Write what they DO with their hands this week.";
        continue;
      }
      const holders = paperworkHolders(state, id);
      if (holders.length && isPaperworkGoal(goal)) {
        console.info(`[drives] rejected paperwork goal for ${c.name} (${holders.join(", ")} already have one): "${goal}"`);
        rejection = `\n\nYour previous attempt was another errand of record and account, and ${holders.join(" and ")} ${holders.length === 1 ? "is" : "are"} already doing that in this story. Write a want of a different KIND — the body, an appetite, a grudge, a repair, curiosity, standing, or somebody else they are trying to get something for.`;
        continue;
      }
      // the door is only kept when it is actually a different sentence from the want; a model that
      // restates the goal here would hand the narrator the announcement twice over
      const approach = tidyPhrase((j as any).approach, 140);
      const restates = approach && overlapRatio(approach, goal) > 0.6;
      c.drive = {
        goal,
        approach: approach && !restates ? approach : undefined,
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
