import React, { useEffect } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

/**
 * THE CHEAT SHEET — the handful of things that are not guessable, on one card.
 *
 * This was a five-thousand-pixel essay with a seventeen-pixel close button, which is two failures
 * at once: nobody reads a manual to start a game, and the one who opened it by accident could not
 * get out. So it is a card over the game now, not a document instead of it, and it closes four
 * ways — the button, the backdrop, Escape, and Done at the end.
 *
 * The bar for a line being in here: a player cannot work it out by looking, and getting it wrong
 * costs them a scene. Everything else belongs on the control itself or in the README.
 */

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code style={{
    fontFamily: "var(--font-mono)", fontSize: "0.87em", color: "var(--accent)",
    background: "var(--accent-soft)", borderRadius: 5, padding: "1.5px 5px",
    boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
  }}>{children}</code>
);

const Cap = ({ children }: { children: React.ReactNode }) => (
  <div className="font-mono text-[9.5px] uppercase tracking-widest mt-5 mb-2" style={{ color: "var(--accent)" }}>
    {children}
  </div>
);

/** One line of a two-column list: the thing on the left, what it means on the right. */
const Row = ({ k, children }: { k: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex gap-2.5 items-baseline py-[3px]">
    <span className="shrink-0" style={{ minWidth: 96 }}>{k}</span>
    <span className="text-[12.5px] leading-snug" style={{ color: "var(--text-mid)" }}>{children}</span>
  </div>
);

export default function Primer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}>
      <motion.div className="drawer-veil" style={{ position: "absolute", inset: 0 }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} />

      <motion.div className="card" role="dialog" aria-modal="true" aria-label="cheat sheet"
        initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        style={{
          position: "relative", width: "100%", maxWidth: 420, maxHeight: "100%",
          display: "flex", flexDirection: "column", background: "var(--ink-1)",
          boxShadow: "0 24px 70px rgba(0,0,0,.6)",
        }}>

        <div className="flex items-center justify-between pl-4 pr-1.5 py-1.5 shrink-0"
          style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="font-display text-[15px]">Cheat sheet</div>
          {/* 44px, because the last one was 17 and could not be hit on a phone. */}
          <button onClick={onClose} aria-label="close"
            style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} style={{ color: "var(--text-mid)" }} />
          </button>
        </div>

        <div className="scroll-y px-4 pb-4" style={{ minHeight: 0 }}>
          <Cap>writing a message</Cap>
          <Row k={<Mono>"quotes"</Mono>}>said out loud — everyone present hears it</Row>
          <Row k={<Mono>*asterisks*</Mono>}>a thought. No one can hear it, ever</Row>
          <Row k={<Mono>(parens)</Mono>}>how you feel about the act — invisible to everyone</Row>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>plain text</span>}>
            what you physically do
          </Row>
          <div className="card p-2.5 mt-2.5" style={{ background: "var(--ink-0)" }}>
            <div className="text-[12px] leading-relaxed" style={{ fontFamily: "var(--font-mono)", color: "var(--text-hi)" }}>
              I stay standing. "I'm not signing." (hands shaking, don't let her see)
            </div>
            <div className="text-[11.5px] mt-1.5" style={{ color: "var(--text-lo)" }}>
              They hear one line and see a man who didn't sit. The hands are yours alone.
            </div>
          </div>

          <Cap>two rules</Cap>
          <div className="text-[12.5px] leading-relaxed space-y-1.5" style={{ color: "var(--text-mid)" }}>
            <p>What you <strong style={{ color: "var(--text-hi)" }}>do</strong> always happens, at the scale you said it.</p>
            <p>What you <strong style={{ color: "var(--text-hi)" }}>claim</strong> doesn't become true. Ask for a hospital in a world without one and people are just baffled.</p>
            <p style={{ color: "var(--text-lo)" }}>Griping at the writing is read as a note to the narrator, not played out as story.</p>
          </div>

          <Cap>the + button</Cap>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>Do / Story</span>}>
            you act, or you narrate and it weaves it in
          </Row>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>web</span>}>
            grounds this one reply in a live search
          </Row>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>tight 0–5</span>}>
            how tight your body is; off = read it from my words
          </Row>

          <Cap>when a turn goes wrong</Cap>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>Veto</span>}>
            refuse an invention — rolls back past it, gone for good
          </Row>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>Correct</span>}>
            it broke a rule of your world — affirms the rule, rolls back nothing
          </Row>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>Re-run</span>}>
            prose was fine, record is wrong — keeps every word
          </Row>
          <Row k={<span className="text-[12.5px]" style={{ color: "var(--text-hi)" }}>Roll back</span>}>
            return to any earlier turn. There's an undo
          </Row>

          <Cap>worth knowing</Cap>
          <div className="text-[12.5px] leading-relaxed space-y-1.5" style={{ color: "var(--text-mid)" }}>
            <p><strong style={{ color: "var(--text-hi)" }}>World tension</strong> (Tuning) is the master dial. At 0 the world introduces nothing on its own.</p>
            <p><strong style={{ color: "var(--text-hi)" }}>Narrator direction</strong> (⋯) overrules everything, including the model's taste in drama.</p>
            <p>Saves live in this browser only. Export from Tuning.</p>
          </div>

          <button className="btn w-full mt-5" style={{ height: 44 }} onClick={onClose}>Done</button>
        </div>
      </motion.div>
    </div>
  );
}
