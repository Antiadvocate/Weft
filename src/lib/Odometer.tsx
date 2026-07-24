
// Odometer — renders a time/label string where each digit flips vertically
// when it changes, and non-digit characters stay put. Motion fires only on the
// digits that actually changed. Respects reduced motion (no flip, just swap).
import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { reducedMotion } from "./tone";

function OdometerDigit({ d }: { d: string }) {
  if (reducedMotion()) return <span style={{ display: "inline-block" }}>{d}</span>;
  return (
    <span style={{ display: "inline-block", overflow: "hidden", height: "1.15em", verticalAlign: "bottom" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={d}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ display: "inline-block" }}
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
        /\d/.test(c) ? <OdometerDigit key={i} d={c} /> : <span key={i}>{c}</span>,
      )}
    </span>
  );
}

