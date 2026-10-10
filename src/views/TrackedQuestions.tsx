import React, { useState } from "react";
import { Pin, X } from "lucide-react";
import { api, type ClientSave } from "../lib/api";

/* TRACKED QUESTIONS. A question the player pins — "Is the bridge still standing?", "How much does
   Mara owe the Hall?" — re-answered from the record every few turns and handed to the narrator as how
   things stand. See engine/tracked.ts. */
export default function TrackedQuestions({ save, onSave }: { save: ClientSave; onSave?: (s: ClientSave) => void }) {
  const list = save.world.tracked ?? [];
  const [q, setQ] = useState("");
  const [every, setEvery] = useState("3");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setErr("");
    try { onSave?.(await api.trackedAdd(save.id, q.trim(), Number(every) || 3)); setQ(""); }
    catch (e: any) { setErr(e?.message ?? "couldn't add it"); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { onSave?.(await api.trackedRemove(save.id, id)); };
  const now = async () => {
    setBusy(true); setErr("");
    try { const r = await api.trackedAnswerNow(save.id); onSave?.(r.save); if (!r.answered) setErr("No answers came back. They'll be tried again next turn."); }
    catch (e: any) { setErr(e?.message ?? "couldn't answer them now"); }
    finally { setBusy(false); }
  };

  return (
    <section className="mb-7">
      <div className="flex items-center gap-2 mb-2">
        <Pin size={14} style={{ color: "var(--text-mid)" }} />
        <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>What you're keeping track of</h3>
      </div>
      {list.length === 0 && (
        <div className="text-[12.5px] mb-2" style={{ color: "var(--text-lo)" }}>
          Pin a question about your story and it is answered from what has happened, every few turns, and the narrator writes consistently with the answer.
        </div>
      )}
      {list.map((t) => (
        <div key={t.id} className="py-1.5" style={{ borderBottom: "1px solid var(--ink-2)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[12.5px] font-medium">{t.question}</div>
            <button className="shrink-0 opacity-60 hover:opacity-100" aria-label="stop tracking" onClick={() => void remove(t.id)}><X size={13} /></button>
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: t.answer ? "var(--text-mid)" : "var(--text-lo)" }}>
            {t.answer ?? "not answered yet — the next turn will"}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-lo)" }}>
            every {t.every} turn{t.every > 1 ? "s" : ""}{t.answered_turn !== undefined ? ` · as of turn ${t.answered_turn}` : ""}
          </div>
        </div>
      ))}
      {list.length < 6 && (
        <div className="mt-2 space-y-2">
          <input className="field w-full text-[12.5px]" style={{ minWidth: 0 }} value={q} placeholder="Is the bridge still standing?"
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <div className="flex items-center gap-2">
            <select className="field text-[12px]" style={{ width: "auto" }} value={every} onChange={(e) => setEvery(e.target.value)} aria-label="how often">
              {[1, 2, 3, 5, 8].map((n) => <option key={n} value={n}>every {n} turn{n > 1 ? "s" : ""}</option>)}
            </select>
            <button className="btn-sm shrink-0" disabled={busy || !q.trim()} onClick={() => void add()}>pin it</button>
          </div>
        </div>
      )}
      {list.length > 0 && (
        <button className="btn-sm mt-2" disabled={busy} onClick={() => void now()}>{busy ? "working…" : "update now"}</button>
      )}
      {err && <div className="text-[11.5px] mt-1.5" style={{ color: "var(--text-mid)" }}>{err}</div>}
    </section>
  );
}
