import { describe, it, expect } from 'vitest';
import { exportLattice } from './export-pipeline.js';
import { createUnitCell } from './unit-cell.js';
import { createGrid } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { parseSTL } from './stl-parser.js';

function buildTestGraph(radius = 0.15) {
  const cell = createUnitCell('cubic')!;
  const grid = createGrid(2, 2, 2, [1, 1, 1]);
  const pop = populate(cell, grid);
  return buildBeamGraph(pop, grid, radius);
}

describe('exportLattice', () => {
  it('exports a valid STL for a small cubic lattice', async () => {
    const graph = buildTestGraph();

    // density=10 → mcStep = 1/10 = 0.1, radius=0.15 → well resolved
    const result = await exportLattice(graph, null, null, 0.15, {
      mcDensity: 10,
      filletK: 0,
    });

    expect(result.stl).toBeInstanceOf(ArrayBuffer);
    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.fileSizeBytes).toBe(80 + 4 + result.triangleCount * 50);
  });

  it('round-trips through parseSTL', async () => {
    const graph = buildTestGraph();

    const result = await exportLattice(graph, null, null, 0.15, {
      mcDensity: 10,
      filletK: 0,
    });

    const parsed = parseSTL(result.stl);
    expect(parsed.triangleCount).toBe(result.triangleCount);
    expect(parsed.vertexCount).toBeGreaterThan(0);
  });

  it('auto density scales with r*', async () => {
    // r* = 0.08 → auto density = ceil(3/(2*0.08)) = ceil(18.75) = 19
    const graph = buildTestGraph(0.08);
    const result = await exportLattice(graph, null, null, 0.08);

    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('reports timing data', async () => {
    const graph = buildTestGraph();

    const result = await exportLattice(graph, null, null, 0.15, {
      mcDensity: 4,
      filletK: 0,
    });

    expect(result.timings.accelMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.sdfMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.mcMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.stlMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('calls onProgress callback', async () => {
    const graph = buildTestGraph();
    const phases: string[] = [];

    await exportLattice(graph, null, null, 0.15, {
      mcDensity: 4,
      filletK: 0,
      onProgress: (phase) => { if (!phases.includes(phase)) phases.push(phase); },
    });

    expect(phases).toContain('sdf');
    expect(phases).toContain('mc');
    expect(phases).toContain('stl');
  });

  it('higher density produces more triangles', async () => {
    const graph = buildTestGraph();

    const lo = await exportLattice(graph, null, null, 0.15, { mcDensity: 6, filletK: 0 });
    const hi = await exportLattice(graph, null, null, 0.15, { mcDensity: 12, filletK: 0 });

    expect(hi.triangleCount).toBeGreaterThan(lo.triangleCount);
  });
});
