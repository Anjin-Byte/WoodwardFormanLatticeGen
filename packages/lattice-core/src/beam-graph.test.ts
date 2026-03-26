import { describe, it, expect } from 'vitest';
import { createUnitCell } from './unit-cell.js';
import { createGrid, totalCells } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph, beamsInCell, cellOfBeam, getPosition } from './beam-graph.js';
import { NODE_INTERIOR, BEAM_INTERIOR } from './pipeline-types.js';

const cubic = createUnitCell('cubic')!;

function makeGraph(nx: number, ny: number, nz: number) {
  const grid = createGrid(nx, ny, nz, [1, 1, 1]);
  const pop = populate(cubic, grid);
  return buildBeamGraph(pop, grid);
}

describe('buildBeamGraph', () => {
  const graph = makeGraph(3, 3, 3);

  it('array length contracts', () => {
    expect(graph.positions.length).toBe(graph.nodeCount * 3);
    expect(graph.edges.length).toBe(graph.beamCount * 2);
    expect(graph.nodeFlags.length).toBe(graph.nodeCount);
    expect(graph.beamFlags.length).toBe(graph.beamCount);
    expect(graph.beamRadii.length).toBe(graph.beamCount);
    expect(graph.nodeBeamPtr.length).toBe(graph.nodeCount + 1);
    expect(graph.nodeBeams.length).toBe(graph.beamCount * 2);
  });

  it('beamCount = totalCells × edgesPerCell', () => {
    expect(graph.beamCount).toBe(totalCells(graph.grid) * graph.edgesPerCell);
  });

  it('all flags initialized to INTERIOR', () => {
    for (let i = 0; i < graph.nodeCount; i++) {
      expect(graph.nodeFlags[i]).toBe(NODE_INTERIOR);
    }
    for (let i = 0; i < graph.beamCount; i++) {
      expect(graph.beamFlags[i]).toBe(BEAM_INTERIOR);
    }
  });

  it('all radii initialized to default', () => {
    for (let i = 0; i < graph.beamCount; i++) {
      expect(graph.beamRadii[i]).toBeCloseTo(0.05);
    }
  });
});

describe('cell↔beam arithmetic', () => {
  const graph = makeGraph(3, 3, 3);
  const tc = totalCells(graph.grid); // 27

  it('cellOfBeam is in [0, totalCells)', () => {
    for (let b = 0; b < graph.beamCount; b++) {
      const c = cellOfBeam(graph, b);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(tc);
    }
  });

  it('beamsInCell contains the beam', () => {
    for (let b = 0; b < Math.min(graph.beamCount, 500); b++) {
      const c = cellOfBeam(graph, b);
      const [start, end] = beamsInCell(graph, c);
      expect(b).toBeGreaterThanOrEqual(start);
      expect(b).toBeLessThan(end);
    }
  });

  it('each cell owns exactly edgesPerCell beams', () => {
    for (let c = 0; c < tc; c++) {
      const [start, end] = beamsInCell(graph, c);
      expect(end - start).toBe(graph.edgesPerCell);
    }
  });
});

describe('node adjacency CSR', () => {
  const graph = makeGraph(2, 2, 2);

  it('nodeBeamPtr is monotonically non-decreasing', () => {
    for (let n = 1; n <= graph.nodeCount; n++) {
      expect(graph.nodeBeamPtr[n]).toBeGreaterThanOrEqual(graph.nodeBeamPtr[n - 1]);
    }
  });

  it('nodeBeamPtr[0] === 0', () => {
    expect(graph.nodeBeamPtr[0]).toBe(0);
  });

  it('nodeBeamPtr[last] === beamCount * 2', () => {
    expect(graph.nodeBeamPtr[graph.nodeCount]).toBe(graph.beamCount * 2);
  });

  it('every node-beam reference is correct', () => {
    for (let n = 0; n < graph.nodeCount; n++) {
      const start = graph.nodeBeamPtr[n];
      const end = graph.nodeBeamPtr[n + 1];
      for (let j = start; j < end; j++) {
        const b = graph.nodeBeams[j];
        const n0 = graph.edges[b * 2];
        const n1 = graph.edges[b * 2 + 1];
        expect(n === n0 || n === n1).toBe(true);
      }
    }
  });

  it('no orphan nodes', () => {
    for (let n = 0; n < graph.nodeCount; n++) {
      const degree = graph.nodeBeamPtr[n + 1] - graph.nodeBeamPtr[n];
      expect(degree).toBeGreaterThan(0);
    }
  });
});

describe('getPosition', () => {
  const graph = makeGraph(1, 1, 1);

  it('returns valid coordinates', () => {
    const [x, y, z] = getPosition(graph, 0);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(Number.isFinite(z)).toBe(true);
  });
});
