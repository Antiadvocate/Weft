// AnimNumber — the measurable-animation primitive. Tweens old → new,
// tints by direction of change, then settles back to neutral. Motion only
// fires when Δ ≠ 0; it shows the delta and rests. Respects reduced motion.
import React, { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./tone";

export function AnimNumber({
  value,
  format = (v: number) => String(Math.round(v)),
  good,
}: {
  value: number;
  format?: (v: number) => string;
  /** If set, overrides direction-tinting: true = calm, false = danger. */
  good?: boolean;
}) {
  const prev = useRef(value);
  const [display, setDisplay] = useState(value);
  const [dir, setDir] = useState<0 | 1 | -1>(0);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    setDir(value > from ? 1 : -1);
    if (reducedMotion()) {
      setDisplay(value);
      const rest = setTimeout(() => setDir(0), 600);
      return () => clearTimeout(rest);
    }
    const t0 = performance.now();
    const dur = 500;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setDisplay(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        setDisplay(value);
        setDir(0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const tint =
    good === true
      ? "var(--calm)"
      : good === false
        ? "var(--danger)"
        : dir > 0
          ? "var(--calm)"
          : dir < 0
            ? "var(--danger)"
            : undefined;

  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        color: dir !== 0 || good !== undefined ? tint : undefined,
        transition: "color .35s",
      }}
    >
      {format(display)}
    </span>
  );
}
