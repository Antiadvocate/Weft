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

export type AttemptDomain = "firearms" | "fighting" | "climbing" | "stealth" | "driving" | "medicine" | "craft" | "persuasion" | "tracking";
export type BodyUse = "hands" | "legs" | "eyes" | "breath" | "head";
const DOMAINS: AttemptDomain[] = ["firearms", "fighting", "climbing", "stealth", "driving", "medicine", "craft", "persuasion", "tracking"];
const USES: BodyUse[] = ["hands", "legs", "eyes", "breath", "head"];

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
  /** The player leaving where they are: where to in their words, the place id when it's one the story
   *  knows, and whether it's their home. */
  leaving: { going: boolean; to: string; place: string; home: boolean };
  /** What the player typed with anything addressed to the game taken out, verbatim; empty when that was all of it. */
  in_world: string;
  /** Whether the player brings back up a subject they closed earlier (given in the context). */
  reopens_subject: boolean;
  /** Whether the player is sleeping, eating, washing or resting. */
  restores: ("sleep" | "eat" | "wash" | "rest")[];
  /** Whether the player says they've already answered what they're being asked. */
  already_answered: boolean;
  /** Whether the player is only waiting, watching or letting things carry on. */
  passive: boolean;
  /** Ids of the people the player speaks to or deals with directly. */
  addresses: string[];
  /** Ids of people the player insults or curses at. */
  insults: string[];
  /** Whether something the player sets loose keeps going on its own after this turn (a fire spreading, a curse). */
  ongoing: boolean;
  /** Whether the player calls, summons or brings someone into the scene. */
  summons: boolean;
  /** Places the player remakes, wrecks or unmakes: the place id and what they do to it. */
  changes_place: { place: string; what: string }[];
  /** Anything the player does that this world's rules don't allow them to do. */
  beyond_the_world: string;
  /** How much the player's own private feeling carries this turn (0 to 1), and which way it moves them. */
  inner: { charge: number; direction: -1 | 0 | 1 };
  /** Something tried that could fail and cost them: how risky, whether it's physical, what it calls on and what it's aimed at. */
  attempt: { stakes: "none" | "risky" | "dangerous"; physical: boolean; domains: AttemptDomain[]; uses: BodyUse[]; target: string };
  /** The player reads or asks something that answers in words: a book, a sign, a screen, a person. */
  consults: { source: string; question: string };
  /** What the player checks a claim against, outside the room ("" when they don't). */
  verifies: string;
  /** Whether the player says they already know what they're being told. */
  says_already_knows: boolean;
  /** Names of people or things the player says don't exist. */
  denies_exist: string[];
  /** Ids of people the player frees, bails out or lets go. */
  releases: string[];
  /** What the turn wants looked up about the real world, if anything. */
  search_topic: string;
  /** A world law (from the list given) the player's act engages, verbatim. */
  engages_law: string;
  /** The id of the person whose mind the player reads with a power, or "". */
  reads_mind_of: string;
  /** Whether the player disputes what the record says happened earlier. */
  disputes_past: boolean;
  /** Whether the player turns to something private on a screen or a page. */
  private_screen: boolean;
  /** The pitch of the player's turn: tender or sexual, dangerous, hushed. */
  register: { intimate: boolean; dangerous: boolean; hushed: boolean };
  /** Whether the player calls out to the room, or to people beyond it (a broadcast, a shout down the street). */
  open_call: "none" | "room" | "broadcast";
  /** What the player does in public, as the place would see it. */
  public_act: "none" | "boon" | "works" | "harm" | "mass_harm";
  /** After the player has ended things with someone: whether they hold to it or take it back. */
  ending_stance: "" | "holds" | "retracts";
  /** Whether the player's words are reported speech ("I tell her I'm leaving") instead of quoted lines. */
  reported_speech: boolean;
  /** Minutes the player says pass this turn ("an hour later", "I sleep till morning"), 0 when they don't say. */
  declared_minutes: number;
  /** The player's own words closing a subject they're done with. */
  drop_subject: string;
  /** Ids of the people the player gives, makes or mends something for; "someone" or "everyone" for people unnamed. */
  gives_to: string[];
  /** Orders the player gives, and to whom (ids). */
  orders: { to: string[]; what: string }[];
  /** Ids of people the player sends away, turns down or tells to keep their distance. */
  turns_away: string[];
  /** Ids of people the player ends a relationship with (a breakup, a divorce). */
  ends_with: string[];
  /** Harm the player does to people: who (ids, or "someone" for an unnamed person), what, whether it
   *  kills, and whether it falls on a crowd, a street or a whole place. */
  harms: { who: string[]; what: string; kills: boolean; mass: boolean }[];
  /** Ids of people the player threatens with death or harm, or "someone" for people unnamed. */
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
  leaving: { going: false, to: "", place: "", home: false }, drop_subject: "",
  gives_to: [], orders: [], turns_away: [], ends_with: [], harms: [], threatens: [],
  shows_power: "", removes: [], declares: "", says_described_back: false,
  in_world: "", reopens_subject: false, restores: [], already_answered: false, passive: false,
  addresses: [], insults: [], ongoing: false, summons: false, changes_place: [],
  beyond_the_world: "", inner: { charge: 0, direction: 0 },
  attempt: { stakes: "none", physical: false, domains: [], uses: [], target: "" },
  consults: { source: "", question: "" }, verifies: "", says_already_knows: false, denies_exist: [], releases: [],
  search_topic: "", engages_law: "", reads_mind_of: "", disputes_past: false, private_screen: false,
  register: { intimate: false, dangerous: false, hushed: false }, open_call: "none", public_act: "none",
  ending_stance: "", reported_speech: false, declared_minutes: 0,
};

const S = (props: Record<string, object>, required: string[] = []): object => ({ type: "object", properties: props, required, additionalProperties: true });
const A = (items: object): object => ({ type: "array", items });
const str = { type: "string" }, bool = { type: "boolean" }, num = { type: "number" }, strA = A({ type: "string" });

export const ACTION_READ_SCHEMA: object = S({
  said: strA, did: str, thought: str, to_the_game: str, in_world: str,
  story_change: S({ asked: bool, remove: str, true_now: str }),
  leaving: S({ going: bool, to: str, place: str, home: bool }),
  drop_subject: str, reopens_subject: bool, gives_to: strA,
  orders: A(S({ to: strA, what: str })),
  turns_away: strA, ends_with: strA,
  harms: A(S({ who: strA, what: str, kills: bool, mass: bool })),
  threatens: strA, shows_power: str, removes: strA, declares: str, says_described_back: bool,
  restores: A({ type: "string", enum: ["sleep", "eat", "wash", "rest"] }),
  already_answered: bool, passive: bool, addresses: strA, insults: strA, ongoing: bool, summons: bool,
  changes_place: A(S({ place: str, what: str })),
  beyond_the_world: str,
  inner: S({ charge: num, direction: num }),
  attempt: S({ stakes: { type: "string", enum: ["none", "risky", "dangerous"] }, physical: bool, domains: A({ type: "string", enum: DOMAINS }), uses: A({ type: "string", enum: USES }), target: str }),
  consults: S({ source: str, question: str }),
  verifies: str, says_already_knows: bool, denies_exist: strA, releases: strA, search_topic: str, engages_law: str,
  reads_mind_of: str, disputes_past: bool, private_screen: bool,
  register: S({ intimate: bool, dangerous: bool, hushed: bool }),
  open_call: { type: "string", enum: ["none", "room", "broadcast"] },
  public_act: { type: "string", enum: ["none", "boon", "works", "harm", "mass_harm"] },
  ending_stance: { type: "string", enum: ["", "holds", "retracts"] },
  reported_speech: bool, declared_minutes: num,
});

const SYSTEM = `You read one turn of an interactive story, meaning what the player typed for their character, and say what it means as fields the game can act on, without writing any of the story yourself.

The player's character is named below, along with the people in the scene and the others the story knows, each with an id, and the places the story knows, each with an id. Whenever a field asks for people or a place, give ids from those lists. When the player means someone by a pronoun, a title, a description or a misspelling ("her", "the old man", "isolade"), work out who from the list and the end of the last scene, and give that person's id. Someone harmed or given something who isn't on the list goes in as "someone", or "everyone" for a whole crowd or village.

Read it the way a careful person would, because a sentence can say the opposite of the words in it ("I haven't found a reason to make you go away" sends nobody away) and a figure of speech is a way of talking ("I crush her in a hug" harms nobody, and "I kill time" kills nobody). Words inside quotation marks are said aloud unless the player is plainly thinking them, and words between asterisks, or plainly private, are thoughts. Something only threatened or shown is a threat or a show of power, and harm is what the player actually does to someone. A line aimed at the game, the narrator or the AI ("stop narrating", "you're a terrible writer", "change the story so that...") goes in to_the_game, in_world keeps the rest of what they typed exactly as typed, and if it asks for the story itself to change, story_change says what to take out and what's now true. An act that's only there to make a point about the writing ("I kill myself because you're a terrible writer") goes in to_the_game whole, with in_world left empty. Leaving means setting off from where they are now, this turn, and carrying on with a trip already under way counts. Leave every field empty, false or [] when the turn has nothing of that kind, which is most of them on most turns.

Reply with only this JSON:
{"said":["each line the player says aloud, verbatim"],"did":"what anyone in the room could see the player do, in plain words, apart from speech and thought","thought":"what the player only thinks or feels","to_the_game":"anything said to the game, the narrator or the AI, outside the world of the story","in_world":"everything else they typed, verbatim","story_change":{"asked":false,"remove":"what they asked to have taken out of the story, in a few words","true_now":"what they said is true now, as a plain statement"},"leaving":{"going":false,"to":"where they're going, in their words","place":"the id of that place, if it's on the list","home":false},"drop_subject":"the player's own words, if they're closing a subject they're done with","reopens_subject":false,"gives_to":["ids of people the player gives, makes or mends something for, or someone, or everyone"],"orders":[{"to":["ids"],"what":"what they're told to do"}],"turns_away":["ids of people the player sends away, turns down or tells to keep their distance"],"ends_with":["ids of people the player ends a relationship with"],"insults":["ids of people the player insults or curses at"],"addresses":["ids of the people the player speaks to or deals with directly"],"harms":[{"who":["ids, or someone"],"what":"what the player does to them","kills":false,"mass":false}],"threatens":["ids of people the player threatens with death or harm, or someone"],"shows_power":"a weapon or a power drawn, shown or held, and kept from use","removes":["ids of people the player physically puts out of the scene, has arrested or has taken away"],"summons":false,"changes_place":[{"place":"place id","what":"what the player does to the place itself"}],"ongoing":false,"declares":"an outcome the player announces in place of attempting it, like someone dying or something appearing","beyond_the_world":"anything the player does that the world's rules below put out of their reach","restores":["sleep, eat, wash or rest, for whatever the player does of those"],"passive":false,"already_answered":false,"says_already_knows":false,"says_described_back":false,"inner":{"charge":0,"direction":0},"attempt":{"stakes":"none","physical":false,"domains":[],"uses":[],"target":"what or whom it's aimed at"},"consults":{"source":"what they read or ask, a book, a sign, a screen or a person","question":"what they want from it"},"verifies":"what they check a claim against, outside the room","denies_exist":["names the player says are made up"],"releases":["ids of people the player frees, bails out or lets go"],"reads_mind_of":"id of the person whose mind the player reads with a power","disputes_past":false,"private_screen":false,"register":{"intimate":false,"dangerous":false,"hushed":false},"open_call":"none","public_act":"none","ending_stance":"","reported_speech":false,"declared_minutes":0,"engages_law":"a law from the list below that the player's act runs into, copied exactly","search_topic":"what about the real world this turn would need looked up"}

mass is true when the harm falls on a crowd, a street or a whole place. summons is true when the player calls, conjures or brings someone into the scene. ongoing is true when something the player sets loose carries on by itself after this turn, like a spreading fire or a standing curse. passive is true when all the player does is wait, watch or let things carry on. already_answered is true when the player says they've already answered what they're being asked. reopens_subject is true when they bring back up the subject named under A SUBJECT THE PLAYER CLOSED. inner says how much the player's own private feeling carries this turn, from 0 for nothing to 1 for a great deal, and its direction, -1 when it tightens them (anger, fear, shame, grief), 1 when it eases them (relief, love, calm), 0 when it's mixed or unclear. attempt.stakes is risky or dangerous only when what they try could fail and cost them; domains are drawn from firearms, fighting, climbing, stealth, driving, medicine, craft, persuasion and tracking, and uses from hands, legs, eyes, breath and head. register says whether the turn is tender or sexual, dangerous, or hushed. open_call is room when the player calls out to everyone present and broadcast when they reach people beyond the room. public_act is what the place would make of the deed: a boon done for people, works built for them, harm, or harm to a whole crowd. ending_stance, after the player has ended things with someone, says whether they hold to it this turn or take it back. reported_speech is true when the player reports what they say in place of quoting it. declared_minutes is how much time the player says passes.`;

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

/** The places the story knows, with ids, and which one the player is at. */
function placeList(state: SaveState): string {
  const here = state.world?.player_location;
  const home = (state.world as any)?.player_home ?? state.characters?.char_player?.schedule?.home;
  const rows = Object.entries(state.world?.places ?? {})
    .filter(([id, p]) => id !== "loc_offscene" && p?.name && p.name !== "elsewhere")
    .slice(0, 40)
    .map(([id, p]) => `- ${id}: ${p.name}${p.identity ? `, ${clipText(p.identity, 90)}` : ""}${id === here ? " (the player is here)" : ""}${id === home ? " (the player's home)" : ""}`);
  return rows.length ? `PLACES:\n${rows.join("\n")}` : "";
}

/** What this world allows, and the laws it holds people to, for beyond_the_world and engages_law. */
function worldRules(state: SaveState): string {
  const b = (state.world_bible ?? {}) as any;
  const rules = [b.technology_level, b.magic_rules, b.forbidden, b.absent].map((x) => clipText(String(x ?? ""), 300)).filter(Boolean);
  const laws = [...(state.world?.canon ?? []), ...((state.world?.norms ?? []) as any[]).map((n) => n?.rule)].map((x) => clipText(String(x ?? ""), 200)).filter(Boolean).slice(0, 12);
  return [
    rules.length ? `THE WORLD'S RULES${b.god_mode ? " (the player is sovereign here, so nothing is beyond them)" : ""}:\n${rules.map((r) => `- ${r}`).join("\n")}` : "",
    laws.length ? `ITS LAWS AND CUSTOMS:\n${laws.map((l) => `- ${l}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** A trip the player set off on in the last two turns and hasn't finished. */
export function tripUnderWay(state: SaveState): string {
  for (const h of (state.history ?? []).slice(-2).reverse()) {
    const l = h.read?.leaving;
    if (!l?.going || !l.place) continue;
    if (l.place === state.world?.player_location) return "";
    const name = state.world?.places?.[l.place]?.name ?? l.to;
    return `A TRIP UNDER WAY: on turn ${h.turn} the player set off for ${name} (${l.place}) and hasn't arrived yet.`;
  }
  return "";
}

function closedSubject(state: SaveState): string {
  const d = (state.world as any)?.dropped as { turn: number; said: string; topic: string } | undefined;
  if (!d || (state.world?.current_turn ?? 0) - d.turn > 4) return "";
  return `A SUBJECT THE PLAYER CLOSED: on turn ${d.turn} they said "${d.said}", about ${d.topic || "what was being discussed"}.`;
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

/** Ids only, from people the story knows, or "someone" (and "everyone") where allowed. */
function ids(state: SaveState, v: unknown, allowSomeone = false, allowEveryone = false): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const x of list) {
    const id = String(x ?? "").trim();
    if ((allowSomeone && id === "someone") || (allowEveryone && id === "everyone")) { if (!out.includes(id)) out.push(id); continue; }
    if (id && id !== "char_player" && state.characters?.[id] && !out.includes(id)) out.push(id);
  }
  return out;
}
const text = (v: unknown, max = 400) => clipText(String(v ?? ""), max);
/** A place id the story knows, or "". */
function placeId(state: SaveState, v: unknown): string {
  const id = String(v ?? "").trim();
  return id && state.world?.places?.[id] && id !== "loc_offscene" ? id : "";
}

/** The model's answer, held to the shape and to people who exist. */
export function shapeRead(state: SaveState, g: any): ActionRead {
  if (!g || typeof g !== "object") return { ...EMPTY_READ };
  return {
    said: (Array.isArray(g.said) ? g.said : []).map((x: unknown) => text(x, 600)).filter(Boolean).slice(0, 12),
    did: text(g.did, 600),
    thought: text(g.thought, 600),
    to_the_game: text(g.to_the_game, 600),
    story_change: { asked: !!g.story_change?.asked, remove: text(g.story_change?.remove, 120), true_now: text(g.story_change?.true_now, 300) },
    leaving: { going: !!g.leaving?.going, to: text(g.leaving?.to, 120), place: placeId(state, g.leaving?.place), home: !!g.leaving?.home },
    drop_subject: text(g.drop_subject, 200),
    gives_to: ids(state, g.gives_to, true, true),
    orders: (Array.isArray(g.orders) ? g.orders : []).map((o: any) => ({ to: ids(state, o?.to), what: text(o?.what, 200) })).filter((o: { to: string[]; what: string }) => o.what).slice(0, 6),
    turns_away: ids(state, g.turns_away),
    ends_with: ids(state, g.ends_with),
    harms: (Array.isArray(g.harms) ? g.harms : []).map((h: any) => ({ who: ids(state, h?.who, true), what: text(h?.what, 200), kills: !!h?.kills, mass: !!h?.mass })).filter((h: { what: string }) => h.what).slice(0, 6),
    threatens: ids(state, g.threatens, true),
    shows_power: text(g.shows_power, 200),
    removes: ids(state, g.removes),
    declares: text(g.declares, 300),
    says_described_back: !!g.says_described_back,
    in_world: text(g.in_world, 3000),
    reopens_subject: !!g.reopens_subject,
    restores: (Array.isArray(g.restores) ? g.restores : []).filter((x: unknown) => x === "sleep" || x === "eat" || x === "wash" || x === "rest"),
    already_answered: !!g.already_answered,
    passive: !!g.passive,
    addresses: ids(state, g.addresses),
    insults: ids(state, g.insults),
    ongoing: !!g.ongoing,
    summons: !!g.summons,
    changes_place: (Array.isArray(g.changes_place) ? g.changes_place : []).map((c: any) => ({ place: placeId(state, c?.place), what: text(c?.what, 200) })).filter((c: { place: string; what: string }) => c.place && c.what).slice(0, 3),
    beyond_the_world: text(g.beyond_the_world, 300),
    inner: { charge: clamp01(g.inner?.charge), direction: g.inner?.direction > 0 ? 1 : g.inner?.direction < 0 ? -1 : 0 },
    attempt: {
      stakes: g.attempt?.stakes === "risky" || g.attempt?.stakes === "dangerous" ? g.attempt.stakes : "none",
      physical: !!g.attempt?.physical,
      domains: (Array.isArray(g.attempt?.domains) ? g.attempt.domains : []).filter((d: any) => DOMAINS.includes(d)),
      uses: (Array.isArray(g.attempt?.uses) ? g.attempt.uses : []).filter((u: any) => USES.includes(u)),
      target: text(g.attempt?.target, 200),
    },
    consults: { source: text(g.consults?.source, 160), question: text(g.consults?.question, 300) },
    verifies: text(g.verifies, 200),
    says_already_knows: !!g.says_already_knows,
    denies_exist: (Array.isArray(g.denies_exist) ? g.denies_exist : []).map((x: unknown) => text(x, 80)).filter(Boolean).slice(0, 6),
    releases: ids(state, g.releases),
    search_topic: text(g.search_topic, 200),
    engages_law: text(g.engages_law, 400),
    reads_mind_of: ids(state, [g.reads_mind_of])[0] ?? "",
    disputes_past: !!g.disputes_past,
    private_screen: !!g.private_screen,
    register: { intimate: !!g.register?.intimate, dangerous: !!g.register?.dangerous, hushed: !!g.register?.hushed },
    open_call: g.open_call === "room" || g.open_call === "broadcast" ? g.open_call : "none",
    public_act: ["boon", "works", "harm", "mass_harm"].includes(g.public_act) ? g.public_act : "none",
    ending_stance: g.ending_stance === "holds" || g.ending_stance === "retracts" ? g.ending_stance : "",
    reported_speech: !!g.reported_speech,
    declared_minutes: Math.max(0, Math.min(60 * 24 * 365, Math.round(Number(g.declared_minutes) || 0))),
  };
}
const clamp01 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };

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
    placeList(state),
    worldRules(state),
    tripUnderWay(state),
    closedSubject(state),
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
