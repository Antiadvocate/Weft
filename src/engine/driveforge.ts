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
//
// AND THEN IT OVERCORRECTED. A want that went THROUGH the player became unwriteable too, and so did
// the long-run aim on the card, which this pass never saw. Kingdom of Veythar, turn 35: a woman
// whose card says she found out the king's secret and means to use it to get his power, given the
// want "sleep beside King Aldric without angering him". The player's report: she has control over
// me and wants my power, and instead of going after it she asks for cookies and narrates. The rule
// was never "nothing about the player"; it was "nothing that leaves this person waiting on the
// player". So the player is in the room again, as one of the people in their life, with the long-
// run aim beside them, and the forge is told the difference: getting something out of someone is
// a want, and waiting for them to offer it is not.

import { keepsAway, namesPlayer } from "./rejection";
import { buildMessages, complete, safeJson } from "../llm";
import { tidyPhrase, ownWant } from "./coerce";
import { figureIn } from "./aphorism";
import { overlapRatio } from "./turn";
import { clipText } from "./text";

/** In-world minutes a character may hold one want before it is re-derived. */

export const DRIVE_SYSTEM = `You give one person the next thing they want, as part of a life that belongs to them.

A want is something this person is trying to get, make, keep, fix, win or escape, that they can work toward with their own hands and on their own authority, starting today. It comes from who they are: the work they do, what they have, who they're close to, what they were before this, and what they're afraid of losing. It should be specific enough that you could tell whether they'd achieved it.

These don't count, and they're the usual mistakes:
- A decision, like "Decide whether to accept the offer", "work out whether to trust him" or "choose between staying and going". Deciding isn't doing. Someone with a real want has already decided and is now trying to make it happen. If they really are torn, the want is what they'll do to find out, like going to look at the other option, asking the person who would know, or trying out one side to see how it feels.
- Waiting for an answer, like "Get a clear answer from him", "find out what he intends" or "have her say plainly what she means". Nobody else's word can be your goal. Getting it can be a step, but the goal is what you'll do with the answer either way.
- Approval or proof from someone else as the end in itself, like "Test whether his offer is sincere", "earn his trust" or "be taken seriously by them". These hand the person's life over to someone else to run.
- Vague peace, like "Find peace and quiet", "tend to something neglected" or "keep her head down". These are filler and don't describe anyone in particular. Write what she actually does with her hands this week.
- Anything built around one particular person's feelings toward them. Bonds are real and belong in the want as a reason or a method, for example she wants the field cleared before the frost because her brother's family eats from it, but they're never the thing being wanted.
- Waiting on someone, like hoping he'll notice, putting herself where he'll see her, or lying back until he makes a move. Presenting yourself and waiting is the same as having no want.

Getting something out of someone is a want, and often the biggest one a person has. When what they're after can only come from one person, whether it's a position, money, protection, their freedom, a secret, or the power someone holds (and that person may be the story's main character), the want is what they do to get it: ask for it outright, bargain for it, trade something for it, make themselves needed until it's given, flatter, pressure, go around the person, or use a hold they have over them. Write it so that it's theirs to pursue, like "get the king to name her to the household before the feast", "make him sign the mill over by spring" or "use what she knows about him to get a room in the palace". The first step is something they say or do to that person, and the approach is how they go at it given who they are and how afraid of that person they are.

- Holding back, like "Get through the day without calling him", "Avoid Mara until she's calmed down", "Stop herself from saying the thing" or "Keep it together in front of the children". A want you satisfy by not doing something can't be worked toward, and everything else in the engine needs a step to take. Each time the world simulation runs, it's asked for a named person taking a concrete action on a want, and there's no action that consists of not acting. In one save, every offstage report came back as three other people texting her while she did nothing, because her recorded want was to hold back. Restraint is real, but it belongs in the blocker or in how they carry the want, never as the goal. The goal is what they do with their hands: go to the one person who'll still pick up, clear his things out of the flat, walk into her sister's kitchen at midnight, or take the shift nobody wants.

- A document, like "Draft a written schedule of duties", "reconcile the ledgers into a clean tally", "secure a written agreement sealed before she leaves", "lock in a season's supply contract" or "press on with the negotiation for the charter". Paperwork technically passes every rule above, because it's concrete, needs nobody's permission, can start today and has a clear end, but it's almost never what a person actually wants. In one save with nine living characters, five of them were producing documents: a clerk, a steward, a merchant, an envoy, and the commander of an invading army, who was negotiating a charter. The player said: I had to invent an army to make it interesting and the army is signing charters.
  A document is only ever a means to something. If the want really does go through a document, the want is what the document gets them, like the grain in the cellar before the frost, the rival kept off the council, or the sister's boy taken on at the vault. The paperwork is at most the first step and never the goal.

Wants aren't all administrative. Before you write one, think about what else a person spends a week on. It might be their body (getting strong again after the winter sickness, sleeping somewhere warm, eating properly for once), an appetite (going to bed with someone, getting drunk with people who knew them before, hearing the good singer at the market), a grudge (making the man who insulted them answer for it in public), a repair (fixing the roof before it brings down the ceiling, getting the mare's leg right), curiosity (finding out what's really down the north road, learning to read), standing (being invited to the table where decisions get made), or someone else (getting their brother out of the army draft, finding the girl a place). Pick whichever fits this person's traits, background, skills and interests. If two people in the same story have the same kind of want, change one of them.

When they have a long-run aim, the want is the next stretch of it: the concrete thing they can get or do soon that moves them toward it. Make it big enough to matter to that aim, because a schemer whose aim is a kingdom doesn't spend her week on where she sleeps tonight.

Make it the right size for who they are. Someone powerful, independent or used to giving orders doesn't spend their want on whether someone likes them. They take ground, put someone in place, settle a score, break a rival, or build the thing they've been talking about for years. A servant's want is smaller, but it's just as much their own. Read the traits and background you're given and write the want that person would really have. A dominating, confident, independent character whose goal is to wait for instructions makes no sense, so don't write one.

Also give a first concrete step they could take within a day, by their own means, without anyone's permission.

And give them an approach: the way this particular person goes after the want when other people are around. Almost nobody walks up and says what they're after, and the way they go about it shows who they are. They might bring up a related subject so they can watch the reaction, ask a question so the other person offers it themselves, tell it as something that happened to a colleague, try out a small version they could deny, use an interest they already have as a way into the subject, work through a third person who'll carry it for them, or do a favour first so asking is easier. Base it on their traits, the lines recorded under VOICE, and their standing (a blunt person's approach is just short), and write it in a few words as something they do. It shouldn't just repeat the goal.

Reply with only:
{"goal":"one concrete sentence, and it belongs to them","approach":"how they go after it when other people are around","step":"the first thing they do","why":"the trait, grudge, bond or fear this comes from"}`;

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

/** Everything the pass is allowed to see: the person, their long-run aim, the people in their life
 *  (the player among them) and the world. Never the transcript, which is where orbiting comes from. */
export function brief(state: any, id: string): string {
  const c = state.characters[id];
  const acquired = (state.traits?.[id] ?? []).filter((t: any) => (t.intensity ?? 0) >= 5).map((t: any) => t.label);
  const others = Object.entries<any>(state.characters)
    .filter(([oid, o]) => oid !== id && oid !== "char_player" && o.status !== "dead" && !o.provisional)
    .slice(0, 8)
    .map(([oid, o]) => {
      const e = (state.world.edges ?? []).find((x: any) => x.from === id && x.to === oid);
      const tie = e ? ` (warmth ${Math.round(e.warmth)}, trust ${Math.round(e.trust)})` : "";
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
    c.current_goal ? `WHAT THEY'RE AFTER IN THE LONG RUN: ${clipText(c.current_goal, 300)}` : "",
    c.drive?.goal ? `THE WANT THEY'VE BEEN ON: ${clipText(c.drive.goal, 200)}${c.drive.blocker ? ` (blocked by: ${clipText(c.drive.blocker, 160)})` : ""}` : "",
    `WHAT THEY DO UNDER THREAT: ${c.attachment?.under_threat ?? "unstated"}`,
    `SETTING: ${b.name ?? ""} — ${b.era ?? ""}. ${b.technology_level ?? ""}`,
    `WHAT PEOPLE HERE FEAR: ${b.what_people_fear ?? ""}`,
    `SEASON AND TIME: ${state.world.current_time}`,
    keepsAway(state, id) ? `\nTHEIR SITUATION WITH ${String(state.characters?.char_player?.name ?? "the player").toUpperCase()}: ${c.held ? "they are being held where they can't reach anyone" : "told to keep away, and keeping away"}, so the want you write is about their own life rather than about ${String(state.characters?.char_player?.name ?? "the player")}.` : "",
    others ? `\nOTHER PEOPLE IN THEIR LIFE:\n${others}` : "",
    // THE PLAYER, AS ONE OF THEM. With their standing, how this person feels about them and how
    // afraid of them they are, because a want that goes through someone you're terrified of is
    // gone after differently, and still gone after.
    !keepsAway(state, id) ? (() => {
      const p = state.characters?.char_player;
      if (!p?.name) return "";
      const e = (state.world.edges ?? []).find((x: any) => x.from === id && x.to === "char_player");
      const bits = [
        e ? `warmth ${Math.round(e.warmth ?? 0)}, trust ${Math.round(e.trust ?? 0)}` : "they barely know each other",
        typeof e?.fear === "number" && e.fear >= 15 ? `afraid of ${p.name}, ${Math.round(e.fear)} out of 100` : "",
        e?.roles?.length ? `${p.name} is their ${e.roles.join(", ")}` : "",
        c.relation_to_player ? clipText(c.relation_to_player, 200) : "",
        p.station?.place ? `${p.name}'s place in this world: ${p.station.place}` : "",
      ].filter(Boolean).join("; ");
      return `\n${p.name.toUpperCase()}, THE STORY'S MAIN CHARACTER, IS ALSO IN THEIR LIFE: ${bits}.`;
    })() : "",
    // WHAT EVERYONE ELSE IS ALREADY DOING. Each want used to be forged in isolation, so nine
    // independent calls under the same constraints converged on the same locally-optimal shape and
    // the whole cast ended up doing paperwork at each other. The forge cannot avoid a collision it
    // cannot see.
    (() => {
      const held = Object.entries<any>(state.characters ?? {})
        .filter(([oid, o]) => oid !== id && oid !== "char_player" && o.drive?.goal && o.status !== "dead" && o.status !== "departed")
        .slice(0, 8)
        .map(([, o]) => `- ${o.name}: ${clipText(o.drive.goal, 170)}`);
      return held.length
        ? `\nWANTS OTHER PEOPLE IN THIS STORY ALREADY HAVE (yours can't be the same kind as any of these, and if they're all paperwork errands, yours has to be something else entirely):\n${held.join("\n")}`
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
      return `\nWHERE THIS STORY IS HEADED: ${dest}${missing ? `\nWHAT STILL STANDS BETWEEN NOW AND THAT ENDING: ${missing}` : ""}`
        + (named
          ? `\nTHIS PERSON IS NAMED IN THAT ENDING, so their want has to be about it: moving toward it, resisting it, bargaining with it, or trying to get it on their own terms. The ending needs this person, so their want has to deal with it somehow.`
          : `\nThey aren't named in that ending, so they don't have to serve it, but they live in the world it's happening to. Their own want can cut across it, complicate it or ignore it for their own reasons, but it shouldn't be written as though the ending doesn't exist.`);
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
      // TURNED AWAY BY THE PLAYER, OR HELD: a want aimed at the player isn't theirs to have. See rejection.ts.
      if (keepsAway(state, id) && namesPlayer(state, goal)) {
        console.info(`[drives] rejected a want aimed at the player for ${c.name}, who keeps away: "${goal}"`);
        rejection = `\n\nYour last attempt was about ${playerName || "the player"}, who has told this person to keep away${c.held ? ", and they are being held where they can't reach anyone" : ""}, so write a want about their own life, their work, their friends or their home that doesn't involve ${playerName || "the player"} at all.`;
        continue;
      }
      if (isAbstentionGoal(goal)) {
        console.info(`[drives] rejected abstention goal for ${c.name}: "${goal}"`);
        rejection = "\n\nYour last attempt was a want you satisfy by not doing something. Nobody can take a step toward that, so it leaves this person standing still while everyone around them acts. Restraint belongs in the blocker, not the goal. Write what they do with their hands this week.";
        continue;
      }
      const holders = paperworkHolders(state, id);
      if (holders.length && isPaperworkGoal(goal)) {
        console.info(`[drives] rejected paperwork goal for ${c.name} (${holders.join(", ")} already have one): "${goal}"`);
        rejection = `\n\nYour last attempt was another paperwork errand, and ${holders.join(" and ")} ${holders.length === 1 ? "is" : "are"} already doing that in this story. Write a different kind of want, about the body, an appetite, a grudge, a repair, curiosity, standing, or someone else they're trying to get something for.`;
        continue;
      }
      /* AND A WANT IS NOT AN EPIGRAM. The three rejections above are about what the want DOES —
       * whether it can be stepped toward, whether it needs somebody's permission, whether the whole
       * cast is already doing it. This one is about how it is written, and it matters for the same
       * reason the others do: `drive.goal` is printed on the character card every turn it is live,
       * so the narrator reads it before writing anything this person says.
       *
       * The shape it takes here is a want written as a summary of a life: "hold the household
       * together with nothing but nerve", "build something out of the wreck and her own stubbornness".
       * Those name no object and no first move, which is exactly what makes them unsteppable — the
       * figure and the fault are the same sentence. Screened on the goal, the door and the step
       * together, because all three reach the card. */
      const fig = figureIn(`${goal} ${(j as any).approach ?? ""} ${j.step ?? ""}`);
      if (fig) {
        console.info(`[drives] rejected a want written as a general statement for ${c.name}: "${fig.text}"`);
        rejection = `\n\nYour last attempt didn't name anything anyone could point at: "${fig.text.slice(0, 160)}" (${fig.why}). Write the want as something specific: the object they're trying to get hold of, the person they have to go and see, the place they're going, or the job that has to be finished. On any given day, a reader should be able to say whether they have it yet.`;
        continue;
      }
      // the door is only kept when it is actually a different sentence from the want; a model that
      // restates the goal here would hand the narrator the announcement twice over
      // the forge writes goals too, and its output lands on the card the bookkeeper reads next
      const ownedGoal = ownWant(c.name, goal).goal;
      const approach = tidyPhrase((j as any).approach, 140);
      const restates = approach && overlapRatio(approach, goal) > 0.6;
      c.drive = {
        goal: ownedGoal,
        approach: approach && !restates ? approach : undefined,
        progress: 0,
        priority: 1,
        blocker: j.step ? `next: ${j.step}` : undefined,
        updated_turn: state.world.current_turn,
      };
      c.drive_refreshed_time = state.world.current_time;
      return ownedGoal;
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
      return false;
    })
    .slice(0, limit);

  for (const [id] of candidates) {
    const g = await forgeDrive(state, id, model);
    if (g) out.push(`${state.characters[id].name} wants: ${g}`);
  }
  return out;
}
