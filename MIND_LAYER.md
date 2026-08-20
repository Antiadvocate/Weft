# The Mind Layer — information asymmetry for Weft

## What it is
Until now the engine was **omniscient**: every character's true state sat in the prompt, so no one could be wrong about anyone. The LLM-social-sim literature is blunt that this is the regime where models look deceptively good and believability dies — real social life runs on *information asymmetry*. This layer adds it.

Each tracked/present character holds a **private model** of the people who matter to them (the player, plus their single sharpest tie). The model can diverge from ground truth, and the **gap is the point**.

## The mechanism (active inference, deterministic, zero tokens)
- `predicted_warmth` / `predicted_stance` = the character's generative model of the other.
- Each turn, `updateMind` compares the model to what actually happened (the true edge, the QRE stance the undertow sampled) and computes **prediction error**.
- Error → `surprise` (a leaky accumulator: decays in calm, spikes on violated expectation), precision-weighted so a *confident* model is more shaken by the same error.
- **Surprise feeds the cusp load term `a`** in the undertow — surprise *is* the body bracing against an unpredictable world, so the catastrophe (psyche) layer and the cognition layer are now the same thing measured twice. A mind that can't predict its world clenches, for real, by geometry.
- **Low confidence about someone high-stakes → an epistemic drive**: the character seeds a "find out where they stand — test them, probe, get a read" goal, executed by the existing drive/QRE machinery. (Active inference: act to reduce your own uncertainty.)
- **Being right has a cost too.** The layer originally treated being WRONG as the only failure mode, so a converged, confident, zero-surprise model meant the character was simply correct and the machinery went quiet. Confidence now runs a clock (`settled_turns`): held above 0.85 for more than a few turns, the model starts standing in front of the person. The percept is damped toward the prediction (at full strength four fifths of what changed does not register), and the breakthrough wall rises. It is deliberately NOT gated on the model being wrong, hostile, or attached to any bad trait — it fires on people who are accurate about each other. When something finally breaks through a long-standing picture the surprise is amplified in proportion to how long the looking had been suspended, the settled count resets, and confidence halves: the believer is looking at a person again. Certainty raises the wall but is never allowed to *seal* a mind — sealing stays a function of hostility and a guarded style, because a mind nothing can reach cannot have the collapse, and the collapse is the point.
- A large, *sustained, unresolved* warmth gap can crystallize into a `held_false` belief — one concrete thing the character is wrong about ("is convinced the player has turned on them") — the misread that drives a scene. It clears when the gap closes.

## What changed in the prose
The narrator now receives a **MINDS** block for present characters whose model diverges from truth, with the instruction to act on each one's *belief*, not the truth. Misreads and fresh surprise surface as "what shifted" beats ("she didn't expect that from you", "the misread dissolves").

## Where you see it
- **Play tooltip** — tap a name: a "their read of you" panel shows when their model is off the mark, carrying a misread, or freshly thrown.
- **Chronicle records** — "Carrying a misread of you" and "Widest gap between read and truth" across the playthrough.

## Files
- `src/engine/mind.ts` — the whole layer (new).
- `src/engine/types.ts` — `BeliefAbout`, `MindModel`, `Stance` (moved here), `minds` on `SaveState`.
- `src/engine/undertow.ts` — runs the mind pass, feeds surprise into the cusp, emits the MINDS directive + epistemic pulls.
- `src/engine/drives.ts` — epistemic pulls steer drive regeneration.
- `src/engine/turn.ts` — passes pulls through.
- `src/engine/prompts.ts` — surfaces each present character's belief about the player.
- `src/views/Play.tsx`, `src/views/Chronicle.tsx` — UI surfacing.

## Cost / tradeoff
A few scalars per tracked character, updated like the rest of the undertow — zero tokens for the *computation*. The one real cost is prompt size: the MINDS block adds a short line per diverging present character. It only appears when a model meaningfully differs from truth, so calm/accurate scenes pay nothing.

## Verified

`tests/recognition.ts` covers the reification path end to end: convergence on a stable accurate read, the clock accruing, a real change under the wall arriving attenuated, the collapse firing with its narrator line, and the non-sealing guarantee (a fully reified mind is still reachable by a large enough event).

`updateMind` was unit-checked in isolation: no surprise on first sight; convergence + rising confidence on a stable bond; surprise spike + model lurch + narrator beat on a betrayal; epistemic-pull flag on high-stakes uncertainty. The `held_false` guard intentionally under-fires on a single clean betrayal (the model just updates) — it's reserved for genuinely sustained misunderstanding.
