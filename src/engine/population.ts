/**
 * POPULATION — the people who are not characters.
 *
 * The engine models a cast: carded, remembered, capped by max_central_characters because
 * full-fidelity people are expensive. That cap is correct. What was missing is the OTHER tier —
 * the ordinary human traffic that makes a place a place. A `Place` had `contains`, which holds
 * cast members only, so a market with no cast member standing in it was, to the narrator, an
 * empty room. PRESENT is law and PRESENT was empty, and the contract says the state is true and
 * your inventions are not. So the narrator did the correct thing and wrote a deserted world.
 *
 * A player who built a town with a market, a hospital, walls and a beach walked through all of it
 * alone, sat on a board in the river for four turns because there was nobody to talk to, and then
 * unmade the town.
 *
 * These people are never carded and never remembered. They are weather with faces: a scale figure
 * and one line on who they are, so a scene can have a crowd in it without the crowd becoming
 * sixteen new records with drives and voice cards.
 */
import type { Place, SaveState } from "./types";
import { minutesBetween } from "./time";

export interface Population { scale: number; who: string }

/**
 * Ordinary daytime traffic implied by what a place IS, for places authored before the field
 * existed (every place in every save to date) or created without one.
 *
 * Matched against the NAME ONLY, most specific first. Matching the description as well was the
 * obvious thing and it is wrong: descriptions constantly mention OTHER places — "a soot-stained
 * building near the city wall", "a manor on the outskirts of the city", "the forest north of the
 * city" — and every one of those came back as four thousand hawkers. A place's name is what it is;
 * its description is largely where it is. Inference is a backfill, so it is better for it to say
 * nothing than to put a crowd in a forest; anything it misses can be authored explicitly.
 */
const KINDS: { re: RegExp; scale: number; who: string }[] = [
  { re: /\b(forest|woods?|moor|waste|wilderness|mountains?|wilds)\b/i, scale: 0, who: "" },
  { re: /\b(warrens?|slums?|rookery|alleys?)\b/i, scale: 150, who: "the poor, beggars, thieves watching from doorways, families crowded into rooms" },
  { re: /\b(docks?|harbou?r|quay|wharf|pier)\b/i, scale: 120, who: "dockhands, bargemen, fishwives, factors counting cargo, boys hauling rope" },
  { re: /\b(inn|tavern|alehouse|pub)\b/i, scale: 30, who: "drinkers, travellers, a serving girl, someone asleep in a corner" },
  { re: /\b(temple|cathedral|church|shrine|chapel)\b/i, scale: 60, who: "worshippers, penitents, a sexton, someone praying who does not want to be spoken to" },
  { re: /\b(hospital|infirmary|almshouse)\b/i, scale: 40, who: "the sick and those sitting with them, attendants moving between beds" },
  { re: /\b(gates?|walls?|garrison|barracks)\b/i, scale: 20, who: "guards on watch, travellers waiting to pass, a serjeant with a slate" },
  { re: /\b(markets?|bazaar|squares?|fair)\b/i, scale: 200, who: "stallholders, buyers haggling, porters, cutpurses working the press, children underfoot" },
  { re: /\b(castle|palace|keep|citadel)\b/i, scale: 80, who: "servants, guards on rotation, petitioners waiting, clerks with errands" },
  { re: /\b(forge|smithy|workshop|mill|bakery|brewery)\b/i, scale: 4, who: "whoever works here and whoever is waiting on the work" },
  { re: /\b(farms?|fields?|steading|orchard)\b/i, scale: 15, who: "labourers at work, a foreman, children carrying water" },
  { re: /\b(beach|shore|strand)\b/i, scale: 12, who: "a few people walking, someone gathering shellfish, children at the waterline" },
  { re: /\b(roads?|track|highway|bridge)\b/i, scale: 10, who: "travellers passing, a carter, someone walking the other way" },
  { re: /\b(estate|manor|hall|house|cottage|lodge)\b/i, scale: 8, who: "household staff going about the day's work" },
  { re: /\b(cities|city|capital)\b/i, scale: 4000, who: "citizens on their own business — hawkers, porters, clerks, beggars, children, off-duty guards" },
  { re: /\b(towns?|villages?|hamlets?|settlements?)\b/i, scale: 400, who: "townsfolk going about the day — tradesmen, wives at the well, carters, idlers on the step" },
];

/** Explicit "nobody lives here" markers — an automated place, a ruin, a place stated as empty. */
const DESERTED = /\b(deserted|abandoned|empty|ruin(s|ed)?|no one (lives|works|is)|nobody|automated|autonomous|unmanned|uninhabited|razed|burn(ed|t) out)\b/i;

/**
 * What is ordinarily here. An explicit `population` always wins — including an explicit zero,
 * which is how a place states that it really is deserted. Otherwise inferred from the name;
 * unrecognised places get nothing rather than a guess.
 */
export function populationOf(place: Place | undefined): Population | null {
  if (!place) return null;
  if (place.population) return place.population.scale > 0 ? place.population : null;
  const name = place.name ?? "";
  // The description gets exactly one vote, and it is a veto: a place that says it is empty is.
  if (DESERTED.test(name) || DESERTED.test(place.description_facts ?? "")) return null;
  for (const k of KINDS) {
    if (k.re.test(name)) return k.scale > 0 ? { scale: k.scale, who: k.who } : null;
  }
  return null;
}

/** "about 200 people" → a phrase a prompt can use without pretending to a census. */
function scaleWord(n: number): string {
  if (n >= 2000) return "thousands of people";
  if (n >= 500) return "many hundreds of people";
  if (n >= 150) return "a couple of hundred people";
  if (n >= 50) return "dozens of people";
  if (n >= 15) return "a dozen or two people";
  return "a handful of people";
}

/** One line per place for the LOCATIONS block, so the world reads as inhabited everywhere. */
export function populationLine(place: Place): string {
  const p = populationOf(place);
  return p ? ` — ordinarily ${scaleWord(p.scale)} about: ${p.who}` : "";
}

/**
 * The directive for the room the player is standing in. This is the one that matters: PRESENT
 * lists cast members and nothing else, so without this the narrator's only honest reading of a
 * populated market with no cast member in it is that the market is empty.
 *
 * It licenses anonymous people explicitly, and says the thing that keeps them anonymous — the
 * bookkeeper cards anyone who speaks under a capitalised name, so the crowd stays unnamed unless
 * the player reaches for someone in particular.
 */
export function crowdDirective(state: SaveState): string {
  const place = state.world.places[state.world.player_location];
  const pop = populationOf(place);
  if (!pop) return "";
  const castHere = state.world.present.filter((id) => id !== "char_player" && state.characters[id]).length;
  const alone = castHere === 0;
  return `\nTHE PLACE IS INHABITED — ${place.name} ordinarily has ${scaleWord(pop.scale)} about it: ${pop.who}. These are NOT characters and never will be; they are the texture of a populated place, and they exist whether or not anyone from the cast is standing here.${alone ? ` No one from the cast is in this scene, and that does NOT mean the player is alone — it means nobody the story tracks is here. Do not write this place as deserted, silent, or emptied unless the state says it has been emptied.` : ""} Let them be present the way people actually are: work going on, voices carrying, someone in the way, someone watching, someone who wants something small. They may act, react, be spoken to, and answer. Keep them ANONYMOUS — trades, roles and descriptions, never a capitalised name and never a personal history — so they stay crowd instead of becoming cast. If the player singles someone out and keeps them, the bookkeeper will make them real.`;
}

/* ─────────────────────────── AN OPEN CALL GETS ANSWERED ───────────────────────────
 *
 * The player stood in the Forum of a city of a million, having that morning abolished slavery and
 * raised a school out of light in front of witnesses, and said: "Is there any woman here that would
 * not manipulate me and would be genuinely in love with me? I'm open for dating. If there is one
 * around please come and say hi." Nobody came. He said it again — "go on and spread the news, I'm
 * interested in a partner" — and nobody came. On the third turn he put the words directly into every
 * mind in Rome, walked home, and sat down at his own gate to wait. The prose for that turn:
 *
 *     The street gate stayed shut. No one knocked. […] The gate stayed shut. The garden was still.
 *
 * and the world's own report of the same hours was four separate people deciding not to approach —
 * a baker's boy who thought better of offering bread, a freedwoman who crossed the lane, a matron
 * telling her husband nobody went near the villa and that was the right decision.
 *
 * This is not a verdict the world reached. It is the only outcome the engine could produce, because
 * there were exactly two channels by which any new person could reach the player and neither one
 * was open. `arrivals_pending` fires only for an ALREADY-CARDED character whose recorded drive
 * already names him. `inbound` fires only when the offstage pass volunteers a contact, and the
 * offstage pass is told in its first line that no event may exist because the player exists and no
 * stranger may develop an opinion about him. The crowd — the one tier with a million people in it —
 * is licensed to react but forbidden a name: "keep them ANONYMOUS […] If the PLAYER singles someone
 * out and keeps them, the bookkeeper will make them real." Every route required the player to reach
 * first. A call is the one act that inverts that, and nothing in the engine could hear one.
 *
 * So: hear it. A call put to a population is held on the world state until it is answered, and while
 * it stands the narrator is told how many people it reached and that some of them respond.
 *
 * WHAT STANDING DOES HERE IS CHOOSE WHO AND WHY — NEVER WHETHER. This is the whole point. A feared
 * power's open offer is answered by the desperate, the ambitious, the ones with nothing left to
 * lose, families pushing a daughter forward, opportunists, zealots, and somebody's agent — a
 * different crowd, arriving for worse reasons, and arriving. Silence is what a call to five people
 * in a small room may get. It is not what a call to a city gets, in any direction, ever.
 */

/** Addressed to an indefinite plurality: to whoever, rather than to somebody. */
const OPEN_AUDIENCE = /\b(any\s?(?:one|body)|any (?:wo)?m[ae]n\b|any (?:person|girl|lady|soul|folk)|every\s?(?:one|body)|all of (?:you|them|rome|the \w+)|the (?:whole|entire) (?:city|town|village|country|world|empire)|every (?:mind|head|ear|household)|whoever|whomever|the crowd|the people|no matter who)\b/i;
/** A call, not a remark: an offer, an invitation, a summons, an advertisement, a proclamation. */
const CALL_ACT = new RegExp("\\b(" + [
  // come to me
  `come (?:here|forward|find|see|and|to me|say)|step forward|say hi|speak up|approach me|present (?:yourself|themselves)|apply|answer me`,
  `let (?:me|her|him|them) know|make (?:yourself|themselves) known`,
  // I am offering / I am looking
  `i'?m (?:open|looking|interested|seeking|available)|i am (?:open|looking|interested|seeking|available)`,
  `looking for (?:a|an|someone|anyone)|seeking (?:a|an|someone|anyone)|i want (?:a|an|someone|anyone)`,
  `offer(?:ing)? (?:my|a) (?:hand|marriage|place|position|work|job|reward)|invit(?:e|ing)|summon(?:s|ing)?`,
  // put it about
  `proclaim|announce|broadcast|spread the (?:news|word)|put out (?:a|the) (?:word|call)|call(?:ing)? for (?:a|an|any|volunteers)|hiring|reward for`,
  // "Anyone want to talk. Anyone at all. Anyone here worth actually talking to" — put to a forum of
  // five thousand, and the plainest form a call takes. It missed the list above on the first draft.
  `(?:want|wants|wanna|care|cares) to (?:talk|chat|speak|come|join|help|work|meet)`,
  `worth (?:actually )?(?:talking|speaking) to|is there (?:a|an|any)\\b`,
].join("|") + ")\\b", "i");
/** Reached beyond the room the player is standing in. */
const BROADCAST = /\b(broadcast|proclaim|announce(?:d|ment)?|every (?:mind|head|ear|household)|the (?:whole|entire) (?:city|town|country|world|empire)|across the (?:city|town|country|empire)|spread the (?:news|word)|criers?|herald)\b/i;

/** In-world minutes a call stays live. A city hears within a day; stragglers arrive on the second. */
const CALL_WINDOW_MIN = 48 * 60;

/**
 * Did the player just put something to the room at large? Returns the reach — how many people heard
 * it — or 0 for anything that is not an open call.
 */
export function openCallReach(state: SaveState, action: string): number {
  const a = String(action ?? "");
  if (!OPEN_AUDIENCE.test(a) || !CALL_ACT.test(a)) return 0;
  const here = populationOf(state.world.places[state.world.player_location])?.scale ?? 0;
  if (!BROADCAST.test(a)) return here;
  // Beyond the room: everywhere the engine knows about, which is the closest thing it has to
  // "the city". A broadcast that reaches nowhere the state models still reaches the room.
  const everywhere = Object.values(state.world.places)
    .reduce((n, p) => n + (populationOf(p)?.scale ?? 0), 0);
  return Math.max(here, everywhere);
}

/** How many answer, and over what stretch. Deliberately a band, not a number — the narrator needs a
 *  floor that is not zero and a sense of scale, and a precise headcount would only read as a quota. */
function answerBand(reach: number): { floor: string; pace: string } {
  if (reach >= 2000) return { floor: "dozens over the day, and the first of them within the hour", pace: "They do not all arrive at once. They arrive in a trickle that does not stop, and it becomes its own problem." };
  if (reach >= 200) return { floor: "several over the day, and at least one soon", pace: "They arrive spread out, one and then another, each with their own reason." };
  if (reach >= 25) return { floor: "one or two", pace: "It takes a little while — long enough for someone to decide, and to talk themselves into crossing the room." };
  return { floor: "possibly one, possibly nobody", pace: "A handful of people is small enough that a call can genuinely go unanswered; if it does, that is a real outcome and not an oversight." };
}

/**
 * The directive for a call that is still standing. Empty when there is no open call, when the window
 * has run out, or when enough people have already answered it.
 */
export function openCallDirective(state: SaveState): string {
  const call = state.world.open_call;
  if (!call) return "";
  const elapsed = minutesBetween(call.time, state.world.current_time);
  if (elapsed > CALL_WINDOW_MIN) return "";
  const band = answerBand(call.reach);
  const turnsWaiting = (state.world.current_turn ?? 0) - call.turn;
  // The escalation exists because the failure it was written for was a player asking three times.
  const unanswered = turnsWaiting >= 1 && call.answered === 0 && call.reach >= 25
    ? ` NOBODY HAS ANSWERED IT YET, ${turnsWaiting === 1 ? "a turn" : `${turnsWaiting} turns`} on. That is overdue rather than atmospheric: SOMEONE ANSWERS IT THIS TURN, on the page, close enough to be spoken to.`
    : "";
  return `\nAN OPEN CALL IS STANDING — the player put this to everyone who could hear, not to any one person: "${call.what.slice(0, 200)}". It reached roughly ${scaleWord(call.reach)}, and it has not been withdrawn.`
    + ` A call at that reach is answered by ${band.floor}. ${band.pace}`
    + ` WHO answers and WHY is where their standing with the player bites — awe, need, ambition, calculation, loneliness, someone sent by somebody else, someone who wants the thing on offer and does not much care who is offering it. If the community fears him, then the people who come are the ones fear does not stop, and they come for worse reasons; that is a different scene, not an empty one.`
    + ` What is NOT available is the whole population declining in unison. Crowds do not agree. Whatever the general mood, some fraction of ${scaleWord(call.reach)} acts against it, because that is what a number that size means.`
    + ` Anyone who answers must be a real person with their own reason for coming, named if they speak more than a line — the bookkeeper will card them.${unanswered}`;
}

/** Record a call the player just made, and clear one they have withdrawn or that has been answered
 *  enough. Called once per turn from the turn loop, after the action is known. */
export function trackOpenCall(state: SaveState, action: string): void {
  const reach = openCallReach(state, action);
  if (reach > 0) {
    state.world.open_call = {
      what: String(action).trim().slice(0, 300),
      turn: state.world.current_turn ?? 0,
      time: state.world.current_time,
      reach,
      answered: 0,
    };
    return;
  }
  const call = state.world.open_call;
  if (!call) return;
  if (minutesBetween(call.time, state.world.current_time) > CALL_WINDOW_MIN) delete state.world.open_call;
}

/** Somebody new turned up while a call was standing. Enough of them closes it. */
export function creditCallAnswer(state: SaveState, howMany = 1): void {
  const call = state.world.open_call;
  if (!call) return;
  call.answered += howMany;
  // A call to a room is satisfied by one person; a call to a city keeps producing arrivals, but the
  // engine stops NAGGING about it once a few have come — the story has what it needed to continue.
  if (call.answered >= (call.reach >= 200 ? 3 : 1)) delete state.world.open_call;
}
