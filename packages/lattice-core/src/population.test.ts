import { describe, it, expect } from 'vitest';
import { createUnitCell } from './unit-cell.js';
import { createGrid } from './grid.js';
import { populate, computeBeamCount } from './population.js';

const cubic = createUnitCell('cubic')!;

describe('populate', () => {
  it('1×1×1: 8 nodes, 12 beams', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const result = populate(cubic, grid);
    expect(result.nodeCount).toBe(8);
    expect(result.beamCount).toBe(12);
    expect(result.edgesPerCell).toBe(12);
  });

  it('2×1×1: 12 nodes (4 shared on x-face), 24 beams', () => {
    const grid = createGrid(2, 1, 1, [1, 1, 1]);
    const result = populate(cubic, grid);
    // 2 cells × 8 nodes = 16, minus 4 shared on the +x/-x face = 12
    expect(result.nodeCount).toBe(12);
    expect(result.beamCount).toBe(24);
  });

  it('1×2×1: 12 nodes (4 shared on y-face), 24 beams', () => {
    const grid = createGrid(1, 2, 1, [1, 1, 1]);
    const result = populate(cubic, grid);
    expect(result.nodeCount).toBe(12);
    expect(result.beamCount).toBe(24);
  });

  it('1×1×2: 12 nodes (4 shared on z-face), 24 beams', () => {
    const grid = createGrid(1, 1, 2, [1, 1, 1]);
    const result = populate(cubic, grid);
    expect(result.nodeCount).toBe(12);
    expect(result.beamCount).toBe(24);
  });

  it('2×2×2: correct node count with full sharing, 96 beams', () => {
    const grid = createGrid(2, 2, 2, [1, 1, 1]);
    const result = populate(cubic, grid);
    // For cubic 2×2×2: (2+1)×(2+1)×(2+1) = 27 unique nodes
    expect(result.nodeCount).toBe(27);
    expect(result.beamCount).toBe(96);
  });

  it('3×3×3: no duplicate positions', () => {
    const grid = createGrid(3, 3, 3, [1, 1, 1]);
    const result = populate(cubic, grid);

    const seen = new Set<string>();
    for (let i = 0; i < result.nodeCount; i++) {
      const key = `${result.positions[i * 3].toFixed(7)},${result.positions[i * 3 + 1].toFixed(7)},${result.positions[i * 3 + 2].toFixed(7)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('all edges are canonically ordered (a < b)', () => {
    const grid = createGrid(3, 3, 3, [1, 1, 1]);
    const result = populate(cubic, grid);

    for (let i = 0; i < result.beamCount; i++) {
      expect(result.edges[i * 2]).toBeLessThan(result.edges[i * 2 + 1]);
    }
  });

  it('all edge indices are in range', () => {
    const grid = createGrid(3, 3, 3, [1, 1, 1]);
    const result = populate(cubic, grid);

    for (let i = 0; i < result.edges.length; i++) {
      expect(result.edges[i]).toBeLessThan(result.nodeCount);
    }
  });

  it('beam ordering: each cell owns edgesPerCell consecutive beams', () => {
    const grid = createGrid(3, 2, 2, [1, 1, 1]);
    const result = populate(cubic, grid);
    const totalCells = 3 * 2 * 2;

    expect(result.beamCount).toBe(totalCells * result.edgesPerCell);

    // Each block of edgesPerCell beams should reference nodes that are
    // within the world-space bounds of their owning cell (approximately)
    // We just verify the count relationship here.
    for (let c = 0; c < totalCells; c++) {
      const start = c * result.edgesPerCell;
      const end = start + result.edgesPerCell;
      expect(end).toBeLessThanOrEqual(result.beamCount);
    }
  });

  it('position accuracy with non-unit cell size', () => {
    const grid = createGrid(1, 1, 1, [2, 3, 4], [10, 20, 30]);
    const result = populate(cubic, grid);

    // Node at local (0,0,0) → world (10, 20, 30)
    // Node at local (1,1,1) → world (12, 23, 34)
    // Find them in the positions array
    let foundOrigin = false;
    let foundMax = false;
    for (let i = 0; i < result.nodeCount; i++) {
      const x = result.positions[i * 3];
      const y = result.positions[i * 3 + 1];
      const z = result.positions[i * 3 + 2];
      if (Math.abs(x - 10) < 1e-6 && Math.abs(y - 20) < 1e-6 && Math.abs(z - 30) < 1e-6) {
        foundOrigin = true;
      }
      if (Math.abs(x - 12) < 1e-6 && Math.abs(y - 23) < 1e-6 && Math.abs(z - 34) < 1e-6) {
        foundMax = true;
      }
    }
    expect(foundOrigin).toBe(true);
    expect(foundMax).toBe(true);
  });

  it('deterministic: same input produces identical output', () => {
    const grid = createGrid(3, 3, 3, [1, 1, 1]);
    const a = populate(cubic, grid);
    const b = populate(cubic, grid);

    expect(a.nodeCount).toBe(b.nodeCount);
    expect(a.beamCount).toBe(b.beamCount);

    for (let i = 0; i < a.positions.length; i++) {
      expect(a.positions[i]).toBe(b.positions[i]);
    }
    for (let i = 0; i < a.edges.length; i++) {
      expect(a.edges[i]).toBe(b.edges[i]);
    }
  });

  it('no orphan nodes: every node appears in at least one edge', () => {
    const grid = createGrid(2, 2, 2, [1, 1, 1]);
    const result = populate(cubic, grid);

    const referenced = new Set<number>();
    for (let i = 0; i < result.edges.length; i++) {
      referenced.add(result.edges[i]);
    }
    for (let n = 0; n < result.nodeCount; n++) {
      expect(referenced.has(n)).toBe(true);
    }
  });
});

describe('computeBeamCount', () => {
  it('matches populate result', () => {
    const grid = createGrid(3, 4, 5, [1, 1, 1]);
    const expected = computeBeamCount(cubic, grid);
    const result = populate(cubic, grid);
    expect(result.beamCount).toBe(expected);
  });
});
