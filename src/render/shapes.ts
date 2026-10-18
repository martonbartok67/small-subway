import type { Shape } from '../sim/types';

/** Trace a station/passenger glyph of nominal radius r centred on (x, y). */
export function traceShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  ctx.beginPath();
  const poly = (n: number, rad: number, rot: number) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i * Math.PI * 2) / n;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'triangle':
      poly(3, r * 1.3, -Math.PI / 2);
      break;
    case 'square':
      ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
      break;
    case 'pentagon':
      poly(5, r * 1.1, -Math.PI / 2);
      break;
    case 'diamond':
      poly(4, r * 1.25, -Math.PI / 2);
      break;
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? r * 0.55 : r * 1.3;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
        else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      ctx.closePath();
      break;
    }
    case 'cross': {
      const a = r * 0.38;
      const b = r * 1.05;
      const pts = [
        [-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a],
        [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a],
      ];
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
      ctx.closePath();
      break;
    }
    case 'gem': {
      const w = r * 1.1;
      ctx.moveTo(x - w * 0.55, y - r * 0.7);
      ctx.lineTo(x + w * 0.55, y - r * 0.7);
      ctx.lineTo(x + w, y - r * 0.15);
      ctx.lineTo(x, y + r * 1.05);
      ctx.lineTo(x - w, y - r * 0.15);
      ctx.closePath();
      break;
    }
    case 'egg':
      ctx.ellipse(x, y + r * 0.08, r * 0.82, r * 1.08, 0, 0, Math.PI * 2);
      break;
    case 'wedge':
      // Teardrop: round bottom, pointed top.
      ctx.moveTo(x, y - r * 1.25);
      ctx.bezierCurveTo(x + r * 0.35, y - r * 0.7, x + r * 1.0, y - r * 0.1, x + r * 0.95, y + r * 0.3);
      ctx.arc(x, y + r * 0.3, r * 0.95, 0, Math.PI);
      ctx.bezierCurveTo(x - r * 1.0, y - r * 0.1, x - r * 0.35, y - r * 0.7, x, y - r * 1.25);
      ctx.closePath();
      break;
  }
}
