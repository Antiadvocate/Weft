/**
 * THE PLAYER'S TURN, READ BY A MODEL BEFORE THE NARRATOR WRITES IT.
 *
 * For most of this engine's life, what the player typed was read by patterns: lists of words for
 * violence, for leaving, for "drop it", for turning someone away, for talking to the game instead of
 * the world. Every one of them failed the same way in play. "I haven't found a reason to make you go
 * away" turned someone away. "I skin her so she is nothing but a skeleton" was not violence, because
 * "skin" wasn't on the list. "I set isolade on fire" missed its victim on a typo. The player's verdict
 * was the right one: the people typing and the models writing back are beyond being caught by a
 * list of words.
 *
 * So one call to the small model reads the turn, before anything else is built, and hands the
 * engine what it means as fields: what was said aloud, what was done where others could see it, what
 * was only thought, who it was done to, whether the player is leaving and where to, whether they're
 * closing a subject, whether a line is addressed to the game, and the rest. Everything downstream
 * that used to guess at the words reads these.
 *
 * It runs once a turn. The Play screen asks for it before sending, so a line that's an instruction
 * about the story can be offered the right tools; the turn then reuses the same read. If the call
 * fails, the read is empty, and every consumer treats an empty read as "nothing of that kind
 * happened" rather than guessing.
 */
import type { SaveState } from "./types";
import { complete, buildMessages, safeJson, Cancelled } from "../llm";
import { clipText, collapseSpaces, without } from "./text";

export interface ActionRead {
  /** The player's words spoken aloud, each line verbatim. */
  said: string[];
  /** What anyone in the room could see the player do, in plain words, with speech and thought left out. */
  did: string;
  /** What the player only thinks or feels, which nobody else can perceive. */
  thought: string;
  /** Anything addressed to the game, the narrator or the AI instead of to the world. */
  to_the_game: string;
  /** A request to change the story itself: something removed from it, or something made true in it. */
  story_change: { asked: boolean; remove: string; true_now: string };
  /** The player leaving where they are, and where to. */
  leaving: { going: boolean; to: string };
  /** The player's own words closing a subject they're done with. */
  drop_subject: string;
  /** Ids of the people the player gives, makes or mends something for. */
  gives_to: string[];
  /** Orders the player gives, and to whom (ids). */
  orders: { to: string[]; what: string }[];
  /** Ids of people the player sends away, turns down or tells to keep their distance. */
  turns_away: string[];
  /** Ids of people the player ends a relationship with (a breakup, a divorce). */
  ends_with: string[];
  /** Harm the player does to people: who (ids, or "someone" for an unnamed person), what, and whether it kills. */
  harms: { who: string[]; what: string; kills: boolean }[];
  /** Ids of people the player threatens with death or harm. */
  threatens: string[];
  /** A weapon or a power drawn, shown or held without being used on anyone. */
  shows_power: string;
  /** Ids of people the player physically puts out of the scene, has arrested or has taken away. */
  removes: string[];
  /** Something the player declares true about the world or another person instead of doing it. */
  declares: string;
  /** Whether the player, in the scene, says the people here keep describing what they're doing back to them. */
  says_described_back: boolean;
}

export const EMPTY_READ: ActionRead = {
  said: [], did: "", thought: "", to_the_game: "",
  story_change: { asked: false, remove: "", true_now: "" },
  leaving: { going: false, to: "" }, drop_subject: "",
  gives_to: [], orders: [], turns_away: [], ends_with: [], harms: [], threatens: [],
  shows_power: "", removes: [], declares: "", says_described_back: false,
};

const S = (props: Record<string, object>, required: string[] = []): object => ({ type: "object", properties: props, required, additionalProperties: true });
const A = (items: object): object => ({ type: "array", items });
const str = { type: "string" }, bool = { type: "boolean" }, strA = A({ type: "string" });

export const ACTION_READ_SCHEMA: object = S({
  said: strA, did: str, thought: str, to_the_game: str,
  story_change: S({ asked: bool, remove: str, true_now: str }),
  leaving: S({ going: bool, to: str }),
  drop_subject: str, gives_to: strA,
  orders: A(S({ to: strA, what: str })),
  turns_away: strA, ends_with: strA,
  harms: A(S({ who: strA, what: str, kills: bool })),
  threatens: strA, shows_power: str, removes: strA, declares: str, says_described_back: bool,
});

const SYSTEM = `You read one turn of an interactive story, meaning what the player typed for their character, and say what it means as fields the game can act on, without writing any of the story yourself.

The player's character is named below, along with the people in the scene and the others the story knows, each with an id. Whenever a field asks for people, give their ids from that list. When the player means someone by a pronoun, a title, a description or a misspelling ("her", "the old man", "isolade"), work out who from the list and the end of the last scene, and give that person's id. Someone harmed who isn't on the list at all goes in as "someone".

Read it the way a careful person would, because a sentence can say the opposite of the words in it ("I haven't found a reason to make you go away" sends nobody away) and a figure of speech is a way of talking ("I crush her in a hug" harms nobody, and "I kill time" kills nobody). Words inside quotation marks are said aloud unless the player is plainly thinking them, and words between asterisks, or plainly private, are thoughts. Something only threatened or shown is a threat or a show of power, and harm is what the player actually does to someone. A line aimed at the game, the narrator or the AI ("stop narrating", "you're a terrible writer", "change the story so that...") goes in to_the_game, and if it asks for the story itself to change, story_change says what to take out and what's now true. Leave every field empty, false or [] when the turn has nothing of that kind, which is most of them on most turns.

Reply with only this JSON:
{"said":["each line the player says aloud, verbatim"],"did":"what anyone in the room could see the player do, in plain words, apart from speech and thought","thought":"what the player only thinks or feels","to_the_game":"anything said to the game, the narrator or the AI, outside the world of the story","story_change":{"asked":false,"remove":"what they asked to have taken out of the story, in a few words","true_now":"what they said is true now, as a plain statement"},"leaving":{"going":false,"to":"where they're going, if they said"},"drop_subject":"the player's own words, if they're closing a subject they're done with","gives_to":["ids of people the player gives, makes or mends something for"],"orders":[{"to":["ids"],"what":"what they're told to do"}],"turns_away":["ids of people the player sends away, turns down or tells to keep their distance"],"ends_with":["ids of people the player ends a relationship with"],"harms":[{"who":["ids, or someone"],"what":"what the player does to them","kills":false}],"threatens":["ids of people the player threatens with death or harm"],"shows_power":"a weapon or a power drawn, shown or held, and kept from use","removes":["ids of people the player physically puts out of the scene, has arrested or has taken away"],"declares":"anything the player declares true about the world or another person, as a statement of fact","says_described_back":false}`;

/** The cast as the reader sees it: who's here first, then everyone else the story knows. */
function roster(state: SaveState): string {
  const present = new Set(state.world?.present ?? []);
  const line = (id: string) => {
    const c = state.characters?.[id];
    if (!c) return "";
    const aka = c.aliases?.length ? `, also called ${c.aliases.slice(0, 3).join(", ")}` : "";
    return `- ${id}: ${c.name}${c.pronouns ? ` (${c.pronouns})` : ""}${aka}${c.status === "dead" ? ", dead" : ""}`;
  };
  const here = [...present].map(line).filter(Boolean);
  const others = Object.keys(state.characters ?? {}).filter((id) => id !== "char_player" && !present.has(id)).slice(0, 24).map(line).filter(Boolean);
  return [`IN THE SCENE:\n${here.join("\n") || "- nobody but the player"}`, others.length ? `ELSEWHERE IN THE STORY:\n${others.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

function lastScene(state: SaveState): string {
  const h = [...(state.history ?? [])].reverse().find((x) => x?.narrator_prose);
  return h ? clipText(String(h.narrator_prose).slice(-1400), 1400) : "";
}

const MODE_NOTE: Record<string, string> = {
  do: "The player typed this as what their character does and says.",
  say: "The player typed this as words their character says aloud, all of it.",
  think: "The player typed this as their character's private thought, all of it.",
  story: "The player typed this as what happens in the story, written as its author.",
};

/** Ids only, from people the story knows, or "someone". */
function ids(state: SaveState, v: unknown, allowSomeone = false): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const x of list) {
    const id = String(x ?? "").trim();
    if (allowSomeone && id === "someone") { out.push(id); continue; }
    if (id && id !== "char_player" && state.characters?.[id] && !out.includes(id)) out.push(id);
  }
  return out;
}
const text = (v: unknown, max = 400) => clipText(String(v ?? ""), max);

/** The model's answer, held to the shape and to people who exist. */
export function shapeRead(state: SaveState, g: any): ActionRead {
  if (!g || typeof g !== "object") return { ...EMPTY_READ };
  return {
    said: (Array.isArray(g.said) ? g.said : []).map((x: unknown) => text(x, 600)).filter(Boolean).slice(0, 12),
    did: text(g.did, 600),
    thought: text(g.thought, 600),
    to_the_game: text(g.to_the_game, 600),
    story_change: { asked: !!g.story_change?.asked, remove: text(g.story_change?.remove, 120), true_now: text(g.story_change?.true_now, 300) },
    leaving: { going: !!g.leaving?.going, to: text(g.leaving?.to, 120) },
    drop_subject: text(g.drop_subject, 200),
    gives_to: ids(state, g.gives_to),
    orders: (Array.isArray(g.orders) ? g.orders : []).map((o: any) => ({ to: ids(state, o?.to), what: text(o?.what, 200) })).filter((o: { to: string[]; what: string }) => o.what).slice(0, 6),
    turns_away: ids(state, g.turns_away),
    ends_with: ids(state, g.ends_with),
    harms: (Array.isArray(g.harms) ? g.harms : []).map((h: any) => ({ who: ids(state, h?.who, true), what: text(h?.what, 200), kills: !!h?.kills })).filter((h: { what: string }) => h.what).slice(0, 6),
    threatens: ids(state, g.threatens),
    shows_power: text(g.shows_power, 200),
    removes: ids(state, g.removes),
    declares: text(g.declares, 300),
    says_described_back: !!g.says_described_back,
  };
}

/** What the player typed with the lines to the engine taken out: ((a search)) and [[a beat]]. */
export function storyText(action: string): string {
  return collapseSpaces(without(without(String(action ?? ""), "((", "))"), "[[", "]]"));
}

/** Ask the small model. Never throws for a failure: a failed read is an empty one. */
export async function readAction(state: SaveState, action: string, mode = "do", signal?: AbortSignal): Promise<ActionRead> {
  const typed = storyText(action);
  if (!typed) return { ...EMPTY_READ };
  const cached = state.action_read;
  if (cached && cached.action === typed && cached.mode === mode && cached.turn === state.world?.current_turn) return cached.read;
  const P = state.characters?.char_player;
  const ctx = [
    `THE PLAYER'S CHARACTER: ${P?.name ?? "the player"}${P?.pronouns ? ` (${P.pronouns})` : ""}`,
    roster(state),
    lastScene(state) ? `THE END OF THE LAST SCENE:\n${lastScene(state)}` : "",
    `${MODE_NOTE[mode] ?? MODE_NOTE.do}\n\nWHAT THE PLAYER TYPED:\n${typed.slice(0, 3000)}`,
  ].filter(Boolean).join("\n\n");
  let read: ActionRead = { ...EMPTY_READ };
  try {
    const model = state.model_settings.simulator_model;
    const out = await complete(buildMessages(SYSTEM, ctx, "Read the turn. Reply with the JSON only.", model), model, state.model_settings.fallback_model, { schema: ACTION_READ_SCHEMA, name: "action_read" }, 900, { signal });
    read = shapeRead(state, safeJson<any>(out.text, null));
  } catch (e: any) {
    if (e instanceof Cancelled) throw e;
    console.warn("[read] the turn couldn't be read; treating it as having nothing in it", e?.message ?? e);
  }
  state.action_read = { action: typed, mode, turn: state.world?.current_turn ?? 0, read };
  return read;
}

/** The read for the turn being played, or an empty one when there isn't one. */
export function turnRead(state: SaveState): ActionRead {
  const r = state.action_read;
  return r && r.turn === state.world?.current_turn ? r.read : EMPTY_READ;
}

/** Put a read in place by hand: for tests, replays and anything that already knows. */
export function setRead(state: SaveState, action: string, read: Partial<ActionRead>, mode = "do"): ActionRead {
  const full = { ...EMPTY_READ, ...read } as ActionRead;
  state.action_read = { action: storyText(action), mode, turn: state.world?.current_turn ?? 0, read: full };
  return full;
}

/** The read of an earlier turn, kept on its history entry. */
export function readOfTurn(h: { read?: ActionRead } | undefined): ActionRead {
  return h?.read ?? EMPTY_READ;
}
