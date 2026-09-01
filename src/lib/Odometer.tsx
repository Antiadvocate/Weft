// Odometer — renders a time/label string where each digit flips vertically
// when it changes, and non-digit characters stay put. Motion fires only on the
// digits that actually changed. Respects reduced motion (no flip, just swap).
//
// EVERY CHARACTER GETS THE SAME BOX. The flip needs the digit in an overflow-hidden
// inline-block, and the baseline of such a box is its bottom margin edge rather than
// the glyph's baseline — so digits in a box next to letters that were not sat two
// pixels lower than the letters, and "Day 1, 09:00" read as two different lines of
// type. The box also has to be exactly one line tall or the glyph is clipped inside
// it: at 1.15em tall with an inherited line-height of 1.5 the digit was losing its
// top and bottom. So: one box, one height, one line-height, for digits and letters
// alike, and the string sits on a single baseline again.
import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { reducedMotion } from "./tone";

const BOX: React.CSSProperties = {
  display: "inline-block",
  overflow: "hidden",
  height: "1.15em",
  lineHeight: "1.15em",
  verticalAlign: "bottom",
  whiteSpace: "pre",   // an inline-block holding only a space would otherwise collapse
};

function OdometerDigit({ d }: { d: string }) {
  if (reducedMotion()) return <span style={BOX}>{d}</span>;
  return (
    <span style={BOX}>
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
        /\d/.test(c) ? <OdometerDigit key={i} d={c} /> : <span key={i} style={BOX}>{c}</span>,
      )}
    </span>
  );
}
