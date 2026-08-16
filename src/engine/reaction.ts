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
export function visibleOnPlayer(state: SaveState): string {
  const cond = state.condition["char_player"];
  const carried = [
    ...(cond?.wearing ?? []),
    ...(cond?.inventory ?? []).map((i) => i?.name).filter(Boolean) as string[],
  ].filter((x) => String(x).trim()).slice(0, 6);
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
  const look = now || (facts.length > 320 ? `…${facts.slice(-320)}` : facts);
  const tech = String(state.world_bible?.technology_level ?? "").trim();
  const seen = [look.slice(0, 340), ...carried].filter(Boolean).join("; ");
  if (!seen || !tech) return "";
  const him = String(p?.name ?? "").trim() || "the player";
  return `\nWHAT HE HAS ON HIM, WHICH THEY CAN ALL SEE: ${seen}.
This world can do this and no more: ${tech.slice(0, 240)}
Hold those two lines against each other. Anything on him that this world could not make, has no name for, and has never seen is NOT set dressing and does not become ordinary by having been mentioned before — it is ordinary to HIM and to nobody else here. A person meeting it has no word for it and reaches for the nearest thing they do know, and gets it wrong: they will call it by the closest object in their own life, or by a god, or by a trick, or by an illness. They may refuse to look at it. They may not be able to stop looking at it. What they will not do is price it, park it, or fold it into the errand they were already on.
AND HOLD THE SAME TWO LINES AGAINST WHAT HE SAYS. ${him} talks out of a world nobody here has seen, and a word for a thing this world does not contain does not become a thing by being said out loud. When he names one — a material, a tool, a trade, a machine, a measure, a sum, an idea — the people here do not know what he means, because there is nothing in their lives for the word to land on. Each of them does one of these, from who they are: hears the nearest thing their own life holds and answers about THAT instead, asks him what it is, takes it for a word from his own country and lets it go by, or decides he is talking nonsense and says so. What NONE of them does is say yes to it, repeat it back as a thing they know, name a price for it, or add a detail of their own — a single agreement puts that object into this world permanently, and everything written after it inherits a Rome that has the thing in it.`;
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
    : `Nobody is here to see it, so the world's answer is the place itself and whatever it does in response.`;

  const anachronism = visibleOnPlayer(state);

  return `\n[WHAT THE PLAYER JUST DID — THE SCENE ANSWERS THIS FIRST.
"${act.slice(0, 300)}"
${who}${anachronism}
This is the largest thing that has happened in this scene, and it outranks any standing thread, clock or errand named above: those are the background of the room, and this happened IN the room. Whatever the pressure line says arrives or does not arrive from outside, it does not license writing past this.
HOW THEY ANSWER IT: each present character reacts out of their own state, their own history with the player, and — this is the part that gets skipped — WHAT THIS WORLD HOLDS TO BE TRUE. Measure the act against the canon and the world bible you were given. If what the player just did is impossible here, or forbidden here, or carries a penalty here, then that is the largest fact in the room and every person in it knows it; they do not absorb it as ordinary and they do not need it explained to them. If it is unremarkable here, it is unremarkable, and a shrug is the honest answer.
TWO FAILURES, BOTH CAUGHT IN PLAY. Do NOT continue the previous topic as though nothing happened — a scene that was an argument about money before the act must not still be an argument about money after it, with the act as a debating point. And do NOT convert the act into a figure of speech, a lesson, or an occasion for someone's philosophy: they are looking at a thing that just occurred, and what a person does with a thing that just occurred is look at it, name it, back away from it, reach for it, or ask what it is.]`;
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
    log.push(`the world has seen you do something it cannot explain.`);
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
