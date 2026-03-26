import { describe, it, expect } from 'vitest';
import { occupancyToClassification } from './voxelize-wasm.js';
import { createGrid, totalCells, cellIndex } from './grid.js';
import { CellClass } from './pipeline-types.js';
import { tessellateBox, tessellateSphere } from './triangle-mesh.js';
import { createBoxDomain, createSphereDomain } from './domain.js';
import { createMeshDomain } from './mesh-domain.js';
import { createUnitCell } from './unit-cell.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { classifyCells, applyClassification, trimBeams } from './boundary.js';
import { buildRenderData } from './render-data.js';

/**
 * Simulate WASM voxelizer: conservative AABB marking with WASM index layout.
 * Linear index: x + nx * (y + ny * z)
 */
function simulateWasmVoxelize(
  positions: Float32Array,
  indices: Uint32Array,
  originX: number, originY: number, originZ: number,
  voxelSize: number,
  nx: number, ny: number, nz: number,
): Uint32Array {
  const numVoxels = nx * ny * nz;
  const occupancy = new Uint32Array(Math.ceil(numVoxels / 32));
  const invSize = 1 / voxelSize;
  const triCount = indices.length / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const vx = [
      (positions[i0 * 3] - originX) * invSize,
      (positions[i1 * 3] - originX) * invSize,
      (positions[i2 * 3] - originX) * invSize,
    ];
    const vy = [
      (positions[i0 * 3 + 1] - originY) * invSize,
      (positions[i1 * 3 + 1] - originY) * invSize,
      (positions[i2 * 3 + 1] - originY) * invSize,
    ];
    const vz = [
      (positions[i0 * 3 + 2] - originZ) * invSize,
      (positions[i1 * 3 + 2] - originZ) * invSize,
      (positions[i2 * 3 + 2] - originZ) * invSize,
    ];

    const minX = Math.max(0, Math.floor(Math.min(...vx) - 1e-4));
    const minY = Math.max(0, Math.floor(Math.min(...vy) - 1e-4));
    const minZ = Math.max(0, Math.floor(Math.min(...vz) - 1e-4));
    const maxX = Math.min(nx - 1, Math.floor(Math.max(...vx) + 1e-4));
    const maxY = Math.min(ny - 1, Math.floor(Math.max(...vy) + 1e-4));
    const maxZ = Math.min(nz - 1, Math.floor(Math.max(...vz) + 1e-4));

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const wasmIdx = x + nx * (y + ny * z);
          occupancy[wasmIdx >> 5] |= 1 << (wasmIdx & 31);
        }
      }
    }
  }

  return occupancy;
}

describe('occupancyToClassification index mapping', () => {
  it('empty occupancy: all cells EXTERIOR', () => {
    const grid = createGrid(4, 4, 4, [1, 1, 1]);
    const tc = totalCells(grid);
    const occupancy = new Uint32Array(Math.ceil(tc / 32));
    const cls = occupancyToClassification(occupancy, grid);
    for (let c = 0; c < tc; c++) {
      expect(cls[c]).toBe(CellClass.EXTERIOR);
    }
  });

  it('single cell marked in WASM layout maps to correct grid position', () => {
    const grid = createGrid(4, 5, 6, [1, 1, 1]);
    const occupancy = new Uint32Array(Math.ceil(totalCells(grid) / 32));

    // Mark cell (2, 3, 4) in WASM layout: x + nx*(y + ny*z) = 2 + 4*(3 + 5*4) = 2+92 = 94
    const wasmIdx = 2 + 4 * (3 + 5 * 4);
    occupancy[wasmIdx >> 5] |= 1 << (wasmIdx & 31);

    const cls = occupancyToClassification(occupancy, grid);
    const ourIdx = cellIndex(grid, 2, 3, 4);
    expect(cls[ourIdx]).toBe(CellClass.BOUNDARY);
  });

  it('non-square grid: WASM and our indices differ but mapping is correct', () => {
    const grid = createGrid(3, 4, 5, [1, 1, 1]);

    // WASM idx for (1,2,3) = 1 + 3*(2 + 4*3) = 1 + 42 = 43
    // Our idx for (1,2,3) = 1*20 + 2*5 + 3 = 33
    const wasmIdx = 1 + 3 * (2 + 4 * 3);
    const ourIdx = cellIndex(grid, 1, 2, 3);
    expect(wasmIdx).not.toBe(ourIdx); // indices MUST differ

    const occupancy = new Uint32Array(Math.ceil(totalCells(grid) / 32));
    occupancy[wasmIdx >> 5] |= 1 << (wasmIdx & 31);

    const cls = occupancyToClassification(occupancy, grid);
    expect(cls[ourIdx]).toBe(CellClass.BOUNDARY);
  });

  it('closed shell: interior cells are classified INTERIOR', () => {
    const grid = createGrid(6, 6, 6, [1, 1, 1]);
    const occupancy = new Uint32Array(Math.ceil(totalCells(grid) / 32));

    // Mark a shell at i/j/k = 1 and 4 (cells 1..4 on each axis)
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        for (let z = 0; z < 6; z++) {
          if (x >= 1 && x <= 4 && y >= 1 && y <= 4 && z >= 1 && z <= 4) {
            if (x === 1 || x === 4 || y === 1 || y === 4 || z === 1 || z === 4) {
              const wasmIdx = x + 6 * (y + 6 * z);
              occupancy[wasmIdx >> 5] |= 1 << (wasmIdx & 31);
            }
          }
        }
      }
    }

    const cls = occupancyToClassification(occupancy, grid);

    // Cells (2,2,2) to (3,3,3) should be INTERIOR
    for (let i = 2; i <= 3; i++) {
      for (let j = 2; j <= 3; j++) {
        for (let k = 2; k <= 3; k++) {
          expect(cls[cellIndex(grid, i, j, k)]).toBe(CellClass.INTERIOR);
        }
      }
    }

    // Corner cell (0,0,0) should be EXTERIOR
    expect(cls[cellIndex(grid, 0, 0, 0)]).toBe(CellClass.EXTERIOR);
  });
});

describe('WASM vs JS classification comparison', () => {
  it('box domain: WASM and JS paths produce same interior cell count', () => {
    const cell = createUnitCell('cubic')!;
    const grid = createGrid(6, 6, 6, [1, 1, 1]);
    const pop = populate(cell, grid);

    // JS path
    const graphJS = buildBeamGraph(pop, grid);
    const domainJS = createBoxDomain([1, 1, 1], [5, 5, 5]);
    const clsJS = classifyCells(graphJS, domainJS);

    // WASM-simulated path
    const boxMesh = tessellateBox([1, 1, 1], [5, 5, 5]);
    const occupancy = simulateWasmVoxelize(
      boxMesh.positions, boxMesh.indices,
      grid.origin[0], grid.origin[1], grid.origin[2],
      grid.cellSize[0], grid.nx, grid.ny, grid.nz,
    );
    const clsWASM = occupancyToClassification(occupancy, grid);

    const tc = totalCells(grid);
    let jsInterior = 0, wasmInterior = 0;
    for (let c = 0; c < tc; c++) {
      if (clsJS[c] === CellClass.INTERIOR) jsInterior++;
      if (clsWASM[c] === CellClass.INTERIOR) wasmInterior++;
    }

    console.log(`Box 6x6x6: JS interior=${jsInterior}, WASM interior=${wasmInterior}`);
    // Conservative AABB marking produces more boundary cells than SAT/BVH.
    // The key invariant: WASM interior should be a subset of JS interior
    // (WASM may mark some JS-interior cells as boundary, but not the reverse).
    expect(wasmInterior).toBeLessThanOrEqual(jsInterior);
    expect(wasmInterior).toBeGreaterThan(0); // some cells must be interior
  });

  it('sphere domain: both paths produce similar visible beam counts', () => {
    const cell = createUnitCell('cubic')!;
    const grid = createGrid(8, 8, 8, [1, 1, 1]);
    const pop = populate(cell, grid);

    // JS path
    const graphJS = buildBeamGraph(pop, grid);
    const domain = createSphereDomain([4, 4, 4], 3);
    const clsJS = classifyCells(graphJS, domain);
    applyClassification(graphJS, clsJS);
    trimBeams(graphJS, domain);
    const rdJS = buildRenderData(graphJS);

    // WASM path
    const graphWASM = buildBeamGraph(pop, grid);
    const sphereMesh = tessellateSphere([4, 4, 4], 3, 24, 48);
    const occupancy = simulateWasmVoxelize(
      sphereMesh.positions, sphereMesh.indices,
      grid.origin[0], grid.origin[1], grid.origin[2],
      grid.cellSize[0], grid.nx, grid.ny, grid.nz,
    );
    const clsWASM = occupancyToClassification(occupancy, grid);
    const meshDomain = createMeshDomain(sphereMesh);
    applyClassification(graphWASM, clsWASM);
    trimBeams(graphWASM, meshDomain);
    const rdWASM = buildRenderData(graphWASM);

    const ratio = rdWASM.count / rdJS.count;
    console.log(`Sphere 8x8x8: JS visible=${rdJS.count}, WASM visible=${rdWASM.count}, ratio=${ratio.toFixed(3)}`);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });
});
