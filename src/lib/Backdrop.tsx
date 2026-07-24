
/**
 * BACKDROP â€” a seeded, noise-driven color field under the prose.
 * Deterministic: seed = hash(locale + tone), so returning to a place reproduces its light.
 * A tiny offscreen buffer (64Ã—40) is filled from 3-octave value noise mapped through a
 * tone palette (nudged warm/cool by the place's own name), then drawn scaled â€” the upscale itself does the blurring, no CSS filter.
 * Drifts very slowly; crossfades ~2s on scene change. Static under reduced motion.
 */
import React, { useEffect, useRef } from "react";
import { hashSeed, makeNoise2D, mulberry32, reducedMotion, type AmbienceLevel, type SceneTone } from "./tone";

type RGB = [number, number, number];
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Palette stops per tone: [deep, mid, glow]. Kept dark â€” this sits UNDER ink, not over it. */
const PALETTES: Record<SceneTone["id"], [RGB, RGB, RGB]> = {
  calm:    [[13, 12, 10], [21, 19, 15], [30, 26, 19]],
  warm:    [[15, 11, 8],  [27, 18, 12], [44, 27, 15]],
  wonder:  [[10, 12, 15], [17, 21, 28], [26, 33, 46]],
  grief:   [[11, 11, 12], [17, 17, 19], [23, 23, 25]],
  neutral: [[13, 11, 9],  [20, 17, 13], [26, 22, 16]],
  tense:   [[13, 10, 9],  [23, 16, 13], [34, 21, 16]],
  dread:   [[10, 8, 8],   [19, 12, 11], [29, 15, 13]],
};

/** The place's own name bends its light: hearths run warm, reaches run cool. */
function placeShift(locale: string): number {
  const l = locale.toLowerCase();
  if (/temple|hearth|forge|fire|inn|kitchen|den\b/.test(l)) return +1;
  if (/sea|reach|sky|frost|ice|moon|deep|void|cavern/.test(l)) return -1;
  return 0;
}

const BW = 64, BH = 40;

export default function Backdrop({ tone, locale, level = "subtle" }: { tone: SceneTone; locale: string; level?: Exclude<AmbienceLevel, "off"> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef({ tone, locale });
  sceneRef.current = { tone, locale };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cur = document.createElement("canvas"); cur.width = BW; cur.height = BH;
    const prev = document.createElement("canvas"); prev.width = BW; prev.height = BH;
    const cctx = cur.getContext("2d")!, pctx = prev.getContext("2d")!;
    let key = "", fadeStart = 0, raf = 0, lastFill = 0;

    let noise = makeNoise2D(1), ox = 0, oy = 0, palette = PALETTES.neutral, warm = 0;
    const rebind = () => {
      const { tone: t, locale: loc } = sceneRef.current;
      const seed = hashSeed(`${loc}::${t.id}`);
      const rnd = mulberry32(seed);
      noise = makeNoise2D(seed);
      ox = rnd() * 64; oy = rnd() * 64;
      warm = placeShift(loc) * 5 + (rnd() - 0.5) * 4;
      palette = PALETTES[t.id];
    };

    const fill = (target: CanvasRenderingContext2D, time: number) => {
      const img = target.createImageData(BW, BH);
      const d = img.data;
      const z = time * 0.000045; // slow drift
      for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
        const nx = ox + x * 0.045, ny = oy + y * 0.06;
        let v = noise(nx + z, ny) * 0.55 + noise(nx * 2.1, ny * 2.1 - z) * 0.3 + noise(nx * 4.3 + z, ny * 4.3) * 0.15;
        v = Math.max(0, Math.min(1, (v - 0.28) * 1.6));
        const c = v < 0.5 ? lerp3(palette[0], palette[1], v * 2) : lerp3(palette[1], palette[2], (v - 0.5) * 2);
        const i = (y * BW + x) * 4;
        d[i] = c[0] + warm; d[i + 1] = c[1]; d[i + 2] = c[2] - warm; d[i + 3] = 255;
      }
      target.putImageData(img, 0, 0);
    };

    const resize = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      if (!box) return;
      canvas.width = Math.max(1, box.width); canvas.height = Math.max(1, box.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const compose = (now: number) => {
      const fade = Math.min(1, (now - fadeStart) / 2000);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      if (fade < 1) { ctx.globalAlpha = 1 - fade; ctx.drawImage(prev, 0, 0, canvas.width, canvas.height); }
      ctx.globalAlpha = fade;
      ctx.drawImage(cur, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      const k = `${sceneRef.current.locale}::${sceneRef.current.tone.id}`;
      if (k !== key) {
        pctx.clearRect(0, 0, BW, BH); pctx.drawImage(cur, 0, 0);
        key = k; fadeStart = now; rebind(); fill(cctx, now); lastFill = now;
      } else if (now - lastFill > 140) { fill(cctx, now); lastFill = now; } // throttled drift
      compose(now);
    };

    if (reducedMotion()) {
      key = `${sceneRef.current.locale}::${sceneRef.current.tone.id}`;
      rebind(); fill(cctx, 0); fadeStart = -3000; compose(0);
      // still re-render on scene change, just without drift
      const iv = window.setInterval(() => {
        const k = `${sceneRef.current.locale}::${sceneRef.current.tone.id}`;
        if (k !== key) { key = k; rebind(); fill(cctx, 0); fadeStart = -3000; compose(0); }
      }, 500);
      return () => { window.clearInterval(iv); ro.disconnect(); };
    }

    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <canvas ref={canvasRef} aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
        opacity: level === "full" ? 0.32 : 0.16,
        filter: "saturate(1.1)", transform: "scale(1.06)" }} />
  );
}

