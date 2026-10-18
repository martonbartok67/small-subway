import { describe, expect, it } from 'vitest';
import { RIVERTON } from '../src/sim/city';
import { octilinearOptions, offsetPolyline, v } from '../src/sim/geom';
import { Rng } from '../src/sim/rng';
import { World } from '../src/sim/world';
import { greedy, pickUpgrade } from './bot';

const DT = 1 / 60;

function run(w: World, seconds: number, each?: (w: World) => void) {
  for (let i = 0; i < seconds / DT && !w.over; i++) {
    w.step(DT);
    if (w.pendingUpgrade) w.chooseUpgrade(pickUpgrade(w.pendingUpgrade));
    if (i % 60 === 0) each?.(w);
  }
}

describe('rng', () => {
  it('is deterministic', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('geometry', () => {
  it('builds octilinear routes with one 45° leg', () => {
    const [diag, straight] = octilinearOptions(v(0, 0), v(100, 40));
    expect(diag[1]).toEqual(v(40, 40));
    expect(straight[1]).toEqual(v(60, 0));
  });
  it('offsets a polyline sideways', () => {
    const p = offsetPolyline([v(0, 0), v(10, 0)], 5);
    expect(p[0].y).toBeCloseTo(5);
  });
});

describe('world', () => {
  it('starts with circle, triangle and square', () => {
    const w = new World(RIVERTON, 1);
    expect(w.stations.map((s) => s.shape).sort()).toEqual(['circle', 'square', 'triangle']);
  });

  it('delivers passengers on a simple line', () => {
    const w = new World(RIVERTON, 7);
    const ids = w.stations.map((s) => s.id);
    expect(w.commitLine(0, ids, false)).toBe(true);
    expect(w.trains.length).toBe(1);
    run(w, RIVERTON.dayLength * 3);
    expect(w.score).toBeGreaterThan(0);
  });

  it('rejects lines that need more crossings than available', () => {
    const w = new World(RIVERTON, 3);
    w.inv.crossingsTotal = 0;
    const ids = w.stations.map((s) => s.id);
    const pv = w.previewLine(0, ids, false);
    expect(pv.ok).toBe(pv.crossingsNeeded === 0);
  });

  it('replays identically from the same seed', () => {
    const play = () => {
      const w = new World(RIVERTON, 99);
      run(w, RIVERTON.dayLength * 20, greedy);
      return [w.score, w.stations.length, w.rng.state, w.over?.day];
    };
    expect(play()).toEqual(play());
  });

  it('survives a long greedy game without errors', () => {
    const results: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new World(RIVERTON, seed);
      run(w, RIVERTON.dayLength * 7 * 14, greedy);
      results.push(`seed ${seed}: score ${w.score}, stations ${w.stations.length}, ${w.over ? `lost day ${w.over.day.toFixed(1)}` : 'alive'}`);
      expect(w.score).toBeGreaterThan(20);
    }
    console.log(results.join('\n'));
  });

  it('keeps trains consistent through line edits', () => {
    const w = new World(RIVERTON, 11);
    run(w, RIVERTON.dayLength * 6, greedy);
    const line = w.lines.find((l) => l && l.stops.length >= 3)!;
    expect(line).toBeTruthy();
    // Remove a middle stop, then delete the line entirely, while trains run.
    w.commitLine(line.id, [line.stops[0], ...line.stops.slice(2)], false);
    run(w, 5);
    w.deleteLine(line.id);
    run(w, 30);
    expect(w.trains.every((t) => t.line !== line.id)).toBe(true);
    const locos = w.inv.locomotives + w.trains.length;
    expect(locos).toBe(RIVERTON.start.locomotives + w.week);
  });
});
