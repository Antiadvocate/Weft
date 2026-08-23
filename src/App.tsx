import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Feather, Users, Globe2, BarChart3, Moon, Sun, Settings2, ScrollText, HelpCircle } from "lucide-react";
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
import Coach from "./lib/Coach";
import Primer from "./lib/Primer";
import { TOURS, type TourId, tourSeen, markTourSeen, guidesOff, setGuidesOff, firstRun, markVisited } from "./lib/tour";

export type Tab = "play" | "cast" | "world" | "journal" | "chronicle" | "settings";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "play", label: "Play", icon: Feather },
  { id: "cast", label: "Cast", icon: Users },
  { id: "world", label: "World", icon: Globe2 },
  { id: "journal", label: "Journal", icon: ScrollText },
  { id: "chronicle", label: "Chronicle", icon: BarChart3 },
  { id: "settings", label: "Tuning", icon: Settings2 },
];

export default function App() {
  const [save, setSave] = useState<ClientSave | null>(null);
  const [tab, setTab] = useState<Tab>("play");
  /* THE FORGE IS THE FRONT DOOR. A first-time player opening on the library sees a list of other
     people's worlds and one dashed card at the bottom that happens to be the actual product. Land
     them in the Forge; the library is one tap away and becomes the landing once they have a save. */
  const [mode, setMode] = useState<"library" | "forge" | "game">(() => (firstRun() ? "forge" : "library"));
  const [lightMode, setLightMode] = useState(() => localStorage.getItem("weft-mode") === "light");
  const [needKey, setNeedKey] = useState(!hasApiKey());
  const [keyInput, setKeyInput] = useState("");
  /* ONBOARDING — a welcome card on the very first run, a spotlight guide per screen, and the full
     primer behind the "?" forever after. See lib/tour.ts. */
  const [welcome, setWelcome] = useState(() => firstRun());
  const [coach, setCoach] = useState<TourId | null>(null);
  const [primer, setPrimer] = useState(false);

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

  /* Which guide belongs to what is on screen right now. The game tabs share their id with their
     tour, so a new tab needs no wiring here. */
  const currentTour: TourId | null =
    mode === "library" ? "library" : mode === "forge" ? "forge" : (mode === "game" && save) ? (tab as TourId) : null;

  /* A screen explains itself the first time you reach it — once, ever, and never while the key gate
     or the welcome card is still up. The delay lets the view finish animating in, so the spotlight
     lands on where the button ACTUALLY is rather than where it was mid-transition. */
  useEffect(() => {
    if (welcome || needKey || !currentTour) return;
    if (guidesOff() || tourSeen(currentTour)) return;
    const id = currentTour;
    const t = window.setTimeout(() => { markTourSeen(id); setCoach(id); }, 480);
    return () => window.clearTimeout(t);
  }, [currentTour, welcome, needKey]);

  const openSave = useCallback(async (id: string) => {
    const s = await api.save(id);
    markVisited();
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
            {/* THE WAY BACK IN. Every screen's guide runs itself once; this is how you get it again,
                and it is the only control that is in the same place on every screen. */}
            {currentTour && (
              <button className="icon-btn" data-tour="help" onClick={() => setCoach(currentTour)}
                aria-label="what does everything on this screen do" title="what does everything on this screen do">
                <HelpCircle size={15} />
              </button>
            )}
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
            <motion.div key="library" className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <Library onOpen={openSave} onForge={() => setMode("forge")} onCreated={(s) => { markVisited(); setSave(s); setMode("game"); setTab("play"); }} />
            </motion.div>
          )}
          {mode === "forge" && (
            <motion.div key="forge" className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <Forge onBack={() => setMode("library")} onGuide={() => setPrimer(true)}
                onCreated={(s) => { markVisited(); setSave(s); setMode("game"); setTab("play"); }} />
            </motion.div>
          )}
          {mode === "game" && save && (
            <motion.div key={`game-${tab}`} className="absolute inset-0"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
              {tab === "play" && <Play save={save} setSave={setSave} />}
              {tab === "cast" && <Cast save={save} setSave={setSave} />}
              {tab === "world" && <World save={save} onSave={setSave} />}
              {tab === "chronicle" && <Chronicle save={save} />}
              {tab === "journal" && <Journal save={save} onSave={setSave} />}
              {tab === "settings" && <Settings save={save} setSave={setSave} onGuide={() => setPrimer(true)} />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── FIRST RUN ── the only thing between a stranger and the Forge. Three sentences on what
          this is, the one piece of syntax that is not guessable, and a door marked "I have played
          this sort of thing". Never shown twice. */}
      <AnimatePresence>
        {welcome && (
          <motion.div style={{ position: "fixed", inset: 0, zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="drawer-veil" style={{ position: "absolute", inset: 0 }} />
            <motion.div className="card p-5" style={{ position: "relative", width: "100%", maxWidth: 400, maxHeight: "100%", overflowY: "auto" }}
              initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}>
              <div className="font-display text-[23px] leading-tight mb-2" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>
                A world that reacts.
              </div>
              <div className="text-[13.5px] leading-relaxed space-y-2" style={{ color: "var(--text-mid)" }}>
                <p>Describe a place. The engine builds the people, what they want, and the trouble already coming.</p>
                <p>Then you live in it. Nothing is on rails.</p>
                <p style={{ color: "var(--text-lo)" }}>
                  The one thing to know: in the message box{" "}
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>"quotes"</span> are spoken,{" "}
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>*asterisks*</span> are private thoughts,
                  and the rest is what you do.
                </p>
              </div>

              <button className="btn btn-accent w-full mt-4" style={{ height: 46 }}
                onClick={() => { markVisited(); setWelcome(false); }}>
                Build a world
              </button>
              <div className="flex gap-2 mt-2">
                <button className="btn flex-1" onClick={() => setPrimer(true)}>Cheat sheet</button>
                <button className="btn flex-1" onClick={() => { markVisited(); setGuidesOff(true); setWelcome(false); }}>
                  Skip the guides
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {coach && <Coach key={coach} steps={TOURS[coach]} onDone={() => setCoach(null)} />}
      {primer && <Primer onClose={() => setPrimer(false)} />}

      {mode === "game" && save && (
        <nav className="tabbar z-30">
          <div className="flex items-stretch px-2" data-tour="tabs">
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
