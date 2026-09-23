/**
 * THE PLAIN NARRATOR.
 *
 * The directed narrator on the Velora save was sent about 155,000 characters for one line of player
 * input: 69,400 of standing rules, 52,500 of snapshot, 33,800 of per-turn direction. The story
 * itself, as prose, was about 6,000 of that, and only the last three turns. Everything else was
 * correction: a rule for each failure anybody had seen, and each rule pulling on the others. The
 * model spent the turn satisfying rules, so Sera wiped a bar in somebody's kitchen, a grid dispute
 * was forced into a day off, and everybody spoke in one-line fragments because a rule capped the
 * people the player wasn't facing at "one line each".
 *
 * This mode sends the story and the people and trusts the model with them. The model gets:
 *   - a short system prompt, written the way you'd brief a novelist;
 *   - the world, its hard limits and its established facts;
 *   - the whole story so far, as prose, with only the oldest turns shortened to their summaries;
 *   - where the scene is, whose place it is, when, and who is there;
 *   - each person present as a whole person: background, voice, how they come apart under stress,
 *     what they want, what they remember, how they feel about the player, and how open or
 *     clenched they are right now;
 *   - the player's input.
 *
 * Nothing in it tells the model what should happen this turn. The world still moves: the engine
 * still runs clocks, offstage events, relationships and memory after each turn, and whatever that
 * produces reaches the narrator here as a fact about the world, never as an order.
 *
 * RELAXATION AND CLENCHING. Every character carries `psyche.relaxation`, from -10 (clenched) to +10
 * (open), with a resting point it drifts back to. The directed narrator turned that number into
 * orders: "take the worst reading", "answer briefly", "at most one line". Here it's a description of
 * where the person is right now, next to their own card's account of what they do when threatened
 * and what settles them. An open person's attention is wide: they take in what's actually in front
 * of them and respond to it freshly. A clenched person's attention narrows onto the threat and their
 * old habits run them. Both come from the person and the moment, and both can change within a scene.
 */
import type { SaveState, Identity, ActionMode, SocialEdge, EpisodicMemory } from "./types";
import { buildMessages } from "../llm";
import { contextHistory } from "./context";
import { detectWorldPronoun } from "./coerce";
import { retrieve } from "./memory";
import { populationOf } from "./population";
import { SCENE_FOOTER_INSTRUCTION } from "./prompts";

/** How much of the story goes in as full prose before older turns are shortened to summaries. */
const STORY_PROSE_BUDGET = 40_000;
/** Memories per person present, picked by relevance to what the player just did. */
const MEMORIES_PER_PERSON = 8;

export const PLAIN_NARRATOR_SYSTEM = `You're narrating an ongoing story that one player lives inside. The player tells you what their character does, and you write what happens next: what the other people do and say, and what the world does. Then you hand the story back to the player.

"You" in the story always means the player's character. Write in the second person and present tense, and never call the player's character by name or by a third-person pronoun in the narration. Everyone else is written in the third person.

How to read what the player types. Text in "double quotes" is what their character says out loud. Text in *asterisks* is a private thought: nobody else can hear it or know it. Anything else is what their character does. They did exactly that and nothing more, so don't add words, actions, feelings or decisions for them. Don't repeat their line back to them; start from the moment just after it, with everyone in the room having heard and seen it. If someone asks them something or the moment turns to them, stop there and let them answer.

Everything you're given about the story is true, and your job is to keep it true. People remember what happened in front of them and what was said to them, and they carry it into what they do next. A place stays what it is: someone's home is their home, and a person visiting it behaves like a guest. A time of day and a day of the week hold. Don't invent facts about the player's character (a job incident, a document they signed, a mark on their body) beyond what's on their card and what has happened in the story. If something new needs to exist, let it come from something that's already there. The story itself is the final word: if a note below disagrees with what the story shows, such as someone listed as here who walked out in the last scene, go with the story, and put it right in the line you end the turn with.

The people. Each person present comes with a full description: where they come from, what shaped them, how they talk, what they want, what they remember and how they feel about the player's character. Let them act from all of that. They're whole people with their own day going on. They want things, they notice things, they get things wrong, they change their minds. Nobody does something because the story needs it; they do it because it's what that person would do right now. The story is seen through the player's character, so you can't see inside anyone else's head, but people show a great deal: they say what they think, explain themselves, tell stories, joke, argue, go quiet, leave. Write them the way you'd know them in life.

Openness and clenching. Each person's description says how open or clenched they are right now. It's the most useful thing you know about them in this moment. When someone is open and relaxed, their attention is wide. They take in what's actually happening and respond to it freshly, they're curious, they can be surprised, they laugh easily, they say what they notice, and they can hear something difficult without defending against it. When someone is clenched, their attention narrows onto whatever feels threatening, and their oldest habits take over: the ones their description lists for when they're under pressure. They misread, defend, repeat themselves, withdraw or push. Most people are somewhere in between. It isn't fixed: being heard, being treated kindly and feeling safe loosen people, and being cornered, shamed or frightened tighten them, and that can happen partway through a scene. Let what happens between people move them, and let where they are decide how they meet what happens.

How people talk. Each person has their own voice, described on their card with example lines. Use it. Someone who talks in long looping sentences does that, and someone who barely talks barely does. How much a person says comes from who they are and what's happening to them. Some people talk a lot, and a conversation can have long speeches in it. Dialogue should sound like real people: they interrupt, trail off, answer the question they wanted to be asked, and say ordinary things.

The world. This world has its own facts and its own limits, set out below. Its people know only what their lives would have taught them. If the player's character names something that doesn't exist here, the people listening have never heard of it, so they ask what it is, guess wrong, or let it pass. The world has its own business going on (work, weather, other people, problems that were already underway), and it can touch the scene when it would, but it doesn't arrive just to create drama.

Writing. Write plain, specific prose about what can be seen, heard and felt from where the player's character is. Use concrete detail, and don't philosophize. Let each paragraph end on something happening in the scene. A turn is usually between 150 and 450 words: as long as the moment needs, and ending when it's the player's turn.`;

/* ─────────────────────────────── helpers ─────────────────────────────── */

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

function warmthWords(w: number, who: string): string {
  if (w >= 70) return `loves ${who}`;
  if (w >= 45) return `is fond of ${who}`;
  if (w >= 20) return `likes ${who}`;
  if (w >= 5) return `is mildly well disposed toward ${who}`;
  if (w > -5) return `has no strong feeling about ${who} yet`;
  if (w > -20) return `is cool toward ${who}`;
  if (w > -45) return `dislikes ${who}`;
  return `resents ${who}`;
}

function trustWords(t: number): string {
  if (t >= 50) return "trusts them";
  if (t >= 20) return "is starting to trust them";
  if (t >= 0) return "is still deciding whether to trust them";
  if (t > -25) return "is wary of them";
  return "doesn't trust them at all";
}

/** Where someone is on the open-to-clenched range, as a description of the person. */
export function opennessWords(relaxation: number): string {
  const r = relaxation ?? 0;
  if (r <= -7) return "badly clenched: braced against everything, attention narrowed to the threat, running on old defences";
  if (r <= -3) return "tense and guarded: taking things carefully, quick to hear a threat, giving less than they're asked for";
  if (r < 3) return "in the middle: neither braced nor especially at ease";
  if (r < 7) return "fairly relaxed: attention wide, taking things as they come, easy to talk to";
  return "completely at ease: open, unguarded, saying what they notice and letting things in";
}

function edgeLine(e: SocialEdge | undefined, name: string, playerName: string): string {
  if (!e) return `${name} hasn't dealt with ${playerName} before.`;
  const roles = (e.roles ?? []).filter(Boolean);
  const bits = [
    // roles are what `from` is to `to`: Veth's "co-worker" means Veth is Rabi's co-worker
    roles.length ? `${name} is ${playerName}'s ${roles.join(" and ")}.` : "",
    `${name} ${warmthWords(e.warmth ?? 0, playerName)}, and ${trustWords(e.trust ?? 0)}.`,
    e.notes?.trim() ? `Lately: ${clean(e.notes)}` : "",
  ];
  return bits.filter(Boolean).join(" ");
}

function voiceBlock(c: Identity): string {
  const v = c.voice;
  const lines: string[] = [];
  if (v?.diction) lines.push(`Words: ${clean(v.diction)}`);
  if (v?.syntax) lines.push(`Sentences: ${clean(v.syntax)}`);
  if (v?.rhythm) lines.push(`Rhythm: ${clean(v.rhythm)}`);
  if (v?.tics?.length) lines.push(`Habits of speech: ${v.tics.map(clean).join("; ")}`);
  if (v?.never_says?.length) lines.push(`Won't talk about: ${v.never_says.map(clean).join("; ")}`);
  if (v?.example_lines?.length) lines.push(`Sounds like: ${v.example_lines.map((l) => `"${clean(l).replace(/^"|"$/g, "")}"`).join(" / ")}`);
  if (!lines.length && c.speech_pattern) lines.push(clean(c.speech_pattern));
  return lines.length ? `How ${c.name} talks:\n  ${lines.join("\n  ")}` : "";
}

function list(label: string, xs: unknown): string {
  const arr = Array.isArray(xs) ? xs.map(clean).filter(Boolean) : clean(xs) ? [clean(xs)] : [];
  return arr.length ? `${label}: ${arr.join("; ")}` : "";
}

function memoryLines(state: SaveState, id: string, query: string): string {
  const mem = state.memory?.[id];
  if (!mem) return "";
  const turn = state.world.current_turn;
  const out: string[] = [];
  const episodes = retrieve(mem, query, turn, MEMORIES_PER_PERSON) as EpisodicMemory[];
  // in the order they happened, so a sequence reads as one
  episodes.sort((a, b) => (a.event_turn ?? a.turn ?? 0) - (b.event_turn ?? b.turn ?? 0));
  for (const m of episodes) out.push(`- ${m.when_label ? `${m.when_label}: ` : ""}${clean(m.content)}`);
  const facts = (mem.facts ?? []).filter((f) => !f.superseded_by).slice(-6);
  for (const f of facts) out.push(`- (takes as fact) ${clean(f.content)}`);
  const beliefs = (mem.beliefs ?? []).slice(-4);
  for (const b of beliefs) out.push(`- (believes) ${clean((b as { content?: string }).content ?? b)}`);
  return out.length ? `What ${state.characters[id]?.name} remembers:\n${out.join("\n")}` : "";
}

function stateNow(state: SaveState, id: string): string {
  const cond = state.condition?.[id];
  if (!cond) return "";
  const p = cond.psyche;
  const bits: string[] = [];
  if (p) {
    bits.push(`Right now ${state.characters[id]?.name} is ${opennessWords(p.relaxation)}.`);
    if (clean(p.mood)) bits.push(`Mood: ${clean(p.mood)}.`);
    if (p.active_states?.length) bits.push(`Carrying: ${p.active_states.map(clean).join(", ")}.`);
    if (p.state === "broken" || p.state === "shattered") bits.push(`They're at the end of what they can hold together.`);
    else if (p.state === "fracturing") bits.push(`They're starting to come apart under a long strain.`);
  }
  const body: string[] = [];
  if (cond.fatigue && cond.fatigue !== "fresh") body.push(cond.fatigue);
  if (cond.hunger && cond.hunger !== "fed") body.push(cond.hunger);
  if (cond.conditions?.length) body.push(...cond.conditions.map(clean));
  if (cond.injuries?.length) body.push(...cond.injuries.map((i) => clean((i as { description?: string }).description ?? JSON.stringify(i))));
  if (body.length) bits.push(`Body: ${body.join(", ")}.`);
  if (cond.wearing?.length) bits.push(`Wearing: ${cond.wearing.map(clean).join(", ")}.`);
  if (cond.inventory?.length) bits.push(`Has with them: ${cond.inventory.map((x) => clean(x.name)).join(", ")}.`);
  return bits.join(" ");
}

function personCard(state: SaveState, id: string, query: string): string {
  const c = state.characters[id];
  if (!c) return "";
  const playerName = state.characters.char_player?.name ?? "the player's character";
  const edge = state.world.edges.find((e) => e.from === id && e.to === "char_player");
  const a = c.attachment;
  const want = clean(c.drive?.goal) || clean(c.current_goal);
  const alsoWant = c.current_goal && c.drive?.goal && clean(c.current_goal) !== clean(c.drive.goal) ? clean(c.current_goal) : "";
  const parts = [
    `### ${c.name} (${c.pronouns || "they/them"}, ${c.age ?? "age unknown"})`,
    clean(c.appearance_now) ? `Looks: ${clean(c.appearance_facts)} Right now: ${clean(c.appearance_now)}` : clean(c.appearance_facts) ? `Looks: ${clean(c.appearance_facts)}` : "",
    clean(c.background) ? `Background: ${clean(c.background)}` : "",
    list("What they're like", c.core_traits),
    list("What matters to them", c.values),
    list("Their ordinary life", c.texture),
    voiceBlock(c),
    a ? `Under pressure: ${clean(a.under_threat)}${a.when_that_fails ? ` If that doesn't work: ${clean(a.when_that_fails)}` : ""}${a.soothed_by ? ` What settles them: ${clean(a.soothed_by)}` : ""}` : "",
    want ? `What they want at the moment: ${want}${c.drive?.blocker ? ` (in the way: ${clean(c.drive.blocker)})` : ""}` : "",
    alsoWant ? `Longer term: ${alsoWant}` : "",
    c.knows_player_name === false ? `Doesn't know ${playerName}'s name.` : "",
    edgeLine(edge, c.name, playerName),
    stateNow(state, id),
    memoryLines(state, id, query),
  ];
  return parts.filter(Boolean).join("\n");
}

function playerCard(state: SaveState): string {
  const c = state.characters.char_player;
  if (!c) return "";
  const parts = [
    `### ${c.name}: the player's character, written as "you" (${c.pronouns || "they/them"}, ${c.age ?? "age unknown"})`,
    clean(c.appearance_now) ? `Looks: ${clean(c.appearance_facts)} Right now: ${clean(c.appearance_now)}` : clean(c.appearance_facts) ? `Looks: ${clean(c.appearance_facts)}` : "",
    clean(c.background) ? `Background (nobody in the world knows any of this unless the player's character has told them or it has happened in the story): ${clean(c.background)}` : "",
    list("What they're like", c.core_traits),
    list("Their ordinary life", c.texture),
    c.speech_pattern ? `How they talk: ${clean(c.speech_pattern)}` : "",
    stateNow(state, "char_player"),
  ];
  return parts.filter(Boolean).join("\n");
}

function worldBlock(state: SaveState): string {
  const wb = state.world_bible ?? ({} as SaveState["world_bible"]);
  const field = (label: string, v: unknown) => (clean(v) ? `${label}: ${clean(v)}` : "");
  const pro = detectWorldPronoun(state.world.canon);
  const playerPro = clean(state.characters.char_player?.pronouns);
  const pronounNote = pro
    ? `Pronouns: the people of this world use ${pro} for everyone, because their language has no other pronouns. That includes how they speak about the player's character${playerPro && playerPro !== pro ? `, even though the player's character uses ${playerPro}` : ""}. Nobody native to this world says he, him, his, she, her or hers.`
    : "";
  const themes = Array.isArray(wb.pressure_palette) && wb.pressure_palette.length
    ? `What life here tends to revolve around: ${wb.pressure_palette.map(clean).join("; ")}.` : "";
  const notMain = Array.isArray(wb.forbidden_as_primary) && wb.forbidden_as_primary.length
    ? `Never the main thing driving the story: ${wb.forbidden_as_primary.map(clean).join("; ")}.` : "";
  const parts = [
    `## The world: ${clean(wb.name) || "(unnamed)"}`,
    field("Era", wb.era),
    field("Technology", wb.technology_level),
    field("Magic", wb.magic_rules),
    field("Peoples and languages", wb.cultures_and_languages),
    field("Land and climate", wb.climate_and_geography),
    field("Calendar and money", wb.calendar_and_currency),
    field("Politics", wb.political_situation),
    field("What people fear", wb.what_people_fear),
    field("Never in this world", wb.forbidden),
    field("Doesn't exist here", (wb as { absent?: string }).absent),
    pronounNote,
    themes,
    notMain,
    field("The player's standing direction for the story", wb.narrator_direction),
    field("Where the player wants the story to end up", wb.destination),
  ];
  const canon = (state.world.canon ?? []).map(clean).filter(Boolean);
  if (canon.length) parts.push(`Established facts:\n${canon.map((f) => `- ${f}`).join("\n")}`);
  return parts.filter(Boolean).join("\n");
}

function placesBlock(state: SaveState): string {
  const places = Object.values(state.world.places ?? {}).filter((p) => p.id !== "loc_offscene");
  if (!places.length) return "";
  const lines = places.map((p) => `- ${p.name}${clean(p.identity) ? `: ${clean(p.identity)}` : ""}`);
  return `## Places in this world\n${lines.join("\n")}\nA new place is only added when the story really goes somewhere that isn't part of any of these.`;
}

/** The story so far: recent turns as full prose, older ones as their one-line summaries. */
export function storyBlock(state: SaveState): string {
  const hist = contextHistory(state).filter((h) => clean(h.narrator_prose));
  const playerName = state.characters.char_player?.name ?? "the player";
  const full: string[] = [];
  let used = 0;
  let cut = hist.length;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    const act = clean(h.player_action);
    const chunk = `${h.time_label ? `[${h.time_label}] ` : ""}${act ? `${playerName}: ${act}\n\n` : ""}${String(h.narrator_prose).trim()}`;
    if (used + chunk.length > STORY_PROSE_BUDGET && full.length) break;
    full.unshift(chunk);
    used += chunk.length;
    cut = i;
  }
  const older = hist.slice(0, cut).map((h) => `- ${h.time_label ? `${h.time_label}: ` : ""}${clean(h.summary) || clean(h.player_action)}`);
  const chapters = (state.chapters ?? []).filter((c) => (c.to_turn ?? 0) < (hist[cut]?.turn ?? Infinity));
  const parts: string[] = ["## The story so far"];
  if (chapters.length) parts.push(chapters.map((c) => `${c.title}: ${clean(c.summary)}`).join("\n"));
  if (older.length) parts.push(`Earlier, in short:\n${older.join("\n")}`);
  if (full.length) parts.push(full.join("\n\n---\n\n"));
  else parts.push("(The story begins now.)");
  return parts.join("\n\n");
}

function sceneBlock(state: SaveState): string {
  const w = state.world;
  const place = w.places?.[w.player_location];
  const playerName = state.characters.char_player?.name ?? "the player's character";
  const present = (w.present ?? []).filter((id) => id !== "char_player" && state.characters[id]);
  const pop = populationOf(place);
  const others = Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed" && !present.includes(id) && c.location)
    .map(([, c]) => `${c.name} (${c.location === "loc_offscene" ? "somewhere else" : w.places?.[c.location!]?.name ?? "somewhere else"})`);
  const threads = (w.threads ?? []).filter((t) => t.status === "active");
  const parts = [
    `## Now`,
    `${clean(w.current_time)}${clean(w.weather) ? `, ${clean(w.weather)}` : ""}.`,
    place ? `Where: ${place.name}.${clean(place.identity) ? ` ${clean(place.identity)}` : ""}${clean(place.description_facts) ? ` ${clean(place.description_facts)}` : ""}` : "",
    pop ? `Ordinarily around here: ${clean(pop.who)}. They're background people with no names or stories of their own.` : "",
    present.length
      ? `Here with ${playerName}: ${present.map((id) => state.characters[id].name).join(", ")}. Nobody else is here unless you write them arriving.`
      : `${playerName} is alone here.`,
    others.length ? `Not here (they can't see or hear this scene): ${others.join(", ")}.` : "",
    threads.length ? `Things going on in the world:\n${threads.map((t) => `- ${clean(t.title)}${clean(t.description) ? `: ${clean(t.description)}` : ""}`).join("\n")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** The whole narrator request in plain mode. */
export function plainNarratorMessages(state: SaveState, action: string, mode: ActionMode, worldNow: string[] = []): any[] {
  const present = (state.world.present ?? []).filter((id) => id !== "char_player" && state.characters[id]);
  const query = `${action} ${contextHistory(state).slice(-1)[0]?.narrator_prose ?? ""}`.slice(0, 2000);
  const stable = [
    worldBlock(state),
    placesBlock(state),
    `## The player's character\n${playerCard(state)}`,
  ].filter(Boolean).join("\n\n");
  const people = present.length
    ? `## The people here\n${present.map((id) => personCard(state, id, query)).join("\n\n")}`
    : "";
  const input = mode === "think"
    ? `## What the player does now\nThis is a private moment inside the player's character. Nobody else can perceive it:\n${action}`
    : `## What the player does now\n${action}`;
  const happening = worldNow.length ? `## In the world this turn\n${worldNow.map((l) => `- ${l}`).join("\n")}` : "";
  const volatile = [storyBlock(state), sceneBlock(state), happening, people, input].filter(Boolean).join("\n\n")
    + SCENE_FOOTER_INSTRUCTION;
  return buildMessages(PLAIN_NARRATOR_SYSTEM, stable, volatile, state.model_settings.narrator_model);
}
