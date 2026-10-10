/**
 * THE RECORD — ask your own save a question, and get an answer that cites it.
 *
 * Weft keeps an unusual amount of explainable state: who told whom every rumour and when, how a
 * faction came to know something, what each person remembers in their own words, what they wrongly
 * believe about the player, the dated note behind every relationship. None of it could be asked
 * anything. The Chronicle draws charts; the Inspector dumps fields. "Why does Áedán distrust me?" had
 * an answer sitting in the save, spread across four structures, and no way to put the question.
 *
 * This is a small tool-using loop over that state. The model gets read-only tools — search, a
 * person, two people, a rumour's route, a faction, a stretch of turns — and must look things up
 * before it answers. The loop's guardrails are borrowed from a report agent built for the same job
 * over a simulation graph, because each one exists for a failure that agent hit:
 *
 *   · A FLOOR ON LOOKUPS. Below MIN_CALLS the answer is refused and the model is sent back to look.
 *     A model asked about a story will happily answer from the shape of stories.
 *   · A CEILING. At MAX_CALLS it must answer with what it has.
 *   · A NUDGE TOWARD THE TOOLS IT HASN'T USED, after every lookup, so it doesn't run search five times.
 *   · NO INVENTED OBSERVATIONS. A model writing a tool call often writes the result too. Everything
 *     after the call in its reply is cut before it is kept; only the engine writes results.
 *   · SAY SO. If the records don't show it, the answer says the records don't show it.
 *
 * The tools are pure functions of the save and cost nothing; only the loop spends tokens. Nothing
 * here writes to the save.
 */
import type { SaveState, Rumor } from "./types";
import { relevance } from "./memory";
import { clipText } from "./text";
import { membersOf } from "./institution";
import { rumorSubject } from "./hearsay";

export const MIN_CALLS = 2;
export const MAX_CALLS = 6;

const nm = (s: SaveState, id: string | null | undefined) => (id ? (id === "char_player" ? `${s.characters[id]?.name ?? "the player"} (the player)` : s.characters[id]?.name ?? id) : "nobody");

/** Resolve a person the model named: full name, first name, alias, or "the player"/"me". */
export function findPerson(s: SaveState, raw: unknown): string | null {
  const q = String(raw ?? "").trim().toLowerCase().replace(/^the\s+player$|^me$|^you$|^player$/, "char_player");
  if (!q) return null;
  if (q === "char_player" || s.characters[q]) return s.characters[q] ? q : null;
  const cast = Object.entries(s.characters);
  const hit = cast.find(([, c]) => c.name?.toLowerCase() === q)
    ?? cast.find(([, c]) => (c.aliases ?? []).some((a) => a.toLowerCase() === q))
    ?? cast.filter(([, c]) => c.name?.toLowerCase().split(/\s+/)[0] === q.split(/\s+/)[0]).find((_, __, all) => all.length === 1)
    ?? cast.find(([, c]) => c.name?.toLowerCase().includes(q));
  return hit?.[0] ?? null;
}

interface Hit { score: number; text: string }

/** search(query): the best-matching lines anywhere in the record, each labelled with where it is. */
function toolSearch(s: SaveState, query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "search needs a query.";
  const hits: Hit[] = [];
  const push = (text: string, label: string, boost = 0) => {
    const r = relevance(text, q);
    if (r > 0.08) hits.push({ score: r + boost, text: `[${label}] ${clipText(text, 240)}` });
  };
  for (const h of s.history ?? []) {
    if (h.summary) push(h.summary, `turn ${h.turn}, ${h.time_label ?? ""} — what happened`.replace(/, —/, " —"), 0.05);
    if (h.player_action) push(h.player_action, `turn ${h.turn} — what the player did`);
  }
  for (const [id, m] of Object.entries(s.memory ?? {})) {
    for (const e of m.episodic ?? []) push(e.content, `${nm(s, id)}'s memory, turn ${e.turn}${e.where ? `, at ${e.where}` : ""}`);
    for (const b of m.beliefs ?? []) push(b.content, `${nm(s, id)}'s belief, formed turn ${b.formed_turn}`);
    for (const f of m.facts ?? []) push(f.content, `${nm(s, id)} knows${f.superseded_by ? " (no longer believes)" : ""}, turn ${f.turn}`, 0.05);
  }
  for (const r of s.world.rumors ?? []) push(r.content, `rumour started by ${nm(s, r.origin_char)}, turn ${r.born_turn}, ${r.knowers.length} know it`);
  for (const o of s.world.offstage_log ?? []) push(o.what, `elsewhere, turn ${o.turn}${o.place ? `, ${o.place}` : ""}`);
  for (const c of s.world.canon ?? []) push(c, "canon");
  for (const t of s.world.threads ?? []) push(`${t.title}. ${t.description ?? ""}`, `thread (${t.status})`);
  for (const k of s.world.clocks ?? []) push(`${k.faction}: ${k.objective}`, `faction clock ${k.filled}/${k.segments}`);
  hits.sort((a, b) => b.score - a.score);
  return hits.length ? hits.slice(0, 12).map((h) => h.text).join("\n") : `Nothing in the record matches "${q}".`;
}

/** person(name): who they are, where, what they want, their bonds, their read of the player. */
function toolPerson(s: SaveState, name: string): string {
  const id = findPerson(s, name);
  if (!id) return `No one called "${name}" is in the record.`;
  const c = s.characters[id];
  const place = c.location ? s.world.places[c.location]?.name : undefined;
  const lines = [
    `${nm(s, id)}${c.age ? `, ${c.age}` : ""}${c.status && c.status !== "active" ? `, ${c.status}` : ""}${place ? `, at ${place}` : ""}.`,
    c.background ? `Background: ${clipText(c.background, 400)}` : "",
    c.life_history ? `Since the story began: ${clipText(c.life_history, 300)}` : "",
    c.drive?.goal ? `Wants: ${c.drive.goal}` : "",
  ];
  const out = s.world.edges.filter((e) => e.from === id).sort((a, b) => Math.abs(b.warmth) + Math.abs(b.trust) - Math.abs(a.warmth) - Math.abs(a.trust)).slice(0, 6);
  if (out.length) lines.push(`Feels toward: ${out.map((e) => `${nm(s, e.to)} (warmth ${Math.round(e.warmth)}, trust ${Math.round(e.trust)}${e.roles?.length ? `, ${e.roles.join("/")}` : ""}${e.notes ? ` — "${clipText(e.notes, 100)}", turn ${e.notes_turn ?? e.updated_turn}` : ""})`).join("; ")}`);
  for (const b of s.minds?.[id]?.about ?? []) {
    lines.push(`Their read of ${nm(s, b.target)}: expects warmth ${Math.round(b.predicted_warmth)}, confidence ${b.confidence.toFixed(2)}${b.held_false ? `, wrongly convinced they ${b.held_false}` : ""}.`);
  }
  const heard = (s.world.rumors ?? []).filter((r) => !r.dead && r.knowers.includes(id) && r.origin_char !== id);
  if (heard.length) lines.push(`Has heard: ${heard.slice(-4).map((r) => `"${clipText(r.content, 100)}"${r.distorted?.includes(id) ? " (a sharpened version)" : ""}`).join("; ")}`);
  const mem = (s.memory[id]?.episodic ?? []).slice().sort((a, b) => b.importance - a.importance).slice(0, 4);
  if (mem.length) lines.push(`Weightiest memories: ${mem.map((m) => `turn ${m.turn}: "${clipText(m.content, 120)}"`).join("; ")}`);
  return lines.filter(Boolean).join("\n");
}

/** between(a, b): both sides of a relationship, and what each remembers of the other. */
function toolBetween(s: SaveState, a: string, b: string): string {
  const x = findPerson(s, a), y = findPerson(s, b);
  if (!x || !y) return `Couldn't find ${!x ? `"${a}"` : `"${b}"`} in the record.`;
  const side = (f: string, t: string) => {
    const e = s.world.edges.find((z) => z.from === f && z.to === t);
    if (!e) return `${nm(s, f)} → ${nm(s, t)}: no recorded feeling.`;
    return `${nm(s, f)} → ${nm(s, t)}: warmth ${Math.round(e.warmth)}, trust ${Math.round(e.trust)}${e.roles?.length ? `, ${e.roles.join("/")}` : ""}${e.swing ? `, recently moved ${e.swing.warmth > 0 ? "+" : ""}${Math.round(e.swing.warmth)} warmth since turn ${e.swing.since_turn}` : ""}${e.notes ? `. Note (turn ${e.notes_turn ?? e.updated_turn}): "${clipText(e.notes, 160)}"` : ""}`;
  };
  const about = (who: string, other: string) => {
    const on = s.characters[other]?.name?.split(/\s+/)[0] ?? "";
    return (s.memory[who]?.episodic ?? []).filter((m) => on && m.content.includes(on)).slice(-4).map((m) => `turn ${m.turn}: "${clipText(m.content, 120)}"`);
  };
  const ma = about(x, y), mb = about(y, x);
  return [side(x, y), side(y, x),
    ma.length ? `${nm(s, x)} remembers: ${ma.join("; ")}` : "",
    mb.length ? `${nm(s, y)} remembers: ${mb.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

/** trace(topic): how a piece of news travelled — every hop, who told whom, where, and when. */
function toolTrace(s: SaveState, topic: string): string {
  const q = String(topic ?? "");
  const ranked = (s.world.rumors ?? []).map((r) => ({ r, v: relevance(r.content, q) })).filter((x) => x.v > 0.08).sort((a, b) => b.v - a.v);
  const lines: string[] = [];
  const top = ranked.slice(0, 2).map((x) => x.r);
  for (const r of top) lines.push(routeOf(s, r));
  // A faction's chain belongs here when it is about this topic, or when it runs through the people
  // who carry this rumour — which is how a faction usually comes to know anything.
  const carriers = new Set(top.flatMap((r) => r.knowers).map((id) => s.characters[id]?.name?.split(/\s+/)[0]).filter(Boolean) as string[]);
  for (const k of s.world.clocks ?? []) {
    const chain = k.knowledge_chain ?? [];
    if (!chain.length) continue;
    const text = chain.join(" ");
    const throughCarriers = [...carriers].some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
    if (relevance(`${k.faction} ${k.objective} ${text}`, q) > 0.08 || throughCarriers) lines.push(`How ${k.faction} came to know: ${chain.join(" → ")}`);
  }
  return lines.length ? lines.join("\n\n") : `No rumour in the record matches "${q}", so if it happened, nobody has repeated it.`;
}

function routeOf(s: SaveState, r: Rumor): string {
  const subject = rumorSubject(s, r);
  const head = `"${clipText(r.content, 200)}" — ${r.truth === "true" ? "true" : r.truth === "distorted" ? "distorted at the source" : "false"}${subject ? `, about ${nm(s, subject)}` : ""}, salience ${r.salience.toFixed(1)}${r.dead ? ", no longer spreading" : ""}.`;
  const path = (r.path ?? []).map((h) => h.how === "witnessed"
    ? `turn ${h.turn}: ${nm(s, h.to)} saw it${h.where ? ` at ${h.where}` : ""}`
    : `turn ${h.turn}: ${nm(s, h.from)} told ${nm(s, h.to)}${h.where ? ` at ${h.where}` : ""}${r.distorted?.includes(h.to) ? " (and it had grown by then)" : ""}`);
  const untraced = r.knowers.filter((k) => !(r.path ?? []).some((h) => h.to === k));
  return [head, ...(path.length ? path : [`started with ${nm(s, r.origin_char)}, turn ${r.born_turn}`]),
    untraced.length ? `Also knows it, route not recorded: ${untraced.map((k) => nm(s, k)).join(", ")}` : ""].filter(Boolean).join("\n");
}

/** faction(name): what a faction is working toward, how far along, who is in it, what it knows. */
function toolFaction(s: SaveState, name: string): string {
  const q = String(name ?? "");
  const clocks = (s.world.clocks ?? []).filter((k) => relevance(k.faction, q) > 0.1 || k.faction.toLowerCase().includes(q.toLowerCase()));
  if (!clocks.length) return `No faction called "${q}" has a clock in the record; the factions are: ${[...new Set((s.world.clocks ?? []).map((k) => k.faction))].join(", ") || "none"}.`;
  return clocks.map((k) => {
    const members = membersOf(s, k.faction).map((m) => nm(s, m));
    return [`${k.faction}: ${k.objective} — ${k.filled}/${k.segments}, ${k.status ?? "running"}.`,
      k.consequence ? `When it fills: ${k.consequence}` : "",
      k.public_line ? `What it says publicly: ${k.public_line}` : "",
      members.length ? `Members: ${members.join(", ")}` : "No members in the cast.",
      k.knowledge_chain?.length ? `How it came to know: ${k.knowledge_chain.join(" → ")}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

/** turns(from, to): what happened, turn by turn, in a range (at most 12). */
function toolTurns(s: SaveState, from: unknown, to: unknown): string {
  const last = s.world.current_turn;
  let a = Math.max(0, Math.round(Number(from) || 0)), b = Math.round(Number(to) || a);
  if (!Number(from) && !Number(to)) { b = last; a = Math.max(0, last - 8); }
  if (b < a) [a, b] = [b, a];
  if (b - a > 11) a = b - 11;
  const rows = (s.history ?? []).filter((h) => h.turn >= a && h.turn <= b);
  return rows.length ? rows.map((h) => `turn ${h.turn} (${h.time_label ?? ""}): ${clipText(h.summary || h.player_action, 220)}`).join("\n") : `No turns are recorded between ${a} and ${b}, and the story is at turn ${last}.`;
}

export const TOOLS: Record<string, { args: string; does: string; run: (s: SaveState, a: Record<string, unknown>) => string }> = {
  search: { args: `{"query": "words to look for"}`, does: "the best-matching lines anywhere in the record: what happened each turn, every memory, belief and known fact, rumours, offstage events, canon, threads, faction goals", run: (s, a) => toolSearch(s, String(a.query ?? "")) },
  person: { args: `{"name": "a name, or 'the player'"}`, does: "one person: where they are, what they want, how they feel about the people that matter to them and why, their read of the player, what they've heard, their weightiest memories", run: (s, a) => toolPerson(s, String(a.name ?? "")) },
  between: { args: `{"a": "a name", "b": "another name"}`, does: "both sides of one relationship, the dated note behind each side, and what each remembers of the other", run: (s, a) => toolBetween(s, String(a.a ?? ""), String(a.b ?? "")) },
  trace: { args: `{"topic": "what the news was about"}`, does: "how a piece of news travelled: who saw it, who told whom, where and on which turn, whose version had grown, and how any faction came to know", run: (s, a) => toolTrace(s, String(a.topic ?? "")) },
  faction: { args: `{"name": "a faction"}`, does: "a faction's goal, progress, members, public position and how it came to know what it knows", run: (s, a) => toolFaction(s, String(a.name ?? "")) },
  turns: { args: `{"from": 1, "to": 12}`, does: "what happened turn by turn in a range of up to 12 turns; with no numbers, the last eight", run: (s, a) => toolTurns(s, a.from, a.to) },
};

export function toolsDescription(): string {
  return Object.entries(TOOLS).map(([k, t]) => `${k} ${t.args}: ${t.does}.`).join("\n");
}

/** The first tool call in a reply, if any. Accepts the tag form and a bare JSON object. */
export function parseToolCall(reply: string): { name: string; args: Record<string, unknown> } | null {
  const tagged = reply.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  const body = tagged?.[1] ?? reply.match(/\{\s*"name"\s*:\s*"(?:search|person|between|trace|faction|turns)"[\s\S]*?\}\s*\}/)?.[0];
  if (!body) return null;
  try {
    const j = JSON.parse(body.replace(/^```(?:json)?|```$/g, "").trim());
    const name = String(j.name ?? j.tool ?? "");
    if (!TOOLS[name]) return null;
    const args = (j.args ?? j.parameters ?? j.arguments ?? {}) as Record<string, unknown>;
    return { name, args: typeof args === "object" && args ? args : {} };
  } catch { return null; }
}

/** Keep the reasoning and the call, drop anything after it — a model that writes a call often
 *  writes the "result" too, and the only results that count are the engine's. */
export function stripInvented(reply: string): string {
  const end = reply.search(/<\/tool_call>/i);
  if (end >= 0) return reply.slice(0, end + "</tool_call>".length);
  const cut = reply.search(/<tool_result>|^\s*Observation\s*:|^\s*\[?tool result/im);
  return cut >= 0 ? reply.slice(0, cut).trimEnd() : reply;
}

export function finalAnswer(reply: string): string | null {
  const m = reply.match(/Final Answer\s*:\s*([\s\S]+)$/i);
  return m ? m[1].trim() : null;
}

export interface AnalystStep { tool: string; args: Record<string, unknown>; result: string }
type Msg = { role: "system" | "user" | "assistant"; content: string };

/**
 * Run the loop. `call` is the model: messages in, reply text out. `system` is the instruction block
 * (ANALYST_SYSTEM in prompts.ts, with the tool list appended by the caller or here).
 */
export async function runAnalyst(
  s: SaveState, question: string, system: string,
  call: (msgs: Msg[]) => Promise<string>,
  onStep?: (step: AnalystStep) => void,
): Promise<{ answer: string; steps: AnalystStep[] }> {
  const steps: AnalystStep[] = [];
  const used = new Set<string>();
  const unusedHint = () => {
    const left = Object.keys(TOOLS).filter((k) => !used.has(k));
    return left.length ? ` Not used yet: ${left.join(", ")}.` : "";
  };
  const msgs: Msg[] = [
    { role: "system", content: `${system}\n\nTOOLS\n${toolsDescription()}` },
    { role: "user", content: `The story is at turn ${s.world.current_turn} (${s.world.current_time}), and the player is ${s.characters.char_player?.name ?? "the player"}.\n\nQUESTION: ${question}` },
  ];
  for (let round = 0; round < MAX_CALLS + 3; round++) {
    const raw = await call(msgs);
    const reply = stripInvented(raw);
    const tool = parseToolCall(reply);
    const final = tool ? null : finalAnswer(reply);
    if (tool && steps.length < MAX_CALLS) {
      let result: string;
      try { result = TOOLS[tool.name].run(s, tool.args); } catch (e: any) { result = `That lookup failed: ${e?.message ?? e}`; }
      const step = { tool: tool.name, args: tool.args, result };
      steps.push(step); used.add(tool.name); onStep?.(step);
      msgs.push({ role: "assistant", content: reply });
      msgs.push({ role: "user", content: `RESULT of ${tool.name}:\n${result}\n\n(${steps.length} of ${MAX_CALLS} lookups used.${unusedHint()} Look something else up, or answer with "Final Answer:".)` });
      continue;
    }
    if (final && steps.length >= MIN_CALLS) return { answer: final, steps };
    msgs.push({ role: "assistant", content: reply });
    if (steps.length >= MAX_CALLS) {
      msgs.push({ role: "user", content: `That is all ${MAX_CALLS} lookups. Answer now from what they showed, starting with "Final Answer:".` });
    } else if (final) {
      msgs.push({ role: "user", content: `You've made ${steps.length} lookup${steps.length === 1 ? "" : "s"}; at least ${MIN_CALLS} come before an answer, so look something up first.${unusedHint()}` });
    } else {
      msgs.push({ role: "user", content: `Reply with one tool call in <tool_call>…</tool_call>, or with "Final Answer:" and the answer.${unusedHint()}` });
    }
  }
  // The model never produced a usable answer. Say what was found rather than nothing.
  return { answer: steps.length ? `No answer came back, so here is what the lookups found:\n\n${steps.map((x) => `${x.tool}: ${clipText(x.result, 400)}`).join("\n\n")}` : "No answer came back from the model, and no lookups ran.", steps };
}
