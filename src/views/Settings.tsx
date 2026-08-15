import React, { useState } from "react";
import { ModelPicker, loadLocalModels } from "./ModelPicker";
import { Braces, Check, Copy, Download, Wrench, SlidersHorizontal } from "lucide-react";
import Inspector from "./Inspector";
import { getTtsPrefs, setTtsPrefs, listVoices, ttsAvailable, speak, stopSpeaking } from "../lib/tts";
import { api, type ClientSave, type ModelSettings } from "../lib/api";
import { DEFAULT_MODELS } from "../engine/types";
import { splitLines } from "../engine/turn";
import { getApiKey, setApiKey, getLocalEndpoint, setLocalEndpoint, isLocalModel, LOCAL_SAMPLER_DEFAULTS } from "../config";
import { currentPush, getRelay, isInstalled, relayHealth, setRelay, subscribePush } from "../relay";

const THEMES = ["auto", "ember", "verdigris", "rust", "frost"];

export const PROSE_FONTS: { id: string; label: string; stack: string }[] = [
  { id: "newsreader", label: "Newsreader", stack: '"Newsreader", serif' },
  { id: "source", label: "Source Serif", stack: '"Source Serif 4", serif' },
  { id: "fraunces", label: "Fraunces", stack: '"Fraunces", serif' },
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
];

export function applyProseFont(id: string) {
  const f = PROSE_FONTS.find((x) => x.id === id) ?? PROSE_FONTS[0];
  document.documentElement.style.setProperty("--font-prose", f.stack);
  localStorage.setItem("weft-prose-font", f.id);
}

/* Field components live at MODULE level — defining them inside the component
   recreates the type every render, React remounts the input, and the keyboard
   dies after one keystroke. Never again. */
function TextField({ label, value, onChange, mono, rows }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean; rows?: number;
}) {
  const style = mono ? { fontFamily: "var(--font-mono)", fontSize: 13 } : undefined;
  return (
    <div className="py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>{label}</div>
      {rows && rows > 1
        ? <textarea className="field" style={style} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className="field" style={style} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}


function Toggle({ on, onFlip, title, desc }: { on: boolean; onFlip: () => void; title: string; desc: string }) {
  return (
    <button className="w-full flex items-center justify-between py-2" onClick={onFlip}>
      <span className="text-left">
        <span className="block text-[14px]">{title}</span>
        <span className="block text-[11px]" style={{ color: "var(--text-lo)" }}>{desc}</span>
      </span>
      <span style={{ width: 42, height: 24, borderRadius: 999, background: on ? "var(--accent)" : "var(--ink-3)", position: "relative", flexShrink: 0, transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: "var(--ink-0)", transition: "left .2s" }} />
      </span>
    </button>
  );
}

function SectionHeader({ label, blurb }: { label: string; blurb: string }) {
  return (
    <div className="px-1 pt-2">
      <div className="font-display text-[16px]">{label}</div>
      <div className="text-[11px]" style={{ color: "var(--text-lo)" }}>{blurb}</div>
    </div>
  );
}

/** LOCAL AI — the model on your own machine.
 *
 *  KoboldCpp, llama.cpp's server, LM Studio and Ollama all expose the same OpenAI-shaped endpoint,
 *  so this is a base URL and nothing more. Once it's set, every model picker grows a LOCAL section
 *  and any of the four roles can be pointed at it independently — see src/config.ts for why the
 *  `local/` id prefix is the whole routing mechanism.
 *
 *  It says out loud what the other cards say: nothing here leaves the device, and in this case
 *  nothing leaves the LAN. */
/** THE FIELDS THE LOCAL PRESET TOUCHES, and the two values each of them can take.
 *
 *  Defined in one place because a preset you cannot reverse is a trap: the button applied eight
 *  changes across three cards, and finding them all again by hand — after a save, in a later
 *  session, with no record of what they had been — is not something anyone should have to do. The
 *  restore path reads the same list, so the two can never drift apart. */
const LOCAL_PRESET: Partial<ModelSettings> = {
  lean_mode: true,
  context_mode: "chatlog",
  iframe_cadence: 10,
  history_window: 4,
  paging: true,
  token_budget: 3000,
  narrator_reasoning: false,
  context_memories_k: 4,
};
/** Where "restore" lands when there is no snapshot to go back to — a save tuned in an earlier
 *  session has no memory of what it was before, and the engine defaults are the honest answer. */
const LOCAL_PRESET_DEFAULTS: Partial<ModelSettings> = {
  lean_mode: DEFAULT_MODELS.lean_mode ?? false,
  context_mode: DEFAULT_MODELS.context_mode ?? "chatlog",
  iframe_cadence: DEFAULT_MODELS.iframe_cadence ?? 6,
  history_window: DEFAULT_MODELS.history_window,
  paging: true,
  token_budget: DEFAULT_MODELS.token_budget ?? 0,
  narrator_reasoning: DEFAULT_MODELS.narrator_reasoning ?? false,
  context_memories_k: DEFAULT_MODELS.context_memories_k,
};

function LocalAI({ onPreset, onRestore, presetApplied }: { onPreset: () => void; onRestore: () => void; presetApplied: boolean }) {
  const cur = getLocalEndpoint();
  const [url, setUrl] = useState(cur?.url ?? "");
  const [lkey, setLkey] = useState(cur?.key ?? "");
  const [noThink, setNoThink] = useState(cur?.no_think !== false);
  const [loopGuard, setLoopGuard] = useState(String(cur?.loop_guard ?? LOCAL_SAMPLER_DEFAULTS.loop_guard));
  const [topP, setTopP] = useState(String(cur?.top_p ?? LOCAL_SAMPLER_DEFAULTS.top_p));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const clean = url.trim().replace(/\/+$/, "");
    if (!clean) { setLocalEndpoint(null); setStatus("local AI off — every call goes to OpenRouter"); return; }
    setLocalEndpoint({
      url: clean, key: lkey.trim() || undefined, no_think: noThink,
      loop_guard: Math.max(0, Math.min(2, Number(loopGuard) || 0)),
      top_p: Math.max(0, Math.min(1, Number(topP) || 0)),
    });
    setBusy(true);
    try {
      const found = await loadLocalModels();
      const real = found.filter((m) => !m.id.endsWith("/default"));
      setStatus(real.length
        ? `connected — serving ${real.map((m) => m.name).slice(0, 3).join(", ")}${real.length > 3 ? ` +${real.length - 3}` : ""}. Pick it in any model slot below.`
        : "saved. Couldn't list models (normal for KoboldCpp behind CORS) — choose `local/default` in a model slot and it will use whatever is loaded.");
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Local AI (your machine)</div>
      <TextField label="OpenAI-compatible base URL" value={url} onChange={setUrl} mono />
      <TextField label="Key (optional — most local servers ignore it)" value={lkey} onChange={setLkey} mono />
      <Toggle on={noThink} onFlip={() => setNoThink((v) => !v)}
        title="Suppress local thinking (/no_think)"
        desc="Qwen3 and other hybrid GGUFs deliberate out loud before answering — slow, and it lands in the story pane. This appends the control token that turns it off. Any <think> block that appears anyway is stripped before you ever see it." />
      <div className="flex gap-2">
        <div className="flex-1"><TextField label="Loop guard (frequency penalty)" value={loopGuard} onChange={setLoopGuard} mono /></div>
        <div className="flex-1"><TextField label="top_p" value={topP} onChange={setTopP} mono /></div>
      </div>
      <div className="text-[11px] mb-1" style={{ color: "var(--text-lo)" }}>
        OpenRouter's providers ship sane sampler defaults; a local server gives you its own, and a heavily quantized model on permissive defaults repeats — a clause cycling until the token budget dies, or a character delivering a line and then delivering it again two paragraphs later. Loop guard drives both penalties that counter that (frequency, and presence at half). <b>If you are still seeing repetition, raise it — 0.6 to 0.8 is not too much on a low-bit quant.</b> Set either field to <span style={{ fontFamily: "var(--font-mono)" }}>0</span> to send nothing and let your server's own settings decide.
      </div>
      <button className="btn w-full mt-2" disabled={busy} onClick={() => void save()}>
        {busy ? "checking…" : url.trim() ? "Save & test" : "Turn local AI off"}
      </button>
      {status && <div className="text-[11px] mt-2" style={{ color: "var(--text-lo)" }}>{status}</div>}
      <div className="text-[11px] italic mt-2" style={{ color: "var(--text-lo)" }}>
        KoboldCpp: <span style={{ fontFamily: "var(--font-mono)" }}>http://localhost:5001/v1</span> · llama-server: <span style={{ fontFamily: "var(--font-mono)" }}>http://localhost:8080/v1</span> · LM Studio: <span style={{ fontFamily: "var(--font-mono)" }}>http://localhost:1234/v1</span> · Ollama: <span style={{ fontFamily: "var(--font-mono)" }}>http://localhost:11434/v1</span>.
        Nothing leaves your machine. If the page is served over https the browser may refuse a plain-http localhost call — run Weft locally, or use KoboldCpp's <span style={{ fontFamily: "var(--font-mono)" }}>--remotetunnel</span> and paste the https URL it prints.
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn flex-1" onClick={onPreset}>
          {presetApplied ? <><Check size={14} /> tuned for a local model</> : "Tune this save for a local model"}
        </button>
        <button className="btn flex-1" onClick={onRestore}>
          {presetApplied ? "Undo" : "Restore defaults"}
        </button>
      </div>
      <div className="text-[11px] mt-1.5" style={{ color: "var(--text-lo)" }}>
        Reversible. <b>Undo</b> puts back exactly what these settings were before you tapped Tune; <b>Restore defaults</b> returns the same eight fields to the engine's own values, which is the one that helps if you tuned a save in an earlier session and want out. Either way, only these fields move — models, keys, and everything else are left alone. Then Save.
      </div>
      <div className="text-[11px] italic mt-1.5" style={{ color: "var(--text-lo)" }}>
        Sets lean prompts, chat-log context, a slower re-anchor and a tight digest — about 18k tokens a turn instead of 27k. This is a SPEED setting, not a fitting one: a 64k window holds a full turn either way, but every token you cut is prompt the model doesn't ingest before it writes, and KV cache it doesn't hold. If your machine is fast enough, unwind it in this order and keep what reads better — token budget to 0 first, then lean mode off. Chat-log context and the slow re-anchor cost nothing; leave those on. Review the sections below, then Save.
      </div>
    </div>
  );
}

/** BACKGROUND TURNS — the relay, and the notification that tells you a turn landed.
 *
 *  This is the only place in Settings that configures something outside the browser, so it says
 *  plainly what leaves the device. See src/relay.ts and relay/README.md. */
function BackgroundTurns() {
  const cur = getRelay();
  const [url, setUrl] = useState(cur?.url ?? "");
  const [token, setToken] = useState(cur?.token ?? "");
  const [vapid, setVapid] = useState(cur?.vapid ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subbed, setSubbed] = useState<boolean | null>(null);

  React.useEffect(() => { void currentPush().then((p) => setSubbed(!!p)); }, []);

  const save = async () => {
    const c = { url: url.trim().replace(/\/+$/, ""), token: token.trim(), vapid: vapid.trim() || undefined };
    if (!c.url || !c.token) { setRelay(null); setStatus("relay off — turns run in this tab, as before"); return; }
    setBusy(true);
    try {
      const h = await relayHealth(c);
      if (!h.ok) { setStatus(`couldn't reach it: ${h.error}`); return; }
      setRelay(c);
      setStatus("connected — narration now runs on the relay");
      if (h.vapid && !c.vapid) { setVapid(h.vapid); setRelay({ ...c, vapid: h.vapid }); }
    } finally { setBusy(false); }
  };

  const enablePush = async () => {
    const c = getRelay();
    if (!c?.vapid) { setStatus("save the relay first — the public key comes from it"); return; }
    setBusy(true);
    try {
      await subscribePush(c.vapid);
      setSubbed(true);
      setStatus("notifications on — you'll get a ping when a turn lands");
    } catch (e) {
      setStatus(`couldn't subscribe: ${(e as Error)?.message ?? e}`);
    } finally { setBusy(false); }
  };

  const installed = isInstalled();
  return (
    <div className="card p-4 mt-3">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Background turns (optional)</div>
      <div className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-mid)" }}>
        Without this, a turn is written by this tab — so if the app is closed or killed while the
        narrator is working, the turn dies with it. On iOS that happens within seconds of switching
        away. Point Weaver at a relay you've deployed and the narrator call is made there instead:
        leave, come back, it's finished. Setup is in <span style={{ fontFamily: "var(--font-mono)" }}>relay/README.md</span>.
      </div>
      <div className="text-[11px] italic mb-3" style={{ color: "var(--text-lo)" }}>
        What the relay sees: the narrator prompt (world digest and recent prose) and what comes back.
        Your save never leaves this device — bookkeeping still runs here.
      </div>
      <TextField label="Relay URL" value={url} onChange={setUrl} mono />
      <TextField label="Relay token" value={token} onChange={setToken} mono />
      <TextField label="VAPID public key (for notifications)" value={vapid} onChange={setVapid} mono />
      <div className="flex gap-2 mt-2">
        <button className="btn flex-1" disabled={busy} onClick={() => void save()}>
          {busy ? "checking…" : "Save & test"}
        </button>
        <button className="btn flex-1" disabled={busy || !installed || subbed === true} onClick={() => void enablePush()}>
          {subbed ? <><Check size={14} /> notifications on</> : "Turn on notifications"}
        </button>
      </div>
      {!installed && (
        <div className="text-[11px] italic mt-2" style={{ color: "var(--text-lo)" }}>
          Notifications need the app added to your home screen — iOS gives a plain browser tab no
          access to them at all. Share → Add to Home Screen, then open it from the icon.
        </div>
      )}
      {status && <div className="text-[11.5px] mt-2" style={{ color: "var(--accent)" }}>{status}</div>}
    </div>
  );
}

export default function Settings({ save, setSave }: { save: ClientSave; setSave: (s: ClientSave) => void }) {
  const m = save.model_settings;
  const wb = save.world_bible;
  const [draft, setDraft] = useState<ModelSettings>({ ...m });
  const [theme, setTheme] = useState(wb.era_theme ?? "auto");
  const [proseFont, setProseFont] = useState(() => localStorage.getItem("weft-prose-font") ?? "newsreader");
  const [tts, setTts] = useState(() => getTtsPrefs());
  const updTts = (patch: Partial<ReturnType<typeof getTtsPrefs>>) => { const next = { ...tts, ...patch }; setTts(next); setTtsPrefs(next); };
  const [saved, setSaved] = useState(false);
  const [orKey, setOrKey] = useState(getApiKey());
  const [keySaved, setKeySaved] = useState(false);
  // What the preset-touched fields were before "Tune for a local model" — null when it hasn't been
  // tapped this visit, which is also the case where "Restore defaults" is the only sane target.
  const [prePreset, setPrePreset] = useState<Partial<ModelSettings> | null>(null);
  const [rescueText, setRescueText] = useState<string | null>(null);
  const [worldJson, setWorldJson] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [worldErr, setWorldErr] = useState("");
  const [openingText, setOpeningText] = useState<string | null>(null);
  const [openingBusy, setOpeningBusy] = useState(false);
  const [bibleSaved, setBibleSaved] = useState(false);
  const [bible, setBible] = useState({
    name: wb.name ?? "", era: wb.era ?? "", technology_level: wb.technology_level ?? "",
    magic_rules: wb.magic_rules ?? "", forbidden: wb.forbidden ?? "",
    political_situation: wb.political_situation ?? "", what_people_fear: wb.what_people_fear ?? "", start_date: wb.start_date ?? "",
    cultures_and_languages: wb.cultures_and_languages ?? "", climate_and_geography: wb.climate_and_geography ?? "",
    calendar_and_currency: wb.calendar_and_currency ?? "",
    narrator_direction: wb.narrator_direction ?? "",
    destination: wb.destination ?? "",
    destination_turns: wb.destination_turns ?? 0,
    art_direction: wb.art_direction ?? "",
  });
  // ONE PER LINE, NOT COMMA-SEPARATED. These round-tripped through `join(", ")` / `split(",")`,
  // which shreds any entry containing a comma and does it again on every save: "Political intrigue
  // without immediate, personal stakes" became "Political intrigue without immediate" plus a lost
  // fragment, and a pressure palette decayed into seven half-sentences, three of them starting with
  // "and". Newlines, the way canon below already does it.
  const [palette, setPalette] = useState((wb.pressure_palette ?? []).join("\n"));
  const [forbidPrimary, setForbidPrimary] = useState((wb.forbidden_as_primary ?? []).join("\n"));
  const [godMode, setGodMode] = useState(!!wb.god_mode);
  const [canon, setCanon] = useState(((save.world as any).canon ?? []).join("\n"));
  const [difficulty, setDifficulty] = useState({ ...wb.difficulty_profile });

  const DIFF_OPTIONS = {
    lethality: ["low", "medium", "high"],
    friction_density: ["sparse", "balanced", "dense"],
    antagonist_aggression: ["slow_burn", "active", "hostile"],
    protagonist_competence: ["soft", "average", "hardened"],
  } as const;

  const setM = (k: keyof ModelSettings) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: typeof m[k] === "number" ? Number(v) || 0 : v }) as ModelSettings);
  const setB = (k: keyof typeof bible) => (v: string) => setBible((b) => ({ ...b, [k]: v }));

  const previewTheme = (t: string) => {
    setTheme(t);
    // live preview — saving makes it stick to the save file
    document.documentElement.setAttribute("data-theme", t === "auto" ? "ember" : t);
  };

  const commit = async () => {
    const s = await api.settings(save.id, { ...draft, era_theme: theme });
    setSave(s); setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const commitBible = async () => {
    const s = await api.edit(save.id, { canon: canon.split("\n").map((x: string) => x.trim()).filter(Boolean), world_bible: {
      ...bible,
      destination_turns: Math.max(0, parseInt(String(bible.destination_turns ?? 0), 10) || 0),
      god_mode: godMode,
      difficulty_profile: difficulty,
      pressure_palette: splitLines(palette),
      forbidden_as_primary: splitLines(forbidPrimary),
    } });
    setSave(s); setBibleSaved(true);
    setTimeout(() => setBibleSaved(false), 1400);
  };

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      <SectionHeader label="The story" blurb="How this world behaves — tension, direction, canon." />
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>World tension</div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[14px]">How much the world throws at you</span>
          <span className="font-mono text-[13px]" style={{ color: "var(--accent)" }}>{draft.tension ?? 5}</span>
        </div>
        <input type="range" min={0} max={10} step={1} value={draft.tension ?? 5}
          onChange={(e) => setDraft((d) => ({ ...d, tension: Number(e.target.value) }))}
          className="w-full" style={{ accentColor: "var(--accent)" }} />
        <div className="text-[11px] mt-1" style={{ color: "var(--text-lo)" }}>
          {(draft.tension ?? 5) === 0
            ? "0 — at rest. The world introduces nothing new: no fresh threats, threads, events, faction moves, or background drives. It only responds to what you do. Pure breathing room."
            : (draft.tension ?? 5) <= 2
              ? "Low — quiet. Existing situations can resolve and people react, but little new friction is manufactured, and no scheduled consequences are created."
              : (draft.tension ?? 5) <= 4
                ? "Below midpoint — gentle. Friction stays mild; the world rarely escalates on its own."
                : (draft.tension ?? 5) === 5
                  ? "Balanced — the default rhythm of complication and calm."
                  : (draft.tension ?? 5) <= 7
                    ? "Above midpoint — eventful. The world presses harder and more often."
                    : "High — relentless. Expect frequent, fast escalation."}
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>World bible — every rule, yours (live next turn)</div>

        <button className="chip my-2" onClick={() => setGodMode((v) => !v)}
          style={godMode ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
          {godMode ? "◉" : "○"} god mode — powers cost nothing; the world reacts to what it has seen you do
        </button>

        <TextField label="Name" value={bible.name} onChange={setB("name")} />
        <TextField label="Era" value={bible.era} onChange={setB("era")} />
        <TextField label="Art direction (portraits & scenes — style, medium, palette)" value={bible.art_direction} onChange={setB("art_direction")} rows={2} />
        <div className="text-[11px] -mt-1 mb-1" style={{ color: "var(--text-lo)" }}>
          e.g. "muted painterly chiaroscuro, oil texture" · "90s cel anime, hard ink lines" · "gritty photoreal, 35mm film grain". Portraits are full-body on white studio; scenes use this same style.
        </div>
        <TextField label="Technology" value={bible.technology_level} onChange={setB("technology_level")} rows={2} />
        <TextField label="Magic / power rules (incl. any costs — delete a cost and it's gone)" value={bible.magic_rules} onChange={setB("magic_rules")} rows={4} />
        <TextField label="Forbidden in this world" value={bible.forbidden} onChange={setB("forbidden")} rows={2} />
        <TextField label="Start date of Day 1 (YYYY-MM-DD — unlocks weekdays, months, years in the clock)" value={bible.start_date} onChange={setB("start_date")} />
        <TextField label="Political situation" value={bible.political_situation} onChange={setB("political_situation")} rows={3} />
        <TextField label="What people fear" value={bible.what_people_fear} onChange={setB("what_people_fear")} rows={2} />
        <TextField label="Cultures & languages" value={bible.cultures_and_languages} onChange={setB("cultures_and_languages")} rows={2} />
        <TextField label="Climate & geography" value={bible.climate_and_geography} onChange={setB("climate_and_geography")} rows={2} />
        <TextField label="Calendar & currency" value={bible.calendar_and_currency} onChange={setB("calendar_and_currency")} rows={2} />
        <TextField label="Pressure palette (one per line — where friction is allowed to come from)" value={palette} onChange={setPalette} rows={3} />
        <TextField label="Never the primary engine of a scene (one per line)" value={forbidPrimary} onChange={setForbidPrimary} rows={3} />
        <TextField label="Narrator direction (your standing orders)" value={bible.narrator_direction} onChange={setB("narrator_direction")} rows={3} />
        <TextField label="Destination — the ending this story is written toward (blank = open world)" value={bible.destination} onChange={setB("destination")} rows={2} />
        {!!bible.destination?.trim() && (
          <div className="mt-2">
            <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
              Turn budget — 0 = no clock (gravity, not fate)
            </div>
            <input className="field" inputMode="numeric" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
              value={String(bible.destination_turns || "")}
              onChange={(e) => setB("destination_turns")(e.target.value.replace(/[^0-9]/g, ""))} />
            <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
              {(bible.destination_turns || 0) > 0
                ? <>The ending arrives within this many turns, well or badly. Changing this restarts the clock from the current turn.</>
                : <>No clock: the ending pulls but never forces.</>}
            </div>
          </div>
        )}
        {!!save.retcons?.length && (
          <div className="mt-3">
            <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>Player overrides — vetoes void an invention; corrections affirm world law</div>
            <div className="space-y-1.5">
              {save.retcons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: "var(--ink-1)" }}>
                  <span className="font-mono text-[9px] uppercase tracking-wider mt-0.5 shrink-0" style={{ color: r.kind === "correction" ? "var(--accent)" : "var(--danger, var(--text-lo))" }}>
                    {r.kind === "correction" ? "law" : "veto"}
                  </span>
                  <div className="flex-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{r.text}</div>
                  <button className="chip shrink-0" onClick={async () => setSave(await api.unstrike(save.id, i))}>{r.kind === "correction" ? "drop" : "allow"}</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <TextField label="Established canon (one per line — world-altering facts EVERYONE knows, forever)" value={canon} onChange={setCanon} rows={4} />

        <div className="font-mono text-[10px] uppercase tracking-wider mt-3 mb-1.5" style={{ color: "var(--text-lo)" }}>Difficulty profile</div>
        {(Object.keys(DIFF_OPTIONS) as (keyof typeof DIFF_OPTIONS)[]).map((k) => (
          <div key={k} className="flex items-center gap-2 py-1 flex-wrap">
            <span className="font-mono text-[9.5px] uppercase tracking-wider w-32 shrink-0" style={{ color: "var(--text-lo)" }}>{k.replace(/_/g, " ")}</span>
            {DIFF_OPTIONS[k].map((opt) => (
              <button key={opt} className="chip" onClick={() => setDifficulty((d) => ({ ...d, [k]: opt }))}
                style={difficulty[k] === opt ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
                {opt.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        ))}

        <button className="btn w-full mt-3" onClick={commitBible}>
          {bibleSaved ? <><Check size={14} /> saved</> : "Save world bible"}
        </button>
        <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={() => setInspecting(true)}>
          <SlidersHorizontal size={14} /> Inspector — every field in the save
        </button>

        <button className="btn btn-ghost w-full mt-2" onClick={async () => {
          setWorldErr(""); const raw = await api.getWorldRaw(save.id); setWorldJson(JSON.stringify(raw, null, 2));
        }}>
          <Braces size={14} /> Raw world edit (full JSON)
        </button>
        <div className="text-[11px] mt-1" style={{ color: "var(--text-lo)" }}>
          Edit the world directly — bible, threads, faction clocks, places, edges, canon. Handy at turn 1 to fix anything the forge over-baked.
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Opening scene</div>
        <div className="text-[12px] mb-2" style={{ color: "var(--text-mid)" }}>The scene you start in, before turn 1. Generate one, edit it, or clear it.</div>
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" disabled={openingBusy} onClick={async () => {
            setOpeningBusy(true);
            try { const v = await api.generateOpening(save.id); setSave(v); const op = v.history.find((h: any) => h.kind === "opening"); setOpeningText(op?.narrator_prose ?? ""); }
            catch (e: any) { alert(`Opening failed: ${e.message}`); }
            finally { setOpeningBusy(false); }
          }}>{openingBusy ? "writing…" : "Generate"}</button>
          <button className="btn btn-ghost flex-1" onClick={() => {
            const op = save.history.find((h: any) => h.kind === "opening");
            setOpeningText(op?.narrator_prose ?? "");
          }}>Edit</button>
        </div>
        {openingText !== null && (
          <div className="mt-2">
            <textarea className="field w-full" rows={6} value={openingText} onChange={(e) => setOpeningText(e.target.value)} style={{ fontSize: 13, lineHeight: 1.5 }} />
            <div className="flex gap-2 mt-2">
              <button className="btn btn-accent flex-1" onClick={async () => { setSave(await api.setOpening(save.id, openingText)); setOpeningText(null); }}>Save opening</button>
              <button className="btn btn-ghost" onClick={async () => { setSave(await api.setOpening(save.id, "")); setOpeningText(null); }}>Clear</button>
              <button className="btn btn-ghost" onClick={() => setOpeningText(null)}>Close</button>
            </div>
          </div>
        )}
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-2.5" style={{ color: "var(--text-lo)" }}>Palette (previews live — save to keep)</div>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <button key={t} className="chip" onClick={() => previewTheme(t)}
              style={theme === t ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
              {t}
            </button>
          ))}
        </div>

        <div className="font-mono text-[10px] uppercase tracking-widest mt-4 mb-2.5" style={{ color: "var(--text-lo)" }}>Narrator's typeface</div>
        <div className="flex flex-wrap gap-2">
          {PROSE_FONTS.map((f) => (
            <button key={f.id} className="chip" style={{
              textTransform: "none", fontFamily: f.stack, fontSize: 12, letterSpacing: 0,
              ...(proseFont === f.id ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : {}),
            }}
              onClick={() => { setProseFont(f.id); applyProseFont(f.id); }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[15px]" style={{ fontFamily: "var(--font-prose)", color: "var(--text-mid)" }}>
          The ice spoke first, a long groan from under the reeds. <span className="dlg">"Don't,"</span> Ettel said, without turning.
        </div>

        {ttsAvailable() && (
          <>
            <div className="font-mono text-[10px] uppercase tracking-widest mt-4 mb-2.5" style={{ color: "var(--text-lo)" }}>Reader (system voice — device setting)</div>
            <select className="field" value={tts.voiceURI ?? ""} onChange={(e) => updTts({ voiceURI: e.target.value || undefined })}>
              <option value="">System default voice</option>
              {listVoices().map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
            <div className="flex items-center gap-3 mt-2">
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>speed {(tts.rate ?? 1).toFixed(1)}×</span>
              <input type="range" min={0.5} max={1.6} step={0.1} value={tts.rate ?? 1} style={{ flex: 1 }}
                onChange={(e) => updTts({ rate: parseFloat(e.target.value) })} />
              <button className="chip" style={{ textTransform: "none" }}
                onClick={() => { stopSpeaking(); speak("The ice spoke first, a long groan from under the reeds."); }}>
                test
              </button>
            </div>
            <div className="text-[11px] mt-1.5" style={{ color: "var(--text-lo)" }}>
              Uses the voices installed on this phone (Settings → Accessibility → Spoken Content → Voices to add more). A read button sits under each narrator reply.
            </div>
          </>
        )}
      </div>
      <SectionHeader label="The machine" blurb="Keys, models, and token economics. Set once, forget mostly." />
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>OpenRouter key (stored on this device only)</div>
        <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} type="password"
          placeholder="sk-or-..." value={orKey} onChange={(e) => setOrKey(e.target.value)} />
        <button className="btn w-full mt-2" onClick={() => { setApiKey(orKey); setKeySaved(true); setTimeout(() => setKeySaved(false), 1400); }}>
          {keySaved ? <><Check size={14} /> saved locally</> : "Save key"}
        </button>
        <div className="text-[11px] italic mt-1.5" style={{ color: "var(--text-lo)" }}>
          The key lives in your browser's localStorage and is sent straight to OpenRouter. It never touches any other server. Get one at openrouter.ai/keys.
        </div>
      </div>

      <LocalAI presetApplied={!!prePreset} onRestore={() => {
        // Back to the snapshot if this session took one, otherwise to the engine defaults — a save
        // tuned last week has nothing to roll back TO, and that is the case the button exists for.
        setDraft((d) => ({ ...d, ...(prePreset ?? LOCAL_PRESET_DEFAULTS) }));
        setPrePreset(null);
      }} onPreset={() => {
        // THE SHAPE OF A TURN THAT FITS IN 64k. The narrator prompt is a compiled state document,
        // not a transcript — measured at 26.5k tokens on a long save, of which the rules contract
        // alone is 14.5k and replayed history is 8%. Lean prompts halve the contract; chat-log mode
        // makes the prefix append-only so a local server can reuse its KV cache instead of
        // reprocessing 20k tokens every turn; a slow re-anchor keeps that reuse across many turns.
        // Nothing here drops state — it drops PHRASING of state.
        setDraft((d) => {
          // Snapshot ONLY the fields the preset moves, so undo cannot quietly revert an unrelated
          // edit the player made in the same visit to this screen.
          const before: Partial<ModelSettings> = {};
          for (const k of Object.keys(LOCAL_PRESET) as (keyof ModelSettings)[]) (before as any)[k] = d[k];
          setPrePreset(before);
          return { ...d, ...LOCAL_PRESET };
        });
      }} />
      <BackgroundTurns />
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Models (OpenRouter ids, or local/…)</div>
        <ModelPicker label="Narrator — the voice" value={draft.narrator_model} onChange={setM("narrator_model")} />
        <ModelPicker label="Simulator — the bookkeeper" value={draft.simulator_model} onChange={setM("simulator_model")} />
        <ModelPicker label="Forge — world generation" value={draft.forge_model} onChange={setM("forge_model")} />
        <ModelPicker label="Fallback" value={draft.fallback_model} onChange={setM("fallback_model")} />
        {isLocalModel(draft.narrator_model) && isLocalModel(draft.fallback_model) && (
          // A fallback exists to be DIFFERENT. Pointing it at the same local model means a narrator
          // that returned garbage gets asked again, the same way, by the same weights — and the one
          // failure a local setup actually produces (a malformed response, not a refusal) is the one
          // that reproduces perfectly on retry.
          <div className="text-[11px] mt-1 mb-1" style={{ color: "var(--accent)" }}>
            Narrator and fallback are the same local model — so a bad turn is retried on the weights that just produced it, and nothing can rescue a local server that is down. Point the fallback at a cloud model.
          </div>
        )}
        <ModelPicker label="Images — portraits & scenes" value={draft.image_model} onChange={setM("image_model")} kind="image" />
        <div className="text-[11px] -mt-1 mb-1" style={{ color: "var(--text-lo)" }}>
          Live list from OpenRouter, newest first — search or type a custom id. Image field shows image-capable models.
        </div>
        <div className="text-[11px] italic mt-1" style={{ color: "var(--text-lo)" }}>
          Two calls per turn. Any slot can be a `local/…` id independently: the useful split is a LOCAL NARRATOR (the long creative call, and the expensive one) with a cloud bookkeeper. The reason is prefill, not capability — the bookkeeper's prompt is a different document, so running it locally too means a SECOND full prompt ingest every turn, and that is the wait you actually feel between beats. A model big enough to write well can usually keep the books; it just costs you double the slowest part of the turn to let it. Keep the fallback cloud-side so a stalled local server doesn't end the turn.
          Prefix `anthropic/` models get prompt-cache breakpoints automatically.
          Append ":online" to any model id (e.g. deepseek/deepseek-chat-v3-0324:online) and it gains live web search for grounding — works for the narrator, simulator, or forge.
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Context engine</div>
        <Toggle on={draft.context_mode === "chatlog"} onFlip={() => setDraft((d) => ({ ...d, context_mode: d.context_mode === "chatlog" ? "digest" : "chatlog" }))}
          title="Chat-log context (cache-first)"
          desc="The conversation becomes the context: a full state snapshot is anchored every few turns and each turn only appends. Providers with prefix caching (DeepSeek ~0.1x, Gemini ~0.25x) then bill nearly all input at the cached rate. Off = classic per-turn digest (maximum state fidelity)." />
        {draft.context_mode === "chatlog" && (
          <TextField label="Re-anchor cadence (turns between full state snapshots)" value={String(draft.iframe_cadence ?? 6)} onChange={(v) => setDraft((d) => ({ ...d, iframe_cadence: Math.max(2, Number(v) || 6) }))} mono />
        )}
        <Toggle on={draft.paging !== false} onFlip={() => setDraft((d) => ({ ...d, paging: d.paging === false ? true : false }))}
          title="Page out cold characters"
          desc="A central character who's been offscreen a while and isn't bonded to you drops to a one-line stub in context, and wakes the moment they appear or you name them. Their memory is untouched — only their card leaves the room." />
        <Toggle on={!!draft.habit_engine} onFlip={() => setDraft((d) => ({ ...d, habit_engine: !d.habit_engine }))}
          title="Habit engine (experimental)"
          desc="Core traits become firing habits that loosen only when a character sees themselves do them (clarity, not kindness) and deepen when they don't. Change is slow, directionless, and never chosen — a character finds out they've changed when someone else notices. Watch it in each character's drawer." />
        <Toggle on={draft.sim_route_speed !== false} onFlip={() => setDraft((d) => ({ ...d, sim_route_speed: d.sim_route_speed === false ? true : false }))}
          title="Bookkeeper: route for speed"
          desc="Send bookkeeping calls to the highest-throughput provider for the model instead of the cheapest. Bookkeeping is the wait you actually feel between turns; the narrator can still route by price below." />
        <Toggle on={!!draft.route_by_price} onFlip={() => setDraft((d) => ({ ...d, route_by_price: !d.route_by_price }))}
          title="Route by price"
          desc="Let OpenRouter send each call to the cheapest healthy provider for the chosen model. DeepSeek also discounts off-peak hours (≈16:30–00:30 UTC) automatically on its own end." />
        <Toggle on={draft.prefer_deepseek_provider !== false} onFlip={() => setDraft((d) => ({ ...d, prefer_deepseek_provider: d.prefer_deepseek_provider === false ? true : false }))}
          title="Prefer first-party DeepSeek"
          desc="For deepseek/* models, try DeepSeek's own provider first: its cache-hit rate (~0.8% of input price) is the cheapest long-context input on the platform. Unhealthy first-party falls back to the provider pool automatically. Note: your prompts go to DeepSeek's servers." />
        <Toggle on={!!draft.narrator_reasoning} onFlip={() => setDraft((d) => ({ ...d, narrator_reasoning: !d.narrator_reasoning }))}
          title="Narrator thinking (reasoning)"
          desc="Let the narrator deliberate before writing. Reasoning-tier models bill thinking as output tokens — thousands of invisible tokens per turn — and prose rarely improves enough to pay it. Off = thinking disabled on the narrator stream. Try a session each way and keep what reads better to you." />
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Token economy</div>
        <button className="w-full flex items-center justify-between py-2" onClick={() => setDraft((d) => ({ ...d, lean_mode: !d.lean_mode }))}>
          <span className="text-left">
            <span className="block text-[14px]">Lean mode</span>
            <span className="block text-[11px]" style={{ color: "var(--text-lo)" }}>Compressed instructions + only present/tracked cast in context. ~Half the input tokens, slightly less prose richness.</span>
          </span>
          <span style={{ width: 42, height: 24, borderRadius: 999, background: draft.lean_mode ? "var(--accent)" : "var(--ink-3)", position: "relative", flexShrink: 0, transition: "background .2s" }}>
            <span style={{ position: "absolute", top: 2, left: draft.lean_mode ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: "var(--ink-0)", transition: "left .2s" }} />
          </span>
        </button>
        <div className="mt-2">
          <TextField label="Token budget per turn (0 = off; e.g. 4000 to cap context)" value={String(draft.token_budget ?? 0)} onChange={(v) => setDraft((d) => ({ ...d, token_budget: Number(v) || 0 }))} mono />
          <div className="text-[11px] -mt-0.5" style={{ color: "var(--text-lo)" }}>
            When set, the per-turn context is trimmed toward this many input tokens — shedding offscreen detail, old memories, and rumors first, collapsing only the least-involved present characters as a last resort. People in your scene are never dropped.
          </div>
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Cost governor</div>
        <TextField label="Daily budget in USD (0 = off)" value={String(draft.daily_budget_usd ?? 0)} onChange={(v) => setDraft((d) => ({ ...d, daily_budget_usd: Number(v) || 0 }))} mono />
        <div className="text-[11px] -mt-0.5" style={{ color: "var(--text-lo)" }}>
          Soft ceiling, never a wall: past 70% of today's budget the engine quietly shifts to eco — lean prompts and a tightened context — for the rest of the day. Play is never blocked. The Play screen shows spend, the eco state, and cache hit rate live.
        </div>
        <TextField label="Auto-chapter every N turns (0 = off)" value={String(draft.chapter_cadence ?? 25)} onChange={(v) => setDraft((d) => ({ ...d, chapter_cadence: Number(v) || 0 }))} mono />
        <div className="text-[11px] -mt-0.5" style={{ color: "var(--text-lo)" }}>
          One cheap call per chapter distills the last stretch into a titled summary — shown in Chronicle, carried as one line each in context — so the verbatim history window can stay small without losing the arc.
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Cast</div>
        <div className="flex items-center justify-between">
          <span className="text-[14px]">Central characters</span>
          <span className="font-mono text-[13px]" style={{ color: "var(--accent)" }}>{draft.max_central_characters ?? 6}</span>
        </div>
        <input type="range" min={2} max={12} step={1} value={draft.max_central_characters ?? 6}
          onChange={(e) => setDraft((d) => ({ ...d, max_central_characters: Number(e.target.value) }))}
          className="w-full mt-1" style={{ accentColor: "var(--accent)" }} />
        <div className="text-[11px] mt-1" style={{ color: "var(--text-lo)" }}>
          How many full, autonomous characters the world holds at once — each with memory, goals, and inner life. Beyond this, new people enter as lightweight background figures (a guard, a vendor) that cost almost nothing and stay simple, until a central slot frees up. Fewer central characters means each gets more presence and autonomy; more means a busier, costlier cast. Default 6.
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Memory economy</div>
        <TextField label="Memories per NPC in context (top-k)" value={String(draft.context_memories_k)} onChange={setM("context_memories_k")} mono />
        <TextField label="Reflection cadence (turns)" value={String(draft.reflection_cadence)} onChange={setM("reflection_cadence")} mono />
        <TextField label="Verbatim history window (turns)" value={String(draft.history_window)} onChange={setM("history_window")} mono />
      </div>







      {inspecting && (
        <div style={{ position: "fixed", inset: 0, zIndex: 96, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="px-4 py-2 flex items-center gap-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="min-w-0">
              <div className="font-display text-[16px]">Inspector</div>
              <div className="text-[11px]" style={{ color: "var(--text-mid)" }}>Every field in this save, typed and searchable.</div>
            </div>
            <div style={{ flex: 1 }} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {/* Closing is the Inspector's call, not the header's — it knows whether there is unsaved
                work and writes it before it goes. A "done" button up here silently threw drafts away. */}
            <Inspector save={save} setSave={setSave} onClose={() => setInspecting(false)} />
          </div>
        </div>
      )}

      {worldJson !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 95, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="font-display text-[16px]">Raw world edit</div>
            <div className="text-[12px] mt-1" style={{ color: "var(--text-mid)" }}>
              World bible, threads, clocks, places, edges, canon. Delete a clock you don't want, retune the bible, fix the opening. Save writes it straight to the world.
            </div>
            {worldErr && <div className="text-[12px] mt-1.5 px-2 py-1 rounded" style={{ color: "var(--danger)", background: "rgba(200,60,60,.12)" }}>{worldErr}</div>}
            <div className="flex gap-2 mt-2.5">
              <button className="btn btn-accent" style={{ flex: 1 }} onClick={async () => {
                try { const parsed = JSON.parse(worldJson); setSave(await api.rawEditWorld(save.id, parsed)); setWorldJson(null); setWorldErr(""); }
                catch (e) { const m = e instanceof Error ? e.message : String(e); setWorldErr(m.includes("JSON") ? "Invalid JSON — check brackets and commas." : m); }
              }}>Save world</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setWorldJson(null); setWorldErr(""); }}>Cancel</button>
            </div>
          </div>
          <textarea value={worldJson} onChange={(e) => setWorldJson(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off"
            style={{ flex: 1, width: "100%", background: "var(--ink-1)", color: "var(--text-mid)", border: "none", padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5 }} />
        </div>
      )}


      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        const { name, json } = await api.exportSave(save.id);
        const filename = `${name}.weaver.json`;
        // 1) iOS/modern: native share sheet with a real file (Save to Files, AirDrop, Messages…)
        try {
          const file = new File([json], filename, { type: "application/json" });
          const nav = navigator as any;
          if (nav.canShare && nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: filename });
            return;
          }
        } catch (e: any) { if (e?.name === "AbortError") return; /* user cancelled */ }
        // 2) desktop: classic download
        try {
          const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const a = document.createElement("a");
          a.href = url; a.download = filename; document.body.appendChild(a); a.click();
          a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
          return;
        } catch { /* fall through */ }
        // 3) last resort: clipboard (paste into Notes/email; Import accepts pasted text)
        try { await navigator.clipboard.writeText(json); alert("Couldn't open a download here, so your save was copied to the clipboard. Paste it into Notes or email to keep it — you can re-import it later."); }
        catch { alert("Export failed on this browser. Try Copy save instead."); }
      }}>
        <Download size={14} /> Export save (share / download)
      </button>

      {/* REPAIR — ledger damage is fixable in place; you should not have to export and re-import a
          save to get a phantom out of the room. */}
      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        try {
          const { save: fresh, log } = await api.repairSave(save.id);
          setSave(fresh);
          alert(log.length ? `Repaired:\n\n${log.join("\n")}` : "Nothing to repair — the cast and the scene are consistent.");
        } catch (e: any) { alert(`Repair failed: ${e?.message ?? e}`); }
      }}>
        <Wrench size={14} /> Repair this save
        <span className="block text-[10.5px] font-normal normal-case tracking-normal" style={{ color: "var(--text-lo)" }}>
          removes cast members made of parse debris, and sends home anyone standing in a scene the prose never wrote them into
        </span>
      </button>

      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        const { json } = await api.exportSave(save.id);
        try { await navigator.clipboard.writeText(json); alert("Save copied to clipboard. Paste it somewhere safe (Notes, email). Re-import it later via Library → paste."); }
        catch {
          // clipboard blocked: drop the text into a prompt so it can be selected/copied manually
          window.prompt("Select all and copy your save:", json.slice(0, 100000));
        }
      }}>
        <Copy size={14} /> Copy save as text
      </button>

      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        const { json } = await api.exportSave(save.id);
        setRescueText(json);
      }}>
        <Copy size={14} /> Show save text (manual backup)
      </button>

      {rescueText !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="font-display text-[16px]">Your save — back it up</div>
            <div className="text-[12px] mt-1" style={{ color: "var(--text-mid)" }}>
              Tap and hold the text below → Select All → Copy. Paste into Notes or email. To restore later: Library → Paste a chronicle.
            </div>
            <div className="flex gap-2 mt-2.5">
              <button className="btn btn-accent" style={{ flex: 1 }} onClick={async () => {
                try { await navigator.clipboard.writeText(rescueText); alert("Copied to clipboard."); }
                catch { alert("Couldn't auto-copy — long-press the text and choose Select All → Copy."); }
              }}>Try auto-copy</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setRescueText(null)}>Done</button>
            </div>
          </div>
          <textarea
            readOnly
            value={rescueText}
            onFocus={(e) => e.currentTarget.select()}
            style={{ flex: 1, width: "100%", background: "var(--ink-1)", color: "var(--text-mid)", border: "none", padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.5, WebkitUserSelect: "text", userSelect: "text" }}
          />
        </div>
      )}

      <button className="btn btn-accent w-full" style={{ height: 48 }} onClick={commit}>
        {saved ? <><Check size={15} /> saved</> : "Save tuning"}
      </button>
    </div>
  );
}
