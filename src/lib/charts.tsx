/** Tiny dependency-free SVG chart kit. All charts read CSS vars for theming. */
import React from "react";
import { motion } from "motion/react";

function pathFrom(points: [number, number][]): string {
  if (!points.length) return "";
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function scale(values: number[], w: number, h: number, pad = 3, yMin?: number, yMax?: number): [number, number][] {
  const lo = yMin ?? Math.min(...values);
  const hi = yMax ?? Math.max(...values);
  const span = hi - lo || 1;
  const n = Math.max(values.length - 1, 1);
  return values.map((v, i) => [
    pad + (i / n) * (w - pad * 2),
    h - pad - ((v - lo) / span) * (h - pad * 2),
  ]);
}

export function Sparkline({ values, w = 120, h = 34, stroke = "var(--accent)", yMin, yMax, fill = false }: {
  values: number[]; w?: number; h?: number; stroke?: string; yMin?: number; yMax?: number; fill?: boolean;
}) {
  if (values.length < 2) return <svg width={w} height={h} />;
  const pts = scale(values, w, h, 3, yMin, yMax);
  const d = pathFrom(pts);
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${h - 1} L${pts[0][0].toFixed(1)},${h - 1} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {fill && <path d={area} fill={stroke} opacity={0.12} />}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.4} fill={stroke} />
    </svg>
  );
}

/** Live pressure seismograph + optional instability hairline (λ̂ of the social map). */
export function Seismograph({ trace, overlay, w = 340, h = 32, max = 60 }: { trace: number[]; overlay?: number[]; w?: number; h?: number; max?: number }) {
  const vals = trace.slice(-max);
  const gap = w / max;
  const ov = (overlay ?? []).slice(-max);
  const ovPts = ov.map((v, i) => {
    const x = w - (ov.length - i) * gap + gap / 2;
    const y = h / 2 - clampL(v, -0.6, 0.6) * (h * 0.7);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {ovPts && <polyline points={ovPts} fill="none" stroke="var(--text-hi)" strokeWidth={0.9} opacity={0.5} strokeDasharray="1 3" />}
      {vals.map((p, i) => {
        const x = w - (vals.length - i) * gap + gap / 2;
        const t = p / 10;
        const bar = 3 + t * (h - 8);
        const color = t > 0.65 ? "var(--danger)" : t > 0.35 ? "var(--accent)" : "var(--text-lo)";
        return (
          <line key={i} x1={x} x2={x} y1={(h - bar) / 2} y2={(h + bar) / 2}
            stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.35 + t * 0.65} />
        );
      })}
    </svg>
  );
}

function clampL(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** Cusp catastrophe glyph: the bistable wedge in the (b, a) control plane + this psyche's position. */
export function CuspGlyph({ a, b, x, size = 86 }: { a: number; b: number; x: number; size?: number }) {
  const w = size, h = size * 0.78;
  // control plane: b ∈ [−1.2, 1.2] horizontal, a ∈ [0.4, −1.6] vertical (fold deepens downward)
  const px = (bv: number) => ((bv + 1.2) / 2.4) * w;
  const py = (av: number) => ((0.4 - av) / 2.0) * h;
  // wedge boundary: |b| = 2(−a/3)^{3/2} for a ≤ 0
  const left: string[] = [], right: string[] = [];
  for (let av = 0; av >= -1.6; av -= 0.05) {
    const bb = 2 * Math.pow(-av / 3, 1.5);
    left.push(`${px(-bb).toFixed(1)},${py(av).toFixed(1)}`);
    right.push(`${px(bb).toFixed(1)},${py(av).toFixed(1)}`);
  }
  const wedge = `M${left.join(" L")} L${right.reverse().join(" L")} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <rect x={0} y={0} width={w} height={h} rx={8} fill="var(--ink-1)" stroke="var(--line)" />
      <path d={wedge} fill="var(--accent)" opacity={0.13} stroke="var(--accent-glow)" strokeWidth={0.8} />
      <line x1={px(0)} x2={px(0)} y1={2} y2={h - 2} stroke="var(--line)" strokeDasharray="2 3" />
      <circle cx={px(b)} cy={py(a)} r={3.4}
        fill={x >= 0 ? "var(--calm)" : "var(--danger)"} stroke="var(--ink-0)" strokeWidth={1} />
    </svg>
  );
}

export function Bars({ data, w = 320, h = 120, color = "var(--accent)" }: {
  data: { label: string; value: number }[]; w?: number; h?: number; color?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = Math.min(26, h / data.length);
  return (
    <svg width="100%" height={data.length * rowH} viewBox={`0 0 ${w} ${data.length * rowH}`}>
      {data.map((d, i) => {
        const bw = (d.value / max) * (w - 120);
        return (
          <g key={d.label} transform={`translate(0,${i * rowH})`}>
            <text x={0} y={rowH / 2 + 3.5} fill="var(--text-mid)" fontSize={10.5} fontFamily="var(--font-mono)">
              {d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label}
            </text>
            <rect x={104} y={rowH / 2 - 5} width={Math.max(bw, 2)} height={10} rx={5} fill={color} opacity={0.85} />
            <text x={110 + bw} y={rowH / 2 + 3.5} fill="var(--text-lo)" fontSize={10} fontFamily="var(--font-mono)">
              {Math.round(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Mood arc: valence -10..10 area chart around a zero line. */
export function MoodArc({ values, w = 340, h = 80 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <svg width="100%" height={h} />;
  const pts = scale(values, w, h, 6, -10, 10);
  const zeroY = h - 6 - ((0 - -10) / 20) * (h - 12);
  const d = pathFrom(pts);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke="var(--line-strong)" strokeDasharray="3 4" />
      <path d={`${d} L${pts[pts.length - 1][0]},${zeroY} L${pts[0][0]},${zeroY} Z`} fill="var(--accent)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>{label}</div>
      <div className="font-display text-xl mt-1" style={{ color: "var(--text-hi)" }}>{value}</div>
      {sub && <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-mid)" }}>{sub}</div>}
    </div>
  );
}

/* ───────────────────────── A PERSON'S DAY ─────────────────────────
 *
 * The schedule (engine/schedule.ts) is the one piece of character state that is inherently
 * SHAPED — it is hours on a line, and a list of rows saying "08:00–16:00, weekdays" makes the
 * reader do in their head the one thing a picture does for free: see where the gaps are. Which is
 * the actual question the player has. Not "when is her shift", but "how long have I got".
 *
 * So: twenty-four hours across the width, the blocks laid on it where they fall, and a needle at
 * the hour it currently is. Night is shaded, so the strip reads as a day rather than as a bar
 * chart. The lead-in dashes are the commute — the gap between when she has to stand up and when
 * she has to be there, which is the number the scene actually runs on.
 */
export interface DaySegment {
  start: number;            // minutes since midnight
  end: number;              // minutes since midnight; may exceed 1440 (it runs past midnight)
  travel?: number;          // minutes of lead-in before `start` — drawn as the dashed approach
  label?: string;
  tone: "live" | "due" | "idle" | "off";
}

const TONE: Record<DaySegment["tone"], { fill: string; op: number }> = {
  live: { fill: "var(--accent)", op: 0.9 },      // happening right now
  due:  { fill: "var(--danger)", op: 0.95 },     // they should have gone and have not
  idle: { fill: "var(--text-lo)", op: 0.5 },     // on the books for today, not yet
  off:  { fill: "var(--text-lo)", op: 0.16 },    // not today
};

export function DayRibbon({ segments, now, w = 340, h = 52 }: {
  segments: DaySegment[]; now: number; w?: number; h?: number;
}) {
  // SVG ids are document-global, so two ribbons on one screen — which is the normal case, one per
  // character card — both resolve url(#seg0) to whichever rendered first. The second ribbon's
  // labels were being clipped to the FIRST ribbon's bar, so a block whose hours did not overlap it
  // simply had no text and one that partly did showed the middle two letters of its own name.
  const uid = React.useId().replace(/:/g, "");
  const x = (m: number) => Math.max(0, Math.min(w, (m / 1440) * w));
  const trackY = 17, trackH = 13, mid = trackY + trackH / 2;
  // A block that runs past midnight is drawn as the two pieces it actually occupies on one day.
  const pieces: { a: number; b: number; s: DaySegment }[] = [];
  for (const s of segments) {
    const a = Math.max(0, s.start), b = s.end;
    pieces.push({ a, b: Math.min(1440, b), s });
    if (b > 1440) pieces.push({ a: 0, b: b - 1440, s });
  }
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      {/* night, so the strip reads as a day and not as a number line */}
      <rect x={0} y={trackY - 5} width={x(6 * 60)} height={trackH + 10} rx={3} fill="var(--ink-0)" />
      <rect x={x(21 * 60)} y={trackY - 5} width={w - x(21 * 60)} height={trackH + 10} rx={3} fill="var(--ink-0)" />
      <rect x={0} y={trackY} width={w} height={trackH} rx={trackH / 2} fill="var(--ink-3)" />

      {[6, 12, 18].map((hh) => (
        <g key={hh}>
          <line x1={x(hh * 60)} x2={x(hh * 60)} y1={trackY - 3} y2={trackY + trackH + 3}
            stroke="var(--line-strong)" strokeWidth={0.8} />
          <text x={x(hh * 60)} y={h - 2} textAnchor="middle" fontSize={8.5}
            fontFamily="var(--font-mono)" fill="var(--text-lo)">{String(hh).padStart(2, "0")}</text>
        </g>
      ))}

      {pieces.map(({ a, b, s }, i) => {
        const t = TONE[s.tone];
        const bx = x(a), bw = Math.max(3, x(b) - x(a));
        const lead = s.travel && s.tone !== "off" ? x(a) - x(Math.max(0, a - s.travel)) : 0;
        return (
          <g key={i}>
            {lead > 2 && (
              <line x1={bx - lead} x2={bx} y1={mid} y2={mid} stroke={t.fill} strokeWidth={1.6}
                strokeDasharray="2 2.5" opacity={0.6} strokeLinecap="round" />
            )}
            {s.tone === "live" || s.tone === "due" ? (
              <motion.rect
                x={bx} y={trackY} width={bw} height={trackH} rx={trackH / 2} fill={t.fill}
                initial={false}
                animate={{ opacity: s.tone === "due" ? [0.55, 1, 0.55] : [0.72, 0.95, 0.72] }}
                transition={{ duration: s.tone === "due" ? 1.5 : 3.4, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : (
              <rect x={bx} y={trackY} width={bw} height={trackH} rx={trackH / 2} fill={t.fill} opacity={t.op} />
            )}
            {s.label && bw > 38 && (
              <>
                <clipPath id={`${uid}seg${i}`}>
                  <rect x={bx + 5} y={trackY} width={Math.max(0, bw - 9)} height={trackH} />
                </clipPath>
                <text x={bx + 6} y={mid + 3.4} fontSize={9} fontFamily="var(--font-mono)"
                  clipPath={`url(#${uid}seg${i})`}
                  fill={s.tone === "idle" || s.tone === "off" ? "var(--text-hi)" : "var(--ink-0)"}
                  opacity={s.tone === "off" ? 0.5 : 0.92}>
                  {/* Estimated so a long name ends in an ellipsis rather than mid-letter; the clip
                      above is the safety net for when the estimate is generous. */}
                  {s.label.length > (bw - 10) / 5 ? `${s.label.slice(0, Math.max(1, Math.floor((bw - 10) / 5) - 1)).trimEnd()}…` : s.label}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* the hour it is. Springs to its new position when the clock moves, so a turn that ate
          forty minutes is something you SEE happen rather than a number that changed. */}
      <motion.g initial={false} animate={{ x: x(now) }} transition={{ type: "spring", stiffness: 90, damping: 17 }}>
        <line x1={0} x2={0} y1={trackY - 7} y2={trackY + trackH + 7} stroke="var(--text-hi)" strokeWidth={1.4} />
        <motion.circle cx={0} cy={trackY - 8.5} r={3} fill="var(--text-hi)"
          animate={{ opacity: [0.55, 1, 0.55] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }} />
      </motion.g>
    </svg>
  );
}

/** The week under the day: which days this runs, and which one it is. Seven pips, because seven
 *  pips is the whole of the weekday/weekend question and a sentence about it is not. */
export function WeekPips({ on, today, labels = ["S", "M", "T", "W", "T", "F", "S"] }: {
  on: (d: number) => boolean; today: number; labels?: string[];
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {labels.map((l, d) => {
        const lit = on(d), isToday = d === today;
        return (
          <div key={d} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-mono)", fontSize: 9,
              width: 17, height: 17, borderRadius: 5, flex: "0 0 auto",
              background: lit ? "var(--accent-soft)" : "transparent",
              border: `1px solid ${isToday ? "var(--text-hi)" : lit ? "var(--accent-glow)" : "var(--line)"}`,
              color: lit ? "var(--accent)" : "var(--text-lo)",
              fontWeight: isToday ? 700 : 400,
            }}>
            {l}
          </div>
        );
      })}
    </div>
  );
}
