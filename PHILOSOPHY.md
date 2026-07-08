# How people work in Weft

One page, plain language. Every mechanic below is deterministic code unless marked (LLM).

## The kernel: relaxation

Every character has one number for the state of their body: **relaxation**, −10 (clenched) to +10 (open). Everything else hangs off it. Each body has its own **resting point** (capacity) and its own **recovery speed** — some people return to calm fast, some sit braced for days. The number drifts toward the resting point every turn; events (via the simulator) shove it around.

## Seeing: the perception gate

Relaxation sets how accurately a person reads other people. Clenched bodies see poorly and are certain anyway — neutral faces read as threats. Open bodies see people as they actually are. This is rendered as an instruction per character per turn, so the narrator writes misreading, not just mood.

**Exception — conscience.** Calm is not care. Each person has a **conscience** number (0–1): how much other people's pain registers as mattering. For most people, opening up and warming up travel together. For a person at ≤0.3, they come apart: relaxation still sharpens their sight, but what they see never obligates them. Their calm is real (these people are genuinely low-anxiety and stress-immune) and it makes them more effective, not kinder. Clench makes them petty and punitive instead of defensive. Their darkness is constitution, not wound, and comfort does not fix it.

## Feeling: the lifecycle of an emotion

An emotion is an event, not a possession. When one lands (an active state like "anger at the verdict"), what happens next depends on the body holding it:

- **Settled body:** after a couple of turns the state dissolves on its own — felt fully, not fed. It leaves its information behind: anger settles into a clear view of what was actually wrong, fear into alertness to what matters, grief into plain love for what was lost. The charge goes; the knowledge stays.
- **Clenched body:** the state gets re-told instead of felt. After a few turns it starts feeding on itself — a small ongoing drain on relaxation, because the reaction to the pain has become its own pain. The first hit is the event. The second hit is the story about the event, and the second one is self-inflicted. The oldest fed emotion also colonizes the mood.
- **Moods are weather:** a mood set turns ago fades once the body settles. Nothing emotional is permanent unless a body keeps it alive.

## Wanting: desire as its own channel

**Attraction is separate from warmth** — wanting someone is not liking them. It's seeded from conditioning (each person's *taste*: what their world and history trained them to find desirable) the moment two people share a scene, gated hard by orientation, and it never moves because someone was kind (kindness moves warmth). Sustained warmth can lift attraction slowly, but a flat first read plateaus at fondness-with-a-mild-pull — a different relationship, not passion.

What desire *does* obeys the kernel: a drawn, settled person acts — flirts, teases, approaches. A drawn, clenched person leaks — staring, sharpness, avoidance. Held long enough in a clenched body, wanting hardens into fixation, which drains the body further until the person settles — at which point it lets go on its own. Same energy, two roads, decided by grip.

## Other people: co-regulation and attachment

Nervous systems are not closed. A settled person you trust, present in the room, pulls you toward settled. But *how* a body uses people under threat is a stable per-person trait:

- **secure** — takes the comfort straight; settles near safe people.
- **anxious** — runs hot toward people: soothed strongly by presence, but scared and alone, the alarm feeds itself (pursue, escalate, re-check).
- **avoidant** — runs cold: comfort barely lands, and under real threat closeness is pressure — a warm person leaning in does nothing; they settle alone, later.
- **disorganized** — reaches for the comfort and flinches from it in the same motion; presence helps some turns and stings on others.

When someone is clenched, the narrator gets their under-threat behavior as a line of law — so two scared people in the same scene do visibly different things.

## Breaking

Clenched long enough and deep enough, a person fractures, then breaks — into a break mode (dissociative, fawning, mirror, fractured) with its own rendering rules. Recovery restores them.

## Becoming: how emotion builds a self

Repeated states become traits (LLM, on the reflection cadence — never per-turn, so a single scene can't move the core). Reflection now also receives the body's recent record: a body that spent the period braced hardens protective, absolute convictions from the same events a settled body would read generously. Belief is shaped by the state it was formed in, not just the facts. Deep-integrated traits fold into core identity; unreinforced ones fade. Memory does the same: experience decays into gist, important gist becomes settled knowledge, and the life-defining residue is permanent.

## The short version

Events land as feeling. Grip turns feeling into story, story into suffering, suffering into disposition, disposition into self. Release lets feeling pass and keeps its information. Other bodies tilt yours toward grip or release, each in its own style. A few people see everything and grip nothing because nothing ever mattered to them but themselves — and they are calm.

## Prose craft: where the narrator rules come from

The narrator's anti-vagueness rules are not invented here. They use human craft vocabulary, so a language model recognizes the term and the correction it was trained alongside:

- **Filter words** (Janet Burroway, *Writing Fiction*) — *saw, felt, heard, noticed, seemed, realized, watched.* They put a pane of glass between reader and moment. Cut the filter: "the cold seeped into her hands," not "she felt the cold seep in." Prune, don't ban — a filter is right when perception itself is the point ("she heard it before she saw it").
- **Vague declarative** (anti-slop skill vocabulary) — asserting a reaction without naming it. "Something tightened behind her eyes" is the fiction form. Fix: name the specific reaction or cut to action.
- **Narrator-from-a-distance** (same source) — pulling the camera out of the scene. Our weather-sting ("Outside, the rain picked up") is this. Fix: put the reader in the room; end on a person.
- **On-the-nose dialogue / subtext** (editor's craft term) — characters saying exactly what they feel, which flattens voice and reads false. Fix: let the surface line be about the small thing and the real thing sit under it. Trust the gap; don't close it with a confession.

These are *tendencies to prune, not absolutes* — every craft source is emphatic on this, and a human writer exercises judgment the model won't. For a weak narrator model that overuses these moves by default, the prompt draws a harder line than a writer would draw on themselves. That is deliberate: the model needs the floor, not the nuance.

Rules NOT imported, though they appear in the same anti-slop lists, because they are essay rules that break fiction: "no inanimate objects performing human actions" (kills legitimate metaphor — "the fever broke," "grief sat down beside him"), blanket "no em dashes," blanket "no adverbs." Those lists target marketing copy and essays; fiction is a different instrument.

## Earshot

Presence is derived from co-location, and co-location decides who perceives a turn. Two rules follow, and both are enforced in code because the prompt alone never held:

- **Sub-rooms are rooms.** "Tessa's house (kitchen)" and "Tessa's house (outside in the yard)" are not one scene. A sub-room merges only with its bare parent, never with a sibling. Names arrive both dashed ("House - kitchen") and parenthesized; both parse.
- **Only witnesses learn.** Whoever stood in the room when the player acted — plus anyone the turn moves into the player's place — may gain a memory, a learned fact, an edge shift, a mood change from it. Everyone else gets nothing, no matter what the prose implies. A line spoken alone in the yard cannot be answered from the kitchen, and cannot be remembered there later.

The failure this prevents is quiet and corrosive: a character reacts to something they could not have heard, the player assumes they were overheard, and the world stops being a place with walls.

## Destination

A story may be told toward an ending. Set it once at the Forge — "he learns to feed himself through winter and builds a shelter that holds" — and it becomes the story's gravity.

Three properties make it a destination rather than a plot:

- **Optional.** Blank is the default and emits nothing into the prompt: an open world, unchanged. Never invent one the player didn't ask for.
- **Gravity, not a rail.** The narrator bends scenes toward the ending — the frictions it raises, the wants it lets characters pursue — but the player may refuse, detour, fail, or walk away. Nobody announces the goal. Nobody nags. Help is never fabricated. Progress can go *down*, and a chapter that loses ground is a truthful chapter. If the player has plainly abandoned the course, the engine follows the player: their standing direction and their choices both outrank it.
- **Measured, not enforced.** The chapter auditor already judges the story against its contract; it now also scores distance to the ending — a percentage, what was earned, and the next concrete obstacle. The narrator receives that reading; the Chronicle draws it. Nothing forces the number up.

Reaching it does not end the game. `destination_reached` shifts the narrator into aftermath: consequence and cost, smaller and truer scenes, no manufactured replacement arc. A new course is the player's to set.

Implementation note: the destination *text* is immutable and lives in the cache-stable prefix; the *progress* mutates each chapter and lives in the volatile digest. Putting progress in the prefix would break its byte-identity and cost the prompt cache every turn.
