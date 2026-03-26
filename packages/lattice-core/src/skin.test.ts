import { describe, it, expect } from 'vitest';
import { createUnitCell } from './unit-cell.js';
import { createGrid, totalCells } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { createSphereDomain, createBoxDomain } from './domain.js';
import { classifyCells, applyClassification, trimBeams } from './boundary.js';
import { generateSkin } from './skin.js';
import { CellClass } from './pipeline-types.js';

const cubic = createUnitCell('cubic')!;

function runPipeline(nx: number, ny: number, nz: number, domain: ReturnType<typeof createSphereDomain>) {
  const grid = createGrid(nx, ny, nz, [1, 1, 1]);
  const pop = populate(cubic, grid);
  const graph = buildBeamGraph(pop, grid);
  const cls = classifyCells(graph, domain);
  applyClassification(graph, cls);
  const trim = trimBeams(graph, domain);
  return { graph, trim, cls, grid };
}

describe('generateSkin', () => {
  it('produces skin beams for sphere domain', () => {
    const { graph, trim, cls } = runPipeline(6, 6, 6, createSphereDomain([3, 3, 3], 2.5));
    const skin = generateSkin(graph, trim, cubic, cls);

    expect(skin.beamCount).toBeGreaterThan(0);
    expect(skin.nodeCount).toBeGreaterThan(0);
    expect(skin.positions.length).toBe(skin.nodeCount * 3);
    expect(skin.edges.length).toBe(skin.beamCount * 2);
    expect(skin.beamRadii.length).toBe(skin.beamCount);
  });

  it('skin beam endpoints are on the domain surface', () => {
    const center: [number, number, number] = [3, 3, 3];
    const radius = 2.5;
    const { graph, trim, cls } = runPipeline(6, 6, 6, createSphereDomain(center, radius));
    const skin = generateSkin(graph, trim, cubic, cls);

    for (let i = 0; i < skin.nodeCount; i++) {
      const x = skin.positions[i * 3] - center[0];
      const y = skin.positions[i * 3 + 1] - center[1];
      const z = skin.positions[i * 3 + 2] - center[2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      // Trimmed positions should be approximately on the sphere
      expect(dist).toBeCloseTo(radius, 0);
    }
  });

  it('no skin beams when fully inside', () => {
    const { graph, trim, cls } = runPipeline(4, 4, 4, createSphereDomain([2, 2, 2], 10));
    const skin = generateSkin(graph, trim, cubic, cls);
    expect(skin.beamCount).toBe(0);
  });

  it('no skin beams when fully outside', () => {
    const { graph, trim, cls } = runPipeline(4, 4, 4, createSphereDomain([20, 20, 20], 1));
    const skin = generateSkin(graph, trim, cubic, cls);
    expect(skin.beamCount).toBe(0);
  });

  it('no duplicate skin beams', () => {
    const { graph, trim, cls } = runPipeline(6, 6, 6, createSphereDomain([3, 3, 3], 2.5));
    const skin = generateSkin(graph, trim, cubic, cls);

    const seen = new Set<string>();
    for (let i = 0; i < skin.beamCount; i++) {
      const a = skin.edges[i * 2];
      const b = skin.edges[i * 2 + 1];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('all skin edge indices in range', () => {
    const { graph, trim, cls } = runPipeline(6, 6, 6, createSphereDomain([3, 3, 3], 2.5));
    const skin = generateSkin(graph, trim, cubic, cls);

    for (let i = 0; i < skin.edges.length; i++) {
      expect(skin.edges[i]).toBeLessThan(skin.nodeCount);
    }
  });
});
