import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Feather, Users, Globe2, BarChart3, Moon, Sun, Settings2, ScrollText } from "lucide-react";
import { api, type ClientSave } from "./lib/api";
import { hasApiKey, setApiKey } from "./config";
import { watchForUpdate } from "./lib/freshness";
import Library from "./views/Library";
import Play from "./views/Play";
import Cast from "./views/Cast";
import World from "./views/World";
import Chronicle from "./views/Chronicle";
import Journal from "./views/Journal";
import Forge from "./views/Forge";
import Settings, { applyProseFont } from "./views/Settings";

export type Tab = "play" | "cast" | "world" | "journal" | "chronicle" | "settings";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "play", label: "Play", icon: Feather },
  { id: "cast", label: "Cast", icon: Users },
  { id: "world", label: "World", icon: Globe2 },
  { id: "journal", label: "Journal", icon: ScrollText },
  { id: "chronicle", label: "Chronicle", icon: BarChart3 },
  { id: "settings", label: "Tuning", icon: Settings2 },
];

/* SCREEN — the same rise-and-fade on every top-level swap.
   The `key` belongs on <Screen> at the call site, not in here: AnimatePresence
   reads the keys of its own children, and the motion.div inside picks up the exit
   through PresenceContext.
   Tab changes inside a game use `quick`: you switch tabs far more often than you
   switch modes, and a transition you see fifty times an hour has to get out of
   the way faster. */
function Screen({ quick, children }: { quick?: boolean; children: React.ReactNode }) {
  const d = quick ? 6 : 8;
  return (
    <motion.div className="absolute inset-0"
      initial={{ opacity: 0, y: d + 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -d }}
      transition={{ duration: quick ? 0.22 : 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

export default function App() {
  const [save, setSave] = useState<ClientSave | null>(null);
  const [tab, setTab] = useState<Tab>("play");
  const [mode, setMode] = useState<"library" | "forge" | "game">("library");
  const [lightMode, setLightMode] = useState(() => localStorage.getItem("weft-mode") === "light");
  const [needKey, setNeedKey] = useState(!hasApiKey());
  const [keyInput, setKeyInput] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", lightMode ? "light" : "dark");
    localStorage.setItem("weft-mode", lightMode ? "light" : "dark");
  }, [lightMode]);

  const theme = save?.world_bible.era_theme && save.world_bible.era_theme !== "auto"
    ? save.world_bible.era_theme : "ember";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => { applyProseFont(localStorage.getItem("weft-prose-font") ?? "newsreader"); }, []);

  /* iOS KEYBOARD — 100dvh ignores the software keyboard, so a focused composer
     used to slide under it. Track the visual viewport and size the shell to what
     is actually visible; the composer then docks just above the keys. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
      // keep the focused field in view when the keyboard shoves the layout up
      window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);

  const openSave = useCallback(async (id: string) => {
    const s = await api.save(id);
    setSave(s); setTab("play"); setMode("game");
  }, []);

  const closeSave = useCallback(() => { setSave(null); setMode("library"); }, []);

  const title = mode === "game" && save ? save.world_bible.name : mode === "forge" ? "The Forge" : "Weaver";
  const subtitle = mode === "game" && save ? `${save.world.current_time} · turn ${save.world.current_turn}` : "a world that reacts";

  // FRESHNESS — watch for a newer deploy and offer a reload. See lib/freshness.ts.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => watchForUpdate(() => setUpdateReady(true)), []);

  if (needKey) {
    return (
      <div className="shell">
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="card p-6 max-w-sm w-full">
            <div className="font-display text-[22px] mb-1" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>Weaver</div>
            <div className="text-[13.5px] mb-4" style={{ color: "var(--text-mid)" }}>
              A world that reacts. It runs entirely in your browser and talks to models through your own OpenRouter key — paste it once to begin.
            </div>
            <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} type="password"
              placeholder="sk-or-..." value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
            <button className="btn btn-accent w-full mt-3" disabled={!keyInput.trim()}
              onClick={() => { setApiKey(keyInput.trim()); setNeedKey(false); }}>
              Begin
            </button>
            {/* A KEY IS NOT ACTUALLY A REQUIREMENT ANY MORE. Point the four model slots at a local
                server and Weft never touches OpenRouter — so this gate must have a door in it, or a
                fully-local setup can't reach the settings screen that would configure it. */}
            <button className="btn w-full mt-2" onClick={() => setNeedKey(false)}>
              Skip — I'll use a local model
            </button>
            <div className="text-[11px] italic mt-3" style={{ color: "var(--text-lo)" }}>
              Stored only in this browser (localStorage), sent only to OpenRouter. Free & paid models at openrouter.ai/keys. You can change it later in Tuning — which is also where you point Weft at a local model (KoboldCpp, llama.cpp, LM Studio, Ollama) instead.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {updateReady && (
        // A tab left open keeps running the bundle it loaded. Without this the only signal that the
        // code in front of you is stale is hitting a bug that was fixed an hour ago.
        <button
          onClick={() => location.reload()}
          className="w-full text-center py-1.5 font-mono text-[10.5px] uppercase tracking-widest z-40"
          style={{ background: "var(--accent-soft)", color: "var(--accent)", borderBottom: "1px solid var(--accent-glow)" }}>
          a newer version of Weaver is available — tap to reload
        </button>
      )}
      <header className="topbar z-30">
        <div className="flex items-center justify-between px-4 py-2">
          <button className="text-left min-w-0" onClick={mode === "game" ? closeSave : undefined}>
            <div className="font-display text-[16.5px] leading-tight truncate" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>
              {title}
            </div>
            <div className="font-mono text-[9.5px] tracking-wider uppercase truncate" style={{ color: "var(--text-lo)" }}>
              {subtitle}
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <button className="icon-btn" onClick={() => setLightMode((v) => !v)} aria-label="toggle light and dark" title="toggle light and dark">
              {lightMode ? <Moon size={14} /> : <Sun size={14} />}
            </button>
            {mode === "game" && (
              <button className="icon-btn" onClick={closeSave} aria-label="back to library" title="back to library">
                <BookOpen size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait">
          {mode === "library" && (
            <Screen key="library">
              <Library onOpen={openSave} onForge={() => setMode("forge")} onCreated={(s) => { setSave(s); setMode("game"); setTab("play"); }} />
            </Screen>
          )}
          {mode === "forge" && (
            <Screen key="forge">
              <Forge onBack={() => setMode("library")} onCreated={(s) => { setSave(s); setMode("game"); setTab("play"); }} />
            </Screen>
          )}
          {mode === "game" && save && (
            <Screen key={`game-${tab}`} quick>
              {tab === "play" && <Play save={save} setSave={setSave} />}
              {tab === "cast" && <Cast save={save} setSave={setSave} />}
              {tab === "world" && <World save={save} onSave={setSave} />}
              {tab === "chronicle" && <Chronicle save={save} />}
              {tab === "journal" && <Journal save={save} onSave={setSave} />}
              {tab === "settings" && <Settings save={save} setSave={setSave} />}
            </Screen>
          )}
        </AnimatePresence>
      </main>

      {mode === "game" && save && (
        <nav className="tabbar z-30">
          <div className="flex items-stretch px-2">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button key={id} onClick={() => setTab(id)}
                  className={active ? "tab-btn on" : "tab-btn"}
                  aria-label={label} aria-current={active ? "page" : undefined} title={label}>
                  <Icon size={20} />
                  {active && (
                    <motion.div layoutId="tab-dot" className="tab-dot"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
