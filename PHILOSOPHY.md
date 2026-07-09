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

## The veto

The narrator is a weak model with authority to invent, and the bookkeeper is told the prose is source of truth. That combination means one bad sentence becomes permanent world-fact within a turn, and the next turn builds lore on top of it. The player must be able to say *no* and have it stick.

**Strike** does that. It rolls back past the offending turn and records a standing retcon — a statement of what is NOT and never was — injected into every subsequent narrator and simulator prompt at absolute authority. Struck things are not explained or resolved; they are treated as never written. Characters the strike names are deleted; canon it minted is dropped. Undo restores everything.

Three guards sit under it, because a veto after the fact is a poor substitute for not breaking the world:

- **Canon is a constraint on what may exist**, not a fact sheet. Before anything enters a scene — even a shout through a wall — it is checked against canon. Introducing an exception and then explaining it *is* the violation. If the player says something was impossible, they are almost certainly right.
- **The prose is not authority to violate canon.** The simulator no longer transcribes "exactly"; it refuses to create, record, or learn from anything canon forbids.
- **Exits must be written, never inferred.** The simulator can emit `{char_id, place}` with no justification and no cost, and it hallucinates departures: a character speaking in this very turn gets teleported to `elsewhere`, drops from `present`, loses her card, and vanishes. Now a character who is active in the prose cannot be moved out of the scene unless the prose actually says she left.

## Re-running the bookkeeper

Two models write each turn. The narrator produces prose; the bookkeeper turns that prose into world change — memories formed, feelings moved, people relocated. When the bookkeeper returns an empty or dead diff, the turn happened on the page and did not happen in the world. Nobody remembers it. This failure is silent by default, and it is the single most corrosive bug in the engine: the story reads fine and the characters are quietly amnesiac.

Every turn now carries a `bookkeeping` verdict — `ok`, `thin` (parsed, but recorded nothing despite substantial prose), or `failed` (nothing usable came back). Flagged turns show a banner and a re-run button; any turn can be re-run manually.

A re-run keeps the prose. The snapshot for turn N is taken *before* N applies, so re-running N restores that snapshot and replays the same action and same prose through the whole downstream pipeline — simulator, clamps, applyDiff, physiology, reflection. One simulator call, no narrator call, illustration carried across. Undo restores the pre-re-run state.

The trap worth naming: `rollback` finds the nearest *earlier* snapshot, not an exact one. Re-running a turn whose snapshot had aged out of the seven-entry ring would have replayed its prose against a state several turns stale and destroyed everything between. The re-run therefore demands an exact snapshot and refuses otherwise. Only the last several turns are re-runnable, and that is the honest limit rather than a silent catastrophe.

## The ending

A destination is an ending plus a number of turns: "in 30 turns, he has built the shelter." The turn count is the clock, and it is the only one. Progress is turns elapsed divided by turns budgeted — arithmetic, not a model's opinion. It cannot stall because a weak simulator failed to notice the story moved, and it has nothing to do with the chapter cadence, which exists to summarize history and save context.

The chapter auditor still reads the story, but only to answer one question: what still stands between here and the ending? That sentence goes to the narrator. The auditor never scores progress and never decides when the ending arrives, with one exception — if the prose has already reached the ending, it says so, and the story stops pushing toward a place it has arrived.

Acts are proportions of the budget, so a five-turn story passes through all of them just as a sixty-turn story does:

- **open** (first quarter) — the ending is far. The player is free.
- **rising** — scenes are asked to bring it nearer or show its cost.
- **closing** (past halfway) — threads that do not serve the ending lose tension. Abandoned roads stop staying open. Pressure gets a floor.
- **convergence** (final fifth) — unrelated threads close. Faction clocks turn toward the ending. No new subjects.
- **arrival** (turns spent) — the ending is written in this scene.

Two things make this hold. Fate changes threads, clocks, and pressure rather than only instructing the narrator, because a directive leaves the machinery pulling elsewhere. And if the narrator writes around the ending when it is due, the engine records it anyway one turn later — a weak model's reluctance is not a veto. When that happens the ending is marked `forced` rather than `earned`, and the aftermath is told not to pretend the player made it happen.
