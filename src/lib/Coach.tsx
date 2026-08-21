import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { TourStep } from "./tour";

/**
 * COACH — the spotlight over a screen's controls.
 *
 * A hole is cut in a dimmed page around one element and a card points at it. The scrim is four
 * plain rectangles rather than an SVG mask because the hole has to be genuinely transparent (the
 * thing under it is the point) and four divs do that everywhere, including the Safari versions
 * that quietly drop a masked backdrop-filter.
 *
 * Nothing here can reach the app underneath: the scrim covers the page and a click on it advances
 * the guide. That is deliberate — a first-time player should have to step THROUGH the overlay
 * rather than around it, which is the whole reason it exists.
 */

const CARD_W = 360;
const PAD = 7;

/* ── inline markup ───────────────────────────────────────────────────────────────────────────── */

/** `**bold**`, `` `mono` ``, `*italic*`. Mono wins where they overlap, so a syntax example can
 *  contain quotes and asterisks and be shown literally. */
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*`]+\*)/g;

function Rich({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter((s) => s !== "");
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <strong key={i} style={{ color: "var(--text-hi)", fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
        }
        if (p.startsWith("`") && p.endsWith("`")) {
          return (
            <code key={i} style={{
              fontFamily: "var(--font-mono)", fontSize: "0.88em", color: "var(--accent)",
              background: "var(--accent-soft)", borderRadius: 5, padding: "1px 5px",
              boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
            }}>{p.slice(1, -1)}</code>
          );
        }
        if (p.startsWith("*") && p.endsWith("*")) {
          return <em key={i} style={{ color: "var(--text-mid)" }}>{p.slice(1, -1)}</em>;
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

/* ── the overlay ─────────────────────────────────────────────────────────────────────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const findTarget = (t?: string) =>
  t ? (document.querySelector(`[data-tour="${t}"]`) as HTMLElement | null) : null;

export default function Coach({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  /* Which steps actually apply, decided once at open. A control that is not on this screen right
     now (nobody present, no rollback yet, no spend) would otherwise be explained to a player who
     cannot see it. */
  const live = useMemo(
    () => steps.filter((s) => !s.skipIfMissing || findTarget(s.target)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [i, setI] = useState(0);
  const step = live[i];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);

  const next = useCallback(() => {
    if (i + 1 >= live.length) onDone(); else setI(i + 1);
  }, [i, live.length, onDone]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  /* MEASURE. Twice more on a timer because the view this sits over is usually still animating in
     when the guide opens, and a rect taken mid-transition points at where the button was. */
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    const t1 = window.setTimeout(measure, 120);
    const t2 = window.setTimeout(measure, 420);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t1); window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [i, step]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onDone(); }
      else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onDone]);

  if (!step) return null;

  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 24);

  // The hole. Clamped to the viewport so a half-offscreen target still reads as a highlight
  // rather than as a scrim with a bite out of the edge.
  const hole = rect && rect.width > 0 && rect.height > 0
    ? {
        top: clamp(rect.top - PAD, 0, vh), left: clamp(rect.left - PAD, 0, vw),
        right: clamp(rect.right + PAD, 0, vw), bottom: clamp(rect.bottom + PAD, 0, vh),
      }
    : null;

  let top: number, left: number;
  if (hole) {
    const below = hole.bottom + 12;
    const above = hole.top - 12 - cardH;
    top = below + cardH <= vh - 12 ? below
        : above >= 12 ? above
        : clamp(vh - cardH - 12, 12, Math.max(12, vh - cardH - 12));
    left = clamp((hole.left + hole.right) / 2 - w / 2, 12, Math.max(12, vw - w - 12));
  } else {
    top = clamp(vh / 2 - cardH / 2, 12, Math.max(12, vh - cardH - 12));
    left = clamp(vw / 2 - w / 2, 12, Math.max(12, vw - w - 12));
  }

  /* The panels carry the veil and the blur; the hole is the gap between them, so the spotlight
     needs no mask. Colours live in index.css because light mode wants a gentler one. */
  const panel = (style: React.CSSProperties, key: string) => (
    <div key={key} className="coach-scrim" onClick={next} style={style} />
  );

  const last = i === live.length - 1;

  return (
    <div className="coach-root" style={{ position: "fixed", inset: 0, zIndex: 120 }} role="dialog" aria-modal="true"
      aria-label="screen guide">
      {hole ? [
        panel({ top: 0, left: 0, right: 0, height: hole.top }, "t"),
        panel({ top: hole.bottom, left: 0, right: 0, bottom: 0 }, "b"),
        panel({ top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }, "l"),
        panel({ top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top }, "r"),
      ] : panel({ inset: 0 }, "all")}

      {hole && (
        <motion.div
          initial={false}
          animate={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top }}
          transition={{ type: "spring", stiffness: 420, damping: 40 }}
          style={{
            position: "fixed", pointerEvents: "none", borderRadius: 12,
            border: "1.5px solid var(--accent)", boxShadow: "0 0 0 1px rgba(0,0,0,.5), 0 0 22px var(--accent-glow)",
          }} />
      )}

      <AnimatePresence mode="wait">
        <motion.div key={i} ref={cardRef}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            position: "fixed", top, left, width: w, zIndex: 121,
            background: "var(--ink-1)", border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius)", padding: "14px 15px 11px",
            boxShadow: "0 20px 60px rgba(0,0,0,.6)",
          }}>
          <div className="flex items-start gap-2 mb-1.5">
            <div className="font-display text-[16px] leading-tight flex-1" style={{ color: "var(--text-hi)" }}>
              {step.title}
            </div>
            <button onClick={onDone} aria-label="close the guide" className="shrink-0 -mr-1 -mt-0.5 p-1">
              <X size={15} style={{ color: "var(--text-lo)" }} />
            </button>
          </div>

          <div className="space-y-2">
            {step.body.map((p, n) => (
              <p key={n} className="text-[13px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
                <Rich text={p} />
              </p>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3.5">
            <span className="font-mono text-[10px] tracking-widest shrink-0" style={{ color: "var(--text-lo)" }}>
              {i + 1} / {live.length}
            </span>
            <span className="flex-1" />
            {i > 0 && <button className="chip" onClick={back}>back</button>}
            <button className="chip chip-accent" onClick={next}>{last ? "got it" : "next"}</button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
