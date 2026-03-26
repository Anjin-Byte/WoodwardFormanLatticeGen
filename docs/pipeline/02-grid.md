# Stage 2: Lattice Grid

## Purpose

The grid defines *where* cells are placed in world space. It maps (i,j,k) cell indices to world-space axis-aligned bounding boxes. The grid carries no topology — it's purely spatial.

## Data Structure

```ts
interface LatticeGrid {
  /** Cell counts per axis. All > 0. */
  nx: number;
  ny: number;
  nz: number;

  /** Cell dimensions in world units per axis.
   *  Non-uniform per axis (prismatic voxels) but uniform across cells.
   *  All > 0. */
  cellSize: [number, number, number];

  /** World-space position of the grid's minimum corner (cell 0,0,0 origin). */
  origin: [number, number, number];
}
```

## Derived Quantities

```ts
/** Total number of cells. */
totalCells = nx * ny * nz;

/** Flat cell index from (i,j,k). Row-major order: k varies fastest. */
cellIndex(i, j, k) = i * (ny * nz) + j * nz + k;

/** (i,j,k) from flat cell index. */
cellCoords(idx) = {
  i: Math.floor(idx / (ny * nz)),
  j: Math.floor((idx % (ny * nz)) / nz),
  k: idx % nz,
};

/** World-space minimum corner of cell (i,j,k). */
cellOrigin(i, j, k) = [
  origin[0] + i * cellSize[0],
  origin[1] + j * cellSize[1],
  origin[2] + k * cellSize[2],
];

/** Transform a [0,1]³ local coordinate to world space within cell (i,j,k). */
localToWorld(i, j, k, lx, ly, lz) = [
  origin[0] + (i + lx) * cellSize[0],
  origin[1] + (j + ly) * cellSize[1],
  origin[2] + (k + lz) * cellSize[2],
];

/** Grid AABB in world space. */
gridMin = origin;
gridMax = [
  origin[0] + nx * cellSize[0],
  origin[1] + ny * cellSize[1],
  origin[2] + nz * cellSize[2],
];
```

## Control Flow

Grid construction is trivial — it's a parameter object. The interesting question is how to iterate it during population.

**Iteration order:** Row-major (i outer, k inner) matches the flat index layout. This gives good cache locality when writing to the BeamGraph arrays, since spatially adjacent cells produce adjacent array regions.

```
for i in 0..nx:
  for j in 0..ny:
    for k in 0..nz:
      populate(cell(i,j,k))
```

## Neighbor Lookup

During population, each cell needs to know whether its +x, +y, +z neighbors exist (to deduplicate shared nodes). Since the grid is dense and regular:

```ts
has_neighbor_px(i) = i < nx - 1;
has_neighbor_py(j) = j < ny - 1;
has_neighbor_pz(k) = k < nz - 1;
```

Neighbors in the -x, -y, -z directions are handled implicitly — when we process cell (i,j,k), we only look backward to check if cells (i-1,j,k), (i,j-1,k), (i,j,k-1) have already been processed and their boundary nodes are available for reuse.

## Invariants

1. `nx > 0 && ny > 0 && nz > 0`.
2. `cellSize[d] > 0` for all d.
3. `totalCells = nx * ny * nz` fits in a Uint32 (< 2³²). Practical limit: ~1600³ = 4B cells.
4. `cellIndex` and `cellCoords` are inverse operations.
5. Grid AABB contains all cell AABBs exactly.

## Testing

- **Index roundtrip:** For random (i,j,k) values, verify `cellCoords(cellIndex(i,j,k)) === (i,j,k)`.
- **Coordinate transform:** `localToWorld(i,j,k, 0,0,0)` equals `cellOrigin(i,j,k)`. `localToWorld(i,j,k, 1,1,1)` equals `cellOrigin(i+1,j+1,k+1)` (i.e., the max corner).
- **Boundary:** `localToWorld(0,0,0, 0,0,0)` equals `origin`. `localToWorld(nx-1,ny-1,nz-1, 1,1,1)` equals `gridMax`.
- **Neighbor consistency:** Cell (i,j,k)'s +x face world position equals cell (i+1,j,k)'s -x face world position.
