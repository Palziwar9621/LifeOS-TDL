// LifeOS — native night-scene hero (影).
// Replaces the third-party Kage iframe with a scene of our own: ink sky,
// breathing vermilion moon, layered parallax mountain ridges, a torii gate
// silhouette, rising embers and drifting mist — drawn on ONE canvas with no
// external libraries. Pointer movement drives the parallax ("when I move it
// moves"), focus/sections get their energy from the same palette.
// Respects prefers-reduced-motion (renders a static frame) and pauses when
// the tab is hidden. Pointer-events: none — it never blocks the page.
import React, { useEffect, useRef } from 'react';

interface Ridge {
  seed: number;
  baseY: number;   // fraction of height
  amp: number;     // px amplitude
  speed: number;   // parallax factor
  color: string;
}

const RIDGES: Ridge[] = [
  { seed: 3.1, baseY: 0.66, amp: 52, speed: 0.35, color: '#14120f' },
  { seed: 7.7, baseY: 0.76, amp: 38, speed: 0.6, color: '#0e0d0b' },
  { seed: 11.3, baseY: 0.86, amp: 26, speed: 0.9, color: '#090908' },
];

export function NightScene({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0, h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // smoothed pointer (target + easing) — the scene follows the cursor
    let px = 0, py = 0;      // normalized -0.5..0.5
    let tx = 0, ty = 0;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // embers
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const embers = Array.from({ length: 22 }, () => ({
      x: rand(0, 1), y: rand(0, 1),
      r: rand(0.8, 2.4), vy: rand(0.00012, 0.00045),
      sway: rand(4, 20), phase: rand(0, Math.PI * 2),
      depth: rand(0.3, 1), alpha: rand(0.25, 0.8),
    }));

    const ridgeY = (r: Ridge, xNorm: number): number => {
      const x = xNorm * w;
      return h * r.baseY
        + Math.sin(x / 170 + r.seed) * r.amp
        + Math.sin(x / 61 + r.seed * 2.3) * r.amp * 0.35;
    };

    let raf = 0;
    let running = true;
    let t0 = performance.now();

    const drawStatic = () => {
      // one paint with neutral parallax — used for reduced-motion
      paint(0.25, 0, 0, 1);
    };

    const paint = (time: number, parX: number, parY: number, _frame: number) => {
      // --- sky ---
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#050608');
      sky.addColorStop(0.55, '#0a0b0d');
      sky.addColorStop(1, '#121110');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // --- moon: breathing vermilion disc with soft glow ---
      const breathe = 0.82 + 0.18 * Math.sin(time * 0.0007);
      const mx = w * 0.78 - parX * 26;
      const my = h * 0.22 - parY * 18;
      const mr = Math.min(w, h) * 0.085;
      const glow = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.2);
      glow.addColorStop(0, `rgba(224, 60, 40, ${0.28 * breathe})`);
      glow.addColorStop(0.4, `rgba(180, 40, 28, ${0.1 * breathe})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(236, 92, 72, ${0.95 * breathe})`;
      ctx.fill();
      // crater shading
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(190, 55, 40, 0.5)';
      ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // --- stars ---
      ctx.fillStyle = 'rgba(223, 231, 224, 0.5)';
      for (let i = 0; i < 46; i++) {
        const sx = ((i * 137.51) % 100) / 100 * w;
        const sy = ((i * 79.61) % 55) / 100 * h;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * 0.0004 + i));
        ctx.globalAlpha = 0.25 + 0.35 * tw;
        ctx.fillRect(sx - parX * 8, sy - parY * 6, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;

      // --- mountain ridges (back → front, parallax by depth) ---
      for (const r of RIDGES) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 20; x += 24) {
          ctx.lineTo(x - parX * 40 * r.speed, ridgeY(r, x / w) - parY * 14 * r.speed);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = r.color;
        ctx.fill();
      }

      // --- torii gate on the front ridge ---
      drawTorii(w * 0.76 - parX * 34, ridgeY(RIDGES[2], 0.76) - parY * 12, Math.min(w, 900) * 0.00092);

      // --- mist band ---
      const mist = ctx.createLinearGradient(0, h * 0.55, 0, h);
      mist.addColorStop(0, 'rgba(20, 19, 17, 0)');
      mist.addColorStop(0.6, 'rgba(24, 22, 20, 0.55)');
      mist.addColorStop(1, 'rgba(10, 10, 9, 0.9)');
      ctx.fillStyle = mist;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);

      // --- embers ---
      for (const e of embers) {
        if (!reducedMotion) {
          e.y -= e.vy * 16;
          e.phase += 0.012;
          if (e.y < -0.02) { e.y = 1.02; e.x = rand(0, 1); }
        }
        const ex = (e.x + Math.sin(e.phase) * e.sway / w) * w - parX * 30 * e.depth;
        const ey = e.y * h - parY * 20 * e.depth;
        ctx.beginPath();
        ctx.arc(ex, ey, e.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, ${110 + Math.floor(50 * e.depth)}, 80, ${e.alpha * e.depth})`;
        ctx.fill();
      }
    };

    const drawTorii = (cx: number, baseY: number, s: number) => {
      ctx.fillStyle = '#060505';
      const lw = 10 * s;
      // curved top lintel
      ctx.beginPath();
      ctx.moveTo(cx - 128 * s, baseY - 168 * s);
      ctx.quadraticCurveTo(cx, baseY - 186 * s, cx + 128 * s, baseY - 168 * s);
      ctx.lineTo(cx + 112 * s, baseY - 148 * s);
      ctx.quadraticCurveTo(cx, baseY - 164 * s, cx - 112 * s, baseY - 148 * s);
      ctx.closePath();
      ctx.fill();
      // second beam
      ctx.fillRect(cx - 88 * s, baseY - 108 * s, 176 * s, 7 * s);
      // pillars
      ctx.fillRect(cx - 96 * s, baseY - 152 * s, lw, 152 * s);
      ctx.fillRect(cx + 96 * s - lw, baseY - 152 * s, lw, 152 * s);
      // center strut
      ctx.fillRect(cx - 3 * s, baseY - 148 * s, 6 * s, 44 * s);
    };

    const loop = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      px += (tx - px) * 0.06;
      py += (ty - py) * 0.06;
      paint(now, px, py, 0);
    };

    if (reducedMotion) {
      drawStatic();
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        running = false; cancelAnimationFrame(raf);
      } else if (!reducedMotion && !running) {
        running = true; t0 = performance.now(); raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Night scene: a vermilion moon over layered mountains and a torii gate, with drifting embers — it follows your cursor"
      role="img"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  );
}
