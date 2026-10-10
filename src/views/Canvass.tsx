import React, { useState } from "react";
import { motion } from "motion/react";
import { Users } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import type { CanvassPick } from "../engine/canvass";

/* CANVASS. One question to several people at once, answered side by side, out of scene and not
   recorded. Who gets asked is suggested — the most relevant people, spread across how they stand
   toward you — and every suggestion can be switched off or anyone else switched on. See
   engine/canvass.ts. */
export default function Canvass({ save }: { save: ClientSave }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<CanvassPick[] | null>(null);
  // Factions are asked as the institution, in its public voice — "faction:<clock id>".
  const [factionPicks, setFactionPicks] = useState<{ id: string; faction: string; why: string }[]>([]);
  const [askable, setAskable] = useState<{ id: string; faction: string }[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [answers, setAnswers] = useState<{ id: string; name: string; answer?: string; error?: string }[]>([]);

  const living = Object.entries(save.characters)
    .filter(([id, c]) => id !== "char_player" && c.status !== "dead" && c.status !== "departed")
    .map(([id, c]) => ({ id, name: c.name }));
  const whyOf = (id: string) => id.startsWith("faction:")
    ? `speaking officially${factionPicks.find((f) => `faction:${f.id}` === id) ? ` · ${factionPicks.find((f) => `faction:${f.id}` === id)!.why}` : ""}`
    : picks?.find((p) => p.id === id)?.why;

  const suggest = async () => {
    if (!q.trim() || busy) return;
    setErr(""); setAnswers([]);
    const p = await api.canvassPicks(save.id, q.trim(), 4);
    setPicks(p.people); setFactionPicks(p.factions); setAskable(p.askable);
    setChosen(new Set([...p.people.map((x) => x.id), ...p.factions.map((f) => `faction:${f.id}`)]));
  };
  const ask = async () => {
    if (!q.trim() || !chosen.size || busy) return;
    setBusy(true); setErr("");
    try { setAnswers(await api.canvass(save.id, [...chosen], q.trim())); }
    catch (e: any) { setErr(e?.message ?? "the canvass failed"); }
    finally { setBusy(false); }
  };
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!open) {
    return (
      <button className="w-full font-mono text-[10px] uppercase tracking-widest py-2 rounded border mt-2 flex items-center justify-center gap-1.5"
        style={{ borderColor: "var(--ink-3)", color: "var(--text-lo)" }} data-tour="cast-canvass"
        onClick={() => setOpen(true)}>
        <Users size={11} /> ask several people
      </button>
    );
  }

  return (
    <div className="space-y-2.5 border rounded p-2.5 mt-2" style={{ borderColor: "var(--ink-3)" }}>
      <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>
        Canvass — out of scene (not recorded)
      </div>
      <textarea value={q} rows={2} autoFocus
        onChange={(e) => { setQ(e.target.value); setPicks(null); setAnswers([]); }}
        placeholder="One question for several people. “What do people make of me?” “Who burned the mill?”"
        className="w-full bg-transparent text-[12.5px] leading-relaxed outline-none border rounded p-2 resize-y"
        style={{ borderColor: "var(--ink-3)", color: "var(--text-mid)" }} />

      {!picks ? (
        <div className="flex gap-3">
          <button disabled={!q.trim()} className="font-mono text-[10px] uppercase tracking-widest py-1" style={{ color: "var(--accent)" }}
            onClick={suggest}>who to ask</button>
          <button className="font-mono text-[10px] uppercase tracking-widest py-1" style={{ color: "var(--text-lo)" }}
            onClick={() => setOpen(false)}>close</button>
        </div>
      ) : (
        <>
          <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-lo)" }}>
            Suggested: the people this touches most, spread across how they feel about you so they don't all agree. A faction marked official answers with its public position, which its own people may not share. Tap to change.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {living.map(({ id, name }) => {
              const on = chosen.has(id);
              const suggested = picks.some((p) => p.id === id);
              if (!on && !suggested && living.length > 10) return null;   // keep a big cast's list short
              return (
                <button key={id} className="chip" onClick={() => toggle(id)} title={whyOf(id)}
                  style={on ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)", textTransform: "none", letterSpacing: 0 }
                    : { textTransform: "none", letterSpacing: 0 }}>
                  {on ? "◉" : "○"} {name}
                </button>
              );
            })}
          </div>
          {askable.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {askable.map(({ id, faction }) => {
                const key = `faction:${id}`, on = chosen.has(key);
                return (
                  <button key={key} className="chip" onClick={() => toggle(key)}
                    style={on ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)", textTransform: "none", letterSpacing: 0 }
                      : { textTransform: "none", letterSpacing: 0 }}>
                    {on ? "◆" : "◇"} {faction} <span style={{ opacity: 0.6 }}>(official)</span>
                  </button>
                );
              })}
            </div>
          )}
          {living.length > 10 && (
            <select className="field text-[12px]" value="" onChange={(e) => e.target.value && toggle(e.target.value)}>
              <option value="">add someone else…</option>
              {living.filter(({ id }) => !chosen.has(id) && !picks.some((p) => p.id === id)).map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <div className="flex gap-3">
            <button disabled={busy || !chosen.size} className="font-mono text-[10px] uppercase tracking-widest py-1" style={{ color: "var(--accent)" }}
              onClick={ask}>{busy ? `asking ${chosen.size}…` : `ask ${chosen.size}`}</button>
            <button disabled={busy} className="font-mono text-[10px] uppercase tracking-widest py-1" style={{ color: "var(--text-lo)" }}
              onClick={() => setOpen(false)}>close</button>
          </div>
        </>
      )}

      {err && <div className="text-[11px]" style={{ color: "var(--danger, #c66)" }}>{err}</div>}

      {answers.map((a, i) => (
        <motion.div key={a.id} className="card p-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
          <div className="font-display text-[14px]">{a.name}</div>
          {whyOf(a.id) && <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-lo)" }}>{whyOf(a.id)}</div>}
          <div className="text-[13px] leading-relaxed mt-1.5 whitespace-pre-wrap" style={{ color: a.error ? "var(--danger, #c66)" : "var(--text-mid)" }}>
            {a.answer ?? a.error}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
