import type { TriangleMesh, LatticeGrid, DomainIndex } from './pipeline-types.js';
import { triangleBounds } from './triangle-mesh.js';
import { totalCells } from './grid.js';

export function buildDomainIndex(mesh: TriangleMesh, grid: LatticeGrid): DomainIndex {
  const tc = totalCells(grid);

  // Step 1: Count entries per cell
  const counts = new Uint32Array(tc);

  for (let t = 0; t < mesh.triangleCount; t++) {
    const bounds = triangleBounds(mesh, t);
    const [iMin, jMin, kMin] = worldToCell(grid, bounds.min);
    const [iMax, jMax, kMax] = worldToCell(grid, bounds.max);

    for (let i = iMin; i <= iMax; i++) {
      for (let j = jMin; j <= jMax; j++) {
        for (let k = kMin; k <= kMax; k++) {
          const cellIdx = i * (grid.ny * grid.nz) + j * grid.nz + k;
          counts[cellIdx]++;
        }
      }
    }
  }

  // Step 2: Prefix sum → triPtr
  const triPtr = new Uint32Array(tc + 1);
  triPtr[0] = 0;
  for (let c = 0; c < tc; c++) {
    triPtr[c + 1] = triPtr[c] + counts[c];
  }
  const entryCount = triPtr[tc];

  // Step 3: Scatter triangle indices
  const triIndices = new Uint32Array(entryCount);
  const offsets = new Uint32Array(tc);

  for (let t = 0; t < mesh.triangleCount; t++) {
    const bounds = triangleBounds(mesh, t);
    const [iMin, jMin, kMin] = worldToCell(grid, bounds.min);
    const [iMax, jMax, kMax] = worldToCell(grid, bounds.max);

    for (let i = iMin; i <= iMax; i++) {
      for (let j = jMin; j <= jMax; j++) {
        for (let k = kMin; k <= kMax; k++) {
          const cellIdx = i * (grid.ny * grid.nz) + j * grid.nz + k;
          triIndices[triPtr[cellIdx] + offsets[cellIdx]++] = t;
        }
      }
    }
  }

  return { triPtr, triIndices, entryCount };
}

function worldToCell(
  grid: LatticeGrid,
  point: [number, number, number],
): [number, number, number] {
  return [
    clampInt(Math.floor((point[0] - grid.origin[0]) / grid.cellSize[0]), 0, grid.nx - 1),
    clampInt(Math.floor((point[1] - grid.origin[1]) / grid.cellSize[1]), 0, grid.ny - 1),
    clampInt(Math.floor((point[2] - grid.origin[2]) / grid.cellSize[2]), 0, grid.nz - 1),
  ];
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
