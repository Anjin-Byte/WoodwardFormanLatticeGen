import { describe, it, expect } from 'vitest';
import { createUnitCell, UNIT_CELL_IDS } from './unit-cell.js';
import { createGrid, totalCells } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { createSphereDomain } from './domain.js';
import { classifyCells, applyClassification, trimBeams } from './boundary.js';
import { buildRenderData } from './render-data.js';
import { computeLatticeProperties, computePressureDrop } from './derived-properties.js';
import { validateUnitCell } from './validate.js';
import { BEAM_REMOVED } from './pipeline-types.js';

describe('full pipeline integration (cubic 4×4×4 + sphere)', () => {
  const cell = createUnitCell('cubic')!;
  const grid = createGrid(4, 4, 4, [1, 1, 1]);
  const pop = populate(cell, grid);
  const graph = buildBeamGraph(pop, grid);

  const domain = createSphereDomain([2, 2, 2], 1.8);
  const cls = classifyCells(graph, domain);
  applyClassification(graph, cls);
  const trim = trimBeams(graph, domain);
  const renderData = buildRenderData(graph, trim);
  const props = computeLatticeProperties(cell, grid, 0.05);

  it('unit cell validates', () => {
    expect(validateUnitCell(cell)).toEqual([]);
  });

  it('population produces correct counts', () => {
    expect(pop.beamCount).toBe(totalCells(grid) * cell.edgeCount);
    expect(pop.nodeCount).toBe(125); // 5³ for cubic 4×4×4
  });

  it('beam graph has correct beam count', () => {
    expect(graph.beamCount).toBe(pop.beamCount);
  });

  it('render count = beamCount - removed', () => {
    let removed = 0;
    for (let b = 0; b < graph.beamCount; b++) {
      if (graph.beamFlags[b] & BEAM_REMOVED) removed++;
    }
    expect(renderData.count).toBe(graph.beamCount - removed);
  });

  it('some beams were trimmed', () => {
    expect(trim.trimmedPositions.size).toBeGreaterThan(0);
  });

  it('some beams were removed', () => {
    expect(trim.removedBeams.size).toBeGreaterThan(0);
  });

  it('porosity is in (0, 1)', () => {
    expect(props.openPorosity).toBeGreaterThan(0);
    expect(props.openPorosity).toBeLessThan(1);
  });

  it('pressure drop > 0 for non-zero flow', () => {
    const dp = computePressureDrop(props, 1, 1.2, 1.8e-5, 0.01);
    expect(dp).toBeGreaterThan(0);
  });
});

describe('all unit cell types populate and build successfully', () => {
  for (const id of UNIT_CELL_IDS) {
    it(`${id}: 3×3×3 pipeline completes`, () => {
      const cell = createUnitCell(id)!;
      expect(cell).not.toBeNull();
      expect(validateUnitCell(cell)).toEqual([]);

      const grid = createGrid(3, 3, 3, [1, 1, 1]);
      const pop = populate(cell, grid);

      expect(pop.beamCount).toBe(27 * cell.edgeCount);
      expect(pop.nodeCount).toBeGreaterThan(0);

      // No duplicate positions
      const seen = new Set<string>();
      for (let i = 0; i < pop.nodeCount; i++) {
        const key = `${pop.positions[i * 3].toFixed(7)},${pop.positions[i * 3 + 1].toFixed(7)},${pop.positions[i * 3 + 2].toFixed(7)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      const graph = buildBeamGraph(pop, grid);
      const renderData = buildRenderData(graph);
      expect(renderData.count).toBe(graph.beamCount);
    });
  }
});
