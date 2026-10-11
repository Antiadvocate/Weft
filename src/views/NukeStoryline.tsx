import React, { useState } from "react";
import { Radiation } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import type { NukeReport } from "../engine/nuke";

/* NUKE A STORYLINE. A plot the story won't let go of, wiped from everything the models read: the
   place, everyone's part in it, memories, threads, rumours, past turns. Preview first, then wipe,
   then undo if it took the wrong thing. See engine/nuke.ts. */
type Preview = { report: NukeReport; people: { id: string; name: string; central: boolean; named: boolean }[]; suggestions: string[] };

export default function NukeStoryline({ save, onDone }: { save: ClientSave; onDone: (s: ClientSave) => void }) {
  const [terms, setTerms] = useState("");
  const [remove, setRemove] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ report: NukeReport; snapshots: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const look = async (t = terms, r = remove) => {
    if (!t.trim()) return;
    setBusy(true); setErr(""); setDone(null);
    try { setPreview(await api.nukePreview(save.id, t, r)); }
    catch (e: any) { setErr(e?.message ?? "couldn't look"); }
    finally { setBusy(false); }
  };
  const addTerm = (w: string) => { const t = `${terms.trim().replace(/[,;]\s*$/, "")}, ${w}`; setTerms(t); void look(t); };
  const toggle = (id: string) => { const r = remove.includes(id) ? remove.filter((x) => x !== id) : [...remove, id]; setRemove(r); void look(terms, r); };
  const wipe = async () => {
    setBusy(true); setErr("");
    try {
      const out = await api.nuke(save.id, terms, remove);
      setDone({ report: out.report, snapshots: out.snapshots }); setPreview(null); onDone(out.save);
    } catch (e: any) { setErr(e?.message ?? "the wipe didn't go through"); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true);
    try { onDone(await api.undoRollback(save.id)); setDone(null); setErr("Undone. Everything is back as it was."); }
    catch (e: any) { setErr(e?.message ?? "couldn't undo"); }
    finally { setBusy(false); }
  };

  const r = preview?.report;
  const counts = r ? Object.entries(r.counts).filter(([k]) => k !== "past turns" && k !== "places") : [];
  const nothing = r && !r.places.length && !r.removed.length && !r.trimmed.length && !counts.length && !r.turns.length;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Radiation size={14} style={{ color: "var(--danger)" }} />
        <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>Nuke a storyline</div>
      </div>
      <div className="text-[12px] mb-3" style={{ color: "var(--text-mid)" }}>
        Name a plot you're done with: a place, a project, a person, a few words that mark it. It's removed from
        everything the story reads: the place, people's wants and goals about it, their memories, threads,
        rumours, and the sentences about it in past turns. People keep their place in the story and only lose
        their part in this. You see what goes before anything does, and you can undo it.
      </div>

      <input className="field w-full text-[13px]" style={{ minWidth: 0 }} value={terms} placeholder="Beacon Works, Beacon"
        onChange={(e) => { setTerms(e.target.value); setPreview(null); }} onKeyDown={(e) => { if (e.key === "Enter") void look(); }} />
      <div className="text-[10.5px] mt-1" style={{ color: "var(--text-lo)" }}>Separate words with commas. Each one is matched as a whole word.</div>
      <button className="btn w-full mt-2" disabled={busy || !terms.trim()} onClick={() => void look()}>
        {busy && !preview ? "looking…" : "Show what goes"}
      </button>

      {r && nothing && (
        <div className="text-[12px] mt-3" style={{ color: "var(--text-mid)" }}>Nothing in this story mentions that.</div>
      )}

      {r && !nothing && preview && (
        <div className="mt-3 space-y-3">
          {!!preview.suggestions.length && (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>Words that come up with it (tap to wipe them too)</div>
              <div className="flex flex-wrap gap-1.5">
                {preview.suggestions.map((w) => <button key={w} className="chip" disabled={busy} onClick={() => addTerm(w)}>+ {w}</button>)}
              </div>
            </div>
          )}

          <div className="text-[12.5px] space-y-1" style={{ color: "var(--text-mid)" }}>
            {!!r.places.length && <div><span style={{ color: "var(--danger)" }}>Place deleted:</span> {r.places.join(", ")}</div>}
            {!!r.removed.length && <div><span style={{ color: "var(--danger)" }}>People deleted:</span> {r.removed.join(", ")}</div>}
            {!!counts.length && <div>Removed: {counts.map(([k, n]) => `${k} ${n}`).join(" · ")}</div>}
            {!!r.turns.length && <div>Sentences cut from {r.turns.length} past turn{r.turns.length === 1 ? "" : "s"} (turns {r.turns[0]}–{r.turns[r.turns.length - 1]})</div>}
          </div>

          {!!preview.people.length && (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>People it touches</div>
              {preview.people.map((p) => (
                <label key={p.id} className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                  <span className="text-[12.5px] min-w-0">
                    {p.name}
                    <span className="block text-[11px]" style={{ color: "var(--text-lo)" }}>
                      {p.named ? "named by what you typed, so deleted" : remove.includes(p.id) ? "deleted from the story" : "stays, loses their part in it"}
                    </span>
                  </span>
                  {!p.named && (
                    <span className="flex items-center gap-1.5 shrink-0 text-[11px]" style={{ color: "var(--text-mid)" }}>
                      delete them
                      <input type="checkbox" checked={remove.includes(p.id)} disabled={busy} onChange={() => toggle(p.id)} />
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}

          {!!r.samples.length && (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>Some of what goes</div>
              {r.samples.slice(0, 5).map((s, i) => (
                <div key={i} className="text-[11.5px] italic py-0.5" style={{ color: "var(--text-lo)", overflowWrap: "anywhere" }}>{s}</div>
              ))}
            </div>
          )}

          <button className="btn btn-danger w-full" disabled={busy} onClick={() => void wipe()}>
            <Radiation size={14} /> {busy ? "working…" : "Wipe it from the story"}
          </button>
          <div className="text-[10.5px]" style={{ color: "var(--text-lo)" }}>
            Your rollback points are cleaned too, so rolling back won't bring it back. If you mention it yourself later, the story lets it back in.
          </div>
        </div>
      )}

      {done && (
        <div className="mt-3 text-[12.5px]" style={{ color: "var(--text-mid)" }}>
          Gone: {[...done.report.places, ...done.report.removed].join(", ") || done.report.terms.join(", ")}
          {done.report.turns.length ? `, and the sentences about it in ${done.report.turns.length} past turns` : ""}.
          {done.snapshots ? ` ${done.snapshots} rollback point${done.snapshots === 1 ? "" : "s"} cleaned too.` : ""}
          <button className="btn btn-ghost w-full mt-2" disabled={busy} onClick={() => void undo()}>Undo the wipe</button>
          <div className="text-[10.5px] mt-1" style={{ color: "var(--text-lo)" }}>Undo works until your next rollback, veto or wipe, which replaces it.</div>
        </div>
      )}
      {err && <div className="text-[11.5px] mt-2" style={{ color: "var(--text-mid)" }}>{err}</div>}
    </div>
  );
}
