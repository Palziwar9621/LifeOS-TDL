// LifeOS — Kage ambient layer (影).
// A single fixed canvas rendered above the page content (pointer-events:
// none) that reacts to the user: a spotlight follows the cursor, embers
// drift upward with parallax against mouse movement, and a vermilion moon
// glow breathes. Active whenever the <html data-kage-ambient> flag is set
// (public site always; app when the Kage theme is on). Cheap: ~30 particles,
// transform-only math, rAF paused when the tab is hidden, disabled entirely
// under prefers-reduced-motion.
import React, { useEffect, useRef } from 'react';

interface Ember {
  x: number; y: number;      // current position (CSS px)
  r: number;                 // radius
  vy: number;                // rise speed
  drift: number;             // horizontal sway amplitude
  phase: number;             // sway phase
  depth: number;             // 0..1 — parallax factor + opacity
  alpha: number;
}

export function KageAmbient({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = window.innerWidth, h = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Pointer state (target + smoothed follow for that Kage "weight" feel)
    let mx = w * 0.7, my = h * 0.3;       // smoothed
    let tx = mx, ty = my;                 // target
    let hasMouse = false;
    const onMove = (e: PointerEvent) => { tx = e.clientX; ty = e.clientY; hasMouse = true; };
    window.addEventListener('pointermove', onMove, { passive: true });

    // Embers
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const embers: Ember[] = Array.from({ length: 26 }, () => ({
      x: rand(0, w), y: rand(0, h),
      r: rand(0.8, 2.6),
      vy: rand(0.15, 0.55),
      drift: rand(6, 26),
      phase: rand(0, Math.PI * 2),
      depth: rand(0.25, 1),
      alpha: rand(0.25, 0.75),
    }));

    // Moon glow breathing
    let t0 = performance.now();
    let raf = 0;
    let running = true;

    const draw = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(draw);
      const t = (now - t0) / 1000;

      // smooth cursor follow
      mx += (tx - mx) * 0.08;
      my += (ty - my) * 0.08;
      const px = (mx / w - 0.5); // -0.5..0.5
      const py = (my / h - 0.5);

      ctx.clearRect(0, 0, w, h);

      // --- moon glow (breathes, parallax-shifts slightly) ---
      const breathe = 0.75 + 0.25 * Math.sin(t * 0.7);
      const gx = w * 0.82 - px * 24;
      const gy = h * 0.16 - py * 18;
      const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.32);
      grd.addColorStop(0, `rgba(224, 60, 40, ${0.16 * breathe})`);
      grd.addColorStop(0.35, `rgba(180, 40, 28, ${0.07 * breathe})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);

      // --- cursor spotlight (the "focus follows me" effect) ---
      if (hasMouse) {
        const sp = ctx.createRadialGradient(mx, my, 0, mx, my, 220);
        sp.addColorStop(0, 'rgba(255, 150, 110, 0.10)');
        sp.addColorStop(0.5, 'rgba(224, 60, 40, 0.045)');
        sp.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sp;
        ctx.fillRect(mx - 240, my - 240, 480, 480);
      }

      // --- embers with mouse parallax ---
      for (const e of embers) {
        e.y -= e.vy;
        e.phase += 0.01;
        if (e.y < -12) { e.y = h + 12; e.x = rand(0, w); }
        const ox = Math.sin(e.phase) * e.drift - px * 30 * e.depth;
        const oy = -py * 18 * e.depth;
        ctx.beginPath();
        ctx.arc(e.x + ox, e.y + oy, e.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, ${110 + Math.floor(50 * e.depth)}, 80, ${e.alpha * e.depth})`;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    const onVis = () => {
      running = document.visibilityState === 'visible';
      if (running) { t0 = performance.now() - 0; raf = requestAnimationFrame(draw); }
      else cancelAnimationFrame(raf);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        width: '100%', height: '100%',
      }}
    />
  );
}

/** Convenience flag: is the ambient layer on for this document? */
export function kageAmbientActive(): boolean {
  return document.documentElement.hasAttribute('data-kage-ambient');
}
