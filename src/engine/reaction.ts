/**
 * WHAT THE PLAYER JUST DID IS THE SCENE.
 *
 * From a save, turn 35. The player types: *I make a cart and a biometric safe next to the hotel.
 * "This is roughly 500 lbs of solid gold."* — matter created from nothing, in 63 BC, in front of two
 * women, in a world whose own canon reads "Sorcery — maleficium — is real in everyone's mind and
 * punishable by death."
 *
 * What the engine told the narrator on that turn:
 *
 *     PRESSURE 6/10 (obstacle) — source: thread: Ownership and tax liability of the hotel.
 *     NO NEW INCIDENT THIS TURN — no rider, no messenger, no alarm, no smoke...
 *
 * What the narrator wrote: an argument about whether to keep savings under the floor, with a remark
 * about a beetle in it. What the bookkeeper recorded as the witness's inner state: `impressed_by_the
 * _gold`. Half a ton of gold out of empty air, filed as a quantity of money.
 *
 * THREE THINGS FAILED AND THEY ARE ALL THE SAME THING.
 *
 *   · `selectBeat` chooses what a scene is about from due consequences, faction clocks, threads and
 *     NPC drives. The player's own action is not a candidate and never has been. So the "source"
 *     line names something else no matter what the player does, and on this turn it named a
 *     bookkeeping dispute last touched three turns earlier.
 *   · `detectPowerTier` is a regex over recent prose hunting for "godlike", "unmade a star",
 *     "teleported him", "impervious". The prose said "The cart came up beside the hotel with the
 *     safe already seated on it" — because the prose rules correctly forbid purple language. So the
 *     engine can only notice the impossible when it is described impossibly, and it is instructed
 *     not to describe things impossibly. The two rules cancel, the tier stays `mortal`, and
 *     EARNED_RESPONSE — the block written for exactly this situation — never fires.
 *   · With the scene declared to be about tax liability and nothing permitted to arrive, the
 *     narrator has nothing concrete to answer, so it fills the space with texture and folk wisdom.
 *     THE MAXIMS ARE DOWNSTREAM OF THIS. A narrator told there is nothing to react to will find
 *     something to say, and what it finds is a proverb.
 *
 * This module is the part that needs no detector, which is why it is the part to trust. It does not
 * try to work out whether an act was impossible, magical, or large; it asserts something that is
 * always true and that the engine had never once said: THE PLAYER ACTED, AND THE SCENE ANSWERS THAT
 * BEFORE IT ANSWERS ANYTHING ELSE. A standing thread is background to the thing that just happened
 * in the room, not the other way round.
 */
import type { SaveState, ActionMode } from "./types";

/**
 * The part of the player's input that was a PHYSICAL ACT.
 *
 * The channels are already established: "double quotes" are spoken aloud, *asterisks* are private
 * thought nobody can perceive, plain text is action. Only the plain text is something the room can
 * see happen, so only the plain text is something the room has to answer.
 */
export function physicalAct(action: string): string {
  return String(action ?? "")
    .replace(/[""][^""]*[""]/g, " ")   // speech — heard, not witnessed
    .replace(/"[^"]*"/g, " ")
    .replace(/\*[^*]*\*/g, " ")          // private thought — imperceptible by construction
    .replace(/\(\([^)]*\)\)/g, " ")      // a search directive, not story text
    .replace(/\s+/g, " ")
    .trim();
}

/** Long enough to be an act rather than a stage direction attached to a line of dialogue. */
const ACT_FLOOR = 18;

/**
 * WHAT EVERYONE IN THE ROOM CAN SEE ON THE PLAYER, and what this world is able to make.
 *
 * A player rode a self-balancing electric vehicle up to an inn in iron-age Latium, wearing a
 * Versace suit, and the innkeeper quoted him a room rate and wondered where he would park it. Both
 * halves of that contradiction were sitting in the save: `wearing` said "Versace suit, white shirt
 * open at neck" and `technology_level` said "ox-plows, hand-mills, oil lamps, wax tablets". Nothing
 * had ever compared one against the other, so an anachronism became an ordinary noun the moment it
 * entered state and stayed one forever.
 *
 * This lived inside reactionDirective, which returns nothing at all unless the player's input
 * contains a physical act of at least ACT_FLOOR characters. So on every turn the player spoke,
 * thought, or did something short — "I nod", "I sit down", most of a conversation — the narrator
 * was told nothing about what the player was visibly wearing or carrying, and the comparison it is
 * supposed to make never happened. What somebody has on them is true on all of those turns too, so
 * it is its own thing now, and the digest prints it every turn.
 *
 * AND THEN IT READ THE WRONG THREE FIELDS AND WENT DARK.
 *
 * Rome, 41 AD, every turn of the save. `wearing: []`, `inventory: []`, `appearance_now: ""` — and
 * `appearance_facts` reading "He wears a modern t-shirt and jeans, now filthy and torn, and carries
 * an iPhone in an OtterBox case." The three fields this function reads are the ones the Forge does
 * not fill and the simulator only writes when something CHANGES; the one that is populated at
 * character creation, always, is the one it never looked at. So the block above — the whole
 * anachronism comparison, the reason it exists — returned the empty string on every turn of a
 * playthrough whose entire premise is a man from 2026 standing on the Tiber bank with a phone.
 *
 * THE OTHER HALF: A WORD IS AN ANACHRONISM TOO.
 *
 * The failure that surfaced it was not an object at all. The player typed "if you have a sheet of
 * paper and a pencil I can draw it out", and a blacksmith in 41 AD said "Paper and a pencil" and
 * then added a detail of his own — not here, the muck gets into everything. Neither thing exists:
 * paper is centuries away and a graphite pencil is fifteen hundred years away. He did not merely
 * fail to object; by repeating the words back and building on them he made both objects real, and
 * they stay real for the rest of the story, because the record now shows a Roman who has heard of
 * them.
 *
 * The engine did have a rule aimed at this and it is aimed one way only: "Nobody NAMES a thing this
 * world does not contain" governs what a character produces. Nothing governed what a character
 * ACCEPTS. Comprehension is the direction the anachronism actually travels when the player is the
 * one out of time, and it is the direction that was never covered.
 */
/* A THING IN A POCKET IS NOT A THING ON DISPLAY — and this block put it there.
 *
 * Turning the guard on was right; the header it turns on under was not. It reads WHAT HE HAS ON
 * HIM, WHICH THEY CAN ALL SEE, and the card it now reads ends "…and carries an iPhone in an
 * OtterBox case". So from the turn that fix landed, the narrator was told every turn that everyone
 * in the room could see a phone that was in a pocket. Within a dozen turns a woman he had never
 * shown it to was looking at "the phone in his hand" — which he had not taken out; the narration
 * produced it — then at "the phone clipped to his belt", and finally telling him "I saw the light
 * it makes. Any woman with eyes saw it. You think cloth hides a thing like that?"
 *
 * Carried and worn are different states and the block now says which is which. The concealed line
 * is the one that matters: a thing nobody has seen can still be revealed, and a thing everybody has
 * seen can never be un-seen, so when the record is ambiguous the safe reading is the closed one.
 */
const CARRIED_CLAUSE = /\s*(?:,\s*)?(?:and\s+)?(?:he\s+|she\s+|they\s+)?(?:carries|carrying|keeps|has)\b[^.]*\b(?:pocket|case|pouch|bag|satchel|sheath|holster|belt|inside|under)\b/i;
/** An inventory line that names where a thing is kept, rather than a thing held in the open. */
const PUT_AWAY = /\b(?:pocket|case|pouch|bag|satchel|sheath|holster|hidden|concealed|tucked|wrapped|in (?:his|her|their) (?:boot|sock|waistband|shoe|hair)|under (?:his|her|their) (?:cloak|coat|tunic|robe|shirt|clothes)|inside (?:his|her|their) (?:cloak|coat|tunic|robe|shirt|jacket))\b/i;

export function visibleOnPlayer(state: SaveState): string {
  const cond = state.condition["char_player"];
  const inv = (cond?.inventory ?? []).map((i) => i?.name).filter(Boolean) as string[];
  const carried = [
    ...(cond?.wearing ?? []),
    ...inv.filter((n) => !PUT_AWAY.test(n)),
  ].filter((x) => String(x).trim()).slice(0, 6);
  const stowed = inv.filter((n) => PUT_AWAY.test(n)).slice(0, 4);
  const p = state.characters["char_player"];
  // appearance_now is what CHANGED; appearance_facts is what is always true of this body and what it
  // is dressed in, written at creation and never blank. Prefer the live field, fall back to the
  // permanent one — the alternative is the guard reading three fields that are usually empty.
  //
  // AND TAKE THE FALLBACK FROM THE END. A Forge-written appearance runs hair, eyes, skin, build,
  // one distinguishing mark, and THEN what they are wearing and carrying — in that order, every
  // time. The anachronism is in the tail by construction, so slicing this from the front trims off
  // the iPhone and keeps the hazel eyes. The save this was found on ran to 295 characters against a
  // 300-character cap; one more clause about his build and the phone would have been cut.
  const now = String(p?.appearance_now ?? "").trim();
  const facts = String(p?.appearance_facts ?? "").trim();
  const looked = now || (facts.length > 320 ? `…${facts.slice(-320)}` : facts);
  // Split the appearance at the clause that says where a thing is KEPT. Everything before it is
  // what a person across the street can see; everything from it on is inside a pocket or a case.
  const cut = looked.search(CARRIED_CLAUSE);
  const look = (cut >= 0 ? looked.slice(0, cut) : looked).trim().replace(/[,;\s]+$/, "");
  const hidden = [cut >= 0 ? looked.slice(cut).trim().replace(/^[,;\s]+|\.$/g, "") : "", ...stowed].filter(Boolean);
  const tech = String(state.world_bible?.technology_level ?? "").trim();
  const seen = [look.slice(0, 340), ...carried].filter(Boolean).join("; ");
  if ((!seen && !hidden.length) || !tech) return "";
  const him = String(p?.name ?? "").trim() || "the player";
  const away = hidden.length
    ? `\nTHINGS HE HAS ON HIM THAT ARE PUT AWAY, WHICH NOBODY HERE HAS SEEN: ${hidden.join("; ").slice(0, 240)}.
Something in a pocket, a case or a bag isn't in the room. Nobody here knows it exists, so nobody looks at it, mentions it, asks about it or reacts to it. Being written on this line doesn't make it seen; only the prose showing him take it out does, either this turn or in a turn already written. If he has taken it out before, they remember seeing something they couldn't name, but they don't know what it does, never learned what it's called, and can't describe how it works. Nobody's clothes are see-through.`
    : "";
  return `\n${seen ? `WHAT HE HAS ON HIM IN PLAIN SIGHT: ${seen}.\n` : ""}${away ? away.slice(1) + "\n" : ""}This is what this world can do, and nothing more: ${tech.slice(0, 240)}
Compare those two lines. Anything he has on him that this world couldn't make, has no name for and has never seen isn't background detail, and it doesn't become ordinary just because it has been mentioned before. It's ordinary to him and to nobody else here. Someone coming across it has no word for it, so they reach for the nearest thing they do know and get it wrong: they call it after the closest object in their own life, or a god, or a trick, or an illness. They might refuse to look at it, or they might not be able to stop looking at it. They don't put a price on it, put it aside, or treat it as part of the errand they were already on.
Compare the same two lines with what he says, too. ${him} talks from a world nobody here has seen, and a word for something this world doesn't contain doesn't make that thing real by being said out loud. When he names one, whether it's a material, a tool, a trade, a machine, a measurement, a sum or an idea, the people here don't know what he means, because there's nothing in their lives for the word to attach to. Each of them reacts to not knowing it, in a way that fits who they are: they ask him what it is, repeat it back as a question, guess out loud and get it wrong, assume it's a word from his own country, or decide he's talking nonsense and say so. Whichever it is, they're answering him and what he just said, and they stay on it until they've had their say. Nobody changes the subject to something from their own day. None of them agrees with it, repeats it back as something they know, names a price for it, or adds a detail of their own, because agreeing even once makes the object part of this world for good, and every later turn will treat it as real.`;
}

/**
 * The directive. Deliberately makes no claim about magnitude — it does not know and does not need
 * to. It says what the act was, requires the scene to answer it, and points each present character
 * at their own state and at what this world holds to be true. When the act was ordinary that costs
 * a sentence of prose; when it was a miracle in a world that executes sorcerers, the canon is right
 * there in the same context and the reaction follows from it.
 */
export function reactionDirective(state: SaveState, action: string, mode: ActionMode): string {
  if (mode === "think") return "";          // nobody can perceive it; there is nothing to answer
  const act = physicalAct(action);
  if (act.length < ACT_FLOOR) return "";
  const present = (state.world.present ?? [])
    .map((id) => state.characters[id]?.name)
    .filter(Boolean) as string[];

  const who = present.length
    ? `${present.join(", ")} ${present.length === 1 ? "is" : "are"} in the room and ${present.length === 1 ? "saw" : "each saw"} it.`
    : `Nobody is here to see it, so the world's response is the place itself and whatever it does in reply.`;

  const anachronism = visibleOnPlayer(state);

  return `\n[WHAT THE PLAYER JUST DID. THE SCENE RESPONDS TO THIS FIRST.
"${act.slice(0, 300)}"
${who}${anachronism}
This is the biggest thing that has happened in this scene, and it comes before any ongoing thread, clock or errand mentioned above. Those are the background of the room, and this happened in the room. Whatever the pressure line says does or doesn't arrive from outside, it doesn't give you permission to write past this.
HOW THEY RESPOND: each character present reacts out of their own state, their own history with the player, and (this is the part that gets skipped) what this world holds to be true. Check the act against the established facts and the world rules you were given. If what the player just did is impossible here, forbidden here, or punished here, then that's the biggest fact in the room and everyone in it knows it. They don't take it in as ordinary, and they don't need it explained to them. If it's unremarkable here, a shrug is the realistic reaction.
There are two mistakes, and both have been caught in play. Don't carry on with the previous topic as if nothing happened: if the scene was an argument about money before the act, it can't still be an argument about money afterwards, with the act as a point in the debate. And don't turn the act into a figure of speech, a lesson, or a chance for someone to philosophise. They're looking at something that just happened, and what a person does with something that just happened is look at it, name it, back away from it, reach for it, or ask what it is.]`;
}

/**
 * WHO WALKED TO WHOM.
 *
 * "You followed me to the docks," she said. "I came because you were walking away from the only
 * thing I asked of you." The travel log says the player left the Forum on turn 36 and the docks are
 * where he went; she was in the Forum with him and is at the docks now, which means she came after
 * him. He typed, twice, that she had followed HIM, and got told twice that he had followed her.
 *
 * Nothing was ever wrong in the state — `travel_log` records every place the player moved to and
 * the turn he moved, and `present_prev` records who was standing with him before. It was simply
 * never handed to the narrator, so who arrived where was decided fresh each turn by whichever
 * reading made the current sentence work.
 */
export function arrivalOrder(state: SaveState): string {
  const log = state.travel_log ?? [];
  const last = log[log.length - 1];
  if (!last) return "";
  const turn = state.world.current_turn ?? 0;
  const since = turn - last.turn;
  if (since > 12) return "";                    // long settled here; nobody is "newly arrived"
  const here = state.world.places[state.world.player_location]?.name;
  if (!here || last.place !== state.world.player_location) return "";
  // Anyone who was standing with him at the previous place and is standing with him now did not
  // summon him — they came along, or came after.
  const camePrev = new Set(state.world.present_prev ?? []);
  const withHim = (state.world.present ?? [])
    .filter((id) => camePrev.has(id))
    .map((id) => state.characters[id]?.name)
    .filter(Boolean) as string[];
  const from = log.length > 1 ? state.world.places[log[log.length - 2].place]?.name : "";
  return `\nWHO CAME TO WHOM (from the record of who moved where; this is settled, and no line of dialogue can contradict it): the player walked to ${here}${from ? ` from ${from}` : ""}${since === 0 ? " this turn" : ` ${since} turn${since === 1 ? "" : "s"} ago`}, so he chose where to meet.${withHim.length ? ` ${withHim.join(", ")} ${withHim.length === 1 ? "was" : "were"} with him before he moved and ${withHim.length === 1 ? "is" : "are"} here now, so ${withHim.length === 1 ? "she or he" : "they"} came after him or with him, and may say so. Nobody here says the player followed them to this place, because he didn't.` : ""}`;
}

/**
 * THE WORLD HAS TO KEEP KNOWING.
 *
 * The directive above governs the turn the act happens on. What kept the engine from ever building
 * on it is that nothing was written down: `power_witnessed` stayed null, no canon entry appeared,
 * and by the next turn the only trace of a miracle was a memory saying a safe had been added.
 *
 * The bookkeeper is asked directly now (see `unexplained` in the simulator contract) rather than
 * having a regex guess from adjectives — the same lesson as `traits_expressed`, where the model's
 * semantic read replaced string-matching and was immediately better. This applies its answer.
 */
export function applyUnexplained(
  state: SaveState,
  un: { what?: string; witnesses?: string[] } | undefined,
  turn: number,
): string[] {
  const what = String(un?.what ?? "").trim();
  if (!what) return [];
  const log: string[] = [];

  // The world's standing read of the player as a power. Stamped from a judgement rather than from
  // whether the prose happened to use the word "godlike".
  const prev = state.power_witnessed;
  if (!prev || prev.tier === "mortal" || prev.tier === "empowered") {
    state.power_witnessed = { tier: "mythic", turn };
    log.push(`the world has seen you do something it can't explain.`);
  } else {
    state.power_witnessed = { tier: prev.tier, turn };   // refresh the clock; do not escalate on its own
  }

  // Everyone who saw it remembers seeing it, at an importance that survives the memory cap. This is
  // what was missing: the witnesses' memories recorded a safe arriving, not a man making one.
  const byName = new Map<string, string>();
  for (const [id, c] of Object.entries(state.characters)) {
    if (id !== "char_player") byName.set(String(c.name ?? "").toLowerCase(), id);
  }
  const ids = (un?.witnesses ?? [])
    .map((w) => byName.get(String(w).toLowerCase().trim()))
    .filter(Boolean) as string[];
  for (const id of ids.length ? ids : (state.world.present ?? [])) {
    const mem = state.memory[id];
    if (!mem) continue;
    if (mem.episodic.some((m) => m.content === what)) continue;
    mem.episodic.push({
      turn,
      content: what.slice(0, 200),
      importance: 9,          // identity-defining: this is folded into who they are, not evicted
      emotional_charge: "shaken",
      when_label: state.world.current_time,
      where: state.world.places[state.characters[id]?.location ?? ""]?.name,
      source: "witnessed",
      last_accessed_turn: turn,
    });
  }
  return log;
}

/* ══ WHAT THE ROOM KNOWS ABOUT THE PLAYER, AFTER IT HAS SEEN HIM DO IT ══════════════════════
 *
 * From the save that prompted this. Turn 6: `power_witnessed` is stamped `cosmic`. Turn 10: the
 * player puts a plate of 24-carat gold on a table at the Ritz, out of nothing, in front of a
 * maître d', a waiter, and a man reading the Financial Times. The prose:
 *
 *   "May I ask how you'd like it valued?"
 *   "The kitchen doesn't have a till for it. And I can't make change for a sovereign."
 *   "Sir, I can't carry a plate of sovereigns through the dining room."
 *
 * Matter appeared from nowhere and the reply was a BILLING QUESTION. The player's report: "They see
 * me make gold, refuse it. Refuse cash. Roll their eyes at me making a car. Totally normal."
 *
 * TWO SOURCES DISAGREED AND THE WRONG ONE WON. `power_witnessed` said the world had seen it at turn
 * six. Canon, written at world creation and never revisited, said:
 *
 *   "the only anomalies are Rabi's phone and matter creator, which are unknown to anyone but him."
 *
 * And reactionDirective, correctly, tells the narrator to measure the act against the canon. So it
 * measured a man conjuring gold against a line stating that nobody knows he can, and wrote a room
 * where nobody knows. Meanwhile the tier itself reached the prompt through exactly one channel: a
 * standing modifier inside dispositionCue, which lowers how much deference a character shows. A
 * number about politeness, carrying the fact that this man rewrites matter.
 *
 * The canon line is not struck. It was true when it was written and the story may yet make it true
 * again, and rewriting somebody's world bible to record what happened in it is the same lossy move
 * as editing a character card to record an injury. It is overridden here, per turn, from state —
 * the same shape as the body gate in prompts.ts, and reversible for the same reason.
 */
const TIER_SEEN: Record<string, string> = {
  empowered: "do things no ordinary person can do",
  mythic: "do things that cannot be explained",
  cosmic: "make matter appear and disappear at will",
};

export function witnessedDirective(state: SaveState): string {
  const w = state.power_witnessed;
  const tier = w?.tier;
  if (!tier || tier === "mortal") return "";
  const seen = TIER_SEEN[tier] ?? TIER_SEEN.mythic;
  const since = w!.turn;
  const ago = Math.max(0, (state.world?.current_turn ?? since) - since);

  // Only when canon actually claims secrecy, so an ordinary world never carries this sentence.
  const secret = (state.world?.canon ?? []).find((c) =>
    /\b(?:unknown|unaware|secret|hidden|conceal\w*|nobody knows|no one knows|known only)\b/i.test(String(c))
    && /\b(?:anomal\w*|power\w*|abilit\w*|device|creator|technolog\w*|machine)\b/i.test(String(c)));

  return `\n[WHAT THE PEOPLE IN THIS ROOM ALREADY KNOW ABOUT THE PLAYER. This was established at turn ${since}${ago ? `, ${ago} turns ago` : ""}, and it has been true every turn since.
The people here have watched the player ${seen}. They weren't told about it; they watched it happen, more than once, with their own eyes.
They've seen that the ordinary limits of life, like needing money, needing to work for things, and needing someone to make and carry an object, don't apply to this one man. That matters more to each of them than their job, their errand or their opinion of him.
So never treat it as a matter of procedure. Here is the mistake this note exists to stop, from a real turn: the player conjured a plate of gold, and the reply was about the till, making change, and how the item should be valued. Nobody responds to a miracle with bookkeeping. What people really do in front of proven power is want something from it, test it, ask him to do it again, ask what he wants in return, get frightened and hide it, refuse to look straight at it, pray, or try to get away from him, and which of those each person does comes from their own card.
People accept what he gives them by default. Someone handed a fortune doesn't turn it down out of dignity. If somebody here does refuse, their own state has to explain why, such as a fear, a rule they live by, or something they want more, and the refusal is visibly hard for them and isn't written as the scene passing moral judgment on the player.
They get used to it by changing how they live. After the third time nobody gasps, because they've adjusted. That adjustment shows as changed behaviour, like what they now ask him for, what they no longer bother planning, what they won't say in front of him, or who they've told, and never as a shrug or rolled eyes.${secret
    ? `\nTHE ESTABLISHED FACTS SAY OTHERWISE, BUT THEY ARE OUT OF DATE: "${String(secret).slice(0, 180)}" was written before any of this happened. It held until turn ${since}. The people in this room have seen otherwise since then, so for them it's no longer true, and what they witnessed comes first. Everything else in the established facts still stands.`
    : ""}]`;
}

/**
 * WHAT THE ROOM HEARD AND SAW. Everything the player typed except private thought and search
 * directives: speech counts here, unlike physicalAct, because a sentence said out loud is
 * something the room has to answer just as much as something done in it.
 */
export function perceptibleInput(action: string): string {
  return String(action ?? "")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\(\([^)]*\)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ANSWER THE PLAYER.
 *
 * The Velora save, eight turns. The player told two people he was a human from another planet,
 * undressed to show them, and said he didn't know how he got here. The beat for that turn was "A
 * SMALL REMINDER: let the ongoing weight of 'Rabi's claim of being from planet Earth' touch the
 * scene once, lightly". His own words, one line below, had been demoted to background by the slot
 * that decides what the turn is for. The two of them talked about a gull, the harbor chill and the
 * brewery books, wiped glasses, and left.
 *
 * So when the player said or did something the room could perceive, and no scheduled consequence
 * or faction sign has a better claim, the turn is for answering it. This replaces the quiet beats
 * only; a consequence that was due still lands, and it lands on a room that heard him.
 */
export function answerThePlayer(action: string, mode: ActionMode): string {
  if (mode === "think") return "";
  const said = perceptibleInput(action);
  if (said.length < 12) return "";
  return `ANSWER THE PLAYER. The people here just heard and saw this: "${said.slice(0, 300)}"\n`
    + `That's what this turn is about. Each person present responds to it as who they are: they might believe it, doubt it, laugh, get angry, get frightened, say plainly that they can't follow it, or ask the obvious next question. They stay with it for the whole turn, and they go on talking to the player about it. Nobody changes the subject to get away from it, and nobody goes back to a chore as though it hadn't been said. Nothing new arrives from outside the scene this turn.`;
}
