import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ClipboardPaste, Hammer, Sprout, Trash2, Play as PlayIcon, Plus, Upload } from "lucide-react";
import { api, type ClientSave, type PresetInfo, type SaveListing } from "../lib/api";
import { Kicker, Sheet } from "../lib/ui";

export default function Library({ onOpen, onForge, onCreated }: {
  onOpen: (id: string) => void;
  onForge: () => void;
  onCreated: (s: ClientSave) => void;
}) {
  const [saves, setSaves] = useState<SaveListing[]>([]);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // RESULT NOTICE — replaces the native alert()s that used to report an import or fork failure.
  const [notice, setNotice] = useState<string | null>(null);
  // Which save is pending a delete confirmation — replaces window.confirm, which a stray tap could
  // no longer accidentally dismiss the wrong way on mobile.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Paste-a-chronicle draft text. null = sheet closed; "" or more = open with that draft. Only shown
  // when the clipboard read comes back empty — the common case still imports silently.
  const [pasteText, setPasteText] = useState<string | null>(null);

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      onCreated(await api.importSave(data));
    } catch (e: any) { setNotice(`Import failed: ${e.message}`); }
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
    catch (e: any) { setNotice(`New chapter failed: ${e.message}`); }
    finally { setForking(null); }
  };
  const remove = async (id: string) => {
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
                  onClick={(e) => { e.stopPropagation(); setBrief(""); setComposing(composing === s.id ? null : s.id); }}>
                  <Sprout size={15} style={{ color: forking === s.id || composing === s.id ? "var(--accent)" : "var(--text-lo)" }} />
                </button>
                <button className="p-2" style={{ color: "var(--text-lo)" }}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}>
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

        <motion.div className="card card-press p-4 flex items-center gap-3"
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
            try { text = await navigator.clipboard.readText(); } catch { /* falls through to the paste sheet */ }
            if (text.trim()) {
              try { onCreated(await api.importSave(JSON.parse(text))); }
              catch (e: any) { setNotice(`Import failed: ${e.message}`); }
              return;
            }
            // Clipboard read was empty or blocked (common off HTTPS, or without a user gesture on
            // some browsers) — a multi-kilobyte save doesn't fit in a native prompt() box, so it gets
            // a real textarea instead.
            setPasteText("");
          }}>
          <ClipboardPaste size={17} style={{ color: "var(--text-mid)" }} />
          <div>
            <div className="font-display text-[15px]">Paste a chronicle</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Restore from save text you copied (handy on phones).</div>
          </div>
        </motion.div>

        <motion.div className="card card-press p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          style={{ borderStyle: "dashed", borderColor: "var(--accent-glow)" }}
          onClick={onForge}>
          <Hammer size={18} style={{ color: "var(--accent)" }} />
          <div>
            <div className="font-display text-[15px]">The Forge</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Seed an idea. The engine builds the world, cast, and stakes.</div>
          </div>
          <Plus size={16} className="ml-auto" style={{ color: "var(--text-lo)" }} />
        </motion.div>
      </div>

      <Sheet open={confirmDeleteId !== null} onClose={() => setConfirmDeleteId(null)}>
        <div className="p-4">
          <div className="text-[14px]" style={{ color: "var(--text-hi)" }}>Delete this chronicle? No rollback past this.</div>
          <div className="flex gap-2 mt-3">
            <button className="btn flex-1" style={{ color: "var(--danger)" }}
              onClick={() => { const id = confirmDeleteId; setConfirmDeleteId(null); if (id) remove(id); }}>
              Delete
            </button>
            <button className="btn btn-ghost flex-1" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={pasteText !== null} onClose={() => setPasteText(null)} fill>
        <div className="p-4 flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <Kicker className="mb-2">Paste your saved chronicle text here</Kicker>
          <textarea
            className="field flex-1"
            style={{ minHeight: 160, fontFamily: "var(--font-mono)", fontSize: 12 }}
            value={pasteText ?? ""}
            onChange={(e) => setPasteText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 mt-3">
            <button className="btn btn-accent flex-1" onClick={async () => {
              const text = (pasteText ?? "").trim();
              if (!text) { setPasteText(null); return; }
              try { onCreated(await api.importSave(JSON.parse(text))); setPasteText(null); }
              catch (e: any) { setNotice(`Import failed: ${e.message}`); }
            }}>Import</button>
            <button className="btn btn-ghost flex-1" onClick={() => setPasteText(null)}>Cancel</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={notice !== null} onClose={() => setNotice(null)}>
        <div className="p-4">
          <div className="text-[13.5px] leading-relaxed whitespace-pre-line" style={{ color: "var(--text-hi)" }}>{notice}</div>
          <button className="btn w-full mt-3" onClick={() => setNotice(null)}>Done</button>
        </div>
      </Sheet>
    </div>
  );
}
