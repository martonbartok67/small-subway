import { offsetPolyline, v, type Polygon, type Vec2 } from './geom';
import type { CityDef } from './types';

/** A water band built from a centreline, so rivers are easy to author. */
function river(center: Vec2[], width: number): Polygon {
  const left = offsetPolyline(center, -width / 2);
  const right = offsetPolyline(center, width / 2).reverse();
  return [...left, ...right];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];

/** Original map: one winding river and a bay. World units, y down, centred on (0,0). */
export const RIVERTON: CityDef = {
  name: 'Riverton',
  water: [
    river(
      [v(-2000, -60), v(-1300, 40), v(-700, -20), v(-250, 120), v(200, 70), v(650, 200), v(1100, 120), v(1600, 260), v(2100, 220)],
      70,
    ),
    [v(900, -1100), v(1150, -820), v(1450, -760), v(1750, -880), v(2100, -820), v(2100, -1100)],
  ],
  areas: [
    { poly: rect(-420, -380, 420, 380), density: 1.2, weights: { circle: 4, triangle: 2, square: 1, SPECIAL: 1.2 }, activeDay: 0 },
    { poly: rect(-1150, -950, 1150, -380), density: 0.95, weights: { circle: 4, triangle: 2, square: 1, SPECIAL: 1 }, activeDay: 0 },
    { poly: rect(-1150, 380, 1150, 950), density: 0.95, weights: { circle: 4, triangle: 2, square: 1, SPECIAL: 1 }, activeDay: 0 },
    { poly: rect(-1150, -380, -420, 380), density: 1.05, weights: { circle: 3, triangle: 2, square: 1, SPECIAL: 1 }, activeDay: 0 },
    { poly: rect(420, -380, 1150, 380), density: 1.05, weights: { circle: 3, triangle: 2, square: 1, SPECIAL: 1 }, activeDay: 0 },
    { poly: rect(-1900, -1050, -1150, 1050), density: 0.8, weights: { circle: 4, triangle: 2, square: 0.6, SPECIAL: 0.5 }, activeDay: 8 },
    { poly: rect(1150, -1050, 1900, 1050), density: 0.8, weights: { circle: 4, triangle: 2, square: 0.6, SPECIAL: 0.5 }, activeDay: 8 },
  ],
  schedules: [
    { numDays: 6, randomness: 0.35, types: ['circle', 'triangle', 'circle', 'square'] },
    { numDays: 8, randomness: 0.2, types: ['circle', 'circle', 'triangle', 'SPECIAL', 'circle', 'triangle'] },
    { numDays: 10, randomness: 0.5, types: ['circle', 'triangle', 'circle', 'square', 'circle', 'triangle', 'SPECIAL', 'circle'] },
    { numDays: 5, randomness: 0.0, types: ['circle', 'triangle', 'circle', 'circle'] },
  ],
  cooldownDays: 1,
  specials: ['pentagon', 'star', 'cross', 'diamond', 'gem', 'wedge', 'egg'],
  camera: { startHalfH: 360, endHalfH: 1000, delayDays: 1, durationDays: 55, aspect: 1.7 },
  lines: { start: 3, max: 7 },
  start: { locomotives: 3, crossings: 3 },
  train: { speed: 105, accel: 70, decel: 140, capacity: 6, maxCars: 4 },
  stationCapacity: 6,
  interchangeCapacity: 18,
  passenger: { baseInterval: 14, growthPerDay: 0.1, minInterval: 3.6, scale: 1 },
  dayLength: 19.2,
  overcrowdSeconds: 45,
  graceSeconds: 2,
  dwellPerPassenger: 0.3,
  demand: {
    circle: { triangle: 0.55, square: 0.3, special: 0.15 },
    triangle: { circle: 0.75, special: 0.25 },
    square: { circle: 0.5, triangle: 0.35, special: 0.15 },
    special: { circle: 0.5, triangle: 0.3, square: 0.2 },
  },
};

/** The same city turned 90° for portrait screens, so the long axis stays on screen. */
export function portrait(city: CityDef): CityDef {
  const r = (p: Vec2) => v(-p.y, p.x);
  const c = city.camera;
  return {
    ...city,
    water: city.water.map((poly) => poly.map(r)),
    areas: city.areas.map((a) => ({ ...a, poly: a.poly.map(r) })),
    camera: { ...c, startHalfH: c.startHalfH * c.aspect, endHalfH: c.endHalfH * c.aspect, aspect: 1 / c.aspect },
  };
}
