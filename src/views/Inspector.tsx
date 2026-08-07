import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Trash2, Plus, ImageOff, Check } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import {
  classify, labelFor, getPath, setPath, deletePath, matchesQuery, sectionsFor, fieldOrder,
  isImageData, approxBytes, humanBytes, type Section, type FieldKind,
} from "../lib/inspector";

/**
 * THE INSPECTOR — every field in the save, typed, labelled, grouped and searchable.
 *
 * Replaces one monospace textarea holding an entire world. Three things it fixes, in order of how
 * much they hurt: a portrait is a hundred kilobytes of base64 you had to scroll past to reach
 * anything under it; every field looked identical, so finding "beliefs" meant reading; and
 * characters, memory, condition and traits were not in the editor at all.
 */

const L = { line: "1px solid var(--line)" };

export default function Inspector({ save, setSave }: { save: ClientSave; setSave: (s: ClientSave) => void }) {
  const [raw, setRaw] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [sectionId, setSectionId] = useState("bible");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = async () => {
    const r = await api.getSaveRaw(save.id);
    setRaw(r); setDraft(r);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [save.id]);

  const sections = useMemo(() => (draft ? sectionsFor(draft) : []), [draft]);
  const flat = useMemo(() => {
    const out: { id: string; label: string; path: (string | number)[]; depth: number }[] = [];
    const walk = (list: Section[], depth: number) => {
      for (const s of list) {
        out.push({ id: s.id, label: s.label, path: s.path, depth });
        if (s.children) walk(s.children, depth + 1);
      }
    };
    walk(sections, 0);
    return out;
  }, [sections]);

  const active = flat.find((s) => s.id === sectionId) ?? flat[0];
  const dirty = draft && raw && JSON.stringify(draft) !== JSON.stringify(raw);

  const edit = (path: (string | number)[], value: unknown) =>
    setDraft((d: any) => (value === undefined ? deletePath(d, path) : setPath(d, path, value)));

  const commit = async () => {
    if (!dirty) return;
    setBusy(true); setErr("");
    try {
      // Diff the two trees at the top level of each section rather than field by field: one patch
      // per changed branch keeps the payload small and the write atomic.
      const patches: { path: (string | number)[]; value: unknown }[] = [];
      const keys = new Set([...Object.keys(raw ?? {}), ...Object.keys(draft ?? {})]);
      for (const k of keys) {
        if (k === "id" || k === "snapshots") continue;
        if (JSON.stringify(raw?.[k]) !== JSON.stringify(draft?.[k])) patches.push({ path: [k], value: draft?.[k] });
      }
      const s = await api.applySavePatches(save.id, patches);
      setSave(s);
      await load();
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (!draft || !active) return <div className="px-4 pt-6 text-[13px]" style={{ color: "var(--text-lo)" }}>Reading the save…</div>;

  const value = getPath(draft, active.path);

  return (
    <div className="h-full flex flex-col">
      {/* ── search + section picker ───────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2 shrink-0" style={{ borderBottom: L.line }}>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ background: "var(--ink-1)" }}>
          <Search size={13} style={{ color: "var(--text-lo)" }} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="find a field — beliefs, traits, warmth…"
            className="flex-1 bg-transparent outline-none text-[13px]" style={{ color: "var(--text-hi)" }}
            spellCheck={false} autoCapitalize="off" autoCorrect="off"
          />
          {query && <button className="text-[11px]" style={{ color: "var(--text-lo)" }} onClick={() => setQuery("")}>clear</button>}
        </div>
        <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1" style={{ scrollbarWidth: "none" }}>
          {flat.map((s) => (
            <button key={s.id} onClick={() => setSectionId(s.id)}
              className={s.id === sectionId ? "chip chip-accent" : "chip"}
              style={{ whiteSpace: "nowrap", opacity: s.depth ? 0.85 : 1, textTransform: "none", letterSpacing: 0 }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── the fields ────────────────────────────────────────────────────── */}
      <div className="scroll-y flex-1 px-3 py-3">
        <Node
          path={active.path} value={value} query={query} open={open} setOpen={setOpen}
          onEdit={edit} depth={0}
        />
      </div>

      {/* ── save bar ──────────────────────────────────────────────────────── */}
      <div className="px-3 py-2.5 shrink-0 flex items-center gap-2" style={{ borderTop: L.line, background: "var(--ink-0)" }}>
        {err && <div className="text-[11px] flex-1" style={{ color: "var(--danger)" }}>{err}</div>}
        {!err && <div className="text-[11px] flex-1" style={{ color: "var(--text-lo)" }}>
          {saved ? "written to the save" : dirty ? "unsaved changes" : "no changes"}
        </div>}
        <button className="chip" disabled={!dirty || busy} style={{ opacity: dirty && !busy ? 1 : 0.4 }}
          onClick={() => setDraft(raw)}>revert</button>
        <button className="chip chip-accent" disabled={!dirty || busy} style={{ opacity: dirty && !busy ? 1 : 0.4 }}
          onClick={commit}>{busy ? "writing…" : saved ? <><Check size={11} /> saved</> : "save"}</button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Node({ path, value, query, open, setOpen, onEdit, depth }: {
  path: (string | number)[]; value: unknown; query: string;
  open: Record<string, boolean>; setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onEdit: (p: (string | number)[], v: unknown) => void; depth: number;
}) {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    const kind = classify(String(path[path.length - 1] ?? ""), value);
    if (kind === "list") return <ListField path={path} value={value as string[]} onEdit={onEdit} />;
    return (
      <div className="space-y-2">
        {value.map((v, i) => {
          const p = [...path, i];
          const key = p.join(".");
          const title = (v && typeof v === "object" && ((v as any).name || (v as any).title || (v as any).label || (v as any).goal || (v as any).content)) || `#${i}`;
          const hit = matchesQuery(p, v, query) || JSON.stringify(v ?? "").toLowerCase().includes(query.trim().toLowerCase());
          if (query && !hit) return null;
          return (
            <Collapsible key={key} id={key} open={open} setOpen={setOpen} depth={depth}
              label={String(title).slice(0, 70)} badge={`${i}`}
              onDelete={() => onEdit(p, undefined)}>
              <Node path={p} value={v} query="" open={open} setOpen={setOpen} onEdit={onEdit} depth={depth + 1} />
            </Collapsible>
          );
        })}
        <button className="chip" onClick={() => onEdit([...path, value.length], seedLike(value))}>
          <Plus size={11} /> add
        </button>
      </div>
    );
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = fieldOrder(obj);
    return (
      <div className="space-y-2.5">
        {keys.map((k) => {
          const p = [...path, k];
          const v = obj[k];
          const kind = classify(k, v);
          const hit = matchesQuery(p, v, query) || (kind === "group" || kind === "objects"
            ? JSON.stringify(v ?? "").toLowerCase().includes(query.trim().toLowerCase()) : false);
          if (query && !hit) return null;
          if (kind === "group" || kind === "objects") {
            const key = p.join(".");
            const count = Array.isArray(v) ? v.length : Object.keys(v as object).length;
            return (
              <Collapsible key={key} id={key} open={open} setOpen={setOpen} depth={depth}
                label={labelFor(k)} badge={String(count)}>
                <Node path={p} value={v} query={query} open={open} setOpen={setOpen} onEdit={onEdit} depth={depth + 1} />
              </Collapsible>
            );
          }
          return <Field key={p.join(".")} path={p} label={labelFor(k)} kind={kind} value={v} onEdit={onEdit} />;
        })}
      </div>
    );
  }

  return <Field path={path} label={labelFor(String(path[path.length - 1]))} kind={classify(String(path[path.length - 1]), value)} value={value} onEdit={onEdit} />;
}

function Collapsible({ id, label, badge, open, setOpen, depth, children, onDelete }: {
  id: string; label: string; badge?: string; depth: number;
  open: Record<string, boolean>; setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  children: React.ReactNode; onDelete?: () => void;
}) {
  const isOpen = open[id] ?? depth === 0;
  return (
    <div className="rounded" style={{ border: L.line, background: depth % 2 ? "transparent" : "var(--ink-1)" }}>
      <div className="flex items-center gap-1.5 px-2.5 py-2 cursor-pointer"
        onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}>
        {isOpen ? <ChevronDown size={13} style={{ color: "var(--text-lo)" }} /> : <ChevronRight size={13} style={{ color: "var(--text-lo)" }} />}
        <div className="font-mono text-[10.5px] uppercase tracking-wider flex-1 truncate" style={{ color: "var(--accent)" }}>{label}</div>
        {badge && <span className="font-mono text-[9.5px]" style={{ color: "var(--text-lo)" }}>{badge}</span>}
        {onDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="remove">
            <Trash2 size={12} style={{ color: "var(--text-lo)" }} />
          </button>
        )}
      </div>
      {isOpen && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

function Field({ path, label, kind, value, onEdit }: {
  path: (string | number)[]; label: string; kind: FieldKind; value: unknown;
  onEdit: (p: (string | number)[], v: unknown) => void;
}) {
  const set = (v: unknown) => onEdit(path, v);
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <div className="font-mono text-[9.5px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>{label}</div>
        <div className="font-mono text-[9px]" style={{ color: "var(--line-strong)" }}>{kind}</div>
      </div>
      {kind === "image" ? <ImageField value={value as string} onClear={() => set("")} /> :
       kind === "boolean" ? (
        <button className={value ? "chip chip-accent" : "chip"} onClick={() => set(!value)}>{value ? "true" : "false"}</button>
      ) :
       kind === "number" ? (
        <input type="number" value={Number(value)} onChange={(e) => set(e.target.value === "" ? 0 : Number(e.target.value))}
          className="w-full bg-transparent outline-none text-[13px] font-mono px-2 py-1.5 rounded"
          style={{ color: "var(--text-hi)", background: "var(--ink-1)", border: L.line }} />
      ) :
       kind === "list" ? <ListField path={path} value={(value as string[]) ?? []} onEdit={onEdit} /> :
       kind === "map" ? <MapField path={path} value={value as Record<string, string>} onEdit={onEdit} /> :
       kind === "prose" ? (
        <textarea value={String(value ?? "")} onChange={(e) => set(e.target.value)} rows={Math.min(14, Math.max(2, String(value ?? "").split("\n").length + 1))}
          spellCheck={false}
          className="w-full outline-none text-[13px] leading-relaxed px-2 py-1.5 rounded resize-y"
          style={{ color: "var(--text-hi)", background: "var(--ink-1)", border: L.line }} />
      ) : kind === "unknown" ? (
        <textarea value={JSON.stringify(value, null, 1)} spellCheck={false} rows={4}
          onChange={(e) => { try { set(JSON.parse(e.target.value)); } catch { /* keep typing */ } }}
          className="w-full outline-none text-[11px] font-mono px-2 py-1.5 rounded resize-y"
          style={{ color: "var(--text-mid)", background: "var(--ink-1)", border: L.line }} />
      ) : (
        <input value={String(value ?? "")} onChange={(e) => set(e.target.value)} spellCheck={false}
          className="w-full bg-transparent outline-none text-[13px] px-2 py-1.5 rounded"
          style={{ color: "var(--text-hi)", background: "var(--ink-1)", border: L.line }} />
      )}
    </div>
  );
}

/** A portrait is shown as a portrait. It is never a hundred kilobytes of text in the scroll. */
function ImageField({ value, onClear }: { value: string; onClear: () => void }) {
  const empty = !value;
  return (
    <div className="flex items-center gap-3 p-2 rounded" style={{ background: "var(--ink-1)", border: L.line }}>
      {empty ? (
        <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>none</div>
      ) : (
        <>
          {isImageData(value) && /^data:image\//i.test(value)
            ? <img src={value} alt="" style={{ width: 44, height: 58, objectFit: "cover", borderRadius: 3 }} />
            : <div style={{ width: 44, height: 58, borderRadius: 3, background: "var(--ink-0)" }} />}
          <div className="flex-1 min-w-0">
            <div className="text-[12px]" style={{ color: "var(--text-mid)" }}>image data</div>
            <div className="font-mono text-[10px]" style={{ color: "var(--text-lo)" }}>{humanBytes(approxBytes(value))} — not shown as text</div>
          </div>
          <button className="chip" onClick={onClear} title="remove the image"><ImageOff size={11} /> clear</button>
        </>
      )}
    </div>
  );
}

/** string[] as one per line — the shape every list in this app actually wants. */
function ListField({ path, value, onEdit }: { path: (string | number)[]; value: string[]; onEdit: (p: (string | number)[], v: unknown) => void }) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => { setText(value.join("\n")); }, [JSON.stringify(value)]);
  return (
    <textarea
      value={text} spellCheck={false}
      onChange={(e) => { setText(e.target.value); onEdit(path, e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)); }}
      rows={Math.min(12, Math.max(2, value.length + 1))}
      placeholder="one per line"
      className="w-full outline-none text-[13px] leading-relaxed px-2 py-1.5 rounded resize-y"
      style={{ color: "var(--text-hi)", background: "var(--ink-1)", border: L.line }} />
  );
}

/** Record<string,string> — skills, and anything else keyed. */
function MapField({ path, value, onEdit }: { path: (string | number)[]; value: Record<string, string>; onEdit: (p: (string | number)[], v: unknown) => void }) {
  const entries = Object.entries(value ?? {});
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1.5 items-center">
          <input value={k} spellCheck={false}
            onChange={(e) => {
              const next: Record<string, string> = {};
              for (const [kk, vv] of entries) next[kk === k ? e.target.value : kk] = vv;
              onEdit(path, next);
            }}
            className="bg-transparent outline-none text-[12px] font-mono px-2 py-1 rounded"
            style={{ width: "38%", color: "var(--accent)", background: "var(--ink-1)", border: L.line }} />
          <input value={String(v ?? "")} spellCheck={false}
            onChange={(e) => onEdit(path, { ...value, [k]: e.target.value })}
            className="flex-1 bg-transparent outline-none text-[12px] px-2 py-1 rounded"
            style={{ color: "var(--text-hi)", background: "var(--ink-1)", border: L.line }} />
          <button onClick={() => { const { [k]: _d, ...rest } = value; onEdit(path, rest); }} title="remove">
            <Trash2 size={12} style={{ color: "var(--text-lo)" }} />
          </button>
        </div>
      ))}
      <button className="chip" onClick={() => onEdit(path, { ...value, "": "" })}><Plus size={11} /> add</button>
    </div>
  );
}

/** A blank entry shaped like the ones already in the array, so "add" produces something usable. */
function seedLike(arr: unknown[]): unknown {
  const model = arr.find((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown> | undefined;
  if (!model) return "";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(model)) {
    out[k] = typeof v === "number" ? 0 : typeof v === "boolean" ? false : Array.isArray(v) ? [] : typeof v === "object" && v ? {} : "";
  }
  return out;
}
