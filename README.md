# Weft — a world that reacts (GitHub Pages build)

A persistent, social world-simulation engine with an LLM narrator. **This build runs entirely in your browser** — no server, no backend. The engine, the saves, and everything else live on your device; it talks to language models through *your own* OpenRouter key.

## Deploy it to your repo (the easy way)

1. Create a new GitHub repository and upload these files (or push this folder to it).
2. In the repo, go to **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`) builds and publishes automatically.
4. Open the URL Pages gives you (e.g. `https://yourname.github.io/weft/`). Paste your OpenRouter key when prompted. Play.

That's it. Every push rebuilds and redeploys.

### Run it locally first (optional)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produces dist/ — the exact static bundle Pages serves
npm run preview  # serve the built dist/ locally
```

## Handing it to someone who has never played

The app teaches itself, so there is nothing to send along with the link.

A first-time player gets a short welcome card and lands **in the Forge**, not in a list of somebody else's worlds. From there each screen runs a brief spotlight pass the first time it is opened — one control at a time, a line each, four to six taps and it's done. That happens once per screen, ever; the **?** in the title bar replays the current screen's afterwards.

Nothing is a manual. The Play pass carries the only genuinely unguessable thing (the four ways to write a message) and the rest of the app is annotated in place. The **cheat sheet** — the four channels, what is and isn't binding on the world, and the four repairs for a bad turn — is one card, reachable from the welcome card and from **Tuning → Learning Weft**.

Anyone who already knows the game ticks **"I'm used to this — skip the guides"** at the bottom of the Forge (or *Skip the guides* on the welcome card) and nothing opens on its own again; the **?** still works. The same switch, and a **Replay guides** button, live at the top of **Tuning**.

## The OpenRouter key

Weft has no server to hold a secret, so it uses **your** key, entered once and stored in your browser's `localStorage` on that device only. It is sent directly to OpenRouter and to nowhere else. Get one (free and paid models available) at <https://openrouter.ai/keys>. You can change it anytime in **Tuning**.

Because the key lives in the browser, **don't** hard-code it into the source or commit it. Anyone who can use your deployed page uses their own key.

> Note: calls go from your browser straight to `openrouter.ai`, which permits cross-origin requests. If your network or an extension blocks third-party requests, the model calls won't go through.

## Running a local model

Any of the four model slots can point at a model on your own machine instead of at OpenRouter. In **Tuning → Local AI**, set the OpenAI-compatible base URL of whatever you're running:

| server | base URL |
| --- | --- |
| KoboldCpp | `http://localhost:5001/v1` |
| llama.cpp (`llama-server`) | `http://localhost:8080/v1` |
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |

Every model picker then grows a **LOCAL** section, and picking from it writes a `local/…` id into that slot — the prefix is the whole routing mechanism. Local calls carry no OpenRouter routing, billing, or web-search parameters, need no key, skip the relay, and are allowed a very long time to first token, because a local model's silence before the first word is prompt prefill rather than a queue. `<think>` blocks are stripped from the stream, so a hybrid-reasoning GGUF never narrates its own deliberation into the story.

**What fits in a small context window.** Weft's narrator prompt is a compiled state document, not a transcript — measured on a 121-turn save it was ~26.5k tokens, of which the rules contract alone was 14.5k and replayed history only 8%. So continuity does not come from the model remembering the chat; it comes from the digest, which is rebuilt from the world state every turn. A 64k model has room for a full-fat turn (~31.5k including generation); **Tune this save for a local model** takes it to roughly 18k by switching on lean prompts, chat-log context, a slower re-anchor and a tighter digest. Treat that button as a speed setting rather than a fitting one — the turn fits either way, but every token cut is prompt not ingested before the model writes, and KV cache not held. Unwind it from the tightest end (token budget, then lean mode) if your hardware allows; chat-log context and the slow re-anchor are free and should stay on.

The useful split is a **local narrator** — the long creative call, and the expensive one — with a **cloud bookkeeper**. The reason is prefill rather than capability: the bookkeeper reads a different document, so it is a second full prompt ingest every turn, and on a local model that ingest *is* the wait between beats. A model large enough to write well can generally hold the schema too (and KoboldCpp can constrain it with a GBNF grammar); it just costs you double the slowest part of the turn. Keep the fallback slot cloud-side so a stalled local server costs you a wait rather than the turn.

> Note: a page served over `https` may refuse a plain-`http://localhost` call. Run Weft locally (`npm run dev`), or use KoboldCpp's `--remotetunnel` and paste the `https` URL it prints.

## Repairing the narrator's tics

There is a family of sentences a narrator writes when it has nothing else to write: the ones that state what somebody felt, knew, or privately decided. *She was looking at him the way she'd looked at him when they were younger. Not frightened, not grateful, just a woman doing arithmetic on a sum she hadn't expected.* The camera does not know any of that. Weft has caught these for a long time — the pattern list in `engine/reviser.ts` was mined family by family out of real saves — and until now it only ever used the catch one way: to keep the sentence out of the narrator's own replayed context, so the model would not read its worst paragraph and copy it. Good for the drift, no use at all to you, who read it.

**Tuning → Models → Repair the narrator's tics** points the catch at the page instead. Each flagged sentence goes to the **reviser** slot with the offending phrase quoted, and comes back with that phrase removed and nothing else touched. What you read is the repaired copy.

What it deliberately is *not* is a "write this plainer" pass. Asking a model for plainer prose flattens the narration's voice, which is yours to set, and flattens the world's vocabulary, which the narrator is only allowed to draw from this setting — a model reaching for the plainest word reaches for the word from *our* world. The unit of work is one sentence and one quoted phrase, and a replacement is thrown away if it drops a name, becomes dialogue, runs long, or trades one tic for another.

Three things worth knowing:

- **It never touches dialogue.** Any sentence carrying a quotation mark is passed over, so a line somebody actually said is never rewritten. A narration sentence that happens to quote two words keeps its tic; that is the trade, and it is the right way round.
- **The narrator's own words stay on the turn.** The repaired copy is a second field. The bookkeeper, presence, the Chronicle, the audit and every extraction pass read what the narrator actually wrote, so the world's record is exactly what it would have been with this switched off.
- **It is free on a clean turn and nearly free otherwise.** The detector runs locally first, so narration with nothing flagged never opens a socket. When it does fire it is a few hundred tokens — the flagged sentences, no digest, no cast, no rules — and it runs *alongside* the bookkeeper rather than after it, so it hides inside a call that was going to happen anyway. It is the one slot that genuinely wants a small local model; a `local/…` id here costs nothing and adds nothing to the wait.

Off by default, including on upgrade. Every failure path — provider down, timeout, nothing usable back — leaves you reading exactly what the narrator wrote.

## Running a local image model

The same idea one slot down: point **Tuning → Local images** at ComfyUI or an A1111-style WebUI, then set the image slot to a `local/…` id. Portraits and scene art are then drawn on your own GPU.

| Backend | URL | Start it with |
|---|---|---|
| ComfyUI | `http://127.0.0.1:8188` | `python main.py --enable-cors-header '*'` |
| A1111 / Forge / SD.Next | `http://127.0.0.1:7860` | `--api --cors-allow-origins=http://localhost:5173` |

The CORS flag is not optional — a browser calling a local server from a page it was not told to allow gets a failure indistinguishable from the server being down. **Paint a test** in that panel makes one picture and reports exactly what came back.

**Why bother.** Because it makes the picture free, and a free picture can arrive on its own. **Paint the scene every turn** (Tuning → Models) repaints the moment after every message — the story gets a moving illustration instead of a button you remember to press. It runs after the turn has committed, so the prose never waits on the GPU, and a picture that fails to paint is silent: the turn stands either way. The same toggle exists on the cloud path and will tell you what it costs there (~4¢ a message), which is the reason it was never the default.

**How the same person keeps coming back.** A diffusion model has no idea who anyone is; it has the words you give it, and it is far more literal than the multimodal models the cloud path uses. So three things hold the cast still:

1. **Locked descriptions.** When a portrait is generated, the exact words that drew it are written onto the character as their *image words* and then reused verbatim in every scene — visible and editable in **Cast → Edit**. Clothing, mood and injuries are added per scene as separate clauses, so changing a shirt never changes the face. A description re-derived from live state each turn drifts a few words at a time and returns a stranger by the tenth message; this is the single biggest lever.
2. **The portraits themselves, as reference images.** Put `%ref1%` in your ComfyUI workflow and Weft stitches the portraits of everyone in the scene into one reference sheet, uploads it, and wires it in — so any single-image reference mechanism carries the whole cast. **Flux Kontext** is the easiest (there is a ready template behind *Load Flux Kontext*); IP-Adapter, PuLID and InstantID all take the same one image. Without a `%ref%` token nothing is uploaded and consistency rests on the locked words alone.
3. **Held seeds.** A character's portrait seed follows them; a scene's seed is derived from the place and who is in it, so one room keeps its framing and palette across a dozen messages while the action changes. Asking again for a turn that already has a picture deliberately breaks that lock — "another take" means another take.

**The workflow.** Leave it blank and a plain txt2img graph is used, which needs only a checkpoint name. For anything else, export yours from ComfyUI with **Workflow → Export (API)** and replace the values Weft should fill with `%prompt%`, `%negative%`, `%seed%`, `%width%`, `%height%`, `%steps%`, `%cfg%`, `%sampler%`, `%scheduler%`, `%checkpoint%`, `%ref1%`–`%ref4%`. Numbers are substituted through their quotes, so `"seed": "%seed%"` arrives as a real number — ComfyUI rejects the string, and that is the most common way a hand-edited workflow fails.

**Prompt dialect matters.** Flux, SD3 and anything with a T5 text encoder read sentences; SD1.5, SDXL and Pony parse comma-separated tags and stop attending past roughly seventy tokens. The **Tag-style prompts** switch picks which one is built. Either way the negations go where a sampler can actually read them: a sampler has no "not", so "no watermark, no crowd, not a person" in the positive prompt is three votes *for* those things — Weft builds a negative prompt instead, and adds to it per picture (a cast of two bars the crowd; a scene with nobody human in it bars people outright).

**Storage.** A picture a turn is a save that grows by a couple of hundred kilobytes a message, and the save is rewritten on every engine call. Images are re-encoded to a 1280px JPEG on the way in, and past **Illustrations that keep their pixels** (default 12) older turns keep the record of having been illustrated and lose the bytes.

> Note: as with a local text model, a page served over `https` will refuse a plain-`http://localhost` call — run Weft locally (`npm run dev`) when you use this.

## Where your data lives

Saves (including any AI-generated portraits and scene art) are stored in your browser via **IndexedDB**. They persist across reloads but are tied to that browser/profile. Use **Tuning → Export save** to download a `.weft.json` you can back up or move; **Library → Import** to load one anywhere.

## What's inside

The full engine ported to the browser:

- **It explains itself** — a welcome card on first run, and a brief one-control-at-a-time spotlight pass on each screen the first time you open it (a line per step; the **?** in the title bar replays it). A one-card cheat sheet covers the four input channels, what is and isn't binding on the world, and the four repairs for a bad turn. One checkbox at the Forge turns the automatic guides off for good.
- **Two-call turn loop** — a streamed narrator and a single strict-JSON simulator; everything else is deterministic and free.
- **The Undertow** — the continuous substrate: logit Quantal Response Equilibrium stances, a frustrated Kuramoto network with a Benettin Lyapunov estimate of the world's regime, cusp-catastrophe psyches that home to each person's set point, and Scheffer early-warning signals.
- **Time-and-place-stamped memory** — every memory records *when* (in-world time) and *where* it happened, and the narrator sees lived distance ("Day 5, ≈3 weeks ago, at the Loom") so old events read as old, not as fresh shocks. Moving somewhere auto-writes a "left X for Y" memory, so a companion of a thousand turns actually remembers where she's been.
- **Identity that earns its changes** — acquired traits and beliefs are now visible in the Cast drawer (with intensity/integration), and a full **raw JSON editor** is back — for characters (identity, condition, traits, memory) AND for the **world** (Tuning → Raw world edit: bible, threads, faction clocks, places, edges, canon), so you can fix anything the forge over-baked right at turn 1 (per-character: identity, condition, traits, memory — add traits/beliefs by hand). Speech is **derived live** every turn from baseline + strong acquired traits + age + current mood + the relationship to whoever's being addressed (a character is cutting to a hostile cop, soft to a lover). And deeply-held acquired traits **consolidate**: reinforced across a long arc, they fold permanently into core traits and the spoken voice — earned slowly, never from a single scene.
- **Grounded complications** — a higher pressure reading no longer licenses invented lore. Complications must grow from what's already established (a thread, a known player, the scene), proportionate to what's happening; the engine will never spring a world-altering revelation, secret identity, or "you were a different species all along" retcon to fill a pressure quota. If there's no grounded friction, a quiet beat is correct. And in focus mode the controller can no longer push pressure UP to hit its target at all — a quiet stretch stays quiet.
- **Focus phases (converge, then escalate)** — focus on an event and the story *builds* toward it: new unrelated chaos is suppressed and every scene bends toward the throughline, while the controller is forbidden from manufacturing friction to hit a quota. When the event actually fires on the clock, the phase **auto-advances** — "prepare for war" flips to "fighting the war," and the tension default flips from suppressed to hot, on its own. Fully generic; driven by the scheduled event firing, not by any keywords. Tap the X to release. 
- **Set the clock by hand** — when the bookkeeper's time drifts from the prose (it says morning, the clock says 18:00), fix it from the Play screen's time control or in Raw world edit. 
- **Events fire on the clock, not the turn counter** — when the fiction says something happens "in two days" or "at dawn", it's now scheduled against in-world time and held there. It won't spring in minutes just because several fast conversational turns passed; it comes due only when the calendar actually reaches it (including across time-skips), then arrives on its own.
- **Story beats, not a talking simulator** — the narrator is now required to MOVE the situation every turn (an action, a discovery, an arrival, a position won or lost), action is fast and physical (no lengthy dialogue mid-fight), and low pressure means "no threat" rather than "nothing happens." Crucially, conflict no longer converges on everyone turning out good: hostility, contempt, and irreconcilable difference are valid lasting endpoints, and a character softening is a rare earned event, not a scene's default arc.
- **Your direction is law** — your standing direction now sits at the TOP of the prompt as a supreme override, above the world bible, the cast, the clocks, and the model's own sense of drama. If you say a power/trait/topic is incidental and NOT the story, the narrator and simulator are bound to keep it peripheral every turn and never spin faction objectives or threads around it. The model subverting your stated premise to chase "interesting tension" is now defined as its worst possible failure.
- **Token usage is visible** — the Chronicle shows a running token breakdown (input/output/total, per-turn average, and which model is your narrator and what share of spend it is), and flags when the narrator is a premium model so a $50 surprise can't sneak up on you. (Weft sees token counts, not prices — check openrouter.ai/activity for live billing.)
- **Neutral is the default** — characters no longer manufacture suspicion or menace from ordinary input. The clench/paranoia physics applies only to characters whose state is actually clenched or whose traits are genuinely hostile; a calm, intact character reads situations accurately and reacts like a normal adult (curious, mildly skeptical, busy). A nervous newcomer asking for help gets a conversation, not a containment protocol. Escalation must be earned by events, not generated from vibes — and the narrator won't invent threatening backstory the state doesn't contain.
- **Lucid villains** — the clench/openness physics governs the *wounded*; it no longer forces antagonists to be secretly good. Characters marked dark (manipulative, ruthless, predatory) are written as clearly, comfortably cruel.
- **A real location model** — every character (you included) has a *place*, tracked by the bookkeeper from the prose: walk somewhere and your location follows; teleport or summon someone and the engine actually moves them there; name a far-off character and they're referenced, not teleported. Places (including in-between ones like "walking outside the dome") are auto-created on first mention. Who's "in the scene" is *derived* from co-location — never authored — so people stop materialising across the world mid-sentence.
- **Editable opening** — generate, hand-edit, or clear the scene you start in (Tuning → Opening scene), shown as "the beginning" before turn 1.
- **New chapter (RECAP)** — the Sprout button on any save distills its whole world-state into a fresh game after a time skip: surviving cast carried forward with evolved traits and relationships baked in, canon preserved, opening narrated as "RECAP: …". A season-2 generator.
- **Character texture** — every character carries a few small standing interests, quirks, and sensitivities (generated from their background at forge, and the engine can quietly grow one when the story earns it — someone who keeps fishing "has taken to fishing"). The narrator surfaces these lightly in quiet moments — a tree-lover pausing at a good one — as seasoning, never the meal, never during tense scenes. Paired with a familiarity rule so long-established situations read as worn-in routine instead of perpetual revelation (no more "we're really doing this" about a six-month marriage).
- **World tension dial (0–10)** — Tuning → World tension. The master control for how much the world throws at you. At **0 the engine introduces nothing new** — no fresh threats, threads, scheduled consequences, faction-clock moves, or background NPC drives; it only responds to what you do, pure breathing room. Low settings keep friction mild and stop new complications from being manufactured; the default 5 is the normal rhythm; high settings escalate fast and often. Independent of focus and lean mode.
- **Lean mode & token budget (one app, two dials)** — Tuning → Token economy. *Lean mode* swaps in compressed instructions and sends only present/tracked characters, roughly halving input tokens at a small cost to prose richness. *Token budget* sets a hard per-turn ceiling: when set, context is trimmed toward it — shedding offscreen detail, old memories, and rumors first, and collapsing only the least-involved present characters as a last resort, so no one in your scene is ever dropped. Use either or both, per save.
- **Identity consolidation & importance-aware memory** — central characters no longer lose who they've become. Memory eviction now protects high-salience moments (a first night together, a death, a betrayal) from the cap instead of dropping them by recency, and identity-defining memories (importance 8+) fold permanently into a separate life-history layer that shapes how the character is written — while the original forge identity stays untouched bedrock. As that history grows it self-compresses (oldest beats trimmed, and re-summarized by a cheap model only when it really piles up), so it never bloats — paired with relationship roles so "girlfriend" is a tracked fact, not an inference.
- **Ground a reply with live web search** — a Globe ("web") toggle by the composer. Flip it on for a turn and that single narrator reply runs through OpenRouter's web search, so a story set in a real place or based on real subject matter gets the actual facts, locations, layouts, and details right. You control when (and only pay for search on those turns); off by default. Pairs well with the strangers-by-default fix so a known setting starts honest and stays accurate when you ask it to.
- **Strangers by default** — new characters no longer arrive pre-attached to the player. The forge and simulator start anyone the player hasn't actually met at zero warmth with no relationship roles, and known-IP scenarios stop importing the source material's relationship web onto you — so you get real introductions instead of a stranger acting like an old friend.
- **Speech / thought / action channels** — within a single message you can mix what you say, think, and do: "double quotes" are spoken aloud and others hear them, *asterisks* are a private thought no character can perceive or react to, and plain text is physical action. The narrator and the bookkeeper both respect the wall — a thought in asterisks never leaks to anyone in the scene, and no one forms knowledge or reactions from it.
- **Coherence — pinned identity & continuity** — every character has explicit pronouns (no more guessing gender / he-she slips), and each present character's pronouns + core traits are restated right beside their live state instead of only in a far-away cast card, so cheaper models stop dropping them mid-context. The immediately-previous prose is also carried forward each turn so voices and facts stay consistent rather than drifting.
- **Relationship roles** — bonds now carry labeled, possibly multiple relationships ("boss" *and* "girlfriend"; "older sister" *and* "rival"), tracked as facts separate from the warmth/trust temperature. The Simulator sets them when the fiction makes a relationship explicit, the narrator always knows them, and they show in the cast drawer's Bonds and on the relationship web. Multiplicity is first-class — one person can be several things to another at once.
- **The web — a relationship graph** in the World tab: the whole cast as a diagram, player at center, edges colored by warmth (green warm / amber cool / red hostile) and weighted by strength. Tap any face to isolate their ties. Makes the social simulation legible at a glance — and surfaces an all-allies or all-hostile cast instantly.
- **Who's here** — the Play screen now shows a strip of exactly which characters are in the scene with you (with their faces) and where, so no one is silently present.
- **Characters actually grow** — acquired traits now fire on any meaningful beat (a betrayal, a kindness, a humiliation, a faced fear), planted at low intensity and strengthening with repetition, visible in the Cast drawer's "becoming" section.
- **The dead leave the stage** — when a character is killed or permanently leaves the story, the Simulator records it; they're pulled from the scene and every room, stop getting new drives, vanish from the relationship web, and move to a collapsed "Gone" section in the cast (greyed, with how they exited) — instead of lingering as an active being. (You can revive or remove anyone by hand in the raw character editor by setting their status.)
- **An optional schedule — where somebody has to be, and when** (Cast → Their week). The engine only ever knew what a person *wanted*, which is open-ended, so nobody ever had to be anywhere: a character with a job in her background was at your flat at eleven on a Tuesday morning for the same reason she was there at eleven on a Sunday. Now any character can carry a standing week — a shift, a watch, lessons, a market day — with hours, a place, how they get there, and *why it is in their life* (which ties it to their background, their drives and what they are trying to get). Three things follow. **They know what is coming**: their card carries the next thing on their day and how long they have, so they cut a conversation short, turn down an errand that will not fit, or tell you they are free until five. **They go on their own**: offscreen, the engine puts them where their hours say they are — deterministically, no tokens — so the yard has men in it at six and the market has stallholders at market hours. **A night that keeps them costs them**: nobody is ever teleported out of a live scene, the narrator is told to write them leaving and staying is a choice with a price; only a scene that holds them *far* past the hour makes the engine act itself, and then they left late, and remember it. Missing something they could not afford to miss lands later as an ordinary scheduled consequence. **Weekday and weekend are real** — every save has a week whether or not it keeps a calendar (with no start date, Day 1 is a Monday), so "catch her before her shift" and "he's off Sunday" are things you can plan around. Write a week by hand, or tap **read it off their background** and one cheap call reads the week already implied by who they are. Entirely optional: a character without one behaves exactly as before.
- **Multiple drives per character** — each tracked character can hold a priority stack of up to three goals. They pursue the top one, but when it stalls, completes, or the scene goes quiet, they switch to a higher- or equal-priority backup — leaving a calm thread to chase a more pressing one elsewhere instead of hovering near you.
- **NPC autonomy & tracking** — named characters you engage join the "long game": offscreen they keep wanting things. When a character finishes a drive (or has none), the engine seeds a new one from *who they are* — their traits, values, and how they feel about everyone else — so a detective starts a new case, a thief plans a score, a rival regroups, all without you authoring it. Follow/unfollow any character with the eye toggle in **Cast**; the narrator can also pull a character into the long game when a thread makes them matter. Unfollowed bit-players recede into the background.
- **Continuity** — let the world turn (deterministic multi-day skips with an interlude), and vessels (leave your character, become another, full identity swap).
- **Canon** — world-altering public events every mind remembers forever.
- **Park-style memory** with reflection, a social fabric of edges + rumor cascades, faction clocks, deterministic pressure control, the full world-bible & character editors, God Mode, dark/light, image generation, and the Chronicle's arcs, records, and regime read-outs.

**Art direction you control** (Tuning → Art direction): set the visual style once — "muted painterly chiaroscuro", "90s cel anime", "gritty photoreal" — and it governs all images. Portraits are full-body, head-to-toe, on a white studio background, and the prompt reads the *whole* character (appearance, core + acquired traits, current bearing, even a guiding belief) so the figure looks like who they actually are. Those portraits are then fed as reference images when illustrating a scene, so the cast stays visually consistent (on image models that accept multimodal input, e.g. the Gemini flash-image family — and on a local ComfyUI workflow with a `%ref1%` node, see *Running a local image model*).

You can choose any OpenRouter image model for portraits and scene art in **Tuning → Images** (Gemini, FLUX, GPT-Image, etc.), and tap any portrait or scene illustration to view it full-screen.

Built with React 19 + Vite + Tailwind 4 + Motion. `base: "./"` means it works from a user root *or* a project subpath with no per-repo configuration.
