/**
 * NUKE A STORYLINE — the player's way to end a plot the story won't let go of.
 *
 * Rainier Valley. "Beacon Works" started as one project in a utility office and by turn 56 it was in
 * about a hundred and fifty places in the save: a tracked place, a coworker's whole want, another
 * coworker's schedule, background, voice lines and current goal, two threads, a consequence, three
 * rumours, the offstage log, a dozen memories, the player's own stated facts, and the recent-story
 * text every model reads. The player walked out of it, emailed everyone that it wasn't their project,
 * deleted the files, reported the coworker who kept bringing it to them, and it came back every turn,
 * because every one of those places put it in front of the narrator again. The strike tool can veto
 * one invention; nothing could take out a storyline. In the player's words: I need a nuke from orbit.
 *
 * So this takes a few words — "Beacon Works", "Beacon" — and removes them from everything the
 * models read:
 *
 *  - a place by that name is deleted, and anyone standing in it is moved home or offstage;
 *  - a person by that name is deleted, and so is anyone the player picks;
 *  - everyone else keeps who they are and loses only their part in it: a want about it is dropped
 *    (the engine gives them a new one), a goal, a schedule block, a voice line or a sentence of
 *    background about it is cut;
 *  - memories, beliefs, facts, canon, threads, clocks, consequences, rumours, promises, the offstage
 *    log, the player's tracked questions and the engine's own notes that mention it are dropped;
 *  - in past turns, the sentences that mention it are cut, from the story text and the summaries,
 *    so the recent-story context stops carrying it;
 *  - it is recorded as a veto, so the bookkeeper ignores it if it turns up again, and the turn loop
 *    cuts any sentence that brings it back unless the player brought it back themselves.
 *
 * Zero tokens. `planNuke` runs the same thing on a copy, so the player sees exactly what goes before
 * anything does, and the api keeps the pre-nuke state as the recovery row, so it can be undone.
 */
import type { SaveState } from "./types";
import { splitSentencesOutsideQuotes } from "./text";
import { OFFSCENE } from "./places";
import { playerHome } from "./leaving";

export interface NukeOptions {
  /** Character ids to delete outright, beyond anyone named by a term. */
  removePeople?: string[];
}

export interface NukeReport {
  terms: string[];
  places: string[];
  removed: string[];
  trimmed: { id: string; name: string; central: boolean }[];
  /** How many items went, by what the player would call them. */
  counts: Record<string, number>;
  /** Past turns that lost at least one sentence. */
  turns: number[];
  /** A few of the lines that went, so the player can see it caught the right thing. */
  samples: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words to nuke, cleaned: trimmed, three letters or more, no duplicates. */
export function nukeTerms(raw: string | string[]): string[] {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\n]/)).map((t) => String(t).trim()).filter((t) => t.length >= 3);
  return [...new Map(list.map((t) => [t.toLowerCase(), t])).values()];
}

export function termRegex(terms: string[]): RegExp | null {
  if (!terms.length) return null;
  const alts = [...terms].sort((a, b) => b.length - a.length).map((t) => esc(t).replace(/\s+/g, "\\s+"));
  return new RegExp(`(?<![\\w-])(?:${alts.join("|")})(?:'?s)?(?![\\w-])`, "i");
}

/** Cut the sentences that mention it. Paragraphs left empty go; a paragraph left with a stranded
 *  quote mark goes too, because half a line of dialogue is worse than none. */
export function cutSentences(text: string, re: RegExp): string {
  if (!text || !re.test(text)) return text;
  return text.split(/\n\n+/).map((para) => {
    if (!re.test(para)) return para;
    const kept = splitSentencesOutsideQuotes(para).filter((s) => !re.test(s)).join("").trim();
    return (kept.match(/["“”]/g) ?? []).length % 2 === 1 ? "" : kept;
  }).filter((p) => p.trim()).join("\n\n");
}

type Hit = (s: string) => boolean;

function mentions(v: unknown, hit: Hit): boolean {
  if (typeof v === "string") return hit(v);
  if (Array.isArray(v)) return v.some((x) => mentions(x, hit));
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => hit(k) || mentions(x, hit));
  return false;
}

/** The fields that say what an item IS: a memory's content, a thread's title, a rumour's text. */
const PRIMARY = ["content", "text", "title", "fact", "what", "description", "goal", "claim", "question", "summary", "objective", "label", "line", "word", "ref", "trait", "belief"];

/** Whether a list item goes whole: a string that mentions it, an item whose primary text does, or
 *  an item with no primary text that mentions it anywhere (an engine note, a telemetry row), or an
 *  item with a field that IS a deleted place or person, by id or by name. */
function dropItem(x: unknown, hit: Hit, ref: Hit): boolean {
  if (typeof x === "string") return hit(x);
  if (!x || typeof x !== "object" || Array.isArray(x)) return mentions(x, hit);
  const o = x as Record<string, unknown>;
  // Something that happened AT the deleted place, or is filed under a deleted person: its `where`,
  // `place` or `who` is that thing and nothing else.
  if (Object.values(o).some((v) => typeof v === "string" && ref(v))) return true;
  const prim = PRIMARY.filter((k) => typeof o[k] === "string");
  return prim.length ? prim.some((k) => hit(o[k] as string)) : mentions(o, hit);
}

/** Character fields that are who somebody IS rather than what they're doing: never cut. */
const IDENTITY = new Set(["character_id", "id", "name", "pronouns", "portrait_url", "portrait_plan", "appearance_facts", "appearance_now", "visual_signature", "height_cm", "weight_kg", "age"]);
/** Character fields that go whole when they mention it, because half a want is not a want. */
const WHOLE = new Set(["drive", "authored", "current_goal", "current_activity", "drive_refreshed_time"]);
/** Top-level fields that are not story. */
const NOT_STORY = new Set(["_weft", "id", "name", "created_at", "updated_at", "model_settings", "snapshots", "retcons", "history", "characters", "memory", "minds", "world", "world_bible"]);

/**
 * Wipe the storyline out of `state`, in place. Returns what went. With no usable terms it does
 * nothing and says so in an empty report.
 */
export function nukeStoryline(state: SaveState, rawTerms: string | string[], opts: NukeOptions = {}): NukeReport {
  const terms = nukeTerms(rawTerms);
  const report: NukeReport = { terms, places: [], removed: [], trimmed: [], counts: {}, turns: [], samples: [] };
  const baseRe = termRegex(terms);
  if (!baseRe) return report;
  const bump = (k: string, n = 1) => { if (n > 0) report.counts[k] = (report.counts[k] ?? 0) + n; };
  const sample = (s: unknown) => { const t = typeof s === "string" ? s : JSON.stringify(s); if (report.samples.length < 8 && t) report.samples.push(t.slice(0, 160)); };

  // ── WHO GOES ENTIRELY: anyone named by a term, and anyone the player picked. Their names join the
  //    terms, so the memories and rumours about them go with them.
  const goneIds = new Set<string>(opts.removePeople ?? []);
  for (const [id, c] of Object.entries(state.characters ?? {})) {
    if (id !== "char_player" && c?.name && baseRe.test(c.name)) goneIds.add(id);
  }
  goneIds.delete("char_player");
  const goneNames = [...goneIds].map((id) => state.characters?.[id]?.name).filter((n): n is string => !!n);
  const re = termRegex([...terms, ...goneNames])!;

  // ── WHERE GOES: places named by a term. Their ids count as mentions from here on, because a
  //    schedule block or an offstage note refers to a place by id, not by name.
  const goneIdsPlaces = new Set<string>();
  for (const [id, p] of Object.entries(state.world?.places ?? {})) {
    if (id !== OFFSCENE && p?.name && re.test(p.name)) { goneIdsPlaces.add(id); report.places.push(p.name); }
  }
  const hit: Hit = (s) => re.test(s) || goneIdsPlaces.has(s) || goneIds.has(s);
  const goneLabels = new Set([...report.places, ...goneNames].map((n) => n.trim().toLowerCase()));
  const ref: Hit = (s) => goneIdsPlaces.has(s) || goneIds.has(s) || goneLabels.has(s.trim().toLowerCase());

  // Somewhere to put people who were standing in a place that no longer exists.
  const home = playerHome(state);
  const fallback = home.id && !goneIdsPlaces.has(home.id) ? home.id : OFFSCENE;
  const placeFor = (cid: string): string => {
    const h = state.characters?.[cid]?.schedule?.home;
    const byName = h ? Object.entries(state.world.places).find(([id, p]) => (id === h || p.name === h) && !goneIdsPlaces.has(id))?.[0] : undefined;
    return cid === "char_player" ? fallback : byName ?? OFFSCENE;
  };
  for (const [cid, c] of Object.entries(state.characters ?? {})) {
    if (c?.location && goneIdsPlaces.has(c.location)) c.location = placeFor(cid);
  }
  if (goneIdsPlaces.has(state.world.player_location)) state.world.player_location = fallback;
  for (const id of goneIdsPlaces) delete state.world.places[id];
  bump("places", goneIdsPlaces.size);
  state.travel_log = (state.travel_log ?? []).filter((t) => !goneIdsPlaces.has(t.place));

  // ── THE PEOPLE WHO GO.
  for (const id of goneIds) {
    const c = state.characters[id];
    if (!c) continue;
    report.removed.push(c.name);
    delete state.characters[id]; delete state.condition?.[id]; delete state.memory?.[id]; delete state.minds?.[id];
    delete (state.traits as Record<string, unknown> | undefined)?.[id];
  }
  state.world.present = (state.world.present ?? []).filter((p) => !goneIds.has(p));
  state.world.edges = (state.world.edges ?? []).filter((e) => !goneIds.has(e.from) && !goneIds.has(e.to));
  for (const p of Object.values(state.world.places)) if (Array.isArray(p.contains)) p.contains = p.contains.filter((x) => !goneIds.has(x));

  // ── THE GENERIC PASS: arrays lose the items that mention it, strings lose the sentences that do,
  //    objects are walked, and a keyed record loses the keys that name it.
  const scrub = (v: any, area: string, depth = 0): any => {
    if (typeof v === "string") {
      if (goneIdsPlaces.has(v) || goneIds.has(v)) { bump(area); return undefined; }
      const out = cutSentences(v, re);
      if (out !== v) { bump(area); sample(splitSentencesOutsideQuotes(v).find((x) => re.test(x))?.trim() ?? v); }
      return out;
    }
    if (Array.isArray(v)) {
      // An item goes when what it SAYS is about it. A memory whose headline is about something else
      // and whose long form mentions it in passing stays, and only loses that passing sentence.
      const kept = v.filter((x) => {
        if (!dropItem(x, hit, ref)) return true;
        bump(area); sample(typeof x === "string" ? x : PRIMARY.map((k) => x?.[k]).find((t) => typeof t === "string" && t) ?? x);
        return false;
      });
      return kept.map((x) => (x && typeof x === "object" && mentions(x, hit) ? scrub(x, area, depth + 1) : x));
    }
    if (v && typeof v === "object" && depth < 8) {
      for (const k of Object.keys(v)) {
        if (hit(k)) { delete v[k]; bump(area); continue; }
        const r = scrub(v[k], area, depth + 1);
        if (r === undefined) delete v[k]; else v[k] = r;
      }
    }
    return v;
  };

  // Characters: identity stays, a want about it goes whole (and the engine forges a new one), the rest
  // is scrubbed field by field.
  for (const [id, c] of Object.entries(state.characters ?? {}) as [string, any][]) {
    if (!mentions(Object.fromEntries(Object.entries(c).filter(([k]) => !IDENTITY.has(k))), hit)) continue;
    if (id !== "char_player") report.trimmed.push({ id, name: c.name, central: !!c.central });
    for (const k of Object.keys(c)) {
      if (IDENTITY.has(k)) continue;
      if (WHOLE.has(k)) {
        if (mentions(c[k], hit)) {
          sample(typeof c[k] === "string" ? c[k] : c[k]?.goal ?? c[k]);
          delete c[k]; bump(id === "char_player" ? "your own notes" : "wants and goals");
          if (k === "drive") {
            delete c.drive_refreshed_time;
            const queue = (c.drive_queue ?? []).filter((d: any) => !mentions(d, hit));
            if (queue.length) c.drive = queue.shift();
            c.drive_queue = queue;
          }
        }
        continue;
      }
      const r = scrub(c[k], id === "char_player" ? "your own notes" : "character details");
      if (r === undefined) delete c[k]; else c[k] = r;
    }
  }

  // Memory and minds: whole entries go.
  for (const mem of Object.values(state.memory ?? {})) scrub(mem, "memories");
  for (const mind of Object.values(state.minds ?? {})) scrub(mind, "beliefs");

  // The world: edges are relationships, so they keep existing and only lose the notes about it.
  const edges = state.world.edges ?? [];
  for (const e of edges) for (const k of Object.keys(e)) {
    if (k === "from" || k === "to") continue;
    const r = scrub((e as any)[k], "relationship notes");
    if (r === undefined) delete (e as any)[k]; else (e as any)[k] = r;
  }
  const WORLD_LABEL: Record<string, string> = {
    canon: "established facts", threads: "threads", clocks: "faction clocks", consequences: "consequences",
    rumors: "rumours", promises: "promises", offstage_log: "offstage events", tracked: "tracked questions",
  };
  for (const k of Object.keys(state.world)) {
    if (["places", "present", "edges", "player_location", "current_time", "current_turn", "weather", "nuked"].includes(k)) continue;
    const r = scrub((state.world as any)[k], WORLD_LABEL[k] ?? "the engine's notes");
    if (r === undefined) delete (state.world as any)[k]; else (state.world as any)[k] = r;
  }
  for (const p of Object.values(state.world.places)) {
    for (const k of Object.keys(p)) {
      if (k === "id" || k === "name" || k === "contains") continue;
      const r = scrub((p as any)[k], "place descriptions");
      if (r === undefined) delete (p as any)[k]; else (p as any)[k] = r;
    }
  }
  const bible = state.world_bible as any;
  for (const k of Object.keys(bible ?? {})) {
    if (k === "name") continue;
    const r = scrub(bible[k], "world bible");
    if (r === undefined) delete bible[k]; else bible[k] = r;
  }

  // Past turns: never dropped, only cut. An emptied line keeps a placeholder, because a turn with no
  // text at all replays as an empty message, which some providers refuse.
  for (const h of (state.history ?? []) as any[]) {
    if (!mentions(h, hit)) continue;
    report.turns.push(h.turn);
    for (const k of Object.keys(h)) {
      if (k === "turn" || k === "time_label" || k === "kind" || k === "illustration_url") continue;
      const before = h[k];
      const r = scrub(before, "past turns");
      if (r === undefined) { delete h[k]; continue; }
      h[k] = typeof before === "string" && before.trim() && !String(r).trim() ? "…" : r;
    }
  }

  // Everything else at the top level is the engine's own bookkeeping. A `last_*` correction that
  // mentions it is cleared outright rather than cut, since half of one quotes nothing.
  // The chatlog anchor is a cached copy of the whole digest: dropped, so the next turn rebuilds it
  // from the cleaned state. Chapters are the story's own record, so they're cut like past turns.
  if (mentions(state.context_anchor, hit)) { delete state.context_anchor; bump("the engine's notes"); }
  for (const ch of (state.chapters ?? []) as any[]) {
    for (const k of Object.keys(ch)) {
      if (typeof ch[k] !== "string" || k === "title") continue;
      const r = scrub(ch[k], "chapter summaries");
      ch[k] = String(r ?? "").trim() ? r : "…";
    }
  }
  for (const k of Object.keys(state)) {
    if (NOT_STORY.has(k) || k === "chapters" || k === "imported_from") continue;
    const v = (state as any)[k];
    if (k.startsWith("last_") && mentions(v, hit)) { (state as any)[k] = null; continue; }
    const r = scrub(v, "the engine's notes");
    if (r === undefined) delete (state as any)[k]; else (state as any)[k] = r;
  }

  // The standing veto, and the record the turn loop reads to keep it out.
  const label = terms.join(" / ");
  state.retcons = [...(state.retcons ?? []), {
    text: `Everything to do with ${label}: the place, the work, and every plan, task, argument and person's interest in it. None of it exists in this story.`,
    turn: state.world.current_turn, kind: "veto" as const,
  }].slice(-12);
  (state.world.nuked ??= []).push({ terms, turn: state.world.current_turn });
  return report;
}

/** What a nuke would do, without doing it. Runs on a copy (snapshots left out — they're cleaned
 *  separately and aren't story). */
export function planNuke(state: SaveState, rawTerms: string | string[], opts: NukeOptions = {}): NukeReport {
  const { snapshots: _s, ...rest } = state;
  const copy = structuredClone(rest) as SaveState;
  copy.snapshots = [];
  return nukeStoryline(copy, rawTerms, opts);
}

/** The people a nuke would touch, for the picker: who mentions it, and whether they're central. */
export function nukeCandidates(state: SaveState, rawTerms: string | string[]): { id: string; name: string; central: boolean; named: boolean }[] {
  const re = termRegex(nukeTerms(rawTerms));
  if (!re) return [];
  return Object.entries(state.characters ?? {})
    .filter(([id, c]) => id !== "char_player" && !!c)
    .filter(([, c]) => mentions(Object.fromEntries(Object.entries(c).filter(([k]) => !IDENTITY.has(k))), (s) => re.test(s)) || re.test(c.name ?? "")
      || Object.values(state.world.places).some((p) => re.test(p.name ?? "") && p.id === c.location))
    .map(([id, c]) => ({ id, name: c.name, central: !!c.central, named: re.test(c.name ?? "") }));
}

/**
 * THE GUARD THAT KEEPS IT OUT. After a nuke, a sentence of new narration that mentions it is cut
 * before the bookkeeper reads it, unless the player's own action brought it up, in which case the
 * player wants it back and it is theirs to have.
 */
export function guardNuked(state: SaveState, prose: string, action: string): { prose: string; cut: number } {
  const terms = (state.world.nuked ?? []).flatMap((n) => n.terms);
  const re = termRegex(terms);
  if (!re || !re.test(prose) || re.test(action)) return { prose, cut: 0 };
  const before = prose.split(/\n\n+/).reduce((n, p) => n + splitSentencesOutsideQuotes(p).length, 0);
  const out = cutSentences(prose, re);
  if (!out.trim()) return { prose, cut: 0 };
  const after = out.split(/\n\n+/).reduce((n, p) => n + splitSentencesOutsideQuotes(p).length, 0);
  return { prose: out, cut: Math.max(1, before - after) };
}

const COMMON = new Set("about after again against because before being between could doesn't every first going might never other right should still their there these thing think those through under until where which while would years always around asked looks looked looking really something someone nothing anything everything without voice phone again hands table started little before office your yours with from that this have been what when into onto over just then them they here were will back down said says she's he's it's".split(" "));

/**
 * Words that keep company with the storyline, offered for the player to add: "capacity", "feeder",
 * "switchgear". Read off the sentences that mention the terms, kept when most of their uses in the
 * save are in those sentences, so a word that's everywhere ("office") isn't suggested.
 */
export function nukeSuggestions(state: SaveState, rawTerms: string | string[], limit = 8): string[] {
  const terms = nukeTerms(rawTerms);
  const re = termRegex(terms);
  if (!re) return [];
  const texts: string[] = [];
  for (const h of state.history ?? []) texts.push(h.narrator_prose ?? "", h.summary ?? "");
  for (const m of Object.values(state.memory ?? {})) for (const k of ["episodic", "facts", "core"] as const) {
    for (const e of ((m as any)?.[k] ?? []) as any[]) texts.push(typeof e === "string" ? e : e?.content ?? "");
  }
  for (const c of Object.values(state.characters ?? {}) as any[]) texts.push(c?.background ?? "", c?.life_history ?? "", c?.current_goal ?? "", c?.drive?.goal ?? "");
  const known = new Set<string>([
    ...terms.flatMap((t) => t.toLowerCase().split(/\s+/)),
    ...Object.values(state.characters ?? {}).flatMap((c: any) => String(c?.name ?? "").toLowerCase().split(/\s+/)),
    ...Object.values(state.world?.places ?? {}).flatMap((p: any) => String(p?.name ?? "").toLowerCase().split(/\s+/)),
  ]);
  const inside = new Map<string, number>(), all = new Map<string, number>();
  for (const t of texts) for (const sent of splitSentencesOutsideQuotes(t)) {
    // Single words, and two-word phrases ("load number", "capacity model"), which name a thing more
    // precisely than either word does.
    const toks = sent.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [];
    const keep = (w: string) => w.length >= 4 && !known.has(w) && !COMMON.has(w);
    const grams = new Set<string>();
    toks.forEach((w, i) => {
      if (keep(w) && w.length >= 5) grams.add(w);
      if (i + 1 < toks.length && keep(w) && keep(toks[i + 1])) grams.add(`${w} ${toks[i + 1]}`);
    });
    const near = re.test(sent);
    for (const w of grams) { all.set(w, (all.get(w) ?? 0) + 1); if (near) inside.set(w, (inside.get(w) ?? 0) + 1); }
  }
  // A phrase needs two sightings near the storyline; a single word, being vaguer, needs four, and
  // three quarters of its uses there.
  const picked = [...inside.entries()].filter(([w, n]) => w.includes(" ")
    ? n >= 2 && n / (all.get(w) ?? n) >= 0.6
    : n >= 4 && n / (all.get(w) ?? n) >= 0.75);
  // A word that mostly turns up inside one of the phrases ("number" in "load number") is the phrase.
  const phrases = picked.filter(([w]) => w.includes(" "));
  return picked
    .filter(([w, n]) => w.includes(" ") || !phrases.some(([p, m]) => p.split(" ").includes(w) && m >= n * 0.5))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}
