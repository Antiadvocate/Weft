import React from "react";
import { motion } from "motion/react";
import type { ClientSave } from "../lib/api";
import { RelationshipWeb } from "./RelationshipWeb";
import StoryMap from "../lib/StoryMap";
import { nice } from "../lib/format";
import { api } from "../lib/api";

export default function World({ save, onSave }: { save: ClientSave; onSave?: (s: ClientSave) => void }) {
  const w = save.world;
  const liveRumors = w.rumors.filter((r) => !r.dead);
  const activeThreads = w.threads.filter((t) => t.status === "active");
  const name = (id: string) => save.characters[id]?.name ?? id;

  // Emotional weather: the REAL signal now — each present/tracked character's openness
  // (relaxation) and state, the thing that actually drives the engine. No Kuramoto, no λ̂.
  const cond = (save as any).condition as Record<string, { psyche?: { relaxation: number; state: string; mood?: string; active_states?: string[] } }> | undefined;
  const weather = Object.entries(cond ?? {})
    .filter(([id]) => id !== "char_player" && save.characters[id] && (save.characters[id] as any).status !== "dead")
    .map(([id, c]) => ({ id, name: name(id), r: c.psyche?.relaxation ?? 0, state: c.psyche?.state ?? "intact", mood: c.psyche?.mood ?? "", states: c.psyche?.active_states ?? [] }))
    .filter((c) => save.world.present.includes(c.id) || (save.characters[c.id] as any).tracked)
    .sort((a, b) => a.r - b.r);
  const openColor = (r: number) => r <= -7 ? "var(--danger)" : r <= -3 ? "var(--accent)" : r >= 4 ? "var(--calm)" : "var(--text-mid)";
  const openWord = (r: number, st: string) => st === "broken" || st === "shattered" ? "broken" : st === "fracturing" ? "fracturing" : r <= -7 ? "clenched tight" : r <= -3 ? "guarded" : r >= 4 ? "open" : "level";

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      {weather.length > 0 && (
        <Block title="Emotional weather" delay={0}>
          <div className="space-y-2 py-1">
            {weather.map((c) => (
              <div key={c.id}>
                <div className="flex justify-between items-baseline">
                  <span className="text-[13px]">{c.name}</span>
                  <span className="font-mono text-[10px]" style={{ color: openColor(c.r) }}>
                    {openWord(c.r, c.state)}{c.mood ? ` · ${c.mood}` : ""}
                  </span>
                </div>
                {/* openness meter: -10 clenched (left) to +10 open (right), midpoint marked */}
                <div className="relative meter mt-1.5" style={{ overflow: "visible" }}>
                  <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "var(--ink-3)" }} />
                  <div style={{
                    position: "absolute", height: "100%", borderRadius: 3,
                    background: openColor(c.r),
                    left: c.r >= 0 ? "50%" : `${50 + c.r * 5}%`,
                    width: `${Math.abs(c.r) * 5}%`,
                  }} />
                </div>
                {c.states.length > 0 && (
                  <div className="text-[10.5px] mt-1" style={{ color: "var(--text-lo)" }}>{c.states.join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
          <div className="text-[10.5px] italic pt-2" style={{ color: "var(--text-lo)" }}>
            Openness bends perception: the clenched misread warmth as threat; the open see clearly. Each line is filtered through this.
          </div>
        </Block>
      )}
      <Block title="The web" delay={0.03}>
        <RelationshipWeb save={save} />
      </Block>

      <Block title="The map" delay={0.035}>
        <StoryMap save={save} />
        <div className="text-[10.5px] italic pt-1" style={{ color: "var(--text-lo)" }}>
          The world as you've walked it — every place you've stood, every path between.
        </div>
      </Block>

      <Block title="Threads" delay={0.04}>
        {activeThreads.length === 0 && <Empty>No active threads yet.</Empty>}
        {activeThreads.map((t) => (
          <div key={t.id} className="py-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="font-display text-[14px]">{t.title}</div>
              <span className="font-mono text-[9.5px] shrink-0" style={{ color: t.tension >= 7 ? "var(--danger)" : "var(--text-lo)" }}>
                tension {t.tension}/10
              </span>
              {/* The narrator reads every active thread on every turn as a live question the story
                  is carrying. Editing the world bible cannot reach one, so a storyline the player
                  has decided they are finished with had no way out except the raw JSON editor. */}
              <button
                className="font-mono text-[9.5px] shrink-0 opacity-60 hover:opacity-100"
                style={{ color: "var(--text-lo)" }}
                title="Close this thread — the narrator stops carrying it"
                onClick={async () => {
                  if (!confirm(`Retire "${t.title}"?\n\nThe narrator stops carrying this storyline. It stays in the record as resolved.`)) return;
                  const s = await api.retireThread(save.id, t.id);
                  onSave?.(s);
                }}
              >retire</button>
            </div>
            <div className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>{t.description}</div>
            <div className="meter mt-2"><div style={{ width: `${t.tension * 10}%`, background: t.tension >= 7 ? "var(--danger)" : "var(--accent)" }} /></div>
          </div>
        ))}
      </Block>

      <Block title="Clocks" delay={0.05}>
        {w.clocks.length === 0 && <Empty>No factions on the move.</Empty>}
        {w.clocks.map((c) => (
          <div key={c.id} className="py-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="font-display text-[14px]">{c.faction}</div>
              <span className="chip" style={c.status === "fired" ? { color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" } : undefined}>
                {c.status === "fired" ? "fired" : `${c.filled}/${c.segments}`}
              </span>
            </div>
            <div className="text-[12.5px] mt-0.5" style={{ color: "var(--text-mid)" }}>{c.objective}</div>
            {/* HOW THEY KNOW — the route, hop by hop. A clock with no chain has learned nothing
                and is not advancing, which is the answer to "how does this guy even know?" */}
            {(c as any).knowledge_chain?.length ? (
              <div className="font-mono text-[9.5px] mt-1 leading-relaxed" style={{ color: "var(--text-lo)" }}>
                {(c as any).knowledge_chain.join("  →  ")}
              </div>
            ) : (
              <div className="font-mono text-[9.5px] mt-1" style={{ color: "var(--text-lo)" }}>
                {c.status === "fired" ? "—" : "knows nothing yet · held"}
              </div>
            )}
            <div className="flex gap-1 mt-2">
              {Array.from({ length: c.segments }).map((_, i) => (
                <div key={i} className="h-2 flex-1 rounded-sm"
                  style={{ background: i < c.filled ? "var(--accent)" : "var(--ink-3)" }} />
              ))}
            </div>
          </div>
        ))}
      </Block>

      <Block title="What people are saying" delay={0.1}>
        {liveRumors.length === 0 && <Empty>No rumors circulating yet.</Empty>}
        {liveRumors.map((r) => (
          <div key={r.id} className="py-2">
            <div className="text-[13px] leading-relaxed italic">"{r.content}"</div>
            <div className="font-mono text-[9.5px] mt-1 flex gap-2" style={{ color: "var(--text-lo)" }}>
              <span style={r.truth !== "true" ? { color: "var(--danger)" } : undefined}>{r.truth}</span>
              <span>· {r.knowers.length} know · from {name(r.origin_char)}</span>
            </div>
            {(r as any).path?.length > 1 && (
              <div className="font-mono text-[9px] mt-0.5 leading-relaxed" style={{ color: "var(--text-lo)" }}>
                {(r as any).path.map((h: any, i: number) =>
                  h.how === "witnessed"
                    ? `${name(h.to)} saw it${h.where ? ` @ ${h.where}` : ""}`
                    : `${name(h.from)} → ${name(h.to)}`).join("  ·  ")}
              </div>
            )}
          </div>
        ))}
      </Block>

      <Block title="Norms" delay={0.15}>
        {w.norms.length === 0 && <Empty>No social rules recorded.</Empty>}
        {w.norms.map((n) => (
          <div key={n.id} className="py-1.5 text-[13px]">
            <span style={{ color: "var(--text-hi)" }}>{n.rule}</span>
            <span className="font-mono text-[9.5px] ml-2" style={{ color: "var(--text-lo)" }}>({n.enforcement} — {n.holders})</span>
          </div>
        ))}
      </Block>

      <Block title="Places" delay={0.2}>
        <Places save={save} onSave={onSave} />
      </Block>
    </div>
  );
}

function Block({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div className="card p-4"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
      <div className="font-mono text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-lo)" }}>{title}</div>
      {children}
    </motion.div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] italic py-1" style={{ color: "var(--text-lo)" }}>{children}</div>;
}


/** PLACE MANAGER — build a location by hand, and put anyone anywhere.
 *
 *  Why this exists: the Forge names ten places and the resolver only mints more from narrator
 *  prose. Anything the PLAYER makes — a house, a camp, a walled compound — is described, lived
 *  in, changed, and then belongs to no location at all, so it cannot be returned to and nobody
 *  can be in it. And when the bookkeeper strands someone (a companion who walked you somewhere
 *  and stayed behind in the ledger), this is where you put them back without editing raw JSON. */
function Places({ save, onSave }: { save: ClientSave; onSave?: (s: ClientSave) => void }) {
  const w = save.world;
  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  // which place is open for editing, and the draft being typed into it
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftDesc, setDraftDesc] = React.useState("");
  // Who is ordinarily about here. The engine infers this from a place's name when unset, but the
  // inference is deliberately conservative — a town you built and named yourself needs telling.
  const [draftPop, setDraftPop] = React.useState("");
  const [draftWho, setDraftWho] = React.useState("");

  const run = async (fn: () => Promise<ClientSave>) => {
    setBusy(true); setErr("");
    try { const next = await fn(); onSave?.(next); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const people = Object.entries(save.characters)
    .filter(([, c]: any) => c.status !== "dead" && c.status !== "departed");

  return (
    <div className="space-y-2">
      {Object.values(w.places).filter((p) => p.id !== "loc_offscene").map((p) => {
        const here = people.filter(([id, c]: any) => (id === "char_player" ? w.player_location : c.location) === p.id);
        return (
          <div key={p.id} className="py-1.5 border-b" style={{ borderColor: "var(--ink-3)" }}>
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-display text-[13.5px]">
                {p.name}
                {w.player_location === p.id && <span style={{ color: "var(--accent)" }}> ◂ you</span>}
                {p.founding && <span className="font-mono text-[9px] ml-1.5" style={{ color: "var(--text-lo)" }}>kept</span>}
              </span>
              <div className="flex gap-1.5 shrink-0">
                {w.player_location !== p.id && (
                  <button disabled={busy} className="font-mono text-[9.5px] uppercase tracking-wider px-1.5 py-0.5"
                    style={{ color: "var(--accent)" }}
                    onClick={() => run(() => api.setLocation(save.id, "char_player", p.id))}>go</button>
                )}
                <button disabled={busy} className="font-mono text-[9.5px] uppercase tracking-wider px-1.5 py-0.5"
                  style={{ color: "var(--text-lo)" }}
                  onClick={() => {
                    if (editing === p.id) { setEditing(null); return; }
                    setEditing(p.id); setDraftName(p.name); setDraftDesc(p.description_facts ?? "");
                    setDraftPop(p.population ? String(p.population.scale) : ""); setDraftWho(p.population?.who ?? ""); setErr("");
                  }}>{editing === p.id ? "close" : "edit"}</button>
                <button disabled={busy} className="font-mono text-[9.5px] uppercase tracking-wider px-1.5 py-0.5"
                  style={{ color: "var(--text-lo)" }}
                  onClick={() => run(() => api.deletePlace(save.id, p.id))}>del</button>
              </div>
            </div>

            {editing === p.id ? (
              // EDITOR — the description is what the narrator actually reads about this place, so it
              // needs room. A house you keep adding rooms to is a paragraph, not a caption.
              <div className="space-y-1.5 mt-1.5">
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)}
                  className="w-full bg-transparent text-[13px] outline-none border-b py-1"
                  style={{ borderColor: "var(--ink-3)", color: "var(--text-hi)" }} />
                <textarea value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} rows={7}
                  placeholder="What is physically here — rooms, contents, who's usually around. The narrator reads this."
                  className="w-full bg-transparent text-[12.5px] leading-relaxed outline-none border rounded p-2 resize-y"
                  style={{ borderColor: "var(--ink-3)", color: "var(--text-mid)", minHeight: 120 }} />
                <div className="flex gap-2 items-center">
                  <input value={draftPop} onChange={(e) => setDraftPop(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="how many"
                    className="w-24 bg-transparent text-[12.5px] outline-none border-b py-1"
                    style={{ borderColor: "var(--ink-3)", color: "var(--text-hi)" }} />
                  <input value={draftWho} onChange={(e) => setDraftWho(e.target.value)}
                    placeholder="who is ordinarily about — trades and roles, no names"
                    className="flex-1 bg-transparent text-[12.5px] outline-none border-b py-1"
                    style={{ borderColor: "var(--ink-3)", color: "var(--text-mid)" }} />
                </div>
                <div className="text-[10.5px]" style={{ color: "var(--text-lo)" }}>
                  People who are not cast — the ordinary traffic of the place. Leave blank to infer from the name; set 0 for genuinely deserted.
                </div>
                <div className="flex gap-3">
                  <button disabled={busy || !draftName.trim()} className="font-mono text-[10px] uppercase tracking-widest py-1"
                    style={{ color: "var(--accent)" }}
                    onClick={() => run(async () => {
                      const n = await api.editPlace(save.id, p.id, {
                        name: draftName, description_facts: draftDesc,
                        ...(draftPop.trim() ? { population: { scale: Number(draftPop), who: draftWho.trim() } } : {}),
                      });
                      setEditing(null); return n;
                    })}>save</button>
                  <button disabled={busy} className="font-mono text-[10px] uppercase tracking-widest py-1"
                    style={{ color: "var(--text-lo)" }} onClick={() => setEditing(null)}>cancel</button>
                </div>
              </div>
            ) : (
              <>
                {p.description_facts && (
                  <div className="text-[12px] whitespace-pre-wrap" style={{ color: "var(--text-lo)" }}>{p.description_facts}</div>
                )}
                {p.stale_note && (
                  <div className="text-[11px] italic mt-0.5" style={{ color: "var(--accent)" }}>{p.stale_note}</div>
                )}
              </>
            )}
            <div className="text-[11px] mt-0.5" style={{ color: "var(--text-lo)" }}>
              {here.length ? here.map(([, c]: any) => c.name).join(", ") : "empty"}
            </div>
          </div>
        );
      })}

      <div className="pt-1 space-y-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New place — name it as someone would say it"
          className="w-full bg-transparent text-[13px] outline-none border-b py-1"
          style={{ borderColor: "var(--ink-3)", color: "var(--text-hi)" }} />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5}
          placeholder="What's physically there — rooms, contents, who's usually around (optional, but the narrator reads it)"
          className="w-full bg-transparent text-[12.5px] leading-relaxed outline-none border rounded p-2 resize-y"
          style={{ borderColor: "var(--ink-3)", color: "var(--text-mid)", minHeight: 90 }} />
        <button disabled={busy || !name.trim()} className="font-mono text-[10px] uppercase tracking-widest py-1"
          style={{ color: name.trim() ? "var(--accent)" : "var(--text-lo)" }}
          onClick={() => run(async () => { const n = await api.addPlace(save.id, name, desc); setName(""); setDesc(""); return n; })}>
          + create place
        </button>
      </div>

      <div className="pt-2 space-y-1">
        <div className="font-mono text-[9.5px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>Put someone somewhere</div>
        {people.map(([id, c]: any) => (
          <div key={id} className="flex justify-between items-center gap-2">
            <span className="text-[12.5px]">{c.name}</span>
            <select disabled={busy}
              value={(id === "char_player" ? w.player_location : c.location) ?? ""}
              onChange={(e) => run(() => api.setLocation(save.id, id, e.target.value))}
              className="bg-transparent text-[11.5px] outline-none py-0.5"
              style={{ color: "var(--text-mid)" }}>
              {Object.values(w.places).map((p) => (
                <option key={p.id} value={p.id} style={{ background: "var(--ink-1)" }}>{p.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {err && <div className="text-[11.5px]" style={{ color: "var(--danger)" }}>{err}</div>}
    </div>
  );
}
