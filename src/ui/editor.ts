import { dist, distToSegment, norm, sub, v, type Vec2 } from '../sim/geom';
import type { Line, Station, Train } from '../sim/types';
import type { World } from '../sim/world';

export type ItemKind = 'loco' | 'carriage' | 'interchange';

type Drag =
  | { kind: 'new'; slot: number; stops: number[]; loop: boolean }
  | { kind: 'extend'; slot: number; head: boolean; stops: number[]; loop: boolean }
  | { kind: 'segment'; slot: number; stops: number[]; loop: boolean; insertPos: number; inserted: number[]; changed: boolean }
  | { kind: 'item'; item: ItemKind }
  | { kind: 'train'; trainId: number };

export interface EditPreview {
  slot: number;
  stops: number[];
  loop: boolean;
  ok: boolean;
  /** Station the dashed rubber band starts from, and (segment drags) the one it returns to. */
  from: number | null;
  to: number | null;
}

/** Handle at an open line's end: the stub's tip position and outward direction. */
export function lineHandles(line: Line): { head: boolean; tip: Vec2; dir: Vec2; base: Vec2 }[] {
  if (line.loop || line.segs.length === 0) return [];
  const first = line.segs[0].path;
  const last = line.segs[line.segs.length - 1].path;
  const mk = (head: boolean, base: Vec2, inner: Vec2) => {
    const dir = norm(sub(base, inner));
    return { head, base, dir, tip: v(base.x + dir.x * 34, base.y + dir.y * 34) };
  };
  return [mk(true, first[0], first[1]), mk(false, last[last.length - 1], last[last.length - 2])];
}

/**
 * Turns pointer gestures into proposed stop lists. The world validates and
 * applies them; the editor never mutates the network directly mid-drag.
 */
export class Editor {
  drag: Drag | null = null;
  cursor: Vec2 = v(0, 0);
  selectedLine = -1;
  private lastHover: number | null = null;
  /** Hit radius in screen px; touch gets a larger target. */
  hitPx = 24;

  constructor(
    private world: () => World,
    private pxToWorld: () => number,
  ) {}

  get active(): boolean {
    return this.drag !== null;
  }

  private get r(): number {
    return this.hitPx * this.pxToWorld();
  }

  stationAt(p: Vec2): Station | null {
    let best: Station | null = null;
    let bd = this.r;
    for (const s of this.world().stations) {
      const d = dist(s.pos, p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  trainAt(p: Vec2): Train | null {
    const w = this.world();
    for (const t of w.trains) if (t.line >= 0 && dist(w.trainPose(t).p, p) < this.r * 0.8) return t;
    return null;
  }

  segmentAt(p: Vec2): { line: Line; seg: number } | null {
    let best: { line: Line; seg: number } | null = null;
    let bd = this.r * 0.6;
    for (const line of this.world().lines) {
      if (!line) continue;
      line.segs.forEach((s, k) => {
        for (let i = 1; i < s.path.length; i++) {
          const d = distToSegment(p, s.path[i - 1], s.path[i]);
          if (d < bd) {
            bd = d;
            best = { line, seg: k };
          }
        }
      });
    }
    return best;
  }

  private handleAt(p: Vec2): { line: Line; head: boolean } | null {
    const w = this.world();
    for (const line of w.lines) {
      if (!line) continue;
      for (const h of lineHandles(line)) if (dist(h.tip, p) < this.r * 0.9) return { line, head: h.head };
    }
    return null;
  }

  beginItem(item: ItemKind, p: Vec2): void {
    this.cursor = p;
    this.drag = { kind: 'item', item };
  }

  down(p: Vec2): boolean {
    const w = this.world();
    this.cursor = p;
    const train = this.trainAt(p);
    if (train) {
      this.drag = { kind: 'train', trainId: train.id };
      return true;
    }
    const h = this.handleAt(p);
    if (h) {
      const stops = h.head ? h.line.stops.slice().reverse() : h.line.stops.slice();
      this.drag = { kind: 'extend', slot: h.line.id, head: h.head, stops, loop: false };
      this.lastHover = stops[stops.length - 1];
      return true;
    }
    const st = this.stationAt(p);
    if (st) {
      const slot = w.freeSlot();
      if (slot < 0) return false;
      this.drag = { kind: 'new', slot, stops: [st.id], loop: false };
      this.lastHover = st.id;
      return true;
    }
    const seg = this.segmentAt(p);
    if (seg) {
      const { line } = seg;
      this.drag = {
        kind: 'segment',
        slot: line.id,
        stops: line.stops.slice(),
        loop: line.loop,
        insertPos: seg.seg + 1,
        inserted: [],
        changed: false,
      };
      this.lastHover = null;
      this.selectedLine = line.id;
      return true;
    }
    this.selectedLine = -1;
    return false;
  }

  move(p: Vec2): void {
    this.cursor = p;
    const d = this.drag;
    if (!d || d.kind === 'item' || d.kind === 'train') return;
    const hover = this.stationAt(p)?.id ?? null;
    if (hover === this.lastHover) return;
    this.lastHover = hover;
    if (hover === null) return;
    if (d.kind === 'segment') this.enterSegment(d, hover);
    else this.enterEnd(d, hover);
  }

  private enterEnd(d: { stops: number[]; loop: boolean }, y: number): void {
    const s = d.stops;
    if (d.loop) {
      if (y === s[s.length - 1]) d.loop = false;
      return;
    }
    if (s.length >= 2 && y === s[s.length - 2]) s.pop();
    else if (s.length >= 3 && y === s[0]) d.loop = true;
    else if (!s.includes(y)) s.push(y);
  }

  private enterSegment(d: Extract<Drag, { kind: 'segment' }>, y: number): void {
    const s = d.stops;
    const n = s.length;
    const removable = (idx: number) => (d.loop ? n >= 4 : idx > 0 && idx < n - 1);
    const leftIdx = d.insertPos - 1;
    const rightIdx = d.insertPos % n;
    if (d.inserted.length && y === s[d.insertPos - 2]) {
      s.splice(d.insertPos - 1, 1);
      d.inserted.pop();
      d.insertPos--;
    } else if (!s.includes(y)) {
      s.splice(d.insertPos, 0, y);
      d.insertPos++;
      d.inserted.push(y);
    } else if (!d.inserted.length && y === s[leftIdx] && removable(leftIdx)) {
      s.splice(leftIdx, 1);
      d.insertPos--;
    } else if (!d.inserted.length && y === s[rightIdx] && removable(rightIdx)) {
      s.splice(rightIdx, 1);
      if (rightIdx < d.insertPos) d.insertPos--;
    } else return;
    d.changed = true;
  }

  up(p: Vec2, overUi: boolean): void {
    const w = this.world();
    this.cursor = p;
    const d = this.drag;
    this.drag = null;
    this.lastHover = null;
    if (!d) return;
    switch (d.kind) {
      case 'new':
        if (d.stops.length >= 2) w.commitLine(d.slot, d.stops, d.loop);
        break;
      case 'extend': {
        const stops = d.head ? d.stops.slice().reverse() : d.stops;
        if (stops.length < 2) w.deleteLine(d.slot);
        else w.commitLine(d.slot, stops, d.loop);
        break;
      }
      case 'segment':
        if (!d.changed) break;
        if (d.stops.length < 2) w.deleteLine(d.slot);
        else w.commitLine(d.slot, d.stops, d.loop && d.stops.length >= 3);
        break;
      case 'item': {
        if (overUi) break;
        if (d.item === 'loco') {
          const seg = this.segmentAt(p);
          if (seg) w.addTrain(seg.line.id, p);
        } else if (d.item === 'carriage') {
          const t = this.trainAt(p);
          if (t) w.addCarriage(t.id);
        } else {
          const s = this.stationAt(p);
          if (s) w.addInterchange(s.id);
        }
        break;
      }
      case 'train': {
        const seg = overUi ? null : this.segmentAt(p);
        if (seg) w.moveTrain(d.trainId, seg.line.id, p);
        else w.removeTrain(d.trainId);
        break;
      }
    }
  }

  cancel(): void {
    this.drag = null;
    this.lastHover = null;
  }

  /** What the renderer should draw instead of the real line during a drag. */
  preview(): EditPreview | null {
    const d = this.drag;
    if (!d || d.kind === 'item' || d.kind === 'train') return null;
    const w = this.world();
    const stops = d.kind === 'extend' && d.head ? d.stops.slice().reverse() : d.stops;
    const loop = d.loop && stops.length >= 3;
    const pv = w.previewLine(d.slot, stops, loop);
    const ok = stops.length < 2 ? true : pv.ok;
    if (d.kind === 'segment') {
      const n = d.stops.length;
      return { slot: d.slot, stops, loop, ok, from: d.stops[d.insertPos - 1] ?? null, to: n ? d.stops[d.insertPos % n] : null };
    }
    const from = d.loop ? null : d.stops[d.stops.length - 1];
    return { slot: d.slot, stops, loop, ok, from, to: null };
  }

  /** The item or train being carried, for the cursor ghost. */
  carried(): { item: ItemKind | 'train'; trainId?: number } | null {
    const d = this.drag;
    if (d?.kind === 'item') return { item: d.item };
    if (d?.kind === 'train') return { item: 'train', trainId: d.trainId };
    return null;
  }
}
