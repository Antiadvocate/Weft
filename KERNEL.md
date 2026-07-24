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
3. **Narrator + simulator (LLM).** The simulator's `relaxation_delta` per character is the main
   event-driven shove. The player's tightness anchor caps after this.
4. **Tail ticks, each fault-isolated** (a failure degrades one system for one turn, never the turn):
   - `tickDesire` — warmth earns attraction under its conditioned ceiling; fixation taxes relaxation.
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
