# The Kernel — what Weft's engine is actually doing

The systems doc. PHILOSOPHY.md explains how people work; this file explains the machine that
moves them: one scalar, the numbers around it, the order things run in, and every place energy
enters and leaves the system. If you are lost in the values, start at §1 and keep §3 open in a tab.

## 1. The mental model in one paragraph

The engine is a **dissipative homeostat**, not a physics toy and not a cellular automaton. Every
character's inner life is one number, **relaxation** (−10 clenched … +10 open), which events shove
and which drifts back toward that character's resting point every turn. Everything else — emotion,
desire, memory tint, misreading, co-regulation, rumors, breaking, release — is a **threshold rule
or a coupling on that one scalar**. Structure emerges because accrual and dissipation are both
always running: tension builds, relaxation releases, and the interesting behavior lives in the
flow-through between them. The LLM's job is narrower than it looks: it writes the prose, files the
bookkeeping deltas, and nothing else. The scalars decide what the prose is allowed to mean.

This is deliberately **computationally reducible**. You can predict the kernel's trajectory in
closed form, and that is a feature, not a limitation: the physics stays legible and debuggable
while the narrator supplies the richness. The one cellular-automaton rule in the system (the rumor
field, §6) inherits its destruction phase from the same kernel — growth and decay on the same
rule, so the field cycles instead of only complexifying.

## 2. The scalar and its entourage

Per character (`Psyche` in `src/engine/types.ts`):

| field | range | meaning |
|---|---|---|
| `relaxation` | −10 … +10 | the body's current openness. The one number everything reads. |
| `capacity` | −6 … +6 | resting point — relaxation drifts here. Set at forge from conscience+traits; healed downward in turn.ts if it contradicts the character's nature. |
| `recovery` | 0.01 … 0.45 | drift rate per turn. Some people return to calm fast; some sit braced for days. |
| `discharge_lift` | +1.5, decays ×0.7/turn | temporary capacity bonus after a discharge (§5). An opening, not a personality change. |
| `consecutive_clenched` | turns | counts turns at ≤ −7. Resets the moment the body rises above −7. |
| `open_run` | turns | mirror of the above, for settled runs — feeds reflection. |
| `prev_relaxation` | −10 … +10 | start-of-turn baseline, captured before drift. The discharge detector's reference. |
| `state` | intact → fracturing → broken/shattered | derived, never set directly (see §3). |
| `mood` / `mood_valence` | word / −10…+10 | weather, not climate. Valence is derived (`relaxation × 0.8`); the word is set by the simulator or colonized by a gripped emotion. |
| `active_states` + `state_ages` | strings + turns | emotions currently held, with the turn each arrived — the lifecycle's clock. |

The player's scalar is special in one way: the engine never authors it upward. Their **tightness
anchor** (0–5 self-report against their own meditative zero) caps relaxation but cannot lift it
(`reconcilePlayerTightness` in physiology.ts). You can always be tighter than the model thinks;
you can never talk yourself above earned tension.

## 3. The thresholds that mean something

Every number below is a load-bearing constant. Changing one changes behavior; they are gathered
here so you can see the whole skeleton at once.

| threshold | where | what it triggers |
|---|---|---|
| r ≥ +4 | Play UI | breath orb reads "open" |
| r ≥ +3 | emotions.ts | gripped emotions **self-liberate** after 2 turns — felt fully, leaving their residue |
| sigmoid(r × 0.7) | habits.ts | the **calm road** to seeing a habit as it fires — clear at +3, near-blind at −3 |
| 0.04 + 0.22·loud·gripped | habits.ts | the **second road**: intensity, not ease. Loud = pressure above 4; gripped = r below −2, full by −8. The two are independent doors, so a deep clench at full volume sees about one firing in five instead of one in a hundred and forty |
| r ≥ +2 | emotions.ts, social | stale moods fade; you count as someone's safe person |
| r ≤ −2 | physiology.ts | visible tension cue rendered for the narrator (shoulders/jaw/breath, never interior) |
| r ≤ −3 | emotions.ts | "threatened": the **second hit** — a held emotion older than 3 turns starts draining −0.2/turn and colonizes the mood; avoidant attachment stops taking comfort |
| r ≤ −4 | tickPsyche, emotions.ts | the **fracturing line**: 4 turns at ≤ −7 flips state to fracturing; a discharge must return above −4 to count |
| r ≤ −7 | tickPsyche | "deep clench": the counter runs; fracturing → broken at −9 |
| rise ≥ 2.5 from ≤ −7 | emotions.ts | **discharge** (§5), if the clench was held (counter ≥ 3 or a fracture state) |
| drift asymmetry | tickPsyche | above capacity, relaxation collapses fast (rate ≥ 0.5); below capacity, it recovers at the character's own `recovery` |

Physiological **ceiling** (physiology.ts): sleep debt ≥ 16/20/24/36 waking hours caps relaxation at
+4/+1/−2/−5; severe thirst and hunger stack on top; the player's subjective baseline stacks under
all of it. Context can lower you below the ceiling; nothing lifts you above it. The body vetoes
the mind.

## 4. The turn pipeline (who moves the scalar, in order)

Per turn in `src/engine/turn.ts`:

1. **Baseline capture.** `prev_relaxation = relaxation` for everyone, then `tickPsyche` drifts each
   body toward capacity (fast collapse above it, own-rate recovery below) and derives
   intact/fracturing/broken from the clench counter. Discharge lift decays here.
2. **Undertow, fate, pressure** (deterministic) decide what the world throws.
3. **Attempt frame (deterministic).** If the player's typed action is a stakes-bearing attempt
   (`attempt.ts`), the outcome is resolved HERE, before a word of prose: capability × body ×
   circumstance against a difficulty from pressure and the verb class. The verdict is appended
   to the narrator directive as law (§8).
4. **Narrator + simulator (LLM).** The simulator's `relaxation_delta` per character is the main
   event-driven shove. The player's tightness anchor caps after this. Promises filed this turn run
   `completeDrivesForPromises` — an accepted commitment matching a character's drive closes that
   want deterministically (§5, answered-want closure).
5. **Tail ticks, each fault-isolated** (a failure degrades one system for one turn, never the turn):
   - `tickDesire` — warmth earns attraction under its conditioned ceiling; fixation taxes relaxation.
   - `tickRivalry` — two present characters wanting the same person: the one watching the rival's
     pursuit land takes the jealousy dip and state (§5, rivalry).
   - `tickCoRegulation` — **pairwise** safe-person pull (attachment-styled, clamp ±0.5), then the
     **mean-field** pass (§5): the room's aggregate leans on everyone, clamp ±0.3.
   - `tickEmotions` — the lifecycle: self-liberation with residue, or the second hit and its drain.
   - `tickDischarge` — reads the fully settled relaxation against the start-of-turn baseline.
   - Theory-of-mind update, drives, then `diffuseRumors` — the rumor field (§6).

Time skips (`continuity.ts`) run a subset: drift, drives, rumors, bonds — no deltas, no discharge
(nobody is releasing anything offscreen; the world just turns).

## 5. The new mechanics (what changed and why)

**Mean-field coupling** (`tickCoRegulation`, second pass). Pairwise co-regulation is star-topology:
each character finds their single safest person. Collective phenomena need neighborhood reads, so a
second pass computes the room's mean relaxation (the player counts as steady company, = 3, the same
convention as the pairwise pass) and nudges each present NPC toward it:
`pull = clamp((mean − r) × 0.03 × boost, ±0.3)`, with a dead zone of ±1 to prevent jitter. The
boost (×1.6) fires when ≥ 75% of the room sits on the same side of neutral — lopsidedness is where
phase transitions live: a unanimous calm holds a frightened stranger, a unanimous bracing sweeps a
crowd into panic. It is deliberately weak and additive. It biases the kernel; it never overwrites
it. (The deleted Kuramoto/cusp layer overwrote relaxation and severed the generative kernel. This
is built to not repeat that.)

**Discharge** (`tickDischarge`). Contraction held past capacity does not taper off — it lets go.
Detected when a body was deep-clenched at the turn's start (≤ −7, with counter ≥ 3 or a fracture
state proving it was *held*, not just visited) and returns above −4 within the turn with a rise of
≥ 2.5. Drift alone cannot fire it: a body drifting home resets its clench counter at the
start-of-turn tick, so only a genuine mid-turn release qualifies. Consequences: the oldest gripped
emotion transmutes immediately with its residue (the charge *and* the story about the charge both
go), a colonized mood clears, and the body earns `discharge_lift = +1.5` capacity, decaying
×0.7/turn. Somatically this is completion of the stress cycle; in the fiction it's the sob, the
laugh, the shaking exhale the narrator just wrote, now visible to the physics. Player excluded —
their release is theirs to report.

**The rumor field** (`diffuseRumors`). The one cellular-automaton rule in the engine, and the
answer to "CA complexifies but never reduces." Neighborhoods are co-located groups (the player's
scene, plus offscreen characters bucketed by location). Cell state is knower/naive plus the
relaxation scalar. The local rule reads each neighborhood's **mean relaxation** and matches it
against the rumor's lexical **charge** (dread words → −1, warm words → +1, else 0): dread spreads
up to ×2.5 faster in a clenched room, warm news in a settled one. And the field reduces:
`salience −= 0.3` every turn, death below 1 (a rumor nobody is charged enough to repeat dies of
boredom, not old age), while transmission in matching weather feeds `+0.6` once per turn ("the
story grows in the telling"). Growth and decay on the same rule — the destruction phase is
inherited from the kernel the field rides.

**Departure evidence guard** (applyDiff, LOCATION pass). `diff.locations` is the bookkeeper's
claim about where everyone is, and `world.present` is derived from it — so a bad claim dumps a
speaking character offscene and the next turn's narrator faithfully renders an empty room. The
schema already asked for evidence (a `said` quote); the engine now checks it. A character who was
in `world.present` when the turn began cannot be moved unless the turn's prose shows the
departure: either the `said` quote (≥ 8 chars, normalized) appears verbatim in the prose, or a
departure verb (left, exits, headed off, took the lift, dismissed, withdrew, …) appears within
±160 chars of their name. Name probes use the full name plus each word of it, skipping titles and
ranks (the prose says "Hale left", never "Mr. Hale left"). A move without evidence is discarded
with a `bookkeeping correction: X stays — the prose never showed them leave` shift. Offscreen
characters move freely — the world goes on offstage; the guard only protects the scene the player
is standing in. (Seen in play: a scene's whole speaking cast was moved to "elsewhere" while the
prose had them talking to and holding the player, and the next turn opened on an empty room.) The bookkeeper prompt (both tiers) now states the rule from its side: a character
who spoke or acted in the turn's prose is recorded at the player's location, never elsewhere;
missing, dead, captured, or stranded characters are never placed somewhere the fiction ruled out
until the prose shows them found, freed, or returned.

**Rivalry** (`tickRivalry`, desire.ts). Jealousy, modeled as the same energy as fixation: desire
is directional, so when two present characters want the SAME person and one watches the other's
pursuit LAND, the watcher's nervous system registers the threat. "Wanting" is attraction ≥ 25 or
a romantic role on the edge (the bookkeeper's label for desire the numbers haven't caught up
with); "landing" is the target warming back (NPC targets) or the rival warmly pursuing (player
target — the player's own response is theirs, never authored). The hit: a capped relaxation dip
(−0.2 to −0.6/turn) plus a `jealous of X` active state that the emotion lifecycle and narrator
carry like any other. Attachment shapes both magnitude and grip threshold: anxious grips hardest
and holds even from relative calm (the pattern is pre-loaded), secure feels the pang and lets it
move unless already clenched, avoidant armors over it. The state releases when the rival leaves
or the watcher settles past their threshold. Deterministic, zero tokens: the cause is computed;
the narrator renders the effect. (This exists because a love triangle was playing as universal
agreeableness — the fiction said jealousy, the state said calm, and nothing deterministic was
reading the geometry.)

**World law vs. content bans, and the correction channel** (`engagedLaw`, facts.ts; `strike`/`correct`,
api.ts). The bible's `forbidden` list is WORLD LAW, not a content filter: entries that state how
bodies, biology, culture, or society work bind EVENTS like physics, even when the player's own
action crosses them — the old wording ("does not punish something the player chose") licensed the
narrator to suspend a biological law mid-scene, which is exactly how an hour-long foot massage
played tender in a world whose law says pain at ten minutes. `engagedLaw` detects the contact
deterministically (token relevance, or strong-word prefix matching against forbidden entries,
magic rules, and canon) and quotes the matched law to the narrator as binding truth with the
anti-litigation clause: never invent an exception, never explain it away, never frame respecting
it as the mistake. The player override layer is split in two after the gaslight failure: **strike**
(the veto) voids an INVENTION — rolls back, purges traces, canon lines survive unless they
substantially restate the struck text (relevance ≥ 0.5; the old any-6-letter-word filter deleted
the player's own biology law when they misfired a correction as a veto); **correct** (the mirror)
affirms a rule the narrator broke as supreme truth and canonizes it, rolling back and purging
nothing. Vetoes render as STRUCK FROM THE STORY; corrections render as THE PLAYER'S CORRECTIONS,
to the narrator and the bookkeeper both.

**Friction: warmth is not agreement** (desire.ts, social.ts, prompts.ts). The agreeableness bug had
three layers. (1) Rendering: disposition cues described only what affection looks like, so warmth
compiled to compliance. Every warmth band now also says how the person disagrees — devotion is not
obedience, trust is reliance not deference, and a neutral stranger is polite, measuring, and
noncommittal — plus a narrator law: warmth lowers ceremony, not independence, and an instant
uncomplicated yes from a character with an agenda is a rendering failure. (2) Stranger phase: a
deterministic cue (few shared memories plus warmth under 40) marks young relationships as
"still measuring you", so first meetings get small questions and hedging instead of instant ease.
(3) The self-betrayal clench, the Dzogchen mechanic that was missing: the bookkeeper records a
`stances` entry when a character answers real pressure (yielded / refused / countered), and
`applyStances` taxes yielding against an active want — a relaxation dip scaled by attachment
(anxious yields dearest) plus a `betrayals` counter that shows as "swallowing resentment" at 3+.
Standing your ground is free and hands a point back; the counter drains over quiet turns. A willing
yes costs nothing. (4) Rupture-repair: refusals and counters stamp the pair's edge, and trust grown
within five turns of a rupture earns half again (applyEdgeDelta), because repaired conflict, not
smoothness, is how trust is actually built. The bookkeeper's edge rule now says the same in words.

**Dialogue law, the scene clock, and clock discharge** (prompts.ts, pressure.ts, turn.ts). Three
holes shared one symptom — characters who read as wisdom-dispensing robots while the world's own
clocks went unfelt. (1) The DIALOGUE law is rewritten around "people, not counselors": answer the
feeling not the thesis ("I'm an ugly duckling" earns "aww, why would you say that?", never a
reframe); no clinician mode (Socratic leading questions, validating reframes, spoken diagnosis of
another's pattern are banned shapes; insight shows in action); state degrades speech (arousal,
fear, and bodily urgency make people dumber, not wiser — no measured paragraphs mid-emergency);
people listen through themselves; emotional literacy is a trait, not the water supply. (2) The
digest now prints a scene timer beside the location (`scene running ~N min`, tracked in
`world.scene_started_time`, reset on location change, big jumps, and time skips) so timed world
laws have something to be measured against — the law directive and corrections block both state
that a timed threshold is a running clock that conversation does not pause. (3) Fired faction
clocks no longer die silently: `dischargeFiredClocks` converts a full clock into a due
consequence, which the beat picker discharges first, before cooldowns and grace — a clock's
promise now lands at full scale instead of evaporating at 6/6. (4) Per-character pronouns printed
in the digest are binding law (FINAL CHECK 13), closing the card-vs-narration pronoun drift.

**Answered-want closure** (`completeDrivesForPromises`, social.ts + two prompt laws). The fix for
the broken-record failure: a character whose want was answered kept re-asking, because the answer
never reached state. Three layers now close the loop. (1) Narrator law: a want voiced and answered
becomes action or silence, never a restatement — an already-answered question is never put to the
player again (TURN STRUCTURE + FINAL CHECK 12, both prompt tiers). (2) Bookkeeper mandate: an
accepted proposal is a commitment and MUST reach state as promises_new; an answered want MUST
rotate via drives_update to the next concrete goal ("plan the evening"). (3) The deterministic
safety net: when a filed promise's text matches the recipient's active drive (token relevance ≥
0.2), the drive completes exactly the way offscreen drives do — it becomes a memory, the slot
clears, and the next goal arrives by the normal drives_update path. Even if the bookkeeper forgets,
the promise reaching the ledger IS the answer reaching state.

## 5b. The attempt frame (`attempt.ts`)

Outcome resolution without dice. A CRPG compresses untracked causes into a roll; this engine
tracks the causes, so it reads them. When the player's action matches a risk-verb gate (and is
not god mode, story mode, mythic/cosmic tier, restful, or inert), three readings resolve the
outcome before the narrator writes:

| reading | weight | what it reads |
|---|---|---|
| capability | 0.45 | token-relevance of the action against the player's fact corpus: background, life history, core traits, skills, acquired traits, grooved habits, inventory. Social attempts get a 0.3 floor of ordinary human competence. |
| body | 0.30 | the relaxation band (+1 settled … −1.6 deep-clenched), fatigue, hunger, thirst, and injuries — matched by ACTIVITY CLASS (a gashed palm fails every gripping action, however phrased) |
| circumstance | 0.25 | weather for physical work; for social attempts, the named target's actual disposition toward the player, straight from the edge |

Difficulty = `0.25 + pressure/10 × 0.35 + (0.22 dangerous / 0.10 risky)`. Verdict bands at
margin ±0.12: **sufficient** (it works, plainly), **contested** (it works at a cost named from
the weakest reading), **insufficient** (it fails, traced to the weakest reading — never by
luck, never catastrophized). Fully deterministic: same state, same verdict. The LLM renders
the verdict as law; it never decides it. The summary lands in "what shifted."

## 6. The dissipation inventory

Every accrual in the system has a decay. This list is the proof that the engine reduces:

- relaxation drifts to capacity every turn (overshoot collapses faster than recovery)
- settled bodies dissolve gripped emotions in 2 turns, keeping only the residue
- moods fade 4 turns after the body settles (weather, not climate)
- unreinforced traits fade (`decayTraits`); only deep-integrated ones become identity
- episodic memory decays through stages into gist; terminal decay semanticizes into facts or fades
  (Ribot's gradient) — nobody carries a forgettable Tuesday as a fact
- rumor salience leaks 0.3/turn; rumors die of boredom below 1
- the discharge opening closes ×0.7/turn
- physical conditions expire (`CONDITION_LIFESPAN`)
- drives complete; promises resolve; clocks fire and are spent

## 7b. Token economy (what a turn costs and why)

Per turn the engine makes 2–5 model calls: the narrator stream, the simulator JSON, one intent
call per staked NPC, plus cadenced reflections (every 10 turns) and chapters (every 25). The
defaults for new games are tuned for the cheapest healthy version of that:

- `route_by_price: true` — every call rides the cheapest healthy OpenRouter provider.
- `prefer_deepseek_provider: true` (llm.ts `providerParam`) — deepseek/* models try first-party
  DeepSeek first, whose cache-hit rate is ~0.8–2% of input price; the provider pool is the
  fallback (`allow_fallbacks`), governed by the price sort.
- `context_mode: "chatlog"` — append-only context; between anchors nearly all input bills at
  cache-hit rates instead of re-paying miss price for a volatile digest every turn.
- `narrator_reasoning: false` — reasoning-tier models default to thinking, and thinking bills as
  output; the narrator stream carries `reasoning: {enabled:false}`. Prose rarely needs it. The
  bookkeeper has always run with reasoning off.
- `lean_mode` (manual or eco-governor automatic) swaps the full prompts for the *_LEAN variants:
  same rules, ~67% smaller narrator prompt, ~53% smaller simulator prompt.

Savings compound: chatlog makes most input hit-priced, routing makes hit price the lowest
available, reasoning-off removes invisible output, lean shrinks what remains. A healthy
250-turn campaign on DeepSeek-class pricing lands around a dollar, roughly 5–13x under the
untuned defaults. Existing saves keep their old settings; flip the same toggles in Tuning.

## 7. Tuning rules (how to change this safely)

1. **Never overwrite the scalar.** Couplings add small clamped nudges; the kernel integrates them.
   The one time a layer assigned relaxation directly, the generative behavior died with it.
2. **Every accrual ships with a decay.** If you add a way for something to build, add the way it
   lets go in the same commit, or the system only complexifies.
3. **Thresholds are the behavior.** Changing a number in §3 changes who people are. Change one at
   a time and read the shifts toasts for a session before touching another.
4. **The player is never authored upward.** Their interior arrives through the tightness anchor or
   not at all.
5. **Deterministic first.** A mechanic that can be computed must be computed; the LLM writes prose
   and files deltas, it does not simulate. Zero-token systems are the only ones you can verify.
