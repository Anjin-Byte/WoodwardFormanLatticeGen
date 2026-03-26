import { describe, it, expect } from 'vitest';
import {
  createGrid, totalCells, cellIndex, cellCoords,
  localToWorld, cellOrigin, cellCenter, gridMin, gridMax,
} from './grid.js';

describe('createGrid', () => {
  it('creates a grid with valid params', () => {
    const g = createGrid(2, 3, 4, [1, 1, 1]);
    expect(g.nx).toBe(2);
    expect(g.ny).toBe(3);
    expect(g.nz).toBe(4);
    expect(totalCells(g)).toBe(24);
  });

  it('throws for zero dimensions', () => {
    expect(() => createGrid(0, 1, 1, [1, 1, 1])).toThrow();
  });

  it('throws for negative cell size', () => {
    expect(() => createGrid(1, 1, 1, [-1, 1, 1])).toThrow();
  });

  it('defaults origin to [0,0,0]', () => {
    const g = createGrid(1, 1, 1, [1, 1, 1]);
    expect(g.origin).toEqual([0, 0, 0]);
  });
});

describe('cellIndex / cellCoords roundtrip', () => {
  const g = createGrid(5, 7, 3, [1, 1, 1]);

  it('roundtrips for (0,0,0)', () => {
    expect(cellCoords(g, cellIndex(g, 0, 0, 0))).toEqual([0, 0, 0]);
  });

  it('roundtrips for (4,6,2)', () => {
    expect(cellCoords(g, cellIndex(g, 4, 6, 2))).toEqual([4, 6, 2]);
  });

  it('roundtrips for all cells', () => {
    for (let i = 0; i < g.nx; i++) {
      for (let j = 0; j < g.ny; j++) {
        for (let k = 0; k < g.nz; k++) {
          const idx = cellIndex(g, i, j, k);
          expect(cellCoords(g, idx)).toEqual([i, j, k]);
        }
      }
    }
  });
});

describe('localToWorld', () => {
  const g = createGrid(4, 4, 4, [2, 3, 4], [10, 20, 30]);

  it('origin corner maps to grid origin', () => {
    expect(localToWorld(g, 0, 0, 0, 0, 0, 0)).toEqual([10, 20, 30]);
  });

  it('max corner maps correctly', () => {
    const [x, y, z] = localToWorld(g, 3, 3, 3, 1, 1, 1);
    expect(x).toBeCloseTo(10 + 4 * 2);
    expect(y).toBeCloseTo(20 + 4 * 3);
    expect(z).toBeCloseTo(30 + 4 * 4);
  });

  it('cell center at (0,0,0) is half cell size from origin', () => {
    const [x, y, z] = localToWorld(g, 0, 0, 0, 0.5, 0.5, 0.5);
    expect(x).toBeCloseTo(11);
    expect(y).toBeCloseTo(21.5);
    expect(z).toBeCloseTo(32);
  });
});

describe('cellOrigin', () => {
  const g = createGrid(2, 2, 2, [1, 1, 1], [5, 5, 5]);

  it('cell (0,0,0) origin is grid origin', () => {
    expect(cellOrigin(g, 0, 0, 0)).toEqual([5, 5, 5]);
  });

  it('cell (1,1,1) origin is offset by cellSize', () => {
    expect(cellOrigin(g, 1, 1, 1)).toEqual([6, 6, 6]);
  });
});

describe('cellCenter', () => {
  const g = createGrid(2, 2, 2, [2, 2, 2], [0, 0, 0]);

  it('cell 0 center is at (1, 1, 1)', () => {
    const c = cellCenter(g, 0);
    expect(c[0]).toBeCloseTo(1);
    expect(c[1]).toBeCloseTo(1);
    expect(c[2]).toBeCloseTo(1);
  });
});

describe('gridMin / gridMax', () => {
  const g = createGrid(3, 4, 5, [2, 3, 4], [1, 2, 3]);

  it('gridMin equals origin', () => {
    expect(gridMin(g)).toEqual([1, 2, 3]);
  });

  it('gridMax equals origin + n*cellSize', () => {
    expect(gridMax(g)).toEqual([7, 14, 23]);
  });
});

describe('neighbor face alignment', () => {
  const g = createGrid(2, 1, 1, [1, 1, 1]);

  it('cell 0 +x face equals cell 1 -x face', () => {
    // Cell 0's max-x corner = cell 1's min-x corner
    const c0Max = localToWorld(g, 0, 0, 0, 1, 0, 0);
    const c1Min = localToWorld(g, 1, 0, 0, 0, 0, 0);
    expect(c0Max[0]).toBeCloseTo(c1Min[0]);
    expect(c0Max[1]).toBeCloseTo(c1Min[1]);
    expect(c0Max[2]).toBeCloseTo(c1Min[2]);
  });
});
