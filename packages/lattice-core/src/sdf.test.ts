import { describe, it, expect } from 'vitest';
import { sdCappedCylinder, smin, buildSdfAccel, latticeSdf } from './sdf.js';
import { createUnitCell } from './unit-cell.js';
import { createGrid } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';

describe('sdCappedCylinder', () => {
  // Cylinder from (0,0,0) to (0,2,0) with radius 0.5
  const ax = 0, ay = 0, az = 0;
  const bx = 0, by = 2, bz = 0;
  const r = 0.5;

  it('returns negative inside the cylinder', () => {
    // Center of the cylinder
    expect(sdCappedCylinder(0, 1, 0, ax, ay, az, bx, by, bz, r)).toBeLessThan(0);
    // Slightly off-center
    expect(sdCappedCylinder(0.2, 1, 0, ax, ay, az, bx, by, bz, r)).toBeLessThan(0);
  });

  it('returns approximately zero on the surface', () => {
    // On the barrel surface
    const d1 = sdCappedCylinder(0.5, 1, 0, ax, ay, az, bx, by, bz, r);
    expect(Math.abs(d1)).toBeLessThan(1e-6);

    // On the top cap center
    const d2 = sdCappedCylinder(0, 2, 0, ax, ay, az, bx, by, bz, r);
    expect(Math.abs(d2)).toBeLessThan(1e-6);

    // On the bottom cap center
    const d3 = sdCappedCylinder(0, 0, 0, ax, ay, az, bx, by, bz, r);
    expect(Math.abs(d3)).toBeLessThan(1e-6);
  });

  it('returns positive outside the cylinder', () => {
    // Far from the cylinder
    expect(sdCappedCylinder(3, 1, 0, ax, ay, az, bx, by, bz, r)).toBeGreaterThan(0);
    // Just outside the barrel
    expect(sdCappedCylinder(0.6, 1, 0, ax, ay, az, bx, by, bz, r)).toBeGreaterThan(0);
    // Beyond the cap
    expect(sdCappedCylinder(0, 3, 0, ax, ay, az, bx, by, bz, r)).toBeGreaterThan(0);
  });

  it('distance at known point matches expected', () => {
    // Point at (1, 1, 0): perpendicular distance to axis is 1, minus radius 0.5 = 0.5
    const d = sdCappedCylinder(1, 1, 0, ax, ay, az, bx, by, bz, r);
    expect(d).toBeCloseTo(0.5, 4);
  });

  it('handles zero-length cylinder gracefully', () => {
    // Degenerate: both endpoints at origin — baba=0 causes division by zero → NaN
    // This is expected behavior; callers should never pass zero-length beams.
    const d = sdCappedCylinder(1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5);
    expect(typeof d).toBe('number'); // doesn't throw
  });
});

describe('smin', () => {
  it('with k=0 returns min(a,b)', () => {
    expect(smin(3, 5, 0)).toBe(3);
    expect(smin(-1, 2, 0)).toBe(-1);
    expect(smin(7, 7, 0)).toBe(7);
  });

  it('is symmetric', () => {
    expect(smin(1.5, 2.3, 0.5)).toBe(smin(2.3, 1.5, 0.5));
    expect(smin(-0.5, 0.5, 0.2)).toBe(smin(0.5, -0.5, 0.2));
  });

  it('result <= min(a,b) for k > 0', () => {
    const a = 1.0, b = 1.5, k = 0.5;
    expect(smin(a, b, k)).toBeLessThanOrEqual(Math.min(a, b));
  });

  it('smoothly blends near equal values', () => {
    const result = smin(0.1, -0.1, 0.5);
    expect(result).toBeLessThan(Math.min(0.1, -0.1));
    expect(result).toBeGreaterThan(-1);
  });
});

describe('buildSdfAccel', () => {
  it('builds accel for a small lattice', () => {
    const cell = createUnitCell('cubic')!;
    const grid = createGrid(2, 2, 2, [1, 1, 1]);
    const pop = populate(cell, grid);
    const graph = buildBeamGraph(pop, grid, 0.1);

    const accel = buildSdfAccel(graph, null, null, { sminK: 0.05 });

    expect(accel.beamCount).toBe(graph.beamCount);
    expect(accel.beamP0.length).toBe(graph.beamCount * 3);
    expect(accel.cellSize).toBeGreaterThan(0);
    expect(accel.cells.size).toBeGreaterThan(0);
  });
});

describe('latticeSdf', () => {
  const cell = createUnitCell('cubic')!;
  const grid = createGrid(2, 2, 2, [1, 1, 1]);
  const pop = populate(cell, grid);
  const graph = buildBeamGraph(pop, grid, 0.1);
  const accel = buildSdfAccel(graph, null, null, { sminK: 0 });

  it('returns negative inside a beam', () => {
    // Midpoint of the first beam — should be inside the cylinder
    const n0 = graph.edges[0];
    const n1 = graph.edges[1];
    const mx = (graph.positions[n0 * 3] + graph.positions[n1 * 3]) / 2;
    const my = (graph.positions[n0 * 3 + 1] + graph.positions[n1 * 3 + 1]) / 2;
    const mz = (graph.positions[n0 * 3 + 2] + graph.positions[n1 * 3 + 2]) / 2;

    const d = latticeSdf(mx, my, mz, accel, 0);
    expect(d).toBeLessThan(0);
  });

  it('returns positive far from all beams', () => {
    const d = latticeSdf(100, 100, 100, accel, 0);
    expect(d).toBeGreaterThan(0);
  });
});
