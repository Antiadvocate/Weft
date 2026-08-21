import React, { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { LOCAL_PREFIX, getLocalEndpoint, getLocalImage } from "../config";
import { listLocalCheckpoints } from "../lib/diffusion";

interface ORModel { id: string; name: string; created?: number; image?: boolean; local?: boolean }

let CACHE: ORModel[] | null = null;
let CACHE_AT = 0;

/* CURATED FALLBACK, used only when the live fetch is blocked or offline.
 *
 *  This list going stale is not cosmetic: a retired id offered here is a model slot that fails on
 *  the first call, and the player has no way to tell a dead id from a bad key. Prune anything
 *  OpenRouter has dropped when you touch this — `deepseek/deepseek-chat-v3-0324` sat here (and was
 *  the Forge's hardcoded default) for a while after it was delisted. */
const FALLBACK: ORModel[] = [
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "openai/gpt-5", name: "GPT-5" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick" },
  { id: "x-ai/grok-4", name: "Grok 4" },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B" },
  { id: "mistralai/mistral-large-2411", name: "Mistral Large" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
];
const FALLBACK_IMAGE: ORModel[] = [
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", image: true },
  { id: "black-forest-labs/flux-1.1-pro", name: "FLUX 1.1 Pro", image: true },
  { id: "black-forest-labs/flux-1-schnell", name: "FLUX.1 Schnell", image: true },
  { id: "openai/gpt-image-1", name: "GPT Image 1", image: true },
];

/** WHAT THE MACHINE UNDER THE DESK IS SERVING.
 *
 *  KoboldCpp loads exactly one GGUF and ignores the `model` field entirely, so `local/default` is
 *  always a valid choice and is offered even when the listing call fails (the server may be up but
 *  refusing a cross-origin GET, which says nothing about whether it will answer a POST). Servers
 *  that do host several models — llama-swap, LM Studio, Ollama — get listed properly. */
export async function loadLocalModels(): Promise<ORModel[]> {
  const ep = getLocalEndpoint();
  if (!ep) return [];
  const fallback: ORModel[] = [{ id: `${LOCAL_PREFIX}default`, name: "Local — whatever is loaded", local: true }];
  try {
    const res = await fetch(`${ep.url}/models`, { headers: ep.key ? { Authorization: `Bearer ${ep.key}` } : undefined });
    if (!res.ok) throw new Error(String(res.status));
    const j: any = await res.json();
    const list: ORModel[] = (j.data ?? []).map((m: any) => {
      const raw = String(m.id ?? "").replace(/^koboldcpp\//, "");
      return { id: `${LOCAL_PREFIX}${raw}`, name: raw.split(/[\\/]/).pop() || raw, local: true };
    }).filter((m: ORModel) => m.id !== LOCAL_PREFIX);
    return list.length ? [...list, ...fallback.filter((f) => !list.some((l) => l.id === f.id))] : fallback;
  } catch {
    return fallback;
  }
}

/** WHAT THE SAMPLER UNDER THE DESK HAS ON DISK.
 *
 *  The image slot's local half. A checkpoint the server lists becomes `local/<file>`; the always-
 *  offered `local/default` means "whatever the endpoint settings or the pasted workflow already
 *  say", which is the right answer for a workflow that names its own model and for a server that
 *  will not answer a cross-origin listing call. */
export async function loadLocalImageModels(): Promise<ORModel[]> {
  if (!getLocalImage()) return [];
  const fallback: ORModel[] = [{ id: `${LOCAL_PREFIX}default`, name: "Local — as configured in Settings", image: true, local: true }];
  const found = await listLocalCheckpoints();
  const list: ORModel[] = found.map((f) => ({
    id: `${LOCAL_PREFIX}${f}`, name: f.split(/[\\/]/).pop() || f, image: true, local: true,
  }));
  return [...list, ...fallback];
}

async function loadModels(): Promise<ORModel[]> {
  if (CACHE && Date.now() - CACHE_AT < 1000 * 60 * 30) return CACHE;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(String(res.status));
    const j: any = await res.json();
    const list: ORModel[] = (j.data ?? []).map((m: any) => {
      const out: string[] = m.architecture?.output_modalities ?? [];
      return { id: m.id, name: m.name ?? m.id, created: m.created, image: out.includes("image") };
    });
    if (!list.length) throw new Error("empty");
    CACHE = list; CACHE_AT = Date.now();
    return list;
  } catch {
    return [...FALLBACK, ...FALLBACK_IMAGE];
  }
}

export function ModelPicker({
  label, value, onChange, kind = "text",
}: { label: string; value: string; onChange: (v: string) => void; kind?: "text" | "image" }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ORModel[] | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || models) return;
    setLoading(true);
    // The local list is cheap and always first — a player who has set up a local endpoint has done
    // it on purpose and should not have to scroll past four hundred cloud models to find it.
    Promise.all([kind === "image" ? loadLocalImageModels() : loadLocalModels(), loadModels()])
      .then(([local, cloud]) => { setModels([...local, ...cloud]); setLoading(false); });
  }, [open, models, kind]);

  const filtered = useMemo(() => {
    let list = (models ?? []).filter((m) => (kind === "image" ? m.image : !m.image));
    // newest first when we have timestamps; local always at the top, whatever the search
    list = [...list].sort((a, b) => (Number(!!b.local) - Number(!!a.local)) || (b.created ?? 0) - (a.created ?? 0));
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((m) => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term));
    return list.slice(0, 60);
  }, [models, q, kind]);

  return (
    <div className="py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>{label}</div>
      <button className="field w-full text-left flex items-center justify-between" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
        onClick={() => { setOpen(true); setQ(""); }}>
        <span className="truncate">{value || "tap to choose a model"}</span>
        <span className="text-[10px] ml-2 shrink-0" style={{ color: "var(--text-lo)" }}>change</span>
      </button>

      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 95, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-[16px]">{label}</div>
              <button onClick={() => setOpen(false)}><X size={18} style={{ color: "var(--text-lo)" }} /></button>
            </div>
            <div className="field flex items-center gap-2" style={{ padding: "0 10px" }}>
              <Search size={14} style={{ color: "var(--text-lo)" }} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "image" ? "search image models…" : "search models…"}
                className="flex-1 bg-transparent outline-none py-2" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-hi)" }} />
            </div>
            <div className="text-[10.5px] mt-1.5" style={{ color: "var(--text-lo)" }}>
              {loading ? "loading live model list…" : `${filtered.length} ${kind === "image" ? "image " : ""}models · ${filtered.some((m) => m.local) ? "local first, then " : ""}newest first`}
            </div>
          </div>

          <div className="scroll-y flex-1 px-2 py-1">
            {q.trim() && !filtered.some((m) => m.id === q.trim()) && (
              <button className="w-full text-left px-3 py-2.5 rounded-lg" style={{ color: "var(--accent)" }}
                onClick={() => { onChange(q.trim()); setOpen(false); }}>
                Use custom: <span style={{ fontFamily: "var(--font-mono)" }}>{q.trim()}</span>
              </button>
            )}
            {filtered.map((m) => (
              <button key={m.id} className="w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between"
                style={{ background: m.id === value ? "var(--ink-2)" : "transparent" }}
                onClick={() => { onChange(m.id); setOpen(false); }}>
                <span className="min-w-0">
                  <span className="block text-[13.5px] truncate">
                    {m.local && <span className="font-mono text-[9px] mr-1.5 px-1 py-0.5 rounded" style={{ background: "var(--ink-2)", color: "var(--accent)", verticalAlign: "middle" }}>LOCAL</span>}
                    {m.name}
                  </span>
                  <span className="block font-mono text-[10px] truncate" style={{ color: "var(--text-lo)" }}>{m.id}</span>
                </span>
                {m.id === value && <Check size={15} style={{ color: "var(--accent)" }} className="shrink-0 ml-2" />}
              </button>
            ))}
            {!loading && !filtered.length && <div className="px-3 py-6 text-center text-[12.5px]" style={{ color: "var(--text-lo)" }}>No match. Type a full model id to use it anyway.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
