import { describe, it, expect } from 'vitest';
import { createUnitCell } from './unit-cell.js';
import { createGrid } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { buildRenderData, computeBeamTransform, getEffectivePosition } from './render-data.js';
import { BEAM_REMOVED } from './pipeline-types.js';

const cubic = createUnitCell('cubic')!;

function makeGraph(nx: number, ny: number, nz: number) {
  const grid = createGrid(nx, ny, nz, [1, 1, 1]);
  const pop = populate(cubic, grid);
  return buildBeamGraph(pop, grid);
}

describe('computeBeamTransform', () => {
  it('beam along Y-axis: rotation is approximately identity', () => {
    const mat = computeBeamTransform([0, 0, 0], [0, 2, 0], 0.5);
    // Translation should be at midpoint (0, 1, 0)
    expect(mat[12]).toBeCloseTo(0);
    expect(mat[13]).toBeCloseTo(1);
    expect(mat[14]).toBeCloseTo(0);
    // Y-column should have length = 2 (beam length)
    const yLen = Math.sqrt(mat[4] ** 2 + mat[5] ** 2 + mat[6] ** 2);
    expect(yLen).toBeCloseTo(2);
    // X-column should have length = 0.5 (radius)
    const xLen = Math.sqrt(mat[0] ** 2 + mat[1] ** 2 + mat[2] ** 2);
    expect(xLen).toBeCloseTo(0.5);
  });

  it('beam along X-axis', () => {
    const mat = computeBeamTransform([0, 0, 0], [3, 0, 0], 0.1);
    // Midpoint at (1.5, 0, 0)
    expect(mat[12]).toBeCloseTo(1.5);
    expect(mat[13]).toBeCloseTo(0);
    expect(mat[14]).toBeCloseTo(0);
    // Y-column length = beam length (3)
    const yLen = Math.sqrt(mat[4] ** 2 + mat[5] ** 2 + mat[6] ** 2);
    expect(yLen).toBeCloseTo(3);
  });

  it('beam along negative Y-axis (anti-parallel)', () => {
    const mat = computeBeamTransform([0, 5, 0], [0, 0, 0], 1.0);
    // Midpoint at (0, 2.5, 0)
    expect(mat[12]).toBeCloseTo(0);
    expect(mat[13]).toBeCloseTo(2.5);
    expect(mat[14]).toBeCloseTo(0);
    // Y-column length = 5
    const yLen = Math.sqrt(mat[4] ** 2 + mat[5] ** 2 + mat[6] ** 2);
    expect(yLen).toBeCloseTo(5);
  });

  it('zero-length beam returns degenerate matrix', () => {
    const mat = computeBeamTransform([1, 2, 3], [1, 2, 3], 0.5);
    // All scale columns should be zero
    expect(mat[0]).toBe(0);
    expect(mat[5]).toBe(0);
    expect(mat[10]).toBe(0);
  });

  it('diagonal beam has correct midpoint and length', () => {
    const mat = computeBeamTransform([0, 0, 0], [1, 1, 1], 0.1);
    expect(mat[12]).toBeCloseTo(0.5);
    expect(mat[13]).toBeCloseTo(0.5);
    expect(mat[14]).toBeCloseTo(0.5);
    const yLen = Math.sqrt(mat[4] ** 2 + mat[5] ** 2 + mat[6] ** 2);
    expect(yLen).toBeCloseTo(Math.sqrt(3));
  });
});

describe('buildRenderData', () => {
  it('visible count matches beam count when none removed', () => {
    const graph = makeGraph(2, 2, 2);
    const data = buildRenderData(graph);
    expect(data.count).toBe(graph.beamCount);
  });

  it('excludes removed beams', () => {
    const graph = makeGraph(2, 2, 2);
    graph.beamFlags[0] |= BEAM_REMOVED;
    graph.beamFlags[1] |= BEAM_REMOVED;
    const data = buildRenderData(graph);
    expect(data.count).toBe(graph.beamCount - 2);
  });

  it('renderToBeam maps back to valid non-removed beams', () => {
    const graph = makeGraph(2, 2, 2);
    graph.beamFlags[5] |= BEAM_REMOVED;
    const data = buildRenderData(graph);
    for (let i = 0; i < data.count; i++) {
      const b = data.renderToBeam[i];
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(graph.beamCount);
      expect(graph.beamFlags[b] & BEAM_REMOVED).toBe(0);
    }
  });

  it('matrices have correct length', () => {
    const graph = makeGraph(2, 2, 2);
    const data = buildRenderData(graph);
    expect(data.matrices.length).toBe(data.count * 16);
  });
});

describe('getEffectivePosition', () => {
  it('returns graph position when no trim', () => {
    const graph = makeGraph(1, 1, 1);
    const pos = getEffectivePosition(graph, null, 0);
    expect(pos[0]).toBe(graph.positions[0]);
    expect(pos[1]).toBe(graph.positions[1]);
    expect(pos[2]).toBe(graph.positions[2]);
  });

  it('returns override when trim has entry', () => {
    const graph = makeGraph(1, 1, 1);
    const trim = {
      trimmedPositions: new Map([[0, [99, 88, 77] as [number, number, number]]]),
      removedBeams: new Set<number>(),
    };
    const pos = getEffectivePosition(graph, trim, 0);
    expect(pos).toEqual([99, 88, 77]);
  });

  it('returns graph position when trim has no entry for node', () => {
    const graph = makeGraph(1, 1, 1);
    const trim = {
      trimmedPositions: new Map<number, [number, number, number]>(),
      removedBeams: new Set<number>(),
    };
    const pos = getEffectivePosition(graph, trim, 0);
    expect(pos[0]).toBe(graph.positions[0]);
  });
});
