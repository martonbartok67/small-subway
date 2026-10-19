import {
  dist,
  distToPolygonEdge,
  distToSegment,
  octilinearOptions,
  offsetPolyline,
  pointAt,
  pointInPolygon,
  polylineHitsPolygon,
  polylineLength,
  v,
  type Vec2,
} from './geom';
import { Rng } from './rng';
import { departDir, nextIdx, Router, segIndex } from './router';
import {
  BASIC_SHAPES,
  isSpecial,
  type CityDef,
  type Inventory,
  type Line,
  type Passenger,
  type Segment,
  type Shape,
  type SimEvent,
  type SpawnType,
  type Station,
  type Train,
  type UpgradeKind,
} from './types';

export const LINE_SPACING = 10;
const REPLACING_SPECIALS: Shape[] = ['wedge', 'star', 'cross'];

export interface LinePreview {
  ok: boolean;
  paths: Vec2[][];
  crossingsNeeded: number;
}

export class World {
  readonly rng: Rng;
  time = 0;
  stations: Station[] = [];
  lines: (Line | null)[];
  trains: Train[] = [];
  inv: Inventory;
  score = 0;
  week = 0;
  events: SimEvent[] = [];
  pendingUpgrade: UpgradeKind[] | null = null;
  over: { station: number; day: number } | null = null;
  /** Bumped on every network change so renderers can cache geometry. */
  networkVersion = 0;
  readonly router: Router;

  private nextId = 1;
  private byId = new Map<number, Station>();
  private spawnQueue: { type: SpawnType; at: number }[] = [];
  private nextScheduleAt = 0.5;
  private lastSpawnAt = -Infinity;
  private baseCache = new Map<string, { path: Vec2[]; crossing: boolean }>();

  constructor(
    readonly city: CityDef,
    readonly seed: number,
  ) {
    this.rng = new Rng(seed);
    this.lines = new Array(city.lines.max).fill(null);
    this.inv = {
      locomotives: city.start.locomotives,
      carriages: 0,
      interchanges: 0,
      crossingsTotal: city.start.crossings,
      linesUnlocked: city.lines.start,
    };
    const self = this;
    this.router = new Router({
      get stations() {
        return self.stations;
      },
      get lines() {
        return self.lines;
      },
      get trains() {
        return self.trains;
      },
      stationById: (id) => self.byId.get(id),
      trainSpeed: city.train.speed,
      dwellEstimate: 1,
    });
    this.placeStartStations();
  }

  // ---------- clock and view ----------

  get day(): number {
    return this.time / this.city.dayLength;
  }

  get maxTrainsPerLine(): number {
    return 11 - this.city.lines.max;
  }

  view(): { halfW: number; halfH: number } {
    const c = this.city.camera;
    const t = Math.max(0, Math.min(1, (this.day - c.delayDays) / c.durationDays));
    const e = t * t * (3 - 2 * t);
    const halfH = c.startHalfH + (c.endHalfH - c.startHalfH) * e;
    return { halfW: halfH * c.aspect, halfH };
  }

  stationById(id: number): Station | undefined {
    return this.byId.get(id);
  }

  capacityOf(s: Station): number {
    return s.isInterchange ? this.city.interchangeCapacity : this.city.stationCapacity;
  }

  trainCapacity(t: Train): number {
    return t.cars * this.city.train.capacity;
  }

  // ---------- main step ----------

  step(dt: number): void {
    if (this.over || this.pendingUpgrade) return;
    this.time += dt;
    this.spawnStations();
    this.spawnPassengers(dt);
    this.router.update(this.time);
    for (const t of this.trains.slice()) this.updateTrain(t, dt);
    this.updateOvercrowding(dt);
    if (Math.floor(this.day / 7) > this.week) {
      this.week++;
      this.inv.locomotives++;
      this.pendingUpgrade = this.rollUpgrades();
      this.events.push({ type: 'weekEnd', week: this.week });
    }
  }

  // ---------- stations ----------

  private placeStartStations(): void {
    const { halfH } = this.view();
    const shapes: Shape[] = ['circle', 'triangle', 'square'];
    for (const shape of shapes) {
      for (let tries = 0; tries < 200; tries++) {
        const p = v(this.rng.range(-halfH, halfH) * this.city.camera.aspect * 0.6, this.rng.range(-halfH, halfH) * 0.6);
        if (this.isDry(p) && this.stations.every((s) => dist(s.pos, p) > 200)) {
          this.addStation(p, shape);
          break;
        }
      }
    }
  }

  private isDry(p: Vec2): boolean {
    return this.city.water.every((w) => !pointInPolygon(p, w) && distToPolygonEdge(p, w) > 45);
  }

  private addStation(pos: Vec2, shape: Shape): Station {
    const s: Station = {
      id: this.nextId++,
      pos,
      shape,
      waiting: [],
      isInterchange: false,
      overcrowd: 0,
      spawnTimer: this.passengerInterval() * this.rng.range(0.3, 1.0),
      bornAt: this.time,
    };
    this.stations.push(s);
    this.byId.set(s.id, s);
    this.router.invalidate();
    this.events.push({ type: 'stationSpawn', station: s.id });
    return s;
  }

  private spawnStations(): void {
    const day = this.day;
    if (this.spawnQueue.length === 0 && day >= this.nextScheduleAt) {
      const sched = this.rng.pick(this.city.schedules);
      const k = sched.types.length;
      const slot = sched.numDays / k;
      this.spawnQueue = sched.types
        .map((type, i) => {
          const even = day + (i + 0.5) * slot;
          const rand = day + this.rng.next() * sched.numDays;
          return { type, at: even + (rand - even) * sched.randomness };
        })
        .sort((a, b) => a.at - b.at);
      this.nextScheduleAt = day + sched.numDays + this.city.cooldownDays;
    }
    if (this.spawnQueue.length && this.spawnQueue[0].at <= day && day - this.lastSpawnAt >= this.city.minSpawnGapDays) {
      const item = this.spawnQueue.shift()!;
      // Retry later instead of banning the type when there is no room.
      if (this.tryPlace(item.type)) this.lastSpawnAt = day;
      else this.spawnQueue.unshift({ type: item.type, at: day + 0.25 });
    }
  }

  private tryPlace(type: SpawnType): boolean {
    let shape: Shape;
    if (type === 'SPECIAL') {
      const free = this.city.specials.filter((sp) => !this.stations.some((s) => s.shape === sp));
      shape = free.length ? this.rng.pick(free) : 'circle';
    } else shape = type;
    const { halfW, halfH } = this.view();
    const visible = (p: Vec2) => Math.abs(p.x) < halfW - 50 && Math.abs(p.y) < halfH - 50;

    if (REPLACING_SPECIALS.includes(shape) && this.rng.next() < 0.5) {
      const circles = this.stations.filter((s) => s.shape === 'circle' && visible(s.pos));
      if (circles.length > 3) {
        const s = this.rng.pick(circles);
        s.shape = shape;
        this.router.invalidate();
        this.events.push({ type: 'stationSpawn', station: s.id });
        return true;
      }
    }

    const key: SpawnType = isSpecial(shape) ? 'SPECIAL' : (shape as SpawnType);
    // Only areas whose bbox overlaps the current view can host the station.
    const areas = this.city.areas
      .filter((a) => a.activeDay <= this.day)
      .map((a) => {
        const xs = a.poly.map((p) => p.x);
        const ys = a.poly.map((p) => p.y);
        const box = {
          x0: Math.max(Math.min(...xs), -halfW + 50),
          x1: Math.min(Math.max(...xs), halfW - 50),
          y0: Math.max(Math.min(...ys), -halfH + 50),
          y1: Math.min(Math.max(...ys), halfH - 50),
        };
        return { a, ...box };
      })
      .filter((b) => b.x0 < b.x1 && b.y0 < b.y1);
    for (let attempt = 0; attempt < 4; attempt++) {
      const pick = this.rng.weighted(areas, (b) => b.a.weights[key] ?? 0);
      if (!pick) return false;
      const { a: area, x0, x1, y0, y1 } = pick;
      const sep = 140 / area.density;
      for (let i = 0; i < 30; i++) {
        const p = v(this.rng.range(x0, x1), this.rng.range(y0, y1));
        if (!pointInPolygon(p, area.poly) || !this.isDry(p)) continue;
        if (this.stations.some((s) => dist(s.pos, p) < sep)) continue;
        this.addStation(p, shape);
        return true;
      }
    }
    return false;
  }

  // ---------- passengers ----------

  passengerInterval(): number {
    const p = this.city.passenger;
    return Math.max(p.minInterval, p.baseInterval / (1 + p.growthPerDay * this.day)) / p.scale;
  }

  private spawnPassengers(dt: number): void {
    const present = new Set(this.stations.map((s) => s.shape));
    for (const s of this.stations) {
      s.spawnTimer -= dt;
      if (s.spawnTimer > 0) continue;
      s.spawnTimer = this.passengerInterval() * this.rng.range(0.7, 1.3);
      const dest = this.pickDestination(s.shape, present);
      if (dest) s.waiting.push({ id: this.nextId++, dest, spawnedAt: this.time });
    }
  }

  private pickDestination(own: Shape, present: Set<Shape>): Shape | undefined {
    const kind = isSpecial(own) ? 'special' : (own as 'circle' | 'triangle' | 'square');
    const table = this.city.demand[kind];
    const options: { shape: Shape; w: number }[] = [];
    for (const [k, w] of Object.entries(table) as [keyof typeof table, number][]) {
      if (k === 'special') {
        const sp = [...present].filter((s) => isSpecial(s) && s !== own);
        for (const s of sp) options.push({ shape: s, w: w / sp.length });
      } else if (k !== own && present.has(k)) options.push({ shape: k, w });
    }
    if (options.length === 0) {
      // Fall back to any other basic shape so no station is ever silent.
      const any = BASIC_SHAPES.filter((s) => s !== own && present.has(s));
      return any.length ? this.rng.pick(any) : undefined;
    }
    return this.rng.weighted(options, (o) => o.w)?.shape;
  }

  // ---------- overcrowding ----------

  private updateOvercrowding(dt: number): void {
    const docked = new Set(this.trains.filter((t) => t.dockedAt !== null).map((t) => t.dockedAt!));
    const sec = this.city.overcrowdSeconds;
    const limit = 1 + this.city.graceSeconds / sec;
    for (const s of this.stations) {
      if (s.waiting.length > this.capacityOf(s)) {
        if (!docked.has(s.id)) s.overcrowd += dt / sec;
      } else s.overcrowd = Math.max(0, s.overcrowd - dt / sec);
      if (s.overcrowd >= limit) {
        if (this.inv.interchanges > 0 && !s.isInterchange) {
          this.inv.interchanges--;
          s.isInterchange = true;
          s.overcrowd = 0;
        } else {
          this.over = { station: s.id, day: this.day };
          this.events.push({ type: 'gameOver', station: s.id });
          return;
        }
      }
    }
  }

  // ---------- upgrades ----------

  private rollUpgrades(): UpgradeKind[] {
    const pool: UpgradeKind[] = ['carriage', 'crossings', 'interchange'];
    if (this.inv.linesUnlocked < this.city.lines.max) pool.push('line');
    const out: UpgradeKind[] = [];
    while (out.length < 2 && pool.length) out.push(pool.splice(this.rng.int(pool.length), 1)[0]);
    return out;
  }

  chooseUpgrade(kind: UpgradeKind): void {
    if (!this.pendingUpgrade?.includes(kind)) return;
    if (kind === 'line') this.inv.linesUnlocked++;
    else if (kind === 'carriage') this.inv.carriages++;
    else if (kind === 'crossings') this.inv.crossingsTotal += 2;
    else this.inv.interchanges++;
    this.pendingUpgrade = null;
    // Leave at least 2 s on any running overcrowd timer.
    for (const s of this.stations) s.overcrowd = Math.min(s.overcrowd, 1);
  }

  // ---------- network geometry ----------

  private basePath(a: number, b: number): { path: Vec2[]; crossing: boolean } {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}-${hi}`;
    let hit = this.baseCache.get(key);
    if (!hit) {
      const opts = octilinearOptions(this.byId.get(lo)!.pos, this.byId.get(hi)!.pos);
      const wet = (p: Vec2[]) => this.city.water.some((w) => polylineHitsPolygon(p, w));
      const dry = opts.find((p) => !wet(p));
      const path = dry ?? opts[0];
      hit = { path, crossing: !dry };
      this.baseCache.set(key, hit);
    }
    return a === lo ? hit : { path: hit.path.slice().reverse(), crossing: hit.crossing };
  }

  private pairs(stops: number[], loop: boolean): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < stops.length; i++) out.push([stops[i], stops[i + 1]]);
    if (loop && stops.length >= 3) out.push([stops[stops.length - 1], stops[0]]);
    return out;
  }

  crossingsUsed(exceptLine = -1): number {
    let n = 0;
    for (const l of this.lines) if (l && l.id !== exceptLine) n += l.segs.filter((s) => s.crossing).length;
    return n;
  }

  get crossingsFree(): number {
    return this.inv.crossingsTotal - this.crossingsUsed();
  }

  /** Validate a proposed stop list for line `slot` without changing anything. */
  previewLine(slot: number, stops: number[], loop: boolean): LinePreview {
    const unique = new Set(stops).size === stops.length;
    const pairs = this.pairs(stops, loop);
    const paths = pairs.map(([a, b]) => this.basePath(a, b).path);
    const crossingsNeeded = pairs.filter(([a, b]) => this.basePath(a, b).crossing).length;
    const budget = this.inv.crossingsTotal - this.crossingsUsed(slot);
    const ok = unique && stops.length >= 2 && (!loop || stops.length >= 3) && crossingsNeeded <= budget;
    return { ok, paths, crossingsNeeded };
  }

  private rebuildGeometry(): void {
    const users = new Map<string, number[]>();
    for (const l of this.lines) {
      if (!l) continue;
      for (const [a, b] of this.pairs(l.stops, l.loop)) {
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        const arr = users.get(k) ?? [];
        arr.push(l.id);
        users.set(k, arr);
      }
    }
    for (const l of this.lines) {
      if (!l) continue;
      l.segs = this.pairs(l.stops, l.loop).map(([a, b]): Segment => {
        const lo = Math.min(a, b);
        const k = `${lo}-${Math.max(a, b)}`;
        const ids = users.get(k)!.sort((x, y) => x - y);
        const off = (ids.indexOf(l.id) - (ids.length - 1) / 2) * LINE_SPACING;
        const base = this.basePath(lo, Math.max(a, b));
        let path = offsetPolyline(base.path, off);
        if (a !== lo) path = path.reverse();
        return { a, b, path, length: polylineLength(path), crossing: base.crossing };
      });
    }
    this.networkVersion++;
    this.router.invalidate();
    this.resyncTrains();
  }

  private segPath(line: Line, i: number, d: 1 | -1): { path: Vec2[]; len: number } {
    const seg = line.segs[segIndex(line, i, d)];
    return { path: d > 0 ? seg.path : seg.path.slice().reverse(), len: seg.length };
  }

  private resyncTrains(): void {
    for (const t of this.trains) {
      const line = t.line >= 0 ? this.lines[t.line] : null;
      if (!line) continue;
      if (t.state === 'dwelling') {
        const idx = line.stops.indexOf(t.dockedAt!);
        if (idx >= 0) {
          t.orphan = false;
          t.fromIdx = idx;
          t.dir = departDir(line, idx, t.dir);
        } else t.orphan = true;
        continue;
      }
      const fi = line.stops.indexOf(t.fromStation);
      const ti = line.stops.indexOf(t.toStation);
      let dir: 0 | 1 | -1 = 0;
      if (fi >= 0 && ti >= 0) {
        if (nextIdx(line, fi, 1) === ti && (line.loop || fi + 1 < line.stops.length)) dir = 1;
        else if (nextIdx(line, fi, -1) === ti && (line.loop || fi - 1 >= 0)) dir = -1;
      }
      if (dir === 0) {
        t.orphan = true;
        continue;
      }
      const frac = t.pathLen > 0 ? t.d / t.pathLen : 0;
      const sp = this.segPath(line, fi, dir);
      Object.assign(t, { orphan: false, fromIdx: fi, toIdx: ti, dir, path: sp.path, pathLen: sp.len, d: frac * sp.len });
    }
  }

  // ---------- network edits (called by the editor) ----------

  freeSlot(): number {
    for (let i = 0; i < this.inv.linesUnlocked; i++) if (!this.lines[i]) return i;
    return -1;
  }

  /** Create or replace line `slot`. Returns false (and changes nothing) if invalid. */
  commitLine(slot: number, stops: number[], loop: boolean): boolean {
    if (slot < 0 || slot >= this.inv.linesUnlocked) return false;
    if (!this.previewLine(slot, stops, loop).ok) return false;
    const existing = this.lines[slot];
    const isNew = !existing;
    this.lines[slot] = { id: slot, stops: stops.slice(), loop, segs: existing?.segs ?? [] };
    this.rebuildGeometry();
    if (isNew && this.inv.locomotives > 0) this.addTrain(slot);
    return true;
  }

  deleteLine(slot: number): void {
    if (!this.lines[slot]) return;
    this.lines[slot] = null;
    for (const t of this.trains.slice()) {
      if (t.line !== slot) continue;
      if (t.state === 'dwelling') this.retireTrain(t, this.byId.get(t.dockedAt!)!);
      else t.line = -1; // finishes its segment, then retires
    }
    this.rebuildGeometry();
  }

  trainsOn(slot: number): Train[] {
    return this.trains.filter((t) => t.line === slot);
  }

  canAddTrain(slot: number): boolean {
    return !!this.lines[slot] && this.inv.locomotives > 0 && this.trainsOn(slot).length < this.maxTrainsPerLine;
  }

  /** Put a locomotive on line `slot`, near `near` if given. */
  addTrain(slot: number, near?: Vec2, cars = 1): Train | null {
    const line = this.lines[slot];
    if (!line || !this.canAddTrain(slot)) return null;
    let fi = 0;
    let dir: 1 | -1 = 1;
    let frac = 0;
    if (near) {
      let best = Infinity;
      line.segs.forEach((seg, k) => {
        for (let p = 1; p < seg.path.length; p++) {
          const dd = distToSegment(near, seg.path[p - 1], seg.path[p]);
          if (dd < best) {
            best = dd;
            fi = k;
            const before = polylineLength(seg.path.slice(0, p));
            frac = Math.min(0.95, (before + dist(seg.path[p - 1], near)) / Math.max(1, seg.length));
          }
        }
      });
    }
    if (!line.loop && fi >= line.stops.length - 1) {
      fi = line.stops.length - 2;
      dir = 1;
    }
    const sp = this.segPath(line, fi, dir);
    const t: Train = {
      id: this.nextId++,
      line: slot,
      color: slot,
      fromIdx: fi,
      toIdx: nextIdx(line, fi, dir),
      fromStation: line.stops[fi],
      toStation: line.stops[nextIdx(line, fi, dir)],
      dir,
      orphan: false,
      path: sp.path,
      pathLen: sp.len,
      d: frac * sp.len,
      speed: 0,
      state: 'moving',
      dwell: 0,
      dockedAt: null,
      stopDecided: false,
      stopping: false,
      cars,
      riders: [],
    };
    this.inv.locomotives--;
    this.trains.push(t);
    this.router.invalidate();
    return t;
  }

  /** Lift a train off the network, dropping riders at its last station. */
  removeTrain(id: number): void {
    const t = this.trains.find((x) => x.id === id);
    if (!t) return;
    this.retireTrain(t, this.byId.get(t.dockedAt ?? t.fromStation) ?? this.byId.get(t.toStation)!);
  }

  moveTrain(id: number, slot: number, near: Vec2): boolean {
    const t = this.trains.find((x) => x.id === id);
    if (!t || !this.lines[slot]) return false;
    if (t.line !== slot && this.trainsOn(slot).length >= this.maxTrainsPerLine) return false;
    const cars = t.cars;
    this.removeTrain(id);
    this.inv.carriages -= cars - 1;
    return !!this.addTrain(slot, near, cars);
  }

  private retireTrain(t: Train, at: Station): void {
    for (const r of t.riders) this.dropRider(r, at, t.color);
    t.riders = [];
    this.inv.locomotives++;
    this.inv.carriages += t.cars - 1;
    this.trains.splice(this.trains.indexOf(t), 1);
    this.router.invalidate();
  }

  private dropRider(r: Passenger, at: Station, color: number): void {
    if (at.shape === r.dest) this.deliver(at, color);
    else at.waiting.push(r);
  }

  addCarriage(trainId: number): boolean {
    const t = this.trains.find((x) => x.id === trainId);
    if (!t || this.inv.carriages <= 0 || t.cars >= this.city.train.maxCars) return false;
    t.cars++;
    this.inv.carriages--;
    return true;
  }

  addInterchange(stationId: number): boolean {
    const s = this.byId.get(stationId);
    if (!s || s.isInterchange || this.inv.interchanges <= 0) return false;
    s.isInterchange = true;
    this.inv.interchanges--;
    return true;
  }

  // ---------- trains ----------

  trainPose(t: Train): { p: Vec2; t: Vec2 } {
    return pointAt(t.path, t.d);
  }

  private deliver(at: Station, color: number): void {
    this.score++;
    this.events.push({ type: 'deliver', station: at.id, line: color });
  }

  private updateTrain(t: Train, dt: number): void {
    if (t.state === 'dwelling') return this.updateDwell(t, dt);
    const cfg = this.city.train;
    const remaining = t.pathLen - t.d;
    const brake = (t.speed * t.speed) / (2 * cfg.decel);
    if (!t.stopDecided && remaining <= brake + t.speed * dt + 4) {
      t.stopping = this.shouldStop(t);
      t.stopDecided = true;
    }
    if (t.stopping) {
      const cap = Math.sqrt(2 * cfg.decel * Math.max(0, remaining));
      t.speed = Math.min(t.speed + cfg.accel * dt, cfg.speed, Math.max(cap, 12));
    } else t.speed = Math.min(t.speed + cfg.accel * dt, cfg.speed);
    t.d += t.speed * dt;
    if (t.d >= t.pathLen) this.arrive(t, t.d - t.pathLen);
  }

  private shouldStop(t: Train): boolean {
    if (t.orphan || t.line < 0) return true;
    const line = this.lines[t.line]!;
    const st = this.byId.get(t.toStation)!;
    const dep = departDir(line, t.toIdx, t.dir);
    let leaving = 0;
    for (const r of t.riders) if (this.router.wouldAlight(line, t.toIdx, dep, st, r.dest)) leaving++;
    if (leaving > 0) return true;
    if (t.riders.length - leaving >= this.trainCapacity(t)) return false;
    for (const p of st.waiting) {
      const b = this.router.decideBoard(st, p.dest);
      if (b && b.line === line.id && b.dir === dep) return true;
    }
    return false;
  }

  private nearestOnLine(line: Line, from: Vec2): Station {
    let best = this.byId.get(line.stops[0])!;
    for (const id of line.stops) {
      const s = this.byId.get(id)!;
      if (dist(s.pos, from) < dist(best.pos, from)) best = s;
    }
    return best;
  }

  /** Send an orphaned train straight to the nearest station still on its line. */
  private rejoin(t: Train, line: Line, at: Station, overshoot: number): void {
    const target = this.nearestOnLine(line, at.pos);
    Object.assign(t, {
      fromStation: at.id,
      toStation: target.id,
      path: [at.pos, target.pos],
      pathLen: Math.max(1, dist(at.pos, target.pos)),
      d: overshoot,
      state: 'moving',
      dockedAt: null,
      stopDecided: true,
      stopping: true,
      orphan: true,
    });
  }

  private arrive(t: Train, overshoot: number): void {
    const st = this.byId.get(t.toStation)!;
    if (t.line < 0) return this.retireTrain(t, st);
    const line = this.lines[t.line]!;
    if (t.orphan) {
      const idx = line.stops.indexOf(st.id);
      if (idx < 0) {
        t.riders = t.riders.filter((r) => (r.dest === st.shape ? (this.deliver(st, t.color), false) : true));
        return this.rejoin(t, line, st, overshoot);
      }
      t.orphan = false;
      t.fromIdx = idx;
      t.dir = departDir(line, idx, t.dir);
      return this.dock(t, st);
    }
    t.fromIdx = t.toIdx;
    t.fromStation = st.id;
    t.dir = departDir(line, t.fromIdx, t.dir);
    if (t.stopping) return this.dock(t, st);
    this.startSegment(t, line, overshoot);
  }

  private dock(t: Train, st: Station): void {
    t.state = 'dwelling';
    t.speed = 0;
    t.dockedAt = st.id;
    t.fromStation = st.id;
    t.d = t.pathLen;
    t.dwell = 0.15;
  }

  private startSegment(t: Train, line: Line, overshoot: number): void {
    const j = nextIdx(line, t.fromIdx, t.dir);
    const sp = this.segPath(line, t.fromIdx, t.dir);
    Object.assign(t, {
      toIdx: j,
      fromStation: line.stops[t.fromIdx],
      toStation: line.stops[j],
      path: sp.path,
      pathLen: sp.len,
      d: overshoot,
      state: 'moving',
      dockedAt: null,
      stopDecided: false,
      stopping: false,
    });
  }

  private updateDwell(t: Train, dt: number): void {
    t.dwell -= dt;
    if (t.dwell > 0) return;
    const st = this.byId.get(t.dockedAt!)!;
    if (t.line < 0) return this.retireTrain(t, st);
    const line = this.lines[t.line]!;
    const stepTime = this.city.dwellPerPassenger / (st.isInterchange ? 4 : 1);
    if (!t.orphan) {
      for (let k = 0; k < t.riders.length; k++) {
        const r = t.riders[k];
        const d = this.router.decideAlight(t, st, r.dest);
        if (d === 'stay') continue;
        t.riders.splice(k, 1);
        if (d === 'deliver') this.deliver(st, t.color);
        else st.waiting.push(r);
        t.dwell = stepTime;
        return;
      }
      if (t.riders.length < this.trainCapacity(t)) {
        for (let k = 0; k < st.waiting.length; k++) {
          const b = this.router.decideBoard(st, st.waiting[k].dest, t);
          if (!b || b.line !== t.line || b.dir !== t.dir) continue;
          t.riders.push(st.waiting.splice(k, 1)[0]);
          this.events.push({ type: 'board', station: st.id, line: t.color });
          t.dwell = stepTime;
          return;
        }
      }
    }
    t.dockedAt = null;
    if (t.orphan) return this.rejoin(t, line, st, 0);
    this.startSegment(t, line, 0);
  }
}
