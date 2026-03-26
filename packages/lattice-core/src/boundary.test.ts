import { describe, it, expect } from 'vitest';
import { createUnitCell } from './unit-cell.js';
import { createGrid, totalCells, cellCoords } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { createBoxDomain, createSphereDomain } from './domain.js';
import { classifyCells, applyClassification, trimBeams } from './boundary.js';
import {
  CellClass, BEAM_REMOVED, BEAM_BOUNDARY, BEAM_TRIMMED, BEAM_INTERIOR,
  NODE_INTERIOR, NODE_BOUNDARY, NODE_EXTERIOR,
} from './pipeline-types.js';

const cubic = createUnitCell('cubic')!;

function makeGraph(nx: number, ny: number, nz: number) {
  const grid = createGrid(nx, ny, nz, [1, 1, 1]);
  const pop = populate(cubic, grid);
  return buildBeamGraph(pop, grid);
}

describe('classifyCells', () => {
  it('box containing entire grid: all INTERIOR', () => {
    const graph = makeGraph(4, 4, 4);
    const domain = createBoxDomain([-1, -1, -1], [5, 5, 5]);
    const cls = classifyCells(graph, domain);

    const tc = totalCells(graph.grid);
    for (let c = 0; c < tc; c++) {
      expect(cls[c]).toBe(CellClass.INTERIOR);
    }
  });

  it('box containing no cells: all EXTERIOR', () => {
    const graph = makeGraph(4, 4, 4);
    const domain = createBoxDomain([10, 10, 10], [20, 20, 20]);
    const cls = classifyCells(graph, domain);

    const tc = totalCells(graph.grid);
    for (let c = 0; c < tc; c++) {
      expect(cls[c]).toBe(CellClass.EXTERIOR);
    }
  });

  it('box cutting grid in half: mix of classifications', () => {
    const graph = makeGraph(4, 4, 4);
    // Box covers x=[0,2], y=[0,4], z=[0,4] — left half
    const domain = createBoxDomain([0, 0, 0], [2, 4, 4]);
    const cls = classifyCells(graph, domain);

    let interior = 0, boundary = 0, exterior = 0;
    const tc = totalCells(graph.grid);
    for (let c = 0; c < tc; c++) {
      if (cls[c] === CellClass.INTERIOR) interior++;
      else if (cls[c] === CellClass.BOUNDARY) boundary++;
      else exterior++;
    }

    expect(interior).toBeGreaterThan(0);
    expect(boundary).toBeGreaterThan(0);
    expect(exterior).toBeGreaterThan(0);
    expect(interior + boundary + exterior).toBe(tc);
  });

  it('sphere domain: boundary cells form a shell', () => {
    const graph = makeGraph(6, 6, 6);
    const domain = createSphereDomain([3, 3, 3], 2.5);
    const cls = classifyCells(graph, domain);

    let interior = 0, boundary = 0, exterior = 0;
    const tc = totalCells(graph.grid);
    for (let c = 0; c < tc; c++) {
      if (cls[c] === CellClass.INTERIOR) interior++;
      else if (cls[c] === CellClass.BOUNDARY) boundary++;
      else exterior++;
    }

    expect(interior).toBeGreaterThan(0);
    expect(boundary).toBeGreaterThan(0);
    expect(exterior).toBeGreaterThan(0);
  });
});

describe('applyClassification', () => {
  it('marks exterior beams as REMOVED', () => {
    const graph = makeGraph(4, 4, 4);
    const domain = createBoxDomain([10, 10, 10], [20, 20, 20]);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);

    for (let b = 0; b < graph.beamCount; b++) {
      expect(graph.beamFlags[b] & BEAM_REMOVED).toBeTruthy();
    }
  });

  it('leaves interior beams unchanged when fully contained', () => {
    const graph = makeGraph(4, 4, 4);
    const domain = createBoxDomain([-1, -1, -1], [5, 5, 5]);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);

    for (let b = 0; b < graph.beamCount; b++) {
      expect(graph.beamFlags[b] & BEAM_REMOVED).toBe(0);
    }
  });
});

describe('trimBeams', () => {
  it('no trimming when all inside', () => {
    const graph = makeGraph(4, 4, 4);
    const domain = createBoxDomain([-1, -1, -1], [5, 5, 5]);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    const trim = trimBeams(graph, domain);

    expect(trim.trimmedPositions.size).toBe(0);
    expect(trim.removedBeams.size).toBe(0);
  });

  it('trims boundary beams with sphere domain', () => {
    const graph = makeGraph(6, 6, 6);
    const domain = createSphereDomain([3, 3, 3], 2.5);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    const trim = trimBeams(graph, domain);

    // Should have some trimmed positions and some removed beams
    expect(trim.trimmedPositions.size).toBeGreaterThan(0);
    expect(trim.removedBeams.size).toBeGreaterThan(0);
  });

  it('trimmed positions are on the domain boundary', () => {
    const graph = makeGraph(6, 6, 6);
    const center: [number, number, number] = [3, 3, 3];
    const radius = 2.5;
    const domain = createSphereDomain(center, radius);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    const trim = trimBeams(graph, domain);

    for (const [, pos] of trim.trimmedPositions) {
      const dx = pos[0] - center[0];
      const dy = pos[1] - center[1];
      const dz = pos[2] - center[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Should be approximately on the sphere surface
      expect(dist).toBeCloseTo(radius, 1);
    }
  });

  it('flag consistency: TRIMMED implies BOUNDARY', () => {
    const graph = makeGraph(6, 6, 6);
    const domain = createSphereDomain([3, 3, 3], 2.5);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    trimBeams(graph, domain);

    for (let b = 0; b < graph.beamCount; b++) {
      if (graph.beamFlags[b] & BEAM_TRIMMED) {
        expect(graph.beamFlags[b] & BEAM_BOUNDARY).toBeTruthy();
      }
    }
  });

  it('flag consistency: interior-only cells have no REMOVED beams', () => {
    const graph = makeGraph(6, 6, 6);
    const domain = createSphereDomain([3, 3, 3], 2.5);
    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    trimBeams(graph, domain);

    // Beams from INTERIOR cells should never be REMOVED
    const tc = totalCells(graph.grid);
    for (let c = 0; c < tc; c++) {
      if (cls[c] !== CellClass.INTERIOR) continue;
      const start = c * graph.edgesPerCell;
      const end = start + graph.edgesPerCell;
      for (let b = start; b < end; b++) {
        expect(graph.beamFlags[b] & BEAM_REMOVED).toBe(0);
      }
    }
  });
});
