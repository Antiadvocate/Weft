
/**
 * ATMOSPHERE — a single canvas of a few dozen procedural particles behind the prose.
 * Tone picks the kind (motes / embers / ash / rain / snow / fog), density, speed, color.
 * Tone changes crossfade: the old population decays out while the new one fades in.
 * Cheap by construction: one rAF, ≤ ~80 particles, paused when the tab is hidden,
 * static single frame under prefers-reduced-motion.
 */
import React, { useEffect, useRef } from "react";
import { reducedMotion, type AmbienceLevel, type ParticleKind, type SceneTone } from "./tone";

/** Readability is the contract: particles must read as texture, never as noise over glyphs.
 *  subtle keeps the field sparse and dim; full is denser but still alpha-capped. */
const LEVELS: Record<Exclude<AmbienceLevel, "off">, { alpha: number; density: number; cap: number }> = {
  subtle: { alpha: 0.35, density: 0.55, cap: 0.16 },
  full:   { alpha: 0.7,  density: 0.9,  cap: 0.3 },
};

interface P {
  x: number; y: number; vx: number; vy: number;
  r: number; a: number; phase: number; kind: ParticleKind; color: string;
  dying?: boolean; born: number;
}

const BASE_V: Record<ParticleKind, { vx: number; vy: number }> = {
  motes:  { vx: 4,  vy: 3 },
  embers: { vx: 5,  vy: -14 },
  ash:    { vx: 6,  vy: 10 },
  rain:   { vx: 18, vy: 160 },
  snow:   { vx: 8,  vy: 18 },
  fog:    { vx: 22, vy: 1.5 },
};

function spawn(kind: ParticleKind, color: string, w: number, h: number, now: number, edge = false): P {
  const v = BASE_V[kind];
  const p: P = {
    kind, color, born: now,
    x: Math.random() * w,
    y: edge && kind === "embers" ? h + 6 : edge && (kind === "rain" || kind === "snow" || kind === "ash") ? -6 : Math.random() * h,
    vx: (Math.random() - 0.5) * 2 * v.vx,
    vy: v.vy * (0.6 + Math.random() * 0.8),
    r: kind === "fog" ? 26 + Math.random() * 30 : kind === "rain" ? 0.7 : 0.6 + Math.random() * 1.3,
    a: kind === "fog" ? 0.018 + Math.random() * 0.022 : 0.25 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
  };
  if (kind === "snow") p.r = 1 + Math.random() * 1.8;
  return p;
}

export default function Atmosphere({ tone, level = "subtle" }: { tone: SceneTone; level?: Exclude<AmbienceLevel, "off"> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let parts: P[] = [];
    let raf = 0, last = performance.now(), curKind = toneRef.current.particle, curColor = toneRef.current.color;
    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      if (!box) return;
      w = box.width; h = box.height;
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // touch devices pay far more per particle (mobile Safari especially) — halve the field there.
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const targetCount = () => {
      const base = Math.round(Math.min(80, Math.max(8, (w * h) / 14000))
        * toneRef.current.density * LEVELS[levelRef.current].density * (coarse ? 0.5 : 1)) || 0;
      // fog draws large radial gradients whose coverage ADDS where they overlap: a field sized for
      // 1px motes stacks into an opaque sheet over the prose. Hold it to a handful of drifting banks.
      return toneRef.current.particle === "fog" ? Math.min(base, coarse ? 5 : 8) : base;
    };

    const draw = (p: P, now: number) => {
      const t = toneRef.current;
      const lv = LEVELS[levelRef.current];
      const ageIn = Math.min(1, (now - p.born) / 1200);
      // fog is the one kind that can obscure prose, so it gets a ceiling of its own well under lv.cap
      const cap = p.kind === "fog" ? Math.min(lv.cap, 0.05) : lv.cap;
      const alpha = Math.min(cap, lv.alpha * p.a * ageIn * (p.dying ? Math.max(0, 1 - (now - p.born) / 1400) : 1)
        * (p.kind === "motes" ? 0.6 + 0.4 * Math.sin(now / 900 + p.phase) : 1));
      if (alpha <= 0.005) return;
      ctx.globalAlpha = alpha;
      if (p.kind === "rain") {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.r;
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.05 * t.speed, p.y - p.vy * 0.06 * t.speed); ctx.stroke();
      } else if (p.kind === "fog") {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, p.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (document.hidden || !w || !h) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = toneRef.current;

      // tone changed → old population decays, new kind takes the field
      if (t.particle !== curKind || t.color !== curColor) {
        for (const p of parts) if (p.kind !== t.particle) { p.dying = true; p.born = now; }
        curKind = t.particle; curColor = t.color;
      }
      const live = parts.filter((p) => p.kind === curKind && !p.dying).length;
      const want = targetCount();
      if (live < want && Math.random() < 0.35) parts.push(spawn(curKind, curColor, w, h, now, true));
      if (live > want) { const x = parts.find((p) => p.kind === curKind && !p.dying); if (x) { x.dying = true; x.born = now; } }

      ctx.clearRect(0, 0, w, h);
      parts = parts.filter((p) => !(p.dying && now - p.born > 1400));
      for (const p of parts) {
        const sway = Math.sin(now / 1000 + p.phase);
        p.x += (p.vx + sway * BASE_V[p.kind].vx * 0.5) * t.speed * dt;
        p.y += p.vy * t.speed * dt * (p.kind === "motes" ? sway * 0.6 + 0.4 : 1);
        if (p.y > h + 10) { p.y = -8; p.x = Math.random() * w; }
        if (p.y < -70) { p.y = h + 8; p.x = Math.random() * w; }
        if (p.x > w + 70) p.x = -60; if (p.x < -70) p.x = w + 60;
        draw(p, now);
      }
    };

    if (reducedMotion()) {
      // one still frame — presence without motion
      const now = performance.now();
      for (let i = 0; i < targetCount(); i++) parts.push({ ...spawn(curKind, curColor, w, h, now), born: now - 2000 });
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) draw(p, now);
      return () => ro.disconnect();
    }

    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }} />;
}

