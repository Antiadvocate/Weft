/**
 * FORMATIVE MEMORIES — what a person carries in from before the story starts.
 *
 * The forge writes each character a background paragraph, files it as their core autobiography, and
 * starts their episodic memory empty. Everything downstream that works on episodes — retrieval by
 * relevance, mood-congruent recall, the common-ground matcher, the interview, the record — then has
 * nothing from before turn 1 to work with. A woman whose card says her brother drowned at the ford
 * cannot be reminded of that afternoon, because there is no afternoon in her memory, only a clause
 * in a paragraph about her.
 *
 * Concordia (Google DeepMind's generative-agent library) does this at creation: a short life story,
 * then a handful of formative episodes, each at a stated age, filed as memories. This is the same
 * move in Weft's terms. One batched call for the cast; every episode is first-person and dated,
 * filed with an event time before the story (so chronology holds) and a "before the story began"
 * anchor, and screened before it is kept: an episode that names a person or place the card and the
 * world do not already contain is dropped, because an invented sister in a memory is how kinship
 * gets contradicted forty turns later (see kinship.ts).
 *
 * The player is never given formative memories. Their past is theirs to write.
 */
import type { SaveState, EpisodicMemory } from "./types";
import { buildMessages, complete, safeJson, isCancel } from "../llm";
import { knownNameWhitelist, suspectNouns } from "./facts";
import { asList, asText } from "./coerce";
import { clipText } from "./text";

export const FORMATIVE_SYSTEM = `You write the formative memories of the people in a story that is about to begin: the handful of moments from before the story that each person still carries. You're given each person's card and a note on the world. Write 4 to 6 memories for each person.

Each memory has to pass all of these checks:
- It happened before the story begins, at a stated age that is younger than the person is now.
- It is one to three sentences in the first person and the past tense, and it opens with the age, the way a person would say it ("When I was nine," or "The winter I turned twenty,").
- It shows one thing that happened in this world: where it was, what it looked or sounded like, and what this person did.
- It names a person only if the card already names them. Anyone else is called by what they were to this person: their mother, the priest at the ford, a boy from the next farm. It names a place only if the card or the world note already names it.
- It contradicts nothing on the card. If the card says something happened, a memory can be that event up close. If the card says they had no brothers or sisters, no memory gives them one.

Across one person's memories: spread the ages over their life so far, make at least one about something that has nothing to do with their work or the story's premise, and make at least one about somebody they loved or lost. weight is 1 to 10 for how much it still matters to them now, and feeling is one or two words for what it still carries.

Return only JSON: {"people":[{"name":"","memories":[{"age":9,"memory":"","weight":7,"feeling":""}]}]}`;

/** Does this person already carry formative memories? */
export function hasFormative(state: SaveState, id: string): boolean {
  return (state.memory?.[id]?.episodic ?? []).some((m) => m.formative);
}

/** Everything the card says, as one block of text — what an episode may draw names from. */
function cardText(state: SaveState, id: string): string {
  const c = state.characters[id];
  if (!c) return "";
  return [c.name, c.background, c.life_history, asList(c.core_traits).join(". "), asList(c.texture).join(". "),
    Object.keys(c.skills ?? {}).join(". "), asList(c.values).join(". ")].filter(Boolean).join("\n");
}

/** The brief for one call: the world, then each person's card and their recorded ties. */
export function formativeBrief(state: SaveState, ids: string[]): string {
  const b = state.world_bible ?? ({} as SaveState["world_bible"]);
  const world = [b.name && `World: ${b.name}.`, b.era && `Era: ${b.era}.`, b.cultures_and_languages && `Peoples and languages: ${clipText(b.cultures_and_languages, 300)}`,
    b.climate_and_geography && `Land: ${clipText(b.climate_and_geography, 300)}`].filter(Boolean).join("\n");
  const people = ids.map((id) => {
    const c = state.characters[id];
    const ties = (state.world.edges ?? []).filter((e) => e.from === id && e.to !== "char_player" && (e.roles?.length || e.notes))
      .map((e) => `${state.characters[e.to]?.name ?? "someone"}${e.roles?.length ? ` (${e.roles.join(", ")})` : ""}${e.notes ? `: ${clipText(e.notes, 100)}` : ""}`);
    return [`PERSON: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}.`,
      `Background: ${asText(c.background)}`,
      c.life_history ? `Since then: ${asText(c.life_history)}` : "",
      asList(c.core_traits).length ? `Traits: ${asList(c.core_traits).join("; ")}` : "",
      asList(c.texture).length ? `Small things about them: ${asList(c.texture).join("; ")}` : "",
      ties.length ? `People in the story they're tied to: ${ties.join("; ")}` : "",
    ].filter(Boolean).join("\n");
  });
  return `${world}\n\n${people.join("\n\n")}`;
}

export interface RawMemory { age?: unknown; memory?: unknown; weight?: unknown; feeling?: unknown }

/**
 * File one person's formative memories, keeping only the ones that pass. Returns what was kept and
 * what was dropped (with why), for the log.
 */
export function fileFormative(state: SaveState, id: string, raw: RawMemory[]): { kept: number; dropped: string[] } {
  const c = state.characters[id];
  const mem = state.memory?.[id];
  if (!c || !mem || id === "char_player") return { kept: 0, dropped: [] };
  const whitelist = knownNameWhitelist(state);
  const card = cardText(state, id);
  const ageNow = Number(c.age) || 30;
  const dropped: string[] = [];
  let kept = 0;
  const seen = new Set((mem.episodic ?? []).map((m) => m.content.toLowerCase()));
  const fresh: EpisodicMemory[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    if (kept >= 6) break;                      // six is a past; more is a biography
    const text = asText(r?.memory).replace(/\s+/g, " ").trim();
    const age = Math.round(Number(r?.age));
    if (text.length < 20 || text.length > 500) { dropped.push(`wrong length: "${text.slice(0, 40)}"`); continue; }
    if (!Number.isFinite(age) || age < 0 || age >= ageNow) { dropped.push(`age ${r?.age} is not before now (${ageNow})`); continue; }
    if (!/\b(I|my|me|I'd|I'm|I've)\b/.test(text)) { dropped.push(`not first person: "${text.slice(0, 40)}"`); continue; }
    const invented = suspectNouns(text, card, whitelist);
    if (invented.length) { dropped.push(`names what the card doesn't: ${invented.join(", ")}`); continue; }
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const m: EpisodicMemory = {
      turn: 0,
      event_turn: -1000 + age,                 // before the story, in the order they were lived
      content: text, full_content: text,
      importance: Math.max(3, Math.min(9, Math.round(Number(r?.weight) || 6))),
      emotional_charge: asText(r?.feeling).slice(0, 40) || "old",
      when_label: `age ${age}`,
      anchor_rel: "before the story began",
      decay_stage: 1,                          // old: the gist and the people, not the minute
      source: "witnessed",
      last_accessed_turn: 0,
      formative: true,
    };
    fresh.push(m);
    kept++;
  }
  // Oldest first at the front of the bank, in the order they were lived.
  mem.episodic.unshift(...fresh.sort((a, b) => (a.event_turn ?? 0) - (b.event_turn ?? 0)));
  return { kept, dropped };
}

/**
 * Write formative memories for these people in one call (batched by eight). Fails open: a call that
 * errors or returns nothing usable leaves those people exactly as they were. Returns log lines.
 */
export async function writeFormative(state: SaveState, ids: string[], model: string, fallback?: string): Promise<string[]> {
  const log: string[] = [];
  const todo = ids.filter((id) => id !== "char_player" && state.characters[id] && !hasFormative(state, id));
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    let g: any = null;
    try {
      const out = await complete(buildMessages(FORMATIVE_SYSTEM, "THE PEOPLE:", formativeBrief(state, batch), model),
        model, fallback ?? model, true, Math.min(6000, 400 + batch.length * 420));
      g = safeJson<any>(out.text, null);
    } catch (e) { if (isCancel(e)) throw e; log.push(`formative memories: the call failed (${(e as Error)?.message ?? e})`); continue; }
    for (const p of Array.isArray(g?.people) ? g.people : []) {
      const want = asText(p?.name).trim().toLowerCase();
      const id = batch.find((x) => state.characters[x]?.name.toLowerCase() === want)
        ?? batch.find((x) => state.characters[x]?.name.toLowerCase().split(/\s+/)[0] === want.split(/\s+/)[0]);
      if (!id) continue;
      const r = fileFormative(state, id, p?.memories);
      log.push(`${state.characters[id].name}: ${r.kept} formative memor${r.kept === 1 ? "y" : "ies"}${r.dropped.length ? `, ${r.dropped.length} dropped (${r.dropped.slice(0, 2).join("; ")})` : ""}`);
    }
  }
  return log;
}
