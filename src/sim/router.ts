import type { Line, Shape, Station, Train } from './types';

/**
 * Passenger routing on a platform graph.
 *
 * Nodes: P(s) = waiting on the platform of station s; O(i, L, d) = aboard a
 * train of line L at stop index i that will depart in index direction d.
 * Instead of one search per passenger, we run one backward Dijkstra per
 * destination shape, giving the cost-to-go from every node. Passengers then
 * decide locally: board a specific train, stay aboard or alight.
 *
 * Costs are seconds. Transfers use half the line headway plus a penalty; the
 * origin wait is projected from actual train positions.
 */

export interface RouterHost {
  stations: Station[];
  lines: (Line | null)[];
  trains: Train[];
  stationById(id: number): Station | undefined;
  readonly trainSpeed: number;
  readonly dwellEstimate: number;
}

const TRANSFER_PENALTY = 4;
const REVERSAL_PENALTY = 3;
const EPOCH = 0.5;

export function nextIdx(line: Line, i: number, d: number): number {
  const n = line.stops.length;
  const j = i + d;
  return line.loop ? (j + n) % n : j;
}

export function departDir(line: Line, i: number, arrDir: 1 | -1): 1 | -1 {
  if (line.loop) return arrDir;
  const j = i + arrDir;
  return j < 0 || j >= line.stops.length ? (-arrDir as 1 | -1) : arrDir;
}

export function segIndex(line: Line, i: number, d: number): number {
  return d > 0 ? i : nextIdx(line, i, -1);
}

interface Edge {
  to: number;
  cost: number;
}

export type BoardChoice = { line: number; dir: 1 | -1; cost: number };

export class Router {
  private dirty = true;
  private nextEpoch = 0;
  private nodeCount = 0;
  private platform = new Map<number, number>(); // station id -> node
  private onboard = new Map<string, number>(); // `${line}:${i}:${d}` -> node
  private nodeStation: number[] = [];
  private rev: Edge[][] = [];
  private costs = new Map<Shape, Float64Array>();
  private waitCache = new Map<string, number>();
  private boardCache = new Map<string, BoardChoice | null>();

  constructor(private host: RouterHost) {}

  invalidate(): void {
    this.dirty = true;
  }

  update(time: number): void {
    if (this.dirty) this.build();
    if (time >= this.nextEpoch) {
      this.nextEpoch = time + EPOCH;
      this.waitCache.clear();
      this.boardCache.clear();
    }
  }

  private trainsOn(lineId: number): Train[] {
    return this.host.trains.filter((t) => t.line === lineId);
  }

  private headway(line: Line): number {
    const n = this.trainsOn(line.id).length;
    if (n === 0) return Infinity;
    let total = 0;
    for (const s of line.segs) total += s.length / this.host.trainSpeed + this.host.dwellEstimate;
    return (line.loop ? total : 2 * total) / n;
  }

  private rideCost(line: Line, i: number, d: 1 | -1): number {
    return line.segs[segIndex(line, i, d)].length / this.host.trainSpeed + this.host.dwellEstimate;
  }

  private build(): void {
    this.dirty = false;
    this.platform.clear();
    this.onboard.clear();
    this.nodeStation = [];
    this.costs.clear();
    this.waitCache.clear();
    this.boardCache.clear();
    const fwd: Edge[][] = [];
    const add = (station: number): number => {
      this.nodeStation.push(station);
      fwd.push([]);
      return this.nodeStation.length - 1;
    };
    for (const s of this.host.stations) this.platform.set(s.id, add(s.id));
    const lines = this.host.lines.filter((l): l is Line => !!l && l.stops.length >= 2);
    for (const line of lines) {
      if (!isFinite(this.headway(line))) continue;
      line.stops.forEach((sid, i) => {
        for (const d of [1, -1] as const) {
          if (!line.loop && (i + d < 0 || i + d >= line.stops.length)) continue;
          this.onboard.set(`${line.id}:${i}:${d}`, add(sid));
        }
      });
    }
    for (const line of lines) {
      const hw = this.headway(line);
      if (!isFinite(hw)) continue;
      line.stops.forEach((sid, i) => {
        for (const d of [1, -1] as const) {
          const o = this.onboard.get(`${line.id}:${i}:${d}`);
          if (o === undefined) continue;
          const p = this.platform.get(sid)!;
          fwd[o].push({ to: p, cost: 0 });
          fwd[p].push({ to: o, cost: hw / 2 + TRANSFER_PENALTY });
          const j = nextIdx(line, i, d);
          const d2 = departDir(line, j, d);
          const o2 = this.onboard.get(`${line.id}:${j}:${d2}`)!;
          fwd[o].push({ to: o2, cost: this.rideCost(line, i, d) + (d2 !== d ? REVERSAL_PENALTY : 0) });
        }
      });
    }
    this.nodeCount = fwd.length;
    this.rev = Array.from({ length: this.nodeCount }, () => []);
    fwd.forEach((edges, from) => edges.forEach((e) => this.rev[e.to].push({ to: from, cost: e.cost })));
  }

  /** Cost-to-go table toward any station of `dest`. */
  private costTo(dest: Shape): Float64Array {
    let c = this.costs.get(dest);
    if (c) return c;
    c = new Float64Array(this.nodeCount).fill(Infinity);
    const heap = new MinHeap();
    for (let n = 0; n < this.nodeCount; n++) {
      if (this.host.stationById(this.nodeStation[n])?.shape === dest) {
        c[n] = 0;
        heap.push(n, 0);
      }
    }
    while (heap.size) {
      const [n, cost] = heap.pop();
      if (cost > c[n]) continue;
      for (const e of this.rev[n]) {
        const nc = cost + e.cost;
        if (nc < c[e.to]) {
          c[e.to] = nc;
          heap.push(e.to, nc);
        }
      }
    }
    this.costs.set(dest, c);
    return c;
  }

  /** Cost of staying aboard from stop i departing d (ride on, never alight here). */
  private stayCost(line: Line, i: number, d: 1 | -1, c: Float64Array): number {
    if (this.onboard.get(`${line.id}:${i}:${d}`) === undefined) return Infinity;
    const j = nextIdx(line, i, d);
    const d2 = departDir(line, j, d);
    const o2 = this.onboard.get(`${line.id}:${j}:${d2}`);
    if (o2 === undefined) return Infinity;
    return this.rideCost(line, i, d) + (d2 !== d ? REVERSAL_PENALTY : 0) + c[o2];
  }

  /** Projected seconds until a train of `line` is at stop i ready to depart in direction d. */
  originWait(line: Line, i: number, d: 1 | -1): number {
    const key = `${line.id}:${i}:${d}`;
    const hit = this.waitCache.get(key);
    if (hit !== undefined) return hit;
    const v = this.host.trainSpeed;
    const n = line.stops.length;
    let best = Infinity;
    for (const t of this.trainsOn(line.id)) {
      if (t.orphan) continue;
      let idx: number;
      let dirArr: 1 | -1;
      let time: number;
      if (t.state === 'dwelling') {
        if (t.fromIdx === i && t.dir === d) {
          best = 0;
          break;
        }
        idx = t.fromIdx;
        time = 0;
        const dep = t.dir;
        time += this.rideCost(line, idx, dep);
        idx = nextIdx(line, idx, dep);
        dirArr = dep;
      } else {
        idx = t.toIdx;
        dirArr = t.dir;
        time = Math.max(0, t.pathLen - t.d) / v;
      }
      for (let k = 0; k < 2 * n + 2 && time < best; k++) {
        const dep = departDir(line, idx, dirArr);
        if (idx === i && dep === d) {
          best = Math.min(best, time);
          break;
        }
        time += this.rideCost(line, idx, dep);
        idx = nextIdx(line, idx, dep);
        dirArr = dep;
      }
    }
    this.waitCache.set(key, best);
    return best;
  }

  /** Best line/direction to board from `station`, or null if no route. A docked train counts as zero wait. */
  decideBoard(station: Station, dest: Shape, docked?: Train): BoardChoice | null {
    const key = `${station.id}:${dest}`;
    if (!docked && this.boardCache.has(key)) return this.boardCache.get(key)!;
    const c = this.costTo(dest);
    let best: BoardChoice | null = null;
    for (const line of this.host.lines) {
      if (!line) continue;
      const i = line.stops.indexOf(station.id);
      if (i < 0) continue;
      for (const d of [1, -1] as const) {
        const stay = this.stayCost(line, i, d, c);
        if (!isFinite(stay)) continue;
        const isDocked = docked && docked.line === line.id && !docked.orphan && docked.fromIdx === i && docked.dir === d;
        const total = (isDocked ? 0 : this.originWait(line, i, d)) + stay;
        if (isFinite(total) && (!best || total < best.cost)) best = { line: line.id, dir: d, cost: total };
      }
    }
    if (!docked) this.boardCache.set(key, best);
    return best;
  }

  /** What a rider on `train` does at stop i (train will depart in train.dir). */
  decideAlight(train: Train, station: Station, dest: Shape): 'deliver' | 'alight' | 'stay' {
    if (station.shape === dest) return 'deliver';
    const line = train.line >= 0 ? this.host.lines[train.line] : null;
    const c = this.costTo(dest);
    const p = this.platform.get(station.id);
    const alight = p === undefined ? Infinity : c[p];
    if (!line || train.orphan) return 'stay';
    const stay = this.stayCost(line, train.fromIdx, train.dir, c);
    if (!isFinite(alight)) return 'stay';
    return alight + 0.5 < stay ? 'alight' : 'stay';
  }

  /** Same decision, evaluated before the train reaches stop `i`. */
  wouldAlight(lineObj: Line, i: number, dep: 1 | -1, station: Station, dest: Shape): boolean {
    if (station.shape === dest) return true;
    const c = this.costTo(dest);
    const p = this.platform.get(station.id);
    const alight = p === undefined ? Infinity : c[p];
    if (!isFinite(alight)) return false;
    return alight + 0.5 < this.stayCost(lineObj, i, dep, c);
  }
}

class MinHeap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(node: number, cost: number): void {
    const a = this.items;
    a.push([node, cost]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
