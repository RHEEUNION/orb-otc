import { useEffect, useRef } from "react";

/**
 * Animated halftone field: a grid of dots whose size follows a slowly moving wave pattern.
 * Runs at ~24fps, pauses while the tab is hidden, and renders one still frame when the user prefers reduced motion.
 */
export function Halftone() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const GAP = 9;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const field = (x: number, y: number, t: number) => {
      const v =
        Math.sin(x * 0.011 + t * 0.5) +
        Math.sin(y * 0.014 - t * 0.35) +
        Math.sin((x * 0.6 + y) * 0.007 + t * 0.22) +
        Math.sin(Math.hypot(x - w * 0.72, y - h * 0.5) * 0.02 - t * 0.6);
      return (v + 4) / 8; // 0..1
    };

    const paint = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const k = Math.max(0, (field(x, y, t) - 0.45) / 0.55);
          if (k < 0.03) continue;
          ctx.globalAlpha = 0.06 + 0.5 * k;
          ctx.beginPath();
          ctx.arc(x, y, k * k * GAP * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || ts - last < 42) return;
      last = ts;
      paint(ts / 1000);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) paint(4);
    else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="halftone" aria-hidden="true" />;
}

/** Our own hexagon mark: an outlined hexagon that draws itself, with a slowly turning inner frame. */
export function HexMark() {
  const hex = (r: number, cx = 100, cy = 100) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  return (
    <svg className="hexmark" viewBox="0 0 200 200" aria-hidden="true">
      <polygon className="hex-outer" points={hex(88)} />
      <g className="hex-spin">
        <polygon className="hex-inner" points={hex(60)} />
        <polygon className="hex-inner faint" points={hex(38)} />
      </g>
      <circle className="hex-core" cx="100" cy="100" r="9" />
    </svg>
  );
}
