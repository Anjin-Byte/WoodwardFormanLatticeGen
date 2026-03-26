import type { LatticeGrid, CellClassification, Domain } from './pipeline-types.js';
import { CellClass } from './pipeline-types.js';
import { totalCells, cellIndex, localToWorld } from './grid.js';

/**
 * Convert a WASM occupancy bitfield (surface voxelization) into a CellClassification.
 *
 * The WASM voxelizer uses linear index: x + nx * (y + ny * z)  (x varies fastest)
 * Our grid uses: i*(ny*nz) + j*nz + k  (k varies fastest, i.e. i-major)
 *
 * When a `domain` is provided, non-boundary cells are classified via ray-cast
 * parity (domain.contains) instead of flood fill. This is robust for complex
 * meshes with thin features (handles, feet, close surfaces) where surface
 * voxelization leaves gaps that flood fill would leak through.
 */
export function occupancyToClassification(
  occupancy: Uint32Array,
  grid: LatticeGrid,
  domain?: Domain,
): CellClassification {
  const { nx, ny, nz } = grid;
  const tc = totalCells(grid);
  const result = new Uint8Array(tc) as CellClassification;

  // Mark boundary cells from occupancy bitfield.
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const wasmIdx = x + nx * (y + ny * z);
        const word = wasmIdx >> 5;
        const bit = wasmIdx & 31;
        if (occupancy[word] & (1 << bit)) {
          const ourIdx = cellIndex(grid, x, y, z);
          result[ourIdx] = CellClass.BOUNDARY;
        }
      }
    }
  }

  if (domain) {
    // Robust path: ray-cast parity per cell center.
    // No flood fill — immune to gaps in the voxel shell.
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let k = 0; k < nz; k++) {
          const idx = cellIndex(grid, i, j, k);
          if (result[idx] === CellClass.BOUNDARY) continue;
          const c = localToWorld(grid, i, j, k, 0.5, 0.5, 0.5);
          result[idx] = domain.contains(c[0], c[1], c[2])
            ? CellClass.INTERIOR
            : CellClass.EXTERIOR;
        }
      }
    }
  } else {
    // Fallback: flood fill from grid faces (less robust for complex meshes).
    const nyNz = ny * nz;
    const visited = new Uint8Array(tc);
    const queue: number[] = [];

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let k = 0; k < nz; k++) {
          if (i === 0 || i === nx - 1 || j === 0 || j === ny - 1 || k === 0 || k === nz - 1) {
            const idx = cellIndex(grid, i, j, k);
            if (result[idx] !== CellClass.BOUNDARY && !visited[idx]) {
              visited[idx] = 1;
              queue.push(idx);
              result[idx] = CellClass.EXTERIOR;
            }
          }
        }
      }
    }

    while (queue.length > 0) {
      const c = queue.shift()!;
      const i = Math.floor(c / nyNz);
      const rem = c % nyNz;
      const j = Math.floor(rem / nz);
      const k = rem % nz;

      const neighbors: number[] = [];
      if (i > 0)      neighbors.push(c - nyNz);
      if (i < nx - 1) neighbors.push(c + nyNz);
      if (j > 0)      neighbors.push(c - nz);
      if (j < ny - 1) neighbors.push(c + nz);
      if (k > 0)      neighbors.push(c - 1);
      if (k < nz - 1) neighbors.push(c + 1);

      for (const n of neighbors) {
        if (visited[n]) continue;
        if (result[n] === CellClass.BOUNDARY) continue;
        visited[n] = 1;
        result[n] = CellClass.EXTERIOR;
        queue.push(n);
      }
    }

    for (let c = 0; c < tc; c++) {
      if (result[c] === 0 && !visited[c]) {
        result[c] = CellClass.INTERIOR;
      }
    }
  }

  return result;
}
