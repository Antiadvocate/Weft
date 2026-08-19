/** SHARED UI PRIMITIVES
 *
 *  Every view used to grow its own copy of the same four or five widgets: a bottom
 *  drawer with a veil and a grab handle, an uppercase mono micro-title, a muted
 *  italic empty-state, a labelled text field, a pill switch. Same pixels, five
 *  implementations, drifting apart one tweak at a time.
 *
 *  They live here now. A view that needs one of these imports it; a view that needs
 *  something genuinely different still writes it locally. The rule is only that two
 *  views must not both invent the same thing.
 */
import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";

/* ---------------------------------------------------------------- motion */

/** The one easing curve the app animates on. */
export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Rise-and-fade entrance, staggered by `delay`. */
export function Fade({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/* ----------------------------------------------------------------- sheet */

/** BOTTOM SHEET — veil, spring-up panel, grab handle.
 *
 *  Escape and a tap on the veil both close it, because a drawer you cannot dismiss
 *  by reflex is a drawer users learn to fear. `fill` gives the panel a flex column
 *  and a height cap for sheets whose body scrolls (a character card); menus of
 *  fixed-height rows leave it off and size to their content. */
export function Sheet({ open, onClose, fill, className = "", children }: {
  open: boolean;
  onClose: () => void;
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="drawer-veil fixed inset-0 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} />
          <motion.div
            className={`drawer fixed bottom-0 left-0 right-0 z-50 ${fill ? "max-h-[82dvh] flex flex-col" : ""} ${className}`}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}>
            <div className="grab" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ text */

/** Uppercase mono micro-title. The label above a card's contents. */
export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[10px] uppercase tracking-widest ${className}`} style={{ color: "var(--text-lo)" }}>
      {children}
    </div>
  );
}

/** Muted italic aside — empty states and footnotes. */
export function Muted({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[12px] italic ${className}`} style={{ color: "var(--text-lo)" }}>{children}</div>;
}

/** A titled card that fades in. */
export function Card({ title, delay = 0, className = "", children }: {
  title?: React.ReactNode; delay?: number; className?: string; children: React.ReactNode;
}) {
  return (
    <motion.div className={`card p-4 ${className}`}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: EASE }}>
      {title != null && <Kicker className="mb-1.5">{title}</Kicker>}
      {children}
    </motion.div>
  );
}

/* ---------------------------------------------------------------- inputs */

/** LABELLED TEXT FIELD.
 *
 *  Declared at module scope on purpose. A component defined inside a render body is
 *  a brand-new type every pass, so React unmounts and remounts the input and the
 *  keyboard dies after one keystroke. Do not move this inside anything.
 *
 *  `label` styling follows the surface: "mono" for the settings screens, "plain" for
 *  the character sheet, where a lowercase label reads as part of the prose. */
export function Field({ label, value, onChange, rows, mono, labelStyle = "mono", ...rest }: {
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
  labelStyle?: "mono" | "plain";
  placeholder?: string;
  type?: string;
}) {
  const style = mono ? { fontFamily: "var(--font-mono)", fontSize: 13 } : undefined;
  return (
    <div className="py-1.5">
      {labelStyle === "mono"
        ? <Kicker className="mb-1">{label}</Kicker>
        : <div className="text-[11.5px] mb-1.5" style={{ color: "var(--text-lo)" }}>{label}</div>}
      {rows && rows > 1
        ? <textarea className="field" style={style} rows={rows} value={value}
            onChange={(e) => onChange(e.target.value)} {...rest} />
        : <input className="field" style={style} value={value}
            onChange={(e) => onChange(e.target.value)} {...rest} />}
    </div>
  );
}

/** Pill switch with a title and a line of explanation. */
export function Toggle({ on, onFlip, title, desc }: {
  on: boolean; onFlip: () => void; title: string; desc?: string;
}) {
  return (
    <button className="w-full flex items-center justify-between py-2" onClick={onFlip}
      role="switch" aria-checked={on}>
      <span className="text-left">
        <span className="block text-[14px]">{title}</span>
        {desc && <span className="block text-[11px]" style={{ color: "var(--text-lo)" }}>{desc}</span>}
      </span>
      <span style={{ width: 42, height: 24, borderRadius: 999, background: on ? "var(--accent)" : "var(--ink-3)", position: "relative", flexShrink: 0, transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: "var(--ink-0)", transition: "left .2s" }} />
      </span>
    </button>
  );
}

/** Key/value line. A value long enough to wrap gets its own line under the label;
 *  short values stay inline, where label-then-value reads faster. */
export function KV({ k, v }: { k: React.ReactNode; v: string }) {
  return String(v).length > 52 ? (
    <div className="py-1">
      <div className="text-[11px] mb-0.5" style={{ color: "var(--text-lo)" }}>{k}</div>
      <div className="text-[13.5px]" style={{ color: "var(--text-hi)", lineHeight: 1.5 }}>{v}</div>
    </div>
  ) : (
    <div className="flex items-baseline gap-2.5 py-1">
      <span className="text-[11px] shrink-0" style={{ color: "var(--text-lo)" }}>{k}</span>
      <span className="text-[13.5px] flex-1 min-w-0" style={{ color: "var(--text-hi)" }}>{v}</span>
    </div>
  );
}
