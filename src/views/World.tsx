import React from "react";
import type { ClientSave } from "../lib/api";
import { RelationshipWeb } from "./RelationshipWeb";
import StoryMap from "../lib/StoryMap";
import { api } from "../lib/api";
import { readFate } from "../engine/fate";
import { Card, Muted, Sheet } from "../lib/ui";

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

  // ── ONE SHEET FOR BOTH DESTRUCTIVE CONFIRMS ─────────────────────────────
  // Retiring a thread and force-firing a clock both used to block on a native confirm(), then a
  // native alert() for the fire's result — dialogs that look like the browser, not the app, and
  // that a test harness cannot drive. Both actions now route through this one drawer.
  const [panel, setPanel] = React.useState<
    | { kind: "retireThread"; id: string; title: string }
    | { kind: "fireClock"; id: string; faction: string; consequence: string }
    | { kind: "fireLog"; lines: string[] }
    | null
  >(null);

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      {weather.length > 0 && (
        <Card title="Emotional weather" delay={0}>
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
        </Card>
      )}
      <Card title="The web" delay={0.03}>
        <RelationshipWeb save={save} />
      </Card>

      <Card title="The map" delay={0.035}>
        <StoryMap save={save} />
        <div className="text-[10.5px] italic pt-1" style={{ color: "var(--text-lo)" }}>
          The world as you've walked it — every place you've stood, every path between.
        </div>
      </Card>

      {/* ── WHERE THIS IS HEADED ────────────────────────────────────────────
          A player set a specific ending, played to turn 87, and watched the engine do nothing with
          it — because the budget was 77 turns and only 15 had been spent, which puts the story in
          the "open" act where fate deliberately leaves the player free. That is a defensible rule
          and it was completely invisible: no way to see the act, the clock, or the gap. Nothing
          here changes the pacing; it just stops it being a mystery. */}
      {(() => {
        const f = readFate(save as any);
        if (!f.active) return null;
        const prog = (save as any).destination_progress;
        const actWord: Record<string, string> = {
          open: "open — the world is not bending toward it yet",
          rising: "rising — frictions are being chosen from between here and there",
          closing: "closing — unrelated threads are losing their pull",
          convergence: "convergence — everything in a scene should shorten the distance",
          arrival: "arrival — the ending is being written",
        };
        return (
          <Card title="Where this is headed" delay={0.036}>
            <div className="py-1.5">
              <div className="text-[13px] leading-relaxed">{f.destination}</div>
              <div className="flex justify-between items-baseline gap-2 mt-2">
                <span className="font-mono text-[9.5px]" style={{ color: "var(--text-lo)" }}>{actWord[f.act] ?? f.act}</span>
                <span className="font-mono text-[9.5px] shrink-0" style={{ color: f.turnsLeft <= 5 ? "var(--danger)" : "var(--text-lo)" }}>
                  {f.turnsLeft > 0 ? `${f.turnsLeft} turns left` : "the turns are spent"}
                </span>
              </div>
              <div className="meter mt-1.5"><div style={{ width: `${f.pct}%`, background: f.pct >= 80 ? "var(--danger)" : "var(--accent)" }} /></div>
              {prog?.missing && (
                <div className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                  <span className="font-mono text-[9.5px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>still in the way </span>
                  {prog.missing}
                </div>
              )}
              <div className="text-[10.5px] italic pt-2" style={{ color: "var(--text-lo)" }}>
                The act comes from turns spent against the budget, nothing else. To make the world start bending sooner, shorten the budget in Tuning.
              </div>
            </div>
          </Card>
        );
      })()}

      <Card title="Threads" delay={0.04}>
        {activeThreads.length === 0 && <Muted className="text-[12.5px] py-1">No active threads yet.</Muted>}
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
                onClick={() => setPanel({ kind: "retireThread", id: t.id, title: t.title })}
              >retire</button>
            </div>
            <div className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>{t.description}</div>
            <div className="meter mt-2"><div style={{ width: `${t.tension * 10}%`, background: t.tension >= 7 ? "var(--danger)" : "var(--accent)" }} /></div>
          </div>
        ))}
      </Card>

      <Card title="Clocks" delay={0.05}>
        {w.clocks.length === 0 && <Muted className="text-[12.5px] py-1">No factions on the move.</Muted>}
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
            {/* A clock that fills does not act — it queues its consequence, which beat selection
                then discharges into a scene ahead of cooldowns and grace. Firing by hand has to go
                through that same path: setting status to "fired" is the one edit that stops it
                working, because the discharge only picks up clocks that are still running. */}
            {c.status !== "fired" && (
              <div className="flex justify-end mt-1.5">
                <button
                  className="font-mono text-[9.5px] shrink-0 opacity-60 hover:opacity-100"
                  style={{ color: "var(--danger)" }}
                  title="fill this clock now — its consequence lands in the next scene"
                  onClick={() => setPanel({ kind: "fireClock", id: c.id, faction: c.faction, consequence: c.consequence || "Its consequence lands in the next scene." })}
                >fire now</button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card title="What people are saying" delay={0.1}>
        {liveRumors.length === 0 && <Muted className="text-[12.5px] py-1">No rumors circulating yet.</Muted>}
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
      </Card>

      <Card title="Norms" delay={0.15}>
        {w.norms.length === 0 && <Muted className="text-[12.5px] py-1">No social rules recorded.</Muted>}
        {w.norms.map((n) => (
          <div key={n.id} className="py-1.5 text-[13px]">
            <span style={{ color: "var(--text-hi)" }}>{n.rule}</span>
            <span className="font-mono text-[9.5px] ml-2" style={{ color: "var(--text-lo)" }}>({n.enforcement} — {n.holders})</span>
          </div>
        ))}
      </Card>

      <Card title="Places" delay={0.2}>
        <Places save={save} onSave={onSave} />
      </Card>

      <Sheet open={!!panel} onClose={() => setPanel(null)}>
        <div className="p-4">
          {panel?.kind === "retireThread" && (
            <>
              <div className="text-[14px]">Retire "{panel.title}"?</div>
              <div className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                The narrator stops carrying this storyline. It stays in the record as resolved.
              </div>
              <div className="flex gap-3 mt-4">
                <button className="font-mono text-[10px] uppercase tracking-widest py-1"
                  style={{ color: "var(--danger)" }}
                  onClick={async () => {
                    const { id } = panel;
                    setPanel(null);
                    const s = await api.retireThread(save.id, id);
                    onSave?.(s);
                  }}
                >retire</button>
                <button className="font-mono text-[10px] uppercase tracking-widest py-1"
                  style={{ color: "var(--text-lo)" }} onClick={() => setPanel(null)}>cancel</button>
              </div>
            </>
          )}
          {panel?.kind === "fireClock" && (
            <>
              <div className="text-[14px]">Fire {panel.faction}'s clock now?</div>
              <div className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                {panel.consequence}
              </div>
              <div className="flex gap-3 mt-4">
                <button className="font-mono text-[10px] uppercase tracking-widest py-1"
                  style={{ color: "var(--danger)" }}
                  onClick={async () => {
                    const { id } = panel;
                    const { save: s2, log } = await api.fireClock(save.id, id);
                    onSave?.(s2);
                    setPanel(log.length ? { kind: "fireLog", lines: log } : null);
                  }}
                >fire now</button>
                <button className="font-mono text-[10px] uppercase tracking-widest py-1"
                  style={{ color: "var(--text-lo)" }} onClick={() => setPanel(null)}>cancel</button>
              </div>
            </>
          )}
          {panel?.kind === "fireLog" && (
            <>
              <div className="text-[14px] mb-2">The clock fired</div>
              <div className="space-y-1.5">
                {panel.lines.map((l, i) => (
                  <div key={i} className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{l}</div>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <button className="font-mono text-[10px] uppercase tracking-widest py-1"
                  style={{ color: "var(--accent)" }} onClick={() => setPanel(null)}>close</button>
              </div>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
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
  const [draftIdent, setDraftIdent] = React.useState("");
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
                    setEditing(p.id); setDraftName(p.name); setDraftIdent(p.identity ?? ""); setDraftDesc(p.description_facts ?? "");
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
                {/* THE HALF THAT DOES NOT MOVE. description_facts is replaced wholesale every time
                    the world changes a place, which is right for what burns and wrong for whose
                    house it is — so the identity is stored apart, the simulator cannot write it,
                    and this is the only place it can be corrected. */}
                <input value={draftIdent} onChange={(e) => setDraftIdent(e.target.value)}
                  placeholder="What this place is and whose it is — fixed, never rewritten by play"
                  className="w-full bg-transparent text-[12.5px] outline-none border-b py-1"
                  style={{ borderColor: "var(--ink-3)", color: "var(--text-hi)" }} />
                <textarea value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} rows={7}
                  placeholder="How it stands NOW — rooms, contents, damage, who is usually around. The world rewrites this when the place changes."
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
                        name: draftName, identity: draftIdent, description_facts: draftDesc,
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
                {p.identity && (
                  <div className="text-[12px]" style={{ color: "var(--text-mid)" }}>{p.identity}</div>
                )}
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
