/**
 * WEFT — world-loom engine types.
 * The world model: a social fabric that reacts, remembers, and moves offscreen.
 */

export interface DifficultyProfile {
  lethality: "low" | "medium" | "high";
  friction_density: "sparse" | "balanced" | "dense";
  antagonist_aggression: "slow_burn" | "active" | "hostile";
  protagonist_competence: "soft" | "average" | "hardened";
}

export interface ModelSettings {
  narrator_model: string;
  simulator_model: string;
  forge_model: string;
  fallback_model: string;
  /** THE REVISER — the fifth slot, and the only optional one. Small, cheap, and asked for one
   *  thing: repair the sentences the tic detector flagged, in place, without touching anything
   *  else on the page. Unset falls back to the simulator slot, which is already the small-model
   *  slot; a `local/…` id here is the intended configuration, since the prompt is a few hundred
   *  tokens and never carries the digest. Only ever called when `prose_reviser` is on AND the
   *  detector actually caught something. */
  reviser_model?: string;
  image_model: string;            // model used for portraits & scene illustrations
  context_memories_k: number;     // top-k memories per present NPC
  reflection_cadence: number;     // turns between reflection compactions
  history_window: number;         // raw recent turns kept verbatim in context
  lean_mode?: boolean;            // compressed system prompts + present/tracked-only cast (lower tokens, slightly less rich)
  token_budget?: number;          // when set (>0), trim the per-turn context to roughly this many input tokens, shedding least-relevant first
  tension?: number;               // 0–10 master dial for how much the world throws at you. 0 = the engine originates NOTHING new (no new threads/consequences/clocks/drives); the world only responds to what you do. Higher = more friction, faster escalation. Default 5.
  max_central_characters?: number; // cap on CENTRAL (full-fidelity, tracked) characters. Default 6. Beyond this, new characters become "non-central" — minimal-footprint background figures (environment-like) with simple handling, unless promoted. Tunable.
  context_mode?: "digest" | "chatlog"; // chatlog = append-only conversation context (I-frame anchor + per-turn deltas) so providers cache nearly the whole input; digest = classic rebuilt-each-turn context
  iframe_cadence?: number;        // chatlog mode: turns between full state re-anchors (default 6)
  route_by_price?: boolean;       // OpenRouter provider sort: price — route each call to the cheapest healthy provider
  narrator_reasoning?: boolean;   // let the narrator THINK (visible reasoning tokens billed as output). DeepSeek V4
                                  // defaults thinking ON; prose rarely needs it, and hidden thinking is a pure
                                  // per-turn tax. Default false = reasoning off for the narrator stream.
  prefer_deepseek_provider?: boolean; // for deepseek/* models, try the first-party DeepSeek provider first —
                                  // it carries the 0.8–2% cache-hit rate that makes long context cheap; other
                                  // providers of the same weights charge up to 4x input with weaker cache discounts.
                                  // Falls back to the rest of the provider pool when first-party is unhealthy.
  sim_route_speed?: boolean;      // route BOOKKEEPER calls for throughput instead of price — default true; bookkeeping latency is the felt latency
  habit_engine?: boolean;         // EXPERIMENTAL: core traits become probabilistic firing habits that loosen when seen (dzogchen self-liberation) and deepen when unseen. Inert unless true.
  daily_budget_usd?: number;      // cost governor: soft daily budget; past 70% the engine auto-runs eco (lean + tight context)
  chapter_cadence?: number;       // auto-chapter every N turns (0 = off, default 25) — one cheap call, shown in Chronicle + one line each in context
  /** PAINT THE SCENE EVERY TURN, without being asked.
   *
   *  Off by default and deliberately so on the cloud path, where every turn would be a few cents.
   *  The setting exists for the local one (Settings -> Local images): on your own GPU a picture per
   *  message costs nothing but the seconds it takes, so the story can simply have a moving
   *  illustration instead of a button you remember to press. Runs AFTER the turn commits and never
   *  blocks the prose. */
  auto_illustrate?: boolean;
  /** How many scene illustrations keep their pixels in the save. Older turns keep the record of
   *  having been illustrated but drop the bytes — one picture a turn is tens of megabytes a
   *  session otherwise, and store.ts documents exactly what that does to the tab. 0 = keep all. */
  illustration_keep?: number;
  /** REPAIR THE NARRATOR'S TICS INSTEAD OF ONLY HIDING THEM FROM IT.
   *
   *  The engine has always detected the interiority tic — the narration stating what somebody felt,
   *  knew or privately concluded — and has always done exactly one thing with the detection: keep
   *  the sentence out of the model's replayed context so it doesn't imitate itself. The player read
   *  it anyway. Turn this on and each flagged sentence goes to the reviser slot to have the offending
   *  phrase removed, and what you read is the repaired copy. The narrator's own words are kept
   *  verbatim on the turn and remain what the bookkeeper, the Chronicle and every extraction pass
   *  read; nothing about the world's record changes.
   *
   *  OFF by default, including on upgrade: it is an extra model call on any turn that trips the
   *  detector, and turning that on for somebody's existing save without being asked is not ours
   *  to do. See engine/reviser.ts. */
  prose_reviser?: boolean;
  paging?: boolean;               // MemGPT-style paging: cold central characters' identity cards page out of the prefix to one-line stubs until they matter again
}

/** An auto-generated chapter of the story — one cheap summarization call every chapter_cadence
 *  turns. Lets the verbatim history window stay small without losing arc awareness. */
export interface Chapter {
  idx: number;
  from_turn: number;
  to_turn: number;
  title: string;
  summary: string;
  on_contract?: boolean;      // did this chapter honor the standing direction (story contract)?
  drift?: string;             // one-line description of the drift, when off contract
  persona?: { mbti: string; read: string; traits: string[]; shift?: string }; // how the PLAYER acted this chapter, typed from behavior
}

export interface WorldBible {
  name: string;
  era: string;
  art_direction?: string;       // visual style for portraits & scenes ("muted painterly chiaroscuro", "90s anime cel", "gritty photoreal")
  technology_level: string;
  magic_rules: string;
  forbidden: string;
  what_people_fear: string;
  tone?: string;                  // GENRE & REGISTER: the story's genre and tonal key, set by the player at forge time or inferred from the seed — e.g. "action-horror survival, lethal and fast, romance under threat", "cozy small-town mystery", "grimdark military SF". Surfaced to the narrator as the GENRE line so the prose is written in this register and never drifts into the wrong key.
  cultures_and_languages: string;
  climate_and_geography: string;
  calendar_and_currency: string;
  political_situation: string;
  narrator_direction?: string;
  destination?: string;        // OPTIONAL. The ending the story is written toward, set at Forge time
                               // ("he learns to survive the winter and builds a shelter that holds").
                               // Empty = open world: the story goes wherever play takes it. When set,
                               // the narrator bends scenes toward it and each chapter is scored for
                               // progress. It is a direction, never a rail — the player can still fail,
                               // refuse, or arrive somewhere else entirely.
  destination_turns?: number;  // OPTIONAL. Turn budget. When set, the ending ARRIVES by this many turns
                               // after the destination was set — well or badly, earned or catastrophic.
                               // The road is negotiable; the arrival is not. 0/undefined = no clock.
  destination_set_turn?: number; // the turn the clock started (so budgets survive mid-story edits)
  destination_reached?: boolean; // set once the chapter auditor judges the ending arrived
  destination_outcome?: "earned" | "forced"; // whether the player drove the ending or the clock did
  start_date?: string;         // "YYYY-MM-DD" — Day 1 of the story; unlocks weekdays/months/years in the clock
  god_mode?: boolean;          // the player is sovereign: powers succeed completely, cost nothing; world still reacts
  era_theme?: string; // ui palette: auto | ember | verdigris | rust | frost
  difficulty_profile: DifficultyProfile;
  pressure_palette?: string[];        // allowed pressure sources, genre-bound
  forbidden_as_primary?: string[];    // never the primary engine of a scene
}

// ───────────────────────────── social fabric ─────────────────────────────

/** A core behavioral habit as PHYSICS, not label. The engine owns whether it fires each beat; the
 *  narrator only ever receives a fire verdict, never the numbers or the lexicon. Change happens by
 *  the dzogchen mechanic: a habit SEEN as it fires (clarity gated by relaxation) loses a little
 *  automaticity; a habit that fires UNSEEN deepens and feeds a dwelling. No self tracks the change —
 *  it moves in the dark and only becomes narratable when ANOTHER character notices the difference.
 *  Directionless by construction: the engine never judges a habit good or bad, and what fills the
 *  space of a dissolved habit comes from surviving desire, never a moral pole. */
export interface CoreHabit {
  trait: string;             // the concrete established behavior, verbatim from core_traits — never a category
  strength: number;          // 0..100 — firing probability when the trigger context is live. Forged ~95: a wall.
  baseline: number;          // what it re-grooves toward when unwatched (extinction is inhibition, not erasure)
  seen_fires: number;        // times it fired while clearly seen (the reps that loosen it)
  last_fired_turn: number;
  noticed_watermark: number; // strength at which an observer last remarked the change — noticing is stepwise
  dormant?: boolean;         // dissolved below threshold and retired at a reflection cadence; can revive on relapse
  /** Times this trait has been EXPRESSED on screen. Distinct from strength (how automatic it is)
   *  and from seen_fires (times its owner caught it firing). This counts narrative airtime, and it
   *  only ever goes up. A trait keeps its intensity forever; what decays is its NOVELTY. The first
   *  time someone plays basketball is an event and the scene is about basketball; the tenth time it
   *  is the floor the scene stands on, and the conversation happening over it is about something
   *  else. Without this count the narrator re-performs the discovery every time. */
  expressions?: number;
  last_expressed_turn?: number;
}

/** A promise on the ledger — who swore what to whom. Weight scales the emotional payoff/damage. */
export interface Promise {
  id: string;
  from: string;                // who made it (char id — often char_player)
  to: string;                  // who it was made to
  text: string;                // "walk you home", "protect your son", "pay the debt by spring"
  made_turn: number;
  due_time?: string;           // in-world time it comes due, if time-bound
  weight: 1 | 2 | 3;           // 1 small favor · 2 real commitment · 3 a vow / life-stakes
  /** `retired` is the player closing the ledger by hand on something that was never going to close
   *  itself, and it carries NO relationship consequence — see settlePromise in lib/api.ts. Kept and
   *  broken both move edges and write a memory; retired says only that the story is done with it. */
  status: "open" | "kept" | "broken" | "retired";
  settled_turn?: number;       // when it stopped being open
  settled_by_hand?: boolean;   // the player closed this one, not the bookkeeper
  /** Turns on which the engine saw evidence this was made good on. Accumulated because the
   *  bookkeeper is asked and can decline, and a promise the player has kept three times over should
   *  not need a fourth prompt. See creditPromiseEvidence in social.ts. */
  evidence_turns?: number[];
  settled_by_evidence?: boolean;
}

/** Directed edge a→b. Axes in [-100, 100]. */
export interface SocialEdge {
  from: string;
  to: string;
  warmth: number;   // affection ↔ hostility
  trust: number;    // reliance ↔ suspicion
  power: number;    // a's perceived standing over b (deference if negative)
  attraction?: number;      // desire, NOT warmth: wanting someone vs liking them (-100..100; negative = averse). Seeded from conditioning at first co-presence; moves slowly.
  attraction_base?: number; // the conditioned first read — caps how far warmth alone can lift attraction (flat first read → companionate plateau, a different relationship)
  authored_seed?: boolean;  // the authored-bond repair has already run on this edge (see repairAuthoredBonds); one-way and once, so a real falling-out is never re-inflated
  desire_admissibility?: number; // 0..1 — how much of the attraction can reach clean self-report vs. discharging as grasping/possession. Stamped at first sight from the perceiver's clench (clenched→grasp-born, open→awe-born), then drifts toward current relaxation each turn: slowly UP under calm (the flower learned to be seen not picked), faster DOWN under clench (re-roughened). Low = possessive/sideways/collector texture; high = flirtation/letting-stand. Same magnitude of wanting, opposite texture.
  roles?: string[]; // labeled relationship(s) A holds toward B — can be multiple at once ("boss", "girlfriend"); structured facts, not just temperature
  notes: string;    // qualitative texture ("owes him for the winter", "old rivals")
  /** WHEN the note was written. It is one 140-char slot holding the last thing the bookkeeper said
   *  about this relationship, and the bookkeeper writes at moments of friction, because friction is
   *  what it notices. Unstamped, that line was rendered to the narrator every turn as the CURRENT
   *  state of the bond, forever: one save had a character at warmth 59 — plainly fond — reading as
   *  cold in every scene because a grievance written on turn 127 was still being served on turn 164
   *  as though it had just happened. A feeling needs a date on it or it is not a feeling, it is law. */
  notes_turn?: number;
  updated_turn: number;
  /** WHAT JUST MOVED. Warmth and trust are levels, and a level cannot say what somebody is reeling
   *  from. A save had a woman at warmth 57 who had been told to leave twice in three turns; the
   *  ledger recorded both cuts and the narrator was handed the number 57, so it wrote a serene,
   *  devoted woman kissing the hand of the man who had just told her to fuck off. The deltas were
   *  applied and thrown away. This keeps them for a few turns so the prose can be about them. */
  swing?: { since_turn: number; warmth: number; trust: number };
  last_rupture_turn?: number; // a real disagreement happened on this edge (someone said no or set terms); trust that grows within 5 turns of it is repair, and repair grows trust faster than smoothness does
}

/** A unit of information moving through the social graph at zero token cost. */
export interface Rumor {
  id: string;
  content: string;
  truth: "true" | "distorted" | "false";
  salience: number;          // 1–10, drives spread probability
  origin_char: string;
  knowers: string[];         // char_ids who currently hold it
  born_turn: number;
  about_char?: string;
  dead?: boolean;            // fully diffused or decayed out
  /** PROVENANCE — every hop, oldest first. Answers "how does this person know?" with a route
   *  rather than an assumption. A rumor with no path is pre-provenance (old save) and is treated
   *  as origin-only. */
  path?: { to: string; from: string | null; turn: number; how: "witnessed" | "told"; where?: string | null }[];
}

export interface FactionClock {
  id: string;
  faction: string;
  objective: string;
  segments: number;          // total
  filled: number;            // progress
  consequence: string;       // what fires at completion
  visible_signs: string[];   // what leaks into scenes as it advances
  last_advanced_time?: string; // in-world timestamp of the last segment — gates the next one (see MINUTES_PER_SEGMENT)
  stalled_since?: number;      // turn this clock first found itself with nothing to act on
  knowledge_chain?: string[];  // how this faction came to know — printed in the World tab, oldest hop first
  status: "running" | "fired" | "stalled";
}

export interface Norm {
  id: string;
  rule: string;              // "no open flame after the horn sounds"
  enforcement: "gossip" | "shunning" | "fine" | "violence" | "exile";
  holders: string;           // who cares ("the dock elders", "everyone")
}

// ───────────────────────────── characters ─────────────────────────────

export interface NPCDrive {
  goal: string;
  /** HOW THEY GO AT IT — the door they use, not the thing they want.
   *
   *  Without this a want is a sentence, and the shortest path from a sentence to a scene is a
   *  character saying it. One save had a woman whose goal read "find the right words to tell him
   *  about her body's changes before tonight", and on the page she said: "I'll have words by then.
   *  The right ones." She recited her own goal field. That is how a book character talks, because a
   *  novel compresses — and it is not how anyone approaches something they are afraid of.
   *
   *  Real pursuit is oblique and the obliquity IS the characterisation: the adjacent topic used as a
   *  door, the question asked so the other person can volunteer it, the small version floated first
   *  to see how it lands. This records THIS person's door. */
  approach?: string;
  progress: number;          // 0–100
  blocker?: string;
  priority?: number;         // higher = more important; ties broken by progress. default 1
  updated_turn: number;
  /** Turn this drive's PROGRESS last actually moved, and the value it moved to. Separate from
   *  updated_turn because the bookkeeper restamps that every turn it rewrites the blocker — which
   *  it does constantly while a question is on the table, disarming any staleness check built on
   *  it. This is what tells the difference between a want being worked on and a want being asked
   *  again. */
  progress_turn?: number;
  last_progress?: number;
  /** Turn this drive first became a pursuit of an absent target ("must find X first"). Separate
   *  from updated_turn on purpose: tickDrives stamps updated_turn EVERY turn as offscreen progress
   *  accrues, so anything measuring "how long have they been looking" against it always reads 1. */
  pursuit_since?: number;
}

export interface Identity {
  character_id: string;
  paged?: boolean;
  knows_player_name?: boolean; // EPISTEMICS: may this character speak the player's name? Spreads only through introduction or hearing it spoken in-scene            // MemGPT-style: identity card paged out of the cached prefix (cold character); rehydrates on presence/mention
  name: string;
  age: number;
  pronouns?: string;          // "she/her", "he/him", "they/them" — pinned so the narrator never has to guess gender
  appearance_facts: string;    // BEDROCK look — face, eyes, hair, build, skin. Set at creation, appended-to only by permanent bodily events, replaced only by the player. The engine must never overwrite this.
  appearance_now?: string;
  height_cm?: number;          // physical constant — moves through the world with them, shapes portraits
  weight_kg?: number;          // physical constant — scales hunger/thirst accrual, shapes portraits     // CURRENT presentation — clothes, grime, visible state. Freely rewritten by the simulator each time it changes.
  background: string;         // BEDROCK: the original forge identity — who they fundamentally are. Never trimmed or rewritten by the engine.
  life_history?: string;      // ACCRETED: defining moments that have happened in play, folded in over time. Compressed when it grows long; bedrock is never touched.
  core_traits: string[];
  values: string[];
  speech_pattern: string;
  attachment?: {              // how this nervous system behaves around other people under threat — clinical attachment, deterministic in play
    style: "secure" | "anxious" | "avoidant" | "disorganized";
    under_threat?: string;    // plain sentence: what they DO when scared or hurt (pursues and escalates / goes flat and leaves / wants comfort and fears it in the same motion)
    soothed_by?: string;      // plain sentence: what actually settles them
  };
  conscience?: number;        // 0..1 — how much other people's experience registers as MATTERING. Orthogonal to relaxation: calm is not care. Most people 0.6-0.9 (openness → warmth, the default physics). ≤0.35 = rudra-type: constitutionally cold — their poise is real (low-anxiety, stress-immune) and their openness yields precision without obligation; comfort does not soften them because there is nothing to soften into.
  voice?: {                   // the verbal fingerprint — what makes this mouth unmistakable on the page
    diction?: string;         // vocabulary register: concrete/abstract, schooling, era words, what they'd never name directly
    syntax?: string;          // sentence shape: length, fragments vs run-ons, where the verb lands, questions vs statements
    rhythm?: string;          // pacing: self-interruption, trailing off, volley vs monologue
    tics?: string[];          // recurring verbal habits — used SPARINGLY (at most once a scene, often zero)
    never_says?: string[];    // constructions this person would never produce
    agenda?: string;          // subtext: what they're usually angling for under the words — people speak from agenda, not to inform
    example_lines?: string[]; // 2-4 lines ONLY this person could say — the register in action, never reused verbatim
  };
  /** Turn the voice was last re-derived by the fresh-reader pass. Voice drifts because the narrator
   *  imitates its own last paragraph; the refresh re-reads the card WITHOUT seeing any prose and
   *  overwrites example_lines, which is what breaks the copy-of-a-copy loop. */
  voice_refreshed_turn?: number;
  /** Auto-registered from prose because the simulator never declared them. The record is a sketch:
   *  no traits, no conscience, background copied from the sentences they appeared in. The simulator
   *  is asked to complete it; until it does, nothing should treat this as a finished person. */
  provisional?: boolean;
  aliases?: string[];         // other handles the fiction uses for this person — nicknames, titles, epithets ("the captain", "Sor"). Feeds name resolution and memory retrieval so a reference by title still finds the person.
  attracted_to?: string;      // orientation — who this person can desire at all ("women", "men", "anyone", "no one"). A hard gate, not a preference.
  beauty?: number;            // 0..100 intrinsic attractiveness — the millisecond snap-read a stranger gets before any relationship. Species-agnostic: a disembodied voice, a machine, a beast can all be beautiful. Set at creation from appearance (symmetry, youth/vitality, presence, striking features), NOT from who's looking — personal taste is applied on top per-observer at seeding. ~50 = ordinary; 75+ = turns heads; <30 = plain/off-putting. The engine derives a fallback from age when unset; never overwrites a set value.
  taste?: string;             // conditioned desire — plain phrases for what their world and history trained them to find attractive. Habituated, not chosen; drives the first-read seeding.
  texture?: string[];         // a few standing interests/quirks/sensitivities — small enduring things that make them a person between plot beats ("loves trees on a quiet walk", "always cold", "knows too much about rocks"). Surfaced sparingly, never made central.
  skills: Record<string, string>;
  intelligence: "low" | "below-average" | "average" | "sharp" | "brilliant";
  gregariousness: number;    // 0–1, drives rumor spread + social initiative
  current_goal?: string;
  current_activity?: string;
  drive?: NPCDrive;           // the ACTIVE pursuit
  drive_queue?: NPCDrive[];   // up to 2 backup goals; promoted when the active one stalls/completes and the scene is calm
  authored?: AuthoredDrive[]; // STANDING wants the player wrote onto this person by hand — see AuthoredDrive
  schedule?: Schedule;        // OPTIONAL standing week — where this person has to be, and when. See engine/schedule.ts
  tracked?: boolean;          // followed in the long game: keeps regenerating drives, persists offscreen
  central?: boolean;          // a CENTRAL character: full fidelity (memory, traits, drives, portrait, theory-of-mind). When false, the character is "non-central" — a background/environment figure with minimal token footprint and simple handling. The cap (max_central_characters, default 6) governs how many can be central at once; overflow registers as non-central until promoted.
  status?: "active" | "dead" | "departed"; // dead = killed/gone for good; departed = left the story (moved away, exiled). active is default.
  exit_turn?: number;         // when they died/left
  exit_note?: string;         // how they exited ("killed by the blast", "fled the city")
  /** SOMEBODY ELSE HAS THEM. Set when the prose puts this person into custody — arrested, jailed,
   *  sectioned, hospitalised, deported. They are not `departed` (that is permanent and untracked);
   *  they are held, and they do not walk back into the player's scene until the story shows a
   *  release. Cleared the moment it does, or by hand from the character panel. Written and read by
   *  the departure/arrival guards in engine/turn.ts — see engine/exit.ts for what counts. */
  held?: { since_turn: number; where: string; note: string };
  location?: string;          // place id (or free name) where this character currently is
  portrait_url?: string;
  /** THE EXACT WORDS THAT DREW THIS PERSON — written when the portrait is generated, then reused
   *  verbatim in every scene image forever after.
   *
   *  Only the local diffusion path reads it, and it exists because that path is literal in a way
   *  the cloud one is not: a multimodal model is handed the portrait and told to match it, while a
   *  sampler is handed words and nothing else. The same clause returns roughly the same face; a
   *  clause re-derived from live state each turn drifts a few words at a time and returns a
   *  stranger by the tenth message. Bedrock only — clothes, mood and injuries are added as their
   *  own clauses per scene, never folded in here. Editable by hand: this is the one field that
   *  says what a character looks like to the image model. */
  visual_signature?: string;
  /** Seed the portrait was drawn at, reused when this character is the subject again. */
  portrait_seed?: number;
  /** Body plan the portrait was generated under. Scene illustrations attach portraits as reference
   *  images only when this matches the character's CURRENT plan — a stale person-shaped portrait
   *  attached as a reference outvotes every "not a person" the prompt can write. */
  portrait_plan?: "humanoid" | "nonhuman";
}

/** A WANT THE PLAYER WROTE, THAT THE WORLD THEN HAS TO LIVE WITH.
 *
 *  The only way to change a person by hand was to edit their core traits — which is instant and
 *  total. Wanting a neighbour to become a nuisance meant typing "annoys me with loud music nightly"
 *  into the field that describes what someone fundamentally IS, and it was simply true from that
 *  moment: no first party, no build, no evening where it might have gone differently. A result
 *  entered as a nature.
 *
 *  What was actually wanted is one level down. Give the man a WANT — start having people over late
 *  — and let the story do the rest. That is already how the engine works; it just had no manual
 *  entry point.
 *
 *  This is deliberately NOT stored in `drive`. Ten places in the engine overwrite that field
 *  (promotion, seeding, the forge, sketch, rupture, death, chapter transitions), and a hand-written
 *  want that quietly evaporates two turns later is worse than no feature. Sitting in its own field
 *  it survives all of them, and it reads as what it is: a standing condition of this person's life
 *  rather than the errand they happen to be on this afternoon.
 *
 *  Two properties the ordinary drive does not have:
 *
 *  · IT DOES NOT COMPLETE. `NPCDrive` is a task with progress 0–100 that finishes and gets replaced.
 *    "Start having parties late at night" is a habit, and a habit that completes after one party is
 *    not the thing anybody asked for. An authored want has no progress. It stops when the player
 *    stops it.
 *  · IT ESCALATES. Left alone it ratchets — one late night, then most weeks, then most nights, then
 *    past anything reasonable — on a rate the player picks. That is the "builds over time" that was
 *    being simulated by hand, and it is where the drama comes from: the same want at stage 0 and
 *    stage 3 produces very different evenings. */
export interface AuthoredDrive {
  /** What they DO — same grammar as NPCDrive.goal. "start having people over late", not "be annoying". */
  goal: string;
  /** The core_trait label this became when it crystallised, so the novelty ladder can find the
   *  habit it is tracked under and the mandatory directive can stand down once it is worn. */
  label?: string;
  /** The door they use. Same field, same reason: without it a want gets announced instead of pursued. */
  approach?: string;
  /** WHY THIS STARTED, in their life, not the player's.
   *
   *  The most important optional field. A want with no cause is a puppet: the narrator is handed
   *  something the character suddenly does and no reason for it, so it invents one — a different one
   *  every turn, none of them load-bearing. This is the same failure that has produced most of the
   *  engine's worst behaviour: a pass asked to act on state it was never given. "His brother moved
   *  in last month" costs one line and makes the whole thing sit differently. */
  because?: string;
  /** How fast it ratchets when nothing opposes it. Turns of standing per stage. */
  rate: "slow" | "steady" | "fast";
  /** Consecutive turns this want was ordered outright and did not appear in the prose. Written only
   *  at the rung where the act itself is demanded — see noteWantMisses. Never gates the ratchet. */
  missed?: number;
  /** FULLY THEMSELVES WITHIN THIS MANY TURNS **THAT SHOW IT**. A deterministic budget that overrides `rate`.
   *
   *  `rate` measures in-world hours, which is right in principle — a habit escalates on nights, not
   *  on how much the player typed — and useless when you want to SEE whether the feature works. One
   *  want sat at stage 0 for nine turns because 165 of the required 360 minutes had passed, which is
   *  correct and indistinguishable from broken. With this set, the want starts visible at 10% on the
   *  turn after it is written and reaches full by the deadline, on a curve that rises fast and then
   *  flattens: something shows immediately, and the arrival is on a fixed schedule you can check. */
  inhabit_turns?: number;
  /** 0–5. How far it has escalated. */
  stage: number;
  /** Turns this want has been live. THE SCHEDULE RUNS ON THIS AND ON NOTHING ELSE — `inhabit_turns`
   *  is a contract, not a target the narrator may decline. */
  turns_live?: number;
  /** DEAD. Written by the prose detector that used to gate the schedule, kept so saves from that era
   *  still load and so the field numbers do not shift under them. Nothing reads them. */
  seen?: number;
  last_seen_turn?: number;
  stalled?: number;
  /** Turns this want has been live and unpaused — a standing want expresses itself whether or not
   *  the player was in the room to see it. */
  acted: number;
  /** Held in place: it stays on the card and stays visible, but stops climbing. What the player sets
   *  when the thing has reached the level they wanted, or when the character has been talked down. */
  paused?: boolean;
  /** Should this become part of who they are if it runs long enough? When it matures at the top
   *  stage, the engine writes the AcquiredTrait itself — the same sentence the player would have
   *  typed at the start, arrived at instead of declared. */
  crystallize?: boolean;
  crystallized_turn?: number;
  added_turn: number;
}

/** WHICH DAYS A BLOCK RUNS. `weekdays` and `weekends` are the two the player asks for by name;
 *  an explicit list (0 Sun … 6 Sat) covers everything else — a Tuesday market, a Sunday service,
 *  four nights on and three off. See engine/time.ts for how a world with no calendar still has a
 *  week: with no `start_date`, Day 1 is a Monday and the week runs from there. */
export type ScheduleDays = "daily" | "weekdays" | "weekends" | number[];

/** ONE STANDING COMMITMENT IN SOMEBODY'S WEEK.
 *
 *  A drive is what a person is trying to get; a block is where they have to BE, whether they feel
 *  like it or not, because their life already had a shape before the story started. The engine had
 *  no representation of that at all: every character stood exactly where the last scene left them
 *  until a model moved them, so a woman with a job was at home at ten on a Tuesday morning for the
 *  same reason she was at home at ten on a Sunday — nothing had ever told the world otherwise.
 *
 *  The fields divide into four groups, and each is load-bearing for a different failure:
 *
 *  · WHAT and WHY. `what` alone gets a character who leaves for "work" and comes back with nothing
 *    to say about it. `why` is the same field as AuthoredDrive.because and exists for the same
 *    reason: a commitment with no cause is a puppet-string, so the narrator invents a cause, and a
 *    different one every turn. It is where the job meets the background — "the only yard that takes
 *    a man with a record", "she is the one who can read, so she reads the wills".
 *  · WHERE and HOW. `where` is what makes this more than a note on a card: the engine moves them
 *    there. `how` is the commute, which is the part of a day people actually talk about, and the
 *    thing that decides how long before the hour they have to stand up and go.
 *  · WHEN. Minutes since midnight, so overnight work is expressible (end < start wraps).
 *  · WHAT IT COSTS. `rigidity` decides whether the world can hold them past the hour and what it
 *    means when it does; `stakes` is the sentence the miss cashes out as. */
export interface ScheduleBlock {
  id: string;
  what: string;                 // "the early shift at the tannery", "Thursday lessons with the priest"
  why?: string;                 // why this is in their life at all — ties to background, drives, debts
  where: string;                // a place id, or a free place name (resolved/created on first use)
  how?: string;                 // "the 6:40 tram", "walks the towpath", "her brother drives her"
  travel_min?: number;          // minutes before `start` they have to set out; derived from distance when unset
  start: number;                // minutes since midnight, 0–1439
  end: number;                  // minutes since midnight; less than `start` means it runs past midnight
  days: ScheduleDays;
  /** How immovable it is, and therefore what the engine is allowed to do about it. `mandatory` — a
   *  shift, a watch, a court date — the engine will move them itself once the scene has held them
   *  well past the hour. `expected` gets a far longer leash. `optional` is never forced: the scene
   *  wins and they simply did not go, which is a thing that happened rather than a rule broken. */
  rigidity: "optional" | "expected" | "mandatory";
  stakes?: string;              // what missing it costs them — "the foreman docks a day and remembers"
  paused?: boolean;             // on the card, off the clock (a leave of absence, a strike, a broken leg)
  /** BOOKKEEPING, one day-number each, so nothing fires twice for the same day. */
  last_left_day?: number;       // the day they set out for it
  last_done_day?: number;       // the day they saw it through to the end
  last_missed_day?: number;     // the day it came and went without them
  last_late_day?: number;       // the day the scene held them past the hour
  /** The day the player's scene was actually holding them while this block's hours ran. It is what
   *  separates "she missed her shift because she was with you" from "the montage skipped Tuesday" —
   *  without it, every time-skip would hand out missed shifts to a cast nobody was looking at. */
  held_day?: number;
  excused_day?: number;         // the player let them off this one — set from the Cast drawer
}

/** A PERSON'S WEEK. Optional in every sense: a character without one behaves exactly as before. */
export interface Schedule {
  blocks: ScheduleBlock[];
  /** Where they end up when nothing else claims them — home, the barracks, the room over the shop.
   *  Without it a character who finishes a shift at midnight stands in the empty tannery until the
   *  next thing in their week happens to start. */
  home?: string;
  /** One line the player can write about the shape of the week that no block captures: "off on
   *  saints' days", "swaps nights with her sister when the baby is bad". Surfaced, never parsed. */
  note?: string;
}

export interface AcquiredTrait {
  id: string;
  label: string;
  origin: string;
  behavioral_impact: string;
  intensity: number;          // 1–10
  self_weight: number;        // identity integration, grows with reinforcement
  last_reinforced_turn: number;
  reinforcement_count: number;
}

export interface Injury {
  id: string;
  type: string;
  cause: string;
  permanent: boolean;
  functional_impact: string;
  /** When it was taken. Conditions have always healed on a timer and injuries never did, so a
   *  scrape recorded once stayed on the card for the rest of the story with `cause: "this turn"`
   *  still on it a hundred turns later. Optional: older saves start their clock on load. */
  turn?: number;
}

export interface Psyche {
  relaxation: number;          // -10 (clenched) .. +10 (open); player never gets this rendered as numbers
  capacity: number;            // resting point relaxation drifts toward
  recovery: number;            // 0.01–0.45 drift rate per turn
  state: "intact" | "fracturing" | "broken" | "shattered";
  break_mode: "dissociative" | "fawning" | "mirror" | "fractured" | null;
  consecutive_clenched: number;
  mood: string;                // one-word weather
  mood_valence: number;        // -10..10 derived
  active_states: string[];     // "grief", "infatuated"
  state_ages?: Record<string, number>;  // turn each active state was added — fuels the lifecycle: states dissolve on their own in a settled body, feed on themselves in a clenched one
  mood_set_turn?: number;      // when the current mood was set — stale moods fade (weather, not climate)
  open_run?: number;           // consecutive settled turns (mirror of consecutive_clenched) — long runs feed reflection: ease shapes belief the way clench does
  prev_relaxation?: number;    // relaxation captured at the START of the current turn, before drift and deltas —
                               // the discharge detector (emotions.ts) reads the turn's net movement against this baseline
  discharge_lift?: number;     // temporary capacity bonus granted by a discharge (release from depth). Decays ×0.7
  /** GRIEF DRAG — the counterpart to discharge_lift, and the thing whose absence made a woman whose
   *  marriage had just ended read as stoic. Relaxation drifts toward CAPACITY every turn, so a
   *  character with a positive nature is pulled back to "open and at ease" no matter what the story
   *  did to them: one save had her at relaxation 0.87 and rising, mood "grieving, hollow", valence
   *  +1, ten turns after her husband left her and called her a slut to his family. The engine had a
   *  temporary lift for good news and nothing at all for bad. Subtracted from capacity; decays. */
  grief_drag?: number;
                               // per turn in tickPsyche — an opening, not a personality change
  /** FAULT — what this person DID, which nothing in the engine used to read. Every other mechanic
   *  here measures what was done TO somebody; there was no cost to being the one who caused it, so
   *  cruelty was free and nobody in this world had ever been in the wrong and known it. Gated by
   *  conscience: at ≤0.35 it registers as information and carries no weight, which is the Rudra
   *  branch and stays law. Never set on the player — telling somebody they feel guilty is the
   *  authorship the tightness anchor exists to prevent. See engine/fault.ts. */
  fault?: { toward: string; about: string; turn: number };
  /** Turns spent trying to fix it — the appeasement road, the counterpart to rumination. A body that
   *  runs its pain outward into activity never sits still long enough to feel it, so while this is
   *  running the lifecycle does NOT self-liberate their states however settled they look. */
  repairing?: number;
  repair_toward?: string;
  /** The other person's warmth toward them when the loop began. Landing is a MOVEMENT from here,
   *  never an absolute level — in a close bond the level is already high and nothing would be waited for. */
  repair_baseline?: number;
  /** What the running is costing them, stored up. When the repairing stops, this arrives. */
  unfelt?: number;
  betrayals?: number;          // recent self-betrayals: times this character gave in under pressure AGAINST an
                               // active want of their own. Each one dips relaxation (agreeing while holding a want
                               // is a clench, whatever its social shape); 3+ shows as a "swallowing resentment"
                               // state; drains over turns and shrinks when they stand their ground.
}

export interface Condition {
  injuries: Injury[];
  conditions: string[];
  condition_age?: Record<string, number>; // turn each condition was added — fuels deterministic decay
  fatigue: "fresh" | "tired" | "exhausted";
  hunger: "fed" | "peckish" | "hungry" | "starving";
  hunger_meter?: number;       // 0 sated .. 10 starving — time-driven (physiology.ts); strings above derive from this
  thirst_meter?: number;       // 0 hydrated .. 10 parched — time-driven, weight- and weather-scaled
  awake_minutes?: number;      // in-world minutes since last real sleep; drives fatigue + the relaxation ceiling
  subjective_ceiling?: number; // PLAYER-ONLY baseline override (-10..+10). A manual "running low today" the sleep/hunger
                               // clock can't see (unrested despite the hours, an off day, ambient stress outside the fiction).
                               // Stacks UNDER the physiological ceiling via min(); persists until the player clears it (=undefined).
  inventory: { id: string; name: string; notes?: string }[];
  wearing: string[];
  psyche: Psyche;
}

// ───────────────────────────── memory (Park et al.) ─────────────────────────────

/** Where a memory or fact came from — the provenance chain. Lets the engine (and the GM UI) answer
 *  "how does this character know that?" and lets future weighting treat hearsay as weaker than
 *  first-hand knowledge. Backfilled to "witnessed" on old saves by sanitize(). */
export type MemorySource =
  | "witnessed"                 // the character was present when it happened
  | "rumor"                     // reached them through the rumor mill
  | "inferred"                  // written by an offscreen/interlude pass — they didn't directly see it
  | "offstage"                  // they witnessed the world sim's own motion, somewhere the player was not
  | { told_by: string };        // a specific character conveyed it (char id), e.g. via memory_recohere

export interface EpisodicMemory {
  /** Set once the entry has been through sweepMemories, so the pass never reprocesses a bank and
   *  an existing save is repaired the first time it loads. See engine/memory.ts. */
  swept?: boolean;
  turn: number;                // the turn this memory was FILED (when the character formed/recorded it)
  event_turn?: number;         // in-fiction turn the event actually happened at; defaults to `turn`. Earlier than `turn` for a recalled/backstory event. Used only for chronological sort, not for display precision.
  anchor_rel?: string;         // STICKY landmark-relative placement ("before the outbreak", "after Marie arrived") — does NOT decay. This is the ordinal guardrail: even when the exact time dissolves, the memory keeps its before/after relation to a major event, so a faded memory can't drift into the wrong point in the timeline. Gist survives; precision fuzzes.
  content: string;             // the current (possibly degraded) recollection — rewritten as it fades
  full_content?: string;       // the original vivid recollection, kept once so degradation has a source
  importance: number;          // 1–10 (poignancy) — high importance decays slower
  emotional_charge: string;
  when_label?: string;         // in-world time it happened ("Day 5, 18:30") — gives memories real temporal distance
  where?: string;              // place name where it happened — drops out as the memory fades (reconstructable from neighbors)
  decay_stage?: 0 | 1 | 2 | 3; // 0 vivid (somatic detail) → 1 gist+person+place → 2 gist+person (place lost) → 3 person+bare gist
  scheduled_time?: string;     // commitments: "Day 3, 19:00"
  commitment_status?: "pending" | "fulfilled" | "missed" | "cancelled";
  folded?: boolean;            // a high-salience memory already folded into the character's background (identity consolidation)
  source?: MemorySource;       // provenance: how this character came to know this (witnessed / rumor / inferred / told_by). Backfilled to "witnessed" on old saves.
  last_accessed_turn: number;
}

export interface Belief {
  content: string;             // reflection output: compressed conviction
  evidence_turns: number[];
  formed_turn: number;
  confidence: number;          // 0–1
}

/** A durable declarative fact this character knows (semantic memory, split from episodic).
 *  Verbatim-anchored at write time, never decayed, never paraphrased by a model again.
 *  This is where "the player is from Seattle" lives — immune to bookkeeper drift. */
export interface DurableFact {
  content: string;             // the fact, as verified against the turn's source text
  turn: number;
  quote?: string;              // the verbatim source span that grounded it
  source?: MemorySource;       // provenance — how the character learned this fact
  /** SUPERSESSION. When a character learns they were wrong, the old fact is not deleted — people
   *  remember having believed the wrong thing, and the correction is often the more important
   *  event. It is marked instead: kept in the ledger, rendered as a former belief, and never
   *  offered to the narrator as current knowledge alongside the truth that replaced it. */
  superseded_by?: string;      // the content of the fact that overturned this one
  superseded_turn?: number;
}

export interface CharMemory {
  character_id: string;
  core: string[];              // immutable autobiography
  episodic: EpisodicMemory[];
  beliefs: Belief[];           // semantic layer from reflection
  facts?: DurableFact[];       // verified declarative knowledge — the fact ledger
  knows: string[];             // char_ids known
  /** This bank's episodic memories have been converted to the first person (see
   *  memory.cleanMemoryContent rule 4). Set once, on load, so the migration never runs twice. */
  first_person?: boolean;
}

// ───────────────────────────── theory of mind (active-inference belief layer) ─────────────────────────────

/** What character A privately believes about character B — a model that can be WRONG.
 *  Behavior is driven off this model, not ground truth; the GAP between prediction and
 *  what actually happens (prediction error) is the dramatic resource: it feeds the cusp
 *  load term, surfaces to the narrator, and biases idle drives toward finding out. */
export interface BeliefAbout {
  target: string;              // char_id this is a model OF (often "char_player")
  predicted_warmth: number;    // what A expects B feels toward A, [-100,100] — may diverge from the true edge
  predicted_stance: "ally" | "rival" | "unknown"; // A's read of where B stands
  held_false?: string;         // ONE concrete thing A wrongly believes about B ("thinks I betrayed them") — the misunderstanding that can drive a scene
  surprise: number;            // 0..1 running prediction-error magnitude; decays in calm, spikes on violated expectation
  confidence: number;          // 0..1 how sure A is of this model; low confidence + high stakes → epistemic drive
  settled_turns?: number;      // consecutive turns this model has been CONFIDENT — the clock reification runs on
  updated_turn: number;
}

/** A's whole theory of mind: sparse — only the people A actually models (player + sharpest tie). */
export interface MindModel {
  character_id: string;        // the BELIEVER
  about: BeliefAbout[];
}

// ───────────────────────────── world ─────────────────────────────

export interface Thread {
  /** In-world timestamp of the last RISE in tension — gates the next one (MINUTES_PER_ESCALATION). */
  last_escalated_time?: string;
  id: string;
  title: string;
  status: "active" | "resolved" | "abandoned" | "dormant";
  description: string;
  turn_started: number;
  /** Last turn this thread was written to, or its subject appeared in the prose. A thread nobody has
   *  touched in a long time is not a live situation, it is a note — see sweepThreads. */
  last_touched_turn?: number;
  turn_resolved?: number;
  tension: number;             // 0–10 how due it is; pressure controller reads this
  /** What KIND of standing source this is. threat is one flavour of demand on the player, not the
   *  axis itself — a world whose threads are all threats can only ever press by endangering them.
   *  Absent on threads authored before this existed; treated as "threat" for weighting. */
  kind?: "obligation" | "opportunity" | "relationship" | "institution" | "threat";
}

export interface ConsequenceEvent {
  id: string;
  description: string;
  fire_turn: number;          // earliest turn it may fire (kept as a floor)
  fire_time?: string;         // in-world time it should fire ("Day 5, 14:00") — the real schedule
  location_trigger?: string;
  severity: "minor" | "notable" | "major";
  source_char?: string;
  status: "pending" | "fired" | "cancelled";
}

export interface Place {
  id: string;
  name: string;
  /** WHAT THIS PLACE IS AND WHOSE IT IS — one sentence, written once, never rewritten by play.
   *
   *  description_facts is a FULL REPLACEMENT every time the world changes a place, which is correct
   *  for the things that actually change (burned, flooded, emptied, rebuilt) and wrong for the one
   *  thing that does not: whose house this is. Each rewrite re-described the ground from scratch, so
   *  a place drifted a little further from itself every time it was touched, and "Rabi's house"
   *  stopped being reliably Rabi's house. This half is fixed. The simulator cannot write it and is
   *  told not to contradict it; only the player can edit it, in the World view. */
  identity?: string;
  description_facts: string;
  changed_turn?: number;   // last turn this place's description was rewritten by play, not by hand
  /** Engine note that this place's description predates something that happened to it. Kept OUT of
   *  description_facts on purpose: that field is the physical baseline the player can read and
   *  edit, and a meta-note appended into it becomes the description when the description was
   *  empty — which is how one place ended up described as a quote of the player's own dialogue. */
  stale_note?: string;
  /** Last turn the player actually stood here. Not for display — it is the boundary for "what has
   *  happened in this room since you last saw it", which is how offstage motion becomes something
   *  the player can walk into rather than a log nobody reads. */
  player_last_here?: number;
  contains: string[];
  founding?: boolean;   // named at the Forge. Never evicted by the place cap; the world's spine.
  /** THE PEOPLE WHO ARE NOT CHARACTERS. `contains` holds carded cast only, and the cast is capped
   *  on purpose — full-fidelity people are expensive. Nothing held the other tier: the ordinary
   *  human traffic of a market, a dock, a town. So a place with no cast member standing in it was
   *  rendered as literally deserted, and a player who built a town of thousands walked through it
   *  alone. `scale` is roughly how many people are about at a normal hour; `who` is one line on
   *  what kind. Both are texture for the narrator — these people are never carded. */
  population?: { scale: number; who: string };
}

/** The convergence/phase system. A phase shapes the tension curve toward (or around) an event,
 *  and can auto-advance into a next phase when its linked consequence fires (e.g. build-up → the war).
 *  Fully generic: "label"/"next_label" are whatever the story is about; the engine only reads the mode. */
export interface FocusPhase {
  label: string;                       // what we're converging on / in ("prepare for war", "the siege")
  mode: "build" | "active";            // build = suppress new chaos, carry toward the event; active = high-tension default, let it rip within the event
  linked_consequence_id?: string;      // when this scheduled event fires, the phase advances
  next_label?: string;                 // the phase to become when it fires ("fighting the war")
  next_mode?: "build" | "active";      // its mode (usually "active")
}

export interface WorldState {
  canon: string[];             // world-altering facts, always in context. Knowledge PROPAGATES: fresh entries carry witness metadata (canon_meta) until news has had time to travel.
  canon_meta?: Record<string, { turn: number; witnesses: string[] }>; // keyed by lowercase canon text — who was present when the fact entered the world, and when. Fresh + unwitnessed = a character does NOT know it yet. Evicted canon folds into the bible instead of vanishing.
  current_turn: number;
  current_time: string;        // "Day 2, 14:30"
  /** Turns before this one are still in `history` — on the page, in the export, in the chapter
   *  record — but are no longer fed to any model. Set by "Clear the log"; 0/undefined = no line
   *  drawn. See engine/context.ts. */
  context_from_turn?: number;
  scene_started_time?: string; // when the current scene began (same format) — resets on location change or a ≥2h jump; the digest prints scene elapsed so timed world laws can be judged
  weather: string;
  player_location: string;
  money: string;               // freeform ("14 chits", "3 silver 20 copper")
  present: string[];           // NPC ids in scene
  places: Record<string, Place>;
  threads: Thread[];
  consequences: ConsequenceEvent[];
  clocks: FactionClock[];
  /** The world's own motion, offstage. Events not aimed at the player, reported every
   *  OFFSTAGE_INTERVAL_MIN of in-world time; they reach the player only via witnesses → rumors. */
  offstage_log?: { turn: number; time: string; what: string; place?: string; actor?: string }[];
  offstage_last_time?: string;
  /** In-world timestamp at each turn, so elapsed travel time can be measured between two turns
   *  rather than assumed from a turn count. Trimmed to the recent window. */
  time_at_turn?: Record<number, string>;
  /** People whose journey to the player completed this turn — the narrator has to write them
   *  arriving, or they appear out of nowhere, which is exactly the bug this exists to stop. */
  arrivals_pending?: string[];
  /** THE OTHER HALF OF THAT. People the engine walked OUT of the player's scene — today only ever
   *  the schedule, when a live scene has held somebody so far past a shift that waiting for the
   *  narrator to write the goodbye has become the bug. Omission from a shorter cast list is not a
   *  statement that somebody left; the narrator has to be told, or the next turn quietly writes
   *  around a hole where a person was. Rendered once, then cleared with arrivals_pending. */
  departures_pending?: { name: string; to: string; why: string }[];
  /** THINGS THAT REACH THE PLAYER FROM OFFSTAGE — a text, a call, a letter, a knock. The offstage
   *  world has only ever reached the player through witnesses and rumor, which models a village and
   *  nothing else; a woman in an apartment across the city could not send a message to a man in a
   *  hotel. Written by the offstage pass, rendered by the narrator on the next turn, then cleared. */
  inbound?: { from: string; how: string; content: string; turn: number }[];
  present_prev?: string[];      // who was in the scene before the last presence rebuild — so the narrator delta can SAY who left, rather than leaving it to be inferred from a shorter list
  offstage_last_turn?: number;  // turn of the last offstage pass — the turn-based floor on the interval, so a story told in conversation doesn't freeze the world for forty turns
  /** How far apart places are, in in-world minutes of ordinary travel. The engine uses this to
   *  answer "could word have got there and back by now?" instead of leaving it to the narrator,
   *  which reliably answers yes and writes a hard gallop to justify it. */
  distances?: { from: string; to: string; minutes: number }[];
  norms: Norm[];
  rumors: Rumor[];
  edges: SocialEdge[];
  /** HOW THE WIDER COMMUNITY HOLDS THE PLAYER: -10 (feared) … 0 (no fixed reputation) … +10
   *  (beloved), decaying toward 0. The crowd's counterpart to `edges` — named characters have
   *  histories with the player, the community only has what it has seen and heard. Moved by public
   *  acts (updatePublicStanding in social.ts), read by the narrator via publicStandingDirective,
   *  and used to break the tie on how a rumor about the player travels. Undefined on old saves =
   *  neutral. */
  public_standing?: number;
  /** AN OPEN CALL THE PLAYER PUT TO A POPULATION rather than to a person — a summons, an offer, an
   *  invitation, an advertisement, a proclamation. The engine had no reading for one at all: the
   *  only ways anybody new could reach the player were an existing cast member whose drive already
   *  named him, or the offstage pass volunteering a contact, and the crowd was licensed to exist but
   *  explicitly forbidden a name. So a call could be answered by nobody, forever, and the silence
   *  looked like the world's considered verdict instead of an absence of machinery. See
   *  openCallDirective in population.ts. */
  open_call?: { what: string; turn: number; time: string; reach: number; answered: number };
  promises?: Promise[];         // the promise ledger: who swore what to whom, and whether it was kept
  focus?: FocusPhase | null;    // the convergence/phase system: shapes the tension curve toward an event, then auto-advances when it fires
}

// ───────────────────────────── telemetry & history ─────────────────────────────

export interface TurnTelemetry {
  turn: number;
  pressure: number;
  pressure_source: string;
  narrator_tokens_in: number;
  cached_tokens?: number;      // input tokens served from prompt cache (billed ~0.25x) — measures cache effectiveness
  turn_cost?: number;          // actual $ cost of this turn from the provider, when reported
  narrator_tokens_out: number;
  simulator_tokens_in: number;
  simulator_tokens_out: number;
  reflection_tokens: number;
  duration_ms: number;
  ts?: number;                 // wall-clock ms — fuels the daily cost governor
  word_count: number;
  player_mood_valence: number;
  present: string[];
  time_label: string;
  edge_snapshot: { pair: string; warmth: number; trust: number }[]; // player edges
  lyapunov?: number;           // λ̂ of the social map this turn
  coherence?: number;          // Kuramoto order parameter R
  regime?: "damped" | "critical" | "cascading";
  early_warning?: boolean;
}

export type ActionMode = "do" | "say" | "think" | "story";

/** The four QRE stances an agent can play in the strategy layer. Canonical home here so
 *  both the undertow (which computes them) and the mind layer (which reads them) can import. */
export type Stance = "press" | "maneuver" | "hold" | "yield";

export interface TurnHistoryEntry {
  turn: number;
  kind?: "turn" | "interlude" | "opening";   // opening = the scene you start in (editable, pre turn-1)
  span_label?: string;           // "three days pass"
  player_action: string;
  action_mode?: ActionMode;
  shifts?: string[];           // humanized per-turn deltas ("Ettel will remember that")
  directive?: string;          // the exact direction the narrator received — nothing hidden
  present?: string[];          // who was in the scene THIS turn — illustrations render the paragraph's own cast, not today's
  illustration_url?: string;
  /** This turn WAS illustrated, and the pixels have since been dropped to keep the save small
   *  (see forgetOldPictures). The record survives; the picture does not. */
  illustrated?: boolean;
  narrator_prose: string;
  /** The reviser's copy — what the player reads, when the pass ran and changed something. The
   *  narrator's own words stay in `narrator_prose` and stay authoritative: presence, novelty,
   *  appellations, maxims, place descriptions, the bookkeeper and every audit read that field and
   *  are entirely unaffected by this one. Absent on every turn the reviser did not touch and on
   *  every save written before it existed, which is why readers go through `displayProse`. */
  narrator_prose_read?: string;
  /** Bookkeeping health for this turn. "thin" = the diff parsed but recorded nothing that changed the
   *  world; "failed" = the simulator returned nothing usable. Either way the prose happened but the
   *  world did not notice, and the turn can be re-run through the bookkeeper without re-narrating. */
  bookkeeping?: "ok" | "thin" | "failed" | "partial";
  summary: string;             // simulator one-liner, used for context
  offscreen: string[];         // world-motion log lines
  /** What the player's own faculties made of the focused character this turn — owned, first-person,
   *  frequently wrong. Generated in a SEALED context that never sees the target's true state, which
   *  is why it cannot leak one. Kept on the entry so the Chronicle can replay a scene as it was
   *  actually experienced rather than as it actually was. */
  reads?: { faculty: string; line: string }[];
  gm_intents?: { char_id: string; name: string; surface: string; truth: string; tell?: string; lying: boolean }[]; // GM VIEW: the private intent each staked NPC authored this turn — the lie/hidden want the prose deliberately concealed. Never shown in prose; visible only in the GM/character panel for verification.
  weather?: string;
  time_label: string;
  /** Set on every beat of a directed montage, so the Chronicle can render one run as a
   *  single "a month passes" card instead of eight orphaned interludes. */
  montage_id?: string;
  montage_beat?: string;   // "3/8"
}

export interface SaveState {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  world_bible: WorldBible;
  model_settings: ModelSettings;
  world: WorldState;
  /** AUXILIARY SPEND — model calls the per-turn telemetry never sees: montage planner/beats/
   *  chapter and image generation. The spend meter reads this so the number you see matches the
   *  OpenRouter dashboard instead of undercounting the two biggest lump costs. */
  aux_spend?: { images: number; montage_calls: number; tokens_in: number; tokens_out: number; cost: number };
  characters: Record<string, Identity>;
  traits: Record<string, AcquiredTrait[]>;
  habits?: Record<string, CoreHabit[]>;   // per-character core habits as firing physics (behind habit_engine flag). Backfilled from core_traits.
  condition: Record<string, Condition>;
  memory: Record<string, CharMemory>;
  minds?: Record<string, MindModel>;   // theory-of-mind: per-character private models of others (active-inference belief layer)
  pending_beauty_rescore?: string[];   // char_ids whose on-sight appearance changed and whose intrinsic beauty needs re-scoring (flushed via a small AI call after the turn)
  history: TurnHistoryEntry[];
  vessel_history?: { turn: number; from_name: string; to_name: string; time_label: string }[]; // bodies the player has worn
  undertow?: unknown;          // continuous substrate state (phases, tangent, cusps) — engine-internal
  telemetry: TurnTelemetry[];
  pressure_trace: number[];    // controller history
  records: { id: string; type: string; title: string; contents: string; location: string }[];
  chapters?: Chapter[];        // auto-generated story chapters (see Chapter)
  sim_dry_runs?: number;   // consecutive turns where real prose produced an empty bookkeeping diff — a failing simulator model dies silently otherwise (edges freeze, memories stop, toasts vanish); the watchdog makes it visible
  sim_escalated_until?: number;  // when the simulator has failed repeatedly, temporarily route bookkeeping to the fallback model through this turn, then auto-clear after a healthy streak
  context_anchor?: { turn: number; digest: string; cast_sig: string; present?: string[]; ledger?: Record<string, Record<string, string>> }; // chatlog mode I-frame: the full state snapshot the conversation is anchored to, plus a per-character ledger fingerprint so P-frames can render ONLY what diverged since (dirty-set)
  contract_drift?: string | null;
  /** A sentence from LAST turn that stated somebody's interior outright. The engine has always been
   *  able to detect these (MOTIVE_LEAK, used to scrub the replayed history so the model does not
   *  learn from its own violations) and has never told anyone it caught one — least of all the
   *  narrator, which went on making the same move. Quoted back at it next turn, then cleared. */
  last_leak?: string | null;
  /** A MAXIM somebody was made to say last turn — a short, closed, portable sentence stating a
   *  general truth. Same mechanism as `last_leak` and for the same reason: the rules that forbid
   *  this all live in the cached prefix, where they are reference, and the one thing that has ever
   *  reliably broken a narrator habit is being shown the sentence at the end of the next turn's
   *  directive. See engine/maxims.ts. */
  last_maxim?: string | null;
  /** The narrator handing the player's own line back — either demanding they repeat it, or quoting
   *  it back at them. Caught in the OUTPUT rather than forbidden with a quoted example in the
   *  prompt, because a banned line pasted into the context is a line the model has been supplied
   *  (see tests/prompt-echo.ts). Corrected at the end of the next turn's directive, same mechanism
   *  as last_maxim and last_leak. See engine/echo.ts. */
  last_echo?: { line: string; kind: "demand" | "parrot" } | null;
  /** The turn the whole cast going cold was reported, so it is said once rather than every turn.
   *  Cleared when the ledger recovers. See castGoneCold. */
  cast_cold_said?: number;
  /** Facts the world does not hold yet and is working toward. Each spends a turn off its clock only
   *  on a turn the world visibly moved, and lands in world.canon when the clock runs out. See
   *  engine/becoming.ts. */
  becomings?: import("./becoming").Becoming[];
  /** Becomings that landed in canon on the turn just written, so the NEXT turn's direction can say
   *  so on the page. Cleared once it has. */
  pending_arrivals?: import("./becoming").Becoming[];
  /** Consecutive turns each present character has been in the room without a line. Cleared for
   *  anybody who is not present, so it never accumulates across a scene change. See speech.ts. */
  speech_silence?: Record<string, number>;
  /** What the last turn's prose actually measured: the share of its words that were spoken aloud,
   *  and the share of its lines that were fragments. The evidence the next turn's correction is
   *  built from — nothing else in the engine was counting either. */
  last_speech?: { share: number; short: number; turn: number };
  /** A line last turn that delivered something the player's own record already held. Corrected at
   *  the end of the next turn's direction, same mechanism as last_maxim and last_echo — the rules
   *  against restating live in the narrator's FINAL CHECK, which is a self-audit. See spent.ts. */
  last_retold?: { line: string; known: string } | null;
  /** The player addressing the machine rather than the world — a note about the writing. Carried
   *  for a few turns as standing direction, never dramatised. See engine/ooc.ts. */
  last_ooc?: { complaint: string; turn: number } | null;
  /** Somebody found inside the player's private space last turn with no door on the page. Corrected
   *  at the end of the next turn's direction, same mechanism as last_maxim. See engine/threshold.ts. */
  last_intrusion?: { name: string; line: string; place: string } | null;
  /** AN ENDING IN PROGRESS. The player has said it is over and the other person has not been got
   *  past yet. `needed` is bought by what they actually have in the bond — a marriage of forty
   *  remembered scenes costs more scenes to end than an acquaintance does. Never a veto: the player
   *  leaves regardless, it just takes the turns it would really take. See engine/severance.ts. */
  severance?: { toward: string; rounds: number; needed: number; started_turn: number };
  /** Distinctive props the DIALOGUE has already spent — the invented proper noun, the odd piece of
   *  trade vocabulary, the specific colour — with the turns they were said on. A subject on the page
   *  in consecutive turns is handed back to the narrator as used up, so a character who is written to
   *  deflect deflects with something new instead of the same anecdote three scenes running. Cast and
   *  place names are never tracked: a scene must always be able to say who is in it. See
   *  engine/spent.ts. */
  spent_subjects?: { word: string; turns: number[] }[];
  // RETCONS — the player's veto. When the narrator invents something that breaks the world (a person
  // who cannot exist, an event that contradicts canon), the player strikes it. Each entry is a
  // standing correction injected into every subsequent turn: this did not happen, never refer to it.
  // Unlike canon (what IS true) a retcon states what is NOT and never was.
  // The player's two kinds of override. "veto" (default): the narrator invented this — it never
  // happened, never mention it, purge its traces. "correction": the narrator broke a rule that IS
  // true — the text is world law, affirmed not voided; nothing is rolled back or purged. The Velora
  // failure was a correction misfired as a veto: the engine broadcast the law as struck and deleted
  // the canon lines that carried it, so the narrator was ordered to deny the rule the player wanted.
  retcons?: { text: string; turn: number; kind?: "veto" | "correction" }[];
  // DESTINATION TRACKING: only when world_bible.destination is set. The chapter auditor scores how
  // close the story has come to its stated ending and names the next concrete thing standing in the
  // way; the narrator receives both. `reached` freezes scoring once the ending has actually landed.
  // pct comes from the clock (turns elapsed / budget) and updates every turn. `missing` is the
  // auditor's description of the remaining gap, refreshed when the act changes. `act` records which
  // act the last audit ran in, so the next act change triggers exactly one more.
  destination_progress?: { pct: number; gained: string; missing: string; turn: number; reached?: boolean; act?: string } | null;
  pressure_state?: { last_beat_turn: number; last_exo_turn: number; last_beat_time?: string; last_exo_time?: string; recent?: { ref: string; turn: number; count: number; time?: string; kind?: string }[] }; // source-driven beat cooldowns (see pressure.ts selectBeat) // CONTRACT GOVERNOR: set when the chapter check finds the story drifting from the standing direction; injects a course-correction directive until the next check passes
  /** THE PLAYER'S PERCEPTUAL APPARATUS — named, biased faculties derived once from their card
   *  (see engine/read.ts). The read channel speaks through these while the narrator writes the
   *  surface. Re-derived only when the card materially changes; trait_count is the trigger. */
  faculties?: { turn: number; trait_count: number; list: { name: string; notices: string; distorts: string }[] };
  /** Last turn the success-consequence pass ran; rations it (see engine/consequence.ts). */
  last_establish_turn?: number;
  persona_reading?: { turn: number; mbti: string; read: string; traits: string[]; arc: string }; // on-demand full-history read of the player as played
  snapshots: { turn: number; blob: string; z?: boolean }[]; // rollback ring, max 7; z = gzip+base64 compressed
  travel_log?: { turn: number; place: string }[]; // player's path through places, in visit order — feeds the story map
  /** The highest power tier this world has actually WITNESSED, and when. A reputation, not a
   *  setting: it decays a rung at a time (see rememberPowerTier) instead of expiring with the
   *  three-turn prose window, so how the world orients to a known power outlives the last sentence
   *  that happened to describe it. */
  power_witnessed?: { tier: "mortal" | "empowered" | "mythic" | "cosmic"; turn: number };
  /** Provenance of the file this save was imported from (see engine/version.ts). Absent for saves
   *  created in this build, and for imports of exports made before stamping existed. */
  imported_from?: { schema: number; app: string; exported_at: string; turn: number; engine?: string };
  /** Who drove the last scene. A tiebreak only: when two present characters want things equally,
   *  the one who steered last turn yields, so a single NPC cannot hold the wheel indefinitely. */
  last_scene_lead?: string;
}

// ───────────────────────────── simulator contract ─────────────────────────────

export interface SimulatorDiff {
  scene_summary: string;
  elapsed_minutes: number;
  weather?: string;
  player_location?: string;       // a place id, OR a free-text place name (auto-created if new) — where the PLAYER now is
  locations?: { char_id: string; place: string; said?: string }[]; // move characters between places. `place` must name an existing place, or "elsewhere". `said` quotes the prose that says they moved.
  money?: string;
  present?: string[];             // optional hint; the engine derives the real scene from co-location with the player
  facts: { char_id: string; field: "fatigue" | "hunger" | "thirst" | "slept" | "condition_add" | "condition_remove" | "inventory_add" | "inventory_remove" | "wearing_add" | "wearing_remove" | "injury" | "injury_remove"; value: string }[];
  psyche: { char_id: string; relaxation_delta: number; mood: string; states_add?: string[]; states_remove?: string[] }[];
  edges: { from: string; to: string; warmth_delta: number; trust_delta: number; power_delta: number; attraction_delta?: number; note?: string; roles_set?: string[] }[];
  aliases_add?: { id: string; alias: string }[];
  memories: { char_id: string; content: string; importance: number; emotional_charge: string; scheduled_time?: string; anchor?: string; core?: boolean }[]; // core: life-defining — promoted to permanent core memory + durable fact
  facts_learned?: { char_id: string; fact: string; quote?: string; corrects?: string }[]; // durable declarative facts, verbatim-quoted — verified by the engine before storage
  traits: { char_id: string; label: string; origin: string; behavioral_impact: string; intensity: number }[];
  /** SOMETHING THE ROOM CANNOT EXPLAIN. Asked of the bookkeeper directly, because the engine's own
   *  detector for this was a regex over prose hunting for words like "godlike" — and the prose rules
   *  forbid writing like that, so a man creating half a ton of gold from nothing read as a cart
   *  arriving. A model can judge "could the people here account for that by ordinary means?" and a
   *  keyword list cannot. See engine/reaction.ts. */
  unexplained?: { what: string; witnesses?: string[] };
  canon_add?: string[];        // world-altering public facts: new faiths, regime changes, public miracles, wars — broadcast to every mind
  /** Per-becoming read of THIS turn: did the world move toward it, how, and did the player act
   *  against it. Judged by meaning, never by whether the claim's words appear. See becoming.ts. */
  becoming_progress?: { claim: string; moved?: boolean; how?: string; opposed?: boolean }[];
  track?: string[];            // promote these characters to the long game (they matter to a thread now)
  appearance: { char_id: string; value: string; permanent?: boolean }[]; // default: replaces appearance_now (presentation). permanent:true = ONE sentence APPENDED to the bedrock appearance_facts; bedrock is never replaced by the engine
  drives_update: { char_id: string; goal: string; progress?: number; blocker?: string; priority?: number }[]; // new or revised offscreen want
  stances?: { character: string; stance: "yielded" | "refused" | "countered"; about: string; toward?: string }[];
  /** Who was in the WRONG this turn, and toward whom. The counterpart to stances: stances record how
   *  somebody answered pressure, this records somebody having caused harm. Deliberately narrow — a
   *  disagreement is not a fault, and being disliked is not a fault. See engine/fault.ts. */
  faults?: { character: string; toward: string; about: string }[]; // how a character answered real pressure (a request, demand, proposal) — yielded against their will, refused, or negotiated. Willing agreement is not recorded
  promises_new?: { from: string; to: string; text: string; weight?: 1 | 2 | 3; due_time?: string }[];
  promises_resolved?: { id?: string; from?: string; to?: string; text?: string; outcome: "kept" | "broken" }[];
  threads_update: { id?: string; title: string; status: "active" | "resolved"; description?: string; tension?: number }[];
  character_exits?: { char_id: string; kind: "dead" | "departed"; note?: string }[]; // someone died or left the story for good
  traits_expressed?: { char_id: string; traits: string[] }[]; // which core traits this turn actually put on screen, judged by meaning (a gelato expresses "loves ice cream")
  texture_add?: { char_id: string; item: string }[]; // a small standing interest/quirk the story has earned (e.g. "has taken to fishing")
  rumors_new: { content: string; truth: "true" | "distorted" | "false"; salience: number; origin_char: string; about_char?: string }[];
  consequences_new: { description: string; fire_in_turns?: number; fire_in_days?: number; fire_in_hours?: number; severity: "minor" | "notable" | "major"; source_char?: string; location_trigger?: string }[];
  clocks_advance: { id: string; segments: number }[];
  new_characters: { name: string; age: number; appearance_facts: string; background: string; core_traits: string[]; speech_pattern: string; gregariousness: number }[];
  new_places: { name: string; description_facts: string }[];
  places_update?: { place: string; description_facts: string; note?: string; population?: { scale: number; who: string } }[]; // a place the prose materially CHANGED — rewritten description_facts (see applyDiff)
  offscreen: string[];          // world-motion lines (the merged world tick)
}

export const DEFAULT_MODELS: ModelSettings = {
  narrator_model: "deepseek/deepseek-v4-pro",
  simulator_model: "google/gemini-3.1-flash-lite",
  forge_model: "anthropic/claude-opus-5",
  fallback_model: "google/gemini-3.1-flash-lite",
  reviser_model: "google/gemini-3.1-flash-lite",
  image_model: "google/gemini-2.5-flash-image",
  illustration_keep: 12,            // pictures that keep their bytes; older turns keep the record only
  context_memories_k: 6,
  reflection_cadence: 10,
  history_window: 5,
  lean_mode: false,
  token_budget: 0,
  tension: 5,
  // COST DEFAULTS (new games): the configuration that makes a long campaign cheap. Existing saves
  // keep whatever they already have — flip these in Tuning to get the same economics there.
  route_by_price: true,             // every call rides the cheapest healthy provider
  context_mode: "chatlog",          // append-only context: between anchors nearly all input bills at cache-hit rates
  narrator_reasoning: false,        // narrator thinking is billed as output; prose doesn't need it
  prefer_deepseek_provider: true,   // first-party DeepSeek carries the 0.8–2% cache-hit rate
  prose_reviser: false,             // opt-in: one extra call on turns that trip the tic detector
};
