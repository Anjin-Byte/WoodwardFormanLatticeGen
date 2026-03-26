import type { LatticeGrid } from './pipeline-types.js';

export function createGrid(
  nx: number,
  ny: number,
  nz: number,
  cellSize: [number, number, number],
  origin: [number, number, number] = [0, 0, 0],
): LatticeGrid {
  if (nx <= 0 || ny <= 0 || nz <= 0) {
    throw new Error(`grid dimensions must be > 0: (${nx}, ${ny}, ${nz})`);
  }
  if (cellSize[0] <= 0 || cellSize[1] <= 0 || cellSize[2] <= 0) {
    throw new Error(`cellSize must be > 0: (${cellSize.join(', ')})`);
  }
  return { nx, ny, nz, cellSize, origin };
}

export function totalCells(grid: LatticeGrid): number {
  return grid.nx * grid.ny * grid.nz;
}

export function cellIndex(grid: LatticeGrid, i: number, j: number, k: number): number {
  return i * (grid.ny * grid.nz) + j * grid.nz + k;
}

export function cellCoords(grid: LatticeGrid, idx: number): [number, number, number] {
  const nyNz = grid.ny * grid.nz;
  const i = Math.floor(idx / nyNz);
  const rem = idx % nyNz;
  const j = Math.floor(rem / grid.nz);
  const k = rem % grid.nz;
  return [i, j, k];
}

export function localToWorld(
  grid: LatticeGrid,
  i: number, j: number, k: number,
  lx: number, ly: number, lz: number,
): [number, number, number] {
  return [
    grid.origin[0] + (i + lx) * grid.cellSize[0],
    grid.origin[1] + (j + ly) * grid.cellSize[1],
    grid.origin[2] + (k + lz) * grid.cellSize[2],
  ];
}

export function cellOrigin(
  grid: LatticeGrid,
  i: number, j: number, k: number,
): [number, number, number] {
  return localToWorld(grid, i, j, k, 0, 0, 0);
}

export function cellCenter(grid: LatticeGrid, idx: number): [number, number, number] {
  const [i, j, k] = cellCoords(grid, idx);
  return localToWorld(grid, i, j, k, 0.5, 0.5, 0.5);
}

export function gridMin(grid: LatticeGrid): [number, number, number] {
  return [...grid.origin] as [number, number, number];
}

export function gridMax(grid: LatticeGrid): [number, number, number] {
  return [
    grid.origin[0] + grid.nx * grid.cellSize[0],
    grid.origin[1] + grid.ny * grid.cellSize[1],
    grid.origin[2] + grid.nz * grid.cellSize[2],
  ];
}
