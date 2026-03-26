import { describe, it, expect } from 'vitest';
import { buildDomainIndex } from './domain-index.js';
import { tessellateBox, tessellateSphere, createTriangleMesh } from './triangle-mesh.js';
import { createGrid, totalCells } from './grid.js';

describe('buildDomainIndex', () => {
  it('empty mesh: all rows empty', () => {
    const mesh = createTriangleMesh(new Float32Array(0), new Uint32Array(0));
    const grid = createGrid(4, 4, 4, [1, 1, 1]);
    const idx = buildDomainIndex(mesh, grid);
    expect(idx.entryCount).toBe(0);
    const tc = totalCells(grid);
    for (let c = 0; c <= tc; c++) {
      expect(idx.triPtr[c]).toBe(0);
    }
  });

  it('single triangle spanning one cell', () => {
    // Triangle fully inside cell (0,0,0) of a grid with cellSize=[2,2,2]
    const positions = new Float32Array([0.1, 0.1, 0.1, 0.5, 0.1, 0.1, 0.1, 0.5, 0.1]);
    const indices = new Uint32Array([0, 1, 2]);
    const mesh = createTriangleMesh(positions, indices);
    const grid = createGrid(2, 2, 2, [2, 2, 2]);
    const idx = buildDomainIndex(mesh, grid);

    // Cell (0,0,0) should have 1 entry
    expect(idx.triPtr[1] - idx.triPtr[0]).toBe(1);
    expect(idx.triIndices[idx.triPtr[0]]).toBe(0);
    expect(idx.entryCount).toBe(1);
  });

  it('triangle spanning multiple cells', () => {
    // Large triangle spanning several cells
    const positions = new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const mesh = createTriangleMesh(positions, indices);
    const grid = createGrid(4, 4, 4, [1, 1, 1]);
    const idx = buildDomainIndex(mesh, grid);

    // Triangle AABB is [0,0,0]→[3,3,0], spans cells [0..3, 0..3, 0] = 16 cells
    expect(idx.entryCount).toBe(16);
  });

  it('box mesh in grid: boundary cells have entries', () => {
    const mesh = tessellateBox([1, 1, 1], [3, 3, 3]);
    const grid = createGrid(4, 4, 4, [1, 1, 1]);
    const idx = buildDomainIndex(mesh, grid);

    expect(idx.entryCount).toBeGreaterThan(0);

    // Cells far from the box (e.g., cell at grid origin) should have 0 entries
    // Cell (0,0,0) is at [0,1]³ — box starts at [1,1,1] but some triangles may overlap
    // Cell (3,3,3) is at [3,4]³ — box ends at [3,3,3], so face triangles overlap
    let cellsWithEntries = 0;
    const tc = totalCells(grid);
    for (let c = 0; c < tc; c++) {
      if (idx.triPtr[c + 1] > idx.triPtr[c]) cellsWithEntries++;
    }
    expect(cellsWithEntries).toBeGreaterThan(0);
    expect(cellsWithEntries).toBeLessThan(tc); // not all cells
  });

  it('CSR consistency', () => {
    const mesh = tessellateSphere([2, 2, 2], 1.5, 8, 16);
    const grid = createGrid(4, 4, 4, [1, 1, 1]);
    const idx = buildDomainIndex(mesh, grid);
    const tc = totalCells(grid);

    // triPtr is monotonic
    for (let c = 1; c <= tc; c++) {
      expect(idx.triPtr[c]).toBeGreaterThanOrEqual(idx.triPtr[c - 1]);
    }

    // triPtr[0] === 0
    expect(idx.triPtr[0]).toBe(0);

    // triPtr[last] === entryCount
    expect(idx.triPtr[tc]).toBe(idx.entryCount);

    // All triangle indices in range
    for (let i = 0; i < idx.entryCount; i++) {
      expect(idx.triIndices[i]).toBeLessThan(mesh.triangleCount);
    }
  });
});
