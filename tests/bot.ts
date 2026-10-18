import type { UpgradeKind } from '../src/sim/types';
import type { World } from '../src/sim/world';

const PREF: UpgradeKind[] = ['carriage', 'line', 'interchange', 'crossings'];
export const pickUpgrade = (opts: UpgradeKind[]) => PREF.find((k) => opts.includes(k))!;

/** Greedy bot: attach every unconnected station to the nearest line end. */
export function greedy(w: World) {
  const connected = new Set(w.lines.flatMap((l) => l?.stops ?? []));
  for (const s of w.stations) {
    if (connected.has(s.id)) continue;
    const slot = w.freeSlot();
    if (slot >= 0) {
      const other = w.stations.filter((o) => o.id !== s.id).sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (other && w.commitLine(slot, [s.id, other.id], false)) {
        connected.add(s.id).add(other.id);
        continue;
      }
    }
    let best: { slot: number; stops: number[]; d: number } | null = null;
    for (const l of w.lines) {
      if (!l || l.loop) continue;
      const head = w.stationById(l.stops[0])!;
      const tail = w.stationById(l.stops[l.stops.length - 1])!;
      for (const [end, stops] of [
        [head, [s.id, ...l.stops]],
        [tail, [...l.stops, s.id]],
      ] as [typeof head, number[]][]) {
        const d = dist(end, s);
        if ((!best || d < best.d) && w.previewLine(l.id, stops, false).ok) best = { slot: l.id, stops, d };
      }
    }
    if (best && w.commitLine(best.slot, best.stops, false)) connected.add(s.id);
  }
  const byNeed = w.lines.filter((l) => !!l).sort((a, b) => w.trainsOn(a!.id).length - w.trainsOn(b!.id).length);
  for (const l of byNeed) if (w.canAddTrain(l!.id)) w.addTrain(l!.id);
  // Warp a spare train onto any line that has none.
  const empty = byNeed.find((l) => w.trainsOn(l!.id).length === 0);
  const rich = byNeed[byNeed.length - 1];
  if (empty && rich && w.trainsOn(rich.id).length >= 2) {
    w.moveTrain(w.trainsOn(rich.id)[0].id, empty.id, w.stationById(empty.stops[0])!.pos);
  }
  for (const t of w.trains) if (w.inv.carriages > 0) w.addCarriage(t.id);
}
const dist = (a: { pos: { x: number; y: number } }, b: { pos: { x: number; y: number } }) =>
  Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);

