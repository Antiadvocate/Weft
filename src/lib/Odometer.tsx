// Odometer — renders a time/label string where each digit flips vertically
// when it changes, and non-digit characters stay put. Motion fires only on the
// digits that actually changed. Respects reduced motion (no flip, just swap).
import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { reducedMotion } from "./tone";

/**
 * EVERY CHARACTER GETS THE SAME BOX, and that is the whole fix.
 *
 * A digit had to be `inline-block` with `overflow: hidden` so the old value could slide out of
 * frame — and per CSS, an inline-block whose overflow is not visible takes its baseline from its
 * bottom margin edge rather than from the text inside it. The punctuation around it was a plain
 * inline span using the real text baseline. So the two sat on different baselines and the clock
 * rendered as "Day 1, 09:00" with the digits visibly riding above the commas and the colon.
 *
 * Aligning them by nudging `vertical-align` is guesswork that breaks at the next font size. Giving
 * the non-digits the identical box means there is only one baseline in the row to begin with.
 */
const CELL: React.CSSProperties = {
  display: "inline-block",
  height: "1.15em",
  lineHeight: "1.15em",
  verticalAlign: "bottom",
};

function OdometerDigit({ d }: { d: string }) {
  if (reducedMotion()) return <span style={CELL}>{d}</span>;
  return (
    <span style={{ ...CELL, overflow: "hidden" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={d}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ display: "inline-block", lineHeight: "1.15em" }}
        >
          {d}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Odometer({ text }: { text: string }) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {text.split("").map((c, i) =>
        /\d/.test(c)
          ? <OdometerDigit key={i} d={c} />
          // a space in its own box collapses to nothing — it needs the non-breaking form to keep width
          : <span key={i} style={CELL}>{c === " " ? " " : c}</span>,
      )}
    </span>
  );
}
