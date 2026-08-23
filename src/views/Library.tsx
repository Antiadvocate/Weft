import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ClipboardPaste, Hammer, Sprout, Trash2, Play as PlayIcon, Plus, Upload } from "lucide-react";
import { api, type ClientSave, type PresetInfo, type SaveListing } from "../lib/api";

export default function Library({ onOpen, onForge, onCreated }: {
  onOpen: (id: string) => void;
  onForge: () => void;
  onCreated: (s: ClientSave) => void;
}) {
  const [saves, setSaves] = useState<SaveListing[]>([]);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      onCreated(await api.importSave(data));
    } catch (e: any) { alert(`Import failed: ${e.message}`); }
  };

  const refresh = () => { api.saves().then(setSaves).catch(() => {}); };
  useEffect(() => { refresh(); api.presets().then(setPresets).catch(() => {}); }, []);

  const launch = async (presetId: string) => {
    setBusy(presetId);
    try { onCreated(await api.newFromPreset(presetId)); } finally { setBusy(null); }
  };
  const [forking, setForking] = React.useState<string | null>(null);
  // WHICH SAVE IS HAVING ITS NEXT CHAPTER WRITTEN, and what the player wants it to be. Branching
  // used to fire the moment the sprout was clicked, with the forge deciding on its own what came
  // next — which for a protagonist nothing can threaten reliably produces a chapter about that
  // protagonist's boredom, because their interior is the only antagonist left. This is the steering.
  const [composing, setComposing] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState("");
  const forkSeason = async (id: string, direction: string) => {
    setComposing(null);
    setForking(id);
    try { onCreated(await api.forkNewSeason(id, direction)); }
    catch (e: any) { alert(`New chapter failed: ${e.message}`); }
    finally { setForking(null); }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this chronicle? No rollback past this.")) return;
    await api.remove(id); refresh();
  };

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3">
      {saves.length > 0 && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-lo)" }}>
            Continue
          </div>
          <div className="space-y-2.5 mb-7">
            {saves.map((s, i) => (
              <React.Fragment key={s.id}>
              <motion.div className="card card-press p-4 flex items-center gap-3"
                data-tour={i === 0 ? "lib-continue" : undefined}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                onClick={() => onOpen(s.id)}>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[15px] truncate">{s.name}</div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-lo)" }}>
                    {s.world_name} · turn {s.turn} · {new Date(s.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <button className="p-2" style={{ color: "var(--text-lo)" }} title="start a new chapter from this save"
                  data-tour={i === 0 ? "lib-sprout" : undefined}
                  onClick={(e) => { e.stopPropagation(); setBrief(""); setComposing(composing === s.id ? null : s.id); }}>
                  <Sprout size={15} style={{ color: forking === s.id || composing === s.id ? "var(--accent)" : "var(--text-lo)" }} />
                </button>
                <button className="p-2" style={{ color: "var(--text-lo)" }}
                  onClick={(e) => { e.stopPropagation(); remove(s.id); }}>
                  <Trash2 size={15} />
                </button>
                <PlayIcon size={16} style={{ color: "var(--accent)" }} />
              </motion.div>
              {composing === s.id && (
                <motion.div className="card p-4 space-y-2"
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                  <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>
                    What is the next chapter about?
                  </div>
                  <textarea
                    className="w-full bg-transparent outline-none text-[13px] leading-relaxed resize-none"
                    style={{ color: "var(--text-hi)", borderBottom: "1px solid var(--line)" }}
                    rows={4}
                    autoFocus
                    placeholder={"Tell it what kind of trouble you want, who it comes from, and what it costs you. \n\ne.g. \"A rival power has been building in the south while I sat still \u2014 someone I can't simply kill, with an army and a claim. I want a war I can lose ground in, not a mood piece about how lonely I am.\""}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                  />
                  <div className="text-[11px] leading-relaxed" style={{ color: "var(--text-lo)" }}>
                    Binding on the threads, the opening and the time skip. Leave it blank and the forge decides on its own.
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button className="chip chip-accent" onClick={() => forkSeason(s.id, brief)}>
                      <Sprout size={11} /> begin chapter
                    </button>
                    <button className="chip" onClick={() => setComposing(null)}>cancel</button>
                  </div>
                </motion.div>
              )}
              </React.Fragment>
            ))}
          </div>
        </>
      )}

      <div className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-lo)" }}>
        Begin
      </div>
      <div className="space-y-2.5">
        {/* THE FORGE IS FIRST AND IT IS THE BIG ONE. It used to sit at the bottom under a dashed
            border, below four other people's worlds — which is where you put the advanced option,
            not the thing the whole engine is for. A world of your own is the default now; the
            prebuilt ones are the shortcut underneath it. */}
        <motion.div className="card card-press p-4 flex items-center gap-3" data-tour="lib-forge"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.3 }}
          style={{ borderColor: "var(--accent-glow)", background: "var(--accent-soft)" }}
          onClick={onForge}>
          <Hammer size={20} className="shrink-0" style={{ color: "var(--accent)" }} />
          <div className="min-w-0">
            <div className="font-display text-[16px]">The Forge — build your own</div>
            <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
              One idea, any genre. The engine builds the place, the cast, their grudges and the clocks already running.
            </div>
          </div>
          <Plus size={16} className="ml-auto shrink-0" style={{ color: "var(--accent)" }} />
        </motion.div>

        {presets.length > 0 && (
          <div className="font-mono text-[10px] uppercase tracking-wider pt-3" style={{ color: "var(--text-lo)" }}>
            or take one already forged
          </div>
        )}
        <div className="space-y-2.5" data-tour="lib-presets">
        {presets.map((p, i) => (
          <motion.div key={p.id} className="card card-press p-4"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={() => !busy && launch(p.id)}>
            <div className="flex items-center justify-between">
              <div className="font-display text-[15px]">{p.name}</div>
              <span className="chip">{busy === p.id ? "creating…" : "new"}</span>
            </div>
            <div className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>{p.blurb}</div>
          </motion.div>
        ))}
        </div>

        <motion.div className="card card-press p-4 flex items-center gap-3" data-tour="lib-import"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.3 }}
          onClick={() => fileRef.current?.click()}>
          <Upload size={17} style={{ color: "var(--text-mid)" }} />
          <div>
            <div className="font-display text-[15px]">Import a chronicle</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Restore from an exported .weaver.json file — older .weft.json saves load too.</div>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </motion.div>

        <motion.div className="card card-press p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.23, duration: 0.3 }}
          onClick={async () => {
            let text = "";
            try { text = await navigator.clipboard.readText(); } catch { /* will prompt */ }
            if (!text) text = window.prompt("Paste your saved chronicle text here:") ?? "";
            if (!text.trim()) return;
            try { onCreated(await api.importSave(JSON.parse(text))); }
            catch (e: any) { alert(`Import failed: ${e.message}`); }
          }}>
          <ClipboardPaste size={17} style={{ color: "var(--text-mid)" }} />
          <div>
            <div className="font-display text-[15px]">Paste a chronicle</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Restore from save text you copied (handy on phones).</div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
