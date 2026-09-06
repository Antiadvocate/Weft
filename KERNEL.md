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
| `capacity` | −6 … +6 | resting point — relaxation drifts here. Set at forge from conscience+traits; healed downward in turn.ts if it contradicts the character's nature. **Lived, not constant** — remodelled slowly by completed runs of bracing or of being held, inside a band around `capacity_born`, with a standing pull back toward it (§5, remodelling). Never for the player. |
| `capacity_born` | −6 … +6 | what the forge stamped. Never written again. Every remodel is measured against it, bounded by it, and drawn back to it. |
| `braced_run` / `settled_run` | turns | consecutive turns spent at or below the braced line, and above the effective resting point. The two runs that move `capacity`. |
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
| r ≥ +2 | aperture.ts | the **aperture opens**: the voice card becomes where the words come from rather than a filter every line passes through, and the character's own standing interests are offered as things the room can catch their attention with |
| r ≤ −4 | aperture.ts | the aperture **narrows**: register at its most concentrated, attention on the one thing. Correct behavior, and what makes the open band mean anything |
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

**The container and its contents** (`ground.ts`). A place had no relationship to a nervous system.
Measured on Ashford: 18 of Amber's 30 episodic memories carry a `where` — the place is filed with the
memory and fades out of it as the memory fades — and that field was used for display and nothing
else. Arrival at a place now shoves relaxation by what happened to that person there, computed from
their own bank. Bounded at ±1.2 (a fifth of a bad conversation), fires on arrival only, needs more
than one memory or one that mattered, and **habituates** — divided by recent visits, so the room you
are in daily stops announcing itself and the one you have avoided does not. That habituation term is
the difference between this and a haunted world. Zero tokens.

**Simulation LOD is not render LOD.** `central === false` gated the emotion lifecycle, discharge,
desire, rivalry and repair — and all of those are pure arithmetic (0 LLM references across
`emotions.ts`, `desire.ts`, `fault.ts`, `social.ts`, `remodel.ts`). Excluding background characters
saved nothing; the *card* is what costs, and theirs is one line either way. Everyone is simulated
now; only the central cast is described.

**Offstage reaches bodies** (`offstage.ts`). The pass had zero references to relaxation or psyche, so
the world could hand a man the first call to his dead husband's brother since the funeral, file it,
seed a rumour off it, and leave him at the same number. `eventImpact` is a separate lexical read from
`actorValence` and deliberately so — agentive valence scores a plague at zero, which is right for
opinion and exactly wrong for a body. The actor takes ±1.4, a witness half, the player never, and a
hard one accrues grief drag so it does not wash out on the next turn's drift.

**The habit engine, no longer optional** (`habits.ts`). Core traits as firing physics — the channel
that carries change nobody chose — was flag-gated off, and simulated with the flag on it produced
**zero fires in 200 turns in every state**. Its opportunity gate was a cosine similarity against the
beat, the metric `novelty.ts` had already documented as wrong here ("it normalizes by document
length"). Measured: a behavioural trait against a beat that IS that behaviour scores 0.302, against a
real turn of prose 0.162, and the gate is 0.34 — so the only trait shape that could ever fire was the
two-word adjective this engine has a whole module devoted to forbidding. No threshold fixes it: a
behaviour that is *enacted* rather than named scores near zero on containment too, and the beat text
is assembled before the prose exists, so the simulator's semantic read is not available either.

Opportunity is structural now, the way the mannerism path always was, with lexical relevance demoted
to deciding which eligible habit takes the beat's one slot. What replaces the gate is grip:
`unpromptedRate` runs from 0.05 at r ≥ +2 to 0.50 at r ≤ −7 — clenching *is* the automaticity, the
kernel's own claim applied to the channel it had never reached. Simulated over 200 turns:

| body | fires | seen | outcome |
|---|---|---|---|
| settled (r +4) | 15 | 87% | slack — the patterns mostly do not run, and it sees what it does |
| clenched, quiet (r −7) | 101 | 10% | runs constantly, blind, grooves *past* baseline — the chain of delusion |
| clenched, loud (r −7, salience 9) | 89 | 24% | the second road: the deepest loosening in the table, and somebody else notices |

Also: `NEW_HABIT_STRENGTH` was declared from the beginning and never used, so the only habits anybody
ever had were forged before turn one. A trait `consolidateTraits` promotes now becomes an
automaticity at drywall strength (60) rather than a forged wall (95). `ensureHabits` runs at
`registerCharacter` as well as on load, so people created mid-save have them too. And `attempt.ts` no
longer reads the habit list as competence — it is a mirror of `core_traits` that can go stale, and it
was double-counting.

**Somatic remodelling** (`remodel.ts`). `capacity` was the only number in the psyche with no history
in it: a body eighty turns braced came to rest exactly where one that arrived this morning did.
Measured on the Ashford save at turn 29, all four characters sat on the integer the forge wrote on
turn zero, three of them after a twenty-eight turn settled run. The engine already had both temporary
halves — `discharge_lift` for release, `grief_drag` for loss, each returning to baseline within a
week of turns — and nothing for the case where the week does not end. Now a completed run of eight
braced turns lowers the resting point by 0.3, a completed run of six turns spent *above* it raises it
by the same, three discharges across a save pay one step, and `capacity` lives in
[born − 2.5, born + 2.0].

The failure mode is a ratchet, and wear feeds itself — a lower resting point means more turns below
the braced line, which earns more wear. Four things stop it: the band; a standing pull toward
`capacity_born` at 2% of the gap every turn, which is the mechanism's *default* direction; settling
being cheaper to earn than wear (6 turns against 8); and a numbness ceiling. A worn body damps
incoming deltas of |1.5| or less, to at most 45% — so ordinary friction stops landing and a real blow
lands in full on the most hardened character in any save. Simulated over 120-turn runs: continuous
cruelty converges around born − 1.6 and never reaches the floor, because the pull home scales with
the gap while wear is flat. Sixty turns of hell followed by a hundred turns of *nothing happening*
recovers most of the way. Growth keys off being lifted above the resting point, not off `open_run` —
an untroubled save widens nobody.

Excluded for the player, on the same rule as `fault`: their resting point is a fact about a person
the engine cannot observe, and deriving it from the prose is the authorship the tightness anchor
exists to prevent.

**The aperture** (`aperture.ts`). Relaxation decided how accurately a person SEES, how an emotion
resolves, and whether a habit can be caught — and said nothing at all about how much of the world
reaches what they SAY. `deriveVoice` had a band at −7 and a band at +6 with nothing between them, so
the whole middle, where nearly every turn of nearly every save sits, got no line about register at
all and spoke out of its card and only its card. Measured on one save: a woman at +2.51 with a
28-turn settled run behind her, 65% of her spoken lines on her one errand, 3% touching any of the
four standing interests printed on her card, the last word of the turn in 15 turns of 17, and four
turns running ending with her telling the player what happens next. Three deterministic detectors
now read the last few turns — how long her speech has been on her own want, how long she has been
closing the scene with an instruction, and which of her own interests the page has not used — and
the note they produce is permission plus the measured fact, never a ban on the want. A clenched body
narrows and the module protects that; an open body does not.

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

**Commitment settlement** (`commitments.ts`, hooked into the per-turn tail and the load path).
`commitment_status` has had "fulfilled", "missed" and "cancelled" since the type was written and
nothing in the engine ever assigned any of them, so a commitment could only ever be born. The
memory digest therefore went on printing `STILL DUE Day 1, 11:00` at Day 1, 15:26, and
`commitmentBoost` kept that impossible line at 0.9 — front of mind, above everything else the
character had — with no upper bound on how overdue it could get. A narrator resolving that
contradiction resolves it the cheap way: she must have gone. One save's character consequently
believed she had worked a shift she spent on the couch, and by the end was accusing the player of
having forgotten an afternoon that was never written. `resolveOverdue` settles the ones the record
can prove — the scheduled minute passing between two consecutive telemetry rows with the character
in `present` for both, which is a crossing rather than an inference — and marks them `missed`;
overdue-but-unwitnessed hours stop being described as upcoming and are rendered to the narrator as
a hole in the record instead. It never marks anything fulfilled: guessing in that direction is the
same failure pointed the other way.

The window on a settled commitment is measured in **world minutes, not turns** — the save that
prompted this ran forty-one turns across twelve hours, so a turn-counted window aged the missing
shift out at about seven in the evening, on the exact turn the player finally rang the salon to
check. And when the player does check, `verificationLaw` puts the verdict in the directive *before*
the prose, the way `attempt.ts` resolves an attempt before a word is written: a witness invented
mid-argument has no record of its own to consult and will agree with whoever spoke last, so the
check the player invented to end a hallucination is otherwise the thing that certifies it. It
settles only what is asked and leaves the rest of the scene open — the character may still lie, the
answer may still be slow, partial or useless; what is unavailable is a third party putting somebody
where the record does not.

**The person who did it remembers doing it** (`rememberOwnAct`, offstage.ts + the first-person
repair in memory.ts). `runOffstage` moves the ACTOR'S nervous system — its own comment reads "The
body that lived it. The actor took the whole of it; a witness took half" — and then writes a memory
for the witnesses and for nobody else. A character alone in her own apartment is nobody's witness,
so she took the relaxation cost of her whole afternoon and kept no recollection of it: twelve
memories in her bank, eleven naming the player, and a day of her own staged pedicure campaigns,
relocations to the entryway choke point, and a plate gone gray at five in the morning that existed
only in the world log. The actor is now written their own copy, one importance step above a
witness, through `cleanMemoryContent` so it lands in their mouth rather than as a report about them.

That conversion had to be fixed first. Every line the offstage pass writes opens with an
unpunctuated time phrase, and rule 4's subject-position test only recognised a fronted adverbial
when it was followed by a comma — so "Around 12:50 Abigail decides…" stored as "me decides", "At
about 19:50 Abigail finally comes off the stool" as "me finally comes". The comma case itself never
fired on the example written into its own comment, because the pattern refuses a full stop and
"Eight a.m.," has two. Also fixed alongside: an adverb may now stand between a swapped subject and
its verb, the agreement repair reaches across a coordinating conjunction for every verb rather than
for the copula alone, and `firstPersonVerb` gets `-es` right (passes → pass, but uses → use).

**`tracked` and `central` are two different claims** (`turn.ts` promotion loop, `prompts.ts` × 3,
`aperture.ts`). `tracked` means the engine spends upkeep on this person — a drive, a schedule, an
authored want; `central` means the narrator is told who they are. Four paths set `tracked` without
touching `central` (the bookkeeper writing a drive, the narrator's own `track` promotion, and
authoring a want or a schedule from the Cast screen), and the promotion loop's gate was
`!c.tracked` — so any of them landing first shut the door permanently. A woman alone with the
player at a restaurant table for eight consecutive turns, with a voice card the engine had spent a
voiceforge call on that same evening, reached the narrator as `— Emily (background) — present,
even; a minor figure, simple and reactive, not a focus`, with her card excluded from the cached
prefix entirely. The cast cap was six and she was the second person in it. The gate is centrality
now, and a *tracked* character is never rendered as furniture — desire.ts made this argument once
already in the other direction ("SIMULATION LOD IS NOT RENDER LOD") when `central` was wrongly
gating simulation.

**Narrating the conversation instead of having it** (`findMetaTalk`, maxims.ts). What a model
writes when it has a scene and no person to put in it: sentences about the exchange — what was
asked, what was said, what the other person is doing by saying it. Measured on the save above,
spoken sentences of that kind per turn ran 0–1 through eleven ordinary turns and then 4, 5, 4, 2 —
so it fires on a rate over a run of turns, never on one line, because an argument about what
somebody meant is a legitimate scene.

**A frequency is not a span** (`declaredMinutes`, time.ts). "I sometimes go 4 times a week", typed
mid-conversation at a dinner table, moved the world clock seven days: the article-plus-unit pattern
matched `a week` inside a rate. Frequencies are rejected now, and quoted speech is masked before
the line is read at all — the engine masks dialogue everywhere else it reads the player's input,
and a character talking about a week is not a player spending one.

**Three location bugs that removed a character from a story** (`exit.ts`, `turn.ts`). (1) `left` is
two verbs. The departure guard's verb list contained a bare `left`, and a narrator writing about
the room the player had walked out of produced "volume unchanged from where Abigail left it" — her
name inside the matched span, which `owns` treats as settling the question. She was moved offscene
on the strength of a sentence about her television. `left`/`leaves`/`leaving` now carry a negative
lookahead for an object pronoun or `behind`; "Abigail left." and "left the apartment" are
untouched. (2) `elsewhere` is not a place. `loc_offscene` is the null bucket — not on the page, not
far away — and priced through the distance steps it inherits the world's scale; one save quoted a
character eighteen hours of travel back from nowhere, on the turn the player typed "continue until
Abigail is back in the picture". It costs a neighbour's walk now, which still forbids appearing in
the same minute as vanishing. (3) A stay is not a journey. `travel_log` records where the player
STOOD on a turn, so measuring a hop between two entries charges the whole intervening stay to the
walk — a player who read a book in his bedroom for six hours taught the engine that two rooms of
one flat were five hours apart, which then set the scale for every unmeasured pair in the world. A
hop is now measured across the turn the move happened on.

**A screen is not the room** (`screenPrivacyNote`, scene.ts). The player's typed action reaches the
narrator whole, which is correct for everything a body does and wrong for the four inches in front
of one person's face: "I do something and she instantly knows I'm on hinge." The note hands the
room the posture — angle, thumb, the light on a face, how long, whether he answers — and withholds
the content. Wanting to know is the scene; being wrong about it is the best version of it. Silent
when nobody else is present, and silent when the player is plainly showing it to someone.

**Three output-side voice guards** (`maxims.ts`, `aperture.ts`). All three use the mechanism that
actually works here — catch it in the committed prose, quote it back at the end of the next
directive. (1) `findFigure` extends the maxim detector out of the quotation marks: a spoken line
followed by a comparison explaining it ("She said it flat, like the word had a price on it") is a
style choice once and a tic on the third turn running, and "like she was —" is an interior leak
with one word in front of it, which is why MOTIVE_LEAK never saw it. Fires on the run, not the
instance. (2) `findNeverSaid` checks the output against each present character's own `never_says`
list, which was printed to the narrator every turn as reference and never once enforced. (3)
`appetiteGap` counts turns of speech in which a character neither wanted anything out loud nor put
a subject on the table that was neither them nor the person they were talking to — and the
narrowed band of `apertureNote`, which had been unreachable (a clenched body was skipped before it
could reach the paragraph written for it), now speaks: a braced body should narrow, and what needed
checking was whose one thing it narrows onto.

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
