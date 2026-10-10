import React, { useState } from "react";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import type { AnalystStep } from "../engine/analyst";

/* ASK THE RECORD. A question about this save — "why does Áedán distrust me?", "how did the Church
   find out?" — answered by a loop that has to look things up before it may answer and cites turns,
   memories and rumour routes. It reads hidden state, so it can spoil things; it writes nothing.
   See engine/analyst.ts. */
export default function AskRecord({ save }: { save: ClientSave }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const ask = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setErr(""); setAnswer(""); setSteps([]); setOpen(null);
    try {
      const r = await api.askRecord(save.id, q.trim(), (st) => setSteps((x) => [...x, st]));
      setSteps(r.steps); setAnswer(r.answer);
    } catch (e: any) { setErr(e?.message ?? "the lookup failed"); }
    finally { setBusy(false); }
  };

  const argLine = (a: Record<string, unknown>) => Object.values(a).map((v) => String(v)).filter(Boolean).join(" · ");

  return (
    <div className="card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Ask the record</div>
      <div className="text-[12px] leading-relaxed mb-2.5" style={{ color: "var(--text-lo)" }}>
        A question about this story, answered from what the save holds, with the turns and memories it came from. It can see what the characters keep hidden, so it can spoil things.
      </div>
      <div className="flex gap-2">
        <input className="field flex-1 text-[13px]" value={q} placeholder="Why does she distrust me? How did they find out?"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} />
        <button className="btn btn-accent shrink-0" style={{ height: 40, padding: "0 14px" }} disabled={busy || !q.trim()} onClick={ask}>
          <Search size={14} />
        </button>
      </div>

      {(steps.length > 0 || busy) && (
        <div className="mt-3 space-y-1">
          {steps.map((st, i) => (
            <div key={i}>
              <button className="font-mono text-[10.5px] text-left w-full truncate" style={{ color: "var(--text-mid)" }}
                onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? "▾" : "▸"} {st.tool} <span style={{ color: "var(--text-lo)" }}>{argLine(st.args)}</span>
              </button>
              {open === i && (
                <pre className="font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap mt-1 mb-2 p-2 rounded"
                  style={{ background: "var(--ink-1)", color: "var(--text-lo)", maxHeight: 220, overflow: "auto" }}>{st.result}</pre>
              )}
            </div>
          ))}
          {busy && <div className="font-mono text-[10.5px] shimmer">looking…</div>}
        </div>
      )}

      {err && <div className="text-[12px] mt-3" style={{ color: "var(--danger, #c66)" }}>{err}</div>}
      {answer && (
        <motion.div className="text-[13.5px] leading-relaxed mt-3 whitespace-pre-wrap" style={{ color: "var(--text-hi)" }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {answer}
        </motion.div>
      )}
    </div>
  );
}
