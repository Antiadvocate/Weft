import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Compass, CornerDownLeft, Crosshair, Globe, Image as ImageIcon, Leaf, Moon, Play as PlayIcon, RotateCcw, Volume2, VolumeX, X , Ban } from "lucide-react";
import { speak, stopSpeaking, ttsAvailable } from "../lib/tts";
import { api, streamTurn, resumePending, governorState, type ActionMode, type ClientSave } from "../lib/api";
import Cast from "./Cast";
import World from "./World";
import Chronicle from "./Chronicle";
import { Seismograph } from "../lib/charts";
import { AnalogClock, WeatherIcon } from "../lib/format";

const PHASE_LABEL: Record<string, string> = {
  pressure: "reading the room",
  narrator: "the world responds",
  simulator: "recording changes",
  apply: "applying consequences",
  reflection: "updating memories",
  "world-turning": "advancing the world",
  eco: "eco — reduced spending today",
  undertow: "updating world systems",
  interlude: "days pass",
};

const MODES: { id: ActionMode; label: string }[] = [
  { id: "do", label: "Do" },
  { id: "story", label: "Story" },
];

interface Tip { name: string; x: number; y: number }

export default function Play({ save, setSave }: { save: ClientSave; setSave: (s: ClientSave) => void }) {
  const draftKey = `weft-draft-${save.id}`;
  const [action, setAction] = useState(() => sessionStorage.getItem(draftKey) ?? "");
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<ActionMode>("do");
  const [ground, setGround] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [liveProse, setLiveProse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rerunning, setRerunning] = useState<number | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [tip, setTip] = useState<Tip | null>(null);
  const [illustrating, setIllustrating] = useState(false);
  const [observing, setObserving] = useState(false);
  const [chaptering, setChaptering] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [proseDone, setProseDone] = useState(false);
  const [armedRollback, setArmedRollback] = useState<number | null>(null);
  const [undoTurn, setUndoTurn] = useState<number | null>(null);
  const [rolledTo, setRolledTo] = useState<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [drawer, setDrawer] = useState<null | "cast" | "world" | "chronicle">(null);
  const [drawerSel, setDrawerSel] = useState<string | null>(null);
  const observingRef = useRef(false);
  const runningRef = useRef(false);
  const [hasPending, setHasPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastId = useRef(0);

  const history = save.history;

  const [readingTurn, setReadingTurn] = useState<number | null>(null);
  const toggleRead = (turn: number, prose: string) => {
    if (readingTurn === turn) { stopSpeaking(); setReadingTurn(null); return; }
    stopSpeaking();
    setReadingTurn(turn);
    speak(prose, () => setReadingTurn((cur) => (cur === turn ? null : cur)));
  };
  useEffect(() => () => stopSpeaking(), []); // leaving the view stops the reader
  const nameIndex = useMemo(() => {
    const ix: Record<string, string> = {};
    for (const [id, c] of Object.entries(save.characters)) if (id !== "char_player") ix[c.name.toLowerCase()] = id;
    for (const [id, c] of Object.entries(save.characters)) if (id !== "char_player") for (const a of c.aliases ?? []) if (a.trim().length >= 3 && !ix[a.toLowerCase()]) ix[a.toLowerCase()] = id;
    return ix;
  }, [save.characters]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveProse, history.length, phase]);

  // never lose a draft: tab switches, remounts, failures — it survives
  useEffect(() => { sessionStorage.setItem(draftKey, action); }, [action, draftKey]);

  const pushToasts = (lines: string[]) => {
    lines.slice(0, 3).forEach((text, i) => {
      setTimeout(() => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
      }, i * 900);
    });
  };

  /** PIPELINE OVERLAP — the prose is the part you read; the bookkeeping is the part you wait
   *  for. Once the narrator finishes streaming, the composer re-arms while the bookkeeper works
   *  in the background: type freely, and a submitted action queues and fires the instant the
   *  turn commits. On a slow bookkeeper this hides most or all of its latency behind the time
   *  you'd spend reading and typing anyway. One action queues; a failed turn returns it. */
  const runAction = async (a: string) => {
    if (!a) return;
    setAction(""); setError(null); setRunning(true); runningRef.current = true; setProseDone(false); setLiveProse(""); setPhase("pressure");
    let failed = false;
    try {
      await streamTurn(save.id, a, mode, {
        onPhase: (p) => { setPhase(p); if (p && p !== "pressure" && p !== "narrator" && p !== "eco") setProseDone(true); },
        onDelta: (t) => setLiveProse((p) => p + t),
        onMeta: (m) => { if (Array.isArray((m as any).shifts)) pushToasts((m as any).shifts as string[]); },
        onDone: (s) => { setSave(s); setLiveProse(""); setPhase(null); sessionStorage.removeItem(draftKey); },
        onError: (msg) => { setError(msg); failed = true; },
      }, { ground });
    } catch (e: any) {
      if (e.name !== "AbortError") { setError(e.message ?? "turn failed"); failed = true; }
    } finally {
      setRunning(false); runningRef.current = false; setProseDone(false); setPhase(null);
      const pend = pendingRef.current; pendingRef.current = null; setHasPending(false);
      if (failed) setAction(pend ? `${a}\n${pend}` : a); // a failed turn gives your words back
      else if (pend) void runAction(pend);               // fire the queued action immediately
    }
  };

  useEffect(() => {
    api.hasRollbackRecovery(save.id).then((r) => setUndoTurn(r.available ? (r.turn ?? 0) : null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.id]);

  // ── RESUME A TURN KILLED MID-FLIGHT (iOS suspends backgrounded pages): on open and on
  // returning to the app, finish any journaled turn — bookkeeping only, no narrator re-buy.
  useEffect(() => {
    let busy = false;
    const tryResume = async () => {
      // runningRef, not the `running` state: this closure is created once per save and the
      // state value goes stale — the old check let a resume fire DURING a live turn (clearing
      // its crash journal, or re-running the simulator against a half-finished turn).
      if (busy || runningRef.current) return;
      busy = true;
      let touched = false;
      try {
        const r = await resumePending(save.id, { onPhase: (p) => { touched = true; setRunning(true); setPhase(p ?? "simulator"); } });
        if (r.kind === "restore_action") { setAction((a) => a || r.action); pushToasts(["that turn never finished — your action is back in the input box"]); }
        if (r.kind === "completed") { setSave(r.save); pushToasts(["finished recording the interrupted turn"]); }
      } catch { /* journal stays; next resume retries */ }
      finally { busy = false; if (touched) { setRunning(false); setPhase(null); } }
    };
    void tryResume();
    const onVis = () => { if (document.visibilityState === "visible") void tryResume(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.id]);

  const submit = async () => {
    const a = action.trim();
    if (!a) return;
    if (running) {
      if (proseDone && !pendingRef.current) { pendingRef.current = a; setHasPending(true); setAction(""); pushToasts(["queued — sends when this turn finishes recording"]); }
      return;
    }
    await runAction(a);
  };

  const doRollback = async (turn: number) => {
    const loss = save.world.current_turn - turn;
    // ARMED CONFIRM: any rollback erasing more than 10 turns takes two deliberate taps, with
    // the cost stated. One mistap must never eat a campaign.
    if (loss > 10 && armedRollback !== turn) { setArmedRollback(turn); return; }
    setArmedRollback(null); setRollbackOpen(false);
    const before = save.world.current_turn;
    setSave(await api.rollback(save.id, turn));
    setUndoTurn(before); setRolledTo(turn);
    pushToasts([`rolled back to turn ${turn} — undo available`]);
  };

  const doUndoRollback = async () => {
    try { setSave(await api.undoRollback(save.id)); setUndoTurn(null); pushToasts(["rollback undone"]); }
    catch (e: any) { setError(e.message ?? "nothing to undo"); }
  };

  /** Re-run the bookkeeper on a turn whose prose is fine but whose bookkeeping died. */
  const doRerun = async (turn: number) => {
    if (rerunning !== null) return;
    setRerunning(turn);
    const before = save.world.current_turn;
    try {
      setSave(await api.rerunBookkeeper(save.id, turn, { onPhase: () => {}, onDelta: () => {}, onMeta: () => {} }));
      setUndoTurn(before);
      pushToasts(["bookkeeper re-run — the prose is unchanged"]);
    } catch (e: any) { setError(e.message ?? "re-run failed"); }
    finally { setRerunning(null); }
  };

  /** THE VETO. Strike what the narrator invented — roll back past it and forbid it forever. */
  const doStrike = async (turn: number) => {
    const what = prompt(
      `Strike from the story — what did the narrator get wrong?\n\nEverything from turn ${turn} on is rolled back, and this becomes a standing rule the narrator cannot break.\n\ne.g. "There is no boy named Leo. No males exist in the Dominion except Rabi."`
    );
    if (!what?.trim()) return;
    const before = save.world.current_turn;
    try {
      setSave(await api.strike(save.id, what.trim(), turn - 1));
      setUndoTurn(before); setRolledTo(turn - 1);
      pushToasts([`struck — rolled back to turn ${turn - 1}`, "the narrator will never write it again"]);
    } catch (e: any) { setError(e.message ?? "strike failed"); }
  };

  const doSkip = async (days: number) => {
    if (skipping) return;
    setSkipOpen(false); setSkipping(true); setError(null); setPhase("world-turning");
    try {
      const s = await api.advance(save.id, days);
      setSave(s);
      const latest = s.history[s.history.length - 1];
      if (latest?.shifts?.length) pushToasts(latest.shifts);
    } catch (e: any) { setError(e.message ?? "time skip failed"); }
    finally { setSkipping(false); setPhase(null); }
  };

  /** Observer: run ONE autonomous turn. You watch; the world and your own character
   *  act on their own. One press = one beat. */
  const runObserve = async () => {
    if (running || observingRef.current) return;
    observingRef.current = true; setObserving(true); setError(null);
    setRunning(true); runningRef.current = true; setLiveProse(""); setPhase("pressure");
    await new Promise<void>((resolve) => {
      streamTurn(save.id, "", "story", {
        onPhase: setPhase,
        onDelta: (t) => setLiveProse((p) => p + t),
        onMeta: (m) => { if (Array.isArray((m as any).shifts)) pushToasts((m as any).shifts as string[]); },
        onDone: (s) => { setSave(s); setLiveProse(""); setPhase(null); resolve(); },
        onError: (msg) => { setError(msg); resolve(); },
      }, { observe: true }).catch((e) => { setError(e?.message ?? "turn failed"); resolve(); });
    });
    setRunning(false); runningRef.current = false; setPhase(null);
    observingRef.current = false; setObserving(false);
  };

  const illustrateLatest = async () => {    if (illustrating || !history.length) return;
    setIllustrating(true); setError(null);
    try {
      const { save: s } = await api.illustrate(save.id, history[history.length - 1].turn);
      setSave(s);
    } catch (e: any) { setError(e.message); } finally { setIllustrating(false); }
  };

  /** Disco-style prose renderer: "dialogue" gets the accent ink; known names become tappable refs. */
  const renderParagraph = (text: string, key: React.Key, animate: boolean) => {
    const nodes: React.ReactNode[] = [];
    // split on double-quoted spans (straight + curly)
    const parts = text.split(/("[^"]+"|“[^”]+”)/g);
    parts.forEach((part, pi) => {
      const isDlg = /^["“]/.test(part);
      const sub = renderNames(part, `${key}-${pi}`);
      nodes.push(isDlg ? <span key={`${key}-${pi}`} className="dlg">{sub}</span> : <React.Fragment key={`${key}-${pi}`}>{sub}</React.Fragment>);
    });
    return <p key={key} style={animate ? undefined : { animation: "none" }}>{nodes}</p>;
  };

  const renderNames = (text: string, keyBase: string): React.ReactNode[] => {
    const names = Object.keys(nameIndex).filter((n) => n.length >= 2);
    if (!names.length) return [text];
    const re = new RegExp(`\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    const out: React.ReactNode[] = [];
    let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const nm = m[0];
      out.push(
        <span key={`${keyBase}-n${i++}`} className="name-ref"
          onClick={(e) => {
            const r = (e.target as HTMLElement).getBoundingClientRect();
            setTip({ name: nm, x: r.left, y: r.bottom });
          }}>{nm}</span>
      );
      last = m.index + nm.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  const tipChar = tip ? save.characters[nameIndex[tip.name.toLowerCase()]] : null;
  const tipId = tipChar?.character_id;
  const tipPsy = tipId ? save.condition[tipId]?.psyche : null;
  const tipEdge = tipId ? save.world.edges.find((e) => e.from === tipId && e.to === "char_player") : null;
  const tipMem = tipId ? save.memory[tipId]?.episodic.slice(-1)[0] : null;
  // theory of mind: what THEY believe about you, and how far it's drifted from the truth
  const tipBelief = tipId ? (save as any).minds?.[tipId]?.about?.find((b: any) => b.target === "char_player") : null;
  const tipDivergence = tipBelief && tipEdge ? Math.abs((tipEdge.warmth ?? 0) - tipBelief.predicted_warmth) : 0;

  return (
    <div className="h-full flex flex-col">
      {/* toasts */}
      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} className="toast"
              initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>



      {/* seismograph strip */}
      <div className="px-4 pt-2 pb-1.5 flex items-center gap-2">
        <div className="seismo flex-1 px-1">
          <Seismograph trace={save.pressure_trace} overlay={save.telemetry.map((t) => (t.player_mood_valence ?? 0) / 16)} />
        </div>
        <button className="chip" onClick={runObserve} disabled={running} title="watch one turn play itself">
          <PlayIcon size={11} />
        </button>
        <button className="chip" onClick={async () => {
          const cur = save.world_bible.narrator_direction ?? "";
          const next = window.prompt("Standing direction for the narrator — takes effect on the next turn, overrides everything. What is this story about, or how should it be told? (blank to clear)", cur);
          if (next === null) return; // cancelled
          setSave(await api.edit(save.id, { world_bible: { narrator_direction: next.trim() } }));
        }} title={save.world_bible.narrator_direction ? "change narrator direction (set)" : "set narrator direction"}
          style={save.world_bible.narrator_direction ? { color: "var(--accent)", borderColor: "var(--accent-glow)" } : undefined}>
          <Compass size={11} />
        </button>
        <button className="chip" onClick={() => setSkipOpen(true)} disabled={running || skipping}>
          <Moon size={11} />
        </button>
        <button className="chip" disabled={running || chaptering} title="refresh — condense memory to clean up drift, same moment and relationships, clears runaway threads (fixes recap confusion)"
          onClick={async () => {
            if (!confirm("Refresh this game? Same moment, same people and relationships — the bookkeeper condenses each character's memory to clear accumulated drift, keeping the full record underneath, and clears stale threads/consequences so runaway plots stop regenerating. No time skip. This can take a moment as it processes each character.")) return;
            setChaptering(true);
            try { setSave(await api.refreshContext(save.id)); }
            catch (e: any) { alert(`Refresh failed: ${e.message}`); }
            finally { setChaptering(false); }
          }}>
          <BookOpen size={11} />
        </button>
        <button className="chip" onClick={() => setRollbackOpen(true)} disabled={!save.snapshot_turns.length}>
          <RotateCcw size={11} /> {save.world.current_turn}
        </button>
        {undoTurn !== null && rolledTo === save.world.current_turn && (
          <button className="chip" onClick={doUndoRollback} title={`undo rollback — return to turn ${undoTurn}`}
            style={{ color: "var(--accent)" }}>
            <RotateCcw size={11} style={{ transform: "scaleX(-1)" }} /> {undoTurn}
          </button>
        )}

      </div>

      {(() => {
        const gov = governorState(save as any);
        const sess = save.telemetry;
        const inTok = sess.reduce((a, t) => a + t.narrator_tokens_in + t.simulator_tokens_in, 0);
        const cached = sess.reduce((a, t) => a + (t.cached_tokens ?? 0), 0);
        const hit = inTok > 0 ? Math.round((cached / inTok) * 100) : 0;
        const spend = sess.reduce((a, t) => a + (t.turn_cost ?? 0), 0);
        return (
          <div className="px-4 pb-0.5 font-mono text-[9px] uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--text-lo)", opacity: 0.7 }}>
            <span>{spend > 0 ? `$${spend.toFixed(2)}` : ""}{spend > 0 ? ` · ${hit}% cached` : ""}</span>
            {gov.budget > 0 && gov.eco && <span className="flex items-center gap-1" style={{ color: "var(--accent)" }}><Leaf size={9} /> eco</span>}
            {save.model_settings.lean_mode && <span>· lean</span>}
          </div>
        );
      })()}

      {/* prose scroll */}
      <div ref={scrollRef} className="scroll-y flex-1 px-5 pb-4">
        {history.length === 0 && !liveProse && (
          <div className="pt-10 text-center">
            <div className="font-display text-lg mb-1.5">Ready to begin.</div>
            <div className="text-[13.5px]" style={{ color: "var(--text-mid)" }}>
              Type an action or narration. The world responds — and keeps moving when you look away.
            </div>
          </div>
        )}
        <div className="prose-stream pt-3">
          {history.map((h) => (
            <div key={`${h.kind ?? "turn"}-${h.turn}`}>
              {h.kind === "interlude" ? (
                <div className="interlude my-5">
                  <div className="interlude-rule"><span>✦ {h.span_label} ✦</span></div>
                  {h.narrator_prose.split(/\n{2,}/).map((p, i) => (
                    <p key={i} className="interlude-prose" style={{ animation: "none" }}>{p}</p>
                  ))}
                  <div className="interlude-rule"><span>{h.time_label}</span></div>
                </div>
              ) : h.kind === "opening" ? (
                <div className="interlude-rule mb-3"><span>the beginning</span></div>
              ) : (
              <div className="player-echo">
                {h.action_mode === "say" ? `“${h.player_action}”` : h.player_action}
              </div>
              )}
              {h.kind !== "interlude" && h.illustration_url && <img className="scene-img" src={h.illustration_url} alt="" onClick={() => setLightbox(h.illustration_url!)} style={{ cursor: "zoom-in" }} />}
              {h.kind !== "interlude" && h.narrator_prose.split(/\n{2,}/).map((p, i) => renderParagraph(p, `${h.turn}-${i}`, false))}
              {h.kind !== "interlude" && h.narrator_prose.trim() && (h.bookkeeping === "thin" || h.bookkeeping === "failed") && (
                <div className="flex items-center gap-2 mb-1.5 p-2 rounded-lg" style={{ background: "var(--ink-1)" }}>
                  <div className="flex-1 text-[11.5px] leading-snug" style={{ color: "var(--text-mid)" }}>
                    {h.bookkeeping === "failed"
                      ? "The bookkeeper failed on this turn — nothing was recorded."
                      : "The bookkeeper recorded nothing here. Nobody remembered this."}
                  </div>
                  <button className="chip shrink-0" disabled={rerunning !== null}
                    onClick={() => doRerun(h.turn)}
                    title="re-run the bookkeeper on this turn — the prose is kept, only the record is rebuilt">
                    {rerunning === h.turn ? "re-running…" : "re-run"}
                  </button>
                </div>
              )}
              {h.kind !== "interlude" && h.narrator_prose.trim() && (
                <div className="flex items-center gap-3 mb-1">
                  <button className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--text-lo)" }}
                    onClick={() => doStrike(h.turn)}
                    title="strike this from the story — roll back past it and forbid it forever">
                    <Ban size={12} /> strike
                  </button>
                  <button className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--text-lo)" }} disabled={rerunning !== null}
                    onClick={() => doRerun(h.turn)}
                    title="re-run the bookkeeper — keeps the prose, rebuilds memories and feelings">
                    <RotateCcw size={12} /> {rerunning === h.turn ? "re-running…" : "re-run records"}
                  </button>
                </div>
              )}
              {h.kind !== "interlude" && h.narrator_prose.trim() && ttsAvailable() && (
                <button className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest mb-1"
                  style={{ color: readingTurn === h.turn ? "var(--accent)" : "var(--text-lo)" }}
                  onClick={() => toggleRead(h.turn, h.narrator_prose)}
                  title={readingTurn === h.turn ? "stop reading" : "read aloud (system voice)"}>
                  {readingTurn === h.turn ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  {readingTurn === h.turn ? "stop" : "read"}
                </button>
              )}
              {(h.shifts?.length || h.offscreen.length) ? (
                <details className="shifts my-3 pl-3 border-l" style={{ borderColor: "var(--line)" }}>
                  <summary className="font-mono text-[10px] uppercase tracking-widest py-0.5 flex items-center gap-2" style={{ color: "var(--text-lo)" }}>
                    <span>◆ what shifted</span>
                    <span className="flex items-center gap-1.5 normal-case tracking-normal" style={{ color: "var(--text-mid)" }}>
                      <AnalogClock label={h.time_label} /> {h.time_label.match(/\d{1,2}:\d{2}/)?.[0] ?? ""}
                      <WeatherIcon weather={h.weather} />
                    </span>
                    {h.turn === history[history.length - 1].turn && !h.illustration_url && (
                      <button className="ml-auto flex items-center" style={{ color: illustrating ? "var(--accent)" : "var(--text-lo)" }}
                        title={illustrating ? "painting…" : "illustrate this moment"}
                        onClick={(e) => { e.preventDefault(); illustrateLatest(); }}>
                        <ImageIcon size={13} className={illustrating ? "shimmer" : undefined} />
                      </button>
                    )}
                  </summary>
                  <div className="pt-1 space-y-0.5">
                    {h.directive && (
                      <div className="font-mono text-[10px] leading-relaxed pb-1.5 whitespace-pre-wrap" style={{ color: "var(--text-lo)" }}>
                        <span style={{ color: "var(--accent)" }}>DIRECTION GIVEN → </span>{h.directive}
                      </div>
                    )}
                    {(h.shifts ?? []).map((s, i) => <div key={`s${i}`} className="shift-line">{s}</div>)}
                    {h.offscreen.map((o, i) => (
                      <div key={`o${i}`} className="font-mono text-[11px] leading-relaxed" style={{ color: "var(--text-lo)" }}>✧ {o}</div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ))}
          {liveProse && liveProse.split(/\n{2,}/).map((p, i, arr) => renderParagraph(p, `live-${i}`, i === arr.length - 1))}
        </div>

        <AnimatePresence>
          {phase && (
            <motion.div key={phase} className="font-mono text-[11px] uppercase tracking-widest py-2"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="shimmer">{PHASE_LABEL[phase] ?? phase}…</span>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="card p-3 my-3 font-mono text-[12px]" style={{ color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" }}>
            {error}
          </div>
        )}
      </div>

      {/* the clock — tap to correct it when the bookkeeper drifts from the prose */}
      <div className="px-4 pt-1.5 pb-0.5">
        <button className="font-mono text-[10px] inline-flex items-center gap-1" style={{ color: "var(--text-lo)" }}
          onClick={async () => {
            const cur = save.world.current_time;
            const next = window.prompt("Set the in-world time (e.g. \"Day 2, 08:00\" or \"Day 3, 14:30\"):", cur.replace(/\s*\(.*\)$/, ""));
            if (next && next.trim() && next.trim() !== cur) setSave(await api.setTime(save.id, next.trim()));
          }}>
          🕐 {save.world.current_time}
        </button>
      </div>

      {/* who's in the scene with you — collapsed to a single tappable chip to save room for narrative */}
      {save.world.present.length > 0 && (
        <div className="px-4 pt-1 pb-0.5">
          <button onClick={() => setPresentOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[11px]"
            style={{ color: "var(--text-lo)" }} title="tap to see who's here">
            <span className="font-mono text-[9px] uppercase tracking-wider">here:</span>
            <span style={{ color: "var(--text-mid)" }}>
              {presentOpen
                ? ""
                : save.world.present.length <= 2
                  ? save.world.present.map((p) => save.characters[p]?.name).filter(Boolean).join(", ")
                  : `${save.world.present.length} present`}
            </span>
            <span className="font-mono text-[9px]">· {save.world.places[save.world.player_location]?.name ?? ""}</span>
            <span style={{ fontSize: 8, opacity: 0.6 }}>{presentOpen ? "▲" : "▼"}</span>
          </button>
          {presentOpen && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {save.world.present.map((pid) => {
                const ch = save.characters[pid];
                if (!ch) return null;
                return (
                  <button key={pid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                    style={{ background: "var(--ink-2)", fontSize: 11.5 }}
                    title={`open ${ch.name}`}
                    onClick={() => { setDrawerSel(pid); setDrawer("cast"); }}>
                    {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-4 h-4 rounded-full object-cover" />}
                    {ch.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* focus / converge toggle */}
      <div className="px-4 pb-1">
        {save.world.focus ? (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--accent-soft, rgba(180,140,90,.12))", border: "1px solid var(--accent-glow, rgba(180,140,90,.3))" }}>
            <Crosshair size={13} style={{ color: "var(--accent)" }} className="shrink-0" />
            <span className="text-[12px] truncate flex-1" style={{ color: "var(--text-mid)" }}>
              {save.world.focus.mode === "active" ? "in:" : "converging on:"} {save.world.focus.label}
            </span>
            <button onClick={async () => setSave(await api.setFocus(save.id, null))} className="shrink-0" title="release focus">
              <X size={14} style={{ color: "var(--text-lo)" }} />
            </button>
          </div>
        ) : (
          <button className="flex items-center text-[11px]" style={{ color: "var(--text-lo)" }}
            title="Focus on an event — the story builds toward it, then shifts into it when it arrives"
            onClick={async () => {
              const hottest = [...save.world.threads].sort((a, b) => b.tension - a.tension)[0];
              const suggest = save.world.consequences.find((c) => c.status === "pending")?.description || hottest?.title || "";
              const ev = window.prompt("Drive toward which event? The story will build toward it (no new chaos), then automatically shift into it when it arrives.", suggest);
              if (ev && ev.trim()) setSave(await api.setFocus(save.id, ev.trim()));
            }}>
            <Crosshair size={14} />
          </button>
        )}
      </div>

      {/* composer */}
      <div className="px-4 pb-2.5 pt-1">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 pb-1">
            {MODES.map((m) => (
              <button key={m.id}
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={mode === m.id
                  ? { color: "var(--accent)", background: "var(--accent-soft)" }
                  : { color: "var(--text-lo)" }}
                onClick={() => setMode(m.id)}>{m.label}</button>
            ))}
            <button
              className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 mt-0.5"
              style={ground ? { color: "var(--accent)", background: "var(--accent-soft)" } : { color: "var(--text-lo)" }}
              title="Ground this reply with a live web search (real places/facts). Costs more for this turn."
              onClick={() => setGround((g) => !g)}>
              <Globe size={10} /> web
            </button>
          </div>
          <textarea
            className="field flex-1"
            rows={focused || action.includes("\n") || action.length > 60 ? 3 : 1}
            style={{ transition: "height .18s ease", padding: focused ? undefined : "10px 14px" }}
            placeholder=""
            value={action}
            enterKeyHint="send"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setAction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
          />
          <motion.button className="btn btn-accent" style={{ height: 44, width: 46, padding: 0 }}
            whileTap={{ scale: 0.92 }} onClick={submit} disabled={(running && !proseDone) || !action.trim() || hasPending}>
            <CornerDownLeft size={16} />
          </motion.button>
        </div>
      </div>

      {/* DE-style name tooltip */}
      <AnimatePresence>
        {tip && tipChar && (
          <>
            <div className="tip-veil" onClick={() => setTip(null)} />
            <motion.div className="tip-card"
              style={{ left: Math.min(tip.x, window.innerWidth - 316), top: Math.min(tip.y + 8, window.innerHeight - 220) }}
              initial={{ opacity: 0, scale: 0.92, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1.2] }}>
              <div className="flex gap-3">
                {tipChar.portrait_url && <img src={tipChar.portrait_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ border: "1px solid var(--line-strong)" }} />}
                <div className="min-w-0">
                  <div className="tip-kicker">{tipPsy ? `${tipPsy.mood} · ${tipPsy.state}` : "presence"}</div>
                  <div className="font-display text-[16px]">{tipChar.name}</div>
                </div>
              </div>
              {tipEdge && (
                <div className="font-mono text-[10.5px] mt-2" style={{ color: tipEdge.warmth >= 0 ? "var(--calm)" : "var(--danger)" }}>
                  {tipEdge.warmth >= 20 ? "warm toward you" : tipEdge.warmth <= -20 ? "cold toward you" : "unresolved about you"} · trust {tipEdge.trust}
                  {tipEdge.notes ? <span style={{ color: "var(--text-lo)" }}> — {tipEdge.notes}</span> : null}
                </div>
              )}
              {tipBelief && (tipBelief.held_false || tipDivergence > 20 || tipBelief.surprise > 0.4) && (
                <div className="mt-2 pl-2.5 py-1.5 rounded" style={{ borderLeft: "2px solid var(--accent-glow, rgba(180,140,90,.4))", background: "var(--accent-soft, rgba(180,140,90,.08))" }}>
                  <div className="font-mono text-[8.5px] uppercase tracking-wider" style={{ color: "var(--accent)" }}>their read of you {tipDivergence > 20 ? "· off the mark" : ""}</div>
                  <div className="text-[11.5px] mt-0.5 leading-snug" style={{ color: "var(--text-mid)" }}>
                    {tipBelief.held_false
                      ? `Wrongly ${tipBelief.held_false.replace(/^is /, "").replace(/^can't/, "can't")}.`
                      : tipBelief.predicted_stance === "ally" ? "Reads you as an ally."
                      : tipBelief.predicted_stance === "rival" ? "Reads you as a threat."
                      : "Can't place you yet."}
                    {tipBelief.surprise > 0.4 ? " Freshly thrown by something you did." : ""}
                  </div>
                </div>
              )}
              {tipMem && (
                <div className="text-[12px] italic mt-2 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                  Last carried: “{tipMem.content}”
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* skip drawer — let the world turn */}
      <AnimatePresence>
        {skipOpen && (
          <>
            <motion.div className="drawer-veil fixed inset-0 z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSkipOpen(false)} />
            <motion.div className="drawer fixed bottom-0 left-0 right-0 z-50 px-5"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}>
              <div className="grab" />
              <div className="py-2">
                <div className="font-display text-[16px]">Let the world turn.</div>
                <div className="text-[12.5px] mt-0.5" style={{ color: "var(--text-mid)" }}>
                  Step away. Drives advance, rumors saturate, clocks fill and fire, bodies heal. You return to whatever it became.
                </div>
              </div>
              <div className="pb-5 grid grid-cols-2 gap-2">
                {[["Overnight", 1], ["Three days", 3], ["A week", 7], ["A fortnight", 14]].map(([label, d]) => (
                  <button key={d} className="card card-press p-3.5 text-left" onClick={() => doSkip(d as number)}>
                    <div className="font-display text-[14px]">{label}</div>
                    <div className="font-mono text-[9.5px] mt-0.5" style={{ color: "var(--text-lo)" }}>{d}d · 1 small call</div>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* rollback drawer */}
      <AnimatePresence>
        {rollbackOpen && (
          <>
            <motion.div className="drawer-veil fixed inset-0 z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setRollbackOpen(false); setArmedRollback(null); }} />
            <motion.div className="drawer fixed bottom-0 left-0 right-0 z-50 px-5"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}>
              <div className="grab" />
              <div className="flex items-center justify-between py-2">
                <div className="font-display text-[16px]">Roll back to…</div>
                <button onClick={() => setRollbackOpen(false)}><X size={18} style={{ color: "var(--text-lo)" }} /></button>
              </div>
              <div className="pb-4 space-y-2">
                {undoTurn !== null && (
                  <button className="card card-press w-full p-3.5 text-left flex justify-between items-center"
                    style={{ borderColor: "var(--accent-glow)" }}
                    onClick={() => { setRollbackOpen(false); doUndoRollback(); }}>
                    <span className="font-display text-[14px]" style={{ color: "var(--accent)" }}>⟳ Undo last rollback</span>
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-lo)" }}>return to turn {undoTurn}</span>
                  </button>
                )}
                {[...save.snapshot_turns].reverse().filter((t) => t !== 1).map((t) => (
                  <button key={t} className="card card-press w-full p-3.5 text-left flex justify-between items-center"
                    style={armedRollback === t ? { borderColor: "var(--danger)" } : undefined}
                    onClick={() => doRollback(t)}>
                    <span className="font-display text-[14px]" style={armedRollback === t ? { color: "var(--danger)" } : undefined}>
                      {armedRollback === t ? `Erases ${save.world.current_turn - t} turns — tap again` : `Turn ${t}`}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-lo)" }}>
                      {save.history.find((h) => h.turn === t)?.time_label ?? ""}
                    </span>
                  </button>
                ))}
                {save.snapshot_turns.includes(1) && (
                  <button className="w-full p-2.5 text-left flex justify-between items-center rounded-xl"
                    style={{ border: `1px dashed ${armedRollback === 1 ? "var(--danger)" : "var(--ink-3)"}`, opacity: 0.85 }}
                    onClick={() => doRollback(1)}>
                    <span className="font-mono text-[11px]" style={{ color: armedRollback === 1 ? "var(--danger)" : "var(--text-lo)" }}>
                      {armedRollback === 1 ? `⟲ ERASES ALL ${save.world.current_turn - 1} TURNS — tap again to confirm` : "⟲ the very beginning (erases the whole story)"}
                    </span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ONE PLAY SURFACE, THREE DRAWERS — the full Cast/World/Chronicle views mount as
          slide-overs so the loop of "check something, keep playing" never leaves the scene.
          The bottom tabs still work; these are the fast path. */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="drawer-veil fixed inset-0 z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawer(null)} />
            <motion.div className="fixed inset-y-0 right-0 z-50 flex flex-col"
              style={{ width: "min(560px, 94vw)", background: "var(--bg, var(--ink-0))", borderLeft: "1px solid var(--line-strong)", boxShadow: "-24px 0 60px rgba(0,0,0,.45)" }}
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 40 }}>
              <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>
                  {drawer === "cast" ? "cast" : drawer === "world" ? "world" : "chronicle"}
                </div>
                <button onClick={() => setDrawer(null)}><X size={16} style={{ color: "var(--text-lo)" }} /></button>
              </div>
              <div className="flex-1 min-h-0">
                {drawer === "cast" && <Cast key={drawerSel ?? "none"} save={save} setSave={setSave} initialSel={drawerSel} />}
                {drawer === "world" && <World save={save} />}
                {drawer === "chronicle" && <Chronicle save={save} />}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
