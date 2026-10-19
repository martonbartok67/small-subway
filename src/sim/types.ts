import type { Polygon, Vec2 } from './geom';

export type Shape = 'circle' | 'triangle' | 'square' | 'pentagon' | 'star' | 'cross' | 'diamond' | 'gem' | 'egg' | 'wedge';
export type SpawnType = 'circle' | 'triangle' | 'square' | 'SPECIAL';
export const BASIC_SHAPES: readonly Shape[] = ['circle', 'triangle', 'square'];
export const isSpecial = (s: Shape) => !BASIC_SHAPES.includes(s);

export interface Passenger {
  id: number;
  dest: Shape;
  spawnedAt: number;
}

export interface Station {
  id: number;
  pos: Vec2;
  shape: Shape;
  waiting: Passenger[];
  isInterchange: boolean;
  /** 0..1 visible fill; game over at 1 + grace/overcrowdSeconds. */
  overcrowd: number;
  spawnTimer: number;
  bornAt: number;
}

export interface Segment {
  a: number;
  b: number;
  /** Render/travel path from a to b, already offset for shared corridors. */
  path: Vec2[];
  length: number;
  crossing: boolean;
}

export interface Line {
  id: number; // colour slot
  stops: number[];
  loop: boolean;
  segs: Segment[];
}

export type TrainState = 'moving' | 'dwelling';

export interface Train {
  id: number;
  /** Colour slot of the line, or -1 for a train whose line was deleted. */
  line: number;
  color: number;
  fromStation: number;
  toStation: number;
  /** Stop indices and index direction; only valid when !orphan. */
  fromIdx: number;
  toIdx: number;
  dir: 1 | -1;
  /** True when the train's segment no longer exists on its line. */
  orphan: boolean;
  path: Vec2[];
  pathLen: number;
  d: number;
  speed: number;
  state: TrainState;
  dwell: number;
  dockedAt: number | null;
  stopDecided: boolean;
  stopping: boolean;
  cars: number;
  riders: Passenger[];
}

export type UpgradeKind = 'line' | 'carriage' | 'crossings' | 'interchange';

export interface Inventory {
  locomotives: number;
  carriages: number;
  interchanges: number;
  crossingsTotal: number;
  linesUnlocked: number;
}

export interface CityArea {
  poly: Polygon;
  density: number;
  weights: Partial<Record<SpawnType, number>>;
  activeDay: number;
}

export interface Schedule {
  numDays: number;
  randomness: number;
  types: SpawnType[];
}

export interface CityDef {
  name: string;
  water: Polygon[];
  areas: CityArea[];
  schedules: Schedule[];
  cooldownDays: number;
  /** Minimum days between two new stations, so arrivals never come in bursts. */
  minSpawnGapDays: number;
  specials: Shape[];
  /** Half-height of the spawnable view in world units; aspect is fixed so the sim stays renderer-independent. */
  camera: { startHalfH: number; endHalfH: number; delayDays: number; durationDays: number; aspect: number };
  lines: { start: number; max: number };
  start: { locomotives: number; crossings: number };
  train: { speed: number; accel: number; decel: number; capacity: number; maxCars: number };
  stationCapacity: number;
  interchangeCapacity: number;
  passenger: { baseInterval: number; growthPerDay: number; minInterval: number; scale: number };
  dayLength: number;
  overcrowdSeconds: number;
  graceSeconds: number;
  dwellPerPassenger: number;
  /** Destination weights by source kind; 'special' is spread over existing specials. */
  demand: Record<'circle' | 'triangle' | 'square' | 'special', Partial<Record<'circle' | 'triangle' | 'square' | 'special', number>>>;
}

export type SimEvent =
  | { type: 'deliver'; station: number; line: number }
  | { type: 'board'; station: number; line: number }
  | { type: 'stationSpawn'; station: number }
  | { type: 'weekEnd'; week: number }
  | { type: 'gameOver'; station: number };
