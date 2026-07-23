import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Compass, CornerDownLeft, Crosshair, Globe, Image as ImageIcon, Leaf, Moon, Play as PlayIcon, RotateCcw, Sparkles, Volume2, VolumeX, X , Ban } from "lucide-react";
import { speak, stopSpeaking, ttsAvailable } from "../lib/tts";
import { api, streamTurn, resumePending, governorState, type ActionMode, type ClientSave } from "../lib/api";
import Cast from "./Cast";
import World from "./World";
import Chronicle from "./Chronicle";
import { Seismograph } from "../lib/charts";
import { AnalogClock, WeatherIcon } from "../lib/format";
import Atmosphere from "../lib/Atmosphere";
import Backdrop from "../lib/Backdrop";
import { sceneTone, reducedMotion, getAmbience, setAmbience, type AmbienceLevel } from "../lib/tone";
import { AnimNumber } from "../lib/AnimNumber";
import { Odometer } from "../lib/Odometer";
import { turnDeltas } from "../lib/ledger";
import { previouslyHere, dueSoon, dueLabel } from "../lib/psychic";

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
  // SOMATIC TIGHTNESS — the player's own body reading 0–5 vs their meditative zero (undefined = let the
  // engine infer from text). `baseline` routes it to the persistent ceiling instead of this-turn's scalar:
  // "running low today" (bad sleep the clock can't see) rather than "this beat tightened me".
  const [tightness, setTightness] = useState<number | undefined>(undefined);
  const [baseline, setBaseline] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [liveProse, setLiveProse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rerunning, setRerunning] = useState<number | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [montageMode, setMontageMode] = useState(false);
  const [mDirection, setMDirection] = useState("");
  const [mDays, setMDays] = useState(30);
  const [mGran, setMGran] = useState<"quick" | "standard" | "full">("standard");
  const [mWarnings, setMWarnings] = useState<string[]>([]);
  const [scorecard, setScorecard] = useState<{ item: string; landed: boolean }[] | null>(null);
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
  const deltas = useMemo(() => turnDeltas(save), [save.telemetry, save.world.present]);
  const recall = useMemo(() => previouslyHere(save), [save.world.player_location, save.memory, save.world.present]);
  const soon = useMemo(() => dueSoon(save), [save.world.consequences, save.world.current_time]);
  // recall is for RE-entry: show it when the place changes, let it go once you're playing here
  const [recallDismissed, setRecallDismissed] = useState<string | null>(null);
  useEffect(() => { setRecallDismissed(null); }, [save.world.player_location]);

  // ── ambient layers: one tone derived from state drives particles, backdrop, prose cadence.
  //    Readability rules them: one tap cycles subtle → full → off, persisted locally. ──
  const tone = useMemo(() => sceneTone(save), [save]);
  const locale = save.world.places[save.world.player_location]?.name ?? "";
  const [ambience, setAmb] = useState<AmbienceLevel>(getAmbience);
  const cycleAmbience = () => {
    const next: AmbienceLevel = ambience === "subtle" ? "full" : ambience === "full" ? "off" : "subtle";
    setAmbience(next); setAmb(next);
    pushToasts([`ambience: ${next}`]);
  };

  // ── state-driven fx: strikes flash red and decay; canon events ripple once ──
  const [fx, setFx] = useState<null | "strike" | "canon">(null);
  const fxTimer = useRef(0);
  const flash = (kind: "strike" | "canon") => {
    window.clearTimeout(fxTimer.current);
    setFx(kind);
    fxTimer.current = window.setTimeout(() => setFx(null), kind === "strike" ? 1000 : 1300);
  };
  const lastHistLen = useRef(history.length);
  useEffect(() => {
    if (history.length > lastHistLen.current) {
      const latest = history[history.length - 1];
      if ((latest?.shifts ?? []).some((s) => s.startsWith("CANON:"))) flash("canon");
    }
    lastHistLen.current = history.length;
  }, [history.length]);

  // ── per-word reveal bookkeeping: words already shown while streaming never re-animate ──
  const revealCount = useRef(new Map<React.Key, number>());
  const pendingReveal = useRef(new Map<React.Key, number>());
  useEffect(() => {
    if (!liveProse) { revealCount.current.clear(); pendingReveal.current.clear(); return; }
    for (const [k, v] of pendingReveal.current) revealCount.current.set(k, v);
  });

  const [readingTurn, setReadingTurn] = useState<number | null>(null);
  const [revealedTurn, setRevealedTurn] = useState<number | null>(null);
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
  /** After a turn commits, if any character's on-sight appearance changed, re-score their
   *  intrinsic beauty in the background (one small AI call per changed character) and fold the
   *  updated save back in. Silent and non-blocking — a stale beauty for one turn is harmless. */
  const flushBeautyRescore = async (s: ClientSave) => {
    if (!s.pending_beauty_rescore?.length) return;
    try {
      await api.rescoreBeauty(s.id);
      const fresh = await api.save(s.id);
      if (fresh) setSave(fresh);
    } catch { /* non-critical; will retry on the next appearance change */ }
  };

  const runAction = async (a: string) => {
    if (!a) return;
    setAction(""); setError(null); setRunning(true); runningRef.current = true; setProseDone(false); setLiveProse(""); setPhase("pressure");
    let failed = false;
    try {
      await streamTurn(save.id, a, mode, {
        onPhase: (p) => { setPhase(p); if (p && p !== "pressure" && p !== "narrator" && p !== "eco") setProseDone(true); },
        onDelta: (t) => setLiveProse((p) => p + t),
        onMeta: (m) => { if (Array.isArray((m as any).shifts)) pushToasts((m as any).shifts as string[]); },
        onDone: (s) => { setSave(s); setLiveProse(""); setPhase(null); sessionStorage.removeItem(draftKey); void flushBeautyRescore(s); },
        onError: (msg) => { setError(msg); failed = true; },
      }, { ground, tightness });
    } catch (e: any) {
      if (e.name !== "AbortError") { setError(e.message ?? "turn failed"); failed = true; }
    } finally {
      setRunning(false); runningRef.current = false; setProseDone(false); setPhase(null);
      // reactive tightness is a per-turn reading — it clears once the turn commits (a spike, not a setting).
      // the baseline (ceiling) is separate and persists in save state until the player clears it.
      if (!failed) setTightness(undefined);
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
      flash("strike");
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

  const doMontage = async () => {
    if (skipping || !mDirection.trim()) return;
    setSkipOpen(false); setSkipping(true); setError(null); setScorecard(null);
    setPhase("planning the montage");
    try {
      const { save: s, scorecard: sc } = await api.montage(
        save.id, mDays, mDirection.trim(), mGran, (p) => setPhase(p),
      );
      setSave(s);
      setScorecard(sc);
      const missed = sc.filter((x) => !x.landed);
      pushToasts(missed.length
        ? [`Montage done — ${sc.length - missed.length}/${sc.length} landed. Missed: ${missed.map((m) => m.item).join(", ")}`]
        : [`Montage done — everything landed.`]);
    } catch (e: any) { setError(e.message ?? "montage failed"); }
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
        onDone: (s) => { setSave(s); setLiveProse(""); setPhase(null); void flushBeautyRescore(s); resolve(); },
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

  /** Per-word settle-in for the live paragraph. Cadence comes from the scene tone —
   *  tense reads fast, meditative drifts. `counter` tracks the paragraph-global word
   *  index and how many words were already revealed while streaming, so text that has
   *  settled never re-animates as new words arrive. */
  type RevealCounter = { i: number; from: number };
  const revealWords = (text: string, keyBase: string, counter: RevealCounter): React.ReactNode[] => {
    const dur = `${Math.min(700, 240 + tone.revealMs * 8)}ms`;
    return text.split(/(\s+)/).map((tok, ti) => {
      if (!tok || /^\s+$/.test(tok)) return tok;
      const idx = counter.i++;
      if (idx < counter.from) return tok;
      return (
        <span key={`${keyBase}-w${ti}`} className="w-in"
          style={{ animationDelay: `${Math.min(idx - counter.from, 40) * tone.revealMs}ms`, ["--w-dur" as any]: dur }}>
          {tok}
        </span>
      );
    });
  };

  /** Disco-style prose renderer: "dialogue" gets the accent ink; known names become tappable refs. */
  const renderParagraph = (text: string, key: React.Key, animate: boolean) => {
    const counter: RevealCounter | null = animate && !reducedMotion()
      ? { i: 0, from: revealCount.current.get(key) ?? 0 } : null;
    const nodes: React.ReactNode[] = [];
    // split on double-quoted spans (straight + curly)
    const parts = text.split(/("[^"]+"|“[^”]+”)/g);
    parts.forEach((part, pi) => {
      const isDlg = /^["“]/.test(part);
      const sub = renderNames(part, `${key}-${pi}`, counter);
      nodes.push(isDlg ? <span key={`${key}-${pi}`} className="dlg">{sub}</span> : <React.Fragment key={`${key}-${pi}`}>{sub}</React.Fragment>);
    });
    if (counter) pendingReveal.current.set(key, counter.i);
    return <p key={key} style={animate ? undefined : { animation: "none" }}>{nodes}</p>;
  };

  const renderNames = (text: string, keyBase: string, counter?: RevealCounter | null): React.ReactNode[] => {
    const names = Object.keys(nameIndex).filter((n) => n.length >= 2);
    const plain = (s: string, k: string): React.ReactNode[] =>
      counter ? revealWords(s, k, counter) : [s];
    if (!names.length) return plain(text, keyBase);
    const re = new RegExp(`\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    const out: React.ReactNode[] = [];
    let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(...plain(text.slice(last, m.index), `${keyBase}-p${i}`));
      const nm = m[0];
      const idx = counter ? counter.i++ : 0;
      const revealing = counter && idx >= counter.from;
      out.push(
        <span key={`${keyBase}-n${i++}`} className={revealing ? "name-ref w-in" : "name-ref"}
          style={revealing ? { animationDelay: `${Math.min(idx - counter!.from, 40) * tone.revealMs}ms` } : undefined}
          onClick={(e) => {
            const r = (e.target as HTMLElement).getBoundingClientRect();
            setTip({ name: nm, x: r.left, y: r.bottom });
          }}>{nm}</span>
      );
      last = m.index + nm.length;
    }
    if (last < text.length) out.push(...plain(text.slice(last), `${keyBase}-pt`));
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
        {(() => {
          const r = (save as any).condition?.["char_player"]?.psyche?.relaxation ?? 0;
          const color = r <= -7 ? "var(--danger)" : r <= -3 ? "var(--accent)" : r >= 4 ? "var(--calm)" : "var(--text-lo)";
          const amp = 1.04 + ((r + 10) / 20) * 0.14; // clenched breathes shallow, open breathes deep
          return (
            <div className="breath-orb" title={`openness: ${r >= 4 ? "open" : r <= -7 ? "clenched tight" : r <= -3 ? "guarded" : "level"}`}
              style={{ background: color, boxShadow: `0 0 10px ${color}`, opacity: 0.85,
                ["--breath-s" as any]: `${tone.breathS}s`, ["--breath-amp" as any]: amp }} />
          );
        })()}
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
        <button className="chip" onClick={cycleAmbience}
          title={`ambience: ${ambience} — tap to cycle (subtle / full / off)`}
          style={ambience === "off" ? { opacity: 0.45 } : ambience === "full" ? { color: "var(--accent)", borderColor: "var(--accent-glow)" } : undefined}>
          <Sparkles size={11} />
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

      {/* prose scroll — ambient layers (seeded backdrop + tone-driven particles) sit beneath it */}
      <div className="relative flex-1 min-h-0">
        {ambience !== "off" && <Backdrop tone={tone} locale={locale} level={ambience} />}
        {ambience !== "off" && <Atmosphere tone={tone} level={ambience} />}
        {ambience !== "off" && <div className="prose-scrim" aria-hidden />}
        {fx && <div className={fx === "strike" ? "fx-strike" : "fx-canon"} aria-hidden />}
        <div ref={scrollRef} className="scroll-y h-full px-5 pb-4 relative" style={{ zIndex: 1 }}>
        {history.length === 0 && !liveProse && (
          <div className="pt-10 text-center">
            <div className="font-display text-lg mb-1.5">Ready to begin.</div>
            <div className="text-[13.5px]" style={{ color: "var(--text-mid)" }}>
              Type an action or narration. The world responds — and keeps moving when you look away.
            </div>
          </div>
        )}
        <div className="prose-stream pt-3">
          {/* previously, here — place-indexed recall on re-entry. Not persistent chrome:
              it appears when you arrive somewhere you have history, and goes when dismissed. */}
          <AnimatePresence>
            {recall.length > 0 && recallDismissed !== save.world.player_location && (
              <motion.div className="recall-card"
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}>
                <div className="recall-head">
                  <span>previously, here</span>
                  <button onClick={() => setRecallDismissed(save.world.player_location)}
                    style={{ color: "var(--text-lo)" }}>dismiss</button>
                </div>
                {recall.map((r) => (
                  <div key={r.key} className="recall-line">
                    {r.text}
                    {r.when && <span className="recall-when"> · {r.when}</span>}
                  </div>
                ))}
                {recall[0]?.shared && (
                  <div className="recall-line" style={{ color: "var(--text-lo)" }}>
                    {recall[0].shared} was here too.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {history.map((h) => (
            <div className={h.turn === history[history.length - 1]?.turn ? undefined : "turn-block"} key={`${h.kind ?? "turn"}-${h.turn}`}>
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
              {h.kind !== "interlude" && h.narrator_prose.trim() ? (
                <div
                  onClick={(e) => {
                    // tap the prose to reveal this turn's actions — but not when tapping a character name (that opens the tip)
                    if ((e.target as HTMLElement).closest(".name-ref")) return;
                    setRevealedTurn((cur) => (cur === h.turn ? null : h.turn));
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {h.narrator_prose.split(/\n{2,}/).map((p, i) => renderParagraph(p, `${h.turn}-${i}`, false))}
                </div>
              ) : (
                h.kind !== "interlude" && h.narrator_prose.split(/\n{2,}/).map((p, i) => renderParagraph(p, `${h.turn}-${i}`, false))
              )}
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
              <AnimatePresence>
                {h.kind !== "interlude" && h.narrator_prose.trim() && revealedTurn === h.turn && (
                  <motion.div className="turn-actions"
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22 }}>
                    <button className="turn-action"
                      onClick={() => doStrike(h.turn)}
                      title="strike this from the story — roll back past it and forbid it forever">
                      <Ban size={12} /> strike
                    </button>
                    <button className="turn-action" disabled={rerunning !== null}
                      onClick={() => doRerun(h.turn)}
                      title="re-run the bookkeeper — keeps the prose, rebuilds memories and feelings">
                      <RotateCcw size={12} /> {rerunning === h.turn ? "re-running…" : "re-run"}
                    </button>
                    {ttsAvailable() && (
                      <button className="turn-action"
                        style={readingTurn === h.turn ? { color: "var(--accent)" } : undefined}
                        onClick={() => toggleRead(h.turn, h.narrator_prose)}
                        title={readingTurn === h.turn ? "stop reading" : "read aloud (system voice)"}>
                        {readingTurn === h.turn ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        {readingTurn === h.turn ? "stop" : "read"}
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
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
          <AnimatePresence>
            {!running && !liveProse && deltas.length > 0 && (
              <motion.div
                className="ledger-card"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35 }}
              >
                {deltas.map((r, i) => (
                  <motion.div
                    key={r.key}
                    className="ledger-row"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: reducedMotion() ? 0 : i * 0.07 }}
                  >
                    <span className="ledger-text">{r.text}</span>
                    {r.from !== undefined && r.to !== undefined && (
                      <span className="ledger-delta">
                        {r.icon === "clock" ? (
                          <AnimNumber value={r.to} format={(v) => {
                            const m = Math.round(v), h = Math.floor(m / 60), mm = m % 60;
                            return h ? `${h}h${mm ? ` ${mm}m` : ""}` : `${m}m`;
                          }} good />
                        ) : (
                          <>
                            <AnimNumber value={r.from} />
                            <span className="ledger-arrow"> → </span>
                            <AnimNumber value={r.to} good={r.good} />
                          </>
                        )}
                      </span>
                    )}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {phase && (
            <motion.div key={phase} className="font-mono text-[11px] uppercase tracking-widest py-2"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="shimmer">{phase === "narrator" && ground ? "narrator · searching the web" : PHASE_LABEL[phase] ?? phase}…</span>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="card p-3 my-3 font-mono text-[12px]" style={{ color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" }}>
            {error}
          </div>
        )}
        </div>
      </div>

      {/* the clock — tap to correct it when the bookkeeper drifts from the prose */}
      <div className="px-4 pt-1.5 pb-0.5">
        <button className="font-mono text-[10px] inline-flex items-center gap-1" style={{ color: "var(--text-lo)" }}
          onClick={async () => {
            const cur = save.world.current_time;
            const next = window.prompt("Set the in-world time (e.g. \"Day 2, 08:00\" or \"Day 3, 14:30\"):", cur.replace(/\s*\(.*\)$/, ""));
            if (next && next.trim() && next.trim() !== cur) setSave(await api.setTime(save.id, next.trim()));
          }}>
          🕐 <Odometer text={save.world.current_time} />
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

      {/* due soon — only what the schedule already holds, never invented dread.
          Appears only when something is actually pending, so it isn't a permanent row. */}
      {soon.length > 0 && (
        <div className="duesoon">
          {soon.map((d) => (
            <div key={d.key} className="duesoon-row">
              <span className="duesoon-when"
                style={{ color: d.severity === "major" ? "var(--danger)" : "var(--text-lo)" }}>
                {dueLabel(d.hours)}
              </span>
              <span className="duesoon-text">{d.text}</span>
              {d.mine && <span className="duesoon-mine">yours</span>}
            </div>
          ))}
        </div>
      )}

      {/* composer */}
      <div className="px-4 pb-2.5 pt-1">
        {/* SOMATIC TIGHTNESS — one-tap body reading vs your meditative zero. Off = the engine infers
            from your text. `base` reroutes the tap to a persistent baseline (bad sleep the clock can't
            see) that holds until cleared; otherwise it's a this-turn spike that clears on send. */}
        <div className="flex items-center gap-1.5 pb-1.5">
          <span className="font-mono text-[8px] uppercase tracking-widest shrink-0" style={{ color: "var(--text-lo)" }} title="how tight your body is right now, 0 (fully calm) to 5 (fully tightened), against your own baseline. leave off to let the engine read it from your words.">
            tight
          </span>
          {[0, 1, 2, 3, 4, 5].map((n) => {
            const active = baseline
              ? (() => { const sc = (save as any).condition?.char_player?.subjective_ceiling;
                  const cur = sc === undefined ? undefined : sc >= 3 ? 2 : sc >= 0 ? 3 : sc >= -3 ? 4 : 5;
                  return cur === n; })()
              : tightness === n;
            return (
              <button key={n}
                className="font-mono text-[10px] leading-none rounded-full flex items-center justify-center shrink-0"
                style={{ width: 18, height: 18,
                  color: active ? "var(--bg, #111)" : "var(--text-lo)",
                  background: active ? "var(--accent)" : "var(--accent-soft, rgba(180,140,90,.10))",
                  border: active ? "1px solid var(--accent)" : "1px solid transparent" }}
                title={["fully calm", "neutral", "curious / focused", "tight — and I know it", "tight — without noticing", "fully tightened"][n] + (baseline ? " (baseline — holds until cleared)" : " (this turn)")}
                onClick={async () => {
                  if (baseline) { setSave(await api.setBaselineTightness(save.id, n)); }
                  else { setTightness((v) => v === n ? undefined : n); }
                }}>{n}</button>
            );
          })}
          <button
            className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
            style={baseline ? { color: "var(--accent)", background: "var(--accent-soft)" } : { color: "var(--text-lo)" }}
            title="baseline mode: the number sets a persistent 'running low today' ceiling (e.g. bad sleep) that holds across turns, instead of a one-turn spike. tap a number in this mode to set it; tap 0/1 to clear."
            onClick={() => setBaseline((v) => !v)}>
            base
          </button>
        </div>
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
              onClick={() => {
                const n = !ground; setGround(n);
                pushToasts([n ? "web grounding on — turns will search the live web (costs a little more)" : "web grounding off"]);
              }}>
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

      {/* montage scorecard — what the run landed, and what it missed */}
      <AnimatePresence>
        {scorecard && scorecard.length > 0 && (
          <motion.div className="fixed left-0 right-0 z-40 px-5"
            style={{ bottom: 96 }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <div className="card p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>
                  montage scorecard
                </div>
                <button className="font-mono text-[10px] uppercase tracking-widest"
                  style={{ color: "var(--text-lo)" }} onClick={() => setScorecard(null)}>close</button>
              </div>
              {scorecard.map((r, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[12px] leading-relaxed">
                  <span style={{ color: r.landed ? "var(--calm)" : "var(--danger)" }}>{r.landed ? "✓" : "○"}</span>
                  <span style={{ color: r.landed ? "var(--text-mid)" : "var(--text-lo)" }}>{r.item}</span>
                </div>
              ))}
              {scorecard.some((r) => !r.landed) && (
                <div className="text-[11px] mt-1.5" style={{ color: "var(--text-lo)" }}>
                  Unlanded items didn't happen in the story. Run another short montage aimed at just those, or play them out.
                </div>
              )}
            </div>
          </motion.div>
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
              {!montageMode ? (
                <>
                  <div className="pb-3 grid grid-cols-2 gap-2">
                    {[["Overnight", 1], ["Three days", 3], ["A week", 7], ["A fortnight", 14]].map(([label, d]) => (
                      <button key={d} className="card card-press p-3.5 text-left" onClick={() => doSkip(d as number)}>
                        <div className="font-display text-[14px]">{label}</div>
                        <div className="font-mono text-[9.5px] mt-0.5" style={{ color: "var(--text-lo)" }}>{d}d · 1 small call</div>
                      </button>
                    ))}
                  </div>
                  <button className="card card-press p-3.5 text-left w-full mb-5"
                    onClick={() => { setMontageMode(true); setMWarnings([]); }}>
                    <div className="font-display text-[14px]">Direct the montage…</div>
                    <div className="text-[11.5px] mt-0.5" style={{ color: "var(--text-mid)" }}>
                      Say what should be true by the end. The engine writes the middle in beats — the decision, the friction, the settling.
                    </div>
                  </button>
                </>
              ) : (
                <div className="pb-5">
                  <textarea className="composer-input w-full mb-2" rows={3}
                    placeholder="thirty days — we move in together, fall deeper, adopt two cats, argue about tacos"
                    value={mDirection}
                    onChange={(e) => { setMDirection(e.target.value); setMWarnings([]); }}
                    onBlur={async () => {
                      if (!mDirection.trim()) return;
                      try { setMWarnings(await api.montagePreflight(save.id, mDirection.trim(), mDays)); } catch {}
                    }} />
                  {mWarnings.map((w, i) => (
                    <div key={i} className="text-[11.5px] mb-1.5 px-2.5 py-1.5 rounded-lg"
                      style={{ background: "var(--ink-1)", color: "var(--text-mid)" }}>⚠ {w}</div>
                  ))}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>days</span>
                    <input type="range" min={3} max={120} value={mDays} className="flex-1"
                      onChange={(e) => setMDays(Number(e.target.value))}
                      onPointerUp={async () => {
                        if (!mDirection.trim()) return;
                        try { setMWarnings(await api.montagePreflight(save.id, mDirection.trim(), mDays)); } catch {}
                      }} />
                    <span className="font-mono text-[12px]" style={{ minWidth: 34, textAlign: "right" }}>{mDays}</span>
                  </div>
                  <div className="flex gap-1.5 mb-3">
                    {(["quick", "standard", "full"] as const).map((g) => (
                      <button key={g} className={g === mGran ? "chip chip-accent" : "chip"}
                        onClick={() => setMGran(g)}>{g}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button className="chip" onClick={() => setMontageMode(false)}>back</button>
                    <button className="chip chip-accent flex-1" disabled={!mDirection.trim()}
                      onClick={doMontage}>run the montage</button>
                  </div>
                </div>
              )}
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
