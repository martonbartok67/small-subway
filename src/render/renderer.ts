import { pointAt, v, type Vec2 } from '../sim/geom';
import type { Shape, Station, Train } from '../sim/types';
import type { World } from '../sim/world';
import { lineHandles, type Editor } from '../ui/editor';
import { traceShape } from './shapes';
import type { Theme } from './theme';

const LINE_W = 9;
const LOUPE_R = 64;
const LOUPE_ZOOM = 1.8;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  scale = 1;
  private ox = 0;
  private oy = 0;
  private cam: { halfW: number; halfH: number } | null = null;
  /** Screen px reserved for the HUD above and below the map. */
  insets = { top: 64, bottom: 92 };
  /** Glyphs grow when zoomed far out so they stay readable on small screens. */
  private boost = 1;
  private get stationR() {
    return 15 * this.boost;
  }
  private get carLen() {
    return 30 * Math.min(this.boost, 1.3);
  }
  private get carW() {
    return 15 * Math.min(this.boost, 1.3);
  }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  resetCamera(): void {
    this.cam = null;
  }

  private fit(world: World): void {
    const target = world.view();
    if (!this.cam) this.cam = { ...target };
    this.cam.halfW += (target.halfW - this.cam.halfW) * 0.04;
    this.cam.halfH += (target.halfH - this.cam.halfH) * 0.04;
    const { top, bottom } = this.insets;
    const availH = Math.max(100, this.h - top - bottom);
    this.scale = Math.min(this.w / (2 * this.cam.halfW + 60), availH / (2 * this.cam.halfH));
    this.ox = this.w / 2;
    this.oy = top + availH / 2;
    this.boost = Math.max(1, Math.min(1.7, 0.8 / this.scale));
  }

  toWorld(sx: number, sy: number): Vec2 {
    return v((sx - this.ox) / this.scale, (sy - this.oy) / this.scale);
  }

  toScreen(p: Vec2): Vec2 {
    return v(p.x * this.scale + this.ox, p.y * this.scale + this.oy);
  }

  draw(world: World, editor: Editor, theme: Theme, now: number): void {
    // iOS home-screen apps settle their viewport after launch without always firing
    // resize, which leaves the bitmap at a stale size and stretches the map. Re-check every frame.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h || dpr !== this.dpr) this.resize();
    this.fit(world);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
    this.drawScene(world, editor, theme, now);
    if (editor.active && editor.touch) this.drawLoupe(world, editor, theme, now);
  }

  private drawScene(world: World, editor: Editor, theme: Theme, now: number): void {
    this.drawWater(world, theme);
    const preview = editor.preview();
    this.drawLines(world, theme, preview?.slot ?? -1, editor.selectedLine);
    if (preview) this.drawPreview(world, editor, theme);
    for (const t of world.trains) this.drawTrain(world, t, theme);
    for (const s of world.stations) this.drawStation(world, s, theme, now);
    this.drawCarried(world, editor, theme);
  }

  /** Magnified view above the finger, so touch drags can see what they are aiming at. */
  private drawLoupe(world: World, editor: Editor, theme: Theme, now: number): void {
    const ctx = this.ctx;
    const f = this.toScreen(editor.cursor);
    const above = f.y - LOUPE_R - 56 > this.insets.top - 40;
    const c = v(Math.max(LOUPE_R + 6, Math.min(this.w - LOUPE_R - 6, f.x)), above ? f.y - LOUPE_R - 56 : f.y + LOUPE_R + 56);
    const k = this.scale * LOUPE_ZOOM;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(c.x, c.y, LOUPE_R, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.clip();
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * (c.x - editor.cursor.x * k), this.dpr * (c.y - editor.cursor.y * k));
    this.drawScene(world, editor, theme, now);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = theme.ui;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, LOUPE_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(c.x - 6, c.y);
    ctx.lineTo(c.x + 6, c.y);
    ctx.moveTo(c.x, c.y - 6);
    ctx.lineTo(c.x, c.y + 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawWater(world: World, theme: Theme): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.water;
    ctx.strokeStyle = theme.waterEdge;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const poly of world.city.water) {
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Stroke a polyline with rounded bends. */
  private tracePath(path: Vec2[], moveFirst = true): void {
    const ctx = this.ctx;
    if (moveFirst) ctx.moveTo(path[0].x, path[0].y);
    else ctx.lineTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length - 1; i++) ctx.arcTo(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y, 22);
    ctx.lineTo(path[path.length - 1].x, path[path.length - 1].y);
  }

  private drawLines(world: World, theme: Theme, skip: number, selected: number): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of world.lines) {
      if (!line || line.id === skip) continue;
      const color = theme.lines[line.id];
      ctx.strokeStyle = color;
      ctx.lineWidth = line.id === selected ? LINE_W + 4 : LINE_W;
      for (const seg of line.segs) {
        ctx.beginPath();
        this.tracePath(seg.path);
        ctx.stroke();
        if (seg.crossing) this.drawTunnelMark(seg.path, world, theme, color);
      }
      for (const h of lineHandles(line)) {
        ctx.beginPath();
        ctx.moveTo(h.base.x, h.base.y);
        ctx.lineTo(h.tip.x, h.tip.y);
        ctx.stroke();
        ctx.beginPath();
        const px = -h.dir.y * 12;
        const py = h.dir.x * 12;
        ctx.moveTo(h.tip.x - px, h.tip.y - py);
        ctx.lineTo(h.tip.x + px, h.tip.y + py);
        ctx.stroke();
      }
      if (world.trainsOn(line.id).length === 0 && line.segs[0]) {
        // Hint that this line needs a locomotive.
        const mid = pointAt(line.segs[0].path, line.segs[0].length / 2).p;
        ctx.fillStyle = theme.bg;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', mid.x, mid.y + 0.5);
      }
    }
  }

  /** Lighten the part of a segment that is over water so tunnels read clearly. */
  private drawTunnelMark(path: Vec2[], world: World, theme: Theme, color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    for (const poly of world.city.water) {
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.clip();
    ctx.strokeStyle = theme.water;
    ctx.lineWidth = LINE_W - 4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    this.tracePath(path);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.restore();
  }

  private drawPreview(world: World, editor: Editor, theme: Theme): void {
    const pv = editor.preview()!;
    const ctx = this.ctx;
    const color = theme.lines[pv.slot];
    const paths = pv.stops.length >= 2 ? world.previewLine(pv.slot, pv.stops, pv.loop).paths : [];
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < pv.stops.length; i++) pairs.push([pv.stops[i], pv.stops[i + 1]]);
    if (pv.loop) pairs.push([pv.stops[pv.stops.length - 1], pv.stops[0]]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = LINE_W;
    ctx.strokeStyle = color;
    ctx.globalAlpha = pv.ok ? 1 : 0.35;
    paths.forEach((path, i) => {
      const [a, b] = pairs[i];
      if (pv.to !== null && a === pv.from && b === pv.to) return; // replaced by the rubber band
      ctx.beginPath();
      this.tracePath(path);
      ctx.stroke();
    });
    const from = pv.from !== null ? world.stationById(pv.from) : undefined;
    if (from) {
      ctx.setLineDash([2, 14]);
      ctx.beginPath();
      ctx.moveTo(from.pos.x, from.pos.y);
      ctx.lineTo(editor.cursor.x, editor.cursor.y);
      const to = pv.to !== null ? world.stationById(pv.to) : undefined;
      if (to) ctx.lineTo(to.pos.x, to.pos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  private drawTrain(world: World, t: Train, theme: Theme): void {
    const ctx = this.ctx;
    const color = theme.lines[t.color];
    const cap = world.city.train.capacity;
    for (let c = 0; c < t.cars; c++) {
      // Leading car at d, carriages trail behind along the path.
      const back = c * (this.carLen + 4);
      const pose = pointAt(t.path, t.d - back);
      const ang = Math.atan2(pose.t.y, pose.t.x);
      ctx.save();
      ctx.translate(pose.p.x, pose.p.y);
      ctx.rotate(ang);
      ctx.fillStyle = color;
      ctx.globalAlpha = t.line < 0 ? 0.5 : 1;
      roundRect(ctx, -this.carLen / 2, -this.carW / 2, this.carLen, this.carW, 3);
      ctx.fill();
      const riders = t.riders.slice(c * cap, (c + 1) * cap);
      riders.forEach((r, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const k = this.carLen / 30;
        this.fillGlyph(r.dest, (-9 + col * 9) * k, (-3.5 + row * 7) * k, 2.6 * k, theme.trainPeep);
      });
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private fillGlyph(shape: Shape, x: number, y: number, r: number, color: string): void {
    this.ctx.fillStyle = color;
    traceShape(this.ctx, shape, x, y, r);
    this.ctx.fill();
  }

  private drawStation(world: World, s: Station, theme: Theme, now: number): void {
    const ctx = this.ctx;
    const age = world.time - s.bornAt;
    const pop = age < 0.6 ? 0.6 + 0.4 * Math.sin((age / 0.6) * Math.PI * 0.5) : 1;
    const r = this.stationR * pop;
    const { x, y } = s.pos;

    if (s.overcrowd > 0) {
      const frac = Math.min(1, s.overcrowd);
      const pulse = frac > 0.7 ? 0.5 + 0.5 * Math.sin(now / 120) : 1;
      ctx.fillStyle = theme.ring;
      ctx.globalAlpha = 0.1 + 0.08 * pulse;
      ctx.beginPath();
      ctx.arc(x, y, r + 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r + 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.lineWidth = 4;
    ctx.strokeStyle = theme.stationStroke;
    ctx.fillStyle = theme.stationFill;
    if (s.isInterchange) {
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    traceShape(ctx, s.shape, x, y, r);
    ctx.fill();
    ctx.stroke();

    // Waiting passengers to the right, rows of six.
    const cap = world.capacityOf(s);
    const per = 6;
    s.waiting.forEach((p, i) => {
      const col = i % per;
      const row = Math.floor(i / per);
      const color = i >= cap ? '#d23b2a' : theme.peep;
      const b = this.boost;
      this.fillGlyph(p.dest, x + r + 13 * b + col * 11 * b, y - r + 4 * b + row * 11 * b, 3.6 * b, color);
    });
  }

  private drawCarried(world: World, editor: Editor, theme: Theme): void {
    const c = editor.carried();
    if (!c) return;
    const ctx = this.ctx;
    const p = editor.cursor;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = theme.ui;
    if (c.item === 'loco' || c.item === 'carriage' || c.item === 'train') {
      const t = c.trainId !== undefined ? world.trains.find((x) => x.id === c.trainId) : undefined;
      ctx.fillStyle = t ? theme.lines[t.color] : theme.ui;
      roundRect(ctx, p.x - this.carLen / 2, p.y - this.carW / 2, this.carLen, this.carW, 3);
      ctx.fill();
      if (c.item === 'carriage') {
        ctx.strokeStyle = theme.bg;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.ui;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.stationR + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
