export interface Vec2 {
  x: number;
  y: number;
}
export type Polygon = Vec2[];

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => v(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => v(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, s: number): Vec2 => v(a.x * s, a.y * s);
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return v(a.x / l, a.y / l);
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross3(p3, p4, p1);
  const d2 = cross3(p3, p4, p2);
  const d3 = cross3(p1, p2, p3);
  const d4 = cross3(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
const cross3 = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function segmentHitsPolygon(a: Vec2, b: Vec2, poly: Polygon): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, poly[j], poly[i])) return true;
  }
  return false;
}

export function polylineHitsPolygon(path: Vec2[], poly: Polygon): boolean {
  for (let i = 1; i < path.length; i++) if (segmentHitsPolygon(path[i - 1], path[i], poly)) return true;
  return false;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return dist(p, v(a.x + ab.x * t, a.y + ab.y * t));
}

export function distToPolygonEdge(p: Vec2, poly: Polygon): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, distToSegment(p, poly[j], poly[i]));
  return best;
}

export function polylineLength(path: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += dist(path[i - 1], path[i]);
  return l;
}

/** Point and unit tangent at distance d along a polyline. */
export function pointAt(path: Vec2[], d: number): { p: Vec2; t: Vec2 } {
  let rem = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const l = dist(path[i - 1], path[i]);
    if (rem <= l || i === path.length - 1) {
      const t = l === 0 ? 0 : Math.min(1, rem / l);
      return { p: lerp(path[i - 1], path[i], t), t: norm(sub(path[i], path[i - 1])) };
    }
    rem -= l;
  }
  return { p: path[0], t: v(1, 0) };
}

/**
 * The two octilinear routes from a to b: one 45° leg plus one axis-aligned leg,
 * diagonal first or straight first.
 */
export function octilinearOptions(a: Vec2, b: Vec2): [Vec2[], Vec2[]] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const d = Math.min(adx, ady);
  const diag = v(Math.sign(dx) * d, Math.sign(dy) * d);
  if (Math.abs(adx - ady) < 1 || d < 1) return [[a, b], [a, b]];
  const diagFirst = [a, add(a, diag), b];
  const straightFirst = [a, sub(b, diag), b];
  return [diagFirst, straightFirst];
}

/** Offset an open polyline sideways by `off` (positive = left of travel). */
export function offsetPolyline(path: Vec2[], off: number): Vec2[] {
  if (off === 0 || path.length < 2) return path.slice();
  const normals: Vec2[] = [];
  for (let i = 1; i < path.length; i++) {
    const t = norm(sub(path[i], path[i - 1]));
    normals.push(v(-t.y, t.x));
  }
  const out: Vec2[] = [add(path[0], scale(normals[0], off))];
  for (let i = 1; i < path.length - 1; i++) {
    const n = norm(add(normals[i - 1], normals[i]));
    const cos = n.x * normals[i].x + n.y * normals[i].y;
    out.push(add(path[i], scale(n, off / Math.max(0.3, cos))));
  }
  out.push(add(path[path.length - 1], scale(normals[normals.length - 1], off)));
  return out;
}
